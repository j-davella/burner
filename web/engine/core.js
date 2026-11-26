// Pure G-code logic (no DOM). Shared by the UI, Web Workers and Node tests.
const Core = (() => {
  const MM = 25.4;
  function cleanLine(l) {
    return l.replace(/\(.*?\)/g, '').replace(/;.*$/, '').replace(/\s+/g, '').toUpperCase();
  }
  function fmt(v) { const s = (Math.round(v * 1000) / 1000).toFixed(3); return s.replace(/\.?0+$/, '') || '0'; }

  // Parse cleaned G-code lines into flat segment arrays for preview. Units out: mm, work coords.
  function parseGcode(lines, smax) {
    smax = smax || 1000;
    let x = 0, y = 0, mode = 0, abs = true, scale = 1, s = 0, laser = false;
    const X0 = [], Y0 = [], X1 = [], Y1 = [], T = [], LN = [], LV = [];
    const all = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const burn = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const ext = (b, a, c) => { if (a < b.minX) b.minX = a; if (a > b.maxX) b.maxX = a; if (c < b.minY) b.minY = c; if (c > b.maxY) b.maxY = c; };
    const re = /([A-Z])([-+]?(?:\d+\.?\d*|\.\d+))/g;
    let burnTime = 0, travelTime = 0, feed = 1000;
    const push = (ax, ay, bx, by, i) => {
      const burning = mode !== 0 && laser && s > 0;
      const t = mode === 0 ? 0 : (burning ? 2 : 1);
      X0.push(ax); Y0.push(ay); X1.push(bx); Y1.push(by); T.push(t); LN.push(i);
      LV.push(burning ? Math.max(0, Math.min(7, Math.ceil((s / smax) * 8) - 1)) : 0);
      ext(all, ax, ay); ext(all, bx, by);
      if (burning) { ext(burn, ax, ay); ext(burn, bx, by); }
      const d = Math.hypot(bx - ax, by - ay);
      if (mode === 0) travelTime += d / 5000; else (burning ? (burnTime += d / feed) : (travelTime += d / feed));
    };
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (!L || L[0] === '$' || L[0] === '%') continue;
      const w = {}; const gs = []; let m; re.lastIndex = 0;
      while ((m = re.exec(L))) {
        const k = m[1], v = parseFloat(m[2]);
        if (k === 'G') gs.push(v);
        else if (k === 'M') { if (v === 3 || v === 4) laser = true; else if (v === 5 || v === 2 || v === 30) laser = false; }
        else w[k] = v;
      }
      let skip = false;
      for (const g of gs) {
        if (g === 0 || g === 1 || g === 2 || g === 3) mode = g;
        else if (g === 90) abs = true; else if (g === 91) abs = false;
        else if (g === 20) scale = MM; else if (g === 21) scale = 1;
        else if (g === 53 || g === 10 || g === 92 || g === 28 || g === 30 || g === 4) skip = true;
      }
      if (w.S !== undefined) s = w.S;
      if (w.F !== undefined) feed = Math.max(1, w.F * scale);
      if (skip || (w.X === undefined && w.Y === undefined)) continue;
      const nx = w.X === undefined ? x : (abs ? w.X * scale : x + w.X * scale);
      const ny = w.Y === undefined ? y : (abs ? w.Y * scale : y + w.Y * scale);
      if ((mode === 2 || mode === 3) && (w.I !== undefined || w.J !== undefined)) {
        const cx = x + (w.I || 0) * scale, cy = y + (w.J || 0) * scale;
        const r = Math.hypot(x - cx, y - cy);
        let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx);
        if (mode === 2) { if (a1 >= a0 - 1e-9) a1 -= 2 * Math.PI; } else { if (a1 <= a0 + 1e-9) a1 += 2 * Math.PI; }
        const da = a1 - a0;
        const n = Math.max(4, Math.ceil(Math.abs(da) * r / 0.5));
        let px = x, py = y;
        for (let k = 1; k <= n; k++) {
          const a = a0 + da * k / n;
          const qx = k === n ? nx : cx + r * Math.cos(a), qy = k === n ? ny : cy + r * Math.sin(a);
          push(px, py, qx, qy, i); px = qx; py = qy;
        }
      } else {
        push(x, y, nx, ny, i);
      }
      x = nx; y = ny;
    }
    return {
      n: T.length,
      x0: Float32Array.from(X0), y0: Float32Array.from(Y0), x1: Float32Array.from(X1), y1: Float32Array.from(Y1),
      type: Uint8Array.from(T), line: Uint32Array.from(LN), lvl: Uint8Array.from(LV),
      all: isFinite(all.minX) ? all : null, burn: isFinite(burn.minX) ? burn : null,
      estMin: burnTime + travelTime
    };
  }

  // Floyd-Steinberg on darkness array (0..1), in place -> 0/1
  function dither(d, cols, rows) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, o = d[i], n = o >= 0.5 ? 1 : 0, e = o - n; d[i] = n;
      if (c + 1 < cols) d[i + 1] += e * 7 / 16;
      if (r + 1 < rows) {
        if (c > 0) d[i + cols - 1] += e * 3 / 16;
        d[i + cols] += e * 5 / 16;
        if (c + 1 < cols) d[i + cols + 1] += e * 1 / 16;
      }
    }
    return d;
  }

  // dark: Float32Array 0..1, row 0 = top of image. o: {pitch mm, feed mm/min, smin, smax, over mm, thresh 0..1, bidir}
  function rasterGcode(dark, cols, rows, o) {
    const p = o.pitch, ox = o.ox || 0, oy = o.oy || 0;
    const fx = v => fmt(v + ox);
    const out = ['; Burner raster ' + cols + 'x' + rows + ' px, pitch ' + fmt(p) + ' mm', 'G21', 'G90', 'M5', 'M4 S0', 'G1 F' + fmt(o.feed)];
    const sv = new Int32Array(cols);
    let fwd = true;
    for (let r = 0; r < rows; r++) {
      const y = (rows - 1 - r) * p + p / 2;
      let first = -1, last = -1;
      for (let c = 0; c < cols; c++) {
        const d = Math.max(0, Math.min(1, dark[r * cols + c]));
        const S = d <= o.thresh ? 0 : Math.round(o.smin + (o.smax - o.smin) * d);
        sv[c] = S; if (S > 0) { if (first < 0) first = c; last = c; }
      }
      if (first < 0) continue;
      if (fwd) {
        out.push('G0 X' + fx(first * p - o.over) + ' Y' + fmt(y + oy));
        out.push('G1 X' + fx(first * p) + ' S0');
        let c = first;
        while (c <= last) { let e = c; while (e + 1 <= last && sv[e + 1] === sv[c]) e++; out.push('G1 X' + fx((e + 1) * p) + ' S' + sv[c]); c = e + 1; }
        out.push('G1 X' + fx((last + 1) * p + o.over) + ' S0');
      } else {
        out.push('G0 X' + fx((last + 1) * p + o.over) + ' Y' + fmt(y + oy));
        out.push('G1 X' + fx((last + 1) * p) + ' S0');
        let c = last;
        while (c >= first) { let e = c; while (e - 1 >= first && sv[e - 1] === sv[c]) e--; out.push('G1 X' + fx(e * p) + ' S' + sv[c]); c = e - 1; }
        out.push('G1 X' + fx(first * p - o.over) + ' S0');
      }
      if (o.bidir) fwd = !fwd;
    }
    out.push('M5 S0');
    return out;
  }

  function parseStatus(l) {
    const parts = l.replace(/^</, '').replace(/>$/, '').split('|');
    const r = { state: parts[0].split(':')[0], sub: parts[0] };
    for (const p of parts.slice(1)) {
      const i = p.indexOf(':'); if (i < 0) continue;
      const k = p.slice(0, i), n = p.slice(i + 1).split(',').map(Number);
      if (k === 'MPos') r.mpos = n; else if (k === 'WPos') r.wpos = n; else if (k === 'WCO') r.wco = n;
      else if (k === 'FS') { r.f = n[0]; r.s = n[1]; } else if (k === 'F') r.f = n[0];
      else if (k === 'Bf') r.bf = n; else if (k === 'Pn') r.pn = p.slice(i + 1);
      else if (k === 'Ov') r.ov = n;
    }
    return r;
  }
  return { cleanLine, parseGcode, dither, rasterGcode, parseStatus, fmt, MM };
})();
export default Core;
