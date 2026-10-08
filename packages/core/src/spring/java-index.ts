import { readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { PlatformProject } from '../platform/model.js';

/** Source roots of an extension that can contain bean classes. */
const SOURCE_ROOTS = [
  ['src'],
  ['gensrc'],
  ['testsrc'],
  ['web', 'src'],
  ['web', 'testsrc'],
  ['hmc', 'src'],
  ['backoffice', 'src'],
  ['acceleratoraddon', 'web', 'src'],
];

/** Maps fully qualified class names to `.java` files of the loaded extensions. */
export class JavaIndex {
  constructor(private readonly byClass: ReadonlyMap<string, string>) {}

  get size(): number {
    return this.byClass.size;
  }

  fileOf(className: string): string | undefined {
    return this.byClass.get(className.replace(/<.*$/s, '').trim());
  }

  /** Class names that start with `prefix` (case-sensitive on the package, insensitive on the simple name). */
  complete(prefix: string, limit = 200): string[] {
    const lower = prefix.toLowerCase();
    const out: string[] = [];
    for (const name of this.byClass.keys()) {
      if (name.toLowerCase().includes(lower)) {
        out.push(name);
        if (out.length >= limit) break;
      }
    }
    return out;
  }
}

export async function buildJavaIndex(project: PlatformProject): Promise<JavaIndex> {
  const map = new Map<string, string>();
  const scan = async (root: string, dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) await scan(root, path);
      } else if (entry.name.endsWith('.java') && entry.name !== 'package-info.java') {
        const relative = path.slice(root.length + 1, -'.java'.length);
        const className = relative.split(sep).join('.');
        if (!map.has(className)) map.set(className, path);
      }
    }
  };
  await Promise.all(
    project.loaded.flatMap((e) =>
      SOURCE_ROOTS.map((parts) => scan(join(e.dir, ...parts), join(e.dir, ...parts))),
    ),
  );
  return new JavaIndex(map);
}
