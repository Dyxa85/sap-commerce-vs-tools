import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ExtensionInfo } from './model.js';

export type FileKind =
  | 'items'
  | 'beans'
  | 'spring'
  | 'process'
  | 'impex'
  | 'flexsearch'
  | 'backoffice'
  | 'properties'
  | 'other';

export interface ExtensionFile {
  kind: FileKind;
  path: string;
  /** Path relative to the extension directory. */
  relativePath: string;
}

export function classifyFile(name: string, relativeDir: string): FileKind | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith('-items.xml')) return 'items';
  if (lower.endsWith('-beans.xml')) return 'beans';
  if (lower.endsWith('-spring.xml')) return 'spring';
  if (lower.endsWith('.impex')) return 'impex';
  if (lower.endsWith('.fxs') || lower.endsWith('.flexsearch') || lower.endsWith('.flexiblesearch'))
    return 'flexsearch';
  if (
    /backoffice-(config|widgets|spring)\.xml$/.test(lower) ||
    lower.endsWith('-backoffice-config.xml')
  )
    return 'backoffice';
  if (lower.endsWith('.xml') && /(^|[\\/])processes?([\\/]|$)/i.test(relativeDir)) return 'process';
  if (lower === 'project.properties' || lower === 'localextensions.xml') return 'properties';
  return undefined;
}

const SKIP = new Set([
  'node_modules',
  '.git',
  'classes',
  'eclipsebin',
  'lib',
  'bin',
  'web',
  'gensrc',
  'src',
  'testsrc',
  'doc',
  'docs',
  'target',
]);

/** The files of an extension that matter for navigation (type system, beans, spring, processes, ImpEx, …). */
export async function listExtensionFiles(
  info: ExtensionInfo,
  maxDepth = 5,
): Promise<ExtensionFile[]> {
  const files: ExtensionFile[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth && !SKIP.has(entry.name) && !entry.name.startsWith('.'))
          await visit(path, depth + 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const rel = relative(info.dir, path);
        const kind = classifyFile(entry.name, relative(info.dir, dir));
        if (kind) files.push({ kind, path, relativePath: rel });
      }
    }
  };
  await visit(info.dir, 0);
  // project.properties lives in the extension root, the rest under resources/
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
