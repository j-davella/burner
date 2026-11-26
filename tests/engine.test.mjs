// Node check of the pure engine against the browser-captured golden G-code.
// Run: node tests/engine.test.mjs
import { readFileSync } from 'node:fs';
import Core from '../web/engine/core.js';
import * as E from '../web/engine/gcode.js';
import * as G from '../web/engine/geom.js';
import { parseDXF } from '../web/engine/dxf.js';
import * as J from '../web/engine/jobs.js';

const here = new URL('.', import.meta.url);
const gold = JSON.parse(readFileSync(new URL('golden/golden.json', here)));
let fail = 0;
// Exact match, or (for trig-heavy curves) same commands with every coordinate within TOL mm.
// Node's V8 and the browser's V8 can differ in the last bit of Math.cos, which can make
// Douglas-Peucker keep a different (equally valid) arc vertex. The browser harness
// (tests/golden-harness.js) is the byte-exact check; this one guards logic.
const TOL = 0.5;
const near = (a, b) => {
  const ta = a.split(' '), tb = b.split(' ');
  return ta.length === tb.length && ta.every((t, i) => t === tb[i] ||
    (t[0] === tb[i][0] && /^[XY]/.test(t) && Math.abs(+t.slice(1) - +tb[i].slice(1)) <= TOL));
};
const check = (name, got) => {
  const want = gold[name];
  if (JSON.stringify(got) === JSON.stringify(want)) { console.log('ok  ', name, got.length, 'lines'); return; }
  const i = got.length === want.length ? got.findIndex((l, j) => !near(l, want[j])) : Math.min(got.length, want.length);
  if (i < 0) { console.log('ok~ ', name, got.length, 'lines (coords within ' + TOL + ' mm)'); return; }
  fail++; console.log('FAIL', name, 'line', i + 1, JSON.stringify(want[i]), '!=', JSON.stringify(got[i]));
};

// DXF -> object exactly as the UI's addVec/addObj build it (first object on an empty bed)
const v = G.normalizeVec(parseDXF(readFileSync(new URL('fixtures/sample.dxf', here), 'utf8')));
const o = { type: 'vec', name: 'sample.dxf', polys: v.polys, cx: 0, cy: 0, cw: v.w, ch: v.h, sx: 1, sy: 1, rot: 0, on: true };
o.x = v.w / 2; o.y = v.h / 2;
o.pathOp = o.polys.map((p, i) => ['cut', 'score', 'fill', 'off'][i % 4]).map((op, i) => op === 'fill' && !G.isClosed(o.polys[i]) ? 'score' : op);
o.set = { cut: { power: 90, feed: 4, passes: 2 }, score: { power: 25, feed: 18, passes: 1 }, fill: { power: 35, feed: 55, passes: 2, interval: 0.15 } };
const job = o => { const L = ['G21', 'G90']; E.vectorGcode([o], 1000, L); L.push('M5 S0', 'G0 X0 Y0'); return L; };
check('dxf', job(o));
// the same job through the Web Worker's entry point (engine/jobs.js), as the UI now runs it
const settings0 = { 30: '1000', 110: '6000', 111: '6000', 120: '500', 121: '500' };
const wres = J.runJob('gen', { imgs: [], vecs: [o], SM: 1000, settings: settings0, smax: 1000 });
check('dxf', wres.text.split('\n'));
o.rot = 30; o.sx = 1.25; o.sy = 0.8; o.x += 7;
check('dxf_xform', job(o));

// Test Lab vector blocks, slot index 7, 5 per row
const TESTS = [['score', 'Score', 'score', { power: 30, feed: 20, passes: 1 }], ['fill', 'Fill', 'fill', { power: 40, feed: 60, passes: 1, interval: 0.1 }],
  ['cut16', 'Cut 1/16"', 'cut', { power: 100, feed: 8, passes: 1 }], ['cut8', 'Cut 1/8"', 'cut', { power: 100, feed: 5, passes: 2 }],
  ['cut316', 'Cut 3/16"', 'cut', { power: 100, feed: 4, passes: 3 }], ['cut4', 'Cut 1/4"', 'cut', { power: 100, feed: 3, passes: 4 }],
  ['cut38', 'Cut 3/8"', 'cut', { power: 100, feed: 2, passes: 6 }]];
for (const [id, name, op, def] of TESTS) {
  const L = ['; TEST ' + name + ' slot 8 (Golden)', 'G21', 'G90'];
  check('lab_' + id, E.testVecGcode({ op }, def, 60, 30, 1000, L));
}

// estimate + sections + preview on the big combined job
const comb = gold.combined;
const settings = { 30: '1000', 110: '6000', 111: '6000', 120: '500', 121: '500' };
check('combined_est', [String(E.estLineTimes(comb, settings).reduce((a, b) => a + b, 0).toFixed(6))]);
const sx = E.buildSections(comb); check('combined_sections', [Array.from(sx.sec).join(','), sx.mx.join(',')]);
const P = Core.parseGcode(comb, 1000);
check('combined_preview', [P.n, JSON.stringify(P.all), JSON.stringify(P.burn), P.estMin.toFixed(6), Array.from(P.lvl).join('')].map(String));

console.log(fail ? `\nFAIL: ${fail}` : '\nPASS'); process.exit(fail ? 1 : 0);
