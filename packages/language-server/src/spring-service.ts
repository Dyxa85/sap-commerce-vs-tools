import { spring, foldingXml, xml, type ExtensionCategory } from '@sapcommerce-vstools/core';
import { basename } from 'node:path';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CodeActionKind,
  FoldingRangeKind,
  MarkupKind,
  SymbolKind,
  TextEdit,
  type CodeAction,
  type Diagnostic as DiagnosticType,
  type DocumentHighlight,
  type DocumentSymbol,
  type FoldingRange,
  type Hover,
  type Location,
  type Range,
  type WorkspaceEdit,
} from 'vscode-languageserver-types';
import {
  toCompletionItem,
  toDiagnostic,
  toLocation,
  toRange,
  type LanguageService,
  type LanguageSettings,
} from './lsp-util.js';
import { uriToPath } from './project-index.js';

export const SPRING_SOURCE = 'sapcommerce-spring';

interface SpringContext {
  system: spring.SpringSystem;
  java: spring.JavaIndex;
}

/** Language features for `*-spring.xml`: bean ids, aliases, overrides and class navigation. */
export class SpringXmlService implements LanguageService {
  readonly languageId = 'xml:spring';
  readonly section = 'sapcommerce.spring';
  private readonly cache = new Map<string, { version: number; xml: xml.XmlDocument }>();

  constructor(
    private readonly context: (uri: string) => SpringContext | undefined,
    private readonly category: (uri: string) => ExtensionCategory | undefined = () => undefined,
  ) {}

  private parse(document: TextDocument): xml.XmlDocument {
    const cached = this.cache.get(document.uri);
    if (cached && cached.version === document.version) return cached.xml;
    const parsed = xml.parseXml(document.getText());
    this.cache.set(document.uri, { version: document.version, xml: parsed });
    return parsed;
  }

  forget(uri: string): void {
    this.cache.delete(uri);
  }

  private open(document: TextDocument) {
    const ctx = this.context(document.uri);
    return ctx ? spring.openSpringDocument(document.getText(), ctx.system, ctx.java) : undefined;
  }

  diagnostics(document: TextDocument, settings: LanguageSettings): DiagnosticType[] {
    const parsed = this.parse(document);
    const ctx = this.context(document.uri);
    if (!ctx) {
      return parsed.problems.map((p) =>
        toDiagnostic(
          parsed.lines,
          { span: p.span, severity: 'error', code: 'spring.xml.syntax', message: p.message },
          SPRING_SOURCE,
        ),
      );
    }
    const path = uriToPath(document.uri) ?? document.uri;
    const file = spring.parseSpringXml(
      document.getText(),
      path,
      this.extensionOf(document.uri) ?? basename(path),
    );
    const category = this.category(document.uri);
    return spring
      .analyzeSpring(file, ctx.system, {
        severities: settings.severities,
        sapOwned: category === 'platform' || category === 'modules',
      })
      .map((p) => toDiagnostic(parsed.lines, p, SPRING_SOURCE));
  }

  /** Name of the extension a file belongs to, taken from the file name convention `<ext>-spring.xml`. */
  private extensionOf(uri: string): string | undefined {
    const ctx = this.context(uri);
    const path = uriToPath(uri);
    if (!ctx || !path) return undefined;
    return ctx.system.files.find((f) => f.file === path)?.extension;
  }

  completion(document: TextDocument, line: number, character: number) {
    const doc = this.open(document);
    if (!doc) return [];
    return spring
      .completeSpring(doc, doc.xml.lines.offsetAt({ line, character }))
      .map((e) => toCompletionItem(doc.xml.lines, e));
  }

  hover(document: TextDocument, line: number, character: number): Hover | null {
    const doc = this.open(document);
    if (!doc) return null;
    const info = spring.hoverSpring(doc, doc.xml.lines.offsetAt({ line, character }));
    return info
      ? {
          contents: { kind: MarkupKind.Markdown, value: info.markdown },
          range: toRange(doc.xml.lines, info.span),
        }
      : null;
  }

  definition(
    document: TextDocument,
    line: number,
    character: number,
  ): Location | Location[] | null {
    const doc = this.open(document);
    if (!doc) return null;
    const locations = spring
      .definitionSpring(doc, doc.xml.lines.offsetAt({ line, character }))
      .map(toLocation);
    return locations.length === 0 ? null : locations;
  }

  references(document: TextDocument, line: number, character: number): Location[] {
    const doc = this.open(document);
    return doc
      ? spring.referencesSpring(doc, doc.xml.lines.offsetAt({ line, character })).map(toLocation)
      : [];
  }

  highlights(): DocumentHighlight[] {
    return [];
  }

  prepareRename(): { range: Range; placeholder: string } | null {
    return null;
  }

  rename(): WorkspaceEdit | null {
    return null;
  }

  symbols(document: TextDocument): DocumentSymbol[] {
    const parsed = this.parse(document);
    return spring.outlineSpring(parsed).map((s) => ({
      name: s.name,
      detail: s.detail,
      kind: s.kind === 'alias' ? SymbolKind.Interface : SymbolKind.Class,
      range: toRange(parsed.lines, s.span),
      selectionRange: toRange(parsed.lines, s.selection),
    }));
  }

  folding(document: TextDocument): FoldingRange[] {
    const parsed = this.parse(document);
    return foldingXml(parsed).map((span) => {
      const r = toRange(parsed.lines, span);
      return {
        startLine: r.start.line,
        endLine: r.end.line,
        kind: parsed.text.startsWith('<!--', span.start)
          ? FoldingRangeKind.Comment
          : FoldingRangeKind.Region,
      };
    });
  }

  semanticTokens(): { data: number[] } {
    return { data: [] };
  }

  format(): TextEdit[] {
    return [];
  }

  codeActions(
    document: TextDocument,
    _range: Range,
    diagnostics: readonly DiagnosticType[],
    settings: LanguageSettings,
  ): CodeAction[] {
    const ctx = this.context(document.uri);
    if (!ctx) return [];
    const parsed = this.parse(document);
    const path = uriToPath(document.uri) ?? document.uri;
    const file = spring.parseSpringXml(
      document.getText(),
      path,
      this.extensionOf(document.uri) ?? basename(path),
    );
    const problems = spring.analyzeSpring(file, ctx.system, { severities: settings.severities });
    const actions: CodeAction[] = [];
    for (const diagnostic of diagnostics) {
      if (diagnostic.source !== SPRING_SOURCE) continue;
      const problem = problems.find(
        (p) =>
          p.code === diagnostic.code &&
          p.span.start === parsed.lines.offsetAt(diagnostic.range.start) &&
          p.span.end === parsed.lines.offsetAt(diagnostic.range.end),
      );
      const suggestion = problem?.data?.suggestion;
      if (!problem || typeof suggestion !== 'string') continue;
      actions.push({
        title: `Change to "${suggestion}"`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        isPreferred: true,
        edit: {
          changes: {
            [document.uri]: [TextEdit.replace(toRange(parsed.lines, problem.span), suggestion)],
          },
        },
      });
    }
    return actions;
  }
}
