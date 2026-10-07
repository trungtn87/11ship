// Pure state resolver for the project progress tree.
//
// Input : the plan manifest (docs/progress/plan.yml, parsed) and a GitHub snapshot (see github.mjs).
// Output: per-task states, per-PR classification, current focus, progress and attention items.
//
// Nothing here reads the clock, the network or the file system, and nothing reads a PR title or
// body: state comes only from merged_at / state / draft / head SHA / check runs / labels /
// dependencies. The same input always produces the same output.

import { FIXED_ROLES } from './constants.mjs';

export const STATE = Object.freeze({
  PLANNED: 'PLANNED',
  DESIGNING: 'DESIGNING',
  DESIGN_REVIEW: 'DESIGN_REVIEW',
  DESIGN_LOCKED: 'DESIGN_LOCKED',
  READY_FOR_CLAUDE: 'READY_FOR_CLAUDE',
  CLAUDE_CODING: 'CLAUDE_CODING',
  CI_RUNNING: 'CI_RUNNING',
  CI_FAILED: 'CI_FAILED',
  WAITING_CHATGPT_REVIEW: 'WAITING_CHATGPT_REVIEW',
  CHATGPT_REVIEW: 'CHATGPT_REVIEW',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  READY_TO_MERGE: 'READY_TO_MERGE',
  DONE: 'DONE',
  BLOCKED_BY_DEPENDENCY: 'BLOCKED_BY_DEPENDENCY',
  BLOCKED_BY_CI: 'BLOCKED_BY_CI',
});

export const PR_STATE = Object.freeze({
  CANCELLED: 'CANCELLED', // closed without merge, or listed in plan.ignored_prs
  MERGED: 'MERGED',
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
});

export const OWNER = Object.freeze({
  CLAUDE: 'CLAUDE',
  CHATGPT: 'CHATGPT',
  OWNER: 'OWNER',
  CI: 'CI',
  NONE: 'NONE',
});

export const CI = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', RUNNING: 'RUNNING', NONE: 'NONE' });

export const LABEL = Object.freeze({
  agentClaude: 'agent:claude',
  agentChatgpt: 'agent:chatgpt',
  agentOwner: 'agent:owner',
  typeDesign: 'type:design',
  typeImplementation: 'type:implementation',
  typeReviewFix: 'type:review-fix',
  typeInfra: 'type:infra',
  reviewInProgress: 'review:in-progress',
  reviewChangesRequested: 'review:changes-requested',
  reviewPass: 'review:pass',
  modulePrefix: 'module:',
});

const FAILED_CONCLUSIONS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'startup_failure',
  'action_required',
  'stale',
]);

// ---------------------------------------------------------------------------------------------
// Plan validation

