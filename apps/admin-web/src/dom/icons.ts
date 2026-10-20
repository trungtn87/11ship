import { IconName } from '../core/menu.js';
import { svg } from './dom.js';

// The icons of the administration web: 24x24 grid, stroke 2, round caps (the brand icon grid, same as the eye icon of the
// login). Drawn here as plain paths so nothing is fetched and the CSP stays `img-src 'self'`.

export type UiIconName =
  | IconName
  | 'chevron-down'
  | 'chevron-up'
  | 'chevrons-left'
  | 'chevrons-right'
  | 'menu'
  | 'help'
  | 'more'
  | 'search'
  | 'refresh'
  | 'lock'
  | 'unlock'
  | 'alert'
  | 'info'
  | 'x'
  | 'check'
  | 'clock'
  | 'wifi-off'
  | 'file'
  | 'arrow-left'
  | 'log-out'
  | 'key';

type Shape = readonly [tag: 'path' | 'circle' | 'rect', attrs: Readonly<Record<string, string>>];

const p = (d: string): Shape => ['path', { d }];
const c = (cx: number, cy: number, r: number): Shape => ['circle', { cx: String(cx), cy: String(cy), r: String(r) }];
const r = (x: number, y: number, w: number, h: number, rx: number): Shape => ['rect', { x: String(x), y: String(y), width: String(w), height: String(h), rx: String(rx) }];

const SHAPES: Record<UiIconName, readonly Shape[]> = {
  home: [p('M3 11l9-8 9 8'), p('M5 10v10h14V10'), p('M10 20v-6h4v6')],
  user: [c(12, 8, 4), p('M4 21c0-4 3.6-7 8-7s8 3 8 7')],
  shield: [p('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'), p('M9 12l2 2 4-4')],
  mail: [r(3, 5, 18, 14, 2), p('M3 7l9 6 9-6')],
  store: [p('M4 9l1-5h14l1 5'), p('M4 9v11h16V9'), p('M4 9c0 1.5 1.3 2.5 2.7 2.5S9.3 10.5 9.3 9c0 1.5 1.3 2.5 2.7 2.5s2.7-1 2.7-2.5c0 1.5 1.3 2.5 2.7 2.5S20 10.5 20 9'), p('M10 20v-5h4v5')],
  rider: [c(6, 17, 3), c(18, 17, 3), p('M9 17h5l3-8h-3'), p('M11 9H8')],
  receipt: [p('M6 3h12v18l-3-2-3 2-3-2-3 2z'), p('M9 8h6'), p('M9 12h6')],
  bell: [p('M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7'), p('M10 20a2 2 0 0 0 4 0')],
  truck: [r(2, 5, 11, 11, 1), p('M13 9h4l4 4v3h-8'), c(6.5, 18, 2), c(17.5, 18, 2)],
  chat: [p('M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z'), p('M8.5 12h.01'), p('M12 12h.01'), p('M15.5 12h.01')],
  wallet: [p('M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'), p('M3 7l12-3v3'), p('M17 14h.01')],
  'plus-circle': [c(12, 12, 9), p('M12 8v8'), p('M8 12h8')],
  'minus-circle': [c(12, 12, 9), p('M8 12h8')],
  'map-pin': [p('M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z'), c(12, 10, 2.5)],
  gear: [c(12, 12, 4), p('M12 2v3'), p('M12 19v3'), p('M4.2 4.2l2.1 2.1'), p('M17.7 17.7l2.1 2.1'), p('M2 12h3'), p('M19 12h3'), p('M4.2 19.8l2.1-2.1'), p('M17.7 6.3l2.1-2.1')],
  doc: [p('M7 3h8l4 4v14H7z'), p('M14 3v5h5'), p('M10 13h6'), p('M10 17h6')],
  activity: [p('M3 12h4l3-8 4 16 3-8h4')],
  star: [p('M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z')],
  'chevron-down': [p('M6 9l6 6 6-6')],
  'chevron-up': [p('M6 15l6-6 6 6')],
  'chevrons-left': [p('M11 17l-5-5 5-5'), p('M18 17l-5-5 5-5')],
  'chevrons-right': [p('M13 17l5-5-5-5'), p('M6 17l5-5-5-5')],
  menu: [p('M4 6h16'), p('M4 12h16'), p('M4 18h16')],
  help: [c(12, 12, 9), p('M9.5 9.2a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8'), p('M12 17h.01')],
  more: [p('M12 5h.01'), p('M12 12h.01'), p('M12 19h.01')],
  search: [c(11, 11, 7), p('M21 21l-4.3-4.3')],
  refresh: [p('M21 12a9 9 0 1 1-3-6.7L21 8'), p('M21 3v5h-5')],
  lock: [r(5, 11, 14, 10, 2), p('M8 11V7a4 4 0 0 1 8 0v4')],
  unlock: [r(5, 11, 14, 10, 2), p('M8 11V7a4 4 0 0 1 7.5-2')],
  alert: [p('M12 3l10 18H2z'), p('M12 10v4'), p('M12 17.5h.01')],
  info: [c(12, 12, 9), p('M12 11v5'), p('M12 8h.01')],
  x: [p('M6 6l12 12'), p('M18 6L6 18')],
  check: [p('M5 12l5 5 9-10')],
  clock: [c(12, 12, 9), p('M12 7v5l3 2')],
  'wifi-off': [p('M2 8.8a15 15 0 0 1 4-2.4'), p('M10 5.2A15 15 0 0 1 22 8.8'), p('M5 12.9a10 10 0 0 1 3-1.9'), p('M13 11a10 10 0 0 1 6 1.9'), p('M8.5 16.4a5 5 0 0 1 7 0'), p('M12 20h.01'), p('M3 3l18 18')],
  file: [p('M7 3h8l4 4v14H7z'), p('M14 3v5h5'), p('M10 14h6'), p('M10 17h4')],
  'arrow-left': [p('M19 12H5'), p('M11 6l-6 6 6 6')],
  'log-out': [p('M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4'), p('M16 8l4 4-4 4'), p('M20 12H9')],
  key: [c(8, 15, 4), p('M11 12l9-9'), p('M17 6l3 3'), p('M14 9l2 2')],
};

export function icon(name: UiIconName, size = 20): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: String(size),
      height: String(size),
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      class: 'icon',
    },
    ...SHAPES[name].map(([tag, attrs]) => svg(tag, attrs)),
  );
}
