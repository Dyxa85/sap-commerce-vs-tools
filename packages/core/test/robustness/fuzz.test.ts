import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  analyzeItems,
  beans,
  buildTypeSystem,
  complete,
  encodeSemanticTokens,
  flexsearch,
  folding,
  formatImpex,
  hover,
  loadPlatform,
  outline,
  parseImpex,
  parseItemsXml,
  processes,
  semanticTokens,
  spring,
  xml,
  openItemsDocument,
  completeItems,
  hoverItems,
  outlineItems,
  foldingXml,
} from '../../src/index.js';

const fixture = fileURLToPath(new URL('../../../test-fixtures/hybris', import.meta.url));
const read = (rel: string): string => readFileSync(join(fixture, rel), 'utf8');

/** Small deterministic generator, so a failing case can be reproduced from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SNIPPETS = [
  '"',
  "'",
  '<',
  '>',
  '</',
  '<!--',
  '-->',
  '<![CDATA[',
  ']]>',
  '&',
  '&amp;',
  '{',
  '}',
  '{{',
  '}}',
  '[',
  ']',
  '(',
  ')',
  ';',
  ',',
  '=',
  '$',
  '$macro=',
  '#',
  '\n',
  '\r\n',
  '\t',
  '\u0000',
  ' ',
  'INSERT_UPDATE ',
  'UPDATE ',
  'REMOVE ',
  '$START_USERRIGHTS',
  'SELECT ',
  ' FROM ',
  ' WHERE ',
  ' UNION ',
  ' AS ',
  '?',
  ':',
  '\\',
  '😀',
  '﻿',
];

function mutate(text: string, random: () => number): string {
  let out = text;
  const rounds = 1 + Math.floor(random() * 4);
  for (let i = 0; i < rounds; i++) {
    const at = Math.floor(random() * (out.length + 1));
    switch (Math.floor(random() * 5)) {
      case 0: // delete a range
        out = out.slice(0, at) + out.slice(at + Math.floor(random() * 40));
        break;
      case 1: // insert a special token
        out =
          out.slice(0, at) +
          (SNIPPETS[Math.floor(random() * SNIPPETS.length)] as string) +
          out.slice(at);
        break;
      case 2: // duplicate a range
        out = out.slice(0, at) + out.slice(at, at + Math.floor(random() * 80)) + out.slice(at);
        break;
      case 3: // truncate
        out = out.slice(0, at);
        break;
      default: // random printable junk
        out =
          out.slice(0, at) +
          String.fromCharCode(32 + Math.floor(random() * 95)).repeat(1 + Math.floor(random() * 3)) +
          out.slice(at);
    }
  }
  return out;
}

const ITERATIONS = Number(process.env['FUZZ_ITERATIONS'] ?? 250);

function fuzz(
  name: string,
  samples: string[],
  run: (text: string, random: () => number) => void,
): void {
  it(`${name} survives ${ITERATIONS} mutations of each sample`, () => {
    for (const [index, sample] of samples.entries()) {
      for (let seed = 1; seed <= ITERATIONS; seed++) {
        const random = rng(seed * 7919 + index);
        const text = mutate(sample, random);
        try {
          run(text, random);
        } catch (err) {
          throw new Error(
            `${name}: sample ${index}, seed ${seed}: ${(err as Error).stack}\n--- input ---\n${JSON.stringify(text)}`,
            { cause: err },
          );
        }
      }
    }
  });
}

const offsets = (text: string, random: () => number): number[] => [
  0,
  text.length,
  ...Array.from({ length: 6 }, () => Math.floor(random() * (text.length + 1))),
];

describe('robustness: mutated input never throws', () => {
  fuzz('ImpEx', [read('bin/custom/acmecore/resources/impex/badges.impex')], (text, random) => {
    const doc = parseImpex(text);
    analyze(doc);
    outline(doc);
    folding(doc);
    encodeSemanticTokens(semanticTokens(doc));
    const formatted = formatImpex(doc);
    for (const o of offsets(text, random)) {
      complete(doc, o);
      hover(doc, o);
    }
    // formatting must not corrupt the document: applying it yields text that parses again
    const edits = [...formatted].sort((a, b) => b.span.start - a.span.start);
    let applied = text;
    for (const e of edits)
      applied = applied.slice(0, e.span.start) + e.newText + applied.slice(e.span.end);
    parseImpex(applied);
  });

  fuzz(
    'FlexibleSearch',
    [
      read('bin/custom/acmecore/resources/impex/badges-by-tier.flexibleSearch'),
      'SELECT {p:pk}, {p:code[en]} FROM {Product AS p JOIN Catalog AS c ON {p:catalog}={c:pk}} WHERE {p:code} LIKE ?code ORDER BY {p:code} ASC',
      'SELECT {pk} FROM {Product} WHERE {pk} IN ({{ SELECT {pk} FROM {Customer} }}) UNION SELECT 1',
    ],
    (text, random) => {
      const doc = flexsearch.parseFlexSearch(text);
      flexsearch.analyzeFlexSearch(doc);
      flexsearch.formatFlexSearch(doc);
      flexsearch.prepareQuery(doc, { code: 'x', n: '1' });
      for (const o of offsets(text, random)) {
        flexsearch.completeFlex(doc, o);
        flexsearch.hoverFlex(doc, o);
      }
    },
  );

  it('XML features survive mutated items, beans, Spring and process files', async () => {
    const project = await loadPlatform(fixture);
    const types = await buildTypeSystem(project);
    const beanSystem = await beans.buildBeanSystem(project);
    const springSystem = await spring.buildSpringSystem(project);
    const samples = {
      items: read('bin/custom/acmecore/resources/acmecore-items.xml'),
      beans: read('bin/custom/acmecore/resources/acmecore-beans.xml'),
      spring: read('bin/custom/acmefacades/resources/acmefacades-spring.xml'),
      process: read('bin/custom/acmeprocess/resources/processes/badge-award-process.xml'),
    };
    for (let seed = 1; seed <= ITERATIONS; seed++) {
      for (const [kind, sample] of Object.entries(samples)) {
        const random = rng(seed * 104729 + kind.length);
        const text = mutate(sample, random);
        try {
          xml.parseXml(text);
          for (const o of offsets(text, random)) xml.xmlContextAt(xml.parseXml(text), o);
          if (kind === 'items') {
            const file = parseItemsXml(text, '/x/acme-items.xml', 'acme');
            analyzeItems(file, types);
            const doc = openItemsDocument(text, types);
            outlineItems(doc.xml);
            foldingXml(doc.xml);
            for (const o of offsets(text, random)) {
              completeItems(doc, o);
              hoverItems(doc, o);
            }
          } else if (kind === 'beans') {
            const file = beans.parseBeansXml(text, '/x/acme-beans.xml', 'acme');
            beans.analyzeBeans(file, beanSystem);
            const doc = beans.openBeansDocument(text, beanSystem);
            beans.outlineBeans(doc.xml);
            for (const o of offsets(text, random)) {
              beans.completeBeans(doc, o);
              beans.hoverBeans(doc, o);
            }
          } else if (kind === 'spring') {
            const file = spring.parseSpringXml(text, '/x/acme-spring.xml', 'acme');
            spring.analyzeSpring(file, springSystem);
            const doc = spring.openSpringDocument(text, springSystem);
            spring.outlineSpring(doc.xml);
            for (const o of offsets(text, random)) {
              spring.completeSpring(doc, o);
              spring.hoverSpring(doc, o);
              spring.definitionSpring(doc, o);
            }
          } else {
            const def = processes.parseProcess(text);
            if (def) {
              processes.analyzeProcess(def);
              processes.processGraph(def);
              for (const o of offsets(text, random)) {
                processes.completeProcess(def, o);
                processes.processTargetAt(def, o);
              }
            }
          }
        } catch (err) {
          throw new Error(
            `${kind}, seed ${seed}: ${(err as Error).stack}\n--- input ---\n${JSON.stringify(text)}`,
            { cause: err },
          );
        }
      }
    }
    expect(true).toBe(true);
  });

  it('formatting an unmutated ImpEx file twice changes nothing the second time', () => {
    const text = read('bin/custom/acmecore/resources/impex/badges.impex');
    const once = apply(text);
    expect(apply(once)).toBe(once);
    function apply(t: string): string {
      let out = t;
      const edits = [...formatImpex(parseImpex(t))].sort((a, b) => b.span.start - a.span.start);
      for (const e of edits) out = out.slice(0, e.span.start) + e.newText + out.slice(e.span.end);
      return out;
    }
  });
});
