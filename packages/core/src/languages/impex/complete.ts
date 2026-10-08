import type { CompletionEntry } from '../shared/completion.js';
import type { Span } from '../shared/line-index.js';
import {
  ATTRIBUTE_MODIFIERS,
  MODE_DOCS,
  SPECIAL_VALUES,
  TYPE_MODIFIERS,
  attributeModifier,
  typeModifier,
} from './knowledge.js';
import type { Header, ImpexDocument } from './model.js';
import { MODES } from './parser.js';
import type { TypeSchema, SchemaAttribute } from '../shared/schema.js';

const LANGUAGES = [
  'en',
  'de',
  'fr',
  'es',
  'it',
  'nl',
  'pt',
  'ru',
  'ja',
  'zh',
  'ko',
  'pl',
  'tr',
  'sv',
  'da',
  'nb',
  'fi',
  'cs',
  'hu',
  'ar',
  'he',
  'el',
  'ro',
  'sk',
  'bg',
  'uk',
];

const MODE_SNIPPETS: Record<string, string> = {
  INSERT_UPDATE: 'INSERT_UPDATE ${1:Type};${2:code}[unique=true]$0',
  INSERT: 'INSERT ${1:Type};${2:code}$0',
  UPDATE: 'UPDATE ${1:Type};${2:code}[unique=true]$0',
  REMOVE: 'REMOVE ${1:Type};${2:code}[unique=true]$0',
};

export function complete(
  doc: ImpexDocument,
  offset: number,
  schema?: TypeSchema,
): CompletionEntry[] {
  const { text, lines } = doc;
  const line = lines.positionAt(offset).line;
  const lineStart = lines.lineStarts[line] ?? 0;
  const before = text.slice(lineStart, offset);

  // $macro
  const macroPrefix = /\$[\w.-]*$/.exec(before);
  if (macroPrefix) {
    return macroEntries(doc, offset, { start: offset - macroPrefix[0].length, end: offset });
  }

  // start of a line: modes & friends
  const startWord = /^[ \t]*([A-Za-z_]*)$/.exec(before);
  if (startWord && !insideMultilineValue(doc, offset)) {
    const prefix = startWord[1] ?? '';
    return startOfLineEntries(prefix, { start: offset - prefix.length, end: offset });
  }

  const statement = doc.statements.find((s) => offset >= s.span.start && offset <= s.span.end);
  if (statement?.kind === 'header') return headerEntries(doc, statement, offset, schema);
  if (statement?.kind === 'row') return rowEntries(doc, statement.header, offset, schema);
  return [];
}

function insideMultilineValue(doc: ImpexDocument, offset: number): boolean {
  return doc.statements.some(
    (s) => s.kind === 'row' && s.multiline && offset > s.span.start && offset <= s.span.end,
  );
}

function macroEntries(doc: ImpexDocument, offset: number, replace: Span): CompletionEntry[] {
  const latest = new Map<string, string>();
  for (const def of doc.macros) {
    if (def.span.start < offset) latest.set(def.name, def.value);
  }
  const entries: CompletionEntry[] = [...latest].map(([name, value]) => ({
    label: `$${name}`,
    kind: 'macro',
    detail: value,
    replace,
    sortText: `0${name}`,
  }));
  entries.push({
    label: '$config-',
    kind: 'macro',
    detail: 'Value of a platform configuration property',
    documentation:
      'Example: `$config-media.default.url` resolves the property from the platform configuration.',
    replace,
    sortText: '9',
  });
  return entries;
}

