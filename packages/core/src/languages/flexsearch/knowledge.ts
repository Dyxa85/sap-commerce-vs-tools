export const KEYWORDS = new Set([
  'SELECT',
  'DISTINCT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'BETWEEN',
  'IS',
  'NULL',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'FULL',
  'CROSS',
  'ON',
  'AS',
  'GROUP',
  'BY',
  'ORDER',
  'HAVING',
  'ASC',
  'DESC',
  'UNION',
  'ALL',
  'EXISTS',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'LIMIT',
  'OFFSET',
  'ESCAPE',
]);

export const JOIN_WORDS = new Set(['JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS']);

/** Clause keywords that start a new line when formatting. */
export const CLAUSE_STARTS = new Set(['FROM', 'WHERE', 'HAVING', 'UNION']);

export const KEYWORD_DOCS: Record<string, string> = {
  SELECT:
    'Starts a query. Fields are written in braces: `{alias:attribute}`; `{pk}` is the item primary key.',
  FROM: 'The types to search, in braces: `FROM {Product AS p}`. Every alias needs `AS`. Add `!` to exclude subtypes: `{Product!}`.',
  WHERE: 'Filters the result. Attribute references use braces, parameters use `?name`.',
  JOIN: 'Combines types inside the FROM brace: `{Product AS p JOIN Catalog AS c ON {p:catalog} = {c:pk}}`.',
  'LEFT JOIN': 'Like JOIN but keeps rows without a match on the right side.',
  ON: 'Join condition. The attribute references stay in braces.',
  AS: 'Declares an alias for a type in the FROM brace. The alias is required to be introduced with AS in FlexibleSearch.',
  'ORDER BY': 'Sorts the result: `ORDER BY {p:code} DESC`.',
  'GROUP BY': 'Groups rows for aggregate functions.',
  HAVING: 'Filters groups after GROUP BY.',
  UNION: 'Combines queries. Each query must be wrapped in `{{ … }}` (subselect syntax).',
  LIMIT:
    'Not supported by FlexibleSearch: the hAC appends its own conditions. Limit rows with the max count of the console or `FlexibleSearchQuery#setCount`.',
  DISTINCT: 'Removes duplicate rows.',
};

export const SNIPPETS: { label: string; detail: string; body: string }[] = [
  {
    label: 'SELECT … FROM',
    detail: 'Basic query',
    body: 'SELECT {${1:p}:pk}\nFROM {${2:Product} AS ${1:p}}\nWHERE {${1:p}:${3:code}} = ${4:?code}',
  },
  {
    label: 'SELECT … JOIN',
    detail: 'Query with join',
    body: "SELECT {${1:p}:pk}\nFROM {${2:Product} AS ${1:p}\n  JOIN ${3:CatalogVersion} AS ${4:cv} ON {${1:p}:catalogVersion} = {${4:cv}:pk}}\nWHERE {${4:cv}:version} = ${5:'Staged'}",
  },
  { label: 'Subselect', detail: '{{ … }}', body: '{{\n  SELECT {${1:pk}} FROM {${2:Type}}\n}}' },
];
