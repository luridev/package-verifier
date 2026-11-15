import assert from 'node:assert/strict';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { CommandError, createRunner, withTemporaryDirectory } from '../src/index.ts';
import { artifactsDirectory, installArgs, npmVersions, root } from './config.ts';
import { getRunner } from './support.ts';
import type { CheckResult } from './types.ts';

const bootstrap = getRunner();
const requested = process.argv[2];
const versions = requested === undefined ? npmVersions : [requested];
assert.ok(versions.every((version) => npmVersions.includes(version)), 'Choose a supported matrix version');
const results: Array<CheckResult> = [];
await mkdir(artifactsDirectory, { recursive: true });

for (const version of versions) {
  await withTemporaryDirectory(async (directory) => {
    process.stdout.write(`Installing isolated npm ${version}\n`);
    await writeFile(join(directory, 'package.json'), '{"private":true}');
    bootstrap.npm([...installArgs, '--prefix', directory, `npm@${version}`]);
    const npmCli = await realpath(join(directory, 'node_modules/npm/bin/npm-cli.js'));

    const runner = createRunner({
      npmCli,
      cwd: root,
      timeout: 900_000,
      env: {
        PATH: `${join(directory, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
        PACKAGE_VERIFIER_NPM_CLI: npmCli,
        PACKAGE_VERIFIER_EXPECT_NPM: version,
      },
    });

    assert.equal(runner.npm(['--version']).stdout.trim(), version);
    assert.equal(runner.run('npm', ['--version']).stdout.trim(), version, 'Nested npm on PATH must match the selected CLI');

    for (const script of ['test:unit', 'test:integration', 'test:package']) {
      const name = `${process.platform}-npm-${version}-${script}`;
      process.stdout.write(`Running ${name}\n`);
      const started = performance.now();
      let log: string;
      let passed: boolean;

      try {
        const result = runner.npm(['run', script]);
        log = result.stdout + result.stderr;
        passed = true;
      } catch (error) {
        if (!(error instanceof CommandError)) {
          throw error;
        }

        log = error.message;
        passed = false;
      }

      results.push({ name, passed, durationMs: Math.round(performance.now() - started), log });
      process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}\n${passed ? '' : log}\n`);
      await writeFile(join(artifactsDirectory, `matrix-${process.platform}.json`), JSON.stringify({ node: process.version, results }, null, 2));
    }
  }, { prefix: 'package-verifier-npm-' });
}

assert.ok(results.every((result) => result.passed), 'The compatibility matrix has failed checks; see artifacts/matrix-*.json');
