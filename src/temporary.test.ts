import { access, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { withTemporaryDirectory } from './temporary.ts';

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const original = await importOriginal();

  return { ...original, rm: vi.fn(original.rm) };
});

describe('temporary', () => {
  it('returns callback values and removes its files on success', async () => {
    let path = '';

    const result = await withTemporaryDirectory(async (directory) => {
      path = directory;
      await writeFile(join(directory, 'file'), 'content');

      return 42;
    });

    expect(result).toBe(42);
    await expect(access(path)).rejects.toThrow(/ENOENT/);
  });

  it('cleans up and preserves the exact callback error', async () => {
    const original = new Error('original');
    let path = '';

    await expect(withTemporaryDirectory((directory) => {
      path = directory;
      throw original;
    })).rejects.toBe(original);

    await expect(access(path)).rejects.toThrow(/ENOENT/);
  });

  it('preserves both errors when callback and cleanup fail', async () => {
    const original = new Error('original');
    const cleanup = new Error('locked');
    let path = '';
    vi.mocked(rm).mockRejectedValueOnce(cleanup);

    try {
      await expect(withTemporaryDirectory((directory) => {
        path = directory;
        throw original;
      })).rejects.toMatchObject({
        cause: original, errors: [original, cleanup],
      });
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });

  it('surfaces cleanup failure after successful work and requests lock retries', async () => {
    const cleanup = new Error('locked');
    let path = '';
    vi.mocked(rm).mockRejectedValueOnce(cleanup);

    try {
      await expect(withTemporaryDirectory((directory) => {
        path = directory;
      })).rejects.toBe(cleanup);

      const options = vi.mocked(rm).mock.lastCall?.[1];
      expect(options?.maxRetries).toBeGreaterThan(0);
      expect(options?.retryDelay).toBeGreaterThan(0);
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });

  it('retains files on error only when explicitly requested', async () => {
    await withTemporaryDirectory(async (parentDirectory) => {
      let path = '';

      await expect(withTemporaryDirectory(async (directory) => {
        path = directory;
        await writeFile(join(directory, 'debug'), 'retained');
        throw new Error('failure');
      }, { parentDirectory, keep: true })).rejects.toThrow('failure');

      expect(await readFile(join(path, 'debug'), 'utf8')).toBe('retained');
    });
  });

  it('rejects traversal, absolute and Windows prefixes', async () => {
    for (const prefix of ['../outside', '/absolute', 'C:\\outside', '..\\outside', '']) {
      await expect(withTemporaryDirectory(() => undefined, { prefix })).rejects.toThrow(/prefix/);
    }
  });

  it('never follows a replacement junction to delete a user directory', async () => {
    await withTemporaryDirectory(async (parentDirectory) => {
      const outside = join(parentDirectory, 'user-data');
      await mkdir(outside);
      await writeFile(join(outside, 'keep'), 'safe');
      let replaced = '';

      await expect(withTemporaryDirectory(async (directory) => {
        replaced = directory;
        await rm(directory, { recursive: true });
        await symlink(outside, directory, 'junction');
      }, { parentDirectory })).rejects.toThrow(/Refusing to remove/);

      expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('safe');
      await rm(replaced);
    });
  });
});
