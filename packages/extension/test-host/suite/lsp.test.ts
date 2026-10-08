import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { getApi } from './helpers';

async function openImpex(content: string): Promise<vscode.TextDocument> {
  const api = await getApi();
  const document = await vscode.workspace.openTextDocument({ language: 'impex', content });
  await vscode.window.showTextDocument(document);
  await api.languages.ready();
  return document;
}

/** Polls until `check` returns a value (language features are async). */
async function eventually<T>(
  check: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for the language server');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const codesOf = (uri: vscode.Uri): string[] =>
  vscode.languages.getDiagnostics(uri).map((d) => String(d.code));

describe('ImpEx language server (end to end)', () => {
  it('registers the language and starts the server on demand', async () => {
    const document = await openImpex('# hello\n');
    assert.equal(document.languageId, 'impex');
    assert.ok((await vscode.languages.getLanguages()).includes('impex'));
  });

  it('publishes diagnostics and updates them while typing', async () => {
    const document = await openImpex('INSERTUPDATE Language;isocode[unique=true]\n;en\n');
    await eventually(() =>
      codesOf(document.uri).includes('impex.header.unknown-mode') ? true : undefined,
    );

    const editor = vscode.window.activeTextEditor!;
    await editor.edit((e) => e.replace(new vscode.Range(0, 0, 0, 12), 'INSERT_UPDATE'));
    await eventually(() => (codesOf(document.uri).length === 0 ? true : undefined));
  });

  it('offers quick fixes', async () => {
    const document = await openImpex('INSERTUPDATE A;x[unique=true]\n;1\n');
    await eventually(() => (codesOf(document.uri).length > 0 ? true : undefined));
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      document.uri,
      new vscode.Range(0, 0, 0, 5),
    );
    const fix = actions.find((a) => a.title === 'Change to INSERT_UPDATE');
    assert.ok(fix, 'quick fix present');
    await vscode.workspace.applyEdit(fix.edit!);
    assert.match(document.getText(), /^INSERT_UPDATE A/);
  });

  it('completes headers, macros and modifiers', async () => {
    const document = await openImpex('$cat=base\nINS');
    const modes = await eventually(async () => {
      const list = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        document.uri,
        new vscode.Position(1, 3),
      );
      return list.items.length > 0 ? list : undefined;
    });
    assert.ok(modes.items.some((i) => i.label === 'INSERT_UPDATE'));

    const withMacro = await openImpex('$cat=base\nUPDATE A;x[unique=true]\n;$');
    const macros = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      withMacro.uri,
      new vscode.Position(2, 2),
    );
    assert.ok(macros.items.some((i) => i.label === '$cat'));

    const mods = await openImpex('UPDATE A;x[');
    const modifierList = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      mods.uri,
      new vscode.Position(0, 11),
    );
    assert.ok(modifierList.items.some((i) => i.label === 'unique'));
  });

  it('shows hovers and resolves definitions and references of macros', async () => {
    const document = await openImpex('$cat=base\nUPDATE A;x[unique=true]\n;$cat\n;$cat\n');
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      new vscode.Position(2, 3),
    );
    assert.match(String((hovers[0]?.contents[0] as vscode.MarkdownString).value), /base/);

    const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider',
      document.uri,
      new vscode.Position(2, 3),
    );
    assert.equal(definitions[0]?.range.start.line, 0);

    const references = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      document.uri,
      new vscode.Position(0, 2),
    );
    assert.equal(references.length, 3);
  });

  it('renames macros everywhere', async () => {
    const document = await openImpex('$cat=base\nUPDATE A;x[unique=true]\n;$cat\n');
    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      'vscode.executeDocumentRenameProvider',
      document.uri,
      new vscode.Position(2, 3),
      'catalog',
    );
    await vscode.workspace.applyEdit(edit);
    assert.equal(document.getText(), '$catalog=base\nUPDATE A;x[unique=true]\n;$catalog\n');
  });

  it('provides outline, folding and semantic tokens', async () => {
    const document = await openImpex('# a\n# b\nINSERT_UPDATE Product;code[unique=true]\n;1\n;2\n');
    const symbols = await eventually(async () => {
      const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        document.uri,
      );
      return result.length > 0 ? result : undefined;
    });
    assert.equal(symbols[0]?.name, 'INSERT_UPDATE Product');
    assert.equal(symbols[0]?.children[0]?.name, 'code');

    const folds = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
      'vscode.executeFoldingRangeProvider',
      document.uri,
    );
    assert.ok(folds.some((f) => f.start === 2 && f.end === 4));

    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      'vscode.provideDocumentSemanticTokens',
      document.uri,
    );
    assert.ok(tokens.data.length > 0 && tokens.data.length % 5 === 0);
  });

  it('formats the document', async () => {
    const document = await openImpex(
      'INSERT_UPDATE Product;code[unique=true];name\n;p1;A\n;longer;B\n',
    );
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider',
      document.uri,
      { tabSize: 2, insertSpaces: true },
    );
    assert.ok(edits.length > 0);
    const edit = new vscode.WorkspaceEdit();
    edit.set(document.uri, edits);
    await vscode.workspace.applyEdit(edit);
    const lines = document.getText().split('\n');
    assert.equal(lines[1]?.indexOf(';', 1), lines[2]?.indexOf(';', 1), 'columns line up');
  });

  it('respects the severity settings', async () => {
    const config = vscode.workspace.getConfiguration('sapcommerce.impex');
    await config.update(
      'diagnostics.severity',
      { 'impex.macro.undefined': 'off' },
      vscode.ConfigurationTarget.Global,
    );
    try {
      const document = await openImpex('UPDATE A;x[unique=true]\n;$nope\n');
      await eventually(() => (codesOf(document.uri).length >= 0 ? true : undefined));
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.ok(!codesOf(document.uri).includes('impex.macro.undefined'));
    } finally {
      await config.update('diagnostics.severity', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

async function openFlex(content: string): Promise<vscode.TextDocument> {
  const api = await getApi();
  const document = await vscode.workspace.openTextDocument({ language: 'flexibleSearch', content });
  await vscode.window.showTextDocument(document);
  await api.languages.ready();
  return document;
}

describe('FlexibleSearch language server (end to end)', () => {
  it('registers the language and reports diagnostics', async () => {
    const document = await openFlex('SELECT {x:pk} FROM {Language AS l}');
    assert.ok((await vscode.languages.getLanguages()).includes('flexibleSearch'));
    await eventually(() =>
      codesOf(document.uri).includes('flexsearch.alias.unknown') ? true : undefined,
    );
  });

  it('fixes an alias without AS via quick fix', async () => {
    const document = await openFlex('SELECT {l:pk} FROM {Language l}');
    await eventually(() =>
      codesOf(document.uri).includes('flexsearch.from.alias-without-as') ? true : undefined,
    );
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      document.uri,
      new vscode.Range(0, 28, 0, 29),
    );
    const fix = actions.find((a) => a.title === 'Insert AS');
    assert.ok(fix);
    await vscode.workspace.applyEdit(fix.edit!);
    assert.equal(document.getText(), 'SELECT {l:pk} FROM {Language AS l}');
  });

  it('completes aliases and formats the query', async () => {
    const document = await openFlex('SELECT {| FROM {Language AS l}');
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      new vscode.Position(0, 8),
    );
    assert.ok(list.items.some((i) => i.label === 'l'));

    const formatDoc = await openFlex(
      "select {pk} from {Language} where {isocode}='en' and {pk} is not null",
    );
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider',
      formatDoc.uri,
      { tabSize: 2, insertSpaces: true },
    );
    const edit = new vscode.WorkspaceEdit();
    edit.set(formatDoc.uri, edits);
    await vscode.workspace.applyEdit(edit);
    assert.equal(
      formatDoc.getText(),
      "SELECT {pk}\nFROM {Language}\nWHERE {isocode} = 'en'\n  AND {pk} IS NOT NULL",
    );
  });

  it('renames an alias everywhere', async () => {
    const document = await openFlex('SELECT {l:isocode} FROM {Language AS l}');
    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      'vscode.executeDocumentRenameProvider',
      document.uri,
      new vscode.Position(0, 9),
      'lang',
    );
    await vscode.workspace.applyEdit(edit);
    assert.equal(document.getText(), 'SELECT {lang:isocode} FROM {Language AS lang}');
  });
});

