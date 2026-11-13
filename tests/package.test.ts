import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRunner, lintPackage, packPackage, withTemporaryDirectory } from '../src/index.ts';
import { packageFixture } from './config.ts';
import type { FixtureManifest, PackageLock } from './types.ts';

const runner = createRunner({
  ...(process.env.PACKAGE_VERIFIER_NPM_CLI === undefined ? {} : { npmCli: process.env.PACKAGE_VERIFIER_NPM_CLI }),
  timeout: 120_000,
});

const require = createRequire(import.meta.url);

async function copyFixture(directory: string): Promise<string> {
  const fixture = join(directory, 'fixture with spaces');
  await cp(packageFixture, fixture, { recursive: true });

  return fixture;
}

async function installConsumer(directory: string, archive: string): Promise<string> {
  const consumer = join(directory, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  runner.npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], { cwd: consumer });

  return consumer;
}

describe('real package contracts', () => {
  it('packs with a runner that inherits output by default', async () => {
    const streaming = createRunner({
      output: 'inherit',
      ...(process.env.PACKAGE_VERIFIER_NPM_CLI === undefined ? {} : { npmCli: process.env.PACKAGE_VERIFIER_NPM_CLI }),
    });

    await withTemporaryDirectory(async (directory) => {
      const cwd = await copyFixture(directory);
      const packed = await packPackage({ cwd, destination: directory, runner: streaming });
      expect(packed.npmVersion).toBe(runner.npm(['--version']).stdout.trim());
    });
  });

  it('packs, lints and installs real archives with isolated repeatable exports and dependencies', async () => {
    let temporary = '';

    await withTemporaryDirectory(async (directory) => {
      temporary = directory;
      const cwd = await copyFixture(directory);
      const first = await packPackage({ cwd, destination: directory, runner });
      const second = await packPackage({ cwd, destination: directory, runner });
      expect(first.path).not.toBe(second.path);
      expect(await readFile(first.path)).toStrictEqual(await readFile(second.path));
      const actualVersion = runner.npm(['--version']).stdout.trim();
      expect(first.npmVersion).toBe(actualVersion);
      expect(actualVersion).toBe(process.env.PACKAGE_VERIFIER_EXPECT_NPM ?? first.npmVersion);
      expect((await lintPackage(first.path)).messages.filter((message) => message.type === 'error')).toStrictEqual([]);
      const consumer = await installConsumer(directory, first.path);
      const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8')) as PackageLock;
      expect(Object.keys(lock.packages).some((path) => path.endsWith('node_modules/typescript'))).toBe(false);
      expect(Object.keys(lock.packages).some((path) => path.endsWith('node_modules/picocolors'))).toBe(true);
      runner.npm(['ls', '--all'], { cwd: consumer });

      await writeFile(join(consumer, 'runtime.mjs'), `
  import assert from 'node:assert/strict';
  import { describe } from 'verifier-contract-fixture';
  import { feature } from 'verifier-contract-fixture/feature';
  assert.equal(describe('hello'), 'hello');
  assert.equal(feature, 'public');
  assert.ok(import.meta.resolve('verifier-contract-fixture').startsWith(new URL('./node_modules/', import.meta.url).href));
  await assert.rejects(import('verifier-contract-fixture/package.json'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  `);

      expect(runner.node(['runtime.mjs'], { cwd: consumer }).status).toBe(0);
      await writeFile(join(consumer, 'contract.ts'), `import { describe } from 'verifier-contract-fixture';\nconst value: string = describe('hello');\n// @ts-expect-error -- Numbers are outside the public contract.\ndescribe(1);\n`);
      expect(runner.node([require.resolve('typescript/bin/tsc'), '--strict', '--module', 'NodeNext', '--noEmit', 'contract.ts'], { cwd: consumer }).status).toBe(0);
    });

    await expect(access(temporary)).rejects.toThrow(/ENOENT/);
  });

  it('detects a broken export in a real tarball and cleans after the rejection', async () => {
    let temporary = '';

    await expect(withTemporaryDirectory(async (directory) => {
      temporary = directory;
      const cwd = await copyFixture(directory);
      const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as FixtureManifest;
      manifest.exports['.'].default = './missing.js';
      await writeFile(join(cwd, 'package.json'), JSON.stringify(manifest));
      const packed = await packPackage({ cwd, destination: directory, runner });
      await lintPackage(packed.path);
    })).rejects.toThrow(/FILE_DOES_NOT_EXIST/);

    await expect(access(temporary)).rejects.toThrow(/ENOENT/);
  });

  it('detects wrong declarations through a real consumer compiler', async () => {
    await withTemporaryDirectory(async (directory) => {
      const cwd = await copyFixture(directory);
      await writeFile(join(cwd, 'index.d.ts'), 'export declare function describe(value: string): number;\n');
      const packed = await packPackage({ cwd, destination: directory, runner });
      await lintPackage(packed.path);
      const consumer = await installConsumer(directory, packed.path);
      await writeFile(join(consumer, 'contract.ts'), 'import { describe } from \'verifier-contract-fixture\';\nconst value: string = describe(\'hello\');\n');
      expect(() => runner.node([require.resolve('typescript/bin/tsc'), '--strict', '--module', 'NodeNext', '--noEmit', 'contract.ts'], { cwd: consumer })).toThrow(/TS2322/);
    });
  });

  it('detects warnings in strict mode while allowing suggestions and non-strict warnings', async () => {
    await withTemporaryDirectory(async (directory) => {
      const cwd = await copyFixture(directory);
      const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as FixtureManifest;

      await writeFile(join(cwd, 'package.json'), JSON.stringify({
        ...manifest, exports: { ...manifest.exports, './missing/*': './missing/*.js' },
      }));

      const packed = await packPackage({ cwd, destination: directory, runner });
      await expect(lintPackage(packed.path)).rejects.toThrow(/EXPORTS_GLOB_NO_MATCHED_FILES/);
      const result = await lintPackage(packed.path, { strict: false });
      expect(result.messages.some((message) => message.type === 'warning')).toBe(true);
    });
  });

  it('refuses npm 10 prepare and suppresses lifecycle scripts on npm 11/12', async () => {
    await withTemporaryDirectory(async (directory) => {
      const cwd = await copyFixture(directory);
      const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as FixtureManifest;
      manifest.scripts.prepare = 'node -e "throw new Error(\'prepare must never run\')"';
      await writeFile(join(cwd, 'package.json'), JSON.stringify(manifest));
      const version = runner.npm(['--version']).stdout.trim();

      const result = await packPackage({ cwd, destination: directory, runner })
        .then(() => 'packed', (error: unknown) => error instanceof Error && error.message.includes('may run prepare') ? 'refused-prepare' : error);

      expect(result).toBe(version.startsWith('10.') ? 'refused-prepare' : 'packed');
    });
  });

  it('rejects corrupt gzip data and removes the temporary archive', async () => {
    let path = '';

    await expect(withTemporaryDirectory(async (directory) => {
      path = directory;
      const archive = join(directory, 'broken.tgz');
      await writeFile(archive, 'this is not a gzip archive');
      await lintPackage(archive);
    })).rejects.toThrow(/Cannot lint tarball/);

    await expect(access(path)).rejects.toThrow(/ENOENT/);
  });
});
