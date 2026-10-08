import type { FlexDocument } from './model.js';

/**
 * The hAC console cannot bind parameters, so `?name` placeholders are replaced by SQL literals before the query
 * is sent. Numbers, quoted strings, NULL and booleans are used as typed, everything else is quoted.
 */
export function toSqlLiteral(input: string): string {
  const value = input.trim();
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  if (/^(null|true|false)$/i.test(value)) return value.toUpperCase();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

export function substituteParameters(
  doc: FlexDocument,
  values: Readonly<Record<string, string>>,
): string {
  let out = doc.text;
  for (const param of [...doc.params].sort((a, b) => b.span.start - a.span.start)) {
    const value = values[param.name];
    if (value === undefined) continue;
    out = out.slice(0, param.span.start) + toSqlLiteral(value) + out.slice(param.span.end);
  }
  return out;
}

export interface PreparedQuery {
  /** Text to send to the hAC. */
  text: string;
  /** `--` comments that were removed because they would swallow the generated SQL. */
  removedLineComments: number;
}

/**
 * Makes a query safe to send: substitutes parameters, drops `--` line comments (they break the hAC), and removes a
 * trailing semicolon (which also breaks it).
 */
export function prepareQuery(
  doc: FlexDocument,
  values: Readonly<Record<string, string>> = {},
): PreparedQuery {
  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [];
  let removed = 0;
  for (const t of doc.tokens)
    if (t.kind === 'line-comment') {
      edits.push({ start: t.span.start, end: t.span.end, text: '' });
      removed++;
    }
  for (const p of doc.params) {
    const value = values[p.name];
    if (value !== undefined)
      edits.push({ start: p.span.start, end: p.span.end, text: toSqlLiteral(value) });
  }
  let out = doc.text;
  for (const e of edits.sort((a, b) => b.start - a.start))
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  out = out.trim().replace(/;\s*$/, '').trim();
  return { text: out, removedLineComments: removed };
}
