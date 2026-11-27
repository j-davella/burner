// ---------- serial ----------
let connected=false, pollTimer=null, rxText='', sawBanner=false, askedSettings=false;
let rxSize=127, inflight=[], bufUsed=0, manualQ=[];
const settings = {};
const st = { state:'Offline', m:[0,0,0], w:[0,0,0], wco:[0,0,0], f:0, s:0, known:false };
const dec = new TextDecoder();
// transport: {send(Uint8Array), close()} ; bridge (WebSocket to burner_bridge.py) or Web Serial
let tp = null;
let userClosing = false;            // Disconnect was pressed: don't auto-reconnect

function rawSend(bytes){ if(tp) tp.send(bytes); }
function rt(b){ rawSend(new Uint8Array([b])); }

function onBytes(u8){
  rxText += dec.decode(u8, {stream:true});
  let i;
  while((i = rxText.indexOf('\n')) >= 0){
    const line = rxText.slice(0,i).trim(); rxText = rxText.slice(i+1);
    if(line) onLine(line);
  }
}
function onOpened(desc){
  connected=true; sawBanner=false; askedSettings=false; inflight=[]; bufUsed=0; manualQ=[]; rxSize=127; rxText=''; userClosing=false;
  st.alarm=null;
  $('connBtn').textContent='Disconnect';
  log('Port open: '+desc,'acc');
  if((typeof Machines!=='undefined')) Machines.onOpened();
  setTimeout(()=>{ if(connected && !sawBanner){ log('No banner yet, sending soft reset','dim'); rt(0x18); } }, 1800);
  clearInterval(pollTimer);
  pollTimer = setInterval(()=>{ if(connected) rt(0x3F); }, 200);
  updateUI();
}
function onClosed(why){
  if(!connected && !tp) return;
  connected=false; clearInterval(pollTimer); tp=null;
  const mid = job.running;
  if(mid){ haltJob('connection lost ('+(why||'unknown')+')', true); log('Job aborted: disconnected. The laser is treated as stopped; the job will NOT restart by itself.','bad'); }
  inflight=[]; bufUsed=0; manualQ=[];
  st.state='Offline'; st.known=false;
  $('connBtn').textContent='Connect';
  log('Disconnected'+(why?' ('+why+')':''),'warn');
  const byUser = userClosing; userClosing=false;
  updateUI();
  if((typeof Machines!=='undefined')) Machines.onClosed(why, byUser, mid);
}
function connect(){ return $('mode').value==='bridge' ? connectBridge() : connectWebSerial(); }
function disconnect(why){ if(why==='user') userClosing=true; if(tp) tp.close(why); else onClosed(why); }

// ----- bridge mode -----
let ws=null, wsReady=null;
function bridgeURL(){ return (location.protocol==='http:'||location.protocol==='https:') && location.host ? 'ws://'+location.host+'/ws' : 'ws://localhost:8765/ws'; }
function ensureWS(){
  if(ws && ws.readyState===1) return Promise.resolve(ws);
  if(wsReady) return wsReady;
  wsReady = new Promise((res, rej)=>{
    const s = new WebSocket(bridgeURL()); s.binaryType='arraybuffer';
    s.onopen = ()=>{ ws=s; wsReady=null; res(s); };
    s.onerror = ()=>{ wsReady=null; rej(new Error('Bridge not reachable at '+bridgeURL()+'. Is burner_bridge.py running?')); };
    s.onclose = ()=>{ if(ws===s){ ws=null; if(tp && tp.kind==='bridge') onClosed('bridge connection lost'); } };
    s.onmessage = e=>{
      if(typeof e.data !== 'string'){ if(tp && tp.kind==='bridge') onBytes(new Uint8Array(e.data)); return; }
      let m; try{ m=JSON.parse(e.data); }catch{ return; }
      if(m.ev==='ports'){ fillPorts(m.ports); if((typeof Machines!=='undefined')) Machines.onPorts(m.ports); }
      else if(m.ev==='opened'){ tp = { kind:'bridge', send:b=>{ if(ws&&ws.readyState===1) ws.send(b); }, close:()=>{ ws&&ws.send(JSON.stringify({cmd:'close'})); } }; onOpened(m.port+' @ '+m.baud+' (bridge)'); }
      else if(m.ev==='closed'){ if(tp && tp.kind==='bridge') onClosed(m.why); }
      else if(m.ev==='error'){ if(!((typeof Machines!=='undefined') && Machines.quietError(m.msg))) log('Bridge: '+m.msg,'bad'); }
    };
  });
  return wsReady;
}
function fillPorts(ports){
  const sel=$('portSel'), prev=sel.value; sel.innerHTML='';
  if(!ports.length){ sel.innerHTML='<option value="">no ports found</option>'; return; }
  for(const p of ports){ const o=document.createElement('option'); o.value=p.path; o.textContent=p.label; sel.appendChild(o); }
  const keep=[...sel.options].find(o=>o.value===prev); if(keep) sel.value=prev;
}
async function refreshPorts(){
  try{ const s=await ensureWS(); s.send(JSON.stringify({cmd:'list'})); }
  catch(e){ log(e.message,'bad'); }
}
async function connectBridge(){
  let s; try{ s=await ensureWS(); }catch(e){ log(e.message,'bad'); return; }
  const p=$('portSel').value;
  if(!p){ log('No port selected. Plug the laser in and hit the refresh button next to the port list.','warn'); s.send(JSON.stringify({cmd:'list'})); return; }
  s.send(JSON.stringify({cmd:'open', port:p, baud:+$('baud').value}));
}

