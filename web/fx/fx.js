// =====================================================================
// Burner effects: deep-space backdrop + 3D holographic bed (raw WebGL2).
//
// Isolated on purpose: nothing in the app depends on this file. Every entry
// point is wrapped; on any error the effects switch Off and the plain 2D map,
// STOP, streaming and editing keep working. It only READS app state
// (st, job, objs, connected, settings ...) and never sends anything to the laser.
//
// Levels:  full = 3D + bloom glow + sparks + animated nebula/stars + motion
//          lite = 3D without bloom/sparks, still backdrop, fewer redraws
//          off  = plain 2D (no WebGL at all)
// =====================================================================
(()=>{
'use strict';
const LS='burner.fx.';
const get=(k,d)=>{ try{ const v=localStorage.getItem(LS+k); return v===null?d:JSON.parse(v); }catch{ return d; } };
const put=(k,v)=>{ try{ localStorage.setItem(LS+k, JSON.stringify(v)); }catch{} };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const S = {                                   // fx state
  level: get('level2', 'lite'),               // 'lite' shows as "Simple" in Settings
  auto3d: get('auto3d2', false), sound: get('sound', false),
  view3d: false, anim: null,                  // camera animation
  cam: { yaw:0, pitch:89.5, dist:600, tx:0, ty:0 },
  warp: 0, rings: [], sparks: null, replay: { on:false, f:1, playing:false },
  lastConn: false, lastRun: false, lastState: '', dro: [null,null],
  frameMs: [], degradeWarned: false, failed: false,
};
let gl=null, cv=null, W=1, H=1, DPR=1, T0=performance.now();

function fail(where, e){
  if(S.failed) return; S.failed=true;
  console.error('Burner effects disabled ('+where+'):', e);
  try{ log('Effects turned off after an error ('+where+': '+(e&&e.message||e)+'). Everything else still works.','warn'); }catch{}
  setLevel('off', true);
}

// ---------------------------------------------------------------- math
const M4 = {
  persp(fovy, a, n, f){ const t=1/Math.tan(fovy/2), nf=1/(n-f); return new Float32Array([t/a,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0]); },
  look(e, c, u){
    let z=[e[0]-c[0],e[1]-c[1],e[2]-c[2]]; const zl=Math.hypot(...z); z=z.map(v=>v/zl);
    let x=[u[1]*z[2]-u[2]*z[1], u[2]*z[0]-u[0]*z[2], u[0]*z[1]-u[1]*z[0]]; const xl=Math.hypot(...x)||1; x=x.map(v=>v/xl);
    const y=[z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
    const d=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -d(x,e),-d(y,e),-d(z,e),1]);
  },
  mul(a,b){ const o=new Float32Array(16); for(let c=0;c<4;c++) for(let r=0;r<4;r++){ let s=0; for(let k=0;k<4;k++) s+=a[k*4+r]*b[c*4+k]; o[c*4+r]=s; } return o; },
};
const ease = t => t<.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
const rnd = (a,b)=>a+Math.random()*(b-a);

// ---------------------------------------------------------------- GL helpers
function shader(type, src){
  const s=gl.createShader(type); gl.shaderSource(s, '#version 300 es\nprecision highp float;\n'+src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: '+gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs){
  const p=gl.createProgram(); gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: '+gl.getProgramInfoLog(p));
  const u={}, n=gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for(let i=0;i<n;i++){ const info=gl.getActiveUniform(p,i); u[info.name.replace(/\[0\]$/,'')]=gl.getUniformLocation(p, info.name); }
  return { p, u };
}
// VAO with interleaved float attributes: layout = [[loc,size],...]
function vao(data, layout, usage){
  const v=gl.createVertexArray(), b=gl.createBuffer(); gl.bindVertexArray(v); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage||gl.STATIC_DRAW);
  const stride=layout.reduce((s,[,n])=>s+n,0)*4; let off=0;
  for(const [loc,n] of layout){ gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off); off+=n*4; }
  gl.bindVertexArray(null);
  return { v, b, n: data.length/(stride/4), stride };
}
function setData(o, data){ gl.bindBuffer(gl.ARRAY_BUFFER, o.b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); o.n=data.length/(o.stride/4); }
function free(o){ if(!o) return; gl.deleteBuffer(o.b); gl.deleteVertexArray(o.v); }

// ---------------------------------------------------------------- shaders
const FULL_VS = `const vec2 P[3]=vec2[](vec2(-1,-1),vec2(3,-1),vec2(-1,3)); out vec2 v_uv;
void main(){ vec2 p=P[gl_VertexID]; v_uv=p*.5+.5; gl_Position=vec4(p,0,1); }`;

const NEBULA_FS = `in vec2 v_uv; out vec4 o; uniform float u_t, u_aspect, u_alarm; uniform vec2 u_pan;
float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }
void main(){
  vec2 p=(v_uv-.5)*vec2(u_aspect,1.)*2.2+u_pan;
  float a=fbm(p*1.2+vec2(u_t*.006,-u_t*.004));
  float b=fbm(p*2.4-vec2(u_t*.01,0.)+a*1.6);
  vec3 col=vec3(.004,.010,.022);
  col+=vec3(0.,.30,.44)*pow(a*b,2.)*1.1;
  col+=vec3(.20,.04,.30)*pow(b,3.5)*.75;
  col+=vec3(0.,.12,.20)*smoothstep(.55,.95,a)*.35;
  col=mix(col, col*vec3(2.2,.35,.4)+vec3(.05,0,0), u_alarm);
  float vg=smoothstep(1.5,.35,length((v_uv-.5)*vec2(u_aspect,1.)));
  o=vec4(col*vg,1.);
}`;

