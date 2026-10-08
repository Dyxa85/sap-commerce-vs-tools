import {
  attr as rawAttr,
  attrNode as rawAttrNode,
  childNamed,
  childrenNamed,
  parseXml,
  walk,
  type XmlElement,
} from '../xml/parser.js';
import type {
  AttributeDef,
  EnumTypeDef,
  IndexDef,
  ItemsFile,
  ItemTypeDef,
  RelationDef,
  RelationEndDef,
  SourceRef,
} from './model.js';

/** Real-world files contain values like `extends="Foo "`; names are always compared trimmed. */
const a = (el: XmlElement, name: string): string | undefined => rawAttr(el, name)?.trim();
const node = (el: XmlElement, name: string): ReturnType<typeof rawAttrNode> => {
  const n = rawAttrNode(el, name);
  return n ? { ...n, value: n.value.trim() } : undefined;
};

const bool = (value: string | undefined): boolean | undefined =>
  value === undefined ? undefined : value.toLowerCase() === 'true';

/** Parses one `*-items.xml`. Never throws; broken XML yields as much structure as possible. */
export function parseItemsXml(text: string, file: string, extension: string): ItemsFile {
  const doc = parseXml(text);
  const result: ItemsFile = {
    file,
    extension,
    text,
    itemTypes: [],
    enumTypes: [],
    collectionTypes: [],
    mapTypes: [],
    atomicTypes: [],
    relations: [],
    problems: doc.problems.map((p) => ({ span: p.span, message: p.message })),
  };
  const root = doc.root?.name === 'items' ? doc.root : undefined;
  if (!root) return result;

  const source = (el: XmlElement, nameAttr: string): SourceRef => {
    const nameNode = node(el, nameAttr);
    return { file, extension, span: el.span, nameSpan: nameNode?.valueSpan ?? el.nameSpan };
  };

  for (const el of walk(root)) {
    switch (el.name) {
      case 'atomictype': {
        const className = a(el, 'class');
        if (className)
          result.atomicTypes.push({
            className,
            extends: a(el, 'extends'),
            source: source(el, 'class'),
          });
        break;
      }
      case 'collectiontype': {
        const code = a(el, 'code');
        const element = node(el, 'elementtype');
        if (code && element) {
          const kind = a(el, 'type');
          result.collectionTypes.push({
            code,
            elementType: element.value,
            elementTypeSpan: element.valueSpan,
            kind: kind === 'list' || kind === 'set' ? kind : 'collection',
            source: source(el, 'code'),
          });
        }
        break;
      }
      case 'maptype': {
        const code = a(el, 'code');
        if (code) {
          result.mapTypes.push({
            code,
            argumentType: a(el, 'argumenttype') ?? '',
            returnType: a(el, 'returntype') ?? '',
            source: source(el, 'code'),
          });
        }
        break;
      }
      case 'enumtype': {
        const code = a(el, 'code');
        if (code) result.enumTypes.push(parseEnum(el, code, source));
        break;
      }
      case 'itemtype': {
        const code = a(el, 'code');
        if (code) result.itemTypes.push(parseItemType(el, code, source));
        break;
      }
      case 'relation': {
        const relation = parseRelation(el, source);
        if (relation) result.relations.push(relation);
        break;
      }
      default:
        break;
    }
  }
  return result;
}

function parseEnum(
  el: XmlElement,
  code: string,
  source: (el: XmlElement, nameAttr: string) => SourceRef,
): EnumTypeDef {
  return {
    code,
    dynamic: bool(a(el, 'dynamic')) ?? false,
    description: childNamed(el, 'description')?.text || undefined,
    source: source(el, 'code'),
    values: childrenNamed(el, 'value')
      .map((v) => ({
        code: a(v, 'code') ?? '',
        description: childNamed(v, 'description')?.text || undefined,
        source: source(v, 'code'),
      }))
      .filter((v) => v.code !== ''),
  };
}

