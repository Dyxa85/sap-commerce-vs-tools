import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTypeSystem, loadPlatform, parseItemsXml, TypeSystem } from '../../src/index.js';

const fixture = fileURLToPath(new URL('../../../test-fixtures/hybris', import.meta.url));
let ts: TypeSystem;

beforeAll(async () => {
  ts = await buildTypeSystem(await loadPlatform(fixture));
});

describe('parseItemsXml', () => {
  const text = `<items>
    <itemtypes><typegroup name="g">
      <itemtype code="A" extends="B" abstract="true" jaloclass="x.A">
        <deployment table="a_tab" typecode="10001"/>
        <description>About A</description>
        <attributes>
          <attribute qualifier="name" type="localized:java.lang.String" redeclare="true">
            <modifiers optional="false" unique="true" read="true" write="false"/>
            <persistence type="dynamic" attributeHandler="h"/>
            <defaultvalue>"x"</defaultvalue>
          </attribute>
        </attributes>
        <indexes><index name="i" unique="true"><key attribute="name"/></index></indexes>
      </itemtype></typegroup>
    </itemtypes>
    <enumtypes><enumtype code="E" dynamic="true"><value code="ONE"/><value code="TWO"/></enumtype></enumtypes>
    <collectiontypes><collectiontype code="AList" elementtype="A" type="list"/></collectiontypes>
    <relations><relation code="R" localized="false">
      <sourceElement type="A" qualifier="bs" cardinality="many" collectiontype="set"/>
      <targetElement type="B" qualifier="as" cardinality="one"/>
    </relation></relations>
  </items>`;
  const file = parseItemsXml(text, '/f-items.xml', 'ext');

  it('reads item types inside typegroups with all details', () => {
    const a = file.itemTypes[0]!;
    expect(a).toMatchObject({
      code: 'A',
      extends: 'B',
      abstract: true,
      jaloclass: 'x.A',
      description: 'About A',
    });
    expect(a.deployment).toMatchObject({ table: 'a_tab', typecode: 10001 });
    expect(a.indexes).toEqual([{ name: 'i', unique: true, keys: ['name'] }]);
    const attr = a.attributes[0]!;
    expect(attr).toMatchObject({
      qualifier: 'name',
      localized: true,
      baseType: 'java.lang.String',
      redeclare: true,
      optional: false,
      unique: true,
      write: false,
      persistence: 'dynamic',
      attributeHandler: 'h',
      defaultValue: '"x"',
    });
    expect(text.slice(a.source.nameSpan.start, a.source.nameSpan.end)).toBe('A');
    expect(text.slice(attr.source.nameSpan.start, attr.source.nameSpan.end)).toBe('name');
    expect(text.slice(attr.typeSpan.start, attr.typeSpan.end)).toBe('localized:java.lang.String');
  });

  it('reads enums, collections and relations', () => {
    expect(file.enumTypes[0]).toMatchObject({ code: 'E', dynamic: true });
    expect(file.enumTypes[0]?.values.map((v) => v.code)).toEqual(['ONE', 'TWO']);
    expect(file.collectionTypes[0]).toMatchObject({
      code: 'AList',
      elementType: 'A',
      kind: 'list',
    });
    expect(file.relations[0]?.sourceElement).toMatchObject({
      type: 'A',
      qualifier: 'bs',
      cardinality: 'many',
      collectionType: 'set',
    });
  });

  it('survives broken XML', () => {
    const broken = parseItemsXml(
      '<items><itemtypes><itemtype code="X"><attributes><attribute qualifier="q" type="T"',
      '/b',
      'e',
    );
    expect(broken.itemTypes[0]?.code).toBe('X');
    expect(broken.problems.length).toBeGreaterThan(0);
    expect(parseItemsXml('not xml at all', '/c', 'e').itemTypes).toEqual([]);
  });
});

