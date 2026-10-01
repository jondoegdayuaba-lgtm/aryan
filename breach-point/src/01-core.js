'use strict';
(function(){
if(!window.THREE){document.getElementById('loading').textContent='Could not load three.js from cdnjs. Check your internet connection and reload.';return;}

/* =====================================================================
   Utilities
   ===================================================================== */
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const rand=(a,b)=>a+Math.random()*(b-a);
const randi=(a,b)=>Math.floor(a+Math.random()*(b-a+1));
const pick=a=>a[Math.floor(Math.random()*a.length)];
const DEG=Math.PI/180;
function angDiff(a,b){let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function fmtTime(t){t=Math.max(0,Math.ceil(t));return Math.floor(t/60)+':'+String(t%60).padStart(2,'0');}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
const V3=(x,y,z)=>new THREE.Vector3(x,y,z);
// direction a view (yaw, pitch) looks at. yaw 0 looks toward -z, positive yaw turns left.
function dirFromAngles(yaw,pitch,out){out=out||new THREE.Vector3();const cp=Math.cos(pitch);return out.set(-Math.sin(yaw)*cp,Math.sin(pitch),-Math.cos(yaw)*cp);}
function yawTo(dx,dz){return Math.atan2(-dx,-dz);}

/* =====================================================================
   Settings
   ===================================================================== */
const DEFAULTS={sens:2.0,fov:90,volume:0.7,xColor:'#4cff6a',xSize:6,xGap:3,xThick:2,xDot:false,xOutline:true,xDynamic:true,difficulty:'normal',side:'random',quality:'ultra',map:'sandline',renderScale:1,showFps:false};
const S=Object.assign({},DEFAULTS);
try{Object.assign(S,JSON.parse(localStorage.getItem('breachpoint.settings')||'{}'));}catch(e){}
function saveSettings(){try{localStorage.setItem('breachpoint.settings',JSON.stringify(S));}catch(e){}}

/* =====================================================================
   Audio (everything synthesised with Web Audio)
   ===================================================================== */
const listener={x:0,y:0,z:0,yaw:0};
const SFX=(()=>{
  let ctx=null,master=null,noiseBuf=null;
  function init(){
    if(ctx){if(ctx.state==='suspended')ctx.resume();return;}
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    ctx=new AC();master=ctx.createGain();master.gain.value=S.volume;
    const comp=ctx.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=4;
    master.connect(comp);comp.connect(ctx.destination);
    noiseBuf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
    const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  }
  function setVolume(v){if(master)master.gain.value=v;}
  // returns an input node routed through distance gain, occlusion low-pass and stereo pan
  function out(pos,vol,range){
    if(!ctx)return null;
    let g=vol,pan=0,lp=20000;
    if(pos){
      const dx=pos.x-listener.x,dy=pos.y-listener.y,dz=pos.z-listener.z;
      const d=Math.sqrt(dx*dx+dy*dy+dz*dz);
      if(d>range)return null;
      g=vol*Math.pow(1-d/range,1.6)/(1+d*0.03);
      if(g<0.002)return null;
      if(d>0.5){
        const rx=Math.cos(listener.yaw),rz=-Math.sin(listener.yaw);
        pan=clamp((dx*rx+dz*rz)/Math.max(0.001,Math.hypot(dx,dz)),-1,1)*0.8;
      }
      lp=18000/(1+d*0.05);
      if(d>3&&World.segBlocked(listener.x,listener.y,listener.z,pos.x,pos.y+0.5,pos.z)){g*=0.55;lp=Math.min(lp,1100);}
    }
    const gn=ctx.createGain();gn.gain.value=g;
    let node=gn;
    if(lp<17000){const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=lp;node.connect(f);node=f;}
    if(pan&&ctx.createStereoPanner){const p=ctx.createStereoPanner();p.pan.value=pan;node.connect(p);node=p;}
    node.connect(master);
    return gn;
  }
  function noise(dest,t,dur,o){
    const src=ctx.createBufferSource();src.buffer=noiseBuf;src.loop=true;
    const f=ctx.createBiquadFilter();f.type=o.type||'bandpass';f.frequency.setValueAtTime(o.freq||1000,t);
    if(o.freqEnd)f.frequency.exponentialRampToValueAtTime(o.freqEnd,t+dur);
    f.Q.value=o.q||1;
    const g=ctx.createGain();const a=o.attack||0.002;
    g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(o.gain||1,t+a);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    src.connect(f);f.connect(g);g.connect(dest);
    src.start(t,Math.random()*1.5);src.stop(t+dur+0.05);
  }
  function tone(dest,t,o){
    const osc=ctx.createOscillator();osc.type=o.type||'sine';
    osc.frequency.setValueAtTime(o.freq,t);if(o.freqEnd)osc.frequency.exponentialRampToValueAtTime(o.freqEnd,t+o.dur);
    const g=ctx.createGain();g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(o.gain||0.3,t+(o.attack||0.004));
    g.gain.exponentialRampToValueAtTime(0.0001,t+o.dur);
    osc.connect(g);g.connect(dest);osc.start(t);osc.stop(t+o.dur+0.05);
  }
  const GUN={
    pistol:{crack:2600,q:0.9,len:0.13,thump:170,tg:0.6,tail:0.18,vol:0.75},
    heavy:{crack:1700,q:0.7,len:0.24,thump:120,tg:0.9,tail:0.35,vol:1},
    smg:{crack:2900,q:1.1,len:0.1,thump:180,tg:0.5,tail:0.15,vol:0.7},
    rifle:{crack:2100,q:0.8,len:0.16,thump:130,tg:0.85,tail:0.3,vol:0.95},
    rifle2:{crack:2500,q:0.9,len:0.14,thump:145,tg:0.75,tail:0.26,vol:0.9},
    sniper:{crack:1400,q:0.6,len:0.34,thump:85,tg:1.1,tail:0.7,vol:1.2},
    shotgun:{crack:1200,q:0.5,len:0.3,thump:95,tg:1,tail:0.45,vol:1.1}
  };
  const api={
    init,setVolume,
    get ready(){return !!ctx;},
    gun(kind,pos,local){
      if(!ctx)return;const p=GUN[kind]||GUN.rifle;
      const d=out(local?null:pos,p.vol*(local?0.55:1.1),140);if(!d)return;const t=ctx.currentTime;
      noise(d,t,p.len,{type:'bandpass',freq:p.crack*rand(0.92,1.08),q:p.q,gain:1});
      noise(d,t,p.tail+p.len,{type:'lowpass',freq:3000,freqEnd:300,gain:0.5});
      tone(d,t,{type:'sine',freq:p.thump,freqEnd:40,dur:p.len+0.08,gain:p.tg});
    },
    dryfire(){if(!ctx)return;const d=out(null,0.3);tone(d,ctx.currentTime,{type:'square',freq:2200,dur:0.03,gain:0.2});},
    step(pos,local,soft){
      if(!ctx)return;const d=out(local?null:pos,(local?0.16:0.75)*(soft?0.4:1),local?1:24);if(!d)return;
      noise(d,ctx.currentTime,0.07,{type:'bandpass',freq:rand(500,900),q:1.4,gain:1,attack:0.005});
      noise(d,ctx.currentTime+0.01,0.05,{type:'highpass',freq:3500,gain:0.25});
    },
    land(pos,local){if(!ctx)return;const d=out(local?null:pos,local?0.3:0.8,26);if(!d)return;noise(d,ctx.currentTime,0.12,{type:'lowpass',freq:500,gain:1});},
    hit(head){if(!ctx)return;const d=out(null,0.5);const t=ctx.currentTime;
      if(head){tone(d,t,{type:'sine',freq:2900,dur:0.28,gain:0.4});tone(d,t,{type:'sine',freq:4350,dur:0.2,gain:0.2});}
      else tone(d,t,{type:'triangle',freq:1500,freqEnd:900,dur:0.06,gain:0.5});},
    hurt(){if(!ctx)return;const d=out(null,0.5);noise(d,ctx.currentTime,0.12,{type:'lowpass',freq:700,gain:1});},
    impact(pos,metal){if(!ctx)return;const d=out(pos,0.25,30);if(!d)return;
      if(metal)tone(d,ctx.currentTime,{type:'square',freq:rand(1800,2600),dur:0.05,gain:0.2});
      else noise(d,ctx.currentTime,0.05,{type:'bandpass',freq:rand(1500,3000),q:2,gain:1});},
    reload(local,pos,stage){if(!ctx)return;const d=out(local?null:pos,local?0.35:0.5,20);if(!d)return;const t=ctx.currentTime;
      tone(d,t,{type:'square',freq:stage===2?900:stage===1?1300:600,dur:0.04,gain:0.3});noise(d,t,0.06,{type:'highpass',freq:2000,gain:0.4});},
    shell(){if(!ctx)return;const d=out(null,0.3);tone(d,ctx.currentTime,{type:'triangle',freq:700,freqEnd:500,dur:0.08,gain:0.4});},
    swap(){if(!ctx)return;const d=out(null,0.25);noise(d,ctx.currentTime,0.08,{type:'bandpass',freq:1800,q:3,gain:0.7});},
    knife(pos,local){if(!ctx)return;const d=out(local?null:pos,0.5,20);if(!d)return;noise(d,ctx.currentTime,0.18,{type:'bandpass',freq:2500,freqEnd:500,q:2,gain:0.8});},
    knifeHit(pos){if(!ctx)return;const d=out(pos,0.6,20);if(!d)return;noise(d,ctx.currentTime,0.1,{type:'lowpass',freq:600,gain:1});tone(d,ctx.currentTime,{type:'sine',freq:180,freqEnd:80,dur:0.1,gain:0.5});},
    pin(){if(!ctx)return;const d=out(null,0.3);tone(d,ctx.currentTime,{type:'square',freq:2600,dur:0.03,gain:0.25});tone(d,ctx.currentTime+0.06,{type:'square',freq:1800,dur:0.03,gain:0.2});},
    throwN(pos,local){if(!ctx)return;const d=out(local?null:pos,0.4,20);if(!d)return;noise(d,ctx.currentTime,0.15,{type:'bandpass',freq:900,freqEnd:400,q:1,gain:0.6});},
    bounce(pos){if(!ctx)return;const d=out(pos,0.45,25);if(!d)return;tone(d,ctx.currentTime,{type:'triangle',freq:rand(700,1100),dur:0.07,gain:0.5});},
    explode(pos,big){if(!ctx)return;const d=out(pos,big?2.2:1.4,big?220:120);if(!d)return;const t=ctx.currentTime;
      noise(d,t,big?2.6:1.3,{type:'lowpass',freq:big?2500:3500,freqEnd:120,gain:1,attack:0.005});
      tone(d,t,{type:'sine',freq:big?70:95,freqEnd:28,dur:big?1.6:0.8,gain:1});},
    flashPop(pos){if(!ctx)return;const d=out(pos,1.2,90);if(!d)return;noise(d,ctx.currentTime,0.35,{type:'highpass',freq:1200,gain:1});},
    ring(sec,strength){if(!ctx)return;const d=out(null,0.22*strength);tone(d,ctx.currentTime,{type:'sine',freq:3300,dur:Math.max(0.3,sec),gain:0.6,attack:0.05});},
    smokePop(pos){if(!ctx)return;const d=out(pos,0.6,60);if(!d)return;noise(d,ctx.currentTime,1.8,{type:'bandpass',freq:1800,freqEnd:600,q:0.6,gain:0.7,attack:0.08});},
    fire(pos,dur){if(!ctx)return null;const d=out(pos,0.5,35);if(!d)return;const t=ctx.currentTime;
      noise(d,t,0.25,{type:'lowpass',freq:2500,gain:1});noise(d,t,dur,{type:'bandpass',freq:900,q:0.5,gain:0.35,attack:0.2});},
    beep(pos,urgent){if(!ctx)return;const d=out(pos,urgent?0.8:0.6,70);if(!d)return;tone(d,ctx.currentTime,{type:'square',freq:2550,dur:0.09,gain:0.35});},
    plantTick(pos){if(!ctx)return;const d=out(pos,0.4,25);if(!d)return;tone(d,ctx.currentTime,{type:'square',freq:1650,dur:0.05,gain:0.3});},
    defuseTick(pos){if(!ctx)return;const d=out(pos,0.4,25);if(!d)return;tone(d,ctx.currentTime,{type:'triangle',freq:rand(900,1400),dur:0.04,gain:0.35});noise(d,ctx.currentTime,0.05,{type:'highpass',freq:3000,gain:0.3});},
    armed(){if(!ctx)return;const d=out(null,0.5);const t=ctx.currentTime;[0,0.12,0.24].forEach((o,i)=>tone(d,t+o,{type:'square',freq:2550-i*300,dur:0.08,gain:0.3}));},
    defused(){if(!ctx)return;const d=out(null,0.6);const t=ctx.currentTime;[0,0.1,0.2].forEach((o,i)=>tone(d,t+o,{type:'sine',freq:900+i*300,dur:0.15,gain:0.35}));},
    ui(){if(!ctx)return;const d=out(null,0.25);tone(d,ctx.currentTime,{type:'triangle',freq:1200,dur:0.05,gain:0.4});},
    buy(){if(!ctx)return;const d=out(null,0.35);const t=ctx.currentTime;tone(d,t,{type:'triangle',freq:880,dur:0.06,gain:0.4});tone(d,t+0.06,{type:'triangle',freq:1320,dur:0.08,gain:0.4});noise(d,t,0.1,{type:'highpass',freq:2500,gain:0.3});},
    deny(){if(!ctx)return;const d=out(null,0.3);tone(d,ctx.currentTime,{type:'square',freq:220,dur:0.14,gain:0.3});},
    pickup(){if(!ctx)return;const d=out(null,0.3);noise(d,ctx.currentTime,0.08,{type:'bandpass',freq:1200,q:2,gain:0.8});tone(d,ctx.currentTime+0.05,{type:'square',freq:1000,dur:0.03,gain:0.25});},
    roundStart(){if(!ctx)return;const d=out(null,0.4);const t=ctx.currentTime;[523,659,784].forEach((f,i)=>tone(d,t+i*0.09,{type:'triangle',freq:f,dur:0.25,gain:0.3}));},
    win(good){if(!ctx)return;const d=out(null,0.45);const t=ctx.currentTime;
      const notes=good?[523,659,784,1047]:[466,392,311,262];notes.forEach((f,i)=>tone(d,t+i*0.13,{type:'triangle',freq:f,dur:0.45,gain:0.3}));
      if(good)tone(d,t+0.52,{type:'sine',freq:1568,dur:0.6,gain:0.15});}
  };
  return api;
})();

/* =====================================================================
   Procedural textures (colour maps are drawn on canvases; normal maps
   are derived from them with a Sobel filter)
   ===================================================================== */
const TEX={};
function canvasTex(w,h,draw,repeat,linear){
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');draw(g,w,h);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;if(repeat)t.repeat.set(repeat,repeat);
  t.anisotropy=Math.min(16,MAX_ANISO);if(!linear)t.encoding=THREE.sRGBEncoding;t.userData={canvas:c};return t;
}
let MAX_ANISO=8;
function normalFrom(tex,strength,invert){
  const src=tex.userData.canvas,w=src.width,h=src.height;const d=src.getContext('2d').getImageData(0,0,w,h).data;
  let H=new Float32Array(w*h);for(let i=0;i<w*h;i++)H[i]=(d[i*4]*0.3+d[i*4+1]*0.59+d[i*4+2]*0.11)/255*(invert?-1:1);
  // two passes of a wrapping 3x3 blur so single-pixel speckle does not turn into glittering normals
  for(let pass=0;pass<2;pass++){const B=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)s+=H[((y+dy+h)%h)*w+((x+dx+w)%w)];B[y*w+x]=s/9;}H=B;}
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');const out=g.createImageData(w,h);const o=out.data;
  const at=(x,y)=>H[((y+h)%h)*w+((x+w)%w)];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const dx=(at(x+1,y-1)+2*at(x+1,y)+at(x+1,y+1))-(at(x-1,y-1)+2*at(x-1,y)+at(x-1,y+1));
    const dy=(at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1))-(at(x-1,y-1)+2*at(x,y-1)+at(x+1,y-1));
    let nx=-dx*strength,ny=dy*strength,nz=1;const l=Math.hypot(nx,ny,nz);nx/=l;ny/=l;nz/=l;
    const i=(y*w+x)*4;o[i]=(nx*0.5+0.5)*255;o[i+1]=(ny*0.5+0.5)*255;o[i+2]=(nz*0.5+0.5)*255;o[i+3]=255;}
  g.putImageData(out,0,0);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(16,MAX_ANISO);return t;
}
function speckle(g,w,h,n,cols,smin,smax){for(let i=0;i<n;i++){g.fillStyle=pick(cols);g.globalAlpha=rand(0.05,0.35);const s=rand(smin,smax);g.fillRect(Math.random()*w,Math.random()*h,s,s);}g.globalAlpha=1;}
function blotches(g,w,h,n,cols,rmin,rmax,a){for(let i=0;i<n;i++){const x=Math.random()*w,y=Math.random()*h,r=rand(rmin,rmax);const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,pick(cols));gr.addColorStop(1,'rgba(0,0,0,0)');g.globalAlpha=a;g.fillStyle=gr;
  for(const ox of[-w,0,w])for(const oy of[-h,0,h]){g.save();g.translate(ox,oy);g.fillRect(x-r,y-r,r*2,r*2);g.restore();}}g.globalAlpha=1;}