describe('type system features (fixture project)', () => {
  const indexed = async (): Promise<void> => {
    const api = await getApi();
    await api.languages.ready();
    await eventually(async () => {
      const info = await api.languages.request<unknown[]>('sapcommerce/index/info', {});
      return info.length > 0 ? true : undefined;
    });
  };

  it('indexes the project and answers type searches', async () => {
    await indexed();
    const api = await getApi();
    const hits = await api.languages.request<{ kind: string; name: string }[]>(
      'sapcommerce/types/search',
      { query: 'badge' },
    );
    assert.ok(hits.some((h) => h.kind === 'type' && h.name === 'AcmeBadge'));
    assert.ok(hits.some((h) => h.kind === 'relation'));
  });

  it('reports unknown types and attributes in ImpEx and fixes them', async () => {
    await indexed();
    const document = await openImpex('INSERT_UPDATE Prodcut;code[unique=true]\n;1\n');
    await eventually(() =>
      codesOf(document.uri).includes('impex.type.unknown') ? true : undefined,
    );
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      document.uri,
      new vscode.Range(0, 15, 0, 15),
    );
    const fix = actions.find((a) => a.title === 'Change to "Product"');
    assert.ok(fix);
    await vscode.workspace.applyEdit(fix.edit!);
    await eventually(() => (codesOf(document.uri).length === 0 ? true : undefined));
  });

  it('jumps from an ImpEx type to its definition in the items.xml', async () => {
    await indexed();
    const document = await openImpex('INSERT_UPDATE Language;isocode[unique=true]\n;en\n');
    const locations = await eventually(async () => {
      const result = await vscode.commands.executeCommand<
        (vscode.Location | vscode.LocationLink)[]
      >('vscode.executeDefinitionProvider', document.uri, new vscode.Position(0, 16));
      return result.length > 0 ? result : undefined;
    });
    const first = locations[0] as vscode.Location;
    assert.match(first.uri.fsPath, /core-items\.xml$/);
    const target = await vscode.workspace.openTextDocument(first.uri);
    assert.match(target.lineAt(first.range.start.line).text, /code="Language"/);
  });

  it('offers real attributes and enum values in ImpEx completion', async () => {
    await indexed();
    const document = await openImpex('INSERT_UPDATE Product;code[unique=true];\n');
    const list = await eventually(async () => {
      const result = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        document.uri,
        new vscode.Position(0, 41),
      );
      return result.items.some((i) => i.label === 'approvalStatus') ? result : undefined;
    });
    assert.ok(list.items.some((i) => i.label === 'catalogVersion'));
  });

  it('shows a type in the preview panel', async () => {
    await indexed();
    const api = await getApi();
    await vscode.commands.executeCommand('sapcommerce.types.show', 'Customer');
    assert.equal(api.typePanel.currentName, 'Customer');
    await vscode.commands.executeCommand('sapcommerce.types.show', 'LoyaltyTier');
    assert.equal(api.typePanel.currentName, 'LoyaltyTier');
  });

  it('follows edits of an items.xml before they are saved', async () => {
    await indexed();
    const items = vscode.Uri.file(
      (await vscode.workspace.findFiles('**/acmecore-items.xml', undefined, 1))[0]!.fsPath,
    );
    const itemsDoc = await vscode.workspace.openTextDocument(items);
    await vscode.window.showTextDocument(itemsDoc);
    const impex = await openImpex('INSERT_UPDATE BrandNewType;code[unique=true]\n;1\n');
    await eventually(() => (codesOf(impex.uri).includes('impex.type.unknown') ? true : undefined));

    const freshEditor = await vscode.window.showTextDocument(itemsDoc);
    await freshEditor.edit((e) => {
      const at = itemsDoc.positionAt(
        itemsDoc.getText().indexOf('<itemtypes>') + '<itemtypes>'.length,
      );
      e.insert(
        at,
        '<itemtype code="BrandNewType" extends="GenericItem"><attributes><attribute qualifier="code" type="java.lang.String"><modifiers unique="true"/></attribute></attributes></itemtype>',
      );
    });
    await eventually(
      () => (!codesOf(impex.uri).includes('impex.type.unknown') ? true : undefined),
      20_000,
    );
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });
});

