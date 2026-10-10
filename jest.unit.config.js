'use strict';

// Unit tests run on JavaScript compiled by `tsc -p tsconfig.test.json` into .test-dist.
// passWithNoTests is intentionally NOT set: an empty run must fail.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/.test-dist/apps/backend/src', '<rootDir>/.test-dist/apps/admin-web/src'],
  testMatch: ['**/*.spec.js'],
  testEnvironment: 'node',
  clearMocks: true,
};
