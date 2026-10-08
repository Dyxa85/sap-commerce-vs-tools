import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface AntTarget {
  name: string;
  description: string;
  group: 'build' | 'system' | 'test' | 'server';
}

/** The targets of the platform's `build.xml` that developers run most often (observed on a 2211 platform). */
export const ANT_TARGETS: readonly AntTarget[] = [
  { name: 'build', description: 'Compile all loaded extensions', group: 'build' },
  { name: 'clean', description: 'Remove compiled classes and generated sources', group: 'build' },
  { name: 'all', description: 'Clean build including generated artefacts', group: 'build' },
  { name: 'customize', description: 'Copy the customize folder into the platform', group: 'build' },
  { name: 'extgen', description: 'Generate a new extension from a template', group: 'build' },
  { name: 'modulegen', description: 'Generate a new module from a template', group: 'build' },
  { name: 'classpathgen', description: 'Generate the .classpath files', group: 'build' },
  { name: 'initialize', description: 'Initialize the system (drops all data)', group: 'system' },
  { name: 'updatesystem', description: 'Update the running system', group: 'system' },
  { name: 'yunitinit', description: 'Initialize the test tenant', group: 'system' },
  { name: 'server', description: 'Start the platform from Ant', group: 'server' },
  { name: 'unittests', description: 'Run unit tests', group: 'test' },
  { name: 'integrationtests', description: 'Run integration tests', group: 'test' },
  { name: 'alltests', description: 'Run all tests', group: 'test' },
  { name: 'allwebtests', description: 'Run all web tests', group: 'test' },
];

const TARGET_NAME = /^[A-Za-z][\w.-]*$/;
/** Ant property definitions (`-Dkey=value`) and a few plain flags; nothing that a shell would interpret. */
const ARGUMENT = /^(-D[\w.-]+=[\w.,:/\\@+-]*|-D[\w.-]+|-v|-d|-q|-f|--debug|--quiet)$/;

export function isValidTarget(name: string): boolean {
  return TARGET_NAME.test(name);
}

export function isValidArgument(arg: string): boolean {
  return ARGUMENT.test(arg);
}

/** A process to start, expressed without a shell string that would need quoting. */
export interface Invocation {
  executable: string;
  args: string[];
  /** Directory to run in (the platform directory). */
  cwd: string;
}

const isWindows = (platform: NodeJS.Platform): boolean => platform === 'win32';

/**
 * `ant <target>` the way the platform expects it: `setantenv` has to be sourced in the platform directory first
 * because it sets `ANT_HOME`, `ANT_OPTS` and `PATH`. Target and arguments are validated, so no quoting is needed.
 */
export function antInvocation(
  platformDir: string,
  target: string,
  args: readonly string[] = [],
  platform: NodeJS.Platform = process.platform,
): Invocation {
  if (!isValidTarget(target)) throw new Error(`Not a valid Ant target name: ${target}`);
  for (const arg of args)
    if (!isValidArgument(arg)) throw new Error(`Argument not allowed: ${arg}`);
  const line = [target, ...args].join(' ');
  return isWindows(platform)
    ? {
        executable: 'cmd.exe',
        args: ['/d', '/c', `call setantenv.bat && ant ${line}`],
        cwd: platformDir,
      }
    : {
        executable: '/bin/sh',
        args: ['-c', `. ./setantenv.sh >/dev/null && ant ${line}`],
        cwd: platformDir,
      };
}

export type ServerMode = 'run' | 'debug' | 'minimal';

/** Starts Tomcat through the platform's own script (`debug` opens the JDWP port). */
export function serverInvocation(
  platformDir: string,
  mode: ServerMode = 'run',
  platform: NodeJS.Platform = process.platform,
): Invocation {
  return isWindows(platform)
    ? {
        executable: 'cmd.exe',
        args: ['/d', '/c', `hybrisserver.bat${mode === 'run' ? '' : ` ${mode}`}`],
        cwd: platformDir,
      }
    : {
        executable: '/bin/sh',
        args: ['./hybrisserver.sh', ...(mode === 'run' ? [] : [mode])],
        cwd: platformDir,
      };
}

/** The port the JDWP agent listens on in debug mode (`tomcat.debugjavaoptions`), 8000 when nothing says otherwise. */
export async function debugPort(platformDir: string, configDir: string): Promise<number> {
  let port = 8000;
  // later files win: platform defaults, then the project's configuration
  for (const file of [
    join(platformDir, 'project.properties'),
    join(configDir, 'local.properties'),
  ]) {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*tomcat\.debugjavaoptions\s*[=:](.*)$/.exec(line);
      const address = m ? /address=(?:[\w.*]+:)?(\d{2,5})/.exec(m[1] ?? '') : null;
      if (address) port = Number(address[1]);
    }
  }
  return port;
}
