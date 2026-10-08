import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  beans,
  describeType,
  findHybrisDirs,
  searchTypes,
  type SchemaLocation,
} from '@sapcommerce-vstools/core';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CodeActionKind,
  createConnection,
  DidChangeConfigurationNotification,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
  type InitializeResult,
} from 'vscode-languageserver/node';
import { FlexSearchLanguageService } from './flexsearch-service.js';
import { registerGraphRequests } from './graph-requests.js';
import { BeansXmlService } from './beans-service.js';
import { ImpexLanguageService } from './impex-service.js';
import { ItemsXmlService } from './items-service.js';
import { ProcessXmlService, isProcessUri } from './process-service.js';
import { ProjectIndex, uriToPath } from './project-index.js';
import { SpringXmlService } from './spring-service.js';
import {
  DEFAULT_SETTINGS,
  SEMANTIC_LEGEND,
  type LanguageService,
  type LanguageSettings,
} from './lsp-util.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let canConfigure = false;
const settingsCache = new Map<string, Promise<LanguageSettings>>();
const timers = new Map<string, NodeJS.Timeout>();

/** Roots of the SAP Commerce projects: configured paths or auto-detected `hybris` directories. */
async function computeRoots(): Promise<string[]> {
  const folders = ((await connection.workspace.getWorkspaceFolders()) ?? [])
    .map((f) => uriToPath(f.uri))
    .filter((p): p is string => !!p);
  const configured = canConfigure
    ? ((
        (await connection.workspace.getConfiguration({ section: 'sapcommerce.project' })) as {
          roots?: string[];
        } | null
      )?.roots ?? [])
    : [];
  if (configured.length > 0)
    return configured.map((root) => (isAbsolute(root) ? root : join(folders[0] ?? '', root)));
  const found = new Set<string>();
  for (const folder of folders) for (const dir of await findHybrisDirs(folder)) found.add(dir);
  return [...found];
}

const index = new ProjectIndex({
  roots: computeRoots,
  overlay: (path) => {
    for (const document of documents.all())
      if (uriToPath(document.uri) === path) return document.getText();
    return undefined;
  },
  changed: () => {
    for (const document of documents.all()) scheduleDiagnostics(document, 0);
    void connection.sendNotification('sapcommerce/index/updated');
  },
  log: (message) => connection.console.log(message),
});

const services = new Map<string, LanguageService>(
  [
    new ImpexLanguageService(index.schemaFor),
    new FlexSearchLanguageService(index.schemaFor),
    new ItemsXmlService(index.typeSystemFor, (uri) => index.categoryFor(uri)),
    new BeansXmlService(index.beanSystemFor, (uri) => index.categoryFor(uri)),
    new SpringXmlService(index.springFor, (uri) => index.categoryFor(uri)),
    new ProcessXmlService(
      (uri) => index.springFor(uri)?.system,
      (uri) => index.categoryFor(uri),
    ),
  ].map((s) => [s.languageId, s]),
);

connection.onInitialize((params): InitializeResult => {
  canConfigure = params.capabilities.workspace?.configuration === true;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['$', '[', '(', ',', '=', ';', '<', '{', ':', '.'],
        resolveProvider: false,
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      renameProvider: { prepareProvider: true },
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
      semanticTokensProvider: { legend: SEMANTIC_LEGEND, full: true },
    },
  };
});

connection.onInitialized(() => {
  if (canConfigure)
    void connection.client.register(DidChangeConfigurationNotification.type, undefined);
  void index.reload();
});

let reloadTimer: NodeJS.Timeout | undefined;
let typeSystemTimer: NodeJS.Timeout | undefined;
const debounce = (
  timer: NodeJS.Timeout | undefined,
  fn: () => void,
  ms: number,
): NodeJS.Timeout => {
  if (timer) clearTimeout(timer);
  return setTimeout(fn, ms);
};

// Project structure changed on disk (localextensions.xml, extensioninfo.xml, items files)
connection.onDidChangeWatchedFiles(() => {
  reloadTimer = debounce(reloadTimer, () => void index.reload(), 500);
});