export function validatePlan(plan) {
  const errors = [];
  const add = (m) => errors.push(m);
  if (!plan || typeof plan !== 'object') throw new Error('plan is empty or not a map');
  if (plan.schema_version !== 1) add(`schema_version must be 1 (got ${plan.schema_version})`);
  if (!plan.project?.id) add('project.id is required');
  if (typeof plan.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(plan.repo)) add('repo must be "owner/name"');
  if (!plan.main_branch) add('main_branch is required');
  if (!Array.isArray(plan.required_checks) || plan.required_checks.length === 0) {
    add('required_checks must list at least one check run name');
  }
  const moduleIds = new Set();
  for (const m of plan.modules ?? []) {
    if (!m.id) add('every module needs an id');
    else if (moduleIds.has(m.id)) add(`duplicate module id ${m.id}`);
    else moduleIds.add(m.id);
  }
  const ids = new Set();
  const tasks = plan.tasks ?? [];
  for (const t of tasks) {
    if (!t.id) {
      add('every task needs an id');
      continue;
    }
    if (ids.has(t.id)) add(`duplicate task id ${t.id}`);
    ids.add(t.id);
    if (!moduleIds.has(t.module)) add(`task ${t.id}: unknown module ${t.module}`);
    if (t.kind !== 'leaf' && t.kind !== 'group') add(`task ${t.id}: kind must be leaf or group`);
    if (!Number.isInteger(t.order)) add(`task ${t.id}: order must be an integer`);
    // Schema v1 fixes the workflow (Claude implements, ChatGPT designs and reviews). The fields stay
    // in plan.yml as documentation, but they are not configurable: any other value is an error.
    for (const [field, expected] of Object.entries(FIXED_ROLES)) {
      if (t[field] !== expected) add(`task ${t.id}: ${field} must be ${expected} in schema v1 (got ${t[field] ?? 'nothing'}); roles are not configurable yet`);
    }
    if (t.kind === 'leaf' && !(Number.isInteger(t.weight ?? 1) && (t.weight ?? 1) >= 0)) {
      add(`task ${t.id}: weight must be a non-negative integer`);
    }
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const orders = new Set();
  for (const t of tasks) {
    if (Number.isInteger(t.order)) {
      if (orders.has(t.order)) add(`task ${t.id}: duplicate order ${t.order}`);
      orders.add(t.order);
    }
    if (t.parent != null) {
      const p = byId.get(t.parent);
      if (!p) add(`task ${t.id}: unknown parent ${t.parent}`);
      else if (p.kind !== 'group') add(`task ${t.id}: parent ${t.parent} is not a group`);
      else if (p.module !== t.module) add(`task ${t.id}: module differs from parent ${t.parent}`);
    }
    for (const d of t.depends_on ?? []) {
      if (!byId.has(d)) add(`task ${t.id}: unknown dependency ${d}`);
      if (d === t.id) add(`task ${t.id}: depends on itself`);
    }
    if (t.kind === 'group' && !tasks.some((c) => c.parent === t.id)) add(`group ${t.id} has no children`);
  }
  // cycles over (depends_on + parent) edges
  const visiting = new Set();
  const done = new Set();
  const visit = (id, trail) => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      add(`dependency cycle: ${[...trail, id].join(' -> ')}`);
      return;
    }
    visiting.add(id);
    const t = byId.get(id);
    if (t) {
      const next = [...(t.depends_on ?? []), ...(t.parent != null ? [t.parent] : [])];
      for (const n of next) if (byId.has(n)) visit(n, [...trail, id]);
    }
    visiting.delete(id);
    done.add(id);
  };
  for (const t of tasks) visit(t.id, []);
  const pins = new Map();
  for (const t of tasks) {
    for (const [field, kind] of [['design_pr', 'design'], ['implementation_pr', 'implementation']]) {
      if (t[field] == null) continue;
      if (!Number.isInteger(t[field])) add(`task ${t.id}: ${field} must be a PR number`);
      else if (pins.has(t[field])) add(`PR #${t[field]} is pinned twice (${pins.get(t[field])}, ${t.id})`);
      else pins.set(t[field], `${t.id}:${kind}`);
    }
  }
  for (const ig of plan.ignored_prs ?? []) {
    if (!Number.isInteger(ig.number)) add('ignored_prs entries need an integer number');
    if (pins.has(ig.number)) add(`PR #${ig.number} is both pinned and ignored`);
  }
  if (errors.length) throw new Error(`invalid plan:\n- ${errors.join('\n- ')}`);
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Small helpers

export function shortId(id) {
  return /^M\d+-/.test(id) ? id.replace(/^M\d+-/, '') : id;
}

export function shortSha(sha) {
  return sha ? String(sha).slice(0, 7) : '';
}

export function parseLabels(labels = []) {
  const set = new Set(labels);
  return {
    has: (l) => set.has(l),
    modules: labels.filter((l) => l.startsWith(LABEL.modulePrefix)).map((l) => l.slice(LABEL.modulePrefix.length)),
    types: labels.filter((l) => l.startsWith('type:')),
    agents: labels.filter((l) => l.startsWith('agent:')),
  };
}

