import { applySeverities, type Problem, type SeverityOverride } from '../shared/problem.js';
import type { TypeSchema } from '../shared/schema.js';
import type { FlexDocument, Scope, TypeRef } from './model.js';

export interface FlexAnalyzeOptions {
  severities?: Record<string, SeverityOverride | undefined>;
  schema?: TypeSchema;
}

/** Item attributes every type has; accepted even when no schema is loaded. */
const UNIVERSAL_ATTRIBUTES = new Set(['pk']);

export function analyzeFlexSearch(doc: FlexDocument, options: FlexAnalyzeOptions = {}): Problem[] {
  const problems: Problem[] = [...doc.problems];

  // missing FROM
  for (const scope of doc.scopes) {
    if (scope.selectSpan && !scope.hasFrom) {
      problems.push({
        span: scope.selectSpan,
        severity: 'error',
        code: 'flexsearch.select.no-from',
        message:
          'Missing FROM clause: the hAC rejects a SELECT without FROM ("Missing FROM clause").',
      });
    }
  }

  // duplicate aliases per scope
  for (const scope of doc.scopes) {
    const seen = new Set<string>();
    for (const ref of scope.typeRefs) {
      const key = (ref.alias ?? ref.typeName).toLowerCase();
      if (seen.has(key) && ref.aliasSpan) {
        problems.push({
          span: ref.aliasSpan,
          severity: 'error',
          code: 'flexsearch.alias.duplicate',
          message: `Alias "${ref.alias}" is declared more than once in this query.`,
        });
      }
      seen.add(key);
    }
  }

  // field references
  const usedAliases = new Set<TypeRef>();
  for (const field of doc.fieldRefs) {
    if (!field.valid) {
      problems.push({
        span: field.span,
        severity: 'warning',
        code: 'flexsearch.field.unrecognized',
        message:
          'Unrecognized field expression. Expected {attribute}, {alias:attribute}, {alias:attribute[lang]} or {alias:attribute:o}.',
      });
      continue;
    }
    const target = field.alias ? resolveAlias(field.scope, field.alias) : soleType(field.scope);
    if (field.alias && !target && field.aliasSpan) {
      const known = visibleAliases(field.scope);
      problems.push({
        span: field.aliasSpan,
        severity: 'error',
        code: 'flexsearch.alias.unknown',
        message: `Unknown alias "${field.alias}"${known.length > 0 ? `. Known: ${known.join(', ')}` : ''} (the hAC reports "cannot find (visible) type for alias").`,
        data: { suggestion: closest(field.alias, known) },
      });
      continue;
    }
    if (target) usedAliases.add(target);
    const schema = options.schema;
    if (target && schema && field.attributeSpan.end > field.attributeSpan.start) {
      if (!UNIVERSAL_ATTRIBUTES.has(field.attribute.toLowerCase())) {
        const attrs = schema.attributes(target.typeName);
        if (attrs && !attrs.some((a) => a.name.toLowerCase() === field.attribute.toLowerCase())) {
          problems.push({
            span: field.attributeSpan,
            severity: 'error',
            code: 'flexsearch.attribute.unknown',
            message: `Type ${target.typeName} has no attribute "${field.attribute}".`,
          });
        }
      }
    }
  }

  // types
  if (options.schema) {
    for (const ref of doc.typeRefs) {
      if (!options.schema.hasType(ref.typeName)) {
        problems.push({
          span: ref.typeSpan,
          severity: 'error',
          code: 'flexsearch.type.unknown',
          message: `Unknown type "${ref.typeName}" (the hAC reports "no composed type with code ${ref.typeName} found").`,
        });
      }
    }
  }

  // unused aliases
  for (const ref of doc.typeRefs) {
    if (ref.alias && ref.aliasSpan && !usedAliases.has(ref) && !joinsReference(doc, ref)) {
      problems.push({
        span: ref.aliasSpan,
        severity: 'hint',
        code: 'flexsearch.alias.unused',
        message: `Alias "${ref.alias}" is never used.`,
        unnecessary: true,
      });
    }
  }

  // UNION must combine {{ … }} subselects
  for (const [i, t] of doc.tokens.entries()) {
    if (t.kind === 'keyword' && t.text.toUpperCase() === 'UNION') {
      const next = doc.tokens.slice(i + 1).find((x) => x.kind !== 'comment');
      if (next?.kind === 'keyword' && ['SELECT', 'ALL'].includes(next.text.toUpperCase())) {
        problems.push({
          span: t.span,
          severity: 'warning',
          code: 'flexsearch.union.unwrapped',
          message:
            'UNION needs each query wrapped in {{ … }}: {{ SELECT … }} UNION {{ SELECT … }} (the hAC fails with "no composed type with code … found").',
        });
      }
    }
  }

  // trailing semicolon
  const last = [...doc.tokens]
    .reverse()
    .find((t) => t.kind !== 'comment' && t.kind !== 'line-comment');
  if (last?.kind === 'punct' && last.text === ';') {
    problems.push({
      span: last.span,
      severity: 'warning',
      code: 'flexsearch.trailing-semicolon',
      message:
        'A trailing ";" makes the hAC fail ("unexpected token: WHERE"). It is removed when the query is run from the editor.',
    });
  }

  return applySeverities(problems, options.severities);
}

function joinsReference(doc: FlexDocument, ref: TypeRef): boolean {
  // an alias used only inside the FROM brace (ON clause) is still "used"
  return doc.fieldRefs.some(
    (f) => f.scope === ref.scope && f.alias?.toLowerCase() === ref.alias?.toLowerCase(),
  );
}

/** Alias lookup through the scope chain (subselects see the aliases of enclosing queries). */
export function resolveAlias(scope: Scope | undefined, alias: string): TypeRef | undefined {
  const wanted = alias.toLowerCase();
  for (let s = scope; s; s = s.parent) {
    const byAlias = s.typeRefs.find((r) => r.alias?.toLowerCase() === wanted);
    if (byAlias) return byAlias;
    const byType = s.typeRefs.find((r) => r.typeName.toLowerCase() === wanted);
    if (byType) return byType;
  }
  return undefined;
}

/** The only type of a scope, for unqualified `{attribute}` references. */
export function soleType(scope: Scope): TypeRef | undefined {
  return scope.typeRefs.length === 1 ? scope.typeRefs[0] : undefined;
}

export function visibleAliases(scope: Scope | undefined): string[] {
  const names: string[] = [];
  for (let s = scope; s; s = s.parent) {
    for (const r of s.typeRefs) names.push(r.alias ?? r.typeName);
  }
  return names;
}

function closest(word: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const c of candidates) {
    const d = distance(word.toLowerCase(), c.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = temp;
    }
  }
  return prev[b.length] as number;
}
