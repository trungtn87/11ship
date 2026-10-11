// Outline icons on the brand grid: 24px, stroke 2, round caps and joins (03-ui-catalog, Icon). Generic interface icons
// only; the brand logo is NOT drawn here (see brand.ts). Icons are decorative (aria-hidden): the control that holds one
// always has a text label or an aria-label.

type Shape =
  | readonly ['p', string]
  | readonly ['c', number, number, number]
  | readonly ['r', number, number, number, number, number];

const ICONS = {
  back: [['p', 'M19 12H5M12 19l-7-7 7-7']],
  chevronRight: [['p', 'M9 18l6-6-6-6']],
  chevronDown: [['p', 'M6 9l6 6 6-6']],
  chevronsLeft: [['p', 'M11 17l-5-5 5-5M18 17l-5-5 5-5']],
  chevronsRight: [['p', 'M13 17l5-5-5-5M6 17l5-5-5-5']],
  eye: [
    ['p', 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z'],
    ['c', 12, 12, 3],
  ],
  eyeOff: [
    ['p', 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z'],
    ['c', 12, 12, 3],
    ['p', 'M3 3l18 18'],
  ],
  lock: [
    ['r', 3, 11, 18, 11, 2],
    ['p', 'M7 11V7a5 5 0 0110 0v4'],
  ],
  phone: [
    ['r', 7, 2, 10, 20, 2],
    ['p', 'M12 18h.01'],
  ],
  user: [
    ['p', 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2'],
    ['c', 12, 7, 4],
  ],
  users: [
    ['p', 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2'],
    ['c', 9, 7, 4],
    ['p', 'M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8'],
  ],
  store: [
    ['p', 'M3 9l1-5h16l1 5M3 9v11h18V9M9 20v-6h6v6'],
    ['p', 'M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0'],
  ],
  mapPin: [
    ['p', 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0116 0z'],
    ['c', 12, 10, 3],
  ],
  locate: [
    ['c', 12, 12, 3],
    ['c', 12, 12, 8],
    ['p', 'M12 2v2M12 20v2M2 12h2M20 12h2'],
  ],
  home: [['p', 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6']],
  search: [
    ['c', 11, 11, 7],
    ['p', 'M21 21l-4.3-4.3'],
  ],
  receipt: [['p', 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6']],
  wallet: [['p', 'M3 7a2 2 0 012-2h13v4M3 7v10a2 2 0 002 2h16V9H5a2 2 0 01-2-2zM17 14h.01']],
  barChart: [['p', 'M6 20V10M12 20V4M18 20v-7']],
  settings: [
    ['c', 12, 12, 3],
    ['p', 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1'],
  ],
  sliders: [['p', 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6']],
  logout: [['p', 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9']],
  check: [['p', 'M20 6L9 17l-5-5']],
  checkCircle: [
    ['c', 12, 12, 10],
    ['p', 'M8 12l3 3 5-6'],
  ],
  info: [
    ['c', 12, 12, 10],
    ['p', 'M12 16v-4M12 8h.01'],
  ],
  alert: [['p', 'M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01']],
  alertCircle: [
    ['c', 12, 12, 10],
    ['p', 'M12 8v4M12 16h.01'],
  ],
  clock: [
    ['c', 12, 12, 10],
    ['p', 'M12 6v6l4 2'],
  ],
  wifiOff: [['p', 'M1 1l22 22M16.7 11.1A11 11 0 0119 12.6M5 12.6a11 11 0 015.2-2.9M8.5 16.4a5 5 0 017 0M12 20h.01M2 8.8a15 15 0 014.2-2.7M10.7 5.1A15 15 0 0122 8.8']],
  camera: [
    ['p', 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z'],
    ['c', 12, 13, 4],
  ],
  help: [
    ['c', 12, 12, 10],
    ['p', 'M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01'],
  ],
  bell: [['p', 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0']],
  box: [['p', 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8']],
  shield: [['p', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z']],
  mail: [
    ['r', 2, 4, 20, 16, 2],
    ['p', 'M22 6l-10 7L2 6'],
  ],
  menu: [['p', 'M3 6h18M3 12h18M3 18h18']],
  close: [['p', 'M18 6L6 18M6 6l12 12']],
  plus: [['p', 'M12 5v14M5 12h14']],
  plusCircle: [
    ['c', 12, 12, 10],
    ['p', 'M12 8v8M8 12h8'],
  ],
  minusCircle: [
    ['c', 12, 12, 10],
    ['p', 'M8 12h8'],
  ],
  refresh: [['p', 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5']],
  truck: [
    ['p', 'M1 3h15v13H1zM16 8h4l3 3v5h-7z'],
    ['c', 5.5, 18.5, 2.5],
    ['c', 18.5, 18.5, 2.5],
  ],
  message: [['p', 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z']],
  file: [['p', 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M8 13h8M8 17h8']],
  activity: [['p', 'M22 12h-4l-3 9L9 3l-3 9H2']],
  utensils: [['p', 'M4 3v7a2 2 0 002 2h1a2 2 0 002-2V3M7 3v18M17 3c-2 2-3 4-3 7s1 4 3 4v7']],
  copy: [
    ['r', 9, 9, 13, 13, 2],
    ['p', 'M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1'],
  ],
  send: [['p', 'M22 2L11 13M22 2l-7 20-4-9-9-4z']],
  trash: [['p', 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6']],
  more: [
    ['c', 12, 5, 1],
    ['c', 12, 12, 1],
    ['c', 12, 19, 1],
  ],
  chartLine: [
    ['r', 3, 3, 18, 18, 2],
    ['p', 'M7 15l3-3 3 2 4-5'],
  ],
  key: [
    ['c', 7.5, 15.5, 4.5],
    ['p', 'M10.7 12.3L21 2M16 7l3 3'],
  ],
  mobile: [['p', 'M12 18h.01'], ['r', 6, 2, 12, 20, 3]],
  lockOpen: [
    ['r', 3, 11, 18, 11, 2],
    ['p', 'M7 11V7a5 5 0 019.9-1'],
  ],
  banknote: [
    ['r', 2, 6, 20, 12, 2],
    ['c', 12, 12, 2.5],
  ],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;

const SVG_NS = 'http://www.w3.org/2000/svg';

function shapeNode(shape: Shape): SVGElement {
  if (shape[0] === 'p') {
    const node = document.createElementNS(SVG_NS, 'path');
    node.setAttribute('d', shape[1]);
    return node;
  }
  if (shape[0] === 'c') {
    const node = document.createElementNS(SVG_NS, 'circle');
    node.setAttribute('cx', String(shape[1]));
    node.setAttribute('cy', String(shape[2]));
    node.setAttribute('r', String(shape[3]));
    return node;
  }
  const node = document.createElementNS(SVG_NS, 'rect');
  node.setAttribute('x', String(shape[1]));
  node.setAttribute('y', String(shape[2]));
  node.setAttribute('width', String(shape[3]));
  node.setAttribute('height', String(shape[4]));
  node.setAttribute('rx', String(shape[5]));
  return node;
}

export function icon(name: IconName, size = 24): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const shape of ICONS[name] as readonly Shape[]) {
    svg.append(shapeNode(shape));
  }
  return svg;
}

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
