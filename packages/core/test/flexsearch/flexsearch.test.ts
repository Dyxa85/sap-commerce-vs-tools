import { describe, expect, it } from 'vitest';
import { applyEdits, flexsearch as fs, type TypeSchema } from '../../src/index.js';

const parse = fs.parseFlexSearch;
const analyze = (text: string, schema?: TypeSchema) =>
  fs.analyzeFlexSearch(parse(text), { schema });
const codes = (text: string, schema?: TypeSchema) => analyze(text, schema).map((p) => p.code);
const errors = (text: string, schema?: TypeSchema) =>
  analyze(text, schema)
    .filter((p) => p.severity === 'error')
    .map((p) => p.code);

const schema: TypeSchema = {
  typeNames: () => ['Language', 'Title', 'Product'],
  hasType: (n) => ['Language', 'Title', 'Product'].includes(n),
  attributes: (t) =>
    t === 'Language'
      ? [{ name: 'isocode' }, { name: 'name', localized: true }, { name: 'active' }]
      : t === 'Title'
        ? [{ name: 'code' }]
        : undefined,
};

/** Queries the real hAC (2211-jdk21) accepted or rejected in our probe run. */
describe('agreement with the real hAC', () => {
  const accepted: [string, string][] = [
    ['basic', 'SELECT {pk} FROM {Language}'],
    ['alias', 'SELECT {l:pk} FROM {Language AS l}'],
    ['type name as alias', 'SELECT {Language:pk} FROM {Language}'],
    ['unaliased field with alias declared', 'SELECT {pk} FROM {Language AS l}'],
    ['lowercase keywords', "select {pk} from {Language} where {isocode} = 'en'"],
    ['block comment', 'SELECT /* c */ {pk} FROM {Language}'],
    ['subselect', 'SELECT {pk} FROM {Language} WHERE {pk} IN ({{ SELECT {pk} FROM {Language} }})'],
    ['locale syntax', 'SELECT {l:name[en]} FROM {Language AS l}'],
    ['outer join suffix', 'SELECT {l:name[en]:o} FROM {Language AS l}'],
    ['join', 'SELECT {l:pk} FROM {Language AS l JOIN Title AS t ON {l:pk} = {t:pk}}'],
    ['left join', 'SELECT {l:pk} FROM {Language AS l LEFT JOIN Title AS t ON {l:pk} = {t:pk}}'],
    ['exclude subtypes', 'SELECT {pk} FROM {Language!}'],
    ['order by', 'SELECT {isocode} FROM {Language} ORDER BY {isocode} DESC'],
    ['count', 'SELECT COUNT(*) FROM {Language}'],
    ['dot separator', 'SELECT {l.isocode} FROM {Language AS l}'],
    ['parameter', 'SELECT {pk} FROM {Language} WHERE {isocode} = ?code'],
  ];
  it.each(accepted)('accepts: %s', (_name, query) => {
    expect(errors(query)).toEqual([]);
  });

  const rejected: [string, string, string][] = [
    ['alias without AS', 'SELECT {l:pk} FROM {Language l}', 'flexsearch.from.alias-without-as'],
    ['unknown alias', 'SELECT {x:pk} FROM {Language AS l}', 'flexsearch.alias.unknown'],
    ['missing FROM', 'SELECT {pk}', 'flexsearch.select.no-from'],
    ['unbalanced brace', 'SELECT {pk FROM {Language}', 'flexsearch.syntax.missing-brace'],
    [
      'unterminated string',
      "SELECT {pk} FROM {Language} WHERE {isocode} = 'en",
      'flexsearch.syntax.unterminated-string',
    ],
  ];
  it.each(rejected)('rejects: %s', (_name, query, code) => {
    expect(codes(query)).toContain(code);
  });

  const warned: [string, string, string][] = [
    ['line comment', 'SELECT {pk} FROM {Language} -- trailing\n', 'flexsearch.comment.line'],
    ['trailing semicolon', 'SELECT {pk} FROM {Language};', 'flexsearch.trailing-semicolon'],
    ['LIMIT', 'SELECT {pk} FROM {Language} LIMIT 1', 'flexsearch.limit.unsupported'],
    [
      'naked UNION',
      'SELECT {pk} FROM {Language} UNION SELECT {pk} FROM {Language}',
      'flexsearch.union.unwrapped',
    ],
  ];
  it.each(warned)('warns: %s', (_name, query, code) => {
    expect(analyze(query).find((p) => p.code === code)?.severity).toBe('warning');
  });

  it('does not warn about a properly wrapped UNION', () => {
    expect(
      codes(
        'SELECT x.pk FROM ({{ SELECT {pk} AS pk FROM {Language} }} UNION {{ SELECT {pk} AS pk FROM {Language} }}) x',
      ),
    ).not.toContain('flexsearch.union.unwrapped');
  });
});

