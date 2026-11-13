import { CommandError, PackageLintError, createRunner, lintPackage, packPackage, withTemporaryDirectory } from '@protoapps/package-verifier';
import type { LintOptions, LintResult, PackedPackage, PackOptions, Runner, RunnerOptions, RunOptions, RunResult, TemporaryDirectoryOptions } from '@protoapps/package-verifier';

const options: RunnerOptions = { cleanNodeEnvironment: true, env: { TEST: 'value' } };
const runOptions: RunOptions = { cwd: '.', output: 'capture' };
const runner: Runner = createRunner(options);
export const result: RunResult = runner.node(['--version'], runOptions);
const temporary: TemporaryDirectoryOptions = { keep: false };
export const verified: Promise<LintResult> = withTemporaryDirectory(async (directory) => {
  const packOptions: PackOptions = { cwd: '.', destination: directory, runner };
  const packed: PackedPackage = await packPackage(packOptions);
  const lintOptions: LintOptions = { strict: true };
  return lintPackage(packed.path, lintOptions);
}, temporary);
export function errorCause(error: CommandError | PackageLintError): unknown { return error.cause; }
// @ts-expect-error -- Shell strings are not argument lists.
runner.npm('pack');
// @ts-expect-error -- A destination with explicit ownership is required.
packPackage({ cwd: '.' });