const STAR_VS = `layout(location=0) in vec3 a_s; layout(location=1) in float a_tail;
uniform float u_t, u_warp, u_dpr; uniform vec2 u_drift; out float v_b;
void main(){
  float z=a_s.z; vec2 p=fract(a_s.xy+u_drift*(.25+z*.75));
  vec2 c=p-.5; float w=u_warp*(.4+z);
  vec2 q=.5+c*(1.+w*.9) - c*w*.55*a_tail;          // tail vertex streaks back toward the center
  gl_Position=vec4(q*2.-1.,0,1);
  gl_PointSize=(.7+z*1.9)*u_dpr*(1.+u_warp*.6);
  v_b=(.35+.65*z)*(.72+.28*sin(u_t*(1.+z*3.)+a_s.x*90.))*(1.-a_tail*.85)*(1.+u_warp*1.5);
}`;
const STAR_FS = `in float v_b; out vec4 o; uniform int u_pts;
void main(){ float a=v_b; if(u_pts==1){ float r=length(gl_PointCoord-.5)*2.; a*=smoothstep(1.,.0,r); }
  o=vec4(vec3(.75,.92,1.)*a, a); }`;

const LINE_VS = `layout(location=0) in vec3 a_p; layout(location=1) in vec4 a_c; uniform mat4 u_mvp; out vec4 v_c;
void main(){ v_c=a_c; gl_Position=u_mvp*vec4(a_p,1); }`;
const LINE_FS = `in vec4 v_c; out vec4 o; void main(){ o=vec4(v_c.rgb*v_c.a, v_c.a); }`;

// job toolpaths: per vertex x,y (work mm), segment index, kind (0 travel, 1..8 burn power level)
const JOB_VS = `layout(location=0) in vec2 a_xy; layout(location=1) in float a_seg; layout(location=2) in float a_k;
uniform mat4 u_mvp; uniform vec2 u_off; uniform float u_done, u_heat; out vec4 v_c;
void main(){
  bool burn=a_k>.5; float lvl=(a_k-1.)/7.;
  vec3 c; float al; float z=0.;
  if(a_seg<u_done){
    if(burn){ float age=(u_done-a_seg)/u_heat, heat=exp(-age);
      c=mix(vec3(.30,.12,.05), mix(vec3(1.,.42,.08), vec3(1.,.95,.82), smoothstep(.55,1.,heat)), smoothstep(.0,.6,heat));
      al=.55+.45*heat; z=.05+heat*.6; }
    else { c=vec3(.25,.35,.45); al=.05; }
  } else {
    if(burn){ c=vec3(1.,.48,.10); al=.07+.30*lvl; z=.02; } else { c=vec3(.45,.6,.75); al=.11; }
  }
  v_c=vec4(c,al); gl_Position=u_mvp*vec4(a_xy+u_off, z, 1);
}`;

const SPRITE_VS = `layout(location=0) in vec2 a_c; uniform mat4 u_mvp; uniform vec3 u_ctr; uniform float u_size; uniform int u_mode; uniform vec2 u_vp; out vec2 v_c;
void main(){ v_c=a_c;
  if(u_mode==1){ gl_Position=u_mvp*vec4(u_ctr+vec3(a_c*u_size,0.),1.); }
  else { vec4 c=u_mvp*vec4(u_ctr,1.); c.xy+=a_c*u_size/u_vp*2.*c.w; gl_Position=c; } }`;
const SPRITE_FS = `in vec2 v_c; out vec4 o; uniform vec4 u_col; uniform int u_shape; uniform float u_ring;
void main(){ float r=length(v_c), a;
  if(u_shape==0) a=exp(-r*r*5.)*(1.-smoothstep(.85,1.,r));
  else a=exp(-pow((r-u_ring)/.05,2.))*(1.-smoothstep(.97,1.,r));
  a*=u_col.a; o=vec4(u_col.rgb*a, a); }`;

const PT_VS = `layout(location=0) in vec3 a_p; layout(location=1) in vec4 a_c; layout(location=2) in float a_s; uniform mat4 u_mvp; uniform float u_dpr; out vec4 v_c;
void main(){ v_c=a_c; gl_Position=u_mvp*vec4(a_p,1); gl_PointSize=a_s*u_dpr; }`;
const PT_FS = `in vec4 v_c; out vec4 o; void main(){ float r=length(gl_PointCoord-.5)*2.; float a=v_c.a*smoothstep(1.,0.,r); o=vec4(v_c.rgb*a,a); }`;

// bloom
const BRIGHT_FS = `in vec2 v_uv; out vec4 o; uniform sampler2D u_tex;
void main(){ vec3 c=texture(u_tex,v_uv).rgb; float l=max(c.r,max(c.g,c.b)); o=vec4(c*smoothstep(.5,1.,l),1.); }`;
const BLUR_FS = `in vec2 v_uv; out vec4 o; uniform sampler2D u_tex; uniform vec2 u_dir;
void main(){ vec3 c=texture(u_tex,v_uv).rgb*.227;
  c+=(texture(u_tex,v_uv+u_dir*1.385).rgb+texture(u_tex,v_uv-u_dir*1.385).rgb)*.316;
  c+=(texture(u_tex,v_uv+u_dir*3.231).rgb+texture(u_tex,v_uv-u_dir*3.231).rgb)*.070; o=vec4(c,1.); }`;
const COMP_FS = `in vec2 v_uv; out vec4 o; uniform sampler2D u_scene, u_bloom; uniform float u_k;
void main(){ vec3 c=texture(u_scene,v_uv).rgb+texture(u_bloom,v_uv).rgb*u_k; o=vec4(1.-exp(-c*1.25),1.); }`;

let P={}, Q={};            // programs, quads/geometry
let stars=null, starTails=null, quad=null, empty=null;
let G={ bed:null, bedKey:'', surf:null, job:null, jobKey:'', objs:null, objKey:'', dyn:null, sparks:null };
let fb=null;               // bloom framebuffers

