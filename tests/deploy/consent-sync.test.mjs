// The consent texts and versions must be the same in the app, the public legal pages (backend source), the production template for the server and the text document:
// the app sends the pair, the server accepts only the pair it is configured with, and the document is what the Owner approved (14/11/2026).
// The text comparison is a two-way structural equality (section count, order, titles and every paragraph) on both sides.
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

const decodeEntities = (text) =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// Dart: `const List<LegalPolicySection> <name> = <LegalPolicySection>[ LegalPolicySection(title: "...", paragraphs: <String>["...", ...]), ... ];`
function parseDartSections(name) {
  const start = policyDart.indexOf(`const List<LegalPolicySection> ${name} = <LegalPolicySection>[`);
  assert.ok(start >= 0, `${name} not found`);
  const end = policyDart.indexOf('\n];', start);
  assert.ok(end > start, `${name} is not closed`);
  const block = policyDart.slice(start, end);
  const sections = [];
  const sectionRe = /LegalPolicySection\(\s*title: "((?:[^"\\]|\\.)*)",\s*paragraphs: <String>\[([\s\S]*?)\],?\s*\),/g;
  let match;
  while ((match = sectionRe.exec(block)) !== null) {
    const paragraphs = [];
    const literalRe = /"((?:[^"\\]|\\.)*)"/g;
    let literal;
    let rest = match[2];
    while ((literal = literalRe.exec(match[2])) !== null) {
      paragraphs.push(literal[1]);
    }
    rest = rest.replace(literalRe, '').replace(/,/g, '').trim();
    assert.equal(rest, '', `${name}: unexpected content in a paragraph list`);
    sections.push({ title: match[1], paragraphs });
  }
  const declared = (block.match(/LegalPolicySection\(/g) ?? []).length;
  assert.equal(sections.length, declared, `${name}: every LegalPolicySection must parse`);
  for (const section of sections) {
    assert.ok(!/\\/.test(section.title + section.paragraphs.join('')), `${name}: backslash escapes are not expected in the mirror`);
  }
  return sections;
}

// Terms page: the `sections` literal of terms-page.ts is JSON-compatible (ids, titles, paragraphs).
function parseTermsSections() {
  const match = /const sections: readonly TermsSection\[\] = (\[[\s\S]*?\n\]);/.exec(termsPage);
  assert.ok(match, 'terms sections literal not found');
  return JSON.parse(match[1]).map(({ title, paragraphs }) => ({ title, paragraphs }));
}

// Privacy page: each policy section is `<section id="..."><h2>TITLE</h2><p>...</p>...</section>` inside the HTML literal.
function parsePrivacySections() {
  const sections = [];
  const sectionRe = /<section id="[^"]*"><h2>([^<]*)<\/h2>([\s\S]*?)<\/section>/g;
  let match;
  while ((match = sectionRe.exec(privacyPage)) !== null) {
    const paragraphs = [];
    const paragraphRe = /<p>([^<]*)<\/p>/g;
    let paragraph;
    while ((paragraph = paragraphRe.exec(match[2])) !== null) {
      paragraphs.push(decodeEntities(paragraph[1]));
    }
    assert.equal(paragraphs.length, (match[2].match(/<p[\s>]/g) ?? []).length, 'every paragraph of a privacy section must parse');
    sections.push({ title: decodeEntities(match[1]), paragraphs });
  }
  assert.equal(sections.length, (privacyPage.match(/<section id=/g) ?? []).length, 'every privacy section must parse');
  return sections;
}

// Two-way equality: a paragraph or a title that is missing or extra on EITHER side fails.
function assertSameSections(dart, backend, label) {
  assert.deepStrictEqual(
    backend.map((s) => ({ title: s.title, paragraphs: s.paragraphs })),
    dart.map((s) => ({ title: s.title, paragraphs: s.paragraphs })),
    `${label}: the app mirror and the public page differ`,
  );
}

const dartTerms = parseDartSections('kTermsPolicySections');
const dartPrivacy = parseDartSections('kPrivacyPolicySections');
const backendTerms = parseTermsSections();
const backendPrivacy = parsePrivacySections();

const dartConst = (name) => {
  const match = new RegExp(`const String ${name} = '([^']+)';`).exec(policyDart);
  assert.ok(match, `${name} not found`);
  return match[1];
};

describe('consent texts and versions', () => {
  it('the Owner-approved texts have 16 terms sections and 12 privacy sections on both sides', () => {
    assert.equal(dartTerms.length, 16);
    assert.equal(dartPrivacy.length, 12);
    assert.equal(backendTerms.length, 16);
    assert.equal(backendPrivacy.length, 12);
  });

  it('the app texts equal the public page texts in both directions (order, titles and every paragraph)', () => {
    assertSameSections(dartTerms, backendTerms, 'terms');
    assertSameSections(dartPrivacy, backendPrivacy, 'privacy');
  });

  it('the two-way check fails when one paragraph is removed on either side or one is added', () => {
    const removedOnDart = dartTerms.map((s, i) => (i === 3 ? { ...s, paragraphs: s.paragraphs.slice(1) } : s));
    const addedOnBackend = backendPrivacy.map((s, i) => (i === 0 ? { ...s, paragraphs: [...s.paragraphs, 'extra'] } : s));
    assert.throws(() => assertSameSections(removedOnDart, backendTerms, 'terms'), /differ/);
    assert.throws(() => assertSameSections(dartPrivacy, addedOnBackend, 'privacy'), /differ/);
    const droppedSection = backendTerms.slice(1);
    assert.throws(() => assertSameSections(dartTerms, droppedSection, 'terms'), /differ/);
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
