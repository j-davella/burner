// Design-tool geometry: basic shapes, a single-line stroke font for scoring, contour
// tracing (outline text from any font the browser can draw), arrays and sheet nesting.
// Pure, no DOM. Units mm, y up. Polylines are flat [x,y,x,y,...]; closed ones repeat
// their first point at the end (the convention the rest of the engine uses).

const close = p => { if (p[0] !== p[p.length - 2] || p[1] !== p[p.length - 1]) p.push(p[0], p[1]); return p; };
// segments for a full circle of radius r so the chord error stays under ~0.02 mm
const segsFor = (r, frac = 1) => Math.max(8, Math.ceil(frac * Math.PI / Math.acos(Math.max(-1, 1 - 0.02 / Math.max(r, 0.05)))));

export function rectShape(w, h, r = 0) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r < 1e-6) return [[0, 0, w, 0, w, h, 0, h, 0, 0]];
  const p = [], n = segsFor(r, 0.25);
  const corner = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI / 2; p.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); } };
  corner(w - r, r, -Math.PI / 2); corner(w - r, h - r, 0); corner(r, h - r, Math.PI / 2); corner(r, r, Math.PI);
  return [close(p)];
}
export function ellipseShape(w, h) {
  const n = segsFor(Math.max(w, h) / 2), p = [];
  for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; p.push(w / 2 + w / 2 * Math.cos(a), h / 2 + h / 2 * Math.sin(a)); }
  return [close(p)];
}
// regular polygon / star, point up, scaled to fill w x h
export function polygonShape(n, w, h, inner = 0) {
  n = Math.max(3, Math.min(200, n | 0));
  const pts = [], k = inner > 0 ? 2 * n : n;
  for (let i = 0; i < k; i++) {
    const a = Math.PI / 2 + i / k * 2 * Math.PI, r = inner > 0 && i % 2 ? inner : 1;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const p = []; for (const [x, y] of pts) p.push((x - x0) / (x1 - x0) * w, (y - y0) / (y1 - y0) * h);
  return [close(p)];
}
export function makeShape(s) {
  const w = Math.max(0.1, +s.w || 10), h = Math.max(0.1, +s.h || 10);
  if (s.kind === 'rect') return rectShape(w, h, +s.r || 0);
  if (s.kind === 'ellipse') return ellipseShape(w, h);
  if (s.kind === 'polygon') return polygonShape(+s.n || 6, w, h);
  if (s.kind === 'star') return polygonShape(+s.n || 5, w, h, Math.max(0.05, Math.min(0.95, +s.inner || 0.45)));
  throw new Error('unknown shape ' + s.kind);
}

// ---------- single-line font ----------
// Cap height 10, x-height 6.5, baseline 0, descender to -3.5. Per glyph: [width, path].
// Path: M x y = new stroke, L x y = line to, N = new empty stroke, A cx cy rx ry a0 a1 =
// elliptical arc appended to the current stroke (degrees; a1 < a0 runs clockwise).
const G = {
  ' ': [4, ''],
  A: [8, 'M0 0 L4 10 L8 0 M1.6 4 L6.4 4'], B: [7, 'M0 0 L0 10 L4.5 10 A4.5 7.5 2.5 2.5 90 -90 L0 5 M4.5 5 A4.5 2.5 2.5 2.5 90 -90 L0 0'],
  C: [8, 'N A4.5 5 4 5 40 320'], D: [7.5, 'M0 0 L0 10 L3 10 A3 5 4.5 5 90 -90 L0 0'], E: [6.5, 'M6.5 10 L0 10 L0 0 L6.5 0 M0 5 L5 5'],
  F: [6, 'M6 10 L0 10 L0 0 M0 5 L5 5'], G: [8.5, 'N A4.5 5 4 5 45 340 L8.3 4.5 L5.5 4.5'], H: [7, 'M0 0 L0 10 M7 0 L7 10 M0 5 L7 5'],
  I: [2, 'M1 0 L1 10'], J: [5.5, 'M5.5 10 L5.5 2.5 A3 2.5 2.5 2.5 0 -180'], K: [7, 'M0 0 L0 10 M7 10 L0 3.5 M2.4 5.8 L7 0'],
  L: [6, 'M0 10 L0 0 L6 0'], M: [9, 'M0 0 L0 10 L4.5 2 L9 10 L9 0'], N: [7, 'M0 0 L0 10 L7 0 L7 10'],
  O: [9, 'N A4.5 5 4.5 5 0 360'], P: [7, 'M0 0 L0 10 L4.5 10 A4.5 7.5 2.5 2.5 90 -90 L0 5'],
  Q: [9, 'N A4.5 5 4.5 5 0 360 M5.5 2.5 L9 -0.5'], R: [7, 'M0 0 L0 10 L4.5 10 A4.5 7.5 2.5 2.5 90 -90 L0 5 M3.5 5 L7 0'],
  S: [7, 'N A3.5 7.5 3.2 2.5 20 270 A3.5 2.5 3.5 2.5 90 -160'], T: [7, 'M0 10 L7 10 M3.5 10 L3.5 0'],
  U: [7, 'M0 10 L0 3.5 A3.5 3.5 3.5 3.5 180 360 L7 10'], V: [8, 'M0 10 L4 0 L8 10'], W: [11, 'M0 10 L2.75 0 L5.5 8 L8.25 0 L11 10'],
  X: [7, 'M0 0 L7 10 M0 10 L7 0'], Y: [8, 'M0 10 L4 5 L8 10 M4 5 L4 0'], Z: [7, 'M0 10 L7 10 L0 0 L7 0'],
  a: [6, 'N A3 3.25 3 3.25 0 360 M6 6.5 L6 0'], b: [6, 'M0 10 L0 0 N A3 3.25 3 3.25 0 360'], c: [5.5, 'N A3 3.25 3 3.25 45 315'],
  d: [6, 'M6 10 L6 0 N A3 3.25 3 3.25 0 360'], e: [6, 'M0.2 3.25 L6 3.25 A3 3.25 3 3.25 0 315'],
  f: [4, 'M4.3 8.8 A3 8 1.5 1.5 30 180 L1.5 0 M0 6.5 L3.5 6.5'], g: [6, 'N A3 3.25 3 3.25 0 360 M6 6.5 L6 -1 A3 -1 3 2.5 0 -170'],
  h: [6, 'M0 10 L0 0 M0 3.5 A3 3.5 3 3 180 0 L6 0'], i: [1, 'M0.5 0 L0.5 6.5 M0.5 8.6 L0.5 9.2'],
  j: [3, 'M2.5 6.5 L2.5 -1.5 A1 -1.5 1.5 2 0 -150 M2.5 8.6 L2.5 9.2'], k: [5.5, 'M0 0 L0 10 M5.5 6.5 L0 2.5 M1.8 3.8 L5.5 0'],
  l: [1, 'M0.5 10 L0.5 0'], m: [9, 'M0 0 L0 6.5 M0 4 A2.25 4 2.25 2.5 180 0 L4.5 0 M4.5 4 A6.75 4 2.25 2.5 180 0 L9 0'],
  n: [6, 'M0 0 L0 6.5 M0 3.5 A3 3.5 3 3 180 0 L6 0'], o: [6, 'N A3 3.25 3 3.25 0 360'],
  p: [6, 'M0 6.5 L0 -3.5 N A3 3.25 3 3.25 0 360'], q: [6, 'M6 6.5 L6 -3.5 N A3 3.25 3 3.25 0 360'],
  r: [4.5, 'M0 0 L0 6.5 M0 3.5 A3 3.5 3 3 180 60'], s: [5, 'N A2.5 4.9 2.3 1.6 20 270 A2.5 1.6 2.5 1.6 90 -160'],
  t: [4, 'M1.5 9 L1.5 1.2 A3 1.2 1.5 1.2 180 300 M0 6.5 L4 6.5'], u: [6, 'M0 6.5 L0 3 A3 3 3 3 180 360 M6 6.5 L6 0'],
  v: [6, 'M0 6.5 L3 0 L6 6.5'], w: [9, 'M0 6.5 L2.25 0 L4.5 5 L6.75 0 L9 6.5'], x: [6, 'M0 0 L6 6.5 M0 6.5 L6 0'],
  y: [6, 'M0 6.5 L3 0 M6 6.5 L2 -2.5 L0.5 -3.5'], z: [6, 'M0 6.5 L6 6.5 L0 0 L6 0'],
  0: [7, 'N A3.5 5 3.5 5 0 360'], 1: [5.5, 'M1 8 L3 10 L3 0 M0.5 0 L5.5 0'], 2: [7, 'N A3.5 6.8 3.2 3.2 160 -40 L0 0 L7 0'],
  3: [7, 'N A3.5 7.6 3 2.4 150 -90 A3.5 2.6 3.5 2.6 90 -150'], 4: [7, 'M5.5 0 L5.5 10 L0 2.5 L7 2.5'],
  5: [7, 'M6.5 10 L1 10 L0.5 5.5 A3.5 3.2 3.5 3.2 135 -150'], 6: [7, 'N A3.5 3.3 3.3 3.3 0 360 M0.2 3.3 L0.2 5.5 A3.7 5.5 3.5 4.5 180 50'],
  7: [7, 'M0 10 L7 10 L2.5 0'], 8: [7, 'N A3.5 7.6 2.9 2.4 0 360 N A3.5 2.6 3.4 2.6 0 360'],
  9: [7, 'N A3.5 6.7 3.3 3.3 0 360 M6.8 6.7 L6.8 4.5 A3.3 4.5 3.5 4.5 0 -130'],
  '.': [1, 'M0.5 0 L0.5 0.6'], ',': [1.5, 'M1 0.5 L0 -1.5'], '!': [1, 'M0.5 10 L0.5 3 M0.5 0 L0.5 0.6'],
  '?': [6, 'N A3 7.5 3 2.5 160 -60 L3 3 M3 0 L3 0.6'], '-': [5, 'M0.5 4 L4.5 4'], '+': [6, 'M0 4 L6 4 M3 1 L3 7'],
  '=': [6, 'M0 3 L6 3 M0 5.5 L6 5.5'], '/': [5, 'M0 -1 L5 11'], ':': [1, 'M0.5 0 L0.5 0.6 M0.5 5 L0.5 5.6'],
  ';': [1.5, 'M1 0.5 L0 -1.5 M1 5 L1 5.6'], "'": [1, 'M0.5 10 L0.5 7.5'], '"': [3, 'M0.5 10 L0.5 7.5 M2.5 10 L2.5 7.5'],
  '(': [3, 'N A6 4 5.5 7 150 210'], ')': [3, 'N A-3 4 5.5 7 30 -30'], _: [6, 'M0 -1 L6 -1'],
  '*': [5, 'M2.5 9 L2.5 5 M0.5 8 L4.5 6 M0.5 6 L4.5 8'], '#': [7, 'M2 0 L3 10 M5 0 L6 10 M0 3.3 L7 3.3 M0 6.6 L7 6.6'],
  '&': [8, 'M8 0 L1.8 6.8 A3.2 8 1.6 1.8 220 -30 L1.2 3 A3.2 2.2 2.2 2.2 160 -60 L7.5 4.5'],
  '%': [8, 'N A1.8 8 1.5 1.8 0 360 N A6.2 2 1.5 1.8 0 360 M7.5 10 L0.5 0'], $: [7, 'N A3.5 7.5 3.2 2.5 20 270 A3.5 2.5 3.5 2.5 90 -160 M3.5 11 L3.5 -1'],
  '<': [5, 'M5 8 L0 4.5 L5 1'], '>': [5, 'M0 8 L5 4.5 L0 1'], '[': [3, 'M3 11 L0.5 11 L0.5 -2 L3 -2'], ']': [3, 'M0 11 L2.5 11 L2.5 -2 L0 -2'],
};
const glyphCache = {};
function glyph(ch) {
  if (glyphCache[ch]) return glyphCache[ch];
  const g = G[ch] || G['?'], strokes = []; let cur = null;
  // tokens: a command letter, optionally glued to its first number ("L4 10" or "L 4 10")
  const t = g[1].trim() ? g[1].trim().split(/\s+/).flatMap(w => /^[A-Z]./.test(w) ? [w[0], w.slice(1)] : [w]) : [];
  for (let i = 0; i < t.length;) {
    const c = t[i++];
    if (c === 'M') { cur = [+t[i++], +t[i++]]; strokes.push(cur); }
    else if (c === 'L') { cur.push(+t[i++], +t[i++]); }
    else if (c === 'N') { cur = null; }
    else if (c === 'A') {
      const cx = +t[i++], cy = +t[i++], rx = +t[i++], ry = +t[i++], a0 = +t[i++], a1 = +t[i++];
      if (!cur) { cur = []; strokes.push(cur); }
      const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 9));
      for (let k = 0; k <= n; k++) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; cur.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
    }
  }
  return (glyphCache[ch] = { w: g[0], strokes: strokes.filter(s => s.length >= 4) });
}
export const strokeChars = Object.keys(G);
// text -> open polylines. size = cap height (mm). lines split on \n; align left|center|right.
export function strokeText(str, size, align = 'left', spacing = 1) {
  const k = size / 10, lh = 16 * k, gap = 2 * spacing;
  const lines = String(str).split('\n'), out = [];
  const widths = lines.map(l => [...l].reduce((w, ch) => w + glyph(ch).w + gap, 0) - (l.length ? gap : 0));
  const W = Math.max(0, ...widths);
  lines.forEach((l, li) => {
    let x = align === 'center' ? (W - widths[li]) / 2 : align === 'right' ? W - widths[li] : 0;
    const y = -li * lh;
    for (const ch of l) {
      const g = glyph(ch);
      for (const s of g.strokes) { const p = []; for (let i = 0; i < s.length; i += 2) p.push((x + s[i]) * k, y + s[i + 1] * k); out.push(p); }
      x += g.w + gap;
    }
  });
  return out;
}

