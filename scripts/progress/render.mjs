// Renders the resolved progress model as docs/PROGRESS.md.
//
// Deterministic: no clock, no randomness, stable ordering. Only plan.yml text and enum values
// reach Mermaid; PR titles (untrusted) appear only in the ledger table and are neutralised first.

import { OWNER, PR_STATE, STATE, CI, shortId, shortSha } from './resolve.mjs';

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
  [OWNER.OWNER]: 'CHỦ DỰ ÁN',
  [OWNER.CI]: 'CI',
  [OWNER.NONE]: '—',
};
const OWNER_WORD = {
  [OWNER.CLAUDE]: 'Claude',
  [OWNER.CHATGPT]: 'ChatGPT',
  [OWNER.OWNER]: 'Chủ dự án',
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
  [CI.PASS]: '✅ Đạt (`PASS`)',
  [CI.FAIL]: '❌ Lỗi (`FAIL`)',
  [CI.RUNNING]: '⏳ Đang chạy (`RUNNING`)',
  [CI.NONE]: '—',
};
const PR_STATE_CELL = {
  [PR_STATE.MERGED]: 'Đã merge (`MERGED`)',
  [PR_STATE.CANCELLED]: '🚫 Đã hủy / bỏ qua (`CANCELLED / IGNORED`)',
  [PR_STATE.DRAFT]: 'Bản nháp (`DRAFT`)',
  [PR_STATE.OPEN]: 'Đang mở (`OPEN`)',
};

const STATE_LABEL_VI = {
  [STATE.PLANNED]: 'Đã lên kế hoạch',
  [STATE.DESIGNING]: 'Đang thiết kế',
  [STATE.DESIGN_REVIEW]: 'Chờ duyệt thiết kế',
  [STATE.DESIGN_LOCKED]: 'Thiết kế đã khóa',
  [STATE.READY_FOR_CLAUDE]: 'Sẵn sàng giao Claude',
  [STATE.CLAUDE_CODING]: 'Claude đang code',
  [STATE.CI_RUNNING]: 'CI đang chạy',
  [STATE.CI_FAILED]: 'CI thất bại',
  [STATE.WAITING_CHATGPT_REVIEW]: 'Chờ ChatGPT kiểm tra',
  [STATE.CHATGPT_REVIEW]: 'ChatGPT đang kiểm tra',
  [STATE.CHANGES_REQUESTED]: 'Cần sửa theo review',
  [STATE.READY_TO_MERGE]: 'Sẵn sàng merge',
  [STATE.DONE]: 'Hoàn thành',
  [STATE.BLOCKED_BY_DEPENDENCY]: 'Đang chờ công việc trước',
  [STATE.BLOCKED_BY_CI]: 'Bị chặn bởi CI',
};

const TITLE_VI = new Map([
  ['Foundation', 'Nền tảng'],
  ['Authentication', 'Xác thực'],
  ['Backend Foundation', 'Nền tảng Backend'],
  ['Transactional Core', 'Lõi giao dịch'],
  ['Transaction + Shared Primitives', 'Giao dịch + primitive dùng chung'],
  ['Idempotency', 'Chống xử lý lặp (Idempotency)'],
  ['Audit + Outbox Write', 'Audit + ghi Outbox'],
  ['Dispatcher + Final Integration', 'Dispatcher + tích hợp cuối'],
  ['Auth Core', 'Lõi xác thực (Auth Core)'],
  ['Onboarding (Shop + Driver)', 'Onboarding (Quán + Tài xế)'],
  ['Shop onboarding', 'Onboarding quán (Shop)'],
  ['Driver onboarding', 'Onboarding tài xế (Driver)'],
  ['Post-merge repairs (session, rollback, router, progress)', 'Sửa sau merge (session, rollback, router, tiến độ)'],
]);

const ROLE_VI = {
  design: 'thiết kế',
  combined: 'thiết kế + triển khai',
  implementation: 'triển khai',
  'review-fix': 'sửa sau review',
  infra: 'hạ tầng',
};

const titleVi = (value) => TITLE_VI.get(String(value)) ?? String(value);
const stateVi = (state) => STATE_LABEL_VI[state] ?? state;
const stateCell = (state) => `${STATE_ICON[state] ?? ''} ${stateVi(state)} (\`${state}\`)`;
const statePlain = (state) => `${stateVi(state)} (${state})`;

