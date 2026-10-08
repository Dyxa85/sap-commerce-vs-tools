import type { Span } from '../shared/line-index.js';
import { MODE_DOCS, SPECIAL_VALUES, attributeModifier, typeModifier } from './knowledge.js';
import { macroAt, macroValue, targetAt } from './navigation.js';
import type { ImpexDocument, ImpexMode } from './model.js';
import type { TypeSchema } from '../shared/schema.js';

export interface HoverInfo {
  span: Span;
  /** Markdown. */
  markdown: string;
}

export function hover(
  doc: ImpexDocument,
  offset: number,
  schema?: TypeSchema,
): HoverInfo | undefined {
  const macro = macroAt(doc, offset);
  if (macro) {
    const value = macroValue(doc, macro);
    const lines = [`**$${macro.name}**`];
    if (macro.def) {
      lines.push('', `\`${macro.def.value || '(empty)'}\``);
      if (value !== undefined && value !== macro.def.value)
        lines.push('', `Expands to: \`${value}\``);
    } else if (/^config-/i.test(macro.name)) {
      lines.push('', 'Value of a platform configuration property, resolved by the importer.');
    } else {
      lines.push('', 'Not defined above this line.');
    }
    return { span: macro.span, markdown: lines.join('\n') };
  }

  const target = targetAt(doc, offset);
  if (!target) return undefined;

  switch (target.kind) {
    case 'mode': {
      const mode = target.header.canonicalMode as ImpexMode | undefined;
      return mode
        ? { span: target.header.modeSpan, markdown: `**${mode}**\n\n${MODE_DOCS[mode]}` }
        : undefined;
    }
    case 'type': {
      const span = target.header.typeSpan;
      if (!span) return undefined;
      const doc2 = schema?.typeDoc?.(target.header.typeName);
      const known = schema
        ? schema.hasType(target.header.typeName)
          ? ''
          : '\n\n_Unknown type in the loaded type system._'
        : '';
      return {
        span,
        markdown: `**${target.header.typeName}** (item type)${doc2 ? `\n\n${doc2}` : ''}${known}`,
      };
    }
    case 'type-modifier':
    case 'modifier': {
      const { modifier } = target;
      const info =
        target.kind === 'type-modifier'
          ? typeModifier(modifier.name)
          : attributeModifier(modifier.name);
      if (!info) return undefined;
      return {
        span: modifier.span,
        markdown: `**${info.name}** (${info.scope} modifier)\n\n${info.doc}`,
      };
    }
    case 'column': {
      const { column, header } = target;
      const attr = schema
        ?.attributes(header.typeName)
        ?.find((a) => a.name.toLowerCase() === column.name.toLowerCase());
      const parts = [`**${column.name}** – column ${column.index} of \`${header.typeName}\``];
      if (attr) {
        parts.push(
          '',
          [
            attr.type ? `Type: \`${attr.type}\`` : '',
            attr.mandatory ? 'mandatory' : '',
            attr.localized ? 'localized' : '',
          ]
            .filter(Boolean)
            .join(' · '),
        );
        if (attr.doc) parts.push('', attr.doc);
      } else if (schema && column.kind === 'attribute' && !column.name.includes('$')) {
        parts.push(
          '',
          `_No attribute "${column.name}" on ${header.typeName} in the loaded type system._`,
        );
      }
      return { span: column.span, markdown: parts.join('\n') };
    }
    case 'cell': {
      const { cell, column, header } = target;
      if (SPECIAL_VALUES[cell.value])
        return {
          span: cell.valueSpan,
          markdown: `**${cell.value}**\n\n${SPECIAL_VALUES[cell.value]}`,
        };
      if (!header || !column) return undefined;
      const mods = column.modifiers
        .map((m) => (m.value === undefined ? m.name : `${m.name}=${m.value}`))
        .join(', ');
      return {
        span: cell.valueSpan.end > cell.valueSpan.start ? cell.valueSpan : cell.span,
        markdown: `Column ${column.index}: **${column.name}**${mods ? ` \`[${mods}]\`` : ''} of \`${header.typeName}\``,
      };
    }
  }
}
