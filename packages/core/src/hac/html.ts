/** Helpers to read the few facts we need from hAC HTML pages (no DOM available in the extension host). */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return safeCodePoint(parseInt(body.slice(2), 16), match);
    }
    if (body.startsWith('#')) return safeCodePoint(parseInt(body.slice(1), 10), match);
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

/** `<meta name="_csrf" content="…">` */
export function extractCsrfToken(html: string): string | undefined {
  const match = /<meta\s+name="_csrf"\s+content="([^"]+)"/i.exec(html);
  return match?.[1];
}

/** True when the response is (or redirects to) the login page instead of the requested resource. */
export function looksLikeLoginPage(html: string): boolean {
  return (
    html.includes('redirect_detection') ||
    (html.includes('j_spring_security_check') && html.includes('j_username'))
  );
}

export interface ResultSpan {
  level: string;
  message: string;
}

/** Reads `<span id="{id}" data-level="…" data-result="…">` used by the ImpEx pages. */
export function extractResultSpan(html: string, id: string): ResultSpan | undefined {
  const tag = new RegExp(`<span\\b[^>]*\\bid="${id}"[^>]*>`, 'i').exec(html)?.[0];
  if (!tag) return undefined;
  const level = /\bdata-level="([^"]*)"/i.exec(tag)?.[1] ?? '';
  const message = /\bdata-result="([^"]*)"/i.exec(tag)?.[1] ?? '';
  return { level: decodeEntities(level), message: decodeEntities(message) };
}

/** The `<pre>` block of failed imports: unresolved lines annotated with the reason. */
export function extractImpexDetails(html: string): string | undefined {
  const match = /<div[^>]*class="[^"]*\bimpexResult\b[^"]*"[^>]*>\s*<pre>([\s\S]*?)<\/pre>/i.exec(
    html,
  );
  const text = match?.[1] ? decodeEntities(match[1]).trim() : '';
  return text === '' ? undefined : text;
}
