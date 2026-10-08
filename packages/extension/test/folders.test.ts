import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listFolder, parseHidden, roleOf } from '../src/project/folders.js';

const root = mkdtempSync(join(tmpdir(), 'sapc-folders-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const file = (rel: string): void => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), '');
};
const dir = (rel: string): void => {
  mkdirSync(join(root, rel), { recursive: true });
};

describe('listFolder', () => {
  const hidden = parseHidden(['.git', 'classes', '/bin']);

  it('lists folders before files, sorted without regard to case, and hides noise', async () => {
    dir('src/com/acme');
    dir('gensrc');
    dir('lib');
    dir('resources/impex');
    dir('classes'); // build output
    dir('bin'); // built jars
    dir('.git');
    file('build.xml');
    file('buildcallbacks.xml');
    file('Extensioninfo.xml');
    file('project.properties');
    const labels = (await listFolder(root, root, hidden)).map(
      (e) => `${e.isDir ? 'd' : 'f'}:${e.label}`,
    );
    expect(labels).toEqual([
      'd:gensrc',
      'd:lib',
      'd:resources',
      'd:src',
      'f:build.xml',
      'f:buildcallbacks.xml',
      'f:Extensioninfo.xml',
      'f:project.properties',
    ]);
  });

  it('hides /bin only at the top, other folders called bin stay', async () => {
    dir('web/bin/inner');
    file('web/bin/inner/a.txt');
    const web = (await listFolder(join(root, 'web'), root, hidden)).map((e) => e.label);
    expect(web).toEqual(['bin/inner']);
  });

  it('merges packages with a single sub-folder but keeps source roots', async () => {
    file('src/com/acme/core/service/impl/Impl.java');
    const top = await listFolder(root, root, hidden);
    const src = top.find((e) => e.label === 'src')!;
    expect(src.path).toBe(join(root, 'src')); // a source root is never merged with its child
    const packages = await listFolder(src.path, root, hidden);
    expect(packages.map((e) => e.label)).toEqual(['com/acme/core/service/impl']);
    expect(packages[0]!.path).toBe(join(root, 'src/com/acme/core/service/impl'));
  });

  it('stops merging where a folder branches or holds files', async () => {
    file('src/org/one/A.java');
    file('src/org/two/B.java');
    file('src/org/Top.java');
    const org = (await listFolder(join(root, 'src'), root, hidden)).find((e) => e.label === 'org');
    expect(org?.label).toBe('org');
    expect((await listFolder(org!.path, root, hidden)).map((e) => e.label)).toEqual([
      'one',
      'two',
      'Top.java',
    ]);
  });

  it('follows links to folders and survives dangling ones', async () => {
    dir('real/inner');
    file('real/inner/x.txt');
    try {
      symlinkSync(join(root, 'real'), join(root, 'linked'), 'dir');
      symlinkSync(join(root, 'nowhere'), join(root, 'dangling'));
    } catch {
      return; // creating links needs a privilege on some Windows setups; nothing to test there
    }
    const top = await listFolder(root, root, hidden);
    expect(top.find((e) => e.label.startsWith('linked'))?.isDir).toBe(true);
    expect(top.find((e) => e.label === 'dangling')?.isDir).toBe(false);
  });

  it('returns nothing for a folder that does not exist', async () => {
    expect(await listFolder(join(root, 'missing'), root, hidden)).toEqual([]);
  });
});

describe('roleOf and parseHidden', () => {
  it('describes well-known folders by their path in the extension', () => {
    expect(roleOf('/x/ext', '/x/ext/src')).toBe('sources');
    expect(roleOf('/x/ext', '/x/ext/testsrc')).toBe('test sources');
    expect(roleOf('/x/ext', '/x/ext/web/webroot')).toBe('web root');
    expect(roleOf('/x/ext', '/x/ext/src/com')).toBeUndefined();
  });

  it('separates names from root-relative paths and ignores blanks', () => {
    const rules = parseHidden(['.git', '/bin', '  ', '/web/classes/']);
    expect([...rules.anywhere]).toEqual(['.git']);
    expect([...rules.fromRoot].sort()).toEqual(['bin', 'web/classes']);
  });
});
