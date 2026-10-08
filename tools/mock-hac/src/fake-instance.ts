/** Tiny deterministic fake of "what lives in the database" for the mock hAC. */

export interface MockHacData {
  /** Known item types and their rows: column name -> values. Keys are type codes. */
  types: Record<string, { columns: string[]; rows: string[][] }>;
}

export const defaultData: MockHacData = {
  types: {
    Language: {
      columns: ['isocode'],
      rows: [['en'], ['de'], ['fr']],
    },
  },
};

export interface QueryResult {
  query: string | null;
  executionTime: number;
  resultCount: number;
  exception: { message: string } | null;
  resultList: string[][];
  headers: string[];
  rawExecution: boolean;
  dataSourceId: string;
  exceptionStackTrace: string;
  parametersAsString: string;
  catalogVersionsAsString: string;
}

const FLEX_FROM = /\bFROM\s*\{\s*(\w+)/i;
const SQL_FROM = /\bFROM\s+(\w+)/i;
const SQL_TABLES: Record<string, string> = { languages: 'Language' };

export function runQuery(data: MockHacData, form: URLSearchParams): QueryResult {
  const flex = (form.get('flexibleSearchQuery') ?? '').trim();
  const sql = (form.get('sqlQuery') ?? '').trim();
  const raw = flex === '' && sql !== '';
  const maxCount = Math.max(1, Number(form.get('maxCount') ?? '200') || 200);
  const text = raw ? sql : flex;

  const base: QueryResult = {
    query: null,
    executionTime: 0,
    resultCount: 0,
    exception: null,
    resultList: [],
    headers: [],
    rawExecution: raw,
    dataSourceId: form.get('dataSource') ?? 'master',
    exceptionStackTrace: '',
    parametersAsString: '',
    catalogVersionsAsString: '',
  };

  const match = raw ? SQL_FROM.exec(text) : FLEX_FROM.exec(text);
  const typeCode = raw ? SQL_TABLES[(match?.[1] ?? '').toLowerCase()] : match?.[1];
  const type = typeCode ? data.types[typeCode] : undefined;
  if (!text || !type) {
    const message = text
      ? `unknown type or table in query: ${match?.[1] ?? '?'}`
      : 'Flexible search query or raw SQL query is required to perform this operation';
    return { ...base, exception: { message }, exceptionStackTrace: `MockException: ${message}` };
  }

  const rows = type.rows.slice(0, maxCount);
  return {
    ...base,
    query: text,
    executionTime: 1,
    resultCount: rows.length,
    resultList: rows,
    headers: type.columns.map((c) => `P_${c.toUpperCase()}`),
  };
}

export interface ScriptResult {
  executionResult: string;
  outputText: string;
  stacktraceText: string;
}

/** Not a Groovy interpreter: supports `println "…"` and `return <integer expression a*b|a+b>` only. */
export function runGroovy(script: string): ScriptResult {
  if (/\bthrow\b/.test(script)) {
    return {
      executionResult: '',
      outputText: '',
      stacktraceText: 'java.lang.RuntimeException: mock',
    };
  }
  const output = [...script.matchAll(/println\s+["']([^"']*)["']/g)]
    .map((m) => `${m[1]}\n`)
    .join('');
  const ret = /return\s+(\d+)\s*([*+])\s*(\d+)/.exec(script);
  const result = ret ? String(op(Number(ret[1]), ret[2] as '*' | '+', Number(ret[3]))) : 'null';
  return { executionResult: result, outputText: output, stacktraceText: '' };
}

const op = (a: number, o: '*' | '+', b: number): number => (o === '*' ? a * b : a + b);

export interface ImpexVerdict {
  ok: boolean;
  message: string;
}

const HEADER = /^\s*(INSERT_UPDATE|INSERT|UPDATE|REMOVE)\s+(\w+)/i;

/** Checks only that each header names a known type; comments and value lines are accepted. */
export function analyzeImpex(data: MockHacData, script: string): ImpexVerdict {
  for (const line of script.split(/\r?\n/)) {
    const header = HEADER.exec(line);
    if (header && !data.types[header[2] as string]) {
      return {
        ok: false,
        message: `unknown type '${header[2]}' in header '${header[1]} ${header[2]}'`,
      };
    }
  }
  return { ok: true, message: '' };
}
