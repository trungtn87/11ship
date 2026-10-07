// Trusted helpers for ChatGPT review results. Both run in workflows that check out the default
// branch only, take nothing but a PR number (and an event SHA) from the event, and never run PR code.
//
//   syncReviewStatus   the CORRECTNESS ROOT. Turns the review:* label on a PR into a commit status
//                      (context 11ship/chatgpt-review) on the PR's CURRENT head SHA, read from the
//                      API at that moment. A status exists on one SHA only, so a result given for
//                      head A can never become a result for head B, whatever order the workflows run
//                      in. The resolver accepts a label only when that status backs it.
//   resetReviewLabels  UI cleanup and defense in depth. When the head changes it removes every
//                      review:* label. Correctness does not depend on it: even if it has not run
//                      yet, the exact-SHA status binding already rejects the old label.

import { GitHubError, makeClient } from './github.mjs';
import { REVIEW_CONTEXT, REVIEW_LABELS } from './constants.mjs';
import { expectedReviewStatus } from './review-binding.mjs';

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const PR_NUMBER_RE = /^[1-9]\d{0,8}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

/** How many times the writer re-reads the PR after writing, to catch a change made in between. */
const SYNC_ATTEMPTS = 3;

function checkRepoAndNumber(repo, prNumber) {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) throw new Error('repository must look like "owner/name"');
  if (!PR_NUMBER_RE.test(String(prNumber))) throw new Error('PR number must be a positive integer');
}

/**
 * Writes the review status for the current head of one PR.
 *
 * Reads the PR once, so the head SHA and the labels come from the same moment, then posts the status
 * on exactly that SHA. `eventHeadSha` is the head SHA GitHub put in the label event. When the head
 * has moved on since, the label was given for an older head: nothing is written, and the new head
 * has no review status (so it waits for a review). After writing, the PR is read again and the write
 * is repeated if the head or the labels changed meanwhile; if it does not settle, this throws.
 * Any API error throws too (fail closed: the job fails and publish does not run).
 */
export async function syncReviewStatus({ repo, prNumber, eventHeadSha, token, apiBase, fetchImpl }) {
  checkRepoAndNumber(repo, prNumber);
  if (eventHeadSha != null && eventHeadSha !== '' && !SHA_RE.test(String(eventHeadSha))) throw new Error('event head SHA must be 40 lowercase hex characters');
  const call = makeClient({ token, apiBase, fetchImpl });

  const read = async () => {
    const pull = await call(`/repos/${repo}/pulls/${prNumber}`);
    const sha = pull.head?.sha;
    if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new Error(`PR #${prNumber} has no usable head SHA`);
    return { open: pull.state === 'open', sha, expected: expectedReviewStatus((pull.labels ?? []).map((l) => l.name)) };
  };

  let current = await read();
  if (!current.open) return { written: false, skipped: 'PR is not open', sha: current.sha };
  if (eventHeadSha && eventHeadSha !== current.sha) {
    return { written: false, skipped: 'head changed since the label event', sha: current.sha };
  }

  const { sha } = current;
  for (let attempt = 1; attempt <= SYNC_ATTEMPTS; attempt += 1) {
    const { expected } = current;
    await call(`/repos/${repo}/statuses/${sha}`, {
      method: 'POST',
      body: { state: expected.state, context: REVIEW_CONTEXT, description: expected.description },
    });
    const result = { written: true, sha, state: expected.state, label: expected.label };
    const after = await read();
    // The head moved on while writing: what was written belongs to the old SHA and stays there. It is
    // never copied to the new head, because the label was given for the old one.
    if (after.sha !== sha || !after.open) return result;
    if (after.expected.state === expected.state) return result;
    current = after; // same head, but the labels changed meanwhile: write what is true now
  }
  throw new Error(`review status for PR #${prNumber} did not settle after ${SYNC_ATTEMPTS} attempts`);
}

export async function resetReviewLabels({ repo, prNumber, token, apiBase, fetchImpl }) {
  checkRepoAndNumber(repo, prNumber);
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