describe('structure', () => {
  const doc = parse(
    'SELECT {p:pk}, {c:name[en]:o} FROM {Product AS p JOIN Title! AS t ON {p:x} = {t:pk}}, {Language AS c} WHERE {p:code} = ?code AND {p:y} = ?other',
  );

  it('collects type refs with aliases and flags', () => {
    expect(doc.typeRefs.map((r) => [r.typeName, r.alias, r.excludeSubtypes])).toEqual([
      ['Product', 'p', false],
      ['Title', 't', true],
      ['Language', 'c', false],
    ]);
  });

  it('collects field refs including those inside the FROM brace', () => {
    expect(
      doc.fieldRefs.map(
        (f) =>
          `${f.alias}:${f.attribute}${f.lang ? `[${f.lang}]` : ''}${f.suffixes.length ? `:${f.suffixes.join(':')}` : ''}`,
      ),
    ).toEqual(['p:pk', 'c:name[en]:o', 'p:x', 't:pk', 'p:code', 'p:y']);
  });

  it('collects distinct parameters', () => {
    expect(fs.parameterNames(doc)).toEqual(['code', 'other']);
  });

  it('keeps subselect scopes with visibility of outer aliases', () => {
    const d = parse(
      'SELECT {a:pk} FROM {Language AS a} WHERE EXISTS ({{ SELECT {t:pk} FROM {Title AS t} WHERE {t:code} = {a:isocode} }})',
    );
    expect(d.scopes).toHaveLength(2);
    expect(
      errors(
        'SELECT {a:pk} FROM {Language AS a} WHERE EXISTS ({{ SELECT {t:pk} FROM {Title AS t} WHERE {t:code} = {a:isocode} }})',
      ),
    ).toEqual([]);
    expect(
      codes(
        'SELECT {pk} FROM {Language AS a} WHERE {pk} IN ({{ SELECT {z:pk} FROM {Title AS t} }})',
      ),
    ).toContain('flexsearch.alias.unknown');
  });

  it('reports a missing FROM inside a subselect only for that scope', () => {
    const c = analyze('SELECT {pk} FROM {Language} WHERE {pk} IN ({{ SELECT {pk} }})').filter(
      (p) => p.code === 'flexsearch.select.no-from',
    );
    expect(c).toHaveLength(1);
  });

  it('flags duplicate aliases and unused aliases', () => {
    expect(
      codes('SELECT {a:pk} FROM {Language AS a JOIN Title AS a ON {a:pk} = {a:pk}}'),
    ).toContain('flexsearch.alias.duplicate');
    expect(
      codes('SELECT {a:pk} FROM {Language AS a JOIN Title AS t ON {a:pk} = {a:pk}}'),
    ).toContain('flexsearch.alias.unused');
  });

  it('never throws and keeps spans inside the text', () => {
    const alphabet = [
      '{',
      '}',
      '{{',
      '}}',
      "'",
      '"',
      '?',
      'SELECT ',
      'FROM ',
      ' AS ',
      ':',
      '.',
      '[',
      ']',
      '-',
      '/*',
      '*/',
      ';',
      ' ',
      'a',
      '\n',
      '!',
      'JOIN ',
      'ON ',
    ];
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 500; n++) {
      let text = '';
      for (let i = 0, len = Math.floor(rnd() * 60); i < len; i++)
        text += alphabet[Math.floor(rnd() * alphabet.length)];
      const problems = analyze(text);
      for (const p of problems) {
        expect(p.span.start).toBeGreaterThanOrEqual(0);
        expect(p.span.end).toBeLessThanOrEqual(text.length);
      }
      fs.formatFlexSearch(parse(text));
    }
  });
});

