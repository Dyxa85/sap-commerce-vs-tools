import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { INITIAL, Registry, parseRawGrammar, type IGrammar } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';

const require = createRequire(join(__dirname, 'grammar.test.ts'));
let grammar: IGrammar;

beforeAll(async () => {
  const wasm = readFileSync(join(require.resolve('vscode-oniguruma'), '..', 'onig.wasm'));
  await loadWASM(
    wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer,
  );
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new OnigScanner(patterns),
      createOnigString: (s) => new OnigString(s),
    }),
    loadGrammar: async () =>
      parseRawGrammar(
        readFileSync(join(__dirname, '..', 'syntaxes', 'impex.tmLanguage.json'), 'utf8'),
        'impex.tmLanguage.json',
      ),
  });
  grammar = (await registry.loadGrammar('source.impex'))!;
});

/** [text, most specific scope] pairs of one line (non-whitespace tokens only). */
function scopes(lines: string[]): [string, string][][] {
  let state = INITIAL;
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    return result.tokens
      .map((t): [string, string] => [
        line.slice(t.startIndex, t.endIndex),
        t.scopes[t.scopes.length - 1] ?? '',
      ])
      .filter(([text]) => text.trim() !== '');
  });
}

const has = (tokens: [string, string][], text: string, scope: string): boolean =>
  tokens.some(([t, s]) => t === text && s === scope);

describe('ImpEx TextMate grammar', () => {
  it('highlights comments and script lines', () => {
    const [comment, script] = scopes(['# a comment', '#% impex.info("x");']);
    expect(comment?.[0]?.[1]).toBe('comment.line.number-sign.impex');
    expect(script?.[0]?.[1]).toBe('meta.preprocessor.script.impex');
  });

  it('highlights macro definitions and uses', () => {
    const [def, row] = scopes(['$cat = base:$other', ';$cat;x']);
    expect(has(def!, '$cat', 'variable.other.macro.definition.impex')).toBe(true);
    expect(has(def!, '=', 'keyword.operator.assignment.impex')).toBe(true);
    expect(has(def!, '$other', 'variable.other.macro.impex')).toBe(true);
    expect(has(row!, '$cat', 'variable.other.macro.impex')).toBe(true);
  });

  it('highlights headers: mode, type, attributes, modifiers and references', () => {
    const [h] = scopes([
      'INSERT_UPDATE Product;code[unique=true,lang=en];catalogVersion(catalog(id),version);@alias;&docId',
    ]);
    expect(has(h!, 'INSERT_UPDATE', 'keyword.control.mode.impex')).toBe(true);
    expect(has(h!, 'Product', 'entity.name.type.item.impex')).toBe(true);
    expect(has(h!, 'code', 'variable.other.property.attribute.impex')).toBe(true);
    expect(has(h!, 'unique', 'entity.other.attribute-name.modifier.impex')).toBe(true);
    expect(has(h!, 'true', 'constant.language.boolean.impex')).toBe(true);
    expect(has(h!, 'catalog', 'variable.parameter.reference.impex')).toBe(true);
    expect(has(h!, '@alias', 'variable.parameter.special-column.impex')).toBe(true);
  });

  it('is case-insensitive for modes', () => {
    const [h] = scopes(['insert_update Language;isocode[unique=true]']);
    expect(has(h!, 'insert_update', 'keyword.control.mode.impex')).toBe(true);
  });

  it('highlights value rows: separators, numbers, special values and strings', () => {
    const [row] = scopes([';p1;12;<ignore>;"text ""q"" here"']);
    expect(row!.filter(([, s]) => s === 'punctuation.separator.cell.impex')).toHaveLength(4);
    expect(has(row!, '12', 'constant.numeric.impex')).toBe(true);
    expect(has(row!, '<ignore>', 'constant.language.special.impex')).toBe(true);
    expect(row!.some(([, s]) => s === 'string.quoted.double.impex')).toBe(true);
    expect(has(row!, '""', 'constant.character.escape.quote.impex')).toBe(true);
  });

  it('keeps multi-line strings together and recovers afterwards', () => {
    const lines = scopes([
      ';1;"first',
      '# not a comment inside the value',
      'last";2',
      '# real comment',
    ]);
    expect(lines[1]?.[0]?.[1]).toBe('string.quoted.double.impex');
    expect(lines[3]?.[0]?.[1]).toBe('comment.line.number-sign.impex');
  });

  it('does not treat a word starting like a mode as a header', () => {
    const [row] = scopes(['UPDATED value']);
    expect(row!.some(([, s]) => s === 'keyword.control.mode.impex')).toBe(false);
  });
});

describe('FlexibleSearch TextMate grammar', () => {
  let flex: IGrammar;
  beforeAll(async () => {
    const registry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns) => new OnigScanner(patterns),
        createOnigString: (str) => new OnigString(str),
      }),
      loadGrammar: async () =>
        parseRawGrammar(
          readFileSync(join(__dirname, '..', 'syntaxes', 'flexsearch.tmLanguage.json'), 'utf8'),
          'flexsearch.tmLanguage.json',
        ),
    });
    flex = (await registry.loadGrammar('source.flexsearch'))!;
  });

  function tokens(line: string): [string, string][] {
    return flex
      .tokenizeLine(line, INITIAL)
      .tokens.map((t): [string, string] => [
        line.slice(t.startIndex, t.endIndex),
        t.scopes[t.scopes.length - 1] ?? '',
      ])
      .filter(([text]) => text.trim() !== '');
  }

  it('highlights keywords, types, aliases, attributes and parameters', () => {
    const t = tokens(
      "SELECT {p:code[en]:o} FROM {Product AS p JOIN Title AS t ON {p:x} = {t:pk}} WHERE {p:code} = ?code AND {p:n} LIKE 'a''b'",
    );
    const has = (text: string, scope: string) => t.some(([x, s]) => x === text && s === scope);
    expect(has('SELECT', 'keyword.control.flexsearch')).toBe(true);
    expect(has('p', 'variable.other.alias.flexsearch')).toBe(true);
    expect(has('code', 'variable.other.property.attribute.flexsearch')).toBe(true);
    expect(has('[en]', 'constant.language.locale.flexsearch')).toBe(true);
    expect(has('Product', 'entity.name.type.item.flexsearch')).toBe(true);
    expect(has('AS', 'keyword.control.join.flexsearch')).toBe(true);
    expect(has('?code', 'variable.parameter.query.flexsearch')).toBe(true);
    expect(has("'a''b'", 'string.quoted.single.flexsearch')).toBe(true);
  });

  it('highlights comments, numbers, functions and operators', () => {
    const t = tokens('SELECT COUNT(*) /* c */ FROM {A} WHERE {x} >= 10 -- tail');
    const scopes = t.map(([, s]) => s);
    expect(scopes).toContain('support.function.flexsearch');
    expect(scopes).toContain('comment.block.flexsearch');
    expect(scopes).toContain('constant.numeric.flexsearch');
    expect(scopes).toContain('keyword.operator.flexsearch');
    expect(scopes).toContain('comment.line.double-dash.flexsearch');
  });
});
