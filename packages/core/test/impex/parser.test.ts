import { describe, expect, it } from 'vitest';
import { analyze, parseImpex } from '../../src/index.js';

const codes = (text: string) => analyze(parseImpex(text)).map((p) => p.code);

describe('parseImpex: structure', () => {
  const doc = parseImpex(
    [
      '# comment',
      '$cat=electronics',
      'INSERT_UPDATE Product;code[unique=true];name[lang=en];catalogVersion(catalog(id),version)[unique=true]',
      ';p1;Phone;$cat:Staged',
      ';p2;"Multi',
      'Line";x',
      '',
      '#% impex.info("x");',
    ].join('\n'),
  );

  it('recognises all statement kinds', () => {
    expect(doc.statements.map((s) => s.kind)).toEqual([
      'comment',
      'macro',
      'header',
      'row',
      'row',
      'script',
    ]);
  });

  it('parses the header', () => {
    const header = doc.headers[0];
    expect(header?.mode).toBe('INSERT_UPDATE');
    expect(header?.canonicalMode).toBe('INSERT_UPDATE');
    expect(header?.typeName).toBe('Product');
    expect(header?.columns.map((c) => c.name)).toEqual(['code', 'name', 'catalogVersion']);
    expect(header?.columns[1]?.lang).toBe('en');
    const cv = header?.columns[2];
    expect(cv?.refs[0]?.name).toBe('catalog');
    expect(cv?.refs[0]?.children.map((c) => c.name)).toEqual(['id']);
    expect(cv?.refs[1]?.name).toBe('version');
    expect(cv?.modifiers[0]).toMatchObject({ name: 'unique', value: 'true' });
  });

  it('attaches rows and handles multi-line quoted cells', () => {
    const header = doc.headers[0];
    expect(header?.rows).toHaveLength(2);
    const second = header?.rows[1];
    expect(second?.multiline).toBe(true);
    expect(second?.cells.map((c) => c.value)).toEqual(['', 'p2', 'Multi\nLine', 'x']);
    expect(second?.cells[2]?.quoted).toBe(true);
  });

  it('records macros and their uses', () => {
    expect(doc.macros.map((m) => [m.name, m.value])).toEqual([['cat', 'electronics']]);
    expect(doc.macroUses.map((u) => u.name)).toEqual(['cat']);
  });
});

describe('parseImpex: details', () => {
  it('is case-insensitive for modes', () => {
    expect(
      parseImpex('insert_update Language;isocode[unique=true]').headers[0]?.canonicalMode,
    ).toBe('INSERT_UPDATE');
  });

  it('keeps ";" inside quotes and unescapes doubled quotes', () => {
    const doc = parseImpex('UPDATE A;x[unique=true]\n;"a;b ""q"""');
    expect(doc.headers[0]?.rows[0]?.cells.map((c) => c.value)).toEqual(['', 'a;b "q"']);
  });

  it('handles type modifiers and whitespace in modifiers', () => {
    const header = parseImpex('UPDATE Language[batchmode=true];isocode [ unique = true ]')
      .headers[0];
    expect(header?.typeName).toBe('Language');
    expect(header?.typeModifiers[0]).toMatchObject({ name: 'batchmode', value: 'true' });
    expect(header?.columns[0]?.modifiers[0]).toMatchObject({ name: 'unique', value: 'true' });
  });

  it('keeps commas inside quoted modifier values', () => {
    const header = parseImpex("UPDATE A;price[numberformat='#,##0.00',unique=true]").headers[0];
    expect(header?.columns[0]?.modifiers.map((m) => [m.name, m.value])).toEqual([
      ['numberformat', '#,##0.00'],
      ['unique', 'true'],
    ]);
  });

  it('classifies special columns', () => {
    const cols = parseImpex('INSERT_UPDATE A;&docId;@alias[translator=x.Y];$col;code').headers[0]
      ?.columns;
    expect(cols?.map((c) => [c.kind, c.name])).toEqual([
      ['docid', 'docId'],
      ['dynamic', 'alias'],
      ['macro', '$col'],
      ['attribute', 'code'],
    ]);
  });

  it('works with CRLF line endings', () => {
    const doc = parseImpex('INSERT_UPDATE A;code[unique=true]\r\n;a\r\n;b\r\n');
    expect(doc.headers[0]?.rows).toHaveLength(2);
    expect(doc.headers[0]?.rows[1]?.cells[1]?.value).toBe('b');
  });

  it('does not treat user-rights blocks as headerless rows', () => {
    const text = '$START_USERRIGHTS\nType;UID;MemberOfGroups\nUserGroup;g1;\n$END_USERRIGHTS\n';
    expect(codes(text)).not.toContain('impex.row.no-header');
  });
});

