import type { CompletionEntry } from '../shared/completion.js';
import type { Span } from '../shared/line-index.js';
import type { TypeSchema } from '../shared/schema.js';
import { resolveAlias, soleType, visibleAliases } from './analyze.js';
import { KEYWORDS, KEYWORD_DOCS, SNIPPETS } from './knowledge.js';
import type { FlexDocument, Scope, Token } from './model.js';

const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'ru', 'ja', 'zh', 'ko', 'pl', 'tr'];

export function completeFlex(
  doc: FlexDocument,
  offset: number,
  schema?: TypeSchema,
): CompletionEntry[] {
  const open = innermostOpenBrace(doc, offset);
  if (open && !open.double) {
    const fromContext = isFromBrace(doc, open.tokenIndex);
    const inner = doc.text.slice(open.token.span.end, offset);
    return fromContext
      ? fromEntries(inner, offset, schema)
      : fieldEntries(doc, inner, offset, schema);
  }
  if (open?.double || !open) return keywordEntries(doc, offset);
  return [];
}

function innermostOpenBrace(
  doc: FlexDocument,
  offset: number,
): { token: Token; tokenIndex: number; double: boolean } | undefined {
  const stack: { token: Token; tokenIndex: number; double: boolean }[] = [];
  const tokens = doc.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.span.start >= offset) break;
    const next = tokens[i + 1];
    if (t.kind === 'lbrace') {
      const double =
        next?.kind === 'lbrace' && next.span.start === t.span.end && next.span.end <= offset;
      stack.push({ token: t, tokenIndex: i, double });
      if (double) i++;
    } else if (t.kind === 'rbrace') {
      const top = stack[stack.length - 1];
      if (
        top?.double &&
        next?.kind === 'rbrace' &&
        next.span.start === t.span.end &&
        next.span.end <= offset
      ) {
        stack.pop();
        i++;
      } else {
        stack.pop();
      }
    }
  }
  return stack[stack.length - 1];
}

function isFromBrace(doc: FlexDocument, tokenIndex: number): boolean {
  const prev = doc.tokens[tokenIndex - 1];
  if (prev?.kind === 'keyword' && prev.text.toUpperCase() === 'FROM') return true;
  return prev?.kind === 'punct' && prev.text === ',' && doc.fromBlocks.length > 0;
}

function scopeAt(doc: FlexDocument, offset: number): Scope {
  let best = doc.scopes[0] as Scope;
  for (const scope of doc.scopes) {
    if (
      scope.kind === 'subselect' &&
      offset > scope.span.start &&
      offset <= scope.span.end &&
      scope.span.start >= best.span.start
    ) {
      best = scope;
    }
  }
  return best;
}

function fromEntries(inner: string, offset: number, schema?: TypeSchema): CompletionEntry[] {
  // a type is expected at the start of the brace, after JOIN and after a comma
  const typePosition = /(?:^\s*|\bJOIN\s+|,\s*)([\w$]*)$/i.exec(inner);
  if (typePosition) {
    const prefix = typePosition[1] ?? '';
    if (!schema) return [];
    const replace = { start: offset - prefix.length, end: offset };
    return schema.typeNames().map((name) => ({
      label: name,
      kind: 'type' as const,
      documentation: schema.typeDoc?.(name),
      replace,
    }));
  }
  const afterType = /[A-Za-z_$][\w$]*!?\s+([A-Za-z]*)$/.exec(inner);
  if (afterType && !/\bAS\s+[\w$]*$/i.test(inner)) {
    const prefix = afterType[1] ?? '';
    return ['AS', 'JOIN', 'LEFT JOIN'].map((label) => ({
      label,
      kind: 'keyword' as const,
      replace: { start: offset - prefix.length, end: offset },
    }));
  }
  return [];
}

