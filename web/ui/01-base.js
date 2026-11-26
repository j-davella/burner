// ---------- App ----------
const $ = id => document.getElementById(id);
const MM = Core.MM, fmt = Core.fmt;
const { rad, oW, oH, toLocal, toWorld, objCorners, layoutBounds, joinPolys, simplify, nurbs, inPoly, isClosed,
        containedIdx, hatch, nnOrder, sq, circ, shift, buildSections } = Eng;
const parseDXF = t => Eng.parseDXF(t, log);
const estLineTimes = lines => Eng.estLineTimes(lines, settings);
const enc = new TextEncoder();
const ERR = {1:'Expected command letter',2:'Bad number format',3:'Invalid $ statement',8:"'$' command only valid when Idle",9:'G-code locked out during alarm or jog. Unlock ($X) or home.',15:'Jog target exceeds machine travel',20:'Unsupported command',22:'Feed rate undefined'};
const ALM = {1:'Hard limit hit. Position lost, rehome.',2:'Soft limit: target outside machine travel.',3:'Reset while moving. Position lost, rehome or $X.',6:'Homing failed: reset during cycle.',7:'Homing failed: door opened.',8:'Homing failed: pull-off did not clear switch.',9:'Homing failed: switch not found.'};

// ---------- persisted settings ----------
const PERSIST = ['theme','mode','baud','jogStep','jogFeedS','bedW','bedH','bedX0','bedY0','frameFeedS','frameS','rLpi','rFeedS','rPmin','rPmax','rOver','rThresh','rDither','rInvert','rBidir','haltErr'];
function loadPrefs(){ try{ const p = JSON.parse(localStorage.getItem('burner.prefs')||'{}'); for(const k of PERSIST){ if(p[k]===undefined) continue; const el=$(k); if(el.type==='checkbox') el.checked=p[k]; else el.value=p[k]; } }catch{} }
function savePrefs(){ try{ const p={}; for(const k of PERSIST){ const el=$(k); p[k]= el.type==='checkbox'?el.checked:el.value; } localStorage.setItem('burner.prefs',JSON.stringify(p)); }catch{} }
loadPrefs();
PERSIST.forEach(k=>$(k).addEventListener('change',()=>{ savePrefs(); if(k.startsWith('bed')) fitView(); }));

// ---------- console ----------
const con = $('console'); let conLines = 0;
function log(t, cls){
  const d = document.createElement('div'); if(cls) d.className=cls; d.textContent=t; con.appendChild(d);
  if(++conLines>600){ con.removeChild(con.firstChild); conLines--; }
  con.scrollTop = con.scrollHeight;
}
