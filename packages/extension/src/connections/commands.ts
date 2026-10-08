import * as vscode from 'vscode';
import { checkConnection } from './check.js';
import type { ConnectionManager } from './manager.js';
import type { ConnectionsPanel } from '../ui/connections-panel.js';
import { normalizeBaseUrl, slugify, type ConnectionConfig } from './model.js';
import type { Logger } from '../util/log.js';

/** Registers connection management commands and the status bar entry. */
export function registerConnectionCommands(
  context: vscode.ExtensionContext,
  manager: ConnectionManager,
  log: Logger,
  panel: ConnectionsPanel,
): void {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'sapcommerce.connection.select';
  context.subscriptions.push(status);

  const refresh = (): void => {
    const active = manager.active();
    if (active) {
      status.text = `$(server-environment) ${active.name}${active.protected ? ' $(shield)' : ''}`;
      status.tooltip = new vscode.MarkdownString(
        `**${active.name}**\n\n${active.url}\n\nUser: ${active.username}` +
          (active.protected ? '\n\n$(shield) protected – writes need confirmation' : '') +
          (active.ignoreTlsErrors ? '\n\n$(warning) TLS certificate verification is OFF' : ''),
        true,
      );
      status.backgroundColor = active.protected
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
    } else {
      status.text = '$(server-environment) SAP Commerce: no connection';
      status.tooltip = 'Select or add a SAP Commerce hAC connection';
      status.backgroundColor = undefined;
    }
    status.show();
  };
  refresh();
  context.subscriptions.push(manager.onDidChange(refresh));

  const register = (id: string, fn: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  };

  // connections are managed on one page; the step-by-step input boxes remain for people who prefer them
  register('sapcommerce.connection.add', () => panel.show('new'));
  register('sapcommerce.connection.addStepByStep', async () => {
    const created = await runWizard(manager, undefined);
    if (created) await offerTest(manager, created, log);
  });

  register('sapcommerce.connection.select', async () => {
    const all = manager.list();
    if (all.length === 0) return vscode.commands.executeCommand('sapcommerce.connection.add');
    const active = manager.active();
    const picked = await vscode.window.showQuickPick(
      [
        ...all.map((c) => ({
          label: `${c.id === active?.id ? '$(check) ' : ''}${c.name}${c.protected ? ' $(shield)' : ''}`,
          description: c.url,
          detail: `User: ${c.username}`,
          id: c.id,
        })),
        { label: '$(add) Add connection…', description: '', detail: '', id: '' },
        { label: '$(gear) Manage connections…', description: '', detail: '', id: '*' },
      ],
      { title: 'Select SAP Commerce connection', matchOnDescription: true },
    );
    if (!picked) return;
    if (picked.id === '') return vscode.commands.executeCommand('sapcommerce.connection.add');
    if (picked.id === '*') return panel.show();
    await manager.setActive(picked.id);
  });

  register('sapcommerce.connection.edit', () => panel.show());

  register('sapcommerce.connection.test', async (item?: ConnectionConfig) => {
    const connection =
      (item?.id ? manager.list().find((c) => c.id === item.id) : undefined) ??
      manager.active() ??
      (await pickConnection(manager, 'Test which connection?'));
    if (connection) await offerTest(manager, connection, log, false);
  });

  register('sapcommerce.connection.openHac', async (item?: ConnectionConfig) => {
    const connection =
      (item?.id ? manager.list().find((c) => c.id === item.id) : undefined) ??
      manager.active() ??
      (await pickConnection(manager, 'Open which hAC?'));
    if (connection) await vscode.env.openExternal(vscode.Uri.parse(connection.url));
  });
}

export async function pickConnection(
  manager: ConnectionManager,
  title: string,
): Promise<ConnectionConfig | undefined> {
  const all = manager.list();
  if (all.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      'No SAP Commerce connection configured yet.',
      'Add Connection',
    );
    if (choice) await vscode.commands.executeCommand('sapcommerce.connection.add');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    all.map((c) => ({ label: c.name, description: c.url, connection: c })),
    { title },
  );
  return picked?.connection;
}

