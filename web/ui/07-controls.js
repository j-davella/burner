// ---------- buttons ----------
$('connBtn').onclick = ()=> connected ? disconnect('user') : connect();
$('portRefresh').onclick = refreshPorts;
$('mode').addEventListener('change', ()=>{ const b=$('mode').value==='bridge'; $('portSel').style.display=$('portRefresh').style.display=b?'':'none'; if(b) refreshPorts(); });
$('stopBtn').onclick = stopAll;
$('resetBtn').onclick = ()=>{ if(!connected) return; job.running=false; manualQ=[]; rt(0x18); inflight=[]; bufUsed=0; updateUI(); };
$('homeBtn').onclick = $('alarmHome').onclick = ()=>{ if(canCommand()) queue('$H'); };
$('unlockBtn').onclick = $('alarmUnlock').onclick = ()=>{ if(canCommand()) queue('$X'); };
$('zeroBtn').onclick = ()=>{ if(canCommand()) queue('G10 L20 P1 X0 Y0'); };
$('goZeroBtn').onclick = ()=>{ if(canCommand()) queue('M5','G21 G90 G0 X0 Y0'); };
$('settingsBtn').onclick = ()=>{ if(canCommand()) queue('$$'); };
$('resyncBtn').onclick = ()=>{ inflight=[]; bufUsed=0; log('Buffer count cleared','dim'); pump(); };
$('frameBtn').onclick = frameJob;
$('startBtn').onclick = startJob;
$('pauseBtn').onclick = pauseJob;
$('jogCancel').onclick = ()=>{ if(connected) rt(0x85); };
function jog(dx,dy){
  if(!canCommand()) return;
  const s = +$('jogStep').value*MM, f=(+$('jogFeedS').value||40)*60;
  queue('$J=G91 G21'+(dx?' X'+fmt(dx*s):'')+(dy?' Y'+fmt(dy*s):'')+' F'+fmt(f));
}
document.querySelectorAll('[data-pw]').forEach(b=>b.onclick=()=>{
  if(!connected) return;
  if(b.dataset.pw==='job'){ sendSpindleOv(100); return; }
  const a=powerAbs(); if(a===null){ log('Power adjust works while a job is burning','dim'); return; }
  setPowerAbs(Math.round(a)+(+b.dataset.pw));
});
document.querySelectorAll('[data-ov]').forEach(b=>b.onclick=()=>{ if(connected) rt(+b.dataset.ov); });
document.querySelectorAll('[data-j]').forEach(b=>b.onclick=()=>{ const [x,y]=b.dataset.j.split(',').map(Number); jog(x,y); });

// console input
const hist=[]; let hi=0;
$('cmd').addEventListener('keydown', e=>{
  if(e.key==='Enter'){ const v=$('cmd').value.trim(); if(!v) return;
    hist.push(v); hi=hist.length; $('cmd').value='';
    if(v==='?'){ rt(0x3F); return; } if(v==='!'){ rt(0x21); return; } if(v==='~'){ rt(0x7E); return; }
    if(canCommand()) queue(v);
  } else if(e.key==='ArrowUp'){ if(hi>0){ hi--; $('cmd').value=hist[hi]; } e.preventDefault(); }
  else if(e.key==='ArrowDown'){ if(hi<hist.length-1){ hi++; $('cmd').value=hist[hi]; } else { hi=hist.length; $('cmd').value=''; } e.preventDefault(); }
});
document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){ openSettings(false); stopAll(); if(cropMode){ cropMode=false; } else if(sel){ sel=null; } syncProps(); dirty=true; e.preventDefault(); return; }
  if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const k={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[e.key];
  if(sel && !job.running){
    if(e.key==='Delete'||e.key==='Backspace'){ deleteSel(); e.preventDefault(); return; }
    if(k){ const d=(e.shiftKey?0.1:0.01)*MM; sel.x+=k[0]*d; sel.y+=k[1]*d; layoutChanged(); e.preventDefault(); return; }
  }
  if(connected){
    const ov = {'[':0x92,']':0x91}[e.key];
    if(ov){ rt(ov); e.preventDefault(); return; }
    if(e.key==='-'||e.key==='='){ const a=powerAbs(); if(a!==null) setPowerAbs(Math.round(a)+(e.key==='='?10:-10)); e.preventDefault(); return; }
    if(e.key===' ' && job.running){ pauseJob(); e.preventDefault(); return; }
  }
  if(k){ jog(...k); e.preventDefault(); }
  if(e.key==='f'||e.key==='F') fitView();
});

