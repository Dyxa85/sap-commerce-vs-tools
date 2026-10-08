import type { Span } from './line-index.js';

export type CompletionKind =
  'keyword' | 'snippet' | 'macro' | 'type' | 'property' | 'modifier' | 'value' | 'enumMember';

export interface CompletionEntry {
  label: string;
  kind: CompletionKind;
  detail?: string;
  documentation?: string;
  /** Text to insert; defaults to the label. LSP snippet syntax when `snippet` is true. */
  insertText?: string;
  snippet?: boolean;
  /** Range replaced by the completion (the already typed prefix). */
  replace: Span;
  sortText?: string;
}
