import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeItems,
  buildTypeSystem,
  completeItems,
  definitionItems,
  foldingXml,
  hoverItems,
  loadPlatform,
  openItemsDocument,
  outlineItems,
  parseItemsXml,
  usagesOfType,
  xml,
  type TypeSystem,
} from '../../src/index.js';

const fixture = fileURLToPath(new URL('../../../test-fixtures/hybris', import.meta.url));
let ts: TypeSystem;
beforeAll(async () => {
  ts = await buildTypeSystem(await loadPlatform(fixture));
});

const cursor = (source: string) => ({ text: source.replace('|', ''), offset: source.indexOf('|') });
const codes = (text: string, category?: 'custom') =>
  analyzeItems(parseItemsXml(text, '/x/acmecore-items.xml', 'acmecore'), ts, { category }).map(
    (p) => p.code,
  );
const wrap = (inner: string) => `<items>${inner}</items>`;

describe('analyzeItems', () => {
  it('accepts the real fixture file', () => {
    const file = ts.files.find((f) => f.extension === 'acmecore')!;
    expect(analyzeItems(file, ts, { category: 'custom' })).toEqual([]);
  });

  it('reports unknown supertypes and attribute types with suggestions', () => {
    const file = parseItemsXml(
      wrap(
        '<itemtypes><itemtype code="X" extends="Prodcut"><attributes><attribute qualifier="a" type="Strng"/></attributes></itemtype></itemtypes>',
      ),
      '/f',
      'e',
    );
    const problems = analyzeItems(file, ts);
    expect(problems.find((p) => p.code === 'items.extends.unknown')?.data?.suggestion).toBe(
      'Product',
    );
    expect(problems.map((p) => p.code)).toContain('items.type.unknown');
  });

  it('knows Java classes, generics, localized: and primitives', () => {
    const c = codes(
      wrap(
        '<itemtypes><itemtype code="X" extends="GenericItem"><attributes><attribute qualifier="a" type="localized:java.lang.String"/><attribute qualifier="b" type="Collection&lt;Product&gt;"/><attribute qualifier="c" type="boolean"/><attribute qualifier="d" type="com.acme.Foo"/></attributes></itemtype></itemtypes>',
      ),
    );
    expect(c).toEqual([]);
  });

  it('flags duplicate attributes, duplicate declarations and redeclaring nothing', () => {
    const c = codes(
      wrap(
        '<itemtypes><itemtype code="X" extends="GenericItem"><attributes><attribute qualifier="a" type="java.lang.String"/><attribute qualifier="a" type="java.lang.String"/><attribute qualifier="ghost" type="java.lang.String" redeclare="true"/></attributes></itemtype><itemtype code="X" extends="GenericItem"/></itemtypes>',
      ),
    );
    expect(c).toEqual(
      expect.arrayContaining([
        'items.attribute.duplicate',
        'items.attribute.redeclare-nothing',
        'items.type.duplicate',
      ]),
    );
  });

  it('suggests redeclare when an attribute shadows a parent attribute', () => {
    const c = codes(
      wrap(
        '<itemtypes><itemtype code="Y" extends="Language"><attributes><attribute qualifier="isocode" type="java.lang.String"/></attributes></itemtype></itemtypes>',
      ),
    );
    expect(c).toContain('items.attribute.shadows');
    const ok = codes(
      wrap(
        '<itemtypes><itemtype code="Y" extends="Language"><attributes><attribute qualifier="isocode" type="java.lang.String" redeclare="true"/></attributes></itemtype></itemtypes>',
      ),
    );
    expect(ok).not.toContain('items.attribute.shadows');
  });

  it('checks typecodes: duplicates and the reserved range for custom extensions', () => {
    const dup = codes(
      wrap(
        '<itemtypes><itemtype code="Z" extends="GenericItem"><deployment table="z" typecode="32"/></itemtype></itemtypes>',
      ),
    );
    expect(dup).toContain('items.typecode.duplicate');
    expect(
      codes(
        wrap(
          '<itemtypes><itemtype code="Z" extends="GenericItem"><deployment table="z" typecode="5000"/></itemtype></itemtypes>',
        ),
        'custom',
      ),
    ).toContain('items.typecode.reserved');
    expect(
      codes(
        wrap(
          '<itemtypes><itemtype code="Z" extends="GenericItem"><deployment table="z" typecode="10500"/></itemtype></itemtypes>',
        ),
        'custom',
      ),
    ).toEqual([]);
  });

  it('checks enums, collections and relations', () => {
    const c = codes(
      wrap(
        '<enumtypes><enumtype code="E"><value code="A"/><value code="A"/></enumtype></enumtypes><collectiontypes><collectiontype code="C" elementtype="Nope"/></collectiontypes><relations><relation code="R"><sourceElement type="Nope" qualifier="x" cardinality="one"/><targetElement type="Product" qualifier="code" cardinality="many"/></relation></relations>',
      ),
    );
    expect(c).toEqual(expect.arrayContaining(['items.enum.duplicate-value', 'items.type.unknown']));
  });

  it('reports XML syntax problems', () => {
    expect(codes('<items><itemtypes><itemtype code="A"')).toContain('items.xml.syntax');
  });
});

