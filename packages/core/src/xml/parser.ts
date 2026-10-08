import { LineIndex, type Span } from '../languages/shared/line-index.js';

/**
 * Lenient XML scanner for editor features. Unlike a validating parser it never throws: broken or half-typed
 * documents still yield a tree with positions for every element and attribute.
 */

export interface XmlAttribute {
  name: string;
  /** Decoded value (entities resolved). */
  value: string;
  nameSpan: Span;
  /** Span of the value without the surrounding quotes. */
  valueSpan: Span;
}

export interface XmlElement {
  name: string;
  /** Span of the tag name inside the start tag. */
  nameSpan: Span;
  attributes: XmlAttribute[];
  children: XmlElement[];
  parent?: XmlElement;
  /** Whole element from `<` of the start tag to `>` of the end tag. */
  span: Span;
  /** The start tag `<name …>`. */
  startTag: Span;
  /** The end tag `</name>`; undefined for self-closing or unclosed elements. */
  endTag?: Span;
  selfClosing: boolean;
  /** Concatenated character data directly inside this element (trimmed). */
  text: string;
}

export interface XmlProblem {
  span: Span;
  message: string;
}

export interface XmlDocument {
  text: string;
  lines: LineIndex;
  root?: XmlElement;
  problems: XmlProblem[];
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[\w:.-]/;

export function parseXml(text: string): XmlDocument {
  const problems: XmlProblem[] = [];
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let i = 0;
  const n = text.length;

  const addText = (from: number, to: number): void => {
    const top = stack[stack.length - 1];
    if (top && to > from) top.text += text.slice(from, to);
  };

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      addText(i, n);
      break;
    }
    addText(i, lt);
    i = lt;

    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1) {
        problems.push({
          span: { start: i, end: Math.min(i + 4, n) },
          message: 'Unterminated comment',
        });
        break;
      }
      i = end + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      const stop = end === -1 ? n : end;
      addText(i + 9, stop);
      i = end === -1 ? n : end + 3;
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (text.startsWith('<!', i)) {
      // DOCTYPE with optional internal subset
      let depth = 0;
      let j = i + 2;
      for (; j < n; j++) {
        if (text[j] === '[') depth++;
        else if (text[j] === ']') depth--;
        else if (text[j] === '>' && depth <= 0) break;
      }
      i = Math.min(j + 1, n);
    } else if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i);
      const stop = end === -1 ? n : end + 1;
      const name = text.slice(i + 2, end === -1 ? n : end).trim();
      const matchIndex = findOpen(stack, name);
      if (matchIndex === -1) {
        problems.push({
          span: { start: i, end: stop },
          message: `Unexpected closing tag </${name}>`,
        });
      } else {
        // implicitly close anything left open above the match
        while (stack.length - 1 > matchIndex) {
          const dangling = stack.pop() as XmlElement;
          dangling.span = { start: dangling.startTag.start, end: i };
          problems.push({ span: dangling.nameSpan, message: `<${dangling.name}> is not closed` });
        }
        const el = stack.pop() as XmlElement;
        el.endTag = { start: i, end: stop };
        el.span = { start: el.startTag.start, end: stop };
        el.text = el.text.trim();
      }
      i = stop;
    } else if (NAME_START.test(text[i + 1] ?? '')) {
      i = parseStartTag(text, i, stack, problems, (el) => {
        if (!root) root = el;
      });
    } else {
      // a stray '<' – skip it
      i++;
    }
  }

  while (stack.length > 0) {
    const el = stack.pop() as XmlElement;
    el.span = { start: el.startTag.start, end: n };
    el.text = el.text.trim();
    problems.push({ span: el.nameSpan, message: `<${el.name}> is not closed` });
  }

  return { text, lines: new LineIndex(text), root, problems };
}

function findOpen(stack: readonly XmlElement[], name: string): number {
  for (let k = stack.length - 1; k >= 0; k--) if (stack[k]?.name === name) return k;
  return -1;
}

