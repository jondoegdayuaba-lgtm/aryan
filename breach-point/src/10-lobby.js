
/* =====================================================================
   Lobby: play, inventory, loadout, store and case opening.
   Item pictures are real 3D renders of the Blender models.
   ===================================================================== */
const Thumb={cache:{},
  init(){
    this.scene=new THREE.Scene();this.cam=new THREE.PerspectiveCamera(26,2,0.01,60);
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x606a78,0.9));
    const key=new THREE.DirectionalLight(0xffffff,2.6);key.position.set(3,4,5);this.scene.add(key);
    const rim=new THREE.DirectionalLight(0xbfd8ff,1.8);rim.position.set(-4,2,-5);this.scene.add(rim);
    const fill=new THREE.DirectionalLight(0xffe0c0,0.8);fill.position.set(5,-1,1);this.scene.add(fill);
  },
  render(key,obj,w,h,frame){
    if(this.cache[key])return this.cache[key];
    const W=w*2,H=h*2;
    if(!this.rt||this.rt.width!==W||this.rt.height!==H){if(this.rt)this.rt.dispose();this.rt=new THREE.WebGLRenderTarget(W,H);this.rt.texture.encoding=THREE.sRGBEncoding;}
    this.scene.environment=scene.environment;this.scene.add(obj);obj.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(obj),size=box.getSize(V3()),ctr=box.getCenter(V3());
    this.cam.aspect=w/h;frame(this.cam,ctr,size);this.cam.updateProjectionMatrix();
    const tm=renderer.toneMapping,ex=renderer.toneMappingExposure;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    renderer.setRenderTarget(this.rt);renderer.setClearColor(0x000000,0);renderer.clear();renderer.render(this.scene,this.cam);
    const px=new Uint8Array(W*H*4);renderer.readRenderTargetPixels(this.rt,0,0,W,H,px);
    renderer.setRenderTarget(null);renderer.setClearColor(0x000000,1);renderer.toneMapping=tm;renderer.toneMappingExposure=ex;
    this.scene.remove(obj);
    const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');const img=g.createImageData(W,H);
    for(let y=0;y<H;y++)img.data.set(px.subarray((H-1-y)*W*4,(H-y)*W*4),y*W*4);
    g.putImageData(img,0,0);const c2=document.createElement('canvas');c2.width=w;c2.height=h;const g2=c2.getContext('2d');g2.imageSmoothingQuality='high';g2.drawImage(c,0,0,w,h);
    return this.cache[key]=c2.toDataURL();
  },
  weapon(w,f){
    return this.render('w:'+w+':'+(f||''),buildGun(w,'S',f).group,320,160,(cam,ctr,size)=>{
      const len=Math.max(size.z,size.y*2);const d=len/2/Math.tan(cam.fov*DEG/2)/cam.aspect*1.15+0.05;
      cam.position.set(ctr.x+d,ctr.y+d*0.18,ctr.z+d*0.22);cam.lookAt(ctr);});
  },
  agent(a,w,h){
    const T=AGENT_INFO[a].team,rifle=T==='S'?'ark7':'m4r';
    const m=buildCharacter(a);setCharGun(m,rifle,T,Profile.skinFor(T,rifle));m.userData.arms.rotation.x=-0.2;m.rotation.y=0.45;
    return this.render('a:'+a+':'+(w||170)+(Profile.skinFor(T,rifle)||''),m,w||170,h||250,(cam,ctr,size)=>{
      const d=size.y/2/Math.tan(cam.fov*DEG/2)*1.12;cam.position.set(ctr.x,ctr.y+0.1,ctr.z+d);cam.lookAt(ctr.x,ctr.y,ctr.z);});
  },
  item(it){return it.a?this.agent(it.a):this.weapon(it.w,it.f);}
};
function caseArt(cs,w,h){
  const key='case:'+cs.id+w;if(Thumb.cache[key])return Thumb.cache[key];
  const c=document.createElement('canvas');c.width=w*2;c.height=h*2;const g=c.getContext('2d');g.scale(2,2);
  const bw=w*0.78,bh=h*0.62,x=(w-bw)/2,y=h*0.26;
  g.fillStyle='rgba(0,0,0,.35)';g.beginPath();g.ellipse(w/2,y+bh+6,bw*0.48,8,0,0,7);g.fill();
  g.strokeStyle='#2a2a2a';g.lineWidth=7;g.beginPath();g.roundRect?g.roundRect(w/2-bw*0.16,y-h*0.13,bw*0.32,h*0.16,8):g.rect(w/2-bw*0.16,y-h*0.13,bw*0.32,h*0.16);g.stroke();
  const gr=g.createLinearGradient(0,y,0,y+bh);gr.addColorStop(0,cs.color);gr.addColorStop(1,'#1a1a1a');g.fillStyle=gr;
  g.beginPath();g.roundRect?g.roundRect(x,y,bw,bh,10):g.rect(x,y,bw,bh);g.fill();
  g.fillStyle='rgba(255,255,255,.18)';g.fillRect(x+6,y+6,bw-12,5);g.fillStyle='rgba(0,0,0,.35)';for(let i=1;i<6;i++)g.fillRect(x+i*bw/6-2,y+12,4,bh-24);
  g.fillStyle='#d8d8d8';g.fillRect(x+bw*0.18,y+bh*0.42,10,16);g.fillRect(x+bw*0.82-10,y+bh*0.42,10,16);
  g.fillStyle='rgba(0,0,0,.55)';g.beginPath();g.arc(w/2,y+bh/2,bh*0.24,0,7);g.fill();g.fillStyle='#fff';g.font=`bold ${Math.round(bh*0.26)}px Rajdhani, sans-serif`;g.textAlign='center';g.textBaseline='middle';
  g.fillText(cs.name.split(' ')[0][0],w/2,y+bh/2+1);
  return Thumb.cache[key]=c.toDataURL();
}
function mapArt(M,w,h){
  const key='map:'+M.id;if(Thumb.cache[key])return Thumb.cache[key];
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');const K=M.theme.sky;const hx=n=>'#'+n.toString(16).padStart(6,'0');
  const gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,hx(K.top));gr.addColorStop(0.55,hx(K.mid));gr.addColorStop(0.75,hx(K.horizon));g.fillStyle=gr;g.fillRect(0,0,w,h);
  const sx=w*(0.5+K.sunDir[0]*0.4),sy=h*(0.62-K.sunDir[1]*0.5);const sg=g.createRadialGradient(sx,sy,0,sx,sy,h*0.5);sg.addColorStop(0,'rgba(255,240,210,.95)');sg.addColorStop(0.08,'rgba(255,230,180,.6)');sg.addColorStop(1,'rgba(255,220,160,0)');g.fillStyle=sg;g.fillRect(0,0,w,h);
  const wall=M.id==='harbor'?'#5a4038':M.id==='frostbite'?'#4a3a30':'#a8875a',wall2=M.id==='harbor'?'#3a4a58':M.id==='frostbite'?'#d8dde2':'#c8a878';
  let x=0;while(x<w){const bw=rand(18,46),bh=rand(h*0.18,h*0.42);g.fillStyle=Math.random()<0.5?wall:wall2;g.fillRect(x,h*0.78-bh,bw,bh);
    if(M.id==='frostbite'){g.fillStyle='#f4f8fc';g.fillRect(x-2,h*0.78-bh-3,bw+4,5);}g.fillStyle='rgba(20,20,20,.45)';for(let k=0;k<3;k++)g.fillRect(x+4+k*12,h*0.78-bh+8,6,8);x+=bw+rand(0,6);}
  if(M.id==='harbor'){g.fillStyle='#d8a028';g.fillRect(w*0.74,h*0.15,5,h*0.6);g.fillRect(w*0.62,h*0.15,w*0.3,5);for(const[cx_,col]of[[0.15,'#a8382d'],[0.32,'#2e5f8f'],[0.5,'#d8762a']]){g.fillStyle=col;g.fillRect(w*cx_,h*0.66,w*0.14,h*0.12);}}
  if(M.id==='sandline'){g.fillStyle='#3e6a2c';for(const px of[0.2,0.7]){g.fillRect(w*px,h*0.38,3,h*0.4);g.beginPath();g.ellipse(w*px+1,h*0.38,14,5,0.3,0,7);g.fill();g.beginPath();g.ellipse(w*px+1,h*0.38,14,5,-0.3,0,7);g.fill();}}
  if(M.id==='frostbite'){g.fillStyle='#2c4a2e';for(const px of[0.12,0.85,0.55]){g.beginPath();g.moveTo(w*px,h*0.3);g.lineTo(w*px-14,h*0.78);g.lineTo(w*px+14,h*0.78);g.fill();}
    g.fillStyle='rgba(255,255,255,.8)';for(let i=0;i<80;i++)g.fillRect(Math.random()*w,Math.random()*h,1.5,1.5);}
  const gg=g.createLinearGradient(0,h*0.78,0,h);gg.addColorStop(0,hx(M.id==='frostbite'?0xe8eef4:M.id==='harbor'?0x8f8b84:0xd8b887));gg.addColorStop(1,'#111');g.fillStyle=gg;g.fillRect(0,h*0.78,w,h*0.22);
  return Thumb.cache[key]=c.toDataURL();
}

