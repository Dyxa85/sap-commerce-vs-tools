import * as vscode from 'vscode';
import type { ProjectService } from '../project/service.js';
import type { Logger } from '../util/log.js';
import {
  explainJavaPrompt,
  needsJavaSetup,
  shouldOfferJavaSetup,
  type JavaPromptState,
} from './prompt.js';

const DISMISSED = 'sapcommerce.java.offerDismissed';
const COMMAND = 'sapcommerce.java.configure';

/**
 * Without the Java settings the Java extension cannot see the platform's classes and every import is underlined – the
 * biggest pain point of working on a platform in VS Code. A one-time notification is easy to miss, so the hint stays:
 * a status bar item, a message in the Commerce Project view and a quick fix on the red underlines, until Java is set up.
 */
export class JavaHint implements vscode.CodeActionProvider, vscode.Disposable {
  private readonly status: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private offered = false;
  private lastLogged = '';
  /** Tests run without the Java extension; this pretends it is there. */
  forceJavaInstalled = false;
  /** Set by the project view so the hint can show an entry at the top of the tree. */
  setViewHint: (visible: boolean) => void = () => undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly project: ProjectService,
    private readonly log: Logger,
  ) {
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
    this.status.text = '$(warning) Java: set up SAP Commerce';
    this.status.tooltip = new vscode.MarkdownString(
      'The Java extension does not know the classes of the platform and your extensions yet, so imports are shown as unresolved.\n\nClick to set it up.',
    );
    this.status.command = COMMAND;
    this.disposables.push(
      this.status,
      project.onDidChange(() => this.evaluate()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('java.project')) this.evaluate();
      }),
      vscode.extensions.onDidChange(() => this.evaluate()),
      vscode.languages.registerCodeActionsProvider({ language: 'java' }, this, {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }),
    );
    this.evaluate();
  }

  state(): JavaPromptState {
    const sourcePaths = vscode.workspace
      .getConfiguration()
      .inspect<string[]>('java.project.sourcePaths');
    return {
      hasProject: this.project.projects.length > 0,
      javaExtensionInstalled:
        this.forceJavaInstalled || vscode.extensions.getExtension('redhat.java') !== undefined,
      alreadyConfigured: Boolean(
        sourcePaths?.workspaceValue?.length ?? sourcePaths?.globalValue?.length,
      ),
      dismissed: this.context.workspaceState.get<boolean>(DISMISSED, false),
      trusted: vscode.workspace.isTrusted,
      testMode: this.context.extensionMode === vscode.ExtensionMode.Test,
    };
  }

  /** True while the hints are shown. */
  get active(): boolean {
    return needsJavaSetup(this.state());
  }

  evaluate(): void {
    const state = this.state();
    const needed = needsJavaSetup(state);
    const why = explainJavaPrompt(state);
    if (why !== this.lastLogged) {
      this.lastLogged = why;
      this.log.info(`Java setup hint: ${why}`);
    }
    if (needed) this.status.show();
    else this.status.hide();
    this.setViewHint(needed);
    if (shouldOfferJavaSetup(state) && !this.offered) {
      this.offered = true;
      void this.offer();
    }
  }

  private async offer(): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      'SAP Commerce project found. The Java extension does not know the platform classes yet, so imports show as unresolved. Set up Java now?',
      'Configure Java',
      'Not now',
      "Don't ask again",
    );
    if (choice === 'Configure Java') await vscode.commands.executeCommand(COMMAND);
    else if (choice === "Don't ask again") {
      await this.context.workspaceState.update(DISMISSED, true);
      this.evaluate();
    }
  }

  // ---- quick fix on the red underlines
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (!this.active) return [];
    const inProject = this.project.projects.some((p) =>
      document.uri.fsPath.startsWith(p.hybrisDir),
    );
    if (!inProject) return [];
    const unresolved = context.diagnostics.filter(
      (d) =>
        d.source === 'Java' && /cannot be resolved|is undefined|does not exist/i.test(d.message),
    );
    if (unresolved.length === 0) return [];
    const action = new vscode.CodeAction(
      'Set up Java for this SAP Commerce project…',
      vscode.CodeActionKind.QuickFix,
    );
    action.diagnostics = unresolved;
    action.command = { command: COMMAND, title: 'Set up Java for this SAP Commerce project' };
    return [action];
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
