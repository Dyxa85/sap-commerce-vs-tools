import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** A JDK on this machine. */
export interface Jdk {
  /** Major version, e.g. 21. */
  version: number;
  home: string;
}

/**
 * The Java version the platform insists on: the Ant build refuses to run with any other one
 * (`required_java_version` in `platform/resources/ant/util.xml`).
 */
export function requiredJavaVersion(platformDir: string): number | undefined {
  try {
    const text = readFileSync(join(platformDir, 'resources', 'ant', 'util.xml'), 'utf8');
    const m = /name="required_java_version"\s+value="(\d+)"/.exec(text);
    return m ? Number(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

/** Major version of the JDK in `home`, read from its `release` file. */
export function jdkVersion(home: string): number | undefined {
  try {
    const text = readFileSync(join(home, 'release'), 'utf8');
    const m = /JAVA_VERSION="?(\d+)(?:\.(\d+))?/.exec(text);
    if (!m) return undefined;
    return m[1] === '1' ? Number(m[2]) : Number(m[1]);
  } catch {
    return undefined;
  }
}

function children(dir: string): string[] {
  try {
    return readdirSync(dir).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/** The places JDKs are usually installed in, most specific first. */
export function jdkCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string[] {
  const found: string[] = [];
  if (env.JAVA_HOME) found.push(env.JAVA_HOME);
  if (platform === 'darwin') {
    for (const root of [
      '/Library/Java/JavaVirtualMachines',
      join(home, 'Library/Java/JavaVirtualMachines'),
    ])
      found.push(...children(root).map((d) => join(d, 'Contents', 'Home')));
    found.push(
      ...children('/opt/homebrew/opt')
        .filter((d) => /openjdk/.test(d))
        .map((d) => join(d, 'libexec/openjdk.jdk/Contents/Home')),
    );
  } else if (platform === 'win32') {
    for (const root of [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\SapMachine',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Amazon Corretto',
    ])
      found.push(...children(root));
  } else {
    found.push(...children('/usr/lib/jvm'));
  }
  found.push(...children(join(home, '.sdkman/candidates/java')), ...children(join(home, '.jdks')));
  return found;
}

/** The JDK with exactly this major version among `candidates`, if there is one. */
export function findJdk(
  version: number,
  candidates: readonly string[] = jdkCandidates(),
): Jdk | undefined {
  for (const home of candidates) {
    if (existsSync(join(home, 'release')) && jdkVersion(home) === version) return { version, home };
  }
  return undefined;
}

const runtimeName = (version: number): string =>
  version <= 8 ? `JavaSE-1.${version}` : `JavaSE-${version}`;

/**
 * Settings of the Java extension that are not about the project but about how the server and test runs behave:
 * - the project's JDK is the one the platform requires (otherwise the server's own, newer one is used, and a test run
 *   on it fails on libraries that do not know that class file version yet),
 * - the server's memory: a collector that gives unused heap back, and a limit the project fits in,
 * - no Gradle/Maven import: the project is described by the settings above, a `build.gradle` somewhere in the tree
 *   would start Gradle daemons,
 * - quiet test runs.
 */
export function javaServerSettings(options: {
  jdk?: Jdk;
  /** `sources` compiles every extension and needs a bigger heap. */
  mode: 'compiled' | 'sources';
}): Record<string, unknown> {
  const heap = options.mode === 'sources' ? '-Xmx4G' : '-Xmx1536m';
  const settings: Record<string, unknown> = {
    'java.jdt.ls.vmargs': [
      '-XX:+UseG1GC',
      heap,
      '-Xms100m',
      '-XX:MinHeapFreeRatio=10',
      '-XX:MaxHeapFreeRatio=30',
      '-XX:G1PeriodicGCInterval=30000',
      '-Dsun.zip.disableMemoryMapping=true',
      '-Xlog:disable',
    ].join(' '),
    'java.import.gradle.enabled': false,
    'java.import.maven.enabled': false,
    'java.test.config': {
      vmArgs: ['-XX:+EnableDynamicAgentLoading', '-Xshare:off'],
    },
  };
  if (options.jdk) {
    settings['java.configuration.runtimes'] = [
      { name: runtimeName(options.jdk.version), path: options.jdk.home, default: true },
    ];
  }
  return settings;
}
