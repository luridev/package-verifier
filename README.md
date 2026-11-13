# @protoapps/package-verifier

Composable helpers for verifying already-built npm packages with temporary directories, command execution and publint.

```sh
npm install -D @protoapps/package-verifier
```

ESM-only. Requires Node.js >=20.0.0 and a compatible npm >=10 compatible with your Node version; npm 12 does not support Node 20.
TypeScript consumers need `@types/node`. All option and result types are exported from the package root.

## Usage

```js
import {
  createRunner, packPackage, lintPackage, withTemporaryDirectory,
} from '@protoapps/package-verifier';

const runner = createRunner({ cwd: process.cwd() });

await withTemporaryDirectory(async (directory) => {
  const archive = await packPackage({
    cwd: process.cwd(), destination: directory, runner,
  });
  const { diagnostics } = await lintPackage(archive.path);
  for (const diagnostic of diagnostics) console.log(diagnostic);
});
```

Save as `scripts/verifyPackage.mjs` and run after building: `npm run build && node scripts/verifyPackage.mjs`.

## API

### `createRunner(options?)`

Returns synchronous `npm(args, options?)`, `node(args, options?)` and `run(command, args, options?)` methods. Pass arguments as arrays. Results contain `stdout`, `stderr`, `status` and `signal`; failed commands throw `CommandError` with execution details and captured output.

Options include `cwd`, `env`, `output` (`capture` by default or `inherit`), `timeout` (120,000 ms) and `maxBuffer` (16 MiB per stream). Per-call options override defaults; `inherit` streams output and returns empty output strings.

`npmCli` selects an absolute path to `npm-cli.js`; otherwise npm is selected from `npm_execpath`, then PATH. It affects `runner.npm` only; nested npm commands still use PATH. `NODE_PATH` and `NODE_OPTIONS` are removed unless `cleanNodeEnvironment: false` is set.

### `packPackage({ cwd, destination, runner? })`

Creates a real tarball for one built package, without running lifecycle scripts or rebuilding. `destination` must already exist. Returns `{ path, filename, size, directory, npmVersion }`; `size` is compressed bytes. The caller owns the resulting directory and archive.

**With npm 10, `packPackage` rejects any `scripts.prepare` field**, since npm 10 may run prepare despite `--ignore-scripts`. Use a compatible npm 11/12 version for such packages.

### `lintPackage(archivePath, { strict = true }?)`

Checks the existing tarball with publint and returns `{ messages, diagnostics }`. Strict mode treats warnings as errors; `strict: false` allows warnings, while suggestions never fail. Error diagnostics throw `PackageLintError` with the full result in `.result`.

### `withTemporaryDirectory(callback, options?)`

Creates a temporary directory, returns the callback's result and removes the directory on success or failure. Options: `parentDirectory` (existing directory; defaults to OS temp), `prefix` (letters, digits, underscores and hyphens), and `keep` (default false). `keep: true` retains files even on failure.

Cleanup failures propagate. If both the callback and cleanup fail, an `AggregateError` preserves both errors.

## Limitations

- Build, installation and consumer runtime/type assertions belong to the caller; publint alone does not verify those contracts.
- The runner blocks the calling thread. Timeouts cover the direct child process, not its entire descendant tree.
- These helpers execute local commands and manage temporary files; they do not provide a sandbox or a CLI.
