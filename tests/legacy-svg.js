// The ORIGINAL SVG importer (getPointAtLength sampling; O(n^2) on long paths), kept as the
// reference for tests: golden G-code cases use it so they stay byte-exact, and
// tests/svg-compare.js checks the fast importer against it geometrically.
// Needs the page globals simplify() and log().
// ----- SVG (uses the browser's own geometry engine) -----
window.legacyParseSVG = function legacyParseSVG(t){
  const doc=new DOMParser().parseFromString(t,'image/svg+xml');
  const src=doc.documentElement; if(!src || src.nodeName.toLowerCase()!=='svg') throw new Error('not an SVG');
  const host=document.createElement('div'); host.style.cssText='position:absolute;left:0;top:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(host);
  const el=document.importNode(src,true); host.appendChild(el);
  try{
    const vb=el.viewBox && el.viewBox.baseVal;
    let k=25.4/96;
    const m=/^\s*([\d.]+)\s*(mm|cm|in|pt|px)?\s*$/.exec(src.getAttribute('width')||'');
    if(m && vb && vb.width) k = (+m[1])*({mm:1,cm:10,in:25.4,pt:25.4/72,px:25.4/96}[m[2]||'px'])/vb.width;
    log('SVG scale: '+(m?src.getAttribute('width'):'no width attr, assuming 96 dpi'),'dim');
    const root=el.getScreenCTM().inverse();
    const polys=[];
    for(const g of el.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse')){
      if(g.closest('defs,clipPath,mask,symbol,marker,pattern')) continue;
      let len; try{ len=g.getTotalLength(); }catch{ continue; }
      if(!(len>0)) continue;
      const M=root.multiply(g.getScreenCTM());
      const sc=Math.sqrt(Math.abs(M.a*M.d-M.b*M.c))*k || k;
      // window.LEGACY_STEP_MM / LEGACY_MAXN: test-only overrides for a fine reference sampling (defaults = original)
      const step=Math.max(len/(window.LEGACY_MAXN||50000), (window.LEGACY_STEP_MM||0.1)/sc);       // ~0.1 mm
      const n=Math.ceil(len/step);
      const P=l=>{ const q=g.getPointAtLength(l); return [(M.a*q.x+M.c*q.y+M.e)*k, -(M.b*q.x+M.d*q.y+M.f)*k, q.x, q.y]; };
      let cur=[], prev=P(0), prevL=0; cur.push(prev[0],prev[1]);
      for(let i=1;i<=n;i++){
        const l=Math.min(len,i*step), p=P(l);
        if(Math.hypot(p[2]-prev[2],p[3]-prev[3]) > (l-prevL)*1.5+1e-6){
          // subpath jump: binary search the break
          let a=prevL, b=l;
          for(let it=0;it<30;it++){ const mid=(a+b)/2, q=P(mid); if(Math.hypot(q[2]-prev[2],q[3]-prev[3]) <= (mid-prevL)*1.5+1e-6) a=mid; else b=mid; }
          const ea=P(a); cur.push(ea[0],ea[1]); polys.push(cur);
          const sb=P(b); cur=[sb[0],sb[1]];
          if(b<l) cur.push(p[0],p[1]);
        } else cur.push(p[0],p[1]);
        prev=p; prevL=l;
      }
      polys.push(cur);
    }
    return window.LEGACY_NO_SIMPLIFY ? polys : polys.map(p=>simplify(p,0.01));
  } finally { host.remove(); }
};
