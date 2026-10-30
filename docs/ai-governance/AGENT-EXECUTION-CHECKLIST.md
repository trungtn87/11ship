# Agent task lifecycle — required template

Use in PR description or a durable PR/Issue comment, not in generated `docs/PROGRESS.md`. Every developer must use this regardless of Claude local or Codex Cloud. Replace placeholders; do not claim unverified evidence.

## START / PREFLIGHT
- Owner-approved scope / issues:
- Executor (Claude | Codex), environment (Windows local | Cloud), one active owner:
- Confirm read: AGENTS.md, docs/ai-governance/README.md, role instructions, workflow, relevant runbooks:
- Branch / PR / local worktree (if accessible):
- Base SHA / remote PR HEAD / local HEAD (or LOCAL_UNVERIFIED):
- git status, untracked files, ahead/behind or divergence:
- Sync state: SYNCED | LOCAL_AHEAD | REMOTE_AHEAD | DIVERGED | LOCAL_UNVERIFIED | CONFLICT; evidence/time:
- Independent work allowed; blocked dependent operations:
- Checklist / affected test plan / design questions:

## MILESTONE / BLOCKER
- Completed / in progress / not done / not tested:
- Commit and latest SHA:
- Focused tests (result and evidence):
- Blockers or decisions requested of ChatGPT; no unilateral product choice:

## END / POSTFLIGHT / HANDOFF
- Scope checklist and outstanding items:
- Local SHA / remote verified SHA / current PR HEAD:
- Pending uncommitted or unpushed changes; safe worktree location:
- Sync state, result of fetch/fast-forward/push, conflicts and follow-up:
- Tests, CI run URLs and SHA covered; limits:
- Next executor, handoff checkpoint and confirmation old executor stopped:
- How Owner tests affected Android/web behavior:
- ChatGPT review / Owner merge approval: (reserved for authorized decision)
- Owner deploy/APK approval and actual release evidence: (reserved)
