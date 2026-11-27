// ================= TEST LAB =================
const LAB_KEY='burner.lab';
const BLOCK=25.4, PITCH=30;   // 1" block, 30 mm slot pitch
const TESTS=[
  {id:'score',  name:'Score',         kind:'vec', op:'score', desc:'Square outline, cross and a circle. Looking for a crisp, even line with no charring.', def:{power:30,feed:20,passes:1}},
  {id:'fill',   name:'Fill',          kind:'vec', op:'fill',  desc:'Hatch-filled square with a round hole. Looking for even darkness and no visible line gaps.', def:{power:40,feed:60,passes:1,interval:0.1}},
  {id:'cut16',  name:'Cut 1/16"',     kind:'vec', op:'cut', th:'1/16"', desc:'Square with a hole. The hole cuts first. Pass = both pieces fall out clean.', def:{power:100,feed:8,passes:1}},
  {id:'cut8',   name:'Cut 1/8"',      kind:'vec', op:'cut', th:'1/8"',  desc:'Square with a hole. The hole cuts first. Pass = both pieces fall out clean.', def:{power:100,feed:5,passes:2}},
  {id:'cut316', name:'Cut 3/16"',     kind:'vec', op:'cut', th:'3/16"', desc:'Square with a hole. The hole cuts first. Pass = both pieces fall out clean.', def:{power:100,feed:4,passes:3}},
  {id:'cut4',   name:'Cut 1/4"',      kind:'vec', op:'cut', th:'1/4"',  desc:'Square with a hole. The hole cuts first. Pass = both pieces fall out clean.', def:{power:100,feed:3,passes:4}},
  {id:'cut38',  name:'Cut 3/8"',      kind:'vec', op:'cut', th:'3/8"',  desc:'Square with a hole. Thick for a diode, so expect lots of passes and air assist.', def:{power:100,feed:2,passes:6}},
  {id:'gray',   name:'Grayscale photo',kind:'ras', dither:false, desc:'Gradient bar, shaded sphere, fine lines and small text, burned as grayscale. Looking for a smooth tone range.', def:{lpi:254,feed:50,pmin:0,pmax:60}},
  {id:'dither', name:'Dither photo',  kind:'ras', dither:true,  desc:'Same test image, dithered. Looking for separate dots, not mud, and readable small text.', def:{lpi:254,feed:50,pmin:0,pmax:40}},
  {id:'ramp',   name:'Power ramp',    kind:'ras', ramp:true,    desc:'10 bars from min to max power, left to right. Find the first bar that marks (your min) and where it stops getting darker (your max). Saves to Grayscale.', def:{lpi:254,feed:50,pmin:0,pmax:100}},
];
let lab={materials:{}, current:'', slot:0, cols:5};
try{ const v=JSON.parse(localStorage.getItem(LAB_KEY)||'null'); if(v) lab=Object.assign(lab,v); }catch{}
let labTest='score';
function saveLab(){ try{ localStorage.setItem(LAB_KEY, JSON.stringify(lab)); }catch(e){ log('Could not save test lab: '+e.message,'bad'); } renderMatProfiles(); }
function mat(){ if(!lab.current) return null; return lab.materials[lab.current] || (lab.materials[lab.current]={tuned:{}, attempts:[], created:Date.now()}); }
const T=id=>TESTS.find(t=>t.id===id);

// ---------- geometry ----------
function slotXY(n){ const c=Math.max(1,lab.cols|0); return [(n%c)*PITCH, Math.floor(n/c)*PITCH]; }

