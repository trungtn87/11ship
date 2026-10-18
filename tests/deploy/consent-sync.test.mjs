// The consent texts and versions must be the same in the app, the production template for the server and the text document:
// the app sends the pair, the server accepts only the pair it is configured with, and the document is what the Owner approved.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const views = read('mobile/packages/n11_shared/lib/src/account/account_views.dart');
const session = read('mobile/packages/n11_shared/lib/src/account/session_controller.dart');
const doc = read('docs/current/M01-terms-privacy-20261014.md');
const env = read('ops/vinahost/production.env.example');

const dartText = (name) => {
  const match = new RegExp(`const String ${name} =\\s*'((?:[^'\\\\]|\\\\.)*)';`).exec(views);
  assert.ok(match, `${name} not found`);
  return match[1];
};
const section = (heading) => {
  const start = doc.indexOf(`## ${heading}`);
  assert.ok(start >= 0, heading);
  return doc.slice(start).split('\n').slice(1).find((line) => line.trim() !== '').trim();
};

describe('consent texts and versions', () => {
  it('the app texts are the document texts, word for word', () => {
    assert.equal(dartText('kTermsText'), section('Điều khoản sử dụng'));
    assert.equal(dartText('kPrivacyText'), section('Chính sách quyền riêng tư'));
  });

  it('the privacy text states the Shipper data as the Owner worded it', () => {
    const text = dartText('kPrivacyText');
    assert.ok(text.includes('Hồ sơ Shipper có thể bao gồm họ tên, số điện thoại, biển số xe và thông tin tài khoản ngân hàng. Thông tin ngân hàng được sử dụng để xác minh chủ tài khoản và phục vụ các nghiệp vụ thanh toán liên quan. Thông tin này không được công khai cho khách hàng, chủ quán hoặc Shipper khác.'));
    assert.doesNotMatch(text, /thời hạn lưu|xóa dữ liệu|xuất dữ liệu/i, 'no retention or legal commitment the Owner has not confirmed');
  });

  it('the version the app sends is the pair the production template configures on the server', () => {
    const terms = /kConsentTermsVersion = '([^']+)'/.exec(session)?.[1];
    const privacy = /kConsentPrivacyVersion = '([^']+)'/.exec(session)?.[1];
    assert.equal(env.match(/^CLIENT_AUTH_TERMS_VERSION=(.+)$/m)?.[1], terms);
    assert.equal(env.match(/^CLIENT_AUTH_PRIVACY_VERSION=(.+)$/m)?.[1], privacy);
    assert.ok(doc.includes(`\`${terms}\``) && doc.includes(`\`${privacy}\``));
  });
});
