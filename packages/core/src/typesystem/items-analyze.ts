import type { ExtensionCategory } from '../platform/model.js';
import {
  applySeverities,
  type Problem,
  type SeverityOverride,
} from '../languages/shared/problem.js';
import type { Fix } from '../languages/shared/edits.js';
import type { ItemsFile } from './model.js';
import type { TypeSystem } from './system.js';

export interface ItemsAnalyzeOptions {
  severities?: Record<string, SeverityOverride | undefined>;
  /** Category of the extension the file belongs to; custom extensions must not use reserved typecodes. */
  category?: ExtensionCategory;
}

/** Typecodes below this value are reserved for SAP. */
export const FIRST_CUSTOM_TYPECODE = 10000;

/** True when `type` names something that exists (or looks like a Java class). */
export function typeIsKnown(ts: TypeSystem, type: string): boolean {
  const base = type.replace(/^localized:/i, '').trim();
  if (base === '') return false;
  const generic = /^(?:Collection|List|Set)<(.+)>$/.exec(base);
  if (generic) return typeIsKnown(ts, generic[1] as string);
  if (ts.kindOf(base)) return true;
  // fully qualified Java classes cannot be checked; generated collection types of relations end in "Coll"
  return base.includes('.') || /Coll$/.test(base);
}

/**
 * Semantic checks for one items.xml. `file` must be parsed from the text that is being edited; `ts` provides the
 * surrounding type system (parents, other extensions).
 */
export function analyzeItems(
  file: ItemsFile,
  ts: TypeSystem,
  options: ItemsAnalyzeOptions = {},
): Problem[] {
  const problems: Problem[] = file.problems.map((p) => ({
    span: p.span,
    severity: 'error',
    code: 'items.xml.syntax',
    message: p.message,
  }));
  const push = (p: Problem): void => void problems.push(p);

  const seenTypes = new Set<string>();
  for (const type of file.itemTypes) {
    const declaring = type.autocreate;
    if (declaring) {
      if (seenTypes.has(type.code)) {
        push({
          span: type.source.nameSpan,
          severity: 'error',
          code: 'items.type.duplicate',
          message: `Item type "${type.code}" is declared more than once in this file.`,
        });
      }
      seenTypes.add(type.code);
    }

    if (type.extends && type.extendsSpan) {
      const kind = ts.kindOf(type.extends);
      if (kind === undefined) {
        push({
          span: type.extendsSpan,
          severity: 'error',
          code: 'items.extends.unknown',
          message: `Unknown supertype "${type.extends}".`,
          data: { suggestion: closest(type.extends, ts.typeNames()) },
        });
      } else if (kind !== 'item') {
        push({
          span: type.extendsSpan,
          severity: 'error',
          code: 'items.extends.not-item',
          message: `"${type.extends}" is a ${kind} type, not an item type.`,
        });
      }
    }

    const qualifiers = new Map<string, number>();
    const parent = type.extends ? ts.item(type.extends) : undefined;
    const inherited = new Set(
      (parent ? ts.attributeInfos(parent.code) : ts.attributeInfos(IMPLICIT_PARENT)).map((a) =>
        a.qualifier.toLowerCase(),
      ),
    );

    for (const attribute of type.attributes) {
      const key = attribute.qualifier.toLowerCase();
      if (qualifiers.has(key)) {
        push({
          span: attribute.source.nameSpan,
          severity: 'error',
          code: 'items.attribute.duplicate',
          message: `Attribute "${attribute.qualifier}" is declared twice in "${type.code}".`,
        });
      }
      qualifiers.set(key, 1);

      if (attribute.type === '') {
        if (!attribute.redeclare) {
          push({
            span: attribute.source.nameSpan,
            severity: 'error',
            code: 'items.attribute.no-type',
            message: `Attribute "${attribute.qualifier}" needs a type.`,
          });
        }
      } else if (!typeIsKnown(ts, attribute.type)) {
        push({
          span: attribute.typeSpan,
          severity: 'error',
          code: 'items.type.unknown',
          message: `Unknown type "${attribute.baseType}".`,
          data: { suggestion: closest(attribute.baseType, ts.typeNames()) },
        });
      }

      const knownAbove =
        inherited.has(key) ||
        (!type.extends &&
          type.autocreate === false &&
          ts.item(type.code) !== undefined &&
          hasAncestorAttribute(ts, type.code, key));
      if (attribute.redeclare && !knownAbove && !ts.isIncomplete(type.code)) {
        push({
          span: attribute.source.nameSpan,
          severity: 'error',
          code: 'items.attribute.redeclare-nothing',
          message: `redeclare="true", but no supertype of "${type.code}" has an attribute "${attribute.qualifier}".`,
        });
      } else if (!attribute.redeclare && knownAbove && options.category !== 'platform') {
        push({
          span: attribute.source.nameSpan,
          severity: 'warning',
          code: 'items.attribute.shadows',
          message: `A supertype already has the attribute "${attribute.qualifier}". Add redeclare="true" to change it.`,
        });
      }
    }

    const deployment = type.deployment;
    if (deployment?.typecode !== undefined) {
      const other = [...ts.items.values()].find(
        (t) => t.code !== type.code && t.deployment?.typecode === deployment.typecode,
      );
      if (other) {
        push({
          span: deployment.span,
          severity: 'error',
          code: 'items.typecode.duplicate',
          message: `Typecode ${deployment.typecode} is already used by "${other.code}".`,
        });
      }
      if (options.category === 'custom' && deployment.typecode < FIRST_CUSTOM_TYPECODE) {
        push({
          span: deployment.span,
          severity: 'warning',
          code: 'items.typecode.reserved',
          message: `Typecodes below ${FIRST_CUSTOM_TYPECODE} are reserved for SAP. Custom types should use ${FIRST_CUSTOM_TYPECODE}–32767.`,
        });
      }
    }
  }

  for (const e of file.enumTypes) {
    const seen = new Set<string>();
    for (const v of e.values) {
      if (seen.has(v.code)) {
        push({
          span: v.source.nameSpan,
          severity: 'error',
          code: 'items.enum.duplicate-value',
          message: `Value "${v.code}" appears twice in enum "${e.code}".`,
        });
      }
      seen.add(v.code);
    }
  }

  for (const c of file.collectionTypes) {
    if (!typeIsKnown(ts, c.elementType)) {
      push({
        span: c.elementTypeSpan,
        severity: 'error',
        code: 'items.type.unknown',
        message: `Unknown element type "${c.elementType}".`,
        data: { suggestion: closest(c.elementType, ts.typeNames()) },
      });
    }
  }

  for (const r of file.relations) {
    for (const end of [r.sourceElement, r.targetElement]) {
      if (end.type !== '' && ts.kindOf(end.type) !== 'item') {
        push({
          span: end.typeSpan,
          severity: 'error',
          code: 'items.type.unknown',
          message: `Unknown type "${end.type}" in relation "${r.code}".`,
          data: { suggestion: closest(end.type, ts.typeNames()) },
        });
      }
    }
  }

  // Files shipped by SAP cannot be fixed by the project: report their findings as hints only.
  const sapOwned = options.category === 'platform' || options.category === 'modules';
  const adjusted = sapOwned
    ? problems.map((p) =>
        p.code === 'items.xml.syntax' || p.severity === 'hint'
          ? p
          : { ...p, severity: 'hint' as const },
      )
    : problems;
  return applySeverities(adjusted, options.severities);
}

