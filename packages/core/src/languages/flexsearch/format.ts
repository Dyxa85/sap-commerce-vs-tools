import { CLAUSE_STARTS } from './knowledge.js';
import type { FlexDocument, Token } from './model.js';

export interface FlexFormatOptions {
  /** Write keywords in upper case. Default true. */
  uppercaseKeywords?: boolean;
  /** Put AND / OR on their own, indented line. Default true. */
  breakLogicalOperators?: boolean;
  /** Indentation unit. Default two spaces. */
  indent?: string;
}

const OPERATOR_CHARS = new Set(['<', '>', '=', '!', '|']);

/**
 * Re-flows a query: one clause per line, AND/OR indented, normalised spacing. Content of strings and comments is
 * kept. Returns undefined when the text has syntax errors that make re-flowing unsafe.
 */
export function formatFlexSearch(
  doc: FlexDocument,
  options: FlexFormatOptions = {},
): string | undefined {
  if (doc.problems.some((p) => p.severity === 'error')) return undefined;
  const upper = options.uppercaseKeywords ?? true;
  const breakLogical = options.breakLogicalOperators ?? true;
  const indent = options.indent ?? '  ';

  const atoms = toAtoms(doc.tokens);
  const out: string[] = [];
  let line = '';
  let level = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  const parenStack: number[] = [];
  let inWhere = false;
  let betweenPending = false;
  let prev: Atom | undefined;
  let blankBefore = false;

  const flush = (): void => {
    if (line.trim() !== '') out.push(line.replace(/\s+$/, ''));
    line = '';
  };
  const startLine = (indentLevel: number): void => {
    flush();
    if (blankBefore) {
      out.push('');
      blankBefore = false;
    }
    line = indent.repeat(Math.max(indentLevel, 0));
  };

  for (const [i, atom] of atoms.entries()) {
    const word = atom.kind === 'keyword' ? atom.text.toUpperCase() : '';
    const text = atom.kind === 'keyword' && upper ? word : atom.text;

    if (atom.kind === 'sub-open') {
      if (prev && needsSpace(prev, atom, braceDepth)) line += ' ';
      line += '{{';
      level++;
      braceDepth = 0;
      parenStack.push(parenDepth);
      parenDepth = 0;
      startLine(level);
      prev = atom;
      continue;
    }
    if (atom.kind === 'sub-close') {
      level--;
      parenDepth = parenStack.pop() ?? 0;
      startLine(level);
      line += '}}';
      prev = atom;
      inWhere = false;
      continue;
    }

    const first = line.trim() === '';
    if (prev?.text === ';' && braceDepth === 0) {
      blankBefore = true;
      startLine(0);
      inWhere = false;
    } else if (braceDepth === 0 && parenDepth === 0 && !first) {
      if (
        CLAUSE_STARTS.has(word) ||
        ((word === 'GROUP' || word === 'ORDER') && atoms[i + 1]?.text.toUpperCase() === 'BY')
      ) {
        startLine(level);
      } else if (breakLogical && inWhere && (word === 'AND' || word === 'OR') && !betweenPending) {
        startLine(level + 1);
      }
    }
    if (word === 'WHERE' || word === 'HAVING') inWhere = true;
    if (word === 'FROM' || word === 'GROUP' || word === 'ORDER') inWhere = false;
    if (word === 'BETWEEN') betweenPending = true;
    if (word === 'AND' && betweenPending) betweenPending = false;

    if (atom.kind === 'punct') {
      if (atom.text === '{') braceDepth++;
      else if (atom.text === '}') braceDepth = Math.max(0, braceDepth - 1);
      else if (atom.text === '(') parenDepth++;
      else if (atom.text === ')') parenDepth = Math.max(0, parenDepth - 1);
    }

    const stillFirst = line.trim() === '';
    if (!stillFirst && prev && needsSpace(prev, atom, braceDepth, atoms[i - 2])) line += ' ';
    line += text;
    if (atom.kind === 'line-comment') startLine(level);
    prev = atom;
  }
  flush();
  return out.join('\n') + (doc.text.endsWith('\n') ? '\n' : '');
}

// ------------------------------------------------------------------ atoms

interface Atom {
  kind: Token['kind'] | 'sub-open' | 'sub-close' | 'op';
  text: string;
  /** For `{`/`}`: which side. */
}

function toAtoms(tokens: readonly Token[]): Atom[] {
  const atoms: Atom[] = [];
  let subDepth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    const next = tokens[i + 1];
    if (t.kind === 'lbrace' && next?.kind === 'lbrace' && next.span.start === t.span.end) {
      atoms.push({ kind: 'sub-open', text: '{{' });
      subDepth++;
      i++;
    } else if (
      t.kind === 'rbrace' &&
      next?.kind === 'rbrace' &&
      next.span.start === t.span.end &&
      subDepth > 0
    ) {
      // `}}` closes a subselect only when no single brace is still open inside it
      atoms.push({ kind: 'sub-close', text: '}}' });
      subDepth--;
      i++;
    } else if (t.kind === 'lbrace') {
      atoms.push({ kind: 'punct', text: '{' });
    } else if (t.kind === 'rbrace') {
      atoms.push({ kind: 'punct', text: '}' });
    } else if (t.kind === 'punct' && OPERATOR_CHARS.has(t.text)) {
      let op = t.text;
      while (
        tokens[i + 1]?.kind === 'punct' &&
        OPERATOR_CHARS.has(tokens[i + 1]?.text ?? '') &&
        (tokens[i + 1] as Token).span.start === (tokens[i] as Token).span.end
      ) {
        i++;
        op += (tokens[i] as Token).text;
      }
      atoms.push({ kind: 'op', text: op });
    } else {
      atoms.push({ kind: t.kind, text: t.text });
    }
  }
  return atoms;
}

const GLUE_INSIDE_BRACES = new Set([':', '.', '!', '[', ']']);

function isOperand(a: Atom | undefined): boolean {
  return (
    !!a &&
    (['ident', 'number', 'string', 'param'].includes(a.kind) ||
      a.text === ')' ||
      a.text === '}' ||
      a.text === ']')
  );
}

function needsSpace(prev: Atom, next: Atom, braceDepth: number, beforePrev?: Atom): boolean {
  const p = prev.text;
  const n = next.text;
  if (p === '{' || n === '}') return false;
  if (braceDepth > 0 && (GLUE_INSIDE_BRACES.has(p) || GLUE_INSIDE_BRACES.has(n))) return false;
  if (p === '(' || p === '.' || n === '.') return false;
  if (n === ')' || n === ',' || n === ';') return false;
  if (n === '(') return !(prev.kind === 'ident' || p === 'COUNT');
  if ((p === '-' || p === '+') && next.kind === 'number' && !isOperand(beforePrev)) return false;
  if (p === '!' && braceDepth === 0) return true;
  return true;
}
