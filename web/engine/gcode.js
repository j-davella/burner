// Vector G-code generation, test blocks, time estimate, power sections. No DOM.
// This is what drives the laser: tests/golden/ pins its output byte for byte.
import Core from './core.js';
import { toWorld, hatch, nnOrder, sq, circ, shift } from './geom.js';
const { fmt, MM } = Core;

// vecs: vector objects that are on. SM: $30 (max S). Appends to lines.
// air: the machine's air-assist command ('M7' / 'M8', '' = none). An operation with
// set[op].air on gets it after its header and M9 after its M5. Off by default, so
// jobs without air are byte-identical to before.
// Order: fill -> score -> cut (cuts smallest-first so inner parts/holes go before the outline)
export function vectorGcode(vecs, SM, lines, air){
  const world=o=>o.polys.map(pl=>{ const r=[]; for(let i=0;i<pl.length;i+=2){ const [x,y]=toWorld(o,(pl[i]-o.cw/2)*o.sx,(pl[i+1]-o.ch/2)*o.sy); r.push(x,y); } return r; });
  const W_ = new Map(vecs.map(o=>[o,world(o)]));
  const pick=(o,op)=>W_.get(o).filter((_,i)=>o.pathOp[i]===op);
  const opHead=(o,op)=>{ const st_=o.set[op], S=Math.round(SM*st_.power/100), F=st_.feed*60; lines.push('; '+op+' '+o.name+' S'+S+' F'+fmt(F)+' x'+st_.passes, 'M4 S'+S, 'G1 F'+fmt(F)); if(air && st_.air) lines.push(air); return st_; };
  const opEnd=st_=>{ lines.push('M5 S0'); if(air && st_.air) lines.push('M9'); };
  const emit=p=>{ lines.push('G0 X'+fmt(p[0])+' Y'+fmt(p[1])); for(let i=2;i<p.length;i+=2) lines.push('G1 X'+fmt(p[i])+' Y'+fmt(p[i+1])); };
  for(const o of vecs){
    const polys=pick(o,'fill'); if(!polys.length) continue;
    const st_=opHead(o,'fill'), segs=hatch(polys, st_.interval);
    for(let k=0;k<st_.passes;k++) for(const [x0,x1,y] of segs){ lines.push('G0 X'+fmt(x0)+' Y'+fmt(y)); lines.push('G1 X'+fmt(x1)); }
    opEnd(st_);
  }
  for(const o of vecs){
    const polys=nnOrder(pick(o,'score')); if(!polys.length) continue;
    const st_=opHead(o,'score');
    for(let k=0;k<st_.passes;k++) for(const p of polys) emit(p);
    opEnd(st_);
  }
  const cuts=[];
  for(const o of vecs) for(const p of pick(o,'cut')){ let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity; for(let i=0;i<p.length;i+=2){ a=Math.min(a,p[i]); c=Math.max(c,p[i]); b=Math.min(b,p[i+1]); d=Math.max(d,p[i+1]); } cuts.push({o,p,area:(c-a)*(d-b)}); }
  cuts.sort((u,v)=>u.area-v.area);
  let lastO=null;
  for(const c of cuts){
    if(c.o!==lastO){ if(lastO) opEnd(lastO.set.cut); opHead(c.o,'cut'); lastO=c.o; }
    for(let k=0;k<c.o.set.cut.passes;k++) emit(c.p);
  }
  if(lastO) opEnd(lastO.set.cut);
  return lines;
}

