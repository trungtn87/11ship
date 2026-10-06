import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: ['**/dist/**', '.test-dist/**', '**/node_modules/**', 'coverage/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
  },
]);
