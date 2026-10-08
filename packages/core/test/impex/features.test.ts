import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  analyze,
  buildTypeSystem,
  parseItemsXml,
  TypeSystem,
  loadPlatform,
  applyEdits,
  complete,
  encodeSemanticTokens,
  fixesFor,
  folding,
  formatImpex,
  hover,
  macroAt,
  macroOccurrences,
  outline,
  parseImpex,
  semanticTokens,
  TOKEN_TYPES,
  type TypeSchema,
} from '../../src/index.js';

const fixtureDir = fileURLToPath(new URL('../../../test-fixtures/hybris', import.meta.url));

/** Marks the cursor with "|" and returns text and offset. */
function cursor(source: string): { text: string; offset: number } {
  const offset = source.indexOf('|');
  return { text: source.replace('|', ''), offset };
}

const schema: TypeSchema = {
  typeNames: () => ['Product', 'Category', 'Catalog'],
  hasType: (n) => ['Product', 'Category', 'Catalog'].includes(n),
  attributes: (t) =>
    t === 'Product'
      ? [
          { name: 'code', type: 'java.lang.String', unique: true, mandatory: true },
          { name: 'name', type: 'java.lang.String', localized: true },
          { name: 'catalog', type: 'Catalog' },
        ]
      : t === 'Catalog'
        ? [{ name: 'id', type: 'java.lang.String' }]
        : undefined,
  enumValues: (t, a) => (t === 'Product' && a === 'status' ? ['NEW', 'OLD'] : undefined),
  typeDoc: (t) => (t === 'Product' ? 'A product.' : undefined),
};

describe('formatImpex', () => {
  const format = (text: string, options = {}) =>
    applyEdits(text, formatImpex(parseImpex(text), options));

  it('aligns columns across header and rows', () => {
    const out = format(
      'INSERT_UPDATE Product;code[unique=true];name[lang=en]\n;p1;Phone\n;longer-code;X\n',
    );
    expect(out).toBe(
      [
        'INSERT_UPDATE Product;code[unique=true];name[lang=en]',
        '                     ;p1               ;Phone',
        '                     ;longer-code      ;X',
        '',
      ].join('\n'),
    );
  });

  it('is idempotent', () => {
    const once = format('INSERT_UPDATE A;x[unique=true];yy\n;1;2\n;333;4\n');
    expect(format(once)).toBe(once);
  });

  it('keeps a trailing semicolon of the header and empty trailing cells', () => {
    const out = format('UPDATE A;x[unique=true];\n;1;;\n');
    expect(out.split('\n')[0]).toBe('UPDATE A;x[unique=true];');
    expect(out.split('\n')[1]?.trim()).toBe(';1;;');
  });

  it('does not touch rows with multi-line values and leaves other statements alone', () => {
    const text = '$m=1\nUPDATE A;x[unique=true];y\n;1;"a\nb"\n;22;3\n# c\n';
    const out = format(text);
    expect(out).toContain(';1;"a\nb"');
    expect(out).toContain('$m=1');
    expect(out).toContain('# c');
  });

  it('does not align headers with syntax problems', () => {
    const text = 'UPDATE A;x[unique=true;y\n;1;2\n';
    expect(format(text)).toBe(text);
  });

  it('can switch alignment off but still trims trailing whitespace', () => {
    const out = format('UPDATE A;x[unique=true]   \n;1;2  \n', { alignColumns: false });
    expect(out).toBe('UPDATE A;x[unique=true]\n;1;2\n');
  });

  it('can leave the type column unaligned', () => {
    const out = format('INSERT_UPDATE Product;code[unique=true]\n;p1\n', {
      alignTypeColumn: false,
    });
    expect(out.split('\n')[1]).toBe(';p1');
  });

  it('only formats the blocks touched by a range', () => {
    const text = 'UPDATE A;x[unique=true];yy\n;1;2\n\nUPDATE B;x[unique=true];yy\n;1;2\n';
    const doc = parseImpex(text);
    const second = text.indexOf('UPDATE B');
    const edits = formatImpex(doc, {}, { start: second, end: text.length });
    expect(edits.every((e) => e.span.start >= second)).toBe(true);
  });
});

