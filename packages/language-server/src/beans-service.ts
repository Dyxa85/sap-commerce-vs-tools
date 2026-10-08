import { beans, type ExtensionCategory } from '@sapcommerce-vstools/core';
import { basename } from 'node:path';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Location, TextEdit } from 'vscode-languageserver-types';
import {
  FoldingRangeKind,
  MarkupKind,
  SymbolKind,
  type CodeAction,
  type Diagnostic as DiagnosticType,
  type DocumentHighlight,
  type DocumentSymbol,
  type FoldingRange,
  type Hover,
  type Range,
  type WorkspaceEdit,
} from 'vscode-languageserver-types';
import { foldingXml, xml } from '@sapcommerce-vstools/core';
import {
  toCompletionItem,
  toDiagnostic,
  toLocation,
  toRange,
  type LanguageService,
  type LanguageSettings,
} from './lsp-util.js';
import { uriToPath } from './project-index.js';

export const BEANS_SOURCE = 'sapcommerce-beans';

const KIND: Record<beans.BeansSymbol['kind'], SymbolKind> = {
  bean: SymbolKind.Class,
  enum: SymbolKind.Enum,
  property: SymbolKind.Property,
  value: SymbolKind.EnumMember,
};

/** Language features for `*-beans.xml` (bean system definitions). */
export class BeansXmlService implements LanguageService {
  readonly languageId = 'xml:beans';
  readonly section = 'sapcommerce.beans';
  private readonly cache = new Map<string, { version: number; xml: xml.XmlDocument }>();

  constructor(
    private readonly system: (uri: string) => beans.BeanSystem | undefined,
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
    const system = this.system(document.uri);
    return system ? beans.openBeansDocument(document.getText(), system) : undefined;
  }

  diagnostics(document: TextDocument, settings: LanguageSettings): DiagnosticType[] {
    const parsed = this.parse(document);
    const system = this.system(document.uri);
    if (!system) {
      return parsed.problems.map((p) =>
        toDiagnostic(
          parsed.lines,
          { span: p.span, severity: 'error', code: 'beans.xml.syntax', message: p.message },
          BEANS_SOURCE,
        ),
      );
    }
    const path = uriToPath(document.uri) ?? document.uri;
    const file = beans.parseBeansXml(
      document.getText(),
      path,
      basename(path).replace(/-beans\.xml$/, ''),
    );
    const category = this.category(document.uri);
    return beans
      .analyzeBeans(file, system, {
        severities: settings.severities,
        sapOwned: category === 'platform' || category === 'modules',
      })
      .map((p) => toDiagnostic(parsed.lines, p, BEANS_SOURCE));
  }

  completion(document: TextDocument, line: number, character: number) {
    const doc = this.open(document);
    if (!doc) return [];
    return beans
      .completeBeans(doc, doc.xml.lines.offsetAt({ line, character }))
      .map((e) => toCompletionItem(doc.xml.lines, e));
  }

  hover(document: TextDocument, line: number, character: number): Hover | null {
    const doc = this.open(document);
    if (!doc) return null;
    const info = beans.hoverBeans(doc, doc.xml.lines.offsetAt({ line, character }));
    return info
      ? {
          contents: { kind: MarkupKind.Markdown, value: info.markdown },
          range: toRange(doc.xml.lines, info.span),
        }
      : null;
  }

  definition(document: TextDocument, line: number, character: number): Location | null {
    const doc = this.open(document);
    const location = doc
      ? beans.definitionBeans(doc, doc.xml.lines.offsetAt({ line, character }))
      : undefined;
    return location ? toLocation(location) : null;
  }

  references(): Location[] {
    return [];
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
    const convert = (s: beans.BeansSymbol): DocumentSymbol => ({
      name: s.name,
      detail: s.detail,
      kind: KIND[s.kind],
      range: toRange(parsed.lines, s.span),
      selectionRange: toRange(parsed.lines, s.selection),
      children: s.children.map(convert),
    });
    return beans.outlineBeans(parsed).map(convert);
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

  codeActions(): CodeAction[] {
    return [];
  }
}
