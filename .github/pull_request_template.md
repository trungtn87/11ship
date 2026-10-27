## Owner-approved scope
- Related issues:
- Design/requirements approval:
- Executor: Claude local / Codex Cloud / other (specify), one active executor:
- Confirmation: read [AGENTS.md](../AGENTS.md), [AI Governance](../docs/ai-governance/README.md), [execution checklist](../docs/ai-governance/AGENT-EXECUTION-CHECKLIST.md) on start/resume:

## Preflight (mandatory, non-blocking where safe)
- Branch/worktree, remote and local SHA or LOCAL_UNVERIFIED:
- Dirty/untracked, ahead/behind, remote PR head:
- Sync status and safe action / independent-scope rationale:

## Implemented and checked
- Approved checklist completion and remaining items:
- Focused tests, CI links and exact code SHA:
- Blockers escalated to ChatGPT and Owner decisions:

## Postflight (mandatory)
- Final local SHA and verified GitHub branch SHA; unpushed/uncommitted work:
- Safe sync actions and remaining differences:
- Next executor / handoff checkpoint / device-test directions:

## Authority gates
- [ ] ChatGPT independently reviewed diff against approved scope
- [ ] Owner explicitly approved merging this PR (link/reference)
- [ ] Merge not yet performed unless approval above is recorded
- [ ] Production deploy/APK publication separately authorized if relevant

> Incomplete sync is not itself a blanket code-work blocker; never overwrite uncommitted work. For pure documentation-only PRs, mark non-applicable technical sections N/A with reason. No rule here installs a local Windows Sync Guard.
