#!/usr/bin/env node
// Removes the review:* labels from one PR because its head changed. Used by the reset-review job
// in .github/workflows/update-progress.yml.
//
// Environment only (never argv, never interpolated into a shell line):
//   PR_NUMBER          pull request number, taken from the GitHub event
//   GITHUB_REPOSITORY  owner/name
//   GITHUB_TOKEN       token that may edit labels
//   GITHUB_API_URL     optional
// Exit codes: 0 done, 1 error (the job fails and the publish job does not run).

import { resetReviewLabels } from './progress/review.mjs';

try {
  const { removed } = await resetReviewLabels({
    repo: process.env.GITHUB_REPOSITORY,
    prNumber: process.env.PR_NUMBER,
    token: process.env.GITHUB_TOKEN,
    apiBase: process.env.GITHUB_API_URL || 'https://api.github.com',
  });
  console.log(removed.length ? `removed ${removed.join(', ')} from PR #${process.env.PR_NUMBER}` : `no review labels on PR #${process.env.PR_NUMBER}`);
} catch (error) {
  // Messages are built from status codes and short API messages only; never from the token.
  console.error(`reset review labels failed: ${error.message}`);
  process.exit(1);
}
