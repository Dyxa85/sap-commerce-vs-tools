import { attributeModifier, typeModifier, type ModifierInfo } from './knowledge.js';
import { isBuiltinMacro, resolveMacroName } from './macros.js';
import type { Header, ImpexDocument, Modifier } from './model.js';
import { applySeverities, type Problem, type SeverityOverride } from '../shared/problem.js';
import type { TypeSchema } from '../shared/schema.js';
import { checkAgainstSchema } from './analyze-types.js';

export interface AnalyzeOptions {
  /** Per-code severity overrides (or "off"), typically from user settings. */
  severities?: Record<string, SeverityOverride | undefined>;
  /** Type system; enables the checks for types, attributes, references and enum values. */
  schema?: TypeSchema;
}

/** All problems of a document: syntax problems from the parser plus semantic checks. */
export function analyze(doc: ImpexDocument, options: AnalyzeOptions = {}): Problem[] {
  const problems: Problem[] = [...doc.problems];

  for (const header of doc.headers) {
    if (header.valid) checkHeader(doc, header, problems);
    checkRows(doc, header, problems);
  }
  checkRowsWithoutHeader(doc, problems);
  checkMacros(doc, problems);
  checkScripts(doc, problems);
  if (options.schema) checkAgainstSchema(doc, options.schema, problems);

  return applySeverities(problems, options.severities);
}

// ------------------------------------------------------------------ headers

function checkHeader(doc: ImpexDocument, header: Header, problems: Problem[]): void {
  const mode = header.canonicalMode;

  // Duplicate columns ("ambiguous columns" in the importer): same attribute and same language.
  const seen = new Map<string, number>();
  for (const column of header.columns) {
    if (column.kind !== 'attribute' && column.kind !== 'dynamic') continue;
    if (column.name.includes('$')) continue;
    const langModifier = column.modifiers.find((m) => m.name.toLowerCase() === 'lang');
    const lang = (langModifier?.value ?? '').toLowerCase();
    const key = `${column.kind}:${column.name.toLowerCase()}|${lang}`;
    if (seen.has(key)) {
      problems.push({
        span: column.span,
        severity: 'error',
        code: 'impex.header.duplicate-column',
        message: `Duplicate column "${column.name}"${lang ? ` (lang=${lang})` : ''}: the importer rejects ambiguous columns.`,
      });
    }
    seen.set(key, column.index);
  }

  // Modifiers
  checkModifiers(header.typeModifiers, typeModifier, 'type', problems);
  for (const column of header.columns) {
    checkModifiers(column.modifiers, attributeModifier, 'attribute', problems);
    for (const ref of column.refs) checkRefModifiers(ref, problems);
  }

  // Strict mode needs at least one unique column to identify items.
  if (mode && mode !== 'INSERT') {
    const dynamic = header.columns.some((c) => c.kind === 'macro');
    const hasUnique = header.columns.some((c) =>
      c.modifiers.some(
        (m) => m.name.toLowerCase() === 'unique' && m.value?.toLowerCase() !== 'false',
      ),
    );
    const unresolvable = header.columns.some(
      (c) => c.modifiers.some((m) => (m.value ?? m.name).includes('$')) || c.name.includes('$'),
    );
    const batch = header.typeModifiers.some(
      (m) => m.name.toLowerCase() === 'batchmode' && m.value === 'true',
    );
    if (!hasUnique && !dynamic && !unresolvable && !batch) {
      const hasUniqueViaMacro = doc.macros.some((m) => /unique\s*=\s*true/i.test(m.value));
      if (!hasUniqueViaMacro) {
        problems.push({
          span: header.span,
          severity: 'warning',
          code: 'impex.header.no-unique',
          message: `${mode} needs at least one column with [unique=true]; in strict mode the importer rejects this header.`,
        });
      }
    }
  }
}

function checkRefModifiers(
  ref: { modifiers: Modifier[]; children: (typeof ref)[] },
  problems: Problem[],
): void {
  checkModifiers(ref.modifiers, attributeModifier, 'attribute', problems);
  for (const child of ref.children) checkRefModifiers(child, problems);
}

