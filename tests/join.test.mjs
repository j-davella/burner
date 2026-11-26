// Fast joinPolys must give exactly the same contours as the original O(n^2) version.
// Run: node tests/join.test.mjs
import { readFileSync } from 'node:fs';
import { joinPolys, joinPolysSlow } from '../web/engine/geom.js';
import { parseDXF } from '../web/engine/dxf.js';
const here = new URL('.', import.meta.url);
let fail = 0;
const cases = { sample: 'fixtures/sample.dxf', heavy: 'fixtures/heavy.dxf' };
for (const [name, f] of Object.entries(cases)) {
  const polys = parseDXF(readFileSync(new URL(f, here), 'utf8')).filter(p => p.length >= 4);
  let t = performance.now(); const a = joinPolysSlow(polys); const ts = performance.now() - t;
  t = performance.now(); const b = joinPolys(polys); const tf = performance.now() - t;
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) fail++;
  console.log((same ? 'ok  ' : 'FAIL') + ` ${name}: ${polys.length} pieces -> ${b.length} contours; original ${ts.toFixed(0)} ms, fast ${tf.toFixed(1)} ms`);
}
// adversarial: many coincident endpoints (star of segments through one point, shuffled grid lines)
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let trial = 0; trial < 30; trial++) {
  const ps = [];
  for (let k = 0; k < 300; k++) {
    const g = () => Math.round(rnd() * 12) * 0.5 + (rnd() < 0.3 ? (rnd() - 0.5) * 0.015 : 0);
    ps.push([g(), g(), g(), g()]);
    if (rnd() < 0.2) ps.push([g(), g(), g(), g(), g(), g()]);
  }
  const same = JSON.stringify(joinPolysSlow(ps)) === JSON.stringify(joinPolys(ps));
  if (!same) { fail++; console.log('FAIL random trial', trial); }
}
console.log(fail ? `\nFAIL: ${fail}` : '\nPASS (30 random dense trials identical too)'); process.exit(fail ? 1 : 0);
