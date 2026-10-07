// Collects the GitHub facts the resolver needs, using the REST API only.
//
// The snapshot keeps just the fields the resolver reads: number, title (display only), state,
// draft, merged_at, head SHA, labels, check runs, and for review-labelled open PRs the label
// timestamps and head commit date. PR bodies are never fetched into the snapshot.

const API_VERSION = '2022-11-28';

export class GitHubError extends Error {
  constructor(status, path, detail) {
    super(`GitHub API ${status} for ${path}${detail ? `: ${detail}` : ''}`);
    this.status = status;
  }
}

function makeClient({ token, apiBase = 'https://api.github.com', fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error('GITHUB_TOKEN (or GH_TOKEN) is required to read GitHub state');
  return async function get(path) {
    const res = await fetchImpl(`${apiBase}${path}`, {
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

  // Main CI: newest commit on main that has any run of a required check. Commits pushed by the
  // progress bot itself (GITHUB_TOKEN pushes do not trigger CI) have none and are skipped.
  const commits = await get(`/repos/${repo}/commits?sha=${encodeURIComponent(mainBranch)}&per_page=15`);
  let main = { sha: commits[0]?.sha ?? null, checks: [] };
  for (const c of commits) {
    const runs = await checkRuns(get, repo, c.sha);
    if (runs.some((r) => requiredChecks.includes(r.name))) {
      main = { sha: c.sha, checks: runs };
      break;
    }
  }
  return { repo, pulls, main };
}
