// Binds ChatGPT review labels to the head SHA they were given for.
//
// A review label carries no SHA, so the binding is made by removing it: whenever the head of a PR
// changes (pull_request_target "synchronize"), every review:* label is removed. After that the
// resolver sees no review label, the task is WAITING_CHATGPT_REVIEW, and only a review that is
// labelled after the change can move it on. This runs in a trusted workflow that checks out the
// default branch, takes nothing but the PR number from the event, and holds the least write
// permission that can edit labels.

import { GitHubError, makeClient } from './github.mjs';
import { REVIEW_LABELS } from './constants.mjs';

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const PR_NUMBER_RE = /^[1-9]\d{0,8}$/;

export async function resetReviewLabels({ repo, prNumber, token, apiBase, fetchImpl }) {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) throw new Error('repository must look like "owner/name"');
  if (!PR_NUMBER_RE.test(String(prNumber))) throw new Error('PR number must be a positive integer');
  const call = makeClient({ token, apiBase, fetchImpl });
  const base = `/repos/${repo}/issues/${prNumber}`;

  // A failed read is an error, not "nothing to remove": the reset must never silently do nothing.
  const current = await call(`${base}/labels?per_page=100`);
  const present = new Set(current.map((l) => l.name));
  const removed = [];
  for (const label of REVIEW_LABELS) {
    if (!present.has(label)) continue;
    try {
      await call(`${base}/labels/${encodeURIComponent(label)}`, { method: 'DELETE' });
    } catch (error) {
      if (!(error instanceof GitHubError && error.status === 404)) throw error; // already gone is fine
    }
    removed.push(label);
  }
  return { removed };
}
