import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.ts'], restoreMocks: true } },
      { test: { name: 'integration', include: ['tests/**/*.test.ts'], testTimeout: 120_000, fileParallelism: false } },
    ],
  },
});
