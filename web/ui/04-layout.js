// ---------- layout: images + vectors on the bed (work coords, mm) ----------
const objs=[]; let sel=null, cropMode=false, layoutStale=false;
function readRaster(){ const v={}; for(const id of RFIELDS){ const el=$(id); v[id]= el.type==='checkbox'?el.checked:+el.value; } return v; }
function writeRaster(v){ for(const id of RFIELDS){ if(v[id]===undefined) continue; const el=$(id); if(el.type==='checkbox') el.checked=v[id]; else el.value=v[id]; } }
function layoutChanged(){
  layoutVer++;
  if(!objs.length && job.fromLayout){ layoutStale=false; clearJob(); }
  else if(objs.length) layoutStale=true;
  dirty=true; scheduleUI();                    // panel + status refresh once per frame, not per mousemove
}
function addObj(o){
  o.on=true;
  const off=objs.length*0.25*MM;
  o.rot=0; o.x=oW(o)/2+off; o.y=oH(o)/2+off;
  objs.push(o); sel=o; cropMode=false; layoutChanged();
}
function defaultOps(){ const m=(typeof Material!=='undefined') && Material.ops(); if(m) return m; return { cut:{power:100,feed:5,passes:2}, score:{power:30,feed:20,passes:1}, fill:{power:40,feed:60,passes:1,interval:0.1} }; }
const OPS=['cut','score','fill'];
function deleteSel(){ if(!sel) return; objs.splice(objs.indexOf(sel),1); sel=null; cropMode=false; layoutChanged(); }

// ----- loading -----
$('loadImgBtn').onclick = ()=>$('imgFile').click();
$('imgFile').onchange = async e=>{
  for(const f of [...e.target.files]){
    const n=f.name.toLowerCase();
    try{
      if(n.endsWith('.dxf')) await importVecText(f.name, await f.text(), 'dxf');
      else if(n.endsWith('.svg')) await importVecText(f.name, await f.text(), 'svg');
      else await addImage(f);
    }catch(err){
      if(err.cancelled){ log('Import cancelled','warn'); break; }
      log('Load '+f.name+' failed: '+err.message,'bad');
    }
  }
  e.target.value='';
};
// DXF: parse + join in the worker. SVG: the browser resolves transforms/units (needs the
// DOM), then our own linear-time flattener; joining is fast either way now.
async function importVecText(name, text, kind){
  const t0=performance.now(); let mainMs=0;
  if(kind==='svg'){ addVec(name, parseSVG(text)); window.__lastImportMainMs=+(performance.now()-t0).toFixed(1); return; }
  Busy.show('Importing '+name);
  try{
    const res=await Jobs.run('vec', { name, text }, (f,s)=>Busy.set(f,s));
    const t1=performance.now();
    for(const [m,c] of res.logs) log(m,c);
    if(res.error) throw new Error(res.error);
    addVecNorm(name, res.n0, res.v);
    mainMs=performance.now()-t1;
  } finally { Busy.hide(); }
  window.__lastImportMainMs=+mainMs.toFixed(1);
}
function addImage(f){
  return new Promise((res,rej)=>{
    const im=new Image();
    im.onload=()=>{
      const iw=im.naturalWidth, ih=im.naturalHeight, s=Math.min(3.5*MM, bedRect().w)/iw;
      addObj({type:'img', img:im, blob:f, name:f.name, iw, ih, cx:0, cy:0, cw:iw, ch:ih, sx:s, sy:s, r:readRaster()});
      log('Image '+f.name+' '+iw+'x'+ih+' px added at 3.5 in wide','dim'); res();
    };
    im.onerror=()=>rej(new Error('not a readable image'));
    im.src=URL.createObjectURL(f);
  });
}
function addVec(name, polys){
  const n0=polys.length;
  addVecNorm(name, n0, Eng.normalizeVec(polys));
}
function addVecNorm(name, n0, v){
  if(v.polys.length<n0) log('Joined '+n0+' pieces into '+v.polys.length+' contours','dim');
  const polys=v.polys, w=v.w, h=v.h, pts=v.pts;
  addObj({type:'vec', name, polys, cx:0, cy:0, cw:w, ch:h, sx:1, sy:1, pathOp:polys.map(()=>'score'), psel:new Set(), set:defaultOps()});
  log('Vector '+name+': '+polys.length+' paths, '+pts+' pts, '+(w/MM).toFixed(3)+' x '+(h/MM).toFixed(3)+' in. All contours start as Score. Default power/speed are placeholders, dial them in on scrap.','dim');
}