// ---------- contour tracing ----------
// Marching squares on a coverage grid (0..1, row 0 = top), threshold 0.5, linear
// interpolation on cell edges. Returns closed loops in grid units with y flipped up
// (y = rows - row), so holes come out as their own loops (even-odd fill handles them).
export function traceContours(a, cols, rows) {
  const W = cols + 2, H = rows + 2;                      // pad with an empty border so every loop closes
  const v = (x, y) => (x <= 0 || y <= 0 || x > cols || y > rows) ? 0 : a[(y - 1) * cols + (x - 1)];
  const T = 0.5;
  // edge ids: horizontal edge from (x,y)-(x+1,y) = 2*(y*W+x); vertical (x,y)-(x,y+1) = +1
  const hE = (x, y) => 2 * (y * W + x), vE = (x, y) => 2 * (y * W + x) + 1;
  const pos = new Map(), next = new Map();
  const at = (id, x0, y0, x1, y1, va, vb) => {
    if (!pos.has(id)) { const t = Math.abs(vb - va) > 1e-9 ? (T - va) / (vb - va) : 0.5; pos.set(id, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); }
    return id;
  };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const tl = v(x, y), tr = v(x + 1, y), br = v(x + 1, y + 1), bl = v(x, y + 1);
    const c = (tl >= T ? 8 : 0) | (tr >= T ? 4 : 0) | (br >= T ? 2 : 0) | (bl >= T ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const top = () => at(hE(x, y), x, y, x + 1, y, tl, tr), bot = () => at(hE(x, y + 1), x, y + 1, x + 1, y + 1, bl, br);
    const lef = () => at(vE(x, y), x, y, x, y + 1, tl, bl), rig = () => at(vE(x + 1, y), x + 1, y, x + 1, y + 1, tr, br);
    // segments oriented so inside is on the left (consistent direction lets loops chain)
    const seg = (a, b) => next.set(a, b);
    const mid = (tl + tr + br + bl) / 4;
    switch (c) {
      case 1: seg(bot(), lef()); break; case 2: seg(rig(), bot()); break; case 3: seg(rig(), lef()); break;
      case 4: seg(top(), rig()); break; case 6: seg(top(), bot()); break; case 7: seg(top(), lef()); break;
      case 8: seg(lef(), top()); break; case 9: seg(bot(), top()); break; case 11: seg(rig(), top()); break;
      case 12: seg(lef(), rig()); break; case 13: seg(bot(), rig()); break; case 14: seg(lef(), bot()); break;
      case 5: if (mid >= T) { seg(top(), lef()); seg(bot(), rig()); } else { seg(bot(), lef()); seg(top(), rig()); } break;
      case 10: if (mid >= T) { seg(lef(), bot()); seg(rig(), top()); } else { seg(lef(), top()); seg(rig(), bot()); } break;
    }
  }
  const loops = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const p = []; let id = start, guard = 0;
    while (id !== undefined && !seen.has(id) && guard++ < 1e7) { seen.add(id); const [x, y] = pos.get(id); p.push(x - 1, rows - (y - 1)); id = next.get(id); }
    if (p.length >= 6) loops.push(close(p));
  }
  return loops;
}

