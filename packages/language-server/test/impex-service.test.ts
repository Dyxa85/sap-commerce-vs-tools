import { TextDocument } from 'vscode-languageserver-textdocument';
import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import { DEFAULT_SETTINGS, ImpexLanguageService, SOURCE } from '../src/index.js';

const service = new ImpexLanguageService();
let version = 0;
const doc = (text: string) => TextDocument.create('file:///t.impex', 'impex', ++version, text);

describe('ImpexLanguageService', () => {
  it('publishes diagnostics with severity, code and source', () => {
    const d = service.diagnostics(doc('INSERTUPDATE A;x[unique=true]\n;1'), DEFAULT_SETTINGS);
    const unknown = d.find((x) => x.code === 'impex.header.unknown-mode');
    expect(unknown).toMatchObject({ severity: DiagnosticSeverity.Error, source: SOURCE });
    expect(unknown?.range.start).toEqual({ line: 0, character: 0 });
  });

  it('applies severity overrides from the settings', () => {
    const text = 'UPDATE A;x[unique=true]\n;$nope';
    const off = service.diagnostics(doc(text), {
      severities: { 'impex.macro.undefined': 'off' },
      format: {},
    });
    expect(off.map((x) => x.code)).not.toContain('impex.macro.undefined');
  });

  it('marks unused macros as unnecessary', () => {
    const d = service.diagnostics(doc('$a=1\nUPDATE A;x[unique=true]\n;1'), DEFAULT_SETTINGS);
    expect(d.find((x) => x.code === 'impex.macro.unused')?.tags).toEqual([1]);
  });

  it('caches parses per document version', () => {
    const d = doc('UPDATE A;x[unique=true]');
    expect(service.parse(d)).toBe(service.parse(d));
    const next = TextDocument.create(d.uri, 'impex', 100_000, 'UPDATE B;x[unique=true]');
    expect(service.parse(next)).not.toBe(service.parse(d));
    expect(service.parse(next).headers[0]?.typeName).toBe('B');
  });

  it('returns completion items with text edits and snippet format', () => {
    const items = service.completion(doc('INS'), 0, 3);
    const item = items.find((i) => i.label === 'INSERT_UPDATE');
    expect(item?.insertTextFormat).toBe(2);
    expect(item?.textEdit).toMatchObject({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    });
  });

  it('hovers, navigates and renames macros', () => {
    const d = doc('$cat=base\nUPDATE A;x[unique=true]\n;$cat\n;$cat');
    expect(service.hover(d, 2, 3)?.contents).toMatchObject({
      value: expect.stringContaining('base'),
    });
    expect(service.definition(d, 2, 2)?.range.start).toEqual({ line: 0, character: 0 });
    expect(service.references(d, 0, 2)).toHaveLength(3);
    const edit = service.rename(d, 2, 3, 'catalog');
    expect(edit?.changes?.[d.uri]).toHaveLength(3);
    expect(TextDocument.applyEdits(d, edit!.changes![d.uri]!)).toBe(
      '$catalog=base\nUPDATE A;x[unique=true]\n;$catalog\n;$catalog',
    );
    expect(service.rename(d, 2, 3, 'bad name!')).toBeNull();
    expect(service.prepareRename(d, 2, 3)?.placeholder).toBe('cat');
  });

  it('provides symbols, folding and semantic tokens', () => {
    const d = doc('# a\n# b\nUPDATE A;x[unique=true]\n;1\n;2');
    expect(service.symbols(d).map((s) => s.name)).toEqual(['UPDATE A']);
    expect(service.folding(d).map((f) => [f.startLine, f.endLine])).toEqual(
      expect.arrayContaining([
        [0, 1],
        [2, 4],
      ]),
    );
    expect(service.semanticTokens(d).data.length % 5).toBe(0);
  });

  it('formats documents and ranges', () => {
    const d = doc('UPDATE A;x[unique=true];yy\n;1;2\n;333;4\n');
    const edits = service.format(d, DEFAULT_SETTINGS);
    expect(TextDocument.applyEdits(d, edits)).toContain(
      `;${'333'.padEnd('x[unique=true]'.length)};4`,
    );
    expect(
      service.format(d, DEFAULT_SETTINGS, {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 3 },
      }).length,
    ).toBeGreaterThan(0);
  });

  it('turns diagnostics into quick fixes', () => {
    const d = doc('INSERTUPDATE A;x[unique=true]\n;1');
    const diagnostics = service.diagnostics(d, DEFAULT_SETTINGS);
    const actions = service.codeActions(d, diagnostics[0]!.range, diagnostics, DEFAULT_SETTINGS);
    const fix = actions.find((a) => a.title === 'Change to INSERT_UPDATE');
    expect(fix?.isPreferred).toBe(true);
    expect(TextDocument.applyEdits(d, fix!.edit!.changes![d.uri]!)).toBe(
      'INSERT_UPDATE A;x[unique=true]\n;1',
    );
  });

  it('ignores diagnostics from other sources in code actions', () => {
    const d = doc('UPDATE A;x[unique=true]');
    expect(
      service.codeActions(
        d,
        { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        [
          {
            message: 'x',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            source: 'other',
            code: 'impex.macro.undefined',
          },
        ],
        DEFAULT_SETTINGS,
      ),
    ).toEqual([]);
  });
});
