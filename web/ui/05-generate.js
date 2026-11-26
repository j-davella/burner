// ----- drawing on the map -----
const OPCOL={cut:'#ff3b4e',score:'#3ce0ff',fill:'#2ee59d',off:'rgba(140,150,165,0.35)'};
function drawObjs(g){
  const s=vw.sc, ox=st.wco[0], oy=st.wco[1];
  for(const o of objs){
    const W=oW(o), H=oH(o), isSel=o===sel;
    g.save(); g.translate(px(o.x+ox), py(o.y+oy)); g.rotate(-rad(o.rot)); if(!o.on) g.globalAlpha=0.28;
    if(o.type==='img'){
      if(isSel && cropMode){ g.globalAlpha=0.25; g.drawImage(o.img,0,0,o.iw,o.ih,(-W/2-o.cx*o.sx)*s,(-H/2-o.cy*o.sy)*s,o.iw*o.sx*s,o.ih*o.sy*s); }
      g.globalAlpha=o.on?0.9:0.25; g.drawImage(o.img,o.cx,o.cy,o.cw,o.ch,-W/2*s,-H/2*s,W*s,H*s); g.globalAlpha=o.on?1:0.28;
    } else {
      const trace=p=>{ for(let i=0;i<p.length;i+=2){ const X=(p[i]-o.cw/2)*o.sx*s, Y=-(p[i+1]-o.ch/2)*o.sy*s; i?g.lineTo(X,Y):g.moveTo(X,Y); } };
      g.beginPath(); let anyFill=false;
      o.polys.forEach((p,pi)=>{ if(o.pathOp[pi]==='fill'){ trace(p); g.closePath(); anyFill=true; } });
      if(anyFill){ g.fillStyle='rgba(46,229,157,0.22)'; g.fill('evenodd'); }
      for(const op of ['off','fill','score','cut']){
        g.strokeStyle=OPCOL[op]; g.lineWidth=op==='cut'?1.8:1.3; g.beginPath(); let any=false;
        o.polys.forEach((p,pi)=>{ if(o.pathOp[pi]===op){ trace(p); any=true; } });
        if(any) g.stroke();
      }
      if(isSel && o.psel.size){
        g.save(); g.shadowColor='#fff'; g.shadowBlur=8; g.strokeStyle='#ffffff'; g.lineWidth=3; g.setLineDash([6,4]); g.beginPath();
        for(const pi of o.psel) trace(o.polys[pi]);
        g.stroke(); g.restore();
      }
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
function generateLayout(){
  const act=objs.filter(o=>o.on);
  if(!act.length){ log(objs.length?'Every object is turned off. Check one in the Objects list.':'Nothing on the layout','warn'); return false; }
  const imgs=act.filter(o=>o.type==='img'), vecs=act.filter(o=>o.type==='vec');
  const lines=['G21','G90'];
  let pitch=0;
  $('thumb').style.display='none';
  for(const o of imgs){
    const r=o.r||readRaster(), lpi=+r.rLpi; if(!(lpi>0)){ log('Bad LPI on '+o.name,'bad'); return false; }
    const p=MM/lpi, B=layoutBounds([o]);
    const cols=Math.max(1,Math.ceil((B.x1-B.x0)/p)), rows=Math.max(1,Math.ceil((B.y1-B.y0)/p));
    if(cols*rows>8e6){ log(o.name+' is '+(cols*rows/1e6).toFixed(1)+'M pixels. Lower LPI or shrink it.','bad'); return false; }
    const c=document.createElement('canvas'); c.width=cols; c.height=rows;
    const g=c.getContext('2d',{willReadFrequently:true});
    g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high';
    g.fillStyle='#fff'; g.fillRect(0,0,cols,rows);
    g.save(); g.translate((o.x-B.x0)/p,(B.y1-o.y)/p); g.rotate(-rad(o.rot));
    const w=oW(o)/p, h=oH(o)/p; g.drawImage(o.img,o.cx,o.cy,o.cw,o.ch,-w/2,-h/2,w,h); g.restore();
    const px_=g.getImageData(0,0,cols,rows).data, dark=new Float32Array(cols*rows), inv=!!r.rInvert;
    for(let i=0;i<dark.length;i++){ const lum=(0.299*px_[i*4]+0.587*px_[i*4+1]+0.114*px_[i*4+2])/255; dark[i]=inv?lum:1-lum; }
    if(r.rDither) Core.dither(dark,cols,rows);
    if(o===sel || imgs.length===1){
      const t=g.createImageData(cols,rows);
      for(let i=0;i<dark.length;i++){ const v=255-Math.round(Math.max(0,Math.min(1,dark[i]))*255); t.data[i*4]=t.data[i*4+1]=t.data[i*4+2]=v; t.data[i*4+3]=255; }
      g.putImageData(t,0,0); $('thumb').src=c.toDataURL(); $('thumb').style.display='block';
    }
    const SM=smax();
    lines.push('; raster '+o.name);
    const rg=Core.rasterGcode(dark,cols,rows,{
      pitch:p, feed:(+r.rFeedS||50)*60, smin:SM*(+r.rPmin||0)/100, smax:SM*(+r.rPmax||0)/100,
      over:(+r.rOver||0)*MM, thresh:(+r.rThresh||0)/100, bidir:!!r.rBidir, ox:B.x0, oy:B.y1-rows*p });
    for(let i=0;i<rg.length;i++) lines.push(rg[i]);
    pitch=Math.max(pitch,p);
  }
  Eng.vectorGcode(vecs, smax(), lines);
  lines.push('M5 S0','G0 X0 Y0');
  setJob(lines, act.length===1?act[0].name:act.map(o=>o.name).join(' + '), pitch, true);
  return true;
}
$('genBtn').onclick = ()=>{ if(generateLayout()){ const ov=+$('rOver').value||0; if(ov>0 && objs.some(o=>o.on&&o.type==='img')) log('Overscan runs '+ov+' in past the raster edges. Leave room or you will hit a soft limit.','dim'); } };
$('saveGcBtn').onclick = ()=>{
  if(!job.lines.length) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([job.lines.join('\n')+'\n'],{type:'text/plain'}));
  a.download = (job.name.replace(/[^\w.-]+/g,'_')||'job')+'.nc'; a.click();
};
