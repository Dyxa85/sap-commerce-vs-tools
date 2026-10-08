import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  antInvocation,
  conflictingBuildFiles,
  debugPort,
  isValidArgument,
  javaProjectSettings,
  loadPlatform,
  serverInvocation,
  type PlatformProject,
} from '../../src/index.js';

describe('Ant and server invocations', () => {
  it('sources setantenv before ant on Unix, in the platform directory', () => {
    const i = antInvocation('/h/bin/platform', 'build', [], 'darwin');
    expect(i.cwd).toBe('/h/bin/platform');
    expect(i.executable).toBe('/bin/sh');
    expect(i.args).toEqual(['-c', '. ./setantenv.sh >/dev/null && ant build']);
  });

  it('uses the batch file on Windows', () => {
    const i = antInvocation('C:\\h\\bin\\platform', 'clean', ['-Dfoo=bar'], 'win32');
    expect(i.executable).toBe('cmd.exe');
    expect(i.args.at(-1)).toBe('call setantenv.bat && ant clean -Dfoo=bar');
  });

  it('refuses anything a shell could interpret', () => {
    expect(() => antInvocation('/p', 'build; rm -rf /', [], 'linux')).toThrow();
    expect(() => antInvocation('/p', 'build', ['-Dx=$(id)'], 'linux')).toThrow();
    expect(() => antInvocation('/p', 'build', ['&&', 'id'], 'linux')).toThrow();
    expect(isValidArgument('-Dtestclasses.extensions=acmecore,acmefacades')).toBe(true);
    expect(isValidArgument('-Dx=a b')).toBe(false);
  });

  it('starts the server through the platform script', () => {
    expect(serverInvocation('/p', 'debug', 'linux').args).toEqual(['./hybrisserver.sh', 'debug']);
    expect(serverInvocation('/p', 'run', 'linux').args).toEqual(['./hybrisserver.sh']);
    expect(serverInvocation('C:\\p', 'debug', 'win32').args.at(-1)).toBe('hybrisserver.bat debug');
  });
});

describe('debug port', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sapc-port-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('defaults to 8000 and lets the project configuration override the platform', async () => {
    const platform = join(dir, 'platform');
    const config = join(dir, 'config');
    mkdirSync(platform);
    mkdirSync(config);
    expect(await debugPort(platform, config)).toBe(8000);
    writeFileSync(
      join(platform, 'project.properties'),
      'tomcat.debugjavaoptions=-Xdebug -Xrunjdwp:transport=dt_socket,server=y,address=8123,suspend=n\n',
    );
    expect(await debugPort(platform, config)).toBe(8123);
    writeFileSync(
      join(config, 'local.properties'),
      '# comment\ntomcat.debugjavaoptions=-agentlib:jdwp=transport=dt_socket,server=y,address=*:5005,suspend=n\n',
    );
    expect(await debugPort(platform, config)).toBe(5005);
  });
});

describe('Java project settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'sapc-java-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const make = (path: string, files: string[] = []): void => {
    mkdirSync(join(root, path), { recursive: true });
    for (const f of files) writeFileSync(join(root, path, f), '');
  };
  let project: PlatformProject;

  it('lists only what exists, relative to the workspace', async () => {
    const hybris = join(root, 'hybris');
    make('hybris/config');
    writeFileSync(
      join(hybris, 'config/localextensions.xml'),
      '<hybrisconfig><extensions><path dir="${HYBRIS_BIN_DIR}"/><extension name="alpha"/></extensions></hybrisconfig>',
    );
    make('hybris/bin/platform/ext');
    writeFileSync(join(hybris, 'bin/platform/extensions.xml'), '<extensions/>');
    make('hybris/bin/platform/bootstrap/bin', ['ybootstrap.jar', 'models.jar']);
    make('hybris/bin/platform/bootstrap/gensrc');
    make('hybris/bin/platform/lib', ['a.jar']);
    make('hybris/bin/custom/alpha/src');
    make('hybris/bin/custom/alpha/testsrc');
    make('hybris/bin/custom/alpha/web/webroot/WEB-INF/lib', ['w.jar']);
    make('hybris/bin/custom/alpha/lib', ['x.jar']);
    writeFileSync(
      join(hybris, 'bin/custom/alpha/extensioninfo.xml'),
      '<extensioninfo><extension name="alpha"><coremodule packageroot="com.alpha"/></extension></extensioninfo>',
    );
    project = await loadPlatform(hybris);
    expect(project.loaded.map((e) => e.name)).toContain('alpha');

    const s = javaProjectSettings(project, { base: root });
    expect(s['java.project.sourcePaths']).toEqual(
      expect.arrayContaining([
        'hybris/bin/custom/alpha/src',
        'hybris/bin/custom/alpha/testsrc',
        'hybris/bin/platform/bootstrap/gensrc',
      ]),
    );
    expect(s['java.project.sourcePaths']).not.toContain('hybris/bin/custom/alpha/gensrc');
    const libs = s['java.project.referencedLibraries'];
    expect(libs.include).toEqual(
      expect.arrayContaining([
        'hybris/bin/custom/alpha/lib/*.jar',
        'hybris/bin/custom/alpha/web/webroot/WEB-INF/lib/*.jar',
        'hybris/bin/platform/bootstrap/bin/*.jar',
        'hybris/bin/platform/lib/*.jar',
      ]),
    );
    expect(libs.exclude).toEqual(['**/bootstrap/bin/models.jar']);
  });

  it('can leave out tests and single extensions', () => {
    const s = javaProjectSettings(project, { base: root, includeTests: false, exclude: ['alpha'] });
    expect(s['java.project.sourcePaths'].some((p) => p.includes('alpha'))).toBe(false);
    const noTests = javaProjectSettings(project, { base: root, includeTests: false });
    expect(noTests['java.project.sourcePaths']).not.toContain('hybris/bin/custom/alpha/testsrc');
  });

  it('reports build files that disable the invisible project mode', () => {
    make('ws', ['pom.xml']);
    expect(conflictingBuildFiles(join(root, 'ws'))).toEqual(['pom.xml']);
    expect(conflictingBuildFiles(join(root, 'hybris'))).toEqual([]);
  });
});