describe('semantic tokens', () => {
  const doc = parseImpex(
    '$cat=x\nINSERT_UPDATE Product;code[unique=true];name[lang=$l]\n;p1;"q $cat r";12;<ignore>\n# c',
  );
  const tokens = semanticTokens(doc);
  const at = (line: number, ch: number) =>
    tokens.find((t) => t.line === line && t.character === ch);

  it('classifies the header parts', () => {
    expect(at(1, 0)?.type).toBe('keyword');
    expect(at(1, 14)?.type).toBe('class');
    expect(at(1, 22)?.type).toBe('property');
    expect(at(1, 22)?.modifiers).toContain('readonly');
    expect(at(1, 27)?.type).toBe('decorator');
  });

  it('classifies macros, strings, numbers and comments', () => {
    expect(at(0, 0)?.type).toBe('macro');
    expect(at(2, 4)?.type).toBe('string');
    expect(tokens.some((t) => t.line === 2 && t.type === 'macro')).toBe(true);
    expect(tokens.some((t) => t.line === 2 && t.type === 'number')).toBe(true);
    expect(tokens.some((t) => t.line === 2 && t.type === 'enumMember')).toBe(true);
    expect(at(3, 0)?.type).toBe('comment');
  });

  it('never overlaps and stays on single lines', () => {
    for (const [i, t] of tokens.entries()) {
      const next = tokens[i + 1];
      if (next && next.line === t.line)
        expect(t.character + t.length).toBeLessThanOrEqual(next.character);
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it('splits multi-line strings per line and encodes to the LSP wire format', () => {
    const multi = semanticTokens(parseImpex('UPDATE A;x[unique=true]\n;"a\nb"'));
    expect(multi.filter((t) => t.type === 'string').map((t) => t.line)).toEqual([1, 2]);
    const data = encodeSemanticTokens(multi);
    expect(data.length % 5).toBe(0);
    expect(data[3]).toBe(TOKEN_TYPES.indexOf('keyword'));
  });
});

describe('outline and folding', () => {
  const doc = parseImpex(
    '# a\n# b\n$m=1\nINSERT_UPDATE Product;code[unique=true];name\n;1;a\n;2;b\n\nUPDATE C;x[unique=true]\n;1\n',
  );

  it('lists macros and headers with columns', () => {
    const symbols = outline(doc);
    expect(symbols.map((s) => s.name)).toEqual(['$m', 'INSERT_UPDATE Product', 'UPDATE C']);
    expect(symbols[1]?.detail).toBe('2 rows');
    expect(symbols[1]?.children.map((c) => c.name)).toEqual(['code', 'name']);
  });

  it('folds header blocks and comment runs', () => {
    const ranges = folding(doc).map((r) => [
      doc.lines.positionAt(r.span.start).line,
      doc.lines.positionAt(r.span.end).line,
      r.kind,
    ]);
    expect(ranges).toContainEqual([0, 1, 'comment']);
    expect(ranges).toContainEqual([3, 5, 'region']);
    expect(ranges).toContainEqual([7, 8, 'region']);
  });
});

describe('complete', () => {
  it('offers headers at the start of a line', () => {
    const { text, offset } = cursor('INS|');
    const labels = complete(parseImpex(text), offset).map((e) => e.label);
    expect(labels).toEqual(expect.arrayContaining(['INSERT', 'INSERT_UPDATE']));
    expect(labels).not.toContain('UPDATE');
  });

  it('offers macro, script and comment snippets on an empty line', () => {
    const { text, offset } = cursor('\n|');
    const labels = complete(parseImpex(text), offset).map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining(['INSERT_UPDATE', '$macro = value', '#% script']),
    );
  });

  it('completes macros defined above the cursor only', () => {
    const { text, offset } = cursor('$a=1\nUPDATE A;x[unique=true]\n;$|\n$later=2');
    const entries = complete(parseImpex(text), offset);
    expect(entries.map((e) => e.label)).toContain('$a');
    expect(entries.map((e) => e.label)).not.toContain('$later');
    expect(entries.find((e) => e.label === '$a')?.replace).toEqual({
      start: offset - 1,
      end: offset,
    });
  });

  it('completes modifier names, skipping the ones already used', () => {
    const { text, offset } = cursor('UPDATE Product;code[unique=true,|]');
    const labels = complete(parseImpex(text), offset).map((e) => e.label);
    expect(labels).toContain('lang');
    expect(labels).not.toContain('unique');
  });

  it('completes modifier values', () => {
    const boolValues = cursor('UPDATE Product;code[unique=|]');
    expect(complete(parseImpex(boolValues.text), boolValues.offset).map((e) => e.label)).toEqual([
      'true',
      'false',
    ]);
    const langs = cursor('UPDATE Product;name[lang=d|]');
    expect(complete(parseImpex(langs.text), langs.offset).map((e) => e.label)).toContain('de');
    const type = cursor('UPDATE Product[|];code');
    expect(complete(parseImpex(type.text), type.offset).map((e) => e.label)).toContain('batchmode');
  });

  it('uses the schema for types, attributes and reference attributes', () => {
    const types = cursor('UPDATE Pro|');
    expect(complete(parseImpex(types.text), types.offset, schema).map((e) => e.label)).toContain(
      'Product',
    );

    const attrs = cursor('UPDATE Product;code[unique=true];|');
    const entries = complete(parseImpex(attrs.text), attrs.offset, schema);
    expect(entries.map((e) => e.label)).toEqual(['name', 'catalog']);
    expect(entries[0]?.insertText).toBe('name[lang=${1:en}]');

    const refs = cursor('UPDATE Product;code[unique=true];catalog(|)');
    expect(complete(parseImpex(refs.text), refs.offset, schema).map((e) => e.label)).toEqual([
      'id',
    ]);
  });

  it('stays silent about types and attributes without a schema', () => {
    const { text, offset } = cursor('UPDATE Pro|');
    expect(complete(parseImpex(text), offset)).toEqual([]);
  });

  it('suggests special values and enum values in cells', () => {
    const { text, offset } = cursor('UPDATE Product;code[unique=true];status\n;1;|');
    const labels = complete(parseImpex(text), offset, schema).map((e) => e.label);
    expect(labels).toEqual(expect.arrayContaining(['<ignore>', '<empty>', 'NEW', 'OLD']));
  });
});

describe('hover and navigation', () => {
  const text =
    '$cat=base\n$full=$cat:Staged\nINSERT_UPDATE Product;code[unique=true];name[lang=en]\n;p1;Phone;$full\n';
  const doc = parseImpex(text);

  it('shows the expanded macro value', () => {
    const info = hover(doc, text.indexOf('$full', 60) + 2);
    expect(info?.markdown).toContain('Expands to: `base:Staged`');
  });

  it('explains modes and modifiers', () => {
    expect(hover(doc, text.indexOf('INSERT_UPDATE') + 3)?.markdown).toContain('INSERT_UPDATE');
    expect(hover(doc, text.indexOf('unique') + 2)?.markdown).toContain('modifier');
  });

  it('shows the column of a value cell', () => {
    const info = hover(doc, text.indexOf('Phone') + 1);
    expect(info?.markdown).toContain('Column 2: **name**');
    expect(info?.markdown).toContain('lang=en');
  });

  it('reports unknown attributes when a schema is loaded', () => {
    const bad = parseImpex('UPDATE Product;nope[unique=true]');
    expect(hover(bad, bad.text.indexOf('nope') + 1, schema)?.markdown).toContain('No attribute');
  });

  it('finds definitions and all occurrences of a macro', () => {
    const ref = macroAt(doc, text.indexOf('$cat', 20) + 1);
    expect(ref?.def?.name).toBe('cat');
    expect(macroOccurrences(doc, ref!.def!)).toHaveLength(2);
    expect(macroAt(doc, 0)?.isDefinition).toBe(true);
  });
});

describe('quick fixes', () => {
  const fixAll = (text: string, code: string) => {
    const doc = parseImpex(text);
    const problem = analyze(doc).find((p) => p.code === code);
    expect(problem, `problem ${code}`).toBeDefined();
    const fix = fixesFor(doc, problem!)[0];
    expect(fix, `fix for ${code}`).toBeDefined();
    return applyEdits(text, fix!.edits);
  };

  it('corrects an unknown mode', () => {
    expect(fixAll('INSERTUPDATE A;x[unique=true]\n;1', 'impex.header.unknown-mode')).toBe(
      'INSERT_UPDATE A;x[unique=true]\n;1',
    );
  });

  it('defines an undefined macro', () => {
    expect(
      fixAll('UPDATE A;x[unique=true]\n;$m', 'impex.macro.undefined').startsWith('$m=\n'),
    ).toBe(true);
  });

  it('closes brackets and quotes', () => {
    expect(fixAll('UPDATE A;x[unique=true\n;1', 'impex.syntax.missing-bracket')).toBe(
      'UPDATE A;x[unique=true]\n;1',
    );
    expect(
      fixAll('UPDATE A;x[unique=true];y\n;1;"open\n;2;3', 'impex.syntax.unterminated-quote'),
    ).toContain('"open"');
  });

  it('removes surplus values', () => {
    expect(fixAll('UPDATE A;x[unique=true]\n;1;2;3', 'impex.row.extra-cells')).toBe(
      'UPDATE A;x[unique=true]\n;1',
    );
  });

  it('joins a header continuation', () => {
    expect(
      fixAll('UPDATE A;x[unique=true];\n  y[lang=en]\n;1;2', 'impex.row.header-continuation'),
    ).toBe('UPDATE A;x[unique=true];y[lang=en]\n;1;2');
  });

  it('marks the first attribute unique', () => {
    expect(fixAll('UPDATE A;x;y\n;1;2', 'impex.header.no-unique')).toBe(
      'UPDATE A;x[unique=true];y\n;1;2',
    );
    expect(fixAll('UPDATE A;x[lang=en];y\n;1;2', 'impex.header.no-unique')).toBe(
      'UPDATE A;x[unique=true,lang=en];y\n;1;2',
    );
  });

  it('removes an unused macro', () => {
    expect(fixAll('$unused=1\nUPDATE A;x[unique=true]\n;1', 'impex.macro.unused')).toBe(
      'UPDATE A;x[unique=true]\n;1',
    );
  });

  it('produces fixed documents without remaining errors for the mode case', () => {
    const fixed = fixAll('INSERTUPDATE A;x[unique=true]\n;1', 'impex.header.unknown-mode');
    expect(analyze(parseImpex(fixed)).filter((p) => p.severity === 'error')).toEqual([]);
  });
});

describe('type-aware diagnostics (with the fixture type system)', () => {
  let ts: Awaited<ReturnType<typeof buildTypeSystem>>;
  beforeAll(async () => {
    ts = await buildTypeSystem(await loadPlatform(fixtureDir));
  });
  const codesWith = (text: string) => analyze(parseImpex(text), { schema: ts }).map((p) => p.code);

  it('accepts valid headers, references and enum values', () => {
    const text = [
      'INSERT_UPDATE Product;code[unique=true];catalogVersion(catalog(id),version)[unique=true];approvalStatus(code)',
      ';p1;main:Staged;approved',
      'INSERT_UPDATE Language;isocode[unique=true];name[lang=en]',
      ';de;German',
    ].join('\n');
    expect(codesWith(text)).toEqual([]);
  });

  it('reports unknown types and attributes with suggestions', () => {
    const doc = parseImpex(
      'INSERT_UPDATE Prodcut;code[unique=true]\n;1\nINSERT_UPDATE Product;cod[unique=true]\n;1',
    );
    const problems = analyze(doc, { schema: ts });
    const type = problems.find((p) => p.code === 'impex.type.unknown');
    const attr = problems.find((p) => p.code === 'impex.attribute.unknown');
    expect(type?.data?.suggestion).toBe('Product');
    expect(attr?.data?.suggestion).toBe('code');
    expect(fixesFor(doc, type!)[0]?.edits[0]?.newText).toBe('Product');
  });

  it('checks reference lookups through the referenced types', () => {
    const c = codesWith(
      'INSERT_UPDATE Product;code[unique=true];catalogVersion(catalog(idd),versionx)[unique=true]\n;1;a:b',
    );
    expect(c.filter((x) => x === 'impex.reference.unknown')).toHaveLength(2);
  });

  it('warns about values that are not in the enumeration', () => {
    expect(
      codesWith(
        'INSERT_UPDATE Product;code[unique=true];approvalStatus(code)\n;1;aproved\n;2;approved\n;3;<ignore>',
      ),
    ).toEqual(['impex.value.unknown-enum']);
  });

  it('knows relation types, localized attributes and virtual columns', () => {
    expect(
      codesWith(
        'INSERT_UPDATE AcmeBadge2CustomerRelation;source(code)[unique=true];target(uid)[unique=true]\n;a;b',
      ),
    ).toEqual([]);
    expect(codesWith('INSERT_UPDATE Language;isocode[unique=true];name\n;de;x')).toContain(
      'impex.attribute.localized-without-lang',
    );
    expect(
      codesWith(
        'INSERT_UPDATE Language;isocode[unique=true];computed[virtual=true,default=x]\n;de;',
      ),
    ).toEqual([]);
  });

  it('warns when an abstract type is inserted', () => {
    expect(codesWith('INSERT_UPDATE C2LItem;isocode[unique=true]\n;x')).toContain(
      'impex.type.abstract',
    );
    expect(codesWith('UPDATE C2LItem;isocode[unique=true]\n;x')).not.toContain(
      'impex.type.abstract',
    );
  });

  it('stays silent about types when no schema is given', () => {
    expect(
      analyze(parseImpex('INSERT_UPDATE Nope;x[unique=true]\n;1')).map((p) => p.code),
    ).not.toContain('impex.type.unknown');
  });

  it('feeds completion and hover with real type information', () => {
    const attrs = cursor('INSERT_UPDATE Product;code[unique=true];|');
    const labels = complete(parseImpex(attrs.text), attrs.offset, ts).map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining(['catalogVersion', 'approvalStatus', 'creationtime']),
    );
    expect(labels).not.toContain('code');

    const cell = cursor('INSERT_UPDATE Product;code[unique=true];approvalStatus(code)\n;1;|');
    expect(complete(parseImpex(cell.text), cell.offset, ts).map((e) => e.label)).toEqual(
      expect.arrayContaining(['check', 'approved', 'unapproved']),
    );

    const doc = parseImpex('INSERT_UPDATE Product;code[unique=true]');
    expect(hover(doc, doc.text.indexOf('Product') + 2, ts)?.markdown).toContain(
      'extends `GenericItem`',
    );
  });
});

describe('type-aware diagnostics: real-world forms', () => {
  let ts: Awaited<ReturnType<typeof buildTypeSystem>>;
  beforeAll(async () => {
    ts = await buildTypeSystem(await loadPlatform(fixtureDir));
  });
  const codesWith = (text: string) => analyze(parseImpex(text), { schema: ts }).map((p) => p.code);

  it('accepts &docId and Type.attribute references', () => {
    expect(codesWith('INSERT_UPDATE Product;code[unique=true];catalogVersion(&cv)\n;1;x')).toEqual(
      [],
    );
    expect(
      codesWith(
        'INSERT_UPDATE Product;code[unique=true];catalogVersion(CatalogVersion.version)\n;1;x',
      ),
    ).toEqual([]);
    expect(
      codesWith(
        'INSERT_UPDATE Product;code[unique=true];catalogVersion(CatalogVersion.nope)\n;1;x',
      ),
    ).toEqual(['impex.reference.unknown']);
  });

  it('checks each value of a comma separated enum cell', () => {
    expect(
      codesWith(
        'INSERT_UPDATE Product;code[unique=true];approvalStatus(code)\n;1;"check,approved"',
      ),
    ).toEqual([]);
    const doc = parseImpex(
      'INSERT_UPDATE Product;code[unique=true];approvalStatus(code)\n;1;check,aproved',
    );
    const problems = analyze(doc, { schema: ts });
    expect(problems.map((p) => p.code)).toEqual(['impex.value.unknown-enum']);
    expect(doc.text.slice(problems[0]!.span.start, problems[0]!.span.end)).toBe('aproved');
  });

  it('does not report unknown attributes on types whose declaration is not loaded', () => {
    const partial = new TypeSystem([
      parseItemsXml(
        '<items><itemtypes><itemtype code="Foreign" autocreate="false"><attributes><attribute qualifier="known" type="java.lang.String"/></attributes></itemtype></itemtypes></items>',
        '/p',
        'ext',
      ),
    ]);
    const doc = parseImpex('UPDATE Foreign;known[unique=true];other\n;a;b');
    expect(analyze(doc, { schema: partial }).map((p) => p.code)).not.toContain(
      'impex.attribute.unknown',
    );
  });
});
