// ----- drawing on the map -----
const OPCOL={cut:'#ff3b4e',score:'#3ce0ff',fill:'#2ee59d',off:'rgba(140,150,165,0.35)'};
function tracePoly(P,o,p){ for(let i=0;i<p.length;i+=2){ const X=(p[i]-o.cw/2)*o.sx, Y=-(p[i+1]-o.ch/2)*o.sy; i?P.lineTo(X,Y):P.moveTo(X,Y); } }
// One Path2D per operation (+ the fill area), rebuilt only when geometry, scale or ops change.
function vecPaths(o){
  const key=o.cw+','+o.ch+','+o.sx+','+o.sy+'|'+o.pathOp.join(',');
  if(o._pc && o._pc.key===key && o._pc.polys===o.polys) return o._pc;
  const pc={ key, polys:o.polys, fillArea:new Path2D(), anyFill:false, has:{}, off:new Path2D(), fill:new Path2D(), score:new Path2D(), cut:new Path2D() };
  o.polys.forEach((p,pi)=>{
    const op=o.pathOp[pi]; if(!pc[op]) return;
    if(op==='fill'){ tracePoly(pc.fillArea,o,p); pc.fillArea.closePath(); pc.anyFill=true; }
    tracePoly(pc[op],o,p); pc.has[op]=true;
  });
  return (o._pc=pc);
}
function drawObjs(g){
  const s=vw.sc, ox=st.wco[0], oy=st.wco[1];
  for(const o of objs){
    const W=oW(o), H=oH(o), isSel=o===sel;
    g.save(); g.translate(px(o.x+ox), py(o.y+oy)); g.rotate(-rad(o.rot)); if(!o.on) g.globalAlpha=0.28;
    if(o.type==='img'){
      if(isSel && cropMode){ g.globalAlpha=0.25; g.drawImage(o.img,0,0,o.iw,o.ih,(-W/2-o.cx*o.sx)*s,(-H/2-o.cy*o.sy)*s,o.iw*o.sx*s,o.ih*o.sy*s); }
      g.globalAlpha=o.on?0.9:0.25; g.drawImage(o.img,o.cx,o.cy,o.cw,o.ch,-W/2*s,-H/2*s,W*s,H*s); g.globalAlpha=o.on?1:0.28;
    } else {
      // cached paths in object-local mm; the view scale is applied as a transform, so
      // moving / rotating / zooming never re-traces the geometry
      const pc=vecPaths(o);
      g.save(); g.scale(s,s);
      if(pc.anyFill){ g.fillStyle='rgba(46,229,157,0.22)'; g.fill(pc.fillArea,'evenodd'); }
      for(const op of ['off','fill','score','cut']){
        if(!pc.has[op]) continue;
        g.strokeStyle=OPCOL[op]; g.lineWidth=(op==='cut'?1.8:1.3)/s; g.stroke(pc[op]);
      }
      if(isSel && o.psel.size){
        const hp=new Path2D(); for(const pi of o.psel) tracePoly(hp,o,o.polys[pi]);
        g.save(); g.shadowColor='#fff'; g.shadowBlur=8; g.strokeStyle='#ffffff'; g.lineWidth=3/s; g.setLineDash([6/s,4/s]);
        g.stroke(hp); g.restore();
      }
      g.restore();
    }
    g.strokeStyle = isSel ? (cropMode?'#f5c542':'#ff8a3d') : 'rgba(255,255,255,0.25)'; g.lineWidth=1; g.setLineDash(isSel?[]:[4,3]);
    g.strokeRect(-W/2*s,-H/2*s,W*s,H*s); g.setLineDash([]);
    if(isSel && !job.running){
      const hd=(x,y,sq)=>{ g.fillStyle='#fff'; g.strokeStyle='#000'; g.beginPath(); sq? g.rect(x-4,y-4,8,8) : g.arc(x,y,5,0,Math.PI*2); g.fill(); g.stroke(); };
      if(cropMode){ [[W/2,0],[-W/2,0],[0,H/2],[0,-H/2]].forEach(([a,b])=>{ g.fillStyle='#f5c542'; g.fillRect(a*s-(b?8:3),-b*s-(b?3:8),b?16:6,b?6:16); }); }
      else {
        [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([a,b])=>hd(a*W/2*s,-b*H/2*s,true));
        g.strokeStyle='#ff8a3d'; g.beginPath(); g.moveTo(0,-H/2*s); g.lineTo(0,-H/2*s-24); g.stroke(); hd(0,-H/2*s-24,false);
      }
    }
    g.restore();
  }
}

