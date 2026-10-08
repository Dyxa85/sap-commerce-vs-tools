import type { ImpexMode } from './model.js';

/** Descriptions are written for this project (not copied from other tools). */

export const MODE_DOCS: Record<ImpexMode, string> = {
  INSERT:
    'Creates new items. Rows whose key already exists are not merged – use INSERT_UPDATE for that.',
  UPDATE:
    'Changes existing items only. At least one column must be `unique=true` to find the item; rows without a match fail.',
  INSERT_UPDATE:
    'Creates the item when no item with the same unique key exists, otherwise updates it. Safe to run repeatedly.',
  REMOVE: 'Deletes the items found through the unique columns.',
};

export interface ModifierInfo {
  name: string;
  doc: string;
  kind: 'boolean' | 'value' | 'enum';
  values?: readonly string[];
  /** Where it is allowed. */
  scope: 'attribute' | 'type';
}

const booleanValues = ['true', 'false'] as const;

export const ATTRIBUTE_MODIFIERS: readonly ModifierInfo[] = [
  {
    name: 'unique',
    kind: 'boolean',
    values: booleanValues,
    scope: 'attribute',
    doc: 'Part of the key that identifies an existing item. At least one column must be unique for UPDATE, REMOVE and INSERT_UPDATE in strict mode.',
  },
  {
    name: 'allownull',
    kind: 'boolean',
    values: booleanValues,
    scope: 'attribute',
    doc: 'An empty cell sets the attribute to null instead of being ignored.',
  },
  {
    name: 'forceWrite',
    kind: 'boolean',
    values: booleanValues,
    scope: 'attribute',
    doc: 'Write the value even if the attribute is not normally writable.',
  },
  {
    name: 'ignorenull',
    kind: 'boolean',
    values: booleanValues,
    scope: 'attribute',
    doc: 'Do not overwrite the attribute when the cell is empty.',
  },
  {
    name: 'ignoreKeyCase',
    kind: 'boolean',
    values: booleanValues,
    scope: 'attribute',
    doc: 'Compare unique key values case-insensitively.',
  },
  {
    name: 'virtual',
    kind: 'boolean',
    values: booleanValues,
    scope: 'attribute',
    doc: 'Column is not an attribute of the item; its value is computed (use with `default`) or consumed by a translator/decorator.',
  },
  {
    name: 'lang',
    kind: 'value',
    scope: 'attribute',
    doc: 'Language (ISO code, e.g. `en`) for a localized attribute.',
  },
  {
    name: 'mode',
    kind: 'enum',
    values: ['append', 'remove', 'replace'],
    scope: 'attribute',
    doc: 'For collection attributes: `append` adds values, `remove` removes them, `replace` (default) overwrites the collection.',
  },
  { name: 'default', kind: 'value', scope: 'attribute', doc: 'Value used when the cell is empty.' },
  {
    name: 'translator',
    kind: 'value',
    scope: 'attribute',
    doc: 'Fully qualified class of a special value translator that converts the cell.',
  },
  {
    name: 'cellDecorator',
    kind: 'value',
    scope: 'attribute',
    doc: 'Fully qualified class of a cell decorator that transforms the cell value before import.',
  },
  {
    name: 'dateformat',
    kind: 'value',
    scope: 'attribute',
    doc: 'Pattern for date values, e.g. `dd.MM.yyyy`.',
  },
  {
    name: 'numberformat',
    kind: 'value',
    scope: 'attribute',
    doc: 'Pattern for number values; quote it if it contains a comma.',
  },
  {
    name: 'collection-delimiter',
    kind: 'value',
    scope: 'attribute',
    doc: 'Separator between the values of a collection cell (default `,`).',
  },
  {
    name: 'map-delimiter',
    kind: 'value',
    scope: 'attribute',
    doc: 'Separator between the entries of a map cell.',
  },
  {
    name: 'key2value-delimiter',
    kind: 'value',
    scope: 'attribute',
    doc: 'Separator between key and value inside map entries.',
  },
  {
    name: 'path-delimiter',
    kind: 'value',
    scope: 'attribute',
    doc: 'Separator for path-like references (default `:`).',
  },
  {
    name: 'alias',
    kind: 'value',
    scope: 'attribute',
    doc: 'Alias that other columns can use to refer to this column.',
  },
  {
    name: 'pos',
    kind: 'value',
    scope: 'attribute',
    doc: 'Position of the value inside a composed cell.',
  },
];

export const TYPE_MODIFIERS: readonly ModifierInfo[] = [
  {
    name: 'batchmode',
    kind: 'boolean',
    values: booleanValues,
    scope: 'type',
    doc: 'Apply the row to all items matching the (non-unique) columns. Only for UPDATE and REMOVE.',
  },
  {
    name: 'impex.legacy.mode',
    kind: 'boolean',
    values: booleanValues,
    scope: 'type',
    doc: 'Import this header through the legacy (Jalo) layer.',
  },
  {
    name: 'processor',
    kind: 'value',
    scope: 'type',
    doc: 'Fully qualified class of an import processor for this header.',
  },
  {
    name: 'cacheUnique',
    kind: 'boolean',
    values: booleanValues,
    scope: 'type',
    doc: 'Cache lookups of unique keys during the import.',
  },
  {
    name: 'condition',
    kind: 'value',
    scope: 'type',
    doc: 'Condition evaluated by a conditional import processor.',
  },
  {
    name: 'disable.interceptor.beans',
    kind: 'value',
    scope: 'type',
    doc: 'Comma-separated bean ids of interceptors that are switched off while this header is imported.',
  },
  {
    name: 'disable.interceptor.types',
    kind: 'value',
    scope: 'type',
    doc: 'Comma-separated interceptor types (e.g. `validate`) that are switched off while this header is imported.',
  },
  {
    name: 'disable.UniqueAttributesValidator.for.types',
    kind: 'value',
    scope: 'type',
    doc: 'Item types for which the unique-attributes validator is skipped during this import.',
  },
];

const byName = (list: readonly ModifierInfo[]): Map<string, ModifierInfo> =>
  new Map(list.map((m) => [m.name.toLowerCase(), m]));

const ATTRIBUTE_BY_NAME = byName(ATTRIBUTE_MODIFIERS);
const TYPE_BY_NAME = byName(TYPE_MODIFIERS);

export function attributeModifier(name: string): ModifierInfo | undefined {
  return ATTRIBUTE_BY_NAME.get(name.toLowerCase());
}

export function typeModifier(name: string): ModifierInfo | undefined {
  return TYPE_BY_NAME.get(name.toLowerCase());
}

export const SPECIAL_VALUES: Record<string, string> = {
  '<ignore>': 'The cell is skipped for this row (the attribute is not touched).',
  '<empty>': 'Sets the attribute to an empty value (empty string / empty collection).',
};
