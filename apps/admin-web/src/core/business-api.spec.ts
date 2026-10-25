import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { BusinessApi } from './business-api';
import { AdminAuthController } from './controller';
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const rig=()=>{const sessionLost=jest.fn();return {api:new BusinessApi({sessionCsrf:'csrf-memory',sessionLost} as unknown as AdminAuthController),sessionLost};};
afterEach(()=>jest.restoreAllMocks());
describe('Business API session and money retry semantics',()=>{
  it('reuses the same key after a lost response and sends only same-origin cookies plus in-memory CSRF',async()=>{
    const headers:Headers[]=[];let calls=0;
    jest.spyOn(globalThis,'fetch').mockImplementation(async(_path,init)=>{
      calls++;headers.push(new Headers(init?.headers));expect(init?.credentials).toBe('same-origin');expect(init?.cache).toBe('no-store');
      if(calls===1)throw new TypeError('lost answer');return response(200,{data:{ok:true}});
    });
    const {api}=rig();const body={body:'Đã chuyển khoản'};
    await expect(api.call('/v1/admin/business/requests/test/messages',body)).rejects.toThrow();
    await expect(api.call('/v1/admin/business/requests/test/messages',body)).resolves.toEqual({ok:true});
    expect(headers[0]!.get('idempotency-key')).toBe(headers[1]!.get('idempotency-key'));
    expect(headers[0]!.get('x-csrf-token')).toBe('csrf-memory');expect(headers[0]!.get('authorization')).toBeNull();
  });
  it('drops an answer that arrived after logout or a different account mounted',async()=>{
    let finish:((r:Response)=>void)|undefined;
    jest.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise< Response>(resolve=>{finish=resolve;}));
    const {api}=rig();const read=api.call('/v1/admin/business/reports');api.clear();finish!(response(200,{data:{secret:'old account'}}));
    await expect(read).rejects.toThrow('session changed');
  });
  it('ends the existing session on 401, rather than rendering private data from a failed response',async()=>{
    jest.spyOn(globalThis,'fetch').mockResolvedValue(response(401,{error:{code:'ADMIN_SESSION_INVALID'}}));
    const {api,sessionLost}=rig();await expect(api.call('/v1/admin/business/requests')).rejects.toThrow();expect(sessionLost).toHaveBeenCalledTimes(1);
  });
});
