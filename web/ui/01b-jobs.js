// ---------- background jobs (Web Worker) + progress overlay ----------
// Heavy work (generate, DXF import, G-code load) runs in engine/worker.js so the UI,
// the STOP button and streaming never freeze. If workers can't start, the same code
// runs on the main thread (engine/jobs.js), just without the smooth UI.
const Jobs = (()=>{
  let w=null, broken=false, seq=0; const pend=new Map();
  function start(){
    if(broken) return null;
    try{
      w=new Worker('engine/worker.js',{type:'module'});
      w.onmessage=e=>{
        const m=e.data, p=pend.get(m.id); if(!p) return;
        if('progress' in m){ p.onProgress && p.onProgress(m.progress, m.stage); return; }
        pend.delete(m.id); m.ok ? p.res(m.res) : p.rej(new Error(m.err));
      };
      w.onerror=e=>{                                  // worker failed to load: finish pending work here
        e.preventDefault && e.preventDefault();
        log('Background worker unavailable ('+(e.message||'failed to start')+'). Working on the main thread.','warn');
        broken=true; try{ w.terminate(); }catch{} w=null;
        const todo=[...pend.values()]; pend.clear();
        for(const p of todo){ try{ p.res(Eng.runJob(p.op, p.args, p.onProgress)); }catch(err){ p.rej(err); } }
      };
    }catch(e){ broken=true; w=null; }
    return w;
  }
  function run(op, args, onProgress){
    if(!w) start();
    if(!w) return new Promise((res,rej)=>{ setTimeout(()=>{ try{ res(Eng.runJob(op,args,onProgress)); }catch(e){ rej(e); } }, 0); });
    const id=++seq;
    return new Promise((res,rej)=>{ pend.set(id,{res,rej,onProgress,op,args}); w.postMessage({id,op,args}); });
  }
  function cancel(){
    if(w){ w.terminate(); w=null; }
    const todo=[...pend.values()]; pend.clear();
    for(const p of todo) p.rej(Object.assign(new Error('cancelled'),{cancelled:true}));
  }
  return { run, cancel, busy:()=>pend.size>0 };
})();

// Overlay on the map: only appears if the work takes more than ~150 ms, so quick jobs don't flash.
const Busy = (()=>{
  let timer=0, shown=false, label='';
  const el=()=>$('busy');
  function show(text){
    label=text; clearTimeout(timer);
    timer=setTimeout(()=>{ const b=el(); if(!b) return; b.classList.add('on'); shown=true; set(0,text); }, 150);
  }
  function set(f, stage){
    const b=el(); if(!b) return;
    b.querySelector('.busy-t').textContent=stage||label;
    b.querySelector('.busy-bar i').style.width=(Math.max(0,Math.min(1,f))*100).toFixed(1)+'%';
    b.querySelector('.busy-p').textContent=Math.round(f*100)+'%';
  }
  function hide(){ clearTimeout(timer); const b=el(); if(b) b.classList.remove('on'); shown=false; }
  return { show, set, hide };
})();
$('busyCancel').onclick=()=>Jobs.cancel();

// Split a big newline-joined result into lines without one long freeze: ~200k lines per
// slice, yielding between slices (MessageChannel: not throttled like timers in background tabs).
const yieldUI=()=>new Promise(r=>{ const ch=new MessageChannel(); ch.port1.onmessage=()=>r(); ch.port2.postMessage(0); });
async function splitLines(text, onMain){
  if(!text) return [];
  const out=[]; let i=0;
  while(true){
    const t0=performance.now();
    for(let k=0;k<200000;k++){ const j=text.indexOf('\n',i); if(j<0){ out.push(text.slice(i)); onMain(performance.now()-t0); return out; } out.push(text.slice(i,j)); i=j+1; }
    onMain(performance.now()-t0);
    await yieldUI();
  }
}

// Panel/status refresh, coalesced: dragging fires many mousemoves per frame, but the
// object list and side panel only need rebuilding once per frame.
let uiQueued=false;
function scheduleUI(){
  if(uiQueued) return; uiQueued=true;
  requestAnimationFrame(flushUI);
  setTimeout(flushUI, 120);                           // rAF doesn't run in hidden tabs
}
function flushUI(){ if(!uiQueued) return; uiQueued=false; syncProps(); updateUI(); }
