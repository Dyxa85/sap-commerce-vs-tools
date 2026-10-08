import type { Span } from '../shared/line-index.js';
import {
  toSemanticTokens,
  type RawToken,
  type SemanticToken,
  type TokenModifier,
  type TokenType,
} from '../shared/semantic.js';
import { isBuiltinMacro } from './macros.js';
import type { Cell, Column, Header, ImpexDocument, Modifier, RefNode } from './model.js';

const NUMBER_RE = /^[-+]?\d+(?:[.,]\d+)*$/;

export function semanticTokens(doc: ImpexDocument): SemanticToken[] {
  const raw: RawToken[] = [];
  const add = (span: Span, type: TokenType, priority = 1, modifiers?: TokenModifier[]): void => {
    if (span.end > span.start) raw.push({ span, type, modifiers, priority });
  };

  for (const statement of doc.statements) {
    switch (statement.kind) {
      case 'comment':
      case 'script':
      case 'userrights-start':
      case 'userrights-end':
        add(
          statement.span,
          statement.kind === 'userrights-start' || statement.kind === 'userrights-end'
            ? 'keyword'
            : 'comment',
        );
        break;
      case 'macro':
        add({ start: statement.nameSpan.start - 1, end: statement.nameSpan.end }, 'macro', 3, [
          'declaration',
        ]);
        break;
      case 'header':
        addHeader(statement, add);
        break;
      case 'row':
        for (const cell of statement.cells) addCell(cell, add);
        break;
    }
  }
  for (const use of doc.macroUses) {
    add(use.span, 'macro', isBuiltinMacro(use.name) ? 3 : 3);
  }

  return toSemanticTokens(doc.lines, raw);
}

function addHeader(
  header: Header,
  add: (s: Span, t: TokenType, p?: number, m?: TokenModifier[]) => void,
): void {
  add(header.modeSpan, 'keyword', 2);
  if (header.typeSpan) add(header.typeSpan, 'class', 2);
  addModifiers(header.typeModifiers, add);
  for (const column of header.columns) addColumn(column, add);
}

function addColumn(
  column: Column,
  add: (s: Span, t: TokenType, p?: number, m?: TokenModifier[]) => void,
): void {
  if (column.kind === 'macro' || column.kind === 'empty') {
    addModifiers(column.modifiers, add);
    return;
  }
  const isKey = column.modifiers.some(
    (m) => m.name.toLowerCase() === 'unique' && m.value?.toLowerCase() !== 'false',
  );
  const type: TokenType = column.kind === 'attribute' ? 'property' : 'variable';
  const nameSpan =
    column.kind === 'attribute'
      ? column.nameSpan
      : { start: column.nameSpan.start - 1, end: column.nameSpan.end };
  add(nameSpan, type, 2, isKey ? ['readonly'] : undefined);
  for (const ref of column.refs) addRef(ref, add);
  addModifiers(column.modifiers, add);
}

function addRef(
  ref: RefNode,
  add: (s: Span, t: TokenType, p?: number, m?: TokenModifier[]) => void,
): void {
  add({ start: ref.span.start, end: ref.span.start + ref.name.length }, 'parameter', 2);
  addModifiers(ref.modifiers, add);
  for (const child of ref.children) addRef(child, add);
}

function addModifiers(
  modifiers: readonly Modifier[],
  add: (s: Span, t: TokenType, p?: number, m?: TokenModifier[]) => void,
): void {
  for (const modifier of modifiers) {
    add(modifier.nameSpan, 'decorator', 2);
    if (
      modifier.valueSpan &&
      modifier.value !== undefined &&
      /^(true|false)$/i.test(modifier.value)
    ) {
      add(modifier.valueSpan, 'enumMember', 2);
    }
  }
}

function addCell(
  cell: Cell,
  add: (s: Span, t: TokenType, p?: number, m?: TokenModifier[]) => void,
): void {
  if (cell.value === '') return;
  if (cell.quoted) add(cell.valueSpan, 'string', 1);
  else if (cell.value === '<ignore>' || cell.value === '<empty>')
    add(cell.valueSpan, 'enumMember', 1);
  else if (NUMBER_RE.test(cell.value)) add(cell.valueSpan, 'number', 1);
}
