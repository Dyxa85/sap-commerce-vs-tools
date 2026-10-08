import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  dependencyEdges,
  dependents,
  findHybrisDirs,
  listExtensionFiles,
  loadPlatform,
  parseExtensionInfo,
  parseLocalExtensions,
  resolveLoadOrder,
  resolveVariables,
  defaultVariables,
  type ExtensionInfo,
} from '../../src/index.js';

const fixture = fileURLToPath(new URL('../../../test-fixtures/hybris', import.meta.url));

describe('variables and localextensions.xml', () => {
  const vars = defaultVariables('/h');

  it('resolves known variables and reports unknown ones', () => {
    const unknown: string[] = [];
    expect(resolveVariables('${HYBRIS_BIN_DIR}/custom/${NOPE}', vars, (n) => unknown.push(n))).toBe(
      '/h/bin/custom/${NOPE}',
    );
    expect(unknown).toEqual(['NOPE']);
  });

  it('parses paths, names and dirs with spans', () => {
    const text = `<hybrisconfig><extensions>
      <path dir='\${HYBRIS_BIN_DIR}' autoload='false'/>
      <path dir="\${HYBRIS_BIN_DIR}/modules"/>
      <extension name="a"/>
      <extension dir="\${HYBRIS_BIN_DIR}/custom/b"/>
      <extension/>
    </extensions></hybrisconfig>`;
    const local = parseLocalExtensions(text, '/h/config/localextensions.xml', vars);
    expect(local.scanPaths.map((p) => [p.dir, p.autoload])).toEqual([
      ['/h/bin', false],
      ['/h/bin/modules', true],
    ]);
    expect(local.entries.map((e) => (e.kind === 'name' ? e.name : e.dir))).toEqual([
      'a',
      '/h/bin/custom/b',
    ]);
    expect(local.problems.some((p) => p.message.includes('needs a "name" or "dir"'))).toBe(true);
  });
});

describe('extensioninfo.xml', () => {
  it('reads requirements, modules and meta', () => {
    const info = parseExtensionInfo(
      `<extensioninfo><extension name="x" version="2.0">
        <requires-extension name="a"/><requires-extension name="b"/>
        <coremodule generated="true" manager="m.M" packageroot="m"/>
        <webmodule webroot="/x"/><meta key="k" value="v"/>
      </extension></extensioninfo>`,
      '/h/bin/custom/x/extensioninfo.xml',
      '/h/bin',
    );
    expect(info).toMatchObject({
      name: 'x',
      version: '2.0',
      requires: ['a', 'b'],
      category: 'custom',
      meta: { k: 'v' },
    });
    expect(info?.coreModule).toEqual({ packageRoot: 'm', manager: 'm.M', generated: true });
    expect(info?.webModule?.webRoot).toBe('/x');
  });

  it('returns undefined without an extension name', () => {
    expect(parseExtensionInfo('<extensioninfo/>', '/x/extensioninfo.xml', '/x')).toBeUndefined();
  });
});

describe('load order', () => {
  const ext = (name: string, requires: string[] = []): ExtensionInfo => ({
    name,
    dir: `/x/${name}`,
    category: 'custom',
    infoFile: `/x/${name}/extensioninfo.xml`,
    requires,
    meta: {},
  });
  const available = new Map(
    [ext('core'), ext('a', ['core']), ext('b', ['a', 'core']), ext('c', ['missing'])].map((e) => [
      e.name,
      e,
    ]),
  );

  it('puts dependencies before dependents', () => {
    const { loaded } = resolveLoadOrder(available, new Set(['b']), 'f');
    expect(loaded.map((e) => e.name)).toEqual(['core', 'a', 'b']);
  });

  it('reports missing requirements once', () => {
    const { problems } = resolveLoadOrder(available, new Set(['c']), 'f');
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('requires "missing"');
  });

  it('detects cycles without hanging', () => {
    const cyc = new Map([ext('p', ['q']), ext('q', ['p'])].map((e) => [e.name, e]));
    const { problems, loaded } = resolveLoadOrder(cyc, new Set(['p']), 'f');
    expect(problems.some((p) => p.message.includes('Circular dependency'))).toBe(true);
    expect(loaded.length).toBeLessThanOrEqual(2);
  });

  it('computes edges and transitive dependents', () => {
    const list = [...available.values()];
    expect(dependencyEdges(list)).toContainEqual({ from: 'b', to: 'a' });
    expect(dependents(list, 'core')).toEqual(['a', 'b']);
  });
});

describe('loadPlatform (fixture project)', () => {
  it('finds the hybris directory', async () => {
    expect(await findHybrisDirs(join(fixture, '..'))).toEqual([fixture]);
  });

  it('loads platform extensions, requested extensions and resolves dependencies in order', async () => {
    const project = await loadPlatform(fixture);
    expect(project.problems).toEqual([]);
    expect([...project.available.keys()].sort()).toEqual([
      'acmecore',
      'acmefacades',
      'acmeprocess',
      'catalog',
      'core',
    ]);
    const order = project.loaded.map((e) => e.name);
    expect(order.indexOf('core')).toBeLessThan(order.indexOf('acmecore'));
    expect(order.indexOf('acmecore')).toBeLessThan(order.indexOf('acmefacades'));
    expect(order.indexOf('acmefacades')).toBeLessThan(order.indexOf('acmeprocess'));
    expect(project.available.get('core')?.category).toBe('platform');
    expect(project.available.get('acmecore')?.category).toBe('custom');
  });
});

