import type { Problem } from '../shared/problem.js';
import type { SchemaAttribute, TypeSchema } from '../shared/schema.js';
import type { Column, Header, ImpexDocument, RefNode } from './model.js';

/** Type-system aware checks. Only run when a schema is available; otherwise ImpEx stays silent about types. */
export function checkAgainstSchema(
  doc: ImpexDocument,
  schema: TypeSchema,
  problems: Problem[],
): void {
  for (const header of doc.headers) {
    if (!header.valid || !header.typeSpan || header.typeName.includes('$')) continue;

    if (!schema.hasType(header.typeName)) {
      problems.push({
        span: header.typeSpan,
        severity: 'error',
        code: 'impex.type.unknown',
        message: `Unknown type "${header.typeName}" (the importer reports "unknown type … in header").`,
        data: { suggestion: closest(header.typeName, schema.typeNames()) },
      });
      continue;
    }
    const attributes = schema.attributes(header.typeName);
    if (!attributes) continue; // enum or other non-item type

    if (
      schema.isAbstract?.(header.typeName) &&
      (header.canonicalMode === 'INSERT' || header.canonicalMode === 'INSERT_UPDATE')
    ) {
      problems.push({
        span: header.typeSpan,
        severity: 'warning',
        code: 'impex.type.abstract',
        message: `${header.typeName} is abstract: items cannot be created from this header. Use a concrete subtype.`,
      });
    }

    const byName = new Map(attributes.map((a) => [a.name.toLowerCase(), a]));
    for (const column of header.columns)
      checkColumn(header, column, byName, attributes, schema, problems);
    checkEnumCells(header, byName, schema, problems);
  }
}

function checkColumn(
  header: Header,
  column: Column,
  byName: ReadonlyMap<string, SchemaAttribute>,
  attributes: readonly SchemaAttribute[],
  schema: TypeSchema,
  problems: Problem[],
): void {
  if (column.kind !== 'attribute' || column.name === '' || column.name.includes('$')) return;
  if (
    column.modifiers.some(
      (m) => m.name.toLowerCase() === 'virtual' && m.value?.toLowerCase() === 'true',
    )
  )
    return;

  const attribute = byName.get(column.name.toLowerCase());
  if (!attribute) {
    if (schema.isIncomplete?.(header.typeName)) return;
    problems.push({
      span: column.nameSpan,
      severity: 'error',
      code: 'impex.attribute.unknown',
      message: `Type ${header.typeName} has no attribute "${column.name}" (the importer reports "unknown attribute … in header").`,
      data: {
        suggestion: closest(
          column.name,
          attributes.map((a) => a.name),
        ),
      },
    });
    return;
  }

  if (attribute.localized && !column.modifiers.some((m) => m.name.toLowerCase() === 'lang')) {
    problems.push({
      span: column.nameSpan,
      severity: 'info',
      code: 'impex.attribute.localized-without-lang',
      message: `"${attribute.name}" is localized: add [lang=…] to choose the language.`,
    });
  }

  // reference pattern: catalogVersion(catalog(id),version)
  if (column.refs.length > 0 && attribute.type && schema.referencedType) {
    const target = schema.referencedType(attribute.type);
    if (target) checkRefs(column.refs, target, schema, problems);
  }
}

function checkRefs(
  refs: readonly RefNode[],
  typeName: string,
  schema: TypeSchema,
  problems: Problem[],
): void {
  const attributes = schema.attributes(typeName);
  if (!attributes || schema.isIncomplete?.(typeName)) return; // enums, and types whose declaration is not loaded
  const byName = new Map(attributes.map((a) => [a.name.toLowerCase(), a]));
  for (const ref of refs) {
    if (ref.name === '' || ref.name.includes('$') || ref.name.startsWith('&')) continue; // &docId references
    if (ref.name.includes('.')) {
      checkQualifiedRef(ref, schema, problems);
      continue;
    }
    const attribute = byName.get(ref.name.toLowerCase());
    if (!attribute) {
      problems.push({
        span: { start: ref.span.start, end: ref.span.start + ref.name.length },
        severity: 'warning',
        code: 'impex.reference.unknown',
        message: `Type ${typeName} has no attribute "${ref.name}" to look the reference up by.`,
        data: {
          suggestion: closest(
            ref.name,
            attributes.map((a) => a.name),
          ),
        },
      });
      continue;
    }
    if (ref.children.length > 0 && attribute.type && schema.referencedType) {
      const next = schema.referencedType(attribute.type);
      if (next) checkRefs(ref.children, next, schema, problems);
    }
  }
}

/** `CMSLinkComponent.uid`: the attribute is looked up on the named type. */
function checkQualifiedRef(ref: RefNode, schema: TypeSchema, problems: Problem[]): void {
  const dot = ref.name.indexOf('.');
  const typeName = ref.name.slice(0, dot);
  const attributeName = ref.name.slice(dot + 1);
  const attributes = schema.hasType(typeName) ? schema.attributes(typeName) : undefined;
  if (!attributes || schema.isIncomplete?.(typeName)) return;
  if (!attributes.some((a) => a.name.toLowerCase() === attributeName.toLowerCase())) {
    problems.push({
      span: { start: ref.span.start + dot + 1, end: ref.span.start + ref.name.length },
      severity: 'warning',
      code: 'impex.reference.unknown',
      message: `Type ${typeName} has no attribute "${attributeName}".`,
      data: {
        suggestion: closest(
          attributeName,
          attributes.map((a) => a.name),
        ),
      },
    });
  }
}

function checkEnumCells(
  header: Header,
  byName: ReadonlyMap<string, SchemaAttribute>,
  schema: TypeSchema,
  problems: Problem[],
): void {
  if (!schema.enumValues) return;
  for (const column of header.columns) {
    if (column.kind !== 'attribute') continue;
    // enum values are written plain or as status(code)
    const onlyCode =
      column.refs.length === 0 ||
      (column.refs.length === 1 &&
        column.refs[0]?.name.toLowerCase() === 'code' &&
        column.refs[0].children.length === 0);
    if (!onlyCode) continue;
    const attribute = byName.get(column.name.toLowerCase());
    if (!attribute) continue;
    const allowed = schema.enumValues(header.typeName, attribute.name);
    if (!allowed || allowed.length === 0) continue;
    const lower = new Set(allowed.map((v) => v.toLowerCase()));
    for (const row of header.rows) {
      const cell = row.cells[column.index];
      if (!cell || cell.value === '' || cell.value.includes('$') || cell.value.startsWith('<'))
        continue;
      // collection attributes hold several values: "A,B"
      let offset = cell.valueSpan.start;
      for (const part of cell.value.split(',')) {
        const value = part.trim();
        const start = offset + (part.length - part.trimStart().length);
        offset += part.length + 1;
        if (value === '' || lower.has(value.toLowerCase())) continue;
        problems.push({
          span: { start, end: start + value.length },
          severity: 'warning',
          code: 'impex.value.unknown-enum',
          message: `"${value}" is not a value of ${attribute.type}. Allowed: ${allowed.slice(0, 8).join(', ')}${allowed.length > 8 ? ', …' : ''}.`,
          data: { suggestion: closest(value, allowed) },
        });
      }
    }
  }
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
