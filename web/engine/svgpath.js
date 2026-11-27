// SVG path data -> polylines, in linear time. No DOM.
// The old importer sampled each element with getPointAtLength(), which walks the whole
// path on every call (quadratic: minutes for a few thousand curves). This parses the path
// itself and flattens curves to about `step` output-mm per segment; the caller maps points
// through the element's transform and simplifies to 0.01 mm like before.

// Returns array of subpaths: { pts:[x,y,...] (user units), closed }.
// scale: output mm per user unit (for choosing segment counts). step: target mm per segment.
export function flattenPath(d, scale, step){
  step = step || 0.1;
  const toks = tokenizeArcAware(d);
  const subs=[]; let cur=null;
  let x=0, y=0, sx=0, sy=0, cmd='', lcx=0, lcy=0, lqx=0, lqy=0, prev='';
  let i=0;
  const num=()=>{ const v=toks[i++]; return typeof v==='number' ? v : NaN; };
  const start=(nx,ny)=>{ cur={pts:[nx,ny], closed:false}; subs.push(cur); sx=nx; sy=ny; };
  const lineTo=(nx,ny)=>{ if(!cur) start(x,y); cur.pts.push(nx,ny); };
  const segs=lenMm=>Math.max(1, Math.min(20000, Math.ceil(lenMm/step)));
  const cubic=(x1,y1,x2,y2,x3,y3)=>{
    const L=(Math.hypot(x1-x,y1-y)+Math.hypot(x2-x1,y2-y1)+Math.hypot(x3-x2,y3-y2))*scale, n=segs(L);
    for(let k=1;k<=n;k++){ const t=k/n, u=1-t;
      lineTo(u*u*u*x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3, u*u*u*y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3); }
  };
  const quad=(x1,y1,x2,y2)=>{
    const L=(Math.hypot(x1-x,y1-y)+Math.hypot(x2-x1,y2-y1))*scale, n=segs(L);
    for(let k=1;k<=n;k++){ const t=k/n, u=1-t; lineTo(u*u*x+2*u*t*x1+t*t*x2, u*u*y+2*u*t*y1+t*t*y2); }
  };
  const arc=(rx,ry,phi,large,sweep,x2,y2)=>{
    // SVG 1.1 F.6.5 endpoint -> center parameterization
    if(x===x2 && y===y2) return;
    rx=Math.abs(rx); ry=Math.abs(ry);
    if(!rx || !ry){ lineTo(x2,y2); return; }
    const p=phi*Math.PI/180, cp=Math.cos(p), sp=Math.sin(p);
    const dx=(x-x2)/2, dy=(y-y2)/2, x1p=cp*dx+sp*dy, y1p=-sp*dx+cp*dy;
    const lam=x1p*x1p/(rx*rx)+y1p*y1p/(ry*ry); if(lam>1){ const s=Math.sqrt(lam); rx*=s; ry*=s; }
    const num_=rx*rx*ry*ry-rx*rx*y1p*y1p-ry*ry*x1p*x1p, den=rx*rx*y1p*y1p+ry*ry*x1p*x1p;
    let co=Math.sqrt(Math.max(0,num_/den)); if(large===sweep) co=-co;
    const cxp=co*rx*y1p/ry, cyp=-co*ry*x1p/rx;
    const cx=cp*cxp-sp*cyp+(x+x2)/2, cy=sp*cxp+cp*cyp+(y+y2)/2;
    const ang=(ux,uy,vx,vy)=>{ const a=Math.atan2(ux*vy-uy*vx, ux*vx+uy*vy); return a; };
    const t1=ang(1,0,(x1p-cxp)/rx,(y1p-cyp)/ry);
    let dt=ang((x1p-cxp)/rx,(y1p-cyp)/ry,(-x1p-cxp)/rx,(-y1p-cyp)/ry);
    if(!sweep && dt>0) dt-=2*Math.PI; else if(sweep && dt<0) dt+=2*Math.PI;
    const n=segs(Math.abs(dt)*Math.max(rx,ry)*scale);
    for(let k=1;k<=n;k++){ const t=t1+dt*k/n, ct=Math.cos(t), st=Math.sin(t);
      if(k===n) lineTo(x2,y2); else lineTo(cp*rx*ct-sp*ry*st+cx, sp*rx*ct+cp*ry*st+cy); }
  };
  while(i<toks.length){
    let t=toks[i];
    if(typeof t==='string'){ cmd=t; i++; }
    else if(!cmd) { i++; continue; }
    else if(cmd==='M') cmd='L'; else if(cmd==='m') cmd='l';   // implicit lineto after moveto
    const C=cmd.toUpperCase(), rel=cmd!==C;
    if(C==='Z'){ if(cur){ cur.pts.push(sx,sy); cur.closed=true; } x=sx; y=sy; cur=null; prev='Z'; continue; }
    const ox=rel?x:0, oy=rel?y:0;
    if(C==='M'){ const nx=num()+ox, ny=num()+oy; if(isNaN(nx)||isNaN(ny)) break; start(nx,ny); x=nx; y=ny; }
    else if(C==='L'){ const nx=num()+ox, ny=num()+oy; if(isNaN(nx)||isNaN(ny)) break; lineTo(nx,ny); x=nx; y=ny; }
    else if(C==='H'){ const nx=num()+ox; if(isNaN(nx)) break; lineTo(nx,y); x=nx; }
    else if(C==='V'){ const ny=num()+oy; if(isNaN(ny)) break; lineTo(x,ny); y=ny; }
    else if(C==='C'||C==='S'){
      let x1,y1; if(C==='C'){ x1=num()+ox; y1=num()+oy; } else if(prev==='C'||prev==='S'){ x1=2*x-lcx; y1=2*y-lcy; } else { x1=x; y1=y; }
      const x2=num()+ox, y2=num()+oy, x3=num()+ox, y3=num()+oy; if([x1,y1,x2,y2,x3,y3].some(isNaN)) break;
      if(!cur) start(x,y); cubic(x1,y1,x2,y2,x3,y3); lcx=x2; lcy=y2; x=x3; y=y3;
    }
    else if(C==='Q'||C==='T'){
      let x1,y1; if(C==='Q'){ x1=num()+ox; y1=num()+oy; } else if(prev==='Q'||prev==='T'){ x1=2*x-lqx; y1=2*y-lqy; } else { x1=x; y1=y; }
      const x2=num()+ox, y2=num()+oy; if([x1,y1,x2,y2].some(isNaN)) break;
      if(!cur) start(x,y); quad(x1,y1,x2,y2); lqx=x1; lqy=y1; x=x2; y=y2;
    }
    else if(C==='A'){
      const rx=num(), ry=num(), rot=num(), la=num(), sw=num(), nx=num()+ox, ny=num()+oy;
      if([rx,ry,rot,la,sw,nx,ny].some(isNaN)) break;
      if(!cur) start(x,y); arc(rx,ry,rot,la?1:0,sw?1:0,nx,ny); x=nx; y=ny;
    }
    else { i++; }
    prev=C;
  }
  return subs;
}

