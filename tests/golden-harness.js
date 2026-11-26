// Golden G-code harness. Paste/inject into a loaded Burner page (any version that
// exposes the classic globals: objs, addVec, parseDXF, parseSVG, addImage,
// generateLayout, job, testGcode, TESTS, lab, settings, estLineTimes, buildSections).
// Returns {case: string[]} - every G-code line the app would send.
// tests/run_golden.py drives this in a browser and diffs against tests/golden/.
(async () => {
  const out = {};
  const fx = async n => (await fetch(n, { cache: 'no-store' })).text();
  const base = window.GOLDEN_FIXTURES || '../tests/fixtures/';
  const reset = () => { objs.length = 0; sel = null; };
  for (const k of Object.keys(settings)) delete settings[k];
  Object.assign(settings, { 30: '1000', 32: '1', 110: '6000', 111: '6000', 120: '500', 121: '500' });
  lab.current = 'Golden'; lab.cols = 5;

  const dxfText = await fx(base + 'sample.dxf');
  const svgText = await fx(base + 'sample.svg');
  const setOps = o => {
    o.pathOp = o.polys.map((p, i) => ['cut', 'score', 'fill', 'off'][i % 4]);
    o.pathOp = o.pathOp.map((op, i) => op === 'fill' && !isClosed(o.polys[i]) ? 'score' : op);
    o.set = { cut: { power: 90, feed: 4, passes: 2 }, score: { power: 25, feed: 18, passes: 1 }, fill: { power: 35, feed: 55, passes: 2, interval: 0.15 } };
  };
  const gen = name => { if (!generateLayout()) throw new Error('generate failed: ' + name); out[name] = job.lines.slice(); };

  // 1. DXF alone
  reset(); addVec('sample.dxf', parseDXF(dxfText)); setOps(objs[0]); gen('dxf');
  // 2. DXF scaled + rotated
  objs[0].rot = 30; objs[0].sx = 1.25; objs[0].sy = 0.8; objs[0].x += 7; gen('dxf_xform');
  // 3. SVG
  reset(); addVec('sample.svg', parseSVG(svgText)); setOps(objs[0]); gen('svg');
  // 4. Image (synthetic, no text so fonts can't change it)
  const c = document.createElement('canvas'); c.width = 160; c.height = 100;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 160, 0);
  gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff'); g.fillStyle = gr; g.fillRect(0, 0, 160, 100);
  g.fillStyle = '#222'; g.beginPath(); g.arc(50, 50, 30, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillRect(100, 20, 20, 60);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'synthetic.png', { type: 'image/png' });
  reset(); await addImage(file);
  objs[0].r = { rLpi: 127, rFeedS: 60, rPmin: 5, rPmax: 70, rOver: 0.05, rThresh: 3, rDither: false, rInvert: false, rBidir: true };
  gen('img_gray');
  objs[0].r = { ...objs[0].r, rDither: true, rBidir: false }; objs[0].rot = 12; objs[0].cx = 10; objs[0].cw = 130; gen('img_dither');
  // 5. Everything together, one object off
  const imgObj = objs[0];
  addVec('sample.dxf', parseDXF(dxfText)); setOps(objs[1]); objs[1].x += 120;
  addVec('sample.svg', parseSVG(svgText)); setOps(objs[2]); objs[2].y += 90; objs[2].rot = -45;
  addVec('sample.dxf', parseDXF(dxfText)); setOps(objs[3]); objs[3].on = false;
  gen('combined');
  out.combined_est = [String(estLineTimes(job.lines).reduce((a, b) => a + b, 0).toFixed(6))];
  const sx = buildSections(job.lines); out.combined_sections = [Array.from(sx.sec).join(','), sx.mx.join(',')];
  const P = Core.parseGcode(job.lines, 1000);
  out.combined_preview = [P.n, JSON.stringify(P.all), JSON.stringify(P.burn), P.estMin.toFixed(6), Array.from(P.lvl).join('')].map(String);
  // 6. Test Lab blocks
  for (const t of TESTS) out['lab_' + t.id] = testGcode(t, t.def, 7).lines;
  reset();
  return out;
})();
