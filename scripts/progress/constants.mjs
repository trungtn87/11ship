// Facts shared by the generator, the collector and the workflows. Keep this file free of imports.

/** The only file the progress bot may change. */
export const PROGRESS_FILE = 'docs/PROGRESS.md';

/** Exact first line (and only line) of the commit the progress workflow creates. */
export const PROGRESS_COMMIT_MESSAGE = 'chore(progress): update docs/PROGRESS.md [skip ci]';

/** Git identity the workflow commits with (see .github/workflows/update-progress.yml). */
export const PROGRESS_BOT = Object.freeze({
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
  login: 'github-actions[bot]',
});

/** Review labels. Each one is only valid for the head SHA that was reviewed. */
export const REVIEW_LABELS = Object.freeze(['review:in-progress', 'review:changes-requested', 'review:pass']);

/**
 * Commit status context that carries a ChatGPT review result. A status lives on ONE commit SHA, so
 * a result written for head A can never be read as a result for head B. This is the root of the
 * review binding; the review:* labels are only the input a person sets.
 */
export const REVIEW_CONTEXT = '11ship/chatgpt-review';

/** Only statuses created by this GitHub login (the Actions token) count as trusted. */
export const REVIEW_STATUS_CREATOR = PROGRESS_BOT.login;

/** The one commit-status state each review label stands for. */
export const REVIEW_LABEL_STATE = Object.freeze({
  'review:in-progress': 'pending',
  'review:changes-requested': 'failure',
  'review:pass': 'success',
});

/** Fixed descriptions. Nothing from GitHub (title, body, branch, label text) is ever put in one. */
export const REVIEW_STATUS_DESCRIPTION = Object.freeze({
  pending: 'ChatGPT review in progress',
  failure: 'ChatGPT requested changes',
  success: 'ChatGPT review passed',
  error: 'No single review label on this head',
});

/** Schema v1 fixes the workflow roles; plan.yml cannot configure them yet. */
export const FIXED_ROLES = Object.freeze({ owner_role: 'CLAUDE', design_role: 'CHATGPT', review_role: 'CHATGPT' });

/** How many commits below main HEAD the collector will look through progress-bot commits. */
export const MAIN_LOOKBACK = 15;
