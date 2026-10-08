import { elementAt, type XmlDocument, type XmlElement, type XmlAttribute } from './parser.js';

/** Where the cursor is inside an XML document, for completion and hover. */
export type XmlContext =
  | {
      kind: 'attribute-value';
      element: XmlElement;
      attribute: XmlAttribute | { name: string };
      prefix: string;
      start: number;
      end: number;
    }
  | {
      kind: 'attribute-name';
      element: XmlElement | { name: string; attributes: XmlAttribute[] };
      prefix: string;
      start: number;
    }
  | { kind: 'element-name'; parent: XmlElement | undefined; prefix: string; start: number }
  | { kind: 'content'; parent: XmlElement | undefined };

/**
 * Works on the raw text before the cursor so that it also handles half-typed tags
 * (`<attribute type="Pro|`), which a tree-based lookup cannot.
 */
export function xmlContextAt(doc: XmlDocument, offset: number): XmlContext {
  const text = doc.text;
  // start of the markup that is still open at the cursor
  const lt = text.lastIndexOf('<', offset - 1);
  const gt = text.lastIndexOf('>', offset - 1);
  const insideTag = lt !== -1 && lt > gt && !text.startsWith('<!--', lt) && text[lt + 1] !== '/';

  if (insideTag) {
    const tag = text.slice(lt + 1, offset);
    const nameMatch = /^([A-Za-z_:][\w:.-]*)/.exec(tag);
    if (!nameMatch)
      return { kind: 'element-name', parent: parentAt(doc, lt), prefix: '', start: lt + 1 };
    const name = nameMatch[1] as string;
    if (tag.length === name.length) {
      return { kind: 'element-name', parent: parentAt(doc, lt), prefix: name, start: lt + 1 };
    }
    // inside the start tag: are we in a quoted attribute value?
    const rest = tag.slice(name.length);
    const value = /([A-Za-z_:][\w:.-]*)\s*=\s*(["'])((?:(?!\2)[^])*)$/.exec(rest);
    const element = elementAt(doc, lt + 1) ?? undefined;
    const stub = { name, attributes: element?.attributes ?? [] };
    if (value) {
      const attrName = value[1] as string;
      const prefix = value[3] as string;
      const attribute = element?.attributes.find((a) => a.name === attrName) ?? { name: attrName };
      return {
        kind: 'attribute-value',
        element: (element?.nameSpan.start === lt + 1
          ? element
          : (stub as unknown as XmlElement)) as XmlElement,
        attribute,
        prefix,
        start: offset - prefix.length,
        end: offset,
      };
    }
    const namePrefix = /([A-Za-z_:][\w:.-]*)?$/.exec(rest)?.[1] ?? '';
    return {
      kind: 'attribute-name',
      element: stub,
      prefix: namePrefix,
      start: offset - namePrefix.length,
    };
  }

  return { kind: 'content', parent: parentAt(doc, offset) };
}

/** The element whose content contains `offset` (not counting a start tag that begins at the cursor). */
function parentAt(doc: XmlDocument, offset: number): XmlElement | undefined {
  const el = elementAt(doc, offset);
  if (!el) return undefined;
  // inside the start tag or end tag itself → the element is not the parent
  if (offset <= el.startTag.end - 1 && offset >= el.startTag.start) return el.parent;
  if (el.endTag && offset >= el.endTag.start) return el.parent;
  return el;
}