describe('schema checks', () => {
  it('reports unknown types and attributes', () => {
    expect(codes('SELECT {pk} FROM {Nope}', schema)).toContain('flexsearch.type.unknown');
    const c = codes('SELECT {l:nosuch}, {l:isocode}, {l:pk} FROM {Language AS l}', schema);
    expect(c.filter((x) => x === 'flexsearch.attribute.unknown')).toHaveLength(1);
  });

  it('skips attribute checks when the type is unknown to the schema (no cascading errors)', () => {
    expect(codes('SELECT {l:whatever} FROM {Product AS l}', schema)).not.toContain(
      'flexsearch.attribute.unknown',
    );
  });
});

describe('navigation and hover', () => {
  const text = 'SELECT {l:isocode} FROM {Language AS l} WHERE {l:active} = ?flag';
  const doc = parse(text);

  it('finds alias occurrences and renames them consistently', () => {
    const ref = fs.aliasRefAt(doc, text.indexOf('l:isocode') + 1);
    expect(ref?.typeName).toBe('Language');
    const spans = fs.aliasOccurrences(doc, ref!);
    expect(spans).toHaveLength(3);
    const renamed = applyEdits(
      text,
      spans.map((span) => ({ span, newText: 'lang' })),
    );
    expect(renamed).toBe(
      'SELECT {lang:isocode} FROM {Language AS lang} WHERE {lang:active} = ?flag',
    );
  });

  it('hovers aliases, attributes, parameters and keywords', () => {
    expect(fs.hoverFlex(doc, text.indexOf('l:isocode') + 1)?.markdown).toContain(
      'alias of `Language`',
    );
    expect(fs.hoverFlex(doc, text.indexOf('isocode') + 1, schema)?.markdown).toContain(
      'attribute of `Language`',
    );
    expect(fs.hoverFlex(doc, text.indexOf('?flag') + 2)?.markdown).toContain('query parameter');
    expect(fs.hoverFlex(doc, 1)?.markdown).toContain('SELECT');
    expect(fs.hoverFlex(doc, text.indexOf('FROM') + 1)?.markdown).toContain('AS');
  });
});

describe('quick fixes', () => {
  const fix = (text: string, code: string) => {
    const doc = parse(text);
    const problem = fs.analyzeFlexSearch(doc).find((p) => p.code === code);
    expect(problem, code).toBeDefined();
    const f = fs.flexFixesFor(doc, problem!)[0];
    expect(f, `fix for ${code}`).toBeDefined();
    return applyEdits(text, f!.edits);
  };

  it('inserts AS', () =>
    expect(fix('SELECT {l:pk} FROM {Language l}', 'flexsearch.from.alias-without-as')).toBe(
      'SELECT {l:pk} FROM {Language AS l}',
    ));
  it('suggests a close alias', () =>
    expect(fix('SELECT {ll:pk} FROM {Language AS l}', 'flexsearch.alias.unknown')).toBe(
      'SELECT {l:pk} FROM {Language AS l}',
    ));
  it('removes the trailing semicolon', () =>
    expect(fix('SELECT {pk} FROM {Language};', 'flexsearch.trailing-semicolon')).toBe(
      'SELECT {pk} FROM {Language}',
    ));
  it('converts line comments', () =>
    expect(fix('SELECT {pk} FROM {Language} -- why\n', 'flexsearch.comment.line')).toBe(
      'SELECT {pk} FROM {Language} /* why */\n',
    ));
});