// ----- Web Serial mode -----
// given: an already-granted SerialPort (auto-reconnect), so no picker is shown
let wsPortInfo=null;
async function connectWebSerial(given){
  if(!('serial' in navigator)){ log('Web Serial not available in this browser. Use Bridge mode.','bad'); return false; }
  let port, reader, writer;
  try{
    port = given || await navigator.serial.requestPort();
    await port.open({ baudRate:+$('baud').value, bufferSize:8192 });
  }catch(e){ if(!given) log('Connect failed: '+e.message,'bad'); return false; }
  try{ wsPortInfo = port.getInfo(); }catch{}
  writer = port.writable.getWriter();
  let closing=false;
  tp = { kind:'webserial',
    send:b=>writer.write(b).catch(e=>log('Write failed: '+e.message,'bad')),
    close: async why=>{ closing=true; try{ await reader?.cancel(); }catch{} try{ writer.releaseLock(); }catch{} try{ await port.close(); }catch{} onClosed(why); } };
  onOpened('Web Serial @ '+$('baud').value);
  reader = port.readable.getReader();
  try{ for(;;){ const {value,done}=await reader.read(); if(done) break; onBytes(value); } }
  catch(e){ if(!closing) log('Read error: '+e.message,'bad'); }
  finally{ try{ reader.releaseLock(); }catch{} }
  if(!closing && tp && tp.kind==='webserial') tp.close('read loop ended');
}
// ---------- streaming (character-counting) ----------
function sendLine(line, jobIdx){
  const data = line + '\n';
  inflight.push({ len:data.length, jobIdx, line });
  bufUsed += data.length;
  rawSend(enc.encode(data));
  if(jobIdx < 0) log('> '+line,'tx');
}
function fits(len){ return bufUsed + len + 1 <= rxSize || inflight.length === 0; }
function pump(){
  if(!connected) return;
  while(manualQ.length && fits(manualQ[0].length)) sendLine(manualQ.shift(), -1);
  if(job.running && !job.paused && !manualQ.length){
    while(job.idx < job.lines.length && fits(job.lines[job.idx].length)){
      sendLine(job.lines[job.idx], job.idx); job.idx++;
    }
  }
}
function queue(...lines){
  if(!connected){ log('Not connected','bad'); return false; }
  for(const l of lines){ const c = l.trim(); if(c){ manualQ.push(c); if(/^\$H$/i.test(c) && job.halt) job.halt.homed=true; } }
  pump(); return true;
}
function canCommand(){
  if(!connected){ log('Not connected','bad'); return false; }
  if(job.running){ log('Job running. Pause/stop first.','warn'); return false; }
  return true;
}