describe('items.xml editing (fixture project)', () => {
  async function openItems(name: string): Promise<vscode.TextDocument> {
    const api = await getApi();
    await api.languages.ready();
    const file = (await vscode.workspace.findFiles(`**/${name}`, undefined, 1))[0];
    assert.ok(file, `${name} in the workspace`);
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document);
    await eventually(async () => {
      const info = await api.languages.request<unknown[]>('sapcommerce/index/info', {});
      return info.length > 0 ? true : undefined;
    });
    return document;
  }

  it('has no findings for a valid file, reports problems after an edit and fixes them', async () => {
    const document = await openItems('acmecore-items.xml');
    assert.equal(document.languageId, 'xml');
    await new Promise((r) => setTimeout(r, 800));
    assert.deepEqual(
      vscode.languages
        .getDiagnostics(document.uri)
        .filter((d) => String(d.code).startsWith('items.')),
      [],
    );

    const editor = vscode.window.activeTextEditor!;
    const at = document.positionAt(document.getText().indexOf('extends'));
    void at;
    await editor.edit((e) => {
      const index = document.getText().indexOf('<itemtype code="AcmeBadge"');
      e.insert(
        document.positionAt(index + '<itemtype code="AcmeBadge"'.length),
        ' extends="GenricItem"',
      );
    });
    await eventually(() =>
      codesOf(document.uri).includes('items.extends.unknown') ? true : undefined,
    );

    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      document.uri,
      document.getText().includes('GenricItem')
        ? new vscode.Range(
            document.positionAt(document.getText().indexOf('GenricItem')),
            document.positionAt(document.getText().indexOf('GenricItem') + 3),
          )
        : new vscode.Range(0, 0, 0, 0),
    );
    const fix = actions.find((a) => a.title === 'Change to "GenericItem"');
    assert.ok(fix, 'quick fix for the misspelled supertype');
    await vscode.workspace.applyEdit(fix.edit!);
    await eventually(() =>
      !codesOf(document.uri).includes('items.extends.unknown') ? true : undefined,
    );
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });

  it('completes types and offers definition, hover and outline', async () => {
    const document = await openItems('acmecore-items.xml');
    const text = document.getText();
    const typeOffset = text.indexOf('type="LoyaltyTier"') + 'type="Loy'.length;
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      document.positionAt(typeOffset),
    );
    assert.ok(list.items.some((i) => i.label === 'LoyaltyTier'));

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      document.positionAt(text.indexOf('type="LoyaltyTier"') + 8),
    );
    assert.ok(
      hovers.some((h) =>
        h.contents.some((c) => (c as vscode.MarkdownString).value?.includes('LoyaltyTier')),
      ),
    );

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    );
    assert.ok(symbols.some((s) => s.name === 'AcmeBadge'));

    const customer = document.positionAt(text.indexOf('relation code') + 1);
    void customer;
    const refDef = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider',
      document.uri,
      document.positionAt(text.indexOf('type="Customer" qualifier="acmeCustomers"') + 8),
    );
    assert.match((refDef[0] as vscode.Location).uri.fsPath, /core-items\.xml$/);
  });
});

