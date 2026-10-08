import * as vscode from 'vscode';
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';
import type { Logger } from '../util/log.js';

/** Languages served by the language server. */
export const LANGUAGE_IDS = ['impex', 'flexibleSearch'] as const;

/**
 * Starts the language server lazily: only when a document of one of our languages is opened,
 * so users who only need the hAC commands never pay for the extra process.
 */
export class LanguageServerController implements vscode.Disposable {
  private client: LanguageClient | undefined;
  private starting: Promise<void> | undefined;
  private readonly subscription: vscode.Disposable;
  private readonly updated = new vscode.EventEmitter<void>();
  /** Fires after the server re-indexed the project (type system changed). */
  readonly onIndexUpdated = this.updated.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: Logger,
  ) {
    this.subscription = vscode.workspace.onDidOpenTextDocument((d) => this.onOpen(d));
    for (const document of vscode.workspace.textDocuments) this.onOpen(document);
  }

  /** Resolves when the server is running (starts it if necessary). Used by tests. */
  ready(): Promise<void> {
    return this.start();
  }

  /** Sends a custom request to the server, starting it if necessary. */
  async request<T>(method: string, params: unknown): Promise<T> {
    await this.start();
    if (!this.client) throw new Error('The language server is not running');
    return this.client.sendRequest<T>(method, params);
  }

  private onOpen(document: vscode.TextDocument): void {
    if ((LANGUAGE_IDS as readonly string[]).includes(document.languageId)) void this.start();
  }

  private start(): Promise<void> {
    this.starting ??= this.doStart();
    return this.starting;
  }

  private async doStart(): Promise<void> {
    const module = this.context.asAbsolutePath('dist/server.cjs');
    const serverOptions: ServerOptions = {
      run: { module, transport: TransportKind.ipc },
      debug: {
        module,
        transport: TransportKind.ipc,
        options: { execArgv: ['--nolazy', '--inspect=6011'] },
      },
    };
    const clientOptions: LanguageClientOptions = {
      // items.xml / beans.xml are synchronised too so the server sees unsaved edits of the type system
      documentSelector: [
        ...LANGUAGE_IDS.map((language) => ({ language })),
        { language: 'xml', pattern: '**/*-items.xml' },
        { language: 'xml', pattern: '**/*-beans.xml' },
        { language: 'xml', pattern: '**/*-spring.xml' },
        { language: 'xml', pattern: '**/*-process.xml' },
        { language: 'xml', pattern: '**/processes/*.xml' },
      ],
      synchronize: {
        configurationSection: 'sapcommerce',
        fileEvents: [
          vscode.workspace.createFileSystemWatcher('**/*-items.xml'),
          vscode.workspace.createFileSystemWatcher('**/*-beans.xml'),
          vscode.workspace.createFileSystemWatcher('**/*-spring.xml'),
          vscode.workspace.createFileSystemWatcher('**/localextensions.xml'),
          vscode.workspace.createFileSystemWatcher('**/extensioninfo.xml'),
        ],
      },
      outputChannelName: 'SAP Commerce Language Server',
    };
    this.client = new LanguageClient(
      'sapcommerce',
      'SAP Commerce Language Server',
      serverOptions,
      clientOptions,
    );
    try {
      await this.client.start();
      this.client.onNotification('sapcommerce/index/updated', () => this.updated.fire());
      this.log.info('Language server started');
    } catch (err) {
      this.log.error('Language server failed to start', err);
      this.client = undefined;
      this.starting = undefined;
      throw err;
    }
  }

  async dispose(): Promise<void> {
    this.subscription.dispose();
    this.updated.dispose();
    const client = this.client;
    this.client = undefined;
    if (client?.isRunning()) await client.stop();
  }
}