// ----- SVG -----
// The browser resolves units, viewBox and transforms (getScreenCTM); geometry is flattened by
// engine/svgpath.js in linear time. (The old getPointAtLength sampler, kept in
// tests/legacy-svg.js, took minutes on a few thousand curves; tests/svg-compare.js checks
// both give the same shapes.)
function svgShapePath(g){
  const t=g.nodeName.toLowerCase(), L=a=>g[a].baseVal.value;
  if(t==='path') return g.getAttribute('d')||'';
  if(t==='line') return 'M'+L('x1')+' '+L('y1')+'L'+L('x2')+' '+L('y2');
  if(t==='polyline'||t==='polygon'){ const a=[]; for(let i=0;i<g.points.numberOfItems;i++){ const q=g.points.getItem(i); a.push(q.x,q.y); } return Eng.polyPath(a, t==='polygon'); }
  if(t==='rect'){ let rx=g.hasAttribute('rx')?L('rx'):null, ry=g.hasAttribute('ry')?L('ry'):null; if(rx===null) rx=ry===null?0:ry; if(ry===null) ry=rx; return Eng.rectPath(L('x'),L('y'),L('width'),L('height'),rx,ry); }
  if(t==='circle'){ const r=L('r'); return Eng.ellipsePath(L('cx'),L('cy'),r,r); }
  if(t==='ellipse') return Eng.ellipsePath(L('cx'),L('cy'),L('rx'),L('ry'));
  return '';
}
function parseSVG(t){
  const doc=new DOMParser().parseFromString(t,'image/svg+xml');
  const src=doc.documentElement; if(!src || src.nodeName.toLowerCase()!=='svg') throw new Error('not an SVG');
  const host=document.createElement('div'); host.style.cssText='position:absolute;left:0;top:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(host);
  const el=document.importNode(src,true); host.appendChild(el);
  try{
    const vb=el.viewBox && el.viewBox.baseVal;
    let k=25.4/96;
    const m=/^\s*([\d.]+)\s*(mm|cm|in|pt|px)?\s*$/.exec(src.getAttribute('width')||'');
    if(m && vb && vb.width) k = (+m[1])*({mm:1,cm:10,in:25.4,pt:25.4/72,px:25.4/96}[m[2]||'px'])/vb.width;
    log('SVG scale: '+(m?src.getAttribute('width'):'no width attr, assuming 96 dpi'),'dim');
    const root=el.getScreenCTM().inverse();
    const polys=[];
    for(const g of el.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse')){
      if(g.closest('defs,clipPath,mask,symbol,marker,pattern')) continue;
      let len; try{ len=g.getTotalLength(); }catch{ continue; }
      if(!(len>0)) continue;
      const M=root.multiply(g.getScreenCTM());
      const sc=Math.sqrt(Math.abs(M.a*M.d-M.b*M.c))*k || k;   // output mm per user unit
      for(const sp of Eng.flattenPath(svgShapePath(g), sc, 0.1)){
        const q=sp.pts, out=new Array(q.length);
        for(let i=0;i<q.length;i+=2){ out[i]=(M.a*q[i]+M.c*q[i+1]+M.e)*k; out[i+1]=-(M.b*q[i]+M.d*q[i+1]+M.f)*k; }
        polys.push(out);
      }
    }
    return polys.map(p=>simplify(p,0.01));
  } finally { host.remove(); }
}
// ----- properties panel -----
function objSummary(o){
  if(o.type==='img'){ const r=o.r||{}; return (r.rDither?'dither ':'gray ')+(r.rLpi||'')+'lpi '+(r.rPmax!==undefined?r.rPmax+'%':''); }
  const c={cut:0,score:0,fill:0}; o.pathOp.forEach(x=>{ if(c[x]!==undefined) c[x]++; });
  return ['cut','score','fill'].filter(k=>c[k]).map(k=>k+' '+c[k]).join(' · ')||'all off';
}
function renderObjList(){
  const el=$('objList');
  if(!objs.length){ el.className='muted'; el.textContent='Nothing on the bed yet.'; return; }
  el.className=''; el.innerHTML='';
  objs.forEach((o,i)=>{
    const d=document.createElement('div'); d.className='orow'+(o===sel?' sel':'')+(o.on?'':' off');
    d.innerHTML='<input type="checkbox"'+(o.on?' checked':'')+' title="Include in the job"><span class="dot" style="background:'+(o.type==='img'?'#ff7a1a':'#3ce0ff')+'"></span><span class="nm"></span><span class="sm"></span>';
    d.querySelector('.nm').textContent=o.name; d.querySelector('.nm').title=o.name; d.querySelector('.sm').textContent=objSummary(o);
    const cb=d.querySelector('input');
    cb.onclick=e=>{ e.stopPropagation(); o.on=cb.checked; layoutChanged(); };
    d.onclick=()=>{ sel=o; cropMode=false; syncProps(); dirty=true; };
    el.appendChild(d);
  });
}
function syncProps(){
  renderObjList();
  $('rasterHdr').textContent = sel&&sel.type==='img' ? 'Image engraving: this image' : 'Image engraving: new images';
  if(sel&&sel.type==='img'&&sel.r){ writeRaster(sel.r); fillPresetSel('rPreset','raster',sel.rPreset||''); }
  $('objNone').style.display = sel?'none':''; $('objBox').style.display = sel?'':'none';
  if(!sel) return;
  const set=(id,v)=>{ if(document.activeElement!==$(id)) $(id).value=v; };
  $('objName').textContent = sel.name+(sel.type==='vec'?'  (vector)':'  (image)');
  set('oX',(sel.x/MM).toFixed(3)); set('oY',(sel.y/MM).toFixed(3));
  set('oW',(oW(sel)/MM).toFixed(3)); set('oH',(oH(sel)/MM).toFixed(3)); set('oR',+sel.rot.toFixed(2));
  const im = sel.type==='img';
  $('cropBtn').disabled = !im; $('uncropBtn').disabled = !im;
  $('cropBtn').textContent = cropMode ? 'Done cropping' : 'Crop';
  $('vecProps').style.display = im ? 'none' : '';
  if(!im){
    for(const op of OPS) for(const k of ['power','feed','passes']) set('op_'+op+'_'+k, sel.set[op][k]);
    set('op_fill_interval', sel.set.fill.interval);
    for(const op of OPS) $('op_'+op+'_air').checked=!!sel.set[op].air;
    const cnt={cut:0,score:0,fill:0,off:0}; sel.pathOp.forEach(o=>cnt[o]++);
    $('pathInfo').innerHTML = '<b style="color:var(--tx)">'+sel.psel.size+'</b> of '+sel.polys.length+' contours picked &middot; <span style="color:#ff5a6a">cut '+cnt.cut+'</span> &middot; <span style="color:#3ce0ff">score '+cnt.score+'</span> &middot; <span style="color:#2ee59d">fill '+cnt.fill+'</span> &middot; off '+cnt.off;
    fillPresetSel('vPreset','vector', sel.preset||'');
  }
}
const numIn=(id,fn)=>$(id).addEventListener('change',()=>{ const v=parseFloat($(id).value); if(sel && isFinite(v)){ fn(v); layoutChanged(); } });
numIn('oX',v=>sel.x=v*MM); numIn('oY',v=>sel.y=v*MM); numIn('oR',v=>sel.rot=v);
numIn('oW',v=>{ if(v<=0) return; const f=v*MM/oW(sel); sel.sx*=f; if($('oLock').checked) sel.sy*=f; });
numIn('oH',v=>{ if(v<=0) return; const f=v*MM/oH(sel); sel.sy*=f; if($('oLock').checked) sel.sx*=f; });
for(const op of OPS){
  numIn('op_'+op+'_power',v=>{ if(sel.set){ sel.set[op].power=Math.max(0,Math.min(100,v)); sel.preset=''; } });
  numIn('op_'+op+'_feed',v=>{ if(sel.set){ sel.set[op].feed=Math.max(0.1,v); sel.preset=''; } });
  numIn('op_'+op+'_passes',v=>{ if(sel.set){ sel.set[op].passes=Math.max(1,Math.round(v)); sel.preset=''; } });
}
numIn('op_fill_interval',v=>{ if(sel.set){ sel.set.fill.interval=Math.max(0.02,v); sel.preset=''; } });
for(const op of OPS) $('op_'+op+'_air').addEventListener('change',()=>{ if(sel && sel.set){ sel.set[op].air=$('op_'+op+'_air').checked; sel.preset=''; layoutChanged(); } });
document.querySelectorAll('[data-op]').forEach(b=>b.onclick=()=>{
  if(!sel||sel.type!=='vec') return;
  const op=b.dataset.op, idx = sel.psel.size ? [...sel.psel] : sel.polys.map((_,i)=>i);
  let open=0;
  for(const i of idx){ if(op==='fill' && !isClosed(sel.polys[i])) { open++; continue; } sel.pathOp[i]=op; }
  if(open) log(open+' open contour'+(open>1?'s':'')+' skipped for Fill (fill needs closed shapes)','warn');
  layoutChanged();
});
$('onlySelBtn').onclick=()=>{ if(!sel){ log('Select an object first','warn'); return; } objs.forEach(o=>o.on=(o===sel)); layoutChanged(); log('Only "'+sel.name+'" is on','dim'); };
$('allOnBtn').onclick=()=>{ objs.forEach(o=>o.on=true); layoutChanged(); };
$('pathOuter').onclick=()=>{ if(!sel||sel.type!=='vec') return; const ins=containedIdx(sel); sel.psel=new Set(sel.polys.map((_,i)=>i).filter(i=>!ins.has(i)&&isClosed(sel.polys[i]))); if(!sel.psel.size) log('No closed outer contour found','warn'); syncProps(); dirty=true; };
$('pathInner').onclick=()=>{ if(!sel||sel.type!=='vec') return; sel.psel=containedIdx(sel); syncProps(); dirty=true; };
$('pathAll').onclick=()=>{ if(sel&&sel.type==='vec'){ sel.psel=new Set(sel.polys.map((_,i)=>i)); syncProps(); dirty=true; } };
$('pathNone').onclick=()=>{ if(sel&&sel.type==='vec'){ sel.psel=new Set(); syncProps(); dirty=true; } };
$('cropBtn').onclick=()=>{ if(sel&&sel.type==='img'){ cropMode=!cropMode; syncProps(); dirty=true; } };
$('uncropBtn').onclick=()=>{
  if(!sel||sel.type!=='img') return; const o=sel;
  const dx=(o.iw/2-(o.cx+o.cw/2))*o.sx, dy=-(o.ih/2-(o.cy+o.ch/2))*o.sy;
  [o.x,o.y]=toWorld(o,dx,dy); o.cx=0; o.cy=0; o.cw=o.iw; o.ch=o.ih; layoutChanged();
};
$('dupBtn').onclick=()=>{ if(!sel) return; const c={...sel, x:sel.x+oW(sel)+0.125*MM}; if(sel.type==='vec'){ c.pathOp=sel.pathOp.slice(); c.psel=new Set(); c.set=JSON.parse(JSON.stringify(sel.set)); } if(sel.r) c.r={...sel.r}; objs.push(c); sel=c; cropMode=false; layoutChanged(); };
$('toZeroBtn').onclick=()=>{ if(!sel) return; const b=layoutBounds([sel]); sel.x-=b.x0; sel.y-=b.y0; layoutChanged(); };
$('delBtn').onclick=deleteSel;

