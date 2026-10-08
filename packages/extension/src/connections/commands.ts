import * as vscode from 'vscode';
import { HacAuthError, HacConnectionError } from '@sapcommerce-vstools/core';
import { UserCancelled, type ConnectionManager } from './manager.js';
import { normalizeBaseUrl, slugify, type ConnectionConfig } from './model.js';
import type { Logger } from '../util/log.js';

/** Registers connection management commands and the status bar entry. */
export function registerConnectionCommands(
  context: vscode.ExtensionContext,
  manager: ConnectionManager,
  log: Logger,
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

  register('sapcommerce.connection.add', async () => {
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
      ],
      { title: 'Select SAP Commerce connection', matchOnDescription: true },
    );
    if (!picked) return;
    if (picked.id === '') return vscode.commands.executeCommand('sapcommerce.connection.add');
    await manager.setActive(picked.id);
  });

  register('sapcommerce.connection.edit', async () => {
    const connection = await pickConnection(manager, 'Edit which connection?');
    if (!connection) return;
    const action = await vscode.window.showQuickPick(
      [
        { label: '$(edit) Edit details…', key: 'edit' },
        { label: '$(key) Change password…', key: 'password' },
        { label: '$(clear-all) Forget stored password', key: 'forget' },
        { label: '$(trash) Remove connection', key: 'remove' },
      ],
      { title: connection.name },
    );
    switch (action?.key) {
      case 'edit':
        return runWizard(manager, connection);
      case 'password':
        return changePassword(manager, connection);
      case 'forget':
        await manager.forgetPassword(connection);
        return vscode.window.showInformationMessage(
          `Stored password for "${connection.name}" removed.`,
        );
      case 'remove': {
        const sure = await vscode.window.showWarningMessage(
          `Remove connection "${connection.name}" and its stored password?`,
          { modal: true },
          'Remove',
        );
        if (sure) await manager.remove(connection.id);
      }
    }
  });

  register('sapcommerce.connection.test', async () => {
    const connection =
      manager.active() ?? (await pickConnection(manager, 'Test which connection?'));
    if (connection) await offerTest(manager, connection, log, false);
  });

  register('sapcommerce.connection.openHac', async () => {
    const connection = manager.active() ?? (await pickConnection(manager, 'Open which hAC?'));
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

async function changePassword(
  manager: ConnectionManager,
  connection: ConnectionConfig,
): Promise<void> {
  const password = await vscode.window.showInputBox({
    title: `New password for ${connection.username} @ ${connection.name}`,
    password: true,
    ignoreFocusOut: true,
  });
  if (password === undefined) return;
  await manager.storePassword(connection, password);
  await vscode.window.showInformationMessage('Password stored in VS Code secret storage.');
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
      try {
        await manager.clientFor(connection, controller.signal);
        void vscode.window.showInformationMessage(
          `Connected to "${connection.name}" as ${connection.username}.`,
        );
      } catch (err) {
        if (err instanceof UserCancelled) return;
        log.error(`Connection test failed for "${connection.name}"`, err);
        const hint =
          err instanceof HacAuthError || err instanceof HacConnectionError
            ? err.message
            : 'Unexpected error – see the output channel.';
        const choice = await vscode.window.showErrorMessage(
          `Connection failed: ${hint}`,
          'Show Log',
        );
        if (choice) log.show();
      }
    },
  );
}