describe('completion', () => {
  const at = (source: string, s?: TypeSchema) => {
    const offset = source.indexOf('|');
    const text = source.replace('|', '');
    return fs.completeFlex(parse(text), offset, s).map((e) => e.label);
  };

  it('offers keywords and snippets at the start', () => {
    const labels = at('SEL|');
    expect(labels).toContain('SELECT');
    expect(labels).toContain('SELECT … FROM');
  });

  it('offers the FROM brace after FROM', () => {
    expect(at('SELECT {pk} FROM |')).toContain('{Type AS alias}');
  });

  it('offers types in the FROM brace and AS/JOIN after a type', () => {
    expect(at('SELECT {pk} FROM {La|', schema)).toContain('Language');
    expect(at('SELECT {pk} FROM {Language |}', schema)).toEqual(
      expect.arrayContaining(['AS', 'JOIN']),
    );
    expect(at('SELECT {pk} FROM {Language AS l JOIN Ti|}', schema)).toContain('Title');
  });

  it('offers aliases, then attributes after "alias:"', () => {
    expect(at('SELECT {| FROM {Language AS l}', schema)).toContain('l');
    expect(at('SELECT {l:| FROM {Language AS l}', schema)).toEqual(
      expect.arrayContaining(['pk', 'isocode', 'name']),
    );
    expect(at('SELECT {isoc|} FROM {Language}', schema)).toContain('isocode');
  });

  it('offers languages after "["', () => {
    expect(at('SELECT {l:name[| FROM {Language AS l}', schema)).toContain('de');
  });
});

describe('formatFlexSearch', () => {
  const format = (text: string, options = {}) => fs.formatFlexSearch(parse(text), options);

  it('puts clauses on separate lines and indents logical operators', () => {
    expect(
      format(
        "select {p:pk} from {Product as p} where {p:code}='x' and {p:y} = 1 or {p:z}=2 order by {p:code} desc",
      ),
    ).toBe(
      [
        'SELECT {p:pk}',
        'FROM {Product AS p}',
        "WHERE {p:code} = 'x'",
        '  AND {p:y} = 1',
        '  OR {p:z} = 2',
        'ORDER BY {p:code} DESC',
      ].join('\n'),
    );
  });

  it('is idempotent', () => {
    const once = format(
      'SELECT {a:pk},{a:b} FROM {A AS a JOIN B AS b ON {a:x}={b:y}} WHERE {a:c} IN (1,2,3) AND {a:d} BETWEEN 1 AND 5 AND {a:e} <> 3',
    )!;
    expect(format(once)).toBe(once);
  });

  it('keeps BETWEEN ... AND together and parenthesised conditions on one line', () => {
    expect(format('SELECT {pk} FROM {A} WHERE {x} BETWEEN 1 AND 5 AND ({y} = 1 OR {z} = 2)')).toBe(
      ['SELECT {pk}', 'FROM {A}', 'WHERE {x} BETWEEN 1 AND 5', '  AND ({y} = 1 OR {z} = 2)'].join(
        '\n',
      ),
    );
  });

  it('formats subselects with one more level of indentation', () => {
    expect(
      format('SELECT {pk} FROM {A} WHERE {pk} IN ({{ SELECT {pk} FROM {B} WHERE {x}=1 }})'),
    ).toBe(
      [
        'SELECT {pk}',
        'FROM {A}',
        'WHERE {pk} IN ({{',
        '  SELECT {pk}',
        '  FROM {B}',
        '  WHERE {x} = 1',
        '}})',
      ].join('\n'),
    );
  });

  it('keeps strings, operators, negative numbers and function calls intact', () => {
    expect(
      format(
        "SELECT COUNT(*) FROM {A} WHERE {x} >= -1 AND {y} LIKE '%a  b%' AND UPPER({z}) <> 'Q'",
      ),
    ).toBe(
      [
        'SELECT COUNT(*)',
        'FROM {A}',
        'WHERE {x} >= -1',
        "  AND {y} LIKE '%a  b%'",
        "  AND UPPER({z}) <> 'Q'",
      ].join('\n'),
    );
  });

  it('can keep keyword case and not break AND/OR', () => {
    expect(
      format('select {pk} from {A} where {x}=1 and {y}=2', {
        uppercaseKeywords: false,
        breakLogicalOperators: false,
      }),
    ).toBe(['select {pk}', 'from {A}', 'where {x} = 1 and {y} = 2'].join('\n'));
  });

  it('refuses to reflow text with syntax errors', () => {
    expect(format("SELECT {pk} FROM {A} WHERE {x} = 'oops")).toBeUndefined();
  });

  it('preserves comments', () => {
    const out = format('SELECT /* all */ {pk} FROM {A}')!;
    expect(out).toContain('/* all */');
  });
});

