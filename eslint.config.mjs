import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: ['**/dist/**', '.test-dist/**', '**/node_modules/**', 'coverage/**'],
  },
  {
    // Plain-JS web UI (apps/web). Browser globals are listed by hand so no extra package is needed.
    files: ['apps/web/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: Object.fromEntries(
        [
          'window', 'document', 'navigator', 'fetch', 'AbortController', 'URL', 'Headers',
          'crypto', 'console', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'FontFace',
          'HTMLElement', 'Event', 'CustomEvent', 'performance', 'queueMicrotask', 'structuredClone',
        ].map((name) => [name, 'readonly']),
      ),
    },
    rules: { 'no-unused-vars': 'error', 'no-undef': 'error' },
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
  },
]);
