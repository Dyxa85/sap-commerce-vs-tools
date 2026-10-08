import { describe, expect, it } from 'vitest';
import { History, type KeyValueStore } from '../src/history.js';
import { toCsv, toJson } from '../src/util/csv.js';
import { redact } from '../src/util/redact.js';

describe('csv', () => {
  it('quotes separators, quotes and newlines', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x,y', 'he said "hi"'],
          ['line1\nline2', 'plain'],
        ],
      ),
    ).toBe('a,b\r\n"x,y","he said ""hi"""\r\n"line1\nline2",plain\r\n');
  });

  it('neutralises spreadsheet formulas but keeps negative numbers', () => {
    const csv = toCsv(['v'], [['=1+1'], ['+cmd'], ['@sum'], ['-cmd'], ['-5'], ['-0.5']]);
    expect(csv.split('\r\n')).toEqual(['v', "'=1+1", "'+cmd", "'@sum", "'-cmd", '-5', '-0.5', '']);
  });

  it('exports JSON objects by column', () => {
    expect(JSON.parse(toJson(['a', 'b'], [['1', '2']]))).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('redact', () => {
  it('masks known secrets and form/header patterns', () => {
    const text = 'pw=hunter2 j_password=hunter2&x=1 X-CSRF-TOKEN: abcdefghijklmnopqrstuv';
    const out = redact(text, ['hunter2']);
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('abcdefghijklmnopqrstuv');
  });

  it('ignores very short secrets to avoid mangling text', () => {
    expect(redact('a b c', ['a'])).toBe('a b c');
  });
});

describe('History', () => {
  function memoryStore(): KeyValueStore {
    const data = new Map<string, unknown>();
    return {
      get: <T>(key: string, def: T) => (data.has(key) ? (data.get(key) as T) : def),
      update: async (key, value) => void data.set(key, value),
    };
  }

  it('keeps newest first, de-duplicates and limits', async () => {
    const h = new History(memoryStore(), 3);
    for (const [i, text] of ['a', 'b', 'c', 'a', 'd'].entries()) {
      await h.add({ kind: 'sql', text, connection: 'x', at: i });
    }
    expect(h.list().map((e) => e.text)).toEqual(['d', 'a', 'c']);
  });

  it('filters by kind and clears', async () => {
    const h = new History(memoryStore());
    await h.add({ kind: 'sql', text: 's', connection: 'x', at: 1 });
    await h.add({ kind: 'groovy', text: 'g', connection: 'x', at: 2 });
    expect(h.list('groovy')).toHaveLength(1);
    await h.clear();
    expect(h.list()).toEqual([]);
  });
});
