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
}

const SOURCE_ROOTS = ['src', 'gensrc', 'web/src', 'web/gensrc'];
const TEST_ROOTS = ['testsrc', 'web/testsrc'];
const LIB_DIRS = ['lib', 'web/webroot/WEB-INF/lib'];

const posix = (p: string): string => p.split(sep).join('/');

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
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

  const roots = [...SOURCE_ROOTS, ...(options.includeTests === false ? [] : TEST_ROOTS)];
  const sourcePaths: string[] = [];
  const include: string[] = [];
  for (const ext of extensions) {
    for (const root of roots) {
      const dir = join(ext.dir, root);
      if (isDir(dir)) sourcePaths.push(shown(dir));
    }
    for (const lib of LIB_DIRS) {
      const dir = join(ext.dir, lib);
      if (hasJars(dir)) include.push(`${shown(dir)}/*.jar`);
    }
  }

  // the platform: bootstrap jars (ybootstrap, yant, …), its shared libraries and Tomcat's API jars
  const exclude: string[] = [];
  const bootstrap = join(project.platformDir, 'bootstrap');
  const generated = join(bootstrap, 'gensrc');
  if (isDir(generated)) {
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
