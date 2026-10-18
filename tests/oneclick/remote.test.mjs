// Execute the REAL Bash state machine in disposable filesystem fixtures. OS/DB/network commands are explicit doubles.
// No production addresses are contacted; no production unit, database or secret is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, readlinkSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
const sha='a'.repeat(40), oldSha='b'.repeat(40), job='c'.repeat(32);
const helper=readFileSync('scripts/deploy/deploy-vps.sh','utf8');
const guard=readFileSync('scripts/deploy/deploy-check.mjs','utf8');
const hash=x=>createHash('sha256').update(x).digest('hex');
const mock=`#!${process.execPath}
const fs=require('fs'),cp=require('child_process'),path=require('path');
const cmd=path.basename(process.argv[1]),a=process.argv.slice(2),root=process.env.FIXTURE;
fs.appendFileSync(root+'/calls',cmd+' '+a.join(' ')+'\\n');
const current=fs.readlinkSync(root+'/opt/11ship/current');
const isNew=current.includes('${sha}');
const mode=process.env.CASE;
if(cmd==='id'){console.log('0');process.exit(0)}
if(cmd==='df'){console.log('Filesystem 1M-blocks Used Available Use% Mounted on\\nfixture 4000 1000 3000 25% /');process.exit(0)}
if(cmd==='sleep'){process.exit(0)}
if(cmd==='systemctl'){
 if(a[0]==='is-active') {if(mode==='service-fails'&&isNew){console.log('failed');process.exit(3)} console.log('active');process.exit(0)}
 if(a[0]==='restart'&&mode==='restart-fails'&&isNew)process.exit(1);
 process.exit(0);
}
if(cmd==='runuser'){const i=a.indexOf('--');const r=cp.spawnSync(a[i+1],a.slice(i+2),{stdio:'inherit',env:process.env});process.exit(r.status??1)}
if(cmd==='pg_dump'){if(mode==='backup-fails')process.exit(1);process.stdout.write('PGDMP-fixture');process.exit(0)}
if(cmd==='pg_restore'){process.exit(mode==='backup-invalid'?1:0)}
if(cmd==='psql'){if(a.includes('-c'))console.log('ship11_staging');process.exit(mode==='grants-fails'&&a.includes('-f')?1:0)}
if(cmd==='curl'){
 if(['health-fails','unsafe-rollback'].includes(mode)&&isNew)process.exit(22);
 const i=a.indexOf('-o');if(i>=0){fs.copyFileSync(current+'/apps/admin-web/dist/index.html',a[i+1]);process.exit(0)}
 console.log('{"data":{"status":"ready"}}');process.exit(0)
}
if(cmd==='node'){
 if(a[0]?.endsWith('verify-ubuntu-artifact.mjs'))process.exit(0);
 if(a[0]?.endsWith('db-migrate-remote.js')){
   if(a.includes('--apply')){fs.writeFileSync(root+'/applied','yes');process.exit(mode==='migration-fails'?1:0)}
   const pending=(mode==='with-migration'||mode==='migration-fails'||mode==='unsafe-rollback')&&!fs.existsSync(root+'/applied')?1:0;
   console.log('db:migrate:remote: '+(pending?0:1)+' applied, '+pending+' pending of 1 migration file(s)');
   if(pending)console.log('db:migrate:remote:   pending 123_new');
   console.log('db:migrate:remote: check only; nothing was changed.');process.exit(0)
 }
 const r=cp.spawnSync(process.env.REAL_NODE,a,{stdio:'inherit',env:process.env});process.exit(r.status??1)
}
process.exit(1);
`;
function fixture(mode){
 const d=mkdtempSync(join(tmpdir(),'ship11-deploy-'));
 const root=join(d,'opt/11ship'), old=join(root,`releases/11ship-${oldSha}-ubuntu24-amd64`), upload=join(d,`root/11ship-upload/${job}`), top=`11ship-${sha}-ubuntu24-amd64`, fresh=join(d,'stage',top);
 for(const dir of [old,fresh]){
  for(const sub of ['apps/admin-web/dist','database/migrations','scripts/deploy','ops/selfhosted'])mkdirSync(join(dir,sub),{recursive:true});
  writeFileSync(join(dir,'RELEASE.json'),JSON.stringify({sourceSha:dir===old?oldSha:sha}));
  writeFileSync(join(dir,'apps/admin-web/dist/index.html'),dir===old?'OLD':'NEW');
  for(const file of ['02-runtime-grants.sql','03-runtime-function-grants.sql'])writeFileSync(join(dir,'ops/selfhosted',file),'GRANT SELECT ON app.users TO ship11_app;\n');
 }
 mkdirSync(join(d,'etc/11ship'),{recursive:true});writeFileSync(join(d,'etc/11ship/staging.env'),'APP_ENV=production\n');
 mkdirSync(join(d,'root/ship11-secrets'),{recursive:true});writeFileSync(join(d,'root/ship11-secrets/operator.env'),'APP_ENV=production\nDB_REMOTE_TARGET=SELF_HOSTED\n');
 mkdirSync(upload,{recursive:true});mkdirSync(join(d,'var/lock'),{recursive:true});mkdirSync(join(d,'bin'));
 symlinkSync(old,join(root,'current'));
 if(mode==='unchanged')writeFileSync(join(old,'RELEASE.json'),JSON.stringify({sourceSha:sha}));
 writeFileSync(join(fresh,'scripts/deploy/deploy-check.mjs'),guard);
 const sql='CREATE TABLE app.fixture (id int);\n';writeFileSync(join(fresh,'database/migrations/123_new.sql'),sql);
 writeFileSync(join(fresh,'scripts/deploy/migration-policy.json'),JSON.stringify({migrations:{'123_new':{sha256:hash(sql),autoApply:true}}}));
 function walk(dir,prefix=''){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name),prefix+e.name+'/'):[prefix+e.name])}
 writeFileSync(join(fresh,'MANIFEST.sha256'),walk(fresh).map(p=>hash(readFileSync(join(fresh,p)))+'  '+p+'\n').join(''));
 const pkg=join(upload,`${top}.tar.gz`);execFileSync('tar',['-czf',pkg,'-C',join(d,'stage'),top]);
 writeFileSync(pkg+'.sha256',`${hash(readFileSync(pkg))}  ${top}.tar.gz\n`);
 if(mode==='bad-checksum')writeFileSync(pkg+'.sha256',`${'0'.repeat(64)}  ${top}.tar.gz\n`);
 if(mode==='bad-manifest')writeFileSync(join(fresh,'apps/admin-web/dist/index.html'),'tampered');
 if(mode==='bad-manifest') {execFileSync('tar',['-czf',pkg,'-C',join(d,'stage'),top]);writeFileSync(pkg+'.sha256',`${hash(readFileSync(pkg))}  ${top}.tar.gz\n`)}
 for(const cmd of ['id','df','sleep','systemctl','runuser','pg_dump','pg_restore','psql','curl','node']) {writeFileSync(join(d,'bin',cmd),mock);chmodSync(join(d,'bin',cmd),0o755)}
 const body=helper.replaceAll('/opt/11ship',root).replaceAll('/var/lib/11ship-deploy',join(d,'var/lib/11ship-deploy')).replaceAll('/var/backups/11ship',join(d,'var/backups/11ship')).replaceAll('/root/11ship-upload',join(d,'root/11ship-upload')).replaceAll('/root/ship11-secrets',join(d,'root/ship11-secrets')).replaceAll('/etc/11ship',join(d,'etc/11ship')).replaceAll('/var/lock/11ship-deploy.lock',join(d,'var/lock/11ship-deploy.lock'));
 const script=join(d,'deploy.sh');writeFileSync(script,body);
 return {d,root,old,upload,script};
}
for(const mode of ['success','unchanged','bad-checksum','bad-manifest','backup-fails','backup-invalid','with-migration','migration-fails','restart-fails','health-fails','service-fails','unsafe-rollback']){
 test(`remote state machine: ${mode}`,()=>{
  const f=fixture(mode);
  try{
   const r=spawnSync('bash',[f.script,sha,job,f.upload],{env:{...process.env,PATH:join(f.d,'bin')+':'+process.env.PATH,FIXTURE:f.d,REAL_NODE:process.execPath,CASE:mode},encoding:'utf8',timeout:20000});
   assert.equal(r.signal,null,`${r.stderr} ${r.stdout}`);
   const receipt=JSON.parse(readFileSync(join(f.d,`var/lib/11ship-deploy/${job}.json`),'utf8'));
   const calls=readFileSync(join(f.d,'calls'),'utf8');
   if(['success','with-migration'].includes(mode)) {assert.equal(receipt.status,'success',JSON.stringify(receipt));assert.equal(readlinkSync(join(f.root,'current')).includes(sha),true)}
   else if(mode==='unchanged'){assert.equal(receipt.status,'unchanged');assert.doesNotMatch(calls,/pg_dump|restart|--apply/)}
   else {assert.equal(receipt.status,'failed');if(mode!=='unsafe-rollback')assert.equal(readlinkSync(join(f.root,'current')),f.old);assert.notEqual(r.status,0)}
   if(['restart-fails','health-fails','service-fails'].includes(mode)) assert.equal(receipt.rollback,'restored',JSON.stringify(receipt));
   if(mode==='unsafe-rollback'){assert.equal(receipt.rollback,'unsafe-schema-changed');assert.equal(readlinkSync(join(f.root,'current')).includes(sha),true)}
   if(mode==='migration-fails'){assert.equal(receipt.reason,'MIGRATION_FAILED_CODE_UNCHANGED');assert.doesNotMatch(calls,/systemctl restart/)}
   if(['bad-checksum','bad-manifest','backup-fails','backup-invalid'].includes(mode))assert.doesNotMatch(calls,/--apply|systemctl restart/);
   assert.doesNotMatch(calls,/--down|db:reset|DROP DATABASE|staging-seed|fixture/);
  } finally{rmSync(f.d,{recursive:true,force:true})}
 });
}

test('a second deployment cannot enter while the first owns the VPS lock', async () => {
 const f=fixture('success');
 const env={...process.env,PATH:join(f.d,'bin')+':'+process.env.PATH,FIXTURE:f.d,REAL_NODE:process.execPath,CASE:'success'};
 // Hold the exact OS flock that the helper uses, with a separate process (not a string assertion).
 const {spawn}=await import('node:child_process');
 const holder=spawn('flock',['-x',join(f.d,'var/lock/11ship-deploy.lock'),'sh','-c','echo locked; sleep 5'],{stdio:['ignore','pipe','pipe']});
 try {
  await new Promise((done,reject)=>{holder.stdout.once('data',done);holder.once('error',reject)});
  const r=spawnSync('bash',[f.script,sha,job,f.upload],{env,encoding:'utf8',timeout:10000});
  assert.notEqual(r.status,0);
  const receipt=JSON.parse(readFileSync(join(f.d,`var/lib/11ship-deploy/${job}.json`),'utf8'));
  assert.equal(receipt.reason,'DEPLOY_BUSY');
  assert.equal(readlinkSync(join(f.root,'current')),f.old);
 } finally {holder.kill('SIGTERM');rmSync(f.d,{recursive:true,force:true})}
});
