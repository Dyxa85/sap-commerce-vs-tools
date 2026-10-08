import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { HacAuthError, HacClient } from '@sapcommerce-vstools/core';
import type { Logger } from '../util/log.js';
import {
  isInsecureRemote,
  normalizeConnections,
  toSettingsEntry,
  type ConnectionConfig,
} from './model.js';

const ACTIVE_KEY = 'sapcommerce.activeConnection';

export class UserCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'UserCancelled';
  }
}

interface CachedClient {
  client: HacClient;
  fingerprint: string;
}

/**
 * Owns connection settings, stored passwords and one authenticated HacClient per connection.
 * Passwords live in SecretStorage, keyed by *url + user* (not by name), so a workspace setting that reuses
 * a familiar name with a different URL can never receive a stored password.
 */
export class ConnectionManager implements vscode.Disposable {
  private readonly clients = new Map<string, CachedClient>();
  /** Connections whose plain-HTTP warning was confirmed in this session. */
  private readonly acknowledgedInsecure = new Set<string>();
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly subscription: vscode.Disposable;
  private reportedProblems = '';

  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: Logger,
  ) {
    this.subscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('sapcommerce.connections') ||
        e.affectsConfiguration('sapcommerce.requestTimeoutSeconds')
      ) {
        this.dropStaleClients();
        this.emitter.fire();
      }
    });
  }

  // ------------------------------------------------------------ settings

  list(): ConnectionConfig[] {
    const raw = vscode.workspace.getConfiguration('sapcommerce').get<unknown>('connections');
    const { connections, problems } = normalizeConnections(raw);
    const summary = problems.map((p) => p.message).join('\n');
    if (summary && summary !== this.reportedProblems) {
      this.reportedProblems = summary;
      this.log.warn(`Invalid entries in "sapcommerce.connections":\n${summary}`);
      void vscode.window
        .showWarningMessage(
          `SAP Commerce: ${problems.length} problem(s) in "sapcommerce.connections" – see the output channel.`,
          'Open Settings',
        )
        .then((choice) => {
          if (choice)
            void vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'sapcommerce.connections',
            );
        });
    }
    return connections;
  }

  active(): ConnectionConfig | undefined {
    const all = this.list();
    const id = this.context.workspaceState.get<string>(ACTIVE_KEY);
    return all.find((c) => c.id === id) ?? (all.length === 1 ? all[0] : undefined);
  }

  async setActive(id: string | undefined): Promise<void> {
    await this.context.workspaceState.update(ACTIVE_KEY, id);
    this.emitter.fire();
  }

  /** Writes the connection list where it is already defined (workspace if present, else user settings). */
  async save(connections: ConnectionConfig[]): Promise<void> {
    const config = vscode.workspace.getConfiguration('sapcommerce');
    const inspected = config.inspect('connections');
    const target =
      inspected?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspected?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : inspected?.globalValue !== undefined || !vscode.workspace.workspaceFolders
            ? vscode.ConfigurationTarget.Global
            : vscode.ConfigurationTarget.Workspace;
    await config.update('connections', connections.map(toSettingsEntry), target);
  }

  async upsert(connection: ConnectionConfig, replacesId?: string): Promise<void> {
    const all = this.list();
    const index = all.findIndex((c) => c.id === (replacesId ?? connection.id));
    if (index >= 0) all[index] = connection;
    else all.push(connection);
    await this.save(all);
    if (!this.active()) await this.setActive(connection.id);
  }

  async remove(id: string): Promise<void> {
    const target = this.list().find((c) => c.id === id);
    await this.save(this.list().filter((c) => c.id !== id));
    if (target) await this.forgetPassword(target);
    this.dropClient(id);
    if (this.context.workspaceState.get<string>(ACTIVE_KEY) === id) await this.setActive(undefined);
  }

  // ------------------------------------------------------------ passwords

  static secretKey(connection: Pick<ConnectionConfig, 'url' | 'username'>): string {
    const digest = createHash('sha256')
      .update(`${connection.url}\n${connection.username}`)
      .digest('hex');
    return `sapcommerce.password.${digest.slice(0, 32)}`;
  }

  async storePassword(connection: ConnectionConfig, password: string): Promise<void> {
    await this.context.secrets.store(ConnectionManager.secretKey(connection), password);
    this.log.addSecret(password);
    this.dropClient(connection.id); // an already authenticated client must not outlive a password change
  }

  async forgetPassword(connection: ConnectionConfig): Promise<void> {
    await this.context.secrets.delete(ConnectionManager.secretKey(connection));
    this.dropClient(connection.id);
  }

  async hasPassword(connection: ConnectionConfig): Promise<boolean> {
    return (await this.context.secrets.get(ConnectionManager.secretKey(connection))) !== undefined;
  }

  // ------------------------------------------------------------ clients

  /**
   * Returns an authenticated client. Asks for the password when none is stored (or the stored one is rejected),
   * and keeps it only after a successful login.
   */
  async clientFor(connection: ConnectionConfig, signal?: AbortSignal): Promise<HacClient> {
    const fingerprint = this.fingerprint(connection);
    const cached = this.clients.get(connection.id);
    if (cached?.fingerprint === fingerprint) return cached.client;
    cached?.client.dispose();
    this.clients.delete(connection.id);

    if (isInsecureRemote(connection.url) && !this.acknowledgedInsecure.has(connection.id)) {
      const answer = await vscode.window.showWarningMessage(
        `"${connection.name}" uses plain HTTP (${connection.url}).`,
        {
          modal: true,
          detail:
            'Your password and everything you query would cross the network unencrypted. Use https:// if the server supports it.',
        },
        'Connect anyway',
      );
      if (answer !== 'Connect anyway') throw new UserCancelled();
      this.acknowledgedInsecure.add(connection.id);
    }

    const key = ConnectionManager.secretKey(connection);
    let password = await this.context.secrets.get(key);
    let fromStore = password !== undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (password === undefined) {
        password = await vscode.window.showInputBox({
          title: `Password for ${connection.username} @ ${connection.name}`,
          prompt: attempt === 0 ? connection.url : `Login failed – ${connection.url}`,
          password: true,
          ignoreFocusOut: true,
        });
        if (password === undefined) throw new UserCancelled();
        fromStore = false;
      }
      this.log.addSecret(password);

      const client = new HacClient({
        baseUrl: connection.url,
        username: connection.username,
        password,
        ignoreTlsErrors: connection.ignoreTlsErrors,
        timeoutMs: this.timeoutMs(),
      });
      try {
        await client.login(signal);
        if (!fromStore) await this.context.secrets.store(key, password);
        this.clients.set(connection.id, { client, fingerprint });
        this.log.info(
          `Connected to "${connection.name}" (${connection.url}) as ${connection.username}`,
        );
        return client;
      } catch (err) {
        client.dispose();
        if (!(err instanceof HacAuthError)) throw err;
        if (fromStore) await this.context.secrets.delete(key); // stored password is outdated
        password = undefined;
        fromStore = false;
      }
    }
    throw new HacAuthError('Login failed three times – check user name and password');
  }

  private fingerprint(c: ConnectionConfig): string {
    return JSON.stringify([c.url, c.username, c.ignoreTlsErrors, this.timeoutMs()]);
  }

  private timeoutMs(): number {
    const seconds = vscode.workspace
      .getConfiguration('sapcommerce')
      .get<number>('requestTimeoutSeconds', 60);
    return Math.min(Math.max(seconds, 5), 900) * 1000;
  }

  private dropClient(id: string): void {
    this.clients.get(id)?.client.dispose();
    this.clients.delete(id);
  }

  private dropStaleClients(): void {
    const current = new Map(this.list().map((c) => [c.id, this.fingerprint(c)]));
    for (const [id, cached] of this.clients) {
      if (current.get(id) !== cached.fingerprint) this.dropClient(id);
    }
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
    for (const id of [...this.clients.keys()]) this.dropClient(id);
  }
}
