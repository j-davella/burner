// DXF -> polylines in mm (LINE, ARC, CIRCLE, LWPOLYLINE w/ bulges, POLYLINE, ELLIPSE, SPLINE).
// No DOM. log(msg, cls) is optional.
import { rad, simplify, nurbs } from './geom.js';

export function parseDXF(t, log = () => {}){
  const L=t.split(/\r?\n/); const pr=[];
  for(let i=0;i+1<L.length;i+=2) pr.push([parseInt(L[i]), L[i+1].trim()]);
  let units=0;
  for(let i=0;i<pr.length-1;i++) if(pr[i][0]===9 && pr[i][1]==='$INSUNITS'){ units=+pr[i+1][1]; break; }
  const k = {1:25.4, 4:1, 5:10, 6:1000}[units] || 25.4;
  log('DXF units: '+({1:'inches',4:'mm',5:'cm',6:'m'}[units] || 'not set, assuming inches'),'dim');
  let i=pr.findIndex(p=>p[0]===2 && p[1]==='ENTITIES'); if(i<0) throw new Error('no ENTITIES section');
  const ents=[]; let cur=null;
  for(i=i+1;i<pr.length;i++){ const [c,v]=pr[i]; if(c===0){ if(cur) ents.push(cur); if(v==='ENDSEC'){ cur=null; break; } cur={type:v,g:[]}; } else if(cur) cur.g.push([c,v]); }
  const num=(e,c,d=0)=>{ const f=e.g.find(p=>p[0]===c); return f?parseFloat(f[1]):d; };
  const SEG=0.2; // mm per arc segment
  const arcPts=(cx,cy,r,a0,a1)=>{ const sw=a1-a0, n=Math.max(8,Math.ceil(Math.abs(rad(sw))*r/SEG)), o=[]; for(let j=0;j<=n;j++){ const a=rad(a0+sw*j/n); o.push(cx+r*Math.cos(a), cy+r*Math.sin(a)); } return o; };
  const bulgePoly=(vs,closed)=>{
    const m=vs.length, o=[]; if(m<2) return o;
    o.push(vs[0].x*k, vs[0].y*k);
    const segs = closed ? m : m-1;
    for(let j=0;j<segs;j++){
      const p=vs[j], q=vs[(j+1)%m], px_=p.x*k, py_=p.y*k, qx=q.x*k, qy=q.y*k;
      if(Math.abs(p.b)>1e-9){
        const th=4*Math.atan(p.b), dx=qx-px_, dy=qy-py_, c=Math.hypot(dx,dy);
        if(c>1e-9){
          const r=c/(2*Math.sin(th/2)), hgt=r*Math.cos(th/2), mx=(px_+qx)/2, my=(py_+qy)/2;
          const ccx=mx-dy/c*hgt, ccy=my+dx/c*hgt, a0=Math.atan2(py_-ccy,px_-ccx), R=Math.abs(r);
          const n=Math.max(4,Math.ceil(Math.abs(th)*R/SEG));
          for(let s=1;s<n;s++){ const a=a0+th*s/n; o.push(ccx+R*Math.cos(a), ccy+R*Math.sin(a)); }
        }
      }
      o.push(qx,qy);
    }
    return o;
  };
  const polys=[], skipped={}; let pl=null;
  for(const e of ents){
    const flip = num(e,230,1) < 0;
    switch(e.type){
      case 'LINE': polys.push([num(e,10)*k, num(e,20)*k, num(e,11)*k, num(e,21)*k]); break;
      case 'CIRCLE': case 'ARC': {
        let cx=num(e,10)*k, cy=num(e,20)*k, r=num(e,40)*k, a0=e.type==='ARC'?num(e,50):0, a1=e.type==='ARC'?num(e,51):360;
        if(a1<=a0) a1+=360;
        if(flip){ cx=-cx; [a0,a1]=[180-a1,180-a0]; }
        polys.push(arcPts(cx,cy,r,a0,a1)); break; }
      case 'LWPOLYLINE': {
        const vs=[]; let v=null;
        for(const [c,val] of e.g){ if(c===10){ v={x:+val,y:0,b:0}; vs.push(v); } else if(c===20&&v) v.y=+val; else if(c===42&&v) v.b=+val; }
        if(flip) vs.forEach(q=>{ q.x=-q.x; q.b=-q.b; });
        polys.push(bulgePoly(vs, num(e,70)&1)); break; }
      case 'POLYLINE': pl={closed:num(e,70)&1, vs:[]}; break;
      case 'VERTEX': if(pl) pl.vs.push({x:num(e,10), y:num(e,20), b:num(e,42)}); break;
      case 'SEQEND': if(pl){ polys.push(bulgePoly(pl.vs, pl.closed)); pl=null; } break;
      case 'ELLIPSE': {
        const cx=num(e,10)*k, cy=num(e,20)*k, mx=num(e,11)*k, my=num(e,21)*k, ratio=num(e,40,1);
        let t0=num(e,41,0), t1=num(e,42,2*Math.PI); if(t1<=t0) t1+=2*Math.PI;
        const A=Math.hypot(mx,my), B=A*ratio, R=Math.atan2(my,mx), n=Math.max(16,Math.ceil((t1-t0)*A/SEG)), o=[];
        for(let j=0;j<=n;j++){ const tt=t0+(t1-t0)*j/n; o.push(cx+A*Math.cos(tt)*Math.cos(R)-B*Math.sin(tt)*Math.sin(R), cy+A*Math.cos(tt)*Math.sin(R)+B*Math.sin(tt)*Math.cos(R)); }
        if(flip) for(let j=0;j<o.length;j+=2) o[j]=-o[j];
        polys.push(o); break; }
      case 'SPLINE': {
        const deg=num(e,71,3), knots=[], w=[], ctrl=[], fit=[]; let lastC=null, lastF=null;
        for(const [c,val] of e.g){
          if(c===40) knots.push(+val); else if(c===41) w.push(+val);
          else if(c===10){ lastC=[+val*k,0]; ctrl.push(lastC); } else if(c===20&&lastC) lastC[1]=+val*k;
          else if(c===11){ lastF=[+val*k,0]; fit.push(lastF); } else if(c===21&&lastF) lastF[1]=+val*k;
        }
        let o = ctrl.length>=2 ? nurbs(deg,knots,ctrl,w) : fit.flat();
        if(flip) for(let j=0;j<o.length;j+=2) o[j]=-o[j];
        polys.push(o); break; }
      default: skipped[e.type]=(skipped[e.type]||0)+1;
    }
  }
  const sk=Object.entries(skipped);
  if(sk.length) log('DXF skipped: '+sk.map(([t,n])=>t+' x'+n).join(', ')+(skipped.INSERT?' (INSERT = blocks; explode them before export)':''),'warn');
  return polys.map(p=>simplify(p,0.01));
}
