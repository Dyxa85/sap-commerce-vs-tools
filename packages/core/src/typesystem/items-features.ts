import type { CompletionEntry } from '../languages/shared/completion.js';
import type { Span } from '../languages/shared/line-index.js';
import type { SchemaLocation } from '../languages/shared/schema.js';
import {
  attr,
  parseXml,
  walk,
  xmlContextAt,
  type XmlAttribute,
  type XmlDocument,
  type XmlElement,
} from '../xml/index.js';
import { ITEMS_SCHEMA, JAVA_TYPES } from './items-schema.js';
import type { TypeSystem } from './system.js';

/** An open items.xml: its XML tree plus the surrounding type system. */
export interface ItemsDocument {
  xml: XmlDocument;
  ts: TypeSystem;
}

export function openItemsDocument(text: string, ts: TypeSystem): ItemsDocument {
  return { xml: parseXml(text), ts };
}

// ------------------------------------------------------------------ completion

const SNIPPETS: Record<string, { label: string; body: string }> = {
  itemtype: {
    label: 'itemtype',
    body: 'itemtype code="${1:MyType}" extends="${2:GenericItem}" autocreate="true" generate="true">\n  <deployment table="${3:mytypes}" typecode="${4:10001}"/>\n  <attributes>\n    $0\n  </attributes>\n</itemtype>',
  },
  attribute: {
    label: 'attribute',
    body: 'attribute qualifier="${1:name}" type="${2:java.lang.String}">\n  <persistence type="property"/>\n  <modifiers optional="${3:true}"/>\n</attribute>',
  },
  enumtype: {
    label: 'enumtype',
    body: 'enumtype code="${1:MyEnum}" autocreate="true" generate="true" dynamic="false">\n  <value code="${2:VALUE}"/>\n</enumtype>',
  },
  relation: {
    label: 'relation',
    body: 'relation code="${1:A2BRelation}" localized="false" autocreate="true" generate="true">\n  <sourceElement type="${2:A}" qualifier="${3:bs}" cardinality="many"/>\n  <targetElement type="${4:B}" qualifier="${5:as}" cardinality="many"/>\n</relation>',
  },
};

export function completeItems(doc: ItemsDocument, offset: number): CompletionEntry[] {
  const context = xmlContextAt(doc.xml, offset);
  const { ts } = doc;

  if (context.kind === 'attribute-value') {
    const elementName = context.element.name;
    const spec = ITEMS_SCHEMA[elementName]?.attributes[context.attribute.name];
    const replace = { start: context.start, end: context.end };
    if (spec?.values)
      return spec.values.map((v) => ({ label: v, kind: 'value' as const, replace }));
    if (spec?.kind === 'type') {
      const entries: CompletionEntry[] = [];
      const itemsOnly = context.attribute.name === 'extends';
      for (const name of itemsOnly ? [...ts.items.keys()] : ts.typeNames()) {
        entries.push({
          label: name,
          kind: 'type',
          detail: ts.kindOf(name),
          documentation: ts.typeDoc(name),
          replace,
          sortText: `1${name}`,
        });
      }
      if (!itemsOnly) {
        for (const name of [...ts.collections.keys(), ...ts.maps.keys()])
          entries.push({ label: name, kind: 'type', replace, sortText: `2${name}` });
        for (const name of JAVA_TYPES)
          entries.push({
            label: name,
            kind: 'type',
            detail: 'Java type',
            replace,
            sortText: `0${name}`,
          });
        if (elementName === 'attribute') {
          for (const name of [
            'java.lang.String',
            'java.lang.Boolean',
            'java.lang.Integer',
            'java.util.Date',
          ]) {
            entries.push({
              label: `localized:${name}`,
              kind: 'type',
              detail: 'localized value',
              replace,
              sortText: `0z${name}`,
            });
          }
        }
      }
      return entries;
    }
    return [];
  }

  if (context.kind === 'attribute-name') {
    const spec = ITEMS_SCHEMA[context.element.name];
    if (!spec) return [];
    const used = new Set(context.element.attributes.map((a) => a.name));
    return Object.entries(spec.attributes)
      .filter(([name]) => !used.has(name))
      .map(([name, s]) => ({
        label: name,
        kind: 'property' as const,
        insertText: s.values ? `${name}="\${1|${s.values.join(',')}|}"` : `${name}="$1"`,
        snippet: true,
        replace: { start: context.start, end: offset },
      }));
  }

  const parentName = context.kind === 'element-name' ? context.parent?.name : context.parent?.name;
  const children = parentName
    ? ITEMS_SCHEMA[parentName]?.children
    : doc.xml.root
      ? undefined
      : ['items'];
  if (!children) return [];
  const prefix = context.kind === 'element-name' ? context.prefix : '';
  const start = context.kind === 'element-name' ? context.start : offset;
  return children
    .filter((name) => name.startsWith(prefix))
    .map((name) => {
      const snippet = SNIPPETS[name];
      return {
        label: name,
        kind: 'snippet' as const,
        insertText: snippet ? snippet.body : elementBody(name),
        snippet: true,
        replace: { start, end: offset },
      };
    });
}