// ---------- UI state ----------
function updateUI(){
  const b=$('stateBadge'); b.textContent = connected ? (st.known ? st.sub : 'Waiting') : 'Offline';
  b.className = 'badge st-'+st.state;
  const k = connected && st.known;
  $('wx').textContent = k?(st.w[0]/MM).toFixed(3):'-'; $('wy').textContent = k?(st.w[1]/MM).toFixed(3):'-';
  $('mx').textContent = k?(st.m[0]/MM).toFixed(3):'-'; $('my').textContent = k?(st.m[1]/MM).toFixed(3):'-';
  $('fs').textContent = k?Math.round(st.f/60):'-'; $('ss').textContent = k?Math.round(st.s):'-';
  const ov = k && st.ov;
  $('ovF').textContent = ov?st.ov[0]+'%':'-'; $('ovR').textContent = ov?st.ov[1]+'%':'-';
  const pa = ov ? powerAbs() : null, jm=curSecMax();
  $('ovS').textContent = pa!==null ? Math.round(pa)+'%' : '-';
  $('pwInfo').textContent = pa!==null ? 'job set '+Math.round(jm/smax()*100)+'%'+(st.ov[2]!==100?' -> now '+Math.round(pa)+'%':'')+' of laser' : 'adjusts while burning';
  $('ovF').style.color = ov&&st.ov[0]!==100?'var(--warn)':''; $('ovS').style.color = ov&&st.ov[2]!==100?'var(--warn)':'';
  $('alarmBar').style.display = connected && st.state==='Alarm' ? 'block' : 'none';
  const idle = connected && !job.running;
  ['homeBtn','unlockBtn','zeroBtn','goZeroBtn','settingsBtn','frameBtn'].forEach(id=>$(id).disabled=!idle);
  $('startBtn').disabled = !(idle && sawBanner && job.lines.length && st.state==='Idle');
  $('pauseBtn').disabled = !(connected && job.running);
  $('pauseBtn').textContent = (job.paused||st.state==='Hold') ? 'Resume' : 'Pause';
  $('genBtn').disabled = job.running; $('loadGcBtn').disabled = job.running; $('loadImgBtn').disabled = job.running;
  $('resetBtn').disabled = !connected;
  $('layoutNote').style.display = layoutStale && objs.length ? '' : 'none';
  updateHudStrip();
  const n=job.lines.length||1;
  $('prog').value = job.acked/n;
  if(job.running && job.cum){
    const el=runSeconds(), estRem=job.estTotal-job.cum[Math.min(job.acked,job.lines.length)];
    // learn how far off the estimate is (override-adjusted), once there's enough data
    const k = (el>8 && job.estDoneAdj>2) ? Math.max(0.3,Math.min(5, el/job.estDoneAdj)) : 1;
    const rem = estRem*100/((st.ov&&st.ov[0])||100)*k;
    const done = new Date(Date.now()+rem*1000);
    const held = st.state==='Hold';
    $('prog').value = job.estTotal ? 1-estRem/job.estTotal : job.acked/n;
    $('tLeft').textContent = fmtT(rem);
    $('tSub').innerHTML = (held?'<span style="color:var(--warn)">PAUSED</span> &middot; ':'')+'left &middot; done ~'+done.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})+'<br>'+fmtT(el)+' elapsed &middot; est total '+fmtT(el+rem);
    $('progTxt').textContent = job.acked.toLocaleString()+' / '+job.lines.length.toLocaleString()+' lines ('+(100*$('prog').value).toFixed(1)+'%)';
  } else {
    $('progTxt').textContent = job.lines.length ? (job.acked? job.acked.toLocaleString()+' / '+job.lines.length.toLocaleString()+' acked':'Ready') : '-';
    if(job.doneS && !job.running && job.acked>=job.lines.length){ $('tLeft').textContent=fmtT(job.doneS); $('tSub').innerHTML='done &middot; estimate was '+fmtT(job.estTotal); }
    else if(job.lines.length && job.estTotal!==undefined){ $('tLeft').textContent=fmtT(job.estTotal); $('tSub').textContent=layoutStale?'estimate (regenerate for current layout)':'estimated'; }
    else { $('tLeft').textContent='--:--'; $('tSub').textContent='no job'; }
  }
}
function fmtT(s){ s=Math.max(0,Math.round(s)); const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=String(s%60).padStart(2,'0'); return h? h+':'+String(m).padStart(2,'0')+':'+x : m+':'+x; }
function runSeconds(){ if(!job.t0) return 0; const now=performance.now(); return (now-job.t0-job.holdMs-(job.holdStart?now-job.holdStart:0))/1000; }
setInterval(()=>{ if(job.running) updateUI(); }, 500);
