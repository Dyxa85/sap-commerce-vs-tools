import * as vscode from 'vscode';
import type { ProjectService } from '../project/service.js';
import { shouldOfferJavaSetup } from './prompt.js';

const DISMISSED = 'sapcommerce.java.offerDismissed';

/**
 * Without the Java settings the Java extension cannot see the platform's classes, and every import in a Java file is
 * underlined. So when a project is found and nothing is configured, offer the setup once instead of waiting for the
 * user to find the command.
 */
export function registerJavaOffer(context: vscode.ExtensionContext, project: ProjectService): void {
  let offered = false;
  const check = async (): Promise<void> => {
    if (offered) return;
    const sourcePaths = vscode.workspace
      .getConfiguration()
      .inspect<string[]>('java.project.sourcePaths');
    const state = {
      hasProject: project.projects.length > 0,
      javaExtensionInstalled: vscode.extensions.getExtension('redhat.java') !== undefined,
      alreadyConfigured: Boolean(
        sourcePaths?.workspaceValue?.length ?? sourcePaths?.globalValue?.length,
      ),
      dismissed: context.workspaceState.get<boolean>(DISMISSED, false),
      trusted: vscode.workspace.isTrusted,
      testMode: context.extensionMode === vscode.ExtensionMode.Test,
    };
    if (!shouldOfferJavaSetup(state)) return;
    offered = true;
    const choice = await vscode.window.showInformationMessage(
      'SAP Commerce project found. The Java extension does not know the platform classes yet, so imports show as unresolved. Set up Java now?',
      'Configure Java',
      'Not now',
      "Don't ask again",
    );
    if (choice === 'Configure Java')
      await vscode.commands.executeCommand('sapcommerce.java.configure');
    else if (choice === "Don't ask again") await context.workspaceState.update(DISMISSED, true);
  };
  context.subscriptions.push(project.onDidChange(() => void check()));
}