describe('analyze: problems matching the real importer', () => {
  it('flags an unknown mode as an error with a suggestion', () => {
    const problems = analyze(parseImpex('INSERTUPDATE Language;isocode[unique=true]\n;en'));
    const unknown = problems.find((p) => p.code === 'impex.header.unknown-mode');
    expect(unknown?.severity).toBe('error');
    expect(unknown?.data?.suggestion).toBe('INSERT_UPDATE');
    expect(problems.map((p) => p.code)).not.toContain('impex.row.no-header');
  });

  it('flags a header without a type', () => {
    expect(codes('UPDATE ;isocode[unique=true]\n;en')).toContain('impex.header.missing-type');
  });

  it('flags rows before any header', () => {
    expect(codes(';en;English')).toContain('impex.row.no-header');
  });

  it('warns about values beyond the header columns', () => {
    const problems = analyze(parseImpex('UPDATE A;x[unique=true]\n;1;2;3'));
    const extra = problems.find((p) => p.code === 'impex.row.extra-cells');
    expect(extra?.message).toContain('2 value(s)');
  });

  it('does not warn about missing cells or empty trailing cells', () => {
    expect(codes('UPDATE A;x[unique=true];y\n;1\n;2;;;')).not.toContain('impex.row.extra-cells');
  });

  it('flags unterminated quotes without swallowing the rest of the file', () => {
    const doc = parseImpex('UPDATE A;x[unique=true];y\n;1;"open\n;2;3\n');
    expect(doc.problems.map((p) => p.code)).toContain('impex.syntax.unterminated-quote');
    expect(doc.headers[0]?.rows).toHaveLength(2);
  });

  it('flags unbalanced brackets', () => {
    const problems = parseImpex('UPDATE A;x[unique=true\n;1').problems;
    expect(problems[0]).toMatchObject({
      code: 'impex.syntax.missing-bracket',
      data: { close: ']' },
    });
    expect(parseImpex('UPDATE A;x(catalog(id)\n;1').problems[0]?.data?.close).toBe(')');
  });

  it('flags duplicate columns but allows the same attribute in different languages', () => {
    expect(codes('UPDATE A;x[unique=true];x\n;1;2')).toContain('impex.header.duplicate-column');
    expect(codes('UPDATE A;x[unique=true];n[lang=en];n[lang=de]\n;1;a;b')).not.toContain(
      'impex.header.duplicate-column',
    );
  });

  it('requires a unique column unless macros could provide it', () => {
    expect(codes('UPDATE Language;isocode;name[lang=en]\n;a;b')).toContain(
      'impex.header.no-unique',
    );
    expect(codes('INSERT Language;isocode\n;a')).not.toContain('impex.header.no-unique');
    expect(
      codes('$cv=catalogVersion(catalog(id),version)[unique=true]\nUPDATE P;code;$cv\n;a;b'),
    ).not.toContain('impex.header.no-unique');
  });

  it('warns about an indented header continuation', () => {
    const text = 'UPDATE A;x[unique=true];\n  y[lang=en]\n;1;2';
    expect(codes(text)).toContain('impex.row.header-continuation');
  });

  it('informs about trailing # in a value row', () => {
    expect(codes('UPDATE A;x[unique=true];y\n;1;value # note')).toContain(
      'impex.value.trailing-comment',
    );
    expect(codes('UPDATE A;x[unique=true];y\n;1;http://a/b#frag')).not.toContain(
      'impex.value.trailing-comment',
    );
  });
});

describe('analyze: modifiers', () => {
  it('warns about unknown, duplicate and invalid modifiers', () => {
    const c = codes('UPDATE A;x[unique=maybe,nosuch=1,lang=en,lang=de];y[lang]\n;1;2');
    expect(c).toContain('impex.modifier.invalid-value');
    expect(c).toContain('impex.modifier.unknown');
    expect(c).toContain('impex.modifier.duplicate');
    expect(c).toContain('impex.modifier.missing-value');
  });

  it('knows type modifiers and complains when they are used on columns', () => {
    expect(codes('UPDATE A[batchmode=true];x[unique=true]\n;1')).not.toContain(
      'impex.modifier.unknown',
    );
    expect(codes('UPDATE A;x[batchmode=true,unique=true]\n;1')).toContain('impex.modifier.unknown');
  });

  it('ignores modifiers that contain macros', () => {
    expect(codes('$u=unique\nUPDATE A;x[$u=true];y[lang=$l]\n;1;2')).not.toContain(
      'impex.modifier.unknown',
    );
  });
});