describe('beans.xml editing and bean preview (fixture project)', () => {
  async function openBeans(): Promise<vscode.TextDocument> {
    const api = await getApi();
    await api.languages.ready();
    const file = (await vscode.workspace.findFiles('**/acmecore-beans.xml', undefined, 1))[0];
    assert.ok(file);
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document);
    await eventually(async () => {
      const info = await api.languages.request<{ beans: number }[]>('sapcommerce/index/info', {});
      return info[0] && info[0].beans > 0 ? true : undefined;
    });
    return document;
  }

  it('offers completion, hover, definition and outline', async () => {
    const document = await openBeans();
    const text = document.getText();
    const at = document.positionAt(
      text.indexOf('extends="com.acme.core.dto.BadgeData"') +
        'extends="com.acme.core.dto.Bad'.length,
    );
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      at,
    );
    assert.ok(list.items.some((i) => i.label === 'com.acme.core.dto.BadgeData'));

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      at,
    );
    assert.ok(
      hovers.some((h) =>
        h.contents.some((c) => (c as vscode.MarkdownString).value?.includes('bean')),
      ),
    );

    const defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider',
      document.uri,
      at,
    );
    assert.ok(defs.length > 0);

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    );
    assert.ok(symbols.some((s) => s.name === 'BadgeSummaryData'));
  });

  it('finds beans in the type search and shows them in the preview', async () => {
    await openBeans();
    const api = await getApi();
    const hits = await api.languages.request<{ kind: string; name: string }[]>(
      'sapcommerce/types/search',
      { query: 'badge' },
    );
    assert.ok(hits.some((h) => h.kind === 'bean' && h.name === 'com.acme.core.dto.BadgeData'));
    await vscode.commands.executeCommand('sapcommerce.types.show', 'BadgeSummaryData');
    assert.equal(api.typePanel.currentName, 'com.acme.core.dto.BadgeSummaryData');
    await vscode.commands.executeCommand('sapcommerce.types.show', 'TierData');
    assert.equal(api.typePanel.currentName, 'com.acme.core.enums.TierData');
  });
});