function noteVi(value) {
  const raw = String(value ?? '');
  const prefix = raw.match(/^(PR #\d+: )(.*)$/);
  if (prefix) return `${prefix[1]}${noteVi(prefix[2])}`;
  if (raw === 'Ignored by plan') return 'Bị bỏ qua theo kế hoạch';
  if (raw === 'Out of plan (type:infra)') return 'Ngoài kế hoạch (type:infra)';
  if (raw === 'Implementation opened by ChatGPT against the workflow, closed without merge. Not accepted.') {
    return 'PR triển khai do ChatGPT mở sai quy trình, đã đóng và không merge. Không được chấp nhận.';
  }
  let m = raw.match(/^no usable metadata \(missing (.+)\); PR not counted\. State is never inferred from titles, bodies or authors\.$/);
  if (m) return `thiếu metadata hợp lệ (thiếu ${m[1]}); PR không được tính. Trạng thái không bao giờ được suy ra từ tiêu đề, nội dung hoặc tác giả.`;
  m = raw.match(/^label module:(.+) does not match any task in plan\.yml; PR not counted\.$/);
  if (m) return `label module:${m[1]} không khớp task nào trong plan.yml; PR không được tính.`;
  if (raw === 'more than one module:/type: label; PR not counted.') return 'có nhiều hơn một label module:/type:; PR không được tính.';
  m = raw.match(/^(type:[^ ]+) on (module:[^ ]+) requires ([^ ]+) \(found (.+)\); PR not counted\.$/);
  if (m) return `${m[1]} trên ${m[2]} yêu cầu ${m[3]} (hiện có ${m[4]}); PR không được tính.`;
  return raw;
}

function reasonVi(value) {
  const raw = String(value ?? '');
  let m = raw.match(/^waiting for (.+)$/);
  if (m) return `đang chờ ${m[1]}`;
  m = raw.match(/^design locked; (\d+)\/(\d+) child tasks done$/);
  if (m) return `thiết kế đã khóa; ${m[1]}/${m[2]} task con đã hoàn thành`;
  if (raw === 'merged PR has failing required checks; not counted as DONE') return 'PR đã merge nhưng required check đang lỗi; chưa được tính HOÀN THÀNH';
  if (raw === 'merged PR has no verified green required checks; not counted as DONE') return 'PR đã merge nhưng chưa xác minh required check xanh; chưa được tính HOÀN THÀNH';
  m = raw.match(/^main CI is (.+); required checks must be green on main$/);
  if (m) return `CI của main đang ${m[1]}; required check phải xanh trên main`;
  return raw;
}

function focusTextVi(state, actor) {
  const chatgpt = {
    [STATE.READY_FOR_CLAUDE]: 'Chờ Claude triển khai trước khi kiểm tra',
    [STATE.CLAUDE_CODING]: 'Chờ Claude hoàn tất triển khai trước khi kiểm tra',
    [STATE.CI_RUNNING]: 'Chờ CI trước khi kiểm tra',
    [STATE.CI_FAILED]: 'Chờ Claude sửa CI trước khi kiểm tra',
    [STATE.WAITING_CHATGPT_REVIEW]: 'Cần kiểm tra',
    [STATE.CHATGPT_REVIEW]: 'Đang kiểm tra',
    [STATE.CHANGES_REQUESTED]: 'Chờ Claude xử lý các finding',
    [STATE.READY_TO_MERGE]: 'Đã kiểm tra PASS',
    [STATE.PLANNED]: 'Cần thiết kế',
    [STATE.DESIGNING]: 'Đang thiết kế',
    [STATE.DESIGN_REVIEW]: 'Đã gửi thiết kế; chờ Chủ dự án',
  };
  const claude = {
    [STATE.READY_FOR_CLAUDE]: 'Sẵn sàng triển khai',
    [STATE.CLAUDE_CODING]: 'Đang code',
    [STATE.CI_RUNNING]: 'Đã push triển khai; đang chờ CI',
    [STATE.CI_FAILED]: 'Sửa CI đang lỗi',
    [STATE.WAITING_CHATGPT_REVIEW]: 'Chờ kết quả kiểm tra',
    [STATE.CHATGPT_REVIEW]: 'Chờ kết quả kiểm tra',
    [STATE.CHANGES_REQUESTED]: 'Sửa các finding của ChatGPT',
    [STATE.READY_TO_MERGE]: 'Chờ',
  };
  if (actor === 'chatgpt') return chatgpt[state] ?? 'Chưa có việc cần làm';
  if (actor === 'claude') return claude[state] ?? 'Chưa bắt đầu (chưa được mở khóa)';
  if (state === STATE.READY_TO_MERGE) return 'Quyết định merge';
  if (state === STATE.DESIGN_REVIEW) return 'Khóa hoặc từ chối thiết kế';
  return 'Không cần thao tác';
}

function nextGateVi(focus) {
  const gates = {
    [STATE.READY_FOR_CLAUDE]: 'PR triển khai (agent:claude, type:implementation, module label) + required CI xanh',
    [STATE.CLAUDE_CODING]: 'Claude chuyển PR sang sẵn sàng review + required CI xanh',
    [STATE.CI_RUNNING]: 'Required CI xanh',
    [STATE.CI_FAILED]: 'Required CI xanh trở lại',
    [STATE.WAITING_CHATGPT_REVIEW]: 'Kết quả kiểm tra ChatGPT trên head SHA hiện tại',
    [STATE.CHATGPT_REVIEW]: 'Kết quả kiểm tra ChatGPT trên head SHA hiện tại',
    [STATE.CHANGES_REQUESTED]: 'Claude sửa finding, CI xanh, ChatGPT kiểm tra lại',
    [STATE.READY_TO_MERGE]: 'Chủ dự án merge PR',
    [STATE.PLANNED]: 'PR thiết kế của ChatGPT',
    [STATE.DESIGNING]: 'PR thiết kế sẵn sàng review',
    [STATE.DESIGN_REVIEW]: 'Chủ dự án khóa thiết kế (merge)',
    [STATE.BLOCKED_BY_DEPENDENCY]: `Các dependency phải HOÀN THÀNH: ${focus.blocked_by.map(shortId).join(', ')}`,
    [STATE.BLOCKED_BY_CI]: 'Required check trên main phải xanh',
  };
  return gates[focus.state] ?? '';
}

function nextActionVi(task) {
  const pr = task.pr != null ? ` #${task.pr}` : '';
  switch (task.state) {
    case STATE.DONE: return '—';
    case STATE.BLOCKED_BY_DEPENDENCY: return `Chờ ${task.unmet.map(shortId).join(', ')}`;
    case STATE.BLOCKED_BY_CI: return 'Sửa required check trên main';
    case STATE.READY_FOR_CLAUDE: return 'Claude triển khai';
    case STATE.CLAUDE_CODING: return `Claude hoàn tất PR${pr}, chuyển sang ready`;
    case STATE.CI_RUNNING: return `Chờ CI${pr ? ` trên PR${pr}` : ''}`;
    case STATE.CI_FAILED: return `Claude sửa CI${pr ? ` trên PR${pr}` : ''}`;
    case STATE.WAITING_CHATGPT_REVIEW: return `ChatGPT kiểm tra PR${pr}`;
    case STATE.CHATGPT_REVIEW: return `ChatGPT hoàn tất kiểm tra PR${pr}`;
    case STATE.CHANGES_REQUESTED: return `Claude sửa finding trên PR${pr}`;
    case STATE.READY_TO_MERGE: return `Chủ dự án merge PR${pr}`;
    case STATE.PLANNED: return 'ChatGPT thiết kế';
    case STATE.DESIGNING: return `ChatGPT hoàn tất PR thiết kế${pr}`;
    case STATE.DESIGN_REVIEW: return `Chủ dự án duyệt và khóa PR thiết kế${pr}`;
    case STATE.DESIGN_LOCKED: return 'Tiếp tục các task con';
    default: return '—';
  }
}

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
    lines.push(`  subgraph ${mermaidId(m.id)}_box["${mermaidText(`${m.id} · ${titleVi(m.title)}`)}"]`);
    for (const t of inModule) {
      const label = [
        `${t.id}${t.kind === 'group' ? ' (thiết kế)' : ''}`,
        titleVi(t.title),
        `${OWNER_ICON[t.owner]} ${OWNER_LABEL[t.owner]}`,
        statePlain(t.state),
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
  return task.own_deps.map((d) => `${shortId(d.id)} ${statePlain(d.state)}`).join(', ');
}

/**
 * Names main without ever presenting a CI-bearing older commit as the head. When the head is a
 * progress-bot commit its SHA is deliberately not printed: it changes with every dashboard commit,
 * so printing it would make every regeneration produce another commit.
 */
function mainRef(main) {
  if (main.head_is_progress_commit) return `mã main \`${shortSha(main.ci_sha)}\``;
  return main.head_sha ? `main HEAD \`${shortSha(main.head_sha)}\`` : '';
}

function mainBanner(main) {
  const ref = mainRef(main) || 'main chưa xác định';
  const note = main.head_is_progress_commit
    ? ' (HEAD là commit progress-bot chỉ sửa tài liệu; CI được đọc từ commit mã này)'
    : main.ci === CI.NONE && main.head_sha
      ? ' (chưa xác minh CI cho HEAD; không dùng kết quả của commit cũ)'
      : '';
  return `${ref}${note}`;
}

function headCell(task, model) {
  if (task.state === STATE.READY_FOR_CLAUDE) return mainRef(model.main) || 'main';
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
  out.push(`# ${project.name} — Tiến độ dự án`);
  out.push('');
  out.push('> **TỰ ĐỘNG TẠO — KHÔNG SỬA THỦ CÔNG**');
  out.push('>');
  out.push('> Kế hoạch nằm trong [`docs/progress/plan.yml`](progress/plan.yml); trạng thái được suy ra từ GitHub (PR đã merge, draft/open/closed, label, head SHA, required check và dependency). Không ai, kể cả người hay AI, có thể tự ghi một task thành HOÀN THÀNH. Xem [cách suy ra trạng thái](progress/README.md).');
  out.push(`> Dữ liệu theo ${mainBanner(model.main)} · CI main: ${CI_CELL[model.main.ci]}`);
  out.push('');

  // Delivery stages are planned separately; group design state is not proof of UI lock or Owner UAT.
  if (model.tasks.some((task) => task.id === 'M00-LOCAL')) {
    out.push('## Các luồng song song và checklist');
    out.push('');
    out.push('Nghiệp vụ → thiết kế backend/UI → triển khai → E2E → Owner nghiệm thu. Backend DONE không đồng nghĩa UI hoặc bản dùng thử đã đạt.');
    out.push('');
    out.push('| Luồng | Thiết kế | Công việc / checklist |');
    out.push('|---|---|---|');
    for (const [id, label, path] of [
      ['M00-LOCAL', 'M00 — môi trường test local', 'M00-delivery-checklist.md'],
      ['M01-UI', 'M01 — UI và bản thử Auth/onboarding', 'M01-delivery-checklist.md'],
      ['M02-A', 'M02 — nghiệp vụ hồ sơ và lịch quán', 'M02-delivery-checklist.md'],
    ]) {
      const task = model.tasks.find((candidate) => candidate.id === id);
      if (task) out.push(`| ${label} | ${stateCell(task.design_state)}${task.design_pr ? ` · #${task.design_pr}` : ''} | [Checklist](${`tasks/${path}`}) · xem dependency từng gói bên dưới |`);
    }
    out.push('');
    out.push('Thiết kế UI được làm trong khi chuẩn bị môi trường. Frame Figma và xác nhận Owner nằm trong evidence; CI không tự xác nhận hai bước này. [Quy trình đầy đủ](tasks/module-delivery-workflow.md).');
    out.push('');
  }

  // CURRENT FOCUS
  out.push('## 🎯 VIỆC ĐANG LÀM');
  out.push('');
  if (!focus) {
    out.push('**Tất cả task đã lập kế hoạch đều HOÀN THÀNH.** Thêm task tiếp theo vào `docs/progress/plan.yml`.');
  } else {
    const blockedBy = focus.blocked_by.length ? focus.blocked_by.map(shortId).join(', ') : 'Không';
    out.push('| | |');
    out.push('|---|---|');
    out.push(`| **Task** | **${focus.task} — ${safeText(titleVi(focus.title))}** |`);
    out.push(`| **Trạng thái** | ${stateCell(focus.state)} |`);
    out.push(`| **Người phụ trách** | ${OWNER_ICON[focus.owner]} **${OWNER_LABEL[focus.owner]}** |`);
    out.push(`| **ChatGPT** | ${focusTextVi(focus.state, 'chatgpt')} |`);
    out.push(`| **Claude** | ${focusTextVi(focus.state, 'claude')} |`);
    out.push(`| **Chủ dự án** | ${focusTextVi(focus.state, 'owner')} |`);
    out.push(`| **Đang bị chặn bởi** | ${blockedBy} |`);
    out.push(`| **Điều kiện sang bước tiếp** | ${nextGateVi(focus)} |`);
    if (focus.pr) out.push(`| **PR đang hoạt động** | ${focus.pr} |`);
    if (focus.ignored_prs.length) out.push(`| **PR bị bỏ qua** | ${focus.ignored_prs.join(', ')} (đã hủy, không bao giờ được tính) |`);
    if (focus.reason) out.push(`| **Ghi chú** | ${safeText(reasonVi(focus.reason), 120)} |`);
  }
  out.push('');

  // Progress
  out.push('## Tiến độ');
  out.push('');
  out.push('Tính theo trọng số task trong kế hoạch (mỗi task lá = 1 nếu không ghi khác). Commit, số dòng code và PR đã hủy không được tính. Phần trăm được làm tròn xuống.');
  out.push('');
  out.push('| Phạm vi | Hoàn thành / tổng |');
  out.push('|---|---|');
  const cur = progress.current_module;
  if (cur) out.push(`| Milestone hiện tại — ${cur.id} ${safeText(titleVi(cur.title))} | ${pct(cur)} |`);
  out.push(`| Toàn bộ — chỉ tính task đã lập kế hoạch${model.roadmap_complete ? '' : ' (roadmap chưa chốt hết)'} | ${pct(progress.overall)} |`);
  for (const m of progress.modules) {
    if (cur && m.id === cur.id) continue;
    out.push(`| Module ${m.id} ${safeText(titleVi(m.title))} | ${pct(m)} |`);
  }
  out.push('');

  // Tree
  out.push('## Cây tiến độ');
  out.push('');
  out.push('Mũi tên liền là dependency, mũi tên nét đứt là task cha → task con đầu tiên. Viền vàng đậm là việc đang làm.');
  out.push('');
  out.push('```mermaid');
  out.push(renderMermaid(model, model._planModules));
  out.push('```');
  out.push('');

  // Details table
  out.push('## Chi tiết công việc');
  out.push('');
  out.push('| Task | Trạng thái | Người phụ trách | PR | CI | Head | Dependency | Việc tiếp theo |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const t of model.tasks) {
    const indent = '&nbsp;&nbsp;'.repeat(t.depth);
    const name = t.kind === 'group' ? `**${t.id}** thiết kế · ${safeText(titleVi(t.title))}` : `${t.id} · ${safeText(titleVi(t.title))}`;
    const owner = t.owner === OWNER.NONE ? '—' : OWNER_WORD[t.owner];
    out.push(
      `| ${indent}${name} | ${stateCell(t.state)} | ${owner} | ${prCell(repo, t.pr)} | ${CI_CELL[t.ci]} | ${headCell(t, model)} | ${dependencyCell(t)} | ${nextActionVi(t)} |`,
    );
  }
  out.push('');

  // PR ledger
  out.push('## Danh sách Pull Request');
  out.push('');
  out.push('Cách hệ thống xử lý từng PR. PR chỉ được tính qua metadata rõ ràng (label hoặc số PR được ghim trong kế hoạch), không bao giờ suy ra từ tiêu đề, nội dung hay tác giả.');
  out.push('');
  out.push('| PR | Vòng đời | Task | Vai trò | CI trên head | Head | Cách tính |');
  out.push('|---|---|---|---|---|---|---|');
  for (const p of model.prs) {
    const treated = p.counted ? 'được tính' : p.lifecycle === PR_STATE.CANCELLED ? '🚫 không tính (đã hủy)' : p.role === 'infra' ? 'ngoài kế hoạch' : '⚠️ không tính';
    const note = p.note ? ` — ${safeText(noteVi(p.note), 110)}` : '';
    out.push(
      `| ${prCell(repo, p.number)} ${safeText(p.title, 60)} | ${PR_STATE_CELL[p.lifecycle]} | ${p.task ?? '—'} | ${ROLE_VI[p.role] ?? p.role ?? '—'} | ${CI_CELL[p.ci]} | \`${shortSha(p.head_sha)}\` | ${treated}${note} |`,
    );
  }
  out.push('');

  // Attention
  out.push('## ⚠️ Cần chú ý');
  out.push('');
  if (model.attention.length === 0) {
    out.push('Không có vấn đề nào cần chú ý.');
  } else {
    for (const a of model.attention) out.push(`- \`${a.code}\` ${safeText(noteVi(a.message), 260)}`);
  }
  out.push('');

  // Legend
  out.push('## Quy trình');
  out.push('');
  out.push('`KẾ HOẠCH → CHATGPT THIẾT KẾ → THIẾT KẾ ĐÃ KHÓA → SẴN SÀNG GIAO CLAUDE → CLAUDE CODE → CI → CHỜ CHATGPT KIỂM TRA → CHATGPT KIỂM TRA → SẴN SÀNG MERGE → ĐÃ MERGE / ĐÃ KHÓA → task tiếp theo`');
  out.push('');
  out.push('ChatGPT thiết kế và kiểm tra, Claude triển khai và test, Chủ dự án chốt quyết định và merge. Không có gì được tự động merge.');
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
