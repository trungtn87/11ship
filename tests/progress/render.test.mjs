import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMarkdown } from '../../scripts/generate-progress.mjs';
import { resolveProgress, STATE, PR_STATE, OWNER } from '../../scripts/progress/resolve.mjs';
import { renderProgress, withPlan, safeText } from '../../scripts/progress/render.mjs';
import { plan, root, history, pr, snapshot, checks, stateOf, taskOf, prOf } from './helpers.mjs';

const live = JSON.parse(readFileSync(resolve(root, 'tests/progress/fixtures/live-2026-10-07.json'), 'utf8'));

describe('P10 determinism', () => {
  test('same input twice -> byte-for-byte identical output', () => {
    const a = buildMarkdown(plan, live);
    const b = buildMarkdown(plan, structuredClone(live));
    assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
  });

  test('input order does not matter (PRs and checks shuffled)', () => {
    const shuffled = structuredClone(live);
    shuffled.pulls.reverse();
    for (const p of shuffled.pulls) p.checks.reverse();
    assert.equal(buildMarkdown(plan, shuffled), buildMarkdown(plan, live));
  });

  test('output carries no clock value', () => {
    const md = buildMarkdown(plan, live);
    assert.doesNotMatch(md, /\b20\d\d-\d\d-\d\d[T ]\d\d:\d\d/);
  });
});