function checkModifiers(
  modifiers: readonly Modifier[],
  lookup: (name: string) => ModifierInfo | undefined,
  scope: 'attribute' | 'type',
  problems: Problem[],
): void {
  const seen = new Set<string>();
  for (const modifier of modifiers) {
    const key = modifier.name.toLowerCase();
    if (modifier.name.includes('$')) continue;

    if (seen.has(key)) {
      problems.push({
        span: modifier.span,
        severity: 'warning',
        code: 'impex.modifier.duplicate',
        message: `Modifier "${modifier.name}" is given more than once.`,
      });
    }
    seen.add(key);

    const info = lookup(modifier.name);
    if (!info) {
      const other =
        scope === 'type' ? attributeModifier(modifier.name) : typeModifier(modifier.name);
      problems.push({
        span: modifier.nameSpan,
        severity: 'warning',
        code: 'impex.modifier.unknown',
        message: other
          ? `"${modifier.name}" is a ${other.scope} modifier and does not apply here.`
          : `Unknown modifier "${modifier.name}". Custom modifiers of your own extensions can be ignored.`,
      });
      continue;
    }

    const hasValueText = !!modifier.valueSpan && modifier.valueSpan.end > modifier.valueSpan.start;
    if (modifier.value === undefined || modifier.value === '') {
      if (info.kind !== 'boolean' && !hasValueText) {
        problems.push({
          span: modifier.span,
          severity: 'warning',
          code: 'impex.modifier.missing-value',
          message: `Modifier "${info.name}" needs a value, e.g. ${info.name}=…`,
        });
      }
      continue;
    }
    if (modifier.value.includes('$')) continue;
    if (
      info.values &&
      !info.values.some((v) => v.toLowerCase() === modifier.value?.toLowerCase())
    ) {
      problems.push({
        span: modifier.valueSpan ?? modifier.span,
        severity: 'warning',
        code: 'impex.modifier.invalid-value',
        message: `"${modifier.value}" is not valid for "${info.name}". Use ${info.values.join(' or ')}.`,
      });
    }
  }
}

// ------------------------------------------------------------------ rows

function checkRows(doc: ImpexDocument, header: Header, problems: Problem[]): void {
  if (!header.valid) return;
  const expected = header.columns.length + 1; // cell 0 is the type column

  let previousEnd = header.span.end;
  for (const row of header.rows) {
    // Indented line directly after a header that looks like more header columns.
    const first = row.cells[0];
    if (
      first &&
      first.value !== '' &&
      /^[\w@&$.-]+\s*[[(]/.test(first.value) &&
      doc.lines.positionAt(row.span.start).line === doc.lines.positionAt(previousEnd).line + 1
    ) {
      problems.push({
        span: row.span,
        severity: 'warning',
        code: 'impex.row.header-continuation',
        message:
          'Headers cannot continue on the next line: this line is imported as a value row. Put the whole header on one line.',
      });
    }
    previousEnd = row.span.end;

    if (row.multiline) continue;
    const extra = row.cells.slice(expected).filter((c) => c.value !== '');
    if (extra.length > 0) {
      const last = extra[extra.length - 1];
      const firstExtra = extra[0];
      if (firstExtra && last) {
        problems.push({
          span: { start: firstExtra.valueSpan.start, end: last.valueSpan.end },
          severity: 'warning',
          code: 'impex.row.extra-cells',
          message: `${extra.length} value(s) beyond the ${header.columns.length} header column(s): the importer ignores them.`,
          data: { expected },
        });
      }
    }

    const lastCell = row.cells[row.cells.length - 1];
    if (lastCell && !lastCell.quoted) {
      const hash = /\s#/.exec(lastCell.value);
      if (hash && lastCell.value.trim().length > 0) {
        const at = lastCell.valueSpan.start + hash.index + 1;
        problems.push({
          span: { start: at, end: lastCell.valueSpan.end },
          severity: 'info',
          code: 'impex.value.trailing-comment',
          message:
            "'#' does not start a comment inside a value row: this text is imported as part of the value.",
        });
      }
    }
  }
}

function checkRowsWithoutHeader(doc: ImpexDocument, problems: Problem[]): void {
  for (const statement of doc.statements) {
    if (statement.kind !== 'row' || statement.header || statement.userRights) continue;
    const firstLineEnd = doc.lines.lineEnd(doc.lines.positionAt(statement.span.start).line);
    problems.push({
      span: { start: statement.span.start, end: Math.min(firstLineEnd, statement.span.end) },
      severity: 'error',
      code: 'impex.row.no-header',
      message:
        'Value row without a header: the importer reports "no current header for value line".',
    });
  }
}

// ------------------------------------------------------------------ macros & scripts

function checkMacros(doc: ImpexDocument, problems: Problem[]): void {
  const usedDefs = new Set<number>();
  for (const use of doc.macroUses) {
    if (isBuiltinMacro(use.name)) continue;
    const hit = resolveMacroName(doc, use.name, use.span.start);
    if (hit) {
      usedDefs.add(hit.def.span.start);
    } else {
      problems.push({
        span: use.span,
        severity: 'warning',
        code: 'impex.macro.undefined',
        message: `Macro $${use.name} is not defined above this line; the importer uses the text "$${use.name}" literally.`,
        data: { name: use.name },
      });
    }
  }
  for (const def of doc.macros) {
    if (!usedDefs.has(def.span.start)) {
      problems.push({
        span: def.nameSpan,
        severity: 'hint',
        code: 'impex.macro.unused',
        message: `Macro $${def.name} is never used.`,
        unnecessary: true,
      });
    }
  }
}

function checkScripts(doc: ImpexDocument, problems: Problem[]): void {
  const script = doc.statements.find((s) => s.kind === 'script');
  if (script) {
    problems.push({
      span: script.span,
      severity: 'hint',
      code: 'impex.script.code-execution',
      message:
        '"#%" lines run code and only work when code execution is enabled for the import (setting sapcommerce.impex.enableCodeExecution).',
    });
  }
}
