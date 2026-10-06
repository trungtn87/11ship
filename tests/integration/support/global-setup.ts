import { assertTestTarget } from './assert-test-target';

// Defence in depth: even if Jest is started directly (not through npm), the target is verified
// before the first test runs. A failure aborts the whole run instead of skipping tests.
export default async function globalSetup(): Promise<void> {
  await assertTestTarget(process.env);
}