// ---------- arrays ----------
// grid: offsets (mm) for cols x rows copies with the given pitch; [0,0] (the original) first
export function gridOffsets(cols, rows, px, py) {
  const out = []; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push([i * px, j * py, 0]);
  return out;
}
// circular: n copies around (cx,cy) starting at the original's position (x,y); returns
// [x, y, rotation added] per copy, original first
export function circleOffsets(n, x, y, cx, cy, rotate) {
  const out = [], r = Math.hypot(x - cx, y - cy), a0 = Math.atan2(y - cy, x - cx);
  for (let k = 0; k < n; k++) { const a = a0 + k * 2 * Math.PI / n; out.push([cx + r * Math.cos(a) - x, cy + r * Math.sin(a) - y, rotate ? k * 360 / n : 0]); }
  return out;
}

// ---------- nesting ----------
// Shelf packing of bounding boxes into a sheet. items: [{w,h}] (mm). Each item may be
// turned 90 deg to lie flat (wide side along X) when that fits. Returns one entry per
// item: {x, y, turn} (bottom-left of its box) or null if it did not fit.
export function nestBoxes(items, sheetW, sheetH, gap = 2) {
  const order = items.map((it, i) => {
    let w = it.w, h = it.h, turn = false;
    if (h > w && h <= sheetW) { [w, h] = [h, w]; turn = true; }
    if (w > sheetW && h <= sheetW && w <= sheetH) { [w, h] = [h, w]; turn = !turn; }
    return { i, w, h, turn };
  }).sort((a, b) => b.h - a.h || b.w - a.w);
  const out = new Array(items.length).fill(null);
  let x = 0, y = 0, shelf = 0;
  for (const it of order) {
    if (it.w > sheetW + 1e-9) continue;
    if (x > 0 && x + it.w > sheetW + 1e-9) { x = 0; y += shelf + gap; shelf = 0; }
    if (y + it.h > sheetH + 1e-9) continue;
    out[it.i] = { x, y, turn: it.turn };
    x += it.w + gap; shelf = Math.max(shelf, it.h);
  }
  return out;
}
