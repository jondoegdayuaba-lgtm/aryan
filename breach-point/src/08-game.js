
/* =====================================================================
   Rounds, economy and the match
   ===================================================================== */
const FREEZE_TIME=12,BUY_TIME=20,ROUND_TIME=115,BOMB_TIME=40,END_DELAY=5.5,WIN_ROUNDS=13,HALF=12;
const NAMES=[['Kite','Mako','Quill','Rasp','Dune'],['Bastion','Pike','Lumen','Orrin','Vesper']];
const G={phase:'menu',agents:[],player:null,round:0,score:[0,0],lossStreak:[0,0],phaseT:0,roundTime:ROUND_TIME,bomb:null,bombItem:null,
  plan:null,execAt:0,intel:null,roundKills:new Map(),squadSide:['S','W'],buyEnd:0,roundsPlayed:0,
  inMatch(){return this.phase!=='menu'&&this.phase!=='over';},
  sideOf(sq){return this.squadSide[sq];},
  canBuy(a){return a&&a.alive&&this.inMatch()&&NOW<this.buyEnd&&inSpawn(a.team,a.pos)&&!this.bomb;},
  lookItem(p){let best=null,bd=1.7;const d=dirFromAngles(p.yaw,p.pitch),e=p.eye();
    for(const it of items){if(it.bomb)continue;const to=it.pos.clone().sub(e);const dist=to.length();if(dist>2.2)continue;if(to.normalize().dot(d)<0.8)continue;if(dist<bd){bd=dist;best=it;}}return best;},
  newMatch(side,mapId){
    clearItems();FX.clear();for(const a of this.agents)if(a.model)scene.remove(a.model);
    loadMap(mapId||S.map);
    this.agents=[];const s0=side==='random'?pick(['S','W']):side;this.squadSide=[s0,s0==='S'?'W':'S'];
    this.player=new Agent('You',0,true);this.agents.push(this.player);
    const bn=shuffle(NAMES[0].slice()),en=shuffle(NAMES[1].slice());
    for(let i=0;i<4;i++)this.agents.push(new Agent(bn[i],0,false));
    for(let i=0;i<5;i++)this.agents.push(new Agent(en[i],1,false));
    for(const a of this.agents){a.team=this.sideOf(a.squad);
      if(!a.isPlayer){a.bot=new Bot(a);a.botSkins=rollBotSkins();a.botKnife=Math.random()<0.25?pick(knifeItems()):null;
        a.botAgent={S:pick(Object.keys(AGENT_INFO).filter(k=>AGENT_INFO[k].team==='S')),W:pick(Object.keys(AGENT_INFO).filter(k=>AGENT_INFO[k].team==='W'))};}
      this.dress(a);}
    this.score=[0,0];this.lossStreak=[0,0];this.round=0;this.roundsPlayed=0;
    Game.paused=false;$('gameover').classList.add('hidden');
    this.startRound(true);
  },
  // gives an agent its character model, arms and knife for its current side
  dress(a){
    a.agentId=a.isPlayer?Profile.agentFor(a.team):a.botAgent[a.team];
    const kn=a.isPlayer?Profile.knifeFor(a.team):{k:a.botKnife&&a.botKnife.k||'knife',f:a.botKnife&&a.botKnife.f||null};a.knifeModel=kn.k;a.knifeSkin=kn.f;
    if(a.model)scene.remove(a.model);a.model=buildCharacter(a.agentId);scene.add(a.model);
  },
  swapSides(){
    this.squadSide=[this.squadSide[1],this.squadSide[0]];this.lossStreak=[0,0];
    for(const a of this.agents){a.team=this.sideOf(a.squad);a.money=800;a.resetLoadout();this.dress(a);}
    HUD.chat('Halftime: teams switch sides.','sys');
  },
  startRound(first){
    this.round++;const pistol=this.round===1||this.round===HALF+1;
    clearItems();FX.clear();
    this.bomb=null;this.bombItem=null;this.planted=false;this.intel=null;this.roundKills=new Map();
    this.phase='freeze';this.phaseT=FREEZE_TIME;this.roundTime=ROUND_TIME;this.buyEnd=NOW+BUY_TIME;
    for(const T of['S','W']){
      const team=this.agents.filter(a=>a.team===T);const spots=shuffle(SPAWNS[T].slice());
      team.forEach((a,i)=>{
        if(pistol||!a.alive){a.resetLoadout();if(pistol)a.money=800;}
        a.hasBomb=false;if(!a.secondary){const pid=DEFAULT_PISTOL[T];a.secondary={id:pid,mag:WEP[pid].mag,res:WEP[pid].res,skin:a.skinPref(pid)};}
        for(const w of[a.primary,a.secondary])if(w){w.mag=WEP[w.id].mag;w.res=WEP[w.id].res;}
        const c=spots[i%spots.length];const p=cellPos(c[0],c[1]);p.x+=rand(-0.4,0.4);p.z+=rand(-0.4,0.4);
        a.slot=a.primary?1:2;a.spawnAt(p,T==='W'?Math.PI+rand(-0.2,0.2):rand(-0.2,0.2));
        if(a.model){a.model.userData.dying=undefined;}
      });
    }
    const S_=this.agents.filter(a=>a.team==='S');pick(S_).hasBomb=true;
    // bots buy and get their plans
    for(const T of['S','W']){const team=this.agents.filter(a=>a.team===T);const avg=team.reduce((s,a)=>s+a.money,0)/team.length;
      for(const a of team)if(a.bot){a.bot.roundReset();botBuy(a,avg,pistol);a.slot=a.primary?1:2;}}
    const site=pick(['A','B']);const main=Math.random()<0.5?0:1;this.plan={site};
    const sBots=shuffle(S_.filter(a=>a.bot));const split=Math.random()<0.45;
    sBots.forEach((a,i)=>{const r=split&&i>=sBots.length-2?1-main:main;a.bot.plan=PLANS[site][r];a.bot.planIdx=i;a.bot.mode='stage';});
    this.execAt=NOW+FREEZE_TIME+rand(22,42);
    const wBots=shuffle(this.agents.filter(a=>a.team==='W'&&a.bot));
    const roles=shuffle(['A','A','B','B','M']);const used={A:[],B:[],M:[]};
    wBots.forEach((a,i)=>{const s=roles[i%roles.length];const opts=HOLDS[s].filter(h=>!used[s].includes(h));const h=pick(opts.length?opts:HOLDS[s]);used[s].push(h);
      a.bot.hold={c:h.c,l:h.l,site:s};a.bot.crouchHold=Math.random()<0.3;a.bot.mode='hold';});
    Spectate.mode='alive';Spectate.target=null;$('deathInfo').classList.add('hidden');$('roundBanner').classList.add('hidden');
    VM.setWeapon(this.player);Cam.eyeY=this.player.eyeY;
    if(Buy.open)Buy.render();
    HUD.chat(pistol?'Pistol round. Round '+this.round+' — buy time is on.':'Round '+this.round+' — buy time is on.','sys');
    if(this.player.team==='S'&&this.player.hasBomb)HUD.chat('You are carrying the bomb (slot 5).','sys');
  },
  endRound(win,reason,mvp){
    if(this.phase!=='live')return;
    this.phase='end';this.phaseT=END_DELAY;this.roundsPlayed++;
    const wsq=this.squadSide[0]===win?0:1,lsq=1-wsq;this.score[wsq]++;
    const lose=win==='S'?'W':'S';
    const winCash=reason==='Target bombed'||reason==='Bomb defused'?3500:3250;
    this.lossStreak[lsq]=Math.min(4,this.lossStreak[lsq]+1);this.lossStreak[wsq]=Math.max(0,this.lossStreak[wsq]-1);
    const lossCash=1400+500*(this.lossStreak[lsq]-1);
    for(const a of this.agents){
      if(a.team===win)addMoney(a,winCash,'Round win');
      else{if(lose==='S'&&reason==='Time ran out'&&a.alive)continue;addMoney(a,lossCash+(lose==='S'&&this.planted?800:0),'Round loss');}
    }
    if(!mvp||mvp.team!==win){let best=null,bk=-1;for(const[a,k]of this.roundKills)if(a.team===win&&(k>bk||(k===bk&&a.stats.dmg>best.stats.dmg))){best=a;bk=k;}mvp=best;}
    if(mvp)mvp.stats.mvp++;
    const b=$('roundBanner');b.className=win;b.classList.remove('hidden');
    b.innerHTML=`<h2>${win==='S'?'STRIKERS':'WARDENS'} WIN</h2><p>${esc(reason)}</p>`+(mvp?`<p class="mvp">★ MVP: ${esc(mvp.name)}${reason==='Target bombed'&&mvp===this.bomb?.planter?' for planting the bomb':reason==='Bomb defused'?' for defusing the bomb':' for most eliminations'}</p>`:'');
    SFX.win(win===this.player.team);
    if(this.score[wsq]>=WIN_ROUNDS||this.roundsPlayed>=HALF*2)this.gameOverPending=true;
    else if(this.roundsPlayed===HALF){this.halfPending=true;b.innerHTML+='<p>Halftime — switching sides</p>';}
  },
  update(dt){
    if(this.phase==='freeze'){this.phaseT-=dt;if(this.phaseT<=0){this.phase='live';SFX.roundStart();HUD.center('GO!',1);}}
    else if(this.phase==='live'){
      if(!this.bomb){this.roundTime-=dt;}
      const alive=t=>this.agents.some(a=>a.alive&&a.team===t);
      if(!alive('W'))this.endRound('S','Wardens eliminated');
      else if(!alive('S')&&!this.bomb)this.endRound('W','Strikers eliminated');
      else if(this.roundTime<=0&&!this.bomb)this.endRound('W','Time ran out');
    }else if(this.phase==='end'){
      this.phaseT-=dt;
      if(this.phaseT<=0){
        if(this.gameOverPending){this.gameOverPending=false;Game.gameOver();return;}
        if(this.halfPending){this.halfPending=false;this.swapSides();}
        this.startRound();
      }
    }
  }
};

