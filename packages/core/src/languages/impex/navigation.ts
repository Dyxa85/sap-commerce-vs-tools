import type { Span } from '../shared/line-index.js';
import { resolveMacroName, isBuiltinMacro, expandMacros } from './macros.js';
import type { Cell, Column, Header, ImpexDocument, MacroDef, Modifier } from './model.js';

export interface MacroRef {
  /** Name as written at the cursor. */
  name: string;
  span: Span;
  def?: MacroDef;
  /** Length of the macro name that really matched (a use like `$a-b` may refer to `a`). */
  matchedLength: number;
  isDefinition: boolean;
}

/** Macro definition or use under the cursor. */
export function macroAt(doc: ImpexDocument, offset: number): MacroRef | undefined {
  for (const def of doc.macros) {
    const span = { start: def.nameSpan.start - 1, end: def.nameSpan.end };
    if (offset >= span.start && offset <= span.end) {
      return { name: def.name, span, def, matchedLength: def.name.length, isDefinition: true };
    }
  }
  for (const use of doc.macroUses) {
    if (offset >= use.span.start && offset <= use.span.end) {
      const hit = resolveMacroName(doc, use.name, use.span.start);
      return {
        name: use.name,
        span: use.span,
        def: hit?.def,
        matchedLength: hit?.length ?? use.name.length,
        isDefinition: false,
      };
    }
  }
  return undefined;
}

/** All spans referring to the same definition (uses and the definition's name). */
export function macroOccurrences(doc: ImpexDocument, def: MacroDef): Span[] {
  const spans: Span[] = [{ start: def.nameSpan.start - 1, end: def.nameSpan.end }];
  for (const use of doc.macroUses) {
    const hit = resolveMacroName(doc, use.name, use.span.start);
    if (hit?.def === def) {
      // `$` plus the matched part of the name
      spans.push({ start: use.span.start, end: use.span.start + 1 + hit.length });
    }
  }
  return spans;
}

export function macroValue(doc: ImpexDocument, ref: MacroRef): string | undefined {
  if (!ref.def) return isBuiltinMacro(ref.name) ? undefined : undefined;
  return expandMacros(doc, ref.def.value, ref.def.span.start);
}

export type Target =
  | { kind: 'mode'; header: Header }
  | { kind: 'type'; header: Header }
  | { kind: 'type-modifier'; header: Header; modifier: Modifier; onValue: boolean }
  | { kind: 'column'; header: Header; column: Column }
  | { kind: 'modifier'; header: Header; column: Column; modifier: Modifier; onValue: boolean }
  | { kind: 'cell'; header: Header | undefined; cell: Cell; column?: Column };

const within = (span: Span | undefined, offset: number): boolean =>
  !!span && offset >= span.start && offset <= span.end;

/** What is under the cursor (header parts, value cells with their column). */
export function targetAt(doc: ImpexDocument, offset: number): Target | undefined {
  for (const statement of doc.statements) {
    if (offset < statement.span.start || offset > statement.span.end) continue;
    if (statement.kind === 'header') {
      const header = statement;
      if (within(header.modeSpan, offset)) return { kind: 'mode', header };
      if (within(header.typeSpan, offset)) return { kind: 'type', header };
      for (const modifier of header.typeModifiers) {
        if (within(modifier.span, offset)) {
          return {
            kind: 'type-modifier',
            header,
            modifier,
            onValue: within(modifier.valueSpan, offset),
          };
        }
      }
      for (const column of header.columns) {
        if (!within(column.span, offset)) continue;
        for (const modifier of column.modifiers) {
          if (within(modifier.span, offset)) {
            return {
              kind: 'modifier',
              header,
              column,
              modifier,
              onValue: within(modifier.valueSpan, offset),
            };
          }
        }
        return { kind: 'column', header, column };
      }
    } else if (statement.kind === 'row') {
      const cell = statement.cells.find((c) => offset >= c.span.start && offset <= c.span.end);
      if (cell) {
        const column =
          cell.index > 0
            ? statement.header?.columns.find((c) => c.index === cell.index)
            : undefined;
        return { kind: 'cell', header: statement.header, cell, column };
      }
    }
  }
  return undefined;
}
