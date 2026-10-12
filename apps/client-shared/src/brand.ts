import { h } from './dom.js';

// Brand identity of the two phone apps. Colours, font and slogans are fixed by the Owner (brand guideline v1.0,
// design set v2.0.2). The logos are the Owner-approved originals (docs/brand/originals), only cropped and resized into
// apps/client-shared/public/brand by tools/brand/build-brand-assets.py; they are never redrawn. A slot falls back to the
// plain app name as text only if a path in LOGO_ASSETS is removed.

export type AppId = 'FOOD' | 'SHIP';

export interface AppBrand {
  readonly id: AppId;
  /** The product name written as plain text (`11Food`). */
  readonly name: string;
  readonly slogan: string;
}

export const FOOD_BRAND: AppBrand = { id: 'FOOD', name: '11Food', slogan: 'Thèm là có' };
export const SHIP_BRAND: AppBrand = { id: 'SHIP', name: '11Ship', slogan: 'Gọi là có' };

/** Paths of the approved logo files, relative to the site root. `undefined` = no logo: the app name is shown as text. */
export const LOGO_ASSETS: Readonly<Record<AppId, string | undefined>> = {
  FOOD: '/brand/logo-11food-ui.png',
  SHIP: '/brand/logo-11ship-ui.png',
};

export function logo(brand: AppBrand, large = false): HTMLElement {
  const asset = LOGO_ASSETS[brand.id];
  const cls = large ? 'c-logo c-logo--large' : 'c-logo';
  if (asset !== undefined) {
    return h('img', { class: cls, src: asset, alt: brand.name });
  }
  // Plain text, no styling that imitates the logo. `data-logo-placeholder` lets tests and the Owner find every slot.
  return h('span', { class: cls, role: 'img', 'aria-label': brand.name, 'data-logo-placeholder': brand.id }, brand.name);
}
