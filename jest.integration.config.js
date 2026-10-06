'use strict';

// Integration tests need a real PostgreSQL. They are never skipped when the database is missing:
// global-setup verifies APP_ENV=test and the real database/user before any test (or DDL) runs.
// forceExit and passWithNoTests are intentionally NOT set.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/.test-dist/tests/integration'],
  testMatch: ['**/*.spec.js'],
  testEnvironment: 'node',
  globalSetup: '<rootDir>/.test-dist/tests/integration/support/global-setup.js',
  testTimeout: 60000,
  maxWorkers: 1,
};
