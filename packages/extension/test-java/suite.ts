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

  if (env('LAB_TREE') === '1') return dumpTrees(log);

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
    await sleep(Number(env('LAB_POLL_MS', '20000')));
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
  // ---- cost of the Java build: restart, a small edit, and what `ant clean all` does (rewrites every gensrc file)
  if (env('LAB_MEASURE') === '1') {
    const { execSync } = await import('node:child_process');
    const { readdirSync, statSync, utimesSync, appendFileSync: append } = await import('node:fs');
    const mark = env('LAB_BASE', 'sapc-javalab');
    const sampleServer = (): { cpu: number; rssMb: number } | undefined => {
      const out = execSync('ps -axo pid=,pcpu=,rss=,command=', {
        encoding: 'utf8',
        maxBuffer: 64 << 20,
      });
      // the memory Activity Monitor shows: RSS leaves out pages macOS has compressed, `footprint` includes them
      const footprintMb = (pid: string, fallback: number): number => {
        try {
          const text = execSync(`footprint -p ${pid}`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          const m = /Footprint:\s+([\d.]+)\s+(KB|MB|GB)/.exec(text);
          if (m) return Number(m[1]) * ({ KB: 1 / 1024, MB: 1, GB: 1024 }[m[2] as 'KB'] ?? 1);
        } catch {
          // fall through
        }
        return fallback;
      };
      const rows = out
        .split('\n')
        .filter((l) => l.includes('org.eclipse.equinox.launcher') && l.includes(mark))
        .map((l) => l.trim().split(/\s+/))
        .map((c) => ({
          cpu: Number(c[1]),
          rssMb: footprintMb(c[0] as string, Number(c[2]) / 1024),
        }));
      return rows.length
        ? { cpu: Math.max(...rows.map((r) => r.cpu)), rssMb: Math.max(...rows.map((r) => r.rssMb)) }
        : undefined;
    };
    /** Busy = the server uses CPU. Idle = below 8 % for 20 s in a row. Returns seconds until idle and the peak memory. */
    const untilIdle = async (label: string, maxSeconds = 900): Promise<void> => {
      const t0 = Date.now();
      let idleSince = 0;
      let peak = 0;
      let busySeen = false;
      while ((Date.now() - t0) / 1000 < maxSeconds) {
        await sleep(2000);
        const m = sampleServer();
        if (!m) continue;
        peak = Math.max(peak, m.rssMb);
        if (m.cpu >= 8) {
          busySeen = true;
          idleSince = 0;
        } else if (!idleSince) idleSince = Date.now();
        // a build that has not started yet looks idle: wait for the first busy sample (at most 20 s)
        if (idleSince && Date.now() - idleSince >= 20000 && (busySeen || Date.now() - t0 > 20000))
          break;
      }
      const end = idleSince && idleSince > t0 ? idleSince : Date.now();
      log(
        `${label}: busy for ${Math.round((end - t0) / 1000)} s (peak memory ${Math.round(peak)} MB, busy seen: ${busySeen})`,
      );
    };

    await untilIdle('restart (already built profile)');

    // what the server keeps once it has been idle for a while (the heap that the collector does not give back counts)
    await sleep(Number(env('LAB_STEADY_S', '90')) * 1000);
    const steady = sampleServer();
    if (steady) log(`steady state after restart: ${Math.round(steady.rssMb)} MB`);

    // a small edit saved to disk
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(doc);
    const original = doc.getText();
    await editor.edit((b) =>
      b.insert(
        doc.positionAt(original.lastIndexOf('}')),
        '\n    // lab edit\n    private int labField = 1;\n',
      ),
    );
    await doc.save();
    await untilIdle('one saved edit');
    await editor.edit((b) =>
      b.replace(
        new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
        original,
      ),
    );
    await doc.save();
    await untilIdle('edit reverted');

    // what `ant clean all` does to the Java server: every generated source file is written again
    const touched: string[] = [];
    const walk = (dir: string, depth = 0): void => {
      for (const name of readdirSync(dir)) {
        const p = `${dir}/${name}`;
        const st = statSync(p);
        if (st.isDirectory()) walk(p, depth + 1);
        else if (name.endsWith('.java')) touched.push(p);
      }
    };
    const gensrcDirs = env('LAB_GENSRC').split(',').filter(Boolean);
    for (const d of gensrcDirs) walk(d);
    const now = new Date();
    for (const f of touched) utimesSync(f, now, now);
    log(`rewrote ${touched.length} generated source files in ${gensrcDirs.length} gensrc folders`);
    await untilIdle('after "ant clean all" (all gensrc files rewritten)', 1500);
    append(report, '');
  }

  log('DONE');
}