// ------------------------------------------------------------------ navigation & hover

const TYPE_ATTRIBUTES = new Set([
  'extends',
  'type',
  'elementtype',
  'argumenttype',
  'returntype',
  'metatype',
]);

interface TypeReference {
  name: string;
  span: Span;
  element: XmlElement;
  attribute: XmlAttribute;
}

/** The type name under the cursor inside `type="Collection<Foo>"`, `extends="Foo"`, … */
export function typeReferenceAt(doc: ItemsDocument, offset: number): TypeReference | undefined {
  for (const el of walk(doc.xml.root)) {
    if (offset < el.startTag.start || offset > el.startTag.end) continue;
    for (const a of el.attributes) {
      if (!TYPE_ATTRIBUTES.has(a.name) || offset < a.valueSpan.start || offset > a.valueSpan.end)
        continue;
      // scan the raw text (offsets must match the document); blank out entities such as &lt; so they are not read as words
      const text = doc.xml.text
        .slice(a.valueSpan.start, a.valueSpan.end)
        .replace(/&[#\w]+;/g, (e) => ' '.repeat(e.length));
      const rel = offset - a.valueSpan.start;
      for (const m of text.matchAll(/[A-Za-z_$][\w$.]*/g)) {
        const start = m.index ?? 0;
        if (rel >= start && rel <= start + m[0].length && m[0] !== 'localized') {
          return {
            name: m[0],
            span: {
              start: a.valueSpan.start + start,
              end: a.valueSpan.start + start + m[0].length,
            },
            element: el,
            attribute: a,
          };
        }
      }
    }
  }
  return undefined;
}

/** `qualifier` of the attribute under the cursor and the type it belongs to. */
function attributeAt(
  doc: ItemsDocument,
  offset: number,
):
  | { qualifier: string; typeName: string; parent?: string; span: Span; element: XmlElement }
  | undefined {
  for (const el of walk(doc.xml.root)) {
    if (el.name !== 'attribute') continue;
    const q = el.attributes.find((a) => a.name === 'qualifier');
    if (!q || offset < q.valueSpan.start || offset > q.valueSpan.end) continue;
    const owner = el.parent?.parent?.name === 'itemtype' ? el.parent.parent : undefined;
    const typeName = owner ? attr(owner, 'code') : undefined;
    if (owner && typeName) {
      return {
        qualifier: q.value,
        typeName: typeName.trim(),
        parent: attr(owner, 'extends')?.trim(),
        span: q.valueSpan,
        element: el,
      };
    }
  }
  return undefined;
}

export function definitionItems(doc: ItemsDocument, offset: number): SchemaLocation | undefined {
  const reference = typeReferenceAt(doc, offset);
  if (reference) return doc.ts.locate(reference.name);
  const attribute = attributeAt(doc, offset);
  if (attribute) {
    // go to the declaration this attribute redeclares / overrides
    const info = findAttribute(doc, attribute);
    const first = info?.definitions[0];
    return first ? doc.ts.locationOfSpan(first.source) : undefined;
  }
  return undefined;
}

export function hoverItems(
  doc: ItemsDocument,
  offset: number,
): { span: Span; markdown: string } | undefined {
  const reference = typeReferenceAt(doc, offset);
  if (reference) {
    const kind = doc.ts.kindOf(reference.name);
    if (!kind) return { span: reference.span, markdown: `**${reference.name}** – unknown type` };
    const info = doc.ts.typeDoc(reference.name);
    return {
      span: reference.span,
      markdown: `**${doc.ts.canonicalName(reference.name)}** (${kind})${info ? `\n\n${info}` : ''}`,
    };
  }
  const attribute = attributeAt(doc, offset);
  if (attribute) {
    const info = findAttribute(doc, attribute);
    if (!info) return undefined;
    const d = info.def;
    const flags = [
      d.unique ? 'unique' : '',
      d.optional === false ? 'mandatory' : '',
      d.localized ? 'localized' : '',
      d.write === false ? 'read-only' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      span: attribute.span,
      markdown: `**${info.qualifier}** – \`${d.type}\`${flags ? `\n\n${flags}` : ''}${d.description ? `\n\n${d.description}` : ''}\n\nDeclared in \`${info.declaredIn}\`${info.definitions.length > 1 ? ` (${info.definitions.length} definitions)` : ''}`,
    };
  }
  // element / attribute documentation
  const el = (() => {
    for (const e of walk(doc.xml.root))
      if (offset >= e.nameSpan.start && offset <= e.nameSpan.end) return e;
    return undefined;
  })();
  return el && ITEMS_SCHEMA[el.name]
    ? {
        span: el.nameSpan,
        markdown: `**<${el.name}>**\n\nAttributes: ${
          Object.keys(ITEMS_SCHEMA[el.name]?.attributes ?? {})
            .map((a) => `\`${a}\``)
            .join(', ') || '–'
        }`,
      }
    : undefined;
}

/** All places in the loaded items files that refer to a type (supertype, attribute type, element type, relation end). */
export function usagesOfType(ts: TypeSystem, typeName: string): SchemaLocation[] {
  const canonical = ts.canonicalName(typeName);
  if (!canonical) return [];
  const out: SchemaLocation[] = [];
  const add = (file: string, span: Span): void => {
    const loc = ts.locationOfSpan({ file, extension: '', span, nameSpan: span }, span);
    if (loc) out.push(loc);
  };
  const words = (text: string, base: number, file: string, span: Span): void => {
    for (const m of text.matchAll(/[A-Za-z_$][\w$.]*/g)) {
      if (m[0] === canonical)
        add(file, { start: base + (m.index ?? 0), end: base + (m.index ?? 0) + m[0].length });
    }
    void span;
  };
  for (const file of ts.files) {
    for (const t of file.itemTypes) {
      if (t.extends === canonical && t.extendsSpan) add(file.file, t.extendsSpan);
      for (const a of t.attributes)
        words(
          file.text.slice(a.typeSpan.start, a.typeSpan.end),
          a.typeSpan.start,
          file.file,
          a.typeSpan,
        );
    }
    for (const c of file.collectionTypes)
      words(c.elementType, c.elementTypeSpan.start, file.file, c.elementTypeSpan);
    for (const r of file.relations) {
      if (r.sourceElement.type === canonical) add(file.file, r.sourceElement.typeSpan);
      if (r.targetElement.type === canonical) add(file.file, r.targetElement.typeSpan);
    }
  }
  return out;
}

// ------------------------------------------------------------------ structure

export interface ItemsSymbol {
  name: string;
  detail?: string;
  kind: 'itemtype' | 'enum' | 'relation' | 'collection' | 'map' | 'attribute' | 'value' | 'group';
  span: Span;
  selection: Span;
  children: ItemsSymbol[];
}

export function outlineItems(xml: XmlDocument): ItemsSymbol[] {
  const nameOf = (el: XmlElement, attrName: string): { text: string; span: Span } | undefined => {
    const a = el.attributes.find((x) => x.name === attrName);
    return a ? { text: a.value.trim(), span: a.valueSpan } : undefined;
  };
  const build = (el: XmlElement): ItemsSymbol | undefined => {
    switch (el.name) {
      case 'itemtype': {
        const code = nameOf(el, 'code');
        if (!code) return undefined;
        const attributes = el.children
          .filter((c) => c.name === 'attributes')
          .flatMap((c) => c.children.filter((a) => a.name === 'attribute'))
          .map(build)
          .filter((s): s is ItemsSymbol => !!s);
        return {
          name: code.text,
          detail: nameOf(el, 'extends')?.text,
          kind: 'itemtype',
          span: el.span,
          selection: code.span,
          children: attributes,
        };
      }
      case 'attribute': {
        const q = nameOf(el, 'qualifier');
        return q
          ? {
              name: q.text,
              detail: nameOf(el, 'type')?.text,
              kind: 'attribute',
              span: el.span,
              selection: q.span,
              children: [],
            }
          : undefined;
      }
      case 'enumtype': {
        const code = nameOf(el, 'code');
        if (!code) return undefined;
        const values = el.children
          .filter((c) => c.name === 'value')
          .map(
            (v) =>
              nameOf(v, 'code') && {
                name: nameOf(v, 'code')!.text,
                kind: 'value' as const,
                span: v.span,
                selection: nameOf(v, 'code')!.span,
                children: [],
              },
          );
        return {
          name: code.text,
          kind: 'enum',
          span: el.span,
          selection: code.span,
          children: values.filter((v): v is NonNullable<typeof v> => !!v),
        };
      }
      case 'relation': {
        const code = nameOf(el, 'code');
        return code
          ? { name: code.text, kind: 'relation', span: el.span, selection: code.span, children: [] }
          : undefined;
      }
      case 'collectiontype':
      case 'maptype': {
        const code = nameOf(el, 'code');
        return code
          ? {
              name: code.text,
              kind: el.name === 'maptype' ? 'map' : 'collection',
              span: el.span,
              selection: code.span,
              children: [],
            }
          : undefined;
      }
      case 'typegroup': {
        const name = nameOf(el, 'name');
        const kids = el.children.map(build).filter((s): s is ItemsSymbol => !!s);
        return name
          ? { name: name.text, kind: 'group', span: el.span, selection: name.span, children: kids }
          : undefined;
      }
      default:
        return undefined;
    }
  };
  const root = xml.root;
  if (!root) return [];
  return root.children.flatMap((section) =>
    section.children.map(build).filter((s): s is ItemsSymbol => !!s),
  );
}

export function foldingXml(xml: XmlDocument): Span[] {
  const spans: Span[] = [];
  const multiline = (s: Span): boolean =>
    xml.lines.positionAt(s.start).line < xml.lines.positionAt(s.end).line;
  for (const el of walk(xml.root))
    if (el.children.length > 0 && multiline(el.span)) spans.push(el.span);
  // comments
  for (const m of xml.text.matchAll(/<!--[\s\S]*?-->/g)) {
    const span = { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
    if (multiline(span)) spans.push(span);
  }
  return spans;
}

/** `name attr="…"/>` for leaf elements, a block with a closing tag otherwise (the leading `<` is already typed). */
function elementBody(name: string): string {
  return (ITEMS_SCHEMA[name]?.children.length ?? 0) === 0
    ? `${name} $0/>`
    : `${name}>\n  $0\n</${name}>`;
}

/** The attribute in the type system; falls back to the parent type when the edited type is not indexed yet. */
function findAttribute(
  doc: ItemsDocument,
  attribute: { qualifier: string; typeName: string; parent?: string },
) {
  return (
    doc.ts.attribute(attribute.typeName, attribute.qualifier) ??
    (attribute.parent ? doc.ts.attribute(attribute.parent, attribute.qualifier) : undefined)
  );
}
