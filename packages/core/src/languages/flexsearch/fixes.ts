import type { Fix } from '../shared/edits.js';
import type { Problem } from '../shared/problem.js';
import type { FlexDocument } from './model.js';

export function flexFixesFor(doc: FlexDocument, problem: Problem): Fix[] {
  switch (problem.code) {
    case 'flexsearch.alias.unknown': {
      const suggestion = problem.data?.suggestion;
      return typeof suggestion === 'string'
        ? [
            {
              title: `Change to "${suggestion}"`,
              edits: [{ span: problem.span, newText: suggestion }],
              preferred: true,
            },
          ]
        : [];
    }
    case 'flexsearch.from.alias-without-as': {
      const typeEnd = problem.data?.typeEnd;
      const aliasStart = problem.data?.aliasStart;
      if (typeof typeEnd !== 'number' || typeof aliasStart !== 'number') return [];
      return [
        {
          title: 'Insert AS',
          edits: [{ span: { start: typeEnd, end: aliasStart }, newText: ' AS ' }],
          preferred: true,
        },
      ];
    }
    case 'flexsearch.trailing-semicolon':
      return [
        {
          title: 'Remove trailing ";"',
          edits: [{ span: problem.span, newText: '' }],
          preferred: true,
        },
      ];
    case 'flexsearch.comment.line': {
      const body = doc.text.slice(problem.span.start + 2, problem.span.end).trimEnd();
      return [
        {
          title: 'Convert to /* … */ comment',
          edits: [{ span: problem.span, newText: `/*${body} */` }],
          preferred: true,
        },
      ];
    }
    case 'flexsearch.syntax.unterminated-string': {
      const lineEnd = doc.lines.lineEnd(doc.lines.positionAt(problem.span.start).line);
      return [
        {
          title: 'Insert closing quote',
          edits: [
            {
              span: { start: lineEnd, end: lineEnd },
              newText: doc.text[problem.span.start] ?? "'",
            },
          ],
        },
      ];
    }
    case 'flexsearch.syntax.missing-brace': {
      const lineEnd = doc.lines.lineEnd(doc.lines.positionAt(problem.span.start).line);
      return [
        {
          title: "Insert missing '}'",
          edits: [{ span: { start: lineEnd, end: lineEnd }, newText: '}' }],
        },
      ];
    }
    default:
      return [];
  }
}
