/* =====================================================================
   Skins pack: new pattern painters, weapon/knife finishes and five cases
   (Jungle, Midnight, Forge, Coastline and the knives-only Blade Case).
   Every id made here starts with 'skins_'.
   ===================================================================== */

// knife model names (the models come from the knives pack; only filled in when that pack is absent)
for(const [k,n] of [['knife_hook','Hook Knife'],['knife_spire','Spire Bayonet'],['knife_flip','Flip Knife'],['knife_ridge','Ridgeback'],['knife_moth','Moth Knife']])
  if(!KNIVES[k])KNIVES[k]={name:n};

/* ------------------------------ helpers ------------------------------ */
const skins_rgb=c=>{c=c.replace('#','');if(c.length===3)c=c.split('').map(x=>x+x).join('');const n=parseInt(c,16);return[n>>16&255,n>>8&255,n&255];};
const skins_mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const skins_clamp=(x,a=0,b=1)=>x<a?a:x>b?b:x;
const skins_smooth=(e0,e1,x)=>{const t=skins_clamp((x-e0)/(e1-e0));return t*t*(3-2*t);};
// colour ramp through a list of rgb triples, t in 0..1
function skins_ramp(P,t){t=skins_clamp(t)*(P.length-1);const i=Math.min(P.length-2,Math.floor(t));return skins_mix(P[i],P[i+1],t-i);}
// tileable value noise / fbm: n(u,v,px,py,octaves) with u,v in 0..1, px/py lattice cells per tile
function skins_noise(){
  const L={};
  const val=(u,v,px,py)=>{const key=px*4096+py;const t=L[key]||(L[key]=Float32Array.from({length:px*py},Math.random));
    let x=u*px,y=v*py;x-=Math.floor(x/px)*px;y-=Math.floor(y/py)*py;const ix=Math.floor(x)%px,iy=Math.floor(y)%py,fx=x-Math.floor(x),fy=y-Math.floor(y);
    const x1=(ix+1)%px,y1=(iy+1)%py,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
    const a=t[iy*px+ix],b=t[iy*px+x1],c=t[y1*px+ix],d=t[y1*px+x1];return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy;};
  return (u,v,px,py,oct)=>{let s=0,amp=1,tot=0;for(let o=0;o<(oct||1);o++){s+=val(u,v,px<<o,py<<o)*amp;tot+=amp;amp*=0.5;}return s/tot;};
}
// evaluates fn(u,v) over the canvas into a float field normalised to 0..1
function skins_field(w,h,fn){const f=new Float32Array(w*h);let lo=1e9,hi=-1e9;
  for(let y=0,i=0;y<h;y++)for(let x=0;x<w;x++,i++){const v=fn(x/w,y/h);f[i]=v;if(v<lo)lo=v;if(v>hi)hi=v;}
  const k=1/((hi-lo)||1);for(let i=0;i<f.length;i++)f[i]=skins_clamp((f[i]-lo)*k);return f;}
// writes pixels: fn(u,v,index) returns [r,g,b] or null to keep what is there
function skins_paint(g,w,h,fn){const im=g.getImageData(0,0,w,h),d=im.data;
  for(let y=0,i=0;y<h;y++)for(let x=0;x<w;x++,i++){const c=fn(x/w,y/h,i);if(c){const j=i*4;d[j]=c[0];d[j+1]=c[1];d[j+2]=c[2];d[j+3]=255;}}g.putImageData(im,0,0);}
// jittered grid of cell points (tileable voronoi)
function skins_points(n,jit){const P=[];for(let i=0;i<n;i++)for(let j=0;j<n;j++)P.push([(i+0.5+(Math.random()-0.5)*jit)/n,(j+0.5+(Math.random()-0.5)*jit)/n]);return P;}
// returns [f1, f2, id] wrapped distances
function skins_vor(P,u,v){let d1=9,d2=9,id=0;for(let i=0;i<P.length;i++){let dx=Math.abs(u-P[i][0]),dy=Math.abs(v-P[i][1]);if(dx>0.5)dx=1-dx;if(dy>0.5)dy=1-dy;const d=dx*dx+dy*dy;
  if(d<d1){d2=d1;d1=d;id=i;}else if(d<d2)d2=d;}return[Math.sqrt(d1),Math.sqrt(d2),id];}
