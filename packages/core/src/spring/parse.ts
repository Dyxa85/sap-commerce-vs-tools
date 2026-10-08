import { attr, attrNode, parseXml, walk, type XmlElement } from '../xml/parser.js';
import type { Span } from '../languages/shared/line-index.js';
import type { SpringBean, SpringFile, SpringRef } from './model.js';

const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

/** Elements that define a bean when they carry an `id`. */
const BEAN_LIKE = new Set([
  'bean',
  'list',
  'map',
  'set',
  'properties',
  'constant',
  'property-path',
]);

export function parseSpringXml(text: string, file: string, extension: string): SpringFile {
  const doc = parseXml(text);
  const result: SpringFile = {
    file,
    extension,
    text,
    beans: [],
    aliases: [],
    imports: [],
    componentScans: [],
    problems: doc.problems.map((p) => ({ span: p.span, message: p.message })),
  };
  if (!doc.root || localName(doc.root.name) !== 'beans') return result;

  for (const el of walk(doc.root)) {
    const name = localName(el.name);
    if (el === doc.root) continue;
    if (name === 'alias') {
      const target = attrNode(el, 'name');
      const alias = attrNode(el, 'alias');
      if (target && alias)
        result.aliases.push({
          name: target.value.trim(),
          nameSpan: target.valueSpan,
          alias: alias.value.trim(),
          aliasSpan: alias.valueSpan,
          file,
          extension,
        });
    } else if (name === 'import') {
      const resource = attrNode(el, 'resource');
      if (resource)
        result.imports.push({ resource: resource.value.trim(), span: resource.valueSpan });
    } else if (name === 'component-scan') {
      const base = attrNode(el, 'base-package');
      if (base)
        result.componentScans.push({ basePackage: base.value.trim(), span: base.valueSpan });
    } else if (
      name === 'bean' ||
      (attr(el, 'id') && (BEAN_LIKE.has(name) || el.parent === doc.root))
    ) {
      // beans, util:list/map/…, and any top-level element with an id (int:channel, jee:jndi-lookup, …) defines a bean
      result.beans.push(parseBean(el, name, file, extension));
    }
  }
  return result;
}

function parseBean(el: XmlElement, element: string, file: string, extension: string): SpringBean {
  const id = attrNode(el, 'id');
  const nameAttr = attr(el, 'name');
  const cls = attrNode(el, 'class');
  const parent = attrNode(el, 'parent');
  const refs: SpringRef[] = [];
  if (parent) refs.push({ target: parent.value.trim(), span: parent.valueSpan, kind: 'parent' });

  // references made by this bean's own attributes
  for (const a of el.attributes) {
    if (a.name === 'depends-on') refs.push(...splitList(a.value, a.valueSpan, 'depends-on'));
    else if (a.name === 'factory-bean')
      refs.push({ target: a.value.trim(), span: a.valueSpan, kind: 'factory-bean' });
    else if (/^p:.+-ref$/.test(a.name))
      refs.push({ target: a.value.trim(), span: a.valueSpan, kind: 'ref' });
  }
  // references in the body, but not those that belong to nested beans (they are collected for the nested bean)
  collectBodyRefs(el, refs);

  return {
    id: id?.value.trim(),
    idSpan: id?.valueSpan,
    names: nameAttr ? nameAttr.split(/[,;\s]+/).filter(Boolean) : [],
    className: cls?.value.trim(),
    classSpan: cls?.valueSpan,
    parent: parent?.value.trim(),
    scope: attr(el, 'scope'),
    abstract: attr(el, 'abstract') === 'true',
    element,
    refs: refs.filter((r) => isStatic(r.target) && r.target !== ''),
    file,
    extension,
    span: el.span,
  };
}

/** `#{…}` (SpEL) and `${…}` (placeholders) are resolved at runtime and cannot be checked. */
const isStatic = (value: string): boolean => !/[#$]\{/.test(value);

function collectBodyRefs(el: XmlElement, refs: SpringRef[]): void {
  for (const child of el.children) {
    const name = localName(child.name);
    if (name === 'bean') continue; // nested inner bean: its own references are not the outer bean's
    for (const a of child.attributes) {
      if ((name === 'property' || name === 'constructor-arg') && a.name === 'ref')
        refs.push({ target: a.value.trim(), span: a.valueSpan, kind: 'ref' });
      else if (name === 'entry' && (a.name === 'key-ref' || a.name === 'value-ref'))
        refs.push({ target: a.value.trim(), span: a.valueSpan, kind: 'ref' });
      else if ((name === 'ref' || name === 'idref') && (a.name === 'bean' || a.name === 'local'))
        refs.push({ target: a.value.trim(), span: a.valueSpan, kind: 'ref' });
      else if ((name === 'lookup-method' || name === 'replaced-method') && a.name === 'bean')
        refs.push({ target: a.value.trim(), span: a.valueSpan, kind: 'lookup' });
    }
    collectBodyRefs(child, refs);
  }
}

function splitList(value: string, span: Span, kind: SpringRef['kind']): SpringRef[] {
  const out: SpringRef[] = [];
  for (const m of value.matchAll(/[^,;\s]+/g)) {
    out.push({
      target: m[0],
      span: { start: span.start + (m.index ?? 0), end: span.start + (m.index ?? 0) + m[0].length },
      kind,
    });
  }
  return out;
}
