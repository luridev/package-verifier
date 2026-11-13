import { fileURLToPath } from 'node:url';

export const packageFixture = fileURLToPath(new URL('./fixtures/package/', import.meta.url));
