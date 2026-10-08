import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseExtensionInfo } from './extensioninfo.js';
import type { ExtensionInfo } from './model.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.idea',
  '.vscode',
  'eclipsebin',
  'classes',
  'testclasses',
  'temp',
  'log',
  'data',
  'tomcat',
  'apache-ant',
  'lib',
  'bootstrap',
  'doc',
  'docs',
  'target',
  'build',
  'dist',
]);

/** True for directories and for symlinks that point to directories (CCv2 builds link modules into `bin/modules`). */
async function isDirectory(
  parent: string,
  entry: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean },
): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return (await stat(join(parent, entry.name))).isDirectory();
  } catch {
    return false; // dangling link
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The `hybris` directories (those with `bin/platform/extensions.xml`) at or below `start`. */
export async function findHybrisDirs(start: string, maxDepth = 4): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (await exists(join(dir, 'bin', 'platform', 'extensions.xml'))) {
      found.push(dir);
      return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        !SKIP_DIRS.has(entry.name) &&
        !entry.name.startsWith('.') &&
        (await isDirectory(dir, entry))
      ) {
        await visit(join(dir, entry.name), depth + 1);
      }
    }
  };
  await visit(start, 0);
  return found;
}

/**
 * Finds every directory below `dir` that contains an `extensioninfo.xml` (does not descend into extensions).
 * Inside a `platform` directory only `ext` is scanned (tomcat, ant and friends are huge and irrelevant).
 */
export async function scanForExtensions(
  dir: string,
  binDir: string,
  maxDepth = 6,
): Promise<ExtensionInfo[]> {
  const result: ExtensionInfo[] = [];
  const seen = new Set<string>(); // real paths, protects against symlink cycles
  const visit = async (current: string, depth: number): Promise<void> => {
    try {
      const real = await realpath(current);
      if (seen.has(real)) return;
      seen.add(real);
    } catch {
      return;
    }
    const infoFile = join(current, 'extensioninfo.xml');
    if (await exists(infoFile)) {
      try {
        const info = parseExtensionInfo(await readFile(infoFile, 'utf8'), infoFile, binDir);
        if (info) result.push(info);
      } catch {
        // unreadable file: skip
      }
      return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    const isPlatformDir = await exists(join(current, 'extensions.xml'));
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      if (isPlatformDir && entry.name !== 'ext') continue;
      if (!(await isDirectory(current, entry))) continue;
      await visit(join(current, entry.name), depth + 1);
    }
  };
  await visit(dir, 0);
  return result;
}
