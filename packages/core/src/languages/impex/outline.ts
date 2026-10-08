import type { Span } from '../shared/line-index.js';
import type { Header, ImpexDocument } from './model.js';

export interface OutlineSymbol {
  name: string;
  detail?: string;
  kind: 'header' | 'macro' | 'column';
  span: Span;
  selection: Span;
  children: OutlineSymbol[];
}

export function outline(doc: ImpexDocument): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  for (const statement of doc.statements) {
    if (statement.kind === 'macro') {
      symbols.push({
        name: `$${statement.name}`,
        detail: statement.value,
        kind: 'macro',
        span: statement.span,
        selection: statement.nameSpan,
        children: [],
      });
    } else if (statement.kind === 'header') {
      symbols.push(headerSymbol(statement));
    }
  }
  return symbols;
}

function headerSymbol(header: Header): OutlineSymbol {
  const end =
    header.rows.length > 0
      ? (header.rows[header.rows.length - 1]?.span.end ?? header.span.end)
      : header.span.end;
  const rows = header.rows.length;
  return {
    name: `${header.mode.toUpperCase()} ${header.typeName || '?'}`,
    detail: `${rows} row${rows === 1 ? '' : 's'}`,
    kind: 'header',
    span: { start: header.span.start, end },
    selection: header.modeSpan,
    children: header.columns
      .filter((c) => c.kind !== 'empty')
      .map((c) => ({
        name: c.kind === 'dynamic' ? `@${c.name}` : c.kind === 'docid' ? `&${c.name}` : c.name,
        detail:
          c.modifiers
            .map((m) => (m.value === undefined ? m.name : `${m.name}=${m.value}`))
            .join(', ') || undefined,
        kind: 'column' as const,
        span: c.span,
        selection: c.nameSpan,
        children: [],
      })),
  };
}

export interface FoldingSpan {
  span: Span;
  kind: 'region' | 'comment';
}

export function folding(doc: ImpexDocument): FoldingSpan[] {
  const ranges: FoldingSpan[] = [];
  const lineOf = (offset: number): number => doc.lines.positionAt(offset).line;

  for (const header of doc.headers) {
    const end =
      header.rows.length > 0
        ? (header.rows[header.rows.length - 1]?.span.end ?? header.span.end)
        : header.span.end;
    if (lineOf(end) > lineOf(header.span.start)) {
      ranges.push({ span: { start: header.span.start, end }, kind: 'region' });
    }
  }
  for (const row of doc.statements) {
    if (row.kind === 'row' && row.multiline) ranges.push({ span: row.span, kind: 'region' });
  }

  // Consecutive comment lines and user-rights regions
  let runStart: number | undefined;
  let runEnd = 0;
  let lastLine = -2;
  const flush = (): void => {
    if (runStart !== undefined && lineOf(runEnd) > lineOf(runStart)) {
      ranges.push({ span: { start: runStart, end: runEnd }, kind: 'comment' });
    }
    runStart = undefined;
  };
  let rightsStart: number | undefined;
  for (const s of doc.statements) {
    if (s.kind === 'comment') {
      const line = lineOf(s.span.start);
      if (runStart === undefined || line !== lastLine + 1) {
        flush();
        runStart = s.span.start;
      }
      runEnd = s.span.end;
      lastLine = line;
    } else {
      flush();
    }
    if (s.kind === 'userrights-start') rightsStart = s.span.start;
    if (s.kind === 'userrights-end' && rightsStart !== undefined) {
      ranges.push({ span: { start: rightsStart, end: s.span.end }, kind: 'region' });
      rightsStart = undefined;
    }
  }
  flush();
  return ranges;
}
