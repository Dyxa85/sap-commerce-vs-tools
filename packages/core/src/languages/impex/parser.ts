import { LineIndex, type Span } from '../shared/line-index.js';
import type { Problem } from '../shared/problem.js';
import type {
  Cell,
  Column,
  ColumnKind,
  DataRow,
  Header,
  ImpexDocument,
  ImpexMode,
  MacroDef,
  MacroUse,
  Modifier,
  RefNode,
  Statement,
} from './model.js';

export const MODES: readonly ImpexMode[] = ['INSERT_UPDATE', 'INSERT', 'UPDATE', 'REMOVE'];

const HEADER_RE = /^([ \t]*)(INSERT_UPDATE|INSERT|UPDATE|REMOVE)(?=[\s;[]|$)/i;
const SUSPECT_MODE_RE = /^([ \t]*)([A-Za-z_]+)[ \t]+[A-Za-z_][\w.]*[ \t]*(?:;|\[|$)/;
const MACRO_DEF_RE = /^([ \t]*)\$([A-Za-z_][\w.-]*)([ \t]*=[ \t]*)(.*?)[ \t]*$/;
const MACRO_USE_RE = /\$([A-Za-z_][\w.-]*)/g;
const USERRIGHTS_START = /^[ \t]*\$START_USERRIGHTS\b/i;
const USERRIGHTS_END = /^[ \t]*\$END_USERRIGHTS\b/i;

interface Line {
  start: number;
  end: number;
  /** Offset after the line break (== end of text for the last line). */
  next: number;
}

export function parseImpex(text: string): ImpexDocument {
  const lines = new LineIndex(text);
  const problems: Problem[] = [];
  const statements: Statement[] = [];
  const headers: Header[] = [];
  const macros: MacroDef[] = [];
  const macroUses: MacroUse[] = [];

  const physical: Line[] = [];
  for (let i = 0; i < lines.lineCount; i++) {
    const start = lines.lineStarts[i] ?? 0;
    const next = lines.lineStarts[i + 1] ?? text.length;
    physical.push({ start, end: lines.lineEnd(i), next });
  }

  let current: Header | undefined;
  let inUserRights = false;

  for (let i = 0; i < physical.length; i++) {
    const line = physical[i] as Line;
    const lineText = text.slice(line.start, line.end);
    const trimmed = lineText.trim();
    if (trimmed === '') continue;

    const lead = lineText.length - lineText.trimStart().length;
    const firstCh = trimmed[0];

    if (firstCh === '#') {
      if (trimmed[1] === '%') {
        statements.push({
          kind: 'script',
          span: { start: line.start + lead, end: line.end },
          text: trimmed,
        });
      } else {
        statements.push({ kind: 'comment', span: { start: line.start + lead, end: line.end } });
      }
      continue;
    }

    if (USERRIGHTS_START.test(lineText)) {
      inUserRights = true;
      statements.push({
        kind: 'userrights-start',
        span: { start: line.start + lead, end: line.end },
      });
      continue;
    }
    if (USERRIGHTS_END.test(lineText)) {
      inUserRights = false;
      statements.push({
        kind: 'userrights-end',
        span: { start: line.start + lead, end: line.end },
      });
      continue;
    }

    const macro = MACRO_DEF_RE.exec(lineText);
    if (macro && !inUserRights) {
      const [, ws = '', name = '', eq = '', value = ''] = macro;
      const nameStart = line.start + ws.length + 1;
      const valueStart = nameStart + name.length + eq.length;
      const def: MacroDef = {
        kind: 'macro',
        span: { start: line.start + ws.length, end: valueStart + value.length },
        name,
        nameSpan: { start: nameStart, end: nameStart + name.length },
        value,
        valueSpan: { start: valueStart, end: valueStart + value.length },
      };
      macros.push(def);
      statements.push(def);
      collectMacroUses(value, valueStart, macroUses);
      continue;
    }

    if (!inUserRights) {
      const headerMatch = HEADER_RE.exec(lineText);
      if (headerMatch) {
        const header = parseHeader(
          text,
          line,
          (headerMatch[1] ?? '').length,
          headerMatch[2] ?? '',
          problems,
          false,
        );
        collectMacroUses(lineText, line.start, macroUses);
        headers.push(header);
        statements.push(header);
        current = header;
        continue;
      }

      const suspect = SUSPECT_MODE_RE.exec(lineText);
      if (suspect && looksLikeMode(suspect[2] ?? '')) {
        const word = suspect[2] as string;
        const wordStart = line.start + (suspect[1]?.length ?? 0);
        const header = parseHeader(text, line, suspect[1]?.length ?? 0, word, problems, true);
        problems.push({
          span: { start: wordStart, end: wordStart + word.length },
          severity: 'error',
          code: 'impex.header.unknown-mode',
          message: `Unknown mode "${word}". Expected ${MODES.join(', ')}. The importer treats this line as a value row ("no current header for value line").`,
          data: { suggestion: closestMode(word) },
        });
        collectMacroUses(lineText, line.start, macroUses);
        headers.push(header);
        statements.push(header);
        current = header;
        continue;
      }
    }

    // ---- value row (may span lines when a quoted value contains line breaks)
    let endLine = i;
    let rowEnd = line.end;
    const open = scanQuoteState(text, line.start, line.end);
    if (open.inQuote) {
      let j = i + 1;
      let state = open;
      while (state.inQuote && j < physical.length) {
        const nextLine = physical[j] as Line;
        state = scanQuoteState(text, nextLine.start, nextLine.end, state);
        endLine = j;
        rowEnd = nextLine.end;
        j++;
      }
      if (state.inQuote) {
        // Never closed: report it, but keep the rest of the file parseable by limiting the row to its first line.
        problems.push({
          span: { start: state.openAt, end: state.openAt + 1 },
          severity: 'error',
          code: 'impex.syntax.unterminated-quote',
          message:
            'Unterminated quote: the importer rejects a file with an odd number of " characters.',
        });
        endLine = i;
        rowEnd = line.end;
      }
    }

    const span: Span = { start: line.start, end: rowEnd };
    const row: DataRow = {
      kind: 'row',
      span,
      cells: splitCells(text, span),
      header: inUserRights ? undefined : current,
      userRights: inUserRights,
      multiline: endLine > i,
    };
    if (!inUserRights) current?.rows.push(row);
    if (!inUserRights) collectMacroUses(text.slice(span.start, span.end), span.start, macroUses);
    statements.push(row);
    i = endLine;
  }

  return { text, lines, statements, headers, macros, macroUses, problems };
}

// ------------------------------------------------------------------ headers

function parseHeader(
  text: string,
  line: Line,
  lead: number,
  modeWord: string,
  problems: Problem[],
  unknownMode: boolean,
): Header {
  const lineText = text.slice(line.start, line.end);
  const modeSpan: Span = { start: line.start + lead, end: line.start + lead + modeWord.length };
  const canonical = unknownMode ? undefined : (modeWord.toUpperCase() as ImpexMode);

  const { segments } = splitHeaderSegments(lineText, line.start, problems);
  const first = segments[0] ?? { start: modeSpan.start, end: line.end };

  // First segment: MODE Type[typeModifiers]
  const afterMode = modeSpan.end;
  let cursor = afterMode;
  while (cursor < first.end && /\s/.test(text[cursor] ?? '')) cursor++;
  let typeEnd = cursor;
  while (typeEnd < first.end && !/[\s[(]/.test(text[typeEnd] ?? '')) typeEnd++;
  const typeName = text.slice(cursor, typeEnd);
  let typeModifiers: Modifier[] = [];
  let typeModifiersSpan: Span | undefined;
  let scan = typeEnd;
  while (scan < first.end && /\s/.test(text[scan] ?? '')) scan++;
  if (text[scan] === '[') {
    const close = findClosing(text, scan, first.end, '[', ']');
    const innerEnd = close === -1 ? first.end : close;
    typeModifiers = parseModifiers(text, scan + 1, innerEnd);
    typeModifiersSpan = { start: scan, end: close === -1 ? first.end : close + 1 };
  }

  const columns: Column[] = [];
  segments.slice(1).forEach((segment, i) => {
    columns.push(parseColumn(text, segment, i + 1, problems));
  });
  // A trailing empty segment (`...;`) is harmless; keep it out of the model.
  while (columns.length > 0 && columns[columns.length - 1]?.kind === 'empty') columns.pop();

  const header: Header = {
    kind: 'header',
    span: { start: line.start + lead, end: line.end },
    mode: modeWord,
    modeSpan,
    canonicalMode: canonical,
    typeName,
    typeSpan: typeName ? { start: cursor, end: typeEnd } : undefined,
    typeModifiers,
    typeModifiersSpan,
    columns,
    valid: !unknownMode && typeName !== '',
    rows: [],
  };

  if (!unknownMode && typeName === '') {
    problems.push({
      span: modeSpan,
      severity: 'error',
      code: 'impex.header.missing-type',
      message: `"${modeWord}" needs a type, e.g. "${modeWord.toUpperCase()} Product;code[unique=true]". Without it the importer ignores this header ("no current header for value line").`,
    });
  }
  return header;
}

/** Splits a header line at top-level `;` (not inside [...], (...) or quotes within brackets). */
export function splitHeaderSegments(
  lineText: string,
  base: number,
  problems: Problem[],
): { segments: Span[] } {
  const segments: Span[] = [];
  let segStart = base;
  const brackets: number[] = [];
  const parens: number[] = [];
  let quote: string | undefined;

  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i] as string;
    const at = base + i;
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (brackets.length > 0 && (ch === "'" || ch === '"')) {
      quote = ch;
    } else if (ch === '[') {
      brackets.push(at);
    } else if (ch === ']') {
      brackets.pop();
    } else if (ch === '(') {
      parens.push(at);
    } else if (ch === ')') {
      parens.pop();
    } else if (ch === ';' && brackets.length === 0 && parens.length === 0) {
      segments.push({ start: segStart, end: at });
      segStart = at + 1;
    }
  }
  segments.push({ start: segStart, end: base + lineText.length });

  for (const at of brackets) {
    problems.push({
      span: { start: at, end: at + 1 },
      severity: 'error',
      code: 'impex.syntax.missing-bracket',
      message: "Missing ']' for this '['.",
      data: { close: ']' },
    });
  }
  for (const at of parens) {
    problems.push({
      span: { start: at, end: at + 1 },
      severity: 'error',
      code: 'impex.syntax.missing-bracket',
      message: "Missing ')' for this '('.",
      data: { close: ')' },
    });
  }
  return { segments };
}

function parseColumn(text: string, segment: Span, index: number, problems: Problem[]): Column {
  let start = segment.start;
  let end = segment.end;
  while (start < end && /\s/.test(text[start] ?? '')) start++;
  while (end > start && /\s/.test(text[end - 1] ?? '')) end--;
  const span: Span = { start, end };

  if (start === end) {
    return { index, span, kind: 'empty', name: '', nameSpan: span, refs: [], modifiers: [] };
  }

  let nameEnd = start;
  while (nameEnd < end && !/[[(\s]/.test(text[nameEnd] ?? '')) nameEnd++;
  const rawName = text.slice(start, nameEnd);
  const prefix = rawName[0];
  const kind: ColumnKind =
    prefix === '@' ? 'dynamic' : prefix === '&' ? 'docid' : prefix === '$' ? 'macro' : 'attribute';
  const hasPrefix = kind === 'dynamic' || kind === 'docid';
  const name = hasPrefix ? rawName.slice(1) : rawName;
  const nameSpan: Span = { start: hasPrefix ? start + 1 : start, end: nameEnd };

  const column: Column = { index, span, kind, name, nameSpan, refs: [], modifiers: [] };

  let cursor = nameEnd;
  while (cursor < end) {
    const ch = text[cursor] as string;
    if (/\s/.test(ch)) {
      cursor++;
    } else if (ch === '(') {
      const close = findClosing(text, cursor, end, '(', ')');
      const innerEnd = close === -1 ? end : close;
      column.refs.push(...parseRefs(text, cursor + 1, innerEnd));
      column.refsSpan = { start: cursor, end: close === -1 ? end : close + 1 };
      cursor = close === -1 ? end : close + 1;
    } else if (ch === '[') {
      const close = findClosing(text, cursor, end, '[', ']');
      const innerEnd = close === -1 ? end : close;
      column.modifiers.push(...parseModifiers(text, cursor + 1, innerEnd));
      column.modifiersSpan = { start: cursor, end: close === -1 ? end : close + 1 };
      cursor = close === -1 ? end : close + 1;
    } else {
      problems.push({
        span: { start: cursor, end },
        severity: 'error',
        code: 'impex.syntax.unexpected-text',
        message: `Unexpected text "${text.slice(cursor, end).trim()}" in column header. Expected "(…)" or "[…]".`,
      });
      column.kind = kind === 'attribute' ? 'invalid' : kind;
      break;
    }
  }

  const lang = column.modifiers.find((m) => m.name.toLowerCase() === 'lang');
  if (lang?.value && !lang.value.includes('$')) column.lang = lang.value;
  return column;
}

/** Index of the bracket closing the one at `open`, or -1. Quotes protect brackets inside `[...]`. */
function findClosing(
  text: string,
  open: number,
  limit: number,
  openCh: string,
  closeCh: string,
): number {
  let depth = 0;
  let quote: string | undefined;
  for (let i = open; i < limit; i++) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (openCh === '[' && (ch === "'" || ch === '"')) quote = ch;
    else if (ch === openCh) depth++;
    else if (ch === closeCh && --depth === 0) return i;
  }
  return -1;
}

/** Splits `a,b(c,d),e` at top-level commas. */
function splitTopLevel(text: string, start: number, end: number): Span[] {
  const parts: Span[] = [];
  let depthParen = 0;
  let depthBracket = 0;
  let quote: string | undefined;
  let partStart = start;
  for (let i = start; i < end; i++) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depthParen++;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === ',' && depthParen === 0 && depthBracket === 0) {
      parts.push({ start: partStart, end: i });
      partStart = i + 1;
    }
  }
  parts.push({ start: partStart, end });
  return parts;
}

function trim(text: string, span: Span): Span {
  let { start, end } = span;
  while (start < end && /\s/.test(text[start] ?? '')) start++;
  while (end > start && /\s/.test(text[end - 1] ?? '')) end--;
  return { start, end };
}

export function parseModifiers(text: string, start: number, end: number): Modifier[] {
  const modifiers: Modifier[] = [];
  for (const raw of splitTopLevel(text, start, end)) {
    const part = trim(text, raw);
    if (part.start === part.end) continue;
    const eq = text.indexOf('=', part.start);
    if (eq === -1 || eq >= part.end) {
      modifiers.push({
        name: text.slice(part.start, part.end),
        nameSpan: part,
        span: part,
      });
      continue;
    }
    const nameSpan = trim(text, { start: part.start, end: eq });
    const valueSpan = trim(text, { start: eq + 1, end: part.end });
    let value = text.slice(valueSpan.start, valueSpan.end);
    if (
      value.length >= 2 &&
      (value[0] === "'" || value[0] === '"') &&
      value.endsWith(value[0] as string)
    ) {
      value = value.slice(1, -1);
    }
    modifiers.push({
      name: text.slice(nameSpan.start, nameSpan.end),
      nameSpan,
      value,
      valueSpan,
      span: part,
    });
  }
  return modifiers;
}

function parseRefs(text: string, start: number, end: number): RefNode[] {
  const nodes: RefNode[] = [];
  for (const raw of splitTopLevel(text, start, end)) {
    const part = trim(text, raw);
    if (part.start === part.end) continue;
    let nameEnd = part.start;
    while (nameEnd < part.end && !/[[(\s]/.test(text[nameEnd] ?? '')) nameEnd++;
    const node: RefNode = {
      name: text.slice(part.start, nameEnd),
      span: part,
      modifiers: [],
      children: [],
    };
    let cursor = nameEnd;
    while (cursor < part.end) {
      const ch = text[cursor] as string;
      if (ch === '(') {
        const close = findClosing(text, cursor, part.end, '(', ')');
        const inner = close === -1 ? part.end : close;
        node.children.push(...parseRefs(text, cursor + 1, inner));
        cursor = close === -1 ? part.end : close + 1;
      } else if (ch === '[') {
        const close = findClosing(text, cursor, part.end, '[', ']');
        const inner = close === -1 ? part.end : close;
        node.modifiers.push(...parseModifiers(text, cursor + 1, inner));
        cursor = close === -1 ? part.end : close + 1;
      } else {
        cursor++;
      }
    }
    nodes.push(node);
  }
  return nodes;
}

// ------------------------------------------------------------------ value rows

interface QuoteState {
  inQuote: boolean;
  /** Offset of the `"` that opened the currently open quote. */
  openAt: number;
}

function scanQuoteState(
  text: string,
  start: number,
  end: number,
  previous: QuoteState = { inQuote: false, openAt: -1 },
): QuoteState {
  let { inQuote, openAt } = previous;
  for (let i = start; i < end; i++) {
    if (text[i] === '"') {
      inQuote = !inQuote;
      if (inQuote) openAt = i;
    }
  }
  return { inQuote, openAt };
}

function splitCells(text: string, span: Span): Cell[] {
  const cells: Cell[] = [];
  let inQuote = false;
  let cellStart = span.start;
  const push = (end: number): void => {
    const rawSpan: Span = { start: cellStart, end };
    const valueSpan = trim(text, rawSpan);
    const raw = text.slice(rawSpan.start, rawSpan.end);
    let value = text.slice(valueSpan.start, valueSpan.end);
    let quoted = false;
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      quoted = true;
      value = value.slice(1, -1).replace(/""/g, '"');
    }
    cells.push({ index: cells.length, span: rawSpan, raw, value, valueSpan, quoted });
  };
  for (let i = span.start; i < span.end; i++) {
    const ch = text[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ';' && !inQuote) {
      push(i);
      cellStart = i + 1;
    }
  }
  push(span.end);
  return cells;
}

// ------------------------------------------------------------------ macros

function collectMacroUses(segmentText: string, base: number, out: MacroUse[]): void {
  for (const m of segmentText.matchAll(MACRO_USE_RE)) {
    const at = base + (m.index ?? 0);
    out.push({ name: m[1] as string, span: { start: at, end: at + m[0].length } });
  }
}

function looksLikeMode(word: string): boolean {
  const upper = word.toUpperCase();
  if (MODES.includes(upper as ImpexMode)) return false;
  return MODES.some((m) => distance(upper, m) <= 3) && upper.length >= 5;
}

export function closestMode(word: string): ImpexMode | undefined {
  const upper = word.toUpperCase();
  let best: ImpexMode | undefined;
  let bestDistance = Infinity;
  for (const mode of MODES) {
    const d = distance(upper, mode);
    if (d < bestDistance) {
      bestDistance = d;
      best = mode;
    }
  }
  return bestDistance <= 3 ? best : undefined;
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = temp;
    }
  }
  return prev[b.length] as number;
}
