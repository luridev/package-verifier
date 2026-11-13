import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as api from '@protoapps/package-verifier';

assert.deepStrictEqual(Object.keys(api).sort(), ['CommandError', 'PackageLintError', 'createRunner', 'lintPackage', 'packPackage', 'withTemporaryDirectory'].sort());
const resolved = pathToFileURL(createRequire(import.meta.url).resolve('@protoapps/package-verifier')).href;
assert.ok(resolved.startsWith(new URL('./node_modules/', import.meta.url).href));
const runner = api.createRunner({ npmCli: process.env.PACKAGE_VERIFIER_NPM_CLI ?? process.env.npm_execpath });
const version = runner.npm(['--version']).stdout.trim();
if (process.env.PACKAGE_VERIFIER_EXPECT_NPM) assert.equal(version, process.env.PACKAGE_VERIFIER_EXPECT_NPM);
assert.equal(runner.node(['-e', 'process.stdout.write("installed")']).stdout, 'installed');
await api.withTemporaryDirectory(async (directory) => {
  const fixture = join(directory, 'package');
  await mkdir(fixture);
  await writeFile(join(fixture, 'package.json'), JSON.stringify({
    name: 'self-verification-fixture', version: '1.0.0', type: 'module', license: 'MIT',
    exports: './index.js', files: ['index.js'], engines: { node: '>=20' }, sideEffects: false,
  }));
  await writeFile(join(fixture, 'index.js'), 'export const value = 42;\n');
  const packed = await api.packPackage({ cwd: fixture, destination: directory, runner });
  assert.equal(packed.npmVersion, version);
  const result = await api.lintPackage(packed.path);
  assert.equal(result.messages.some((message) => message.type === 'error'), false);
});
console.log(`Installed API and real pack/lint verified: npm ${version}`);
