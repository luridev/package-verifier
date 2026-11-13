import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { packPackage } from './pack.ts';
import { withTemporaryDirectory } from './temporary.ts';
import type { Runner } from './types.ts';

function fakeRunner(pack: (directory: string) => void, version = '12.2.2'): Runner {
  const npm: Runner['npm'] = (args) => {
    if (args[0] === '--version') {
      return { stdout: version, stderr: '', status: 0, signal: null };
    }

    const directory = args[args.indexOf('--pack-destination') + 1];

    if (directory === undefined) {
      throw new Error('Pack destination missing from command');
    }

    pack(directory);

    return { stdout: 'arbitrary npm output, not JSON', stderr: '', status: 0, signal: null };
  };

  return { npm: vi.fn(npm), node: vi.fn(), run: vi.fn() };
}

describe('pack', () => {
  it('preserves a failed npm invocation and removes its output directory', async () => {
    await withTemporaryDirectory(async (cwd) => {
      await writeFile(join(cwd, 'package.json'), '{}');
      const original = new Error('npm pack failed');

      const runner = fakeRunner(() => {
        throw original;
      });

      await expect(packPackage({ cwd, destination: cwd, runner })).rejects.toBe(original);
      expect(await readdir(cwd)).toStrictEqual(['package.json']);
    });
  });

  it('ignores stdout and finds a regular archive in a fresh directory', async () => {
    await withTemporaryDirectory(async (cwd) => {
      await writeFile(join(cwd, 'package.json'), '{}');
      await writeFile(join(cwd, 'unrelated.tgz'), 'unrelated');

      const runner = fakeRunner((directory) => {
        writeFileSync(join(directory, 'actual.tgz'), 'abc');
      });

      const result = await packPackage({ cwd, destination: cwd, runner });
      expect(result.filename).toBe('actual.tgz');
      expect(result.size).toBe(3);
      expect(result.directory).not.toBe(cwd);
      expect(runner.npm).toHaveBeenLastCalledWith(expect.arrayContaining(['--ignore-scripts']), { cwd });
    });
  });

  it.each([0, 2])('rejects %i archives and cleans the failed output directory', async (count) => {
    await withTemporaryDirectory(async (cwd) => {
      await writeFile(join(cwd, 'package.json'), '{}');

      const runner = fakeRunner((directory) => {
        for (let index = 0; index < count; index += 1) {
          writeFileSync(join(directory, `${index}.tgz`), 'x');
        }
      });

      await expect(packPackage({ cwd, destination: cwd, runner })).rejects.toThrow(`found ${count}`);
      expect(await readdir(cwd)).toStrictEqual(['package.json']);
    });
  });

  it('rejects a directory with a tarball extension', async () => {
    await withTemporaryDirectory(async (cwd) => {
      await writeFile(join(cwd, 'package.json'), '{}');

      await expect(packPackage({ cwd,
        destination: cwd,
        runner: fakeRunner((directory) => {
          mkdirSync(join(directory, 'fake.tgz'));
        }) })).rejects.toThrow(/Unsafe tarball/);
    });
  });

  it('rejects a junction escaping the pack directory without removing its target', async () => {
    await withTemporaryDirectory(async (cwd) => {
      await writeFile(join(cwd, 'package.json'), '{}');
      const outside = join(cwd, 'outside');
      await mkdir(outside);
      await writeFile(join(outside, 'keep'), 'safe');
      const { symlinkSync } = await import('node:fs');

      const runner = fakeRunner((directory) => {
        symlinkSync(outside, join(directory, 'escape.tgz'), 'junction');
      });

      await expect(packPackage({ cwd, destination: cwd, runner })).rejects.toThrow(/Unsafe tarball/);
      expect(await readdir(outside)).toStrictEqual(['keep']);
    });
  });

  it.skipIf(process.platform === 'win32')('rejects regular-file symlinks on Linux', async () => {
    await withTemporaryDirectory(async (cwd) => {
      await writeFile(join(cwd, 'package.json'), '{}');
      const outside = join(cwd, 'outside.tgz');
      await writeFile(outside, 'x');
      const link = join(cwd, 'link');
      await symlink(outside, link);
      const { symlinkSync } = await import('node:fs');

      await expect(packPackage({ cwd,
        destination: cwd,
        runner: fakeRunner((directory) => {
          symlinkSync(outside, join(directory, 'escape.tgz'));
        }) })).rejects.toThrow(/Unsafe tarball/);
    });
  });

  it('refuses npm 10 prepare before packing, while accepting npm 10 without prepare', async () => {
    await withTemporaryDirectory(async (cwd) => {
      const runner = fakeRunner((directory) => {
        writeFileSync(join(directory, 'ok.tgz'), 'x');
      }, '10.9.10');

      await writeFile(join(cwd, 'package.json'), JSON.stringify({ scripts: { prepare: 'node build.js' } }));
      await expect(packPackage({ cwd, destination: cwd, runner })).rejects.toThrow(/prepare despite --ignore-scripts/);
      expect(runner.npm).toHaveBeenCalledOnce();
      await writeFile(join(cwd, 'package.json'), '{}');
      expect((await packPackage({ cwd, destination: cwd, runner })).npmVersion).toBe('10.9.10');
    });
  });
});