function testImageCanvas(t, cols, rows){
  const c=document.createElement('canvas'); c.width=cols; c.height=rows; const g=c.getContext('2d',{willReadFrequently:true});
  g.fillStyle='#fff'; g.fillRect(0,0,cols,rows);
  const W=cols, H=rows;
  if(t.ramp){
    for(let i=0;i<10;i++){ const v=Math.round(255*(1-(i+1)/10)); g.fillStyle='rgb('+v+','+v+','+v+')'; g.fillRect(Math.round(i*W/10)+1,0,Math.round(W/10)-2,H); }
    return c;
  }
  const gr=g.createLinearGradient(0,0,W,0); gr.addColorStop(0,'#000'); gr.addColorStop(1,'#fff');
  g.fillStyle=gr; g.fillRect(W*0.04,H*0.04,W*0.92,H*0.22);
  const cx=W*0.3, cy=H*0.55, r=W*0.2, rg=g.createRadialGradient(cx-r*0.35,cy-r*0.35,r*0.1,cx,cy,r);
  rg.addColorStop(0,'#eee'); rg.addColorStop(1,'#111'); g.fillStyle=rg; g.beginPath(); g.arc(cx,cy,r,0,Math.PI*2); g.fill();
  g.fillStyle='#000';
  for(let k=0;k<6;k++){ const lw=Math.max(1,Math.round((k+1)*W/254)); g.fillRect(W*0.58+k*W*0.06, H*0.36, lw, H*0.38); }
  g.font='bold '+Math.round(H*0.11)+'px sans-serif'; g.fillText('Aa 2026', W*0.06, H*0.93);
  g.font=Math.round(H*0.06)+'px sans-serif'; g.fillText('fine text 0.1', W*0.55, H*0.93);
  return c;
}

// ---------- G-code for one block ----------
function testGcode(t, v, slot){
  const [bx,by]=slotXY(slot), L=['; TEST '+t.name+' slot '+(slot+1)+(lab.current?' ('+lab.current+')':''),'G21','G90'];
  const SM=smax();
  if(t.kind==='vec'){
    Eng.testVecGcode(t, v, bx, by, SM, L);
    return {lines:L, pitch:0};
  }
  const lpi=Math.max(20,v.lpi), p=MM/lpi, n=Math.round(BLOCK*0.9/p), c=testImageCanvas(t,n,n);
  const d=c.getContext('2d').getImageData(0,0,n,n).data, dark=new Float32Array(n*n);
  for(let i=0;i<dark.length;i++) dark[i]=1-(0.299*d[i*4]+0.587*d[i*4+1]+0.114*d[i*4+2])/255;
  if(t.dither) Core.dither(dark,n,n);
  const off=(BLOCK-n*p)/2;
  const rg=Core.rasterGcode(dark,n,n,{pitch:p, feed:v.feed*60, smin:SM*v.pmin/100, smax:SM*v.pmax/100, over:1.27, thresh:0.02, bidir:true, ox:bx+off, oy:by+off});
  for(let i=0;i<rg.length;i++) L.push(rg[i]);
  return {lines:L, pitch:p};
}

// ---------- UI ----------
function labFields(t){
  if(t.kind==='vec') return [['power','Power %',1],['feed','Speed mm/s',0.5],['passes','Passes',1]].concat(t.op==='fill'?[['interval','Line interval mm',0.01]]:[]);
  return [['lpi','Lines per inch',1],['feed','Speed mm/s',5],['pmin','Min power %',1],['pmax','Max power %',1]];
}
function curVals(t){ const m=mat(); const base=(m&&m.tuned[t.id])||t.def; return {...t.def, ...base}; }
function readLab(t){ const v={}; for(const [k] of labFields(t)) v[k]=+$('lab_'+k).value; if(t.kind==='vec') v.passes=Math.max(1,Math.round(v.passes)); return v; }
function vdesc(t,v){ return t.kind==='vec' ? v.power+'% '+v.feed+'mm/s x'+v.passes+(v.interval?' @'+v.interval+'mm':'') : v.lpi+'lpi '+v.feed+'mm/s '+v.pmin+'-'+v.pmax+'%'; }
function openLab(o){ $('labModal').classList.toggle('open',o); if(o) renderLab(); }