/* =====================================================================
   Game shell: menus, settings, main loop
   ===================================================================== */
const Game={paused:false,last:0,fpsAcc:0,fpsN:0,menuT:0,menuModel:null,
  pause(on){this.paused=on;$('pause').classList.toggle('hidden',!on);if(on)Buy.toggle(false);},
  playerDrop(){
    const p=G.player;if(!p.alive)return;
    if(p.slot===1&&p.primary){dropItem(p,p.primary,false);p.primary=null;p.slot=3;switchSlot(p,p.secondary?2:3)||VM.setWeapon(p);}
    else if(p.slot===2&&p.secondary){dropItem(p,p.secondary,false);p.secondary=null;p.slot=3;switchSlot(p,p.primary?1:3)||VM.setWeapon(p);}
    else if(p.slot===5&&p.hasBomb){p.hasBomb=false;dropBomb(p);switchSlot(p,p.primary?1:p.secondary?2:3);}
    else if(p.hasBomb&&p.slot!==1&&p.slot!==2){p.hasBomb=false;dropBomb(p);}
  },
  playerUse(){
    const p=G.player;const it=G.lookItem(p);if(!it)return;const s=WEP[it.id].slot;
    const cur=s===1?p.primary:p.secondary;if(cur)dropItem(p,cur,false);if(s===1)p.primary=null;else p.secondary=null;
    pickupItem(p,it,items.indexOf(it));switchSlot(p,s);
  },
  gameOver(){
    G.phase='over';Input.allowUnlock=true;document.exitPointerLock&&document.exitPointerLock();
    const w=G.score[0]>G.score[1]?0:G.score[1]>G.score[0]?1:-1;
    $('goTitle').textContent=w===0?'VICTORY':w===1?'DEFEAT':'DRAW';
    $('goTitle').style.color=w===0?'#7be07b':w===1?'#ff6a5a':'#ffd56b';
    $('goScore').innerHTML=`${esc(MAP.name)} · your team <b>${G.score[0]}</b> : <b>${G.score[1]}</b> enemy team`;
    const rw=Profile.reward(G.player,w===0,w===-1,G.score[0],S.difficulty);
    $('rewards').innerHTML='<div class="hist" style="font-size:16px"><span>COINS EARNED</span><b><span class="coin" style="vertical-align:-3px"></span> +'+rw.total+'</b></div>'+
      rw.lines.map(l=>`<div class="hist"><span>${esc(l[0])}</span><span>${l[1]===null?'':'+'+l[1]}</span></div>`).join('')+
      `<div class="hist"><span>Balance</span><b>${Profile.coins.toLocaleString()}</b></div>`;
    $('goBoard').innerHTML=scoreboardHTML();$('gameover').classList.remove('hidden');SFX.win(w===0);
  },
  start(){
    SFX.init();
    const el=document.documentElement;
    try{const fs=el.requestFullscreen&&el.requestFullscreen();if(fs&&fs.then)fs.then(()=>{if(navigator.keyboard&&navigator.keyboard.lock)navigator.keyboard.lock().catch(()=>{});}).catch(()=>{});}catch(e){}
    $('menu').classList.add('hidden');$('hud').classList.remove('hidden');Lobby.hideModel();
    G.newMatch(S.side,S.map);Input.lock();
  },
  toMenu(){
    G.phase='menu';this.pause(false);$('gameover').classList.add('hidden');$('hud').classList.add('hidden');$('menu').classList.remove('hidden');
    clearItems();FX.clear();for(const a of G.agents)if(a.model)scene.remove(a.model);G.agents=[];G.player=null;
    Input.allowUnlock=true;document.exitPointerLock&&document.exitPointerLock();Lobby.show();
    try{if(document.fullscreenElement)document.exitFullscreen();}catch(e){}
  },
  sim(dt){
    NOW+=dt;
    G.update(dt);if(G.phase==='over'||G.phase==='menu')return;
    const p=G.player;Input.apply(p);
    for(const a of G.agents)if(a.bot)a.bot.update(dt);
    const sub=dt>1/50?2:1;
    for(const a of G.agents){if(!a.alive)continue;
      for(let i=0;i<sub;i++)physics(a,dt/sub);
      weaponLogic(a,dt);
      const usePlant=a.hasBomb&&a.input.use&&a.slot!==5;
      if(usePlant&&!tryPlant(a,dt))a.plantProg=0;
      if(!a.input.use&&!(a.slot===5&&a.input.fire))a.plantProg=0;
    }
    separateAgents();
    updateNades(dt);updateItems(dt);updateFireDamage(dt);updateBomb(dt);
    // the player spots enemies on screen for the radar
    if(p.alive){const e=p.eye();const look=dirFromAngles(p.yaw,p.pitch);
      for(const o of G.agents){if(!o.alive||o.team===p.team)continue;const c=V3(o.pos.x,o.pos.y+1.2,o.pos.z);const to=c.clone().sub(e);const d=to.length();
        if(to.normalize().dot(look)<Math.cos(S.fov*DEG*0.6)||d>90||NOW<p.blindUntil)continue;
        if(!World.segBlocked(e.x,e.y,e.z,c.x,c.y,c.z)&&!FX.smokeBlocks(e,c))o.spottedUntil=NOW+1.5;}}
    Spectate.update();
  },
  animModels(dt){
    const vt=viewTarget();
    for(const a of G.agents){const m=a.model;if(!m)continue;const u=m.userData;
      if(!a.alive){m.visible=true;if(u.dying===undefined)u.dying=0;u.dying+=dt;const k=Math.min(1,u.dying/0.45);m.rotation.x=-k*1.52;m.position.y=a.pos.y+k*0.12;continue;}
      m.visible=!(a===vt&&Spectate.mode!=='death');
      m.position.copy(a.pos);m.rotation.set(0,a.yaw,0);
      const sp=Math.hypot(a.vel.x,a.vel.z);u.ph=(u.ph||0)+dt*sp*2.4;const sw=Math.min(1,sp/4)*(a.onGround?1:0.3);
      const c=a.crouchAmt;
      u.legs.forEach((l,i)=>{const s=i?-1:1;l.hip.position.y=0.92-0.42*c;l.hip.rotation.x=Math.sin(u.ph)*0.55*sw*s+c*1.15;l.knee.rotation.x=-Math.max(0,-Math.sin(u.ph)*s)*0.8*sw-c*2.1;});
      u.upper.position.y=-0.42*c;u.upper.rotation.x=c*0.15;
      u.head.rotation.x=a.pitch*0.5;u.arms.rotation.x=a.pitch*0.85;
      setCharGun(m,a.curId(),a.team,skinOf(a,a.curId()),knifeModelOf(a,a.curId()));
    }
  },
  render(dt){
    if(G.phase==='menu'){Lobby.updateScene(dt);updateSun();Weather.update(dt);Post.render(false);return;}
    Cam.update(dt);
    const v=viewTarget();VM.update(dt,v&&Spectate.mode!=='death'?v:null,Input.mdx,Input.mdy);Input.mdx=0;Input.mdy=0;
    vmCam.fov=vFovFor(Math.min(S.fov,90)*0.85,vmCam.aspect);vmCam.updateProjectionMatrix();
    updateSun();Weather.update(dt);Post.render(VM.root.visible);
    HUD.update(dt);
  },
  frame(t){
    const dt=Math.min(0.05,Math.max(0.001,(t-(this.last||t))/1000));this.last=t;
    if(G.inMatch()&&!this.paused)this.sim(dt);
    if(G.phase!=='menu'&&!this.paused){FX.update(dt);this.animModels(dt);}
    this.render(dt);
    if(S.showFps){this.fpsAcc+=dt;this.fpsN++;if(this.fpsAcc>0.5){$('fps').textContent=Math.round(this.fpsN/this.fpsAcc)+' fps';this.fpsAcc=0;this.fpsN=0;}}
    // one tip per session if Ultra/High runs slowly on this machine
    if(G.inMatch()&&!this.paused&&!this.fpsTipped&&S.quality!=='low'&&S.quality!=='medium'){this.perfT=(this.perfT||0)+dt;this.perfN=(this.perfN||0)+1;
      if(this.perfT>12){if(this.perfN/this.perfT<35){this.fpsTipped=true;HUD.chat('Low frame rate: open Settings (Esc) and pick a lower Graphics preset.','sys');}else{this.perfT=0;this.perfN=0;}}}
    requestAnimationFrame(tt=>this.frame(tt));
  }
};