function onLine(l){
  if(l[0]==='<'){ onStatus(Core.parseStatus(l)); return; }
  if(l==='ok' || l.startsWith('error')){
    const it = inflight.shift();
    if(it){ bufUsed -= it.len; if(bufUsed<0) bufUsed=0; if(it.jobIdx>=0){ job.acked = it.jobIdx+1; if(job.lt) job.estDoneAdj += job.lt[it.jobIdx]*100/((st.ov&&st.ov[0])||100);
      if(job.sections){ const sc=job.sections.sec[it.jobIdx]; if(sc!==job.lastSec){ if(job.lastSec>=0 && st.ov && st.ov[2]!==100){ rt(0x99); st.ov[2]=100; log('Next operation: power back to its job setting','dim'); } job.lastSec=sc; } } } }
    if(l.startsWith('error')){
      const code = +l.split(':')[1];
      log((it?it.line+'  ->  ':'')+l+(ERR[code]?'  '+ERR[code]:''),'bad');
      if(it && it.jobIdx<0 && job.running){ log('A resume setup line failed, so the job was stopped before burning anything.','bad'); stopAll(); }
      else if(it && it.jobIdx>=0 && $('haltErr').checked && !job.paused){ pauseJob(); log('Job paused on error (line '+(it.jobIdx+1)+'). Resume or STOP.','warn'); }
    } else if(it && it.jobIdx<0){ log('ok','dim');
      const sm=/^\$(\d+)=(.+)$/.exec(it.line); if(sm){ settings[sm[1]]=sm[2]; updateCtlInfo(); if(typeof Machines!=='undefined') Machines.onSetting(); } }
    // every line acked only means planned: the last moves are still burning. Done = acked + Idle.
    if(job.running && job.idx>=job.lines.length && job.acked>=job.lines.length && inflight.length===0){ job.drain=true; job.drainT=performance.now(); rt(0x3F); }
    pump(); return;
  }
  if(l.startsWith('ALARM')){
    const code = +l.split(':')[1];
    st.alarm = code;
    log(l+'  '+almText(code),'bad');
    if(job.running){ haltJob('ALARM:'+code+' '+(ALM[code]?ALM[code][0]:''), !(ALM[code] && ALM[code][2])); manualQ=[]; log('Job aborted by alarm','bad'); }
    else if(job.halt && ALM[code] && !ALM[code][2]) job.halt.lost=true;
    updateUI(); return;
  }
  if(/^Grbl/i.test(l)){
    sawBanner=true; inflight=[]; bufUsed=0; manualQ=[];
    if(job.running){ haltJob('controller reset itself', true); log('Job ended: controller reset','warn'); }
    log(l,'acc');
    if(!askedSettings){ askedSettings=true; setTimeout(()=>queue('$$'), 300); }
    updateUI(); return;
  }
  const m = /^\$(\d+)=(.*)$/.exec(l);
  if(m){ settings[m[1]] = m[2]; log(l,'dim'); updateCtlInfo(); if((typeof Machines!=='undefined')) Machines.onSetting(); return; }
  if(/^\[MSG:.*'\$H'\|'\$X' to unlock/.test(l)){ if(typeof st.alarm!=='number') st.alarm='lock'; log(l+'  Homing is on, so the controller locks after power-up or a reset until it knows where the head is. Home ($H).','warn'); updateUI(); return; }
  log(l, /^\[MSG/.test(l)?'warn':undefined);
}

function onStatus(r){
  st.state = r.state; st.sub = r.sub; st.pn = r.pn||'';
  if(st.state!=='Alarm') st.alarm=null;
  if(r.wco) st.wco = r.wco;
  if(r.mpos){ st.m = r.mpos; st.w = r.mpos.map((v,i)=>v-(st.wco[i]||0)); }
  else if(r.wpos){ st.w = r.wpos; st.m = r.wpos.map((v,i)=>v+(st.wco[i]||0)); }
  if(r.f!==undefined) st.f=r.f; if(r.s!==undefined) st.s=r.s;
  if(r.ov) st.ov = r.ov;
  if(job.running){ const now=performance.now(); if(st.state==='Hold'){ if(!job.holdStart) job.holdStart=now; } else if(job.holdStart){ job.holdMs+=now-job.holdStart; job.holdStart=0; } }
  if(r.bf && inflight.length===0 && !job.running && r.bf[1]>16) rxSize = r.bf[1]-1;
  st.known = true;
  if(job.running && job.drain && st.state==='Idle' && performance.now()-job.drainT>50) jobDone();
  updateUI(); dirty = true;
}

// ---------- controller info ----------
function updateCtlInfo(){
  const parts=[];
  if(settings[30]) parts.push('$30 max S = '+settings[30]);
  if(settings[32]!==undefined) parts.push(settings[32]==='1'?'laser mode ON':'<b style="color:#ff4d4d">$32=0, laser mode OFF. Send $32=1</b>');
  if(settings[13]!==undefined) parts.push('$13 report '+(settings[13]==='1'?'inches':'mm'));
  if(settings[130]) parts.push('travel '+(+settings[130]/MM).toFixed(2)+' x '+(+settings[131]/MM).toFixed(2)+' in');
  parts.push('RX buffer '+rxSize);
  $('ctlInfo').innerHTML = parts.join('<br>');
  fillMotion();
  if(settings[13]==='1') log('Controller reports in inches ($13=1). This sender expects mm. Send $13=0.','warn');
}
function smax(){ return +(settings[30]||1000); }
