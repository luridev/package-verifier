export type PackageManifest = {
  name: string;
  version: string;
  exports: Record<string, { types: string; default: string }>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

export type PackageLock = { packages: Record<string, unknown> };
export type CheckResult = { name: string; passed: boolean; durationMs: number; log: string };