// ---------------------------------------------------------------- init
function init(){
  cv=document.createElement('canvas'); cv.id='gl';
  const wrap=document.getElementById('mapWrap'); wrap.insertBefore(cv, wrap.firstChild);
  gl=cv.getContext('webgl2', { antialias:true, alpha:false, premultipliedAlpha:false, powerPreference:'high-performance' });
  if(!gl) throw new Error('WebGL2 not available in this browser');
  cv.addEventListener('webglcontextlost', e=>{ e.preventDefault(); fail('context lost', 'GPU reset'); });
  P.neb=program(FULL_VS, NEBULA_FS); P.star=program(STAR_VS, STAR_FS); P.line=program(LINE_VS, LINE_FS);
  P.job=program(JOB_VS, LINE_FS.replace('in vec4 v_c;','in vec4 v_c;')); P.spr=program(SPRITE_VS, SPRITE_FS); P.pt=program(PT_VS, PT_FS);
  P.bright=program(FULL_VS, BRIGHT_FS); P.blur=program(FULL_VS, BLUR_FS); P.comp=program(FULL_VS, COMP_FS);
  empty=gl.createVertexArray();
  // stars: 1100, each as a point + a 2-vertex streak (used while warping)
  const N=1100, pts=new Float32Array(N*4), tails=new Float32Array(N*8);
  for(let i=0;i<N;i++){ const x=Math.random(), y=Math.random(), z=Math.pow(Math.random(),2.2);
    pts.set([x,y,z,0], i*4); tails.set([x,y,z,0, x,y,z,1], i*8); }
  stars=vao(pts, [[0,3],[1,1]]); starTails=vao(tails, [[0,3],[1,1]]);
  quad=vao(new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), [[0,2]]);
  G.dyn=vao(new Float32Array(7), [[0,3],[1,4]], gl.DYNAMIC_DRAW);
  G.sparks=vao(new Float32Array(8), [[0,3],[1,4],[2,1]], gl.DYNAMIC_DRAW);
  S.sparks=[];
  new ResizeObserver(()=>{ resize(); }).observe(wrap);
  resize();
  bindControls();
}
function resize(){
  const r=cv.getBoundingClientRect(); DPR=Math.min(2, window.devicePixelRatio||1);
  W=Math.max(1,Math.round(r.width*DPR)); H=Math.max(1,Math.round(r.height*DPR));
  if(cv.width!==W||cv.height!==H){ cv.width=W; cv.height=H; makeFB(); }
  S.need=true;
}
function makeFB(){
  if(!gl) return;
  if(fb){ for(const t of fb.tex) gl.deleteTexture(t); gl.deleteRenderbuffer(fb.rb); for(const f of fb.fbs) gl.deleteFramebuffer(f); }
  const tex=(w,h)=>{ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); return t; };
  const fbo=t=>{ const f=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,f); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0); return f; };
  const hw=Math.max(1,W>>2), hh=Math.max(1,H>>2);
  const scene=tex(W,H), a=tex(hw,hh), b=tex(hw,hh);
  const rb=gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, Math.min(4, gl.getParameter(gl.MAX_SAMPLES)), gl.RGBA8, W, H);
  const ms=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, ms); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
  fb={ tex:[scene,a,b], rb, ms, scene:fbo(scene), a:fbo(a), b:fbo(b), hw, hh, fbs:[] };
  fb.fbs=[ms, fb.scene, fb.a, fb.b];
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ---------------------------------------------------------------- app state access (read only)
const A = {
  ok: ()=>typeof st!=='undefined' && typeof job!=='undefined' && typeof objs!=='undefined' && typeof connected!=='undefined',
  bed: ()=>{ try{ return bedRect(); }catch{ return {x0:0,y0:0,w:400,h:400}; } },
  head: ()=> (st && st.known) ? [st.m[0], st.m[1]] : null,
  firing: ()=> st && st.known && st.s>0 && (st.state==='Run'||st.state==='Jog'),
  power: ()=>{ try{ return Math.max(0, Math.min(1, st.s/smax())); }catch{ return 0; } },
  wco: ()=> (st && st.wco) ? st.wco : [0,0,0],
};

