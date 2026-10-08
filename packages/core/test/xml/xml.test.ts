import { describe, expect, it } from 'vitest';
import { xml } from '../../src/index.js';

const { parseXml, attr, childrenNamed, elementAt, walk } = xml;

describe('lenient XML parser', () => {
  it('builds the tree with attributes and spans', () => {
    const text =
      '<?xml version="1.0"?>\n<!-- c --><a x="1" y=\'2\'>\n  <b/><c k="&amp;&lt;">text</c>\n</a>';
    const doc = parseXml(text);
    expect(doc.problems).toEqual([]);
    expect(doc.root?.name).toBe('a');
    expect(doc.root?.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(attr(doc.root!, 'y')).toBe('2');
    const c = doc.root!.children[1]!;
    expect(attr(c, 'k')).toBe('&<');
    expect(c.text).toBe('text');
    expect(text.slice(c.span.start, c.span.end)).toBe('<c k="&amp;&lt;">text</c>');
    const x = doc.root!.attributes[0]!;
    expect(text.slice(x.valueSpan.start, x.valueSpan.end)).toBe('1');
    expect(text.slice(x.nameSpan.start, x.nameSpan.end)).toBe('x');
  });

  it('handles CDATA, DOCTYPE and processing instructions', () => {
    const doc = parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a><![CDATA[<not-a-tag>]]><b/></a>');
    expect(doc.root?.name).toBe('a');
    expect(doc.root?.text).toBe('<not-a-tag>');
    expect(doc.root?.children).toHaveLength(1);
  });

  it('never throws and still returns a tree for broken input', () => {
    const doc = parseXml(
      '<items><itemtype code="A"><attributes><attribute qualifier="x"\n</itemtype>',
    );
    expect(doc.root?.name).toBe('items');
    expect(doc.problems.length).toBeGreaterThan(0);
    expect([...walk(doc.root)].map((e) => e.name)).toContain('attribute');
  });

  it('reports unquoted attributes, unclosed comments and stray closing tags', () => {
    expect(parseXml('<a x=1/>').problems[0]?.message).toContain('not quoted');
    expect(
      parseXml('<a><!-- oops').problems.some((p) => p.message.includes('Unterminated comment')),
    ).toBe(true);
    expect(parseXml('<a></b></a>').problems[0]?.message).toContain('</b>');
  });

  it('finds the innermost element at an offset', () => {
    const text = '<a><b><c/></b></a>';
    const doc = parseXml(text);
    expect(elementAt(doc, text.indexOf('<c'))?.name).toBe('c');
    expect(elementAt(doc, text.indexOf('<b') + 1)?.name).toBe('b');
    expect(childrenNamed(doc.root, 'b')).toHaveLength(1);
  });

  it('survives random garbage', () => {
    const alphabet = [
      '<',
      '>',
      '/',
      '"',
      "'",
      '=',
      ' ',
      'a',
      'b',
      '!',
      '-',
      '?',
      '[',
      ']',
      '\n',
      '&',
      ';',
      '<a ',
      '</a>',
      '<!--',
      '-->',
    ];
    let seed = 99;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 500; n++) {
      let t = '';
      for (let i = 0, len = Math.floor(rnd() * 60); i < len; i++)
        t += alphabet[Math.floor(rnd() * alphabet.length)];
      const doc = parseXml(t);
      for (const p of doc.problems) {
        expect(p.span.start).toBeGreaterThanOrEqual(0);
        expect(p.span.end).toBeLessThanOrEqual(t.length + 1);
      }
    }
  });
});
