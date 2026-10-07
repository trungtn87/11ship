// Pure rules that tie a ChatGPT review to the EXACT head SHA it was given for.
//
// Used by both sides so they cannot drift apart:
//   * the trusted workflow (review.mjs) turns the review label on a PR into a commit status on the
//     current head SHA;
//   * the resolver (resolve.mjs) accepts a review label only when the snapshot holds a status that
//     was written for the current head SHA, in the right context, with the state that label means.
//
// A label alone is never evidence of a review. A commit status exists on one SHA only, so it cannot
// be carried over to a newer head, whatever order the workflows happen to run in and whatever the
// commit timestamps say. Nothing here reads the clock, the network or a PR title or body.

import { REVIEW_CONTEXT, REVIEW_LABELS, REVIEW_LABEL_STATE, REVIEW_STATUS_DESCRIPTION } from './constants.mjs';

/**
 * The status a set of PR labels asks for. Exactly one review:* label maps to its state. No review
 * label, or more than one, is `error`: there is no single result to bind, and the resolver never
 * treats `error` as a review.
 */
export function expectedReviewStatus(labels = []) {
  const set = new Set(labels);
  const present = REVIEW_LABELS.filter((l) => set.has(l));
  if (present.length === 1) {
    const state = REVIEW_LABEL_STATE[present[0]];
    return { label: present[0], state, description: REVIEW_STATUS_DESCRIPTION[state], reason: null };
  }
  return {
    label: null,
    state: 'error',
    description: REVIEW_STATUS_DESCRIPTION.error,
    reason: present.length === 0 ? 'none' : 'ambiguous',
  };
}

/**
 * Decides whether the review label on a PR is backed by a trusted status for its current head.
 *
 * `pr` needs: head_sha, labels, and review_status = { sha, context, state } | null | undefined.
 * Returns { label, valid, reason }. `label` is the single review label present (or null); `valid`
 * is true only when every check below holds. Anything missing or odd is invalid (fail closed).
 */
export function reviewBinding(pr) {
  const expected = expectedReviewStatus(pr.labels);
  if (!expected.label) {
    return { label: null, valid: false, reason: expected.reason === 'none' ? 'no review label' : 'more than one review label' };
  }
  const base = { label: expected.label, valid: false };
  const status = pr.review_status;
  if (!status || typeof status !== 'object') return { ...base, reason: 'no trusted review status' };
  if (typeof pr.head_sha !== 'string' || !pr.head_sha) return { ...base, reason: 'head SHA unknown' };
  if (status.context !== REVIEW_CONTEXT) return { ...base, reason: 'review status has the wrong context' };
  if (status.sha !== pr.head_sha) return { ...base, reason: 'review status is for another SHA' };
  if (status.state !== expected.state) return { ...base, reason: 'review status state does not match the label' };
  return { ...base, valid: true, reason: null };
}
