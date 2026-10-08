import { describe, expect, it } from 'vitest';
import { decodeEntities, extractCsrfToken, extractResultSpan } from '../src/index.js';
import { extractImpexDetails } from '../src/hac/html.js';

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('&lt;a&gt; &amp; &quot;x&quot; &#39;y&#39; &#x41;')).toBe(
      `<a> & "x" 'y' A`,
    );
  });

  it('leaves unknown or invalid entities untouched', () => {
    expect(decodeEntities('&unknown; &#99999999;')).toBe('&unknown; &#99999999;');
  });
});

describe('extractCsrfToken', () => {
  it('reads the meta tag', () => {
    expect(extractCsrfToken('<meta name="_csrf" content="abc-123" />')).toBe('abc-123');
  });

  it('does not confuse it with _csrf_header', () => {
    expect(extractCsrfToken('<meta name="_csrf_header" content="X-CSRF-TOKEN" />')).toBeUndefined();
  });
});

describe('extractResultSpan', () => {
  it('reads multi-line attributes and decodes the message', () => {
    const html = `<span id="impexResult" data-level="error"
         data-result="Import has &#39;problems&#39; &amp; more"></span>`;
    expect(extractResultSpan(html, 'impexResult')).toEqual({
      level: 'error',
      message: "Import has 'problems' & more",
    });
  });

  it('returns undefined when absent', () => {
    expect(extractResultSpan('<div></div>', 'impexResult')).toBeUndefined();
  });
});

describe('extractImpexDetails', () => {
  it('reads and decodes the pre block', () => {
    const html = `<div class="box impexResult quiet">\n<pre>\nINSERT x;# unknown attribute &#039;a&#039;\n</pre></div>`;
    expect(extractImpexDetails(html)).toBe("INSERT x;# unknown attribute 'a'");
  });

  it('is undefined when there is no block', () => {
    expect(
      extractImpexDetails('<div class="box impexResult quiet"><pre>  </pre></div>'),
    ).toBeUndefined();
    expect(extractImpexDetails('<p>x</p>')).toBeUndefined();
  });
});
