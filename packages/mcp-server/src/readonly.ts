/**
 * Guards for the query tools. The hAC would run anything, so the MCP server only lets read statements through and
 * never uses commit mode. These checks are a second line of defence next to that; they are intentionally strict.
 */

/** Removes comments and quoted text so that keywords inside strings are not mistaken for statements. */
function stripLiterals(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] as string;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) i += 2;
          else break;
        } else i++;
      }
      i++;
      out += "''";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const WRITE_WORDS =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|call|exec|execute|into|lock|vacuum|shutdown)\b/i;

export class NotReadOnlyError extends Error {}

/** FlexibleSearch: one `SELECT`, no second statement. */
export function assertReadOnlyFlexSearch(query: string): string {
  const stripped = stripLiterals(query)
    .trim()
    .replace(/;+\s*$/, '');
  if (stripped === '') throw new NotReadOnlyError('The query is empty.');
  if (!/^select\b/i.test(stripped))
    throw new NotReadOnlyError('Only SELECT statements are allowed.');
  if (stripped.includes(';')) throw new NotReadOnlyError('Only one statement per call is allowed.');
  return query.trim().replace(/;+\s*$/, '');
}

/** SQL: one `SELECT` (or `WITH … SELECT`), with no write keyword anywhere outside string literals. */
export function assertReadOnlySql(query: string): string {
  const stripped = stripLiterals(query)
    .trim()
    .replace(/;+\s*$/, '');
  if (stripped === '') throw new NotReadOnlyError('The query is empty.');
  if (!/^(select|with)\b/i.test(stripped))
    throw new NotReadOnlyError('Only SELECT statements are allowed.');
  if (stripped.includes(';')) throw new NotReadOnlyError('Only one statement per call is allowed.');
  const word = WRITE_WORDS.exec(stripped);
  if (word) throw new NotReadOnlyError(`"${word[0]}" is not allowed in a read-only query.`);
  return query.trim().replace(/;+\s*$/, '');
}
