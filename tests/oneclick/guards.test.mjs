import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pendingFrom, migrationPlan, checkGrants, checkArchiveMembers, nonDestructiveUp } from '../../scripts/deploy/deploy-check.mjs';

test('preflight must be complete; missing, duplicate or truncated pending entries are not guessed', () => {
  assert.deepEqual(pendingFrom('db:migrate:remote: 1 applied, 0 pending of 1 migration file(s)\ndb:migrate:remote: check only; nothing was changed.'), []);
  for (const text of ['', 'db:migrate:remote: 1 applied, 1 pending of 2 migration file(s)\ncheck only; nothing was changed.']) assert.throws(() => pendingFrom(text));
});
test('unknown, modified or review-only migration blocks before any SQL mutation', () => {
  const dir=mkdtempSync(join(tmpdir(),'deploy-policy-'));
  try {
    for (const r of ['new','old']) mkdirSync(join(dir,r,'database/migrations'),{recursive:true});
    mkdirSync(join(dir,'new/scripts/deploy'),{recursive:true});
    writeFileSync(join(dir,'new/database/migrations/123_new.sql'),'CREATE TABLE app.x (id int);');
    const log='db:migrate:remote: 0 applied, 1 pending of 1 migration file(s)\ndb:migrate:remote:   pending 123_new\ndb:migrate:remote: check only; nothing was changed.';
    const policy=join(dir,'new/scripts/deploy/migration-policy.json');
    writeFileSync(policy,JSON.stringify({migrations:{}}));
    assert.throws(()=>migrationPlan(join(dir,'new'),join(dir,'old'),log),/REQUIRES_REVIEW/);
    const digest=createHash('sha256').update(readFileSync(join(dir,'new/database/migrations/123_new.sql'))).digest('hex');
    writeFileSync(policy,JSON.stringify({migrations:{'123_new':{sha256:digest,autoApply:true}}}));
    assert.equal(migrationPlan(join(dir,'new'),join(dir,'old'),log).rollbackSafe,false);
    writeFileSync(join(dir,'new/database/migrations/123_new.sql'),'DROP TABLE app.users;');
    assert.throws(()=>migrationPlan(join(dir,'new'),join(dir,'old'),log),/REQUIRES_REVIEW/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('the checked-in migration policy is immutable and risky backfills are closed', () => {
  const policy=JSON.parse(readFileSync('scripts/deploy/migration-policy.json','utf8'));
  for(const [name,rule] of Object.entries(policy.migrations)) { const bytes=readFileSync(`database/migrations/${name}.sql`); assert.equal(createHash('sha256').update(bytes).digest('hex'),rule.sha256); if(rule.autoApply)assert.equal(nonDestructiveUp(bytes),true,name); }
  for(const name of ['1793059200000_account-scope-lifecycle-settings','1793318400000_create-shipper-management','1793836800000_m06-v1-1-three-tiers-agreement']) assert.equal(policy.migrations[name].autoApply,false);
  checkGrants('.');
});
test('reject tar traversal, absolute paths, symlinks, devices and unexpected roots', () => {
  checkArchiveMembers([{name:'release/x',type:'file'}],'release');
  for(const item of [{name:'release/../../etc/passwd',type:'file'},{name:'/etc/passwd',type:'file'},{name:'release/key',type:'symlink'},{name:'release/dev',type:'device'},{name:'other/x',type:'file'}]) assert.throws(()=>checkArchiveMembers([item],'release'));
});

test('helper never logs raw DB output or mutates production configuration', () => {
  const script=readFileSync('scripts/deploy/deploy-vps.sh','utf8');
  assert.doesNotMatch(script,/journalctl|set -x|--apply.*down|DROP DATABASE|pg_drop|staging-seed/);
  assert.match(script,/flock -n 9/);
  assert.match(script,/pg_restore --list/);
  assert.match(script,/unsafe-schema-changed/);
  assert.match(script,/cmp -s.*apps\/admin-web\/dist\/index.html/);
});

test('data-destructive Up is refused even if somebody marks its hash autoApply', () => {
  for(const sql of ['DROP TABLE app.users;', 'TRUNCATE app.users;', 'DELETE FROM app.users;', 'UPDATE app.users SET full_name=null;', 'DO $$ BEGIN DROP TABLE app.users; END $$;']) assert.equal(nonDestructiveUp(sql),false,sql);
  assert.equal(nonDestructiveUp('CREATE FUNCTION app.f() RETURNS void AS $$ BEGIN DELETE FROM app.x; END; $$ LANGUAGE plpgsql;'),true);
});
