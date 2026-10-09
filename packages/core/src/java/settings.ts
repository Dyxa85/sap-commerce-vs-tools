import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { PlatformProject } from '../platform/model.js';

/** The settings of the Red Hat Java extension that describe an "invisible project" (see ADR 0001). */
export interface JavaProjectSettings {
  'java.project.sourcePaths': string[];
  'java.project.referencedLibraries': { include: string[]; exclude: string[] };
  'java.project.outputPath': string;
}

export interface JavaSettingsOptions {
  /** Workspace folder the paths are made relative to. */
  base: string;
  /** Include `testsrc`. Default true. */
  includeTests?: boolean;
  /** Extensions to leave out (names). */
  exclude?: readonly string[];
  /** Cap to protect the language server from huge projects (default: no cap). */
  maxExtensions?: number;
  /**
   * `sources` (default): the Java server compiles the sources of every loaded extension.
   * `compiled`: only custom extensions are compiled by it; platform and modules come from the result of `ant build`
   * (`bin/*.jar`, and the `classes` folders packed by `packClassFolders` when `classJarsDir` is set).
   */
  mode?: 'sources' | 'compiled';
  /**
   * In `compiled` mode: directory with one jar per extension, made from its `classes` folder. The Java server only
   * accepts jars as libraries, a `classes` folder listed there is silently ignored (measured).
   */
  classJarsDir?: string;
}

const SOURCE_ROOTS = [
  'src',
  'gensrc',
  'web/src',
  'web/gensrc',
  // parts of an extension that are built into other web applications
  'backoffice/src',
  'acceleratoraddon/web/src',
];
const TEST_ROOTS = ['testsrc', 'web/testsrc', 'backoffice/testsrc', 'acceleratoraddon/web/testsrc'];
const LIB_DIRS = ['lib', 'web/webroot/WEB-INF/lib'];

/** Where `packClassFolders` puts the jar of an extension. */
export function classJarPath(dir: string, extension: string): string {
  return join(dir, `${extension}.jar`);
}

const posix = (p: string): string => p.split(sep).join('/');

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFilled(path: string): boolean {
  try {
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

function hasJars(dir: string): boolean {
  try {
    return readdirSync(dir).some((f) => f.endsWith('.jar'));
  } catch {
    return false;
  }
}

/**
 * Derives the settings from the loaded extensions: every existing source root as source path, every `lib` directory
 * and the platform's own jars as library globs. Only directories that exist are listed.
 */
export function javaProjectSettings(
  project: PlatformProject,
  options: JavaSettingsOptions,
): JavaProjectSettings {
  const shown = (path: string): string => {
    const rel = relative(options.base, path);
    return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? posix(path) : posix(rel);
  };
  const skip = new Set(options.exclude ?? []);
  const extensions = project.loaded
    .filter((e) => !skip.has(e.name))
    .slice(0, options.maxExtensions ?? Infinity);

  const compiled = options.mode === 'compiled';
  const roots = [...SOURCE_ROOTS, ...(options.includeTests === false ? [] : TEST_ROOTS)];
  const sourcePaths: string[] = [];
  const include: string[] = [];
  for (const ext of extensions) {
    // in compiled mode only the code you work on is compiled by the Java server; an extension that `ant build` has not
    // produced anything for (after `ant clean`, or a module that was never built) falls back to its sources
    const built =
      hasJars(join(ext.dir, 'bin')) ||
      (options.classJarsDir !== undefined && isFilled(join(ext.dir, 'classes')));
    const asSources = !compiled || ext.category === 'custom' || !built;
    for (const root of asSources ? roots : []) {
      const dir = join(ext.dir, root);
      if (isDir(dir)) sourcePaths.push(shown(dir));
    }
    for (const lib of LIB_DIRS) {
      const dir = join(ext.dir, lib);
      if (hasJars(dir)) include.push(`${shown(dir)}/*.jar`);
    }
    // An extension without hand-written sources ships its classes as `bin/*.jar` (platform `core` and `processing`, most
    // modules: 86 of 234 extensions of a real 2211 project). `gensrc` does not count: it holds only generated models,
    // the real code of such an extension is in the jar. One with a `src` folder is compiled by the Java server itself,
    // its jar would only be a stale second copy of the same classes.
    if (!asSources || !isDir(join(ext.dir, 'src'))) {
      const bin = join(ext.dir, 'bin');
      if (hasJars(bin)) include.push(`${shown(bin)}/*.jar`);
    }
    if (!asSources && options.classJarsDir !== undefined && isFilled(join(ext.dir, 'classes'))) {
      include.push(shown(classJarPath(options.classJarsDir, ext.name)));
    }
  }

  // the platform: bootstrap jars (ybootstrap, yant, …), its shared libraries and Tomcat's API jars
  const exclude: string[] = [];
  const bootstrap = join(project.platformDir, 'bootstrap');
  const generated = join(bootstrap, 'gensrc');
  const models = join(bootstrap, 'bin', 'models.jar');
  if (isDir(generated) && (!compiled || !existsSync(models))) {
    // the generated model sources are indexed directly, so the compiled copy would only duplicate every class
    sourcePaths.push(shown(generated));
    exclude.push('**/bootstrap/bin/models.jar');
  }
  for (const dir of [
    join(bootstrap, 'bin'),
    join(project.platformDir, 'lib'),
    join(project.platformDir, 'tomcat', 'lib'),
  ]) {
    if (hasJars(dir)) include.push(`${shown(dir)}/*.jar`);
  }
  // library folders of the platform's own libs (`lib/dbdriver`, …)
  const dbdriver = join(project.platformDir, 'lib', 'dbdriver');
  if (hasJars(dbdriver)) include.push(`${shown(dbdriver)}/*.jar`);

  return {
    'java.project.sourcePaths': [...new Set(sourcePaths)],
    'java.project.referencedLibraries': { include: [...new Set(include)], exclude },
    'java.project.outputPath': '.sapcommerce/classes',
  };
}

/** Why the "invisible project" mode would not start in this folder (build files at its root win). */
export function conflictingBuildFiles(dir: string): string[] {
  return ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', '.project'].filter(
    (f) => existsSync(join(dir, f)),
  );
}
