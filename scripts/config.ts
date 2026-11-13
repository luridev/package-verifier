import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const artifactsDirectory = join(root, '.local/artifacts');
export const npmVersions = ['10.9.10', '11.21.2', '12.2.2'];
export const installArgs = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--include=dev'];
