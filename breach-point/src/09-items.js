
/* =====================================================================
   Items: rarities, weapon finishes, agents, cases and the saved profile
   ===================================================================== */
const RARITY=[
  {name:'Standard',color:'#4b69ff',weight:55,sell:40},
  {name:'Superior',color:'#8847ff',weight:26,sell:110},
  {name:'Elite',color:'#d32ce6',weight:12.5,sell:300},
  {name:'Mythic',color:'#eb4b4b',weight:5,sell:800},
  {name:'Relic',color:'#e4ae39',weight:1.5,sell:2000}];
const WEAR=[[0.07,'Pristine'],[0.15,'Clean'],[0.38,'Field-Used'],[0.45,'Worn'],[1.01,'Battered']];
const wearName=f=>WEAR.find(w=>f<w[0])[1];

// finish id -> look. pat picks the drawing routine, cols its palette, scale is metres per tile.
const FINISHES={
  dunedrift:{name:'Dune Drift',pat:'camo',cols:['#c8a46e','#a07c4c','#e2cfa0','#7a5e3a'],metal:0.1,rough:0.75,scale:0.5},
  sandtiger:{name:'Sand Tiger',pat:'tiger',cols:['#d8b070','#3a2a18'],metal:0.15,rough:0.6,scale:0.6},
  sandtopo:{name:'Sandstone Topo',pat:'topo',cols:['#b89064','#6a4a2a'],metal:0.1,rough:0.7,scale:0.5},
  rusthex:{name:'Rust Hex',pat:'hex',cols:['#8a4a26','#d08a50','#4a2a16'],metal:0.6,rough:0.45,scale:0.25},
  desertdigital:{name:'Desert Digital',pat:'digital',cols:['#c8a46e','#8a6a44','#e6d4aa','#5a4630'],metal:0.1,rough:0.7,scale:0.4},
  sunsetfade:{name:'Sunset Fade',pat:'fade',cols:['#ffcf40','#ff6a8a','#7a4aff'],metal:0.85,rough:0.18,scale:1.2},
  copperpatina:{name:'Copper Patina',pat:'marble',cols:['#b86a3a','#3aa088','#2a5a4a'],metal:0.7,rough:0.35,scale:0.5},
  inferno:{name:'Inferno',pat:'flames',cols:['#1a0e0a','#ff3a10','#ffd040'],metal:0.3,rough:0.4,scale:0.5,glow:0.35},
  scorpionweb:{name:'Scorpion Web',pat:'web',cols:['#2a2a2a','#e0c070'],metal:0.4,rough:0.4,scale:0.6},
  carbon:{name:'Carbon Weave',pat:'carbon',cols:['#1a1c1e','#3a3e44'],metal:0.5,rough:0.35,scale:0.1},
  neongrid:{name:'Neon Grid',pat:'hex',cols:['#0e0f1a','#30f0ff','#ff40c0'],metal:0.3,rough:0.3,scale:0.25,glow:0.6},
  staticdigital:{name:'Static Digital',pat:'digital',cols:['#2a2e36','#5a6270','#9aa4b0','#16181c'],metal:0.2,rough:0.6,scale:0.4},
  toxic:{name:'Toxic Splash',pat:'splatter',cols:['#1c1e1a','#8aff30','#30c040'],metal:0.2,rough:0.4,scale:0.6,glow:0.25},
  nightcircuit:{name:'Night Circuit',pat:'circuit',cols:['#101418','#30a0ff'],metal:0.5,rough:0.3,scale:0.4,glow:0.7},
  neoncircuit:{name:'Neon Circuit',pat:'circuit',cols:['#14081c','#ff40c0'],metal:0.5,rough:0.3,scale:0.4,glow:0.8},
  galaxy:{name:'Galaxy',pat:'galaxy',cols:['#05060f','#5a2aa0','#2a6aff','#ff5ab0'],metal:0.6,rough:0.2,scale:0.7,glow:0.3},
  royalpulse:{name:'Royal Pulse',pat:'fade',cols:['#30e0ff','#6a3aff','#ff3ab0'],metal:0.9,rough:0.15,scale:1.0,glow:0.25},
  hyperdrive:{name:'Hyperdrive',pat:'stripes',cols:['#101218','#ffea30','#ff6a20'],metal:0.4,rough:0.3,scale:0.6,glow:0.3},
  arctic:{name:'Arctic Camo',pat:'camo',cols:['#e6ecf2','#9aa8b8','#c8d2de','#5a6878'],metal:0.1,rough:0.7,scale:0.5},
  icetopo:{name:'Ice Topo',pat:'topo',cols:['#cfe4f2','#4a7aa0'],metal:0.2,rough:0.5,scale:0.5},
  birch:{name:'Birch Camo',pat:'camo',cols:['#e8e4da','#2a2a28','#bab4a8','#6a6a64'],metal:0.1,rough:0.75,scale:0.4},
  glacier:{name:'Glacier Marble',pat:'marble',cols:['#e8f4ff','#7ab8e8','#2a5a8a'],metal:0.6,rough:0.2,scale:0.5},
  frostdigital:{name:'Frostbite Digital',pat:'digital',cols:['#dfe8f0','#8aa4c0','#4a6a8a','#ffffff'],metal:0.2,rough:0.6,scale:0.4},
  polartiger:{name:'Polar Tiger',pat:'tiger',cols:['#f0f2f4','#14161a'],metal:0.2,rough:0.5,scale:0.6},
  aurora:{name:'Aurora',pat:'fade',cols:['#30ffa0','#30a0ff','#c040ff'],metal:0.8,rough:0.2,scale:1.1,glow:0.35},
  damascus:{name:'Damascus',pat:'damascus',cols:['#5a5e64','#c8ccd2'],metal:1,rough:0.22,scale:0.3},
  goldleaf:{name:'Gold Leaf',pat:'chrome',cols:['#fff0a0','#d8a020','#7a5410'],metal:1,rough:0.12,scale:0.6},
  crimsonweb:{name:'Crimson Web',pat:'web',cols:['#8a0e12','#120404'],metal:0.5,rough:0.3,scale:0.5},
  rubychrome:{name:'Ruby Chrome',pat:'chrome',cols:['#ff8a8a','#d01020','#5a0408'],metal:1,rough:0.1,scale:0.6}
};
// Extra pattern painters can be registered here: PATTERNS.name=(g,w,h,cols,wrapDraw,finish)=>{...}
const PATTERNS={};
// Knife models: 'knife' is the default Talon; others are Blender assets named after their key (knife_xxx)
const KNIVES={knife:{name:'Talon Knife'}};
const finishTexCache={};
function finishTex(fid){
  if(finishTexCache[fid])return finishTexCache[fid];
  const F=FINISHES[fid],C=F.cols,S_=F.res||256;
  const t=canvasTex(S_,S_,(g,w,h)=>{
    const wrapDraw=fn=>{for(const ox of[-w,0,w])for(const oy of[-h,0,h]){g.save();g.translate(ox,oy);fn();g.restore();}};
    g.fillStyle=C[0];g.fillRect(0,0,w,h);
    if(PATTERNS[F.pat])PATTERNS[F.pat](g,w,h,C,wrapDraw,F);else switch(F.pat){
      case 'camo':for(let k=1;k<C.length;k++)for(let i=0;i<9;i++){const x=Math.random()*w,y=Math.random()*h,r=rand(18,42);const pts=[];for(let a=0;a<12;a++){const rr=r*rand(0.6,1.25);pts.push([x+Math.cos(a/12*6.283)*rr,y+Math.sin(a/12*6.283)*rr*0.7]);}
        wrapDraw(()=>{g.fillStyle=C[k];g.beginPath();pts.forEach((p,j)=>j?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]));g.closePath();g.fill();});}break;
      case 'tiger':g.fillStyle=C[1];for(let i=0;i<9;i++){const y0=i*h/9+rand(-6,6);g.beginPath();g.moveTo(0,y0);
        for(let x=0;x<=w;x+=16)g.lineTo(x,y0+Math.sin(x*0.05+i)*8+rand(-2,2));for(let x=w;x>=0;x-=16)g.lineTo(x,y0+Math.sin(x*0.05+i)*8+rand(4,13)*(0.4+0.6*Math.abs(Math.sin(x*0.02+i*1.3))));g.closePath();g.fill();}break;
      case 'topo':g.strokeStyle=C[1];g.lineWidth=2;for(let k=0;k<5;k++){const x=Math.random()*w,y=Math.random()*h;for(let r=8;r<120;r+=10)wrapDraw(()=>{g.beginPath();for(let a=0;a<=40;a++){const an=a/40*6.283,rr=r*(1+0.18*Math.sin(an*3+k));a?g.lineTo(x+Math.cos(an)*rr,y+Math.sin(an)*rr):g.moveTo(x+Math.cos(an)*rr,y+Math.sin(an)*rr);}g.stroke();});}break;
      case 'hex':{const r=16,hh=r*Math.sqrt(3);g.lineWidth=2.5;for(let row=-1;row<h/hh+1;row++)for(let col=-1;col<w/(r*1.5)+1;col++){const x=col*r*1.5,y=row*hh+(col%2?hh/2:0);
        g.beginPath();for(let a=0;a<6;a++){const an=a/6*6.283;g.lineTo(x+Math.cos(an)*r,y+Math.sin(an)*r);}g.closePath();if(Math.random()<0.12&&C[2]){g.fillStyle=C[2];g.fill();}g.strokeStyle=C[1];g.stroke();}break;}
      case 'digital':{const n=16,s=w/n;for(let i=0;i<n;i++)for(let j=0;j<n;j++){if(Math.random()<0.55)continue;g.fillStyle=C[1+Math.floor(Math.random()*(C.length-1))];g.fillRect(i*s,j*s,s*randi(1,2),s);}break;}
      case 'fade':{const gr=g.createLinearGradient(0,0,w,0);C.forEach((c,i)=>gr.addColorStop(i/(C.length-1),c));g.fillStyle=gr;g.fillRect(0,0,w,h);break;}
      case 'marble':for(let k=0;k<26;k++){g.strokeStyle=C[1+(k%2)];g.globalAlpha=rand(0.3,0.8);g.lineWidth=rand(1,4);g.beginPath();let x=Math.random()*w,y=Math.random()*h;g.moveTo(x,y);
        for(let i=0;i<14;i++){x+=rand(-24,24);y+=rand(-10,24);g.lineTo(x,y);}g.stroke();}g.globalAlpha=1;break;
      case 'flames':for(let i=0;i<14;i++){const x=Math.random()*w,bw=rand(20,44),ht=rand(80,200);wrapDraw(()=>{const gr=g.createLinearGradient(0,h,0,h-ht);gr.addColorStop(0,C[1]);gr.addColorStop(1,C[2]);g.fillStyle=gr;
        g.beginPath();g.moveTo(x-bw,h);g.quadraticCurveTo(x-bw*0.6,h-ht*0.5,x+rand(-8,8),h-ht);g.quadraticCurveTo(x+bw*0.6,h-ht*0.5,x+bw,h);g.fill();});}break;
      case 'web':{g.strokeStyle=C[1];g.lineWidth=2;const ox=w*0.4,oy=h*0.5;for(let a=0;a<12;a++){g.beginPath();g.moveTo(ox,oy);g.lineTo(ox+Math.cos(a/12*6.283)*w,oy+Math.sin(a/12*6.283)*w);g.stroke();}
        for(let r=14;r<w;r+=18){g.beginPath();for(let a=0;a<=12;a++){const an=a/12*6.283,x=ox+Math.cos(an)*r,y=oy+Math.sin(an)*r;a?g.quadraticCurveTo(ox+Math.cos(an-0.26)*r*0.86,oy+Math.sin(an-0.26)*r*0.86,x,y):g.moveTo(x,y);}g.stroke();}break;}
      case 'carbon':for(let i=0;i<w;i+=16)for(let j=0;j<h;j+=16){const gr=(i+j)/16%2?g.createLinearGradient(i,j,i+16,j):g.createLinearGradient(i,j,i,j+16);gr.addColorStop(0,C[0]);gr.addColorStop(0.5,C[1]);gr.addColorStop(1,C[0]);g.fillStyle=gr;g.fillRect(i,j,16,16);}break;
      case 'circuit':g.strokeStyle=C[1];g.fillStyle=C[1];g.lineWidth=2.5;for(let i=0;i<34;i++){let x=Math.round(Math.random()*16)*16,y=Math.round(Math.random()*16)*16;g.beginPath();g.moveTo(x,y);
        for(let k=0;k<4;k++){if(Math.random()<0.5)x+=pick([-1,1])*randi(1,4)*16;else y+=pick([-1,1])*randi(1,4)*16;g.lineTo(x,y);}g.stroke();g.beginPath();g.arc(x,y,4,0,7);g.fill();}break;
      case 'galaxy':blotches(g,w,h,22,[C[1],C[2],C[3]],20,80,0.45);for(let i=0;i<260;i++){g.fillStyle='#fff';g.globalAlpha=rand(0.3,1);const s=rand(0.6,2);g.fillRect(Math.random()*w,Math.random()*h,s,s);}g.globalAlpha=1;break;
      case 'splatter':for(let i=0;i<40;i++){const x=Math.random()*w,y=Math.random()*h,r=rand(3,16);wrapDraw(()=>{g.fillStyle=C[1+(i%2)];g.beginPath();g.arc(x,y,r,0,7);g.fill();for(let k=0;k<5;k++){g.beginPath();g.arc(x+rand(-r*2,r*2),y+rand(-r*2,r*2),r*rand(0.15,0.4),0,7);g.fill();}});}break;
      case 'stripes':for(let i=-4;i<12;i++){g.fillStyle=C[1+(i&1)];g.beginPath();g.moveTo(i*32,0);g.lineTo(i*32+14,0);g.lineTo(i*32+14+h*0.5,h);g.lineTo(i*32+h*0.5,h);g.fill();}break;
      case 'damascus':for(let y=0;y<h;y+=3){g.strokeStyle=(y/3)%2?C[1]:C[0];g.lineWidth=3;g.beginPath();for(let x=0;x<=w;x+=8)g.lineTo(x,y+Math.sin(x*0.05+y*0.08)*10+Math.sin(x*0.13)*4);g.stroke();}break;
      case 'chrome':{const gr=g.createLinearGradient(0,0,w*0.3,h);gr.addColorStop(0,C[0]);gr.addColorStop(0.45,C[1]);gr.addColorStop(0.55,C[2]);gr.addColorStop(1,C[1]);g.fillStyle=gr;g.fillRect(0,0,w,h);break;}
    }
    if(!F.clean)speckle(g,w,h,600,['rgba(0,0,0,.5)','rgba(255,255,255,.5)'],1,1.5);
  });
  t.wrapS=t.wrapT=(F.pat==='fade'||F.mirror)?THREE.MirroredRepeatWrapping:THREE.RepeatWrapping;t.repeat.set(1/F.scale,1/F.scale);
  return finishTexCache[fid]=t;
}

