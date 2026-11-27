// ---------- map ----------
const cv=$('map'), cx=cv.getContext('2d');
let jobCv=document.createElement('canvas'), doneCv=document.createElement('canvas');
let W=0,H=0,DPR=1, vw={x0:0,y0:0,sc:1}, dirty=true, staticKey='', doneSeg=0;
const BURN_COL='255,122,26', DONE_COL='46,229,157';

function bedRect(){ return { x0:(+$('bedX0').value||0)*MM, y0:(+$('bedY0').value||0)*MM, w:(+$('bedW').value||10)*MM, h:(+$('bedH').value||10)*MM }; }
function resize(){
  const r = cv.getBoundingClientRect(); DPR = window.devicePixelRatio||1;
  W = Math.max(50,r.width); H=Math.max(50,r.height);
  for(const c of [cv,jobCv,doneCv]){ c.width=Math.round(W*DPR); c.height=Math.round(H*DPR); }
  staticKey=''; dirty=true;
}
function fitView(){
  const b=bedRect(); let x0=b.x0,y0=b.y0,x1=b.x0+b.w,y1=b.y0+b.h;
  if(job.prev && job.prev.all){ const a=job.prev.all, o=st.wco; x0=Math.min(x0,a.minX+o[0]); y0=Math.min(y0,a.minY+o[1]); x1=Math.max(x1,a.maxX+o[0]); y1=Math.max(y1,a.maxY+o[1]); }
  const m=24, sc=Math.min((W-2*m)/(x1-x0||1),(H-2*m)/(y1-y0||1));
  vw={ sc, x0: x0 - (W/sc - (x1-x0))/2, y0: y0 - (H/sc - (y1-y0))/2 };
  staticKey=''; dirty=true;
}
const px = x => (x-vw.x0)*vw.sc, py = y => H-(y-vw.y0)*vw.sc;
const toMach = (sx,sy) => [sx/vw.sc+vw.x0, (H-sy)/vw.sc+vw.y0];

