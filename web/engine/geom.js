// Geometry helpers (no DOM). Units: mm. Polylines are flat [x,y,x,y,...] arrays.
// Objects on the bed: {x,y (center, work coords), rot (deg), cw,ch (local size), sx,sy (scale)}.

export const rad = d => d * Math.PI / 180;
export const oW = o => o.cw * o.sx, oH = o => o.ch * o.sy;
export function toLocal(o,x,y){ const dx=x-o.x, dy=y-o.y, c=Math.cos(rad(o.rot)), s=Math.sin(rad(o.rot)); return [dx*c+dy*s, -dx*s+dy*c]; }
export function toWorld(o,lx,ly){ const c=Math.cos(rad(o.rot)), s=Math.sin(rad(o.rot)); return [o.x+lx*c-ly*s, o.y+lx*s+ly*c]; }
export function objCorners(o){ const w=oW(o)/2,h=oH(o)/2; return [[-w,-h],[w,-h],[w,h],[-w,h]].map(([a,b])=>toWorld(o,a,b)); }
export function layoutBounds(list){
  const b={x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity};
  for(const o of list) for(const [x,y] of objCorners(o)){ b.x0=Math.min(b.x0,x); b.y0=Math.min(b.y0,y); b.x1=Math.max(b.x1,x); b.y1=Math.max(b.y1,y); }
  return b;
}

// Chain segments whose endpoints touch into single contours (SolidWorks DXF exports a rectangle as 4 LINEs).
// Same result, piece for piece, as the original O(n^2) scan (joinPolysSlow below, kept for the tests):
// take the LAST remaining piece, then repeatedly attach the remaining piece with the LOWEST index that
// touches either end, testing end->start, end->end, start->end, start->start in that order.
// A spatial hash of endpoints finds the candidates, so big DXFs join in roughly linear time.
export function joinPolys(ps, tol){
  tol=tol||0.01;
  const eq=(ax,ay,bx,by)=>Math.abs(ax-bx)<tol&&Math.abs(ay-by)<tol;
  const rev=q=>{ const r=[]; for(let i=q.length-2;i>=0;i-=2) r.push(q[i],q[i+1]); return r; };
  const P=ps.map(p=>Array.from(p)), N=P.length, alive=new Uint8Array(N).fill(1), out=[];
  // grid of cell size tol: any point within tol (per axis) of (x,y) is in the 3x3 cells around it
  const grid=new Map(), key=(cx,cy)=>cx+','+cy;
  const cell=v=>Math.floor(v/tol);
  const addPt=(x,y,i)=>{ const k=key(cell(x),cell(y)); let a=grid.get(k); if(!a) grid.set(k,a=[]); a.push(i); };
  for(let i=0;i<N;i++){ const q=P[i], m=q.length; if(m<2) continue; addPt(q[0],q[1],i); addPt(q[m-2],q[m-1],i); }
  const near=(x,y,set)=>{ const cx=cell(x), cy=cell(y); for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){ const a=grid.get(key(cx+dx,cy+dy)); if(a) for(const i of a) if(alive[i]) set.add(i); } };
  let top=N-1;
  const cand=new Set();
  while(true){
    while(top>=0 && !alive[top]) top--;
    if(top<0) break;
    let cur=P[top]; alive[top]=0;
    let grew=true;
    while(grew){
      grew=false; const n=cur.length;
      if(n>=6 && eq(cur[0],cur[1],cur[n-2],cur[n-1])) break;
      const ex=cur[n-2], ey=cur[n-1], sx=cur[0], sy=cur[1];
      cand.clear(); near(ex,ey,cand); near(sx,sy,cand);
      let best=-1;
      for(const i of cand){
        if(best>=0 && i>=best) continue;
        const q=P[i], m=q.length;
        if(eq(ex,ey,q[0],q[1])||eq(ex,ey,q[m-2],q[m-1])||eq(sx,sy,q[m-2],q[m-1])||eq(sx,sy,q[0],q[1])) best=i;
      }
      if(best<0) break;
      const q=P[best], m=q.length;
      if(eq(ex,ey,q[0],q[1])) cur=cur.concat(q.slice(2));
      else if(eq(ex,ey,q[m-2],q[m-1])) cur=cur.concat(rev(q).slice(2));
      else if(eq(sx,sy,q[m-2],q[m-1])) cur=q.concat(cur.slice(2));
      else cur=rev(q).concat(cur.slice(2));
      alive[best]=0; grew=true;
    }
    out.push(cur);
  }
  return out;
}
// The original joiner, kept as the reference the fast one is tested against.
export function joinPolysSlow(ps, tol){
  tol=tol||0.01;
  const eq=(ax,ay,bx,by)=>Math.abs(ax-bx)<tol&&Math.abs(ay-by)<tol;
  const rev=q=>{ const r=[]; for(let i=q.length-2;i>=0;i-=2) r.push(q[i],q[i+1]); return r; };
  const left=ps.map(p=>Array.from(p)), out=[];
  while(left.length){
    let cur=left.pop(), grew=true;
    while(grew){
      grew=false; const n=cur.length;
      if(n>=6 && eq(cur[0],cur[1],cur[n-2],cur[n-1])) break;
      const ex=cur[n-2], ey=cur[n-1], sx=cur[0], sy=cur[1];
      for(let i=0;i<left.length;i++){
        const q=left[i], m=q.length;
        if(eq(ex,ey,q[0],q[1])) cur=cur.concat(q.slice(2));
        else if(eq(ex,ey,q[m-2],q[m-1])) cur=cur.concat(rev(q).slice(2));
        else if(eq(sx,sy,q[m-2],q[m-1])) cur=q.concat(cur.slice(2));
        else if(eq(sx,sy,q[0],q[1])) cur=rev(q).concat(cur.slice(2));
        else continue;
        left.splice(i,1); grew=true; break;
      }
    }
    out.push(cur);
  }
  return out;
}