/** What the side bar shows for the opened folder (LAB_TREE=1): structure of the views, not pixels. */
async function dumpTrees(log: (line: string) => void): Promise<void> {
  type Tree<N> = {
    getChildren(n?: N): Promise<N[]> | N[];
    getTreeItem(n: N): vscode.TreeItem;
    nodeFor?(path: string): Promise<N | undefined>;
    getParent?(n: N): N | undefined;
    message?(): string | undefined;
  };
  const own = vscode.extensions.all.find((e) => e.packageJSON.name === 'sap-commerce-vs-tools');
  const api = (await own?.activate()) as {
    project: { refresh(): Promise<void> };
    projectTree: Tree<unknown>;
    ccv2: { service: { refresh(): Promise<void> }; tree: Tree<unknown> };
    changes: { tree: Tree<unknown> };
  };
  await api.project.refresh();
  await api.ccv2.service.refresh();
  await sleep(4000); // the Git extension scans the repositories
  const icon = (item: vscode.TreeItem): string => {
    const i = item.iconPath as { id?: string; fsPath?: string } | undefined;
    return i?.id ?? (i?.fsPath ? i.fsPath.split('/').pop()! : '');
  };
  const show = async (
    tree: Tree<unknown>,
    node: unknown,
    depth: number,
    max: number,
  ): Promise<void> => {
    const item = tree.getTreeItem(node);
    const label = typeof item.label === 'string' ? item.label : item.label?.label;
    log(
      `${'  '.repeat(depth)}${label}${item.description ? `  [${item.description}]` : ''}  <${icon(item)}>`,
    );
    if (depth >= max) return;
    const children = await tree.getChildren(node);
    for (const child of children.slice(0, 8)) await show(tree, child, depth + 1, max);
    if (children.length > 8) log(`${'  '.repeat(depth + 1)}… ${children.length - 8} more`);
  };
  log('== Commerce Project');
  for (const top of await api.projectTree.getChildren()) await show(api.projectTree, top, 0, 1);
  const tops = await api.projectTree.getChildren();
  for (const top of tops) {
    const label = String(api.projectTree.getTreeItem(top).label);
    for (const child of await api.projectTree.getChildren(top)) {
      const c = String(api.projectTree.getTreeItem(child).label);
      if (['Configuration', 'Root'].includes(c)) {
        log(`== ${label} / ${c}`);
        await show(api.projectTree, child, 0, 1);
      }
    }
  }
  log('== CCv2');
  for (const top of await api.ccv2.tree.getChildren()) await show(api.ccv2.tree, top, 0, 1);
  log('== Changes');
  log(`message: ${api.changes.tree.message?.()}`);
  for (const top of await api.changes.tree.getChildren()) await show(api.changes.tree, top, 0, 1);
  const file = env('LAB_FILE');
  if (file && api.projectTree.nodeFor) {
    let node = await api.projectTree.nodeFor(file);
    const chain: string[] = [];
    while (node) {
      chain.unshift(String(api.projectTree.getTreeItem(node).label));
      node = api.projectTree.getParent?.(node);
    }
    log(`== reveal ${file}\n   ${chain.join(' > ') || '(not shown)'}`);
  }
  log('DONE');
}
