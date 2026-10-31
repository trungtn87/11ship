#!/usr/bin/env node
// Build-time offline place index for the 11Food address search (issue #283). Reads the OSM extract that is already in the repository
// (ops/m14/data/caobang.osm.pbf, Geofabrik, ODbL) and writes a small JSON the phone loads once: no Internet, no map scan while typing.
//
//   node scripts/places/build-search-index.mjs [input.osm.pbf] [output.json]
//
// Only what OpenStreetMap really has is indexed: a named place / road / facility and one REAL point of it (a node of the way that lies on it, or the
// node itself). A road is one entry with a point ON the road. Nothing is invented: no house numbers, no coordinates for an address OSM does not know.
// The point filter is the bounds of the offline map package (same as mobile/gps-test/tools/prepare-data.sh), so a result can always be pinned on the map.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const input = resolve(process.argv[2] ?? resolve(here, '../../ops/m14/data/caobang.osm.pbf'));
const output = resolve(process.argv[3] ?? resolve(here, '../../mobile/packages/n11_shared/assets/places/caobang-places.json'));
const MAP_VERSION = 'caobang-v1.3-2026-10-14';
const BOUNDS = { minLng: 106.0, minLat: 22.43, maxLng: 106.52, maxLat: 22.91 }; // mobile/gps-test/assets/caobang/manifest.json

