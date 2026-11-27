// Resume-from-line + air assist checks. Run: node tests/resume.test.mjs
// A tiny independent G-code interpreter runs (a) the original job and (b) the resume
// preamble + the job from line n. Every move from line n on must burn exactly the
// same segments at the same S, and the preamble itself must never move with the laser on.
import { readFileSync } from 'node:fs';
import * as E from '../web/engine/gcode.js';
import * as J from '../web/engine/jobs.js';

const here = new URL('.', import.meta.url);
const gold = JSON.parse(readFileSync(new URL('golden/golden.json', here)));
let fail = 0;
const ok = (c, msg) => { if (c) console.log('ok  ', msg); else { fail++; console.log('FAIL', msg); } };

// Executes lines; returns the moves made (x0,y0,x1,y1, burning?, S) tagged with the source index.
function run(lines, tagFrom = 0) {
  let x = 0, y = 0, abs = true, inch = false, mo = 0, S = 0, sp = 5, air = 0;
  const out = [];
  lines.forEach((raw, i) => {
    const L = String(raw).replace(/\(.*?\)|;.*$/g, '').toUpperCase(); if (!L || L[0] === '$') return;
    const w = [...L.matchAll(/([GMXYFS])([-+]?(?:\d+\.?\d*|\.\d+))/g)].map(m => [m[1], +m[2]]);
    for (const [k, v] of w) if (k === 'G' && (v === 20 || v === 21)) inch = v === 20;
    let nx = null, ny = null; const sc = inch ? 25.4 : 1;
    for (const [k, v] of w) {
      if (k === 'G') { if (v <= 3) mo = v; else if (v === 90) abs = true; else if (v === 91) abs = false; }
      else if (k === 'M') { if (v >= 3 && v <= 5) sp = v; if (v === 7 || v === 8) air |= v === 7 ? 1 : 2; if (v === 9) air = 0; }
      else if (k === 'S') S = v; else if (k === 'X') nx = v * sc; else if (k === 'Y') ny = v * sc;
    }
    if (nx === null && ny === null) return;
    const tx = nx === null ? x : abs ? nx : x + nx, ty = ny === null ? y : abs ? ny : y + ny;
    out.push({ i: i - tagFrom, x0: +x.toFixed(4), y0: +y.toFixed(4), x1: +tx.toFixed(4), y1: +ty.toFixed(4), burn: mo !== 0 && sp !== 5 && S > 0, S: sp !== 5 && mo !== 0 ? S : 0, air });
    x = tx; y = ty;
  });
  return out;
}
const key = m => [m.x0, m.y0, m.x1, m.y1, m.burn, m.S, m.air].join(',');

function checkJob(name, lines, ns) {
  const full = run(lines);
  for (const n of ns) {
    const s = E.modalAt(lines, n);
    if (s.why) { ok(false, name + ' @' + n + ' refused: ' + s.why); continue; }
    const pre = E.resumePreamble(s);
    const r = run(pre.concat(lines.slice(n)), pre.length);
    const preMoves = r.filter(m => m.i < 0), rest = r.filter(m => m.i >= 0);
    const want = full.filter(m => m.i >= n);
    const same = rest.length === want.length && rest.every((m, k) => key(m) === key(want[k]));
    ok(!preMoves.some(m => m.burn) && same, name + ' resume @' + n + ' (' + want.length + ' moves, preamble ' + pre.length + ' lines)');
  }
}

const comb = gold.combined;
checkJob('combined', comb, [0, 1, 2, 3, 50, 777, Math.floor(comb.length / 3), Math.floor(comb.length / 2), comb.length - 5, comb.length]);
checkJob('dxf', gold.dxf, [5, 40, gold.dxf.length - 3]);

// inch + relative + M3 + air: modal state carried over correctly
const odd = ['G20 G90', 'M8', 'G0 X1 Y1', 'M3 S300', 'G1 F20 X2', 'G91', 'G1 X0.5 Y0.25', 'X0.5', 'G0 Y1', 'G1 X-1 S500', 'G90 M5', 'M9', 'G0 X0 Y0'];
checkJob('inch/rel/M3/air', odd, [4, 6, 7, 8, 9, 10, 12]);
const s7 = E.modalAt(odd, 8);
ok(s7.inch && !s7.abs && s7.flood && s7.spindle === 'M3' && s7.S === 300 && Math.abs(s7.F - 20 * 25.4) < 1e-9, 'modal state @8: G20 G91 M8 M3 S300 F20');

// offsets changed mid-job: refuse
ok(!!E.modalAt(['G0 X1', 'G92 X0', 'G1 X5'], 3).why, 'refuses after G92');
ok(!!E.modalAt(['G0 X1', 'G53 G0 X0', 'G1 X5'], 3).why, 'refuses after G53 move');
ok(!E.modalAt(['G0 X1', 'G1 X5'], 2).why, 'plain job is resumable');

// nearest line to a stop position
const nl = E.nearestLine(['G0 X0 Y0', 'G1 X10 F100', 'G1 Y10', 'G1 X0', 'G1 Y0'], 0, 5, [10.2, 6]);
ok(nl.line === 2 && Math.abs(nl.dist - 0.2) < 1e-9, 'nearestLine picks the move the head was on (line 3, 0.2 mm)');

// air assist: off by default (golden unchanged), on per operation
const o = { type: 'vec', name: 'sq', polys: [[0, 0, 10, 0, 10, 10, 0, 10, 0, 0], [3, 3, 6, 3, 6, 6, 3, 6, 3, 3]], cx: 0, cy: 0, cw: 10, ch: 10, sx: 1, sy: 1, rot: 0, x: 5, y: 5, on: true,
  pathOp: ['cut', 'score'], set: { cut: { power: 100, feed: 5, passes: 1 }, score: { power: 30, feed: 20, passes: 1 }, fill: { power: 40, feed: 60, passes: 1, interval: 0.1 } } };
const noAir = E.vectorGcode([o], 1000, [], 'M8');
ok(!noAir.some(l => /^M[789]$/.test(l)), 'no air commands unless an operation asks');
o.set.cut.air = true;
const withAir = E.vectorGcode([o], 1000, [], 'M8');
const ci = withAir.findIndex(l => l.startsWith('; cut')), si = withAir.findIndex(l => l.startsWith('; score'));
ok(withAir[ci + 3] === 'M8' && withAir[withAir.length - 1] === 'M9' && !withAir.slice(si, ci).includes('M8'), 'cut gets M8 after its header and M9 after M5; score does not');
ok(!E.vectorGcode([o], 1000, [], '').some(l => /^M[789]$/.test(l)), 'machine with no air command emits none');
const g = J.runJob('gen', { imgs: [], vecs: [o], SM: 1000, settings: {}, smax: 1000, air: 'M7' }).text.split('\n');
ok(g.includes('M7') && g.includes('M9') && !g.includes('M8'), 'worker job uses the machine profile air command (M7)');

console.log(fail ? `\nFAIL: ${fail}` : '\nPASS'); process.exit(fail ? 1 : 0);
