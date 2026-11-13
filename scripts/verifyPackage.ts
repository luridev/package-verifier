import assert from 'node:assert/strict';
import { cp, mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { lintPackage, packPackage, withTemporaryDirectory } from '../src/index.ts';
import { artifactsDirectory, installArgs, root } from './config.ts';
import { getRunner, readJson } from './support.ts';
import type { PackageLock, PackageManifest } from './types.ts';

const runner = getRunner();
const require = createRequire(import.meta.url);
const manifest = await readJson<PackageManifest>(join(root, 'package.json'));
const typescript = await readJson<PackageManifest>(require.resolve('typescript/package.json'));
const nodeTypes = await readJson<PackageManifest>(require.resolve('@types/node/package.json'));

await withTemporaryDirectory(async (directory) => {
  const packed = await packPackage({ cwd: root, destination: directory, runner });
  await lintPackage(packed.path);
  const consumer = join(directory, 'independent-consumer');
  await cp(join(root, 'scripts/fixtures/self-consumer'), consumer, { recursive: true });
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  runner.npm([...installArgs, packed.path], { cwd: consumer });
  const installed = await realpath(join(consumer, 'node_modules', manifest.name));
  assert.ok(installed.startsWith(`${consumer}${sep}`));
  const installedManifest = await readJson<PackageManifest>(join(installed, 'package.json'));
  assert.deepStrictEqual(installedManifest.exports, manifest.exports);
  assert.deepStrictEqual(installedManifest.dependencies, manifest.dependencies);
  assert.deepStrictEqual((await readdir(installed)).sort(), ['LICENSE', 'README.md', 'dist', 'package.json'].sort());

  assert.ok((await readdir(join(installed, 'dist'))).every((file) =>
    (file.endsWith('.js') || file.endsWith('.d.ts')) && !/\.(test|spec|config)\./.test(file)));

  const lock = await readJson<PackageLock>(join(consumer, 'package-lock.json'));

  for (const name of Object.keys(manifest.devDependencies)) {
    assert.ok(!Object.keys(lock.packages).some((path) => path.endsWith(`node_modules/${name}`)), `Unexpected devDependency: ${name}`);
  }

  runner.npm(['ls', '--all'], { cwd: consumer });
  const runtime = runner.node(['runtime.mjs'], { cwd: consumer });
  process.stdout.write(runtime.stdout);
  runner.npm([...installArgs, `typescript@${typescript.version}`, `@types/node@${nodeTypes.version}`], { cwd: consumer });
  runner.node(['node_modules/typescript/bin/tsc', '--noEmit'], { cwd: consumer });
  await mkdir(artifactsDirectory, { recursive: true });
  await cp(packed.path, join(artifactsDirectory, packed.filename));

  await writeFile(join(artifactsDirectory, `package-${process.platform}.json`), JSON.stringify({
    node: process.version,
    npm: packed.npmVersion,
    filename: packed.filename,
    size: packed.size,
    files: (await readdir(installed, { recursive: true })).sort(),
    runtime: runtime.stdout,
    declarations: 'passed',
  }, null, 2));

  process.stdout.write(`Self tarball verified with npm ${packed.npmVersion}: ${packed.filename}\n`);
});
