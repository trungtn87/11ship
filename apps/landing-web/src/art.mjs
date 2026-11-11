// Original vector illustrations (no photographs, no people, no app screenshots). Colours follow the brand yellow/charcoal;
// the landscape greens/blues are illustration colours only. Replace with Owner-approved photography when supplied.

/** Karst mountains, waterfall and river of Cao Bằng. `slice` crops to the box instead of letterboxing. */
export function landscape(label) {
  return `<svg class="art" viewBox="0 0 800 460" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dff0f5"/><stop offset="1" stop-color="#fff6dc"/></linearGradient>
<linearGradient id="riv" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4fb0b5"/><stop offset="1" stop-color="#7cd0cc"/></linearGradient></defs>
<rect width="800" height="460" fill="url(#sky)"/>
<circle cx="610" cy="96" r="46" fill="#D8AD18" opacity=".35"/>
<path d="M0 270 L60 190 L110 250 L175 150 L240 250 L300 200 L360 260 L430 170 L500 255 L560 205 L640 265 L720 180 L800 250 V460 H0Z" fill="#a9cdb2"/>
<path d="M0 320 L70 230 L120 300 L210 205 L280 305 L350 250 L420 320 L520 220 L600 315 L690 240 L800 320 V460 H0Z" fill="#6aa985"/>
<path d="M0 370 L90 300 L160 365 L260 290 L340 370 L450 300 L560 375 L660 305 L800 370 V460 H0Z" fill="#3f8564"/>
<path d="M392 296 h36 l14 76 h-64z" fill="#f3fbfc" opacity=".92"/><path d="M402 300 l-6 68 M410 300 v68 M418 300 l6 68" stroke="#bfe0e4" stroke-width="3" stroke-linecap="round"/>
<path d="M300 372 C420 350 560 352 800 380 V460 H0 V400 C120 385 200 380 300 372Z" fill="url(#riv)"/>
<path d="M60 430 C220 400 420 405 520 425" stroke="#fff" stroke-opacity=".5" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M-20 440 C150 360 520 330 830 245" stroke="#D8AD18" stroke-width="16" fill="none" stroke-linecap="round" opacity=".95"/>
</svg>`;
}

/** Stylised bowl of noodle soup with steam (11Food). */
export function bowl(label) {
  return `<svg class="art art--bowl" viewBox="0 0 400 300" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
<path d="M150 70c-12 22 12 30 0 52M200 56c-14 24 14 34 0 60M250 70c-12 22 12 30 0 52" stroke="#D8AD18" stroke-width="7" fill="none" stroke-linecap="round" opacity=".55"/>
<ellipse cx="200" cy="268" rx="130" ry="14" fill="#2A2A2E" opacity=".12"/>
<path d="M60 150 H340 C340 232 280 268 200 268 C120 268 60 232 60 150Z" fill="#fff" stroke="#e3e1db" stroke-width="3"/>
<path d="M60 150 H340" stroke="#D8AD18" stroke-width="8" stroke-linecap="round"/>
<ellipse cx="200" cy="150" rx="140" ry="30" fill="#f3d27a"/>
<ellipse cx="200" cy="150" rx="118" ry="22" fill="#f8e2a4"/>
<path d="M120 148c30-16 50 14 80 0s50 14 80 0" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".9"/>
<path d="M130 156c24 10 46-8 70 2s46-8 70 2" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>
<circle cx="150" cy="140" r="14" fill="#b75a3c"/><circle cx="188" cy="136" r="14" fill="#c8694a"/><circle cx="226" cy="142" r="13" fill="#b75a3c"/>
<path d="M240 128c14-18 34-20 44-8-10 12-30 18-44 8zM104 140c10-16 28-18 38-6-8 12-26 16-38 6z" fill="#4c9a62"/>
<path d="M270 62 L330 140M286 56 L346 134" stroke="#8a5a34" stroke-width="6" stroke-linecap="round"/>
</svg>`;
}

/** Delivery route between a shop and a drop-off point (11Ship). */
export function route(label) {
  return `<svg class="art art--route" viewBox="0 0 520 300" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
<path d="M0 262 C140 230 260 280 520 190 V300 H0Z" fill="#D8AD18"/>
<path d="M0 282 C160 252 280 296 520 214" stroke="#fff" stroke-opacity=".25" stroke-width="3" fill="none"/>
<path d="M90 214 C150 120 240 210 300 130 S420 90 440 70" stroke="#fff" stroke-width="4" stroke-dasharray="3 12" stroke-linecap="round" fill="none"/>
<g transform="translate(60 150)"><path d="M30 0C14 0 2 12 2 28c0 20 28 48 28 48s28-28 28-48C58 12 46 0 30 0z" fill="#D8AD18"/>
<path d="M16 20h28l-3 -8H19z M18 24v14h24V24M26 38v-8h8v8" fill="none" stroke="#2A2A2E" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></g>
<g transform="translate(410 6)"><path d="M30 0C14 0 2 12 2 28c0 20 28 48 28 48s28-28 28-48C58 12 46 0 30 0z" fill="#fff"/><circle cx="30" cy="28" r="10" fill="#2A2A2E"/></g>
<g transform="translate(236 138)"><circle cx="16" cy="16" r="16" fill="#2A2A2E" stroke="#D8AD18" stroke-width="4"/><path d="M8 18l6-8h8l4 8M10 20h12" stroke="#D8AD18" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
</svg>`;
}
