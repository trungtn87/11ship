#!/usr/bin/env node
// Writes the ChatGPT review result of one PR as a commit status on the PR's CURRENT head SHA. Used by
// the review-status job in .github/workflows/update-progress.yml.
//
// Environment only (never argv, never interpolated into a shell line):
//   PR_NUMBER          pull request number, taken from the GitHub event
//   EVENT_HEAD_SHA     head SHA recorded in the event (optional; a different current head means the
//                      label was given for an older head, so nothing is written)
//   GITHUB_REPOSITORY  owner/name
//   GITHUB_TOKEN       token with statuses: write
//   GITHUB_API_URL     optional
// Exit codes: 0 done (or a stale event, skipped), 1 error (the job fails and publish does not run).

import { syncReviewStatus } from './progress/review.mjs';

try {
  const result = await syncReviewStatus({
    repo: process.env.GITHUB_REPOSITORY,
    prNumber: process.env.PR_NUMBER,
    eventHeadSha: process.env.EVENT_HEAD_SHA,
    token: process.env.GITHUB_TOKEN,
    apiBase: process.env.GITHUB_API_URL || 'https://api.github.com',
  });
  const sha = String(result.sha).slice(0, 7);
  console.log(result.written ? `review status ${result.state} written on ${sha} for PR #${process.env.PR_NUMBER}` : `review status not written for PR #${process.env.PR_NUMBER} (${result.skipped}; head ${sha})`);
} catch (error) {
  // Messages are built from status codes and short API messages only; never from the token.
  console.error(`sync review status failed: ${error.message}`);
  process.exit(1);
}
