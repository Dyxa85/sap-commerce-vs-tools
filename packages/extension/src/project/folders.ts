import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** One line of an extension's folder tree. */
export interface FolderEntry {
  path: string;
  /** What the tree shows; for packages with a single sub-folder this is `com/acme/core`. */
  label: string;
  isDir: boolean;
}

export interface HiddenRules {
  /** Names hidden at any depth. */
  anywhere: Set<string>;
  /** Paths hidden relative to the extension root (written with a leading `/`). */
  fromRoot: Set<string>;
}

/** `".git"` hides the name everywhere, `"/bin"` only the top-level folder of the extension. */
export function parseHidden(entries: readonly string[]): HiddenRules {
  const rules: HiddenRules = { anywhere: new Set(), fromRoot: new Set() };
  for (const raw of entries) {
    const entry = raw.trim();
    if (entry === '') continue;
    if (entry.startsWith('/')) rules.fromRoot.add(entry.slice(1).replace(/\/+$/, ''));
    else rules.anywhere.add(entry);
  }
  return rules;
}

/**
 * Well-known folders of an extension, by path relative to its root. They are shown with a short description and are
 * never merged with their single child (a source root stays a source root).
 */
export const FOLDER_ROLES: Readonly<Record<string, string>> = {
  src: 'sources',
  gensrc: 'generated sources',
  testsrc: 'test sources',
  resources: 'resources',
  lib: 'libraries',
  web: 'web module',
  'web/src': 'web sources',
  'web/gensrc': 'generated web sources',
  'web/testsrc': 'web test sources',
  'web/webroot': 'web root',
  backoffice: 'backoffice module',
  'backoffice/src': 'backoffice sources',
  'backoffice/testsrc': 'backoffice test sources',
  'backoffice/resources': 'backoffice resources',
  hmc: 'hMC module',
  'hmc/src': 'hMC sources',
  'hmc/resources': 'hMC resources',
  acceleratoraddon: 'addon',
  'acceleratoraddon/web': 'addon web',
  'acceleratoraddon/web/src': 'addon web sources',
  'acceleratoraddon/web/webroot': 'addon web root',
  docs: 'documentation',
  doc: 'documentation',
};

const posix = (p: string): string => p.split(sep).join('/');

export function roleOf(root: string, path: string): string | undefined {
  return FOLDER_ROLES[posix(relative(root, path))];
}

function isHidden(rules: HiddenRules, root: string, name: string, path: string): boolean {
  return rules.anywhere.has(name) || rules.fromRoot.has(posix(relative(root, path)));
}

async function isDirectory(
  path: string,
  dirent: { isDirectory(): boolean; isSymbolicLink(): boolean },
) {
  if (dirent.isDirectory()) return true;
  if (!dirent.isSymbolicLink()) return false;
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false; // dangling link
  }
}

async function readVisible(dir: string, root: string, rules: HiddenRules) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: { name: string; path: string; isDir: boolean }[] = [];
  for (const e of entries) {
    const path = join(dir, e.name);
    if (isHidden(rules, root, e.name, path)) continue;
    result.push({ name: e.name, path, isDir: await isDirectory(path, e) });
  }
  return result;
}

const MAX_COMPACT_DEPTH = 24;

/**
 * The entries of one folder: folders first, then files, both sorted without regard to case. A folder that contains
 * nothing but one other folder is merged with it (like Java packages in an IDE), except for well-known folders.
 */
export async function listFolder(
  dir: string,
  root: string,
  rules: HiddenRules,
): Promise<FolderEntry[]> {
  const entries = (await readVisible(dir, root, rules)).sort(
    (a, b) =>
      Number(b.isDir) - Number(a.isDir) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  const result: FolderEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDir || roleOf(root, entry.path)) {
      result.push({ path: entry.path, label: entry.name, isDir: entry.isDir });
      continue;
    }
    let path = entry.path;
    let label = entry.name;
    for (let depth = 0; depth < MAX_COMPACT_DEPTH; depth++) {
      const inner = await readVisible(path, root, rules);
      const only = inner.length === 1 ? inner[0] : undefined;
      if (!only?.isDir || roleOf(root, only.path)) break;
      path = only.path;
      label += `/${only.name}`;
    }
    result.push({ path, label, isDir: true });
  }
  return result;
}
