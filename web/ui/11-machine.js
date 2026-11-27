// ---------- machine profiles, auto-reconnect, $-settings check ----------
// A profile = one laser: bed size/offsets, connection (mode, port, baud), air-assist
// command, and a saved copy of its $-settings. The bed/baud/mode fields stay the live
// values (01-base persists them); the current profile follows every change to them.
//
// Reconnect: if the link drops without Disconnect being pressed, keep trying the same
// port. A job that was running is NOT restarted: on reconnect the controller gets a
// feed hold + soft reset so anything left in its planner stops, and the job waits in
// the Job tab for a deliberate Resume (ui/12-resume.js).
const Machines = (()=>{
  const KEY='burner.machines', CUR='burner.machineCur';
  const BED=['bedW','bedH','bedX0','bedY0'];
  const rd=(k,d)=>{ try{ const v=localStorage.getItem(k); return v===null?d:JSON.parse(v); }catch{ return d; } };
  const wr=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };
  const snap=()=>({ bedW:+$('bedW').value, bedH:+$('bedH').value, bedX0:+$('bedX0').value, bedY0:+$('bedY0').value, mode:$('mode').value, baud:$('baud').value });
  const fresh=name=>({ id:'m'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), name, ...snap(), port:'', portLabel:'', air:'M8', dollar:null });

  let list=rd(KEY, []);
  if(!Array.isArray(list) || !list.length) list=[fresh('My laser')];
  let cur=list.find(m=>m.id===rd(CUR,'')) || list[0];
  const save=()=>{ wr(KEY, list); wr(CUR, cur.id); };
  save();

  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const num=v=>{ const n=parseFloat(v); return isNaN(n)? String(v) : String(n); };
  function diffs(){
    if(!cur.dollar) return [];
    return Object.keys(cur.dollar).filter(k=>settings[k]!==undefined && num(settings[k])!==num(cur.dollar[k]))
      .map(k=>({ k, now:settings[k], want:cur.dollar[k] }));
  }

  // ----- UI -----
  function fillSel(){
    const s=$('machSel'); s.innerHTML='';
    for(const m of list){ const o=document.createElement('option'); o.value=m.id; o.textContent=m.name; s.appendChild(o); }
    s.value=cur.id; $('machName').value=cur.name; $('machAir').value=cur.air||'';
  }
  function info(){
    const conn=(cur.mode==='webserial'?'Web Serial':'Bridge')+' · '+cur.baud+(cur.port?' · '+(cur.portLabel||cur.port):'');
    const d=diffs();
    let h='Bed '+(+cur.bedW).toFixed(2)+' × '+(+cur.bedH).toFixed(2)+' in · '+esc(conn)+'<br>';
    h+= cur.dollar ? Object.keys(cur.dollar).length+' $-settings saved' : '$-settings not saved yet';
    if(d.length) h+='<br><span class="bad">Controller differs: '+d.slice(0,6).map(x=>'$'+x.k+' is '+esc(x.now)+' (saved '+esc(x.want)+')').join(', ')+(d.length>6?' and '+(d.length-6)+' more':'')+'</span>';
    $('machInfo').innerHTML=h;
    const nset=Object.keys(settings).length;
    $('machCapture').disabled=!connected || !nset;
    $('machApply').disabled=!connected || job.running || !d.length;
  }
  function track(){ Object.assign(cur, snap()); save(); info(); }
  [...BED,'mode','baud'].forEach(id=>$(id).addEventListener('change', track));

  function apply(m){
    for(const k of BED) if(m[k]!==undefined && m[k]!=='') $(k).value=m[k];
    $('baud').value=m.baud||'115200';
    $('mode').value=m.mode||'bridge';
    $('mode').dispatchEvent(new Event('change'));          // port controls + port refresh (+ savePrefs, track)
    pickPort();
    savePrefs(); fitView(); dirty=true;
  }
  function pickPort(){
    const sel=$('portSel'); if(connected || !cur.port) return;
    const o=[...sel.options].find(o=>o.value===cur.port) || [...sel.options].find(o=>cur.portLabel && o.textContent===cur.portLabel);
    if(o) sel.value=o.value;
  }
  $('machSel').onchange=()=>{
    const m=list.find(x=>x.id===$('machSel').value);
    if(!m || m===cur) return;
    if(connected || job.running){ $('machSel').value=cur.id; log('Disconnect before switching machines.','warn'); return; }
    cur=m; save(); fillSel(); apply(cur); info(); log('Machine: '+cur.name,'acc');
  };
  $('machNew').onclick=()=>{
    if(connected || job.running){ log('Disconnect before adding a machine.','warn'); return; }
    const m=fresh('Laser '+(list.length+1)); list.push(m); cur=m; save(); fillSel(); info();
    $('machName').focus(); $('machName').select();
    log('New machine profile "'+m.name+'" (starts from the current bed and connection settings)','dim');
  };
  // two-click buttons for anything destructive: first click arms, second (within 4 s) acts
  function arm(btn, label, act){
    let t=0; const base=btn.textContent;
    btn.onclick=()=>{
      if(btn.disabled) return;
      if(t){ clearTimeout(t); t=0; btn.textContent=base; btn.classList.remove('armed'); act(); return; }
      const l=label(); if(!l) return;
      btn.textContent=l; btn.classList.add('armed');
      t=setTimeout(()=>{ t=0; btn.textContent=base; btn.classList.remove('armed'); }, 4000);
    };
  }
  arm($('machDel'), ()=>{ if(list.length<2){ log('That is the only machine profile.','warn'); return ''; } return 'Delete?'; }, ()=>{
    if(connected){ log('Disconnect before deleting a machine.','warn'); return; }
    const name=cur.name; list=list.filter(m=>m!==cur); cur=list[0]; save(); fillSel(); apply(cur); info(); log('Deleted machine "'+name+'". Now: '+cur.name,'dim');
  });
  $('machName').addEventListener('change', ()=>{ cur.name=$('machName').value.trim()||cur.name; save(); fillSel(); });
  $('machAir').addEventListener('change', ()=>{ cur.air=$('machAir').value; save(); if(objs.length) layoutChanged(); });
  $('machCapture').onclick=()=>{
    if(!connected || !Object.keys(settings).length) return;
    cur.dollar={...settings}; save(); info();
    log('Saved '+Object.keys(cur.dollar).length+' $-settings to "'+cur.name+'"','acc');
  };
  arm($('machApply'), ()=>{ const d=diffs(); if(!d.length || !canCommand()) return ''; if(st.state!=='Idle'){ log('Controller must be Idle to write settings','warn'); return ''; } return 'Write '+d.length+'?'; }, ()=>{
    const d=diffs(); if(!d.length || !canCommand() || st.state!=='Idle') return;
    log('Writing '+d.length+' saved $-settings to the controller','warn');
    queue(...d.map(x=>'$'+x.k+'='+x.want), '$$');
  });

  // $$ answer finished (no new $ line for 0.5 s): compare once per connection
  let setT=0, checked=false;
  function onSetting(){
    clearTimeout(setT);
    setT=setTimeout(()=>{
      info();
      if(checked) return; checked=true;
      const d=diffs();
      if(d.length) log('Controller settings differ from machine "'+cur.name+'": '+d.map(x=>'$'+x.k+'='+x.now+' (saved '+x.want+')').join(', ')+
        '. Wrong machine? Switch profiles. Otherwise "Write saved" or "Save from controller" in the Machine tab.','warn');
      else if(cur.dollar) log('Controller settings match machine "'+cur.name+'"','dim');
    }, 500);
  }

  // ----- reconnect -----
  const R={ on:false, n:0, t0:0, timer:0, opening:false, target:null, mid:false, gaveUp:false, back:false };
  const LIMIT_S=120;
  function onClosed(why, byUser, mid){
    R.opening=false;
    if(byUser || !$('autoReconnect').checked || /taken over|closed by user|reopen/.test(why||'')){ stopTrying(); return; }
    R.target={ mode:$('mode').value, port:cur.port||$('portSel').value, label:cur.portLabel, info:wsPortInfo };
    R.on=true; R.n=0; R.t0=performance.now(); R.mid=mid; R.gaveUp=false; R.back=false;
    clearInterval(R.timer); R.timer=setInterval(tick, 2000);
    log('Trying to reconnect every 2 s'+(mid?' (the job will NOT restart by itself)':''),'warn');
    bar(); setTimeout(tick, 600);
  }
  function stopTrying(gaveUp){
    clearInterval(R.timer); R.timer=0; R.on=false; R.opening=false; R.gaveUp=!!gaveUp;
    if(gaveUp) log('Gave up reconnecting. Check the USB cable and power, then Connect.','bad');
    bar();
  }
  async function tick(){
    if(!R.on || connected) return;
    if((performance.now()-R.t0)/1000 > LIMIT_S){ stopTrying(true); return; }
    R.n++; bar();
    if(R.target.mode==='webserial'){
      if(!('serial' in navigator) || R.opening) return;
      try{
        const ports=await navigator.serial.getPorts(), i=R.target.info||{};
        const p=ports.find(p=>{ const f=p.getInfo(); return f.usbVendorId===i.usbVendorId && f.usbProductId===i.usbProductId; }) || (ports.length===1?ports[0]:null);
        if(p){ R.opening=true; const ok=await connectWebSerial(p); if(ok===false) R.opening=false; }
      }catch{ R.opening=false; }
      return;
    }
    try{ const s=await ensureWS(); s.send(JSON.stringify({cmd:'list'})); }catch{}
  }
  if('serial' in navigator) navigator.serial.addEventListener('connect', ()=>{ if(R.on) tick(); });
  function onPorts(ports){
    pickPort();
    if(!R.on || connected || R.opening || R.target.mode!=='bridge') return;
    const p=ports.find(p=>p.path===R.target.port) || ports.find(p=>!p.sim && R.target.label && p.label===R.target.label);
    if(!p) return;
    R.opening=true; $('portSel').value=p.path;
    try{ ws.send(JSON.stringify({cmd:'open', port:p.path, baud:+$('baud').value})); }catch{ R.opening=false; }
  }
  function quietError(msg){ if(R.on){ R.opening=false; return true; } return false; }
  function onOpened(){
    checked=false;
    if($('mode').value==='bridge'){ const o=$('portSel').selectedOptions[0]; if(o && o.value){ cur.port=o.value; cur.portLabel=o.textContent; save(); } }
    if(R.on){
      clearInterval(R.timer); R.timer=0; R.on=false; R.opening=false;
      log('Reconnected after '+R.n+' tr'+(R.n===1?'y':'ies'),'acc');
      if(R.mid || job.halt){
        // whatever the controller still had queued from the job must not keep burning
        rt(0x21); setTimeout(()=>{ if(connected) rt(0x18); }, 250);
        log('Sent feed hold + soft reset so nothing left over from the job runs. Resume it from the Job tab when ready.','warn');
        R.back=true;
      }
    }
    bar(); info();
  }

  function bar(){
    const b=$('dropBar'), t=b.querySelector('span'), a=$('dropAct'), x=$('dropX');
    let msg='', act='', show=true;
    if(R.on){ msg='Lost the connection to the laser'+(R.mid?' mid-job':'')+'. Treated as stopped. Reconnecting'+(R.n?' (try '+R.n+')':'')+'...'; act='Stop trying'; }
    else if(R.gaveUp){ msg='Could not reconnect. Check the USB cable and the laser power, then Connect.'; }
    else if(R.back && job.halt){ msg='Reconnected. The job stopped at line '+job.halt.at.toLocaleString()+' and did not restart. Check the work, then Resume.'; act='Resume...'; }
    else show=false;
    b.style.display=show?'flex':'none';
    if(t.textContent!==msg) t.textContent=msg;
    a.textContent=act; a.style.display=act?'':'none';
  }
  $('dropAct').onclick=()=>{ if(R.on) stopTrying(false); else { R.back=false; bar(); UI.showTab('job'); $('resumeBox').scrollIntoView({block:'nearest'}); } };
  $('dropX').onclick=()=>{ R.gaveUp=false; R.back=false; if(R.on) stopTrying(false); bar(); };

  fillSel(); info();
  setInterval(()=>{ if(R.back && !job.halt){ R.back=false; bar(); } }, 1000);
  return { air:()=>cur.air||'', current:()=>cur, save, onClosed, onOpened, onPorts, onSetting, quietError, info, bar };
})();