describe('parameters', () => {
  it('quotes plain values and keeps numbers, NULL and quoted strings', () => {
    expect(fs.toSqlLiteral('abc')).toBe("'abc'");
    expect(fs.toSqlLiteral("o'neil")).toBe("'o''neil'");
    expect(fs.toSqlLiteral('42')).toBe('42');
    expect(fs.toSqlLiteral('-1.5')).toBe('-1.5');
    expect(fs.toSqlLiteral('null')).toBe('NULL');
    expect(fs.toSqlLiteral("'already'")).toBe("'already'");
  });

  it('substitutes only the given parameters', () => {
    const doc = parse('SELECT {pk} FROM {A} WHERE {x} = ?a AND {y} = ?b AND {z} = ?a');
    expect(fs.substituteParameters(doc, { a: 'v' })).toBe(
      "SELECT {pk} FROM {A} WHERE {x} = 'v' AND {y} = ?b AND {z} = 'v'",
    );
  });
});

describe('semantic tokens', () => {
  it('classifies keywords, types, aliases, attributes, params and functions', () => {
    const doc = parse(
      'SELECT {l:isocode} FROM {Language AS l} WHERE COUNT({l:pk}) > 1 AND {l:name} = ?p -- c',
    );
    const tokens = fs.flexSemanticTokens(doc);
    const kinds = new Set(tokens.map((t) => t.type));
    for (const kind of [
      'keyword',
      'class',
      'variable',
      'property',
      'parameter',
      'function',
      'number',
      'comment',
    ]) {
      expect(kinds.has(kind as never), kind).toBe(true);
    }
    for (const [i, t] of tokens.entries()) {
      const next = tokens[i + 1];
      if (next && next.line === t.line)
        expect(t.character + t.length).toBeLessThanOrEqual(next.character);
    }
  });
});

describe('prepareQuery', () => {
  it('drops line comments, substitutes parameters and removes the trailing semicolon', () => {
    const doc = parse('SELECT {pk} FROM {A} -- why\nWHERE {x} = ?v;  ');
    const prepared = fs.prepareQuery(doc, { v: 'abc' });
    expect(prepared.text).toBe("SELECT {pk} FROM {A} \nWHERE {x} = 'abc'");
    expect(prepared.removedLineComments).toBe(1);
  });

  it('keeps unresolved parameters', () => {
    expect(fs.prepareQuery(parse('SELECT {pk} FROM {A} WHERE {x} = ?v')).text).toContain('?v');
  });
});

describe('outline and folding', () => {
  const doc = parse(
    'SELECT {a:pk}\nFROM {A AS a}\nWHERE {a:x} IN ({{\n  SELECT {b:pk}\n  FROM {B AS b}\n}})',
  );

  it('lists the query, its types and nested subselects', () => {
    const [query] = fs.outlineFlex(doc);
    expect(query?.name).toBe('SELECT');
    expect(query?.detail).toBe('A AS a');
    expect(query?.children.map((c) => c.name)).toEqual(['a', 'subselect']);
    expect(query?.children[1]?.children.map((c) => c.name)).toEqual(['b']);
  });

  it('folds subselects', () => {
    expect(fs.foldingFlex(doc).some((f) => f.kind === 'region')).toBe(true);
  });
});
