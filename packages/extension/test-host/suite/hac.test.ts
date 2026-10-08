import * as assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createMockHac, type MockHacServer } from '@sapcommerce-vstools/mock-hac';
import * as vscode from 'vscode';
import { ConnectionManager } from '../../src/connections/manager';
import { getApi, openText, setConnections, stubWindow } from './helpers';

const PASSWORD = 'mock-pass';
let server: MockHacServer;
let url: string;

async function configure(extra: Record<string, unknown> = {}, name = 'Mock'): Promise<void> {
  const api = await getApi();
  await setConnections([{ name, url, username: 'mock-user', ...extra }]);
  const connection = api.manager.list()[0];
  assert.ok(connection, 'connection should be configured');
  await api.manager.storePassword(connection, PASSWORD);
  await api.manager.setActive(connection.id);
}

async function eventually<T>(check: () => Promise<T | undefined>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

before(async () => {
  server = createMockHac();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hac`;
});

after(async () => {
  await setConnections([]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('hAC actions (against the mock hAC)', () => {
  beforeEach(async () => {
    await configure();
  });

  it('runs a FlexibleSearch query from the active editor', async () => {
    const api = await getApi();
    await openText('SELECT {pk}, {isocode} FROM {Language};');
    await vscode.commands.executeCommand('sapcommerce.flexsearch.run');

    const model = api.results.lastModel;
    assert.equal(model?.kind, 'query');
    assert.deepEqual(model.result.rows, [['en'], ['de'], ['fr']]);
    assert.equal(api.history.list('flexsearch')[0]?.text, 'SELECT {pk}, {isocode} FROM {Language}');
  });

  it('uses only the selection when text is selected', async () => {
    const api = await getApi();
    const editor = await openText('SELECT 1\nSELECT {pk} FROM {Language}\n');
    editor.selection = new vscode.Selection(1, 0, 1, 'SELECT {pk} FROM {Language}'.length);
    await vscode.commands.executeCommand('sapcommerce.flexsearch.run');
    assert.equal(api.results.lastModel?.kind, 'query');
  });

  it('runs raw SQL', async () => {
    const api = await getApi();
    await openText('SELECT p_isocode FROM languages');
    await vscode.commands.executeCommand('sapcommerce.sql.run');
    const model = api.results.lastModel;
    assert.equal(model?.kind, 'query');
    assert.equal(model.result.raw, true);
  });

  it('shows server-side query errors in the results panel', async () => {
    const api = await getApi();
    await openText('SELECT {x} FROM {Nope}');
    await vscode.commands.executeCommand('sapcommerce.flexsearch.run');
    const model = api.results.lastModel;
    assert.equal(model?.kind, 'error');
    assert.match(model.message, /unknown type/);
  });

  it('runs a Groovy script in rollback mode', async () => {
    const api = await getApi();
    await openText('println "hi"; return 6*7', 'plaintext');
    await vscode.commands.executeCommand('sapcommerce.groovy.run');
    const model = api.results.lastModel;
    assert.equal(model?.kind, 'script');
    assert.equal(model.result.result, '42');
    assert.equal(model.committed, false);
  });

  it('validates a good and a bad ImpEx script', async () => {
    const api = await getApi();
    await openText('INSERT_UPDATE Language;isocode[unique=true]\n;en\n');
    await vscode.commands.executeCommand('sapcommerce.impex.validate');
    let model = api.results.lastModel;
    assert.equal(model?.kind, 'impex');
    assert.equal(model.result.ok, true);

    const restore = stubWindow('showWarningMessage', async () => undefined);
    try {
      await openText('INSERT_UPDATE NoSuchType;code[unique=true]\n;x\n');
      await vscode.commands.executeCommand('sapcommerce.impex.validate');
    } finally {
      restore();
    }
    model = api.results.lastModel;
    assert.equal(model?.kind, 'impex');
    assert.equal(model.result.ok, false);
  });

  it('asks before committing and does nothing when declined', async () => {
    const api = await getApi();
    await openText('return 1+1');
    await vscode.commands.executeCommand('sapcommerce.groovy.run'); // baseline result
    const before = api.results.lastModel;

    let asked = 0;
    const restore = stubWindow('showWarningMessage', async () => {
      asked++;
      return undefined; // user dismisses the modal
    });
    try {
      await vscode.commands.executeCommand('sapcommerce.groovy.runCommit');
    } finally {
      restore();
    }
    assert.equal(asked, 1);
    assert.equal(api.results.lastModel, before, 'declined commit must not execute anything');
  });

  it('commits after explicit confirmation', async () => {
    const api = await getApi();
    await openText('return 2+2');
    const restore = stubWindow('showWarningMessage', async () => 'Execute');
    try {
      await vscode.commands.executeCommand('sapcommerce.groovy.runCommit');
    } finally {
      restore();
    }
    const model = api.results.lastModel;
    assert.equal(model?.kind, 'script');
    assert.equal(model.committed, true);
  });

  it('always asks on protected connections, even when confirmWrites is off', async () => {
    const api = await getApi();
    await configure({ protected: true });
    const cfg = vscode.workspace.getConfiguration('sapcommerce');
    await cfg.update('confirmWrites', false, vscode.ConfigurationTarget.Global);
    let asked = 0;
    const restore = stubWindow('showWarningMessage', async () => {
      asked++;
      return undefined;
    });
    try {
      await openText('INSERT_UPDATE Language;isocode[unique=true]\n;en\n');
      await vscode.commands.executeCommand('sapcommerce.impex.import');
    } finally {
      restore();
      await cfg.update('confirmWrites', undefined, vscode.ConfigurationTarget.Global);
    }
    assert.equal(asked, 1);
    assert.notEqual(
      api.results.lastModel?.kind === 'impex' && api.results.lastModel.action,
      'import',
    );
  });
});

describe('FlexibleSearch execution from the editor', () => {
  beforeEach(async () => {
    await configure();
  });

  it('asks for ?parameters and sends them as SQL literals, without -- comments or ;', async () => {
    const api = await getApi();
    await openText(
      'SELECT {pk} FROM {Language} -- explain\nWHERE {isocode} = ?code AND {active} = ?flag;',
      'flexibleSearch',
    );
    const asked: string[] = [];
    const restore = stubWindow('showInputBox', async (options: { title?: string }) => {
      asked.push(options.title ?? '');
      return asked.length === 1 ? 'en' : 'true';
    });
    try {
      await vscode.commands.executeCommand('sapcommerce.flexsearch.run');
    } finally {
      restore();
    }
    assert.equal(asked.length, 2);
    assert.match(asked[0] ?? '', /\?code/);
    assert.equal(api.results.lastModel?.kind, 'query');
    const sent = server.receivedQueries.at(-1) ?? '';
    assert.ok(sent.includes("{isocode} = 'en'"), sent);
    assert.ok(sent.includes('{active} = TRUE'), sent);
    assert.ok(!sent.includes('--') && !sent.trimEnd().endsWith(';'), sent);
  });

  it('does not run anything when the parameter prompt is cancelled', async () => {
    const api = await getApi();
    await openText('SELECT {pk} FROM {Language} WHERE {isocode} = ?code', 'flexibleSearch');
    const before = api.results.lastModel;
    const count = server.receivedQueries.length;
    const restore = stubWindow('showInputBox', async () => undefined);
    try {
      await vscode.commands.executeCommand('sapcommerce.flexsearch.run');
    } finally {
      restore();
    }
    assert.equal(api.results.lastModel, before);
    assert.equal(server.receivedQueries.length, count);
  });
});

describe('credentials', () => {
  it('never writes the password into settings', async () => {
    await configure();
    const raw = JSON.stringify(vscode.workspace.getConfiguration('sapcommerce').get('connections'));
    assert.ok(!raw.includes(PASSWORD));
  });

  it('prompts again when the stored password is rejected and keeps the corrected one', async () => {
    const api = await getApi();
    await configure();
    const connection = api.manager.list()[0];
    assert.ok(connection);
    await api.manager.storePassword(connection, 'outdated-password');
    // the secret storage must hand back what was just stored, and no authenticated client may be left over
    const state = await eventually(async () =>
      (await api.readSecret(connection)) === 'outdated-password' &&
      !api.manager.hasCachedClient(connection.id)
        ? 'ready'
        : undefined,
    ).catch(
      async () =>
        `secret=${await api.readSecret(connection)}, cached=${api.manager.hasCachedClient(connection.id)}`,
    );
    assert.equal(state, 'ready', `precondition not met: ${state}`);

    let prompts = 0;
    const restore = stubWindow('showInputBox', async () => {
      prompts++;
      return PASSWORD;
    });
    try {
      await openText('SELECT {pk} FROM {Language}');
      await vscode.commands.executeCommand('sapcommerce.flexsearch.run');
    } finally {
      restore();
    }
    assert.equal(prompts, 1, `prompts=${prompts}, result=${api.results.lastModel?.kind}`);
    assert.equal(api.results.lastModel?.kind, 'query');
    assert.equal(await api.manager.hasPassword(connection), true);
  });

  it('does not offer a stored password to a different URL with the same name', async () => {
    const same = { name: 'Mock', username: 'mock-user' };
    const a = ConnectionManager.secretKey({ url, username: same.username });
    const b = ConnectionManager.secretKey({
      url: 'https://evil.example/hac',
      username: same.username,
    });
    assert.notEqual(a, b);
  });

  it('cancelling the password prompt aborts quietly', async () => {
    const api = await getApi();
    await setConnections([{ name: 'NoPw', url, username: 'nobody' }]);
    const connection = api.manager.list()[0];
    assert.ok(connection);
    await api.manager.forgetPassword(connection);
    await api.manager.setActive(connection.id);
    const restore = stubWindow('showInputBox', async () => undefined);
    const before = api.results.lastModel;
    try {
      await openText('SELECT {pk} FROM {Language}');
      await vscode.commands.executeCommand('sapcommerce.flexsearch.run');
    } finally {
      restore();
    }
    assert.equal(api.results.lastModel, before);
  });
});

describe('history', () => {
  it('re-opens an entry as a new document', async () => {
    const api = await getApi();
    await configure();
    await openText('SELECT {pk} FROM {Language}');
    await vscode.commands.executeCommand('sapcommerce.flexsearch.run');

    const restore = stubWindow('showQuickPick', async (items: unknown) => (items as unknown[])[0]);
    try {
      await vscode.commands.executeCommand('sapcommerce.history.show');
    } finally {
      restore();
    }
    assert.equal(vscode.window.activeTextEditor?.document.getText(), api.history.list()[0]?.text);
  });
});
