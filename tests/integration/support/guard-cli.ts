import { assertTestTarget, TestTargetError } from './assert-test-target';

// Runs before Jest in `npm run test:integration`. It only issues a SELECT, so a wrong target
// fails here before any DDL, migration or test touches a database.
async function main(): Promise<void> {
  try {
    await assertTestTarget(process.env);
    process.stdout.write('Test target guard: OK (APP_ENV=test; database and user verified).\n');
  } catch (error) {
    const message =
      error instanceof TestTargetError
        ? error.message
        : 'Unexpected error while verifying the test target.';
    process.stderr.write(`TEST_TARGET_GUARD_FAILED: ${message}\n`);
    process.exitCode = 1;
  }
}

void main();
