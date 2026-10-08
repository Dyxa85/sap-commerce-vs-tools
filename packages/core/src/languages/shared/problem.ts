import type { Span } from './line-index.js';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export type SeverityOverride = Severity | 'off';

export interface Problem {
  span: Span;
  /** Stable id, e.g. "impex.row.no-header". Used for settings and quick fixes. */
  code: string;
  severity: Severity;
  message: string;
  /** Rendered greyed out in the editor (unused macros). */
  unnecessary?: boolean;
  /** Extra data for quick fixes. */
  data?: Record<string, unknown>;
}

/** Applies per-code severity overrides ("off" drops the problem) and sorts by position. */
export function applySeverities(
  problems: readonly Problem[],
  overrides: Record<string, SeverityOverride | undefined> = {},
): Problem[] {
  const result: Problem[] = [];
  for (const problem of problems) {
    const override = overrides[problem.code];
    if (override === 'off') continue;
    result.push(override ? { ...problem, severity: override } : problem);
  }
  return result.sort((a, b) => a.span.start - b.span.start);
}