describe('merged type system (fixture)', () => {
  it('merges base types and custom additions', () => {
    expect(ts.typeNames()).toEqual(
      expect.arrayContaining([
        'AcmeBadge',
        'ArticleApprovalStatus',
        'Catalog',
        'Customer',
        'Language',
        'LoyaltyTier',
        'Product',
      ]),
    );
    expect(ts.kindOf('Language')).toBe('item');
    expect(ts.kindOf('LoyaltyTier')).toBe('enum');
    expect(ts.kindOf('LanguageList')).toBe('collection');
    expect(ts.kindOf('LocalizedString')).toBe('map');
    expect(ts.kindOf('java.lang.String')).toBe('atomic');
    expect(ts.kindOf('nope')).toBeUndefined();
  });

  it('is case-insensitive when resolving names', () => {
    expect(ts.canonicalName('acmebadge')).toBe('AcmeBadge');
    expect(ts.item('LANGUAGE')?.code).toBe('Language');
  });

  it('walks the inheritance chain and subtypes', () => {
    expect(ts.supertypeChain('Language').map((t) => t.code)).toEqual([
      'Language',
      'C2LItem',
      'GenericItem',
      'Item',
    ]);
    expect(ts.isSubtypeOf('Customer', 'User')).toBe(true);
    expect(ts.isSubtypeOf('Customer', 'Product')).toBe(false);
    expect(ts.directSubtypes('C2LItem')).toEqual(['Language']);
    expect(ts.allSubtypes('User')).toEqual(['Customer']);
  });

  it('inherits attributes and flags the own ones', () => {
    const infos = ts.attributeInfos('Language');
    const byName = Object.fromEntries(infos.map((i) => [i.qualifier, i]));
    expect(Object.keys(byName)).toEqual(
      expect.arrayContaining([
        'pk',
        'creationtime',
        'isocode',
        'active',
        'name',
        'fallbackLanguages',
      ]),
    );
    expect(byName.name?.own).toBe(true);
    expect(byName.isocode?.own).toBe(false);
    expect(byName.isocode?.declaredIn).toBe('C2LItem');
    expect(byName.name?.def.localized).toBe(true);
  });

  it('adds attributes that other extensions declare on existing types', () => {
    expect(ts.attribute('Customer', 'loyaltyTier')?.def.type).toBe('LoyaltyTier');
    expect(ts.attribute('Customer', 'customerid')?.qualifier).toBe('customerID'); // case-insensitive
    expect(ts.item('Customer')?.definitions.map((d) => d.source.extension)).toEqual([
      'core',
      'acmecore',
    ]);
  });

  it('turns relation ends into attributes on the opposite type', () => {
    const onBadge = ts.attribute('AcmeBadge', 'acmeCustomers');
    const onCustomer = ts.attribute('Customer', 'badges');
    expect(onBadge?.def.type).toBe('Set<Customer>');
    expect(onCustomer?.def.type).toBe('Collection<AcmeBadge>');
    expect(onBadge?.def.relation).toBe('AcmeBadge2CustomerRelation');
  });

  it('resolves referenced types through collections, localisation and generics', () => {
    expect(ts.referencedType('localized:java.lang.String')).toBeUndefined();
    expect(ts.referencedType('LanguageList')).toBe('Language');
    expect(ts.referencedType('Set<Customer>')).toBe('Customer');
    expect(ts.referencedType('ArticleApprovalStatus')).toBe('ArticleApprovalStatus');
    expect(ts.referencedType('java.util.Date')).toBeUndefined();
  });

  it('exposes enum values for enum-typed attributes (TypeSchema)', () => {
    expect(ts.enumValues('Product', 'approvalStatus')).toEqual(['check', 'approved', 'unapproved']);
    expect(ts.enumValues('Customer', 'loyaltyTier')).toEqual(['BRONZE', 'SILVER', 'GOLD']);
    expect(ts.enumValues('Product', 'code')).toBeUndefined();
  });

  it('implements the schema used by the language features', () => {
    expect(ts.hasType('Product')).toBe(true);
    expect(ts.hasType('LoyaltyTier')).toBe(true);
    expect(ts.hasType('java.lang.String')).toBe(false);
    const attrs = ts.attributes('Product')!;
    expect(attrs.find((a) => a.name === 'code')).toMatchObject({
      unique: true,
      mandatory: true,
      own: true,
    });
    expect(ts.attributes('Unknown')).toBeUndefined();
    expect(ts.typeDoc('Language')).toContain('Table `languages`');
  });

  it('searches types, attributes, enum values and relations', () => {
    const hits = ts.search('badge');
    expect(hits.map((h) => `${h.kind}:${h.name}`)).toEqual(
      expect.arrayContaining([
        'type:AcmeBadge',
        'relation:AcmeBadge2CustomerRelation',
        'attribute:badges',
      ]),
    );
    expect(ts.search('loyaltytier gold').map((h) => h.kind)).toContain('enum-value');
    expect(ts.search('')).toEqual([]);
    expect(ts.search('e', 3)).toHaveLength(3);
  });

  it('survives inheritance cycles', () => {
    const cyc = new TypeSystem([
      parseItemsXml(
        '<items><itemtypes><itemtype code="X" extends="Y"/><itemtype code="Y" extends="X"/></itemtypes></items>',
        '/c',
        'e',
      ),
    ]);
    expect(cyc.supertypeChain('X').map((t) => t.code)).toEqual(['X', 'Y']);
    expect(cyc.attributeInfos('X')).toEqual([]);
  });
});

