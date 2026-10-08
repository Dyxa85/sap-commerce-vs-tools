// Writes THIRD-PARTY-NOTICES.txt for the production dependencies of the workspace (name, version, license, license text).
// Usage: node tools/release/third-party-notices.mjs <output file>
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('output file missing');

const json = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  }),
);
const packages = Object.entries(json)
  .flatMap(([license, list]) => list.map((p) => ({ ...p, license })))
  .filter((p) => !p.name.startsWith('@sapcommerce-vstools/'))
  .sort((a, b) => a.name.localeCompare(b.name));

const licenseFile = (dir) => {
  if (!existsSync(dir)) return undefined;
  const name = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f));
  return name ? readFileSync(join(dir, name), 'utf8').trim() : undefined;
};

const parts = [
  'This product bundles the following third-party software. Each is distributed under its own license.\n',
];
for (const p of packages) {
  const text = p.paths.map(licenseFile).find(Boolean);
  parts.push(
    `${'='.repeat(78)}\n${p.name} ${p.versions.join(', ')} – ${p.license}${p.homepage ? `\n${p.homepage}` : ''}\n\n${text ?? '(license text not found in the package; see the license identifier above)'}\n`,
  );
}
writeFileSync(out, parts.join('\n'));
console.log(`${packages.length} packages -> ${out}`);
