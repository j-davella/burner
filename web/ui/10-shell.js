// ---------- shell: two fixed panels (Machine left, CAM right), tools, shortcuts ----------
// Pure UI chrome around the existing panels. Everything here is optional sugar: if it
// failed, the machine controls, STOP and streaming would still work.
const UI = (()=>{
  const store = (k, v) => { try{ if(v===undefined) return JSON.parse(localStorage.getItem('burner.ui.'+k)); localStorage.setItem('burner.ui.'+k, JSON.stringify(v)); }catch{ return null; } };

  // No tabs any more. Older code asks for a "tab": bring that part into view instead.
  function showTab(name){
    if(name==='console'){ $('consoleSec').open=true; clearDot(); const c=$('console'); c.scrollTop=c.scrollHeight; $('consoleSec').scrollIntoView({block:'nearest'}); return; }
    if(name==='job'){ const r=$('resumeBox'); (r.hidden?$('startBtn'):r).scrollIntoView({block:'nearest'}); return; }
    if(name==='object'){ setPanel(true); $('objBox').scrollIntoView({block:'nearest'}); return; }
  }
  // errors/warnings logged while the console is closed get a dot on its heading
  function dot(){ const s=$('consoleSec').querySelector('summary'); if(!s.querySelector('.dot')){ const d=document.createElement('span'); d.className='dot'; s.appendChild(d); } }
  function clearDot(){ const d=$('consoleSec').querySelector('summary .dot'); if(d) d.remove(); }
  $('consoleSec').addEventListener('toggle', ()=>{ if($('consoleSec').open){ clearDot(); const c=$('console'); c.scrollTop=c.scrollHeight; } });
  const _log = log;
  log = function(t, cls){ _log(t, cls); if((cls==='bad'||cls==='warn') && !$('consoleSec').open) dot(); };

  // ----- collapsible sections remember open/closed -----
  const secs = store('secs2') || {};
  document.querySelectorAll('details.sec[data-sec]').forEach(d=>{
    const k=d.dataset.sec; if(k in secs) d.open=!!secs[k];
    d.addEventListener('toggle', ()=>{ secs[k]=d.open; store('secs2', secs); });
  });

  // ----- CAM panel show / hide (the Machine panel always stays) -----
  function setPanel(on){
    if(document.body.classList.contains('nopanel') !== !on){
      document.body.classList.toggle('nopanel', !on);
      store('panel', on);
      requestAnimationFrame(()=>{ resize(); dirty=true; });
      setTimeout(()=>{ resize(); dirty=true; }, 230);       // after the grid transition
    }
  }
  $('panelBtn').onclick = ()=>setPanel(false);
  $('panelShow').onclick = ()=>setPanel(true);

  // ----- tools -----
  function setTool(t){
    tool = t;
    document.querySelectorAll('#rail .tool').forEach(b=>b.classList.toggle('on', b.dataset.tool===t));
    document.body.classList.toggle('tool-pan', t==='pan');
    $('map').style.cursor = '';
    store('tool', t);
  }
  document.querySelectorAll('#rail .tool').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));

  // ----- zoom / fit -----
  function zoomBy(f){
    const [mx,my]=toMach(W/2,H/2);
    vw.sc*=f; vw.x0=mx-(mx-vw.x0)/f; vw.y0=my-(my-vw.y0)/f; viewMoved();
  }
  $('zoomInBtn').onclick = ()=>zoomBy(1.25);
  $('zoomOutBtn').onclick = ()=>zoomBy(1/1.25);
  $('fitBtn').onclick = ()=>fitView();

  // ----- shortcuts (Esc, Space, arrows, [ ] - = F live in 07-controls) -----
  document.addEventListener('keydown', e=>{
    if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if(document.querySelector('#labModal.open,#settingsModal.open,#camModal.open')) return;
    if((e.ctrlKey||e.metaKey) && (e.key==='o'||e.key==='O')){ e.preventDefault(); if(!job.running) $('imgFile').click(); return; }
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    const k=e.key;
    if(k==='v'||k==='V') setTool('select');
    else if(k==='h'||k==='H') setTool('pan');
    else if(k==='p'||k==='P') setPanel(document.body.classList.contains('nopanel'));
    else if(k==='`') showTab('console');
    else return;
    e.preventDefault();
  });

  // ----- restore -----
  setTool(store('tool')==='pan' ? 'pan' : 'select');
  if(store('panel')===false) setPanel(false);
  return { showTab, setTool, setPanel };
})();