// ---------------------------------------------------------------- geometry builders
function buildBed(){
  const b=A.bed(), key=[b.x0,b.y0,b.w,b.h].join(',');
  if(key===G.bedKey && G.bed) return;
  G.bedKey=key; free(G.bed); free(G.surf);
  const v=[], push=(x,y,z,c)=>v.push(x,y,z,c[0],c[1],c[2],c[3]);
  const minor=[0,.9,1,.10], major=[0,.9,1,.24], edge=[.2,1,1,.95];
  const IN=25.4;
  for(let x=0;x<=b.w+0.01;x+=IN){ const c=Math.round(x/IN)%6===0?major:minor; push(b.x0+x,b.y0,0,c); push(b.x0+x,b.y0+b.h,0,c); }
  for(let y=0;y<=b.h+0.01;y+=IN){ const c=Math.round(y/IN)%6===0?major:minor; push(b.x0,b.y0+y,0,c); push(b.x0+b.w,b.y0+y,0,c); }
  const X0=b.x0,Y0=b.y0,X1=b.x0+b.w,Y1=b.y0+b.h;
  for(const [a,c] of [[[X0,Y0],[X1,Y0]],[[X1,Y0],[X1,Y1]],[[X1,Y1],[X0,Y1]],[[X0,Y1],[X0,Y0]]]){ push(a[0],a[1],0,edge); push(c[0],c[1],0,edge); }
  // frame posts + top rails (the machine frame, a little above the bed)
  const fr=[0,.75,1,.35], hz=-6, rz=26, m=12;
  for(const [x,y] of [[X0-m,Y0-m],[X1+m,Y0-m],[X1+m,Y1+m],[X0-m,Y1+m]]){ push(x,y,hz,fr); push(x,y,rz,fr); }
  for(const x of [X0-m,X1+m]){ push(x,Y0-m,rz,[0,.9,1,.6]); push(x,Y1+m,rz,[0,.9,1,.6]); }
  push(X0-m,Y0-m,hz,fr); push(X1+m,Y0-m,hz,fr); push(X0-m,Y1+m,hz,fr); push(X1+m,Y1+m,hz,fr);
  push(X0-m,Y0-m,hz,fr); push(X0-m,Y1+m,hz,fr); push(X1+m,Y0-m,hz,fr); push(X1+m,Y1+m,hz,fr);
  G.bed=vao(new Float32Array(v), [[0,3],[1,4]]);
  const s=[0,.05,.08,.55], t=[];
  for(const [x,y] of [[X0,Y0],[X1,Y0],[X0,Y1],[X1,Y1]]) t.push(x,y,-.3,...s);
  G.surf=vao(new Float32Array(t), [[0,3],[1,4]]);
}
function buildJob(){
  const Pv=job.prev;
  if(Pv===G.jobKey) return; G.jobKey=Pv; free(G.job); G.job=null;
  if(!Pv || !Pv.n) return;
  const step=Math.max(1, Math.ceil(Pv.n/1.5e6));            // cap GPU memory on giant rasters (visual only)
  const cnt=Math.ceil(Pv.n/step), d=new Float32Array(cnt*8); let o=0;
  for(let i=0;i<Pv.n;i+=step){
    const k = Pv.type[i]===2 ? 1+Pv.lvl[i] : 0;
    d[o++]=Pv.x0[i]; d[o++]=Pv.y0[i]; d[o++]=i; d[o++]=k;
    d[o++]=Pv.x1[i]; d[o++]=Pv.y1[i]; d[o++]=i; d[o++]=k;
  }
  G.job=vao(d.subarray(0,o), [[0,2],[1,1],[2,1]]);
  G.job.segs=Pv.n;
}
function buildObjs(){
  const w=A.wco(), key=(typeof layoutVer!=='undefined'?layoutVer:0)+'|'+objs.length+'|'+w[0]+','+w[1]+'|'+(sel?objs.indexOf(sel):-1);
  if(key===G.objKey) return; G.objKey=key; free(G.objs); G.objs=null;
  const v=[], col={cut:[1,.3,.38,.95],score:[.24,.88,1,.9],fill:[.18,.9,.6,.85],off:[.55,.6,.66,.3]};
  for(const o of objs){
    const dim=o.on?1:.3, isSel=o===sel;
    if(o.type==='vec'){
      o.polys.forEach((p,pi)=>{ const c=col[o.pathOp[pi]]||col.off; let px,py;
        for(let i=0;i<p.length;i+=2){ const [x,y]=toWorld(o,(p[i]-o.cw/2)*o.sx,(p[i+1]-o.ch/2)*o.sy);
          if(i){ v.push(px+w[0],py+w[1],.05,c[0],c[1],c[2],c[3]*dim, x+w[0],y+w[1],.05,c[0],c[1],c[2],c[3]*dim); } px=x; py=y; } });
    }
    const cs=objCorners(o), c=isSel?[1,.6,.2,.9]:[1,1,1,.25*dim];
    for(let i=0;i<4;i++){ const a=cs[i], b=cs[(i+1)%4]; v.push(a[0]+w[0],a[1]+w[1],.05,...c, b[0]+w[0],b[1]+w[1],.05,...c); }
  }
  if(v.length) G.objs=vao(new Float32Array(v), [[0,3],[1,4]]);
}

// ---------------------------------------------------------------- camera
function fitDist(){
  const b=A.bed(), a=W/H, t=Math.tan(22.5*Math.PI/180);
  return Math.max((b.h/2*1.12)/t, (b.w/2*1.12)/(t*a));
}
function topDown(){ const b=A.bed(); return { yaw:0, pitch:89.5, dist:fitDist(), tx:b.x0+b.w/2, ty:b.y0+b.h/2 }; }
function tilted(){ const td=topDown(); return { ...td, yaw:0, pitch:58, dist:td.dist*1.22, ty:td.ty-td.dist*0.04 }; }   // straight-on tilt that keeps the whole bed in view
function animateCam(to, ms, done){ S.anim={ from:{...S.cam}, to, t0:performance.now(), ms, done }; }
function stepCam(now){
  const a=S.anim; if(!a) return false;
  const f=Math.min(1,(now-a.t0)/a.ms), e=ease(f);
  for(const k of ['yaw','pitch','dist','tx','ty']) S.cam[k]=a.from[k]+(a.to[k]-a.from[k])*e;
  if(f>=1){ S.anim=null; a.done&&a.done(); }
  return true;
}
function mvp(){
  const c=S.cam, y=c.yaw*Math.PI/180, p=c.pitch*Math.PI/180;
  const eye=[c.tx+c.dist*Math.cos(p)*Math.sin(y), c.ty-c.dist*Math.cos(p)*Math.cos(y), c.dist*Math.sin(p)];
  const up=[-Math.sin(y), Math.cos(y), 0];
  return M4.mul(M4.persp(45*Math.PI/180, W/H, c.dist*0.01, c.dist*20), M4.look(eye,[c.tx,c.ty,0],up));
}

