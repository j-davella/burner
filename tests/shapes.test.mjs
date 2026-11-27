// Design-tool geometry checks. Run: node tests/shapes.test.mjs
import * as S from '../web/engine/shapes.js';
let fail = 0;
const ok = (c, msg) => { if (c) console.log('ok  ', msg); else { fail++; console.log('FAIL', msg); } };
const bbox = ps => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of ps) for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); c = Math.max(c, p[i]); b = Math.min(b, p[i + 1]); d = Math.max(d, p[i + 1]); } return [a, b, c, d]; };
const area = p => { let s = 0; for (let i = 0; i + 3 < p.length; i += 2) s += p[i] * p[i + 3] - p[i + 2] * p[i + 1]; return s / 2; };
const closed = p => p[0] === p[p.length - 2] && p[1] === p[p.length - 1];
const near = (a, b, t) => Math.abs(a - b) <= t;

const r = S.rectShape(40, 20)[0];
ok(closed(r) && near(area(r), 800, 1e-9), 'rect 40x20: closed, area 800');
const rr = S.rectShape(40, 20, 5)[0], rb = bbox([rr]);
ok(closed(rr) && near(area(rr), 800 - (4 - Math.PI) * 25, 0.5) && near(rb[2], 40, 1e-9) && near(rb[3], 20, 1e-9), 'rounded rect r5: area 800-(4-pi)r^2, still 40x20');
const e = S.ellipseShape(30, 30)[0];
ok(near(area(e), Math.PI * 225, 1.5), 'circle d30: area pi*15^2 (within chord error)');
const hx = S.polygonShape(6, 50, 50)[0];
ok(hx.length === 14 && near(bbox([hx])[2], 50, 1e-9), 'hexagon: 6 sides, fills 50 wide');
const st = S.makeShape({ kind: 'star', n: 5, w: 50, h: 48, inner: 0.4 })[0], sb = bbox([st]);
ok(st.length === 22 && near(sb[2], 50, 1e-9) && near(sb[3], 48, 1e-9), 'star: 10 points, fills 50 x 48');

const t = S.strokeText('Hello 123', 10);
const tb = bbox(t);
ok(t.length > 10 && near(tb[3], 10, 0.3) && tb[1] < 0.5 && tb[1] > -0.5, 'stroke text: cap height 10 mm, sits on the baseline');
const g = S.strokeText('gy', 10); ok(bbox(g)[1] < -2.5, 'stroke text: descenders go below the baseline');
const two = S.strokeText('AB\nC', 10, 'center'), tw = bbox(two);
ok(tw[1] < -10, 'stroke text: second line below the first');
ok(S.strokeChars.length > 85, 'stroke font covers ' + S.strokeChars.length + ' characters');
ok(S.strokeText('é~', 10).length > 0, 'unknown characters fall back to ?');

// tracing: a disc with a square hole, 200x200 grid
const N = 200, a = new Float32Array(N * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const dx = x + 0.5 - 100, dy = y + 0.5 - 100, d = Math.hypot(dx, dy);
  a[y * N + x] = Math.max(0, Math.min(1, 80 - d + 0.5)) * (Math.abs(dx) < 20 && Math.abs(dy) < 20 ? 0 : 1);
}
const L = S.traceContours(a, N, N);
const areas = L.map(area).sort((p, q) => Math.abs(q) - Math.abs(p));
ok(L.length === 2 && L.every(closed), 'trace: disc with a hole gives 2 closed loops');
ok(near(Math.abs(areas[0]), Math.PI * 6400, 60) && near(Math.abs(areas[1]), 1600, 40), 'trace: areas match (outer pi*80^2, hole 40^2)');
ok(Math.sign(areas[0]) !== Math.sign(areas[1]), 'trace: hole runs the other way round');
const lb = bbox([L[0]]);
ok(lb[3] > lb[1] && near(lb[2] - lb[0], 160, 1.5), 'trace: 160 wide');
ok(S.traceContours(new Float32Array(16), 4, 4).length === 0, 'trace: empty grid gives nothing');

// arrays
ok(JSON.stringify(S.gridOffsets(3, 2, 10, 5)) === JSON.stringify([[0, 0, 0], [10, 0, 0], [20, 0, 0], [0, 5, 0], [10, 5, 0], [20, 5, 0]]), 'grid array offsets');
const c = S.circleOffsets(4, 10, 0, 0, 0, true);
ok(near(c[1][0], -10, 1e-9) && near(c[1][1], 10, 1e-9) && c[1][2] === 90 && c[0][0] === 0, 'circular array: 4 copies, 90 deg apart, rotated');

// nesting: no overlaps, inside the sheet, turned when that helps
const items = [{ w: 50, h: 30 }, { w: 30, h: 50 }, { w: 120, h: 20 }, { w: 40, h: 40 }, { w: 25, h: 25 }, { w: 500, h: 10 }];
const P = S.nestBoxes(items, 200, 150, 3);
const boxes = P.map((p, i) => p && { x0: p.x, y0: p.y, x1: p.x + (p.turn ? items[i].h : items[i].w), y1: p.y + (p.turn ? items[i].w : items[i].h) });
const overl = boxes.some((A, i) => A && boxes.some((B, j) => B && j > i && A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1));
ok(!overl && boxes.every(b => !b || (b.x0 >= 0 && b.y0 >= 0 && b.x1 <= 200 && b.y1 <= 150)), 'nest: no overlaps, all inside the sheet');
ok(P[5] === null && P.slice(0, 5).every(Boolean), 'nest: everything that fits is placed; the 500 mm strip is not');
ok(P[1].turn === true, 'nest: a tall part is turned to lie flat');

console.log(fail ? `\nFAIL: ${fail}` : '\nPASS'); process.exit(fail ? 1 : 0);