function streaks(g,w,h,n,col,a){for(let i=0;i<n;i++){const x=Math.random()*w,y=Math.random()*h*0.6,len=rand(40,160),wd=rand(2,8);const gr=g.createLinearGradient(0,y,0,y+len);
  gr.addColorStop(0,col);gr.addColorStop(1,'rgba(0,0,0,0)');g.globalAlpha=a;g.fillStyle=gr;g.fillRect(x,y,wd,len);}g.globalAlpha=1;}
// name -> [draw, normal strength, roughness, metalness]
const SURFACES={
  sand:[(g,w,h)=>{g.fillStyle='#d8b887';g.fillRect(0,0,w,h);blotches(g,w,h,40,['#c9a46f','#e3c597','#bf9a66','#e8cfa5'],30,110,0.45);
    speckle(g,w,h,9000,['#8f6f45','#f5e3c0','#a88559','#6e5536'],1,2.5);
    for(let i=0;i<220;i++){g.fillStyle=pick(['#9b7d58','#c2a27a','#7e6548']);g.globalAlpha=0.55;g.beginPath();g.ellipse(Math.random()*w,Math.random()*h,rand(1.5,4),rand(1,3),rand(0,3),0,7);g.fill();}g.globalAlpha=1;},2.5,0.96],
  stone:[(g,w,h)=>{g.fillStyle='#bfa37e';g.fillRect(0,0,w,h);const rows=8,rh=h/rows;
    for(let r=0;r<rows;r++){let x=(r%2)*-40-Math.random()*30;while(x<w){const bw=rand(70,130);const l=rand(-14,10);g.fillStyle=`rgb(${205+l},${176+l},${136+l})`;g.fillRect(x+3,r*rh+3,bw-6,rh-6);
      g.fillStyle='rgba(255,255,255,.07)';g.fillRect(x+3,r*rh+3,bw-6,4);g.fillStyle='rgba(0,0,0,.08)';g.fillRect(x+3,r*rh+rh-8,bw-6,5);x+=bw;}}
    speckle(g,w,h,7000,['#7a6446','#efe0c4','#9d8460'],1,2.2);blotches(g,w,h,18,['#8f7350','#e9d6b2'],20,80,0.18);
    const gr=g.createLinearGradient(0,h*0.75,0,h);gr.addColorStop(0,'rgba(90,70,40,0)');gr.addColorStop(1,'rgba(90,70,40,.18)');g.fillStyle=gr;g.fillRect(0,0,w,h);},3.5,0.9],
  plaster:[(g,w,h)=>{g.fillStyle='#ece3d2';g.fillRect(0,0,w,h);blotches(g,w,h,50,['#e0d6c0','#fffaf0','#d8ccb2','#cdbea2'],20,90,0.22);
    speckle(g,w,h,6000,['#a39478','#ffffff','#8a7b62'],1,2);
    for(let i=0;i<14;i++){const x=Math.random()*w,y=Math.random()*h;g.strokeStyle='rgba(120,100,70,.3)';g.lineWidth=1;g.beginPath();g.moveTo(x,y);for(let k=0;k<5;k++)g.lineTo(x+rand(-25,25)*k*0.5,y+k*rand(5,12));g.stroke();}
    for(let i=0;i<10;i++){const x=Math.random()*w,y=Math.random()*h,bw=rand(30,90),bh=rand(16,40);g.fillStyle='rgba(185,160,120,.45)';g.fillRect(x,y,bw,bh);g.strokeStyle='rgba(150,125,90,.35)';for(let k=0;k<bw;k+=18)g.strokeRect(x+k,y,18,bh/2);}},0.9,0.93],
  plasterw:[(g,w,h)=>{g.fillStyle='#eef0f2';g.fillRect(0,0,w,h);blotches(g,w,h,40,['#dfe3e8','#ffffff','#d0d6dc'],20,90,0.4);speckle(g,w,h,5000,['#9aa4ae','#ffffff'],1,2);
    g.fillStyle='#6a4a30';g.fillRect(0,0,w,26);g.fillRect(0,h/2-13,w,26);g.fillRect(0,0,26,h);g.fillRect(w/2-13,0,26,h);
    g.save();g.translate(w/4,h/4);g.rotate(0.78);g.fillRect(-90,-11,180,22);g.restore();g.save();g.translate(w*0.75,h*0.75);g.rotate(-0.78);g.fillRect(-90,-11,180,22);g.restore();
    speckle(g,w,h,1500,['#3a2818'],1,3);
    streaks(g,w,h,12,'rgba(120,120,110,.35)',0.5);},2.0,0.9],
  paving:[(g,w,h)=>{g.fillStyle='#9d8b70';g.fillRect(0,0,w,h);const n=6,s=w/n;
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){const l=rand(-14,14);g.fillStyle=`rgb(${190+l},${172+l},${142+l})`;g.fillRect(i*s+3,j*s+3,s-6,s-6);}
    speckle(g,w,h,6000,['#6d5d48','#e6d8bf'],1,2);blotches(g,w,h,20,['#8d7a5e','#d6c5a6'],20,70,0.2);},3,0.85],
  concrete:[(g,w,h)=>{g.fillStyle='#8f8b84';g.fillRect(0,0,w,h);blotches(g,w,h,60,['#86837c','#9c9890','#7c7872','#a6a29a'],20,120,0.25);
    speckle(g,w,h,12000,['#5a5650','#c8c4bc','#707070'],1,2);g.strokeStyle='rgba(40,38,35,.55)';g.lineWidth=3;for(const v of[0,256]){g.beginPath();g.moveTo(v,0);g.lineTo(v,h);g.moveTo(0,v);g.lineTo(w,v);g.stroke();}
    for(let i=0;i<8;i++){let x=Math.random()*w,y=Math.random()*h;g.strokeStyle='rgba(40,38,35,.4)';g.lineWidth=1;g.beginPath();g.moveTo(x,y);for(let k=0;k<8;k++){x+=rand(-14,14);y+=rand(-14,14);g.lineTo(x,y);}g.stroke();}
    g.fillStyle='rgba(230,200,60,.75)';g.fillRect(0,250,w,10);},2.2,0.9],
  slab:[(g,w,h)=>{g.fillStyle='#55524d';g.fillRect(0,0,w,h);const s=w/2;for(let i=0;i<2;i++)for(let j=0;j<2;j++){const l=rand(-10,10);g.fillStyle=`rgb(${150+l},${146+l},${138+l})`;g.fillRect(i*s+3,j*s+3,s-6,s-6);}
    blotches(g,w,h,30,['#7a766e','#bbb6ac'],20,90,0.3);speckle(g,w,h,9000,['#555','#ccc'],1,2);},3,0.88],
  brick:[(g,w,h)=>{g.fillStyle='#8a7d70';g.fillRect(0,0,w,h);const bh=h/16,bw=w/4;
    for(let r=0;r<16;r++)for(let i=-1;i<5;i++){const x=i*bw+(r%2)*bw/2;const l=rand(-20,16);g.fillStyle=`rgb(${146+l},${86+l*0.6},${68+l*0.5})`;g.fillRect(x+3,r*bh+3,bw-6,bh-6);
      g.fillStyle='rgba(255,255,255,.05)';g.fillRect(x+3,r*bh+3,bw-6,3);}
    speckle(g,w,h,8000,['#3a2018','#d0a090','#6a4030'],1,2);streaks(g,w,h,10,'rgba(40,40,40,.4)',0.6);blotches(g,w,h,10,['#5a5048'],30,90,0.25);},3.2,0.88],
  corrugated:[(g,w,h)=>{const n=24,s=w/n;for(let i=0;i<n;i++){const gr=g.createLinearGradient(i*s,0,i*s+s,0);gr.addColorStop(0,'#5a6670');gr.addColorStop(0.5,'#a8b4bc');gr.addColorStop(1,'#5a6670');g.fillStyle=gr;g.fillRect(i*s,0,s,h);}
    streaks(g,w,h,25,'rgba(140,70,30,.55)',0.6);blotches(g,w,h,14,['#7a4a2a','#3a3a3a'],20,70,0.25);speckle(g,w,h,4000,['#333','#ddd'],1,2);
    g.fillStyle='rgba(30,30,30,.6)';g.fillRect(0,0,w,4);g.fillRect(0,h/2,w,3);},4.5,0.55,0.4],
  concretewall:[(g,w,h)=>{g.fillStyle='#a6a29a';g.fillRect(0,0,w,h);blotches(g,w,h,50,['#8f8b84','#bab6ae','#9a968e'],20,100,0.35);speckle(g,w,h,9000,['#6a6660','#d8d4cc'],1,2);
    g.strokeStyle='rgba(60,58,54,.5)';g.lineWidth=2;g.strokeRect(1,1,w-2,h-2);g.fillStyle='rgba(50,48,45,.65)';
    for(const x of[64,192,320,448])for(const y of[128,384]){g.beginPath();g.arc(x,y,5,0,7);g.fill();}streaks(g,w,h,14,'rgba(60,60,55,.4)',0.5);},2.2,0.92],
  snow:[(g,w,h)=>{g.fillStyle='#e8eef4';g.fillRect(0,0,w,h);blotches(g,w,h,60,['#d4dee8','#ffffff','#c8d4e0','#f4f8fc'],20,120,0.45);
    speckle(g,w,h,6000,['#b8c6d4','#ffffff'],1,2);for(let i=0;i<120;i++){g.fillStyle='rgba(160,180,200,.35)';g.beginPath();g.ellipse(Math.random()*w,Math.random()*h,rand(4,14),rand(2,6),rand(0,3),0,7);g.fill();}},1.8,0.72],
  logs:[(g,w,h)=>{const n=8,s=h/n;for(let i=0;i<n;i++){const gr=g.createLinearGradient(0,i*s,0,i*s+s);gr.addColorStop(0,'#3a2818');gr.addColorStop(0.2,'#7a5434');gr.addColorStop(0.55,'#946640');gr.addColorStop(0.9,'#5a3c22');gr.addColorStop(1,'#2a1c10');g.fillStyle=gr;g.fillRect(0,i*s,w,s);
      for(let k=0;k<6;k++){g.strokeStyle='rgba(40,25,10,.3)';g.beginPath();const y=i*s+rand(6,s-6);g.moveTo(0,y);g.bezierCurveTo(w*0.3,y+rand(-3,3),w*0.6,y+rand(-3,3),w,y);g.stroke();}}
    speckle(g,w,h,4000,['#2a1808','#b08050'],1,2);for(let i=0;i<10;i++){g.fillStyle='rgba(40,25,10,.6)';g.beginPath();g.ellipse(Math.random()*w,Math.random()*h,rand(3,7),rand(2,4),0,0,7);g.fill();}},3.8,0.85],
  cobble:[(g,w,h)=>{g.fillStyle='#5a5c60';g.fillRect(0,0,w,h);for(let y=0;y<h+20;y+=30)for(let x=-(y%60?15:0);x<w+20;x+=32){const l=rand(-18,18);g.fillStyle=`rgb(${128+l},${126+l},${122+l})`;g.beginPath();g.ellipse(x+rand(-2,2),y+rand(-2,2),rand(12,15),rand(10,13),rand(0,3),0,7);g.fill();
      g.fillStyle='rgba(255,255,255,.08)';g.beginPath();g.ellipse(x-3,y-3,7,5,0,0,7);g.fill();}
    g.globalCompositeOperation='lighter';blotches(g,w,h,24,['rgba(150,160,175,.6)'],20,60,0.5);g.globalCompositeOperation='source-over';speckle(g,w,h,5000,['#333','#ddd'],1,2);},4,0.8],
  woodplank:[(g,w,h)=>{g.fillStyle='#6a4a2e';g.fillRect(0,0,w,h);for(let i=0;i<8;i++){const l=rand(-18,14);g.fillStyle=`rgb(${120+l},${84+l},${52+l*0.6})`;g.fillRect(i*64+2,0,60,h);
      for(let k=0;k<5;k++){g.strokeStyle='rgba(50,30,10,.3)';g.beginPath();const x=i*64+rand(4,58);g.moveTo(x,0);g.lineTo(x+rand(-4,4),h);g.stroke();}}speckle(g,w,h,3000,['#2a1808','#b08050'],1,2);},3,0.85]
};
const TEXCACHE={};
function getTex(name){
  if(TEXCACHE[name])return TEXCACHE[name];
  const S_=SURFACES[name]||SURFACES.stone;const map=canvasTex(512,512,S_[0]);
  return TEXCACHE[name]={map,normal:normalFrom(map,S_[1]*0.3),ns:1,rough:S_[2],metal:S_[3]||0};
}
function buildTextures(){
  TEX.soft=canvasTex(64,64,(g)=>{const gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(0.4,'rgba(255,255,255,.6)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);});
  TEX.soft.wrapS=TEX.soft.wrapT=THREE.ClampToEdgeWrapping;
  TEX.cloud=canvasTex(128,128,(g,w,h)=>{for(let i=0;i<26;i++){const x=rand(30,98),y=rand(30,98),r=rand(14,34);const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,'rgba(255,255,255,.55)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,w,h);}
    const gr=g.createRadialGradient(64,64,30,64,64,64);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,1)');g.globalCompositeOperation='destination-out';g.fillStyle=gr;g.fillRect(0,0,w,h);});
  TEX.cloud.wrapS=TEX.cloud.wrapT=THREE.ClampToEdgeWrapping;
  TEX.hole=canvasTex(32,32,(g)=>{const gr=g.createRadialGradient(16,16,0,16,16,16);gr.addColorStop(0,'rgba(10,8,6,1)');gr.addColorStop(0.35,'rgba(30,24,18,.9)');gr.addColorStop(0.6,'rgba(60,50,40,.35)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,32,32);});
  TEX.hole.wrapS=TEX.hole.wrapT=THREE.ClampToEdgeWrapping;
  TEX.scorch=canvasTex(128,128,(g)=>{const gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(15,10,6,.85)');gr.addColorStop(0.7,'rgba(30,20,10,.5)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);});
  TEX.scorch.wrapS=TEX.scorch.wrapT=THREE.ClampToEdgeWrapping;
  // grime detail for the Blender props: near-white so it only adds wear to their colours
  TEX.detail=canvasTex(256,256,(g,w,h)=>{g.fillStyle='#f0f0f0';g.fillRect(0,0,w,h);blotches(g,w,h,40,['#d8d8d8','#ffffff','#cccccc'],10,50,0.4);
    speckle(g,w,h,5000,['#9a9a9a','#ffffff','#b0b0b0'],1,2);streaks(g,w,h,10,'rgba(120,120,120,.35)',0.5);
    g.strokeStyle='rgba(255,255,255,.5)';for(let i=0;i<30;i++){g.beginPath();const x=Math.random()*w,y=Math.random()*h;g.moveTo(x,y);g.lineTo(x+rand(-12,12),y+rand(-12,12));g.stroke();}});
  TEX.detailN=normalFrom(TEX.detail,0.35);
}
function letterTex(letter,color,arrow){
  return canvasTex(256,256,(g,w,h)=>{g.clearRect(0,0,w,h);g.fillStyle=color;g.font='bold 200px Impact, Arial Black, sans-serif';g.textAlign='center';g.textBaseline='middle';
    g.globalAlpha=0.9;g.fillText(letter,w/2,h/2+(arrow?-20:10));
    if(arrow){g.lineWidth=16;g.strokeStyle=color;g.beginPath();g.moveTo(40,220);g.lineTo(210,220);g.stroke();g.beginPath();g.moveTo(arrow>0?226:24,220);g.lineTo(arrow>0?190:60,196);g.lineTo(arrow>0?190:60,244);g.closePath();g.fill();}
    g.globalCompositeOperation='destination-out';for(let i=0;i<500;i++){g.globalAlpha=rand(0.1,0.6);g.fillRect(Math.random()*w,Math.random()*h,rand(1,5),rand(1,5));}});
}