describe('analyze: macros', () => {
  it('reports use before definition and unused macros', () => {
    const c = codes('UPDATE A;x[unique=true]\n;$late\n$late=1\n$unused=2');
    expect(c).toContain('impex.macro.undefined');
    expect(c.filter((x) => x === 'impex.macro.unused')).toHaveLength(2);
  });

  it('resolves macros that reference macros and tolerates spaces around =', () => {
    const c = codes('$a = 1\n$b=$a\nUPDATE A;x[unique=true]\n;$b');
    expect(c).not.toContain('impex.macro.undefined');
    expect(c).not.toContain('impex.macro.unused');
  });

  it('never flags $config-* macros', () => {
    expect(codes('UPDATE A;x[unique=true]\n;$config-some.property')).not.toContain(
      'impex.macro.undefined',
    );
  });

  it('honours severity overrides', () => {
    const doc = parseImpex('UPDATE A;x[unique=true]\n;$nope');
    const off = analyze(doc, { severities: { 'impex.macro.undefined': 'off' } });
    expect(off.map((p) => p.code)).not.toContain('impex.macro.undefined');
    const err = analyze(doc, { severities: { 'impex.macro.undefined': 'error' } });
    expect(err.find((p) => p.code === 'impex.macro.undefined')?.severity).toBe('error');
  });
});

describe('robustness', () => {
  it('never throws on arbitrary input', () => {
    const alphabet = [
      '\n',
      '\r\n',
      ';',
      '"',
      '[',
      ']',
      '(',
      ')',
      '$',
      '#',
      '%',
      ' ',
      'a',
      'INSERT_UPDATE ',
      '=',
      ',',
      '\\',
      "'",
      '@',
      '&',
    ];
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 400; n++) {
      let text = '';
      const length = Math.floor(rnd() * 80);
      for (let i = 0; i < length; i++) text += alphabet[Math.floor(rnd() * alphabet.length)];
      expect(() => analyze(parseImpex(text))).not.toThrow();
    }
  });

  it('keeps all spans inside the document', () => {
    const text = 'INSERT_UPDATE A;x[unique=true];y(z(a,b))\n;1;"a\nb";$m\n$m = 1\n#% x';
    const doc = parseImpex(text);
    for (const p of analyze(doc)) {
      expect(p.span.start).toBeGreaterThanOrEqual(0);
      expect(p.span.end).toBeLessThanOrEqual(text.length);
      expect(p.span.end).toBeGreaterThanOrEqual(p.span.start);
    }
  });
});

describe('real-world regressions (found by running the analyzer over a real platform)', () => {
  it('substitutes macros textually: longest defined prefix wins', () => {
    const c = codes('$prefix=pip\n$cat=$prefixContentCatalog\nUPDATE A;x[unique=true]\n;$cat');
    expect(c).not.toContain('impex.macro.undefined');
    expect(c).not.toContain('impex.macro.unused');
    const doc = parseImpex('$p=zz\n$pN=yy\nUPDATE A;x[unique=true]\n;$pNone');
    const ids = analyze(doc)
      .filter((p) => p.code === 'impex.macro.unused')
      .map((p) => doc.text.slice(p.span.start, p.span.end));
    expect(ids).toEqual(['p']); // $pN won, $p is unused
  });

  it('does not attach user-rights rows to the previous header', () => {
    const text =
      'INSERT_UPDATE A;x[unique=true]\n;1\n$START_USERRIGHTS;;;;\nType;UID;MemberOfGroups\nUserGroup;g;\n;;;;PIPProduct;+;+\n$END_USERRIGHTS';
    const doc = parseImpex(text);
    expect(doc.headers[0]?.rows).toHaveLength(1);
    expect(codes(text)).not.toContain('impex.row.extra-cells');
  });

  it('allows macros in lang modifiers of otherwise identical columns', () => {
    expect(
      codes('UPDATE Language;isocode[unique = true];name[lang = $en];name[lang = $de]\n;a;b;c'),
    ).not.toContain('impex.header.duplicate-column');
    expect(
      codes('UPDATE Language;isocode[unique=true];name[lang=$en];name[lang=$en]\n;a;b;c'),
    ).toContain('impex.header.duplicate-column');
  });

  it('accepts mode=replace, empty quoted defaults and type-level interceptor modifiers', () => {
    const c = codes(
      "UPDATE A[disable.interceptor.types=validate,disable.interceptor.beans='x'];k[unique=true];c(code)[mode=replace];d[default='']\n;1;2;3",
    );
    expect(c).not.toContain('impex.modifier.invalid-value');
    expect(c).not.toContain('impex.modifier.unknown');
    expect(c).not.toContain('impex.modifier.missing-value');
  });
});
