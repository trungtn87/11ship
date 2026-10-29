import { describe, expect, it } from '@jest/globals';
import { createECDH } from 'node:crypto';
import { comparisonPeriods, shipperSuccessRates } from './business-report-service';
import { resolvePeriod } from '../admin-m12/vietnam-time';
import { id, object, page, positive, sequence, subscription, text } from './finance-validation';
import { parseBusinessPushConfig } from '../config/business-push-config';
import { publicAdminAsset } from '../http/admin-web-hosting';

describe('Business Dashboard money and privacy boundaries',()=>{
  it('compares elapsed Vietnam day, not a full previous day against an incomplete one',()=>{
    const now=Date.parse('2026-10-25T05:00:00Z');const p=comparisonPeriods(resolvePeriod('today',now),now);
    expect(p.current.fromMs).toBe(Date.parse('2026-10-24T17:00:00Z'));
    expect(p.previous.fromMs).toBe(Date.parse('2026-10-23T17:00:00Z'));
    expect(p.current.toMs-p.current.fromMs).toBe(p.previous.toMs-p.previous.fromMs);
  });
  it('uses the preceding calendar month and clamps its end for unequal month lengths',()=>{
    const now=Date.parse('2026-03-31T05:00:00Z');const p=comparisonPeriods(resolvePeriod('month',now),now);
    expect(p.previous.fromMs).toBe(Date.parse('2026-01-31T17:00:00Z'));
    expect(p.previous.toMs).toBe(Date.parse('2026-02-28T17:00:00Z'));
  });
  it('uses completed plus failed as the shipper success denominator and leaves no outcomes as unavailable',()=>{
    const report={kind:'shippers',title:'Shipper',basisLabel:'Kỳ',summary:[],columns:[{key:'completed',label:'Thành công',format:'count'},{key:'failed',label:'Thất bại',format:'count'}],rows:[{cells:[3,1]},{cells:[0,0]}],truncated:false,notes:[]} as const;
    const r=shipperSuccessRates(report);expect(r.rows.map(row=>row.cells.at(-1))).toEqual([75,null]);
  });
  it('refuses invalid money, caller-supplied identity and unbounded cursors',()=>{
    expect(()=>positive(1.5)).toThrow();expect(()=>positive(-1)).toThrow();expect(()=>positive(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(()=>object({body:'x',owner_user_id:'x'},['body'])).toThrow();expect(()=>sequence('1e99')).toThrow();expect(()=>id('not-a-uuid')).toThrow();expect(()=>page({state:['PENDING']})).toThrow();expect(()=>text('\0secret')).toThrow();
    expect(text('  Chuyển khoản\nđã gửi ')).toBe('Chuyển khoản\nđã gửi');
  });
  it('limits new finance messages to 500 user-visible characters, including Vietnamese marks and joined emoji',()=>{
    for(const character of ['a','a\u0301','👨‍👩‍👧‍👦']){
      expect(text(character.repeat(500))).toBe(character.repeat(500));
      expect(()=>text(character.repeat(501))).toThrow();
    }
  });
  it('does not turn a Push endpoint into server-side access to private networks or arbitrary hosts',()=>{
    const e=createECDH('prime256v1');e.generateKeys();const keys={p256dh:e.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')};
    expect(subscription({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys}).endpoint).toContain('fcm.googleapis.com');
    for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/','https://fcm.googleapis.com.evil.test/x','https://fcm.googleapis.com:444/x','https://user:pass@fcm.googleapis.com/x','https://metadata.google.internal/'])expect(()=>subscription({endpoint,keys})).toThrow();
  });
  it('fails closed on partial or mismatched VAPID keys and exposes only named configuration errors',()=>{
    expect(parseBusinessPushConfig({})).toEqual({ok:true,config:undefined});
    expect(parseBusinessPushConfig({BUSINESS_PUSH_PRIVATE_KEY:'secret'}).ok).toBe(false);
    const e=createECDH('prime256v1');e.generateKeys();
    expect(parseBusinessPushConfig({BUSINESS_PUSH_PRIVATE_KEY:e.getPrivateKey().toString('base64url'),BUSINESS_PUSH_PUBLIC_KEY:e.getPublicKey().toString('base64url'),BUSINESS_PUSH_SUBJECT:'mailto:ops@example.com'}).ok).toBe(true);
  });
  it('serves the installed PWA deep links and exact assets without extending the API fallback',()=>{
    for(const path of ['/business/','/business/chat','/business/finance','/business/notifications'])expect(publicAdminAsset(path)).toBe('business.html');
    expect(publicAdminAsset('/business.webmanifest')).toBe('business.webmanifest');expect(publicAdminAsset('/business-sw.js')).toBe('business-sw.js');
    for(const path of ['/business/secret','/business/../.env','/v1/admin/business/reports','/business-sw.js/x'])expect(publicAdminAsset(path)).toBeUndefined();
  });
});