function set3D(on){
  if(S.level==='off' && on) return;
  if(on===S.view3d && !S.anim) return;
  if(on){
    S.view3d=true; document.body.classList.add('view3d'); S.cam={...topDown()};
    animateCam(tilted(), reduced?1:350);
    hint('Drag: orbit · right-drag: pan · scroll: zoom · double-click: reset · T: back to 2D');
  } else {
    animateCam(topDown(), reduced?1:300, ()=>{ S.view3d=false; document.body.classList.remove('view3d'); hint(null); try{ dirty=true; }catch{} });
  }
  document.getElementById('view3dBtn').classList.toggle('on', on);
  S.need=true;
}
let hintSaved=null;
function hint(t){ const h=document.getElementById('mapHint'); if(!h) return; if(t){ if(hintSaved===null) hintSaved=h.textContent; h.textContent=t; } else if(hintSaved!==null){ h.textContent=hintSaved; hintSaved=null; } }

function bindControls(){
  let drag=null;
  cv.addEventListener('contextmenu', e=>e.preventDefault());
  cv.addEventListener('mousedown', e=>{ if(!S.view3d) return; S.anim=null;
    drag={ x:e.clientX, y:e.clientY, pan: e.button!==0 || e.shiftKey, cam:{...S.cam} }; });
  window.addEventListener('mouseup', ()=>{ drag=null; });
  window.addEventListener('mousemove', e=>{
    if(!drag) return; const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
    if(drag.pan){ // move the target so the bed follows the mouse: right = (cos y, sin y), forward = (-sin y, cos y)
      const k=2*S.cam.dist*Math.tan(22.5*Math.PI/180)/(H/DPR), y=S.cam.yaw*Math.PI/180, c=Math.cos(y), s_=Math.sin(y);
      S.cam.tx=drag.cam.tx - dx*k*c - dy*k*s_;
      S.cam.ty=drag.cam.ty - dx*k*s_ + dy*k*c; }
    else { S.cam.yaw=drag.cam.yaw-dx*0.3; S.cam.pitch=Math.max(8, Math.min(89.5, drag.cam.pitch+dy*0.25)); }
    S.need=true;
  });
  cv.addEventListener('wheel', e=>{ if(!S.view3d) return; e.preventDefault(); S.anim=null;
    S.cam.dist=Math.max(30, Math.min(fitDist()*4, S.cam.dist*(e.deltaY<0?1/1.12:1.12))); S.need=true; }, {passive:false});
  cv.addEventListener('dblclick', ()=>{ if(S.view3d) animateCam(tilted(), 600); });
  document.getElementById('view3dBtn').onclick=()=>set3D(!S.view3d);
  document.addEventListener('keydown', e=>{
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if(document.querySelector('#labModal.open,#settingsModal.open')) return;
    if(e.key==='t'||e.key==='T'){ set3D(!S.view3d); e.preventDefault(); }
  });
  // replay scrubber (preview only: never sends anything)
  const rng=document.getElementById('scrubRange'), play=document.getElementById('scrubPlay');
  rng.addEventListener('input', ()=>{ S.replay.on=true; S.replay.playing=false; S.replay.f=rng.value/1000; S.need=true; });
  play.onclick=()=>{ if(job.running) return; S.replay.on=true; S.replay.playing=!S.replay.playing; if(S.replay.playing && S.replay.f>=1) S.replay.f=0; S.replay.t=performance.now(); };
  // settings
  const lv=document.getElementById('fxLevel'), au=document.getElementById('fx3dAuto'), so=document.getElementById('fxSound');
  lv.value=S.level; au.checked=S.auto3d; so.checked=S.sound;
  lv.onchange=()=>{ S.degradeWarned=false; setLevel(lv.value); };
  au.onchange=()=>{ S.auto3d=au.checked; put('auto3d2', S.auto3d); };
  so.onchange=()=>{ S.sound=so.checked; put('sound', S.sound); if(S.sound) Snd.blip(880,.06); };
  // soft UI blips (only if sounds are on)
  document.addEventListener('click', e=>{ if(S.sound && e.target.closest && e.target.closest('button')) Snd.blip(e.target.closest('#stopBtn')?220:1320, .025); }, true);
}

// ---------------------------------------------------------------- sound (off by default)
const Snd = (()=>{
  let ac=null, hum=null;
  const ctx=()=>{ if(!ac){ try{ ac=new AudioContext(); }catch{ return null; } } if(ac.state==='suspended') ac.resume(); return ac; };
  function tone(f, dur, type, vol, slide){
    const a=ctx(); if(!a) return; const o=a.createOscillator(), g=a.createGain(), t=a.currentTime;
    o.type=type||'sine'; o.frequency.setValueAtTime(f,t); if(slide) o.frequency.exponentialRampToValueAtTime(slide, t+dur);
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol||.05,t+.01); g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t+dur+.02);
  }
  return {
    blip:(f,d)=>tone(f,d||.04,'sine',.03),
    connect:()=>{ tone(320,.35,'sine',.05,1280); setTimeout(()=>tone(1280,.15,'triangle',.03),300); },
    done:()=>{ [660,880,1320].forEach((f,i)=>setTimeout(()=>tone(f,.4,'sine',.05),i*120)); },
    alarm:()=>{ tone(180,.5,'sawtooth',.05,120); },
    hum(level){                                 // 0..1 while burning
      const a=ac; if(!S.sound || !a){ if(hum){ hum.g.gain.value=0; } return; }
      if(!hum){ const o=a.createOscillator(), f=a.createBiquadFilter(), g=a.createGain(); o.type='sawtooth'; o.frequency.value=58; f.type='lowpass'; f.frequency.value=240; g.gain.value=0; o.connect(f).connect(g).connect(a.destination); o.start(); hum={o,g}; }
      hum.g.gain.setTargetAtTime(level*.035, a.currentTime, .08); hum.o.frequency.setTargetAtTime(52+level*30, a.currentTime, .1);
    },
  };
})();