const Lobby={tab:'play',model:null,modelKey:'',t:0,invFilter:'all',invSel:null,storeSel:'neon',loadSide:'S',
  init(){
    Thumb.init();
    const seg=(id,key)=>{const el=$(id);const upd=()=>el.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===S[key]));
      el.querySelectorAll('button').forEach(b=>b.onclick=()=>{S[key]=b.dataset.v;saveSettings();upd();SFX.init();SFX.ui();this.refreshModel();});upd();};
    seg('segDiff','difficulty');seg('segSide','side');
    document.querySelectorAll('#menuNav button').forEach(b=>b.onclick=()=>{SFX.init();SFX.ui();const t=b.dataset.tab;if(t==='settings'){Settings.open('menu');return;}this.go(t);});
    $('btnPlay').onclick=()=>Game.start();
    $('picker').addEventListener('mousedown',e=>{if(e.target===$('picker'))$('picker').classList.add('hidden');});
    this.renderMaps();
  },
  go(t){
    this.tab=t;document.querySelectorAll('#menuNav button').forEach(x=>x.classList.toggle('on',x.dataset.tab===t));
    for(const[id,k]of[['tabPlay','play'],['tabInventory','inventory'],['tabLoadout','loadout'],['tabStore','store'],['tabHow','howto']])$(id).classList.toggle('hidden',k!==t);
    if(t==='play')this.renderPlay();if(t==='inventory')this.renderInventory();if(t==='loadout')this.renderLoadout();if(t==='store')this.renderStore();
    this.refreshModel();
  },
  show(){G.phase='menu';$('menu').classList.remove('hidden');$('hud').classList.add('hidden');this.refreshTop();this.go(this.tab);if(this.model)this.model.visible=true;},
  hideModel(){if(this.model)this.model.visible=false;},
  refreshTop(){$('coinVal').textContent=Profile.coins.toLocaleString();$('lvlBadge').textContent=Profile.level().lv;},
  side(){return this.tab==='loadout'?this.loadSide:S.side==='W'?'W':'S';},
  refreshModel(){
    const T=this.side(),a=Profile.agentFor(T),rifle=T==='S'?'ark7':'m4r',sk=Profile.skinFor(T,rifle);const key=a+rifle+sk+MAP.id;
    if(key===this.modelKey&&this.model){this.model.visible=G.phase==='menu';return;}
    if(this.model)scene.remove(this.model);this.model=buildCharacter(a);setCharGun(this.model,rifle,T,sk);scene.add(this.model);this.modelKey=key;
    this.model.visible=G.phase==='menu';
  },
  updateScene(dt){
    this.t+=dt;if(!this.model)this.refreshModel();
    const sp=MAP.menuSpot,p=cellPos(sp[0],sp[1]);p.y=World.heightAt(p.x,p.z);
    const th=(MAP.menuAngle||0)+Math.sin(this.t*0.12)*0.1;const cam=V3(p.x+Math.sin(th)*3.7,p.y+1.38,p.z+Math.cos(th)*3.7);
    camera.position.copy(cam);camera.fov=40;camera.updateProjectionMatrix();
    const fwd=V3(p.x-cam.x,0,p.z-cam.z).normalize(),right=V3(-fwd.z,0,fwd.x);const shift=this.tab==='play'?-0.95:-1.6;
    camera.lookAt(p.x+right.x*shift,p.y+1.08,p.z+right.z*shift);
    const m=this.model,u=m.userData;m.position.copy(p);m.rotation.set(0,yawTo(cam.x-p.x,cam.z-p.z)+0.35,0);
    u.upper.position.y=Math.sin(this.t*1.7)*0.006;u.head.rotation.y=Math.sin(this.t*0.5)*0.25;u.head.rotation.x=Math.sin(this.t*0.37)*0.05;
    u.arms.rotation.x=-0.42+Math.sin(this.t*1.7)*0.012;for(const l of u.legs){l.hip.rotation.x=0;l.knee.rotation.x=0;l.hip.position.y=0.92;}
    listener.x=cam.x;listener.y=cam.y;listener.z=cam.z;
  },
  renderMaps(){
    const box=$('mapCards');box.innerHTML='';
    for(const id of MAP_ORDER){const M=MAPS[id];const b=document.createElement('button');b.className='mapcard'+(S.map===id?' on':'');
      b.style.backgroundImage=`url(${mapArt(M,300,140)})`;b.innerHTML=`<span class="md">${id==='sandline'?'DESERT':id==='harbor'?'DOCKS':'SNOW'}</span><span class="mn">${esc(M.name)}</span>`;
      b.onclick=()=>{S.map=id;saveSettings();SFX.ui();this.renderMaps();loadMap(id);this.modelKey='';this.refreshModel();};box.appendChild(b);}
    $('mapDesc').textContent=MAPS[S.map].desc;
  },
  renderPlay(){
    this.renderMaps();
    const cs=CASES.find(c=>c.id==='neon');
    const st=Profile.data.stats,L=Profile.level(),kd=st.deaths?(st.kills/st.deaths).toFixed(2):st.kills.toFixed(2);
    const wr=st.matches?Math.round(st.wins/st.matches*100)+'%':'—';
    $('sidePanel').innerHTML=`<div id="featured"><div class="tag">NEW &amp; POPULAR</div><div class="casepic"><img src="${caseArt(cs,240,110)}" alt=""></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><b>${esc(cs.name)}</b><span class="chip" style="font-size:14px"><span class="coin"></span>${cs.price}</span></div></div>
      <div class="pcard"><img src="${Thumb.agent(Profile.agentFor(this.side()),90,120)}" style="height:84px;border-radius:6px;background:rgba(255,255,255,.06)" alt="">
      <div style="flex:1"><div class="pname">You</div><div style="color:var(--dim);font-size:14px;font-weight:600">Level ${L.lv} · ${L.into} / ${L.need} XP</div><div class="xpbar"><div style="width:${(L.into/L.need*100).toFixed(1)}%"></div></div>
      <div class="chip" style="margin-top:8px;display:inline-flex;font-size:15px"><span class="coin"></span>${Profile.coins.toLocaleString()}</div></div></div>
      <h4>CAREER</h4><div class="stats4"><div><b>${st.matches}</b><small>MATCHES</small></div><div><b>${wr}</b><small>WIN RATE</small></div><div><b>${kd}</b><small>K/D</small></div><div><b>${st.mvps}</b><small>MVP STARS</small></div></div>
      <h4>RECENT MATCHES</h4>${Profile.data.history.length?Profile.data.history.map(h=>`<div class="hist"><span class="${h.res}">${h.res==='W'?'WIN':h.res==='L'?'LOSS':'DRAW'} ${h.score}</span><span>${esc(h.map)}</span><span>${h.k}/${h.d}</span><span style="color:#ffd56b">+${h.coins}</span></div>`).join(''):'<div style="color:var(--dim);font-size:14px">No matches yet. Play one to earn coins.</div>'}
      <h4>COLLECTION</h4><div style="color:var(--dim);font-size:14px">${Profile.data.items.length} items · ${Profile.data.opened||0} cases opened</div>`;
    $('featured').onclick=()=>{this.storeSel='neon';SFX.ui();this.go('store');};
  },
  // ------------------------------ inventory ------------------------------
  renderInventory(){
    const F=[['all','All'],['Rifle','Rifles'],['Mid-tier','Mid-tier'],['Pistol','Pistols'],['Knife','Knives'],['agent','Agents']];
    $('invFilters').innerHTML=F.map(([k,l])=>`<button data-f="${k}" class="${this.invFilter===k?'on':''}">${l}</button>`).join('');
    $('invFilters').querySelectorAll('button').forEach(b=>b.onclick=()=>{this.invFilter=b.dataset.f;SFX.ui();this.renderInventory();});
    const items=Profile.data.items.slice().reverse().filter(it=>this.invFilter==='all'||(this.invFilter==='agent'?!!it.a:itemKind(it)===this.invFilter));
    const grid=$('invGrid');
    if(!items.length){grid.innerHTML=`<div style="color:var(--dim);font-size:16px;grid-column:1/-1">${Profile.data.items.length?'Nothing in this category.':'Your inventory is empty. Earn coins in matches and open cases in the Store.'}</div>`;}
    else grid.innerHTML=items.map(it=>this.card(it,it.uid===this.invSel)).join('');
    grid.querySelectorAll('.icard').forEach(c=>c.onclick=()=>{this.invSel=+c.dataset.uid;SFX.ui();this.renderInventory();});
    this.renderInvDetail();
  },
  card(it,sel){
    const eq=it.uid?Profile.equippedIn(it.uid):[];
    return `<button class="icard${sel?' sel':''}" data-uid="${it.uid||''}"><div class="eq">${eq.map(t=>`<span class="eq${t}">${t==='S'?'STR':'WAR'}</span>`).join('')}</div>
      <div class="pic"><img src="${Thumb.item(it)}" alt=""></div><div class="in">${esc(itemName(it))}</div><div class="ik">${itemKind(it)}${it.fl!==undefined?' · '+wearName(it.fl):''}</div>
      <div class="bar" style="background:${RARITY[it.r].color}"></div></button>`;
  },
  renderInvDetail(){
    const d=$('invDetail');const it=this.invSel&&Profile.find(this.invSel);
    if(!it){d.innerHTML='<div style="color:var(--dim);margin-top:40px;text-align:center">Select an item to equip or sell it.</div>';return;}
    const eq=Profile.equippedIn(it.uid);const R=RARITY[it.r];
    d.innerHTML=`<div class="big" style="background:radial-gradient(circle,${R.color}44,transparent 70%)"><img src="${Thumb.item(it)}" alt=""></div>
      <div class="rar" style="color:${R.color}">${R.name.toUpperCase()} ${itemKind(it).toUpperCase()}</div><h3>${esc(itemName(it))}</h3>
      ${it.a?`<div style="color:var(--dim)">${esc(AGENT_INFO[it.a].desc)}</div>`:`<div style="color:var(--dim)">Wear: ${wearName(it.fl)} (${it.fl.toFixed(4)})</div>`}
      <div style="color:var(--dim);font-size:14px">${eq.length?'Equipped for '+eq.map(t=>t==='S'?'Strikers':'Wardens').join(' and '):'Not equipped'}</div>
      <div class="btnrow">${['S','W'].filter(T=>Profile.usable(it,T)).map(T=>`<button class="btn small ${eq.includes(T)?'':'primary'}" data-eq="${T}">${eq.includes(T)?'Unequip':'Equip'} ${T==='S'?'Strikers':'Wardens'}</button>`).join('')}</div>
      <div class="btnrow"><button class="btn small" id="btnSell">Sell for <span class="coin" style="vertical-align:-3px"></span> ${R.sell}</button></div>`;
    d.querySelectorAll('[data-eq]').forEach(b=>b.onclick=()=>{const T=b.dataset.eq;if(Profile.equippedIn(it.uid).includes(T))Profile.unequip(it.uid,T);else Profile.equip(it.uid,T);SFX.buy();this.modelKey='';this.refreshModel();this.renderInventory();});
    $('btnSell').onclick=()=>{const b=$('btnSell');if(!b.dataset.sure){b.dataset.sure=1;b.innerHTML='Click again to sell';return;}
      const v=Profile.sell(it.uid);SFX.buy();this.invSel=null;this.refreshTop();this.modelKey='';this.refreshModel();this.renderInventory();HUDtoast('Sold for '+v+' coins');};
  },
  // ------------------------------ loadout ------------------------------
  renderLoadout(){
    const P=$('loadoutPanel');let html='';
    for(const T of['S','W']){
      const agents=Object.keys(AGENT_INFO).filter(k=>AGENT_INFO[k].team===T&&Profile.owns(k));const cur=Profile.agentFor(T);
      const weps=['knife',DEFAULT_PISTOL[T],'hawk','vex','breacher',T==='S'?'ark7':'m4r','longshot'];
      html+=`<div class="loadcol" data-side="${T}" style="${this.loadSide===T?'background:rgba(255,255,255,.03)':''}"><h3 style="color:${T==='S'?'var(--s2)':'var(--w2)'}">${T==='S'?'STRIKERS':'WARDENS'}</h3>
        <div class="agentpick"><button class="btn small" data-ag="${T}" data-d="-1">◀</button><img src="${Thumb.agent(cur)}" alt=""><div><div style="font-size:20px;font-weight:700">${esc(AGENT_INFO[cur].name)}</div>
        <div class="rar" style="color:${RARITY[AGENT_INFO[cur].r].color}">${RARITY[AGENT_INFO[cur].r].name}</div><div style="color:var(--dim);font-size:13px">${agents.length} of 4 agents owned</div></div><button class="btn small" data-ag="${T}" data-d="1">▶</button></div>
        ${weps.map(w=>{const f=Profile.skinFor(T,w);return `<div class="lrow" data-w="${w}" data-t="${T}"><img src="${f?Thumb.weapon(w,f):ICON[w]}" alt=""><div><div class="sn">${esc(WEP[w].name)}</div><div class="sk">${f?esc(FINISHES[f].name):'Default finish'}</div></div></div>`;}).join('')}
      </div>`;
    }
    P.innerHTML=html;
    P.querySelectorAll('.loadcol').forEach(c=>c.onmouseenter=()=>{if(this.loadSide!==c.dataset.side){this.loadSide=c.dataset.side;this.refreshModel();}});
    P.querySelectorAll('[data-ag]').forEach(b=>b.onclick=()=>{const T=b.dataset.ag;const agents=Object.keys(AGENT_INFO).filter(k=>AGENT_INFO[k].team===T&&Profile.owns(k));
      let i=agents.indexOf(Profile.agentFor(T));i=(i+(+b.dataset.d)+agents.length)%agents.length;Profile.data.equip[T].agent=agents[i];Profile.save();SFX.ui();this.loadSide=T;this.modelKey='';this.refreshModel();this.renderLoadout();});
    P.querySelectorAll('.lrow').forEach(r=>r.onclick=()=>this.pickSkin(r.dataset.w,r.dataset.t));
  },
  pickSkin(w,T){
    const owned=Profile.data.items.filter(it=>it.w===w);const cur=Profile.data.equip[T].skins[w];
    $('pickerPanel').innerHTML=`<h2 style="margin:0 0 12px">${esc(WEP[w].name)} · ${T==='S'?'Strikers':'Wardens'}</h2><div id="invGridP" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
      <button class="icard${!cur?' sel':''}" data-uid="0"><div class="pic"><img src="${ICON[w]}" alt=""></div><div class="in">Default finish</div><div class="ik">Standard issue</div><div class="bar" style="background:#666"></div></button>
      ${owned.map(it=>this.card(it,it.uid===cur)).join('')}</div>${owned.length?'':'<p style="color:var(--dim)">You do not own any finishes for this weapon yet. Open cases in the Store.</p>'}
      <div style="text-align:right;margin-top:12px"><button class="btn" id="pickClose">Close</button></div>`;
    $('picker').classList.remove('hidden');$('pickClose').onclick=()=>$('picker').classList.add('hidden');
    $('pickerPanel').querySelectorAll('.icard').forEach(c=>c.onclick=()=>{const uid=+c.dataset.uid;if(uid)Profile.equip(uid,T);else Profile.equipDefault(w,T);SFX.buy();
      $('picker').classList.add('hidden');this.modelKey='';this.refreshModel();this.renderLoadout();});
  },
  // ------------------------------ store ------------------------------
  renderStore(){
    $('storeGrid').innerHTML=CASES.map(cs=>`<button class="icard${cs.id===this.storeSel?' sel':''}" data-c="${cs.id}" style="height:190px"><div class="pic" style="height:120px"><img src="${caseArt(cs,220,120)}" alt=""></div>
      <div class="in" style="font-size:16px">${esc(cs.name)}</div><div class="ik" style="display:flex;align-items:center;gap:6px"><span class="coin"></span>${cs.price}</div><div class="bar" style="background:${cs.color}"></div></button>`).join('');
    $('storeGrid').querySelectorAll('.icard').forEach(c=>c.onclick=()=>{this.storeSel=c.dataset.c;SFX.ui();this.renderStore();});
    const cs=CASES.find(c=>c.id===this.storeSel)||CASES[0];const can=Profile.coins>=cs.price;
    $('storeDetail').innerHTML=`<div class="big"><img src="${caseArt(cs,340,190)}" alt=""></div><h3>${esc(cs.name)}</h3>
      <button class="btn ${can?'primary':''}" id="btnOpenCase" ${can?'':'disabled'}>Open for <span class="coin" style="vertical-align:-3px"></span> ${cs.price}</button>
      ${can?'':`<div style="color:#ff8a7a;font-size:14px">You need ${cs.price-Profile.coins} more coins. Play a match to earn more.</div>`}
      <div style="font-size:13px;color:var(--dim);letter-spacing:.1em;margin-top:6px">CONTAINS ONE OF</div>
      <div style="overflow:auto;flex:1;display:flex;flex-direction:column;gap:4px">${cs.items.slice().sort((a,b)=>b.r-a.r).map(it=>`<div class="hist" style="align-items:center;border-left:3px solid ${RARITY[it.r].color}"><img src="${Thumb.item(it)}" style="height:34px;width:70px;object-fit:contain" alt=""><span style="flex:1;margin-left:8px">${esc(it.r===4&&it.w==='knife'?'★ Rare special item':itemName(it))}</span><span style="color:${RARITY[it.r].color};font-size:12px">${RARITY[it.r].name}</span></div>`).join('')}</div>`;
    if(can)$('btnOpenCase').onclick=()=>this.openCase(cs);
  },
  openCase(cs){
    if(Profile.coins<cs.price)return;SFX.init();
    Profile.data.coins-=cs.price;Profile.data.opened=(Profile.data.opened||0)+1;Profile.save();this.refreshTop();
    const win=rollCase(cs);const N=58,WIN=50;const cards=[];for(let i=0;i<N;i++)cards.push(i===WIN?win:rollCase(cs));
    $('caseTitle').textContent=cs.name.toUpperCase();$('caseResult').innerHTML='';
    const reel=$('reel');reel.style.transition='none';reel.style.transform='translateX(0px)';
    reel.innerHTML=cards.map(it=>`<div class="icard"><div class="pic"><img src="${Thumb.item(it)}" alt=""></div><div class="in">${esc(it.r===4&&it.w==='knife'?'★ Rare special item':itemName(it))}</div><div class="bar" style="background:${RARITY[it.r].color}"></div></div>`).join('');
    $('caseOpen').classList.remove('hidden');
    const cw=188,wrapW=$('reelWrap').clientWidth,target=WIN*cw+90-wrapW/2+rand(-70,70);
    void reel.offsetWidth;
    reel.style.transition='transform 6.4s cubic-bezier(0.06,0.72,0.1,1)';reel.style.transform=`translateX(${-target}px)`;
    let last=-1,done=false;const tick=()=>{if(done)return;const m=new DOMMatrixReadOnly(getComputedStyle(reel).transform);const idx=Math.floor((-m.m41+wrapW/2)/cw);if(idx!==last){last=idx;SFX.ui();}requestAnimationFrame(tick);};
    requestAnimationFrame(tick);
    const finish=()=>{if(done)return;done=true;const it=Profile.add(win);const R=RARITY[it.r];
      if(it.r>=3)SFX.win(true);else SFX.buy();
      $('caseResult').innerHTML=`<div class="big" style="background:radial-gradient(circle,${R.color}55,transparent 65%)"><img src="${Thumb.item(it)}" alt=""></div>
        <div class="rar" style="color:${R.color}">${R.name.toUpperCase()} ${itemKind(it).toUpperCase()}</div><h2>${esc(itemName(it))}</h2>
        <div style="color:var(--dim)">${it.a?esc(AGENT_INFO[it.a].desc):'Wear: '+wearName(it.fl)}</div>
        <div class="btnrow" style="justify-content:center;margin-top:14px"><button class="btn primary" id="coKeep">Keep</button>
        ${Profile.usable(it,'S')||Profile.usable(it,'W')?'<button class="btn" id="coEquip">Equip now</button>':''}
        <button class="btn" id="coSell">Sell for ${R.sell}</button><button class="btn" id="coAgain" ${Profile.coins>=cs.price?'':'disabled'}>Open another (${cs.price})</button></div>`;
      const close=()=>{$('caseOpen').classList.add('hidden');this.refreshTop();this.go(this.tab);};
      $('coKeep').onclick=close;
      if($('coEquip'))$('coEquip').onclick=()=>{for(const T of['S','W'])if(Profile.usable(it,T))Profile.equip(it.uid,T);this.modelKey='';close();};
      $('coSell').onclick=()=>{Profile.sell(it.uid);close();};
      $('coAgain').onclick=()=>this.openCase(cs);
    };
    reel.addEventListener('transitionend',finish,{once:true});setTimeout(finish,7000);
  }
};
function HUDtoast(msg){const d=document.createElement('div');d.textContent=msg;d.style.cssText='position:fixed;left:50%;bottom:40px;transform:translateX(-50%);background:rgba(20,24,30,.95);border:1px solid rgba(255,255,255,.2);padding:10px 18px;border-radius:6px;z-index:60;font-weight:700';document.body.appendChild(d);setTimeout(()=>d.remove(),2200);}