function parseItemType(
  el: XmlElement,
  code: string,
  source: (el: XmlElement, nameAttr: string) => SourceRef,
): ItemTypeDef {
  const extendsNode = node(el, 'extends');
  const deploymentEl = childNamed(el, 'deployment');
  const typecode = deploymentEl ? a(deploymentEl, 'typecode') : undefined;
  const itemSource = source(el, 'code');

  const attributes: AttributeDef[] = [];
  for (const container of childrenNamed(el, 'attributes')) {
    for (const a of childrenNamed(container, 'attribute')) {
      const def = parseAttribute(a, source);
      if (def) attributes.push(def);
    }
  }

  const indexes: IndexDef[] = [];
  for (const container of childrenNamed(el, 'indexes')) {
    for (const index of childrenNamed(container, 'index')) {
      indexes.push({
        name: a(index, 'name') ?? '',
        unique: bool(a(index, 'unique')) ?? false,
        keys: childrenNamed(index, 'key')
          .map((k) => a(k, 'attribute') ?? '')
          .filter(Boolean),
      });
    }
  }

  return {
    code,
    extends: extendsNode?.value,
    extendsSpan: extendsNode?.valueSpan,
    abstract: bool(a(el, 'abstract')) ?? false,
    autocreate: bool(a(el, 'autocreate')) ?? true,
    generate: bool(a(el, 'generate')) ?? true,
    jaloclass: a(el, 'jaloclass'),
    deployment: deploymentEl
      ? {
          table: a(deploymentEl, 'table'),
          typecode: typecode !== undefined && /^\d+$/.test(typecode) ? Number(typecode) : undefined,
          span: deploymentEl.span,
        }
      : undefined,
    description: childNamed(el, 'description')?.text || undefined,
    attributes,
    indexes,
    source: itemSource,
  };
}

function parseAttribute(
  el: XmlElement,
  source: (el: XmlElement, nameAttr: string) => SourceRef,
): AttributeDef | undefined {
  const qualifier = a(el, 'qualifier');
  const typeNode = node(el, 'type');
  if (!qualifier) return undefined;
  const modifiers = childNamed(el, 'modifiers');
  const persistence = childNamed(el, 'persistence');
  const type = typeNode?.value ?? '';
  const localized = /^localized:/i.test(type);
  return {
    qualifier,
    type,
    typeSpan: typeNode?.valueSpan ?? el.nameSpan,
    localized,
    baseType: localized ? type.replace(/^localized:/i, '') : type,
    redeclare: bool(a(el, 'redeclare')) ?? false,
    persistence: persistence ? a(persistence, 'type') : undefined,
    attributeHandler: persistence ? a(persistence, 'attributeHandler') : undefined,
    read: bool(modifiers ? a(modifiers, 'read') : undefined),
    write: bool(modifiers ? a(modifiers, 'write') : undefined),
    search: bool(modifiers ? a(modifiers, 'search') : undefined),
    optional: bool(modifiers ? a(modifiers, 'optional') : undefined),
    unique: bool(modifiers ? a(modifiers, 'unique') : undefined),
    initial: bool(modifiers ? a(modifiers, 'initial') : undefined),
    partOf: bool(modifiers ? a(modifiers, 'partof') : undefined),
    encrypted: bool(modifiers ? a(modifiers, 'encrypted') : undefined),
    defaultValue: childNamed(el, 'defaultvalue')?.text || undefined,
    description: childNamed(el, 'description')?.text || undefined,
    source: source(el, 'qualifier'),
  };
}

function parseRelation(
  el: XmlElement,
  source: (el: XmlElement, nameAttr: string) => SourceRef,
): RelationDef | undefined {
  const code = a(el, 'code');
  const src = childNamed(el, 'sourceElement');
  const tgt = childNamed(el, 'targetElement');
  if (!code || !src || !tgt) return undefined;
  return {
    code,
    localized: bool(a(el, 'localized')) ?? false,
    sourceElement: parseEnd(src),
    targetElement: parseEnd(tgt),
    source: source(el, 'code'),
  };
}

function parseEnd(el: XmlElement): RelationEndDef {
  const type = node(el, 'type');
  const qualifier = node(el, 'qualifier');
  const collection = a(el, 'collectiontype');
  const modifiers = childNamed(el, 'modifiers');
  return {
    type: type?.value ?? '',
    typeSpan: type?.valueSpan ?? el.nameSpan,
    qualifier: qualifier?.value,
    qualifierSpan: qualifier?.valueSpan,
    cardinality: a(el, 'cardinality') === 'many' ? 'many' : 'one',
    collectionType:
      collection === 'list' || collection === 'set' || collection === 'collection'
        ? collection
        : undefined,
    ordered: bool(a(el, 'ordered')) ?? false,
    navigable: bool(a(el, 'navigable')) ?? true,
    optional: bool(modifiers ? a(modifiers, 'optional') : undefined),
    partOf: bool(modifiers ? a(modifiers, 'partof') : undefined),
  };
}
