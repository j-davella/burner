// ---------- resume a stopped job from a line ----------
// Shown in the Job tab after STOP, an alarm, a controller reset or a dropped connection
// mid-job (job.halt, set by haltJob in 03-job.js). Nothing resumes by itself: the user
// picks the line, reads the position warnings, ticks the check box and presses Resume.
// The preamble (engine/gcode.js resumePreamble) rapids there with the laser off and
// restores units, distance mode, feed, laser mode, S and air before line N goes out.
const Resume = (()=>{
  const box=$('resumeBox');
  let line=-1, s=null, forT=0, marker=null;

  // default: the move the head was on when it stopped, searching back from the last
  // acked line (GRBL acks a line when it is planned, so up to ~15 moves had not run yet)
  function suggest(h){ const lo=Math.max(0,h.at-200); return h.at ? Eng.nearestLine(h.lines, lo, h.at, h.pos).line : 0; }
  function setLine(n){
    const h=job.halt; if(!h) return;
    line=Math.max(0, Math.min(h.lines.length-1, n|0));
    s=Eng.modalAt(h.lines, line);
    marker = s.why ? null : [s.x, s.y];
    $('resLine').value=line+1; $('resAck').checked=false;
    render(); dirty=true;
  }
  function warnings(h){
    const w=[];
    if(s && s.why) w.push(['bad','Cannot resume here: '+s.why+'.']);
    if(h.lost){
      if(settings[22]==='1') w.push(h.homed ? ['ok','Homed since the stop, so the position is real again.'] : ['bad','The controller may have lost its position ('+h.why+'). Home ($H) first.']);
      else w.push(['bad','No homing switches ($22=0): after a reset the controller counts from wherever the head sits now. Unless it was at the same spot, set work zero again on the same reference first or the rest burns in the wrong place.']);
    }
    if(st.known){
      const dz=Math.hypot(st.wco[0]-h.wco[0], st.wco[1]-h.wco[1]);
      if(dz>0.05) w.push(['bad','Work zero is '+(dz/MM).toFixed(3)+' in away from where it was when the job started. The rest of the job will burn relative to the new zero.']);
    }
    if(s && s.spindle==='M3') w.push(['warn','This job uses M3 (constant power): the laser comes on at the resume point a moment before it moves.']);
    w.push(['warn','Make sure the work piece has not moved and nothing is in the head\'s way.']);
    return w;
  }
  function blocked(h){
    if(!connected) return 'Connect first';
    if(job.running) return 'A job is running';
    if(!sawBanner || !st.known) return 'Waiting for the controller';
    if(st.state!=='Idle') return 'Controller is '+st.state;
    if(!s || s.why) return 'Pick another line';
    if(h.lost && settings[22]==='1' && !h.homed) return 'Home first';
    if(!$('resAck').checked) return 'Tick the check box';
    return '';
  }
  function render(){
    const h=job.halt;
    if(!h || h.lines!==job.lines || !job.lines.length){ if(!box.hidden){ box.hidden=true; marker=null; dirty=true; } return; }
    if(box.hidden){ box.hidden=false; }
    if(forT!==h.t){ forT=h.t; setLine(suggest(h)); return; }
    const n=h.lines.length, pct=100*h.at/n;
    $('resWhy').textContent=h.why;
    const left = job.cum ? fmtT(job.estTotal-job.cum[line]) : '';
    $('resWhere').innerHTML='Stopped around line <b>'+h.at.toLocaleString()+'</b> of '+n.toLocaleString()+' ('+pct.toFixed(1)+'%).'+
      (marker ? '<br>Resume rapids there with the laser off: X '+(marker[0]/MM).toFixed(3)+' Y '+(marker[1]/MM).toFixed(3)+' in (amber ring on the bed)'+(left?', about '+left+' left.':'.') : '');
    const ul=$('resWarn'), w=warnings(h), html=w.map(([c,t])=>'<li class="'+c+'">'+t.replace(/[&<>]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[x]))+'</li>').join('');
    if(ul.innerHTML!==html) ul.innerHTML=html;
    const why=blocked(h), b=$('resGo');
    b.disabled=!!why; b.title=why||'Resume the job from line '+(line+1);
    b.querySelector('span').textContent = why && why!=='Tick the check box' ? why : 'Resume from line '+(line+1).toLocaleString();
  }
  function show(){ render(); if(job.halt && (typeof UI!=='undefined') && !job.running) UI.showTab('job'); }

  async function go(){
    const h=job.halt; if(!h || blocked(h)) return;
    if(!canCommand()) return;
    if(settings[32]==='0'){ log('Refusing to resume: $32=0 (laser mode off). Send $32=1.','bad'); return; }
    if(!travelOK()) return;
    const pre=Eng.resumePreamble(s), from=line;
    job.halt=null; marker=null; render();
    log('Resuming '+job.name+' from line '+(from+1).toLocaleString()+' of '+job.lines.length.toLocaleString()+' ('+pre.join(' | ')+')','acc');
    beginRun(from, pre);
  }

  $('resLine').addEventListener('change', ()=>setLine((+$('resLine').value||1)-1));
  $('resNearest').onclick=()=>{ if(job.halt) setLine(suggest(job.halt)); };
  $('resBack').onclick=()=>{ if(job.halt) setLine(line-Math.max(1,Math.round(job.lines.length*0.002))); };
  $('resAck').addEventListener('change', render);
  $('resGo').onclick=go;
  $('resDiscard').onclick=()=>{ clearHalt(); log('Stopped job discarded (the job itself is still loaded)','dim'); };
  setInterval(render, 500);                 // warnings follow homing / zero / state changes

  function drawMarker(g){
    if(!marker || job.running || box.hidden) return;
    const x=px(marker[0]+st.wco[0]), y=py(marker[1]+st.wco[1]), t=performance.now()/600;
    g.save(); g.strokeStyle='#ffb02e'; g.fillStyle='#ffb02e'; g.lineWidth=2;
    g.beginPath(); g.arc(x,y,9+2*Math.sin(t),0,Math.PI*2); g.stroke();
    g.beginPath(); g.moveTo(x-16,y); g.lineTo(x-5,y); g.moveTo(x+5,y); g.lineTo(x+16,y); g.moveTo(x,y-16); g.lineTo(x,y-5); g.moveTo(x,y+5); g.lineTo(x,y+16); g.stroke();
    g.font='bold 10px ui-monospace,monospace'; g.fillText('RESUME '+(line+1), x+14, y-12);
    g.restore();
  }
  return { show, render, drawMarker, get line(){ return line; } };
})();
