import * as vscode from 'vscode';
import type { ConnectionManager } from '../connections/manager.js';
import { ConnectionManager as Manager } from '../connections/manager.js';
import { isInsecureRemote } from '../connections/model.js';
import type { ProjectService } from '../project/service.js';
import type { Logger } from '../util/log.js';

export const MCP_PROVIDER_ID = 'sapcommerce.mcp';

/**
 * Offers the bundled MCP server to VS Code's AI features. Project knowledge (extensions, types, beans) is always
 * available; read-only queries against the active connection are opt-in and confirmed once per server start.
 */
export class McpProvider implements vscode.McpServerDefinitionProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeMcpServerDefinitions = this.changed.event;
  private readonly registration: vscode.Disposable | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly project: ProjectService,
    private readonly manager: ConnectionManager,
    private readonly log: Logger,
  ) {
    // older VS Code versions do not have the API; everything else keeps working
    this.registration = vscode.lm?.registerMcpServerDefinitionProvider?.(MCP_PROVIDER_ID, this);
    const refresh = (): void => this.changed.fire();
    this.context.subscriptions.push(
      this.project.onDidChange(refresh),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('sapcommerce.mcp')) refresh();
      }),
    );
  }

  /** Arguments for the server; exposed for tests. */
  serverArguments(): string[] {
    return this.project.projects.flatMap((p) => ['--project', p.hybrisDir]);
  }

  provideMcpServerDefinitions(): vscode.McpServerDefinition[] {
    const args = this.serverArguments();
    if (args.length === 0) return [];
    return [
      new vscode.McpStdioServerDefinition(
        'SAP Commerce',
        process.execPath,
        [this.context.asAbsolutePath('dist/mcp.cjs'), ...args],
        // the extension host binary runs as plain Node with this flag
        { ELECTRON_RUN_AS_NODE: '1' },
        this.context.extension.packageJSON.version as string,
      ),
    ];
  }

  async resolveMcpServerDefinition(
    server: vscode.McpServerDefinition,
  ): Promise<vscode.McpServerDefinition | undefined> {
    if (!(server instanceof vscode.McpStdioServerDefinition)) return server;
    if (!vscode.workspace.getConfiguration('sapcommerce.mcp').get<boolean>('enableQueries', false))
      return server;
    const connection = this.manager.active();
    if (!connection) return server;
    if (!vscode.workspace.isTrusted) return server;

    if (isInsecureRemote(connection.url)) {
      void vscode.window.showWarningMessage(
        `AI queries are not offered for "${connection.name}" because it uses plain HTTP to a remote host.`,
      );
      return server;
    }

    const password = await this.context.secrets.get(Manager.secretKey(connection));
    if (password === undefined) {
      void vscode.window.showInformationMessage(
        `AI queries are enabled but no password is stored for "${connection.name}". Run a query once from the editor to store it.`,
      );
      return server;
    }
    const answer = await vscode.window.showWarningMessage(
      `Let AI tools run read-only queries against "${connection.name}"?`,
      {
        modal: true,
        detail: `${connection.url} as ${connection.username}. Only SELECT statements are passed on and nothing is committed, but the results are visible to the AI model.`,
      },
      'Allow',
    );
    if (answer !== 'Allow') return server;

    this.log.addSecret(password);
    this.log.info(`MCP server started with read-only queries against "${connection.name}"`);
    server.args = [
      ...server.args,
      '--hac-url',
      connection.url,
      '--hac-user',
      connection.username,
      ...(connection.ignoreTlsErrors ? ['--insecure'] : []),
    ];
    // handed to the child process only; it never appears in a command line
    server.env = { ...server.env, SAPC_MCP_HAC_PASSWORD: password };
    return server;
  }

  dispose(): void {
    this.registration?.dispose();
    this.changed.dispose();
  }
}
