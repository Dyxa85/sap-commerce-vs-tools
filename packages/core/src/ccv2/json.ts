/** A JSON syntax tree that remembers where every value is, so a tree view can jump to it. */
export type JsonNode =
  | { type: 'object'; start: number; end: number; entries: JsonEntry[] }
  | { type: 'array'; start: number; end: number; items: JsonNode[] }
  | { type: 'string'; start: number; end: number; value: string }
  | { type: 'number'; start: number; end: number; value: number }
  | { type: 'boolean'; start: number; end: number; value: boolean }
  | { type: 'null'; start: number; end: number; value: null };

export interface JsonEntry {
  key: string;
  keyStart: number;
  value: JsonNode;
}

export interface JsonResult {
  root?: JsonNode;
  error?: { message: string; offset: number };
}

class JsonError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

const MAX_DEPTH = 64;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Strict JSON (no comments, no trailing commas) with offsets. Never throws. */
export function parseJson(input: string): JsonResult {
  const text = input.charCodeAt(0) === 0xfeff ? ` ${input.slice(1)}` : input; // keep offsets
  let i = 0;

  const ws = (): void => {
    while (i < text.length && ' \t\r\n'.includes(text[i] as string)) i++;
  };
  const fail = (message: string): never => {
    throw new JsonError(message, i);
  };

  const string = (): { value: string; start: number; end: number } => {
    const start = i;
    i++; // opening quote
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') i += 2;
      else if (c === '"') {
        i++;
        try {
          return { value: JSON.parse(text.slice(start, i)) as string, start, end: i };
        } catch {
          i = start;
          return fail('Invalid string');
        }
      } else if (c === '\n') return fail('Unterminated string');
      else i++;
    }
    return fail('Unterminated string');
  };

  const value = (depth: number): JsonNode => {
    if (depth > MAX_DEPTH) fail('Nested too deeply');
    ws();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      const entries: JsonEntry[] = [];
      ws();
      if (text[i] === '}') {
        i++;
        return { type: 'object', start, end: i, entries };
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('Expected a property name');
        const key = string();
        ws();
        if (text[i] !== ':') fail('Expected ":"');
        i++;
        entries.push({ key: key.value, keyStart: key.start, value: value(depth + 1) });
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return { type: 'object', start, end: i, entries };
        }
        fail('Expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const items: JsonNode[] = [];
      ws();
      if (text[i] === ']') {
        i++;
        return { type: 'array', start, end: i, items };
      }
      for (;;) {
        items.push(value(depth + 1));
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return { type: 'array', start, end: i, items };
        }
        fail('Expected "," or "]"');
      }
    }
    if (c === '"') {
      const s = string();
      return { type: 'string', start: s.start, end: s.end, value: s.value };
    }
    for (const [word, v] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return (
          v === null
            ? { type: 'null', start, end: i, value: null }
            : { type: 'boolean', start, end: i, value: v }
        ) as JsonNode;
      }
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m) {
      i += m[0].length;
      return { type: 'number', start, end: i, value: Number(m[0]) };
    }
    return fail('Unexpected character');
  };

  try {
    const root = value(0);
    ws();
    if (i < text.length) fail('Unexpected content after the JSON value');
    return { root };
  } catch (err) {
    if (err instanceof JsonError) return { error: { message: err.message, offset: err.offset } };
    return { error: { message: 'Invalid JSON', offset: i } };
  }
}
