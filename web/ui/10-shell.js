// ---------- shell: inspector tabs, collapsible sections, tools, rail, shortcuts ----------
// Pure UI chrome around the existing panels. Everything here is optional sugar: if it
// failed, the machine controls, STOP and streaming would still work.
const UI = (()=>{
  const store = (k, v) => { try{ if(v===undefined) return JSON.parse(localStorage.getItem('burner.ui.'+k)); localStorage.setItem('burner.ui.'+k, JSON.stringify(v)); }catch{ return null; } };
  let tab = 'job';

  // ----- tabs -----
  function showTab(name){
    if(!document.querySelector('.pane[data-pane="'+name+'"]')) return;
    tab = name;
    document.querySelectorAll('.tabs [data-tab]').forEach(b=>{ const on=b.dataset.tab===name; b.classList.toggle('on',on); b.setAttribute('aria-selected',on); });
    document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on', p.dataset.pane===name));
    if(name==='console'){ clearDot('console'); const c=$('console'); c.scrollTop=c.scrollHeight; }
    if(document.body.classList.contains('nopanel')) setPanel(true);
    store('tab', name);
  }
  document.querySelectorAll('.tabs [data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
  document.querySelectorAll('[data-tab-go]').forEach(b=>b.onclick=()=>showTab(b.dataset.tabGo));
  function dot(name){ const b=document.querySelector('.tabs [data-tab="'+name+'"]'); if(b && !b.querySelector('.dot')){ const d=document.createElement('span'); d.className='dot'; b.appendChild(d); } }
  function clearDot(name){ const d=document.querySelector('.tabs [data-tab="'+name+'"] .dot'); if(d) d.remove(); }

  // errors/warnings logged while the console is hidden get a dot on its tab
  const _log = log;
  log = function(t, cls){ _log(t, cls); if((cls==='bad'||cls==='warn') && (tab!=='console' || document.body.classList.contains('nopanel'))) dot('console'); };

  // selecting an object from the Job tab jumps to its settings
  let lastSel = null;
  const _sync = syncProps;
  syncProps = function(){ _sync(); if(sel!==lastSel){ if(sel && tab==='job') showTab('object'); lastSel=sel; } };

  // ----- collapsible sections remember open/closed -----
  const secs = store('secs') || {};
  document.querySelectorAll('details.sec[data-sec]').forEach(d=>{
    const k=d.dataset.sec; if(k in secs) d.open=!!secs[k];
    d.addEventListener('toggle', ()=>{ secs[k]=d.open; store('secs', secs); });
  });

  // ----- side panel -----
  function setPanel(on){
    document.body.classList.toggle('nopanel', !on);
    $('panelBtn').classList.toggle('on', on);
    store('panel', on);
    requestAnimationFrame(()=>{ resize(); dirty=true; });
    setTimeout(()=>{ resize(); dirty=true; }, 230);       // after the grid transition
  }
  $('panelBtn').onclick = ()=>setPanel(document.body.classList.contains('nopanel'));

  // ----- tools -----
  function setTool(t){
    tool = t;
    document.querySelectorAll('#rail .tool').forEach(b=>b.classList.toggle('on', b.dataset.tool===t));
    document.body.classList.toggle('tool-pan', t==='pan');
    $('map').style.cursor = '';
    store('tool', t);
  }
  document.querySelectorAll('#rail .tool').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));

  // ----- zoom / fit / add -----
  function zoomBy(f){
    const [mx,my]=toMach(W/2,H/2);
    vw.sc*=f; vw.x0=mx-(mx-vw.x0)/f; vw.y0=my-(my-vw.y0)/f; viewMoved();
  }
  $('zoomInBtn').onclick = ()=>zoomBy(1.25);
  $('zoomOutBtn').onclick = ()=>zoomBy(1/1.25);
  $('fitBtn').onclick = ()=>fitView();
  $('railAdd').onclick = ()=>{ if(!job.running) $('imgFile').click(); };

  // ----- shortcuts (Esc, Space, arrows, [ ] - = F live in 07-controls) -----
  document.addEventListener('keydown', e=>{
    if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if(document.querySelector('#labModal.open,#settingsModal.open')) return;
    if((e.ctrlKey||e.metaKey) && (e.key==='o'||e.key==='O')){ e.preventDefault(); if(!job.running) $('imgFile').click(); return; }
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    const k=e.key;
    if(k==='v'||k==='V') setTool('select');
    else if(k==='h'||k==='H') setTool('pan');
    else if(k==='p'||k==='P') setPanel(document.body.classList.contains('nopanel'));
    else if(k==='m'||k==='M') showTab('machine');
    else if(k==='`') showTab('console');
    else if(k>='1' && k<='4') showTab(['job','object','machine','console'][+k-1]);
    else return;
    e.preventDefault();
  });

  // ----- restore -----
  setTool(store('tool')==='pan' ? 'pan' : 'select');
  if(store('panel')===false) setPanel(false); else $('panelBtn').classList.add('on');
  showTab(store('tab') || 'job');
  return { showTab, setTool, setPanel };
})();
