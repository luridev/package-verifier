import { createProtoConfig } from '@protoapps/eslint-config';
import globals from 'globals';

export default createProtoConfig(
  { tsconfigRootDir: import.meta.dirname, vitest: { files: ['**/*.test.ts'] } },
  { ignores: ['dist/**', 'coverage/**', '.local/**', '**/fixtures/**'] },
  { files: ['**/*.{ts,mjs}'], languageOptions: { globals: globals.node } },
  { files: ['**/*.ts'], rules: { '@typescript-eslint/no-restricted-imports': 'off' } },
);