function startOfLineEntries(prefix: string, replace: Span): CompletionEntry[] {
  const upper = prefix.toUpperCase();
  const entries: CompletionEntry[] = MODES.filter((m) => m.startsWith(upper)).map((mode) => ({
    label: mode,
    kind: 'snippet' as const,
    detail: 'ImpEx header',
    documentation: MODE_DOCS[mode],
    insertText: MODE_SNIPPETS[mode],
    snippet: true,
    replace,
    sortText: `0${mode}`,
  }));
  if (prefix === '') {
    entries.push(
      {
        label: '$macro = value',
        kind: 'snippet',
        detail: 'Macro definition',
        insertText: '$${1:name}=${2:value}',
        snippet: true,
        replace,
        sortText: '1',
      },
      {
        label: '#% script',
        kind: 'snippet',
        detail: 'Code line (needs code execution)',
        insertText: '#% ${1:impex.info("...");}',
        snippet: true,
        replace,
        sortText: '2',
      },
      {
        label: '# comment',
        kind: 'snippet',
        detail: 'Comment',
        insertText: '# ${1:comment}',
        snippet: true,
        replace,
        sortText: '3',
      },
    );
  }
  return entries;
}

// ------------------------------------------------------------------ header

interface HeaderContext {
  segmentIndex: number;
  segmentStart: number;
  /** Offset of the unclosed `[`, if the cursor is inside modifiers. */
  bracketAt?: number;
  /** Offset of the unclosed innermost `(`, if inside a reference pattern. */
  parenAt?: number;
}

function headerContext(doc: ImpexDocument, header: Header, offset: number): HeaderContext {
  let segmentIndex = 0;
  let segmentStart = header.span.start;
  const brackets: number[] = [];
  const parens: number[] = [];
  let quote: string | undefined;
  for (let i = header.span.start; i < offset; i++) {
    const ch = doc.text[i] as string;
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (brackets.length > 0 && (ch === "'" || ch === '"')) quote = ch;
    else if (ch === '[') brackets.push(i);
    else if (ch === ']') brackets.pop();
    else if (ch === '(') parens.push(i);
    else if (ch === ')') parens.pop();
    else if (ch === ';' && brackets.length === 0 && parens.length === 0) {
      segmentIndex++;
      segmentStart = i + 1;
    }
  }
  return {
    segmentIndex,
    segmentStart,
    bracketAt: brackets[brackets.length - 1],
    parenAt: parens[parens.length - 1],
  };
}