/* ------------------------------- settings UI ------------------------------- */
const Settings={from:null,
  rows:[['sens','Sensitivity',0.2,8,0.05],['fov','Field of view',70,110,1],['volume','Volume',0,1,0.01],['xSize','Crosshair size',1,16,1],['xGap','Crosshair gap',-2,12,1],['xThick','Crosshair thickness',1,6,1],['renderScale','Render scale',0.5,1,0.05]],
  toggles:[['xDot','Centre dot'],['xOutline','Outline'],['xDynamic','Dynamic (shows spread)'],['showFps','Show FPS']],
  colors:['#4cff6a','#00e5ff','#ffe14d','#ff4cf0','#ffffff','#ff3b30'],
  open(from){this.from=from;this.render();$('settings').classList.remove('hidden');},
  close(){$('settings').classList.add('hidden');saveSettings();applyGraphics();if(MAP)applyTheme();SFX.setVolume(S.volume);$('fps').classList.toggle('hidden',!S.showFps);},
  render(){
    const g=$('setGrid');g.innerHTML='';
    g.insertAdjacentHTML('beforeend',`<span>Graphics</span><div class="seg" id="segQ">${Object.keys(QUALITY).map(k=>`<button data-v="${k}" class="${S.quality===k?'on':''}">${QUALITY[k].label}</button>`).join('')}</div><span></span>`);
    g.querySelectorAll('#segQ button').forEach(b=>b.onclick=()=>{S.quality=b.dataset.v;this.render();});
    for(const[k,l,mn,mx,st]of this.rows){g.insertAdjacentHTML('beforeend',`<span>${l}</span><input type="range" min="${mn}" max="${mx}" step="${st}" value="${S[k]}" data-k="${k}"><span class="v" id="v_${k}">${S[k]}</span>`);}
    g.insertAdjacentHTML('beforeend',`<span>Crosshair colour</span><div class="swatches">${this.colors.map(c=>`<div class="sw${S.xColor===c?' on':''}" data-c="${c}" style="background:${c}"></div>`).join('')}<input type="color" value="${S.xColor}" id="xCol"></div><span></span>`);
    for(const[k,l]of this.toggles)g.insertAdjacentHTML('beforeend',`<span>${l}</span><label><input type="checkbox" data-t="${k}" ${S[k]?'checked':''}></label><span></span>`);
    g.querySelectorAll('input[type=range]').forEach(i=>i.oninput=()=>{const k=i.dataset.k;S[k]=+i.value;$('v_'+k).textContent=i.value;if(k==='volume')SFX.setVolume(S.volume);this.preview();});
    g.querySelectorAll('.sw').forEach(s=>s.onclick=()=>{S.xColor=s.dataset.c;this.render();});
    $('xCol').oninput=e=>{S.xColor=e.target.value;this.preview();};
    g.querySelectorAll('input[type=checkbox]').forEach(i=>i.onchange=()=>{S[i.dataset.t]=i.checked;this.preview();});
    this.preview();
  },
  preview(){const c=$('xPreview'),g=c.getContext('2d');g.clearRect(0,0,96,96);drawCross(g,48,48,S.xSize,S.xGap,S.xThick,S.xColor,S.xDot,S.xOutline);}
};

