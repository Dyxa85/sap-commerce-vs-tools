import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { describe, expect, it } from 'vitest';
import {
  BeansXmlService,
  DEFAULT_SETTINGS,
  FlexSearchLanguageService,
  ImpexLanguageService,
  ItemsXmlService,
  SpringXmlService,
} from '../src/index.js';
import { ProjectIndex } from '../src/project-index.js';

const hybris = fileURLToPath(new URL('../../test-fixtures/hybris', import.meta.url));
const coreItems = join(hybris, 'bin', 'platform', 'ext', 'core', 'resources', 'core-items.xml');

function makeIndex(overlay: Record<string, string> = {}) {
  let changes = 0;
  const index = new ProjectIndex({
    roots: async () => [hybris],
    overlay: (p) => overlay[p],
    changed: () => void changes++,
    log: () => undefined,
  });
  return { index, changes: () => changes, overlay };
}

describe('ProjectIndex', () => {
  it('indexes the fixture project and serves a schema per document', async () => {
    const { index, changes } = makeIndex();
    await index.reload();
    expect(index.projects).toHaveLength(1);
    expect(changes()).toBe(1);
    const schema = index.schemaFor(
      pathToFileURL(join(hybris, 'bin', 'custom', 'acmecore', 'resources', 'impex', 'badges.impex'))
        .href,
    );
    expect(schema?.hasType('AcmeBadge')).toBe(true);
    // untitled documents fall back to the first project
    expect(index.schemaFor('untitled:Untitled-1')?.hasType('Product')).toBe(true);
  });

  it('uses unsaved editor content instead of the disk version', async () => {
    const original = (await import('node:fs')).readFileSync(coreItems, 'utf8');
    const edited = original.replace('<itemtype code="User"', '<itemtype code="UserRenamed"');
    const { index } = makeIndex({ [coreItems]: edited });
    await index.reload();
    const schema = index.projects[0]!.typeSystem;
    expect(schema.hasType('UserRenamed')).toBe(true);
    expect(schema.hasType('User')).toBe(false);
  });

  it('coalesces concurrent reloads and survives a missing root', async () => {
    const { index } = makeIndex();
    await Promise.all([index.reload(), index.reload(), index.reload()]);
    expect(index.projects).toHaveLength(1);
    const broken = new ProjectIndex({
      roots: async () => ['/does/not/exist'],
      overlay: () => undefined,
      changed: () => undefined,
      log: () => undefined,
    });
    await broken.reload();
    expect(broken.projects[0]?.typeSystem.items.size ?? 0).toBe(0);
  });
});

describe('services with a real type system', () => {
  const setup = async () => {
    const { index } = makeIndex();
    await index.reload();
    return {
      impex: new ImpexLanguageService(index.schemaFor),
      flex: new FlexSearchLanguageService(index.schemaFor),
      index,
    };
  };
  let v = 5000;
  const doc = (languageId: string, text: string) =>
    TextDocument.create('file:///w.txt', languageId, ++v, text);

  it('reports unknown types and attributes in ImpEx', async () => {
    const { impex } = await setup();
    const d = impex.diagnostics(
      doc('impex', 'INSERT_UPDATE Prodcut;cod[unique=true]\n;1'),
      DEFAULT_SETTINGS,
    );
    expect(d.map((x) => x.code)).toContain('impex.type.unknown');
    const ok = impex.diagnostics(
      doc('impex', 'INSERT_UPDATE Product;code[unique=true]\n;1'),
      DEFAULT_SETTINGS,
    );
    expect(ok).toEqual([]);
  });

  it('jumps from an ImpEx type and column to their definition in the items.xml', async () => {
    const { impex } = await setup();
    const d = doc('impex', 'INSERT_UPDATE Language;isocode[unique=true]\n;en');
    const type = impex.definition(d, 0, 16);
    expect(type?.uri).toBe(pathToFileURL(coreItems).href);
    const itemsText = (await import('node:fs')).readFileSync(coreItems, 'utf8').split('\n');
    expect(itemsText[type!.range.start.line]).toContain('code="Language"');
    const column = impex.definition(d, 0, 26);
    expect(itemsText[column!.range.start.line]).toContain('isocode');
  });

  it('jumps from FlexibleSearch types and attributes, and completes real attributes', async () => {
    const { flex } = await setup();
    const d = doc('flexibleSearch', 'SELECT {l:isocode} FROM {Language AS l}');
    const itemsText = (await import('node:fs')).readFileSync(coreItems, 'utf8').split('\n');
    expect(itemsText[flex.definition(d, 0, 28)!.range.start.line]).toContain('code="Language"');
    expect(itemsText[flex.definition(d, 0, 12)!.range.start.line]).toContain('isocode');
    const items = flex.completion(doc('flexibleSearch', 'SELECT {l: FROM {Language AS l}'), 0, 11);
    expect(items.map((i) => i.label)).toEqual(
      expect.arrayContaining(['isocode', 'active', 'name']),
    );
    expect(
      flex
        .diagnostics(
          doc('flexibleSearch', 'SELECT {l:nosuch} FROM {Language AS l}'),
          DEFAULT_SETTINGS,
        )
        .map((x) => x.code),
    ).toContain('flexsearch.attribute.unknown');
  });
});

