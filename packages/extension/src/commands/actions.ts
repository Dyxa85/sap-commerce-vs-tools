import * as vscode from 'vscode';
import {
  HacAuthError,
  HacConnectionError,
  HacProtocolError,
  HacQueryError,
  flexsearch,
  type HacClient,
  type ImpexOptions,
  type ScriptType,
} from '@sapcommerce-vstools/core';
import { pickConnection } from '../connections/commands.js';
import { UserCancelled, type ConnectionManager } from '../connections/manager.js';
import type { ConnectionConfig } from '../connections/model.js';
import type { History, HistoryKind } from '../history.js';
import type { ResultsPanel } from '../ui/results-panel.js';
import type { Logger } from '../util/log.js';

interface Deps {
  context: vscode.ExtensionContext;
  manager: ConnectionManager;
  results: ResultsPanel;
  history: History;
  log: Logger;
}

const LOGGER_LEVELS = ['ALL', 'TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'OFF'];

export function registerActions(deps: Deps): void {
  const { context } = deps;
  const register = (id: string, fn: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  };

  register('sapcommerce.flexsearch.run', () => runQuery(deps, 'flexsearch'));
  register('sapcommerce.sql.run', () => runQuery(deps, 'sql'));
  register('sapcommerce.groovy.run', () => runScript(deps, false));
  register('sapcommerce.groovy.runCommit', () => runScript(deps, true));
  register('sapcommerce.impex.validate', () => runImpex(deps, 'validate'));
  register('sapcommerce.impex.import', () => runImpex(deps, 'import'));
  register('sapcommerce.pk.analyze', () => analyzePk(deps));
  register('sapcommerce.logger.set', () => setLogger(deps));
  register('sapcommerce.history.show', () => showHistory(deps));
  register('sapcommerce.history.clear', async () => {
    await deps.history.clear();
    void vscode.window.showInformationMessage('SAP Commerce history cleared.');
  });
}

// ------------------------------------------------------------------ helpers

/** Selection if present, else the whole active document, else ask the user. */
async function textFromEditor(
  prompt: string,
  kind: HistoryKind,
  history: History,
): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selected = editor.selection.isEmpty
      ? editor.document.getText()
      : editor.document.getText(editor.selection);
    if (selected.trim() !== '') return selected;
  }
  const last = history.list(kind)[0]?.text;
  return vscode.window.showInputBox({ prompt, value: last, ignoreFocusOut: true });
}

async function requireConnection(deps: Deps): Promise<ConnectionConfig | undefined> {
  const active = deps.manager.active();
  if (active) return active;
  return pickConnection(deps.manager, 'Select a SAP Commerce connection');
}

async function confirmWrite(connection: ConnectionConfig, what: string): Promise<boolean> {
  const needsConfirm =
    connection.protected ||
    vscode.workspace.getConfiguration('sapcommerce').get<boolean>('confirmWrites', true);
  if (!needsConfirm) return true;
  const answer = await vscode.window.showWarningMessage(
    `${what} on ${connection.protected ? 'PROTECTED connection ' : 'connection '}"${connection.name}" (${connection.url})?`,
    { modal: true, detail: 'This changes data in the target system.' },
    'Execute',
  );
  return answer === 'Execute';
}

/** Runs `fn` with a cancellable progress notification and the connection's authenticated client. */
async function withClient<T>(
  deps: Deps,
  connection: ConnectionConfig,
  title: string,
  fn: (client: HacClient, signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      try {
        const client = await deps.manager.clientFor(connection, controller.signal);
        return await fn(client, controller.signal);
      } catch (err) {
        if (err instanceof UserCancelled || controller.signal.aborted) return undefined;
        reportError(deps, connection, title, err);
        return undefined;
      }
    },
  );
}

