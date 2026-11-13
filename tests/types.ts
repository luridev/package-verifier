export type FixtureManifest = {
  name: string;
  exports: { '.': { types: string; default: string }; './feature': string };
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};

export type PackageLock = { packages: Record<string, unknown> };