const AGENT_INFO={
  S_raider:{name:'Dune Raider',team:'S',r:0,def:true,desc:'Standard issue Striker kit.'},
  S_bandit:{name:'Plaid Bandit',team:'S',r:1,desc:'Flannel, bandolier and a bad attitude.'},
  S_ghost:{name:'Sand Ghost',team:'S',r:2,desc:'Hooded desert scout with a shemagh.'},
  S_brute:{name:'Iron Brute',team:'S',r:3,desc:'Heavy plate, gas mask, no mercy.'},
  W_officer:{name:'Ward Officer',team:'W',r:0,def:true,desc:'Standard issue Warden kit.'},
  W_ranger:{name:'Alpine Ranger',team:'W',r:1,desc:'Winter scout from the mountain units.'},
  W_diver:{name:'Night Diver',team:'W',r:2,desc:'Combat swimmer with a rebreather.'},
  W_riot:{name:'Riot Lead',team:'W',r:3,desc:'Visored heavy unit, first through the door.'}
};
const SKIN_WEAPONS=['ark7','m4r','longshot','vex','breacher','g9','p12','hawk','knife'];
const CASES=[
  {id:'sandline',name:'Sandline Case',price:250,color:'#d8a85a',items:[
    {w:'g9',f:'dunedrift',r:0},{w:'vex',f:'sandtiger',r:0},{w:'p12',f:'sandtopo',r:0},{w:'breacher',f:'rusthex',r:1},{w:'hawk',f:'desertdigital',r:1},
    {w:'m4r',f:'sunsetfade',r:2},{w:'ark7',f:'copperpatina',r:2},{w:'ark7',f:'inferno',r:3},{w:'longshot',f:'scorpionweb',r:3},
    {w:'knife',f:'sunsetfade',r:4},{w:'knife',f:'damascus',r:4}]},
  {id:'frost',name:'Frostbite Case',price:350,color:'#8ac8f0',items:[
    {w:'p12',f:'arctic',r:0},{w:'g9',f:'icetopo',r:0},{w:'breacher',f:'birch',r:0},{w:'vex',f:'glacier',r:1},{w:'hawk',f:'frostdigital',r:1},
    {w:'ark7',f:'polartiger',r:2},{w:'longshot',f:'arctic',r:2},{w:'m4r',f:'aurora',r:3},{w:'g9',f:'polartiger',r:3},
    {w:'knife',f:'glacier',r:4},{w:'knife',f:'crimsonweb',r:4}]},
  {id:'neon',name:'Neon Nights Case',price:400,color:'#ff40c0',items:[
    {w:'g9',f:'carbon',r:0},{w:'vex',f:'neongrid',r:0},{w:'breacher',f:'staticdigital',r:0},{w:'p12',f:'toxic',r:1},{w:'hawk',f:'nightcircuit',r:1},
    {w:'m4r',f:'neoncircuit',r:2},{w:'longshot',f:'galaxy',r:2},{w:'ark7',f:'royalpulse',r:3},{w:'longshot',f:'hyperdrive',r:3},
    {w:'knife',f:'galaxy',r:4},{w:'knife',f:'goldleaf',r:4}]},
  {id:'operator',name:'Operator Case',price:600,color:'#7be07b',items:[
    {a:'S_bandit',r:1},{a:'W_ranger',r:1},{a:'S_ghost',r:2},{a:'W_diver',r:2},{a:'S_brute',r:3},{a:'W_riot',r:3},
    {w:'knife',f:'rubychrome',r:4},{w:'hawk',f:'goldleaf',r:4}]}
];
function itemName(it){if(it.a)return AGENT_INFO[it.a].name;if(it.w==='knife')return '★ '+KNIVES[it.k||'knife'].name+' | '+(it.f?FINISHES[it.f].name:'Vanilla');return WEP[it.w].name+' | '+FINISHES[it.f].name;}
function itemKind(it){return it.a?(AGENT_INFO[it.a].team==='S'?'Striker agent':'Warden agent'):it.w==='knife'?'Knife':WEP[it.w].cls==='rifle'||WEP[it.w].cls==='sniper'?'Rifle':WEP[it.w].cls==='smg'||WEP[it.w].cls==='shotgun'?'Mid-tier':'Pistol';}
function rollCase(cs){
  const tiers=[...new Set(cs.items.map(i=>i.r))];const tot=tiers.reduce((s,r)=>s+RARITY[r].weight,0);
  let x=Math.random()*tot,tier=tiers[0];for(const r of tiers){x-=RARITY[r].weight;if(x<=0){tier=r;break;}}
  const it=Object.assign({},pick(cs.items.filter(i=>i.r===tier)));if(!it.a)it.fl=+Math.random().toFixed(4);return it;
}

