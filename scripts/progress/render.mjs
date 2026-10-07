// Renders the resolved progress model as docs/PROGRESS.md.
//
// Deterministic: no clock, no randomness, stable ordering. Only plan.yml text and enum values
// reach Mermaid; PR titles (untrusted) appear only in the ledger table and are neutralised first.

import { OWNER, PR_STATE, STATE, CI, nextAction, shortId, shortSha } from './resolve.mjs';

const OWNER_ICON = {
  [OWNER.CLAUDE]: '🔵',
  [OWNER.CHATGPT]: '🟣',
  [OWNER.OWNER]: '🟠',
  [OWNER.CI]: '⚙️',
  [OWNER.NONE]: '⚪',
};
const OWNER_LABEL = {
  [OWNER.CLAUDE]: 'CLAUDE',
  [OWNER.CHATGPT]: 'CHATGPT',
  [OWNER.OWNER]: 'OWNER',
  [OWNER.CI]: 'CI',
  [OWNER.NONE]: '—',
};
const OWNER_WORD = {
  [OWNER.CLAUDE]: 'Claude',
  [OWNER.CHATGPT]: 'ChatGPT',
  [OWNER.OWNER]: 'Owner',
  [OWNER.CI]: 'CI',
  [OWNER.NONE]: '—',
};
const STATE_ICON = {
  [STATE.DONE]: '✅',
  [STATE.DESIGN_LOCKED]: '🔒',
  [STATE.READY_FOR_CLAUDE]: '🟦',
  [STATE.CLAUDE_CODING]: '🛠️',
  [STATE.CI_RUNNING]: '⏳',
  [STATE.CI_FAILED]: '❌',
  [STATE.WAITING_CHATGPT_REVIEW]: '👀',
  [STATE.CHATGPT_REVIEW]: '🔎',
  [STATE.CHANGES_REQUESTED]: '✏️',
  [STATE.READY_TO_MERGE]: '🟢',
  [STATE.PLANNED]: '📝',
  [STATE.DESIGNING]: '📐',
  [STATE.DESIGN_REVIEW]: '🧐',
  [STATE.BLOCKED_BY_DEPENDENCY]: '⛔',
  [STATE.BLOCKED_BY_CI]: '⛔',
};
const CI_CELL = {
  [CI.PASS]: '✅ PASS',
  [CI.FAIL]: '❌ FAIL',
  [CI.RUNNING]: '⏳ RUNNING',
  [CI.NONE]: '—',
};
const PR_STATE_CELL = {
  [PR_STATE.MERGED]: 'MERGED',
  [PR_STATE.CANCELLED]: '🚫 CANCELLED / IGNORED',
  [PR_STATE.DRAFT]: 'DRAFT',
  [PR_STATE.OPEN]: 'OPEN',
};

/**
 * Neutralise untrusted text (PR titles, label names) for a markdown table cell: no raw HTML, no
 * links, no pipes, no backticks, no newlines. Readable characters such as ( ) : # are kept.
 */
