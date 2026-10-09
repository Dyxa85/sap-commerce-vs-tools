import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlatformProject } from '../platform/model.js';
import { classJarPath } from './settings.js';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Entry {
  name: string;
  path: string;
}

/** Lists all files below `root` and the newest modification time of files and folders. */
async function walk(root: string): Promise<{ entries: Entry[]; newest: number }> {
  const entries: Entry[] = [];
  let newest = 0;
  const visit = async (dir: string, prefix: string): Promise<void> => {
    newest = Math.max(newest, (await stat(dir)).mtimeMs);
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.isDirectory()) await visit(join(dir, item.name), `${prefix}${item.name}/`);
      else if (item.isFile()) {
        const path = join(dir, item.name);
        newest = Math.max(newest, (await stat(path)).mtimeMs);
        entries.push({ name: `${prefix}${item.name}`, path });
      }
    }
  };
  await visit(root, '');
  return { entries, newest };
}

/** A zip archive without compression: the Java server only needs to read the classes, not to save space. */
async function zipStored(entries: readonly Entry[]): Promise<Buffer> {
  if (entries.length > 0xfffe) throw new Error(`too many files (${entries.length})`);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = await readFile(entry.path);
    if (offset + data.length > 0xf0000000) throw new Error('archive too large');
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

export interface PackResult {
  /** Jars written (new or out of date). */
  packed: number;
  /** Jars that were already newer than every class. */
  upToDate: number;
  /** Extensions with an empty or missing `classes` folder. */
  empty: number;
  /** Extensions that could not be packed, with the reason. */
  failed: { extension: string; reason: string }[];
}

/**
 * Packs the `classes` folder of every loaded extension that `ant build` produced into one jar in `outDir`. A jar that is
 * newer than all of its classes is kept, so running this again after a build only touches what changed.
 */
export async function packClassFolders(
  project: PlatformProject,
  outDir: string,
  options: { exclude?: readonly string[]; onProgress?: (done: number, total: number) => void } = {},
): Promise<PackResult> {
  const skip = new Set(options.exclude ?? []);
  const extensions = project.loaded.filter((e) => !skip.has(e.name));
  const result: PackResult = { packed: 0, upToDate: 0, empty: 0, failed: [] };
  await mkdir(outDir, { recursive: true });
  let done = 0;
  for (const ext of extensions) {
    options.onProgress?.(done++, extensions.length);
    const jar = classJarPath(outDir, ext.name);
    try {
      const { entries, newest } = await walk(join(ext.dir, 'classes')).catch(() => ({
        entries: [] as Entry[],
        newest: 0,
      }));
      if (entries.length === 0) {
        result.empty++;
        // after `ant clean` the old jar would describe classes that no longer exist
        await rm(jar, { force: true });
        continue;
      }
      const existing = await stat(jar).catch(() => undefined);
      if (existing && existing.mtimeMs >= newest) {
        result.upToDate++;
        continue;
      }
      // write next to the target and rename, so the Java server never sees a half-written jar
      const temporary = `${jar}.${process.pid}.tmp`;
      await writeFile(temporary, await zipStored(entries));
      await rename(temporary, jar);
      result.packed++;
    } catch (err) {
      result.failed.push({
        extension: ext.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  options.onProgress?.(extensions.length, extensions.length);
  return result;
}
