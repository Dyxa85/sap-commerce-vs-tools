import type { Span } from '../shared/line-index.js';
import { resolveAlias } from './analyze.js';
import type { FieldRef, FlexDocument, ParamUse, TypeRef } from './model.js';

const within = (s: Span | undefined, o: number): boolean => !!s && o >= s.start && o <= s.end;

export type FlexTarget =
  | { kind: 'type'; ref: TypeRef }
  | { kind: 'alias-decl'; ref: TypeRef }
  | { kind: 'alias-use'; field: FieldRef; ref: TypeRef | undefined }
  | { kind: 'attribute'; field: FieldRef; ref: TypeRef | undefined }
  | { kind: 'param'; param: ParamUse }
  | { kind: 'field'; field: FieldRef };

export function targetAt(doc: FlexDocument, offset: number): FlexTarget | undefined {
  for (const param of doc.params) if (within(param.span, offset)) return { kind: 'param', param };
  for (const field of doc.fieldRefs) {
    if (!within(field.span, offset)) continue;
    const ref = field.alias
      ? resolveAlias(field.scope, field.alias)
      : field.scope.typeRefs.length === 1
        ? field.scope.typeRefs[0]
        : undefined;
    if (within(field.aliasSpan, offset)) return { kind: 'alias-use', field, ref };
    if (within(field.attributeSpan, offset)) return { kind: 'attribute', field, ref };
    return { kind: 'field', field };
  }
  for (const ref of doc.typeRefs) {
    if (within(ref.aliasSpan, offset)) return { kind: 'alias-decl', ref };
    if (within(ref.typeSpan, offset)) return { kind: 'type', ref };
  }
  return undefined;
}

/** Declaration plus all uses of the alias under the cursor. */
export function aliasOccurrences(doc: FlexDocument, ref: TypeRef): Span[] {
  const spans: Span[] = [];
  if (ref.aliasSpan) spans.push(ref.aliasSpan);
  for (const field of doc.fieldRefs) {
    if (
      field.aliasSpan &&
      resolveAlias(field.scope, field.alias ?? '') === ref &&
      field.alias?.toLowerCase() === ref.alias?.toLowerCase()
    ) {
      spans.push(field.aliasSpan);
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function aliasRefAt(doc: FlexDocument, offset: number): TypeRef | undefined {
  const target = targetAt(doc, offset);
  if (target?.kind === 'alias-decl') return target.ref.alias ? target.ref : undefined;
  if (target?.kind === 'alias-use') return target.ref?.alias ? target.ref : undefined;
  return undefined;
}

/** Distinct parameter names in order of first use. */
export function parameterNames(doc: FlexDocument): string[] {
  const seen = new Set<string>();
  for (const p of doc.params) if (p.name) seen.add(p.name);
  return [...seen];
}
