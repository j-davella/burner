// Camera alignment math. Run: node tests/camera.test.mjs
import * as C from '../web/engine/camera.js';
let fail = 0;
const ok = (c, msg) => { if (c) console.log('ok  ', msg); else { fail++; console.log('FAIL', msg); } };

const bed = { x0: 0, y0: 0, w: 400, h: 400 };
const M = C.markPoints(bed);
ok(JSON.stringify(M) === JSON.stringify([[48, 48], [352, 48], [352, 352], [48, 352]]), 'marks 12% in from the corners, in click order');

// a camera looking down at an angle: a known homography machine -> image
const Htrue = [2.1, 0.35, 310, -0.12, -1.9, 1650, 0.00021, 0.00034, 1];
const img = M.map(([x, y]) => C.applyH(Htrue, x, y));
const H = C.homography(M, img);
let err = 0;
for (let x = 0; x <= 400; x += 25) for (let y = 0; y <= 400; y += 25) { const a = C.applyH(H, x, y), b = C.applyH(Htrue, x, y); err = Math.max(err, Math.hypot(a[0] - b[0], a[1] - b[1])); }
ok(err < 1e-6, 'homography from 4 marks reproduces the camera over the whole bed (max err ' + err.toExponential(1) + ' px)');
const Hi = C.invertH(H);
let e2 = 0; for (const [x, y] of [[0, 0], [400, 0], [123, 321], [400, 400]]) { const [u, v] = C.applyH(H, x, y), [bx, by] = C.applyH(Hi, u, v); e2 = Math.max(e2, Math.hypot(bx - x, by - y)); }
ok(e2 < 1e-6, 'inverse maps image pixels back to machine mm');

// one sloppy click (3 px off) costs well under a millimetre in the middle of the bed
const img2 = img.map(p => p.slice()); img2[2][0] += 3;
const H2 = C.homography(M, img2), Hi2 = C.invertH(H2), Hi1 = C.invertH(Htrue);
const mid = C.applyH(Htrue, 200, 200), m1 = C.applyH(Hi1, ...mid), m2 = C.applyH(Hi2, ...mid);
ok(Math.hypot(m1[0] - m2[0], m1[1] - m2[1]) < 1, '3 px click error -> ' + Math.hypot(m1[0] - m2[0], m1[1] - m2[1]).toFixed(2) + ' mm at bed center');

ok(C.quadOK(img), 'clicked marks form a proper quad');
ok(!C.quadOK([img[0], img[2], img[1], img[3]]), 'marks clicked in the wrong order are rejected');
ok(!C.quadOK([[0, 0], [10, 0], [20, 0], [5, 5]]), 'three marks in a line are rejected');
ok(C.homography(M, [[0, 0], [0, 0], [0, 0], [0, 0]]) === null || !C.quadOK([[0, 0], [0, 0], [0, 0], [0, 0]]), 'degenerate input does not pass');

const g = C.markGcode(M, [10, 20], 200, 600);
ok(g.includes('G0 X32 Y28') && g.filter(l => l === 'M4 S200').length === 4 * 2 + 10 && g[g.length - 1] === 'M5 S0', 'mark G-code: work coords, 2 strokes + n ticks per mark, laser off at the end');
ok(!g.some((l, i) => l.startsWith('G0') && g.slice(0, i).reverse().find(x => /^M[345]/.test(x)) === 'M4 S200'), 'every rapid happens with the laser off');

console.log(fail ? `\nFAIL: ${fail}` : '\nPASS'); process.exit(fail ? 1 : 0);