/* ------------------------------- profile ------------------------------- */
const Profile={
  data:null,
  defaults(){return{coins:750,xp:0,items:[],uid:1,equip:{S:{agent:'S_raider',skins:{}},W:{agent:'W_officer',skins:{}}},
    stats:{matches:0,wins:0,losses:0,draws:0,kills:0,deaths:0,mvps:0},history:[],opened:0};},
  load(){let d=null;try{d=JSON.parse(localStorage.getItem('breachpoint.profile')||'null');}catch(e){}
    this.data=Object.assign(this.defaults(),d||{});for(const T of['S','W'])if(!this.data.equip[T])this.data.equip[T]=this.defaults().equip[T];},
  save(){try{localStorage.setItem('breachpoint.profile',JSON.stringify(this.data));}catch(e){}},
  get coins(){return this.data.coins;},
  level(){const xp=this.data.xp;let lv=1,need=500,acc=0;while(xp>=acc+need){acc+=need;lv++;need=Math.round(need*1.15);}return{lv,into:xp-acc,need};},
  add(it){it.uid=this.data.uid++;it.t=Date.now();this.data.items.push(it);this.save();return it;},
  find(uid){return this.data.items.find(i=>i.uid===uid);},
  sell(uid){const it=this.find(uid);if(!it)return 0;const v=RARITY[it.r].sell;this.unequip(uid);
    this.data.items=this.data.items.filter(i=>i.uid!==uid);this.data.coins+=v;this.save();return v;},
  owns(agent){return AGENT_INFO[agent].def||this.data.items.some(i=>i.a===agent);},
  agentFor(T){const a=this.data.equip[T].agent;return AGENT_INFO[a]&&AGENT_INFO[a].team===T&&this.owns(a)?a:T==='S'?'S_raider':'W_officer';},
  skinFor(T,wid){const uid=this.data.equip[T].skins[wid];const it=uid&&this.find(uid);return it?it.f||null:null;},
  knifeFor(T){const uid=this.data.equip[T].skins.knife;const it=uid&&this.find(uid);return it?{k:it.k&&KNIVES[it.k]?it.k:'knife',f:it.f||null}:{k:'knife',f:null};},
  equippedIn(uid){const out=[];for(const T of['S','W']){const e=this.data.equip[T];if(Object.values(e.skins).includes(uid))out.push(T);const it=this.find(uid);if(it&&it.a&&e.agent===it.a)out.push(T);}return[...new Set(out)];},
  usable(it,T){if(it.a)return AGENT_INFO[it.a].team===T;const w=WEP[it.w];return !w.team||w.team===T;},
  equip(uid,T){const it=this.find(uid);if(!it||!this.usable(it,T))return false;if(it.a)this.data.equip[T].agent=it.a;else this.data.equip[T].skins[it.w]=uid;this.save();return true;},
  unequip(uid,T){for(const t of T?[T]:['S','W']){const e=this.data.equip[t];for(const k in e.skins)if(e.skins[k]===uid)delete e.skins[k];
    const it=this.find(uid);if(it&&it.a&&e.agent===it.a)e.agent=t==='S'?'S_raider':'W_officer';}this.save();},
  equipDefault(wid,T){delete this.data.equip[T].skins[wid];this.save();},
  // coins after a match: rounds won, kills, assists, MVPs, the result, scaled by bot difficulty
  reward(p,won,draw,roundsWon,diff){
    const m={easy:0.75,normal:1,hard:1.4}[diff]||1;const lines=[];
    const add=(l,v)=>{v=Math.round(v*m);if(v>0)lines.push([l,v]);};
    add('Match played',100);add(roundsWon+' rounds won',roundsWon*15);add(p.stats.k+' kills',p.stats.k*8);add(p.stats.a+' assists',p.stats.a*4);
    add(p.stats.mvp+' MVP stars',p.stats.mvp*25);if(won)add('Victory bonus',250);else if(draw)add('Draw bonus',100);
    lines.push(['Bot difficulty ×'+m,null]);
    const total=lines.reduce((s,l)=>s+(l[1]||0),0);
    const d=this.data;d.coins+=total;d.xp+=total;d.stats.matches++;if(won)d.stats.wins++;else if(draw)d.stats.draws++;else d.stats.losses++;
    d.stats.kills+=p.stats.k;d.stats.deaths+=p.stats.d;d.stats.mvps+=p.stats.mvp;
    d.history.unshift({map:MAP.name,res:won?'W':draw?'D':'L',score:G.score[0]+':'+G.score[1],k:p.stats.k,d:p.stats.d,coins:total,t:Date.now()});d.history=d.history.slice(0,8);
    this.save();return{lines,total};
  }
};