function headerEntries(
  doc: ImpexDocument,
  header: Header,
  offset: number,
  schema?: TypeSchema,
): CompletionEntry[] {
  const ctx = headerContext(doc, header, offset);

  // inside [ ... ]
  if (ctx.bracketAt !== undefined) {
    const inner = doc.text.slice(ctx.bracketAt + 1, offset);
    const lastComma = inner.lastIndexOf(',');
    const item = inner.slice(lastComma + 1);
    const itemStart = ctx.bracketAt + 1 + lastComma + 1;
    const eq = item.indexOf('=');
    const isType = ctx.segmentIndex === 0;
    if (eq === -1) {
      const lead = item.length - item.trimStart().length;
      const replace = { start: itemStart + lead, end: offset };
      const used = new Set(
        (isType
          ? header.typeModifiers
          : (header.columns.find((c) => c.index === ctx.segmentIndex)?.modifiers ?? [])
        ).map((m) => m.name.toLowerCase()),
      );
      return (isType ? TYPE_MODIFIERS : ATTRIBUTE_MODIFIERS)
        .filter((m) => !used.has(m.name.toLowerCase()))
        .map((m) => ({
          label: m.name,
          kind: 'modifier' as const,
          documentation: m.doc,
          insertText: m.kind === 'boolean' ? `${m.name}=\${1|true,false|}` : `${m.name}=`,
          snippet: m.kind === 'boolean',
          replace,
        }));
    }
    const name = item.slice(0, eq).trim();
    const valueLead = item.slice(eq + 1);
    const replace = {
      start: itemStart + eq + 1 + (valueLead.length - valueLead.trimStart().length),
      end: offset,
    };
    const info = (isType ? typeModifier(name) : attributeModifier(name)) ?? undefined;
    const values: string[] = info?.values
      ? [...info.values]
      : name.toLowerCase() === 'lang'
        ? LANGUAGES
        : [];
    return values.map((v) => ({ label: v, kind: 'value' as const, replace }));
  }

  // inside ( ... ): reference attributes
  if (ctx.parenAt !== undefined) {
    if (!schema) return [];
    const column = header.columns.find((c) => c.index === ctx.segmentIndex);
    const typeOfAttr = column
      ? schema
          .attributes(header.typeName)
          ?.find((a) => a.name.toLowerCase() === column.name.toLowerCase())?.type
      : undefined;
    const attrs = typeOfAttr ? schema.attributes(typeOfAttr) : undefined;
    const prefix = /[\w.]*$/.exec(doc.text.slice(ctx.parenAt + 1, offset))?.[0] ?? '';
    return (attrs ?? []).map((a) =>
      attributeEntry(a, { start: offset - prefix.length, end: offset }),
    );
  }

  const segmentText = doc.text.slice(ctx.segmentStart, offset);
  const lead = segmentText.length - segmentText.trimStart().length;
  const prefix = segmentText.trimStart();

  // type name after the mode
  if (ctx.segmentIndex === 0) {
    if (!schema) return [];
    const afterMode = doc.text.slice(header.modeSpan.end, offset);
    if (!/^\s+[\w.]*$/.test(afterMode)) return [];
    const typed = /[\w.]*$/.exec(afterMode)?.[0] ?? '';
    return schema.typeNames().map((name) => ({
      label: name,
      kind: 'type' as const,
      documentation: schema.typeDoc?.(name),
      replace: { start: offset - typed.length, end: offset },
    }));
  }

  // attribute name
  if (!schema) return [];
  if (/[[(]/.test(prefix)) return [];
  const replace = { start: ctx.segmentStart + lead, end: offset };
  const attrs = schema.attributes(header.typeName) ?? [];
  const existing = new Set(
    header.columns.filter((c) => c.index !== ctx.segmentIndex).map((c) => c.name.toLowerCase()),
  );
  return attrs
    .filter((a) => !existing.has(a.name.toLowerCase()) || a.localized)
    .map((a) => attributeEntry(a, replace));
}

function attributeEntry(a: SchemaAttribute, replace: Span): CompletionEntry {
  const flags = [
    a.unique ? 'unique' : '',
    a.mandatory ? 'mandatory' : '',
    a.localized ? 'localized' : '',
  ]
    .filter(Boolean)
    .join(', ');
  return {
    label: a.name,
    kind: 'property',
    detail: [a.type, flags].filter(Boolean).join(' · ') || undefined,
    documentation: a.doc,
    insertText: a.localized ? `${a.name}[lang=\${1:en}]` : a.name,
    snippet: a.localized === true,
    replace,
    sortText: `${a.own === false ? '1' : '0'}${a.name}`,
  };
}

// ------------------------------------------------------------------ rows

function rowEntries(
  doc: ImpexDocument,
  header: Header | undefined,
  offset: number,
  schema?: TypeSchema,
): CompletionEntry[] {
  const row = doc.statements.find(
    (s) => s.kind === 'row' && offset >= s.span.start && offset <= s.span.end,
  );
  if (row?.kind !== 'row') return [];
  const cell = row.cells.find((c) => offset >= c.span.start && offset <= c.span.end);
  if (!cell || cell.index === 0) return [];
  const typed = doc.text.slice(cell.span.start, offset);
  const lead = typed.length - typed.trimStart().length;
  const replace = { start: cell.span.start + lead, end: offset };
  const prefix = typed.trimStart();

  const entries: CompletionEntry[] = [];
  const column = header?.columns.find((c) => c.index === cell.index);
  if (column && header && schema?.enumValues) {
    for (const value of schema.enumValues(header.typeName, column.name) ?? []) {
      entries.push({ label: value, kind: 'enumMember', replace });
    }
  }
  for (const [value, doc] of Object.entries(SPECIAL_VALUES)) {
    if (value.startsWith(prefix.toLowerCase()) || prefix === '') {
      entries.push({ label: value, kind: 'value', documentation: doc, replace, sortText: '9' });
    }
  }
  return entries;
}
