import { TextDocument } from 'vscode-languageserver-textdocument';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, FLEX_SOURCE, FlexSearchLanguageService } from '../src/index.js';

const service = new FlexSearchLanguageService();
let version = 1000;
const doc = (text: string) =>
  TextDocument.create('file:///q.fxs', 'flexibleSearch', ++version, text);

describe('FlexSearchLanguageService', () => {
  it('publishes diagnostics with code and source', () => {
    const d = service.diagnostics(doc('SELECT {x:pk} FROM {Language AS l}'), DEFAULT_SETTINGS);
    expect(d.find((x) => x.code === 'flexsearch.alias.unknown')).toMatchObject({
      source: FLEX_SOURCE,
      severity: 1,
    });
  });

  it('honours severity overrides', () => {
    const d = service.diagnostics(doc('SELECT {pk} FROM {A};'), {
      severities: { 'flexsearch.trailing-semicolon': 'off' },
      format: {},
    });
    expect(d.map((x) => x.code)).not.toContain('flexsearch.trailing-semicolon');
  });

  it('completes, hovers and navigates aliases', () => {
    const d = doc('SELECT {l:isocode} FROM {Language AS l}');
    expect(service.completion(doc('SEL'), 0, 3).some((i) => i.label === 'SELECT')).toBe(true);
    expect(service.hover(d, 0, 9)?.contents).toMatchObject({
      value: expect.stringContaining('alias of `Language`'),
    });
    expect(service.definition(d, 0, 9)?.range.start.character).toBe(37);
    expect(service.references(d, 0, 9)).toHaveLength(2);
    const edit = service.rename(d, 0, 9, 'lang');
    expect(TextDocument.applyEdits(d, edit!.changes![d.uri]!)).toBe(
      'SELECT {lang:isocode} FROM {Language AS lang}',
    );
    expect(service.rename(d, 0, 9, 'bad name')).toBeNull();
  });

  it('formats the whole document and refuses broken text', () => {
    const d = doc("select {pk} from {A} where {x}='1' and {y}=2");
    expect(TextDocument.applyEdits(d, service.format(d, DEFAULT_SETTINGS))).toBe(
      "SELECT {pk}\nFROM {A}\nWHERE {x} = '1'\n  AND {y} = 2",
    );
    expect(service.format(doc("select {pk} from {A} where {x}='oops"), DEFAULT_SETTINGS)).toEqual(
      [],
    );
  });

  it('turns diagnostics into quick fixes', () => {
    const d = doc('SELECT {pk} FROM {Language};');
    const diagnostics = service.diagnostics(d, DEFAULT_SETTINGS);
    const actions = service.codeActions(d, diagnostics[0]!.range, diagnostics, DEFAULT_SETTINGS);
    const fix = actions.find((a) => a.title.startsWith('Remove trailing'));
    expect(TextDocument.applyEdits(d, fix!.edit!.changes![d.uri]!)).toBe(
      'SELECT {pk} FROM {Language}',
    );
  });

  it('provides symbols, folding and semantic tokens', () => {
    const d = doc(
      'SELECT {a:pk}\nFROM {A AS a}\nWHERE {a:x} IN ({{\n SELECT {b:pk}\n FROM {B AS b}\n}})',
    );
    expect(service.symbols(d)[0]?.name).toBe('SELECT');
    expect(service.folding(d).length).toBeGreaterThan(0);
    expect(service.semanticTokens(d).data.length % 5).toBe(0);
  });
});
