import type { LineIndex, Span } from './line-index.js';

/** One legend for all languages of this extension. */
export const TOKEN_TYPES = [
  'keyword',
  'class',
  'property',
  'parameter',
  'variable',
  'macro',
  'decorator',
  'enumMember',
  'string',
  'number',
  'comment',
  'function',
  'operator',
] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

export const TOKEN_MODIFIERS = ['declaration', 'readonly'] as const;
export type TokenModifier = (typeof TOKEN_MODIFIERS)[number];

export interface SemanticToken {
  line: number;
  character: number;
  length: number;
  type: TokenType;
  modifiers: TokenModifier[];
}

export interface RawToken {
  span: Span;
  type: TokenType;
  modifiers?: TokenModifier[];
  /** Higher wins when tokens overlap. */
  priority: number;
}

/**
 * LSP semantic tokens must not overlap. Higher-priority tokens (priority >= 2) win; lower-priority ones are cut
 * around them. O(n log n): the common case has no overlap at all.
 */
export function resolveOverlaps(tokens: readonly RawToken[]): RawToken[] {
  const high = tokens
    .filter((t) => t.priority >= 2)
    .sort((a, b) => a.span.start - b.span.start || b.priority - a.priority);
  const kept: RawToken[] = [];
  let lastEnd = -1;
  for (const token of high) {
    if (token.span.start >= lastEnd) {
      kept.push(token);
      lastEnd = token.span.end;
    } else if (token.span.end > lastEnd) {
      kept.push({ ...token, span: { start: lastEnd, end: token.span.end } });
      lastEnd = token.span.end;
    }
  }

  const out: RawToken[] = [...kept];
  for (const token of tokens) {
    if (token.priority >= 2) continue;
    let lo = 0;
    let hi = kept.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((kept[mid] as RawToken).span.end <= token.span.start) lo = mid + 1;
      else hi = mid;
    }
    let cursor = token.span.start;
    for (let i = lo; i < kept.length && (kept[i] as RawToken).span.start < token.span.end; i++) {
      const blocker = (kept[i] as RawToken).span;
      if (blocker.start > cursor)
        out.push({ ...token, span: { start: cursor, end: blocker.start } });
      cursor = Math.max(cursor, blocker.end);
    }
    if (cursor < token.span.end)
      out.push({ ...token, span: { start: cursor, end: token.span.end } });
  }
  return out.sort((a, b) => a.span.start - b.span.start);
}

/** Resolves overlaps and splits tokens at line breaks (tokens cannot span lines). */
export function toSemanticTokens(lines: LineIndex, raw: readonly RawToken[]): SemanticToken[] {
  const out: SemanticToken[] = [];
  for (const token of resolveOverlaps(raw.filter((t) => t.span.end > t.span.start))) {
    const startPos = lines.positionAt(token.span.start);
    const endPos = lines.positionAt(token.span.end);
    for (let line = startPos.line; line <= endPos.line; line++) {
      const from = line === startPos.line ? startPos.character : 0;
      const to =
        line === endPos.line
          ? endPos.character
          : lines.lineEnd(line) - (lines.lineStarts[line] ?? 0);
      if (to > from) {
        out.push({
          line,
          character: from,
          length: to - from,
          type: token.type,
          modifiers: token.modifiers ?? [],
        });
      }
    }
  }
  return out;
}

/** LSP wire format: relative, flattened. */
export function encodeSemanticTokens(tokens: readonly SemanticToken[]): number[] {
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const t of tokens) {
    const deltaLine = t.line - prevLine;
    const deltaChar = deltaLine === 0 ? t.character - prevChar : t.character;
    const modifierBits = t.modifiers.reduce(
      (bits, m) => bits | (1 << TOKEN_MODIFIERS.indexOf(m)),
      0,
    );
    data.push(deltaLine, deltaChar, t.length, TOKEN_TYPES.indexOf(t.type), modifierBits);
    prevLine = t.line;
    prevChar = t.character;
  }
  return data;
}
