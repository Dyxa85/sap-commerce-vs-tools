import type { TextEdit } from '../shared/edits.js';
import type { Span } from '../shared/line-index.js';
import { splitHeaderSegments } from './parser.js';
import type { DataRow, Header, ImpexDocument } from './model.js';

export interface FormatOptions {
  /** Pad cells so columns line up vertically. Default true. */
  alignColumns?: boolean;
  /** Pad the type column of value rows to the width of "MODE Type" in the header. Default true. */
  alignTypeColumn?: boolean;
  /** Remove trailing whitespace on all lines. Default true. */
  trimTrailingWhitespace?: boolean;
}

/**
 * Whitespace around cell values is insignificant to the importer (verified on a real instance), so padding is safe.
 * Rows containing multi-line values are left untouched.
 */
export function formatImpex(
  doc: ImpexDocument,
  options: FormatOptions = {},
  range?: Span,
): TextEdit[] {
  const align = options.alignColumns ?? true;
  const alignType = options.alignTypeColumn ?? true;
  const trimTrailing = options.trimTrailingWhitespace ?? true;
  const edits: TextEdit[] = [];
  const handled = new Set<number>(); // line numbers rewritten by block alignment
  const problemStarts = doc.problems.map((p) => p.span.start).sort((a, b) => a - b);
  const insideValue = continuationLines(doc);

  if (align) {
    for (const header of doc.headers) {
      if (!header.valid || hasProblem(problemStarts, header)) continue;
      const rows = header.rows.filter((r) => !r.multiline);
      const blockEnd =
        rows.length > 0 ? (rows[rows.length - 1] as DataRow).span.end : header.span.end;
      if (range && (blockEnd < range.start || header.span.start > range.end)) continue;
      formatBlock(doc, header, rows, alignType, edits, handled);
    }
  }

  if (trimTrailing) {
    const { lines, text } = doc;
    for (let line = 0; line < lines.lineCount; line++) {
      if (handled.has(line)) continue;
      const start = lines.lineStarts[line] ?? 0;
      const end = lines.lineEnd(line);
      if (range && (end < range.start || start > range.end)) continue;
      let cut = end;
      while (cut > start && (text[cut - 1] === ' ' || text[cut - 1] === '\t')) cut--;
      if (cut < end && !insideValue.has(line))
        edits.push({ span: { start: cut, end }, newText: '' });
    }
  }
  return edits.sort((a, b) => a.span.start - b.span.start);
}

/** Lines that continue a multi-line value (their trailing whitespace belongs to the value). */
function continuationLines(doc: ImpexDocument): Set<number> {
  const lines = new Set<number>();
  for (const s of doc.statements) {
    if (s.kind !== 'row' || !s.multiline) continue;
    const first = doc.lines.positionAt(s.span.start).line;
    const last = doc.lines.positionAt(s.span.end).line;
    for (let l = first + 1; l <= last; l++) lines.add(l);
  }
  return lines;
}

/** True when a parse problem starts on the header line (binary search over sorted problem starts). */
function hasProblem(starts: readonly number[], header: Header): boolean {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((starts[mid] as number) < header.span.start) lo = mid + 1;
    else hi = mid;
  }
  return lo < starts.length && (starts[lo] as number) <= header.span.end;
}

function formatBlock(
  doc: ImpexDocument,
  header: Header,
  rows: DataRow[],
  alignType: boolean,
  edits: TextEdit[],
  handled: Set<number>,
): void {
  const headerText = doc.text.slice(header.span.start, header.span.end);
  const headerCells = splitHeaderSegments(headerText, header.span.start, []).segments.map((s) =>
    doc.text.slice(s.start, s.end).trim(),
  );

  const lines: { span: Span; cells: string[]; isHeader: boolean }[] = [
    { span: header.span, cells: headerCells, isHeader: true },
    ...rows.map((row) => ({
      span: { start: row.span.start, end: row.span.end },
      cells: row.cells.map((c) => c.raw.trim()),
      isHeader: false,
    })),
  ];
  // Trailing empty cells carry no information; keep the row's own count but never widen columns for them.
  const widths: number[] = [];
  for (const line of lines) {
    line.cells.forEach((cell, i) => {
      if (i === 0 && !alignType) return;
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }

  for (const line of lines) {
    const lastNonEmpty = findLastNonEmpty(line.cells);
    const parts = line.cells.slice(0, Math.max(lastNonEmpty + 1, 1)).map((cell, i, all) => {
      const isLast = i === all.length - 1;
      if (isLast) return cell;
      if (i === 0 && !alignType) return cell;
      return cell.padEnd(widths[i] ?? 0, ' ');
    });
    const trailing =
      line.cells.length > parts.length ? ';'.repeat(line.cells.length - parts.length) : '';
    const newText = trimEndSpaces(parts.join(';') + trailing);
    const original = doc.text.slice(line.span.start, line.span.end);
    markHandled(doc, line.span, handled);
    if (newText !== original) edits.push({ span: line.span, newText });
  }
}

function findLastNonEmpty(cells: readonly string[]): number {
  for (let i = cells.length - 1; i >= 0; i--) if (cells[i] !== '') return i;
  return -1;
}

function markHandled(doc: ImpexDocument, span: Span, handled: Set<number>): void {
  const first = doc.lines.positionAt(span.start).line;
  const last = doc.lines.positionAt(span.end).line;
  for (let l = first; l <= last; l++) handled.add(l);
}

/** `String.prototype.trimEnd` limited to spaces/tabs (a regex like /[ \t]+$/ is quadratic on long space runs). */
function trimEndSpaces(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
  return end === text.length ? text : text.slice(0, end);
}