// Job preview: one Path2D for rapids + one per power level, built once per job in work-coord
// mm, then drawn through a view transform. While you zoom/pan, the last render is just
// scaled/moved as a bitmap (cheap); ~200 ms after the view stops it re-renders crisp.
let lastViewMove=0, jobView=null, crispTimer=0, tool='select';   // tool: 'select' | 'pan' (set by 10-shell)
function viewMoved(){ lastViewMove=performance.now(); dirty=true; clearTimeout(crispTimer); crispTimer=setTimeout(()=>{ dirty=true; }, 200); }
function forceCrisp(){ lastViewMove=0; }
function jobPaths(){
  const P=job.prev; if(!P||!P.n) return null;
  if(job.paths && job.paths.P===P) return job.paths;
  const rapid=new Path2D(), lv=Array.from({length:8},()=>new Path2D()), has=new Uint8Array(8); let anyRapid=false;
  for(let i=0;i<P.n;i++){
    const t=P.type[i];
    if(t===0){ rapid.moveTo(P.x0[i],P.y0[i]); rapid.lineTo(P.x1[i],P.y1[i]); anyRapid=true; }
    else if(t===2){ const L=P.lvl[i]; lv[L].moveTo(P.x0[i],P.y0[i]); lv[L].lineTo(P.x1[i],P.y1[i]); has[L]=1; }
  }
  return (job.paths={P, rapid, anyRapid, lv, has});
}
// canvas transform: work-coord mm -> device pixels for the current view
function workTransform(g){ const s=vw.sc; g.setTransform(DPR*s,0,0,-DPR*s, DPR*(st.wco[0]-vw.x0)*s, DPR*(H-(st.wco[1]-vw.y0)*s)); }
function renderStatic(){
  const g=jobCv.getContext('2d'); g.setTransform(1,0,0,1,0,0); g.clearRect(0,0,jobCv.width,jobCv.height);
  jobView={ x0:vw.x0, y0:vw.y0, sc:vw.sc };
  const jp=jobPaths(); if(!jp) return;
  const s=vw.sc; workTransform(g);
  if(jp.anyRapid){ g.strokeStyle='rgba(120,140,160,0.35)'; g.lineWidth=1/s; g.setLineDash([3/s,3/s]); g.stroke(jp.rapid); g.setLineDash([]); }
  g.lineWidth = (job.pitch ? Math.max(1, job.pitch*s) : 1.3)/s; g.lineCap = job.pitch?'butt':'round';
  for(let L=0;L<8;L++){ if(!jp.has[L]) continue; g.strokeStyle='rgba('+BURN_COL+','+(0.18+0.82*(L+1)/8)+')'; g.stroke(jp.lv[L]); }
}
function clearDone(){ const g=doneCv.getContext('2d'); g.setTransform(1,0,0,1,0,0); g.clearRect(0,0,doneCv.width,doneCv.height); doneSeg=0; }
function renderDone(){
  const P=job.prev; if(!P||!P.n) return;
  // find first segment whose line >= acked
  let lo=doneSeg, hi=P.n; const a=job.acked;
  while(lo<hi){ const m=(lo+hi)>>1; if(P.line[m]<a) lo=m+1; else hi=m; }
  if(lo<=doneSeg) return;
  const g=doneCv.getContext('2d'); g.setTransform(DPR,0,0,DPR,0,0);
  const ox=st.wco[0], oy=st.wco[1];
  g.lineWidth = job.pitch ? Math.max(1, job.pitch*vw.sc) : 1.6; g.lineCap = job.pitch?'butt':'round';
  g.strokeStyle='rgba('+DONE_COL+',0.85)'; g.beginPath();
  for(let i=doneSeg;i<lo;i++) if(P.type[i]===2){ g.moveTo(px(P.x0[i]+ox),py(P.y0[i]+oy)); g.lineTo(px(P.x1[i]+ox),py(P.y1[i]+oy)); }
  g.stroke(); doneSeg=lo;
}
function draw(){
  const ckey = [W,H,st.wco[0],st.wco[1],job.prev?job.prev.n:0,job.name].join('|'), key = ckey+'#'+[vw.x0,vw.y0,vw.sc].join('|');
  let blit=false;
  if(key!==staticKey){
    if(staticKey.split('#')[0]===ckey && jobView && performance.now()-lastViewMove<180) blit=true;   // mid-zoom/pan
    else { staticKey=key; renderStatic(); const keep=job.acked; clearDone(); if(keep) renderDone(); }
  }
  if(!blit) renderDone();
  const g=cx; g.setTransform(DPR,0,0,DPR,0,0); g.clearRect(0,0,W,H);
  // bed + inch grid
  const b=bedRect();
  const H_=isHud();
  if(H_){ g.save(); g.shadowColor='rgba(0,229,255,.35)'; g.shadowBlur=24; }
  g.fillStyle=H_?'rgba(0,26,40,0.55)':'#0e1217'; g.fillRect(px(b.x0),py(b.y0+b.h),b.w*vw.sc,b.h*vw.sc);
  if(H_) g.restore();
  const step = vw.sc*MM < 12 ? MM*6 : (vw.sc*MM < 25 ? MM*2 : MM);
  g.strokeStyle=H_?'rgba(0,229,255,0.10)':'#1c242e'; g.lineWidth=1; g.beginPath();
  for(let x=b.x0;x<=b.x0+b.w+0.01;x+=step){ g.moveTo(px(x)+.5,py(b.y0)); g.lineTo(px(x)+.5,py(b.y0+b.h)); }
  for(let y=b.y0;y<=b.y0+b.h+0.01;y+=step){ g.moveTo(px(b.x0),py(y)+.5); g.lineTo(px(b.x0+b.w),py(y)+.5); }
  g.stroke();
  g.strokeStyle=H_?'rgba(0,229,255,0.55)':'#4a5868'; g.strokeRect(px(b.x0)+.5,py(b.y0+b.h)+.5,b.w*vw.sc,b.h*vw.sc);
  if(H_){ // corner brackets on the bed
    const X0=px(b.x0),Y0=py(b.y0+b.h),X1=px(b.x0+b.w),Y1=py(b.y0); g.strokeStyle='#00e5ff'; g.lineWidth=2; g.beginPath();
    for(const [x,y,sx,sy] of [[X0,Y0,1,1],[X1,Y0,-1,1],[X0,Y1,1,-1],[X1,Y1,-1,-1]]){ g.moveTo(x,y+sy*22); g.lineTo(x,y); g.lineTo(x+sx*22,y); }
    g.stroke(); g.lineWidth=1;
  }
  g.fillStyle=H_?'rgba(127,243,255,0.75)':'#7d8a99'; g.font='10px ui-monospace,monospace';
  for(let x=b.x0;x<=b.x0+b.w+0.01;x+=step) g.fillText(((x)/MM).toFixed(0), px(x)+2, py(b.y0)+11);
  // job layers
  if(!(layoutStale && job.fromLayout)){
    if(blit){ // map the last crisp render from its view to the current one
      const k=vw.sc/jobView.sc, ex=(jobView.x0-vw.x0)*vw.sc, ey=H-H*k-(jobView.y0-vw.y0)*vw.sc;
      g.setTransform(DPR*k,0,0,DPR*k,DPR*ex,DPR*ey); g.drawImage(jobCv,0,0,W,H); g.drawImage(doneCv,0,0,W,H);
    } else { g.setTransform(1,0,0,1,0,0); g.drawImage(jobCv,0,0); g.drawImage(doneCv,0,0); }
  }
  g.setTransform(DPR,0,0,DPR,0,0);
  drawObjs(g);
  if((typeof Resume!=='undefined')) try{ Resume.drawMarker(g); }catch{}
  if(typeof Design!=='undefined') try{ Design.drawGuides(g); }catch{}
  // work zero
  if(st.known){
    const zx=px(st.wco[0]), zy=py(st.wco[1]);
    g.strokeStyle='#5aa9ff'; g.lineWidth=1.5; g.beginPath(); g.moveTo(zx,zy); g.lineTo(zx+22,zy); g.moveTo(zx,zy); g.lineTo(zx,zy-22); g.stroke();
    g.fillStyle='#5aa9ff'; g.fillText('W0',zx+3,zy-4);
    // head
    const hx=px(st.m[0]), hy=py(st.m[1]);
    const firing = st.s>0 && (st.state==='Run'||st.state==='Jog');
    if(H_){
      const t=performance.now()/1000, col=firing?'#ff3b4e':'#00e5ff';
      g.save(); g.translate(hx,hy); g.shadowColor=col; g.shadowBlur=12; g.strokeStyle=col; g.lineWidth=1.5;
      g.rotate(t*1.2); g.setLineDash([10,7]); g.beginPath(); g.arc(0,0,20,0,Math.PI*2); g.stroke();
      g.rotate(-t*2.6); g.setLineDash([3,5]); g.beginPath(); g.arc(0,0,13,0,Math.PI*2); g.stroke(); g.setLineDash([]);
      g.rotate(t*1.4); for(let i=0;i<4;i++){ g.rotate(Math.PI/2); g.beginPath(); g.moveTo(24,0); g.lineTo(32,0); g.stroke(); }
      g.restore();
      g.beginPath(); g.arc(hx,hy,firing?5:3,0,Math.PI*2); g.fillStyle=col; g.fill();
      g.font='10px ui-monospace,monospace'; g.fillStyle='rgba(127,243,255,0.9)';
      g.fillText('X '+(st.w[0]/MM).toFixed(3), hx+36, hy-6); g.fillText('Y '+(st.w[1]/MM).toFixed(3), hx+36, hy+6);
    } else {
      g.strokeStyle = firing ? '#ff3030' : '#ffffff'; g.lineWidth=1.5;
      g.beginPath(); g.moveTo(hx-14,hy); g.lineTo(hx-4,hy); g.moveTo(hx+4,hy); g.lineTo(hx+14,hy); g.moveTo(hx,hy-14); g.lineTo(hx,hy-4); g.moveTo(hx,hy+4); g.lineTo(hx,hy+14); g.stroke();
      g.beginPath(); g.arc(hx,hy,firing?5:3,0,Math.PI*2); g.fillStyle=firing?'#ff3030':'#ffffff'; g.fill();
    }
  }
}
let lastAnim=0;
(function loop(ts){ const anim = isHud() && connected && st.known && ts-lastAnim>33; if(dirty || job.running || anim){ dirty=false; lastAnim=ts||0; draw(); } requestAnimationFrame(loop); })(0);
new ResizeObserver(()=>{ resize(); if(!vw.init){ vw.init=true; fitView(); } }).observe($('mapWrap'));

