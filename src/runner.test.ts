import spawn from 'cross-spawn';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandError, createRunner } from './runner.ts';

describe('createRunner', () => {
  afterEach(() => vi.restoreAllMocks());

  it('captures stdout and stderr independently', () => {
    const result = createRunner().node(['-e', 'process.stdout.write("out"); process.stderr.write("err")']);
    expect(result).toStrictEqual({ stdout: 'out', stderr: 'err', status: 0, signal: null });
  });

  it('reports a real spawn error with command, arguments and cwd', () => {
    const run = () => createRunner().run('package-verifier-command-does-not-exist', ['an argument']);
    expect(run).toThrow(CommandError);
    expect(run).toThrow(/package-verifier-command-does-not-exist.*an argument[\s\S]*cwd:/);
  });

  it('preserves a nonzero exit code and captured diagnostics', () => {
    const run = () => createRunner().node(['-e', 'process.stderr.write("failure"); process.exitCode = 7']);

    expect(run).toThrow(expect.objectContaining({
      result: { stdout: '', stderr: 'failure', status: 7, signal: null },
    }));
  });

  it('rejects a signal even when the exit code is zero', () => {
    vi.spyOn(spawn, 'sync').mockReturnValue({ pid: 1, output: [], stdout: '', stderr: '', status: 0, signal: 'SIGTERM' });
    expect(() => createRunner().node(['ignored'])).toThrow(/signal: SIGTERM/);
  });

  it('preserves the spawn error as cause', () => {
    const cause = new Error('spawn failed');
    vi.spyOn(spawn, 'sync').mockReturnValue({ pid: 0, output: [], stdout: '', stderr: '', status: null, signal: null, error: cause });
    expect(() => createRunner().node([])).toThrow(expect.objectContaining({ cause }));
  });

  it('merges env overrides and cleans Node injection without changing process.env', () => {
    const before = { ...process.env };
    const runner = createRunner({ env: { NODE_OPTIONS: '--invalid-node-option', NODE_PATH: '/unsafe', VERIFY_A: 'one', VERIFY_B: 'old' } });

    const { stdout } = runner.node(['-e', 'console.log(JSON.stringify([process.env.NODE_PATH, process.env.NODE_OPTIONS, process.env.VERIFY_A, process.env.VERIFY_B, process.env.VERIFY_C]))'], {
      env: { VERIFY_B: 'two', VERIFY_C: 'three' },
    });

    expect(JSON.parse(stdout)).toStrictEqual([null, null, 'one', 'two', 'three']);
    expect({ ...process.env }).toStrictEqual(before);
  });

  it('allows retaining Node environment and removing an inherited key explicitly', () => {
    const runner = createRunner({ cleanNodeEnvironment: false, env: { NODE_OPTIONS: '--no-warnings', VERIFY_A: 'remove' } });
    const { stdout } = runner.node(['-e', 'console.log(JSON.stringify([process.env.NODE_OPTIONS, process.env.VERIFY_A]))'], { env: { VERIFY_A: undefined } });
    expect(JSON.parse(stdout)).toStrictEqual(['--no-warnings', null]);
  });

  it('passes arguments literally, including spaces and shell metacharacters', () => {
    const values = ['space here', 'a&b', '$(echo secret)', '"quoted"', 'кириллица'];
    const { stdout } = createRunner().node(['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', ...values]);
    expect(JSON.parse(stdout)).toStrictEqual(values);
  });

  it('uses the selected npm CLI through this Node executable', () => {
    const cli = `${process.cwd()}/npm cli.js`;
    const spy = vi.spyOn(spawn, 'sync').mockReturnValue({ pid: 1, output: [], stdout: '10.9.10', stderr: '', status: 0, signal: null });
    createRunner({ npmCli: cli }).npm(['--version']);
    expect(spy).toHaveBeenCalledWith(process.execPath, [cli, '--version'], expect.any(Object));
    expect(() => createRunner({ npmCli: './npm-cli.js' })).toThrow(/absolute path/);
  });
});
