import {
  applySeverities,
  type Problem,
  type SeverityOverride,
} from '../languages/shared/problem.js';
import type { BeansFile } from './model.js';
import type { BeanSystem } from './system.js';

export interface BeansAnalyzeOptions {
  severities?: Record<string, SeverityOverride | undefined>;
  /** SAP-owned files cannot be fixed by the project; their findings are shown as hints. */
  sapOwned?: boolean;
}

export function analyzeBeans(
  file: BeansFile,
  system: BeanSystem,
  options: BeansAnalyzeOptions = {},
): Problem[] {
  const problems: Problem[] = file.problems.map((p) => ({
    span: p.span,
    severity: 'error',
    code: 'beans.xml.syntax',
    message: p.message,
  }));
  const push = (p: Problem): void => void problems.push(p);

  const declared = new Set<string>();
  for (const bean of file.beans) {
    if (declared.has(bean.className)) {
      push({
        span: bean.source.nameSpan,
        severity: 'error',
        code: 'beans.bean.duplicate',
        message: `Bean "${bean.className}" is declared twice in this file.`,
      });
    }
    declared.add(bean.className);

    if (!bean.className.includes('.')) {
      push({
        span: bean.source.nameSpan,
        severity: 'warning',
        code: 'beans.class.no-package',
        message: `"${bean.className}" is not a fully qualified class name.`,
      });
    }

    if (
      bean.extends &&
      bean.extendsSpan &&
      !system.resolve(bean.extends) &&
      // a fully qualified name may be a plain Java class, which cannot be checked here
      !bean.extends.includes('.')
    ) {
      push({
        span: bean.extendsSpan,
        severity: 'warning',
        code: 'beans.extends.unknown',
        message: `"${bean.extends}" is not a bean defined in the loaded extensions.`,
      });
    }

    const names = new Set<string>();
    for (const property of bean.properties) {
      if (names.has(property.name)) {
        push({
          span: property.source.nameSpan,
          severity: 'error',
          code: 'beans.property.duplicate',
          message: `Property "${property.name}" is declared twice in "${bean.className}".`,
        });
      }
      names.add(property.name);
      if (property.type === '') {
        push({
          span: property.source.nameSpan,
          severity: 'error',
          code: 'beans.property.no-type',
          message: `Property "${property.name}" needs a type.`,
        });
      }
      if (/^[A-Z]/.test(property.name)) {
        push({
          span: property.source.nameSpan,
          severity: 'hint',
          code: 'beans.property.naming',
          message: `Property names conventionally start with a lower-case letter ("${property.name}").`,
        });
      }
    }
  }

  for (const e of file.enums) {
    const seen = new Set<string>();
    for (const v of e.values) {
      if (seen.has(v.code))
        push({
          span: v.span,
          severity: 'error',
          code: 'beans.enum.duplicate-value',
          message: `Value "${v.code}" appears twice in "${e.className}".`,
        });
      seen.add(v.code);
    }
    if (e.values.length === 0)
      push({
        span: e.source.nameSpan,
        severity: 'warning',
        code: 'beans.enum.empty',
        message: `Enum "${e.className}" has no values.`,
      });
  }

  const adjusted = options.sapOwned
    ? problems.map((p) =>
        p.code === 'beans.xml.syntax' || p.severity === 'hint'
          ? p
          : { ...p, severity: 'hint' as const },
      )
    : problems;
  return applySeverities(adjusted, options.severities);
}
