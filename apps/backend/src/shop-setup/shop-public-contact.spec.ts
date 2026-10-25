import { describe, expect, it } from '@jest/globals';
import { facebookUrlsOf, publicContactOf, zaloUrlOf } from './shop-public-contact';

describe('public quick contact (issue #190)', () => {
  it('turns the owner\'s phone, Zalo and Facebook into safe https links', () => {
    expect(publicContactOf({ contactPhoneNormalized: '+84912345678', zalo: '0912345678', facebook: 'https://www.facebook.com/quan.oc.11' })).toEqual({
      phone: '+84912345678',
      zaloUrl: 'https://zalo.me/0912345678',
      messengerUrl: 'https://m.me/quan.oc.11',
      facebookUrl: 'https://www.facebook.com/quan.oc.11',
    });
  });

  it('accepts a Zalo number in the usual spellings and a zalo.me link; nothing else', () => {
    expect(zaloUrlOf('+84912345678')).toBe('https://zalo.me/0912345678');
    expect(zaloUrlOf('84912345678')).toBe('https://zalo.me/0912345678');
    expect(zaloUrlOf('https://zalo.me/0912345678')).toBe('https://zalo.me/0912345678');
    expect(zaloUrlOf('zalo.me/quanoc11')).toBe('https://zalo.me/quanoc11');
    expect(zaloUrlOf('https://chat.zalo.me/quanoc11')).toBe('https://zalo.me/quanoc11');
    for (const bad of [null, '', '   ', 'zalo.new', '12345', '0912 345 678', 'javascript:alert(1)', 'http://zalo.me/0912345678', 'https://zalo.me.evil.example/0912345678', 'https://evil.example/zalo.me/0912345678', 'https://u:p@zalo.me/0912345678', 'https://zalo.me:8443/0912345678', 'https://zalo.me/a/b', 'https://zalo.me/%2e%2e', 'intent://zalo.me/0912345678#Intent;end', 'tel:0912345678']) {
      expect([bad, zaloUrlOf(bad)]).toEqual([bad, null]);
    }
  });

  it('derives a Messenger link only from a recognised Facebook / Messenger link, never from free text', () => {
    expect(facebookUrlsOf('https://facebook.com/quan.oc.11')).toEqual({ facebookUrl: 'https://www.facebook.com/quan.oc.11', messengerUrl: 'https://m.me/quan.oc.11' });
    expect(facebookUrlsOf('facebook.com/quan.oc.11')).toEqual({ facebookUrl: 'https://www.facebook.com/quan.oc.11', messengerUrl: 'https://m.me/quan.oc.11' });
    expect(facebookUrlsOf('https://m.facebook.com/quan.oc.11?ref=x#top')).toEqual({ facebookUrl: 'https://www.facebook.com/quan.oc.11', messengerUrl: 'https://m.me/quan.oc.11' });
    expect(facebookUrlsOf('https://www.facebook.com/profile.php?id=100012345678901')).toEqual({ facebookUrl: 'https://www.facebook.com/profile.php?id=100012345678901', messengerUrl: 'https://m.me/100012345678901' });
    expect(facebookUrlsOf('https://m.me/quan.oc.11')).toEqual({ facebookUrl: 'https://www.facebook.com/quan.oc.11', messengerUrl: 'https://m.me/quan.oc.11' });
    expect(facebookUrlsOf('https://www.messenger.com/t/quan.oc.11')).toEqual({ facebookUrl: 'https://www.facebook.com/quan.oc.11', messengerUrl: 'https://m.me/quan.oc.11' });
    for (const bad of [null, '', 'Quán ốc 11', 'quan.oc.11', '@quan.oc.11', 'javascript:alert(1)', 'http://facebook.com/quan.oc.11', 'https://facebook.com.evil.example/quan.oc.11', 'https://evil.example/facebook.com/quan.oc.11', 'https://facebook.com/sharer.php?u=x', 'https://facebook.com/groups/12345678', 'https://facebook.com/pages/Quan/123456', 'https://facebook.com/a', 'https://facebook.com/profile.php?id=abc', 'https://facebook.com/profile.php', 'https://facebook.com/quan oc', 'https://u:p@facebook.com/quan.oc.11', 'https://facebook.com/%71uan.oc.11', 'https://m.me/', 'https://www.messenger.com/t/', 'fb-messenger://user/1234567', 'intent://m.me/quan#Intent;end']) {
      expect([bad, facebookUrlsOf(bad)]).toEqual([bad, { facebookUrl: null, messengerUrl: null }]);
    }
  });

  it('the stored contact phone is offered normalized; anything that is not a Vietnamese mobile number is not offered', () => {
    expect(publicContactOf({ contactPhoneNormalized: '0912345678', zalo: null, facebook: null }).phone).toBe('+84912345678');
    expect(publicContactOf({ contactPhoneNormalized: '+8491234567', zalo: null, facebook: null }).phone).toBeNull();
    expect(publicContactOf({ contactPhoneNormalized: 'not a phone', zalo: null, facebook: null }).phone).toBeNull();
  });
});