describe('Spring XML (fixture project)', () => {
  async function openSpring(name: string): Promise<vscode.TextDocument> {
    const api = await getApi();
    await api.languages.ready();
    const file = (await vscode.workspace.findFiles(`**/${name}`, undefined, 1))[0];
    assert.ok(file);
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document);
    await eventually(async () => {
      const info = await api.languages.request<unknown[]>('sapcommerce/index/info', {});
      return info.length > 0 ? true : undefined;
    });
    return document;
  }

  it('shows overrides, resolves aliases and jumps to definitions and Java classes', async () => {
    const document = await openSpring('acmefacades-spring.xml');
    await eventually(() =>
      codesOf(document.uri).includes('spring.bean.overrides') ? true : undefined,
    );
    const text = document.getText();

    const alias = document.positionAt(
      text.indexOf('p:badgeService-ref="acmeBadgeService"') + 'p:badgeService-ref="acme'.length,
    );
    const defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider',
      document.uri,
      alias,
    );
    assert.equal(defs.length, 2, 'both definitions of the overridden bean');

    const core = await openSpring('acmecore-spring.xml');
    const cText = core.getText();
    const cls = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider',
      core.uri,
      core.positionAt(cText.indexOf('DefaultAcmeBadgeService') + 5),
    );
    assert.match((cls[0] as vscode.Location).uri.fsPath, /DefaultAcmeBadgeService\.java$/);
    await eventually(() =>
      codesOf(core.uri).includes('spring.bean.overridden') ? true : undefined,
    );
  });

  it('completes bean ids for ref attributes and lists symbols', async () => {
    const document = await openSpring('acmefacades-spring.xml');
    const text = document.getText();
    const at = document.positionAt(text.indexOf('ref="badgeConverter"') + 'ref="badgeC'.length);
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      at,
    );
    assert.ok(list.items.some((i) => i.label === 'modelService'));
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    );
    assert.ok(symbols.some((s) => s.name === 'badgeFacade'));
  });
});

