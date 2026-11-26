// ---------- theme ----------
const isHud=()=>document.body.classList.contains('hud');
function applyTheme(){ document.body.classList.toggle('hud', $('theme').value!=='classic'); try{ staticKey=''; dirty=true; }catch{} }
$('theme').addEventListener('change', applyTheme);
document.body.classList.toggle('hud', $('theme').value!=='classic');
(function boot(){
  if(!isHud()) return; const b=$('boot');
  const L=['BURNER // GRBL LASER CONTROL','INITIALIZING MOTION CORE.......... OK','SERIAL BRIDGE LINK................ STANDBY','RASTER / VECTOR ENGINE............ ONLINE','SAFETY INTERLOCK: ESC = STOP...... ARMED','','READY.'];
  b.innerHTML='<svg class="ring" viewBox="0 0 100 100"><g style="transform-origin:50% 50%;animation:spin 2s linear infinite"><circle cx="50" cy="50" r="44" fill="none" stroke="#00e5ff" stroke-width="2" stroke-dasharray="40 14" style="filter:drop-shadow(0 0 6px #00e5ff)"/></g><g style="transform-origin:50% 50%;animation:spin 1.2s linear infinite reverse"><circle cx="50" cy="50" r="32" fill="none" stroke="#7ff3ff" stroke-width="1.5" stroke-dasharray="6 6"/></g><circle cx="50" cy="50" r="12" fill="#7ff3ff" style="filter:drop-shadow(0 0 10px #00e5ff)"/></svg>'+L.map((l,i)=>'<div class="ln" style="animation-delay:'+(i*0.14)+'s">'+(l||' ')+'</div>').join('');
  b.classList.add('go'); const end=()=>{ b.style.opacity='0'; setTimeout(()=>b.classList.remove('go'),400); };
  b.onclick=end; setTimeout(end,1500);
})();
function updateHudStrip(){
  if(!isHud()) return;
  const k=(a,b,c)=>'<span><span class="k">'+a+'</span> <span class="'+(c||'')+'">'+b+'</span></span>';
  const n=job.lines.length;
  $('hudStrip').innerHTML =
    k('LINK', connected?($('mode').value==='bridge'?'BRIDGE':'WEBSERIAL'):'OFFLINE', connected?'on':'off')+
    k('STATE', connected&&st.known?st.state.toUpperCase():'--')+
    k('BUF', connected? bufUsed+'/'+rxSize : '--')+
    k('LASER', st.s>0&&st.state==='Run' ? 'FIRING' : 'SAFE', st.s>0&&st.state==='Run'?'off':'on')+
    k('JOB', n? (job.running? (100*$('prog').value).toFixed(1)+'%' : (layoutStale?'STALE':'READY')) : 'NONE')+
    k('OBJ', objs.filter(o=>o.on).length+'/'+objs.length);
}

