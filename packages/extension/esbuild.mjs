import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions[]} */
const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  minify: process.argv.includes('--production'),
  // keep the notices of bundled MIT/ISC/BSD packages next to the code
  legalComments: process.argv.includes('--production') ? 'linked' : 'none',
  logLevel: 'info',
};

/** The extension itself and the language server (started as a separate process by the client). */
const targets = [
  { ...shared, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs' },
  { ...shared, entryPoints: ['../language-server/src/server.ts'], outfile: 'dist/server.cjs' },
  { ...shared, entryPoints: ['../mcp-server/src/main.ts'], outfile: 'dist/mcp.cjs' },
];

if (watch) {
  for (const options of targets) await (await context(options)).watch();
} else {
  for (const options of targets) await build(options);
}
