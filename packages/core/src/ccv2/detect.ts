import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** A directory the CCv2 view is built for. */
export interface Ccv2Root {
  /** The repository (contains `core-customize`) or, when only that folder is open, `core-customize` itself. */
  dir: string;
  /** The `core-customize` directory (holds `manifest.json` and `hybris`). */
  coreCustomize: string;
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** `core-customize` is the folder with a `manifest.json` next to the `hybris` directory. */
export async function isCoreCustomize(dir: string): Promise<boolean> {
  return (await isFile(join(dir, 'manifest.json'))) && (await isDir(join(dir, 'hybris')));
}

/**
 * Finds CCv2 projects for the opened folders: the folder is `core-customize`, contains it, or one of its direct
 * sub-folders does (a workspace that holds several repositories).
 */
export async function findCcv2Roots(folders: readonly string[]): Promise<Ccv2Root[]> {
  const roots = new Map<string, Ccv2Root>();
  for (const folder of folders) {
    if (await isCoreCustomize(folder)) {
      roots.set(folder, { dir: folder, coreCustomize: folder });
      continue;
    }
    const direct = join(folder, 'core-customize');
    if (await isCoreCustomize(direct)) {
      roots.set(folder, { dir: folder, coreCustomize: direct });
      continue;
    }
    let children;
    try {
      children = await readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith('.') || child.name === 'node_modules')
        continue;
      const candidate = join(folder, child.name, 'core-customize');
      if (await isCoreCustomize(candidate)) {
        const dir = join(folder, child.name);
        roots.set(dir, { dir, coreCustomize: candidate });
      }
    }
  }
  return [...roots.values()];
}
