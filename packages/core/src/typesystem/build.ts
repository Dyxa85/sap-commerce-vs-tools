import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlatformProject } from '../platform/model.js';
import { parseItemsXml } from './parse-items.js';
import type { ItemsFile } from './model.js';
import { TypeSystem } from './system.js';

export type ReadText = (path: string) => Promise<string | undefined>;

/** Reads from disk; returns undefined for missing files. */
export const readFromDisk: ReadText = async (path) => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** The items file the platform loads for an extension: `resources/<name>-items.xml`. */
export function itemsFileOf(extensionName: string, extensionDir: string): string {
  return join(extensionDir, 'resources', `${extensionName}-items.xml`);
}

/**
 * Parses the items files of all loaded extensions in load order and merges them.
 * `read` lets the caller overlay unsaved editor content.
 */
export async function buildTypeSystem(
  project: PlatformProject,
  read: ReadText = readFromDisk,
): Promise<TypeSystem> {
  const files: ItemsFile[] = [];
  await Promise.all(
    project.loaded.map(async (extension, index) => {
      const path = itemsFileOf(extension.name, extension.dir);
      const text = await read(path);
      if (text !== undefined) files[index] = parseItemsXml(text, path, extension.name);
    }),
  );
  return new TypeSystem(files.filter(Boolean));
}