export function prLifecycle(pr, ignoredNumbers = new Set()) {
  if (ignoredNumbers.has(pr.number)) return PR_STATE.CANCELLED;
  if (pr.state === 'closed' && !pr.merged_at) return PR_STATE.CANCELLED;
  if (pr.merged_at) return PR_STATE.MERGED;
  if (pr.draft) return PR_STATE.DRAFT;
  return PR_STATE.OPEN;
}

/** CI verdict for a list of check runs (latest run per name wins) against the required names. */
export function ciStatus(checks = [], required = []) {
  if (!checks.length) return CI.NONE;
  const latest = new Map();
  for (const c of checks) {
    const prev = latest.get(c.name);
    if (!prev || (c.id ?? 0) > (prev.id ?? 0)) latest.set(c.name, c);
  }
  let pending = false;
  for (const name of required) {
    const run = latest.get(name);
    if (!run) {
      pending = true;
      continue;
    }
    if (run.status === 'completed') {
      if (FAILED_CONCLUSIONS.has(run.conclusion)) return CI.FAIL;
      if (run.conclusion !== 'success') pending = true; // neutral/skipped never counts as PASS
    } else {
      pending = true;
    }
  }
  return pending ? CI.RUNNING : CI.PASS;
}

/**
 * Main CI verdict, bound to the real head. Checks only count when they belong to the head itself
 * (ci_sha === head_sha) or to the commit under a chain of trusted progress-bot commits that starts
 * AT the head. Anything else (no head, no CI commit, a CI commit that is not the head and not
 * reached through such a chain) is NONE, never the green of an older commit.
 */
export function mainStatus(main, required) {
  const headSha = main?.head_sha ?? null;
  const ciSha = main?.ci_sha ?? null;
  const skipped = main?.skipped_progress_shas ?? [];
  const viaProgressCommits = skipped.length > 0 && skipped[0] === headSha && ciSha !== headSha;
  const bound = Boolean(headSha && ciSha && (ciSha === headSha || viaProgressCommits));
  return {
    head_sha: headSha,
    ci_sha: bound ? ciSha : null,
    head_is_progress_commit: viaProgressCommits,
    ci: bound ? ciStatus(main.checks ?? [], required) : CI.NONE,
  };
}

/**
 * Defense in depth only. A review label is bound to a head SHA by the trusted reset-review
 * workflow, which removes every review:* label whenever the PR head changes (see
 * .github/workflows/update-progress.yml). This timestamp comparison can never make a label valid
 * by itself; it can only reject one that is still there while the reset has not run yet. Commit
 * timestamps are author-controlled metadata and are not evidence of which SHA was reviewed.
 */
export function reviewLabelFresh(pr, label) {
  const labeledAt = Date.parse(pr.label_events?.[label] ?? '');
  const committedAt = Date.parse(pr.head_committed_at ?? '');
  if (Number.isNaN(labeledAt) || Number.isNaN(committedAt)) return false;
  return labeledAt >= committedAt;
}

// ---------------------------------------------------------------------------------------------
// PR classification