export function safeText(value, max = 70) {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '¦')
    .replace(/`/g, "'")
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\\/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const mermaidId = (id) => id.replace(/[^A-Za-z0-9]/g, '_');
const mermaidText = (s) => String(s).replace(/"/g, '#quot;');

function prCell(repo, number) {
  return number == null ? '—' : `[#${number}](https://github.com/${repo}/pull/${number})`;
}

function mermaidClass(state) {
  switch (state) {
    case STATE.DONE:
      return 'done';
    case STATE.DESIGN_LOCKED:
      return 'locked';
    case STATE.READY_FOR_CLAUDE:
      return 'ready';
    case STATE.CLAUDE_CODING:
    case STATE.CI_RUNNING:
    case STATE.CHANGES_REQUESTED:
      return 'active';
    case STATE.CI_FAILED:
      return 'failed';
    case STATE.WAITING_CHATGPT_REVIEW:
    case STATE.CHATGPT_REVIEW:
    case STATE.READY_TO_MERGE:
    case STATE.DESIGN_REVIEW:
      return 'review';
    case STATE.BLOCKED_BY_DEPENDENCY:
    case STATE.BLOCKED_BY_CI:
      return 'blocked';
    default:
      return 'planned';
  }
}

function renderMermaid(model, planModules) {
  const { tasks, focus } = model;
  const lines = ['flowchart TD'];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const m of planModules) {
    const inModule = tasks.filter((t) => t.module === m.id);
    if (inModule.length === 0) continue;
    lines.push(`  subgraph ${mermaidId(m.id)}_box["${mermaidText(`${m.id} · ${m.title}`)}"]`);
    for (const t of inModule) {
      const label = [
        `${t.id}${t.kind === 'group' ? ' (design)' : ''}`,
        t.title,
        `${OWNER_ICON[t.owner]} ${OWNER_LABEL[t.owner]}`,
        t.state,
      ].map(mermaidText).join('<br/>');
      lines.push(`    ${mermaidId(t.id)}["${label}"]`);
    }
    lines.push('  end');
  }
  lines.push('');
  // Edges: explicit dependencies; a child with no own dependency hangs under its parent.
  const planTasks = model._planTasks;
  for (const pt of planTasks) {
    const own = pt.depends_on ?? [];
    for (const d of own) lines.push(`  ${mermaidId(d)} --> ${mermaidId(pt.id)}`);
    if (own.length === 0 && pt.parent != null && byId.has(pt.parent)) {
      lines.push(`  ${mermaidId(pt.parent)} -.-> ${mermaidId(pt.id)}`);
    }
  }
  lines.push('');
  lines.push('  classDef done fill:#d1fae5,stroke:#047857,color:#064e3b');
  lines.push('  classDef locked fill:#e0e7ff,stroke:#4338ca,color:#312e81');
  lines.push('  classDef ready fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a');
  lines.push('  classDef active fill:#fef9c3,stroke:#a16207,color:#713f12');
  lines.push('  classDef failed fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d');
  lines.push('  classDef review fill:#f3e8ff,stroke:#7e22ce,color:#581c87');
  lines.push('  classDef blocked fill:#f3f4f6,stroke:#9ca3af,color:#4b5563,stroke-dasharray:4 3');
  lines.push('  classDef planned fill:#ffffff,stroke:#9ca3af,color:#374151');
  lines.push('  classDef focus stroke:#f59e0b,stroke-width:5px');
  for (const cls of ['done', 'locked', 'ready', 'active', 'failed', 'review', 'blocked', 'planned']) {
    const ids = tasks.filter((t) => mermaidClass(t.state) === cls).map((t) => mermaidId(t.id));
    if (ids.length) lines.push(`  class ${ids.join(',')} ${cls}`);
  }
  if (focus) lines.push(`  class ${mermaidId(focus.task)} focus`);
  return lines.join('\n');
}

function dependencyCell(task) {
  if (task.own_deps.length === 0) return '—';
  return task.own_deps.map((d) => `${shortId(d.id)} ${d.state === STATE.DONE ? 'DONE' : d.state}`).join(', ');
}

function headCell(task, model) {
  if (task.state === STATE.READY_FOR_CLAUDE) return model.main.sha ? `main @ ${shortSha(model.main.sha)}` : 'main';
  if (task.head && task.head !== 'main') return `\`${shortSha(task.head)}\``;
  return '—';
}

function pct(t) {
  return `${t.done} / ${t.total} (${t.percent}%)`;
}