function fieldEntries(
  doc: FlexDocument,
  inner: string,
  offset: number,
  schema?: TypeSchema,
): CompletionEntry[] {
  const scope = scopeAt(doc, offset);

  const lang = /\[([\w]*)$/.exec(inner);
  if (lang) {
    const prefix = lang[1] ?? '';
    return LANGUAGES.map((l) => ({
      label: l,
      kind: 'value' as const,
      replace: { start: offset - prefix.length, end: offset },
    }));
  }
  if (
    /:\s*[A-Za-z]*$/.test(inner) &&
    /[\w$\]]\s*:\s*[A-Za-z]*$/.test(inner) &&
    /[:.][^:.]*:[A-Za-z]*$/.test(inner)
  ) {
    const prefix = /:([A-Za-z]*)$/.exec(inner)?.[1] ?? '';
    return [
      {
        label: 'o',
        kind: 'modifier',
        documentation: 'Outer join: keep rows without a value.',
        replace: { start: offset - prefix.length, end: offset },
      },
    ];
  }

  const qualified = /([A-Za-z_$][\w$]*)\s*[:.]\s*([\w$]*)$/.exec(inner);
  if (qualified) {
    const prefix = qualified[2] ?? '';
    const type = resolveAlias(scope, qualified[1] ?? '');
    return attributeEntries(type?.typeName, schema, { start: offset - prefix.length, end: offset });
  }

  const prefix = /([\w$]*)$/.exec(inner)?.[1] ?? '';
  const replace = { start: offset - prefix.length, end: offset };
  const entries: CompletionEntry[] = visibleAliases(scope).map((alias) => ({
    label: alias,
    kind: 'value' as const,
    detail: 'alias',
    insertText: `${alias}:`,
    replace,
    sortText: `0${alias}`,
  }));
  const only = soleType(scope);
  if (only) entries.push(...attributeEntries(only.typeName, schema, replace));
  else
    entries.push({
      label: 'pk',
      kind: 'property',
      detail: 'primary key',
      replace,
      sortText: '1pk',
    });
  return entries;
}

function attributeEntries(
  typeName: string | undefined,
  schema: TypeSchema | undefined,
  replace: Span,
): CompletionEntry[] {
  const entries: CompletionEntry[] = [
    { label: 'pk', kind: 'property', detail: 'primary key', replace, sortText: '0pk' },
  ];
  const attrs = typeName ? schema?.attributes(typeName) : undefined;
  for (const a of attrs ?? []) {
    if (a.name === 'pk') continue;
    entries.push({
      label: a.name,
      kind: 'property',
      detail: [a.type, a.localized ? 'localized' : ''].filter(Boolean).join(' · ') || undefined,
      documentation: a.doc,
      insertText: a.localized ? `${a.name}[\${1:en}]` : a.name,
      snippet: a.localized === true,
      replace,
      sortText: `${a.own === false ? '2' : '1'}${a.name}`,
    });
  }
  return entries;
}

function keywordEntries(doc: FlexDocument, offset: number): CompletionEntry[] {
  const before = doc.text.slice(0, offset);
  const prefix = /[A-Za-z_]*$/.exec(before)?.[0] ?? '';
  const replace = { start: offset - prefix.length, end: offset };
  const entries: CompletionEntry[] = [...KEYWORDS]
    .filter((k) => k.startsWith(prefix.toUpperCase()))
    .map((k) => ({
      label: k,
      kind: 'keyword' as const,
      documentation: KEYWORD_DOCS[k],
      replace,
      sortText: `1${k}`,
    }));
  if (before.trim() === '' || /\n\s*[A-Za-z_]*$/.test(before) === false) {
    // snippets are most useful at the start of the file
  }
  if (before.trim() === prefix) {
    for (const s of SNIPPETS) {
      entries.push({
        label: s.label,
        kind: 'snippet',
        detail: s.detail,
        insertText: s.body,
        snippet: true,
        replace,
        sortText: `0${s.label}`,
      });
    }
  }
  if (/\bFROM\s+$/i.test(before)) {
    entries.unshift({
      label: '{Type AS alias}',
      kind: 'snippet',
      insertText: '{${1:Type} AS ${2:alias}}',
      snippet: true,
      replace,
      sortText: '0',
    });
  }
  return entries;
}