const IMPLICIT_PARENT = 'GenericItem';

function hasAncestorAttribute(ts: TypeSystem, type: string, key: string): boolean {
  const chain = ts.supertypeChain(type).slice(1);
  return chain.some((t) => t.attributes.has(key));
}

function closest(word: string, candidates: readonly string[]): string | undefined {
  const lower = word.toLowerCase();
  let best: string | undefined;
  let bestDistance = Math.min(3, Math.max(1, Math.floor(word.length / 3)));
  for (const candidate of candidates) {
    if (Math.abs(candidate.length - word.length) > bestDistance) continue;
    const d = distance(lower, candidate.toLowerCase());
    if (d < bestDistance || (d === bestDistance && best === undefined)) {
      bestDistance = d;
      best = candidate;
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

/** Quick fixes for the problems of {@link analyzeItems}. */
export function fixesForItems(text: string, problem: Problem): Fix[] {
  const suggestion = problem.data?.suggestion;
  if (typeof suggestion === 'string') {
    return [
      {
        title: `Change to "${suggestion}"`,
        edits: [{ span: problem.span, newText: suggestion }],
        preferred: true,
      },
    ];
  }
  if (problem.code === 'items.attribute.shadows') {
    // insert redeclare="true" at the end of the attribute's start tag
    const close = /\/?>/.exec(text.slice(problem.span.end));
    if (!close) return [];
    const at = problem.span.end + close.index;
    return [
      {
        title: 'Add redeclare="true"',
        edits: [{ span: { start: at, end: at }, newText: ' redeclare="true"' }],
        preferred: true,
      },
    ];
  }
  if (problem.code === 'items.attribute.redeclare-nothing') {
    const tag = /\s+redeclare\s*=\s*(["'])true\1/.exec(
      text.slice(problem.span.end, problem.span.end + 400),
    );
    if (!tag) return [];
    const start = problem.span.end + tag.index;
    return [
      {
        title: 'Remove redeclare="true"',
        edits: [{ span: { start, end: start + tag[0].length }, newText: '' }],
      },
    ];
  }
  return [];
}