function classifyPrs(plan, tasksById, snapshot) {
  const ignored = new Map((plan.ignored_prs ?? []).map((i) => [i.number, i]));
  const ignoredNumbers = new Set(ignored.keys());
  const pins = new Map();
  for (const t of plan.tasks) {
    if (t.design_pr != null) pins.set(t.design_pr, { task: t.id, role: 'design' });
    if (t.implementation_pr != null) pins.set(t.implementation_pr, { task: t.id, role: 'implementation' });
  }

  const results = [];
  const attention = [];
  for (const pr of [...snapshot.pulls].sort((a, b) => a.number - b.number)) {
    const lifecycle = prLifecycle(pr, ignoredNumbers);
    const labels = parseLabels(pr.labels);
    const ci = ciStatus(pr.checks, plan.required_checks);
    const base = {
      number: pr.number,
      title: pr.title ?? '',
      lifecycle,
      ci,
      head_sha: pr.head_sha,
      draft: Boolean(pr.draft),
      labels: [...(pr.labels ?? [])].sort(),
      task: null,
      role: null,
      source: null,
      counted: false,
      note: '',
      raw: pr,
    };

    if (ignored.has(pr.number)) {
      const ig = ignored.get(pr.number);
      results.push({ ...base, task: ig.task ?? null, role: 'implementation', source: 'manifest', note: ig.reason ?? 'Ignored by plan' });
      continue;
    }

    const pinned = pins.get(pr.number);
    if (pinned) {
      results.push({ ...base, task: pinned.task, role: pinned.role, source: 'manifest', counted: lifecycle !== PR_STATE.CANCELLED });
      continue;
    }

    if (labels.has(LABEL.typeInfra)) {
      results.push({ ...base, role: 'infra', source: 'label', note: 'Out of plan (type:infra)' });
      continue;
    }

    const knownModules = labels.modules.filter((m) => tasksById.has(m));
    const unknownModules = labels.modules.filter((m) => !tasksById.has(m));
    const types = labels.types.filter((t) => [LABEL.typeDesign, LABEL.typeImplementation, LABEL.typeReviewFix].includes(t));
    const open = lifecycle === PR_STATE.OPEN || lifecycle === PR_STATE.DRAFT;

    const flag = (code, message) => {
      results.push({ ...base, note: message });
      if (open) attention.push({ code, pr: pr.number, message: `PR #${pr.number}: ${message}` });
    };

    if (unknownModules.length) {
      flag('UNKNOWN_MODULE', `label module:${unknownModules[0]} does not match any task in plan.yml; PR not counted.`);
      continue;
    }
    if (knownModules.length === 0 || types.length === 0) {
      const missing = [knownModules.length === 0 ? 'module:<task id>' : null, types.length === 0 ? 'type:design|implementation|review-fix' : null, labels.agents.length === 0 ? 'agent:*' : null].filter(Boolean);
      flag('UNCLASSIFIED_PR', `no usable metadata (missing ${missing.join(', ')}); PR not counted. State is never inferred from titles, bodies or authors.`);
      continue;
    }
    if (knownModules.length > 1 || types.length > 1) {
      flag('AMBIGUOUS_PR', 'more than one module:/type: label; PR not counted.');
      continue;
    }

    const role = types[0] === LABEL.typeDesign ? 'design' : types[0] === LABEL.typeImplementation ? 'implementation' : 'review-fix';
    const requiredAgent = role === 'design' ? LABEL.agentChatgpt : LABEL.agentClaude;
    if (!labels.has(requiredAgent)) {
      flag('AGENT_MISMATCH', `${types[0]} on module:${knownModules[0]} requires ${requiredAgent} (found ${labels.agents.join(', ') || 'no agent label'}); PR not counted.`);
      continue;
    }
    results.push({ ...base, task: knownModules[0], role, source: 'label', counted: lifecycle !== PR_STATE.CANCELLED });
  }
  return { results, attention };
}

// ---------------------------------------------------------------------------------------------
// Task resolution

