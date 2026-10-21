import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** A JavaScript project next to the SAP Commerce backend (a storefront, a portal, …). */
export interface FrontendProject {
  dir: string;
  /** The folder name, which is what the team calls the project. */
  name: string;
  /** What it is built with, as far as `package.json` tells. */
  framework: 'Angular' | 'React' | 'Vue' | 'Node.js';
}

/** Folders that hold dependencies, build output or the backend itself and are never searched. */
const SKIP = new Set([
  'node_modules',
  'hybris',
  'core-customize',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'bower_components',
]);

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function frameworkOf(dir: string): Promise<FrontendProject['framework']> {
  if (await isFile(join(dir, 'angular.json'))) return 'Angular';
  try {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if ('@angular/core' in deps) return 'Angular';
    if ('react' in deps) return 'React';
    if ('vue' in deps) return 'Vue';
  } catch {
    // unreadable package.json: still a Node.js project
  }
  return 'Node.js';
}

/**
 * Finds the JavaScript projects (a folder with a `package.json`) at or below the opened folders, at most `maxDepth`
 * levels down. A project is not searched further, so its own sub-packages do not show up as projects.
 */
export async function findFrontendProjects(
  folders: readonly string[],
  maxDepth = 3,
): Promise<FrontendProject[]> {
  const found = new Map<string, FrontendProject>();
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (await isFile(join(dir, 'package.json'))) {
      found.set(dir, { dir, name: basename(dir), framework: await frameworkOf(dir) });
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
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      await visit(join(dir, entry.name), depth + 1);
    }
  };
  for (const folder of folders) await visit(folder, 0);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
