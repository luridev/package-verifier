import type { Message } from 'publint';

export type RunOptions = {
  cwd?: string;
  /** Overrides are applied to a copy of process.env; undefined removes a key. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to capture. Inherit streams directly; returned output is then empty. */
  output?: 'capture' | 'inherit';
  timeout?: number;
  maxBuffer?: number;
};

export type RunnerOptions = RunOptions & {
  /** Absolute path to npm-cli.js. Defaults to npm_execpath, then npm on PATH. */
  npmCli?: string;
  /** Strip NODE_PATH and NODE_OPTIONS after applying env overrides. Default: true. */
  cleanNodeEnvironment?: boolean;
};

export type RunResult = { stdout: string; stderr: string; status: number | null; signal: NodeJS.Signals | null };

export type Runner = {
  run: (command: string, args: ReadonlyArray<string>, options?: RunOptions) => RunResult;
  node: (args: ReadonlyArray<string>, options?: RunOptions) => RunResult;
  npm: (args: ReadonlyArray<string>, options?: RunOptions) => RunResult;
};

export type TemporaryDirectoryOptions = {
  /** Existing parent directory; only a newly created child is owned and removed. */
  parentDirectory?: string;
  prefix?: string;
  /** Retain on both success and failure. Callback receives the retained path. */
  keep?: boolean;
};

export type PackOptions = {
  cwd: string;
  /** Existing scratch directory; a unique empty child is created inside it. */
  destination: string;
  runner?: Runner;
};

export type PackedPackage = {
  path: string;
  filename: string;
  size: number;
  directory: string;
  npmVersion: string;
};

export type LintOptions = { strict?: boolean };
export type LintResult = { messages: Array<Message>; diagnostics: Array<string> };