// ----- generate the whole layout -----
// Resolves true when the job is set. The main thread only draws each image into a canvas
// at burn resolution (fast, GPU); darkness, dithering, raster + vector G-code, the time
// estimate and the preview are built in the worker (engine/jobs.js genJob).
let genRunning=null, layoutVer=0;
function generateLayout(){
  if(genRunning) return genRunning;
  const t0=performance.now();
  const act=objs.filter(o=>o.on);
  if(!act.length){ log(objs.length?'Every object is turned off. Check one in the Objects list.':'Nothing on the layout','warn'); return Promise.resolve(false); }
  const imgs=act.filter(o=>o.type==='img'), vecs=act.filter(o=>o.type==='vec');
  let pitch=0;
  const req={ imgs:[], vecs:[], SM:smax(), settings:{...settings}, smax:smax() };
  $('thumb').style.display='none';
  for(const o of imgs){
    const r=o.r||readRaster(), lpi=+r.rLpi; if(!(lpi>0)){ log('Bad LPI on '+o.name,'bad'); return Promise.resolve(false); }
    const p=MM/lpi, B=layoutBounds([o]);
    const cols=Math.max(1,Math.ceil((B.x1-B.x0)/p)), rows=Math.max(1,Math.ceil((B.y1-B.y0)/p));
    if(cols*rows>8e6){ log(o.name+' is '+(cols*rows/1e6).toFixed(1)+'M pixels. Lower LPI or shrink it.','bad'); return Promise.resolve(false); }
    const c=document.createElement('canvas'); c.width=cols; c.height=rows;
    const g=c.getContext('2d',{willReadFrequently:true});
    g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high';
    g.fillStyle='#fff'; g.fillRect(0,0,cols,rows);
    g.save(); g.translate((o.x-B.x0)/p,(B.y1-o.y)/p); g.rotate(-rad(o.rot));
    const w=oW(o)/p, h=oH(o)/p; g.drawImage(o.img,o.cx,o.cy,o.cw,o.ch,-w/2,-h/2,w,h); g.restore();
    const SM=smax();
    req.imgs.push({ name:o.name, px:g.getImageData(0,0,cols,rows).data, cols, rows, inv:!!r.rInvert, dither:!!r.rDither,
      thumb:(o===sel || imgs.length===1),
      opts:{ pitch:p, feed:(+r.rFeedS||50)*60, smin:SM*(+r.rPmin||0)/100, smax:SM*(+r.rPmax||0)/100,
             over:(+r.rOver||0)*MM, thresh:(+r.rThresh||0)/100, bidir:!!r.rBidir, ox:B.x0, oy:B.y1-rows*p } });
    pitch=Math.max(pitch,p);
  }
  for(const o of vecs) req.vecs.push({ name:o.name, polys:o.polys, cw:o.cw, ch:o.ch, sx:o.sx, sy:o.sy, rot:o.rot, x:o.x, y:o.y, pathOp:o.pathOp, set:o.set });
  const name=act.length===1?act[0].name:act.map(o=>o.name).join(' + ');
  const ver=layoutVer;
  let mainMs=0; const pre=performance.now()-t0;
  Busy.show('Generating '+name);
  let worst=0;                                              // longest single main-thread block
  const onMain=ms=>{ mainMs+=ms; worst=Math.max(worst,ms); };
  onMain(pre);
  genRunning=Jobs.run('gen', req, (f,stage)=>Busy.set(f,stage)).then(async res=>{
    Busy.set(1,'Loading '+res.count.toLocaleString()+' lines');
    const lines=await splitLines(res.text, onMain);
    const t1=performance.now();
    if(job.running){ log('Job started while generating; result dropped.','warn'); return false; }
    if(res.thumb){
      const c=document.createElement('canvas'); c.width=res.thumb.cols; c.height=res.thumb.rows;
      c.getContext('2d').putImageData(new ImageData(res.thumb.rgba, res.thumb.cols, res.thumb.rows),0,0);
      $('thumb').src=c.toDataURL(); $('thumb').style.display='block';
    }
    setJob(lines, name, pitch, true, res);
    if(layoutVer!==ver){ layoutStale=true; updateUI(); }      // edited while generating
    onMain(performance.now()-t1);
    window.__lastGen={ mainMs, worstBlockMs:worst, totalMs:performance.now()-t0, lines:res.count };
    return true;
  }, err=>{
    log(err.cancelled ? 'Generate cancelled' : 'Generate failed: '+err.message, err.cancelled?'warn':'bad');
    return false;
  }).finally(()=>{ genRunning=null; Busy.hide(); updateUI(); });
  updateUI();
  return genRunning;
}
$('genBtn').onclick = async ()=>{ if(await generateLayout()){ const ov=+$('rOver').value||0; if(ov>0 && objs.some(o=>o.on&&o.type==='img')) log('Overscan runs '+ov+' in past the raster edges. Leave room or you will hit a soft limit.','dim'); } };
$('saveGcBtn').onclick = ()=>{
  if(!job.lines.length) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([job.lines.join('\n')+'\n'],{type:'text/plain'}));
  a.download = (job.name.replace(/[^\w.-]+/g,'_')||'job')+'.nc'; a.click();
};