async function loadSettings(service: LanguageService, resource: string): Promise<LanguageSettings> {
  if (!canConfigure) return DEFAULT_SETTINGS;
  const raw = (await connection.workspace.getConfiguration({
    scopeUri: resource,
    section: service.section,
  })) as {
    diagnostics?: { severity?: Record<string, string> };
    format?: Record<string, boolean | string | number>;
  } | null;
  return {
    severities: (raw?.diagnostics?.severity ?? {}) as LanguageSettings['severities'],
    format: raw?.format ?? {},
  };
}

function settingsFor(service: LanguageService, resource: string): Promise<LanguageSettings> {
  const key = `${service.languageId}|${resource}`;
  let pending = settingsCache.get(key);
  if (!pending) {
    pending = loadSettings(service, resource).catch(() => DEFAULT_SETTINGS);
    settingsCache.set(key, pending);
  }
  return pending;
}

/** The service responsible for a document, if any. */
function serviceOf(document: TextDocument | undefined): LanguageService | undefined {
  if (!document) return undefined;
  if (document.languageId === 'xml') {
    if (document.uri.endsWith('-items.xml')) return services.get('xml:items');
    if (document.uri.endsWith('-beans.xml')) return services.get('xml:beans');
    if (document.uri.endsWith('-spring.xml')) return services.get('xml:spring');
    if (isProcessUri(document.uri)) return services.get('xml:process');
    return undefined;
  }
  return services.get(document.languageId);
}

function scheduleDiagnostics(document: TextDocument, delay = 120): void {
  const existing = timers.get(document.uri);
  if (existing) clearTimeout(existing);
  timers.set(
    document.uri,
    setTimeout(() => {
      timers.delete(document.uri);
      void publish(document.uri);
    }, delay),
  );
}

async function publish(uri: string): Promise<void> {
  const document = documents.get(uri);
  const service = serviceOf(document);
  if (!document || !service) return;
  const settings = await settingsFor(service, uri);
  // The document may have changed while the settings were loading.
  const current = documents.get(uri);
  if (!current) return;
  await connection.sendDiagnostics({ uri, diagnostics: service.diagnostics(current, settings) });
}

connection.onDidChangeConfiguration(() => {
  settingsCache.clear();
  reloadTimer = debounce(reloadTimer, () => void index.reload(), 300);
  for (const document of documents.all()) scheduleDiagnostics(document, 0);
});