// Vector Test Lab block (score / fill / cut) at slot origin bx,by. Appends to L.
export function testVecGcode(t, v, bx, by, SM, L){
  const S=Math.round(SM*v.power/100), F=v.feed*60;
  L.push('M4 S'+S,'G1 F'+fmt(F));
  const emit=p=>{ L.push('G0 X'+fmt(p[0])+' Y'+fmt(p[1])); for(let i=2;i<p.length;i+=2) L.push('G1 X'+fmt(p[i])+' Y'+fmt(p[i+1])); };
  if(t.op==='score'){
    const ps=[sq(2,2,21.4),[6,12.7,19.4,12.7],[12.7,6,12.7,19.4],circ(12.7,12.7,4)].map(p=>shift(p,bx,by));
    for(let k=0;k<v.passes;k++) for(const p of ps) emit(p);
  } else if(t.op==='fill'){
    const segs=hatch([sq(3,3,19.4),circ(12.7,12.7,4)].map(p=>shift(p,bx,by)), Math.max(0.02,v.interval||0.1));
    for(let k=0;k<v.passes;k++) for(const [x0,x1,y] of segs){ L.push('G0 X'+fmt(x0)+' Y'+fmt(y)); L.push('G1 X'+fmt(x1)); }
  } else {
    const hole=shift(circ(12.7,12.7,3),bx,by), outer=shift(sq(3,3,19.4),bx,by);
    for(const p of [hole,outer]) for(let k=0;k<v.passes;k++) emit(p);
  }
  L.push('M5 S0');
  return L;
}

// per-line operation section and its max S, so power can be shown/set as absolute % of the laser
export function buildSections(lines){
  const sec=new Uint32Array(lines.length), mx=[0]; let cur=0;
  for(let i=0;i<lines.length;i++){
    const L=lines[i];
    if(/^M[34]/.test(L)){ cur=mx.length; mx.push(0); }
    const m=/S(\d+(?:\.\d+)?)/.exec(L); if(m && +m[1]>mx[cur]) mx[cur]=+m[1];
    sec[i]=cur;
  }
  return {sec, mx};
}

// per-line time estimate (s): distance/feed, plus a stop-and-go penalty (v/a) on sharp direction changes.
// settings: GRBL $-settings map ($110/$111 max rate, $120/$121 accel).
export function estLineTimes(lines, settings){
  const t=new Float32Array(lines.length);
  const acc=Math.max(10, Math.min(+(settings[120]||500), +(settings[121]||500)));
  const rapid=Math.max(100, Math.min(+(settings[110]||6000), +(settings[111]||6000)))/60;
  let x=0,y=0,mode=0,abs=true,sc=1,F=1000,pdx=0,pdy=0;
  const re=/([GXYF])([-+]?(?:\d+\.?\d*|\.\d+))/g;
  for(let i=0;i<lines.length;i++){
    const L=lines[i]; if(!L||L[0]==='$'||L[0]===';') continue;
    let nx=null, ny=null, m, skip=false; re.lastIndex=0;
    while((m=re.exec(L))){ const k=m[1], v=+m[2];
      if(k==='G'){ if(v<=3) mode=v; else if(v===90) abs=true; else if(v===91) abs=false; else if(v===20) sc=MM; else if(v===21) sc=1; else if(v===53||v===10||v===92||v===28||v===4) skip=true; }
      else if(k==='X') nx=v; else if(k==='Y') ny=v; else if(k==='F') F=Math.max(1,v*sc); }
    if(skip||(nx===null&&ny===null)) continue;
    const tx = nx===null? x : (abs? nx*sc : x+nx*sc), ty = ny===null? y : (abs? ny*sc : y+ny*sc);
    const dx=tx-x, dy=ty-y, d=Math.hypot(dx,dy); x=tx; y=ty;
    if(d<1e-6) continue;
    const v = mode===0 ? rapid : Math.min(F/60, rapid), ux=dx/d, uy=dy/d;
    let ti = d/v;
    if(ux*pdx+uy*pdy < 0.5) ti += v/acc;          // >60 deg turn or reversal: decel + accel
    t[i]=ti; pdx=ux; pdy=uy;
  }
  return t;
}

