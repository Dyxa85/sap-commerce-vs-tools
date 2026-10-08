import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { scanForExtensions } from './discover.js';
import { parseExtensionInfo } from './extensioninfo.js';
import { defaultVariables, parseLocalExtensions } from './localextensions.js';
import type { DependencyEdge, ExtensionInfo, PlatformProblem, PlatformProject } from './model.js';

/** Reads the whole project model of one `hybris` directory. */
export async function loadPlatform(hybrisDir: string): Promise<PlatformProject> {
  const variables = defaultVariables(hybrisDir);
  const binDir = variables.HYBRIS_BIN_DIR;
  const configDir = variables.HYBRIS_CONFIG_DIR;
  const platformDir = variables.platformhome;
  const problems: PlatformProblem[] = [];

  const localFile = join(configDir, 'localextensions.xml');
  let local;
  try {
    local = parseLocalExtensions(await readFile(localFile, 'utf8'), localFile, variables);
    problems.push(...local.problems);
  } catch {
    problems.push({
      severity: 'warning',
      message: 'config/localextensions.xml not found: only the platform extensions are loaded.',
      file: localFile,
    });
  }

  // 1. everything on the scan paths (+ platform/ext, which is always scanned)
  const available = new Map<string, ExtensionInfo>();
  const add = (info: ExtensionInfo): void => {
    const existing = available.get(info.name);
    if (existing && existing.dir !== info.dir) {
      problems.push({
        severity: 'warning',
        message: `Extension "${info.name}" exists twice: ${existing.dir} and ${info.dir}. The first one is used.`,
        file: localFile,
      });
      return;
    }
    available.set(info.name, info);
  };
  const scanDirs = [join(platformDir, 'ext'), ...(local?.scanPaths.map((p) => p.dir) ?? [binDir])];
  const platformExt = await scanForExtensions(join(platformDir, 'ext'), binDir);
  for (const info of platformExt) add(info);
  for (const dir of scanDirs.slice(1))
    for (const info of await scanForExtensions(dir, binDir)) add(info);

  // 2. extensions given by directory
  for (const entry of local?.entries ?? []) {
    if (entry.kind !== 'dir') continue;
    try {
      const infoFile = join(entry.dir, 'extensioninfo.xml');
      const info = parseExtensionInfo(await readFile(infoFile, 'utf8'), infoFile, binDir);
      if (info) add(info);
      else
        problems.push({
          severity: 'error',
          message: `No extension name in ${infoFile}`,
          file: local?.file ?? localFile,
          span: entry.span,
        });
    } catch {
      problems.push({
        severity: 'error',
        message: `No extensioninfo.xml in ${entry.dir}`,
        file: local?.file ?? localFile,
        span: entry.span,
      });
    }
  }

  // 3. what is requested
  const requested = new Set<string>(platformExt.map((e) => e.name));
  const autoload = local?.scanPaths.filter((p) => p.autoload) ?? [];
  for (const path of autoload)
    for (const info of await scanForExtensions(path.dir, binDir)) requested.add(info.name);
  for (const entry of local?.entries ?? []) {
    if (entry.kind === 'name') {
      if (available.has(entry.name)) requested.add(entry.name);
      else
        problems.push({
          severity: 'error',
          message: `Extension "${entry.name}" was not found on any scan path.`,
          file: local?.file ?? localFile,
          span: entry.span,
        });
    } else {
      const wanted = resolve(entry.dir);
      const info = [...available.values()].find((e) => resolve(e.dir) === wanted);
      if (info) requested.add(info.name);
    }
  }

  // 4. dependency closure in load order
  const { loaded, problems: graphProblems } = resolveLoadOrder(
    available,
    requested,
    local?.file ?? localFile,
  );
  problems.push(...graphProblems);

  return {
    hybrisDir,
    binDir,
    configDir,
    platformDir,
    localExtensionsFile: local ? localFile : undefined,
    local,
    available,
    loaded,
    requested,
    problems,
  };
}

/** Depth-first topological order: an extension comes after everything it requires. */
export function resolveLoadOrder(
  available: ReadonlyMap<string, ExtensionInfo>,
  requested: ReadonlySet<string>,
  file: string,
): { loaded: ExtensionInfo[]; problems: PlatformProblem[] } {
  const loaded: ExtensionInfo[] = [];
  const problems: PlatformProblem[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const reportedMissing = new Set<string>();

  const visit = (name: string, path: string[]): void => {
    const current = state.get(name);
    if (current === 'done') return;
    if (current === 'visiting') {
      const cycle = [...path.slice(path.indexOf(name)), name];
      problems.push({
        severity: 'error',
        message: `Circular dependency: ${cycle.join(' → ')}`,
        file,
      });
      return;
    }
    const info = available.get(name);
    if (!info) return;
    state.set(name, 'visiting');
    for (const required of info.requires) {
      if (!available.has(required)) {
        const key = `${name}>${required}`;
        if (!reportedMissing.has(key)) {
          reportedMissing.add(key);
          problems.push({
            severity: 'error',
            message: `Extension "${name}" requires "${required}", which was not found.`,
            file: info.infoFile,
          });
        }
        continue;
      }
      visit(required, [...path, name]);
    }
    state.set(name, 'done');
    loaded.push(info);
  };

  for (const name of [...requested].sort()) visit(name, []);
  return { loaded, problems };
}

export function dependencyEdges(extensions: readonly ExtensionInfo[]): DependencyEdge[] {
  const names = new Set(extensions.map((e) => e.name));
  return extensions.flatMap((e) =>
    e.requires.filter((r) => names.has(r)).map((to) => ({ from: e.name, to })),
  );
}

/** Extensions that (transitively) depend on `name`. */
export function dependents(extensions: readonly ExtensionInfo[], name: string): string[] {
  const reverse = new Map<string, string[]>();
  for (const e of extensions)
    for (const r of e.requires) reverse.set(r, [...(reverse.get(r) ?? []), e.name]);
  const result = new Set<string>();
  const stack = [name];
  while (stack.length > 0) {
    for (const next of reverse.get(stack.pop() as string) ?? []) {
      if (!result.has(next)) {
        result.add(next);
        stack.push(next);
      }
    }
  }
  return [...result].sort();
}
