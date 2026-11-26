// Heavy jobs that run in the Web Worker (engine/worker.js), or on the main thread if
// workers are unavailable. Pure: no DOM. Each takes (args, progress(fraction, stage)).
// The G-code they build is the same, line for line, as the old main-thread code
// (tests/golden pins it).
import Core from './core.js';
import { normalizeVec } from './geom.js';
import { parseDXF } from './dxf.js';
import { vectorGcode, buildSections, estLineTimes } from './gcode.js';

// RGBA pixels -> darkness 0..1 (Float32), the exact formula the UI always used.
export function darkFromRGBA(px, inv){
  const n=px.length>>2, dark=new Float32Array(n);
  for(let i=0;i<n;i++){ const lum=(0.299*px[i*4]+0.587*px[i*4+1]+0.114*px[i*4+2])/255; dark[i]=inv?lum:1-lum; }
  return dark;
}
// darkness -> grayscale RGBA preview
export function thumbRGBA(dark){
  const t=new Uint8ClampedArray(dark.length*4);
  for(let i=0;i<dark.length;i++){ const v=255-Math.round(Math.max(0,Math.min(1,dark[i]))*255); t[i*4]=t[i*4+1]=t[i*4+2]=v; t[i*4+3]=255; }
  return t;
}

// time estimate, power sections and preview segments for a finished line list
export function analyze(lines, settings, smax){
  const lt=estLineTimes(lines, settings), cum=new Float64Array(lines.length+1);
  for(let i=0;i<lines.length;i++) cum[i+1]=cum[i]+lt[i];
  return { lt, cum, estTotal:cum[lines.length], sections:buildSections(lines), prev:Core.parseGcode(lines, smax) };
}

// args: { imgs:[{name, px:Uint8ClampedArray, cols, rows, inv, dither, thumb, opts}],
//         vecs:[plain vector objects], SM, settings, smax }
export function genJob(a, progress){
  const lines=['G21','G90']; let thumb=null;
  const total=a.imgs.reduce((s,im)=>s+im.rows,0)+1; let done=0;
  for(const im of a.imgs){
    progress(done/total, 'Raster '+im.name);
    const dark=darkFromRGBA(im.px, im.inv);
    if(im.dither) Core.dither(dark, im.cols, im.rows);
    if(im.thumb) thumb={ cols:im.cols, rows:im.rows, rgba:thumbRGBA(dark) };
    lines.push('; raster '+im.name);
    const rg=Core.rasterGcode(dark, im.cols, im.rows, im.opts, r=>progress((done+r)/total, 'Raster '+im.name));
    for(let i=0;i<rg.length;i++) lines.push(rg[i]);
    done+=im.rows;
  }
  progress(done/total, 'Vectors');
  vectorGcode(a.vecs, a.SM, lines);
  lines.push('M5 S0','G0 X0 Y0');
  progress(1, 'Preview');
  return { text:lines.join('\n'), count:lines.length, thumb, ...analyze(lines, a.settings, a.smax) };
}

// DXF text -> joined, normalized contours. Log lines are returned to replay in the console.
export function importVec(a, progress){
  const logs=[]; progress(0, 'Reading '+a.name);
  const polys = parseDXF(a.text, (m,c)=>logs.push([m,c]));
  progress(0.6, 'Joining contours');
  const n0=polys.length;
  try { return { logs, n0, v:normalizeVec(polys) }; }
  catch(e){ return { logs, n0, error:e.message }; }
}

// G-code file text -> cleaned lines + analysis
export function loadGcode(a, progress){
  progress(0, 'Reading '+a.name);
  const lines=a.text.split(/\r?\n/).map(Core.cleanLine).filter(Boolean);
  progress(0.5, 'Preview');
  return { text:lines.join('\n'), count:lines.length, ...analyze(lines, a.settings, a.smax) };
}

export const JOBS = { gen:genJob, vec:importVec, gcode:loadGcode };
export function runJob(op, args, progress){ return JOBS[op](args, progress || (()=>{})); }

// typed arrays in a result that can be handed over without copying
export function transferables(res){
  const t=[]; const add=x=>{ if(x && x.buffer instanceof ArrayBuffer && !t.includes(x.buffer)) t.push(x.buffer); };
  if(!res) return t;
  add(res.lt); add(res.cum); if(res.sections) add(res.sections.sec);
  if(res.prev) for(const k of ['x0','y0','x1','y1','type','line','lvl']) add(res.prev[k]);
  if(res.thumb) add(res.thumb.rgba);
  return t;
}