// ---- protobuf reader (only what OSM PBF needs) ----------------------------------------------------------------------------------------------------
class Reader {
  constructor(buf, pos = 0, end = buf.length) { this.buf = buf; this.pos = pos; this.end = end; }
  more() { return this.pos < this.end; }
  varint() { // unsigned 64 bit as BigInt
    let result = 0n; let shift = 0n;
    for (;;) {
      const b = this.buf[this.pos++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
    }
  }
  tag() { const v = Number(this.varint()); return [v >>> 3, v & 7]; }
  bytes() { const n = Number(this.varint()); const out = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return out; }
  skip(wire) { if (wire === 0) this.varint(); else if (wire === 1) this.pos += 8; else if (wire === 2) this.bytes(); else if (wire === 5) this.pos += 4; else throw new Error('wire ' + wire); }
}
const zig = (v) => Number((v >> 1n) ^ -(v & 1n));
const packed = (buf, signed) => { const r = new Reader(buf); const out = []; while (r.more()) { const v = r.varint(); out.push(signed ? zig(v) : Number(v)); } return out; };

function* blobs(file) {
  let pos = 0;
  while (pos < file.length) {
    const headerLength = file.readUInt32BE(pos); pos += 4;
    const header = new Reader(file, pos, pos + headerLength); pos += headerLength;
    let type = ''; let dataSize = 0;
    while (header.more()) { const [f, w] = header.tag(); if (f === 1) type = header.bytes().toString(); else if (f === 3) dataSize = Number(header.varint()); else header.skip(w); }
    const blob = new Reader(file, pos, pos + dataSize); pos += dataSize;
    let raw = null; let zlib = null;
    while (blob.more()) { const [f, w] = blob.tag(); if (f === 1) raw = blob.bytes(); else if (f === 3) zlib = blob.bytes(); else blob.skip(w); }
    yield { type, data: raw ?? (zlib ? inflateSync(zlib) : Buffer.alloc(0)) };
  }
}

function parseBlock(data, handlers) {
  const r = new Reader(data);
  const strings = []; const groups = []; let granularity = 100; let latOffset = 0n; let lonOffset = 0n;
  while (r.more()) {
    const [f, w] = r.tag();
    if (f === 1) { const st = new Reader(r.bytes()); while (st.more()) { const [sf, sw] = st.tag(); if (sf === 1) strings.push(st.bytes().toString('utf8')); else st.skip(sw); } }
    else if (f === 2) groups.push(r.bytes());
    else if (f === 17) granularity = Number(r.varint());
    else if (f === 19) latOffset = BigInt.asIntN(64, r.varint());
    else if (f === 20) lonOffset = BigInt.asIntN(64, r.varint());
    else r.skip(w);
  }
  const lat = (v) => (Number(latOffset) + granularity * v) / 1e9;
  const lon = (v) => (Number(lonOffset) + granularity * v) / 1e9;
  const tagsOf = (keys, vals) => { const t = {}; for (let i = 0; i < keys.length; i += 1) t[strings[keys[i]]] = strings[vals[i]]; return t; };
  for (const g of groups) {
    const gr = new Reader(g);
    while (gr.more()) {
      const [f, w] = gr.tag();
      if (f === 1) { // Node
        const n = new Reader(gr.bytes()); let id = 0; let keys = []; let vals = []; let la = 0; let lo = 0;
        while (n.more()) { const [nf, nw] = n.tag(); if (nf === 1) id = zig(n.varint()); else if (nf === 2) keys = packed(n.bytes(), false); else if (nf === 3) vals = packed(n.bytes(), false); else if (nf === 8) la = zig(n.varint()); else if (nf === 9) lo = zig(n.varint()); else n.skip(nw); }
        handlers.node(id, lat(la), lon(lo), tagsOf(keys, vals));
      } else if (f === 2) { // DenseNodes
        const d = new Reader(gr.bytes()); let ids = []; let las = []; let los = []; let kv = [];
        while (d.more()) { const [df, dw] = d.tag(); if (df === 1) ids = packed(d.bytes(), true); else if (df === 8) las = packed(d.bytes(), true); else if (df === 9) los = packed(d.bytes(), true); else if (df === 10) kv = packed(d.bytes(), false); else d.skip(dw); }
        let id = 0; let la = 0; let lo = 0; let k = 0;
        for (let i = 0; i < ids.length; i += 1) {
          id += ids[i]; la += las[i]; lo += los[i];
          const t = {};
          while (k < kv.length && kv[k] !== 0) { t[strings[kv[k]]] = strings[kv[k + 1]]; k += 2; }
          k += 1; // the 0 that ends this node's tags (a block without any tag has no keys_vals at all)
          if (kv.length === 0) k = 0;
          handlers.node(id, lat(la), lon(lo), t);
        }
      } else if (f === 3) { // Way
        const wy = new Reader(gr.bytes()); let id = 0; let keys = []; let vals = []; let refs = [];
        while (wy.more()) { const [wf, ww] = wy.tag(); if (wf === 1) id = Number(wy.varint()); else if (wf === 2) keys = packed(wy.bytes(), false); else if (wf === 3) vals = packed(wy.bytes(), false); else if (wf === 8) refs = packed(wy.bytes(), true); else wy.skip(ww); }
        let acc = 0; const nodes = refs.map((d) => (acc += d));
        handlers.way(id, nodes, tagsOf(keys, vals));
      } else gr.skip(w);
    }
  }
}

// ---- classification --------------------------------------------------------------------------------------------------------------------------
const CATEGORIES = { place: 'Địa danh', road: 'Đường', school: 'Trường học', health: 'Y tế', market: 'Chợ', food: 'Quán ăn, quán nước', bank: 'Ngân hàng', office: 'Cơ quan', stay: 'Nơi lưu trú', shop: 'Cửa hàng', fuel: 'Trạm xăng', station: 'Bến xe', tourism: 'Du lịch, di tích', nature: 'Sông, núi, thác', other: 'Địa điểm khác' };
function categoryOf(t) {
  if (t.place) return ['place', 3];
  if (t.highway) return ['road', 2];
  const a = t.amenity;
  if (['school', 'kindergarten', 'college', 'university'].includes(a)) return ['school', 1];
  if (['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy'].includes(a) || t.healthcare) return ['health', 1];
  if (a === 'marketplace') return ['market', 1];
  if (['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream'].includes(a)) return ['food', 0];
  if (['bank', 'atm'].includes(a)) return ['bank', 0];
  if (['townhall', 'police', 'post_office', 'courthouse', 'community_centre', 'public_building', 'fire_station', 'library'].includes(a) || t.office || t.government) return ['office', 1];
  if (a === 'fuel') return ['fuel', 0];
  if (a === 'bus_station' || t.public_transport === 'station') return ['station', 1];
  if (t.tourism && ['hotel', 'guest_house', 'hostel', 'motel', 'apartment', 'resort'].includes(t.tourism)) return ['stay', 0];
  if (t.tourism || t.historic) return ['tourism', 1];
  if (t.shop) return ['shop', 0];
  if (t.natural === 'peak' || t.natural === 'water' || t.waterway || t.natural === 'waterfall' || t.waterway === 'waterfall') return ['nature', 3];
  if (['place_of_worship', 'theatre', 'cinema', 'social_facility', 'bus_stop'].includes(a) || t.leisure || t.craft || t.man_made) return ['other', 0];
  return null;
}
const hasLatin = (s) => /[A-Za-zÀ-ỹ]/.test(s);
const insideBounds = (la, lo) => lo >= BOUNDS.minLng && lo <= BOUNDS.maxLng && la >= BOUNDS.minLat && la <= BOUNDS.maxLat;

// ---- build ------------------------------------------------------------------------------------------------------------------------------------
const file = readFileSync(input);
const nodes = new Map(); // id -> [lat, lng], only nodes the ways may need are kept after the first pass
const named = []; // {name, cat, tags, ref}
const wayList = [];

for (const blob of blobs(file)) {
  if (blob.type !== 'OSMData') continue;
  parseBlock(blob.data, {
    node(id, la, lo, t) {
      nodes.set(id, [la, lo]);
      const name = t['name:vi'] ?? t.name;
      if (!name || !hasLatin(name)) return;
      const c = categoryOf(t);
      if (c) named.push({ name, cat: c[0], tags: t, la, lo, osm: 'n' + id });
    },
    way(id, refs, t) {
      const name = t['name:vi'] ?? t.name;
      if (!name || !hasLatin(name)) return;
      const c = categoryOf(t);
      if (c) wayList.push({ name, cat: c[0], tags: t, refs, osm: 'w' + id });
    },
  });
}

// A way's point is one of ITS OWN nodes, the one nearest to the mean of its nodes (so it lies on the road / the building outline).
function onWayPoint(refs) {
  const pts = refs.map((r) => nodes.get(r)).filter(Boolean);
  if (pts.length === 0) return null;
  const mla = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const mlo = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let best = pts[0]; let bd = Infinity;
  for (const p of pts) { const d = (p[0] - mla) ** 2 + (p[1] - mlo) ** 2; if (d < bd) { bd = d; best = p; } }
  return { la: best[0], lo: best[1], mla, mlo, count: pts.length };
}

const entries = new Map(); // key -> entry
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
function addEntry(name, cat, la, lo, extra) {
  if (!insideBounds(la, lo)) return;
  // The same road is cut into many ways in OSM: one entry per (name, category); the point is the member nearest to the mean of the member points.
  const key = cat + '|' + strip(name) + (cat === 'road' || cat === 'nature' ? '' : '|' + la.toFixed(4) + ',' + lo.toFixed(4));
  const e = entries.get(key);
  if (!e) { entries.set(key, { name, cat, pts: [[la, lo]], addr: extra.addr }); return; }
  e.pts.push([la, lo]);
}
const addrOf = (t) => [t['addr:housenumber'], t['addr:street'], t['addr:suburb'] ?? t['addr:subdistrict'], t['addr:district'], t['addr:city'] ?? t['addr:province']].filter(Boolean).join(', ') || undefined;
for (const n of named) addEntry(n.name, n.cat, n.la, n.lo, { addr: addrOf(n.tags) });
for (const w of wayList) {
  const p = onWayPoint(w.refs);
  if (p) addEntry(w.name, w.cat, p.la, p.lo, { addr: addrOf(w.tags) });
}

const out = [];
for (const e of entries.values()) {
  let [la, lo] = e.pts[0];
  if (e.pts.length > 1) { // nearest of the real member points to their mean
    const mla = e.pts.reduce((s, p) => s + p[0], 0) / e.pts.length; const mlo = e.pts.reduce((s, p) => s + p[1], 0) / e.pts.length;
    let bd = Infinity; for (const p of e.pts) { const d = (p[0] - mla) ** 2 + (p[1] - mlo) ** 2; if (d < bd) { bd = d; [la, lo] = p; } }
  }
  const row = [e.name, Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5, e.cat];
  if (e.addr) row.push(e.addr);
  out.push(row);
}
out.sort((a, b) => a[3].localeCompare(b[3]) || a[0].localeCompare(b[0], 'vi'));

const byCat = {}; for (const r of out) byCat[r[3]] = (byCat[r[3]] ?? 0) + 1;
const doc = {
  version: 1, mapVersion: MAP_VERSION, source: 'OpenStreetMap contributors, Geofabrik Vietnam extract 2026-10-14 (ODbL-1.0)', bounds: [BOUNDS.minLng, BOUNDS.minLat, BOUNDS.maxLng, BOUNDS.maxLat],
  sourceSha256: createHash('sha256').update(file).digest('hex'), categories: CATEGORIES, count: out.length, places: out,
};
const text = JSON.stringify(doc);
import('node:fs').then(({ mkdirSync }) => {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, text);
  console.log(JSON.stringify({ output, entries: out.length, bytes: text.length, byCategory: byCat, nodesRead: nodes.size, namedNodes: named.length, namedWays: wayList.length }, null, 2));
});