describe('real-world data quirks', () => {
  it('trims names and applies the implicit GenericItem supertype to the declaring definition', () => {
    const system = new TypeSystem([
      parseItemsXml(
        '<items><itemtypes><itemtype code="Added" autocreate="false"><attributes><attribute qualifier="extra" type="java.lang.String"/></attributes></itemtype></itemtypes></items>',
        '/a',
        'early',
      ),
      parseItemsXml(
        '<items><itemtypes><itemtype code="Added"/><itemtype code=" Sub " extends="Added "/><itemtype code="GenericItem"/><itemtype code="Item"/></itemtypes></items>',
        '/b',
        'late',
      ),
    ]);
    expect(system.item('Added')?.extends).toBe('GenericItem');
    expect(system.item('Added')?.declaration?.source.extension).toBe('late');
    expect(system.item('Sub')?.extends).toBe('Added');
    expect(system.item('Item')?.extends).toBeUndefined();
    expect(system.attribute('Sub', 'extra')?.declaredIn).toBe('Added');
  });

  it('knows Java primitives as attribute types', () => {
    expect(ts.kindOf('boolean')).toBe('atomic');
    expect(ts.kindOf('int')).toBe('atomic');
  });

  it('treats relations as importable types with source/target attributes', () => {
    const relation = ts.item('AcmeBadge2CustomerRelation');
    expect(relation?.relation?.code).toBe('AcmeBadge2CustomerRelation');
    expect(ts.attribute('AcmeBadge2CustomerRelation', 'source')?.def.type).toBe('AcmeBadge');
    expect(ts.attribute('AcmeBadge2CustomerRelation', 'target')?.def.type).toBe('Customer');
    expect(ts.hasType('AcmeBadge2CustomerRelation')).toBe(true);
    expect(
      ts
        .search('AcmeBadge2')
        .some((h) => h.kind === 'type' && h.name === 'AcmeBadge2CustomerRelation'),
    ).toBe(true);
  });
});

describe('relation types (checked against the 480 relations of a running 2211 system)', () => {
  const relations = new TypeSystem([
    parseItemsXml(
      `<items>
        <itemtypes>
          <itemtype code="Owner" autocreate="true" generate="false"/>
          <itemtype code="Entry" autocreate="true" generate="false"/>
          <itemtype code="Tag" autocreate="true" generate="false"/>
        </itemtypes>
        <relations>
          <relation code="Owner2Entry" localized="false">
            <sourceElement type="Owner" cardinality="one" qualifier="owner"/>
            <targetElement type="Entry" cardinality="many" qualifier="entries" ordered="true"/>
          </relation>
          <relation code="Owner2Tag" localized="false">
            <sourceElement type="Owner" cardinality="one" qualifier="owner"/>
            <targetElement type="Tag" cardinality="many" qualifier="tags"/>
          </relation>
          <relation code="Entry2Tag" localized="false">
            <sourceElement type="Entry" cardinality="many" qualifier="entries" ordered="true"/>
            <targetElement type="Tag" cardinality="many" qualifier="tags"/>
          </relation>
          <relation code="Tag2Owner" localized="false">
            <sourceElement type="Tag" cardinality="many" qualifier="ownedTags"/>
            <targetElement type="Owner" cardinality="one" qualifier="tagOwner"/>
          </relation>
        </relations>
      </items>`,
      '/x/t-items.xml',
      't',
    ),
  ]);

  it('makes only many-to-many relations a Link with source and target', () => {
    expect(relations.item('Entry2Tag')?.extends).toBe('Link');
    expect([...relations.item('Entry2Tag')!.attributes.keys()]).toEqual(
      expect.arrayContaining(['source', 'target']),
    );
    for (const code of ['Owner2Entry', 'Owner2Tag', 'Tag2Owner']) {
      expect(relations.item(code)?.extends, code).toBe('Item');
      const keys = [...relations.item(code)!.attributes.keys()];
      expect(keys, code).not.toContain('source');
      expect(keys, code).not.toContain('target');
    }
  });

  it('gives the "many" type a position attribute for an ordered one-to-many relation', () => {
    const pos = relations.item('Entry')?.attributes.get('ownerpos')?.[0];
    expect(pos?.qualifier).toBe('ownerPOS');
    expect(pos?.type).toBe('java.lang.Integer');
    // not for unordered relations, and not for many-to-many
    expect(relations.item('Tag')?.attributes.has('ownerpos')).toBe(false);
    expect(relations.item('Tag')?.attributes.has('tagownerpos')).toBe(false);
  });

  it('still exposes the relation qualifiers on the opposite types', () => {
    expect(relations.item('Owner')?.attributes.has('entries')).toBe(true);
    expect(relations.item('Entry')?.attributes.has('owner')).toBe(true);
    expect(relations.item('Tag')?.attributes.has('tagowner')).toBe(true);
  });
});

describe('type codes are resolved without regard to case (as the platform does)', () => {
  it('attaches relation attributes to a type that is spelled differently in the relation', () => {
    const system = new TypeSystem([
      parseItemsXml(
        `<items>
          <itemtypes>
            <itemtype code="CMSLinkComponent" autocreate="true" generate="false"/>
            <itemtype code="Page" autocreate="true" generate="false"/>
          </itemtypes>
          <relations>
            <relation code="LinksForPage" localized="false">
              <sourceElement type="Page" cardinality="one" qualifier="page"/>
              <targetElement type="CmsLinkComponent" cardinality="many" qualifier="links" ordered="true"/>
            </relation>
          </relations>
        </items>`,
        '/x/c-items.xml',
        'c',
      ),
    ]);
    const link = system.item('CMSLinkComponent');
    expect(link?.attributes.has('page')).toBe(true);
    expect(link?.attributes.has('pagepos')).toBe(true);
    expect(system.item('Page')?.attributes.has('links')).toBe(true);
    expect(system.items.has('CmsLinkComponent')).toBe(false);
  });
});
