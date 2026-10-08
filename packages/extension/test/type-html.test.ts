import { describe, expect, it } from 'vitest';
import { renderType, type WireType } from '../src/ui/type-html.js';

const ctx = { nonce: 'N0NCE', cspSource: 'vscode-webview://x' };
const evil = '<img src=x onerror=alert(1)>"\'&';

const base: WireType = {
  name: 'Product',
  kind: 'item',
  extends: 'GenericItem',
  ancestors: ['GenericItem', 'Item'],
  subtypes: ['Variant'],
  extensions: ['catalog'],
  deployment: { table: 'products', typecode: 1 },
  attributes: [
    {
      qualifier: 'code',
      type: 'java.lang.String',
      declaredIn: 'Product',
      own: true,
      localized: false,
      unique: true,
      optional: false,
    },
    {
      qualifier: 'catalogVersion',
      type: 'localized:CatalogVersion',
      declaredIn: 'Product',
      own: true,
      localized: true,
    },
    {
      qualifier: 'owner',
      type: 'Collection<Item>',
      declaredIn: 'Item',
      own: false,
      localized: false,
    },
  ],
};
const known = new Set(['Product', 'GenericItem', 'Item', 'Variant', 'CatalogVersion']);

describe('renderType', () => {
  const html = renderType(base, known, ctx);

  it('uses a strict CSP bound to the nonce', () => {
    expect(html).toContain("script-src 'nonce-N0NCE'");
    expect(html).not.toMatch(/<script(?![^>]*nonce="N0NCE")/);
  });

  it('shows the chain, subtypes, meta data and flags', () => {
    expect(html).toContain('<b>Product</b>');
    expect(html).toContain('data-type="GenericItem"');
    expect(html).toContain('1 direct subtype');
    expect(html).toContain('Table <code>products</code>, typecode 1');
    expect(html).toContain('mandatory');
    expect(html).toContain('unique');
  });

  it('links only types that exist, also inside generics and localized: prefixes', () => {
    expect(html).toContain('data-type="CatalogVersion"');
    expect(html).toContain('Collection&lt;<a href="#" data-type="Item">Item</a>&gt;');
    expect(html).not.toContain('data-type="java.lang.String"');
  });

  it('marks inherited attributes so they can be filtered', () => {
    expect(html).toContain('class="inherited"');
    expect(html).toContain('class="own"');
  });

  it('escapes every piece of data coming from files', () => {
    const out = renderType(
      {
        ...base,
        name: evil,
        description: evil,
        extensions: [evil],
        attributes: [
          {
            qualifier: evil,
            type: evil,
            declaredIn: evil,
            own: true,
            localized: false,
            description: evil,
          },
        ],
        location: {
          uri: 'file:///x"onclick="y',
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
      new Set([evil]),
      ctx,
    );
    expect(out).not.toContain('<img src=x');
    expect(out).not.toContain('onclick="y');
  });

  it('renders enums, collections and incomplete hints', () => {
    const e = renderType(
      {
        name: 'Status',
        kind: 'enum',
        ancestors: [],
        subtypes: [],
        attributes: [],
        extensions: ['core'],
        enumValues: [{ code: 'NEW', description: 'fresh' }],
      },
      new Set(),
      ctx,
    );
    expect(e).toContain('<code>NEW</code>');
    const c = renderType(
      {
        name: 'LList',
        kind: 'collection',
        elementType: 'Language',
        ancestors: [],
        subtypes: [],
        attributes: [],
        extensions: [],
      },
      new Set(['Language']),
      ctx,
    );
    expect(c).toContain('data-type="Language"');
    expect(renderType({ ...base, incomplete: true }, known, ctx)).toContain('may be incomplete');
  });
});