const skins_hue=(h,s,l)=>{const f=n=>{const k=(n+h*12)%12,a=s*Math.min(l,1-l);return 255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)));};return[f(0),f(8),f(4)];};
const skins_css=c=>`rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;

/* ------------------------------ pattern painters ------------------------------ */
Object.assign(PATTERNS,{
  // thin-film oil sheen over dark blued steel
  skins_oilslick(g,w,h,C,wrapDraw,F){const film=F.film||1,cyc=F.cycles||2.2;const N=skins_noise(),base=skins_rgb(C[0]),tint=skins_rgb(C[1]||C[0]);
    const f=skins_field(w,h,(u,v)=>{const wx=N(u,v,3,3,3),wy=N(u+0.37,v+0.71,3,3,3);return N(u+wx*0.5,v+wy*0.5,2,2,4);});
    const m=skins_field(w,h,(u,v)=>N(u,v,4,4,3));
    skins_paint(g,w,h,(u,v,i)=>{const t=f[i]*cyc;const r=[0.5+0.5*Math.cos(6.283*(t)),0.5+0.5*Math.cos(6.283*(t+0.33)),0.5+0.5*Math.cos(6.283*(t+0.67))].map(x=>x*235+10);
      const k=(0.25+0.6*skins_smooth(0.2,0.8,m[i]))*film;return skins_mix(skins_mix(base,tint,0.4*(1-m[i])),r,k);});},
  // case-hardened steel: blue / straw-gold / purple heat patina over bare steel
  skins_casehard(g,w,h,C){const N=skins_noise(),P=C.slice(1).map(skins_rgb),steel=skins_rgb(C[0]),n=P.length;
    const f=skins_field(w,h,(u,v)=>{const a=N(u,v,3,3,3),b=N(u+0.5,v+0.3,3,3,3);return N(u+a*0.8,v+b*0.8,4,4,5);});
    const m=skins_field(w,h,(u,v)=>{const a=N(u,v,4,4,2);return N(u+a*0.4,v,5,5,4);});
    skins_paint(g,w,h,(u,v,i)=>{const t=f[i]*(n-0.001),k=skins_clamp(Math.floor(t),0,n-1),fr=skins_smooth(0.25,0.75,t-k);const c=skins_mix(P[k],P[Math.min(n-1,k+1)],fr);
      const fine=N(u,v,32,32,2);return skins_mix(skins_mix(steel,[255,255,255],0.15*fine),skins_mix(c,[0,0,0],0.25*fine),skins_smooth(0.3,0.45,m[i]));});},
  // overlapping dragon / reptile scales; C: [gap, centre, edge, rim]
  skins_scales(g,w,h,C){const s=w/8,R=s*0.62,c1=skins_rgb(C[1]),c2=skins_rgb(C[2]),rim=C[3]||C[0];
    const sh=(i,j)=>{const x=Math.sin((((i%8)+8)%8)*12.9898+(((j%16)+16)%16)*78.233)*43758.5453;return x-Math.floor(x);};
    for(let j=17;j>=-2;j--)for(let i=-1;i<=9;i++){const x=i*s+(j&1?s/2:0),y=j*s/2,k=0.75+0.5*sh(i,j);
      const gr=g.createRadialGradient(x-R*0.15,y+R*0.35,R*0.05,x,y+R*0.1,R*1.05);gr.addColorStop(0,skins_css(skins_mix(c1,[255,255,255],0.3*k)));gr.addColorStop(0.45,skins_css(skins_mix(c1,c2,0.25*k)));gr.addColorStop(0.85,skins_css(c2));gr.addColorStop(1,skins_css(skins_mix(c2,[0,0,0],0.5)));
      g.fillStyle=gr;g.beginPath();g.arc(x,y,R,0,Math.PI*2);g.fill();g.strokeStyle=rim;g.lineWidth=2;g.beginPath();g.arc(x,y,R-1,0.2*Math.PI,0.8*Math.PI);g.stroke();}},
  // branching lightning bolts with a glow over storm clouds; C: [sky, glow, core, cloud]
  skins_lightning(g,w,h,C){const N=skins_noise(),sky=skins_rgb(C[0]),cl=skins_rgb(C[3]||C[1]);
    skins_paint(g,w,h,(u,v)=>skins_mix(sky,cl,0.35*skins_smooth(0.45,0.85,N(u,v,3,3,4))));
    const bolt=(x,y,ang,len,wd,depth)=>{const pts=[[x,y]];let a=ang;for(let k=0;k<12;k++){a+=rand(-0.6,0.6);a=ang+skins_clamp(a-ang,-0.7,0.7);x+=Math.cos(a)*len/12;y+=Math.sin(a)*len/12;pts.push([x,y]);
        if(depth<2&&Math.random()<0.18)bolt(x,y,a+pick([-0.8,0.8]),len*0.45,wd*0.6,depth+1);}
      wrapLine(pts,wd);};
    const wrapLine=(pts,wd)=>{for(const ox of[-w,0,w])for(const oy of[-h,0,h]){g.save();g.translate(ox,oy);g.lineJoin='round';g.lineCap='round';
      g.shadowColor=C[1];g.shadowBlur=10;g.strokeStyle=C[1];g.lineWidth=wd*2.4;g.beginPath();pts.forEach((p,j)=>j?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]));g.stroke();
      g.shadowBlur=0;g.strokeStyle=C[2];g.lineWidth=wd;g.stroke();g.restore();}};
    for(let i=0;i<5;i++)bolt(Math.random()*w,Math.random()*h,rand(0.6,2.5),rand(150,230),rand(1.4,2.4),0);},
  // koi carp over a rippled pond with lily pads; C: [water, koi, white, spots, pad]
  skins_koi(g,w,h,C,wrapDraw){const N=skins_noise(),wa=skins_rgb(C[0]);
    skins_paint(g,w,h,(u,v)=>{const n=N(u,v,4,4,3),r=Math.abs(Math.sin(6.283*(n*3)));return skins_mix(wa,[255,255,255],0.10*Math.pow(1-r,6)+0.12*(n-0.5));});
    if(C[4])for(let i=0;i<4;i++){const x=Math.random()*w,y=Math.random()*h,r=rand(12,20),a=Math.random()*6.28;wrapDraw(()=>{g.fillStyle=C[4];g.beginPath();g.moveTo(x,y);g.arc(x,y,r,a+0.35,a+6.0);g.closePath();g.fill();
      g.strokeStyle='rgba(0,0,0,.25)';g.lineWidth=1;g.stroke();});}
    const fish=[];for(let i=0;i<6;i++){let x,y,ok=false;for(let t=0;t<40&&!ok;t++){x=Math.random()*w;y=Math.random()*h;ok=fish.every(f=>{let dx=Math.abs(f[0]-x),dy=Math.abs(f[1]-y);dx=Math.min(dx,w-dx);dy=Math.min(dy,h-dy);return dx*dx+dy*dy>55*55;});}fish.push([x,y]);}
    for(const [x,y] of fish){const a=Math.random()*6.283,L=rand(46,60),W=L*0.26,bend=rand(-0.25,0.25),spots=[];for(let k=0;k<4;k++)spots.push([rand(-L*0.3,L*0.4),rand(-W*0.6,W*0.6),rand(4,9),Math.random()<0.55?C[2]:(C[3]||C[0])]);
      wrapDraw(()=>{g.save();g.translate(x,y);g.rotate(a);
        const body=()=>{g.beginPath();g.moveTo(L*0.5,0);g.bezierCurveTo(L*0.45,-W,-L*0.1,-W*1.05,-L*0.38,-W*0.25*(1+bend));g.lineTo(-L*0.38,W*0.25*(1-bend));g.bezierCurveTo(-L*0.1,W*1.05,L*0.45,W,L*0.5,0);g.closePath();};
        g.fillStyle='rgba(0,0,0,.22)';g.save();g.translate(3,4);body();g.fill();g.restore();
        g.fillStyle=C[1];g.globalAlpha=0.85;g.beginPath();g.moveTo(-L*0.36,0);g.quadraticCurveTo(-L*0.55,-W*1.3,-L*0.68,-W*1.1+bend*10);g.quadraticCurveTo(-L*0.55,0,-L*0.68,W*1.1+bend*10);g.quadraticCurveTo(-L*0.55,W*1.3,-L*0.36,0);g.fill();
        g.beginPath();g.ellipse(L*0.12,-W*0.85,W*0.5,W*0.22,-0.6,0,6.3);g.ellipse(L*0.12,W*0.85,W*0.5,W*0.22,0.6,0,6.3);g.fill();g.globalAlpha=1;
        body();g.fill();g.save();body();g.clip();for(const s of spots){g.fillStyle=s[3];g.beginPath();g.ellipse(s[0],s[1],s[2],s[2]*0.7,0.4,0,6.3);g.fill();}
        const sh=g.createLinearGradient(0,-W,0,W);sh.addColorStop(0,'rgba(255,255,255,.25)');sh.addColorStop(0.5,'rgba(255,255,255,0)');sh.addColorStop(1,'rgba(0,0,0,.25)');g.fillStyle=sh;g.fillRect(-L,-W*1.2,L*2,W*2.4);g.restore();
        g.fillStyle='#111';g.beginPath();g.arc(L*0.38,-W*0.32,1.4,0,7);g.arc(L*0.38,W*0.32,1.4,0,7);g.fill();g.restore();});}},
  // spray-paint wall: blobs, drips and bubble tags; C: [wall, paint1, paint2, paint3, outline]
  skins_graffiti(g,w,h,C,wrapDraw){const paints=C.slice(1,4),line=C[4]||'#111';
    for(let i=0;i<10;i++){const x=Math.random()*w,y=Math.random()*h,r=rand(30,60),c=pick(paints);wrapDraw(()=>{const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,c);gr.addColorStop(0.6,c);gr.addColorStop(1,'rgba(0,0,0,0)');g.globalAlpha=0.55;g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,7);g.fill();g.globalAlpha=1;});}
    const words=['ZAP','RUSH','BOOM','GO!','POW','YEAH','WILD','BRT'];
    for(let i=0;i<7;i++){const x=Math.random()*w,y=Math.random()*h,a=rand(-0.45,0.45),s=rand(30,46),t=pick(words),c=pick(paints),c2=pick(paints);
      wrapDraw(()=>{g.save();g.translate(x,y);g.rotate(a);g.font=`900 ${s}px Impact, "Arial Black", sans-serif`;g.textAlign='center';g.textBaseline='middle';g.lineJoin='round';
        g.lineWidth=s*0.32;g.strokeStyle=line;g.strokeText(t,0,0);const gr=g.createLinearGradient(0,-s/2,0,s/2);gr.addColorStop(0,c);gr.addColorStop(1,c2);g.fillStyle=gr;g.fillText(t,0,0);
        g.lineWidth=1.5;g.strokeStyle='rgba(255,255,255,.7)';g.strokeText(t,-1,-1);g.restore();
        g.fillStyle=c;for(let k=0;k<3;k++){const dx=rand(-s,s),len=rand(10,34);g.fillRect(x+dx,y+s*0.3,2.2,len);g.beginPath();g.arc(x+dx+1.1,y+s*0.3+len,2.2,0,7);g.fill();}});}
    for(let i=0;i<5;i++){const x=Math.random()*w,y=Math.random()*h,r=rand(7,12),c=pick(paints);wrapDraw(()=>{g.fillStyle=c;g.strokeStyle=line;g.lineWidth=2.5;g.beginPath();
      for(let k=0;k<10;k++){const an=k/10*6.283-1.57,rr=k&1?r*0.45:r;g.lineTo(x+Math.cos(an)*rr,y+Math.sin(an)*rr);}g.closePath();g.stroke();g.fill();});}},
  // stained glass: voronoi panes with lead lines; C: [lead, glass colours...]
  skins_stained(g,w,h,C,wrapDraw,F){const P=skins_points(F.cells||5,0.9),G=C.slice(1).map(skins_rgb),lead=skins_rgb(C[0]),N=skins_noise();
    const col=P.map(()=>pick(G)),lum=P.map(()=>rand(0.75,1.15));
    skins_paint(g,w,h,(u,v)=>{const wu=u+0.012*(N(u,v,8,8,1)-0.5),wv=v+0.012*(N(u+0.3,v,8,8,1)-0.5);const [d1,d2,id]=skins_vor(P,wu,wv),e=d2-d1;
      if(e<0.012)return skins_mix(lead,[255,255,255],0.15*skins_smooth(0.004,0.0,Math.abs(e-0.006)));
      const c=col[id].map(x=>Math.min(255,x*lum[id]*(1.15-d1*2.2)));const n=N(u,v,16,16,2);return skins_mix(c,[255,255,255],0.18*Math.max(0,n-0.55)*2);});},
  // pearlescent: soft milky pastel sheen; C: pastel ramp
  skins_pearl(g,w,h,C){const N=skins_noise(),P=C.map(skins_rgb);
    const f=skins_field(w,h,(u,v)=>{const a=N(u,v,2,2,3);return N(u+a*0.7,v+a*0.5,2,2,4);});
    skins_paint(g,w,h,(u,v,i)=>{const t=f[i];const s=0.5+0.5*Math.sin(6.283*t*3);const ir=skins_hue((t*2+u+v)%1,0.6,0.72);return skins_mix(skins_mix(skins_ramp(P,t),ir,0.22+0.2*(1-s)),[255,255,255],0.35*Math.pow(s,6));});},
  // lava: glowing cracks between dark basalt plates; C: [rock, glow, core, rock2]
  skins_lava(g,w,h,C,wrapDraw,F){const P=skins_points(F.cells||5,0.85),N=skins_noise(),rock=skins_rgb(C[0]),rock2=skins_rgb(C[3]||C[0]),glow=skins_rgb(C[1]),core=skins_rgb(C[2]);
    skins_paint(g,w,h,(u,v)=>{const a=N(u,v,6,6,2)-0.5;const [d1,d2]=skins_vor(P,u+a*0.05,v-a*0.05),e=d2-d1;const r=skins_mix(rock,rock2,N(u,v,8,8,3));
      const k=Math.exp(-e*e/(2*0.006*0.006)),k2=Math.exp(-e*e/(2*0.025*0.025));
      return skins_mix(skins_mix(r,glow,k2*0.45),skins_mix(glow,core,k),k);});},
  // zebra: warped bold stripes; C: [light, dark]
  skins_zebra(g,w,h,C){const N=skins_noise(),a=skins_rgb(C[0]),b=skins_rgb(C[1]);
    skins_paint(g,w,h,(u,v)=>{const n=N(u,v,2,3,3),n2=N(u,v,4,4,2);const s=Math.sin(6.283*(u*6+v*1+n*2.2+n2*0.4));const th=0.15+0.3*(N(u+0.5,v,3,3,1)-0.5);
      return skins_mix(a,b,skins_smooth(th-0.07,th+0.07,s));});},
  // leopard rosettes; C: [fur, ring, inner, fur2]
  skins_leopard(g,w,h,C,wrapDraw){const N=skins_noise(),fur=skins_rgb(C[0]),fur2=skins_rgb(C[3]||C[0]);
    skins_paint(g,w,h,(u,v)=>skins_mix(fur,fur2,N(u,v,3,3,4)));
    const n=6,s=w/n;for(let i=0;i<n;i++)for(let j=0;j<n;j++){const x=(i+0.5+rand(-0.25,0.25)+(j&1?0.5:0))*s,y=(j+0.5+rand(-0.2,0.2))*s,r=s*rand(0.26,0.34),rot=Math.random()*6.28,blobs=randi(4,6),gaps=[];
      for(let k=0;k<blobs;k++)gaps.push([rot+k/blobs*6.283+rand(-0.2,0.2),rand(0.6,1.0)]);
      wrapDraw(()=>{g.fillStyle=C[2];g.beginPath();g.ellipse(x,y,r*0.85,r*0.7,rot,0,7);g.fill();g.fillStyle=C[1];g.strokeStyle=C[1];g.lineCap='round';
        for(const [a0,len] of gaps){g.lineWidth=r*rand(0.28,0.4);g.beginPath();g.arc(x,y,r*0.95,a0,a0+len*6.283/blobs*0.8);g.stroke();}});}
    for(let i=0;i<26;i++){const x=Math.random()*w,y=Math.random()*h,r=rand(2,4.5);wrapDraw(()=>{g.fillStyle=C[1];g.beginPath();g.ellipse(x,y,r,r*0.8,Math.random()*3,0,7);g.fill();});}},
  // crackle glaze ceramic; C: [glaze, crack, glaze2]
  skins_crackle(g,w,h,C,wrapDraw,F){const P1=skins_points(F.cells||4,0.95),P2=skins_points((F.cells||4)*2,0.95),N=skins_noise(),gl=skins_rgb(C[0]),gl2=skins_rgb(C[2]||C[0]),cr=skins_rgb(C[1]);
    skins_paint(g,w,h,(u,v)=>{const a=N(u,v,8,8,2)-0.5;const [d1,d2]=skins_vor(P1,u+a*0.03,v+a*0.03),[e1,e2]=skins_vor(P2,u-a*0.02,v+a*0.02);
      let c=skins_mix(gl,gl2,N(u,v,3,3,4));c=skins_mix(c,[255,255,255],0.12*skins_smooth(0.04,0.12,d1));
      const k=Math.max(skins_smooth(0.011,0.004,d2-d1),0.7*skins_smooth(0.007,0.002,e2-e1));c=skins_mix(c,[0,0,0],0.18*skins_smooth(0.05,0.01,d2-d1));return skins_mix(c,cr,k);});},
  // layered wave scallops (fan pattern); C: [line, ring1, ring2, crest]
  skins_waves(g,w,h,C){const R=w/8,cols=[C[1],C[2]];
    for(let j=-2;j<=17;j++)for(let i=-1;i<=4;i++){const x=i*R*2+(j&1?R:0),y=j*R/2;
      for(let k=0;k<5;k++){const r=R*(1-k*0.19);g.fillStyle=k===0&&C[3]?C[3]:cols[k&1];g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();g.strokeStyle=C[0];g.lineWidth=1.4;g.stroke();}}},
  // holographic foil: rainbow sheen with a diamond sparkle grid; C: [silver, tint]
  skins_holo(g,w,h,C){const N=skins_noise(),base=skins_rgb(C[0]);
    const f=skins_field(w,h,(u,v)=>N(u,v,2,2,3));
    skins_paint(g,w,h,(u,v,i)=>{const t=u+2*v+f[i]*1.2;const c=skins_hue(((t%1)+1)%1,0.85,0.66);
      const gu=(u*16)%1-0.5,gv=(v*16)%1-0.5,dia=Math.abs(gu)+Math.abs(gv);const sp=skins_smooth(0.22,0.0,dia)*(0.5+0.5*Math.sin(6.283*(u*3+v*5)));
      return skins_mix(skins_mix(base,c,0.7),[255,255,255],sp*0.7);});},
  // retro pixel sprites on a dotted grid; C: [bg, sprite colours..., eyes]
  skins_pixel(g,w,h,C){const S={
      ghost:['..XXXX..','.XXXXXX.','XX.XX.XX','XX.XX.XX','XXXXXXXX','XXXXXXXX','XXXXXXXX','X.XX.XX.'],
      heart:['........','.XX..XX.','XXXXXXXX','XXXXXXXX','.XXXXXX.','..XXXX..','...XX...','........'],
      skull:['.XXXXXX.','XXXXXXXX','X..XX..X','X..XX..X','XXXXXXXX','.XXX.XX.','.X.X.X..','........'],
      star:['...XX...','...XX...','XXXXXXXX','.XXXXXX.','..XXXX..','.XXXXXX.','.XX..XX.','........'],
      bug:['..X..X..','...XX...','.XXXXXX.','XX.XX.XX','XXXXXXXX','X.XXXX.X','X.X..X.X','...XX...'],
      gem:['..XXXX..','.XXXXXX.','XXXXXXXX','.XXXXXX.','..XXXX..','...XX...','........','........']};
    const names=Object.keys(S),paint=C.slice(1,-1),eye=C[C.length-1],cell=w/4,px=cell/12;
    g.fillStyle='rgba(255,255,255,.08)';for(let x=0;x<w;x+=px*2)for(let y=0;y<h;y+=px*2)g.fillRect(x,y,1,1);
    for(let i=0;i<4;i++)for(let j=0;j<4;j++){const sp=S[names[(i*3+j*5)%names.length]],c=paint[(i+j*2)%paint.length],ox=i*cell+(j&1?cell/2:0)+px*2,oy=j*cell+px*2;
      for(let r=0;r<8;r++)for(let k=0;k<8;k++){if(sp[r][k]!=='X')continue;const x=(ox+k*px)%w,y=oy+r*px;g.fillStyle='rgba(0,0,0,.35)';g.fillRect(x+px*0.5,y+px*0.5,px,px);}
      for(let r=0;r<8;r++)for(let k=0;k<8;k++){const ch=sp[r][k];const x=(ox+k*px)%w,y=oy+r*px;if(ch==='X'){g.fillStyle=c;g.fillRect(x,y,px+0.5,px+0.5);}
        else if((sp===S.ghost||sp===S.skull)&&r>=2&&r<=3&&ch==='.'&&k>0&&k<7&&sp[r-1][k]!=='.'){g.fillStyle=eye;g.fillRect(x,y,px+0.5,px+0.5);}}}},
  // brushed metal: long fine streaks; C: [steel, dark, light]
  skins_brushed(g,w,h,C){const N=skins_noise(),a=skins_rgb(C[0]),b=skins_rgb(C[1]),c=skins_rgb(C[2]||C[0]);
    skins_paint(g,w,h,(u,v)=>{const s=N(u,v,2,128,3),l=N(u,v,1,24,2),big=N(u,v,2,2,2);const t=s*0.7+l*0.3;return skins_mix(skins_mix(b,a,skins_smooth(0.25,0.7,t)),c,0.35*skins_smooth(0.55,0.9,big));});},
  // contour bands (filled elevation map); C: [line, band colours low..high]
  skins_contour(g,w,h,C,wrapDraw,F){const N=skins_noise(),P=C.slice(1).map(skins_rgb),line=skins_rgb(C[0]),nb=F.bands||8;
    const f=skins_field(w,h,(u,v)=>{const a=N(u,v,2,2,2);return N(u+a*0.3,v,2,2,4);});
    skins_paint(g,w,h,(u,v,i)=>{const t=f[i]*nb,b=Math.min(nb-1,Math.floor(t)),fr=t-b;const c=skins_ramp(P,b/(nb-1));
      const e=Math.min(fr,1-fr);return skins_mix(c,line,skins_smooth(0.09,0.03,e));});},
  // knife swirl: strongly warped flowing colours with dark veins and sparkles; C: [dark, ramp...]
  skins_swirl(g,w,h,C){const N=skins_noise(),P=C.slice(1).map(skins_rgb),dark=skins_rgb(C[0]);
    const f=skins_field(w,h,(u,v)=>{const a=N(u,v,2,2,3),b=N(u+0.4,v+0.1,2,2,3);return N(u+a*1.2,v+b*1.2,2,2,4);});
    const q=skins_field(w,h,(u,v)=>N(u,v,3,3,3));
    skins_paint(g,w,h,(u,v,i)=>{const t=f[i];const vein=Math.pow(Math.abs(Math.sin(6.283*t*3)),0.6);let c=skins_ramp(P,skins_smooth(0.1,0.9,q[i]*0.6+t*0.4));
      c=skins_mix(dark,c,0.25+0.75*vein);return skins_mix(c,[255,255,255],0.25*Math.pow(Math.max(0,Math.sin(6.283*t*6)),12));});
    for(let i=0;i<70;i++){g.fillStyle='rgba(255,255,255,'+rand(0.2,0.7)+')';const s=rand(0.6,1.6);g.fillRect(Math.random()*w,Math.random()*h,s,s);}},
  // tiger tooth: polished gold with tapering flame teeth; C: [gold, tooth, edge, shine]
  skins_tooth(g,w,h,C){const N=skins_noise(),gold=skins_rgb(C[0]),th=skins_rgb(C[1]),ed=skins_rgb(C[2]||C[1]),sh=skins_rgb(C[3]||'#fff6c0');
    skins_paint(g,w,h,(u,v)=>{const n=N(u,v,2,4,3);const x=u*7+n*1.1+0.2*Math.sin(6.283*v*2),fr=x-Math.floor(x);
      const taper=0.18+0.22*(0.5+0.5*Math.sin(6.283*(v*2+(((Math.floor(x)%7)+7)%7)*0.37)));const d=Math.abs(fr-0.5);
      let c=skins_mix(gold,sh,0.45*skins_smooth(0.3,0.9,N(u,v,1,3,2)));c=skins_mix(c,ed,skins_smooth(taper+0.06,taper,d));return skins_mix(c,th,skins_smooth(taper,taper-0.05,d));});},
  // glowing circuitry over angled panels; C: [bg, trace, panel, pad]
  skins_circuitry(g,w,h,C,wrapDraw){const s=16;g.lineCap='round';g.lineJoin='round';
    for(let i=0;i<9;i++){const x=randi(0,15)*s,y=randi(0,15)*s,pw=randi(3,6)*s,ph=randi(2,5)*s,c=s*0.8;wrapDraw(()=>{g.fillStyle=C[2];g.beginPath();g.moveTo(x+c,y);g.lineTo(x+pw,y);g.lineTo(x+pw,y+ph-c);g.lineTo(x+pw-c,y+ph);g.lineTo(x,y+ph);g.lineTo(x,y+c);g.closePath();g.fill();
      g.strokeStyle='rgba(0,0,0,.6)';g.lineWidth=2;g.stroke();});}
    for(let i=0;i<26;i++){let x=randi(0,15)*s,y=randi(0,15)*s;const pts=[[x,y]];for(let k=0;k<4;k++){const d=randi(1,3)*s;switch(randi(0,3)){case 0:x+=d;break;case 1:y+=d;break;case 2:x+=d;y+=d;break;default:x-=d;y+=d;}pts.push([x,y]);}
      wrapDraw(()=>{g.strokeStyle=C[1];g.shadowColor=C[1];g.shadowBlur=6;g.lineWidth=2.4;g.beginPath();pts.forEach((p,j)=>j?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]));g.stroke();g.shadowBlur=0;
        g.fillStyle=C[3]||C[1];for(const p of [pts[0],pts[pts.length-1]]){g.beginPath();g.arc(p[0],p[1],3.6,0,7);g.fill();g.fillStyle=C[0];g.beginPath();g.arc(p[0],p[1],1.5,0,7);g.fill();g.fillStyle=C[3]||C[1];}});}},
  // marble fade: three-colour sweep with marble veins (use mirror:true); C: [vein, colours...]
  skins_marblefade(g,w,h,C){const N=skins_noise(),P=C.slice(1).map(skins_rgb),vein=skins_rgb(C[0]);
    skins_paint(g,w,h,(u,v)=>{const a=N(u,v,2,2,4),b=N(u+0.3,v+0.6,3,3,3);const t=skins_clamp(u+(a-0.5)*0.5);const c=skins_ramp(P,t);
      const vv=Math.abs(Math.sin(6.283*(u*2+v+a*2.5)));return skins_mix(c,vein,0.55*Math.pow(1-vv,10)+0.12*(b-0.5));});}
});

/* ------------------------------ finishes ------------------------------ */
Object.assign(FINISHES,{
  // Jungle Case: jungle and overgrown temple
  skins_canopy:{name:'Canopy Drift',pat:'camo',cols:['#3a5420','#203412','#5e7a2c','#141e0a'],metal:0.1,rough:0.75,scale:0.45},
  skins_fernline:{name:'Fernline',pat:'skins_contour',cols:['#101a08','#1a2e10','#284a18','#3a6020','#567a2a','#7a9238'],metal:0.1,rough:0.65,scale:0.35,bands:7,clean:true},
  skins_templemoss:{name:'Temple Moss',pat:'skins_crackle',cols:['#6a7058','#141810','#3a5a22'],metal:0.05,rough:0.85,scale:0.4,cells:4},
  skins_wildstripe:{name:'Wild Stripe',pat:'skins_zebra',cols:['#e8e2cc','#16140f'],metal:0.1,rough:0.6,scale:0.3,clean:true},
  skins_jaguarlily:{name:'Jaguar Lily',pat:'skins_leopard',cols:['#d8a24a','#1e140a','#a86a26','#e8c070'],metal:0.1,rough:0.6,scale:0.22},
  skins_pythoncoil:{name:'Python Coil',pat:'skins_scales',cols:['#0c1206','#7a7a28','#1e300c','#080c04'],metal:0.25,rough:0.45,scale:0.34,clean:true},
  skins_jadeidol:{name:'Jade Idol',pat:'skins_stained',cols:['#2a1e0c','#2a8a5a','#46b07a','#1a6040','#c8a040','#6ac090'],metal:0.45,rough:0.3,scale:0.3,cells:5,clean:true},
  skins_emeraldwyrm:{name:'Emerald Wyrm',pat:'skins_scales',cols:['#020a06','#1a9a5a','#02200e','#e0b040'],metal:0.6,rough:0.3,scale:0.4,clean:true},
  skins_sunkenidol:{name:'Sunken Idol',pat:'skins_casehard',cols:['#8a8a7a','#2a6a5a','#c8a040','#3a8a6a','#e0c070'],metal:0.85,rough:0.28,scale:0.3},
  skins_jaguarking:{name:'Jaguar King',pat:'skins_leopard',cols:['#16120c','#f0b830','#3a2a10','#241c10'],metal:0.8,rough:0.25,scale:0.26,clean:true},
  // Midnight Case: neon night city
  skins_pixelpals:{name:'Pixel Pals',pat:'skins_pixel',cols:['#141428','#ff4fa8','#3ae0ff','#ffe040','#7aff6a','#101018'],metal:0.2,rough:0.5,scale:0.2,clean:true},
  skins_tagalley:{name:'Tag Alley',pat:'skins_graffiti',cols:['#3a3c44','#ff3aa0','#30d0ff','#ffd030','#0c0c10'],metal:0.1,rough:0.7,scale:0.35},
  skins_nightsteel:{name:'Night Steel',pat:'skins_brushed',cols:['#5a6070','#22262e','#8a90a8'],metal:0.9,rough:0.35,scale:0.5,clean:true},
  skins_holofoil:{name:'Holo Foil',pat:'skins_holo',cols:['#c8ccd8','#ffffff'],metal:0.9,rough:0.2,scale:0.5,clean:true},
  skins_stormcell:{name:'Storm Cell',pat:'skins_lightning',cols:['#0a0e1e','#3a8aff','#e8f4ff','#2a3456'],metal:0.3,rough:0.4,scale:0.5,glow:0.45,clean:true},
  skins_synthwave:{name:'Synthwave',pat:'skins_contour',cols:['#0a0614','#2a0a4a','#5a1a8a','#a02a9a','#ff4a8a','#ff9a4a','#ffe060'],metal:0.4,rough:0.3,scale:0.4,bands:7,glow:0.3,clean:true},
  skins_arcadeglitch:{name:'Arcade Glitch',pat:'skins_pixel',cols:['#06060c','#ff2a6a','#2affc0','#8a6aff','#ffffff'],metal:0.3,rough:0.4,scale:0.2,glow:0.45,clean:true},
  skins_neontag:{name:'Neon Tagger',pat:'skins_graffiti',cols:['#0e0e16','#ff2ad0','#2affe0','#d0ff2a','#000000'],metal:0.2,rough:0.5,scale:0.38,glow:0.5,clean:true},
  skins_violetstorm:{name:'Violet Storm',pat:'skins_lightning',cols:['#100618','#c03aff','#fff0ff','#3a1a4a'],metal:0.4,rough:0.35,scale:0.55,glow:0.55,clean:true},
  // Forge Case: molten metal and heavy industry
  skins_slagmap:{name:'Slag Map',pat:'skins_contour',cols:['#14100c','#2a2622','#46403a','#6a5e52','#9a6a3a','#d8782a'],metal:0.4,rough:0.6,scale:0.32,bands:6},
  skins_millsteel:{name:'Mill Steel',pat:'skins_brushed',cols:['#a8acb0','#6a6e74','#e0e4e8'],metal:1,rough:0.3,scale:0.6,clean:true},
  skins_cindercrackle:{name:'Cinder Crackle',pat:'skins_crackle',cols:['#2a2624','#ff7a20','#3a3230'],metal:0.3,rough:0.6,scale:0.4,cells:4,glow:0.25},
  skins_heattint:{name:'Heat Tint',pat:'skins_casehard',cols:['#9a9ea4','#1a3a8a','#c89a40','#5a8ac0','#e8d090'],metal:1,rough:0.22,scale:0.32},
  skins_ironscale:{name:'Iron Scale',pat:'skins_scales',cols:['#0e0e10','#b0b4bc','#24262c','#d8822a'],metal:0.9,rough:0.35,scale:0.3,clean:true},
  skins_magmavein:{name:'Magma Vein',pat:'skins_lava',cols:['#1a1210','#ff4a10','#ffd040','#2a1a14'],metal:0.2,rough:0.6,scale:0.45,cells:5,glow:0.55,clean:true},
  skins_bluedoil:{name:'Blued Oil',pat:'skins_oilslick',cols:['#141a2a','#2a2a40'],metal:0.9,rough:0.2,scale:0.6,clean:true},
  skins_moltencore:{name:'Molten Core',pat:'skins_lava',cols:['#100a08','#ff2a00','#fff080','#3a1a0e'],metal:0.3,rough:0.5,scale:0.35,cells:4,glow:0.85,clean:true},
  // Coastline Case: Mediterranean sea and harbour towns
  skins_seafoam:{name:'Seafoam Fans',pat:'skins_waves',cols:['#0e3a5a','#2a8ac0','#e8f4f4','#5ab8d8'],metal:0.2,rough:0.45,scale:0.45,clean:true},
  skins_shellpearl:{name:'Shell Pearl',pat:'skins_pearl',cols:['#b8aca4','#c88aa8','#7a9ac8','#98b884','#c8aa80'],metal:0.85,rough:0.2,scale:0.6,clean:true},
  skins_terracotta:{name:'Terracotta Glaze',pat:'skins_crackle',cols:['#a8502a','#2a1008','#c87850'],metal:0.1,rough:0.5,scale:0.45,cells:3},
  skins_koipond:{name:'Koi Pond',pat:'skins_koi',cols:['#1e5a6a','#ff6a20','#fff4ea','#1a1a1a','#3a8a3a'],metal:0.2,rough:0.35,scale:0.28,clean:true},
  skins_azuretile:{name:'Azure Tile',pat:'skins_stained',cols:['#f4f0e6','#1a4aa0','#2a6ac8','#3a8ad8','#e8c040'],metal:0.3,rough:0.25,scale:0.25,cells:4,clean:true},
  skins_greatwave:{name:'Great Wave',pat:'skins_waves',cols:['#020a18','#0c2a5a','#3a7ab8','#e8f2f6'],metal:0.3,rough:0.35,scale:0.4,clean:true},
  skins_tidalkoi:{name:'Tidal Koi',pat:'skins_koi',cols:['#0a2440','#ff3a2a','#ffffff','#101010','#2a6a5a'],metal:0.3,rough:0.3,scale:0.28,clean:true},
  skins_goldenkoi:{name:'Golden Koi',pat:'skins_koi',cols:['#082a2a','#ffc020','#fff6d8','#c03a10','#1a5a3a'],metal:0.6,rough:0.25,scale:0.28,clean:true},
  skins_lagoonglass:{name:'Lagoon Glass',pat:'skins_stained',cols:['#0a1a1e','#10b0b8','#30e0d0','#0a7a9a','#f0e0a0','#5ad0ff'],metal:0.4,rough:0.2,scale:0.32,cells:6,glow:0.3,clean:true},
  // knife finishes
  skins_jadeswirl:{name:'Jade Swirl',pat:'skins_swirl',cols:['#021810','#0a5a3a','#2ad08a','#a8ffd8'],metal:0.95,rough:0.12,scale:0.35,clean:true},
  skins_tigerfang:{name:'Tiger Fang',pat:'skins_tooth',cols:['#e8a828','#a8380a','#d06a10','#fff0a0'],metal:1,rough:0.15,scale:0.3,clean:true},
  skins_sapphire:{name:'Midnight Sapphire',pat:'skins_swirl',cols:['#000412','#08206a','#1a5aff','#8ac8ff'],metal:0.95,rough:0.1,scale:0.35,clean:true},
  skins_emberruby:{name:'Ember Ruby',pat:'skins_swirl',cols:['#120002','#5a0410','#e8102a','#ff8a8a'],metal:0.95,rough:0.1,scale:0.35,clean:true},
  skins_circuitflare:{name:'Circuit Flare',pat:'skins_circuitry',cols:['#0c0c10','#ff3a2a','#24262e','#ffb040'],metal:0.7,rough:0.3,scale:0.3,glow:0.6,clean:true},
  skins_forgehardened:{name:'Forge Hardened',pat:'skins_casehard',cols:['#8a8e94','#1a3aa0','#e0b040','#7a3aa0','#f0d890','#2a5ad0'],metal:1,rough:0.18,scale:0.3},
  skins_marbletide:{name:'Marble Tide',pat:'skins_marblefade',cols:['#1a1a24','#1a50e0','#f8e040','#ff3a1a'],metal:0.9,rough:0.12,scale:0.5,mirror:true,clean:true},
  skins_moonpearl:{name:'Moonpearl',pat:'skins_swirl',cols:['#8a8aa0','#e8e0f0','#f8d8e8','#d8f0ff'],metal:0.85,rough:0.15,scale:0.4,clean:true},
  skins_temperedoil:{name:'Tempered Oil',pat:'skins_oilslick',cols:['#0c0a1a','#1a1a2a'],film:0.55,cycles:1.5,metal:1,rough:0.12,scale:0.4,clean:true},
  skins_prismghost:{name:'Prism Ghost',pat:'skins_holo',cols:['#14141c','#ffffff'],metal:1,rough:0.12,scale:0.35,clean:true},
  skins_duskswirl:{name:'Dusk Swirl',pat:'skins_swirl',cols:['#06020e','#3a0a6a','#c040ff','#ff8ad8'],metal:0.95,rough:0.12,scale:0.35,clean:true},
  skins_stormedge:{name:'Storm Edge',pat:'skins_lightning',cols:['#06080e','#40c0ff','#ffffff','#1a2436'],metal:0.8,rough:0.2,scale:0.3,glow:0.5,clean:true}
});

/* ------------------------------ cases ------------------------------ */
const skins_K=(k,f)=>f?{w:'knife',k,f,r:4}:{w:'knife',k,r:4};
CASES.push(
  {id:'skins_jungle',name:'Jungle Case',price:350,color:'#5ab040',items:[
    {w:'p12',f:'skins_canopy',r:0},{w:'vex',f:'skins_fernline',r:0},{w:'breacher',f:'skins_templemoss',r:0},{w:'g9',f:'skins_wildstripe',r:0},
    {w:'hawk',f:'skins_jaguarlily',r:1},{w:'m4r',f:'skins_pythoncoil',r:1},
    {w:'ark7',f:'skins_jadeidol',r:2},{w:'longshot',f:'skins_emeraldwyrm',r:2},
    {w:'g9',f:'skins_sunkenidol',r:3},{w:'ark7',f:'skins_jaguarking',r:3},
    skins_K('knife_hook','skins_jadeswirl'),skins_K('knife_ridge','skins_tigerfang'),skins_K('knife_moth')]},
  {id:'skins_midnight',name:'Midnight Case',price:450,color:'#8a4aff',items:[
    {w:'g9',f:'skins_pixelpals',r:0},{w:'breacher',f:'skins_tagalley',r:0},{w:'p12',f:'skins_nightsteel',r:0},
    {w:'vex',f:'skins_holofoil',r:1},{w:'hawk',f:'skins_stormcell',r:1},
    {w:'m4r',f:'skins_synthwave',r:2},{w:'longshot',f:'skins_arcadeglitch',r:2},
    {w:'ark7',f:'skins_neontag',r:3},{w:'longshot',f:'skins_violetstorm',r:3},
    skins_K('knife_spire','skins_sapphire'),skins_K('knife_flip','skins_circuitflare'),skins_K('knife_moth','skins_prismghost')]},
  {id:'skins_forge',name:'Forge Case',price:500,color:'#ff6a20',items:[
    {w:'p12',f:'skins_slagmap',r:0},{w:'g9',f:'skins_millsteel',r:0},{w:'vex',f:'skins_cindercrackle',r:0},
    {w:'breacher',f:'skins_heattint',r:1},{w:'m4r',f:'skins_ironscale',r:1},
    {w:'longshot',f:'skins_magmavein',r:2},{w:'hawk',f:'skins_bluedoil',r:2},
    {w:'ark7',f:'skins_moltencore',r:3},
    skins_K('knife_ridge','skins_forgehardened'),skins_K('knife_hook','skins_emberruby'),skins_K('knife','skins_temperedoil')]},
  {id:'skins_coast',name:'Coastline Case',price:300,color:'#2aa8d8',items:[
    {w:'g9',f:'skins_seafoam',r:0},{w:'p12',f:'skins_shellpearl',r:0},{w:'breacher',f:'skins_terracotta',r:0},
    {w:'vex',f:'skins_koipond',r:1},{w:'hawk',f:'skins_azuretile',r:1},
    {w:'m4r',f:'skins_greatwave',r:2},{w:'longshot',f:'skins_tidalkoi',r:2},
    {w:'ark7',f:'skins_goldenkoi',r:3},{w:'m4r',f:'skins_lagoonglass',r:3},
    skins_K('knife_flip','skins_marbletide'),skins_K('knife_spire','skins_moonpearl'),skins_K('knife_moth','skins_sapphire')]},
  {id:'skins_blade',name:'Blade Case',price:700,color:'#e4ae39',items:[
    skins_K('knife_hook'),skins_K('knife_spire'),skins_K('knife_flip'),skins_K('knife_ridge'),skins_K('knife_moth'),
    skins_K('knife_hook','skins_emberruby'),skins_K('knife_hook','skins_stormedge'),
    skins_K('knife_spire','skins_duskswirl'),skins_K('knife_spire','skins_forgehardened'),
    skins_K('knife_flip','skins_jadeswirl'),skins_K('knife_flip','skins_temperedoil'),
    skins_K('knife_ridge','skins_marbletide'),skins_K('knife_ridge','skins_circuitflare'),
    skins_K('knife_moth','skins_tigerfang'),skins_K('knife_moth','skins_moonpearl'),
    skins_K('knife','skins_sapphire'),skins_K('knife','skins_prismghost')]}
);
// more knife variety for the original cases
for(const [id,adds] of [
  ['sandline',[['knife_hook','sunsetfade'],['knife_ridge','skins_tigerfang']]],
  ['frost',[['knife_spire','glacier'],['knife_moth','skins_moonpearl']]],
  ['neon',[['knife_flip','skins_prismghost'],['knife_moth','galaxy'],['knife_hook','skins_stormedge']]],
  ['operator',[['knife_ridge','skins_forgehardened'],['knife_spire','skins_emberruby']]]]){
  const cs=CASES.find(c=>c.id===id);if(cs)for(const [k,f] of adds)cs.items.push(skins_K(k,f));
}
