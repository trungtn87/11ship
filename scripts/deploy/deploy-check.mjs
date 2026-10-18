// Pure deployment guards, shared by the production helper and executable tests.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function pendingFrom(text) {
  const summary = /db:migrate:remote: (\d+) applied, (\d+) pending of (\d+) migration file\(s\)/.exec(text);
  const names = [...text.matchAll(/^db:migrate:remote:   pending ([0-9]+_[a-z0-9_-]+)$/gm)].map(x => x[1]);
  if (!summary || Number(summary[2]) !== names.length || new Set(names).size !== names.length || !text.includes('check only; nothing was changed.')) throw Error('PREFLIGHT_INVALID');
  return names;
}
export function migrationPlan(release, previous, text) {
  const names = pendingFrom(text);
  const policy = JSON.parse(readFileSync(join(release, 'scripts/deploy/migration-policy.json'), 'utf8'));
  for (const name of names) {
    const bytes = readFileSync(join(release, 'database/migrations', `${name}.sql`));
    const rule = policy.migrations[name];
    if (!rule || rule.autoApply !== true || rule.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error(`MIGRATION_REQUIRES_REVIEW:${name}`);
  }
  // Existing migrations cannot be rewritten under already-running application code.
  for (const file of readdirSync(join(previous, 'database/migrations')).filter(n => n.endsWith('.sql'))) {
    const target = join(release, 'database/migrations', file);
    if (!existsSync(target) || !readFileSync(target).equals(readFileSync(join(previous, 'database/migrations', file)))) throw Error('MIGRATION_HISTORY_CHANGED');
  }
  return { pending: names, rollbackSafe: names.length === 0 };
}
export function checkGrants(release) {
  for (const file of ['02-runtime-grants.sql', '03-runtime-function-grants.sql']) {
    const sql = readFileSync(join(release, 'ops/selfhosted', file), 'utf8').replace(/--[^\n]*/g, '').trim();
    const statements = sql.split(';').map(x => x.trim()).filter(Boolean);
    if (!statements.length || statements.some(x => !/^GRANT (?:SELECT|INSERT|UPDATE|DELETE|EXECUTE)(?:,\s*(?:SELECT|INSERT|UPDATE|DELETE))* ON (?:FUNCTION )?app\.[a-z_]+(?:\([a-z ,]*\))? TO ship11_app$/i.test(x))) throw Error('GRANTS_REQUIRES_REVIEW');
  }
}
export function checkArchiveMembers(members, root) {
  if (!members.length || members.some(x => !['file', 'directory'].includes(x.type) || x.name.startsWith('/') || x.name.split('/').includes('..') || !(x.name === root || x.name.startsWith(`${root}/`)))) throw Error('ARCHIVE_UNSAFE');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [release, previous, log] = process.argv.slice(2);
    checkGrants(release);
    console.log(JSON.stringify(migrationPlan(release, previous, readFileSync(log, 'utf8'))));
  } catch (e) {
    // Our guards emit fixed codes and validated migration names, never exception text from IO/DB.
    const safe = /^(PREFLIGHT_INVALID|MIGRATION_REQUIRES_REVIEW:[0-9]+_[a-z0-9_-]+|MIGRATION_HISTORY_CHANGED|GRANTS_REQUIRES_REVIEW)$/.test(e.message) ? e.message : 'DEPLOY_POLICY_INVALID';
    console.error(safe); process.exitCode = 1;
  }
}