// ---------------------------------------------------------------- particles
function sparks(dt, hit, power){
  const L=S.sparks;
  if(hit && power>0 && S.level==='full'){
    const n=Math.min(12, Math.floor(power*14*dt*60)+ (Math.random()<power?1:0));
    for(let i=0;i<n && L.length<500;i++){ const a=Math.random()*Math.PI*2, s=rnd(15,70)*(0.4+power);
      L.push({ x:hit[0], y:hit[1], z:.3, vx:Math.cos(a)*s*.5, vy:Math.sin(a)*s*.5, vz:rnd(20,90)*(0.5+power), life:0, max:rnd(.25,.7) }); }
  }
  let o=0; const d=new Float32Array(L.length*8);
  for(let i=L.length-1;i>=0;i--){ const p=L[i]; p.life+=dt; if(p.life>p.max){ L.splice(i,1); continue; }
    p.vz-=260*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.z=Math.max(0,p.z+p.vz*dt); if(p.z===0){ p.vz*=-.3; p.vx*=.6; p.vy*=.6; }
    const t=p.life/p.max, h=1-t;
    d.set([p.x,p.y,p.z, 1, .55+.4*h, .15+.6*h*h, h, 1.5+2.5*h], o); o+=8; }
  setData(G.sparks, d.subarray(0,o));
  return L.length>0;
}

// ---------------------------------------------------------------- frame
let last=performance.now();
function frame(now){
  if(S.level==='off' || S.failed) return;
  try{ tick(now); }catch(e){ fail('frame', e); }
}
function tick(now){
  const dt=Math.max(0, Math.min(.1,(now-last)/1000)); last=Math.max(last, now);   // never negative (clock jumps)
  if(!A.ok()) return;
  events(now);
  readouts(dt);
  const moving=stepCam(now);
  const firing=A.firing();
  if(S.replay.playing){ S.replay.f=Math.min(1, S.replay.f+dt/12); if(S.replay.f>=1) S.replay.playing=false; S.need=true; }
  const full=S.level==='full';
  const animate = full && !reduced;
  const active = S.view3d && (moving || job.running || firing || S.replay.playing || S.sparks.length || S.rings.length || st.state==='Jog');
  if(!(animate || active || S.need || S.warp>0.001)) return;
  S.need=false;
  render(now, dt, full);
  // auto-degrade: Full slower than ~35 fps for 3 s -> Lite
  if(full){ S.frameMs.push(dt*1000); if(S.frameMs.length>90){ const avg=S.frameMs.reduce((a,b)=>a+b,0)/S.frameMs.length; S.frameMs.length=0;
    if(avg>28 && !document.hidden && !S.degradeWarned){ S.degradeWarned=true; setLevel('lite', true);   /* this session only; the saved choice stays */ try{ log('Effects: frames were slow ('+avg.toFixed(0)+' ms), switched to Lite. Settings > Effects to change.','dim'); }catch{} } } }
}

function render(now, dt, full){
  const t=(now-T0)/1000;
  document.body.classList.toggle('hasjob', !!(job.prev && job.prev.n));
  const use3d=S.view3d, bloom=use3d && full && fb;
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloom ? fb.ms : null);
  gl.viewport(0,0,W,H); gl.disable(gl.DEPTH_TEST);
  gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
  // nebula
  gl.disable(gl.BLEND); gl.useProgram(P.neb.p); gl.bindVertexArray(empty);
  const alarm = st.state==='Alarm' ? .6+.4*Math.sin(t*6) : 0;
  gl.uniform1f(P.neb.u.u_t, (full&&!reduced)?t:7); gl.uniform1f(P.neb.u.u_aspect, W/H); gl.uniform1f(P.neb.u.u_alarm, alarm);
  gl.uniform2f(P.neb.u.u_pan, S.cam.yaw*0.004, (89.5-S.cam.pitch)*0.004);
  gl.drawArrays(gl.TRIANGLES,0,3);
  // stars
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  S.warp=Math.max(0, S.warp-dt*0.9);
  gl.useProgram(P.star.p);
  const drift=[(full&&!reduced? t*0.0025:0)+S.cam.yaw*0.0015, (full&&!reduced? t*0.0009:0)+(89.5-S.cam.pitch)*0.002];
  gl.uniform1f(P.star.u.u_t, full&&!reduced?t:0); gl.uniform1f(P.star.u.u_warp, ease(Math.min(1,S.warp))); gl.uniform1f(P.star.u.u_dpr, DPR); gl.uniform2f(P.star.u.u_drift, drift[0], drift[1]);
  gl.uniform1i(P.star.u.u_pts, 1); gl.bindVertexArray(stars.v); gl.drawArrays(gl.POINTS, 0, stars.n);
  if(S.warp>0.01){ gl.uniform1i(P.star.u.u_pts, 0); gl.bindVertexArray(starTails.v); gl.drawArrays(gl.LINES, 0, starTails.n); }
  if(use3d) scene3d(t, dt, full);
  else if(full) S.sparks.length=0;
  gl.bindVertexArray(null);
  if(bloom) postBloom();
}

