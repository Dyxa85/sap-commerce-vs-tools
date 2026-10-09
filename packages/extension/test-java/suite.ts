/**
 * Java lab: runs inside VS Code next to the real Red Hat Java extension and reports what the Java language server makes
 * of a platform. Not part of the normal tests (it needs a platform, the Java extension and several minutes).
 * Configured through environment variables, see run.ts.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import * as vscode from 'vscode';

const env = (name: string, fallback = ''): string => process.env[name] ?? fallback;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function run(): Promise<void> {
  const report = env('LAB_REPORT');
  writeFileSync(report, '');
  const log = (line: string): void =>
    appendFileSync(report, `${new Date().toISOString().slice(11, 19)} ${line}\n`);
  const file = env('LAB_FILE');
  const maxMinutes = Number(env('LAB_WAIT_MIN', '25'));

  const java = vscode.extensions.getExtension('redhat.java');
  if (!java) throw new Error('redhat.java is not installed in the lab profile');
  await java.activate();
  log(`redhat.java ${java.packageJSON.version} active`);

  // the project model loads in the background; the command does nothing before it is there
  const own = vscode.extensions.all.find((e) => e.packageJSON.name === 'sap-commerce-vs-tools');
  const ownApi = (await own?.activate()) as
    { project: { refresh(): Promise<void>; projects: { loaded: unknown[] }[] } } | undefined;
  await ownApi?.project.refresh();
  log(
    `project model: ${ownApi?.project.projects.length} project(s), ${ownApi?.project.projects[0]?.loaded.length} extensions loaded`,
  );

  const phase = env('LAB_PHASE', 'all');
  if (env('LAB_LS_FIRST') === '1') {
    // like a user: the Java server has been running for a while with the project as it was, then we configure
    const early = java.exports as { serverReady?: () => Promise<unknown> } | undefined;
    await early?.serverReady?.();
    await vscode.commands.executeCommand('java.execute.workspaceCommand', 'java.project.getAll');
    await sleep(Number(env('LAB_LS_FIRST_PAUSE', '60')) * 1000);
    log('language server was running before configuring');
  }
  const hintApi = ownApi as unknown as { javaHint?: { active: boolean } } | undefined;
  log(`java hint active before configuring: ${hintApi?.javaHint?.active}`);
  if (env('LAB_CONFIGURE') === '1' && phase !== 'verify') {
    const original = vscode.window.showInformationMessage;
    (vscode.window as unknown as Record<string, unknown>).showInformationMessage = async (
      _message: string,
      ...rest: unknown[]
    ): Promise<unknown> => {
      const items = rest.filter((r): r is string => typeof r === 'string');
      return items.includes('Write settings') ? 'Write settings' : undefined;
    };
    try {
      await vscode.commands.executeCommand('sapcommerce.java.configure');
    } finally {
      (vscode.window as unknown as Record<string, unknown>).showInformationMessage = original;
    }
    log('sapcommerce.java.configure done');
    await sleep(2000);
    log(`java hint active after configuring: ${hintApi?.javaHint?.active}`);
  }

  if (env('LAB_LIST_COMMANDS') === '1') {
    const all = await vscode.commands.getCommands(true);
    log(
      `java commands: ${all.filter((c) => /^java\.(server|clean|projectConfiguration|workspace|project\.)/.test(c)).join(', ')}`,
    );
  }
  const reload = env('LAB_RELOAD');
  if (reload && phase !== 'verify') {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    log(`reload via ${reload}`);
    try {
      if (reload === 'update')
        await vscode.commands.executeCommand('java.projectConfiguration.update', folder);
      else if (reload === 'restart') await vscode.commands.executeCommand('java.server.restart');
      else if (reload === 'clean') {
        // the clean command asks for a confirmation; answer it
        const w = vscode.window as unknown as Record<string, unknown>;
        const keep = [w.showWarningMessage, w.showInformationMessage];
        const answer = async (_m: string, ...rest: unknown[]): Promise<unknown> =>
          rest.find((r) => typeof r === 'string');
        w.showWarningMessage = answer;
        w.showInformationMessage = answer;
        try {
          await vscode.commands.executeCommand('java.clean.workspace');
        } finally {
          [w.showWarningMessage, w.showInformationMessage] = keep;
        }
      }
    } catch (err) {
      log(`reload failed: ${String(err)}`);
    }
    await sleep(Number(env('LAB_RELOAD_PAUSE', '20')) * 1000);
  }
  if (phase === 'prepare') {
    log('prepared');
    log('DONE');
    return;
  }

  const started = Date.now();
  const api = java.exports as { serverReady?: () => Promise<unknown> } | undefined;
  await api?.serverReady?.();
  log(`language server ready after ${Math.round((Date.now() - started) / 1000)} s`);

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document);

  // This command only answers when the server has finished importing and building the project: it is the barrier.
  try {
    const projects = (await vscode.commands.executeCommand(
      'java.execute.workspaceCommand',
      'java.project.getAll',
    )) as string[];
    log(
      `build barrier passed after ${Math.round((Date.now() - started) / 1000)} s; java projects: ${projects?.length}`,
    );
    for (const p of projects.slice(0, 5)) log(`  ${p}`);
  } catch (err) {
    log(`could not list projects: ${String(err)}`);
  }

  let stable = 0;
  let last = -1;
  while ((Date.now() - started) / 60000 < maxMinutes) {
    await sleep(15000);
    const d = vscode.languages.getDiagnostics(document.uri);
    const errors = d.filter((x) => x.severity === vscode.DiagnosticSeverity.Error).length;
    log(`diagnostics on file: ${errors} errors, ${d.length - errors} others`);
    stable = errors === last ? stable + 1 : 0;
    last = errors;
    if (stable >= 4) break; // unchanged for 60 s after the barrier
  }

  const diagnostics = vscode.languages.getDiagnostics(document.uri);
  const errors = diagnostics.filter((x) => x.severity === vscode.DiagnosticSeverity.Error);
  log(`FINAL ${errors.length} errors in ${file.split('/').pop()}`);
  for (const e of errors.slice(0, 25)) log(`  line ${e.range.start.line + 1}: ${e.message}`);

  // positive control: does the server know where every imported type comes from?
  const text = document.getText();
  const resolve = async (offset: number): Promise<string | undefined> => {
    const found = (await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      document.uri,
      document.positionAt(offset),
    )) as (vscode.Location | vscode.LocationLink)[] | undefined;
    const first = found?.[0];
    return first ? ('uri' in first ? first.uri : first.targetUri).toString() : undefined;
  };
  const importsOf = (): { full: string; at: number }[] => {
    const result: { full: string; at: number }[] = [];
    for (const m of text.matchAll(/^import\s+(?:static\s+)?([\w.]+?)(?:\.\*)?;/gm)) {
      const full = m[1] as string;
      if (full.startsWith('java.') || full.startsWith('javax.')) continue; // the JDK is always there
      // the last segment of the import line; for a static import the member is as good as a type
      result.push({ full, at: (m.index ?? 0) + m[0].lastIndexOf(full.split('.').pop() as string) });
    }
    return result;
  };
  // the server builds in the background: measure until the result stops changing
  let previous = '';
  let same = 0;
  let unresolved: string[] = [];
  const total = importsOf().length;
  while ((Date.now() - started) / 60000 < maxMinutes) {
    unresolved = [];
    for (const i of importsOf()) if (!(await resolve(i.at))) unresolved.push(i.full);
    log(
      `imports resolved: ${total - unresolved.length} of ${total} (${Math.round((Date.now() - started) / 1000)} s)`,
    );
    const key = unresolved.join(',');
    same = key === previous ? same + 1 : 0;
    previous = key;
    if (unresolved.length === 0 || same >= Number(env('LAB_STABLE_POLLS', '18'))) break; // default: unchanged for 6 minutes
    await sleep(20000);
  }
  for (const u of unresolved) log(`  NOT RESOLVED: ${u}`);
  // a sample of other files: how many of their imports does the server resolve?
  const sample = env('LAB_FILES').split(',').filter(Boolean);
  let sampleTotal = 0;
  let sampleResolved = 0;
  for (const path of sample) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    await vscode.window.showTextDocument(doc);
    const body = doc.getText();
    const missing: string[] = [];
    let count = 0;
    for (const m of body.matchAll(/^import\s+(?:static\s+)?([\w.]+?)(?:\.\*)?;/gm)) {
      const full = m[1] as string;
      if (full.startsWith('java.') || full.startsWith('javax.')) continue;
      count++;
      const isStatic = /^import\s+static/.test(m[0]);
      const segment = isStatic
        ? (full.split('.').at(-2) as string)
        : (full.split('.').pop() as string);
      const at = (m.index ?? 0) + m[0].lastIndexOf(segment);
      const found = (await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        doc.uri,
        doc.positionAt(at),
      )) as unknown[] | undefined;
      if (!found?.length) missing.push(full);
    }
    sampleTotal += count;
    sampleResolved += count - missing.length;
    const short = path.replace(/^.*\/hybris\/bin\//, '');
    log(
      `FILE ${short}: ${count - missing.length}/${count}${missing.length ? ` missing: ${missing.slice(0, 4).join(', ')}` : ''}`,
    );
  }
  if (sample.length)
    log(`SAMPLE imports resolved: ${sampleResolved} of ${sampleTotal} in ${sample.length} files`);
  log('DONE');
}