function renderLab(){
  const dl=$('labMats'); dl.innerHTML=''; Object.keys(lab.materials).sort().forEach(n=>{ const o=document.createElement('option'); o.value=n; dl.appendChild(o); });
  if(document.activeElement!==$('labMat')) $('labMat').value=lab.current||'';
  $('labSlot').textContent=(lab.slot+1); $('labCols').value=lab.cols;
  const m=mat();
  const list=$('labList'); list.innerHTML='';
  for(const t of TESTS){
    const tuned=m&&m.tuned[t.id], n=m?m.attempts.filter(a=>a.test===t.id).length:0;
    const b=document.createElement('div'); b.className='ltest'+(t.id===labTest?' sel':'');
    b.innerHTML='<span class="ld" style="background:'+(tuned?'var(--ok)':n?'var(--warn)':'#39424e')+'"></span><span>'+t.name+'</span><span class="lc">'+(tuned?'tuned':n?n+' tries':'')+'</span>';
    b.onclick=()=>{ labTest=t.id; renderLab(); };
    list.appendChild(b);
  }
  const t=T(labTest), v=curVals(t);
  $('labTitle').textContent=t.name; $('labDesc').textContent=t.desc;
  $('labTuned').innerHTML = m&&m.tuned[t.id] ? 'Tuned: <b style="color:var(--ok)">'+vdesc(t,m.tuned[t.id])+'</b>' : (lab.current?'Not tuned yet. Starting values are placeholders.':'Pick or type a material name first.');
  const f=$('labFields'); f.innerHTML='';
  for(const [k,lbl,step] of labFields(t)){ const l=document.createElement('label'); l.textContent=lbl; const i=document.createElement('input'); i.type='number'; i.step=step; i.id='lab_'+k; i.value=v[k]; f.appendChild(l); f.appendChild(i); }
  $('labSaveBtn').textContent = t.ramp ? 'Save to Grayscale' : 'Save as tuned';
  // attempts
  const tb=$('labHist'); tb.innerHTML='';
  const at=m? m.attempts.map((a,i)=>({a,i})).filter(x=>x.a.test===t.id).reverse() : [];
  if(!at.length){ tb.innerHTML='<div class="muted">No burns yet for this test.</div>'; }
  for(const {a,i} of at){
    const r=document.createElement('div'); r.className='lrow';
    r.innerHTML='<span class="ls">#'+(a.slot+1)+'</span><span class="lv"></span>'+
      '<button class="lg'+(a.verdict==='good'?' on':'')+'" title="Good">&#10003;</button><button class="lb'+(a.verdict==='bad'?' on':'')+'" title="Bad">&#10007;</button>'+
      '<input placeholder="note" value=""><button title="Load these settings">Load</button><button class="pri" title="Save these as the tuned setting">Use</button><button class="warnb" title="Delete this burn from the log">Del</button>';
    r.querySelector('.lv').textContent=vdesc(t,a.v); const inp=r.querySelector('input'); inp.value=a.note||'';
    const [bg,bb,bl,bu,bdel]=r.querySelectorAll('button');
    armDelete(bdel, ()=>{ mat().attempts.splice(i,1); saveLab(); renderLab(); });
    bg.onclick=()=>{ a.verdict=a.verdict==='good'?'':'good'; saveLab(); renderLab(); };
    bb.onclick=()=>{ a.verdict=a.verdict==='bad'?'':'bad'; saveLab(); renderLab(); };
    inp.onchange=()=>{ a.note=inp.value; saveLab(); };
    bl.onclick=()=>{ for(const [k] of labFields(t)) if(a.v[k]!==undefined) $('lab_'+k).value=a.v[k]; };
    bu.onclick=()=>{ tune(t,a.v); a.verdict='good'; saveLab(); renderLab(); };
    tb.appendChild(r);
  }
}
function needMat(){ if(lab.current) return true; log('Type a material name in the Test Lab first (e.g. Poplar)','warn'); $('labMat').focus(); return false; }

