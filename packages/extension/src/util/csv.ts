/** RFC 4180 CSV with protection against spreadsheet formula injection (cells come from a database). */

const FORMULA_START = /^[=+@]|^-(?![\d.])/;

function cell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n;]/.test(safe) || safe !== safe.trim() ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [columns.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}

export function toJson(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const objects = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])));
  return JSON.stringify(objects, null, 2);
}
