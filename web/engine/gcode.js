// Vector G-code generation, test blocks, time estimate, power sections. No DOM.
// This is what drives the laser: tests/golden/ pins its output byte for byte.
import Core from './core.js';
import { toWorld, hatch, nnOrder, sq, circ, shift } from './geom.js';
const { fmt, MM } = Core;

// vecs: vector objects that are on. SM: $30 (max S). Appends to lines.
// Order: fill -> score -> cut (cuts smallest-first so inner parts/holes go before the outline)
export function vectorGcode(vecs, SM, lines){
  const world=o=>o.polys.map(pl=>{ const r=[]; for(let i=0;i<pl.length;i+=2){ const [x,y]=toWorld(o,(pl[i]-o.cw/2)*o.sx,(pl[i+1]-o.ch/2)*o.sy); r.push(x,y); } return r; });
  const W_ = new Map(vecs.map(o=>[o,world(o)]));
  const pick=(o,op)=>W_.get(o).filter((_,i)=>o.pathOp[i]===op);
  const opHead=(o,op)=>{ const st_=o.set[op], S=Math.round(SM*st_.power/100), F=st_.feed*60; lines.push('; '+op+' '+o.name+' S'+S+' F'+fmt(F)+' x'+st_.passes, 'M4 S'+S, 'G1 F'+fmt(F)); return st_; };
  const emit=p=>{ lines.push('G0 X'+fmt(p[0])+' Y'+fmt(p[1])); for(let i=2;i<p.length;i+=2) lines.push('G1 X'+fmt(p[i])+' Y'+fmt(p[i+1])); };
  for(const o of vecs){
    const polys=pick(o,'fill'); if(!polys.length) continue;
    const st_=opHead(o,'fill'), segs=hatch(polys, st_.interval);
    for(let k=0;k<st_.passes;k++) for(const [x0,x1,y] of segs){ lines.push('G0 X'+fmt(x0)+' Y'+fmt(y)); lines.push('G1 X'+fmt(x1)); }
    lines.push('M5 S0');
  }
  for(const o of vecs){
    const polys=nnOrder(pick(o,'score')); if(!polys.length) continue;
    const st_=opHead(o,'score');
    for(let k=0;k<st_.passes;k++) for(const p of polys) emit(p);
    lines.push('M5 S0');
  }
  const cuts=[];
  for(const o of vecs) for(const p of pick(o,'cut')){ let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity; for(let i=0;i<p.length;i+=2){ a=Math.min(a,p[i]); c=Math.max(c,p[i]); b=Math.min(b,p[i+1]); d=Math.max(d,p[i+1]); } cuts.push({o,p,area:(c-a)*(d-b)}); }
  cuts.sort((u,v)=>u.area-v.area);
  let lastO=null;
  for(const c of cuts){
    if(c.o!==lastO){ if(lastO) lines.push('M5 S0'); opHead(c.o,'cut'); lastO=c.o; }
    for(let k=0;k<c.o.set.cut.passes;k++) emit(c.p);
  }
  if(lastO) lines.push('M5 S0');
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
