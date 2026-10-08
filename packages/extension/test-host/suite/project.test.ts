import * as assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { Node } from '../../src/project/tree';
import { getApi, stubWindow } from './helpers';

async function eventually<T>(check: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('project model and Commerce Project view', () => {
  it('finds the project in the workspace and resolves the load order', async () => {
    const api = await getApi();
    await api.project.refresh();
    const project = api.project.projects[0];
    assert.ok(project, 'project found');
    const order = project.loaded.map((e) => e.name);
    assert.deepEqual([...order].sort(), [
      'acmecore',
      'acmefacades',
      'acmeprocess',
      'catalog',
      'core',
    ]);
    assert.ok(order.indexOf('core') < order.indexOf('acmecore'));
  });

  it('shows projects, groups, extensions and their files in the tree', async () => {
    const api = await getApi();
    await api.project.refresh();
    const roots = (await api.projectTree.getChildren()) as Node[];
    assert.equal(roots.length, 1);
    const children = (await api.projectTree.getChildren(roots[0])) as Node[];
    assert.ok(children.some((n) => n.kind === 'config'));
    const custom = children.find((n) => n.kind === 'group' && n.category === 'custom');
    assert.ok(custom && custom.kind === 'group');
    assert.deepEqual(
      custom.extensions.map((e) => e.name),
      ['acmecore', 'acmefacades', 'acmeprocess'],
    );

    const acmecore = (await api.projectTree.getChildren(custom)) as Node[];
    const content = (await api.projectTree.getChildren(acmecore[0])) as Node[];
    const label = (n: Node): string => String(api.projectTree.getTreeItem(n).label);
    const describe = (n: Node): unknown => api.projectTree.getTreeItem(n).description;

    // the real folder structure of the extension, folders first, then files
    assert.deepEqual(content.filter((n) => n.kind === 'dir').map(label), ['resources', 'src']);
    assert.ok(content.some((n) => n.kind === 'file' && label(n) === 'extensioninfo.xml'));
    const src = content.find((n) => n.kind === 'dir' && label(n) === 'src')!;
    assert.equal(describe(src), 'sources');

    // Java packages are merged until something branches, down to the class
    const packages = (await api.projectTree.getChildren(src)) as Node[];
    assert.equal(packages.length, 1);
    assert.equal(label(packages[0]!), 'com/acme/core/service/impl');
    const classes = (await api.projectTree.getChildren(packages[0])) as Node[];
    assert.deepEqual(classes.map(label), ['DefaultAcmeBadgeService.java']);

    // the commerce-specific view stays available below
    const overview = content.find((n) => n.kind === 'overview')!;
    const labels = ((await api.projectTree.getChildren(overview)) as Node[]).map(label);
    assert.ok(labels.includes('Type system (items.xml)'));
    assert.ok(labels.includes('ImpEx'));
  });

  it('reports problems in localextensions.xml and clears them after the fix', async () => {
    const api = await getApi();
    const file = api.project.projects[0]!.localExtensionsFile!;
    const original = readFileSync(file, 'utf8');
    try {
      writeFileSync(
        file,
        original.replace(
          '<extension name="acmecore"/>',
          '<extension name="acmecore"/><extension name="ghost"/>',
        ),
      );
      await api.project.refresh();
      const diagnostics = await eventually(() => {
        const d = vscode.languages.getDiagnostics(vscode.Uri.file(file));
        return d.length > 0 ? d : undefined;
      });
      assert.match(diagnostics[0]!.message, /"ghost"/);
      assert.equal(diagnostics[0]!.severity, vscode.DiagnosticSeverity.Error);
    } finally {
      writeFileSync(file, original);
      await api.project.refresh();
    }
    assert.deepEqual(vscode.languages.getDiagnostics(vscode.Uri.file(file)), []);
  });

  it('"Go to Extension" opens the extensioninfo.xml of the chosen extension', async () => {
    const api = await getApi();
    await api.project.refresh();
    const restore = stubWindow('showQuickPick', async (items: { label: string }[]) =>
      items.find((i) => i.label === 'acmefacades'),
    );
    try {
      await vscode.commands.executeCommand('sapcommerce.project.goToExtension');
    } finally {
      restore();
    }
    const active = vscode.window.activeTextEditor?.document.uri.fsPath ?? '';
    assert.ok(
      active.endsWith('acmefacades/extensioninfo.xml') ||
        active.endsWith('acmefacades\\extensioninfo.xml'),
      active,
    );
  });
});

describe('build tasks', () => {
  it('offers Ant and server tasks for the project of the workspace', async () => {
    const api = await getApi();
    await api.project.refresh();
    const ant = await vscode.tasks.fetchTasks({ type: 'sapcommerce.ant' });
    const names = ant.map((t) => t.name);
    assert.ok(names.includes('ant build'), names.join(', '));
    assert.ok(names.includes('ant unittests'));
    const build = ant.find((t) => t.name === 'ant build')!;
    const execution = build.execution as vscode.ProcessExecution;
    assert.ok(execution.args.join(' ').endsWith('ant build'));
    assert.match(execution.options?.cwd ?? '', /platform$/);
    assert.deepEqual(build.problemMatchers, ['$sapcommerce-javac']);

    const server = await vscode.tasks.fetchTasks({ type: 'sapcommerce.server' });
    assert.deepEqual(server.map((t) => t.name).sort(), ['server debug', 'server run']);
  });

  it('resolves a task from tasks.json and refuses dangerous targets', async () => {
    const api = await getApi();
    const scope = vscode.workspace.workspaceFolders![0]!;
    const good = new vscode.Task(
      { type: 'sapcommerce.ant', target: 'unittests', args: ['-Dtestclasses.extensions=acmecore'] },
      scope,
      'x',
      'SAP Commerce',
    );
    const resolved = api.tasks.resolveTask(good);
    assert.ok(resolved);
    assert.ok(
      (resolved.execution as vscode.ProcessExecution).args
        .join(' ')
        .includes('-Dtestclasses.extensions=acmecore'),
    );
    const bad = new vscode.Task(
      { type: 'sapcommerce.ant', target: 'build; id' },
      scope,
      'x',
      'SAP Commerce',
    );
    assert.equal(api.tasks.resolveTask(bad), undefined);
  });
});

describe('MCP server', () => {
  it('is offered for the project of the workspace, without credentials', async () => {
    const api = await getApi();
    await api.project.refresh();
    const definitions = api.mcp.provideMcpServerDefinitions();
    assert.equal(definitions.length, 1);
    const server = definitions[0] as vscode.McpStdioServerDefinition;
    assert.equal(server.label, 'SAP Commerce');
    assert.ok(server.args.some((a) => a.endsWith('mcp.cjs')));
    assert.ok(server.args.includes('--project'));
    assert.ok(!server.args.includes('--hac-url'), 'queries are opt-in');
    assert.ok(!JSON.stringify(server.env).includes('PASSWORD'));
  });

  it('keeps queries off unless the setting is on', async () => {
    const api = await getApi();
    const [server] = api.mcp.provideMcpServerDefinitions();
    const resolved = await api.mcp.resolveMcpServerDefinition(server!);
    assert.ok(resolved instanceof vscode.McpStdioServerDefinition);
    assert.ok(!resolved.args.includes('--hac-url'));
  });
});

describe('CCv2 view', () => {
  it('shows core-customize with an outline of manifest.json next to the real folders', async () => {
    const api = await getApi();
    await api.ccv2.service.refresh();
    assert.equal(api.ccv2.service.roots.length, 1);
    const tree = api.ccv2.tree;
    const label = (n: unknown): string => String(tree.getTreeItem(n as never).label);

    const roots = await tree.getChildren();
    assert.equal(roots.length, 1);
    const children = await tree.getChildren(roots[0]);
    assert.deepEqual(
      children.map((n) => `${n.kind}:${label(n)}`),
      [
        'manifest:manifest.json',
        'hybris:hybris',
        'dir:js-storefront',
        'file:.aiignore',
        'file:README.md',
      ],
    );

    const outline = await tree.getChildren(children[0]);
    assert.deepEqual(outline.slice(0, 2).map(label), ['commerceSuiteVersion', 'solrVersion']);
    assert.equal(tree.getTreeItem(outline[0]!).description, '2211-jdk21.17');
    const extensions = outline.find((n) => label(n) === 'extensions')!;
    assert.deepEqual((await tree.getChildren(extensions)).map(label), [
      'acmecore',
      'acmefacades',
      'acmeprocess',
    ]);

    // only what a project owns is listed under hybris
    const hybris = await tree.getChildren(children[1]);
    assert.deepEqual(hybris.map(label), ['config', 'bin/custom']);
  });

  it('opens manifest.json at the clicked entry', async () => {
    const api = await getApi();
    await api.ccv2.service.refresh();
    const roots = await api.ccv2.tree.getChildren();
    const core = await api.ccv2.tree.getChildren(roots[0]);
    const outline = await api.ccv2.tree.getChildren(core[0]);
    const solr = outline.find((n) => String(api.ccv2.tree.getTreeItem(n).label) === 'solrVersion')!;
    const command = api.ccv2.tree.getTreeItem(solr).command!;
    await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
    const editor = vscode.window.activeTextEditor!;
    assert.ok(editor.document.fileName.endsWith('manifest.json'));
    assert.match(editor.document.lineAt(editor.selection.active.line).text, /solrVersion/);
  });

  it('reports an invalid manifest.json instead of an empty view', async () => {
    const api = await getApi();
    const file = join(api.ccv2.service.roots[0]!.coreCustomize, 'manifest.json');
    const original = readFileSync(file, 'utf8');
    try {
      writeFileSync(file, original.replace('"solrVersion": "9.10",', '"solrVersion": "9.10" ,,'));
      const roots = await api.ccv2.tree.getChildren();
      const core = await api.ccv2.tree.getChildren(roots[0]);
      const outline = await api.ccv2.tree.getChildren(core[0]);
      assert.equal(outline.length, 1);
      assert.match(String(api.ccv2.tree.getTreeItem(outline[0]!).label), /^Invalid JSON/);
    } finally {
      writeFileSync(file, original);
    }
  });
});
