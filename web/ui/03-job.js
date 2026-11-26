// ---------- job ----------
const job = { lines:[], idx:0, acked:0, running:false, paused:false, name:'', prev:null, t0:0, raster:null };

function clearJob(){
  job.lines=[]; job.prev=null; job.name=''; job.idx=0; job.acked=0; job.fromLayout=false; job.estTotal=undefined; job.cum=null; job.doneS=0;
  $('jobInfo').textContent='No job loaded.'; staticKey=''; dirty=true; updateUI();
}
function curSecMax(){ if(!job.running||!job.sections) return 0; const i=Math.min(job.lines.length-1,Math.max(0,job.acked-1)); return job.sections.mx[job.sections.sec[i]]||0; }
function powerAbs(){ const m=curSecMax(); return m ? Math.min(100, m*(st.ov?st.ov[2]:100)/smax()) : null; }
function sendSpindleOv(want){
  const cur=st.ov?st.ov[2]:100; want=Math.max(10,Math.min(200,Math.round(want)));
  if(want===100 && cur!==100){ rt(0x99); st.ov&&(st.ov[2]=100); updateUI(); return; }
  let d=want-cur;
  while(d>=10){ rt(0x9A); d-=10; } while(d<=-10){ rt(0x9B); d+=10; }
  while(d>0){ rt(0x9C); d--; } while(d<0){ rt(0x9D); d++; }
  if(st.ov) st.ov[2]=want; updateUI();
}
function setPowerAbs(target){
  if(!connected) return;
  const m=curSecMax(); if(!m){ log('Power adjust works while a job is burning','dim'); return; }
  const SM=smax(); target=Math.max(0,Math.min(100,target));
  let want=target*SM/m;                                   // override % that gives target
  want=Math.min(want, Math.floor(SM/m*100), 200);         // never ask for more than $30
  sendSpindleOv(want);
}
// pre (optional): {lt, cum, estTotal, sections, prev} already computed by the worker
function setJob(lines, name, pitch, fromLayout, pre){
  if(pre && pre.prev){ job.lt=pre.lt; job.cum=pre.cum; job.estTotal=pre.estTotal; job.sections=pre.sections; }
  else { const lt=estLineTimes(lines), cum=new Float64Array(lines.length+1); for(let i=0;i<lines.length;i++) cum[i+1]=cum[i]+lt[i]; job.lt=lt; job.cum=cum; job.estTotal=cum[lines.length];
         job.sections = buildSections(lines); }
  job.lastSec = -1;
  job.lines = lines; job.name = name; job.idx = 0; job.acked = 0; job.running=false; job.paused=false; job.doneS=0;
  job.fromLayout = !!fromLayout; layoutStale = false;
  job.prev = pre && pre.prev ? pre.prev : Core.parseGcode(lines, smax());
  job.paths = null;                                       // preview Path2Ds, built on first draw
  job.pitch = pitch || 0;
  const b = job.prev.burn || job.prev.all;
  $('jobInfo').innerHTML = '<b>'+name+'</b><br>'+lines.length.toLocaleString()+' lines'+
    (b?', '+((b.maxX-b.minX)/MM).toFixed(3)+' x '+((b.maxY-b.minY)/MM).toFixed(3)+' in burn area, from ('+(b.minX/MM).toFixed(3)+', '+(b.minY/MM).toFixed(3)+')':'')+
    '<br>estimated time '+fmtT(job.estTotal);
  doneSeg = 0; staticKey=''; if(!fromLayout) fitView(); dirty=true; updateUI();
}

// Regenerate a stale layout first. Generation is async (worker), so re-check the
// machine afterwards, and refuse if the layout changed while it was generating.
async function freshLayout(){
  if(!layoutStale) return true;
  if(!(await generateLayout())) return false;
  if(layoutStale){ log('Layout changed while generating. Press it again.','warn'); return false; }
  return canCommand();
}
async function startJob(){
  if(!canCommand()) return;
  if(!sawBanner){ log('Controller has not reported in yet. Wait a sec.','warn'); return; }
  if(!(await freshLayout())) return;
  if(!job.lines.length){ log('No job loaded','warn'); return; }
  if(st.state!=='Idle'){ log('Controller must be Idle to start (now '+st.state+')','warn'); return; }
  if(settings[32]==='0'){ log('Refusing to start: $32=0 (laser mode off). Laser would stay on during rapids. Send $32=1.','bad'); return; }
  job.idx=0; job.acked=0; job.running=true; job.paused=false; job.t0=performance.now(); job.holdMs=0; job.holdStart=0; job.estDoneAdj=0; job.doneS=0;
  doneSeg=0; clearDone(); log('Job started: '+job.name,'acc');
  pump(); updateUI();
}
function pauseJob(){
  if(!connected) return;
  if(job.paused || st.state==='Hold'){ rt(0x7E); job.paused=false; log('Resume','dim'); pump(); }
  else { rt(0x21); job.paused=true; log('Feed hold','dim'); }
  updateUI();
}
function jobDone(){
  job.running=false; job.paused=false;
  const s = runSeconds(); job.doneS=s;
  log('Job done in '+Math.floor(s/60)+'m '+Math.round(s%60)+'s','acc'); updateUI();
}
function stopAll(){
  if(!connected) return;
  const wasRunning = job.running;
  job.running=false; job.paused=false; manualQ=[];
  rt(0x85); rt(0x21);
  setTimeout(()=>{ rt(0x18); inflight=[]; bufUsed=0; log('STOP: feed hold + soft reset. Laser off.'+(wasRunning?' Job killed.':''),'warn'); updateUI(); }, 250);
  updateUI();
}

async function frameJob(){
  if(!canCommand()) return;
  if(!(await freshLayout())) return;
  if(!job.prev){ log('Load a job first','warn'); return; }
  const b = job.prev.burn || job.prev.all; if(!b) return;
  const f = (+$('frameFeedS').value||60)*60;
  const L = $('frameLaser').checked;
  const S = Math.max(0, Math.min(smax(), +$('frameS').value||0));
  const p = (x,y)=>'X'+fmt(x)+' Y'+fmt(y);
  queue('G21 G90','M5','G0 '+p(b.minX,b.minY), L?'M3 S'+S:'S0',
    'G1 '+p(b.maxX,b.minY)+' F'+fmt(f),'G1 '+p(b.maxX,b.maxY),'G1 '+p(b.minX,b.maxY),'G1 '+p(b.minX,b.minY),'M5 S0');
}

// ---------- G-code file ----------
$('loadGcBtn').onclick = ()=>$('gcFile').click();
$('gcFile').onchange = async e=>{
  const f = e.target.files[0]; if(!f) return; e.target.value='';
  if(job.running){ log('Job running. Stop it before loading another.','warn'); return; }
  Busy.show('Loading '+f.name);
  try{
    const res = await Jobs.run('gcode', { name:f.name, text:await f.text(), settings:{...settings}, smax:smax() }, (p,s)=>Busy.set(p,s));
    Busy.set(1,'Loading '+res.count.toLocaleString()+' lines');
    const lines=await splitLines(res.text, ()=>{});
    if(job.running) return;
    setJob(lines, f.name, 0, false, res);
  }catch(err){ log(err.cancelled ? 'Loading cancelled' : 'Load '+f.name+' failed: '+err.message, err.cancelled?'warn':'bad'); }
  finally{ Busy.hide(); }
};
