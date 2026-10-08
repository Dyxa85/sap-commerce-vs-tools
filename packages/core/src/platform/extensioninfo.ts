import { basename, dirname, relative, sep } from 'node:path';
import { attr, childNamed, childrenNamed, parseXml } from '../xml/parser.js';
import type { ExtensionCategory, ExtensionInfo } from './model.js';

/** Parses one `extensioninfo.xml`; returns undefined when it has no `<extension name>`. */
export function parseExtensionInfo(
  text: string,
  infoFile: string,
  binDir: string,
): ExtensionInfo | undefined {
  const doc = parseXml(text);
  const root = childNamed(doc.root, 'extension');
  const name = root ? attr(root, 'name') : undefined;
  if (!root || !name) return undefined;
  const dir = dirname(infoFile);

  const core = childNamed(root, 'coremodule');
  const web = childNamed(root, 'webmodule');
  const meta: Record<string, string> = {};
  for (const m of childrenNamed(root, 'meta')) {
    const key = attr(m, 'key');
    if (key) meta[key] = attr(m, 'value') ?? '';
  }

  return {
    name,
    dir,
    category: categoryOf(dir, binDir),
    infoFile,
    version: attr(root, 'version'),
    requires: childrenNamed(root, 'requires-extension')
      .map((r) => attr(r, 'name') ?? '')
      .filter(Boolean),
    coreModule: core
      ? {
          packageRoot: attr(core, 'packageroot'),
          manager: attr(core, 'manager'),
          generated: attr(core, 'generated') === 'true',
        }
      : undefined,
    webModule: web ? { webRoot: attr(web, 'webroot') } : undefined,
    meta,
  };
}

export function categoryOf(dir: string, binDir: string): ExtensionCategory {
  const rel = relative(binDir, dir);
  if (rel.startsWith('..')) return 'other';
  const parts = rel.split(sep);
  if (parts[0] === 'platform') return 'platform';
  if (parts[0] === 'modules') return 'modules';
  if (parts[0] === 'custom') return 'custom';
  return 'other';
}

export function extensionLabel(info: ExtensionInfo): string {
  return `${info.name} (${basename(dirname(info.dir))}/${basename(info.dir)})`;
}
