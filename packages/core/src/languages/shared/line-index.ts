/** Offset <-> (line, character) conversion. Characters are UTF-16 code units, like LSP positions. */

export interface Span {
  /** Inclusive start offset. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export class LineIndex {
  /** Offset of the first character of each line. */
  readonly lineStarts: number[];

  constructor(readonly text: string) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 10) starts.push(i + 1);
      else if (ch === 13) {
        if (text.charCodeAt(i + 1) === 10) i++;
        starts.push(i + 1);
      }
    }
    this.lineStarts = starts;
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  positionAt(offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] ?? 0) <= clamped) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: clamped - (this.lineStarts[lo] ?? 0) };
  }

  offsetAt(position: Position): number {
    if (position.line >= this.lineStarts.length) return this.text.length;
    if (position.line < 0) return 0;
    const start = this.lineStarts[position.line] ?? 0;
    return Math.min(start + Math.max(position.character, 0), this.lineEnd(position.line));
  }

  /** Offset of the end of the line's content (before the line break). */
  lineEnd(line: number): number {
    const start = this.lineStarts[line] ?? this.text.length;
    const next = this.lineStarts[line + 1];
    if (next === undefined) return this.text.length;
    let end = next;
    if (this.text.charCodeAt(end - 1) === 10) end--;
    if (this.text.charCodeAt(end - 1) === 13) end--;
    return Math.max(end, start);
  }

  lineText(line: number): string {
    return this.text.slice(this.lineStarts[line] ?? this.text.length, this.lineEnd(line));
  }

  rangeOf(span: Span): Range {
    return { start: this.positionAt(span.start), end: this.positionAt(span.end) };
  }

  spanOf(range: Range): Span {
    return { start: this.offsetAt(range.start), end: this.offsetAt(range.end) };
  }
}
