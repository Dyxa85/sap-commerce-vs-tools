import { toSemanticTokens, type RawToken, type SemanticToken } from '../shared/semantic.js';
import type { FlexDocument } from './model.js';

export function flexSemanticTokens(doc: FlexDocument): SemanticToken[] {
  const raw: RawToken[] = [];
  for (const [i, t] of doc.tokens.entries()) {
    switch (t.kind) {
      case 'keyword':
        raw.push({ span: t.span, type: 'keyword', priority: 1 });
        break;
      case 'string':
        raw.push({ span: t.span, type: 'string', priority: 1 });
        break;
      case 'number':
        raw.push({ span: t.span, type: 'number', priority: 1 });
        break;
      case 'comment':
      case 'line-comment':
        raw.push({ span: t.span, type: 'comment', priority: 1 });
        break;
      case 'param':
        raw.push({ span: t.span, type: 'parameter', priority: 2 });
        break;
      case 'ident':
        if (doc.tokens[i + 1]?.text === '(' && doc.tokens[i + 1]?.span.start === t.span.end) {
          raw.push({ span: t.span, type: 'function', priority: 1 });
        }
        break;
      default:
        break;
    }
  }
  for (const ref of doc.typeRefs) {
    raw.push({ span: ref.typeSpan, type: 'class', priority: 2 });
    if (ref.aliasSpan)
      raw.push({ span: ref.aliasSpan, type: 'variable', priority: 2, modifiers: ['declaration'] });
  }
  for (const field of doc.fieldRefs) {
    if (!field.valid) continue;
    if (field.aliasSpan) raw.push({ span: field.aliasSpan, type: 'variable', priority: 2 });
    raw.push({ span: field.attributeSpan, type: 'property', priority: 2 });
  }
  return toSemanticTokens(doc.lines, raw);
}