describe('acceptance on the real repository state (frozen snapshot 2026-10-07)', () => {
  const r = resolveProgress(plan, live);

  test('task states', () => {
    assert.equal(stateOf(r, 'M00-B1'), STATE.DONE);
    assert.equal(stateOf(r, 'M00-C1'), STATE.DESIGN_LOCKED);
    assert.equal(stateOf(r, 'M00-C1A0'), STATE.DONE);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.READY_FOR_CLAUDE);
    assert.equal(stateOf(r, 'M00-C1B'), STATE.BLOCKED_BY_DEPENDENCY);
    assert.equal(stateOf(r, 'M00-C1C'), STATE.BLOCKED_BY_DEPENDENCY);
    assert.equal(stateOf(r, 'M01'), STATE.BLOCKED_BY_DEPENDENCY);
  });

  test('current focus is M00-C1A1 owned by Claude', () => {
    assert.equal(r.focus.task, 'M00-C1A1');
    assert.equal(r.focus.owner, OWNER.CLAUDE);
    assert.equal(r.focus.chatgpt, 'Waiting for Claude implementation before review');
    assert.equal(r.focus.claude, 'Ready to implement');
    assert.deepEqual(r.focus.blocked_by, []);
  });

  test('PR #5 is closed, not merged, has green CI, and is CANCELLED / not counted', () => {
    const raw = live.pulls.find((p) => p.number === 5);
    assert.equal(raw.state, 'closed');
    assert.equal(raw.merged_at, null);
    assert.equal(raw.checks.at(-1).conclusion, 'success');
    assert.equal(prOf(r, 5).lifecycle, PR_STATE.CANCELLED);
    assert.equal(prOf(r, 5).counted, false);
    assert.deepEqual(r.focus.ignored_prs, ['#5']);
  });

  test('progress counts only #2 and #4 as done', () => {
    assert.deepEqual([r.progress.overall.done, r.progress.overall.total], [2, 6]);
    assert.deepEqual([r.progress.current_module.done, r.progress.current_module.total], [2, 5]);
  });

  test('unlabelled open PRs are surfaced and never counted', () => {
    for (const n of [6, 7]) {
      assert.equal(prOf(r, n).counted, false);
      assert.ok(r.attention.some((a) => a.code === 'UNCLASSIFIED_PR' && a.pr === n));
    }
  });

  test('rendered dashboard shows the same facts', () => {
    const md = buildMarkdown(plan, live);
    assert.match(md.split('\n')[0], /AUTO-GENERATED — DO NOT EDIT MANUALLY/);
    assert.match(md, /## 🎯 VIỆC ĐANG LÀM/);
    assert.match(md, /\*\*M00-C1A1 — Chống xử lý lặp \(Idempotency\)\*\*/);
    assert.match(md, /\| (?:&nbsp;)*M00-C1A0 · Giao dịch \+ primitive dùng chung \| ✅ Hoàn thành \(`DONE`\).*\[#4\].*`688e796`/);
    assert.match(md, /\| (?:&nbsp;)*M00-C1A1 · Chống xử lý lặp \(Idempotency\) \| 🟦 Sẵn sàng giao Claude \(`READY_FOR_CLAUDE`\).*main HEAD `cfd901f`.*C1A0 Hoàn thành \(DONE\).*Claude triển khai/);
    assert.match(md, /\[#5\].*Đã hủy \/ bỏ qua \(`CANCELLED \/ IGNORED`\)/);
    assert.match(md, /```mermaid\nflowchart TD/);
    assert.match(md, /class M00_C1A1 focus/);
  });

  test('giao diện dashboard là tiếng Việt nhưng vẫn giữ mã kỹ thuật để audit', () => {
    const md = buildMarkdown(plan, live);
    assert.match(md, /## 🎯 VIỆC ĐANG LÀM/);
    assert.match(md, /## Tiến độ/);
    assert.match(md, /## Cây tiến độ/);
    assert.match(md, /## Chi tiết công việc/);
    assert.match(md, /## Danh sách Pull Request/);
    assert.match(md, /## ⚠️ Cần chú ý/);
    assert.match(md, /## Quy trình/);
    assert.match(md, /Sẵn sàng giao Claude \(`READY_FOR_CLAUDE`\)/);
    assert.match(md, /Hoàn thành \(`DONE`\)/);
    assert.match(md, /Đạt \(`PASS`\)/);
    assert.doesNotMatch(md, /## 🎯 CURRENT FOCUS|## Progress\n|## Task details|## Pull request ledger|## ⚠️ Attention/);
  });
  test('the committed docs/PROGRESS.md is the generator output for some snapshot (header intact)', () => {
    const committed = readFileSync(resolve(root, 'docs/PROGRESS.md'), 'utf8');
    assert.match(committed, /^<!-- AUTO-GENERATED — DO NOT EDIT MANUALLY/);
  });
});

describe('rendering untrusted text', () => {
  test('safeText neutralises HTML, links, pipes, backticks and newlines', () => {
    const hostile = 'x <script>alert(1)</script> [click](https://evil.example) | `rm`\nnext';
    const out = safeText(hostile, 200);
    assert.doesNotMatch(out, /<script|\]\(|\||`|\n/);
    assert.match(out, /&lt;script&gt;/);
  });

  test('a hostile PR title cannot inject markup into the dashboard', () => {
    const evil = pr({ number: 50, title: '<img src=x onerror=alert(1)> [pwn](https://evil.example) | | **DONE**', draft: true });
    const md = buildMarkdown(plan, snapshot([...history(), evil]));
    assert.doesNotMatch(md, /<img/);
    assert.doesNotMatch(md, /\]\(https:\/\/evil/);
    const row = md.split('\n').find((l) => l.includes('[#50]'));
    assert.equal(row.split('|').length, 9, 'table row keeps its 7 columns');
  });

  test('titles never reach the Mermaid block', () => {
    const evil = pr({ number: 50, title: 'EVIL_TITLE_MARKER', draft: true });
    const md = buildMarkdown(plan, snapshot([...history(), evil]));
    const mermaid = md.slice(md.indexOf('```mermaid'), md.indexOf('```', md.indexOf('```mermaid') + 3));
    assert.doesNotMatch(mermaid, /EVIL_TITLE_MARKER/);
  });
});

describe('dashboard follows the workflow', () => {
  const claudePr = (extra = {}) => pr({ number: 6, labels: ['agent:claude', 'type:implementation', 'module:M00-C1A1'], ...extra });
  const render = (pulls) => renderProgress(withPlan(resolveProgress(plan, snapshot(pulls)), plan));

  test('Claude coding: focus shows the active PR and Claude as owner', () => {
    const md = render([...history(), claudePr({ draft: true, checks: checks.running })]);
    assert.match(md, /\| \*\*Người phụ trách\*\* \| 🔵 \*\*CLAUDE\*\* \|/);
    assert.match(md, /\| \*\*PR đang hoạt động\*\* \| PR #6 \|/);
    assert.match(md, /CLAUDE_CODING/);
  });

  test('waiting for review: ChatGPT is the owner', () => {
    const md = render([...history(), claudePr({ checks: checks.pass })]);
    assert.match(md, /\| \*\*Người phụ trách\*\* \| 🟣 \*\*CHATGPT\*\* \|/);
    assert.equal(stateOf(resolveProgress(plan, snapshot([...history(), claudePr({ checks: checks.pass })])), 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW);
  });

  test('everything done: focus says so', () => {
    const labels = (id) => ['agent:claude', 'type:implementation', `module:${id}`];
    const done = [
      ...history(),
      ...[['M00-C1A1', 6], ['M00-C1B', 8], ['M00-C1C', 9]].map(([id, n]) => pr({ number: n, state: 'closed', merged_at: '2026-10-07T00:00:00Z', labels: labels(id), checks: checks.pass })),
      pr({ number: 20, state: 'closed', merged_at: '2026-10-07T00:00:00Z', labels: ['agent:chatgpt', 'type:design', 'module:M01'], checks: checks.pass }),
      pr({ number: 21, state: 'closed', merged_at: '2026-10-07T00:00:00Z', labels: labels('M01'), checks: checks.pass }),
    ];
    const r = resolveProgress(plan, snapshot(done));
    assert.equal(r.focus, null);
    assert.equal(r.progress.overall.percent, 100);
    assert.equal(taskOf(r, 'M01').state, STATE.DONE);
    assert.match(renderProgress(withPlan(r, plan)), /Tất cả task đã lập kế hoạch đều HOÀN THÀNH/);
  });
});
