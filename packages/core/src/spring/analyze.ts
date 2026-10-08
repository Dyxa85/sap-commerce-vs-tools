import {
  applySeverities,
  type Problem,
  type SeverityOverride,
} from '../languages/shared/problem.js';
import type { SpringFile } from './model.js';
import type { SpringSystem } from './system.js';

export interface SpringAnalyzeOptions {
  severities?: Record<string, SeverityOverride | undefined>;
  /** Findings in SAP-owned files are shown as hints: the project cannot change them. */
  sapOwned?: boolean;
}

export function analyzeSpring(
  file: SpringFile,
  system: SpringSystem,
  options: SpringAnalyzeOptions = {},
): Problem[] {
  const problems: Problem[] = file.problems.map((p) => ({
    span: p.span,
    severity: 'error',
    code: 'spring.xml.syntax',
    message: p.message,
  }));
  const push = (p: Problem): void => void problems.push(p);

  const ids = new Map<string, number>();
  for (const bean of file.beans) {
    if (bean.id) {
      if (ids.has(bean.id)) {
        push({
          span: bean.idSpan ?? bean.span,
          severity: 'error',
          code: 'spring.bean.duplicate-id',
          message: `Bean id "${bean.id}" is defined twice in this file.`,
        });
      }
      ids.set(bean.id, 1);

      // the same id in another extension: this one overrides (or is overridden by) it
      const defs = system.definitions(bean.id);
      if (defs.length > 1 && bean.idSpan) {
        const effective = defs[defs.length - 1];
        const others = defs.filter((d) => d.file !== file.file).map((d) => d.extension);
        if (effective?.file === file.file && others.length > 0) {
          push({
            span: bean.idSpan,
            severity: 'hint',
            code: 'spring.bean.overrides',
            message: `Overrides the definition of "${bean.id}" from ${[...new Set(others)].join(', ')}.`,
          });
        } else if (effective && effective.file !== file.file) {
          push({
            span: bean.idSpan,
            severity: 'info',
            code: 'spring.bean.overridden',
            message: `Overridden by the definition in ${effective.extension}; this one is not used.`,
          });
        }
      }
    }
    if (bean.element === 'bean' && !bean.abstract && !bean.className && !bean.parent) {
      push({
        span: bean.idSpan ?? { start: bean.span.start, end: bean.span.start + 5 },
        severity: 'warning',
        code: 'spring.bean.no-class',
        message: 'A bean needs a "class" or a "parent".',
      });
    }
    for (const ref of bean.refs) {
      if (!system.has(ref.target)) {
        // Not an error: the bean may be defined in a packaged JAR, in Java configuration or in a context we do not read.
        push({
          span: ref.span,
          severity: 'info',
          code: ref.kind === 'parent' ? 'spring.parent.unknown' : 'spring.ref.unknown',
          message: `No bean or alias "${ref.target}" in the Spring XML files of the loaded extensions (it may come from a packaged JAR or Java configuration).`,
          data: { suggestion: closest(ref.target, system.allIds()) },
        });
      }
    }
  }

  for (const alias of file.aliases) {
    if (!system.has(alias.name)) {
      push({
        span: alias.nameSpan,
        severity: 'info',
        code: 'spring.alias.unknown-target',
        message: `The alias "${alias.alias}" points to "${alias.name}", which is not a bean in the Spring XML files of the loaded extensions.`,
        data: { suggestion: closest(alias.name, system.allIds()) },
      });
    }
  }

  const adjusted = options.sapOwned
    ? problems.map((p) =>
        p.code === 'spring.xml.syntax' || p.severity === 'hint'
          ? p
          : { ...p, severity: 'hint' as const },
      )
    : problems;
  return applySeverities(adjusted, options.severities);
}

function closest(word: string, candidates: readonly string[]): string | undefined {
  const lower = word.toLowerCase();
  let best: string | undefined;
  let bestDistance = Math.min(3, Math.max(1, Math.floor(word.length / 4)));
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