describe('completion', () => {
  const at = (source: string) => {
    const { text, offset } = cursor(source);
    return completeItems(openItemsDocument(text, ts), offset);
  };

  it('completes types in extends/type attributes, only item types for extends', () => {
    const extendsLabels = at('<items><itemtypes><itemtype code="X" extends="Pro|"').map(
      (e) => e.label,
    );
    expect(extendsLabels).toContain('Product');
    expect(extendsLabels).not.toContain('java.lang.String');
    const typeLabels = at(
      '<items><itemtypes><itemtype code="X"><attributes><attribute qualifier="a" type="|"',
    ).map((e) => e.label);
    expect(typeLabels).toEqual(
      expect.arrayContaining([
        'java.lang.String',
        'localized:java.lang.String',
        'Product',
        'LanguageList',
      ]),
    );
  });

  it('completes enumerated and boolean values', () => {
    expect(
      at('<items><relations><relation code="R"><sourceElement cardinality="|"').map((e) => e.label),
    ).toEqual(['one', 'many']);
    expect(at('<items><itemtypes><itemtype code="X" abstract="|"').map((e) => e.label)).toEqual([
      'true',
      'false',
    ]);
    expect(
      at(
        '<items><itemtypes><itemtype code="X"><attributes><attribute qualifier="a" type="b"><persistence type="|"',
      ).map((e) => e.label),
    ).toContain('dynamic');
  });

  it('completes attribute names without repeating used ones', () => {
    const labels = at('<items><itemtypes><itemtype code="X" |').map((e) => e.label);
    expect(labels).toEqual(expect.arrayContaining(['extends', 'abstract', 'jaloclass']));
    expect(labels).not.toContain('code');
  });

  it('completes child elements by parent', () => {
    expect(at('<items><itemtypes><itemtype code="X"><|').map((e) => e.label)).toEqual(
      expect.arrayContaining(['attributes', 'deployment', 'indexes']),
    );
    expect(
      at(
        '<items><itemtypes><itemtype code="X"><attributes><attribute qualifier="a" type="b"><mod|',
      ).map((e) => e.label),
    ).toEqual(expect.arrayContaining(['modifiers', 'model']));
    const snippets = at('<items><itemtypes><|').find((e) => e.label === 'itemtype');
    expect(snippets?.snippet).toBe(true);
    expect(snippets?.insertText).toContain('<deployment');
  });
});

describe('hover, definition and usages', () => {
  const text =
    '<items><itemtypes><itemtype code="Y" extends="Language"><attributes><attribute qualifier="isocode" type="Collection&lt;Product&gt;" redeclare="true"/></attributes></itemtype></itemtypes></items>';
  let doc: ReturnType<typeof openItemsDocument>;
  beforeAll(() => {
    doc = openItemsDocument(text, ts);
  });

  it('shows type information and attribute origin on hover', () => {
    expect(hoverItems(doc, text.indexOf('Language') + 2)?.markdown).toContain('Language');
    expect(hoverItems(doc, text.indexOf('Product') + 2)?.markdown).toContain('item');
    expect(hoverItems(doc, text.indexOf('isocode') + 2)?.markdown).toContain(
      'Declared in `C2LItem`',
    );
  });

  it('jumps to the definition of types (also inside generics) and of redeclared attributes', () => {
    const line = (loc: { file: string; start: { line: number } } | undefined) => {
      const file = ts.files.find((f) => f.file === loc?.file)!;
      return file.text.split('\n')[loc!.start.line]!.trim();
    };
    expect(line(definitionItems(doc, text.indexOf('Language') + 1))).toContain('code="Language"');
    expect(line(definitionItems(doc, text.indexOf('Product') + 1))).toContain('code="Product"');
    expect(line(definitionItems(doc, text.indexOf('qualifier="isocode"') + 14))).toContain(
      'qualifier="isocode"',
    );
  });

  it('finds usages of a type across all items files', () => {
    expect(usagesOfType(ts, 'Customer').length).toBeGreaterThanOrEqual(1); // relation end in acmecore
    expect(usagesOfType(ts, 'GenericItem').length).toBeGreaterThanOrEqual(5); // supertype of many types
    expect(usagesOfType(ts, 'Nope')).toEqual([]);
  });
});

describe('outline and folding', () => {
  it('lists item types with attributes, enums with values and relations', () => {
    const file = ts.files.find((f) => f.extension === 'acmecore')!;
    const symbols = outlineItems(xml.parseXml(file.text));
    expect(symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(
      expect.arrayContaining([
        'enum:LoyaltyTier',
        'relation:AcmeBadge2CustomerRelation',
        'itemtype:AcmeBadge',
      ]),
    );
    const badge = symbols.find((s) => s.name === 'AcmeBadge')!;
    expect(badge.children.map((c) => c.name)).toEqual(['code', 'name']);
    expect(symbols.find((s) => s.name === 'LoyaltyTier')!.children.map((c) => c.name)).toEqual([
      'BRONZE',
      'SILVER',
      'GOLD',
    ]);
  });

  it('folds multi-line elements and comments', () => {
    const doc = xml.parseXml(
      '<items>\n<!-- a\nb -->\n<itemtypes>\n<itemtype code="A">\n<attributes/>\n</itemtype>\n</itemtypes>\n</items>',
    );
    expect(foldingXml(doc).length).toBeGreaterThanOrEqual(3);
  });
});