describe('ItemsXmlService (fixture project)', () => {
  const acmeItems = join(hybris, 'bin', 'custom', 'acmecore', 'resources', 'acmecore-items.xml');
  const setup = async () => {
    const { index } = makeIndex();
    await index.reload();
    return {
      service: new ItemsXmlService(index.typeSystemFor, (uri) => index.categoryFor(uri)),
      index,
    };
  };
  let v = 9000;
  const doc = (text: string, path = acmeItems) =>
    TextDocument.create(pathToFileURL(path).href, 'xml', ++v, text);

  it('finds no problems in the real fixture file', async () => {
    const { service } = await setup();
    const text = (await import('node:fs')).readFileSync(acmeItems, 'utf8');
    expect(service.diagnostics(doc(text), DEFAULT_SETTINGS)).toEqual([]);
  });

  it('reports problems with quick fixes', async () => {
    const { service } = await setup();
    const text =
      '<items><itemtypes><itemtype code="X" extends="Prodcut"><deployment table="x" typecode="5000"/></itemtype></itemtypes></items>';
    const d = doc(text);
    const diagnostics = service.diagnostics(d, DEFAULT_SETTINGS);
    expect(diagnostics.map((x) => x.code)).toEqual(
      expect.arrayContaining(['items.extends.unknown', 'items.typecode.reserved']),
    );
    const actions = service.codeActions(d, diagnostics[0]!.range, diagnostics, DEFAULT_SETTINGS);
    const fix = actions.find((a) => a.title === 'Change to "Product"');
    expect(TextDocument.applyEdits(d, fix!.edit!.changes![d.uri]!)).toContain('extends="Product"');
  });

  it('adds redeclare when an attribute shadows a parent attribute', async () => {
    const { service } = await setup();
    const text =
      '<items><itemtypes><itemtype code="Y" extends="Language"><attributes><attribute qualifier="isocode" type="java.lang.String"/></attributes></itemtype></itemtypes></items>';
    const d = doc(text);
    const diagnostics = service.diagnostics(d, DEFAULT_SETTINGS);
    const fix = service
      .codeActions(d, diagnostics[0]!.range, diagnostics, DEFAULT_SETTINGS)
      .find((a) => a.title.startsWith('Add redeclare'));
    expect(TextDocument.applyEdits(d, fix!.edit!.changes![d.uri]!)).toContain(
      'type="java.lang.String" redeclare="true"/>',
    );
  });

  it('completes, hovers, navigates, lists symbols and folds', async () => {
    const { service } = await setup();
    const text =
      '<items>\n<itemtypes>\n<itemtype code="Y" extends="Lang">\n<attributes>\n<attribute qualifier="a" type="java.lang.String"/>\n</attributes>\n</itemtype>\n</itemtypes>\n</items>';
    const d = doc(text);
    expect(service.completion(d, 2, 31).map((i) => i.label)).toContain('Language');
    expect(service.symbols(d)[0]).toMatchObject({ name: 'Y', children: [{ name: 'a' }] });
    expect(service.folding(d).length).toBeGreaterThan(0);
    const hover = service.hover(
      doc('<items><itemtypes><itemtype code="Y" extends="Language"/></itemtypes></items>'),
      0,
      52,
    );
    expect(hover?.contents).toMatchObject({ value: expect.stringContaining('Language') });
    const def = service.definition(
      doc('<items><itemtypes><itemtype code="Y" extends="Language"/></itemtypes></items>'),
      0,
      52,
    );
    expect(def?.uri).toMatch(/core-items\.xml$/);
    const refs = service.references(
      doc('<items><itemtypes><itemtype code="Y" extends="C2LItem"/></itemtypes></items>'),
      0,
      52,
    );
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  it('works without a project (only syntax problems)', () => {
    const service = new ItemsXmlService(() => undefined);
    expect(service.diagnostics(doc('<items><itemtype'), DEFAULT_SETTINGS)[0]?.code).toBe(
      'items.xml.syntax',
    );
    expect(service.completion(doc('<items>'), 0, 7)).toEqual([]);
  });
});

describe('BeansXmlService (fixture project)', () => {
  const beansFile = join(hybris, 'bin', 'custom', 'acmecore', 'resources', 'acmecore-beans.xml');
  let v = 12000;
  const doc = (text: string) =>
    TextDocument.create(pathToFileURL(beansFile).href, 'xml', ++v, text);
  const setup = async () => {
    const { index } = makeIndex();
    await index.reload();
    return new BeansXmlService(index.beanSystemFor, (uri) => index.categoryFor(uri));
  };

  it('is clean for the fixture and reports problems for broken beans', async () => {
    const service = await setup();
    const text = (await import('node:fs')).readFileSync(beansFile, 'utf8');
    expect(service.diagnostics(doc(text), DEFAULT_SETTINGS)).toEqual([]);
    const bad = service.diagnostics(
      doc(
        '<beans><bean class="x.A"><property name="p" type="String"/><property name="p" type="String"/></bean></beans>',
      ),
      DEFAULT_SETTINGS,
    );
    expect(bad.map((d) => d.code)).toContain('beans.property.duplicate');
  });

  it('completes, hovers, navigates and lists symbols', async () => {
    const service = await setup();
    const text =
      '<beans><bean class="x.A" extends="com.acme.core.dto.BadgeData"><property name="p" type="Bad"/></bean></beans>';
    const d = doc(text);
    expect(service.completion(d, 0, text.indexOf('type="Bad"') + 9).map((i) => i.label)).toContain(
      'com.acme.core.dto.BadgeData',
    );
    expect(service.hover(d, 0, text.indexOf('BadgeData') + 2)?.contents).toMatchObject({
      value: expect.stringContaining('bean'),
    });
    expect(service.definition(d, 0, text.indexOf('BadgeData') + 2)?.uri).toMatch(
      /acmecore-beans\.xml$/,
    );
    expect(service.symbols(d)[0]).toMatchObject({ name: 'A', children: [{ name: 'p' }] });
    expect(
      service.folding(doc('<beans>\n<bean class="x.A">\n</bean>\n</beans>')).length,
    ).toBeGreaterThan(0);
  });
});

describe('SpringXmlService (fixture project)', () => {
  const facadesSpring = join(
    hybris,
    'bin',
    'custom',
    'acmefacades',
    'resources',
    'acmefacades-spring.xml',
  );
  let v = 15000;
  const doc = (text: string, path = facadesSpring) =>
    TextDocument.create(pathToFileURL(path).href, 'xml', ++v, text);
  const setup = async () => {
    const { index } = makeIndex();
    await index.reload();
    return new SpringXmlService(index.springFor, (uri) => index.categoryFor(uri));
  };

  it('reports unknown references as info and notes the override', async () => {
    const service = await setup();
    const text = (await import('node:fs')).readFileSync(facadesSpring, 'utf8');
    const d = service.diagnostics(doc(text), DEFAULT_SETTINGS);
    expect(d.find((x) => x.code === 'spring.ref.unknown')?.severity).toBe(3); // information
    expect(d.some((x) => x.code === 'spring.bean.overrides')).toBe(true);
  });

  it('jumps to every definition of an overridden bean and to the Java class', async () => {
    const service = await setup();
    const text =
      '<beans><bean id="x" class="com.acme.core.service.impl.DefaultAcmeBadgeService"><property name="s" ref="acmeBadgeService"/></bean></beans>';
    const d = doc(text);
    const refs = service.definition(d, 0, text.indexOf('acmeBadgeService') + 3);
    expect(Array.isArray(refs) && refs.length).toBe(2);
    const cls = service.definition(d, 0, text.indexOf('DefaultAcmeBadgeService') + 3);
    expect(JSON.stringify(cls)).toContain('DefaultAcmeBadgeService.java');
  });

  it('completes ids, hovers, finds references and lists symbols', async () => {
    const service = await setup();
    const text =
      '<beans><property name="s" ref="acme"/><bean id="modelService" class="x.Y"/></beans>';
    const d = doc(text);
    expect(service.completion(d, 0, text.indexOf('ref="acme"') + 9).map((i) => i.label)).toContain(
      'acmeBadgeService',
    );
    expect(service.hover(d, 0, text.indexOf('modelService') + 2)?.contents).toMatchObject({
      value: expect.stringContaining('modelService'),
    });
    expect(
      service.references(d, 0, text.indexOf('modelService') + 2).length,
    ).toBeGreaterThanOrEqual(2);
    expect(service.symbols(d)[0]?.name).toBe('modelService');
  });

  it('works without a project', () => {
    const service = new SpringXmlService(() => undefined);
    expect(service.diagnostics(doc('<beans><bean'), DEFAULT_SETTINGS)[0]?.code).toBe(
      'spring.xml.syntax',
    );
    expect(service.definition(doc('<beans/>'), 0, 0)).toBeNull();
  });
});
