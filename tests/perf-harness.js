// Perf harness: inject into a loaded Burner page (see tests/README in the main README).
// Measures main-thread time of the things that lag: importing big DXF/SVG, contour
// picking, dragging, generating a big raster, and redrawing / zooming a big job.
// Works on the old sync build and the new worker build (awaits where needed).
(async () => {
  const R = {};
  const base = window.GOLDEN_FIXTURES || '../tests/fixtures/';
  const fx = async n => (await fetch(base + n, { cache: 'no-store' })).text();
  const now = () => performance.now();
  const flush = () => { if (window.flushUI) window.flushUI(); };
  const time = (fn, n = 1) => { const t = now(); for (let i = 0; i < n; i++) fn(i); return +((now() - t) / n).toFixed(2); };
  objs.length = 0; sel = null;
  if (!W) { resize(); fitView(); }   // hidden pane: ResizeObserver never fired, size the canvas for real
  R.canvas = W + 'x' + H;

  // 1. heavy DXF import (parse + join + add), sync path
  const dxf = await fx('heavy.dxf');
  R.dxf_import_ms = time(() => addVec('heavy.dxf', parseDXF(dxf)));
  const o = objs[objs.length - 1];
  R.dxf_contours = o.polys.length;
  if (window.importVecText) {                                // worker path, if this build has it
    const t = now(); await importVecText('heavy.dxf', dxf, 'dxf'); R.dxf_import_worker_total_ms = +(now() - t).toFixed(1);
    R.dxf_import_worker_main_ms = window.__lastImportMainMs;
    objs.pop();
  }
  // 2. contour picking (hover/click hit test), 300 random points over the object
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pts = Array.from({ length: 300 }, () => { const wx = o.x + (rnd() - 0.5) * oW(o), wy = o.y + (rnd() - 0.5) * oH(o); const [mx, my] = [wx + st.wco[0], wy + st.wco[1]]; return { wx, wy, mx, my, sx: 0, sy: 0 }; });
  R.hit_test_ms = time(i => hitTest(pts[i]), 300);
  // 3. dragging the heavy object: move + panel update + redraw, per mousemove
  sel = o; staticKey = ''; draw();
  R.drag_frame_ms = time(() => { o.x += 0.05; layoutChanged(); flush(); draw(); }, 20);
  objs.length = 0; sel = null;

  // 5. big photo-like raster: 6 in wide at 254 lpi
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 1200, 900);
  gr.addColorStop(0, '#111'); gr.addColorStop(1, '#eee'); g.fillStyle = gr; g.fillRect(0, 0, 1200, 900);
  for (let k = 0; k < 300; k++) { g.fillStyle = 'rgba(' + [k * 7 % 255, k * 13 % 255, k * 3 % 255, 0.5] + ')'; g.beginPath(); g.arc(rnd() * 1200, rnd() * 900, 10 + rnd() * 60, 0, 7); g.fill(); }
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  await addImage(new File([blob], 'photo.png', { type: 'image/png' }));
  const im = objs[0]; im.sx = im.sy = 6 * MM / im.iw; im.x = oW(im) / 2; im.y = oH(im) / 2;
  im.r = { rLpi: 254, rFeedS: 120, rPmin: 0, rPmax: 60, rOver: 0.05, rThresh: 3, rDither: true, rInvert: false, rBidir: true };
  window.__lastGen = null;
  let t = now(); const ret = generateLayout(); const syncMs = now() - t; await ret; const totalMs = now() - t;
  R.gen_lines = job.lines.length;
  R.gen_total_ms = +totalMs.toFixed(1);
  R.gen_main_blocked_ms = +(window.__lastGen ? window.__lastGen.mainMs : syncMs).toFixed(1);
  // 6. drawing the big job: full crisp render, then a zoom step like a mouse wheel
  R.render_full_ms = time(() => { staticKey = ''; if (window.forceCrisp) forceCrisp(); draw(); });
  const rect = cv.getBoundingClientRect();
  R.zoom_frame_ms = time(() => { cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, cancelable: true })); draw(); }, 5);
  R.idle_frame_ms = time(() => { dirty = true; draw(); }, 10);
  objs.length = 0; sel = null; clearJob && clearJob();
  // 7. SVG import (last: the old build takes minutes on heavy.svg, so default to medium.svg)
  if (window.PERF_SKIP_SVG) return R;
  const svgName = window.PERF_SVG || 'medium.svg', svg = await fx(svgName);
  if (window.importVecText) {
    const t2 = now(); await importVecText(svgName, svg, 'svg'); R.svg_import_total_ms = +(now() - t2).toFixed(1);
    R.svg_import_main_ms = window.__lastImportMainMs;
  } else R.svg_import_ms = time(() => addVec(svgName, parseSVG(svg)));
  R.svg_file = svgName;
  objs.length = 0; sel = null;
  return R;
})();
