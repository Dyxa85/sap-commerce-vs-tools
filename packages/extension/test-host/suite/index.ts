import { appendFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Mocha from 'mocha';

/** Test results go to a file: the extension host does not forward console output reliably. */
export function run(): Promise<void> {
  const report = process.env.SAPC_TEST_REPORT;
  const write = (line: string): void => {
    if (report) appendFileSync(report, `${line}\n`);
  };
  if (report) writeFileSync(report, '');

  const mocha = new Mocha({ ui: 'bdd', timeout: 30_000 });
  for (const file of readdirSync(__dirname).filter((f) => f.endsWith('.test.cjs'))) {
    mocha.addFile(join(__dirname, file));
  }
  return new Promise((resolve, reject) => {
    const runner = mocha.run((failures) =>
      failures > 0 ? reject(new Error(`${failures} test(s) failed`)) : resolve(),
    );
    runner.on('pass', (t) => write(`  ✔ ${t.fullTitle()}`));
    runner.on('pending', (t) => write(`  - ${t.fullTitle()} (skipped)`));
    runner.on('fail', (t, err) =>
      write(`  ✖ ${t.fullTitle()}\n      ${err.message.split('\n').join('\n      ')}`),
    );
    runner.on('end', () =>
      write(`\n${runner.stats?.passes} passing, ${runner.stats?.failures} failing`),
    );
  });
}
