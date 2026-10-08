import type { CompletionEntry } from '../languages/shared/completion.js';
import type { Span } from '../languages/shared/line-index.js';
import type { SchemaLocation } from '../languages/shared/schema.js';
import {
  attr,
  parseXml,
  walk,
  xmlContextAt,
  type XmlDocument,
  type XmlElement,
} from '../xml/index.js';
import { BEANS_SCHEMA, BEAN_JAVA_TYPES } from './schema.js';
import type { BeanSystem } from './system.js';

export interface BeansDocument {
  xml: XmlDocument;
  system: BeanSystem;
}

export function openBeansDocument(text: string, system: BeanSystem): BeansDocument {
  return { xml: parseXml(text), system };
}

export function completeBeans(doc: BeansDocument, offset: number): CompletionEntry[] {
  const context = xmlContextAt(doc.xml, offset);

  if (context.kind === 'attribute-value') {
    const spec = BEANS_SCHEMA[context.element.name]?.attributes[context.attribute.name];
    const replace = { start: context.start, end: context.end };
    if (spec?.values)
      return spec.values.map((v) => ({ label: v, kind: 'value' as const, replace }));
    const name = context.attribute.name;
    if (context.element.name === 'bean' && name === 'extends') {
      return [...doc.system.beans.values()].map((b) => ({
        label: b.className,
        kind: 'type' as const,
        detail: b.abstract ? 'abstract bean' : 'bean',
        replace,
        sortText: b.className,
      }));
    }
    if (context.element.name === 'property' && name === 'type') {
      const entries: CompletionEntry[] = BEAN_JAVA_TYPES.map((t) => ({
        label: t,
        kind: 'type' as const,
        detail: 'Java type',
        replace,
        sortText: `0${t}`,
      }));
      for (const b of doc.system.beans.keys())
        entries.push({ label: b, kind: 'type', detail: 'bean', replace, sortText: `1${b}` });
      for (const e of doc.system.enums.keys())
        entries.push({ label: e, kind: 'enumMember', detail: 'enum', replace, sortText: `1${e}` });
      return entries;
    }
    return [];
  }

  if (context.kind === 'attribute-name') {
    const spec = BEANS_SCHEMA[context.element.name];
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

  const parent = context.kind === 'element-name' ? context.parent : context.parent;
  const children = parent
    ? BEANS_SCHEMA[parent.name]?.children
    : doc.xml.root
      ? undefined
      : ['beans'];
  if (!children) return [];
  const prefix = context.kind === 'element-name' ? context.prefix : '';
  const start = context.kind === 'element-name' ? context.start : offset;
  return children
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({
      label: name,
      kind: 'snippet' as const,
      insertText:
        name === 'bean'
          ? 'bean class="${1:com.acme.data.MyData}">\n  <property name="${2:name}" type="${3:String}"/>\n</bean>'
          : name === 'enum'
            ? 'enum class="${1:com.acme.enums.MyEnum}">\n  <value>${2:VALUE}</value>\n</enum>'
            : (BEANS_SCHEMA[name]?.children.length ?? 0) === 0
              ? `${name} $0/>`
              : `${name}>\n  $0\n</${name}>`,
      snippet: true,
      replace: { start, end: offset },
    }));
}

interface ClassReference {
  name: string;
  span: Span;
}