// Imported vector -> joined contours moved so the bounding box starts at 0,0.
// Returns {polys, w, h, pieces, pts}. Throws if nothing usable.
export function normalizeVec(polys){
  const pieces=polys.length;
  polys = joinPolys(polys.filter(p=>p.length>=4));
  if(!polys.length) throw new Error('no usable geometry found');
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity, pts=0;
  for(const p of polys) for(let i=0;i<p.length;i+=2){ x0=Math.min(x0,p[i]); x1=Math.max(x1,p[i]); y0=Math.min(y0,p[i+1]); y1=Math.max(y1,p[i+1]); pts++; }
  for(const p of polys) for(let i=0;i<p.length;i+=2){ p[i]-=x0; p[i+1]-=y0; }
  return { polys, w:Math.max(x1-x0,0.01), h:Math.max(y1-y0,0.01), pieces, pts };
}

// Douglas-Peucker on flat [x,y,...]
export function simplify(p, tol){
  const n=p.length/2; if(n<3) return p;
  const keep=new Uint8Array(n); keep[0]=keep[n-1]=1; const stack=[[0,n-1]];
  while(stack.length){
    const [a,b]=stack.pop(); const ax=p[a*2],ay=p[a*2+1],bx=p[b*2],by=p[b*2+1];
    const dx=bx-ax, dy=by-ay, L=Math.hypot(dx,dy)||1e-12; let md=-1, mi=-1;
    for(let i=a+1;i<b;i++){ const d = L>1e-9 ? Math.abs(dy*(p[i*2]-ax)-dx*(p[i*2+1]-ay))/L : Math.hypot(p[i*2]-ax,p[i*2+1]-ay); if(d>md){md=d;mi=i;} }
    if(md>tol){ keep[mi]=1; stack.push([a,mi],[mi,b]); }
  }
  const out=[]; for(let i=0;i<n;i++) if(keep[i]) out.push(p[i*2],p[i*2+1]); return out;
}

export function nurbs(deg, knots, ctrl, w){
  const n=ctrl.length;
  if(knots.length!==n+deg+1) return ctrl.flat();
  const W = w.length===n ? w : ctrl.map(()=>1);
  const t0=knots[deg], t1=knots[n], N=Math.max(24,n*20), out=[];
  for(let s=0;s<=N;s++){
    let t=t0+(t1-t0)*s/N; if(s===N) t=t1-1e-9*(t1-t0||1);
    let kk=deg; while(kk<n-1 && t>=knots[kk+1]) kk++;
    const d=[]; for(let j=0;j<=deg;j++){ const i=kk-deg+j; d.push([ctrl[i][0]*W[i], ctrl[i][1]*W[i], W[i]]); }
    for(let r=1;r<=deg;r++) for(let j=deg;j>=r;j--){
      const i=kk-deg+j, den=knots[i+deg-r+1]-knots[i], a=den? (t-knots[i])/den : 0;
      for(let c=0;c<3;c++) d[j][c]=(1-a)*d[j-1][c]+a*d[j][c];
    }
    out.push(d[deg][0]/d[deg][2], d[deg][1]/d[deg][2]);
  }
  return out;
}

