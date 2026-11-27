// ---------- projects, autosave + crash recovery, recent list, job history ----------
// Storage is the browser's IndexedDB (per site: the bridge's http://localhost:8765).
// A .burner file is JSON: the layout (objects, their operations, raster settings) with
// images embedded as data URLs, so it opens on any machine.
const DB = (()=>{
  let p=null;
  function open(){
    if(p) return p;
    p=new Promise((res,rej)=>{
      const r=indexedDB.open('burner',1);
      r.onupgradeneeded=()=>{ const d=r.result; d.createObjectStore('kv'); const h=d.createObjectStore('history',{keyPath:'id'}); h.createIndex('machine','machine'); };
      r.onsuccess=()=>res(r.result); r.onerror=()=>{ p=null; rej(r.error); };
    });
    return p;
  }
  async function tx(store, mode, fn){
    const d=await open();
    return new Promise((res,rej)=>{ const t=d.transaction(store,mode), q=fn(t.objectStore(store)); t.oncomplete=()=>res(q?q.result:undefined); t.onerror=t.onabort=()=>rej(t.error); });
  }
  return { get:k=>tx('kv','readonly',s=>s.get(k)), put:(k,v)=>tx('kv','readwrite',s=>s.put(v,k)), del:k=>tx('kv','readwrite',s=>s.delete(k)),
           hAll:()=>tx('history','readonly',s=>s.getAll()), hPut:v=>tx('history','readwrite',s=>s.put(v)), hDel:id=>tx('history','readwrite',s=>s.delete(id)) };
})();

