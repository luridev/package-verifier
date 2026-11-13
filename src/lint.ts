import { readFile } from 'node:fs/promises';
import { publint } from 'publint';
import { formatMessage } from 'publint/utils';
import type { LintOptions, LintResult } from './types.ts';

export class PackageLintError extends Error {
  readonly result: LintResult;

  constructor(archive: string, result: LintResult) {
    super(`Package lint failed: ${archive}\n${result.diagnostics.join('\n')}`);
    this.name = 'PackageLintError';
    this.result = result;
  }
}

export async function lintPackage(archive: string, options: LintOptions = {}): Promise<LintResult> {
  let lint;

  try {
    const buffer = await readFile(archive);
    const tarball = Uint8Array.from(buffer).buffer;
    lint = await publint({ pack: { tarball }, strict: options.strict ?? true });
  } catch (cause) {
    throw new Error(`Cannot lint tarball ${archive}`, { cause });
  }

  const result: LintResult = {
    messages: lint.messages,
    diagnostics: lint.messages.map((message) => `[${message.type}] ${message.code}: ${formatMessage(message, lint.pkg, { color: false }) ?? message.code}`),
  };

  if (result.messages.some((message) => message.type === 'error')) {
    throw new PackageLintError(archive, result);
  }

  return result;
}
