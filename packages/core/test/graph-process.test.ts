import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { graph, processes } from '../src/index.js';

const fixture = fileURLToPath(new URL('../../test-fixtures/hybris', import.meta.url));

const nodes = (...ids: string[]) => ids.map((id) => ({ id, label: id }));
const edge = (from: string, to: string, label?: string) => ({ from, to, label });

describe('graph layout', () => {
  it('layers a DAG left to right along the edges', () => {
    const layout = graph.layoutGraph(nodes('a', 'b', 'c', 'd'), [
      edge('a', 'b'),
      edge('a', 'c'),
      edge('b', 'd'),
      edge('c', 'd'),
    ]);
    const x = Object.fromEntries(layout.nodes.map((n) => [n.id, n.x]));
    expect(x.a!).toBeLessThan(x.b!);
    expect(x.b!).toBe(x.c);
    expect(x.c!).toBeLessThan(x.d!);
    expect(layout.edges.every((e) => !e.back)).toBe(true);
  });

  it('never overlaps nodes', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const es = ids.slice(1).map((id, i) => edge(ids[Math.floor(i / 3)]!, id));
    const layout = graph.layoutGraph(nodes(...ids), es);
    for (const [i, a] of layout.nodes.entries()) {
      for (const b of layout.nodes.slice(i + 1)) {
        const overlap =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlap, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
    expect(layout.width).toBeGreaterThan(0);
    for (const n of layout.nodes) {
      expect(n.x + n.width).toBeLessThanOrEqual(layout.width);
      expect(n.y + n.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it('handles cycles, self loops, unknown endpoints and disconnected nodes', () => {
    const layout = graph.layoutGraph(nodes('a', 'b', 'c', 'lonely'), [
      edge('a', 'b'),
      edge('b', 'c'),
      edge('c', 'a'),
      edge('a', 'a'),
      edge('a', 'ghost'),
    ]);
    expect(layout.nodes).toHaveLength(4);
    expect(layout.edges.filter((e) => e.back)).toHaveLength(1);
    expect(layout.edges.some((e) => e.to === 'ghost' || e.from === e.to)).toBe(false);
  });

  it('is deterministic and supports top-to-bottom', () => {
    const es = [edge('a', 'b'), edge('a', 'c'), edge('c', 'd')];
    const first = graph.layoutGraph(nodes('a', 'b', 'c', 'd'), es, { direction: 'TB' });
    const second = graph.layoutGraph(nodes('a', 'b', 'c', 'd'), es, { direction: 'TB' });
    expect(first).toEqual(second);
    const y = Object.fromEntries(first.nodes.map((n) => [n.id, n.y]));
    expect(y.a!).toBeLessThan(y.b!);
    expect(y.c!).toBeLessThan(y.d!);
  });

  it('copes with empty graphs and large graphs', () => {
    expect(graph.layoutGraph([], []).nodes).toEqual([]);
    const ids = Array.from({ length: 400 }, (_, i) => `m${i}`);
    const es = ids.flatMap(
      (id, i) =>
        [
          i > 0 ? edge(ids[Math.floor((i - 1) / 2)]!, id) : undefined,
          i > 10 ? edge(ids[i - 7]!, id) : undefined,
        ].filter(Boolean) as ReturnType<typeof edge>[],
    );
    const started = Date.now();
    const layout = graph.layoutGraph(nodes(...ids), es);
    expect(layout.nodes).toHaveLength(400);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('svg rendering', () => {
  it('escapes labels and ids and exposes data-id for clicks', () => {
    const evil = '<img src=x onerror=alert(1)>"\'&';
    const svg = graph.renderSvg(
      graph.layoutGraph(
        [
          { id: evil, label: evil, detail: evil, kind: 'k"x' },
          { id: 'b', label: 'b' },
        ],
        [{ from: evil, to: 'b', label: evil, kind: 'x y' }],
      ),
    );
    expect(svg).not.toContain('<img');
    expect(svg).toContain('data-id=');
    expect(svg).toContain('node-k_x');
    expect(svg).toContain('marker-end="url(#arrow)"');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('marks the focus node and back edges', () => {
    const layout = graph.layoutGraph(nodes('a', 'b'), [edge('a', 'b'), edge('b', 'a')]);
    const svg = graph.renderSvg(layout, { focus: 'a' });
    expect(svg).toContain('node node-default focus');
    expect(svg).toContain('back');
  });
});

describe('business processes', () => {
  const text = readFileSync(
    join(
      fixture,
      'bin',
      'custom',
      'acmeprocess',
      'resources',
      'processes',
      'badge-award-process.xml',
    ),
    'utf8',
  );
  const def = processes.parseProcess(text)!;

  it('parses nodes and every kind of transition', () => {
    expect(def).toMatchObject({
      name: 'badgeAwardProcess',
      start: 'checkEligibility',
      onError: 'failed',
    });
    expect(def.nodes.map((n) => `${n.kind}:${n.id}`)).toEqual([
      'action:checkEligibility',
      'split:split',
      'action:awardBadge',
      'action:notifyCustomer',
      'join:join',
      'wait:waitForConfirmation',
      'end:success',
      'end:failed',
    ]);
    const targets = def.edges.map((e) => `${e.from}->${e.to}${e.label ? `(${e.label})` : ''}`);
    expect(targets).toEqual(
      expect.arrayContaining([
        'checkEligibility->split(OK)',
        'checkEligibility->success(NOK)',
        'split->awardBadge',
        'split->notifyCustomer',
        'join->waitForConfirmation',
        'waitForConfirmation->success',
      ]),
    );
    expect(def.nodes[0]).toMatchObject({ bean: 'checkEligibilityAction' });
  });

  it('is clean for the fixture process', () => {
    expect(processes.analyzeProcess(def, { hasBean: () => true })).toEqual([]);
  });

  it('reports broken definitions', () => {
    const broken = processes.parseProcess(
      '<process start="a"><action id="a" bean="x"><transition name="OK" to="nowhere"/></action><action id="a"/><action id="orphan" bean="y"><transition name="OK" to="a"/></action></process>',
    )!;
    const codes = processes.analyzeProcess(broken).map((p) => p.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'process.target.unknown',
        'process.node.duplicate',
        'process.action.no-bean',
        'process.node.unreachable',
        'process.end.unreachable',
      ]),
    );
    expect(
      processes
        .analyzeProcess(
          processes.parseProcess('<process><end id="e" state="SUCCEEDED"/></process>')!,
        )
        .map((p) => p.code),
    ).toContain('process.start.missing');
  });

  it('checks beans only when asked and only as info', () => {
    const problems = processes.analyzeProcess(def, { hasBean: (id) => id !== 'awardBadgeAction' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: 'process.bean.unknown', severity: 'info' });
  });

  it('suggests a close node for a misspelled target', () => {
    const broken = processes.parseProcess(
      '<process start="a"><action id="a" bean="x"><transition name="OK" to="sucess"/></action><end id="success" state="SUCCEEDED"/></process>',
    )!;
    expect(
      processes.analyzeProcess(broken).find((p) => p.code === 'process.target.unknown')?.data
        ?.suggestion,
    ).toBe('success');
  });

  it('builds a graph the layout can use', () => {
    const g = processes.processGraph(def);
    const layout = graph.layoutGraph(g.nodes, g.edges);
    expect(layout.nodes.find((n) => n.id === 'checkEligibility')?.kind).toBe('start');
    expect(layout.nodes.find((n) => n.id === 'success')?.kind).toBe('end-succeeded');
    const x = Object.fromEntries(layout.nodes.map((n) => [n.id, n.x]));
    expect(x.checkEligibility!).toBeLessThan(x.success!);
  });

  it('ignores other XML and survives broken input', () => {
    expect(processes.parseProcess('<beans/>')).toBeUndefined();
    expect(processes.parseProcess('<process start="a"><action id="a" bean="x"')?.nodes[0]?.id).toBe(
      'a',
    );
  });
});

describe('type and module graphs (fixture)', async () => {
  const { buildTypeSystem, loadPlatform, typeGraph, moduleGraph } = await import('../src/index.js');
  const project = await loadPlatform(fixture);
  const ts = await buildTypeSystem(project);

  it('builds the inheritance and reference graph around a type', () => {
    const g = typeGraph(ts, 'Language', { subtypeDepth: 0 })!;
    expect(g.focus).toBe('Language');
    expect(g.nodes.map((n) => n.id)).toEqual(['Language', 'C2LItem', 'GenericItem', 'Item']);
    expect(g.nodes[0]?.kind).toBe('focus');
    expect(g.edges.filter((e) => e.kind === 'extends').map((e) => `${e.from}>${e.to}`)).toEqual([
      'Language>C2LItem',
      'C2LItem>GenericItem',
      'GenericItem>Item',
    ]);
    expect(g.nodes.find((n) => n.id === 'C2LItem')?.kind).toBe('abstract');
  });

  it('includes direct subtypes and referenced types with the attribute as label', () => {
    const subtypes = typeGraph(ts, 'C2LItem')!;
    expect(subtypes.nodes.map((n) => n.id)).toContain('Language');
    const refs = typeGraph(ts, 'Product', { subtypeDepth: 0 })!;
    expect(refs.edges.find((e) => e.kind === 'reference' && e.label === 'catalogVersion')?.to).toBe(
      'CatalogVersion',
    );
    expect(refs.nodes.find((n) => n.id === 'ArticleApprovalStatus')?.kind).toBe('enum');
    expect(
      typeGraph(ts, 'Product', { references: false, subtypeDepth: 0 })!.edges.every(
        (e) => e.kind === 'extends',
      ),
    ).toBe(true);
  });

  it('respects the node limit and unknown types', () => {
    const limited = typeGraph(ts, 'Item', { subtypeDepth: 3, maxNodes: 4 })!;
    expect(limited.nodes).toHaveLength(4);
    expect(limited.truncated).toBe(true);
    expect(typeGraph(ts, 'Nope')).toBeUndefined();
  });

  it('builds module graphs for different scopes', () => {
    const custom = moduleGraph(project, { kind: 'custom' });
    expect(custom.nodes.map((n) => n.id).sort()).toEqual([
      'acmecore',
      'acmefacades',
      'acmeprocess',
      'core',
    ]);
    expect(custom.edges).toContainEqual({
      from: 'acmeprocess',
      to: 'acmefacades',
      kind: 'requires',
    });
    expect(moduleGraph(project, { kind: 'all' }).hidden).toBe(0);
    expect(
      moduleGraph(project, { kind: 'dependencies', extension: 'acmefacades' })
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(['acmecore', 'acmefacades', 'core']);
    expect(
      moduleGraph(project, { kind: 'dependents', extension: 'acmecore' })
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(['acmecore', 'acmefacades', 'acmeprocess']);
    expect(
      moduleGraph(project, { kind: 'dependents', extension: 'acmefacades', depth: 1 })
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(['acmefacades', 'acmeprocess']);
  });
});

describe('long edges', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id }));
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'a', to: 'd', label: 'skip' }, // crosses the layers of b and c
    { from: 'a', to: 'e' },
    { from: 'e', to: 'd' },
  ];
  const inside = (
    p: { x: number; y: number },
    n: { x: number; y: number; width: number; height: number },
  ): boolean => p.x > n.x && p.x < n.x + n.width && p.y > n.y && p.y < n.y + n.height;

  for (const direction of ['LR', 'TB'] as const) {
    it(`keeps every anchor of a ${direction} edge out of the nodes it passes`, () => {
      const layout = graph.layoutGraph(nodes, edges, { direction });
      const skip = layout.edges.find((e) => e.label === 'skip')!;
      expect(skip.points.length).toBeGreaterThan(2);
      const byId = new Map(layout.nodes.map((n) => [n.id, n]));
      for (const p of skip.points)
        for (const n of layout.nodes)
          expect(inside(p, n), `${n.id} at ${JSON.stringify(p)}`).toBe(false);
      // starts at a, ends at d
      const a = byId.get('a')!;
      const d = byId.get('d')!;
      const near = (p: { x: number; y: number }, n: typeof a): boolean =>
        p.x >= n.x - 1 && p.x <= n.x + n.width + 1 && p.y >= n.y - 1 && p.y <= n.y + n.height + 1;
      expect(near(skip.points[0]!, a)).toBe(true);
      expect(near(skip.points.at(-1)!, d)).toBe(true);
    });
  }

  it('ends a long back edge at its real target', () => {
    const layout = graph.layoutGraph(
      ['a', 'b', 'c'].map((id) => ({ id, label: id })),
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ],
    );
    const back = layout.edges.find((e) => e.from === 'c')!;
    const a = layout.nodes.find((n) => n.id === 'a')!;
    const c = layout.nodes.find((n) => n.id === 'c')!;
    expect(back.back).toBe(true);
    const first = back.points[0]!;
    const last = back.points.at(-1)!;
    expect(Math.abs(first.x - c.x) <= c.width + 1 && Math.abs(last.x - a.x) <= a.width + 1).toBe(
      true,
    );
    // the arrow (end of the path) points at "a"
    expect(last.x).toBeGreaterThanOrEqual(a.x - 1);
    expect(last.x).toBeLessThanOrEqual(a.x + a.width + 1);
  });

  it('renders one curve segment per pair of anchors and stays valid SVG text', () => {
    const layout = graph.layoutGraph(nodes, edges);
    const svg = graph.renderSvg(layout);
    const skip = layout.edges.find((e) => e.label === 'skip')!;
    const path = svg.split('<g class="edge ').find((g) => g.includes('skip'))!;
    expect((path.match(/ C /g) ?? []).length).toBe(skip.points.length - 1);
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('undefined');
  });

  it('handles a deep chain with many skipping edges quickly', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, label: `n${i}` }));
    const links = [
      ...many.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id })),
      ...many.slice(0, 250).map((n, i) => ({ from: n.id, to: `n${i + 40}` })),
    ];
    const started = Date.now();
    const layout = graph.layoutGraph(many, links);
    expect(layout.nodes).toHaveLength(300);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
