/**
 * Structure of an items.xml: which elements may contain which children and which attributes (with value hints).
 * Written from the public items.xsd documentation and the files of real projects.
 */
export interface ElementSpec {
  attributes: Record<string, { values?: readonly string[]; kind?: 'type' | 'boolean' | 'free' }>;
  children: readonly string[];
}

const bool = ['true', 'false'] as const;
const b = { values: bool, kind: 'boolean' as const };
const t = { kind: 'type' as const };

export const ITEMS_SCHEMA: Record<string, ElementSpec> = {
  items: {
    attributes: {},
    children: [
      'include',
      'atomictypes',
      'collectiontypes',
      'enumtypes',
      'maptypes',
      'relations',
      'itemtypes',
    ],
  },
  include: { attributes: { file: {} }, children: [] },
  atomictypes: { attributes: {}, children: ['atomictype'] },
  atomictype: { attributes: { class: {}, extends: {}, autocreate: b, generate: b }, children: [] },
  collectiontypes: { attributes: {}, children: ['collectiontype'] },
  collectiontype: {
    attributes: {
      code: {},
      elementtype: t,
      type: { values: ['collection', 'list', 'set'] },
      autocreate: b,
      generate: b,
    },
    children: [],
  },
  maptypes: { attributes: {}, children: ['maptype'] },
  maptype: {
    attributes: {
      code: {},
      argumenttype: t,
      returntype: t,
      autocreate: b,
      generate: b,
      redeclare: b,
    },
    children: [],
  },
  enumtypes: { attributes: {}, children: ['enumtype'] },
  enumtype: {
    attributes: { code: {}, autocreate: b, generate: b, dynamic: b, jaloclass: {} },
    children: ['description', 'value'],
  },
  value: { attributes: { code: {} }, children: ['description'] },
  relations: { attributes: {}, children: ['relation'] },
  relation: {
    attributes: { code: {}, localized: b, generate: b, autocreate: b },
    children: ['deployment', 'sourceElement', 'targetElement'],
  },
  sourceElement: {
    attributes: {
      type: t,
      qualifier: {},
      cardinality: { values: ['one', 'many'] },
      collectiontype: { values: ['collection', 'list', 'set'] },
      ordered: b,
      navigable: b,
      metatype: t,
    },
    children: ['modifiers', 'custom-properties', 'description'],
  },
  targetElement: {
    attributes: {
      type: t,
      qualifier: {},
      cardinality: { values: ['one', 'many'] },
      collectiontype: { values: ['collection', 'list', 'set'] },
      ordered: b,
      navigable: b,
      metatype: t,
    },
    children: ['modifiers', 'custom-properties', 'description'],
  },
  itemtypes: { attributes: {}, children: ['itemtype', 'typegroup'] },
  typegroup: { attributes: { name: {} }, children: ['itemtype'] },
  itemtype: {
    attributes: {
      code: {},
      extends: t,
      jaloclass: {},
      autocreate: b,
      generate: b,
      abstract: b,
      singleton: b,
      metatype: t,
    },
    children: ['description', 'deployment', 'custom-properties', 'attributes', 'indexes'],
  },
  deployment: { attributes: { table: {}, typecode: {}, propertytable: {} }, children: [] },
  attributes: { attributes: {}, children: ['attribute'] },
  attribute: {
    attributes: { qualifier: {}, type: t, metatype: t, autocreate: b, generate: b, redeclare: b },
    children: [
      'description',
      'defaultvalue',
      'persistence',
      'modifiers',
      'model',
      'custom-properties',
    ],
  },
  persistence: {
    attributes: { type: { values: ['property', 'cmp', 'jalo', 'dynamic'] }, attributeHandler: {} },
    children: ['columntype'],
  },
  columntype: { attributes: { database: {} }, children: ['value'] },
  modifiers: {
    attributes: {
      read: b,
      write: b,
      search: b,
      optional: b,
      unique: b,
      encrypted: b,
      private: b,
      initial: b,
      removable: b,
      partof: b,
      dontOptimize: b,
    },
    children: [],
  },
  model: { attributes: {}, children: ['getter', 'setter'] },
  getter: { attributes: { name: {}, default: b, deprecated: b }, children: ['nullDecorator'] },
  setter: { attributes: { name: {}, default: b, deprecated: b }, children: [] },
  indexes: { attributes: {}, children: ['index'] },
  index: {
    attributes: {
      name: {},
      unique: b,
      replace: b,
      remove: b,
      creationmode: { values: ['pk', 'all', 'ora', 'mssql', 'mysql', 'hana'] },
    },
    children: ['key'],
  },
  key: { attributes: { attribute: {}, lower: b }, children: [] },
  'custom-properties': { attributes: {}, children: ['property'] },
  property: { attributes: { name: {} }, children: ['value'] },
  description: { attributes: {}, children: [] },
  defaultvalue: { attributes: {}, children: [] },
};

/** Common Java types offered when completing an attribute type. */
export const JAVA_TYPES = [
  'java.lang.String',
  'java.lang.Boolean',
  'java.lang.Integer',
  'java.lang.Long',
  'java.lang.Double',
  'java.lang.Float',
  'java.lang.Short',
  'java.lang.Byte',
  'java.lang.Character',
  'java.lang.Object',
  'java.lang.Number',
  'java.math.BigDecimal',
  'java.util.Date',
  'java.util.Locale',
  'java.util.Currency',
] as const;