/** A class name inside `extends="…"` or a property `type="…"` at the cursor (also inside generics). */
export function classReferenceAt(doc: BeansDocument, offset: number): ClassReference | undefined {
  for (const el of walk(doc.xml.root)) {
    if (offset < el.startTag.start || offset > el.startTag.end) continue;
    const isExtends = el.name === 'bean';
    const isType = el.name === 'property';
    for (const a of el.attributes) {
      if (!((isExtends && a.name === 'extends') || (isType && a.name === 'type'))) continue;
      if (offset < a.valueSpan.start || offset > a.valueSpan.end) continue;
      const raw = doc.xml.text
        .slice(a.valueSpan.start, a.valueSpan.end)
        .replace(/&[#\w]+;/g, (e) => ' '.repeat(e.length));
      const rel = offset - a.valueSpan.start;
      for (const m of raw.matchAll(/[A-Za-z_$][\w$.]*/g)) {
        const start = m.index ?? 0;
        if (rel >= start && rel <= start + m[0].length)
          return {
            name: m[0],
            span: {
              start: a.valueSpan.start + start,
              end: a.valueSpan.start + start + m[0].length,
            },
          };
      }
    }
  }
  return undefined;
}

export function definitionBeans(doc: BeansDocument, offset: number): SchemaLocation | undefined {
  const reference = classReferenceAt(doc, offset);
  return reference ? doc.system.locate(reference.name) : undefined;
}

export function hoverBeans(
  doc: BeansDocument,
  offset: number,
): { span: Span; markdown: string } | undefined {
  const reference = classReferenceAt(doc, offset);
  if (reference) {
    const name = doc.system.resolve(reference.name);
    if (!name) return undefined;
    const bean = doc.system.beans.get(name);
    if (bean) {
      const props = doc.system.properties(name);
      return {
        span: reference.span,
        markdown: `**${name}** (bean${bean.abstract ? ', abstract' : ''})${bean.description ? `\n\n${bean.description}` : ''}\n\n${props.length} propert${props.length === 1 ? 'y' : 'ies'}${bean.extends ? ` · extends \`${bean.extends}\`` : ''}`,
      };
    }
    return {
      span: reference.span,
      markdown: `**${name}** (enum)\n\nValues: ${doc.system.enumValues(name).join(', ')}`,
    };
  }
  // property name → declared type and where it is inherited from
  for (const el of walk(doc.xml.root)) {
    if (el.name !== 'property') continue;
    const nameNode = el.attributes.find((a) => a.name === 'name');
    if (!nameNode || offset < nameNode.valueSpan.start || offset > nameNode.valueSpan.end) continue;
    const bean = el.parent?.name === 'bean' ? attr(el.parent, 'class') : undefined;
    const className = bean ? bean.replace(/<.*$/s, '').trim() : undefined;
    const info = className
      ? doc.system.properties(className).find((p) => p.name === nameNode.value)
      : undefined;
    return {
      span: nameNode.valueSpan,
      markdown: `**${nameNode.value}** – \`${attr(el, 'type') ?? info?.def.type ?? '?'}\`${info?.def.description ? `\n\n${info.def.description}` : ''}`,
    };
  }
  return undefined;
}

export interface BeansSymbol {
  name: string;
  detail?: string;
  kind: 'bean' | 'enum' | 'property' | 'value';
  span: Span;
  selection: Span;
  children: BeansSymbol[];
}

export function outlineBeans(xml: XmlDocument): BeansSymbol[] {
  const root = xml.root;
  if (!root) return [];
  const symbols: BeansSymbol[] = [];
  const nameNode = (el: XmlElement, name: string) => el.attributes.find((a) => a.name === name);
  for (const el of root.children) {
    if (el.name === 'bean') {
      const cls = nameNode(el, 'class');
      if (!cls) continue;
      const short = cls.value.replace(/<.*$/s, '').trim();
      symbols.push({
        name: short.slice(short.lastIndexOf('.') + 1),
        detail: short,
        kind: 'bean',
        span: el.span,
        selection: cls.valueSpan,
        children: el.children
          .filter((c) => c.name === 'property')
          .flatMap((p) => {
            const n = nameNode(p, 'name');
            return n
              ? [
                  {
                    name: n.value,
                    detail: attr(p, 'type'),
                    kind: 'property' as const,
                    span: p.span,
                    selection: n.valueSpan,
                    children: [],
                  },
                ]
              : [];
          }),
      });
    } else if (el.name === 'enum') {
      const cls = nameNode(el, 'class');
      if (!cls) continue;
      symbols.push({
        name: cls.value.slice(cls.value.lastIndexOf('.') + 1),
        detail: cls.value,
        kind: 'enum',
        span: el.span,
        selection: cls.valueSpan,
        children: el.children
          .filter((c) => c.name === 'value')
          .map((v) => ({
            name: v.text.trim(),
            kind: 'value' as const,
            span: v.span,
            selection: v.nameSpan,
            children: [],
          })),
      });
    }
  }
  return symbols;
}
