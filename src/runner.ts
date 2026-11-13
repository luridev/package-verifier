import { isAbsolute, resolve } from 'node:path';
import spawn from 'cross-spawn';
import { defaultMaxBuffer, defaultTimeout } from './config.ts';
import type { SpawnSyncReturns } from 'node:child_process';
import type { Runner, RunnerOptions, RunOptions, RunResult } from './types.ts';

export class CommandError extends Error {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly result: RunResult;

  constructor(command: string, args: ReadonlyArray<string>, cwd: string, result: RunResult, cause?: Error) {
    super(`Command failed: ${JSON.stringify([command, ...args])}\ncwd: ${cwd}\nexit: ${String(result.status)}, signal: ${String(result.signal)}${cause !== undefined ? `\n${cause.message}` : ''}\n${result.stdout}${result.stderr}`, { cause });
    this.name = 'CommandError';
    this.command = command;
    this.args = [...args];
    this.cwd = cwd;
    this.result = result;
  }
}

export function createRunner(options: RunnerOptions = {}): Runner {
  const npmCli = options.npmCli ?? process.env.npm_execpath;

  if (npmCli !== undefined && !isAbsolute(npmCli)) {
    throw new Error('npmCli must be an absolute path to npm-cli.js.');
  }

  function run(command: string, args: ReadonlyArray<string>, overrides: RunOptions = {}): RunResult {
    const settings = { ...options, ...overrides };
    const cwd = resolve(settings.cwd ?? process.cwd());
    const env: NodeJS.ProcessEnv = {};

    for (const source of [process.env, options.env, overrides.env]) {
      for (const [key, value] of Object.entries(source ?? {})) {
        if (options.cleanNodeEnvironment !== false && ['NODE_PATH', 'NODE_OPTIONS'].includes(key.toUpperCase())) {
          continue;
        }

        env[process.platform === 'win32' ? key.toUpperCase() : key] = value;
      }
    }

    const result: SpawnSyncReturns<string | null> = spawn.sync(command, [...args], {
      cwd,
      env,
      encoding: 'utf8',
      windowsHide: true,
      stdio: settings.output === 'inherit' ? 'inherit' : 'pipe',
      maxBuffer: settings.maxBuffer ?? defaultMaxBuffer,
      timeout: settings.timeout ?? defaultTimeout,
    });

    const output: RunResult = {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
      signal: result.signal,
    };

    if (result.error != null || result.status !== 0 || result.signal !== null) {
      throw new CommandError(command, args, cwd, output, result.error ?? undefined);
    }

    return output;
  }

  return {
    run,
    node: (args, settings) => run(process.execPath, args, settings),
    npm: (args, settings) => npmCli === undefined
      ? run('npm', args, settings)
      : run(process.execPath, [npmCli, ...args], settings),
  };
}
