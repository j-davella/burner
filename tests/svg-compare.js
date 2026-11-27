// Fast SVG importer vs the original getPointAtLength sampler (tests/legacy-svg.js).
// Inject into a loaded Burner page. Both importers are measured against a REFERENCE:
// the original sampler run 10x finer (0.01 mm steps, no simplify), i.e. the true shape.
// Pass: same contour count, and every new contour is within TOL mm of the reference
// in both directions (no point off the shape, no part of the shape missed).
// The old importer's own error is reported alongside for comparison.
(async () => {
  const base = window.GOLDEN_FIXTURES || '../tests/fixtures/';
  const fx = async n => (await fetch(base + n, { cache: 'no-store' })).text();
  if (!window.legacyParseSVG) (0, eval)(await fx('../legacy-svg.js'));
  const TOL = 0.02;   // mm. The new importer flattens to ~0.1 mm segments and simplifies at 0.01 mm.
  const segDist = (x, y, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? ((x - ax) * dx + (y - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - ax - t * dx, y - ay - t * dy); };
  const ptPoly = (x, y, q) => { let d = Infinity; if (q.length === 2) return Math.hypot(x - q[0], y - q[1]); for (let i = 0; i + 3 < q.length; i += 2) d = Math.min(d, segDist(x, y, q[i], q[i + 1], q[i + 2], q[i + 3])); return d; };
  const dirH = (a, b) => { let m = 0; for (let i = 0; i < a.length; i += 2) m = Math.max(m, ptPoly(a[i], a[i + 1], b)); return m; };
  const haus = (a, b) => Math.max(dirH(a, b), dirH(b, a));
  const rep = {};
  for (const f of ['sample.svg', 'shapes.svg']) {
    const txt = await fx(f);
    let t = performance.now(); const A = legacyParseSVG(txt); const tOld = performance.now() - t;
    t = performance.now(); const B = parseSVG(txt); const tNew = performance.now() - t;
    window.LEGACY_STEP_MM = 0.01; window.LEGACY_MAXN = 1e7; window.LEGACY_NO_SIMPLIFY = true;
    let REF; try { REF = legacyParseSVG(txt); } finally { delete window.LEGACY_STEP_MM; delete window.LEGACY_MAXN; delete window.LEGACY_NO_SIMPLIFY; }
    const r = { contours_ref: REF.length, contours_old: A.length, contours_new: B.length, old_ms: +tOld.toFixed(1), new_ms: +tNew.toFixed(1),
                new_worst_mm: 0, old_worst_mm: 0, fail: [] };
    // contours come out in document order in all three
    REF.forEach((ref, i) => {
      const dn = B[i] ? haus(B[i], ref) : Infinity, dold = A[i] ? haus(A[i], ref) : Infinity;
      r.new_worst_mm = Math.max(r.new_worst_mm, dn); r.old_worst_mm = Math.max(r.old_worst_mm, dold);
      if (!(dn <= TOL)) r.fail.push({ contour: i, new_mm: +dn.toFixed(4), old_mm: +dold.toFixed(4) });
    });
    r.new_worst_mm = +r.new_worst_mm.toFixed(4); r.old_worst_mm = +r.old_worst_mm.toFixed(4);
    r.ok = REF.length === B.length && A.length === B.length && !r.fail.length;
    rep[f] = r;
  }
  rep.pass = Object.values(rep).every(r => r.ok);
  return rep;
})();