export function resolveProgress(plan, snapshot) {
  validatePlan(plan);
  const tasks = [...plan.tasks].sort((a, b) => a.order - b.order);
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const required = plan.required_checks;
  const { results: prs, attention: prAttention } = classifyPrs(plan, tasksById, snapshot);
  const attention = [...prAttention];
  const prsByTask = (id, role) => prs.filter((p) => p.counted && p.task === id && p.role === role);

  const mainState = mainStatus(snapshot.main, required);
  const mainCi = mainState.ci;

  const ancestors = (t) => {
    const chain = [];
    let cur = t;
    while (cur.parent != null) {
      cur = tasksById.get(cur.parent);
      chain.push(cur);
    }
    return chain;
  };
  const effectiveDeps = (t) => {
    const out = [];
    for (const node of [t, ...ancestors(t)]) for (const d of node.depends_on ?? []) if (!out.includes(d)) out.push(d);
    return out;
  };

  // Design gate: nearest node (self, then ancestors) that has any counted design PR decides.
  const designOf = (t) => {
    for (const node of [t, ...ancestors(t)]) {
      const designPrs = prsByTask(node.id, 'design');
      if (designPrs.length === 0) continue;
      const merged = designPrs.filter((p) => p.lifecycle === PR_STATE.MERGED).sort((a, b) => b.number - a.number)[0];
      if (merged) return { locked: true, state: STATE.DESIGN_LOCKED, pr: merged, node: node.id };
      const open = designPrs.filter((p) => p.lifecycle === PR_STATE.OPEN || p.lifecycle === PR_STATE.DRAFT).sort((a, b) => b.number - a.number)[0];
      if (open) {
        return { locked: false, state: open.lifecycle === PR_STATE.DRAFT ? STATE.DESIGNING : STATE.DESIGN_REVIEW, pr: open, node: node.id };
      }
    }
    return { locked: false, state: STATE.PLANNED, pr: null, node: null };
  };

  const memo = new Map();
  const resolveTask = (id) => {
    if (memo.has(id)) return memo.get(id);
    const t = tasksById.get(id);
    const deps = effectiveDeps(t).map((d) => ({ id: d, state: resolveTask(d).state }));
    const unmet = deps.filter((d) => d.state !== STATE.DONE).map((d) => d.id);
    const children = tasks.filter((c) => c.parent === id);
    const design = designOf(t);
    const out = {
      id,
      title: t.title,
      kind: t.kind,
      module: t.module,
      parent: t.parent ?? null,
      order: t.order,
      depth: ancestors(t).length,
      deps,
      own_deps: (t.depends_on ?? []).map((d) => ({ id: d, state: resolveTask(d).state })),
      unmet,
      state: STATE.PLANNED,
      owner: OWNER.NONE,
      pr: null,
      ci: CI.NONE,
      head: null,
      reason: '',
      design_state: design.state,
      design_pr: design.pr?.number ?? null,
      weight: t.kind === 'leaf' ? (t.weight ?? 1) : 0,
      children: children.map((c) => c.id),
    };
    const finish = (state, extra = {}) => {
      Object.assign(out, { state }, extra);
      if (out.owner === OWNER.NONE) out.owner = ownerFor(state);
      memo.set(id, out);
      return out;
    };

    if (t.kind === 'group') {
      if (unmet.length) return finish(STATE.BLOCKED_BY_DEPENDENCY, { reason: `waiting for ${unmet.map(shortId).join(', ')}`, pr: design.pr?.number ?? null });
      const kids = children.map((c) => resolveTask(c.id));
      if (design.locked && kids.every((k) => k.state === STATE.DONE)) {
        return finish(STATE.DONE, { pr: design.pr?.number ?? null, ci: design.pr?.ci ?? CI.NONE, head: design.pr?.head_sha ?? null });
      }
      if (design.locked) {
        const done = kids.filter((k) => k.state === STATE.DONE).length;
        return finish(STATE.DESIGN_LOCKED, { pr: design.pr.number, ci: design.pr.ci, head: design.pr.head_sha, reason: `design locked; ${done}/${kids.length} child tasks done`, owner: OWNER.NONE });
      }
      return finish(design.state, { pr: design.pr?.number ?? null, ci: design.pr?.ci ?? CI.NONE, head: design.pr?.head_sha ?? null });
    }

    // Leaf task
    const impl = prs.filter((p) => p.counted && p.task === id && (p.role === 'implementation' || p.role === 'review-fix'));
    const mergedImpl = impl.filter((p) => p.lifecycle === PR_STATE.MERGED && p.role === 'implementation').sort((a, b) => b.number - a.number)[0];

    if (unmet.length) {
      if (mergedImpl) {
        attention.push({ code: 'MERGED_BEFORE_DEPENDENCY', pr: mergedImpl.number, message: `PR #${mergedImpl.number} for ${id} is merged but ${unmet.join(', ')} is not DONE; task is not counted.` });
      }
      return finish(STATE.BLOCKED_BY_DEPENDENCY, { reason: `waiting for ${unmet.map(shortId).join(', ')}` });
    }

    if (mergedImpl) {
      const base = { pr: mergedImpl.number, ci: mergedImpl.ci, head: mergedImpl.head_sha };
      if (mergedImpl.ci === CI.PASS) return finish(STATE.DONE, base);
      if (mergedImpl.ci === CI.FAIL) return finish(STATE.CI_FAILED, { ...base, reason: 'merged PR has failing required checks; not counted as DONE' });
      return finish(STATE.CI_RUNNING, { ...base, reason: 'merged PR has no verified green required checks; not counted as DONE' });
    }

    const active = impl.filter((p) => p.lifecycle === PR_STATE.OPEN || p.lifecycle === PR_STATE.DRAFT).sort((a, b) => b.number - a.number);

    // Start gate: a task that has no PR in flight may only start while required checks on main are
    // green. A task already in flight is not pulled back by a later red main.
    if (active.length === 0 && t.requires_main_ci_green && mainCi !== CI.PASS) {
      return finish(STATE.BLOCKED_BY_CI, { reason: `main CI is ${mainCi}; required checks must be green on main`, head: mainState.head_sha });
    }

    if (!design.locked) {
      return finish(design.state, { pr: design.pr?.number ?? null, ci: design.pr?.ci ?? CI.NONE, head: design.pr?.head_sha ?? null });
    }

    if (active.length > 1) {
      attention.push({ code: 'MULTIPLE_ACTIVE_PRS', pr: active[0].number, message: `${id} has ${active.length} open implementation PRs (${active.map((p) => `#${p.number}`).join(', ')}); using #${active[0].number}.` });
    }
    if (active.length === 0) {
      return finish(STATE.READY_FOR_CLAUDE, { head: 'main', ci: CI.NONE, reason: '' });
    }

    const pr = active[0];
    const raw = pr.raw;
    const base = { pr: pr.number, ci: pr.ci, head: pr.head_sha };
    const fresh = (label) => raw.labels?.includes(label) && reviewLabelFresh(raw, label);
    for (const label of [LABEL.reviewInProgress, LABEL.reviewChangesRequested, LABEL.reviewPass]) {
      if (raw.labels?.includes(label) && !reviewLabelFresh(raw, label)) {
        attention.push({ code: 'STALE_REVIEW_LABEL', pr: pr.number, message: `PR #${pr.number}: label ${label} is older than head ${shortSha(pr.head_sha)} (or its time is unknown) and is ignored.` });
      }
    }

    if (pr.ci === CI.FAIL) return finish(STATE.CI_FAILED, base);
    if (fresh(LABEL.reviewChangesRequested)) return finish(STATE.CHANGES_REQUESTED, base);
    if (pr.lifecycle === PR_STATE.DRAFT) return finish(STATE.CLAUDE_CODING, base);
    if (pr.ci !== CI.PASS) return finish(STATE.CI_RUNNING, base);
    if (fresh(LABEL.reviewPass)) return finish(STATE.READY_TO_MERGE, base);
    if (fresh(LABEL.reviewInProgress)) return finish(STATE.CHATGPT_REVIEW, base);
    return finish(STATE.WAITING_CHATGPT_REVIEW, base);
  };

  const resolved = tasks.map((t) => resolveTask(t.id));

  // Current focus: first unfinished leaf that is not blocked, else first unfinished leaf.
  const leaves = resolved.filter((r) => r.kind === 'leaf');
  const unfinished = leaves.filter((r) => r.state !== STATE.DONE);
  const focusTask = unfinished.find((r) => !isBlocked(r.state)) ?? unfinished[0] ?? null;

  const progress = computeProgress(plan, resolved);
  attention.sort((a, b) => a.pr - b.pr || a.code.localeCompare(b.code));

  return {
    project: plan.project,
    repo: plan.repo,
    main: mainState,
    tasks: resolved,
    prs: prs.map(({ raw, ...rest }) => rest),
    focus: focusTask ? describeFocus(focusTask, resolved, prs) : null,
    progress,
    attention,
    roadmap_complete: plan.roadmap_complete === true,
  };
}

export const isBlocked = (state) => state === STATE.BLOCKED_BY_DEPENDENCY || state === STATE.BLOCKED_BY_CI;

export function ownerFor(state) {
  switch (state) {
    case STATE.PLANNED:
    case STATE.DESIGNING:
    case STATE.WAITING_CHATGPT_REVIEW:
    case STATE.CHATGPT_REVIEW:
      return OWNER.CHATGPT;
    case STATE.DESIGN_REVIEW:
    case STATE.READY_TO_MERGE:
      return OWNER.OWNER;
    case STATE.READY_FOR_CLAUDE:
    case STATE.CLAUDE_CODING:
    case STATE.CI_FAILED:
    case STATE.CHANGES_REQUESTED:
      return OWNER.CLAUDE;
    case STATE.CI_RUNNING:
      return OWNER.CI;
    default:
      return OWNER.NONE;
  }
}

function computeProgress(plan, resolved) {
  const sum = (items) => items.reduce((n, r) => n + r.weight, 0);
  const tally = (items) => {
    const total = sum(items);
    const done = sum(items.filter((r) => r.state === STATE.DONE));
    return { done, total, percent: total === 0 ? 0 : Math.floor((done * 100) / total) };
  };
  const leaves = resolved.filter((r) => r.kind === 'leaf');
  const modules = [...plan.modules].sort((a, b) => a.order - b.order).map((m) => ({ id: m.id, title: m.title, ...tally(leaves.filter((r) => r.module === m.id)) }));
  const current = modules.find((m) => m.total > 0 && m.done < m.total) ?? modules[modules.length - 1] ?? null;
  return { overall: tally(leaves), modules, current_module: current };
}

function describeFocus(task, resolved, prs) {
  const prInfo = task.pr != null ? `PR #${task.pr}` : null;
  const gate = {
    [STATE.READY_FOR_CLAUDE]: 'Implementation PR (agent:claude, type:implementation, module label) + required CI green',
    [STATE.CLAUDE_CODING]: 'Claude marks the PR ready for review + required CI green',
    [STATE.CI_RUNNING]: 'Required CI green',
    [STATE.CI_FAILED]: 'Required CI green again',
    [STATE.WAITING_CHATGPT_REVIEW]: 'ChatGPT review result on the current head SHA',
    [STATE.CHATGPT_REVIEW]: 'ChatGPT review result on the current head SHA',
    [STATE.CHANGES_REQUESTED]: 'Claude fixes the findings, CI green, ChatGPT re-review',
    [STATE.READY_TO_MERGE]: 'Owner merges the PR',
    [STATE.PLANNED]: 'ChatGPT design PR',
    [STATE.DESIGNING]: 'Design PR ready for review',
    [STATE.DESIGN_REVIEW]: 'Owner locks the design (merge)',
    [STATE.BLOCKED_BY_DEPENDENCY]: `Dependencies DONE: ${task.unmet.map(shortId).join(', ')}`,
    [STATE.BLOCKED_BY_CI]: 'Required checks green on main',
  }[task.state] ?? '';

  const chatgpt = {
    [STATE.READY_FOR_CLAUDE]: 'Waiting for Claude implementation before review',
    [STATE.CLAUDE_CODING]: 'Waiting for Claude implementation before review',
    [STATE.CI_RUNNING]: 'Waiting for CI before review',
    [STATE.CI_FAILED]: 'Waiting for Claude to fix CI before review',
    [STATE.WAITING_CHATGPT_REVIEW]: 'Review needed',
    [STATE.CHATGPT_REVIEW]: 'Reviewing',
    [STATE.CHANGES_REQUESTED]: 'Waiting for Claude to address findings',
    [STATE.READY_TO_MERGE]: 'Review PASS',
    [STATE.PLANNED]: 'Design needed',
    [STATE.DESIGNING]: 'Designing',
    [STATE.DESIGN_REVIEW]: 'Design submitted; waiting for Owner',
  }[task.state] ?? 'Nothing to do yet';

  const claude = {
    [STATE.READY_FOR_CLAUDE]: 'Ready to implement',
    [STATE.CLAUDE_CODING]: 'Coding',
    [STATE.CI_RUNNING]: 'Implementation pushed; waiting for CI',
    [STATE.CI_FAILED]: 'Fix failing CI',
    [STATE.WAITING_CHATGPT_REVIEW]: 'Idle until review result',
    [STATE.CHATGPT_REVIEW]: 'Idle until review result',
    [STATE.CHANGES_REQUESTED]: 'Address ChatGPT findings',
    [STATE.READY_TO_MERGE]: 'Idle',
  }[task.state] ?? 'Not started (not unlocked yet)';

  const ownerLine = {
    [STATE.READY_TO_MERGE]: 'Merge decision',
    [STATE.DESIGN_REVIEW]: 'Lock or reject the design',
  }[task.state] ?? 'No action needed';

  const cancelled = prs.filter((p) => p.lifecycle === PR_STATE.CANCELLED && p.task === task.id).map((p) => `#${p.number}`);

  return {
    task: task.id,
    title: task.title,
    state: task.state,
    owner: task.owner,
    chatgpt,
    claude,
    owner_action: ownerLine,
    blocked_by: task.unmet.length ? task.unmet : [],
    next_gate: gate,
    pr: prInfo,
    ignored_prs: cancelled,
    reason: task.reason,
  };
}

export function nextAction(task) {
  const pr = task.pr != null ? ` #${task.pr}` : '';
  switch (task.state) {
    case STATE.DONE:
      return '—';
    case STATE.BLOCKED_BY_DEPENDENCY:
      return `Wait for ${task.unmet.map(shortId).join(', ')}`;
    case STATE.BLOCKED_BY_CI:
      return 'Fix required checks on main';
    case STATE.READY_FOR_CLAUDE:
      return 'Claude implement';
    case STATE.CLAUDE_CODING:
      return `Claude finish PR${pr}, mark ready`;
    case STATE.CI_RUNNING:
      return `Wait for CI${pr ? ` on PR${pr}` : ''}`;
    case STATE.CI_FAILED:
      return `Claude fix CI${pr ? ` on PR${pr}` : ''}`;
    case STATE.WAITING_CHATGPT_REVIEW:
      return `ChatGPT review PR${pr}`;
    case STATE.CHATGPT_REVIEW:
      return `ChatGPT finish review of PR${pr}`;
    case STATE.CHANGES_REQUESTED:
      return `Claude fix findings on PR${pr}`;
    case STATE.READY_TO_MERGE:
      return `Owner merge PR${pr}`;
    case STATE.PLANNED:
      return 'ChatGPT design';
    case STATE.DESIGNING:
      return `ChatGPT finish design PR${pr}`;
    case STATE.DESIGN_REVIEW:
      return `Owner review and lock design PR${pr}`;
    case STATE.DESIGN_LOCKED:
      return 'Continue child tasks';
    default:
      return '—';
  }
}
