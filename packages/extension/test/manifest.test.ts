import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  contributes: {
    commands: { command: string; title: string }[];
    problemMatchers: { name: string; pattern: { regexp: string } }[];
    taskDefinitions: { type: string }[];
    menus: Record<string, { command: string }[]>;
    configuration: { properties: Record<string, unknown> };
  };
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const code = sources(join(root, 'src'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

describe('manifest and code agree', () => {
  const declared = manifest.contributes.commands.map((c) => c.command);

  it('registers every declared command', () => {
    const missing = declared.filter((id) => !code.includes(`'${id}'`));
    expect(missing).toEqual([]);
  });

  it('declares every command that is registered with a literal id', () => {
    const registered = [...code.matchAll(/register\(\s*'(sapcommerce\.[\w.]+)'/g)].map((m) => m[1]);
    const undeclared = registered.filter((id) => !declared.includes(id as string));
    expect(undeclared).toEqual([]);
  });

  it('has unique command ids and titles', () => {
    expect(new Set(declared).size).toBe(declared.length);
    const titles = manifest.contributes.commands.map((c) => c.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('only references declared commands in menus', () => {
    for (const [menu, items] of Object.entries(manifest.contributes.menus)) {
      for (const item of items)
        expect(declared, `${menu}: ${item.command}`).toContain(item.command);
    }
  });

  it('declares the task types the provider registers', () => {
    const types = manifest.contributes.taskDefinitions.map((t) => t.type).sort();
    expect(types).toEqual(['sapcommerce.ant', 'sapcommerce.server']);
  });
});

describe('problem matcher for the platform build', () => {
  const matcher = manifest.contributes.problemMatchers.find((m) => m.name === 'sapcommerce-javac');
  const re = new RegExp(matcher?.pattern.regexp ?? '(?!)');

  it('reads javac messages the way Ant prints them', () => {
    const m = re.exec(
      '    [javac] /h/bin/custom/acme/src/com/acme/Foo.java:12: error: cannot find symbol',
    );
    expect(m?.slice(1)).toEqual([
      '/h/bin/custom/acme/src/com/acme/Foo.java',
      '12',
      'error',
      'cannot find symbol',
    ]);
    expect(re.exec('    [javac] /h/Foo.java:3: warning: [deprecation] x')?.[3]).toBe('warning');
  });

  it('ignores other output', () => {
    expect(re.test('    [javac] Compiling 12 source files')).toBe(false);
    expect(re.test('BUILD FAILED')).toBe(false);
  });
});
