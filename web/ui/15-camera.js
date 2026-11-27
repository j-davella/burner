// ---------- camera: live bed overlay + 4-mark perspective calibration ----------
// Calibration: burn 4 numbered crosshairs at known machine positions, click them in a
// camera snapshot, solve the homography (engine/camera.js). Each frame is then unwarped
// on the GPU into a bed-aligned image (1 px ~ 0.25-0.5 mm) and drawn under the layout.
// The calibration (and chosen camera) is stored in the machine profile. Lens barrel
// distortion is not corrected: keep the camera high and the lens not too wide.
const Camera = (()=>{
  const S={ stream:null, src:null, show:true, opacity:0.6, fresh:false, gl:null, rect:null };
  const video=document.createElement('video'); video.muted=true; video.playsInline=true;
  const cal=()=>Machines.current().cam||null;

  // ----- GPU unwarp -----
  function glInit(){
    const c=document.createElement('canvas'), gl=c.getContext('webgl',{premultipliedAlpha:false, preserveDrawingBuffer:true, alpha:true, antialias:false});
    if(!gl) return null;
    const sh=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr=gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER,'precision highp float;varying vec2 uv;uniform sampler2D t;uniform mat3 H;uniform vec4 bed;uniform vec2 isz;'+
      'void main(){vec2 m=vec2(bed.x+uv.x*bed.z,bed.y+uv.y*bed.w);vec3 q=H*vec3(m,1.);if(q.z<=0.){gl_FragColor=vec4(0.);return;}'+
      'vec2 tc=(q.xy/q.z)/isz;if(tc.x<0.||tc.y<0.||tc.x>1.||tc.y>1.){gl_FragColor=vec4(0.);return;}gl_FragColor=vec4(texture2D(t,tc).rgb,1.);}'));
    gl.linkProgram(pr); if(!gl.getProgramParameter(pr,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(pr,'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    const tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex);
    for(const [k,v] of [[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE],[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D,k,v);
    return { c, gl, u:{ H:gl.getUniformLocation(pr,'H'), bed:gl.getUniformLocation(pr,'bed'), isz:gl.getUniformLocation(pr,'isz') } };
  }
  function unwarp(){
    const k=cal(); if(!k || !S.src) return null;
    if(!S.gl){ try{ S.gl=glInit(); }catch(e){ console.warn(e); S.gl=null; } if(!S.gl){ log('Camera overlay needs WebGL, which is not available here','warn'); S.show=false; return null; } }
    const {c,gl,u}=S.gl, b=bedRect(), res=Math.max(0.25, Math.max(b.w,b.h)/1600);
    const w=Math.max(2,Math.round(b.w/res)), h=Math.max(2,Math.round(b.h/res));
    if(c.width!==w || c.height!==h){ c.width=w; c.height=h; }
    gl.viewport(0,0,w,h);
    try{ gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,S.src); }catch(e){ return null; }
    const H=k.H; gl.uniformMatrix3fv(u.H,false,[H[0],H[3],H[6],H[1],H[4],H[7],H[2],H[5],H[8]]);
    gl.uniform4f(u.bed,b.x0,b.y0,b.w,b.h); gl.uniform2f(u.isz,k.iw,k.ih);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    return c;
  }
  // map hook: draw under the objects
  function draw(g){
    if(!S.show || !S.src || !cal()) return;
    if(S.fresh || !S.rect){ S.rect=unwarp(); S.fresh=false; }
    if(!S.rect) return;
    const b=bedRect();
    g.save(); g.globalAlpha=S.opacity; g.imageSmoothingEnabled=true;
    g.drawImage(S.rect, px(b.x0), py(b.y0+b.h), b.w*vw.sc, b.h*vw.sc);
    g.restore();
  }

  // ----- camera on/off -----
  async function listCams(){
    try{
      const devs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
      const sel=$('camSel'), keep=sel.value||(cal()&&cal().deviceId)||'';
      sel.innerHTML=devs.length? '' : '<option value="">(no camera found)</option>';
      devs.forEach((d,i)=>{ const o=document.createElement('option'); o.value=d.deviceId; o.textContent=d.label||('Camera '+(i+1)); sel.appendChild(o); });
      if([...sel.options].some(o=>o.value===keep)) sel.value=keep;
    }catch{}
  }
  async function start(){
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ log('No camera access here. Open Burner from http://localhost (the bridge) in Chrome or Firefox.','bad'); return; }
    stop(true);
    const id=$('camSel').value;
    try{
      S.stream=await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId:{exact:id}, width:{ideal:1920}, height:{ideal:1080} } : { width:{ideal:1920}, height:{ideal:1080} } });
    }catch(e){ log('Camera failed: '+e.message+(e.name==='NotAllowedError'?' (allow the camera for this page in the browser)':''),'bad'); return; }
    video.srcObject=S.stream; await video.play().catch(()=>{});
    S.src=video; S.rect=null;
    await listCams();
    const tr=S.stream.getVideoTracks()[0], st_=tr.getSettings();
    if(tr.label && $('camSel').value==='') $('camSel').value=st_.deviceId||'';
    const k=cal(); if(k && k.iw && st_.width && Math.abs(st_.width/st_.height - k.iw/k.ih)>0.02) log('Camera shape changed since calibration ('+st_.width+'x'+st_.height+' vs '+k.iw+'x'+k.ih+'). Calibrate again.','warn');
    pump(); info();
    log('Camera on: '+(tr.label||'camera')+' '+(st_.width||'?')+'x'+(st_.height||'?'),'acc');
  }
  function stop(quiet){
    if(S.stream){ for(const t of S.stream.getTracks()) t.stop(); S.stream=null; if(!quiet) log('Camera off','dim'); }
    if(S.src===video) S.src=null;
    S.rect=null; dirty=true; info();
  }
  // new video frame -> redraw (about 10 fps is plenty for an overlay)
  let last=0;
  function pump(){
    if(!S.stream || S.src!==video) return;
    const go=()=>{ if(!S.stream) return; const now=performance.now(); if(now-last>95 && S.show){ last=now; S.fresh=true; dirty=true; } pump(); };
    if(video.requestVideoFrameCallback) video.requestVideoFrameCallback(go); else setTimeout(go, 100);
  }
  // a still image or canvas instead of a camera (tests, or a photo of the bed)
  function useSource(img){ stop(true); S.src=img; S.fresh=true; S.rect=null; dirty=true; info(); }

  function info(){
    const k=cal(), on=!!S.src;
    $('camOn').textContent=S.stream?'Stop':'Start';
    $('camInfo').innerHTML=(S.src===video&&S.stream?'<span class="ok">Live</span>':on?'Still image':'Off')+' · '+(k? 'calibrated '+new Date(k.t).toLocaleDateString()+' ('+k.iw+'x'+k.ih+')' : '<span class="warn">not calibrated</span>');
    $('camCal').disabled=!on; $('camForget').disabled=!k;
  }

  // ----- calibration -----
  $('camBurn').onclick=()=>{
    if(!canCommand()) return;
    if(st.state!=='Idle'){ log('Controller must be Idle to burn marks','warn'); return; }
    if(settings[32]==='0'){ log('Refusing: $32=0 (laser mode off). Send $32=1.','bad'); return; }
    const pts=Eng.markPoints(bedRect()), S_=Math.round(smax()*Math.max(1,Math.min(100,+$('camMarkS').value||20))/100), F=Math.max(1,+$('camMarkF').value||20)*60;
    const m=Machines.current(); m.camMarks=pts; Machines.save();
    queue(...Eng.markGcode(pts, st.wco, S_, F));
    log('Burning 4 calibration marks at '+pts.map(p=>'('+(p[0]/MM).toFixed(2)+', '+(p[1]/MM).toFixed(2)+')').join(' ')+' in (machine). Then press "Click the marks".','acc');
  };
  const shot=$('camShot'), loupe=$('camLoupe'); let pts=[], marks=null, frame=null;
  const NAMES=['1: bottom-left (1 tick)','2: bottom-right (2 ticks)','3: top-right (3 ticks)','4: top-left (4 ticks)'];
  function snapshot(){
    const s=S.src; if(!s) return false;
    const w=s.videoWidth||s.naturalWidth||s.width, h=s.videoHeight||s.naturalHeight||s.height; if(!w||!h) return false;
    shot.width=w; shot.height=h; frame=document.createElement('canvas'); frame.width=w; frame.height=h;
    frame.getContext('2d').drawImage(s,0,0,w,h); return true;
  }
  function paint(){
    const g=shot.getContext('2d'); g.drawImage(frame,0,0);
    const r=Math.max(6, shot.width/160);
    g.lineWidth=Math.max(2, shot.width/600); g.font='bold '+Math.round(r*2.2)+'px ui-monospace,monospace';
    pts.forEach(([x,y],i)=>{ g.strokeStyle='#ffb02e'; g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.moveTo(x-r*2,y); g.lineTo(x+r*2,y); g.moveTo(x,y-r*2); g.lineTo(x,y+r*2); g.stroke();
      g.fillStyle='#ffb02e'; g.fillText(String(i+1), x+r*1.4, y-r*1.4); });
    if(pts.length===4){ g.strokeStyle='rgba(0,229,255,.8)'; g.beginPath(); pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y)); g.closePath(); g.stroke(); }
    const ok=pts.length===4 && Eng.quadOK(pts);
    $('camStep').textContent = pts.length<4 ? 'Click the center of mark '+NAMES[pts.length]+'. The loupe shows the spot under the cursor.' :
      ok ? 'All 4 marks set. Save, or Undo point to redo one.' : 'Those 4 points are not in order around the bed (1 bottom-left, 2 bottom-right, 3 top-right, 4 top-left). Undo and click again.';
    $('camSaveCal').disabled=!ok; $('camUndoPt').disabled=!pts.length;
  }
  function toImg(e){ const r=shot.getBoundingClientRect(); return [(e.clientX-r.left)*shot.width/r.width, (e.clientY-r.top)*shot.height/r.height]; }
  shot.addEventListener('click', e=>{ if(pts.length>=4) return; pts.push(toImg(e)); paint(); });
  shot.addEventListener('mousemove', e=>{
    const [x,y]=toImg(e), Z=6, L=loupe.width, g=loupe.getContext('2d'), src=L/Z;
    g.imageSmoothingEnabled=false; g.fillStyle='#000'; g.fillRect(0,0,L,L);
    g.drawImage(shot, x-src/2, y-src/2, src, src, 0, 0, L, L);
    g.strokeStyle='#00e5ff'; g.beginPath(); g.moveTo(L/2,0); g.lineTo(L/2,L); g.moveTo(0,L/2); g.lineTo(L,L/2); g.stroke();
    loupe.style.display='block';
  });
  shot.addEventListener('mouseleave', ()=>{ loupe.style.display='none'; });
  function openCal(){
    if(!S.src){ log('Start the camera first','warn'); return; }
    if(!snapshot()){ log('No camera picture yet. Wait a second and try again.','warn'); return; }
    marks=Machines.current().camMarks || Eng.markPoints(bedRect());
    pts=[]; paint(); $('camModal').classList.add('open');
  }
  function closeCal(){ $('camModal').classList.remove('open'); }
  $('camCal').onclick=openCal;
  $('camClose').onclick=closeCal;
  $('camModal').addEventListener('mousedown', e=>{ if(e.target.id==='camModal') closeCal(); });
  $('camRetake').onclick=()=>{ if(snapshot()) paint(); };
  $('camUndoPt').onclick=()=>{ pts.pop(); paint(); };
  $('camSaveCal').onclick=()=>{
    const H=Eng.homography(marks, pts); if(!H){ log('Could not solve the camera position from those points','bad'); return; }
    const m=Machines.current();
    m.cam={ H, iw:shot.width, ih:shot.height, t:Date.now(), deviceId:$('camSel').value||'', marks };
    Machines.save(); closeCal(); S.rect=null; S.fresh=true; S.show=true; $('camShow').checked=true; dirty=true; info();
    log('Camera calibrated for "'+m.name+'". The live picture now lines up with the bed.','acc');
  };
  let forgetArm=0;
  $('camForget').onclick=()=>{
    if(!forgetArm){ forgetArm=setTimeout(()=>{ forgetArm=0; $('camForget').textContent='Forget'; }, 4000); $('camForget').textContent='Forget?'; return; }
    clearTimeout(forgetArm); forgetArm=0; $('camForget').textContent='Forget';
    delete Machines.current().cam; Machines.save(); S.rect=null; dirty=true; info(); log('Camera calibration removed','dim');
  };

  // ----- controls -----
  $('camOn').onclick=()=>S.stream?stop():start();
  $('camShow').addEventListener('change',()=>{ S.show=$('camShow').checked; S.fresh=true; dirty=true; });
  $('camOpacity').addEventListener('input',()=>{ S.opacity=+$('camOpacity').value; dirty=true; });
  $('machSel').addEventListener('change',()=>setTimeout(()=>{ S.rect=null; S.fresh=true; dirty=true; info(); },0));
  document.querySelector('details[data-sec="camera"]').addEventListener('toggle', e=>{ if(e.target.open) listCams(); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeCal(); });
  S.opacity=+$('camOpacity').value; S.show=$('camShow').checked;
  info();
  return { draw, start, stop, useSource, unwarp:()=>unwarp(), get state(){ return {src:!!S.src, cal:!!cal(), show:S.show}; } };
})();