export function describeError(err: unknown): { message: string; details?: string } {
  if (err instanceof HacQueryError) {
    const rootNote =
      err.rootCause && err.rootCause !== err.message ? `Cause: ${err.rootCause}` : '';
    return {
      message: err.message,
      details: [rootNote, err.stackTrace].filter(Boolean).join('\n\n') || undefined,
    };
  }
  if (
    err instanceof HacAuthError ||
    err instanceof HacConnectionError ||
    err instanceof HacProtocolError
  ) {
    return { message: err.message };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

function reportError(deps: Deps, connection: ConnectionConfig, title: string, err: unknown): void {
  deps.log.error(`${title} failed on "${connection.name}"`, err);
  const { message, details } = describeError(err);
  deps.results.show({
    kind: 'error',
    title: `${title} – failed`,
    connection: connection.name,
    message,
    details,
  });
}

function cfg<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('sapcommerce').get<T>(key, fallback);
}

function trimStatement(text: string): string {
  return text.trim().replace(/;\s*$/, '');
}

// ------------------------------------------------------------------ actions

async function runQuery(deps: Deps, kind: 'flexsearch' | 'sql'): Promise<void> {
  const connection = await requireConnection(deps);
  if (!connection) return;
  const raw = await textFromEditor(
    kind === 'sql' ? 'SQL query' : 'FlexibleSearch query',
    kind,
    deps.history,
  );
  if (!raw) return;
  const original = trimStatement(raw);
  if (!original) return;

  let query = original;
  if (kind === 'flexsearch') {
    const doc = flexsearch.parseFlexSearch(raw);
    const names = flexsearch.parameterNames(doc);
    const values = names.length > 0 ? await askParameters(deps, names) : {};
    if (values === undefined) return; // cancelled
    const prepared = flexsearch.prepareQuery(doc, values);
    query = prepared.text;
    if (prepared.removedLineComments > 0) {
      deps.log.info(
        `Removed ${prepared.removedLineComments} "--" comment(s): they break FlexibleSearch queries in the hAC`,
      );
    }
    if (!query) return;
  }

  const maxCount = Math.min(Math.max(cfg('query.maxCount', 200), 1), 100_000);
  const title = kind === 'sql' ? 'SQL' : 'FlexibleSearch';
  const result = await withClient(
    deps,
    connection,
    `${title} on ${connection.name}`,
    (client, signal) =>
      (kind === 'sql' ? client.sql : client.flexibleSearch).call(
        client,
        {
          query,
          maxCount,
          locale: connection.locale ?? cfg('query.locale', 'en'),
          dataSource: connection.dataSource,
        },
        signal,
      ),
  );
  if (!result) return;

  await deps.history.add({ kind, text: original, connection: connection.name, at: Date.now() });
  deps.log.info(
    `${title} on "${connection.name}": ${result.rowCount} rows in ${result.executionTimeMs} ms`,
  );
  deps.results.show({
    kind: 'query',
    title: `${title} – ${result.rowCount} rows`,
    connection: connection.name,
    result,
    sourceText: query,
  });
}

function scriptTypeOf(document: vscode.TextDocument | undefined): ScriptType {
  const name = document?.fileName.toLowerCase() ?? '';
  if (name.endsWith('.bsh') || document?.languageId === 'beanshell') return 'beanshell';
  if (name.endsWith('.js') || document?.languageId === 'javascript') return 'javascript';
  return 'groovy';
}

async function runScript(deps: Deps, commit: boolean): Promise<void> {
  const connection = await requireConnection(deps);
  if (!connection) return;
  const script = await textFromEditor('Groovy script', 'groovy', deps.history);
  if (!script?.trim()) return;
  if (commit && !(await confirmWrite(connection, 'Run the script in COMMIT mode'))) return;

  const scriptType = scriptTypeOf(vscode.window.activeTextEditor?.document);
  const result = await withClient(
    deps,
    connection,
    `Script on ${connection.name}`,
    (client, signal) => client.executeScript({ script, scriptType, commit }, signal),
  );
  if (!result) return;

  await deps.history.add({
    kind: 'groovy',
    text: script,
    connection: connection.name,
    at: Date.now(),
  });
  deps.log.info(
    `Script on "${connection.name}" (${commit ? 'commit' : 'rollback'}): ${result.failed ? 'FAILED' : 'ok'}`,
  );
  deps.results.show({
    kind: 'script',
    title: result.failed ? 'Script failed' : 'Script result',
    connection: connection.name,
    result,
    committed: commit,
  });
}

async function runImpex(deps: Deps, action: 'validate' | 'import'): Promise<void> {
  const connection = await requireConnection(deps);
  if (!connection) return;
  const script = await textFromEditor('ImpEx script', 'impex', deps.history);
  if (!script?.trim()) return;
  if (action === 'import' && !(await confirmWrite(connection, 'Import this ImpEx script'))) return;

  const options: ImpexOptions = {
    validation:
      cfg<string>('impex.validation', 'IMPORT_STRICT') === 'IMPORT_RELAXED'
        ? 'IMPORT_RELAXED'
        : 'IMPORT_STRICT',
    legacyMode: cfg('impex.legacyMode', false),
    enableCodeExecution: cfg('impex.enableCodeExecution', false),
    maxThreads: Math.min(Math.max(cfg('impex.maxThreads', 1), 1), 64),
    encoding: cfg('impex.encoding', 'UTF-8'),
  };
  const verb = action === 'validate' ? 'Validate ImpEx' : 'Import ImpEx';
  const result = await withClient(
    deps,
    connection,
    `${verb} on ${connection.name}`,
    (client, signal) =>
      action === 'validate'
        ? client.validateImpex(script, options, signal)
        : client.importImpex(script, options, signal),
  );
  if (!result) return;

  if (action === 'import') {
    await deps.history.add({
      kind: 'impex',
      text: script,
      connection: connection.name,
      at: Date.now(),
    });
  }
  deps.log.info(
    `${verb} on "${connection.name}": ${result.ok ? 'ok' : 'FAILED'} – ${result.message}`,
  );
  deps.results.show({
    kind: 'impex',
    title: `${verb}: ${result.ok ? 'ok' : 'failed'}`,
    connection: connection.name,
    result,
    action,
  });
  if (!result.ok) void vscode.window.showWarningMessage(`${verb}: ${result.message}`);
}

async function analyzePk(deps: Deps): Promise<void> {
  const connection = await requireConnection(deps);
  if (!connection) return;
  const selection = vscode.window.activeTextEditor?.document
    .getText(vscode.window.activeTextEditor.selection)
    .trim();
  const pk = await vscode.window.showInputBox({
    title: 'PK Analyzer',
    prompt: 'Primary key (digits)',
    value: selection && /^\d+$/.test(selection) ? selection : undefined,
    ignoreFocusOut: true,
    validateInput: (v) => (/^\d{1,20}$/.test(v.trim()) ? undefined : 'Enter a numeric PK'),
  });
  if (!pk) return;
  const result = await withClient(
    deps,
    connection,
    `PK analyzer on ${connection.name}`,
    (client, signal) => client.analyzePk(pk.trim(), signal),
  );
  if (result)
    deps.results.show({
      kind: 'pk',
      title: `PK ${result.pk}`,
      connection: connection.name,
      result,
    });
}

async function setLogger(deps: Deps): Promise<void> {
  const connection = await requireConnection(deps);
  if (!connection) return;

  const loggers = await withClient(
    deps,
    connection,
    `Loading loggers from ${connection.name}`,
    (client, signal) => client.listLoggers(signal),
  );
  if (!loggers) return;

  const NEW = '$(add) Enter logger name…';
  const picked = await vscode.window.showQuickPick(
    [
      { label: NEW, description: '' },
      ...loggers.map((l) => ({ label: l.name, description: l.level })),
    ],
    { title: 'Change log level – choose logger', matchOnDescription: true },
  );
  if (!picked) return;
  const loggerName =
    picked.label === NEW
      ? await vscode.window.showInputBox({
          prompt: 'Logger name (package or class)',
          ignoreFocusOut: true,
          validateInput: (v) =>
            /^\w+(\.\w+)*$/.test(v) ? undefined : 'Use a dotted name like com.acme.core',
        })
      : picked.label;
  if (!loggerName) return;

  const current = loggers.find((l) => l.name === loggerName)?.level;
  const level = await vscode.window.showQuickPick(
    LOGGER_LEVELS.map((l) => ({ label: l, description: l === current ? 'current' : '' })),
    { title: `Level for ${loggerName}` },
  );
  if (!level) return;
  if (
    connection.protected &&
    !(await confirmWrite(connection, `Set ${loggerName} to ${level.label}`))
  )
    return;

  const ok = await withClient(
    deps,
    connection,
    `Set log level on ${connection.name}`,
    async (client, signal) => {
      await client.setLoggerLevel(loggerName, level.label, signal);
      return true;
    },
  );
  if (ok) {
    deps.log.info(`Logger ${loggerName} -> ${level.label} on "${connection.name}"`);
    void vscode.window.showInformationMessage(
      `${loggerName} is now ${level.label} (until the server restarts).`,
    );
  }
}

async function showHistory(deps: Deps): Promise<void> {
  const entries = deps.history.list();
  if (entries.length === 0) {
    void vscode.window.showInformationMessage('No history yet.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    entries.map((e) => ({
      label:
        e.text
          .split(/\r?\n/)
          .find((l) => l.trim() !== '')
          ?.trim()
          .slice(0, 100) ?? '(empty)',
      description: `${e.kind} · ${e.connection}`,
      detail: new Date(e.at).toLocaleString(),
      entry: e,
    })),
    { title: 'SAP Commerce history', matchOnDescription: true },
  );
  if (!picked) return;
  const known = await vscode.languages.getLanguages();
  const wanted = { flexsearch: 'flexibleSearch', sql: 'sql', groovy: 'groovy', impex: 'impex' }[
    picked.entry.kind
  ];
  const document = await vscode.workspace.openTextDocument({
    content: picked.entry.text,
    language: known.includes(wanted) ? wanted : 'plaintext',
  });
  await vscode.window.showTextDocument(document);
}

/** Values entered for `?name` parameters during this session (kept in memory only). */
const rememberedParameters = new Map<string, string>();

/**
 * The hAC console cannot bind parameters, so every `?name` is replaced by an SQL literal before the query is sent.
 * Returns undefined when the user cancels.
 */
async function askParameters(
  deps: Deps,
  names: readonly string[],
): Promise<Record<string, string> | undefined> {
  const values: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    const value = await vscode.window.showInputBox({
      title: `Query parameter ?${name} (${index + 1}/${names.length})`,
      prompt:
        "Plain text is quoted for you (abc → 'abc'). Numbers, NULL and 'quoted strings' are used as typed.",
      value: rememberedParameters.get(name),
      ignoreFocusOut: true,
    });
    if (value === undefined) return undefined;
    rememberedParameters.set(name, value);
    values[name] = value;
  }
  deps.log.debug(`Parameters supplied: ${names.join(', ')}`);
  return values;
}
