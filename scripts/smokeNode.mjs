import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [archiveArgument, npmCli, expectedNode, expectedNpm] = process.argv.slice(2);
assert.ok(archiveArgument && npmCli && expectedNode && expectedNpm,
  'Usage: node scripts/smokeNode.mjs <tarball> <absolute npm-cli.js> <expected Node version> <expected npm version>');
assert.ok(isAbsolute(npmCli));
assert.equal(process.versions.node, expectedNode);
const archive = await realpath(archiveArgument);
const parent = await realpath(tmpdir());
const consumer = await realpath(await mkdtemp(join(parent, 'package-verifier-node-')));
assert.equal(dirname(consumer), parent);
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !['NODE_PATH', 'NODE_OPTIONS', 'PATH'].includes(key.toUpperCase())));
environment.PATH = `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
environment.PACKAGE_VERIFIER_NPM_CLI = npmCli;
environment.PACKAGE_VERIFIER_EXPECT_NPM = expectedNpm;
const commands = [];

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: consumer, env: environment, encoding: 'utf8', windowsHide: true, timeout: 120_000,
  });
  commands.push({ args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, `${JSON.stringify(args)}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

let passed = false;
try {
  assert.equal(run([npmCli, '--version']).trim(), expectedNpm);
  await cp(new URL('./fixtures/self-consumer/', import.meta.url), consumer, { recursive: true });
  run([npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', archive]);
  const installed = await realpath(join(consumer, 'node_modules/@protoapps/package-verifier'));
  assert.ok(installed.startsWith(`${consumer}/`) || installed.startsWith(`${consumer}\\`));
  const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
  for (const name of ['@protoapps/eslint-config', 'eslint', 'vitest', 'lefthook', 'typescript']) {
    await assert.rejects(lstat(join(consumer, 'node_modules', name)), { code: 'ENOENT' });
  }
  assert.equal(lock.packages['node_modules/@protoapps/package-verifier'].version,
    JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')).version);
  process.stdout.write(run(['runtime.mjs']));
  run([npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--include=dev']);
  run(['node_modules/typescript/bin/tsc', '--noEmit']);
  passed = true;
  process.stdout.write(`Tarball runtime and declarations passed: Node ${expectedNode}, npm ${expectedNpm}\n`);
} finally {
  const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, `node-${expectedNode}-${process.platform}.json`), JSON.stringify({
    node: process.versions.node, npm: expectedNpm, archive, passed, commands,
  }, null, 2));
  assert.equal(await realpath(consumer), consumer);
  assert.equal((await lstat(consumer)).isSymbolicLink(), false);
  await rm(consumer, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
