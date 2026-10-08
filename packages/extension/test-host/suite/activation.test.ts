import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { getApi } from './helpers';

describe('activation', () => {
  it('activates and exposes the test API', async () => {
    const api = await getApi();
    assert.ok(api.manager);
  });

  it('activates within the 500 ms budget', async () => {
    const api = await getApi();
    assert.ok(api.activationMs < 500, `activation took ${api.activationMs} ms`);
  });

  it('registers every command declared in package.json', async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'sap-commerce-vs-tools');
    assert.ok(ext);
    await ext.activate();
    const declared: string[] = ext.packageJSON.contributes.commands.map(
      (c: { command: string }) => c.command,
    );
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = declared.filter((id) => !registered.has(id));
    assert.deepEqual(missing, []);
  });

  it('ships sensible configuration defaults', () => {
    const cfg = vscode.workspace.getConfiguration('sapcommerce');
    assert.equal(cfg.get('query.maxCount'), 200);
    assert.equal(cfg.get('confirmWrites'), true);
    assert.equal(cfg.get('impex.enableCodeExecution'), false);
    assert.deepEqual(cfg.get('connections'), []);
  });
});