$('labMat').addEventListener('change',()=>{ const n=$('labMat').value.trim(); lab.current=n; if(n) mat(); saveLab(); renderLab(); });
$('labCols').addEventListener('change',()=>{ lab.cols=Math.max(1,Math.min(20,+$('labCols').value||5)); saveLab(); });
$('labSlotPrev').onclick=()=>{ lab.slot=Math.max(0,lab.slot-1); saveLab(); renderLab(); };
$('labSlotNext').onclick=()=>{ lab.slot++; saveLab(); renderLab(); };
$('labSlotReset').onclick=()=>{ lab.slot=0; saveLab(); renderLab(); };
$('labPreview').onclick=()=>{
  const t=T(labTest), g=testGcode(t, readLab(t), lab.slot);
  setJob(g.lines, 'Test: '+t.name+' (slot '+(lab.slot+1)+')', g.pitch, false); dirty=true; log('Preview of '+t.name+' in slot '+(lab.slot+1)+'. Blocks start at work zero.','dim');
};
$('labBurn').onclick=()=>{
  if(!needMat()) return;
  const t=T(labTest), v=readLab(t), g=testGcode(t, v, lab.slot);
  setJob(g.lines, 'Test: '+t.name+' (slot '+(lab.slot+1)+')', g.pitch, false);
  if(!connected){ log('Not connected. Previewed only, nothing logged.','warn'); return; }
  if(job.running || st.state!=='Idle'){ log('Controller must be Idle','warn'); return; }
  mat().attempts.push({test:t.id, slot:lab.slot, v, t:Date.now(), verdict:'', note:''});
  lab.slot++; saveLab();
  openLab(false); startJob();
};
armDelete($('labUntune'), ()=>{ const m=mat(), t=T(labTest), id=t.ramp?'gray':t.id; if(!m||!m.tuned[id]) return; delete m.tuned[id]; saveLab(); log('Cleared tuned '+T(id).name+' for '+lab.current+' (presets it built stay; delete them in Settings)','dim'); renderLab(); });
armDelete($('labClearBurns'), ()=>{ const m=mat(); if(!m) return; const n=m.attempts.length; m.attempts=m.attempts.filter(a=>a.test!==labTest); saveLab(); log('Deleted '+(n-m.attempts.length)+' burns','dim'); renderLab(); });
$('labSaveBtn').onclick=()=>{ if(!needMat()) return; const t=T(labTest); tune(t, readLab(t)); renderLab(); };

// tuned setting -> material + the regular presets used in the job panels
function tune(t,v){
  const m=mat(); if(!m) return;
  const id = t.ramp ? 'gray' : t.id;
  m.tuned[id] = t.ramp ? {...curVals(T('gray')), ...v} : {...v};
  saveLab(); syncMatPresets(lab.current);
  log('Tuned '+lab.current+' / '+T(id).name+': '+vdesc(T(id), m.tuned[id]),'acc');
}
function syncMatPresets(name){
  const m=lab.materials[name]; if(!m) return;
  const tu=m.tuned, d=id=>({...T(id).def, ...(tu[id]||{})});
  const score={power:d('score').power, feed:d('score').feed, passes:d('score').passes};
  const fill={power:d('fill').power, feed:d('fill').feed, passes:d('fill').passes, interval:d('fill').interval};
  let anyCut=false;
  for(const t of TESTS.filter(t=>t.op==='cut')){
    if(!tu[t.id]) continue; anyCut=true;
    const c=tu[t.id]; upsertQuiet('vector', name+' '+t.th, {cut:{power:c.power,feed:c.feed,passes:c.passes}, score, fill});
  }
  if(!anyCut && (tu.score||tu.fill)) upsertQuiet('vector', name+' engrave', {cut:T('cut8').def, score, fill});
  for(const [id,lbl,dith] of [['gray','grayscale',false],['dither','dither',true]]){
    if(!tu[id]) continue; const r=tu[id];
    upsertQuiet('raster', name+' '+lbl, {rLpi:r.lpi, rFeedS:r.feed, rPmin:r.pmin, rPmax:r.pmax, rOver:0.05, rThresh:3, rDither:dith, rInvert:false, rBidir:true});
  }
  savePresets();
  if(typeof Material!=='undefined') Material.afterTune(name);
}
function upsertQuiet(type,name,v){ const i=presets.findIndex(p=>p.type===type&&p.name===name); if(i>=0) presets[i].v=v; else presets.push({type,name,v}); }