async function runWizard(
  manager: ConnectionManager,
  existing: ConnectionConfig | undefined,
): Promise<ConnectionConfig | undefined> {
  const others = manager.list().filter((c) => c.id !== existing?.id);

  const name = await vscode.window.showInputBox({
    title: existing ? 'Edit connection (1/5)' : 'Add connection (1/5)',
    prompt: 'A name for this instance, e.g. "Local", "Dev", "Stage"',
    value: existing?.name ?? (others.length === 0 ? 'Local' : ''),
    ignoreFocusOut: true,
    validateInput: (v) => {
      if (!v.trim()) return 'Name is required';
      return others.some((c) => c.id === slugify(v))
        ? 'A connection with this name already exists'
        : undefined;
    },
  });
  if (name === undefined) return undefined;

  const url = await vscode.window.showInputBox({
    title: 'hAC URL (2/5)',
    prompt: 'Base URL of the hybris Administration Console',
    value: existing?.url ?? 'https://localhost:9002/hac',
    ignoreFocusOut: true,
    validateInput: (v) =>
      normalizeBaseUrl(v)
        ? undefined
        : 'Enter a valid http(s) URL, e.g. https://localhost:9002/hac',
  });
  if (url === undefined) return undefined;
  const normalizedUrl = normalizeBaseUrl(url) as string;

  const username = await vscode.window.showInputBox({
    title: 'User name (3/5)',
    value: existing?.username ?? 'admin',
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : 'User name is required'),
  });
  if (username === undefined) return undefined;

  let ignoreTlsErrors = false;
  if (normalizedUrl.startsWith('https:')) {
    const tls = await vscode.window.showQuickPick(
      [
        { label: 'Verify the TLS certificate (recommended)', value: false },
        {
          label: 'Ignore certificate errors (local instance with self-signed certificate)',
          value: true,
        },
      ],
      { title: 'TLS (4/5)', ignoreFocusOut: true },
    );
    if (!tls) return undefined;
    ignoreTlsErrors = tls.value;
  }

  const isProtected = await vscode.window.showQuickPick(
    [
      { label: 'No', value: false },
      { label: 'Yes – ask before commits, imports and log-level changes', value: true },
    ],
    { title: 'Protect this connection? (5/5)', ignoreFocusOut: true },
  );
  if (!isProtected) return undefined;

  const connection: ConnectionConfig = {
    id: slugify(name),
    name: name.trim(),
    url: normalizedUrl,
    username: username.trim(),
    ignoreTlsErrors,
    protected: isProtected.value,
    locale: existing?.locale,
    dataSource: existing?.dataSource,
  };

  // The stored password belongs to url + user; when those change it no longer applies.
  if (existing && (existing.url !== connection.url || existing.username !== connection.username)) {
    await manager.forgetPassword(existing);
  }
  await manager.upsert(connection, existing?.id);
  if (existing && manager.active()?.id !== connection.id && existing.id !== connection.id) {
    await manager.setActive(connection.id);
  }
  return connection;
}

async function offerTest(
  manager: ConnectionManager,
  connection: ConnectionConfig,
  log: Logger,
  askFirst = true,
): Promise<void> {
  if (askFirst) {
    const choice = await vscode.window.showInformationMessage(
      `Connection "${connection.name}" saved. Test it now?`,
      'Test Connection',
    );
    if (!choice) return;
  }
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Connecting to ${connection.name}…`,
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      const result = await checkConnection(manager, connection, log, controller.signal);
      if (result.cancelled) return;
      if (result.ok) {
        void vscode.window.showInformationMessage(result.message);
        return;
      }
      const choice = await vscode.window.showErrorMessage(result.message, 'Show Log');
      if (choice) log.show();
    },
  );
}
