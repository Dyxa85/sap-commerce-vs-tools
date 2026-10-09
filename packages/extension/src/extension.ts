import * as vscode from 'vscode';
import { PRODUCT_NAME, SUPPORTED_COMMERCE_VERSIONS } from '@sapcommerce-vstools/core';
import { registerActions } from './commands/actions.js';
import { ConnectionsPanel } from './ui/connections-panel.js';
import { registerSideBar, type SideBar } from './views/register.js';
import { registerCcv2View, type Ccv2Parts } from './ccv2/commands.js';
import { CommerceTaskProvider } from './build/tasks.js';
import { registerBuildCommands } from './commands/build.js';
import { registerDiagramCommands } from './commands/diagrams.js';
import { registerTypeCommands } from './commands/types.js';
import { registerConnectionCommands } from './connections/commands.js';
import { ConnectionManager } from './connections/manager.js';
import type { ConnectionConfig } from './connections/model.js';
import { History } from './history.js';
import { ResultsPanel } from './ui/results-panel.js';
import { DiagramPanel } from './ui/diagram-panel.js';
import { TypePanel } from './ui/type-panel.js';
import { registerJavaOffer } from './java/offer.js';
import { McpProvider } from './mcp/provider.js';
import { LanguageServerController } from './language/client.js';
import { registerProjectView } from './project/commands.js';
import { ProjectService } from './project/service.js';
import type { ProjectTree } from './project/tree.js';
import { Logger } from './util/log.js';

/** Exposed to extension-host tests only (ExtensionMode.Test); production activation returns nothing. */
export interface TestApi {
  manager: ConnectionManager;
  results: ResultsPanel;
  history: History;
  languages: LanguageServerController;
  project: ProjectService;
  projectTree: ProjectTree;
  typePanel: TypePanel;
  diagramPanel: DiagramPanel;
  tasks: CommerceTaskProvider;
  mcp: McpProvider;
  ccv2: Ccv2Parts;
  connectionsPanel: ConnectionsPanel;
  sideBar: SideBar;
  /** Time `activate` took (the language server and the project model start afterwards, in the background). */
  activationMs: number;
  /** The password stored for a connection, to check what the secret storage really holds. */
  readSecret: (connection: ConnectionConfig) => Thenable<string | undefined>;
}

export function activate(context: vscode.ExtensionContext): TestApi | undefined {
  const started = performance.now();
  const log = new Logger();
  const manager = new ConnectionManager(context, log);
  if (context.extensionMode === vscode.ExtensionMode.Test) manager.trace = [];
  const results = new ResultsPanel();
  const history = new History(context.workspaceState);
  const languages = new LanguageServerController(context, log);
  const project = new ProjectService(log);
  const typePanel = new TypePanel(languages);
  const diagramPanel = new DiagramPanel();
  context.subscriptions.push(log, manager, results, languages, project, typePanel, diagramPanel);
  const projectTree = registerProjectView(context, project);
  void project.refresh();
  const ccv2 = registerCcv2View(context, log);

  const connectionsPanel = new ConnectionsPanel(manager, log);
  context.subscriptions.push(connectionsPanel);
  registerConnectionCommands(context, manager, log, connectionsPanel);
  const sideBar = registerSideBar(context, manager, connectionsPanel);
  registerActions({ context, manager, results, history, log });
  registerTypeCommands(context, languages, typePanel);
  registerDiagramCommands(context, languages, project, diagramPanel);
  const tasks = new CommerceTaskProvider(project);
  context.subscriptions.push(tasks);
  registerBuildCommands(context, project, tasks, log);
  registerJavaOffer(context, project);
  const mcp = new McpProvider(context, project, manager, log);
  context.subscriptions.push(mcp);

  context.subscriptions.push(
    vscode.commands.registerCommand('sapcommerce.about', () => {
      void vscode.window.showInformationMessage(
        `${PRODUCT_NAME} – unofficial, not affiliated with SAP. Target: SAP Commerce ${SUPPORTED_COMMERCE_VERSIONS.join(', ')}`,
      );
    }),
    vscode.commands.registerCommand('sapcommerce.showLog', () => log.show()),
  );

  const activationMs = Math.round(performance.now() - started);
  log.info(`${PRODUCT_NAME} activated in ${activationMs} ms`);
  return context.extensionMode === vscode.ExtensionMode.Test
    ? {
        manager,
        results,
        history,
        languages,
        project,
        projectTree,
        typePanel,
        diagramPanel,
        tasks,
        mcp,
        ccv2,
        connectionsPanel,
        sideBar,
        activationMs,
        readSecret: (connection) => context.secrets.get(ConnectionManager.secretKey(connection)),
      }
    : undefined;
}

export function deactivate(): void {
  // everything is disposed through context.subscriptions
}