// ---------- report ----------
function esc(x){ return String(x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
$('labReport').onclick=()=>{
  const names = lab.current ? [lab.current] : Object.keys(lab.materials);
  if(!names.length){ log('No materials tested yet','warn'); return; }
  let h='<!DOCTYPE html><html><head><meta charset="utf-8"><title>Burner test report</title><style>body{font:13px system-ui,sans-serif;margin:28px;color:#111}h1{margin:0 0 4px}h2{margin:24px 0 6px;border-bottom:2px solid #ff7a1a;padding-bottom:3px}table{border-collapse:collapse;width:100%;margin:6px 0 14px}td,th{border:1px solid #ccc;padding:4px 7px;text-align:left}th{background:#f3f3f3}.g{color:#0a7d45;font-weight:700}.b{color:#c0142a;font-weight:700}.m{color:#777}@media print{button{display:none}}</style></head><body>';
  h+='<h1>Burner material test report</h1><div class="m">'+new Date().toLocaleString()+' &middot; $30 = '+smax()+'</div><button onclick="print()">Print</button>';
  for(const n of names){
    const m=lab.materials[n]; if(!m) continue;
    h+='<h2>'+esc(n)+'</h2><table><tr><th>Test</th><th>Tuned setting</th><th>Tries</th></tr>';
    for(const t of TESTS){ const tu=m.tuned[t.id], k=m.attempts.filter(a=>a.test===t.id).length; if(!tu&&!k) continue; h+='<tr><td>'+t.name+'</td><td>'+(tu?'<b>'+vdesc(t,tu)+'</b>':'<span class="m">not tuned</span>')+'</td><td>'+k+'</td></tr>'; }
    h+='</table><table><tr><th>Slot</th><th>Test</th><th>Settings</th><th>Result</th><th>Note</th><th>When</th></tr>';
    for(const a of m.attempts){ const t=T(a.test); h+='<tr><td>#'+(a.slot+1)+'</td><td>'+t.name+'</td><td>'+vdesc(t,a.v)+'</td><td class="'+(a.verdict==='good'?'g':a.verdict==='bad'?'b':'')+'">'+(a.verdict||'-')+'</td><td>'+esc(a.note||'')+'</td><td>'+new Date(a.t).toLocaleString()+'</td></tr>'; }
    h+='</table>';
  }
  h+='</body></html>';
  const u=URL.createObjectURL(new Blob([h],{type:'text/html'}));
  const w=window.open(u,'_blank'); if(!w){ const a=document.createElement('a'); a.href=u; a.download='burner-test-report.html'; a.click(); }
};
$('labCsv').onclick=()=>{
  const rows=[['material','slot','test','settings','result','note','time']];
  for(const [n,m] of Object.entries(lab.materials)) for(const a of m.attempts) rows.push([n,a.slot+1,T(a.test).name,vdesc(T(a.test),a.v),a.verdict||'',a.note||'',new Date(a.t).toISOString()]);
  const csv=rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='burner-tests.csv'; a.click();
};

// ---------- settings page: material profiles ----------
function renderMatProfiles(){
  const el=$('matProfiles'); if(!el) return;
  const names=Object.keys(lab.materials).sort();
  if(!names.length){ el.innerHTML='<div class="muted">None yet. Open the Test Lab, name a material and start burning blocks.</div>'; return; }
  el.innerHTML='';
  for(const n of names){
    const m=lab.materials[n], tuned=Object.keys(m.tuned);
    const r=document.createElement('div'); r.className='lrow';
    r.innerHTML='<b style="color:var(--tx);min-width:110px"></b><span class="lv"></span><button>Open in Test Lab</button><button class="warnb">Delete</button>';
    r.querySelector('b').textContent=n;
    r.querySelector('.lv').textContent=tuned.length? tuned.map(id=>T(id).name).join(', ') : 'nothing tuned yet';
    const [bo,bd]=r.querySelectorAll('button');
    bo.onclick=()=>{ lab.current=n; saveLab(); openSettings(false); openLab(true); };
    armDelete(bd, ()=>{ delete lab.materials[n]; if(lab.current===n) lab.current=''; saveLab(); log('Deleted material '+n+' (its presets stay, delete them below)','dim'); });
    el.appendChild(r);
  }
}
$('labBtn').onclick=()=>openLab(true);
$('closeLab').onclick=()=>openLab(false);
$('labModal').addEventListener('mousedown',e=>{ if(e.target.id==='labModal') openLab(false); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') openLab(false); });
renderMatProfiles();

// ---------- current material (CAM panel) ----------
// One name for everything: the Test Lab material. Picking it puts its tuned score / fill / cut
// on every vector object and its tuned grayscale or dither on every image. New SVG, DXF, shapes,
// text and images start from it. The Lab and the CAM panel always show the same material.
// Objects remember what they follow in o.preset / o.rPreset as 'mat:<name>'; editing a number
// by hand makes them '' (their own values), and a later Lab tune leaves those alone.
var Material = (()=>{
  const KEY='burner.material', CKEY='burner.materialCut';
  let cur='', cutId='';
  try{ cur=localStorage.getItem(KEY)||''; cutId=localStorage.getItem(CKEY)||''; }catch{}
  const tuned=n=>(n && lab.materials[n] && lab.materials[n].tuned) || null;
  const has=n=>{ const t=tuned(n); return !!t && Object.keys(t).length>0; };
  if(cur && !lab.materials[cur]){ const m=Object.keys(lab.materials).find(n=>cur.startsWith(n+' ')); cur=m||''; }   // old preset-style value
  const names=()=>Object.keys(lab.materials).filter(has).sort((a,b)=>a.localeCompare(b));
  const cuts=n=>{ const tu=tuned(n)||{}; return TESTS.filter(t=>t.op==='cut' && tu[t.id]); };
  const tag=()=>'mat:'+cur;
  const following=(p,name)=>p===undefined || p===null || p==='mat:'+name;

  function ops(){
    const tu=tuned(cur); if(!tu) return null;
    const d=id=>({...T(id).def, ...(tu[id]||{})}), cs=cuts(cur);
    const c=d(cs.some(t=>t.id===cutId) ? cutId : (cs[0]?cs[0].id:'cut8')), s=d('score'), f=d('fill');
    return { cut:{power:c.power,feed:c.feed,passes:c.passes}, score:{power:s.power,feed:s.feed,passes:s.passes},
             fill:{power:f.power,feed:f.feed,passes:f.passes,interval:f.interval} };
  }
  // raster settings for an image; base keeps its own dither / invert / overscan choices
  function raster(base){
    const tu=tuned(cur); if(!tu || !(tu.gray||tu.dither)) return null;
    let dith = base ? !!base.rDither : !tu.gray;
    if(!tu[dith?'dither':'gray']) dith=!dith;                      // only the other mode is tuned: use that one
    const r=tu[dith?'dither':'gray'];
    return { ...(base||readRaster()), rLpi:r.lpi, rFeedS:r.feed, rPmin:r.pmin, rPmax:r.pmax, rDither:dith };
  }
  function info(){
    const el=$('matInfo'); if(!el) return;
    const tu=tuned(cur);
    if(!tu){ el.textContent = names().length ? 'Built-in starting values.' : 'Built-in starting values. Tune a material in the Test Lab (top right) and it shows up here.'; return; }
    const p=[]; const v=(id,x)=>x.power+'% '+x.feed+'mm/s'+(x.passes>1?' x'+x.passes:'');
    if(tu.score) p.push('score '+v('score',tu.score));
    if(tu.fill) p.push('fill '+v('fill',tu.fill));
    const cs=cuts(cur), c=cs.find(t=>t.id===cutId)||cs[0]; if(c) p.push('cut '+c.th+' '+v(c.id,tu[c.id]));
    if(tu.gray) p.push('grayscale '+tu.gray.pmin+'-'+tu.gray.pmax+'% '+tu.gray.feed+'mm/s');
    if(tu.dither) p.push('dither '+tu.dither.pmin+'-'+tu.dither.pmax+'% '+tu.dither.feed+'mm/s');
    const miss=['score','fill'].filter(k=>!tu[k]).concat(cs.length?[]:['cut']).concat(tu.gray||tu.dither?[]:['images']);
    el.textContent = p.join(' · ') + (miss.length ? '. Not tuned (built-in): '+miss.join(', ')+'.' : '');
  }
  function fill(){
    const el=$('matSel'); if(!el) return;
    if(cur && !lab.materials[cur]) cur='';
    el.innerHTML='<option value="">Default settings</option>';
    for(const n of names()){ const o=document.createElement('option'); o.value=n; o.textContent=n; el.appendChild(o); }
    if(cur && !has(cur)){ const o=document.createElement('option'); o.value=cur; o.textContent=cur+' (nothing tuned yet)'; el.appendChild(o); }
    el.value=cur;
    const cs=cuts(cur), cel=$('matCut');
    cel.innerHTML=cs.map(t=>'<option value="'+t.id+'">Cut '+esc(t.th)+'</option>').join('');
    cel.style.display = cs.length>1 ? '' : 'none';
    if(cs.length) cel.value = cs.some(t=>t.id===cutId) ? cutId : cs[0].id;
    info();
  }
  // all=true: every object (picking from the menu). all=false: only objects still following it.
  function apply(name, all){
    const prev=cur; cur=name||'';
    try{ localStorage.setItem(KEY,cur); }catch{}
    if(cur && lab.current!==cur){ lab.current=cur; try{ localStorage.setItem(LAB_KEY, JSON.stringify(lab)); }catch{} }
    const v=ops(); let nv=0, ni=0;
    for(const o of objs){
      if(o.type==='vec'){
        if(!all && !following(o.preset, cur) && !following(o.preset, prev)) continue;
        if(!v && cur) continue;                    // material with nothing tuned for vectors: leave them
        o.set=JSON.parse(JSON.stringify(v||defaultOps())); o.preset = cur ? tag() : undefined; nv++;
      } else if(o.type==='img'){
        if(!all && !following(o.rPreset, cur)) continue;
        const r=raster(o.r); if(!r) continue;
        o.r=r; o.rPreset=tag(); ni++;
      }
    }
    fill();
    if(nv||ni){ layoutChanged(); syncProps(); log('Material '+(cur||'default')+': updated '+[nv?nv+' vector':'',ni?ni+' image':''].filter(Boolean).join(' and ')+' object'+(nv+ni>1?'s':''),'dim'); }
  }
  function afterTune(name){ if(!cur || cur===name) apply(name, false); else fill(); }
  $('matSel').onchange=()=>apply($('matSel').value, true);
  $('matCut').onchange=()=>{ cutId=$('matCut').value; try{ localStorage.setItem(CKEY,cutId); }catch{} apply(cur, true); };
  fill();
  return { ops, raster, fill, apply, afterTune, current:()=>cur, tag:()=>cur?tag():undefined };
})();
// The Lab's material box and the CAM material are the same thing.
// Switching an image between grayscale and dither picks up the material's tuned values for that mode.
$('rDither').addEventListener('change',()=>{ if(!sel||sel.type!=='img'||!Material.current()) return; const b=readRaster(), r=Material.raster(b); if(!r || r.rDither!==b.rDither) return; writeRaster(r); sel.r=r; sel.rPreset=Material.tag(); layoutChanged(); });
$('labMat').addEventListener('change',()=>{ const n=lab.current; if(n!==Material.current()) Material.apply(n, true); });
{ const _open=openLab; openLab=function(o){ if(o && Material.current() && lab.current!==Material.current()){ lab.current=Material.current(); } _open(o); }; }