function scene3d(t, dt, full){
  buildBed();
  const M=mvp(), w=A.wco();
  // bed surface (normal blend), then everything else additive (holographic)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(P.line.p); gl.uniformMatrix4fv(P.line.u.u_mvp, false, M);
  gl.bindVertexArray(G.surf.v); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.bindVertexArray(G.bed.v); gl.drawArrays(gl.LINES, 0, G.bed.n);
  // job or layout
  const stale = typeof layoutStale!=='undefined' && layoutStale && job.fromLayout;
  let hit=A.head(), power=A.firing()?A.power():0;
  if(job.prev && job.prev.n && !stale){
    buildJob();
    let done=0; const Pv=job.prev;
    if(job.running || job.acked){ let lo=0, hi=Pv.n; while(lo<hi){ const m=(lo+hi)>>1; if(Pv.line[m]<job.acked) lo=m+1; else hi=m; } done=lo; }
    if(!job.running && S.replay.on){
      done=Math.floor(S.replay.f*Pv.n); const i=Math.max(0,Math.min(Pv.n-1,done-1));
      hit=[Pv.x1[i]+w[0], Pv.y1[i]+w[1]]; power = Pv.type[i]===2 ? (Pv.lvl[i]+1)/8 : 0;
      const sr=document.getElementById('scrubRange'); if(document.activeElement!==sr) sr.value=Math.round(S.replay.f*1000);
      document.getElementById('scrubTxt').textContent=Math.round(S.replay.f*100)+'%';
    } else if(job.running){
      const f=Pv.n?done/Pv.n:0; document.getElementById('scrubRange').value=Math.round(f*1000); document.getElementById('scrubTxt').textContent=Math.round(f*100)+'%';
    }
    if(G.job){ gl.useProgram(P.job.p); gl.uniformMatrix4fv(P.job.u.u_mvp,false,M); gl.uniform2f(P.job.u.u_off,w[0],w[1]);
      gl.uniform1f(P.job.u.u_done, done); gl.uniform1f(P.job.u.u_heat, Math.max(120, Math.min(6000, G.job.segs*0.012)));
      gl.bindVertexArray(G.job.v); gl.drawArrays(gl.LINES, 0, G.job.n); }
  } else if(objs.length){
    buildObjs();
    if(G.objs){ gl.useProgram(P.line.p); gl.bindVertexArray(G.objs.v); gl.drawArrays(gl.LINES, 0, G.objs.n); }
  }
  // gantry + head (wireframe), beam
  const b=A.bed(), hp = hit || [b.x0, b.y0], live=!!A.head() || S.replay.on;
  const v=[], push=(x,y,z,c)=>v.push(x,y,z,c[0],c[1],c[2],c[3]);
  const m=12, rz=26, gc=[0,.9,1,live?.85:.3], hc=power>0?[1,.45,.3,1]:[.4,1,1,live?.95:.35];
  push(b.x0-m,hp[1],rz,gc); push(b.x0+b.w+m,hp[1],rz,gc);                            // gantry beam
  push(b.x0-m,hp[1]-6,rz,gc); push(b.x0+b.w+m,hp[1]-6,rz,gc);
  const box=(x,y,z0,z1,s,c)=>{ const q=[[x-s,y-s],[x+s,y-s],[x+s,y+s],[x-s,y+s]];
    for(let i=0;i<4;i++){ const a=q[i], d=q[(i+1)%4]; push(a[0],a[1],z0,c); push(d[0],d[1],z0,c); push(a[0],a[1],z1,c); push(d[0],d[1],z1,c); push(a[0],a[1],z0,c); push(a[0],a[1],z1,c); } };
  box(hp[0], hp[1]-3, rz-4, rz+6, 9, gc);                                               // carriage
  box(hp[0], hp[1], 7, rz-4, 5, hc);                                                    // laser module
  push(hp[0]-2,hp[1]-2,7,hc); push(hp[0],hp[1],4,hc); push(hp[0]+2,hp[1]+2,7,hc); push(hp[0],hp[1],4,hc);   // nozzle
  if(power>0){ const bc=[1,.35+power*.3,.25,1]; for(const o of [-.25,0,.25]){ push(hp[0]+o,hp[1],4,bc); push(hp[0]+o,hp[1],0,bc); } }
  setData(G.dyn, new Float32Array(v));
  gl.useProgram(P.line.p); gl.uniformMatrix4fv(P.line.u.u_mvp,false,M);
  gl.bindVertexArray(G.dyn.v); gl.drawArrays(gl.LINES, 0, G.dyn.n);
  // glows
  gl.useProgram(P.spr.p); gl.uniformMatrix4fv(P.spr.u.u_mvp,false,M); gl.uniform2f(P.spr.u.u_vp, W, H); gl.bindVertexArray(quad.v);
  const sprite=(ctr,size,mode,col,shape,ring)=>{ gl.uniform3f(P.spr.u.u_ctr,...ctr); gl.uniform1f(P.spr.u.u_size,size); gl.uniform1i(P.spr.u.u_mode,mode);
    gl.uniform4f(P.spr.u.u_col,...col); gl.uniform1i(P.spr.u.u_shape,shape); gl.uniform1f(P.spr.u.u_ring,ring||0); gl.drawArrays(gl.TRIANGLE_STRIP,0,4); };
  if(power>0){ const fl=.85+.15*Math.sin(t*47)*Math.sin(t*31);
    sprite([hp[0],hp[1],.2], (60+90*power)*DPR*fl, 0, [1,.5,.2,.9*fl], 0);
    sprite([hp[0],hp[1],.2], (14+20*power)*DPR, 0, [1,.95,.85,1], 0);
    sprite([hp[0],hp[1],4], 18*DPR, 0, [1,.4,.3,.7], 0); }
  else if(live) sprite([hp[0],hp[1],4], 22*DPR, 0, [0,.9,1,.35+.15*Math.sin(t*3)], 0);
  // shockwave rings (job done)
  for(let i=S.rings.length-1;i>=0;i--){ const r=S.rings[i]; r.t+=dt; const f=r.t/1.4; if(f>=1){ S.rings.splice(i,1); continue; }
    sprite([r.x,r.y,.3], 10+ease(f)*Math.max(b.w,b.h)*.6, 1, [.4,1,1,(1-f)], 1, .9); }
  // sparks
  if(full){ const any=sparks(dt, power>0?[hp[0],hp[1]]:null, power);
    if(any){ gl.useProgram(P.pt.p); gl.uniformMatrix4fv(P.pt.u.u_mvp,false,M); gl.uniform1f(P.pt.u.u_dpr,DPR); gl.bindVertexArray(G.sparks.v); gl.drawArrays(gl.POINTS,0,G.sparks.n); } }
}

