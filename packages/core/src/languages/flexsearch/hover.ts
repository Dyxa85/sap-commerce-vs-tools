import type { Span } from '../shared/line-index.js';
import type { TypeSchema } from '../shared/schema.js';
import { KEYWORD_DOCS } from './knowledge.js';
import type { FlexDocument } from './model.js';
import { targetAt } from './navigation.js';

export interface FlexHover {
  span: Span;
  markdown: string;
}

export function hoverFlex(
  doc: FlexDocument,
  offset: number,
  schema?: TypeSchema,
): FlexHover | undefined {
  const target = targetAt(doc, offset);
  if (target) {
    switch (target.kind) {
      case 'param':
        return {
          span: target.param.span,
          markdown: `**?${target.param.name}** – query parameter.\n\nThe hAC console cannot bind parameters; when you run the query from the editor you are asked for a value which is inserted as an SQL literal.`,
        };
      case 'type': {
        const docText = schema?.typeDoc?.(target.ref.typeName);
        const unknown =
          schema && !schema.hasType(target.ref.typeName)
            ? '\n\n_Unknown type in the loaded type system._'
            : '';
        return {
          span: target.ref.typeSpan,
          markdown: `**${target.ref.typeName}** (item type${target.ref.excludeSubtypes ? ', without subtypes' : ''})${docText ? `\n\n${docText}` : ''}${unknown}`,
        };
      }
      case 'alias-decl':
        return target.ref.aliasSpan
          ? {
              span: target.ref.aliasSpan,
              markdown: `**${target.ref.alias}** – alias of \`${target.ref.typeName}\``,
            }
          : undefined;
      case 'alias-use':
        return target.field.aliasSpan
          ? {
              span: target.field.aliasSpan,
              markdown: target.ref
                ? `**${target.field.alias}** – alias of \`${target.ref.typeName}\``
                : `**${target.field.alias}** – unknown alias`,
            }
          : undefined;
      case 'attribute': {
        const type = target.ref?.typeName;
        const attr = type
          ? schema
              ?.attributes(type)
              ?.find((a) => a.name.toLowerCase() === target.field.attribute.toLowerCase())
          : undefined;
        const lines = [`**${target.field.attribute}**${type ? ` – attribute of \`${type}\`` : ''}`];
        if (attr) {
          const flags = [
            attr.type ? `Type: \`${attr.type}\`` : '',
            attr.localized ? 'localized' : '',
            attr.mandatory ? 'mandatory' : '',
          ]
            .filter(Boolean)
            .join(' · ');
          if (flags) lines.push('', flags);
          if (attr.doc) lines.push('', attr.doc);
        } else if (target.field.attribute.toLowerCase() === 'pk') {
          lines.push('', 'Primary key of the item.');
        }
        if (target.field.lang)
          lines.push('', `Localized value for language \`${target.field.lang}\`.`);
        return { span: target.field.attributeSpan, markdown: lines.join('\n') };
      }
      case 'field':
        return undefined;
    }
  }
  for (const [i, t] of doc.tokens.entries()) {
    if (offset < t.span.start || offset > t.span.end || t.kind !== 'keyword') continue;
    const word = t.text.toUpperCase();
    const next = doc.tokens[i + 1]?.text.toUpperCase();
    const key =
      (word === 'ORDER' || word === 'GROUP') && next === 'BY'
        ? `${word} BY`
        : word === 'LEFT' && next === 'JOIN'
          ? 'LEFT JOIN'
          : word;
    const text = KEYWORD_DOCS[key] ?? KEYWORD_DOCS[word];
    return text ? { span: t.span, markdown: `**${key}**\n\n${text}` } : undefined;
  }
  return undefined;
}
