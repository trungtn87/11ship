import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: ['**/dist/**', '.test-dist/**', '**/node_modules/**', 'coverage/**', 'apps/admin-web/src/vendor/**', '.worktrees/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
  },
]);
