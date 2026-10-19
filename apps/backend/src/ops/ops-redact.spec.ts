import { describe, expect, it } from '@jest/globals';
import { maskPhone, redactDetail, redactText } from './ops-redact';

describe('M13 redaction (design sections 2, 8, 11)', () => {
  it('removes a Discord webhook, bearer token, JWT and key=value secrets', () => {
    const text = redactText('POST https://discord.com/api/webhooks/123456789012345678/AbCdEf_ghIJKlmnopQRstuvwxyz0123456789 failed; Authorization: Bearer abcdefghijklmnop1234; token=hunter2secret password: x1y2z3');
    expect(text).not.toContain('discord.com/api/webhooks');
    expect(text).not.toContain('abcdefghijklmnop1234');
    expect(text).not.toContain('hunter2secret');
    expect(text).not.toContain('x1y2z3');
    expect(redactText('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456 end')).not.toContain('eyJhbGci');
  });

  it('removes an OTP and the whole OTP SMS text', () => {
    expect(redactText('11Ship: Ma xac thuc dang ky cua ban la 123456. Hieu luc 5 phut. Khong chia se ma nay.')).not.toContain('123456');
    expect(redactText('otp 654321 gửi lỗi')).not.toContain('654321');
    expect(redactText('mã xác thực là 112233')).not.toContain('112233');
  });

  it('masks Vietnamese phone numbers in every spelling and keeps only the last three digits', () => {
    for (const raw of ['0912345678', '+84912345678', '+84 912 345 678', '84.912.345.678']) {
      const out = redactText(`khách ${raw} gọi`);
      expect(out).not.toContain('912');
      expect(out).toContain('345'.slice(0, 0) + '678');
    }
    expect(maskPhone('+84912345678')).toBe('+84••••••678');
  });

  it('keeps UUIDs and short codes, and bounds the length', () => {
    const id = '0b9c7d3e-4f5a-4b6c-8d7e-1a2b3c4d5e6f';
    expect(redactText(`order ${id} SC-013`)).toBe(`order ${id} SC-013`);
    expect(redactText('lỗi kết nối '.repeat(100), 50)).toHaveLength(50);
    expect(redactText('a'.repeat(40))).not.toContain('aaaa');
  });

  it('blanks secret-named keys at any depth and masks phone-named keys', () => {
    const out = redactDetail({ ok: 1, password: 'p', nested: { Authorization: 'Bearer x', webhook_url: 'u', phone: '0912345678', deep: { otp_code: '123456', note: 'fine' } }, list: [{ token: 't' }] });
    expect(JSON.stringify(out)).not.toMatch(/"p"|Bearer x|123456|0912345678/);
    expect((out.nested as Record<string, unknown>).phone).toBe('+84••••••678');
    expect(((out.nested as Record<string, Record<string, unknown>>).deep as Record<string, unknown>).note).toBe('fine');
    expect(out.ok).toBe(1);
  });

  it('is total: never throws, bounds the size', () => {
    expect(redactDetail('not an object')).toEqual({});
    expect(redactDetail(null)).toEqual({});
    const big: Record<string, string> = {};
    for (let i = 0; i < 30; i += 1) big[`k${i}`] = 'v'.repeat(190);
    expect(JSON.stringify(redactDetail(big)).length).toBeLessThan(4200);
  });
});