// Like tokenize(), but inside an arc command the two flags are single characters,
// so "a10 10 0 01 20 0" and "a10,10,0,0,1,20,0" both work.
function tokenizeArcAware(d){
  const out=[]; let i=0; const n=d.length; let cmd='', argi=0;
  const ws=c=>c===' '||c===','||c==='\t'||c==='\n'||c==='\r'||c==='\f';
  const re=/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
  while(i<n){
    const c=d[i];
    if(/[MmZzLlHhVvCcSsQqTtAa]/.test(c)){ out.push(c); cmd=c; argi=0; i++; continue; }
    if(ws(c)){ i++; continue; }
    if((cmd==='A'||cmd==='a') && (argi%7===3||argi%7===4) && (c==='0'||c==='1')){ out.push(+c); argi++; i++; continue; }
    re.lastIndex=i; const m=re.exec(d);
    if(!m){ i++; continue; }
    out.push(+m[0]); argi++; i=re.lastIndex;
  }
  return out;
}

// Basic shapes -> path data, per the SVG spec's equivalent paths (same start point and
// direction getPointAtLength used: rect from top-left+rx clockwise, circle from (cx+r, cy)).
export function rectPath(x,y,w,h,rx,ry){
  if(!(w>0&&h>0)) return '';
  rx=Math.min(rx,w/2); ry=Math.min(ry,h/2);
  if(!(rx>0&&ry>0)) return `M${x} ${y}H${x+w}V${y+h}H${x}Z`;
  return `M${x+rx} ${y}H${x+w-rx}A${rx} ${ry} 0 0 1 ${x+w} ${y+ry}V${y+h-ry}A${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h}`+
         `H${x+rx}A${rx} ${ry} 0 0 1 ${x} ${y+h-ry}V${y+ry}A${rx} ${ry} 0 0 1 ${x+rx} ${y}Z`;
}
export function ellipsePath(cx,cy,rx,ry){
  if(!(rx>0&&ry>0)) return '';
  return `M${cx+rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy+ry}A${rx} ${ry} 0 0 1 ${cx-rx} ${cy}`+
         `A${rx} ${ry} 0 0 1 ${cx} ${cy-ry}A${rx} ${ry} 0 0 1 ${cx+rx} ${cy}Z`;
}
export function polyPath(pts, close){
  if(pts.length<4) return '';
  let s='M'+pts[0]+' '+pts[1]; for(let i=2;i<pts.length;i+=2) s+='L'+pts[i]+' '+pts[i+1];
  return close? s+'Z' : s;
}