const Project = (()=>{
  const P={ id:'', name:'', dirty:false, handle:null };
  const newId=()=>'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  P.id=newId();
  const KEYS=['type','name','x','y','rot','sx','sy','cx','cy','cw','ch','on','iw','ih','polys','pathOp','set','r','text','shape','preset','rPreset'];

  // ----- (de)serialize -----
  async function blobOf(o){
    if(o.blob) return o.blob;
    const c=document.createElement('canvas'); c.width=o.iw; c.height=o.ih; c.getContext('2d').drawImage(o.img,0,0);
    o.blob=await new Promise(r=>c.toBlob(r,'image/png'));
    return o.blob;
  }
  async function serialize(){
    const out=[];
    for(const o of objs){ const d={}; for(const k of KEYS) if(o[k]!==undefined) d[k]=o[k]; if(o.type==='img') d.blob=await blobOf(o); out.push(d); }
    return { format:'burner-project', version:1, id:P.id, name:P.name||'Untitled', saved:new Date().toISOString(),
             machine:Machines.current().name, raster:readRaster(), objs:out };
  }
  const toDataURL=b=>new Promise((res,rej)=>{ const f=new FileReader(); f.onload=()=>res(f.result); f.onerror=()=>rej(f.error); f.readAsDataURL(b); });
  async function toFileJSON(proj){
    const objs2=[]; for(const o of proj.objs){ const d={...o}; if(d.blob){ d.image=await toDataURL(d.blob); delete d.blob; } objs2.push(d); }
    return JSON.stringify({ ...proj, objs:objs2 });
  }
  async function fromFileJSON(text){
    const p=JSON.parse(text);
    if(p.format!=='burner-project') throw new Error('not a Burner project');
    if(p.version>1) log('This project was saved by a newer Burner; some parts may be missing','warn');
    for(const o of p.objs) if(o.image){ o.blob=await (await fetch(o.image)).blob(); delete o.image; }
    return p;
  }
  const loadImg=b=>new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=()=>rej(new Error('image would not load')); im.src=URL.createObjectURL(b); });
  async function apply(p, how){
    if(job.running){ log('Stop the job before opening a project','warn'); return false; }
    const list=[];
    for(const d of p.objs){
      const o={...d};
      if(o.type==='img'){ if(!o.blob){ log('Image "'+o.name+'" is missing from the project','warn'); continue; } o.img=await loadImg(o.blob); }
      else { o.psel=new Set(); if(!o.set) o.set=defaultOps(); if(!o.pathOp) o.pathOp=o.polys.map(()=>'score'); }
      list.push(o);
    }
    objs.length=0; objs.push(...list); sel=null; cropMode=false;
    if(p.raster) writeRaster(p.raster);
    P.id=p.id||newId(); P.name=p.name||'Untitled'; $('projName').value=P.name;
    layoutChanged(); syncProps(); fitView();
    P.dirty=false; title();
    log((how||'Opened')+' project "'+P.name+'": '+list.length+' object'+(list.length===1?'':'s'),'acc');
    return true;
  }

  // ----- title / dirty / autosave -----
  function title(){ document.title=(P.name||'Untitled')+(P.dirty?' *':'')+' - Burner'; $('projDirty').textContent=P.dirty?'unsaved':'saved'; $('projDirty').className=P.dirty?'warn':'ok'; }
  let asT=0, suppress=false;
  const _lc=layoutChanged;
  layoutChanged=function(){ _lc(); if(suppress) return; P.dirty=true; title(); clearTimeout(asT); asT=setTimeout(autosave, 1500); };
  async function autosave(){
    try{ await DB.put('autosave', { t:Date.now(), proj:await serialize() }); }
    catch(e){ console.warn('autosave failed', e); }
  }

  // ----- recent -----
  async function remember(proj){
    try{
      let rec=(await DB.get('recent'))||[];
      rec=rec.filter(r=>r.id!==proj.id);
      rec.unshift({ id:proj.id, name:proj.name, t:Date.now(), n:proj.objs.length });
      for(const old of rec.slice(12)) await DB.del('proj:'+old.id);
      rec=rec.slice(0,12);
      await DB.put('proj:'+proj.id, proj); await DB.put('recent', rec);
      showRecent(rec);
    }catch(e){ console.warn('recent failed', e); }
  }
  const when=t=>{ const d=new Date(t), now=new Date(); return d.toDateString()===now.toDateString() ? d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : d.toLocaleDateString([], {month:'short',day:'numeric'}); };
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  async function showRecent(rec){
    if(!rec){ try{ rec=(await DB.get('recent'))||[]; }catch{ rec=[]; } }
    const el=$('recentList');
    if(!rec.length){ el.innerHTML='<span class="muted">No recent projects.</span>'; return; }
    el.innerHTML='<div class="arr-h">Recent</div>'+rec.map(r=>'<button class="rec" data-rec="'+esc(r.id)+'" title="Open">'+esc(r.name)+'<small>'+when(r.t)+' · '+r.n+' obj</small></button>').join('');
    el.querySelectorAll('[data-rec]').forEach(b=>b.onclick=async()=>{
      const p=await DB.get('proj:'+b.dataset.rec); if(!p){ log('That project is no longer stored','warn'); return; }
      P.handle=null; await apply(p,'Opened recent');
    });
  }

  // ----- buttons -----
  $('projName').addEventListener('change',()=>{ P.name=$('projName').value.trim()||'Untitled'; P.dirty=true; title(); });
  async function save(as){
    if(!P.name || P.name==='Untitled'){ const n=$('projName').value.trim(); if(n) P.name=n; }
    const proj=await serialize(), text=await toFileJSON(proj), fname=(P.name||'Untitled').replace(/[^\w.-]+/g,'_')+'.burner';
    try{
      if(window.showSaveFilePicker){
        if(as || !P.handle) P.handle=await window.showSaveFilePicker({ suggestedName:fname, types:[{description:'Burner project',accept:{'application/json':['.burner']}}] });
        const w=await P.handle.createWritable(); await w.write(text); await w.close();
        const nm=P.handle.name.replace(/\.burner$/,''); if(nm && nm!==P.name){ P.name=nm; $('projName').value=nm; proj.name=nm; }
      } else {
        const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type:'application/json'})); a.download=fname; a.click();
        setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
      }
    }catch(e){ if(e.name==='AbortError') return; log('Save failed: '+e.message,'bad'); return; }
    P.dirty=false; title(); remember(proj);
    log('Saved project "'+P.name+'" ('+(text.length/1024).toFixed(0)+' KB)','acc');
  }
  $('projSave').onclick=()=>save(false);
  $('projSaveAs').onclick=()=>save(true);
  $('projOpen').onclick=()=>$('projFile').click();
  $('projFile').onchange=async e=>{
    const f=e.target.files[0]; e.target.value=''; if(!f) return;
    try{ const p=await fromFileJSON(await f.text()); P.handle=null; if(!p.name) p.name=f.name.replace(/\.burner$/,''); if(await apply(p)) remember(await serialize()); }
    catch(err){ log('Open '+f.name+' failed: '+err.message,'bad'); }
  };
  let newArm=0;
  $('projNew').onclick=()=>{
    if(job.running) return;
    if(P.dirty && objs.length && !newArm){ newArm=setTimeout(()=>{ newArm=0; $('projNew').textContent='New'; $('projNew').classList.remove('armed'); }, 4000); $('projNew').textContent='Discard?'; $('projNew').classList.add('armed'); return; }
    clearTimeout(newArm); newArm=0; $('projNew').textContent='New'; $('projNew').classList.remove('armed');
    objs.length=0; sel=null; cropMode=false; P.id=newId(); P.name='Untitled'; P.handle=null; $('projName').value='';
    if(job.fromLayout) clearJob();
    layoutChanged(); syncProps(); P.dirty=false; title();
    log('New project','dim');
  };
  document.addEventListener('keydown', e=>{
    if((e.ctrlKey||e.metaKey) && (e.key==='s'||e.key==='S')){ e.preventDefault(); save(e.shiftKey); }
  });

  // ----- crash recovery -----
  async function offerRecovery(){
    let a; try{ a=await DB.get('autosave'); }catch{ return; }
    if(!a || !a.proj || !a.proj.objs.length || objs.length) return;
    const bar=$('recoverBar');
    bar.querySelector('span').textContent='Last session: "'+(a.proj.name||'Untitled')+'", '+a.proj.objs.length+' object'+(a.proj.objs.length===1?'':'s')+', autosaved '+when(a.t)+'.';
    bar.style.display='flex';
    $('recoverYes').onclick=async()=>{ bar.style.display='none'; suppress=true; try{ await apply(a.proj,'Restored'); } finally { suppress=false; } P.dirty=true; title(); };
    $('recoverNo').onclick=()=>{ bar.style.display='none'; };
  }

  title(); showRecent(); offerRecovery();
  return { serialize, apply, save, get name(){ return P.name; }, get id(){ return P.id; }, toFileJSON, fromFileJSON };
})();