function setupMenus(){
  $('btnResume').onclick=()=>{Game.pause(false);Input.lock();};
  $('btnPauseSettings').onclick=()=>Settings.open('pause');
  $('btnQuit').onclick=()=>Game.toMenu();
  $('btnCloseSet').onclick=()=>Settings.close();
  $('btnResetSet').onclick=()=>{const keep={difficulty:S.difficulty,side:S.side};Object.assign(S,DEFAULTS,keep);Settings.render();};
  $('btnAgain').onclick=()=>{$('gameover').classList.add('hidden');G.newMatch(S.side,S.map);Input.lock();};
  $('btnMenu').onclick=()=>Game.toMenu();
  $('buyMenu').addEventListener('mousedown',e=>{if(e.target===$('buyMenu'))Buy.toggle(false);});
  $('fps').classList.toggle('hidden',!S.showFps);
}

// switches the world to another map (rebuilds geometry, lighting, sky and radar)
function loadMap(id){
  if(MAP&&MAP.id===id&&mapGroup)return;
  useMap(id);waterMesh=null;buildMap();applyTheme();HUD.buildRadarBase();
}
function rollBotSkins(){const out={};for(const w of SKIN_WEAPONS){if(w==='knife'||Math.random()>0.3)continue;const opts=CASES.flatMap(c=>c.items).filter(i=>i.w===w);if(opts.length)out[w]=pick(opts).f;}return out;}
function knifeItems(){return CASES.flatMap(c=>c.items).filter(i=>i.w==='knife');}
function boot(){
  buildTextures();
  initRenderer();
  loadGLB(MODELS_GLB);
  Profile.load();
  loadMap(MAPS[S.map]?S.map:'sandline');
  makeIcons();
  FX.init();VM.init();Input.init();setupMenus();Lobby.init();
  $('loading').classList.add('hidden');Lobby.show();
  window.__bp={G,Game,World,Input,FX,cellPos,applyDamage,S,WEP,VM,ASSET,THREE,Profile,Lobby,loadMap,CASES,MAPS,MAP_ORDER,FINISHES,KNIVES,PATTERNS,Thumb,applyGraphics,gfx:()=>({renderer,sun,scene,camera,Post})}; // handle for debugging and automated tests
  requestAnimationFrame(t=>Game.frame(t));
}