// ---------- material presets ----------
const PRE_KEY='burner.presets';
let presets=[]; try{ presets=JSON.parse(localStorage.getItem(PRE_KEY)||'[]'); }catch{}
function savePresets(){ try{ localStorage.setItem(PRE_KEY, JSON.stringify(presets)); }catch(e){ log('Could not save presets: '+e.message,'bad'); } listPresets(); }
const RFIELDS=['rLpi','rFeedS','rPmin','rPmax','rOver','rThresh','rDither','rInvert','rBidir'];
function fillPresetSel(id,type,pick){
  const el=$(id), cur=pick!==undefined?pick:el.value; el.innerHTML='<option value="">Material preset...</option>';
  presets.filter(p=>p.type===type).sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{ const o=document.createElement('option'); o.value=p.name; o.textContent=p.name; el.appendChild(o); });
  el.value=[...el.options].some(o=>o.value===cur)?cur:'';
}
function vecSet(v){ return v.cut ? v : { cut:{power:100,feed:5,passes:2}, score:{power:v.power,feed:v.feed,passes:v.passes}, fill:{power:40,feed:60,passes:1,interval:0.1} }; }
function vecDesc(v){ v=vecSet(v); return 'cut '+v.cut.power+'%/'+v.cut.feed+'mm/s x'+v.cut.passes+', score '+v.score.power+'%/'+v.score.feed+', fill '+v.fill.power+'%/'+v.fill.feed+' @'+v.fill.interval+'mm'; }
function rasterDesc(v){ return v.rLpi+' lpi, '+v.rFeedS+' mm/s, '+v.rPmin+'-'+v.rPmax+'%'+(v.rDither?', dithered':'')+(v.rInvert?', inverted':''); }
function listPresets(){
  fillPresetSel('rPreset','raster'); fillPresetSel('vPreset','vector');
  const el=$('presetList'); el.innerHTML='';
  if(!presets.length){ el.textContent='None saved yet.'; return; }
  presets.slice().sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name)).forEach(p=>{
    const r=document.createElement('div'); r.className='lrow';
    r.innerHTML='<span class="ls" style="min-width:56px">'+(p.type==='raster'?'RASTER':'VECTOR')+'</span><b style="color:var(--tx);min-width:140px"></b><span class="lv" style="font-size:11px;color:var(--dim)"></span><button class="warnb">Delete</button>';
    r.querySelector('b').textContent=p.name; r.querySelector('.lv').textContent=p.type==='raster'?rasterDesc(p.v):vecDesc(p.v);
    armDelete(r.querySelector('button'), ()=>{ presets=presets.filter(q=>q!==p); savePresets(); log('Deleted preset "'+p.name+'"','dim'); });
    el.appendChild(r);
  });
}
function armDelete(btn, fn){ btn.onclick=()=>{ if(btn.dataset.armed){ fn(); } else { btn.dataset.armed='1'; const t=btn.textContent; btn.textContent='Sure?'; setTimeout(()=>{ btn.textContent=t; delete btn.dataset.armed; },2500); } }; }
function upsert(type,name,v){
  const i=presets.findIndex(p=>p.type===type&&p.name===name);
  if(i>=0) presets[i].v=v; else presets.push({type,name,v});
  savePresets(); log((i>=0?'Updated':'Saved')+' '+type+' preset "'+name+'"','acc');
}
$('rSaveAs').onclick=()=>{
  const name=$('rPresetName').value.trim(); if(!name){ log('Type a name for the preset first','warn'); $('rPresetName').focus(); return; }
  const v=readRaster();
  upsert('raster',name,v); fillPresetSel('rPreset','raster',name); $('rPresetName').value='';
};
$('rPreset').onchange=()=>{
  const p=presets.find(p=>p.type==='raster'&&p.name===$('rPreset').value); if(!p) return;
  writeRaster(p.v);
  savePrefs(); if(sel&&sel.type==='img'){ sel.r=readRaster(); sel.rPreset=p.name; layoutChanged(); } log('Raster preset: '+p.name+' ('+rasterDesc(p.v)+')','dim');
};
armDelete($('rPresetDel'), ()=>{ const n=$('rPreset').value; if(!n){ log('Pick a preset in the dropdown first','warn'); return; } presets=presets.filter(p=>!(p.type==='raster'&&p.name===n)); savePresets(); log('Deleted raster preset "'+n+'"','dim'); });
$('vSaveAs').onclick=()=>{
  if(!sel||sel.type!=='vec') return;
  const name=$('vPresetName').value.trim(); if(!name){ log('Type a name for the preset first','warn'); $('vPresetName').focus(); return; }
  upsert('vector',name,JSON.parse(JSON.stringify(sel.set))); fillPresetSel('vPreset','vector',name); $('vPresetName').value='';
};
$('vPreset').onchange=()=>{
  const p=presets.find(p=>p.type==='vector'&&p.name===$('vPreset').value); if(!p||!sel||sel.type!=='vec') return;
  sel.set=JSON.parse(JSON.stringify(vecSet(p.v))); sel.preset=p.name; layoutChanged();
};
armDelete($('vPresetDel'), ()=>{ const n=$('vPreset').value; if(!n){ log('Pick a preset in the dropdown first','warn'); return; } presets=presets.filter(p=>!(p.type==='vector'&&p.name===n)); savePresets(); log('Deleted vector preset "'+n+'"','dim'); });
$('presetExport').onclick=()=>{
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(presets,null,2)],{type:'application/json'})); a.download='burner-presets.json'; a.click();
};
$('presetImport').onclick=()=>$('presetFile').click();
$('presetFile').onchange=async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{ const arr=JSON.parse(await f.text()); let n=0; for(const p of arr) if(p&&p.name&&(p.type==='raster'||p.type==='vector')&&p.v){ const i=presets.findIndex(q=>q.type===p.type&&q.name===p.name); if(i>=0) presets[i]=p; else presets.push(p); n++; } savePresets(); log('Imported '+n+' presets','acc'); }
  catch(err){ log('Import failed: '+err.message,'bad'); }
  e.target.value='';
};
listPresets();
RFIELDS.forEach(id=>$(id).addEventListener('change',()=>{ if(sel&&sel.type==='img'){ sel.r=readRaster(); sel.rPreset=''; layoutChanged(); } }));

// ---------- settings modal ----------
function openSettings(o){ $('settingsModal').classList.toggle('open', o); if(o) fillMotion(); }
$('gearBtn').onclick=()=>openSettings(true);
$('closeSettings').onclick=()=>openSettings(false);
$('settingsModal').addEventListener('mousedown',e=>{ if(e.target.id==='settingsModal') openSettings(false); });
const MOTION=[['accX',120,1],['accY',121,1],['maxX',110,1/60],['maxY',111,1/60]];
function fillMotion(){ for(const [id,n,k] of MOTION){ if(document.activeElement!==$(id)) $(id).value = settings[n]!==undefined ? +(+settings[n]*k).toFixed(2) : ''; } }
$('writeCfgBtn').onclick=()=>{
  if(!canCommand()) return;
  const cmds=[];
  for(const [id,n,k] of MOTION){ const v=parseFloat($(id).value); if(!isFinite(v)||v<=0) continue; const raw=+(v/k).toFixed(3); if(settings[n]===undefined || Math.abs(+settings[n]-raw)>1e-6) cmds.push('$'+n+'='+raw); }
  if(!cmds.length){ log('Nothing changed','dim'); return; }
  queue(...cmds,'$$'); log('Writing '+cmds.join(' '),'warn');
};
$('useTravelBtn').onclick=()=>{
  if(!settings[130]){ log('Read $$ first (connect to the laser)','warn'); return; }
  $('bedW').value=(+settings[130]/MM).toFixed(3); $('bedH').value=(+settings[131]/MM).toFixed(3); savePrefs(); fitView();
};
