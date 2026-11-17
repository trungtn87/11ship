// The consent texts and versions must be the same in the app, the public legal pages (backend source), the production template for the server and the text document:
// the app sends the pair, the server accepts only the pair it is configured with, and the document is what the Owner approved (14/11/2026).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const policyDart = read('mobile/packages/n11_shared/lib/src/account/legal_policy_draft.dart');
const session = read('mobile/packages/n11_shared/lib/src/account/session_controller.dart');
const termsPage = read('apps/backend/src/legal/terms-page.ts');
const privacyPage = read('apps/backend/src/legal/privacy-page.ts');
const doc = read('docs/current/M01-terms-page-20261112.md');
const env = read('ops/vinahost/production.env.example');

// Every quoted paragraph/title in the Dart mirror must appear verbatim in the backend source that serves the public pages.
const dartParagraphs = [...policyDart.split('\n')]
  .map((line) => /^\s+"(.*)",?$/.exec(line)?.[1])
  .filter((text) => text !== undefined);
const dartConst = (name) => {
  const match = new RegExp(`const String ${name} = '([^']+)';`).exec(policyDart);
  assert.ok(match, `${name} not found`);
  return match[1];
};

describe('consent texts and versions', () => {
  it('the app texts are the public page texts, word for word', () => {
    assert.ok(dartParagraphs.length > 0, 'no paragraphs parsed from legal_policy_draft.dart');
    const backend = termsPage + privacyPage;
    const missing = dartParagraphs.filter((text) => !backend.includes(text));
    assert.deepEqual(missing.map((text) => text.slice(0, 80)), []);
  });

  it('the privacy text keeps the Owner-approved Shipper data statement', () => {
    assert.ok(policyDart.includes('Shipper: hồ sơ cá nhân, biển số xe, trạng thái nhận đơn'));
    assert.ok(policyDart.includes('thông tin tài khoản ngân hàng khi cần đối soát và thanh toán.'));
  });

  it('the version the app sends is the pair the production template configures on the server', () => {
    const terms = /kConsentTermsVersion = '([^']+)'/.exec(session)?.[1];
    const privacy = /kConsentPrivacyVersion = '([^']+)'/.exec(session)?.[1];
    assert.equal(env.match(/^CLIENT_AUTH_TERMS_VERSION=(.+)$/m)?.[1], terms);
    assert.equal(env.match(/^CLIENT_AUTH_PRIVACY_VERSION=(.+)$/m)?.[1], privacy);
    assert.ok(doc.includes(`\`${terms}\``) && doc.includes(`\`${privacy}\``));
  });

  it('the Dart policy versions and the public pages report the same versions', () => {
    const terms = /kConsentTermsVersion = '([^']+)'/.exec(session)?.[1];
    const privacy = /kConsentPrivacyVersion = '([^']+)'/.exec(session)?.[1];
    assert.equal(dartConst('kTermsPolicyVersion'), terms);
    assert.equal(dartConst('kPrivacyPolicyVersion'), privacy);
    assert.equal(/TERMS_PAGE_VERSION = '([^']+)'/.exec(termsPage)?.[1], terms);
    assert.equal(/PRIVACY_PAGE_VERSION = '([^']+)'/.exec(privacyPage)?.[1], privacy);
  });
});
