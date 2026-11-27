// Camera alignment math: calibration marks, homography (perspective) solve and apply.
// Pure, no DOM. Machine coordinates in mm; image coordinates in camera pixels.
import Core from './core.js';
const { fmt } = Core;

// 4 mark positions (machine mm), inset from the bed corners, in click order:
// 1 bottom-left, 2 bottom-right, 3 top-right, 4 top-left (as the map shows the bed)
export function markPoints(bed, inset = 0.12) {
  const ix = bed.w * inset, iy = bed.h * inset;
  return [[bed.x0 + ix, bed.y0 + iy], [bed.x0 + bed.w - ix, bed.y0 + iy], [bed.x0 + bed.w - ix, bed.y0 + bed.h - iy], [bed.x0 + ix, bed.y0 + bed.h - iy]];
}
// G-code burning a crosshair at each point, plus n short ticks beside mark n so they can
// be told apart in the camera image. Positions are machine coords; wco converts to work.
export function markGcode(pts, wco, S, F, arm = 6) {
  const L = ['G21 G90', 'M5 S0'], p = (x, y) => 'X' + fmt(x) + ' Y' + fmt(y);
  pts.forEach(([mx, my], i) => {
    const x = mx - wco[0], y = my - wco[1];
    L.push('G0 ' + p(x - arm, y), 'M4 S' + S, 'G1 X' + fmt(x + arm) + ' F' + fmt(F), 'M5 S0');
    L.push('G0 ' + p(x, y - arm), 'M4 S' + S, 'G1 Y' + fmt(y + arm), 'M5 S0');
    for (let k = 0; k <= i; k++) { const tx = x + arm + 2 + k * 1.5; L.push('G0 ' + p(tx, y + arm - 3), 'M4 S' + S, 'G1 Y' + fmt(y + arm), 'M5 S0'); }
  });
  L.push('M5 S0');
  return L;
}

// 3x3 homography H (row-major, H[8]=1) with H*[x,y,1] ~ [u,v,1] for 4 point pairs.
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  if (!h) return null;
  return [...h, 1];
}
function solve(A, b) {                              // Gaussian elimination, partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}
export function invertH(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det);
  return inv.map(v => v / inv[8]);
}
// The 4 clicked points must make a proper (convex, non-degenerate) quadrilateral in
// the same turning order as the marks, or the solve is meaningless.
export function quadOK(pts) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 4], [cx, cy] = pts[(i + 2) % 4];
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(z) < 1e-6) return false;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
}
