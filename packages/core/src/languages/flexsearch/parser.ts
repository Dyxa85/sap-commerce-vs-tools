import { LineIndex, type Span } from '../shared/line-index.js';
import type { Problem } from '../shared/problem.js';
import { JOIN_WORDS, KEYWORDS } from './knowledge.js';
import type { FlexDocument, ParamUse, Scope, Token, TypeRef } from './model.js';

const FIELD_RE =
  /^\s*(?:([A-Za-z_$][\w$]*)\s*[:.]\s*)?([A-Za-z_$][\w$]*)\s*(?:\[\s*([^\]]*?)\s*\])?((?:\s*:\s*[A-Za-z]+)*)\s*$/;

export function parseFlexSearch(text: string): FlexDocument {
  const lines = new LineIndex(text);
  const problems: Problem[] = [];
  const tokens = lex(text, problems);
  const root: Scope = {
    id: 0,
    kind: 'root',
    span: { start: 0, end: text.length },
    typeRefs: [],
    hasFrom: false,
  };
  const doc: FlexDocument = {
    text,
    lines,
    tokens,
    scopes: [root],
    typeRefs: [],
    fieldRefs: [],
    params: [],
    fromBlocks: [],
    subselects: [],
    problems,
  };
  new Builder(doc, root).run();
  return doc;
}

// ------------------------------------------------------------------ lexer

function lex(text: string, problems: Problem[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;
  const push = (kind: Token['kind'], start: number, end: number): void => {
    tokens.push({ kind, text: text.slice(start, end), span: { start, end } });
  };

  while (i < n) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      if (close === -1) {
        problems.push({
          span: { start: i, end: i + 2 },
          severity: 'error',
          code: 'flexsearch.syntax.unterminated-comment',
          message: 'Unterminated comment: "*/" is missing.',
        });
      }
      push('comment', i, end);
      i = end;
    } else if (ch === '-' && text[i + 1] === '-') {
      let end = i;
      while (end < n && text[end] !== '\n' && text[end] !== '\r') end++;
      problems.push({
        span: { start: i, end },
        severity: 'warning',
        code: 'flexsearch.comment.line',
        message:
          'A "--" comment swallows the conditions FlexibleSearch appends to the query (the hAC fails with "parameter index out of range"). Use /* … */.',
      });
      push('line-comment', i, end);
      i = end;
    } else if (ch === "'" || ch === '"') {
      let end = i + 1;
      let closed = false;
      while (end < n && text[end] !== '\n' && text[end] !== '\r') {
        if (text[end] === ch) {
          if (text[end + 1] === ch) {
            end += 2;
            continue;
          }
          end++;
          closed = true;
          break;
        }
        end++;
      }
      if (!closed) {
        problems.push({
          span: { start: i, end: i + 1 },
          severity: 'error',
          code: 'flexsearch.syntax.unterminated-string',
          message: `Unterminated string: closing ${ch} is missing (the hAC reports "malformed string").`,
        });
      }
      push('string', i, end);
      i = end;
    } else if (ch === '?') {
      let end = i + 1;
      while (end < n && /[\w$]/.test(text[end] as string)) end++;
      push('param', i, end);
      i = end;
    } else if (/\d/.test(ch)) {
      let end = i + 1;
      while (end < n && /[\d.]/.test(text[end] as string)) end++;
      push('number', i, end);
      i = end;
    } else if (/[A-Za-z_$]/.test(ch)) {
      let end = i + 1;
      while (end < n && /[\w$]/.test(text[end] as string)) end++;
      push(KEYWORDS.has(text.slice(i, end).toUpperCase()) ? 'keyword' : 'ident', i, end);
      i = end;
    } else if (ch === '{') {
      push('lbrace', i, i + 1);
      i++;
    } else if (ch === '}') {
      push('rbrace', i, i + 1);
      i++;
    } else {
      push('punct', i, i + 1);
      i++;
    }
  }
  return tokens;
}

// ------------------------------------------------------------------ structure

class Builder {
  private i = 0;
  private scopeId = 0;
  private scope: Scope;
  private readonly subselectStarts: number[] = [];

  constructor(
    private readonly doc: FlexDocument,
    root: Scope,
  ) {
    this.scope = root;
  }

  private get tokens(): Token[] {
    return this.doc.tokens;
  }

