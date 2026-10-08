import type { Span } from '../shared/line-index.js';
import type { FlexDocument, Scope } from './model.js';

export interface FlexSymbol {
  name: string;
  detail?: string;
  kind: 'query' | 'type';
  span: Span;
  selection: Span;
  children: FlexSymbol[];
}

export function outlineFlex(doc: FlexDocument): FlexSymbol[] {
  const build = (scope: Scope): FlexSymbol => {
    const types = scope.typeRefs.map((r) => (r.alias ? `${r.typeName} AS ${r.alias}` : r.typeName));
    return {
      name: scope.kind === 'root' ? 'SELECT' : 'subselect',
      detail: types.join(', ') || undefined,
      kind: 'query',
      span:
        scope.kind === 'root'
          ? { start: scope.selectSpan?.start ?? 0, end: doc.text.length }
          : scope.span,
      selection: scope.selectSpan ?? {
        start: scope.span.start,
        end: Math.min(scope.span.start + 2, scope.span.end),
      },
      children: [
        ...scope.typeRefs.map((r) => ({
          name: r.alias ?? r.typeName,
          detail: r.alias ? r.typeName : undefined,
          kind: 'type' as const,
          span: r.aliasSpan ? { start: r.typeSpan.start, end: r.aliasSpan.end } : r.typeSpan,
          selection: r.aliasSpan ?? r.typeSpan,
          children: [],
        })),
        ...doc.scopes.filter((s) => s.parent === scope).map(build),
      ],
    };
  };
  const root = doc.scopes[0];
  return root && (root.selectSpan || root.typeRefs.length > 0) ? [build(root)] : [];
}

export function foldingFlex(doc: FlexDocument): { span: Span; kind: 'region' | 'comment' }[] {
  const ranges: { span: Span; kind: 'region' | 'comment' }[] = [];
  const multiline = (s: Span): boolean =>
    doc.lines.positionAt(s.start).line < doc.lines.positionAt(s.end).line;
  for (const s of [...doc.subselects, ...doc.fromBlocks])
    if (multiline(s)) ranges.push({ span: s, kind: 'region' });
  for (const t of doc.tokens)
    if (t.kind === 'comment' && multiline(t.span)) ranges.push({ span: t.span, kind: 'comment' });
  return ranges;
}
