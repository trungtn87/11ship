// Collects the GitHub facts the resolver needs, using the REST API only.
//
// The snapshot keeps just the fields the resolver reads: number, title (display only), state,
// draft, merged_at, head SHA, labels, check runs, and for review-labelled open PRs the label
// timestamps and head commit date. PR bodies are never fetched into the snapshot.

import { MAIN_LOOKBACK, PROGRESS_BOT, PROGRESS_COMMIT_MESSAGE, PROGRESS_FILE } from './constants.mjs';

const API_VERSION = '2022-11-28';

export class GitHubError extends Error {
  constructor(status, path, detail) {
    super(`GitHub API ${status} for ${path}${detail ? `: ${detail}` : ''}`);
    this.status = status;
  }
}

export function makeClient({ token, apiBase = 'https://api.github.com', fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error('GITHUB_TOKEN (or GH_TOKEN) is required to read GitHub state');
  return async function get(path, { method = 'GET' } = {}) {
    const res = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': '11ship-progress-generator',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = String((await res.json()).message ?? '').slice(0, 160);
      } catch {
        /* no JSON body */
      }
      throw new GitHubError(res.status, path.split('?')[0], detail);
    }
    return res.json();
  };
}

async function paginate(get, path, { perPage = 100, maxPages = 10, pick = (x) => x } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = pick(await get(`${path}${sep}per_page=${perPage}&page=${page}`));
    items.push(...batch);
    if (batch.length < perPage) break;
  }
  return items;
}

const slimCheck = (c) => ({ id: c.id, name: c.name, status: c.status, conclusion: c.conclusion ?? null });

async function checkRuns(get, repo, sha) {
  const runs = await paginate(get, `/repos/${repo}/commits/${sha}/check-runs`, { pick: (r) => r.check_runs ?? [] });
  return runs.map(slimCheck).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

export async function collectSnapshot({ repo, mainBranch, requiredChecks, pinnedNumbers = [], token, apiBase, fetchImpl }) {
  const get = makeClient({ token, apiBase, fetchImpl });
  const pinned = new Set(pinnedNumbers);

  const rawPulls = await paginate(get, `/repos/${repo}/pulls?state=all&sort=created&direction=asc`);
  const pulls = [];
  for (const p of rawPulls) {
    const labels = (p.labels ?? []).map((l) => l.name).sort();
    const open = p.state === 'open';
    const wantChecks = open || pinned.has(p.number) || labels.some((l) => l.startsWith('module:'));
    const pr = {
      number: p.number,
      title: p.title ?? '',
      state: p.state,
      draft: Boolean(p.draft),
      merged_at: p.merged_at ?? null,
      head_sha: p.head?.sha ?? null,
      head_ref: p.head?.ref ?? null,
      labels,
      checks: wantChecks && p.head?.sha ? await checkRuns(get, repo, p.head.sha) : [],
    };
    if (open && labels.some((l) => l.startsWith('review:'))) {
      const events = await paginate(get, `/repos/${repo}/issues/${p.number}/events`, { maxPages: 5 });
      const labelEvents = {};
      for (const e of events) {
        if (e.event === 'labeled' && e.label?.name?.startsWith('review:')) {
          const prev = labelEvents[e.label.name];
          if (!prev || e.created_at > prev) labelEvents[e.label.name] = e.created_at;
        }
      }
      pr.label_events = labelEvents;
      const commit = await get(`/repos/${repo}/commits/${p.head.sha}`);
      pr.head_committed_at = commit.commit?.committer?.date ?? commit.commit?.author?.date ?? null;
    }
    pulls.push(pr);
  }
  pulls.sort((a, b) => a.number - b.number);

  const main = await collectMain(get, { repo, mainBranch });
  return { repo, pulls, main };
}

/**
 * True only for the commit the progress workflow itself creates. Every condition must hold, and a
 * missing field counts as "no": exact one-line message, bot name and email as author AND committer,
 * a GitHub login that is the bot when GitHub reports one, a single parent, and a change to
 * docs/PROGRESS.md and nothing else. The last condition is what matters most: such a commit has
 * exactly the code of its parent, so the parent's CI also covers it.
 */
export async function isTrustedProgressCommit(get, repo, c) {
  const meta = c.commit ?? {};
  if (String(meta.message ?? '').trim() !== PROGRESS_COMMIT_MESSAGE) return false;
  for (const who of [meta.author, meta.committer]) {
    if (!who || who.name !== PROGRESS_BOT.name || who.email !== PROGRESS_BOT.email) return false;
  }
  for (const login of [c.author?.login, c.committer?.login]) {
    if (login != null && login !== PROGRESS_BOT.login) return false;
  }
  if ((c.parents ?? []).length !== 1) return false;
  const detail = await get(`/repos/${repo}/commits/${c.sha}`);
  const files = detail.files ?? [];
  return files.length === 1 && files[0].filename === PROGRESS_FILE && (detail.parents ?? []).length === 1;
}

/**
 * Main CI facts. `head_sha` is the real tip of main and is never replaced. CI is read from
 * `ci_sha`, which is the head itself unless the head is a trusted progress-bot commit (GITHUB_TOKEN
 * pushes do not start CI), in which case it is the commit directly below, repeated while the
 * commits above it are also trusted progress commits. A normal head without required checks is NOT
 * walked past: it keeps its own (empty or running) checks, so main CI is NONE or RUNNING, never the
 * green of an older commit. `skipped_progress_shas` lists the bot commits that were passed over,
 * newest first, so the resolver can verify the chain starts at the head.
 */
export async function collectMain(get, { repo, mainBranch, lookback = MAIN_LOOKBACK }) {
  const commits = await get(`/repos/${repo}/commits?sha=${encodeURIComponent(mainBranch)}&per_page=${lookback}`);
  const headSha = commits[0]?.sha ?? null;
  const skipped = [];
  let ciSha = null;
  for (let i = 0; i < commits.length; i += 1) {
    const c = commits[i];
    if (i > 0 && c.sha !== (commits[i - 1].parents ?? [])[0]?.sha) break; // not a straight line: stop, fail closed
    if (!(await isTrustedProgressCommit(get, repo, c))) {
      ciSha = c.sha;
      break;
    }
    skipped.push(c.sha);
  }
  const checks = ciSha ? await checkRuns(get, repo, ciSha) : [];
  return { head_sha: headSha, ci_sha: ciSha, skipped_progress_shas: skipped, checks };
}