describe('Diagrams and business processes (fixture project)', () => {
  async function openProcess(): Promise<vscode.TextDocument> {
    const api = await getApi();
    await api.languages.ready();
    const file = (await vscode.workspace.findFiles('**/badge-award-process.xml', undefined, 1))[0];
    assert.ok(file);
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document);
    await eventually(async () => {
      const info = await api.languages.request<unknown[]>('sapcommerce/index/info', {});
      return info.length > 0 ? true : undefined;
    });
    return document;
  }

  it('jumps from a transition to its target node and completes node ids', async () => {
    const document = await openProcess();
    const text = document.getText();
    const at = document.positionAt(text.indexOf('to="split"') + 'to="spl'.length);
    const defs = await eventually(async () => {
      const found = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        at,
      );
      return found.length > 0 ? found : undefined;
    });
    const target = defs[0] as vscode.Location;
    assert.equal(target.uri.toString(), document.uri.toString());
    assert.equal(document.lineAt(target.range.start.line).text.includes('split'), true);

    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      document.positionAt(text.indexOf('to="join"') + 'to="j'.length),
    );
    assert.ok(list.items.some((i) => i.label === 'waitForConfirmation'));
  });

  it('draws the process diagram of the open process file', async () => {
    const api = await getApi();
    await openProcess();
    await vscode.commands.executeCommand('sapcommerce.diagram.process');
    const page = await eventually(() => api.diagramPanel.current);
    assert.match(page.title, /badge-award-process/);
    assert.ok(page.svg.includes('data-id="checkEligibility"'));
    assert.ok(page.svg.includes('data-id="success"'));
    assert.match(page.subtitle ?? '', /^\d+ nodes$/);
  });

  it('draws the type diagram around a type and refuses unknown ones', async () => {
    const api = await getApi();
    await api.languages.ready();
    await eventually(async () => {
      const info = await api.languages.request<unknown[]>('sapcommerce/index/info', {});
      return info.length > 0 ? true : undefined;
    });
    const result = await api.languages.request<{
      svg: string;
      nodeCount: number;
      targets: Record<string, { uri?: string }>;
    } | null>('sapcommerce/graph/type', { name: 'Customer' });
    assert.ok(result);
    assert.ok(result.svg.includes('data-id="Customer"'));
    assert.ok(result.svg.includes('data-id="User"'), 'the supertype is part of the graph');
    assert.ok(result.targets['Customer']?.uri?.endsWith('-items.xml'));
    assert.equal(
      await api.languages.request('sapcommerce/graph/type', { name: 'NoSuchType' }),
      null,
    );
    await vscode.commands.executeCommand('sapcommerce.diagram.type', 'Customer');
    assert.match(api.diagramPanel.current?.title ?? '', /Customer/);
  });

  it('draws the dependency diagram of the custom extensions', async () => {
    const api = await getApi();
    await api.languages.ready();
    await eventually(async () => {
      const info = await api.languages.request<unknown[]>('sapcommerce/index/info', {});
      return info.length > 0 ? true : undefined;
    });
    const result = await api.languages.request<{
      svg: string;
      targets: Record<string, { uri?: string }>;
    } | null>('sapcommerce/graph/modules', { scope: { kind: 'custom' } });
    assert.ok(result);
    for (const name of ['acmecore', 'acmefacades', 'acmeprocess']) {
      assert.ok(result.svg.includes(`data-id="${name}"`), name);
      assert.ok(result.targets[name]?.uri?.endsWith('extensioninfo.xml'));
    }
    await vscode.commands.executeCommand('sapcommerce.diagram.modules', { kind: 'custom' });
    assert.equal(api.diagramPanel.current?.title, 'Extension dependencies');
  });
});