export function renderProgress(model) {
  const { repo, project, focus, progress } = model;
  const out = [];
  out.push('<!-- AUTO-GENERATED — DO NOT EDIT MANUALLY. Source: docs/progress/plan.yml + GitHub. Generator: scripts/generate-progress.mjs -->');
  out.push('');
  out.push(`# ${project.name} — Project Progress`);
  out.push('');
  out.push('> **AUTO-GENERATED — DO NOT EDIT MANUALLY**');
  out.push('>');
  out.push('> The plan lives in [`docs/progress/plan.yml`](progress/plan.yml); the status comes from GitHub (merged PRs, draft/open/closed state, labels, head SHA, required checks, dependencies). Nobody, human or AI, can mark a task DONE by writing it down. See [how states are derived](progress/README.md).');
  out.push(`> Data as of \`main @ ${shortSha(model.main.sha) || 'unknown'}\` · main CI: ${CI_CELL[model.main.ci]}`);
  out.push('');

  // CURRENT FOCUS
  out.push('## 🎯 CURRENT FOCUS');
  out.push('');
  if (!focus) {
    out.push('**All planned tasks are DONE.** Add the next task to `docs/progress/plan.yml`.');
  } else {
    const blockedBy = focus.blocked_by.length ? focus.blocked_by.map(shortId).join(', ') : 'None';
    out.push('| | |');
    out.push('|---|---|');
    out.push(`| **Task** | **${focus.task} — ${safeText(focus.title)}** |`);
    out.push(`| **Status** | ${STATE_ICON[focus.state] ?? ''} \`${focus.state}\` |`);
    out.push(`| **Current owner** | ${OWNER_ICON[focus.owner]} **${OWNER_LABEL[focus.owner]}** |`);
    out.push(`| **ChatGPT** | ${focus.chatgpt} |`);
    out.push(`| **Claude** | ${focus.claude} |`);
    out.push(`| **Owner** | ${focus.owner_action} |`);
    out.push(`| **Blocked by** | ${blockedBy} |`);
    out.push(`| **Next gate** | ${focus.next_gate} |`);
    if (focus.pr) out.push(`| **Active PR** | ${focus.pr} |`);
    if (focus.ignored_prs.length) out.push(`| **Ignored PRs** | ${focus.ignored_prs.join(', ')} (cancelled, never counted) |`);
    if (focus.reason) out.push(`| **Note** | ${safeText(focus.reason, 120)} |`);
  }
  out.push('');

  // Progress
  out.push('## Progress');
  out.push('');
  out.push('Weighted by task weight in the plan (each leaf task = 1 unless stated). Commits, lines of code and cancelled PRs never count. Percentages are rounded down.');
  out.push('');
  out.push('| Scope | Done / total |');
  out.push('|---|---|');
  const cur = progress.current_module;
  if (cur) out.push(`| Current milestone — ${cur.id} ${safeText(cur.title)} | ${pct(cur)} |`);
  out.push(`| Overall — planned tasks only${model.roadmap_complete ? '' : ' (roadmap not final)'} | ${pct(progress.overall)} |`);
  for (const m of progress.modules) {
    if (cur && m.id === cur.id) continue;
    out.push(`| Module ${m.id} ${safeText(m.title)} | ${pct(m)} |`);
  }
  out.push('');

  // Tree
  out.push('## Progress tree');
  out.push('');
  out.push('Solid arrows are dependencies, dotted arrows are parent → first child. The thick amber outline is the current focus.');
  out.push('');
  out.push('```mermaid');
  out.push(renderMermaid(model, model._planModules));
  out.push('```');
  out.push('');

  // Details table
  out.push('## Task details');
  out.push('');
  out.push('| Task | Status | Current owner | PR | CI | Head | Dependency | Next action |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const t of model.tasks) {
    const indent = '&nbsp;&nbsp;'.repeat(t.depth);
    const name = t.kind === 'group' ? `**${t.id}** design · ${safeText(t.title)}` : `${t.id} · ${safeText(t.title)}`;
    const owner = t.owner === OWNER.NONE ? '—' : OWNER_WORD[t.owner];
    out.push(
      `| ${indent}${name} | ${STATE_ICON[t.state] ?? ''} ${t.state} | ${owner} | ${prCell(repo, t.pr)} | ${CI_CELL[t.ci]} | ${headCell(t, model)} | ${dependencyCell(t)} | ${nextAction(t)} |`,
    );
  }
  out.push('');

  // PR ledger
  out.push('## Pull request ledger');
  out.push('');
  out.push('How every PR is treated. A PR counts only through explicit metadata (labels, or a number pinned in the plan), never through its title, body or author.');
  out.push('');
  out.push('| PR | Lifecycle | Task | Role | CI on head | Head | Treated as |');
  out.push('|---|---|---|---|---|---|---|');
  for (const p of model.prs) {
    const treated = p.counted ? 'counted' : p.lifecycle === PR_STATE.CANCELLED ? '🚫 not counted (cancelled)' : p.role === 'infra' ? 'out of plan' : '⚠️ not counted';
    const note = p.note ? ` — ${safeText(p.note, 110)}` : '';
    out.push(
      `| ${prCell(repo, p.number)} ${safeText(p.title, 60)} | ${PR_STATE_CELL[p.lifecycle]} | ${p.task ?? '—'} | ${p.role ?? '—'} | ${CI_CELL[p.ci]} | \`${shortSha(p.head_sha)}\` | ${treated}${note} |`,
    );
  }
  out.push('');

  // Attention
  out.push('## ⚠️ Attention');
  out.push('');
  if (model.attention.length === 0) {
    out.push('Nothing needs attention.');
  } else {
    for (const a of model.attention) out.push(`- \`${a.code}\` ${safeText(a.message, 260)}`);
  }
  out.push('');

  // Legend
  out.push('## Workflow');
  out.push('');
  out.push('`PLAN → CHATGPT DESIGN → DESIGN LOCKED → READY FOR CLAUDE → CLAUDE CODING → CI → WAITING CHATGPT REVIEW → CHATGPT REVIEW → READY TO MERGE → MERGED / LOCKED → next task`');
  out.push('');
  out.push('ChatGPT designs and reviews, Claude implements and tests, the Owner locks decisions and merges. Nothing is merged automatically.');
  out.push('');
  return `${out.join('\n')}`;
}

/** Attach the plan fields the renderer needs (kept off the resolver's pure result). */
export function withPlan(model, plan) {
  return {
    ...model,
    _planTasks: [...plan.tasks].sort((a, b) => a.order - b.order),
    _planModules: [...plan.modules].sort((a, b) => a.order - b.order),
  };
}
