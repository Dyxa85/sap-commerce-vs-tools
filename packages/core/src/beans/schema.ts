import type { ElementSpec } from '../typesystem/items-schema.js';

const b = { values: ['true', 'false'] as const, kind: 'boolean' as const };

/** Structure of a beans.xml (public format, verified against the files of a real project). */
export const BEANS_SCHEMA: Record<string, ElementSpec> = {
  beans: { attributes: {}, children: ['import', 'bean', 'enum'] },
  import: { attributes: { type: {} }, children: [] },
  bean: {
    attributes: {
      class: {},
      extends: { kind: 'type' },
      abstract: b,
      template: {},
      deprecated: {},
      deprecatedSince: {},
      type: {},
    },
    children: ['description', 'hints', 'annotations', 'property'],
  },
  property: {
    attributes: {
      name: {},
      type: { kind: 'type' },
      equals: b,
      deprecated: {},
      deprecatedSince: {},
    },
    children: ['description', 'hints', 'annotations'],
  },
  enum: {
    attributes: { class: {}, template: {}, deprecated: {}, deprecatedSince: {} },
    children: ['description', 'value'],
  },
  value: { attributes: {}, children: [] },
  description: { attributes: {}, children: [] },
  hints: { attributes: {}, children: ['hint'] },
  hint: { attributes: { name: {} }, children: [] },
  annotations: { attributes: { scope: { values: ['all', 'java', 'ws'] } }, children: [] },
};

/** Java types that beans commonly use for properties. */
export const BEAN_JAVA_TYPES = [
  'String',
  'Integer',
  'Long',
  'Double',
  'Float',
  'Boolean',
  'Character',
  'Short',
  'Byte',
  'int',
  'long',
  'double',
  'float',
  'boolean',
  'char',
  'java.util.Date',
  'java.math.BigDecimal',
  'java.util.Map<String, String>',
  'java.util.List<String>',
  'java.util.Set<String>',
  'java.util.Locale',
] as const;
