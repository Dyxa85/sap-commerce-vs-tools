import {
  attr,
  attrNode,
  childNamed,
  childrenNamed,
  parseXml,
  type XmlElement,
} from '../xml/parser.js';
import type { BeanDef, BeanEnumDef, BeanProperty, BeansFile, BeanSource } from './model.js';

/** `a.b.Foo<T, U>` → `{ name: 'a.b.Foo', parameters: ['T', 'U'] }` */
export function splitGenerics(raw: string): { name: string; parameters: string[] } {
  const trimmed = raw.trim();
  const lt = trimmed.indexOf('<');
  if (lt === -1) return { name: trimmed, parameters: [] };
  const inner = trimmed.slice(
    lt + 1,
    trimmed.lastIndexOf('>') === -1 ? undefined : trimmed.lastIndexOf('>'),
  );
  return {
    name: trimmed.slice(0, lt).trim(),
    parameters: inner
      .split(',')
      .map((p) => p.trim().split(/\s+/)[0] ?? '')
      .filter(Boolean),
  };
}

export function parseBeansXml(text: string, file: string, extension: string): BeansFile {
  const doc = parseXml(text);
  const result: BeansFile = {
    file,
    extension,
    text,
    beans: [],
    enums: [],
    imports: [],
    problems: doc.problems.map((p) => ({ span: p.span, message: p.message })),
  };
  const root = doc.root?.name === 'beans' ? doc.root : undefined;
  if (!root) return result;

  const source = (el: XmlElement, nameAttr: string): BeanSource => ({
    file,
    extension,
    span: el.span,
    nameSpan: attrNode(el, nameAttr)?.valueSpan ?? el.nameSpan,
  });

  for (const el of root.children) {
    if (el.name === 'import') {
      const type = attrNode(el, 'type');
      if (type) result.imports.push({ type: type.value.trim(), span: type.valueSpan });
    } else if (el.name === 'bean') {
      const cls = attr(el, 'class');
      if (!cls) continue;
      const { name, parameters } = splitGenerics(cls);
      const extendsNode = attrNode(el, 'extends');
      const bean: BeanDef = {
        className: name,
        typeParameters: parameters,
        extends: extendsNode ? splitGenerics(extendsNode.value).name : undefined,
        extendsSpan: extendsNode?.valueSpan,
        abstract: attr(el, 'abstract') === 'true',
        template: attr(el, 'template'),
        deprecated: attr(el, 'deprecated'),
        description: childNamed(el, 'description')?.text || undefined,
        properties: childrenNamed(el, 'property').flatMap((p) => parseProperty(p, source)),
        hints: childrenNamed(childNamed(el, 'hints'), 'hint')
          .map((h) => attr(h, 'name') ?? '')
          .filter(Boolean),
        source: source(el, 'class'),
      };
      result.beans.push(bean);
    } else if (el.name === 'enum') {
      const cls = attr(el, 'class');
      if (!cls) continue;
      const enumDef: BeanEnumDef = {
        className: splitGenerics(cls).name,
        deprecated: attr(el, 'deprecated'),
        description: childNamed(el, 'description')?.text || undefined,
        values: childrenNamed(el, 'value')
          .map((v) => ({ code: v.text.trim(), span: v.span }))
          .filter((v) => v.code !== ''),
        source: source(el, 'class'),
      };
      result.enums.push(enumDef);
    }
  }
  return result;
}

function parseProperty(
  el: XmlElement,
  source: (el: XmlElement, nameAttr: string) => BeanSource,
): BeanProperty[] {
  const name = attr(el, 'name');
  if (!name) return [];
  const type = attrNode(el, 'type');
  return [
    {
      name,
      type: type?.value.trim() ?? '',
      typeSpan: type?.valueSpan ?? el.nameSpan,
      equals: attr(el, 'equals') === undefined ? undefined : attr(el, 'equals') === 'true',
      deprecated: attr(el, 'deprecated'),
      description: childNamed(el, 'description')?.text || undefined,
      source: source(el, 'name'),
    },
  ];
}