// ---------- resume-from-line ----------
// What the controller's modal state is at the START of line n, i.e. after lines 0..n-1
// ran: position (work mm), units, distance mode, motion mode, feed, S, laser M3/M4/M5,
// air M7/M8. why is set when resuming there can't be made safe (offsets changed mid-job).
const MW=/([GMXYZFS])([-+]?(?:\d+\.?\d*|\.\d+))/g;
export function modalAt(lines, n, onLine){
  const s={ x:0, y:0, z:0, hasZ:false, abs:true, inch:false, motion:0, F:0, S:0, spindle:'M5', mist:false, flood:false, why:'' };
  n=Math.max(0, Math.min(n, lines.length));
  for(let i=0;i<n;i++){
    if(onLine) onLine(i, s.x, s.y);
    const L=String(lines[i]).replace(/\(.*?\)|;.*$/g,'').toUpperCase();
    if(!L || L[0]==='$') continue;
    const sc=()=>s.inch?25.4:1;
    let x=null, y=null, z=null, m, g53=false; MW.lastIndex=0;
    const words=[]; while((m=MW.exec(L))) words.push([m[1], +m[2]]);
    for(const [k,v] of words) if(k==='G'){ if(v===20) s.inch=true; else if(v===21) s.inch=false; }
    for(const [k,v] of words){
      if(k==='G'){
        if(v===0||v===1||v===2||v===3) s.motion=v;
        else if(v===90) s.abs=true; else if(v===91) s.abs=false;
        else if(v===53) g53=true;
        else if(v===92||v===10||v===28||v===30||v===54||v===55||v===56||v===57||v===58||v===59)
          s.why=s.why||'line '+(i+1)+' changes the work offset (G'+v+'), so earlier positions cannot be trusted';
      }
      else if(k==='M'){ if(v===3||v===4||v===5) s.spindle='M'+v; else if(v===7) s.mist=true; else if(v===8) s.flood=true; else if(v===9) s.mist=s.flood=false; }
      else if(k==='F') s.F=v*sc();
      else if(k==='S') s.S=v;
      else if(k==='X') x=v*sc(); else if(k==='Y') y=v*sc(); else if(k==='Z') z=v*sc();
    }
    if(g53 && (x!==null||y!==null)){ s.why=s.why||'line '+(i+1)+' moves in machine coordinates (G53)'; continue; }
    if(x!==null) s.x = s.abs? x : s.x+x;
    if(y!==null) s.y = s.abs? y : s.y+y;
    if(z!==null){ s.z = s.abs? z : s.z+z; s.hasZ=true; }
  }
  return s;
}

// Lines sent before resuming at a line with modal state s: laser off, rapid to where that
// line starts (absolute, mm), then restore air, units, distance mode, motion mode + feed,
// laser mode + S. Nothing here moves with the laser on.
export function resumePreamble(s){
  const L=['M5 S0','G21 G90'];
  if(s.hasZ) L.push('G0 Z'+fmt(s.z));
  L.push('G0 X'+fmt(s.x)+' Y'+fmt(s.y));
  if(s.mist) L.push('M7'); if(s.flood) L.push('M8');
  if(s.inch) L.push('G20');
  if(!s.abs) L.push('G91');
  L.push('G'+s.motion+(s.F>0?' F'+fmt(s.inch? s.F/25.4 : s.F):''));
  L.push((s.spindle==='M5'?'':s.spindle+' ')+'S'+fmt(s.S));
  return L;
}

// The line to resume at: of the lines in [lo, hi), the one whose move passes closest to
// pos (work mm, last known head position). Resuming at its start re-burns at most one
// short stretch instead of leaving a gap. Returns {line, dist}.
export function nearestLine(lines, lo, hi, pos){
  lo=Math.max(0,lo|0); hi=Math.min(lines.length, hi|0);
  if(hi<=lo) return { line:lo, dist:Infinity };
  const xs=new Float64Array(hi-lo+1), ys=new Float64Array(hi-lo+1);
  const s=modalAt(lines, hi, (i,x,y)=>{ if(i>=lo){ xs[i-lo]=x; ys[i-lo]=y; } });
  xs[hi-lo]=s.x; ys[hi-lo]=s.y;
  let best=lo, bd=Infinity;
  for(let i=lo;i<hi;i++){
    const ax=xs[i-lo], ay=ys[i-lo], bx=xs[i-lo+1], by=ys[i-lo+1];
    const dx=bx-ax, dy=by-ay, l2=dx*dx+dy*dy;
    const t=l2>0? Math.max(0,Math.min(1,((pos[0]-ax)*dx+(pos[1]-ay)*dy)/l2)) : 0;
    const d=Math.hypot(ax+t*dx-pos[0], ay+t*dy-pos[1]);
    if(d<bd-1e-9){ bd=d; best=i; }
  }
  return { line:best, dist:bd };
}
