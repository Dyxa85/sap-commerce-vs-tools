/**
 * Starts VS Code with a copy of the installed Red Hat Java extension in a throw-away profile and the extension under
 * development, opens a workspace and runs suite.ts.
 *
 *   LAB_WORKSPACE=/tmp/ws LAB_FILE=/tmp/ws/.../Foo.java LAB_REPORT=/tmp/report.txt node dist-java/run.cjs
 *
 * Optional: LAB_SETTINGS (a JSON file copied to <workspace>/.vscode/settings.json), LAB_CONFIGURE=1 (run
 * "Configure Java for this Project" first), LAB_WAIT_MIN (default 25), LAB_JAVA_EXT (extension folder to copy).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const workspace = process.env.LAB_WORKSPACE;
  if (!workspace) throw new Error('LAB_WORKSPACE is required');
  // LAB_BASE keeps the profile (and with it the Java server's workspace) between runs, like a user's installation
  const base = process.env.LAB_BASE ?? mkdtempSync(join(tmpdir(), 'sapc-javalab-'));
  const extensions = join(base, 'extensions');
  mkdirSync(extensions, { recursive: true });
  const source =
    process.env.LAB_JAVA_EXT ??
    join(
      homedir(),
      '.vscode',
      'extensions',
      readdirSync(join(homedir(), '.vscode', 'extensions')).find((n) =>
        n.startsWith('redhat.java-'),
      ) ?? '',
    );
  if (!existsSync(join(extensions, 'redhat.java')))
    cpSync(source, join(extensions, 'redhat.java'), { recursive: true });
  // the extension needs a package.json at its root; the folder name does not matter

  const userData = join(base, 'user-data');
  mkdirSync(join(userData, 'User'), { recursive: true });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    join(userData, 'User', 'settings.json'),
    JSON.stringify({
      'java.jdt.ls.vmargs': '-XX:+UseParallelGC -Xmx4G -Xms512m',
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
    }),
  );
  if (process.env.LAB_SETTINGS) {
    mkdirSync(join(workspace, '.vscode'), { recursive: true });
    cpSync(process.env.LAB_SETTINGS, join(workspace, '.vscode', 'settings.json'));
  }
  const local = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  await runTests({
    vscodeExecutablePath: existsSync(local) ? local : undefined,
    extensionDevelopmentPath: resolve(__dirname, '..'),
    extensionTestsPath: join(__dirname, 'suite.cjs'),
    extensionTestsEnv: { ...process.env } as Record<string, string>,
    launchArgs: [
      workspace,
      '--extensions-dir',
      extensions,
      '--user-data-dir',
      userData,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
