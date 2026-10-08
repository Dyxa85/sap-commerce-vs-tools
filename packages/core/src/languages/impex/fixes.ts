import type { Fix, TextEdit } from '../shared/edits.js';
import type { Problem } from '../shared/problem.js';
import type { ImpexDocument } from './model.js';

/** Quick fixes for a problem; pure and unit-tested, wired to LSP code actions by the language server. */
export function fixesFor(doc: ImpexDocument, problem: Problem): Fix[] {
  const { text, lines } = doc;
  const lineEndOf = (offset: number): number => lines.lineEnd(lines.positionAt(offset).line);

  switch (problem.code) {
    case 'impex.header.unknown-mode': {
      const suggestion = problem.data?.suggestion;
      if (typeof suggestion !== 'string') return [];
      return [
        {
          title: `Change to ${suggestion}`,
          edits: [{ span: problem.span, newText: suggestion }],
          preferred: true,
        },
      ];
    }

    case 'impex.type.unknown':
    case 'impex.attribute.unknown':
    case 'impex.reference.unknown':
    case 'impex.value.unknown-enum': {
      const suggestion = problem.data?.suggestion;
      if (typeof suggestion !== 'string') return [];
      return [
        {
          title: `Change to "${suggestion}"`,
          edits: [{ span: problem.span, newText: suggestion }],
          preferred: true,
        },
      ];
    }

    case 'impex.macro.undefined': {
      const name = problem.data?.name;
      if (typeof name !== 'string') return [];
      return [
        {
          title: `Define macro $${name}`,
          edits: [{ span: { start: 0, end: 0 }, newText: `$${name}=\n` }],
        },
      ];
    }

    case 'impex.syntax.missing-bracket': {
      const close = problem.data?.close;
      if (typeof close !== 'string') return [];
      const lineEnd = lineEndOf(problem.span.start);
      let at = lineEnd;
      // insert before a trailing semicolon-separated remainder only when the bracket is in the last segment
      const nextSemicolon = text.indexOf(';', problem.span.end);
      if (nextSemicolon !== -1 && nextSemicolon < lineEnd) at = nextSemicolon;
      return [
        {
          title: `Insert missing '${close}'`,
          edits: [{ span: { start: at, end: at }, newText: close }],
          preferred: true,
        },
      ];
    }

    case 'impex.syntax.unterminated-quote': {
      const at = lineEndOf(problem.span.start);
      return [
        { title: 'Insert closing quote', edits: [{ span: { start: at, end: at }, newText: '"' }] },
      ];
    }

    case 'impex.row.extra-cells': {
      const row = doc.statements.find(
        (s) =>
          s.kind === 'row' &&
          problem.span.start >= s.span.start &&
          problem.span.start <= s.span.end,
      );
      const expected = problem.data?.expected;
      if (row?.kind !== 'row' || typeof expected !== 'number') return [];
      const keep = row.cells[expected - 1];
      if (!keep) return [];
      return [
        {
          title: 'Remove surplus values',
          edits: [{ span: { start: keep.span.end, end: row.span.end }, newText: '' }],
          preferred: true,
        },
      ];
    }

    case 'impex.row.header-continuation': {
      const row = doc.statements.find(
        (s) => s.kind === 'row' && s.span.start === problem.span.start,
      );
      if (row?.kind !== 'row' || !row.header) return [];
      const header = row.header;
      const first = row.cells[0];
      if (!first) return [];
      const joiner = text.slice(header.span.start, header.span.end).trimEnd().endsWith(';')
        ? ''
        : ';';
      return [
        {
          title: 'Join with the header line',
          edits: [
            { span: { start: header.span.end, end: first.valueSpan.start }, newText: joiner },
          ],
          preferred: true,
        },
      ];
    }

    case 'impex.header.no-unique': {
      const header = doc.headers.find((h) => h.span.start === problem.span.start);
      const column = header?.columns.find((c) => c.kind === 'attribute');
      if (!column) return [];
      const edit: TextEdit = column.modifiersSpan
        ? {
            span: { start: column.modifiersSpan.start + 1, end: column.modifiersSpan.start + 1 },
            newText: 'unique=true,',
          }
        : { span: { start: column.span.end, end: column.span.end }, newText: '[unique=true]' };
      return [{ title: `Mark "${column.name}" as unique`, edits: [edit] }];
    }

    case 'impex.macro.unused': {
      const def = doc.macros.find((m) => m.nameSpan.start === problem.span.start);
      if (!def) return [];
      const line = lines.positionAt(def.span.start).line;
      const start = lines.lineStarts[line] ?? 0;
      const end = lines.lineStarts[line + 1] ?? text.length;
      return [
        {
          title: `Remove unused macro $${def.name}`,
          edits: [{ span: { start, end }, newText: '' }],
        },
      ];
    }

    default:
      return [];
  }
}