describe('loadPlatform (problems)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sapc-platform-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function build(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmp, 'p-'));
    for (const [rel, content] of Object.entries({
      'bin/platform/extensions.xml': '<hybrisconfig/>',
      ...files,
    })) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    return root;
  }
  const info = (name: string, requires: string[] = []) =>
    `<extensioninfo><extension name="${name}">${requires.map((r) => `<requires-extension name="${r}"/>`).join('')}</extension></extensioninfo>`;

  it('reports unknown and missing extensions with the spans of the offending elements', async () => {
    const root = build({
      'config/localextensions.xml': `<hybrisconfig><extensions><path dir="\${HYBRIS_BIN_DIR}"/><extension name="ghost"/></extensions></hybrisconfig>`,
      'bin/custom/a/extensioninfo.xml': info('a', ['absent']),
    });
    const project = await loadPlatform(root);
    const ghost = project.problems.find((p) => p.message.includes('"ghost"'));
    expect(ghost?.severity).toBe('error');
    expect(ghost?.span).toBeDefined();
    expect(project.problems.some((p) => p.message.includes('requires "absent"'))).toBe(true);
  });

  it('warns about duplicate extension names and a missing localextensions.xml', async () => {
    const root = build({
      'bin/custom/a/extensioninfo.xml': info('dup'),
      'bin/custom/b/extensioninfo.xml': info('dup'),
    });
    const project = await loadPlatform(root);
    expect(project.problems.some((p) => p.message.includes('localextensions.xml not found'))).toBe(
      true,
    );
    expect(project.problems.some((p) => p.message.includes('exists twice'))).toBe(true);
  });

  it('loads everything below autoload paths', async () => {
    const root = build({
      'config/localextensions.xml': `<hybrisconfig><extensions><path dir="\${HYBRIS_BIN_DIR}/custom"/></extensions></hybrisconfig>`,
      'bin/custom/a/extensioninfo.xml': info('a'),
      'bin/custom/group/b/extensioninfo.xml': info('b', ['a']),
    });
    const project = await loadPlatform(root);
    expect(project.loaded.map((e) => e.name)).toEqual(['a', 'b']);
  });
});

describe('symlinks and extension files', () => {
  const tmp2 = mkdtempSync(join(tmpdir(), 'sapc-links-'));
  afterAll(() => rmSync(tmp2, { recursive: true, force: true }));

  it('follows symlinked module directories (CCv2 builds link bin/modules) and survives cycles', async () => {
    const { symlinkSync } = await import('node:fs');
    const real = join(tmp2, 'repo', 'modules', 'group', 'm1');
    mkdirSync(real, { recursive: true });
    writeFileSync(
      join(real, 'extensioninfo.xml'),
      '<extensioninfo><extension name="m1"/></extensioninfo>',
    );
    const hybris = join(tmp2, 'hybris');
    mkdirSync(join(hybris, 'bin', 'platform'), { recursive: true });
    writeFileSync(join(hybris, 'bin', 'platform', 'extensions.xml'), '<hybrisconfig/>');
    mkdirSync(join(hybris, 'config'), { recursive: true });
    writeFileSync(
      join(hybris, 'config', 'localextensions.xml'),
      '<hybrisconfig><extensions><path dir="${HYBRIS_BIN_DIR}"/></extensions></hybrisconfig>',
    );
    symlinkSync(join(tmp2, 'repo', 'modules'), join(hybris, 'bin', 'modules'));
    symlinkSync(hybris, join(real, 'loop')); // a link back to the project must not hang the scan

    const project = await loadPlatform(hybris);
    expect([...project.available.keys()]).toEqual(['m1']);
    expect(project.available.get('m1')?.category).toBe('modules');
  });

  it('classifies the files of an extension', async () => {
    const project = await loadPlatform(fixture);
    const files = await listExtensionFiles(project.available.get('acmecore')!);
    expect(files.map((f) => [f.kind, f.relativePath])).toEqual(
      expect.arrayContaining([
        ['items', join('resources', 'acmecore-items.xml')],
        ['beans', join('resources', 'acmecore-beans.xml')],
        ['spring', join('resources', 'acmecore-spring.xml')],
        ['impex', join('resources', 'impex', 'badges.impex')],
        ['flexsearch', join('resources', 'impex', 'badges-by-tier.flexibleSearch')],
      ]),
    );
    const process = await listExtensionFiles(project.available.get('acmeprocess')!);
    expect(process.some((f) => f.kind === 'process')).toBe(true);
  });
});
