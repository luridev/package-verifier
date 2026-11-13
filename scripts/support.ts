import { readFile } from 'node:fs/promises';
import { createRunner } from '../src/index.ts';

export function getRunner() {
  return createRunner({
    ...(process.env.PACKAGE_VERIFIER_NPM_CLI === undefined ? {} : { npmCli: process.env.PACKAGE_VERIFIER_NPM_CLI }),
    timeout: 600_000,
  });
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