function parseStartTag(
  text: string,
  start: number,
  stack: XmlElement[],
  problems: XmlProblem[],
  onElement: (el: XmlElement) => void,
): number {
  const n = text.length;
  let j = start + 1;
  const nameStart = j;
  while (j < n && NAME_CHAR.test(text[j] as string)) j++;
  const name = text.slice(nameStart, j);
  const attributes: XmlAttribute[] = [];

  let selfClosing = false;
  let closed = false;
  while (j < n) {
    while (j < n && /\s/.test(text[j] as string)) j++;
    const ch = text[j];
    if (ch === '>') {
      j++;
      closed = true;
      break;
    }
    if (ch === '/' && text[j + 1] === '>') {
      j += 2;
      selfClosing = true;
      closed = true;
      break;
    }
    if (ch === '<') break; // tag was never closed; the next tag starts here
    if (ch !== undefined && NAME_START.test(ch)) {
      const attrStart = j;
      while (j < n && NAME_CHAR.test(text[j] as string)) j++;
      const attrName = text.slice(attrStart, j);
      while (j < n && /\s/.test(text[j] as string)) j++;
      if (text[j] === '=') {
        j++;
        while (j < n && /\s/.test(text[j] as string)) j++;
        const quote = text[j];
        if (quote === '"' || quote === "'") {
          const valueStart = j + 1;
          const end = text.indexOf(quote, valueStart);
          const valueEnd = end === -1 ? n : end;
          attributes.push({
            name: attrName,
            value: decodeEntities(text.slice(valueStart, valueEnd)),
            nameSpan: { start: attrStart, end: attrStart + attrName.length },
            valueSpan: { start: valueStart, end: valueEnd },
          });
          j = end === -1 ? n : end + 1;
          continue;
        }
        // unquoted value: read to whitespace or tag end
        const valueStart = j;
        while (j < n && !/[\s>]/.test(text[j] as string)) j++;
        attributes.push({
          name: attrName,
          value: text.slice(valueStart, j),
          nameSpan: { start: attrStart, end: attrStart + attrName.length },
          valueSpan: { start: valueStart, end: j },
        });
        problems.push({
          span: { start: valueStart, end: j },
          message: `Attribute value of "${attrName}" is not quoted`,
        });
        continue;
      }
      attributes.push({
        name: attrName,
        value: '',
        nameSpan: { start: attrStart, end: attrStart + attrName.length },
        valueSpan: { start: j, end: j },
      });
      continue;
    }
    j++; // junk inside the tag
  }

  const element: XmlElement = {
    name,
    nameSpan: { start: nameStart, end: nameStart + name.length },
    attributes,
    children: [],
    span: { start, end: j },
    startTag: { start, end: j },
    selfClosing,
    text: '',
  };
  const parent = stack[stack.length - 1];
  if (parent) {
    element.parent = parent;
    parent.children.push(element);
  }
  onElement(element);
  if (!closed)
    problems.push({
      span: element.nameSpan,
      message: `Start tag <${name}> is not closed with ">"`,
    });
  if (!selfClosing) stack.push(element);
  return j;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body] ?? match;
  });
}

// ------------------------------------------------------------------ helpers

export function attr(el: XmlElement, name: string): string | undefined {
  return el.attributes.find((a) => a.name === name)?.value;
}

export function attrNode(el: XmlElement, name: string): XmlAttribute | undefined {
  return el.attributes.find((a) => a.name === name);
}

export function childrenNamed(el: XmlElement | undefined, name: string): XmlElement[] {
  return el ? el.children.filter((c) => c.name === name) : [];
}

export function childNamed(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el?.children.find((c) => c.name === name);
}

/** Depth-first walk over an element and all descendants. */
export function* walk(el: XmlElement | undefined): Generator<XmlElement> {
  if (!el) return;
  yield el;
  for (const child of el.children) yield* walk(child);
}

/** Innermost element containing the offset. */
export function elementAt(doc: XmlDocument, offset: number): XmlElement | undefined {
  const root = doc.root;
  if (!root || offset < root.span.start || offset > root.span.end) return undefined;
  let current: XmlElement = root;
  for (;;) {
    const next: XmlElement | undefined = current.children.find(
      (c) => offset >= c.span.start && offset <= c.span.end,
    );
    if (!next) return current;
    current = next;
  }
}
