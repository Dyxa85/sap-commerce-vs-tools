import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateConnectionForm } from '../src/connections/form.js';
import { renderConnectionsPage } from '../src/ui/connections-html.js';
import { FEATURES } from '../src/views/features.js';

const root = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  contributes: {
    commands: { command: string }[];
    views: Record<string, { id: string }[]>;
    viewsContainers: { activitybar: { id: string; icon: string }[] };
    viewsWelcome: { view: string; contents: string }[];
    walkthroughs: { steps: { id: string; description: string; media: { markdown: string } }[] }[];
  };
};
const declared = new Set(manifest.contributes.commands.map((c) => c.command));
const isOurs = (id: string): boolean => id.startsWith('sapcommerce.');

describe('features view', () => {
  const actions = FEATURES.flatMap((g) => g.children);

  it('only offers commands that exist', () => {
    for (const a of actions) {
      if (isOurs(a.command)) expect(declared.has(a.command), a.command).toBe(true);
      else expect(a.command).toMatch(/^workbench\.action\./);
    }
  });

  it('describes where each feature lives', () => {
    for (const a of actions) {
      expect(a.description.length, a.label).toBeGreaterThan(3);
      expect(a.tooltip.length, a.label).toBeGreaterThan(10);
    }
    expect(new Set(actions.map((a) => a.label)).size).toBe(actions.length);
  });

  it('covers every functional area of the extension', () => {
    const commands = new Set(actions.map((a) => a.command));
    for (const must of [
      'sapcommerce.flexsearch.run',
      'sapcommerce.sql.run',
      'sapcommerce.groovy.run',
      'sapcommerce.impex.validate',
      'sapcommerce.impex.import',
      'sapcommerce.pk.analyze',
      'sapcommerce.logger.set',
      'sapcommerce.types.search',
      'sapcommerce.diagram.type',
      'sapcommerce.diagram.modules',
      'sapcommerce.diagram.process',
      'sapcommerce.ant.run',
      'sapcommerce.server.start',
      'sapcommerce.java.configure',
      'sapcommerce.connections.open',
    ])
      expect(commands.has(must), must).toBe(true);
  });
});

describe('side bar contributions', () => {
  it('has a container with an icon that exists, and views in it', () => {
    const container = manifest.contributes.viewsContainers.activitybar[0]!;
    expect(existsSync(join(root, container.icon))).toBe(true);
    const views = manifest.contributes.views[container.id]!.map((v) => v.id);
    expect(views).toEqual([
      'sapcommerce.connections',
      'sapcommerce.actions',
      'sapcommerce.project',
      'sapcommerce.ccv2',
    ]);
  });

  it('gives every view an explanation for the empty state where it can be empty', () => {
    const welcomed = manifest.contributes.viewsWelcome.map((w) => w.view);
    expect(welcomed).toEqual(
      expect.arrayContaining([
        'sapcommerce.connections',
        'sapcommerce.project',
        'sapcommerce.ccv2',
      ]),
    );
  });

  it('links only to commands that exist', () => {
    const texts = [
      ...manifest.contributes.viewsWelcome.map((w) => w.contents),
      ...manifest.contributes.walkthroughs.flatMap((w) => w.steps.map((s) => s.description)),
    ];
    for (const text of texts) {
      for (const m of text.matchAll(/\(command:([\w.]+)/g)) {
        const id = m[1] as string;
        if (id.startsWith('sapcommerce.') && !id.endsWith('.focus'))
          expect(declared.has(id), id).toBe(true);
      }
    }
  });

  it('ships the page of every walkthrough step', () => {
    for (const step of manifest.contributes.walkthroughs.flatMap((w) => w.steps)) {
      expect(existsSync(join(root, step.media.markdown)), step.id).toBe(true);
    }
    const ignore = readFileSync(join(root, '.vscodeignore'), 'utf8');
    expect(ignore).toContain('!walkthrough/**');
    expect(ignore).toContain('!images/**');
  });
});

describe('connections page', () => {
  const html = renderConnectionsPage({ nonce: 'abc123', cspSource: 'vscode-webview://x' });

  it('has a strict policy and no inline handlers', () => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).not.toMatch(/\son[a-z]+="/);
    expect(html).not.toContain('http://');
  });

  it('contains every element the script uses', () => {
    const script = html.slice(html.indexOf('<script'));
    const used = new Set([...script.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
    for (const id of used) expect(html, id).toContain(`id="${id}"`);
  });

  it('explains what a connection is for', () => {
    expect(html).toContain('FlexibleSearch');
    expect(html).toContain('without');
  });
});

describe('validateConnectionForm', () => {
  const ok = { name: 'Local', url: 'localhost:9002', username: 'admin' };

  it('accepts a short form and normalises it', () => {
    const r = validateConnectionForm({ ...ok, password: 'x', protected: true }, []);
    expect(r).toMatchObject({
      ok: true,
      password: 'x',
      connection: {
        id: 'local',
        url: 'https://localhost:9002/hac',
        username: 'admin',
        protected: true,
      },
    });
  });

  it.each([
    [{ ...ok, name: ' ' }, 'name'],
    [{ ...ok, url: 'ftp://x' }, 'url'],
    [{ ...ok, url: 'https://user:pw@host/hac' }, 'url'],
    [{ ...ok, username: '' }, 'username'],
    [{ ...ok, locale: 'not a locale' }, 'locale'],
    [{ ...ok, dataSource: 'a b' }, 'dataSource'],
    [{ ...ok, name: 'x'.repeat(61) }, 'name'],
    [{ name: 5, url: {}, username: [] }, 'name'],
  ])('rejects %j (%s)', (form, field) => {
    const r = validateConnectionForm(form as never, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe(field);
  });

  it('refuses a name that another connection already uses, but allows keeping the own one', () => {
    const existing = [
      {
        id: 'local',
        name: 'Local',
        url: 'https://a/hac',
        username: 'u',
        ignoreTlsErrors: false,
        protected: false,
      },
    ];
    expect(validateConnectionForm(ok, existing)).toMatchObject({ ok: false, field: 'name' });
    expect(validateConnectionForm({ ...ok, originalId: 'local' }, existing).ok).toBe(true);
  });

  it('ignores "ignore TLS errors" for plain http, and keeps an empty password undefined', () => {
    const r = validateConnectionForm(
      { ...ok, url: 'http://localhost:9001/hac', ignoreTlsErrors: true, password: '' },
      [],
    );
    expect(r).toMatchObject({ ok: true, connection: { ignoreTlsErrors: false } });
    expect(r.ok && r.password).toBeUndefined();
  });
});
