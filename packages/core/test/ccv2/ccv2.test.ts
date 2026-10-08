import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ccv2 } from '../../src/index.js';

describe('parseJson', () => {
  it('keeps offsets of keys and values', () => {
    const text = '{\n  "a": [1, "x"],\n  "b": {"c": true}\n}';
    const { root } = ccv2.parseJson(text);
    expect(root?.type).toBe('object');
    if (root?.type !== 'object') return;
    expect(text.slice(root.entries[0]!.keyStart, root.entries[0]!.keyStart + 3)).toBe('"a"');
    const b = root.entries[1]!;
    expect(text.slice(b.keyStart, b.keyStart + 3)).toBe('"b"');
    expect(b.value.type).toBe('object');
  });

  it.each([
    ['{"a":1,}', 'property name'],
    ['{"a":1', '"," or "}"'],
    ['[1 2]', '"," or "]"'],
    ['{"a":"x}', 'Unterminated'],
    ['{"a":1} x', 'after the JSON'],
    ['{"a": // c\n 1}', 'Unexpected'],
    ['', 'Unexpected'],
  ])('reports %j', (input, message) => {
    const r = ccv2.parseJson(input);
    expect(r.root).toBeUndefined();
    expect(r.error?.message).toContain(message);
  });

  it('accepts a byte order mark and escapes, and refuses absurd nesting without crashing', () => {
    expect(ccv2.parseJson('﻿{"a":"\\u00e4\\n"}').root?.type).toBe('object');
    const deep = '['.repeat(500) + ']'.repeat(500);
    expect(ccv2.parseJson(deep).error?.message).toContain('deeply');
  });
});

describe('manifestOutline', () => {
  const text = JSON.stringify(
    {
      extensions: ['backoffice', 'solrserver'],
      commerceSuiteVersion: '2211-jdk21.17',
      solrVersion: '9.10',
      enableImageProcessingService: true,
      extensionPacks: [{ name: 'hybris-commerce-integrations', version: '2211-jdk21.11' }],
      useConfig: {
        properties: [{ location: '/hybris/config/local_dev.properties', persona: 'development' }],
      },
      properties: [
        { key: 'hac.webroot', value: '/hac' },
        { key: 'empty', value: '' },
      ],
      aspects: [
        {
          name: 'backoffice',
          properties: [{ key: 'a', value: 'b' }],
          webapps: [{ name: 'hac', contextPath: '/hac' }],
        },
      ],
      futureThing: { nested: [1, 2] },
    },
    null,
    2,
  );
  const { entries, error } = ccv2.manifestOutline(text);
  const by = (label: string) => entries.find((e) => e.label === label)!;

  it('puts the versions first and shows plain values as key and value', () => {
    expect(error).toBeUndefined();
    expect(entries.slice(0, 2).map((e) => e.label)).toEqual([
      'commerceSuiteVersion',
      'solrVersion',
    ]);
    expect(by('commerceSuiteVersion').description).toBe('2211-jdk21.17');
    expect(by('enableImageProcessingService').description).toBe('true');
  });

  it('names list entries and describes them', () => {
    expect(by('extensions').description).toBe('2');
    expect(by('extensions').children.map((c) => c.label)).toEqual(['backoffice', 'solrserver']);
    expect(by('extensionPacks').children[0]).toMatchObject({
      label: 'hybris-commerce-integrations',
      description: '2211-jdk21.11',
    });
    expect(by('properties').children.map((c) => [c.label, c.description])).toEqual([
      ['hac.webroot', '/hac'],
      ['empty', '(empty)'],
    ]);
    const config = by('useConfig').children[0]!;
    expect(config.children[0]).toMatchObject({
      label: '/hybris/config/local_dev.properties',
      description: 'development',
    });
  });

  it('nests aspects with their properties and webapps', () => {
    const aspect = by('aspects').children[0]!;
    expect(aspect.label).toBe('backoffice');
    expect(aspect.children.map((c) => c.label)).toEqual(['properties', 'webapps']);
    expect(aspect.children[1]!.children[0]).toMatchObject({ label: 'hac', description: '/hac' });
  });

  it('keeps unknown sections and offsets that point at the entry', () => {
    expect(by('futureThing').children[0]!.label).toBe('nested');
    expect(text.slice(by('solrVersion').offset).startsWith('"solrVersion"')).toBe(true);
    const pack = by('extensionPacks').children[0]!;
    expect(text.slice(pack.offset).startsWith('{')).toBe(true);
    expect(by('aspects').section).toBe('aspects');
    expect(by('aspects').children[0]!.section).toBe('aspects');
  });

  it('reports broken and non-object manifests instead of throwing', () => {
    expect(ccv2.manifestOutline('{"a":').error).toBeDefined();
    expect(ccv2.manifestOutline('[]').error?.message).toContain('object');
  });
});

describe('findCcv2Roots', () => {
  const base = mkdtempSync(join(tmpdir(), 'sapc-ccv2-'));
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const core = (dir: string): void => {
    mkdirSync(join(dir, 'hybris'), { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), '{}');
  };

  it('recognises the repository, core-customize itself, and repositories one level down', async () => {
    core(join(base, 'repo', 'core-customize'));
    core(join(base, 'only-core'));
    core(join(base, 'many', 'one', 'core-customize'));
    core(join(base, 'many', 'two', 'core-customize'));
    mkdirSync(join(base, 'plain', 'hybris'), { recursive: true }); // no manifest: not CCv2

    expect(await ccv2.findCcv2Roots([join(base, 'repo')])).toEqual([
      { dir: join(base, 'repo'), coreCustomize: join(base, 'repo', 'core-customize') },
    ]);
    expect(await ccv2.findCcv2Roots([join(base, 'only-core')])).toEqual([
      { dir: join(base, 'only-core'), coreCustomize: join(base, 'only-core') },
    ]);
    const many = await ccv2.findCcv2Roots([join(base, 'many')]);
    expect(many.map((r) => r.dir).sort()).toEqual([
      join(base, 'many', 'one'),
      join(base, 'many', 'two'),
    ]);
    expect(await ccv2.findCcv2Roots([join(base, 'plain')])).toEqual([]);
    expect(await ccv2.findCcv2Roots([join(base, 'missing')])).toEqual([]);
  });
});
