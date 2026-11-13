import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publint } from 'publint';
import { describe, expect, it, vi } from 'vitest';
import { lintPackage, PackageLintError } from './lint.ts';
import { withTemporaryDirectory } from './temporary.ts';

vi.mock(import('publint'), () => ({ publint: vi.fn() }));

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const original = await importOriginal();

  return { ...original, readFile: vi.fn(original.readFile) as typeof original.readFile };
});

describe('lint', () => {
  it('passes only the visible tarball bytes and strict mode to publint', async () => {
    vi.mocked(publint).mockResolvedValueOnce({ messages: [], pkg: {} });

    await withTemporaryDirectory(async (directory) => {
      const archive = join(directory, 'tiny.tgz');
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([99, 1, 2, 3, 99]).subarray(1, 4));
      await lintPackage(archive);
      expect(publint).toHaveBeenLastCalledWith({ strict: true, pack: { tarball: Uint8Array.from([1, 2, 3]).buffer } });
    });
  });

  it('throws formatted errors even though the API promise resolves', async () => {
    vi.mocked(publint).mockResolvedValueOnce({ messages: [{ code: 'FILE_DOES_NOT_EXIST', path: ['main'], args: {}, type: 'error' }], pkg: { main: './missing.js' } });

    await withTemporaryDirectory(async (directory) => {
      const archive = join(directory, 'pkg.tgz');
      await writeFile(archive, 'placeholder');
      await expect(lintPackage(archive)).rejects.toThrow(PackageLintError);
    });
  });

  it('returns suggestions and non-strict warnings without failing', async () => {
    vi.mocked(publint).mockResolvedValueOnce({ messages: [
      { code: 'USE_TYPE', path: [], args: {}, type: 'suggestion' },
      { code: 'FILE_DOES_NOT_EXIST', path: ['main'], args: {}, type: 'warning' },
    ],
    pkg: { main: './missing.js' } });

    await withTemporaryDirectory(async (directory) => {
      const archive = join(directory, 'pkg.tgz');
      await writeFile(archive, 'placeholder');
      const result = await lintPackage(archive, { strict: false });
      expect(result.diagnostics).toStrictEqual([expect.stringContaining('[suggestion] USE_TYPE'), expect.stringContaining('[warning] FILE_DOES_NOT_EXIST')]);
      expect(vi.mocked(publint).mock.lastCall?.[0]?.strict).toBe(false);
    });
  });

  it('preserves the underlying failure and identifies the archive', async () => {
    const cause = new Error('corrupted archive');
    vi.mocked(publint).mockRejectedValueOnce(cause);

    await withTemporaryDirectory(async (directory) => {
      const archive = join(directory, 'bad.tgz');
      await writeFile(archive, 'bad');
      await expect(lintPackage(archive)).rejects.toMatchObject({ cause, message: `Cannot lint tarball ${archive}` });
      await expect(lintPackage(join(directory, 'missing.tgz'))).rejects.toThrow(/Cannot lint tarball/);
    });
  });
});
