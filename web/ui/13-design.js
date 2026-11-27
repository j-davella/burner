// ---------- design tools: undo/redo, shapes, text, snapping, align, arrays, nesting ----------
// Shapes and text are ordinary vector objects (type 'vec') that remember how they were
// made (o.shape / o.text), so the Object tab can edit them and rebuild the geometry.
const Design = (()=>{
  // ===== undo / redo =====
  // Snapshot the whole layout after each change settles (drags count once, on release).
  const ids=new WeakMap(); let idN=0; const idOf=x=>{ if(!x) return 0; if(!ids.has(x)) ids.set(x, ++idN); return ids.get(x); };
  const cloneObj=o=>({ ...o, pathOp:o.pathOp&&o.pathOp.slice(), psel:new Set(), set:o.set&&JSON.parse(JSON.stringify(o.set)),
    r:o.r&&{...o.r}, text:o.text&&{...o.text}, shape:o.shape&&{...o.shape} });
  const keyOf=()=>JSON.stringify(objs.map(o=>[idOf(o.polys)||idOf(o.img),o.name,o.x,o.y,o.rot,o.sx,o.sy,o.cx,o.cy,o.cw,o.ch,o.on,o.pathOp&&o.pathOp.join(','),o.set,o.r,o.text,o.shape]));
  const snap=()=>({ objs:objs.map(cloneObj), sel:objs.indexOf(sel), key:keyOf() });
  let cur=snap(), undo=[], redo=[], t=0, restoring=false;
  function commit(){
    clearTimeout(t); t=0;
    if(typeof drag!=='undefined' && drag && drag.kind!=='pan'){ t=setTimeout(commit, 150); return; }
    const k=keyOf(); if(k===cur.key) return;
    undo.push(cur); if(undo.length>200) undo.shift();
    cur=snap(); redo=[]; btns();
  }
  const _lc=layoutChanged;
  layoutChanged=function(){ _lc(); if(!restoring){ clearTimeout(t); t=setTimeout(commit, 250); } };
  function restore(s){
    restoring=true;
    try{
      objs.length=0; for(const o of s.objs) objs.push(cloneObj(o));
      sel=objs[s.sel]||null; cropMode=false; layoutChanged(); syncProps();
    } finally { restoring=false; }
    cur={ ...s, key:keyOf() }; btns();
  }
  function doUndo(){ if(job.running) return; if(t) commit(); if(!undo.length) return; redo.push(cur); restore(undo.pop()); }
  function doRedo(){ if(job.running) return; if(t) commit(); if(!redo.length) return; undo.push(cur); restore(redo.pop()); }
  // explicit actions start their own undo step (typing / nudging / dragging coalesce)
  function flush(){ if(t) commit(); }
  function btns(){ $('undoBtn').disabled=!undo.length; $('redoBtn').disabled=!redo.length; }
  $('undoBtn').onclick=doUndo; $('redoBtn').onclick=doRedo;

  // ===== create =====
  const IN=MM;
  function place(o){ // new objects go in the middle of what you're looking at, on the bed
    flush(); o.on=true; o.rot=0; objs.push(o);
    const c=toMach(W/2,H/2), b=bedRect();
    const mx=Math.max(b.x0+oW(o)/2, Math.min(b.x0+b.w-oW(o)/2, c[0])), my=Math.max(b.y0+oH(o)/2, Math.min(b.y0+b.h-oH(o)/2, c[1]));
    o.x=mx-st.wco[0]; o.y=my-st.wco[1];
    sel=o; cropMode=false; layoutChanged(); syncProps();
    if(typeof UI!=='undefined') UI.showTab('object');
  }
  function vecObj(name, polys, op){
    const v=Eng.normalizeVec(polys.map(p=>p.slice()));
    return { type:'vec', name, polys:v.polys, cx:0, cy:0, cw:v.w, ch:v.h, sx:1, sy:1, pathOp:v.polys.map(()=>op), psel:new Set(), set:defaultOps() };
  }
  const SHAPES={ rect:{kind:'rect',w:2*IN,h:1*IN,r:0}, rounded:{kind:'rect',w:2*IN,h:1*IN,r:0.2*IN}, ellipse:{kind:'ellipse',w:1.5*IN,h:1.5*IN},
    polygon:{kind:'polygon',w:1.5*IN,h:1.5*IN,n:6}, star:{kind:'star',w:1.5*IN,h:1.5*IN,n:5,inner:0.45} };
  const NAMES={rect:'Rectangle',ellipse:'Circle',polygon:'Polygon',star:'Star'};
  function addShape(k){
    if(job.running) return;
    const sh={...SHAPES[k]}, o=vecObj(NAMES[sh.kind], Eng.makeShape(sh), 'cut');
    o.shape=sh; place(o);
  }
  function rebuildShape(o){
    const v=Eng.normalizeVec(Eng.makeShape(o.shape));
    o.polys=v.polys; o.cw=v.w; o.ch=v.h; o.sx=1; o.sy=1;
    const op=o.pathOp[0]||'cut'; o.pathOp=v.polys.map(()=>op); o.psel=new Set();
  }

  // ----- text -----
  const SINGLE='Single-line (scoring)';
  const CANDIDATES=['Arial','Arial Black','Helvetica','Verdana','Tahoma','Trebuchet MS','Segoe UI','Bahnschrift','Calibri','Cambria','Candara','Consolas','Constantia','Corbel',
    'Georgia','Times New Roman','Palatino Linotype','Book Antiqua','Garamond','Courier New','Lucida Console','Impact','Comic Sans MS','Franklin Gothic Medium','Segoe Script','Ink Free','Gabriola',
    'DejaVu Sans','DejaVu Serif','DejaVu Sans Mono','Liberation Sans','Liberation Serif','Liberation Mono','Noto Sans','Noto Serif','Noto Sans Mono','Ubuntu','Cantarell','Inter','Roboto',
    'Open Sans','Source Sans Pro','Source Serif Pro','Fira Sans','Lato','Montserrat','Oswald','Cousine','Arimo','Tinos'];
  const loaded=[];
  function installed(f){
    const c=document.createElement('canvas').getContext('2d'), s='mmmmmmmmmmlliWW@#0';
    return ['monospace','serif','sans-serif'].some(base=>{ c.font='72px '+base; const w0=c.measureText(s).width; c.font='72px "'+f+'", '+base; return c.measureText(s).width!==w0; });
  }
  let fontList=null;
  function fonts(){ if(!fontList) fontList=CANDIDATES.filter(installed); return [SINGLE, ...loaded, ...fontList, 'sans-serif','serif','monospace','cursive']; }
  function fillFonts(cur){
    const s=$('txFont'); s.innerHTML='';
    for(const f of fonts()){ const o=document.createElement('option'); o.value=f; o.textContent=f; if(f!==SINGLE && !/^(sans-serif|serif|monospace|cursive)$/.test(f)) o.style.fontFamily='"'+f+'"'; s.appendChild(o); }
    if(cur && ![...s.options].some(o=>o.value===cur)){ const o=document.createElement('option'); o.value=cur; o.textContent=cur+' (not available)'; s.appendChild(o); }
    s.value=cur||SINGLE;
  }
  // outline text: draw with the browser's text engine, trace the coverage into contours
  async function outlineText(tx){
    const fam=/^(sans-serif|serif|monospace|cursive)$/.test(tx.font) ? tx.font : '"'+tx.font+'"';
    const style=(tx.italic?'italic ':'')+(tx.bold?'bold ':'');
    let k=Math.max(4, Math.min(24, 360/tx.size));                // px per mm
    const lines=tx.str.split('\n');
    const probe=document.createElement('canvas').getContext('2d');
    try{ await document.fonts.load(style+'40px '+fam, tx.str); }catch{}
    const measure=()=>{ probe.font=style+(tx.size*k)+'px '+fam; if('letterSpacing' in probe) probe.letterSpacing=(tx.space*tx.size*k*0.1)+'px'; return lines.map(l=>probe.measureText(l).width); };
    let ws=measure(), Wd=Math.max(1,...ws), fs=tx.size*k;
    while((Wd+fs)*(lines.length*1.3*fs+fs)>3e7 && k>2){ k*=0.7; ws=measure(); Wd=Math.max(1,...ws); fs=tx.size*k; }
    const pad=Math.ceil(fs*0.4), cw=Math.ceil(Wd+2*pad), ch=Math.ceil(lines.length*1.25*fs+2*pad);
    const c=document.createElement('canvas'); c.width=cw; c.height=ch;
    const g=c.getContext('2d',{willReadFrequently:true});
    g.font=probe.font; if('letterSpacing' in g) g.letterSpacing=probe.letterSpacing;
    g.fillStyle='#000'; g.textBaseline='alphabetic';
    lines.forEach((l,i)=>{ const x=pad+(tx.align==='center'?(Wd-ws[i])/2:tx.align==='right'?Wd-ws[i]:0); g.fillText(l, x, pad+fs*0.95+i*1.25*fs); });
    const d=g.getImageData(0,0,cw,ch).data, a=new Float32Array(cw*ch);
    for(let i=0;i<a.length;i++) a[i]=d[i*4+3]/255;
    const loops=Eng.traceContours(a, cw, ch).map(p=>{ const q=new Array(p.length); for(let i=0;i<p.length;i++) q[i]=p[i]/k; return Eng.simplify(q, 0.35/k); }).filter(p=>p.length>=8);
    if(!loops.length) throw new Error('nothing to draw (empty text, or the font has no such letters)');
    return loops;
  }
  async function textPolys(tx){
    if(tx.font===SINGLE) return { polys:Eng.strokeText(tx.str, tx.size, tx.align, 1+tx.space), op:'score' };
    return { polys:await outlineText(tx), op:'fill' };
  }
  let txBusy=0;
  async function addText(single){
    if(job.running) return;
    const tx={ str:single?'Burner':'Burner', font:single?SINGLE:(fonts().find(f=>f!==SINGLE&&!loaded.includes(f))||'sans-serif'), size:(single?0.5:0.75)*IN, align:'left', bold:false, italic:false, space:0 };
    try{
      const r=await textPolys(tx), o=vecObj('Text', r.polys, r.op); o.text=tx; o.name='Text: '+tx.str; place(o);
      setTimeout(()=>{ $('txStr').focus(); $('txStr').select(); }, 50);
    }catch(e){ log('Text failed: '+e.message,'bad'); }
  }
  async function rebuildText(o){
    const my=++txBusy, tx=o.text;
    try{
      const r=await textPolys(tx); if(my!==txBusy) return;
      const v=Eng.normalizeVec(r.polys);
      const prevOp=o.pathOp[0]||r.op, single=tx.font===SINGLE, op=single ? (prevOp==='fill'?'score':prevOp) : prevOp;
      o.polys=v.polys; o.cw=v.w; o.ch=v.h; o.pathOp=v.polys.map(()=>op); o.psel=new Set(); o._pc=null;
      o.name='Text: '+tx.str.split('\n')[0].slice(0,24);
      layoutChanged(); syncProps();
    }catch(e){ log('Text failed: '+e.message,'bad'); }
  }

  document.querySelectorAll('[data-mk]').forEach(b=>b.onclick=()=>{ const k=b.dataset.mk; if(k==='text') addText(false); else if(k==='stext') addText(true); else addShape(k); });

  // ----- Object tab editors -----
  const _sync=syncProps;
  syncProps=function(){
    _sync();
    const o=sel, sh=o&&o.shape, tx=o&&o.text;
    $('shapeProps').style.display=sh?'':'none';
    $('textProps').style.display=tx?'':'none';
    const set=(id,v)=>{ const el=$(id); if(document.activeElement!==el) el.value=v; };
    if(sh){
      set('shW',(oW(o)/IN).toFixed(3)); set('shH',(oH(o)/IN).toFixed(3));
      set('shR',((sh.r||0)/IN).toFixed(3)); set('shN',sh.n||''); set('shI',Math.round((sh.inner||0.45)*100));
      document.querySelectorAll('.sh-r').forEach(e=>e.style.display=sh.kind==='rect'?'':'none');
      document.querySelectorAll('.sh-n').forEach(e=>e.style.display=(sh.kind==='polygon'||sh.kind==='star')?'':'none');
      document.querySelectorAll('.sh-i').forEach(e=>e.style.display=sh.kind==='star'?'':'none');
    }
    if(tx){
      if(document.activeElement!==$('txStr')) $('txStr').value=tx.str;
      if($('txFont').value!==tx.font || !$('txFont').options.length) fillFonts(tx.font);
      set('txSize',(tx.size/IN).toFixed(3)); $('txAlign').value=tx.align; set('txSpace',tx.space);
      $('txBold').checked=!!tx.bold; $('txItal').checked=!!tx.italic;
      $('txBold').disabled=$('txItal').disabled=tx.font===SINGLE;
    }
  };
  const shapeIn=(id,fn)=>$(id).addEventListener('change',()=>{ const o=sel; if(!o||!o.shape) return; flush(); const v=parseFloat($(id).value); if(!isFinite(v)) return;
    o.shape.w=oW(o); o.shape.h=oH(o); fn(o.shape,v); rebuildShape(o); layoutChanged(); syncProps(); });
  shapeIn('shW',(s,v)=>{ if(v>0) s.w=v*IN; }); shapeIn('shH',(s,v)=>{ if(v>0) s.h=v*IN; });
  shapeIn('shR',(s,v)=>{ s.r=Math.max(0,v*IN); }); shapeIn('shN',(s,v)=>{ s.n=Math.max(3,Math.min(200,Math.round(v))); });
  shapeIn('shI',(s,v)=>{ s.inner=Math.max(0.05,Math.min(0.95,v/100)); });
  const textIn=(id,ev,fn)=>$(id).addEventListener(ev,()=>{ const o=sel; if(!o||!o.text) return; fn(o.text); rebuildText(o); });
  let txT=0;
  $('txStr').addEventListener('input',()=>{ const o=sel; if(!o||!o.text) return; const v=$('txStr').value; if(!v.trim()) return; o.text.str=v; clearTimeout(txT); txT=setTimeout(()=>rebuildText(o), 250); });
  textIn('txFont','change',t=>{ t.font=$('txFont').value; });
  textIn('txSize','change',t=>{ const v=parseFloat($('txSize').value); if(v>0) t.size=v*IN; });
  textIn('txAlign','change',t=>{ t.align=$('txAlign').value; });
  textIn('txSpace','change',t=>{ t.space=parseFloat($('txSpace').value)||0; });
  textIn('txBold','change',t=>{ t.bold=$('txBold').checked; });
  textIn('txItal','change',t=>{ t.italic=$('txItal').checked; });
  $('txLoad').onclick=()=>$('txFile').click();
  $('txFile').onchange=async e=>{
    const f=e.target.files[0]; e.target.value=''; if(!f) return;
    const name=f.name.replace(/\.(ttf|otf|woff2?)$/i,'');
    try{
      const face=new FontFace(name, await f.arrayBuffer()); await face.load(); document.fonts.add(face);
      if(!loaded.includes(name)) loaded.unshift(name);
      log('Font loaded: '+name+' (for this session)','acc');
      if(sel && sel.text){ sel.text.font=name; fillFonts(name); rebuildText(sel); } else fillFonts(name);
    }catch(err){ log('Could not read font '+f.name+': '+err.message,'bad'); }
  };

  // ===== snapping =====
  let snapOn=true; try{ snapOn=localStorage.getItem('burner.ui.snap')!=='false'; }catch{}
  let guides=[];
  function setSnap(v){ snapOn=v; $('snapBtn').classList.toggle('on',v); try{ localStorage.setItem('burner.ui.snap', v); }catch{} }
  $('snapBtn').onclick=()=>setSnap(!snapOn); setSnap(snapOn);
  // o just moved: pull its edges/center onto nearby object edges/centers, the bed, then the grid
  function snapMove(o, free){
    guides=[];
    if(!snapOn || free) return;
    const tol=8/vw.sc, b=layoutBounds([o]), mine={ x:[b.x0,(b.x0+b.x1)/2,b.x1], y:[b.y0,(b.y0+b.y1)/2,b.y1] };
    const bed=bedRect(), wx=st.wco[0], wy=st.wco[1];
    const tg={ x:[bed.x0-wx, bed.x0+bed.w/2-wx, bed.x0+bed.w-wx, 0], y:[bed.y0-wy, bed.y0+bed.h/2-wy, bed.y0+bed.h-wy, 0] };
    for(const q of objs){ if(q===o) continue; const c=layoutBounds([q]); tg.x.push(c.x0,(c.x0+c.x1)/2,c.x1); tg.y.push(c.y0,(c.y0+c.y1)/2,c.y1); }
    const grid=MM/8;
    for(const ax of ['x','y']){
      let best=null;
      for(const m of mine[ax]) for(const t of tg[ax]){ const d=t-m; if(Math.abs(d)<=tol && (!best||Math.abs(d)<Math.abs(best.d))) best={d,at:t}; }
      if(!best){ const m=mine[ax][0], t=Math.round(m/grid)*grid, d=t-m; if(Math.abs(d)<=tol*0.6) best={d,at:t,grid:true}; }
      if(best){ o[ax]+=best.d; if(!best.grid) guides.push({ax,at:best.at}); }
    }
  }
  window.addEventListener('mouseup',()=>{ if(guides.length){ guides=[]; dirty=true; } });
  function drawGuides(g){
    if(!guides.length) return;
    g.save(); g.strokeStyle='#ff4fd8'; g.lineWidth=1; g.setLineDash([5,4]);
    for(const gd of guides){ g.beginPath(); if(gd.ax==='x'){ const x=px(gd.at+st.wco[0])+.5; g.moveTo(x,0); g.lineTo(x,H); } else { const y=py(gd.at+st.wco[1])+.5; g.moveTo(0,y); g.lineTo(W,y); } g.stroke(); }
    g.restore();
  }

  // ===== align / distribute / nest (checked objects) / align to bed (selected) =====
  const checked=()=>objs.filter(o=>o.on);
  const moveBy=(o,dx,dy)=>{ o.x+=dx; o.y+=dy; };
  document.querySelectorAll('[data-al]').forEach(b=>b.onclick=()=>{
    if(job.running) return; const L=checked(); flush(); if(L.length<2){ log('Check at least two objects in the list to align them','warn'); return; }
    const U=layoutBounds(L), k=b.dataset.al;
    for(const o of L){ const c=layoutBounds([o]);
      if(k==='l') moveBy(o,U.x0-c.x0,0); else if(k==='r') moveBy(o,U.x1-c.x1,0); else if(k==='cx') moveBy(o,(U.x0+U.x1-c.x0-c.x1)/2,0);
      else if(k==='b') moveBy(o,0,U.y0-c.y0); else if(k==='t') moveBy(o,0,U.y1-c.y1); else if(k==='cy') moveBy(o,0,(U.y0+U.y1-c.y0-c.y1)/2); }
    layoutChanged();
  });
  document.querySelectorAll('[data-dist]').forEach(b=>b.onclick=()=>{
    if(job.running) return; const L=checked(); flush(); if(L.length<3){ log('Check at least three objects to space them evenly','warn'); return; }
    const ax=b.dataset.dist, lo=ax==='x'?'x0':'y0', hi=ax==='x'?'x1':'y1';
    const items=L.map(o=>({o,b:layoutBounds([o])})).sort((p,q)=>p.b[lo]-q.b[lo]);
    const span=items[items.length-1].b[hi]-items[0].b[lo], used=items.reduce((s,i)=>s+i.b[hi]-i.b[lo],0), gap=(span-used)/(items.length-1);
    let at=items[0].b[lo];
    for(const it of items){ const d=at-it.b[lo]; ax==='x'?moveBy(it.o,d,0):moveBy(it.o,0,d); at+=it.b[hi]-it.b[lo]+gap; }
    layoutChanged();
  });
  $('nestBtn').onclick=()=>{
    if(job.running) return; const L=checked(); flush(); if(!L.length){ log('Nothing checked to nest','warn'); return; }
    const bed=bedRect(), gap=Math.max(0,(+$('nestGap').value||0)*IN);
    const boxes=L.map(o=>{ const b=layoutBounds([o]); return {w:b.x1-b.x0,h:b.y1-b.y0}; });
    const P=Eng.nestBoxes(boxes, bed.w-2*gap, bed.h-2*gap, gap);
    let miss=0;
    L.forEach((o,i)=>{
      const p=P[i]; if(!p){ miss++; return; }
      if(p.turn) o.rot=((o.rot+90+540)%360)-180;
      const b=layoutBounds([o]);
      moveBy(o, bed.x0-st.wco[0]+gap+p.x-b.x0, bed.y0-st.wco[1]+gap+p.y-b.y0);
    });
    layoutChanged();
    log('Nested '+(L.length-miss)+' of '+L.length+' on the bed'+(miss?' ('+miss+' did not fit)':''), miss?'warn':'dim');
  };
  document.querySelectorAll('[data-bed]').forEach(b=>b.onclick=()=>{
    if(!sel||job.running) return; flush(); const bed=bedRect(), c=layoutBounds([sel]), wx=st.wco[0], wy=st.wco[1], k=b.dataset.bed;
    if(k==='l') moveBy(sel,bed.x0-wx-c.x0,0); else if(k==='r') moveBy(sel,bed.x0+bed.w-wx-c.x1,0); else if(k==='cx') moveBy(sel,bed.x0+bed.w/2-wx-(c.x0+c.x1)/2,0);
    else if(k==='b') moveBy(sel,0,bed.y0-wy-c.y0); else if(k==='t') moveBy(sel,0,bed.y0+bed.h-wy-c.y1); else if(k==='cy') moveBy(sel,0,bed.y0+bed.h/2-wy-(c.y0+c.y1)/2);
    layoutChanged(); syncProps();
  });

  // ===== arrays =====
  function copyOf(o){ const c=cloneObj(o); c._pc=o._pc; return c; }
  $('arGrid').onclick=()=>{
    if(!sel||job.running) return; flush();
    const nc=Math.max(1,Math.min(50,+$('arCols').value|0)), nr=Math.max(1,Math.min(50,+$('arRows').value|0)), gap=Math.max(0,(+$('arGap').value||0)*IN);
    if(nc*nr<2) return;
    const b=layoutBounds([sel]), offs=Eng.gridOffsets(nc,nr,b.x1-b.x0+gap,b.y1-b.y0+gap);
    const base=sel; for(const [dx,dy] of offs.slice(1)){ const c=copyOf(base); c.x+=dx; c.y+=dy; objs.push(c); }
    layoutChanged(); log('Grid array: '+nc+' x '+nr+' of '+base.name,'dim');
  };
  $('arCirc').onclick=()=>{
    if(!sel||job.running) return; flush();
    const n=Math.max(2,Math.min(360,+$('arN').value|0)), r=Math.max(0.05,+$('arRad').value||1)*IN;
    const base=sel, offs=Eng.circleOffsets(n, base.x, base.y, base.x, base.y-r, $('arRot').checked);
    for(const [dx,dy,dr] of offs.slice(1)){ const c=copyOf(base); c.x+=dx; c.y+=dy; c.rot=((c.rot+dr+540)%360)-180; objs.push(c); }
    layoutChanged(); log('Circular array: '+n+' of '+base.name+' around a center '+(r/IN).toFixed(3)+' in below it','dim');
  };

  // ===== keys =====
  document.addEventListener('keydown', e=>{
    const inField=/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if(document.querySelector('#labModal.open,#settingsModal.open')) return;
    if((e.ctrlKey||e.metaKey) && !e.altKey){
      const k=e.key.toLowerCase();
      if(inField && k!=='y' && !(k==='z')) return;
      if(inField) return;                                   // let fields keep their own undo
      if(k==='z' && !e.shiftKey){ doUndo(); e.preventDefault(); }
      else if((k==='z' && e.shiftKey) || k==='y'){ doRedo(); e.preventDefault(); }
      else if(k==='d' && sel && !job.running){ $('dupBtn').click(); e.preventDefault(); }
      return;
    }
    if(inField || e.altKey) return;
    if(e.key==='g'||e.key==='G'){ setSnap(!snapOn); e.preventDefault(); }
    else if(e.key==='r'||e.key==='R'){ addShape('rect'); e.preventDefault(); }
    else if(e.key==='x'||e.key==='X'){ addText(false); e.preventDefault(); }
  });

  btns();
  return { snapMove, drawGuides, undo:doUndo, redo:doRedo, addShape, addText, get stacks(){ return {undo:undo.length, redo:redo.length}; }, commit };
})();