// ---------- job history (per machine) ----------
const History = (()=>{
  const MAX=60;
  function thumbOf(Pv){
    const c=document.createElement('canvas'); c.width=c.height=72; const g=c.getContext('2d');
    g.fillStyle='#0b1016'; g.fillRect(0,0,72,72);
    const b=Pv && (Pv.burn||Pv.all); if(!b || !Pv.n) return c.toDataURL();
    const w=b.maxX-b.minX, h=b.maxY-b.minY, s=64/Math.max(w,h,1e-3), ox=4+(64-w*s)/2, oy=68-(64-h*s)/2;
    g.strokeStyle='#ffa24a'; g.lineWidth=1; g.beginPath();
    const step=Math.max(1,Math.floor(Pv.n/30000));
    for(let i=0;i<Pv.n;i+=step) if(Pv.type[i]===2){ g.moveTo(ox+(Pv.x0[i]-b.minX)*s, oy-(Pv.y0[i]-b.minY)*s); g.lineTo(ox+(Pv.x1[i]-b.minX)*s, oy-(Pv.y1[i]-b.minY)*s); }
    g.stroke(); return c.toDataURL('image/png');
  }
  // what to remember about a run, captured while the job state is still intact
  function capture(){
    if(!job.lines.length) return null;
    return { name:job.name, lines:job.lines, pitch:job.pitch||0, prev:job.prev, fromLayout:job.fromLayout && !layoutStale,
             secs:runSeconds(), est:job.estTotal||0, acked:job.acked, total:job.lines.length, start:Date.now()-runSeconds()*1000 };
  }
  async function record(c, result, why){
    if(!c) return;
    try{
      const m=Machines.current();
      const text=c.lines.join('\n');
      const e={ id:'h'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), machine:m.id, machineName:m.name, name:c.name,
        start:c.start, secs:c.secs, est:c.est, result, why:why||'', acked:c.acked, total:c.total, pitch:c.pitch,
        thumb:thumbOf(c.prev), gcode: text.length<=8e6 ? text : null, proj: c.fromLayout ? await Project.serialize() : null };
      await DB.hPut(e);
      const all=(await DB.hAll()).filter(x=>x.machine===m.id).sort((a,b)=>b.start-a.start);
      for(const old of all.slice(MAX)) await DB.hDel(old.id);
      render();
    }catch(err){ console.warn('history failed', err); }
  }
  const _done=jobDone;
  jobDone=function(){ const c=job.running?capture():null; _done(); record(c,'done'); };
  const _halt=haltJob;
  haltJob=function(why, lost){ const c=job.running?capture():null; _halt(why, lost); if(c) record(c, lost?'lost':'stopped', why); };

  const esc=t=>String(t).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const RES={ done:['ok','Done'], stopped:['warn','Stopped'], lost:['bad','Interrupted'] };
  async function render(){
    const el=$('histList'), m=Machines.current();
    $('histMachine').textContent='· '+m.name;
    let L=[]; try{ L=(await DB.hAll()).filter(x=>x.machine===m.id).sort((a,b)=>b.start-a.start); }catch{}
    if(!L.length){ el.innerHTML='<span class="muted">No jobs run on this machine yet.</span>'; return; }
    el.innerHTML=L.map(e=>{
      const [cls,txt]=RES[e.result]||['',e.result], d=new Date(e.start);
      const pct=e.result==='done'?'':' at '+(100*e.acked/e.total).toFixed(0)+'%';
      return '<div class="hist" data-id="'+e.id+'"><img src="'+e.thumb+'" alt=""><div class="hm"><b title="'+esc(e.name)+'">'+esc(e.name)+'</b>'+
        '<small>'+d.toLocaleDateString([], {month:'short',day:'numeric'})+' '+d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})+' · '+fmtT(e.secs)+'</small>'+
        '<span class="'+cls+'" title="'+esc(e.why)+'">'+txt+pct+'</span></div><div class="hb">'+
        (e.gcode?'<button data-h="load" title="Load exactly this G-code again (press Start to burn)">Load</button>':'')+
        (e.proj?'<button data-h="layout" title="Put this layout back on the bed">Layout</button>':'')+
        '<button data-h="del" class="icon" title="Remove from history" aria-label="Remove">&#10005;</button></div></div>';
    }).join('');
    el.querySelectorAll('.hist').forEach(row=>row.querySelectorAll('[data-h]').forEach(b=>b.onclick=()=>act(row.dataset.id, b.dataset.h)));
  }
  async function act(id, what){
    const e=(await DB.hAll()).find(x=>x.id===id); if(!e) return;
    if(what==='del'){ await DB.hDel(id); render(); return; }
    if(job.running){ log('A job is running','warn'); return; }
    if(what==='layout'){ await Project.apply(e.proj, 'Loaded layout from history:'); return; }
    if(what==='load'){
      Busy.show('Loading '+e.name);
      try{
        const res=await Jobs.run('gcode', { name:e.name, text:e.gcode, settings:{...settings}, smax:smax() }, (p,s)=>Busy.set(p,s));
        const lines=await splitLines(res.text, ()=>{});
        if(job.running) return;
        setJob(lines, e.name, e.pitch||0, false, res);
        log('Loaded "'+e.name+'" from history ('+lines.length.toLocaleString()+' lines). Press Start to burn it.','acc');
        if(typeof UI!=='undefined') UI.showTab('job');
      }catch(err){ log('Load failed: '+err.message,'bad'); }
      finally{ Busy.hide(); }
    }
  }
  $('machSel').addEventListener('change', ()=>setTimeout(render, 0));
  document.querySelector('details[data-sec="history"]').addEventListener('toggle', render);
  render();
  return { render, record };
})();
