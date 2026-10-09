import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrigin, checkHealth } from '../../apps/foundation/web/health.mjs';
test('reject credentials, paths, insecure protocols and query strings', () => {
  for (const origin of ['http://example.com','https://u:p@example.com','https://example.com/api','https://example.com?token=x','https://example.com#x']) assert.throws(() => validateOrigin(origin));
});
test('unconfigured target never makes a request', async () => {
  assert.deepEqual(await checkHealth('', () => { throw new Error('unexpected fetch'); }), { ok:false, code:'NOT_CONFIGURED' });
});
test('liveness alone cannot report database ready', async () => {
  let count = 0;
  const result = await checkHealth('https://example.com', async () => (++count === 1 ? {ok:true,json:async()=>({data:{status:'ok'}})} : {ok:false}));
  assert.equal(result.code, 'NOT_READY'); assert.equal(count,2);
});
test('wrong envelope cannot report ready', async () => {
  assert.equal((await checkHealth('https://example.com', async () => ({ok:true,json:async()=>({status:'ok'})}))).code,'INVALID_RESPONSE');
});
test('both health endpoints and exact statuses required', async () => {
  const urls=[];
  const result=await checkHealth('https://example.com', async (url,options)=>{ urls.push(url); assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error'); return {ok:true,json:async()=>({data:{status:url.endsWith('/live')?'ok':'ready'}})}; });
  assert.equal(result.ok,true); assert.equal(urls.length,2);
});