// pan / zoom / select / move / scale / rotate / crop / dblclick
let drag=null;
function evPos(e){
  const r=cv.getBoundingClientRect(); const sx=e.clientX-r.left, sy=e.clientY-r.top; const [mx,my]=toMach(sx,sy);
  return {sx,sy,mx,my,wx:mx-st.wco[0],wy:my-st.wco[1]};
}
function hitTest(p){
  if(job.running) return null;
  const tol=9/vw.sc;
  if(sel){
    const o=sel, W=oW(o), H=oH(o), [lx,ly]=toLocal(o,p.wx,p.wy);
    if(cropMode){ for(const [edge,hx,hy] of [['r',W/2,0],['l',-W/2,0],['t',0,H/2],['b',0,-H/2]]) if(Math.hypot(lx-hx,ly-hy)<tol*1.3) return {o,kind:'crop',edge}; }
    else {
      if(Math.hypot(lx, ly-(H/2+24/vw.sc))<tol) return {o,kind:'rot'};
      for(const [a,b] of [[-1,-1],[1,-1],[1,1],[-1,1]]) if(Math.hypot(lx-a*W/2, ly-b*H/2)<tol) return {o,kind:'scale',ax:a,ay:b};
    }
  }
  for(let i=objs.length-1;i>=0;i--){ const o=objs[i]; if(o.type==='vec' && pathAt(o,p)>=0) return {o,kind:'move'}; }
  for(let i=objs.length-1;i>=0;i--){ const o=objs[i], [lx,ly]=toLocal(o,p.wx,p.wy), pad=o.type==='vec'?8/vw.sc:0; if(Math.abs(lx)<=oW(o)/2+pad && Math.abs(ly)<=oH(o)/2+pad) return {o,kind:'move'}; }
  return null;
}
function pathAt(o,p){
  const [lx,ly]=toLocal(o,p.wx,p.wy), X=lx/o.sx+o.cw/2, Y=ly/o.sy+o.ch/2, tol=7/vw.sc/Math.min(o.sx,o.sy);
  let best=-1, bd=tol; const bb=Eng.polyBoxes(o);
  // skip contours whose bounding box is farther than the best hit so far (can't win)
  o.polys.forEach((q,pi)=>{ if(X<bb[pi*4]-bd||X>bb[pi*4+2]+bd||Y<bb[pi*4+1]-bd||Y>bb[pi*4+3]+bd) return; for(let i=0;i+3<q.length;i+=2){ const ax=q[i],ay=q[i+1],bx=q[i+2],by=q[i+3],dx=bx-ax,dy=by-ay,L=dx*dx+dy*dy; let t=L?((X-ax)*dx+(Y-ay)*dy)/L:0; t=Math.max(0,Math.min(1,t)); const d=Math.hypot(X-ax-t*dx,Y-ay-t*dy); if(d<bd){bd=d;best=pi;} } });
  return best;
}
const CURSOR={move:'move',scale:'nwse-resize',rot:'grab',crop:'col-resize'};
cv.addEventListener('wheel', e=>{
  e.preventDefault(); const r=cv.getBoundingClientRect(); const [mx,my]=toMach(e.clientX-r.left,e.clientY-r.top);
  const f = e.deltaY<0?1.15:1/1.15; vw.sc*=f; vw.x0 = mx-(mx-vw.x0)/f; vw.y0 = my-(my-vw.y0)/f; viewMoved();
},{passive:false});
cv.addEventListener('contextmenu', e=>e.preventDefault());
cv.addEventListener('mousedown', e=>{
  const p=evPos(e);
  const h = (e.button===0 && tool!=='pan') ? hitTest(p) : null;
  if(h){
    if(sel!==h.o){ sel=h.o; cropMode=false; }
    if(h.kind==='move' && h.o.type==='vec'){
      const pi=pathAt(h.o,p);
      if(pi>=0){ if(e.shiftKey){ h.o.psel.has(pi)?h.o.psel.delete(pi):h.o.psel.add(pi); } else if(!h.o.psel.has(pi)) h.o.psel=new Set([pi]); }
      else if(!e.shiftKey) h.o.psel=new Set();
    }
    drag={...h, p0:p, x0:h.o.x, y0:h.o.y};
    if(h.kind==='scale'){ const W=oW(h.o), H=oH(h.o); drag.A=toWorld(h.o,-h.ax*W/2,-h.ay*H/2); drag.W0=W; drag.H0=H; drag.sx0=h.o.sx; drag.sy0=h.o.sy; }
    syncProps(); dirty=true;
  } else {
    if(e.button===0 && sel && tool!=='pan'){ sel=null; cropMode=false; syncProps(); dirty=true; }
    drag={kind:'pan', x:e.clientX, y:e.clientY, vx:vw.x0, vy:vw.y0};
  }
});
window.addEventListener('mouseup', ()=>{ drag=null; });
window.addEventListener('mousemove', e=>{
  if(!drag) return;
  if(drag.kind==='pan'){ vw.x0=drag.vx-(e.clientX-drag.x)/vw.sc; vw.y0=drag.vy+(e.clientY-drag.y)/vw.sc; viewMoved(); return; }
  const p=evPos(e), o=drag.o;
  if(drag.kind==='move'){ o.x=drag.x0+(p.wx-drag.p0.wx); o.y=drag.y0+(p.wy-drag.p0.wy); if(typeof Design!=='undefined') Design.snapMove(o, e.altKey); }
  else if(drag.kind==='rot'){
    let a=Math.atan2(p.wy-o.y,p.wx-o.x)*180/Math.PI-90;
    if(e.shiftKey) a=Math.round(a/15)*15;
    o.rot=((a+540)%360)-180;
  }
  else if(drag.kind==='scale'){
    const c=Math.cos(rad(o.rot)), s=Math.sin(rad(o.rot)), dx=p.wx-drag.A[0], dy=p.wy-drag.A[1];
    let nw=(dx*c+dy*s)*drag.ax, nh=(-dx*s+dy*c)*drag.ay;
    const lock = $('oLock').checked !== e.shiftKey;
    if(lock){ const f=Math.max(0.01,(nw*drag.W0+nh*drag.H0)/(drag.W0*drag.W0+drag.H0*drag.H0)); nw=drag.W0*f; nh=drag.H0*f; }
    nw=Math.max(0.5,nw); nh=Math.max(0.5,nh);
    o.sx=drag.sx0*nw/drag.W0; o.sy=drag.sy0*nh/drag.H0;
    const [lx,ly]=[drag.ax*nw/2, drag.ay*nh/2];
    o.x=drag.A[0]+lx*c-ly*s; o.y=drag.A[1]+lx*s+ly*c;
  }
  else if(drag.kind==='crop'){
    const [lx,ly]=toLocal(o,p.wx,p.wy), W=oW(o), H=oH(o); let sh=[0,0];
    if(drag.edge==='r'){ const ncw=Math.max(2,Math.min(o.iw-o.cx, o.cw+(lx-W/2)/o.sx)); sh=[(ncw-o.cw)*o.sx/2,0]; o.cw=ncw; }
    else if(drag.edge==='l'){ const ncx=Math.max(0,Math.min(o.cx+o.cw-2, o.cx-(-W/2-lx)/o.sx)); const d=o.cx-ncx; o.cx=ncx; o.cw+=d; sh=[-d*o.sx/2,0]; }
    else if(drag.edge==='t'){ const ncy=Math.max(0,Math.min(o.cy+o.ch-2, o.cy-(ly-H/2)/o.sy)); const d=o.cy-ncy; o.cy=ncy; o.ch+=d; sh=[0,d*o.sy/2]; }
    else if(drag.edge==='b'){ const nch=Math.max(2,Math.min(o.ih-o.cy, o.ch+(-H/2-ly)/o.sy)); sh=[0,-(nch-o.ch)*o.sy/2]; o.ch=nch; }
    [o.x,o.y]=toWorld(o,sh[0],sh[1]);
  }
  layoutChanged();
});
cv.addEventListener('mousemove', e=>{
  const p=evPos(e);
  $('hover').textContent='M '+(p.mx/MM).toFixed(3)+', '+(p.my/MM).toFixed(3)+' in   W '+(p.wx/MM).toFixed(3)+', '+(p.wy/MM).toFixed(3);
  if(!drag){ if(tool==='pan') cv.style.cursor=''; else { const h=hitTest(p); cv.style.cursor = h ? CURSOR[h.kind] : 'crosshair'; } }
});
cv.addEventListener('dblclick', e=>{
  const p=evPos(e);
  if(hitTest(p)) return;
  if(!canCommand()) return;
  const b=bedRect();
  if(p.mx<b.x0||p.my<b.y0||p.mx>b.x0+b.w||p.my>b.y0+b.h){ log('Outside bed, ignored','warn'); return; }
  queue('M5','G53 G0 X'+fmt(p.mx)+' Y'+fmt(p.my));
});

log('Burner ready. Bridge mode: run burner_bridge.py, pick the port, Connect.','dim');
$('mode').dispatchEvent(new Event('change'));
updateUI();
