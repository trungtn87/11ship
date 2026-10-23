import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { classifyException } from '../http/error-envelope';
import { parseShopLogo, shopLogoFingerprint } from './shop-logo';
import { parseShopProfileBody } from '../onboarding/shop-onboarding-validation';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEklEQVR4nGN8tEOeAQaYGJAAACppAb0V3EgsAAAAAElFTkSuQmCC';
const logo = { content_type: 'image/png', data_base64: png };

describe('optional shop logo', () => {
  it('preserves omission, accepts removal and validates the actual image type', () => {
    expect(parseShopLogo(undefined)).toBeUndefined();
    expect(parseShopLogo(null)).toBeNull();
    expect(parseShopLogo(logo)).toEqual(logo);
    for (const bad of [{ ...logo, content_type: 'image/jpeg' }, { ...logo, data_base64: 'not base64' }, { ...logo, user_id: 'other' }, { content_type: 'image/svg+xml', data_base64: Buffer.from('<svg/>').toString('base64') }]) {
      expect(() => parseShopLogo(bad)).toThrow(AppError);
    }
    const large = Buffer.alloc(1048577); Buffer.from(png, 'base64').copy(large);
    expect(() => parseShopLogo({ ...logo, data_base64: large.toString('base64') })).toThrow(AppError);
  });

  it('exposes safe, separate errors at the actual one MiB boundary', () => {
    for (const size of [1048576, 1048577, 1048578]) {
      const bytes = Buffer.alloc(size); Buffer.from(png, 'base64').copy(bytes);
      const input = { ...logo, data_base64: bytes.toString('base64') };
      if (size === 1048576) expect(parseShopLogo(input)).toEqual(input);
      else {
        try { parseShopLogo(input); throw new Error('expected refusal'); }
        catch (error) { expect(classifyException(error)).toMatchObject({ status: 413, code: 'SHOP_LOGO_TOO_LARGE' }); }
      }
    }
    try { parseShopLogo({ ...logo, content_type: 'image/svg+xml' }); throw new Error('expected refusal'); }
    catch (error) {
      const envelope = classifyException(error);
      expect(envelope).toMatchObject({ status: 400, code: 'INVALID_SHOP_LOGO' });
      expect(JSON.stringify(envelope)).not.toContain(png);
    }
  });

  it('fingerprints bytes and MIME deterministically, distinguishes content and removal', () => {
    const parsed = parseShopLogo(logo)!;
    expect(shopLogoFingerprint(parsed)).toEqual(shopLogoFingerprint(parsed));
    expect(shopLogoFingerprint({ ...parsed, data_base64: Buffer.concat([Buffer.from(png, 'base64'), Buffer.from([1])]).toString('base64') })).not.toEqual(shopLogoFingerprint(parsed));
    expect(shopLogoFingerprint({ ...parsed, content_type: 'image/webp' })).not.toEqual(shopLogoFingerprint(parsed));
    expect(shopLogoFingerprint(null)).toBeNull();
  });

  it('logo is optional during onboarding and is normalized with the profile', () => {
    const profile = { name: 'Ốc 11', contact_phone: '0912345678', address_text: 'Cao Bằng' };
    expect(parseShopProfileBody(profile).logo).toBeUndefined();
    expect(parseShopProfileBody({ ...profile, logo }).logo).toEqual(logo);
    expect(parseShopProfileBody({ ...profile, logo: null }).logo).toBeNull();
  });
});
