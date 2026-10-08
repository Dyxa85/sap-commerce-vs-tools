import { build } from 'esbuild';
import { readdirSync } from 'node:fs';

const tests = readdirSync('test-host/suite').filter((f) => f.endsWith('.ts'));

await build({
  entryPoints: [
    ...tests.map((f) => `test-host/suite/${f}`),
    { in: 'test-host/run.ts', out: 'run' },
  ],
  outdir: 'dist-test',
  outbase: 'test-host',
  entryNames: '[dir]/[name]',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outExtension: { '.js': '.cjs' },
  external: ['vscode', 'mocha', '@vscode/test-electron'],
  sourcemap: true,
  logLevel: 'info',
});
