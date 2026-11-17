// The consent the 11Food and 11Ship register screens show and send. The texts and the version pair are the Owner-approved official
// texts (14/11/2026), generated from the backend legal pages into legal-official.ts, so the screen shows the same words the public
// pages show. The server decides whether it accepts the pair (CONSENT_VERSION_UNSUPPORTED otherwise). The texts are shown in full,
// before the form is submitted; the checkbox starts unchecked.

import { OFFICIAL_PRIVACY_SECTIONS, OFFICIAL_PRIVACY_VERSION, OFFICIAL_TERMS_SECTIONS, OFFICIAL_TERMS_VERSION, OfficialLegalSection } from './legal-official.js';

export interface ConsentOffer {
  readonly termsVersion: string;
  readonly privacyVersion: string;
  readonly termsTitle: string;
  /** The Điều khoản sử dụng sections, in order, shown in full. */
  readonly termsSections: readonly OfficialLegalSection[];
  readonly privacyTitle: string;
  /** The Chính sách quyền riêng tư sections, in order, shown in full. */
  readonly privacySections: readonly OfficialLegalSection[];
  /** Label of the single checkbox (unchecked by default). */
  readonly checkboxLabel: string;
}

export const REGISTER_CONSENT: ConsentOffer = {
  termsVersion: OFFICIAL_TERMS_VERSION,
  privacyVersion: OFFICIAL_PRIVACY_VERSION,
  termsTitle: 'Điều khoản sử dụng',
  termsSections: OFFICIAL_TERMS_SECTIONS,
  privacyTitle: 'Chính sách quyền riêng tư',
  privacySections: OFFICIAL_PRIVACY_SECTIONS,
  checkboxLabel: 'Tôi đã đọc và đồng ý với Điều khoản sử dụng và Chính sách quyền riêng tư',
};
