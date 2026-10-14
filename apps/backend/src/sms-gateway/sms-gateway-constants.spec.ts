import { describe, expect, it } from '@jest/globals';
import { renderOtpSms, SMS_TEXT_PATTERN } from './sms-gateway-constants';

describe('renderOtpSms', () => {
  it('renders only the two fixed templates, ASCII, one SMS segment, the OTP as the single variable', () => {
    const register = renderOtpSms('REGISTER', '012345', 300);
    const reset = renderOtpSms('RESET_PASSWORD', '987654', 300);
    expect(register).toBe('11Ship: Ma xac thuc dang ky cua ban la 012345. Hieu luc 5 phut. Khong chia se ma nay.');
    expect(reset).toBe('11Ship: Ma dat lai mat khau cua ban la 987654. Hieu luc 5 phut. Khong chia se ma nay.');
    const activation = renderOtpSms('ADMIN_ACTIVATION', '246810', 300);
    expect(activation).toBe('11Ship: Ma kich hoat quan tri cua ban la 246810. Hieu luc 5 phut. Khong chia se ma nay.');
    for (const text of [register, reset, activation]) {
      expect(text).toMatch(SMS_TEXT_PATTERN);
      expect(text.length).toBeLessThanOrEqual(160);
      expect(/^[\x20-\x7e]+$/.test(text)).toBe(true);
    }
  });

  it('rounds the lifetime up to whole minutes and bounds it', () => {
    expect(renderOtpSms('REGISTER', '111111', 30)).toContain('Hieu luc 1 phut');
    expect(renderOtpSms('REGISTER', '111111', 301)).toContain('Hieu luc 6 phut');
    expect(renderOtpSms('REGISTER', '111111', 600)).toContain('Hieu luc 10 phut');
  });

  it('refuses anything that is not a six digit code, so no free text can reach the queue', () => {
    for (const otp of ['12345', '1234567', 'abcdef', '12 456', '123456\nhttp://evil.example', '']) {
      expect(() => renderOtpSms('REGISTER', otp, 300)).toThrow();
    }
  });

  it('the pattern the gateway enforces rejects any other text', () => {
    for (const text of [
      '11Ship: Ma xac thuc dang ky cua ban la 123456. Hieu luc 5 phut. Khong chia se ma nay. http://x',
      'Click http://evil.example',
      '11Ship: Ma xac thuc dang ky cua ban la 12345. Hieu luc 5 phut. Khong chia se ma nay.',
    ]) {
      expect(SMS_TEXT_PATTERN.test(text)).toBe(false);
    }
  });
});