export function inPoly(x,y,p){ let c=false; const n=p.length/2; for(let i=0,j=n-1;i<n;j=i++){ const xi=p[i*2],yi=p[i*2+1],xj=p[j*2],yj=p[j*2+1]; if(((yi>y)!==(yj>y)) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) c=!c; } return c; }
export function isClosed(p){ const n=p.length; return n>=6 && Math.hypot(p[0]-p[n-2],p[1]-p[n-1]) < 0.05; }
// per-contour bounding boxes [x0,y0,x1,y1,...], cached on the object until its polys change
export function polyBoxes(o){
  if(o._bb && o._bbP===o.polys) return o._bb;
  const bb=new Float64Array(o.polys.length*4);
  o.polys.forEach((p,i)=>{ let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity; for(let k=0;k<p.length;k+=2){ const x=p[k], y=p[k+1]; if(x<a)a=x; if(x>c)c=x; if(y<b)b=y; if(y>d)d=y; } bb[i*4]=a; bb[i*4+1]=b; bb[i*4+2]=c; bb[i*4+3]=d; });
  o._bb=bb; o._bbP=o.polys; return bb;
}
export function containedIdx(o){ // contours lying inside some other closed contour
  // A point outside a ring's bounding box can't be inside it (even-odd test), so the box
  // check only skips work; the answer is the same as testing every pair.
  const closed=o.polys.map(isClosed), inside=new Set(), bb=polyBoxes(o);
  o.polys.forEach((p,i)=>{ const mx=p[0], my=p[1]; for(let j=0;j<o.polys.length;j++){ if(j===i||!closed[j]) continue;
    if(mx<bb[j*4]||mx>bb[j*4+2]||my<bb[j*4+1]||my>bb[j*4+3]) continue;
    if(inPoly(mx,my,o.polys[j])){ inside.add(i); break; } } });
  return inside;
}

// even-odd scanline hatch of closed polygons -> [x0,x1,y] segments, alternating direction
export function hatch(polys, interval){
  const E=[]; let y0=Infinity, y1=-Infinity;
  for(const p of polys){ const n=p.length/2; for(let i=0;i<n;i++){ const j=(i+1)%n, ax=p[i*2], ay=p[i*2+1], bx=p[j*2], by=p[j*2+1]; if(ay!==by) E.push([ax,ay,bx,by]); y0=Math.min(y0,ay); y1=Math.max(y1,ay); } }
  const out=[]; let fwd=true;
  for(let y=y0+interval/2; y<y1; y+=interval){
    const xs=[]; for(const [ax,ay,bx,by] of E) if((ay<=y&&by>y)||(by<=y&&ay>y)) xs.push(ax+(y-ay)*(bx-ax)/(by-ay));
    xs.sort((a,b)=>a-b);
    const row=[]; for(let i=0;i+1<xs.length;i+=2) if(xs[i+1]-xs[i]>1e-6) row.push([xs[i],xs[i+1],y]);
    if(!row.length) continue;
    if(fwd) out.push(...row); else for(let i=row.length-1;i>=0;i--) out.push([row[i][1],row[i][0],y]);
    fwd=!fwd;
  }
  return out;
}
export function nnOrder(polys){
  const left=polys.slice(), out=[]; let cx=0, cy=0;
  while(left.length){
    let bi=0, bd=Infinity, rev=false;
    for(let i=0;i<left.length;i++){ const p=left[i], n=p.length;
      const d0=Math.hypot(p[0]-cx,p[1]-cy), d1=Math.hypot(p[n-2]-cx,p[n-1]-cy);
      if(d0<bd){bd=d0;bi=i;rev=false;} if(d1<bd){bd=d1;bi=i;rev=true;} }
    let p=left.splice(bi,1)[0];
    if(rev){ const r=[]; for(let i=p.length-2;i>=0;i-=2) r.push(p[i],p[i+1]); p=r; }
    out.push(p); cx=p[p.length-2]; cy=p[p.length-1];
  }
  return out;
}

// test-block shapes
export function sq(x0,y0,s){ return [x0,y0, x0+s,y0, x0+s,y0+s, x0,y0+s, x0,y0]; }
export function circ(cx,cy,r){ const o=[], n=Math.max(24,Math.ceil(2*Math.PI*r/0.2)); for(let i=0;i<=n;i++){ const a=2*Math.PI*i/n; o.push(cx+r*Math.cos(a), cy+r*Math.sin(a)); } return o; }
export function shift(p,dx,dy){ return p.map((v,i)=>v+(i%2?dy:dx)); }
