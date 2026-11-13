import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { removalOptions } from './config.ts';
import type { TemporaryDirectoryOptions } from './types.ts';

export async function removeOwnedDirectory(directory: string): Promise<void> {
  const info = await lstat(directory).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  });

  if (info === undefined) {
    return;
  }

  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
    throw new Error(`Refusing to remove replaced temporary directory: ${directory}`);
  }

  await rm(directory, removalOptions);
}

export async function withTemporaryDirectory<T>(
  callback: (directory: string) => T | Promise<T>,
  options: TemporaryDirectoryOptions = {},
): Promise<T> {
  const prefix = options.prefix ?? 'package-verifier-';

  if (!/^[\w-]+$/.test(prefix)) {
    throw new Error('Temporary directory prefix must contain only letters, digits, underscores or hyphens.');
  }

  const parent = await realpath(options.parentDirectory ?? tmpdir());
  const directory = await realpath(await mkdtemp(join(parent, prefix)));

  if (dirname(directory) !== parent) {
    throw new Error(`Unsafe temporary directory: ${directory}`);
  }

  let result: T;

  try {
    result = await callback(directory);
  } catch (originalError) {
    if (options.keep !== true) {
      try {
        await removeOwnedDirectory(directory);
      } catch (cleanupError) {
        // eslint-disable-next-line preserve-caught-error
        throw new AggregateError([originalError, cleanupError], `Operation and cleanup failed in ${directory}`, { cause: originalError });
      }
    }

    throw originalError;
  }

  if (options.keep !== true) {
    await removeOwnedDirectory(directory);
  }

  return result;
}
