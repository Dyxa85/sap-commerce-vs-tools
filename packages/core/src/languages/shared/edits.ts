import type { Span } from './line-index.js';

export interface TextEdit {
  span: Span;
  newText: string;
}

/** Applies non-overlapping edits to text. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.span.start - a.span.start)) {
    out = out.slice(0, edit.span.start) + edit.newText + out.slice(edit.span.end);
  }
  return out;
}

export interface Fix {
  title: string;
  edits: TextEdit[];
  preferred?: boolean;
}
