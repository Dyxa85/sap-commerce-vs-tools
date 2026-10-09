import * as assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import * as vscode from 'vscode';
import { createMockHac, type MockHacServer } from '@sapcommerce-vstools/mock-hac';
import { getApi, setConnections, settleSecret, stubWindow } from './helpers';

let server: MockHacServer;
let url: string;

before(async () => {
  server = createMockHac();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hac`;
});

after(async () => {
  await setConnections([]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function reset(): Promise<void> {
  await setConnections([]);
  const api = await getApi();
  await api.manager.setActive(undefined);
}

type Result = { type: 'result'; ok: boolean; message: string; field?: string };
const results = (messages: readonly unknown[]): Result[] =>
  messages.filter((m): m is Result => (m as { type?: string }).type === 'result');

describe('connections page', () => {
  it('saves a new connection, stores the password and makes it active', async () => {
    await reset();
    const api = await getApi();
    const panel = api.connectionsPanel;
    await panel.handle({
      type: 'save',
      name: 'Local',
      url,
      username: 'mock-user',
      password: 'mock-pass',
      ignoreTlsErrors: false,
      protected: true,
    });
    const [saved] = api.manager.list();
    assert.ok(saved);
    assert.equal(saved.name, 'Local');
    assert.equal(saved.protected, true);
    assert.equal(api.manager.active()?.id, saved.id);
    assert.equal(await api.manager.hasPassword(saved), true);
    assert.equal(results(panel.sentMessages).at(-1)?.ok, true);
    // the page never receives the password back
    assert.ok(!JSON.stringify(panel.sentMessages).includes('mock-pass'));
    const state = panel.sentMessages
      .filter((m) => (m as { type?: string }).type === 'state')
      .at(-1) as {
      connections: { hasPassword: boolean }[];
    };
    assert.equal(state.connections[0]?.hasPassword, true);
  });

  it('names the field that is wrong and changes nothing', async () => {
    await reset();
    const api = await getApi();
    await api.connectionsPanel.handle({
      type: 'save',
      name: 'Bad',
      url: 'not a url',
      username: 'x',
    });
    const last = results(api.connectionsPanel.sentMessages).at(-1)!;
    assert.equal(last.ok, false);
    assert.equal(last.field, 'url');
    assert.equal(api.manager.list().length, 0);
  });

  it('tests a connection against the instance and reports the result', async () => {
    await reset();
    const api = await getApi();
    await api.connectionsPanel.handle({
      type: 'save',
      name: 'Mock',
      url,
      username: 'mock-user',
      password: 'mock-pass',
    });
    await settleSecret(api, api.manager.list()[0]!, 'mock-pass');
    const id = api.manager.list()[0]!.id;
    await api.connectionsPanel.handle({ type: 'test', id });
    const ok = results(api.connectionsPanel.sentMessages).at(-1)!;
    assert.equal(ok.ok, true);
    assert.match(ok.message, /Connected to "Mock"/);

    await api.connectionsPanel.handle({
      type: 'save',
      originalId: id,
      name: 'Mock',
      url,
      username: 'mock-user',
      password: 'wrong',
    });
    await settleSecret(api, api.manager.list()[0]!, 'wrong');
    const restore = stubWindow('showInputBox', async () => undefined);
    try {
      await api.connectionsPanel.handle({ type: 'test', id });
    } finally {
      restore();
    }
    const last = results(api.connectionsPanel.sentMessages).at(-1)!;
    assert.equal(last.ok, false, `${last.message}\n${api.manager.trace?.join('\n')}`);
  });

  it('forgets the password when url or user change, and renames without losing the connection', async () => {
    await reset();
    const api = await getApi();
    await api.connectionsPanel.handle({
      type: 'save',
      name: 'One',
      url,
      username: 'mock-user',
      password: 'mock-pass',
    });
    const one = api.manager.list()[0]!;
    await api.connectionsPanel.handle({
      type: 'save',
      originalId: one.id,
      name: 'Renamed',
      url,
      username: 'other-user',
    });
    const [renamed] = api.manager.list();
    assert.equal(api.manager.list().length, 1);
    assert.equal(renamed!.id, 'renamed');
    assert.equal(
      await api.manager.hasPassword(renamed!),
      false,
      'a password belongs to url + user',
    );
    assert.equal(api.manager.active()?.id, 'renamed');
  });

  it('selects, forgets a password and removes after confirmation', async () => {
    await reset();
    const api = await getApi();
    for (const name of ['A', 'B']) {
      await api.connectionsPanel.handle({
        type: 'save',
        name,
        url,
        username: 'mock-user',
        password: 'mock-pass',
      });
    }
    await api.connectionsPanel.handle({ type: 'select', id: 'a' });
    assert.equal(api.manager.active()?.id, 'a');

    await api.connectionsPanel.handle({ type: 'forgetPassword', id: 'a' });
    assert.equal(await api.manager.hasPassword(api.manager.list()[0]!), false);

    const decline = stubWindow('showWarningMessage', async () => undefined);
    try {
      await api.connectionsPanel.handle({ type: 'remove', id: 'b' });
    } finally {
      decline();
    }
    assert.equal(api.manager.list().length, 2);

    const accept = stubWindow('showWarningMessage', async () => 'Remove');
    try {
      await api.connectionsPanel.handle({ type: 'remove', id: 'b' });
    } finally {
      accept();
    }
    assert.deepEqual(
      api.manager.list().map((c) => c.id),
      ['a'],
    );
  });

  it('ignores messages that are not what the page sends', async () => {
    await reset();
    const api = await getApi();
    for (const bad of [
      null,
      'x',
      5,
      {},
      { type: 'save' },
      { type: 'remove', id: 7 },
      { type: 'test', id: 'ghost' },
      { type: '__proto__' },
    ]) {
      await api.connectionsPanel.handle(bad);
    }
    assert.equal(api.manager.list().length, 0);
  });

  it('opens from the command and from the add command', async () => {
    const api = await getApi();
    await vscode.commands.executeCommand('sapcommerce.connection.add');
    assert.equal(api.connectionsPanel.isOpen, true);
  });
});

describe('side bar views', () => {
  it('lists the connections with the active one marked', async () => {
    await reset();
    const api = await getApi();
    await setConnections([
      { name: 'Local', url, username: 'mock-user' },
      { name: 'Stage', url, username: 'mock-user', protected: true },
    ]);
    await api.manager.setActive('stage');
    const tree = api.sideBar.connections;
    const items = tree.getChildren().map((c) => tree.getTreeItem(c));
    assert.deepEqual(
      items.map((i) => i.label),
      ['Local', 'Stage'],
    );
    assert.match(String(items[1]!.description), /protected/);
    assert.equal((items[1]!.iconPath as vscode.ThemeIcon).id, 'pass-filled');
    assert.equal((items[0]!.iconPath as vscode.ThemeIcon).id, 'circle-large-outline');
    assert.equal(items[0]!.command?.command, 'sapcommerce.connection.activate');
    await vscode.commands.executeCommand('sapcommerce.connection.activate', tree.getChildren()[0]);
    assert.equal(api.manager.active()?.id, 'local');
    await setConnections([]);
  });

  it('shows every feature with the command it runs', async () => {
    const api = await getApi();
    const tree = api.sideBar.features;
    const groups = tree.getChildren();
    assert.ok(groups.length >= 5);
    const all = groups.flatMap((g) => tree.getChildren(g));
    const commands = all.map((a) => tree.getTreeItem(a).command?.command);
    for (const id of [
      'sapcommerce.flexsearch.run',
      'sapcommerce.diagram.modules',
      'sapcommerce.ant.run',
      'sapcommerce.connections.open',
    ]) {
      assert.ok(commands.includes(id), id);
    }
    // each command that the view offers is registered in the running extension
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const c of commands) assert.ok(c && registered.has(c), String(c));
  });

  it('creates new ImpEx and FlexibleSearch files with the right language', async () => {
    await vscode.commands.executeCommand('sapcommerce.file.newImpex');
    assert.equal(vscode.window.activeTextEditor?.document.languageId, 'impex');
    assert.match(vscode.window.activeTextEditor!.document.getText(), /INSERT_UPDATE Language/);
    await vscode.commands.executeCommand('sapcommerce.file.newFlexSearch');
    assert.equal(vscode.window.activeTextEditor?.document.languageId, 'flexibleSearch');
    assert.match(vscode.window.activeTextEditor!.document.getText(), /^SELECT /);
  });
});

describe('Java setup hint', () => {
  it('shows the entry, the status bar item and a quick fix until Java is set up', async () => {
    const api = await getApi();
    await api.project.refresh();
    const hint = api.javaHint;
    assert.equal(hint.active, false, 'the Java extension is not part of the test profile');
    hint.forceJavaInstalled = true;
    try {
      hint.evaluate();
      assert.equal(hint.active, true);

      // an entry at the top of the Commerce Project view
      const roots = await api.projectTree.getChildren();
      assert.equal(roots[0]?.kind, 'javaHint');
      const item = api.projectTree.getTreeItem(roots[0]!);
      assert.equal(item.command?.command, 'sapcommerce.java.configure');

      // a quick fix on a Java "cannot be resolved" error inside the project
      const file = (
        await vscode.workspace.findFiles('**/DefaultAcmeBadgeService.java', undefined, 1)
      )[0]!;
      const diagnostics = vscode.languages.createDiagnosticCollection('java-test');
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(2, 7, 2, 9),
        'The import de cannot be resolved',
        vscode.DiagnosticSeverity.Error,
      );
      diagnostic.source = 'Java';
      diagnostics.set(file, [diagnostic]);
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const actions = hint.provideCodeActions(document, new vscode.Range(2, 7, 2, 9), {
          diagnostics: [diagnostic],
          triggerKind: vscode.CodeActionTriggerKind.Invoke,
          only: undefined,
        });
        assert.equal(actions.length, 1);
        assert.match(actions[0]!.title, /Set up Java/);
        assert.equal(actions[0]!.command?.command, 'sapcommerce.java.configure');
        // other Java errors and other sources get nothing
        const other = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 1),
          'Unused variable',
          vscode.DiagnosticSeverity.Warning,
        );
        other.source = 'Java';
        assert.equal(
          hint.provideCodeActions(document, new vscode.Range(0, 0, 0, 1), {
            diagnostics: [other],
            triggerKind: vscode.CodeActionTriggerKind.Invoke,
            only: undefined,
          }).length,
          0,
        );
      } finally {
        diagnostics.dispose();
      }
    } finally {
      hint.forceJavaInstalled = false;
      hint.evaluate();
    }
    const roots = await api.projectTree.getChildren();
    assert.notEqual(roots[0]?.kind, 'javaHint');
  });
});