  private upper(t: Token | undefined): string {
    return t?.kind === 'keyword' ? t.text.toUpperCase() : '';
  }

  private adjacent(a: Token | undefined, b: Token | undefined): boolean {
    return !!a && !!b && a.span.end === b.span.start;
  }

  run(): void {
    const tokens = this.tokens;
    let afterFrom = false;
    while (this.i < tokens.length) {
      const t = tokens[this.i] as Token;
      const next = tokens[this.i + 1];

      if (t.kind === 'lbrace' && next?.kind === 'lbrace' && this.adjacent(t, next)) {
        this.openSubselect(t);
        this.i += 2;
        afterFrom = false;
        continue;
      }
      if (t.kind === 'rbrace') {
        if (this.subselectStarts.length > 0 && next?.kind === 'rbrace' && this.adjacent(t, next)) {
          this.closeSubselect(next);
          this.i += 2;
        } else {
          this.problem(
            t.span,
            'flexsearch.syntax.unexpected-brace',
            "Unexpected '}' without a matching '{'.",
          );
          this.i++;
        }
        afterFrom = false;
        continue;
      }
      if (t.kind === 'lbrace') {
        if (afterFrom) this.fromBlock();
        else this.fieldRef();
        afterFrom = false;
        continue;
      }

      const word = this.upper(t);
      if (word === 'SELECT') this.scope.selectSpan ??= t.span;
      if (word === 'FROM') {
        this.scope.hasFrom = true;
        afterFrom = true;
        this.i++;
        continue;
      }
      if (
        t.kind === 'punct' &&
        t.text === ',' &&
        afterFrom === false &&
        this.lastWasFromBlock &&
        next?.kind === 'lbrace'
      ) {
        afterFrom = true;
        this.i++;
        continue;
      }
      if (word === 'LIMIT') {
        this.problem(
          t.span,
          'flexsearch.limit.unsupported',
          'LIMIT is not supported: FlexibleSearch appends its own conditions, so the hAC fails with "unexpected token: WHERE". Use the max-count setting instead.',
          'warning',
        );
      }
      if (t.kind === 'param')
        this.doc.params.push({ name: t.text.slice(1), span: t.span } satisfies ParamUse);
      this.lastWasFromBlock = false;
      afterFrom = false;
      this.i++;
    }

    for (const start of this.subselectStarts) {
      this.problem(
        { start, end: start + 2 },
        'flexsearch.syntax.missing-brace',
        "Missing '}}' for this '{{'.",
      );
    }
  }

  private lastWasFromBlock = false;

  private problem(
    span: Span,
    code: string,
    message: string,
    severity: Problem['severity'] = 'error',
    data?: Problem['data'],
  ): void {
    this.doc.problems.push({ span, severity, code, message, data });
  }

  private openSubselect(open: Token): void {
    const scope: Scope = {
      id: ++this.scopeId,
      kind: 'subselect',
      parent: this.scope,
      span: { start: open.span.start, end: this.doc.text.length },
      typeRefs: [],
      hasFrom: false,
    };
    this.doc.scopes.push(scope);
    this.scope = scope;
    this.subselectStarts.push(open.span.start);
  }

  private closeSubselect(second: Token): void {
    const start = this.subselectStarts.pop() as number;
    this.scope.span = { start, end: second.span.end };
    this.doc.subselects.push(this.scope.span);
    this.scope = this.scope.parent as Scope;
  }

  /** Index of the `}` matching the `{` at `open`, or -1. Stops at a subselect boundary. */
  private matchingBrace(open: number): number {
    let depth = 0;
    for (let j = open; j < this.tokens.length; j++) {
      const t = this.tokens[j] as Token;
      if (t.kind === 'lbrace') depth++;
      else if (t.kind === 'rbrace' && --depth === 0) return j;
    }
    return -1;
  }

  private fieldRef(): void {
    const open = this.tokens[this.i] as Token;
    const closeIdx = this.matchingBrace(this.i);
    if (closeIdx === -1) {
      this.problem(open.span, 'flexsearch.syntax.missing-brace', "Missing '}' for this '{'.");
      this.i++;
      return;
    }
    const close = this.tokens[closeIdx] as Token;
    this.addField(open, close);
    this.i = closeIdx + 1;
    this.lastWasFromBlock = false;
  }

