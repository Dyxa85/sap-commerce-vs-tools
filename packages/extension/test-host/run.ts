import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

/** Candidate local installs; otherwise test-electron downloads a stable VS Code (CI). */
const LOCAL_VSCODE = [
  process.env.VSCODE_EXECUTABLE_PATH,
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
].filter((p): p is string => typeof p === 'string' && existsSync(p));

async function main(): Promise<void> {
  const root = resolve(__dirname, '..');
  const userData = mkdtempSync(join(tmpdir(), 'sapc-vscode-'));
  const report = join(tmpdir(), `sapc-report-${process.pid}.txt`);
  // The tests run inside a throw-away copy of the fixture project so they may edit files freely.
  const workspace = join(mkdtempSync(join(tmpdir(), 'sapc-ws-')), 'project');
  cpSync(join(root, '..', 'test-fixtures'), workspace, { recursive: true });
  process.env.SAPC_TEST_REPORT = report;
  try {
    await runTests({
      vscodeExecutablePath: LOCAL_VSCODE[0],
      extensionDevelopmentPath: root,
      extensionTestsPath: join(root, 'dist-test', 'suite', 'index.cjs'),
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--user-data-dir',
        userData,
      ],
    });
  } finally {
    if (existsSync(report)) {
      const text = readFileSync(report, 'utf8');
      console.log(`\n${text}`);
      // on GitHub Actions the failures also become annotations (visible without downloading logs)
      if (process.env.GITHUB_ACTIONS && /[1-9]\d* failing/.test(text)) {
        const failing = text
          .split(/\r?\n/)
          .filter((line) => !line.trimStart().startsWith('✔'))
          .join('\n');
        const encoded = failing.slice(0, 3500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
        console.log(`::error title=Extension host tests::${encoded}`);
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error('Extension host tests failed:', err);
  process.exit(1);
});
