import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';

export async function getApi(): Promise<TestApi> {
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'sap-commerce-vs-tools');
  if (!ext) throw new Error('extension under test not found');
  const api = (await ext.activate()) as TestApi | undefined;
  if (!api) throw new Error('test API not exposed – is the extension running in Test mode?');
  return api;
}

export async function setConnections(connections: unknown[]): Promise<void> {
  // The very first settings write of a fresh profile can be cancelled while VS Code is still starting up.
  for (let attempt = 1; ; attempt++) {
    try {
      await vscode.workspace
        .getConfiguration('sapcommerce')
        .update('connections', connections, vscode.ConfigurationTarget.Global);
      return;
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
}

export async function openText(
  content: string,
  language = 'plaintext',
): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  return vscode.window.showTextDocument(doc);
}

type Fn = (...args: never[]) => unknown;

/** Temporarily replaces a method of vscode.window (UI prompts would block headless tests). */
export function stubWindow<K extends keyof typeof vscode.window>(name: K, impl: Fn): () => void {
  const target = vscode.window as unknown as Record<string, unknown>;
  const original = target[name as string];
  target[name as string] = impl;
  return () => {
    target[name as string] = original;
  };
}

/**
 * Waits until the secret storage keeps returning `expected` for a connection. Two `store` calls for the same key a few
 * milliseconds apart can be applied in the wrong order by VS Code (seen in CI on Windows: the older value won), so a
 * single read is not proof that the value has settled.
 */
export async function settleSecret(
  api: TestApi,
  connection: Parameters<TestApi['readSecret']>[0],
  expected: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stable = 0;
  while (stable < 5) {
    stable = (await api.readSecret(connection)) === expected ? stable + 1 : 0;
    if (Date.now() > deadline) {
      throw new Error(
        `the secret storage did not settle on the stored password\n${api.manager.trace?.join('\n')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}