  private addField(open: Token, close: Token): void {
    const innerStart = open.span.end;
    const inner = this.doc.text.slice(innerStart, close.span.start);
    const m = FIELD_RE.exec(inner);
    const span = { start: open.span.start, end: close.span.end };
    if (!m) {
      this.doc.fieldRefs.push({
        span,
        attribute: inner.trim(),
        attributeSpan: { start: innerStart, end: close.span.start },
        suffixes: [],
        scope: this.scope,
        valid: false,
      });
      return;
    }
    const [, alias, attribute = '', lang, suffix = ''] = m;
    const aliasStart = alias ? innerStart + inner.indexOf(alias) : undefined;
    const attrStart =
      innerStart + inner.indexOf(attribute, alias ? inner.indexOf(alias) + alias.length : 0);
    this.doc.fieldRefs.push({
      span,
      alias,
      aliasSpan:
        alias && aliasStart !== undefined
          ? { start: aliasStart, end: aliasStart + alias.length }
          : undefined,
      attribute,
      attributeSpan: { start: attrStart, end: attrStart + attribute.length },
      lang: lang || undefined,
      suffixes: suffix
        .split(':')
        .map((s) => s.trim())
        .filter(Boolean),
      scope: this.scope,
      valid: true,
    });
  }

  /** `{Type [!] [AS alias] [JOIN Type AS alias ON {a:x} = {b:y}]*}` */
  private fromBlock(): void {
    const tokens = this.tokens;
    const openIdx = this.i;
    const open = tokens[openIdx] as Token;
    const closeIdx = this.matchingBrace(openIdx);
    if (closeIdx === -1) {
      this.problem(open.span, 'flexsearch.syntax.missing-brace', "Missing '}' for this '{'.");
      this.i++;
      return;
    }
    const close = tokens[closeIdx] as Token;
    this.doc.fromBlocks.push({ start: open.span.start, end: close.span.end });

    let j = openIdx + 1;
    let expectType = true;
    while (j < closeIdx) {
      const t = tokens[j] as Token;
      const word = this.upper(t);
      if (t.kind === 'lbrace') {
        const inner = this.matchingBrace(j);
        if (inner === -1 || inner > closeIdx) break;
        this.addField(t, tokens[inner] as Token);
        j = inner + 1;
        continue;
      }
      if (word === 'ON') {
        expectType = false;
        j++;
        continue;
      }
      if (JOIN_WORDS.has(word)) {
        if (word === 'JOIN') expectType = true;
        j++;
        continue;
      }
      if (t.kind === 'punct' && t.text === ',') {
        expectType = true;
        j++;
        continue;
      }
      if (t.kind === 'ident' && expectType) {
        j = this.typeRef(j, closeIdx);
        expectType = false;
        continue;
      }
      if (t.kind === 'param') this.doc.params.push({ name: t.text.slice(1), span: t.span });
      j++;
    }
    this.i = closeIdx + 1;
    this.lastWasFromBlock = true;
  }

  private typeRef(at: number, limit: number): number {
    const tokens = this.tokens;
    const typeToken = tokens[at] as Token;
    let j = at + 1;
    let exclude = false;
    if (
      tokens[j]?.kind === 'punct' &&
      tokens[j]?.text === '!' &&
      this.adjacent(typeToken, tokens[j])
    ) {
      exclude = true;
      j++;
    }
    let alias: Token | undefined;
    if (this.upper(tokens[j]) === 'AS' && tokens[j + 1]?.kind === 'ident' && j + 1 < limit) {
      alias = tokens[j + 1];
      j += 2;
    } else if (tokens[j]?.kind === 'ident' && j < limit) {
      const bare = tokens[j] as Token;
      alias = bare;
      this.problem(
        bare.span,
        'flexsearch.from.alias-without-as',
        `Write "${typeToken.text} AS ${bare.text}": FlexibleSearch needs AS for aliases (the hAC reports "no composed type with code ${typeToken.text} ${bare.text} found").`,
        'error',
        { typeEnd: typeToken.span.end, aliasStart: bare.span.start },
      );
      j++;
    }
    const ref: TypeRef = {
      typeName: typeToken.text,
      typeSpan: typeToken.span,
      alias: alias?.text,
      aliasSpan: alias?.span,
      excludeSubtypes: exclude,
      scope: this.scope,
    };
    this.scope.typeRefs.push(ref);
    this.doc.typeRefs.push(ref);
    return j;
  }
}