function postBloom(){
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb.scene);
  gl.blitFramebuffer(0,0,W,H,0,0,W,H,gl.COLOR_BUFFER_BIT,gl.NEAREST);
  gl.bindVertexArray(empty);
  const pass=(prog,target,w,h,tex,setup)=>{ gl.bindFramebuffer(gl.FRAMEBUFFER,target); gl.viewport(0,0,w,h); gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,tex); gl.uniform1i(prog.u.u_tex,0); setup&&setup(); gl.drawArrays(gl.TRIANGLES,0,3); };
  const [scene,a,b]=fb.tex;
  pass(P.bright, fb.a, fb.hw, fb.hh, scene);
  for(let i=0;i<2;i++){
    pass(P.blur, fb.b, fb.hw, fb.hh, a, ()=>gl.uniform2f(P.blur.u.u_dir, (1+i)/fb.hw, 0));
    pass(P.blur, fb.a, fb.hw, fb.hh, b, ()=>gl.uniform2f(P.blur.u.u_dir, 0, (1+i)/fb.hh));
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,W,H); gl.useProgram(P.comp.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,scene); gl.uniform1i(P.comp.u.u_scene,0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,a); gl.uniform1i(P.comp.u.u_bloom,1);
  gl.uniform1f(P.comp.u.u_k, 1.05);
  gl.drawArrays(gl.TRIANGLES,0,3);
  gl.activeTexture(gl.TEXTURE0);
}

// ---------------------------------------------------------------- app events (polled; the app is never modified)
function events(now){
  if(connected!==S.lastConn){ S.lastConn=connected; if(connected){ S.warp=1.6; if(S.sound) Snd.connect(); } S.need=true; }
  if(job.running!==S.lastRun){
    if(job.running){ S.replay.on=false; S.replay.playing=false; if(S.auto3d && !S.view3d) set3D(true); }
    S.lastRun=job.running;
  }
  // a newly finished job (keyed by its start time, so even a job shorter than one frame counts)
  if(!job.running && job.doneS && job.lines.length && job.acked>=job.lines.length && job.t0!==S.doneT0){
    const first=S.doneT0===undefined; S.doneT0=job.t0;
    if(!first || performance.now()-job.t0<60000){ shock(); if(S.sound) Snd.done(); }
  }
  const alarm=st.state==='Alarm';
  if(alarm!==(S.lastState==='Alarm')){ document.body.classList.toggle('alarm', alarm); if(alarm && S.sound) Snd.alarm(); S.need=true; }
  S.lastState=st.state;
  Snd.hum(A.firing()?A.power():0);
}
function shock(){
  const h=A.head(); if(!h) return;
  S.rings.push({x:h[0], y:h[1], t:0});
  if(!S.view3d && S.level!=='off'){ try{ const d=document.createElement('div'); d.className='shock'; d.style.left=px(h[0])+'px'; d.style.top=py(h[1])+'px';
    document.getElementById('mapWrap').appendChild(d); setTimeout(()=>d.remove(), 1200); }catch{} }
  S.need=true;
}

// ---------------------------------------------------------------- readouts: rolling position numbers + reactor gauges
function readouts(dt){
  const k = typeof connected!=='undefined' && connected && st.known;
  for(const [i,id] of [[0,'wx'],[1,'wy']]){
    const el=document.getElementById(id); if(!el) continue;
    if(!k){ S.dro[i]=null; continue; }
    const target=st.w[i]/25.4;
    if(S.dro[i]===null || reduced || Math.abs(target-S.dro[i])>200) S.dro[i]=target;
    else S.dro[i]+=(target-S.dro[i])*Math.min(1, dt*14);
    if(Math.abs(target-S.dro[i])<0.0005) S.dro[i]=target;
    const txt=S.dro[i].toFixed(3); if(el.textContent!==txt) el.textContent=txt;
  }
  const g=(id,frac,label,live)=>{ const el=document.getElementById(id); if(!el) return;
    el.querySelector('.arc').setAttribute('stroke-dasharray', (122.5*Math.max(0,Math.min(1,frac))).toFixed(1)+' 163.4');
    const b=el.querySelector('b'); if(b.textContent!==label) b.textContent=label; el.classList.toggle('live', !!live); };
  const firing=A.firing(), pw=k ? Math.round(A.power()*100*(firing?1:0)) : 0;
  g('gPower', pw/100, k?String(pw):'-', firing);
  const fmax=Math.max(1, +(settings[110]||6000)/60), f=k ? st.f/60 : 0;
  g('gSpeed', f/fmax, k?String(Math.round(f)):'-', k && f>0);
}

// ---------------------------------------------------------------- level
function setLevel(l, silent){
  S.level=['full','lite','off'].includes(l)?l:'lite';
  if(!silent) put('level2', S.level);
  document.body.classList.remove('fx-full','fx-lite','fx-off'); document.body.classList.add('fx-'+S.level);
  const sel_=document.getElementById('fxLevel'); if(sel_) sel_.value=S.level;
  if(S.level==='off'){ if(S.view3d){ S.anim=null; S.view3d=false; document.body.classList.remove('view3d'); hint(null); }
    document.querySelectorAll('details.sec').forEach(d=>{ d.style.removeProperty('--rx'); d.style.removeProperty('--ry'); });
    if(S.sparks) S.sparks.length=0; try{ dirty=true; }catch{} return; }
  if(!gl && !S.failed){ try{ init(); }catch(e){ fail('start', e); return; } }
  S.need=true;
}

// ---------------------------------------------------------------- boot
function loop(now){ frame(now); requestAnimationFrame(loop); }
try{
  setLevel(S.level, true);
  requestAnimationFrame(loop);
}catch(e){ fail('boot', e); }

// small handle for tests and the console
window.FX = { setLevel, set3D, state:S, render:(t)=>{ S.need=true; frame(t||performance.now()); }, shock };
})();