documents.onDidChangeContent((e) => {
  scheduleDiagnostics(e.document);
  // typing in an items.xml: refresh the type system from the unsaved text
  if (
    e.document.uri.endsWith('-items.xml') ||
    e.document.uri.endsWith('-beans.xml') ||
    e.document.uri.endsWith('-spring.xml')
  )
    typeSystemTimer = debounce(typeSystemTimer, () => void index.rebuildSystems(), 250);
});
documents.onDidClose((e) => {
  for (const service of services.values()) service.forget(e.document.uri);
  for (const key of [...settingsCache.keys()])
    if (key.endsWith(`|${e.document.uri}`)) settingsCache.delete(key);
  const timer = timers.get(e.document.uri);
  if (timer) clearTimeout(timer);
  timers.delete(e.document.uri);
  void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

/** Routes a request to the service of the document's language. */
function handle<P extends { textDocument: { uri: string } }, R>(
  fallback: R,
  fn: (service: LanguageService, document: TextDocument, params: P) => R,
) {
  return (params: P): R => {
    const document = documents.get(params.textDocument.uri);
    const service = serviceOf(document);
    return document && service ? fn(service, document, params) : fallback;
  };
}

const handleAsync =
  <P extends { textDocument: { uri: string } }, R>(
    fallback: R,
    fn: (
      service: LanguageService,
      document: TextDocument,
      params: P,
      settings: LanguageSettings,
    ) => R,
  ) =>
  async (params: P): Promise<R> => {
    const document = documents.get(params.textDocument.uri);
    const service = serviceOf(document);
    if (!document || !service) return fallback;
    return fn(service, document, params, await settingsFor(service, params.textDocument.uri));
  };

connection.onCompletion(
  handle([], (s, d, p) => s.completion(d, p.position.line, p.position.character)),
);
connection.onHover(handle(null, (s, d, p) => s.hover(d, p.position.line, p.position.character)));
connection.onDefinition(
  handle(null, (s, d, p) => s.definition(d, p.position.line, p.position.character)),
);
connection.onReferences(
  handle([], (s, d, p) => s.references(d, p.position.line, p.position.character)),
);
connection.onDocumentHighlight(
  handle([], (s, d, p) => s.highlights(d, p.position.line, p.position.character)),
);
connection.onPrepareRename(
  handle(null, (s, d, p) => s.prepareRename(d, p.position.line, p.position.character)),
);
connection.onRenameRequest(
  handle(null, (s, d, p) => s.rename(d, p.position.line, p.position.character, p.newName)),
);
connection.onDocumentSymbol(handle([], (s, d) => s.symbols(d)));
connection.onFoldingRanges(handle([], (s, d) => s.folding(d)));
connection.languages.semanticTokens.on(handle({ data: [] }, (s, d) => s.semanticTokens(d)));

connection.onDocumentFormatting(handleAsync([], (s, d, _p, settings) => s.format(d, settings)));
connection.onDocumentRangeFormatting(
  handleAsync([], (s, d, p, settings) => s.format(d, settings, p.range)),
);
connection.onCodeAction(
  handleAsync([], (s, d, p, settings) =>
    s.codeActions(d, p.range, p.context.diagnostics, settings),
  ),
);

// ---- requests used by the extension's views and commands
const toUri = (
  location: SchemaLocation | undefined,
): (Omit<SchemaLocation, 'file'> & { uri: string }) | undefined =>
  location
    ? { uri: pathToFileURL(location.file).href, start: location.start, end: location.end }
    : undefined;

connection.onRequest(
  'sapcommerce/types/search',
  (params: { query: string; limit?: number; uri?: string }) => {
    const indexed = index.forUri(params.uri);
    if (!indexed) return [];
    const limit = Math.min(params.limit ?? 100, 500);
    const types = searchTypes(indexed.typeSystem, params.query, limit).map((hit) => ({
      ...hit,
      location: toUri(hit.location),
    }));
    const beanHits = indexed.beanSystem
      .search(params.query, Math.max(limit - types.length, 20))
      .map((hit) => ({
        kind: hit.kind,
        name: hit.name,
        owner: hit.owner,
        detail: hit.detail,
        location: toUri(indexed.beanSystem.locationOf(hit.source)),
      }));
    return [...types, ...beanHits].slice(0, limit);
  },
);

connection.onRequest(
  'sapcommerce/types/describe',
  (params: { name: string; uri?: string }): unknown => {
    const indexed = index.forUri(params.uri);
    if (!indexed) return null;
    const description = describeType(indexed.typeSystem, params.name);
    if (description) {
      return {
        ...description,
        location: toUri(description.location),
        attributes: description.attributes.map((a) => ({ ...a, location: toUri(a.location) })),
      };
    }
    const bean = beans.describeBean(indexed.beanSystem, params.name);
    if (!bean) return null;
    // beans use the same wire shape as item types so that one panel can show both
    return {
      name: bean.name,
      kind: bean.kind,
      extends: bean.extends,
      abstract: bean.abstract,
      description:
        bean.description ?? (bean.deprecated ? `Deprecated: ${bean.deprecated}` : undefined),
      ancestors: bean.ancestors,
      subtypes: bean.subtypes,
      extensions: bean.extensions,
      enumValues: bean.enumValues?.map((code) => ({ code })),
      location: toUri(bean.location),
      attributes: bean.properties.map((p) => ({
        qualifier: p.name,
        type: p.type,
        declaredIn: p.declaredIn,
        own: p.own,
        localized: false,
        description: p.description,
        location: toUri(p.location),
      })),
    };
  },
);

connection.onRequest('sapcommerce/index/info', () =>
  index.projects.map(({ project, typeSystem, beanSystem }) => ({
    hybrisDir: project.hybrisDir,
    extensions: project.loaded.length,
    itemTypes: typeSystem.items.size,
    beans: beanSystem.beans.size,
    enumTypes: typeSystem.enums.size,
    relations: typeSystem.relations.size,
  })),
);

registerGraphRequests(connection, index);

documents.listen(connection);
connection.listen();
