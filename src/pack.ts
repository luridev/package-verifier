import { lstat, mkdtemp, readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRunner } from './runner.ts';
import { removeOwnedDirectory } from './temporary.ts';
import type { PackedPackage, PackOptions } from './types.ts';

export async function packPackage(options: PackOptions): Promise<PackedPackage> {
  const cwd = await realpath(options.cwd);
  const runner = options.runner ?? createRunner();
  const npmVersion = runner.npm(['--version'], { cwd, output: 'capture' }).stdout.trim();

  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(npmVersion) || Number(npmVersion.split('.')[0]) < 10) {
    throw new Error(`Unsupported npm version: ${npmVersion}; npm >=10 is required.`);
  }

  const manifest: unknown = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));

  if (Number(npmVersion.split('.')[0]) === 10 && typeof manifest === 'object' && manifest !== null
    && 'scripts' in manifest && typeof manifest.scripts === 'object' && manifest.scripts !== null
    && 'prepare' in manifest.scripts) {
    throw new Error(`npm ${npmVersion} may run prepare despite --ignore-scripts. Use npm >=11 or remove prepare before packing ${cwd}.`);
  }

  const parent = await realpath(options.destination);
  const directory = await realpath(await mkdtemp(join(parent, 'pack-')));

  try {
    runner.npm(['pack', '--ignore-scripts', '--workspaces=false', '--dry-run=false', '--pack-destination', directory], { cwd });

    if (await realpath(directory) !== directory || (await lstat(directory)).isSymbolicLink()) {
      throw new Error(`Unsafe pack directory: ${directory}`);
    }

    const archives = (await readdir(directory)).filter((name) => name.endsWith('.tgz'));

    if (archives.length !== 1) {
      throw new Error(`Expected exactly one .tgz in ${directory}; found ${archives.length}.`);
    }

    const filename = archives[0];

    if (filename === undefined) {
      throw new Error(`Missing tarball in ${directory}`);
    }

    const archive = join(directory, filename);
    const info = await lstat(archive);
    const path = await realpath(archive);

    if (!info.isFile() || info.isSymbolicLink() || dirname(path) !== directory) {
      throw new Error(`Unsafe tarball: ${archive}; expected a regular file inside ${directory}.`);
    }

    return { path, filename, size: info.size, directory, npmVersion };
  } catch (error) {
    try {
      await removeOwnedDirectory(directory);
    } catch (cleanupError) {
      // eslint-disable-next-line preserve-caught-error
      throw new AggregateError([error, cleanupError], `Packing and cleanup failed in ${directory}`, { cause: error });
    }

    throw error;
  }
}
