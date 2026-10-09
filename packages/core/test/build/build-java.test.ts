import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  antInvocation,
  classJarPath,
  conflictingBuildFiles,
  debugPort,
  isValidArgument,
  javaProjectSettings,
  loadPlatform,
  packClassFolders,
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

  it('references bin jars only of extensions without a src folder', async () => {
    const hybris = join(root, 'hybris');
    // no sources at all: the classes are in the jar
    make('hybris/bin/modules/nosrc/bin', ['nosrcserver.jar']);
    // generated sources only (like platform "processing"): the code is still only in the jar
    make('hybris/bin/modules/gensrcOnly/gensrc');
    make('hybris/bin/modules/gensrcOnly/bin', ['gensrcOnlyserver.jar']);
    // real sources: compiled by the Java server, the jar would be a stale copy
    make('hybris/bin/modules/withsrc/src');
    make('hybris/bin/modules/withsrc/bin', ['withsrcserver.jar']);
    for (const name of ['nosrc', 'gensrcOnly', 'withsrc']) {
      writeFileSync(
        join(hybris, `bin/modules/${name}/extensioninfo.xml`),
        `<extensioninfo><extension name="${name}"/></extensioninfo>`,
      );
    }
    writeFileSync(
      join(hybris, 'config/localextensions.xml'),
      '<hybrisconfig><extensions><path dir="${HYBRIS_BIN_DIR}"/><extension name="alpha"/><extension name="nosrc"/><extension name="gensrcOnly"/><extension name="withsrc"/></extensions></hybrisconfig>',
    );
    const withModules = await loadPlatform(hybris);
    const libs = javaProjectSettings(withModules, { base: root })[
      'java.project.referencedLibraries'
    ].include;
    expect(libs).toContain('hybris/bin/modules/nosrc/bin/*.jar');
    expect(libs).toContain('hybris/bin/modules/gensrcOnly/bin/*.jar');
    expect(libs).not.toContain('hybris/bin/modules/withsrc/bin/*.jar');
  });

  it('lists backoffice and addon source folders', async () => {
    const hybris = join(root, 'hybris');
    make('hybris/bin/custom/alpha/backoffice/src');
    make('hybris/bin/custom/alpha/backoffice/testsrc');
    make('hybris/bin/custom/alpha/acceleratoraddon/web/src');
    const settings = javaProjectSettings(await loadPlatform(hybris), { base: root });
    expect(settings['java.project.sourcePaths']).toEqual(
      expect.arrayContaining([
        'hybris/bin/custom/alpha/backoffice/src',
        'hybris/bin/custom/alpha/backoffice/testsrc',
        'hybris/bin/custom/alpha/acceleratoraddon/web/src',
      ]),
    );
    const noTests = javaProjectSettings(await loadPlatform(hybris), {
      base: root,
      includeTests: false,
    });
    expect(noTests['java.project.sourcePaths']).not.toContain(
      'hybris/bin/custom/alpha/backoffice/testsrc',
    );
  });

  it('takes platform and modules from the Ant build in compiled mode', async () => {
    const hybris = join(root, 'hybris');
    // built module with sources and a jar; built module with sources and only a classes folder; never built module
    make('hybris/bin/modules/withsrc/classes/com');
    make('hybris/bin/modules/classesOnly/src');
    make('hybris/bin/modules/classesOnly/classes/com');
    make('hybris/bin/modules/unbuilt/src');
    make('hybris/bin/modules/unbuilt/classes');
    for (const name of ['classesOnly', 'unbuilt']) {
      writeFileSync(
        join(hybris, `bin/modules/${name}/extensioninfo.xml`),
        `<extensioninfo><extension name="${name}"/></extensioninfo>`,
      );
    }
    writeFileSync(
      join(hybris, 'config/localextensions.xml'),
      '<hybrisconfig><extensions><path dir="${HYBRIS_BIN_DIR}"/><extension name="alpha"/><extension name="withsrc"/><extension name="classesOnly"/><extension name="unbuilt"/></extensions></hybrisconfig>',
    );
    const loaded = await loadPlatform(hybris);

    const jars = javaProjectSettings(loaded, { base: root, mode: 'compiled' });
    const sources = jars['java.project.sourcePaths'];
    // own code stays source, built modules are not compiled again, an unbuilt one falls back to its sources
    expect(sources).toContain('hybris/bin/custom/alpha/src');
    expect(sources).not.toContain('hybris/bin/modules/withsrc/src');
    // no jar and classes folders not requested: nothing to take from the build
    expect(sources).toContain('hybris/bin/modules/classesOnly/src');
    expect(sources).toContain('hybris/bin/modules/unbuilt/src');
    expect(jars['java.project.referencedLibraries'].include).toContain(
      'hybris/bin/modules/withsrc/bin/*.jar',
    );
    // the existing models.jar replaces the generated sources
    expect(sources).not.toContain('hybris/bin/platform/bootstrap/gensrc');
    expect(jars['java.project.referencedLibraries'].exclude).toEqual([]);

    // classes folders are only used through jars made from them, and only when they hold something
    const withClasses = javaProjectSettings(loaded, {
      base: root,
      mode: 'compiled',
      classJarsDir: join(root, '.sapcommerce/libs'),
    });
    expect(withClasses['java.project.referencedLibraries'].include).toContain(
      '.sapcommerce/libs/classesOnly.jar',
    );
    expect(withClasses['java.project.sourcePaths']).not.toContain(
      'hybris/bin/modules/classesOnly/src',
    );
    expect(withClasses['java.project.sourcePaths']).toContain('hybris/bin/modules/unbuilt/src');
    expect(withClasses['java.project.referencedLibraries'].include).not.toContain(
      '.sapcommerce/libs/unbuilt.jar',
    );

    // without a models.jar (clean checkout) the generated model sources are needed
    rmSync(join(hybris, 'bin/platform/bootstrap/bin/models.jar'));
    const unbuilt = javaProjectSettings(loaded, { base: root, mode: 'compiled' });
    expect(unbuilt['java.project.sourcePaths']).toContain('hybris/bin/platform/bootstrap/gensrc');
  });

  it('packs classes folders into jars the Java server can read, and only again when they changed', async () => {
    const hybris = join(root, 'hybris');
    writeFileSync(join(hybris, 'bin/modules/classesOnly/classes/com/A.class'), 'AAAA');
    writeFileSync(join(hybris, 'bin/modules/classesOnly/classes/B.class'), 'bb');
    const loaded = await loadPlatform(hybris);
    const out = join(root, '.sapcommerce/libs');
    const first = await packClassFolders(loaded, out);
    expect(first.failed).toEqual([]);
    expect(first.packed).toBeGreaterThanOrEqual(1);
    expect(readdirSync(out).filter((f) => f.endsWith('.tmp'))).toEqual([]);

    // read the archive back: names, content and checksums
    const jar = readFileSync(classJarPath(out, 'classesOnly'));
    expect(jar.readUInt32LE(jar.length - 22)).toBe(0x06054b50);
    const count = jar.readUInt16LE(jar.length - 12);
    let at = jar.readUInt32LE(jar.length - 6);
    const found: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      const crc = jar.readUInt32LE(at + 16);
      const size = jar.readUInt32LE(at + 20);
      const nameLength = jar.readUInt16LE(at + 28);
      const local = jar.readUInt32LE(at + 42);
      const name = jar.subarray(at + 46, at + 46 + nameLength).toString('utf8');
      const start = local + 30 + jar.readUInt16LE(local + 26);
      const data = jar.subarray(start, start + size);
      expect(crc32(data)).toBe(crc);
      found[name] = data.toString();
      at += 46 + nameLength;
    }
    expect(found).toEqual({ 'com/A.class': 'AAAA', 'B.class': 'bb' });

    const again = await packClassFolders(loaded, out);
    expect(again.packed).toBe(0);
    expect(again.upToDate).toBe(first.packed);
    // a newer class file makes the jar out of date
    const later = new Date(Date.now() + 5000);
    writeFileSync(join(hybris, 'bin/modules/classesOnly/classes/C.class'), 'c');
    utimesSync(join(hybris, 'bin/modules/classesOnly/classes/C.class'), later, later);
    expect((await packClassFolders(loaded, out)).packed).toBe(1);
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
