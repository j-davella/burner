// ---------- App ----------
const $ = id => document.getElementById(id);
const MM = Core.MM, fmt = Core.fmt;
const { rad, oW, oH, toLocal, toWorld, objCorners, layoutBounds, joinPolys, simplify, nurbs, inPoly, isClosed,
        containedIdx, hatch, nnOrder, sq, circ, shift, buildSections } = Eng;
const parseDXF = t => Eng.parseDXF(t, log);
const estLineTimes = lines => Eng.estLineTimes(lines, settings);
const enc = new TextEncoder();
// GRBL 1.1 error codes: what went wrong, in plain English, and what to do about it.
const ERR = {
  1:'Expected a command letter. The line has a stray character; check the G-code.',
  2:'Bad number. A value is missing or not a number.',
  3:"Unknown '$' command. This controller doesn't support it.",
  4:'Negative value where only a positive one is allowed.',
  5:'Homing is not enabled ($22=0). Turn it on only if the machine has homing switches.',
  6:'Step pulse too short. $0 must be 3 us or more.',
  7:'Settings memory (EEPROM) read failed; settings went back to defaults. Check $$ and re-enter yours.',
  8:"'$' commands only work while Idle. Wait for the job to finish or STOP first.",
  9:'Locked: the controller is in alarm or jogging. Unlock ($X) or Home ($H) first.',
  10:'Soft limits ($20) need homing ($22=1) turned on first.',
  11:'Line too long for the controller; it was skipped.',
  12:'Step rate too high: a $ setting asks for more than the controller can do.',
  13:'Safety door is open.',
  14:'Startup line or build info is too long to store.',
  15:'Jog would go past the machine travel ($130/$131). Jog a smaller step.',
  16:'Bad jog command.',
  17:'Laser mode needs a PWM output on this board.',
  20:'Unsupported G-code command.',
  21:'Two commands from the same group on one line (e.g. G0 and G1).',
  22:'Feed rate not set. The job needs an F value before its first cut.',
  23:'This command needs a whole number.',
  24:'Two commands on one line both want the axis words.',
  25:'The same word appears twice on one line.',
  26:'A move command has no X/Y/Z to move to.',
  27:'Bad line number.',
  28:'A command is missing a required value.',
  29:'G59.x work coordinates are not supported.',
  30:'G53 only works with G0 and G1.',
  31:'Axis words on a line that has no move to use them.',
  32:'Arc (G2/G3) has no end point in the plane.',
  33:'Arc target is invalid (the arc math does not work out).',
  34:'Arc radius is invalid.',
  35:'Arc (G2/G3) needs I/J offsets or R.',
  36:'Unused value words on the line.',
  37:'Tool length offset is not on the configured axis.',
  38:'Tool number too large.'};
// GRBL alarm codes: [what happened, what to do, does the controller still know where the head is]
const ALM = {
  1:['Hard limit switch hit.','Make sure nothing jammed, then Home ($H). Without homing switches, Unlock ($X) and set zero again.',false],
  2:['Soft limit: a move would go outside the machine travel.','Unlock ($X), then move the job inside the bed or fix work zero. Position is still good.',true],
  3:['Reset while moving. Steps may have been lost.','Home ($H), or Unlock ($X) and set zero again before trusting positions.',false],
  4:['Probe was already touching before probing.','Check the probe, then Unlock ($X).',true],
  5:['Probe never touched.','Check the probe and the distance, then Unlock ($X).',true],
  6:['Homing stopped: reset during homing.','Home ($H) again.',false],
  7:['Homing stopped: safety door opened.','Close the door and Home ($H) again.',false],
  8:['Homing failed: pull-off did not clear the switch.','Raise $27 (pull-off distance) or check the switch wiring, then Home again.',false],
  9:['Homing failed: a limit switch was never found.','Check the switches and wiring, and that $130/$131 travel is not too short.',false],
  10:['Homing failed: the second switch on a dual axis was not found.','Check the switch wiring, then Home again.',false]};
const almText = c => ALM[c] ? ALM[c][0]+' '+ALM[c][1] : '';

// ---------- persisted settings ----------
const PERSIST = ['theme','mode','baud','jogStep','jogFeedS','bedW','bedH','bedX0','bedY0','frameFeedS','frameS','rLpi','rFeedS','rPmin','rPmax','rOver','rThresh','rDither','rInvert','rBidir','rAir','haltErr','autoReconnect'];
function loadPrefs(){ try{ const p = JSON.parse(localStorage.getItem('burner.prefs')||'{}'); for(const k of PERSIST){ if(p[k]===undefined) continue; const el=$(k); if(el.type==='checkbox') el.checked=p[k]; else el.value=p[k]; } }catch{} }
function savePrefs(){ try{ const p={}; for(const k of PERSIST){ const el=$(k); p[k]= el.type==='checkbox'?el.checked:el.value; } localStorage.setItem('burner.prefs',JSON.stringify(p)); }catch{} }
loadPrefs();
// Served from somewhere other than this PC (e.g. GitHub Pages): the bridge can't be reached
// from there (it only answers pages it served), so use the browser's Web Serial instead.
const REMOTE_PAGE = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && location.protocol!=='file:';
if(REMOTE_PAGE) $('mode').value='webserial';
PERSIST.forEach(k=>$(k).addEventListener('change',()=>{ savePrefs(); if(k.startsWith('bed')) fitView(); }));

// ---------- console ----------
const con = $('console'); let conLines = 0;
function log(t, cls){
  const d = document.createElement('div'); if(cls) d.className=cls; d.textContent=t; con.appendChild(d);
  if(++conLines>600){ con.removeChild(con.firstChild); conLines--; }
  con.scrollTop = con.scrollHeight;
}
