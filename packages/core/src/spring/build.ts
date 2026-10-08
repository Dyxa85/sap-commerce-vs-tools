import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listExtensionFiles } from '../platform/files.js';
import type { PlatformProject } from '../platform/model.js';
import { readFromDisk, type ReadText } from '../typesystem/build.js';
import type { SpringFile } from './model.js';
import { parseSpringXml } from './parse.js';
import { SpringSystem } from './system.js';

/** Spring files of an extension: `*-spring.xml` below `resources/` plus the web context in `web/webroot/WEB-INF`. */
export async function springFilesOf(extension: { name: string; dir: string }): Promise<string[]> {
  const files = (
    await listExtensionFiles({
      ...extension,
      category: 'other',
      infoFile: '',
      requires: [],
      meta: {},
    })
  )
    .filter((f) => f.kind === 'spring')
    .map((f) => f.path);
  try {
    const webInf = join(extension.dir, 'web', 'webroot', 'WEB-INF');
    for (const entry of await readdir(webInf))
      if (entry.endsWith('-spring.xml')) files.push(join(webInf, entry));
  } catch {
    // no web module
  }
  return files;
}

export async function buildSpringSystem(
  project: PlatformProject,
  read: ReadText = readFromDisk,
): Promise<SpringSystem> {
  const perExtension: SpringFile[][] = [];
  await Promise.all(
    project.loaded.map(async (extension, index) => {
      const files: SpringFile[] = [];
      for (const path of await springFilesOf(extension)) {
        const text = await read(path);
        if (text !== undefined) files.push(parseSpringXml(text, path, extension.name));
      }
      perExtension[index] = files;
    }),
  );
  return new SpringSystem(perExtension.flat());
}
