#!/usr/bin/env node
// Validate PR's durable agent intake/final evidence. Never run PR-authored code in a privileged workflow.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Grandfather pre-existing PRs to avoid blocking unrelated in-flight work. They must adopt
// the protocol when an agent resumes, but enforcement begins for newly created PRs.
export const EFFECTIVE_FOR_PRS_CREATED_AT_OR_AFTER = '2026-10-27T16:30:00Z';
export const REQUIRED = [
  'Executor', 'Rules-read', 'Scope', 'Baseline-SHA', 'Sync-preflight',
  'Scope-checklist', 'Tests', 'Sync-postflight', 'Remote-head-SHA', 'Open-blockers',
];
const invalid = value => !value || /^(?:TODO|TBD|PENDING|PLACEHOLDER|N\/A|UNKNOWN|-)$/i.test(value.trim())
  || /^\[.*\]$/.test(value.trim()) || /<[^>]+>/.test(value);

export function validate(body, { draft = false, createdAt = '1970-01-01T00:00:00Z' } = {}) {
  const marker = '<!-- 11ship-agent-report:v1 -->';
  const enforced = Date.parse(createdAt) >= Date.parse(EFFECTIVE_FOR_PRS_CREATED_AT_OR_AFTER)
    || (body || '').includes(marker);
  if (!enforced) return { passed: true, enforced: false, warnings: ['Legacy PR: manual review/next-resume adoption required'], errors: [] };
  const errors = [];
  if (!(body || '').includes(marker)) errors.push('Missing report marker');
  const values = new Map();
  for (const line of (body || '').split(/\r?\n/)) {
    const match = /^-\s+([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (match && !values.has(match[1])) values.set(match[1], match[2].trim());
  }
  for (const key of REQUIRED) if (invalid(values.get(key))) errors.push('Missing usable ' + key);
  const exec = values.get('Executor') || '';
  if (!/^(?:CLAUDE_LOCAL|CLAUDE_CLOUD|CODEX_CLOUD|CODEX_LOCAL)$/i.test(exec)) errors.push('Invalid Executor');
  const read = values.get('Rules-read') || '';
  if (!read.includes('AGENTS.md') || !read.includes('docs/ai-governance/README.md'))
    errors.push('Rules-read must mention both mandatory entrypoints');
  if (/^CODEX_/i.test(exec) && !read.includes('docs/ai-governance/CODEX-EXECUTION.md'))
    errors.push('Codex must confirm reading its role contract');
  if (/^CLAUDE_/i.test(exec) && !read.includes('CLAUDE.md'))
    errors.push('Claude must confirm reading CLAUDE.md');
  for (const shaKey of ['Baseline-SHA', 'Remote-head-SHA']) {
    const sha = values.get(shaKey) || '';
    if (!/^[0-9a-f]{40}$/i.test(sha)) errors.push(shaKey + ' must be full 40-character SHA');
  }
  const blockers = values.get('Open-blockers') || '';
  if (/^(?:BLOCKED|UNRESOLVED)(?:\b|:)/i.test(blockers)) errors.push('Material blocker remains unresolved');
  // A draft may be incomplete while coding; do not block development.
  return { passed: draft || errors.length === 0, enforced, warnings: draft && errors.length ? ['Draft: evidence incomplete; required before Ready for Review'] : [], errors: draft ? [] : errors };
}

function main() {
  const file = process.env.GITHUB_EVENT_PATH;
  if (!file) throw Error('GITHUB_EVENT_PATH missing');
  const event = JSON.parse(readFileSync(file, 'utf8'));
  const pr = event.pull_request;
  if (!pr) throw Error('This check only supports PR events');
  const result = validate(pr.body || '', { draft: Boolean(pr.draft), createdAt: pr.created_at });
  const note = (result.passed ? 'PASS' : 'FAIL') + ': ' +
    (result.enforced ? 'governance evidence' : 'pre-policy legacy PR') +
    ', PR #' + pr.number + ', head ' + String(pr.head?.sha || '').slice(0, 12);
  console.log(note);
  for (const issue of [...result.errors, ...result.warnings]) console.log('- ' + issue);
  if (!result.passed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error('Governance report validation failed: ' + error.message); process.exitCode = 2; }
}
