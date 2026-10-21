import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findFrontendProjects } from '../../src/index.js';

describe('findFrontendProjects', () => {
  const base = mkdtempSync(join(tmpdir(), 'sapc-fe-'));
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const pkg = (dir: string, content: object = {}): void => {
    mkdirSync(join(base, dir), { recursive: true });
    writeFileSync(join(base, dir, 'package.json'), JSON.stringify(content));
  };

  it('finds projects below the opened folder, names them after their folder and knows the framework', async () => {
    pkg('pip', {});
    writeFileSync(join(base, 'pip', 'angular.json'), '{}');
    pkg('shop/js-storefront/spartacus', { dependencies: { '@angular/core': '19' } });
    pkg('shop/js-storefront/admin', { dependencies: { react: '19' } });
    pkg('tools', {});
    const found = await findFrontendProjects([base]);
    expect(found.map((f) => [f.name, f.framework])).toEqual([
      ['admin', 'React'],
      ['pip', 'Angular'],
      ['spartacus', 'Angular'],
      ['tools', 'Node.js'],
    ]);
  });

  it('does not look into dependencies, build output, the backend or a project itself', async () => {
    pkg('app', {});
    pkg('app/node_modules/left-pad', {});
    pkg('app/packages/inner', {});
    pkg('backend/core-customize/hybris/bin/custom/x/web', {});
    pkg('site/dist/bundle', {});
    pkg('site/web', {});
    const found = (
      await findFrontendProjects([join(base, 'app'), join(base, 'backend'), join(base, 'site')])
    ).map((f) => f.name);
    expect(found).toEqual(['app', 'web']);
  });

  it('is empty for missing folders', async () => {
    expect(await findFrontendProjects([join(base, 'nothing')])).toEqual([]);
  });
});
