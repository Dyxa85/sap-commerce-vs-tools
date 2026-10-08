import { join } from 'node:path';
import type { PlatformProject } from '../platform/model.js';
import { readFromDisk, type ReadText } from '../typesystem/build.js';
import type { BeansFile } from './model.js';
import { parseBeansXml } from './parse.js';
import { BeanSystem } from './system.js';

/** The beans file the platform loads for an extension: `resources/<name>-beans.xml`. */
export function beansFileOf(extensionName: string, extensionDir: string): string {
  return join(extensionDir, 'resources', `${extensionName}-beans.xml`);
}

export async function buildBeanSystem(
  project: PlatformProject,
  read: ReadText = readFromDisk,
): Promise<BeanSystem> {
  const files: BeansFile[] = [];
  await Promise.all(
    project.loaded.map(async (extension, index) => {
      const path = beansFileOf(extension.name, extension.dir);
      const text = await read(path);
      if (text !== undefined) files[index] = parseBeansXml(text, path, extension.name);
    }),
  );
  return new BeanSystem(files.filter(Boolean));
}
