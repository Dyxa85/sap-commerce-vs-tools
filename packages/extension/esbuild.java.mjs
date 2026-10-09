import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
};
await build({
  ...shared,
  entryPoints: ['test-java/run.ts'],
  outfile: 'dist-java/run.cjs',
  external: ['vscode', '@vscode/test-electron'],
});
await build({
  ...shared,
  entryPoints: ['test-java/suite.ts'],
  outfile: 'dist-java/suite.cjs',
  external: ['vscode'],
});
