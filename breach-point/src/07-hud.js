
/* =====================================================================
   First-person view model, camera, spectating
   ===================================================================== */
function viewTarget(){if(!G.player)return null;if(G.player.alive)return G.player;return Spectate.target&&Spectate.mode==='spec'?Spectate.target:G.player;}
const VM={
  root:null,holder:null,gun:null,id:null,team:null,owner:null,kickZ:0,kickR:0,reloadT:-1,reloadDur:1,drawT:1,slashT:-1,slashHeavy:false,bob:0,swayX:0,swayY:0,flash:null,flashT:0,
  init(){this.root=new THREE.Group();vmScene.add(this.root);this.holder=new THREE.Group();this.root.add(this.holder);
    this.flash=new THREE.Sprite(new THREE.SpriteMaterial({map:TEX.soft,color:0xffc070,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false}));this.flash.visible=false;},
  setWeapon(a){
    const id=a.curId();this.owner=a;this.id=id;this.team=a.team;this.skin=skinOf(a,id);this.agent=a.agentId;this.kmodel=knifeModelOf(a,id);
    while(this.holder.children.length)this.holder.remove(this.holder.children[0]);
    const g=buildGun(id,a.team,this.skin,this.kmodel);this.gun=g;this.holder.add(g.group);
    const cls=WEP[id].cls;
    const gn=g.group.name.replace(/_root$/,''),gp=g.group.getObjectByName(gn+'_grip')||g.group.getObjectByName(gn+'_handle');
    const grip=gp?gp.position.clone():V3(0,-0.06,0.03);
    const armR=asset(a.agentId+'_vmarmR');g.group.add(armR);
    if(cls==='knife'){g.group.rotation.x=1.1;armR.position.copy(grip);armR.rotation.set(-Math.PI/2,0,0);}
    else if(cls==='nade'){armR.position.set(0,0.035,0.01);armR.rotation.set(-0.15,0,0);}
    else if(cls==='bomb'){armR.position.set(0.1,0.02,0.02);armR.rotation.set(0,0,0);}
    else{armR.position.copy(grip);armR.rotation.set(-0.28,0,0);}
    if(cls==='pistol'||cls==='heavy'){const armL=asset(a.agentId+'_vmarmL');armL.position.copy(grip).add(V3(-0.036,-0.018,-0.004));armL.rotation.set(1.25,-0.5,0.35);g.group.add(armL);}
    else if(cls!=='knife'&&cls!=='nade'){const armL=asset(a.agentId+'_vmarmL');armL.position.copy(g.fore).add(V3(0,cls==='bomb'?0:0.024,0));g.group.add(armL);}
    if(cls==='nade')g.group.scale.setScalar(0.9);
    g.group.add(this.flash);this.flash.position.copy(g.muzzle);this.flash.position.z-=0.03;
    this.drawT=0;this.reloadT=-1;this.slashT=-1;
  },
  kick(w){const c=w.cls;this.kickZ+=c==='sniper'?0.09:c==='shotgun'?0.08:c==='heavy'?0.06:c==='pistol'?0.035:0.025;this.kickR+=c==='sniper'?0.18:c==='heavy'||c==='shotgun'?0.14:0.05;
    this.flashT=0.05;this.flash.material.rotation=Math.random()*6;this.flash.scale.setScalar(c==='pistol'?0.14:0.22);},
  reload(w){this.reloadT=0;this.reloadDur=w.shells?0.5:w.reload;},
  slash(h){this.slashT=0;this.slashHeavy=h;},
  update(dt,a,mdx,mdy){
    if(!a){this.root.visible=false;return;}
    if(this.owner!==a||this.id!==a.curId()||this.team!==a.team||this.skin!==skinOf(a,this.id)||this.agent!==a.agentId||this.kmodel!==knifeModelOf(a,this.id))this.setWeapon(a);
    const cls=WEP[this.id].cls;
    this.root.visible=a.alive&&!(cls==='sniper'&&a.scope);
    const base=cls==='knife'?[0.15,-0.15,-0.32]:cls==='nade'?[0.17,-0.16,-0.42]:cls==='bomb'?[0.06,-0.2,-0.36]:cls==='pistol'||cls==='heavy'?[0.12,-0.13,-0.36]:cls==='sniper'?[0.15,-0.17,-0.46]:[0.13,-0.15,-0.33];
    const sp=Math.hypot(a.vel.x,a.vel.z);this.bob+=dt*sp*1.6;const bk=a.onGround?Math.min(1,sp/6):0.2;
    this.swayX=lerp(this.swayX,clamp(-mdx*0.0006,-0.03,0.03),Math.min(1,dt*10));this.swayY=lerp(this.swayY,clamp(mdy*0.0006,-0.03,0.03),Math.min(1,dt*10));
    this.kickZ=lerp(this.kickZ,0,Math.min(1,dt*14));this.kickR=lerp(this.kickR,0,Math.min(1,dt*12));
    this.drawT=Math.min(1,this.drawT+dt*2.4);const dr=1-this.drawT;
    let rx=this.kickR-dr*0.9,ry=0,rz=0,px=base[0]+Math.sin(this.bob)*0.012*bk+this.swayX,py=base[1]-Math.abs(Math.cos(this.bob))*0.012*bk-dr*0.2+this.swayY-(a.crouch?0.005:0),pz=base[2]+this.kickZ;
    if(!a.onGround)py+=clamp(a.vel.y*0.004,-0.03,0.03);
    if(this.reloadT>=0){this.reloadT+=dt;const k=this.reloadT/this.reloadDur;if(k>=1)this.reloadT=-1;else{const s=Math.sin(Math.min(1,k)*Math.PI);rx-=s*0.5;rz+=s*0.45;py-=s*0.06;}}
    if(this.slashT>=0){this.slashT+=dt;const D=this.slashHeavy?0.6:0.3,k=this.slashT/D;if(k>=1)this.slashT=-1;else{const s=Math.sin(k*Math.PI);
      if(this.slashHeavy){pz-=s*0.18;rx-=s*0.5;}else{ry+=Math.sin(k*Math.PI*2)*0.9*(1-k);px-=s*0.12;rz+=s*0.8;}}}
    if(cls==='nade'&&a.throwHold){py+=0.05;pz+=0.06;rx+=0.6;}
    if(a.plantProg>0){py-=0.08;rx-=0.6;}
    this.holder.position.set(px,py,pz);this.holder.rotation.set(rx,ry,rz);
    if(cls==='knife')this.holder.rotation.z+=0.1;
    this.flashT-=dt;this.flash.visible=this.flashT>0;
  }
};
const Cam={shakeAmt:0,eyeY:0,
  shake(p,str){const v=viewTarget();if(!v)return;const d=v.pos.distanceTo(p);this.shakeAmt=Math.max(this.shakeAmt,str*clamp(1-d/40,0,1));},
  update(dt){
    const v=viewTarget();if(!v)return;
    let pos,yaw,pitch;
    if(Spectate.mode==='death'){
      const k=Math.min(1,(NOW-Spectate.t0)/1.2);const base=Spectate.deathPos;
      pos=base.clone().add(V3(0,0.6*k,0));let tgt=Spectate.killer&&Spectate.killer!==G.player?Spectate.killer.eye():base.clone().add(dirFromAngles(Spectate.deathYaw,-0.3));
      const d=tgt.clone().sub(pos);yaw=lerp(Spectate.deathYaw,yawTo(d.x,d.z),0)+angDiff(Spectate.deathYaw,yawTo(d.x,d.z))*k;
      pitch=Math.atan2(d.y,Math.hypot(d.x,d.z))*k;camera.position.copy(pos);
    }else{
      const ey=v.eyeY;if(v.onGround&&Math.abs(ey-this.eyeY)<0.8)this.eyeY=lerp(this.eyeY,ey,Math.min(1,dt*16));else this.eyeY=ey;
      camera.position.set(v.pos.x,this.eyeY,v.pos.z);yaw=v.yaw;pitch=v.pitch;
      yaw+=-v.vPunch[0]*DEG;pitch+=v.vPunch[1]*DEG+v.hurtPunch*DEG;
    }
    if(this.shakeAmt>0){this.shakeAmt=Math.max(0,this.shakeAmt-dt*1.5);yaw+=rand(-1,1)*this.shakeAmt*0.03;pitch+=rand(-1,1)*this.shakeAmt*0.03;}
    camera.rotation.set(pitch,yaw,0);
    const w=WEP[v.curId()];let hf=S.fov;if(w.cls==='sniper'&&v.scope&&v.alive&&Spectate.mode!=='death')hf=v.scope===1?40:15;
    camera.fov=vFovFor(hf,camera.aspect);camera.updateProjectionMatrix();
    listener.x=camera.position.x;listener.y=camera.position.y;listener.z=camera.position.z;listener.yaw=yaw;
  }
};
const Spectate={mode:'alive',target:null,killer:null,t0:0,deathPos:null,deathYaw:0,
  onPlayerDeath(k){this.mode='death';this.killer=k;this.t0=NOW;this.deathPos=G.player.eye();this.deathYaw=G.player.yaw;HUD.deathInfo(k);},
  next(dir){const alive=G.agents.filter(a=>a.alive&&a!==G.player);if(!alive.length)return;
    const mates=alive.filter(a=>a.team===G.player.team);const list=mates.length?mates:alive;
    let i=list.indexOf(this.target);i=(i+(dir||1)+list.length)%list.length;this.target=list[i];Cam.eyeY=this.target.eyeY;},
  update(){
    if(G.player.alive){this.mode='alive';this.target=null;return;}
    if(this.mode==='death'&&NOW-this.t0>3){this.mode='spec';this.target=null;this.next(1);$('deathInfo').classList.add('hidden');}
    if(this.mode==='spec'&&(!this.target||!this.target.alive)){const old=this.target;this.target=null;this.next(1);if(!this.target)this.target=old;}
  }
};

/* =====================================================================
   HUD
   ===================================================================== */
const HUD={cache:{},kills:[],chatMsgs:[],dmgDirs:[],centerUntil:0,hitT:0,hurtV:0,radarBase:null,
  set(id,v,prop){if(this.cache[id+(prop||'')]===v)return;this.cache[id+(prop||'')]=v;const el=$(id);if(prop==='html')el.innerHTML=v;else if(prop==='src')el.src=v;else if(prop)el.style[prop]=v;else el.textContent=v;},
  cls(id,c,on){const k=id+'.'+c;if(this.cache[k]===on)return;this.cache[k]=on;$(id).classList.toggle(c,on);},
  hitMarker(hs){this.hitT=0.25;$('hitmarker').classList.toggle('hs',hs);SFX.hit(hs);},
  damageFrom(p){this.dmgDirs.push({p:p.clone(),t:1.4});},
  hurt(d){this.hurtV=Math.min(1,this.hurtV+d/60);},
  center(msg,dur){$('centerMsg').textContent=msg;this.centerUntil=NOW+(dur||2);},
  chat(msg,cls){const c=$('chat');const d=document.createElement('div');d.className='m '+(cls||'');d.innerHTML=msg;c.appendChild(d);
    while(c.children.length>6)c.removeChild(c.firstChild);setTimeout(()=>d.classList.add('old'),7000);setTimeout(()=>d.remove(),8200);},
  moneyDelta(d,why){const el=$('moneyDelta');el.textContent=(d>0?'+$':'-$')+Math.abs(d);el.style.color=d>0?'#8be38b':'#ff7a6a';clearTimeout(this._md);this._md=setTimeout(()=>el.textContent='',2500);},
  kill(k,v,wid,hs,wb){
    const kf=$('killfeed');const row=document.createElement('div');row.className='kf'+((k===G.player||v===G.player)?' me':'');
    const icon=ICON[wid==='fire'?'fire':wid]||ICON[wid==='world'?'bomb':'he'];
    row.innerHTML=(k&&k!==v?`<span class="${k.team}">${esc(k.name)}</span>`:'')+`<img src="${icon}" alt="">`+(wb?WB_SVG:'')+(hs?HS_SVG:'')+`<span class="${v.team}">${esc(v.name)}</span>`;
    kf.appendChild(row);while(kf.children.length>6)kf.removeChild(kf.firstChild);setTimeout(()=>row.remove(),k===G.player?9000:6000);
  },
  deathInfo(k){
    const el=$('deathInfo');el.classList.remove('hidden');
    if(!k||k===G.player){el.innerHTML='You died.';return;}
    const given=k.dmgFrom?(k.dmgFrom.get(G.player)||0):0,taken=G.player.dmgFrom.get(k)||0;
    el.innerHTML=`Killed by <b>${esc(k.name)}</b> with ${esc(WEP[k.curId()]?WEP[k.curId()].name:'')} · ${k.hp} HP left<br><small>Damage given ${given} · taken ${taken}</small>`;
  },
  buildRadarBase(){
    const c=document.createElement('canvas');c.width=GW*4;c.height=GH*4;const g=c.getContext('2d');
    for(let r=0;r<GH;r++)for(let col=0;col<GW;col++){const ch=World.grid[r][col];
      g.fillStyle=ch==='#'?'#2c2820':ch==='~'?'#1d4656':ch==='='?'#776a55':'12345'.includes(ch)?'#cdb48a':'kK'.includes(ch)?'#5a5048':ch==='z'?'#2e4a2e':'cmCvo|-PynwuC'.includes(ch)?'#6d5536':'#a8916a';g.fillRect(col*4,r*4,4,4);}
    for(const[c0,r0,c1,r1]of MAP.roofs){g.fillStyle='rgba(0,0,0,.18)';g.fillRect(c0*4,r0*4,(c1-c0+1)*4,(r1-r0+1)*4);}
    for(const k in SITES){const s=SITES[k];g.fillStyle='rgba(220,60,40,.22)';g.fillRect(s.c0*4,s.r0*4,(s.c1-s.c0+1)*4,(s.r1-s.r0+1)*4);
      g.fillStyle='#ff6a50';g.font='bold 22px sans-serif';g.textAlign='center';g.fillText(k,(s.center[0])*4,(s.center[1])*4+8);}
    this.radarBase=c;
  },
  drawRadar(){
    const c=$('radar'),g=c.getContext('2d');const v=viewTarget();if(!v)return;
    const W=c.width,cxp=W/2,cyp=W/2,k=2.6;const px=v.pos.x,pz=v.pos.z,y=v.yaw;const co=Math.cos(y),si=Math.sin(y);
    g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,W,W);g.save();g.beginPath();g.arc(cxp,cyp,W/2-1,0,7);g.clip();
    g.fillStyle='#1a1712';g.fillRect(0,0,W,W);
    const a=k*co/2,b=k*si/2,cc=-k*si/2,d=k*co/2;
    const e=cxp+k*((OX-px)*co-(OZ-pz)*si),f=cyp+k*((OX-px)*si+(OZ-pz)*co);
    g.setTransform(a,b,cc,d,e,f);g.drawImage(this.radarBase,0,0);g.setTransform(1,0,0,1,0,0);
    const toS=p=>{const dx=p.x-px,dz=p.z-pz;return[cxp+k*(dx*co-dz*si),cyp+k*(dx*si+dz*co)];};
    const me=G.player.team;
    for(const o of G.agents){if(o===v)continue;const s=toS(o.pos);
      if(o.team===me){if(!o.alive){g.strokeStyle='#888';g.lineWidth=2;g.beginPath();g.moveTo(s[0]-3,s[1]-3);g.lineTo(s[0]+3,s[1]+3);g.moveTo(s[0]+3,s[1]-3);g.lineTo(s[0]-3,s[1]+3);g.stroke();continue;}
        g.fillStyle=me==='S'?'#ffcf6b':'#7ab8ff';g.beginPath();g.arc(s[0],s[1],4,0,7);g.fill();g.strokeStyle='#000';g.lineWidth=1;g.stroke();
        if(o.hasBomb&&me==='S'){g.fillStyle='#ff6a1a';g.fillRect(s[0]+3,s[1]-7,5,5);}}
      else if(o.alive&&NOW<o.spottedUntil){g.fillStyle='#ff3b30';g.beginPath();g.arc(s[0],s[1],4.5,0,7);g.fill();g.strokeStyle='#000';g.stroke();}}
    const bombP=G.bomb&&!G.bomb.done?G.bomb.pos:(G.bombItem&&me==='S'?G.bombItem.pos:null);
    if(bombP){const s=toS(bombP);g.fillStyle=G.bomb&&Math.floor(NOW*3)%2?'#ff2020':'#ff8a1a';g.fillRect(s[0]-4,s[1]-4,8,8);g.strokeStyle='#000';g.strokeRect(s[0]-4,s[1]-4,8,8);}
    g.fillStyle='#fff';g.beginPath();g.moveTo(cxp,cyp-7);g.lineTo(cxp-5,cyp+5);g.lineTo(cxp,cyp+2);g.lineTo(cxp+5,cyp+5);g.closePath();g.fill();
    g.restore();
  },
  drawCrosshair(){
    const c=$('crosshairC'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);
    const v=viewTarget();if(!v||!v.alive||Spectate.mode==='death')return;const w=WEP[v.curId()];
    if(w.cls==='sniper'){if(!v.scope){g.fillStyle=S.xColor;g.fillRect(c.width/2-1,c.height/2-1,2,2);}return;}
    let gap=S.xGap;if(S.xDynamic&&w.inacc){const sp=inaccuracy(v,w);const px=Math.tan(sp*DEG)/Math.tan(camera.fov*DEG/2)*(window.innerHeight/2);gap+=Math.min(60,px*0.6);}
    drawCross(g,c.width/2,c.height/2,S.xSize,gap,S.xThick,S.xColor,S.xDot,S.xOutline);
  },
  drawDamage(dt){
    const c=$('dmgind'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);const v=viewTarget();if(!v)return;
    for(let i=this.dmgDirs.length-1;i>=0;i--){const d=this.dmgDirs[i];d.t-=dt;if(d.t<=0){this.dmgDirs.splice(i,1);continue;}
      const ang=angDiff(v.yaw,yawTo(d.p.x-v.pos.x,d.p.z-v.pos.z));const a=-ang-Math.PI/2;
      g.strokeStyle=`rgba(255,40,30,${Math.min(1,d.t)})`;g.lineWidth=10;g.beginPath();g.arc(210,210,170,a-0.32,a+0.32);g.stroke();}
  },
  drawTags(){
    const c=$('tags'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);if(!G.player||G.phase==='menu')return;
    const v=viewTarget();const me=G.player.team;g.font='600 13px Rajdhani, sans-serif';g.textAlign='center';
    for(const o of G.agents){if(!o.alive||o===v||o.team!==me)continue;
      const p=V3(o.pos.x,o.pos.y+2.05-0.5*o.crouchAmt,o.pos.z);const d=p.distanceTo(camera.position);if(d>70)continue;
      p.project(camera);if(p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1)continue;
      const x=(p.x+1)/2*c.width,y=(1-p.y)/2*c.height;g.fillStyle='rgba(0,0,0,.6)';g.fillText(o.name,x+1,y+1);g.fillStyle=me==='S'?'#ffcf6b':'#a8d2ff';g.fillText(o.name,x,y);}
    if(G.bomb&&!G.bomb.done&&me==='S'){const p=G.bomb.pos.clone();p.y+=0.6;p.project(camera);if(p.z<1){const x=(p.x+1)/2*c.width,y=(1-p.y)/2*c.height;g.fillStyle=Math.floor(NOW*3)%2?'#ff3030':'#ff9a30';g.fillText('◆ BOMB',x,y);}}
  },
  pips(){
    const mk=(sq)=>G.agents.filter(a=>a.squad===sq).map(a=>`<div class="pip ${a.team}${a.alive?'':' dead'}">${a.isPlayer?'★':''}</div>`).join('');
    this.set('pipsL',mk(0),'html');this.set('pipsR',mk(1),'html');
  },
  update(dt){
    const v=viewTarget();if(!v)return;const p=G.player;
    this.set('hp',String(Math.ceil(v.hp)));this.cls('hpBox','low',v.hp<=25);
    this.set('ar',String(v.armor));this.set('helm',v.helmet?'⛑':'');
    this.set('money','$'+p.money);
    const canBuy=G.canBuy(p);this.set('buyZone',canBuy?'B · Buy menu ('+Math.ceil(G.buyEnd-NOW)+'s)':'');
    const id=v.curId(),w=WEP[id],inst=v.curInst();
    this.set('wepName',id==='fire'?nadeName('fire',v.team):w.name);this.set('wepIcon',ICON[id],'src');
    if(inst){this.set('ammo',`${inst.mag}<small> / ${inst.res}</small>`,'html');this.cls('ammo','low',inst.mag<=Math.ceil(w.mag*0.2));}
    else this.set('ammo',w.cls==='nade'?'1':'','html');
    this.set('nadeRow',v.nades.map((n,i)=>`<img class="${v.slot===4&&v.nadeIdx===i?'sel':''}" src="${ICON[n]}" alt="">`).join('')+(v.hasBomb?`<img class="${v.slot===5?'sel':''}" src="${ICON.bomb}" alt="">`:''),'html');
    // timer
    let t;if(G.phase==='freeze')t=fmtTime(G.phaseT);else if(G.phase==='live')t=G.bomb?'':fmtTime(G.roundTime);else t=fmtTime(G.phaseT);
    this.set('timer',G.bomb&&!G.bomb.done&&G.phase==='live'?'💣':t);this.cls('timer','bomb',!!(G.bomb&&!G.bomb.done&&G.phase==='live'));
    this.set('roundLbl',G.phase==='freeze'?'Buy time · Round '+G.round:'Round '+G.round);
    const ls=G.sideOf(0),rs=G.sideOf(1);this.set('scoreL',String(G.score[0]));this.set('scoreR',String(G.score[1]));
$('scoreL').className='score '+ls;$('scoreR').className='score '+rs;
    this.pips();
    this.set('location',zoneName(v.pos));
    // progress bar
    let prog=null;
    if(v.plantProg>0)prog=['Planting the bomb…',v.plantProg/3];
    else if(v.defuseProg>0)prog=[v.kit?'Defusing (kit)…':'Defusing…',v.defuseProg/(v.kit?5:10)];
    $('progress').classList.toggle('hidden',!prog);if(prog){this.set('progressLabel',prog[0]);this.set('progressFill',(prog[1]*100).toFixed(1)+'%','width');}
    // hints
    let hint='';
    if(p.alive){
      if(G.bomb&&!G.bomb.done&&p.team==='W'&&p.pos.distanceTo(G.bomb.pos)<1.8&&!p.defuseProg)hint='Hold E to defuse'+(p.kit?' (5 s)':' (10 s)');
      else if(p.hasBomb&&inSite(p.pos)&&!p.plantProg&&G.phase==='live')hint='Hold E (or 5 + left click) to plant';
      else{const it=G.lookItem(p);if(it)hint='Press E to pick up '+WEP[it.id].name;}
    }
    this.set('hint',hint);this.cls('hint','hidden',!hint);
    this.set('centerMsg',NOW<this.centerUntil?$('centerMsg').textContent:'');
    // overlays
    this.hitT-=dt;$('hitmarker').style.opacity=Math.max(0,this.hitT*4).toFixed(2);
    this.hurtV=Math.max(0,this.hurtV-dt*1.2);$('hurt').style.opacity=(this.hurtV*0.9).toFixed(2);
    let fl=0;if(v.blindUntil>NOW){const left=v.blindUntil-NOW;fl=Math.min(1,left/1.2)*Math.min(1,v.blindAmt*1.3);}$('flash').style.opacity=fl.toFixed(3);
    let so=0;for(const s of FX.smokes){const d=Math.hypot(camera.position.x-s.pos.x,camera.position.z-s.pos.z,(camera.position.y-s.pos.y-1.6)*0.8);if(d<s.r)so=Math.max(so,clamp((s.r-d)/1.4,0,0.96));}
    $('smokeOv').style.opacity=so.toFixed(2);
    $('scope').classList.toggle('hidden',!(w.cls==='sniper'&&v.scope&&v.alive&&Spectate.mode!=='death'));
    // spectate label
    const sp=$('spec');if(!p.alive&&Spectate.mode==='spec'&&Spectate.target){sp.classList.remove('hidden');this.set('spec',`Spectating <span style="color:${Spectate.target.team==='S'?'#ffcf6b':'#a8d2ff'}">${esc(Spectate.target.name)}</span><small>Click for the next player</small>`,'html');}
    else sp.classList.add('hidden');
    this.drawRadar();this.drawCrosshair();this.drawDamage(dt);this.drawTags();
  }
};
function drawCross(g,cx0,cy0,size,gap,th,col,dot,outline){
  const rects=[[cx0-gap-size,cy0-th/2,size,th],[cx0+gap,cy0-th/2,size,th],[cx0-th/2,cy0-gap-size,th,size],[cx0-th/2,cy0+gap,th,size]];
  if(dot)rects.push([cx0-th/2,cy0-th/2,th,th]);
  if(outline){g.fillStyle='rgba(0,0,0,.85)';for(const r of rects)g.fillRect(Math.round(r[0])-1,Math.round(r[1])-1,r[2]+2,r[3]+2);}
  g.fillStyle=col;for(const r of rects)g.fillRect(Math.round(r[0]),Math.round(r[1]),r[2],r[3]);
}

/* =====================================================================
   Buy menu, scoreboard
   ===================================================================== */
const Buy={open:false,
  cols(team){return[
    ['Pistols',[DEFAULT_PISTOL[team],'hawk']],
    ['Mid-tier',['vex','breacher']],
    ['Rifles',[team==='S'?'ark7':'m4r','longshot']],
    ['Gear',['kevlar','helmet'].concat(team==='W'?['kit']:[])],
    ['Grenades',['flash','smoke','he','fire']]];},
  label(id,team){return id==='kevlar'?'Kevlar Vest':id==='helmet'?'Kevlar + Helmet':id==='kit'?'Defuse Kit':id==='fire'?nadeName('fire',team):WEP[id].name;},
  render(){
    const p=G.player;const team=p.team;let n=0;const grid=$('buyGrid');grid.innerHTML='';
    for(const[title,ids]of this.cols(team)){const col=document.createElement('div');col.className='bcol';col.innerHTML=`<h4>${title}</h4>`;
      for(const id of ids){n++;const price=priceOf(id,p);const b=document.createElement('button');b.className='bitem';
        const owned=(id==='kevlar'&&p.armor>=100)||(id==='helmet'&&p.helmet&&p.armor>=100)||(id==='kit'&&p.kit)||(p.primary&&p.primary.id===id)||(p.secondary&&p.secondary.id===id)||(WEP[id]&&WEP[id].cls==='nade'&&p.nades.filter(x=>x===id).length>=NADE_MAX[id]);
        b.disabled=price>p.money||owned||!G.canBuy(p);if(owned)b.classList.add('owned');
        const ic=ICON[id]?`<img src="${ICON[id]}" alt="">`:`<div style="height:26px;font-size:22px">${id==='kit'?'🔧':'🛡'}</div>`;
        b.innerHTML=`<span class="k">${n}</span>${ic}<span class="n">${esc(this.label(id,team))}</span><span class="p">$${price}</span>`;
        b.dataset.id=id;b.dataset.key=String(n%10);
        b.onclick=()=>{if(buyItem(p,id))this.render();else SFX.deny();};col.appendChild(b);}
      grid.appendChild(col);}
    $('buyMoney').textContent='$'+p.money;$('buyTime').textContent=G.canBuy(p)?'Buy time left: '+Math.ceil(G.buyEnd-NOW)+' s':'Buy time is over';
  },
  hotkey(k){const b=[...document.querySelectorAll('#buyGrid .bitem')].find(x=>x.dataset.key===k);if(b&&!b.disabled)b.click();},
  toggle(force){
    const want=force!==undefined?force:!this.open;
    if(want&&!G.canBuy(G.player)){HUD.center(G.player.alive?'You can only buy in your spawn during buy time.':'',1.5);return;}
    this.open=want;$('buyMenu').classList.toggle('hidden',!want);
    if(want){this.render();Input.allowUnlock=true;document.exitPointerLock&&document.exitPointerLock();}
    else{Input.lock();}
  }
};
function scoreboardHTML(){
  const rows=sq=>G.agents.filter(a=>a.squad===sq).sort((p,q)=>q.stats.k-p.stats.k||q.stats.dmg-p.stats.dmg).map(a=>{
    const mine=a.team===G.player.team;
    return `<tr class="${a.isPlayer?'me':''} ${a.alive||G.phase!=='live'?'':'dead'}"><td class="${a.team}">${a.hasBomb&&mine?'💣 ':''}${esc(a.name)}${a.isPlayer?'':' <small style="color:var(--dim)">BOT</small>'}</td>
      <td>${mine?'$'+a.money:'—'}</td><td>${a.stats.k}</td><td>${a.stats.a}</td><td>${a.stats.d}</td><td>${a.stats.dmg}</td><td>${Math.round(a.stats.dmg/Math.max(1,G.roundsPlayed||1))}</td>
      <td class="star">${a.stats.mvp?'★'+(a.stats.mvp>1?a.stats.mvp:''):''}</td><td>${a.ping}</td></tr>`;}).join('');
  const head='<tr><th>PLAYER</th><th>MONEY</th><th>K</th><th>A</th><th>D</th><th>DMG</th><th>ADR</th><th>MVP</th><th>PING</th></tr>';
  const sec=sq=>{const side=G.sideOf(sq);return `<div class="sbhead"><h3 class="${side}" style="color:${side==='S'?'var(--s2)':'var(--w2)'}">${side==='S'?'STRIKERS':'WARDENS'}</h3><span class="big">${G.score[sq]}</span></div><table class="sb">${head}${rows(sq)}</table>`;};
  return `<div style="display:flex;justify-content:space-between;color:var(--dim);font-weight:600"><span>${esc(MAP.name.toUpperCase())} · ${S.difficulty.toUpperCase()} BOTS</span><span>Round ${G.round} of 24 · first to 13</span></div>`+sec(0)+sec(1);
}

/* =====================================================================
   Input
   ===================================================================== */
const Input={keys:{},mouse:[false,false,false],mdx:0,mdy:0,locked:false,allowUnlock:false,
  init(){
    const cv=$('c');
    document.addEventListener('pointerlockchange',()=>{this.locked=document.pointerLockElement===cv;
      if(!this.locked&&G.inMatch()&&!Buy.open&&!this.allowUnlock&&G.phase!=='over'){Game.pause(true);}
      this.allowUnlock=false;});
    document.addEventListener('mousemove',e=>{if(!this.locked)return;let dx=e.movementX,dy=e.movementY;if(Math.abs(dx)>400||Math.abs(dy)>400)return;
      this.mdx+=dx;this.mdy+=dy;const p=G.player;if(!p||!p.alive||Game.paused)return;
      const v=WEP[p.curId()];const zoom=v.cls==='sniper'&&p.scope?(p.scope===1?40:15)/S.fov:1;
      const k=S.sens*0.022*DEG*zoom;p.yaw-=dx*k;p.pitch=clamp(p.pitch-dy*k,-89*DEG,89*DEG);});
    cv.addEventListener('mousedown',e=>{SFX.init();if(!this.locked&&G.inMatch()&&!Game.paused){this.lock();return;}this.mouse[e.button]=true;
      if(e.button===0&&G.player&&!G.player.alive&&Spectate.mode==='spec')Spectate.next(1);
      if(e.button===2&&G.player&&!G.player.alive&&Spectate.mode==='spec')Spectate.next(-1);});
    window.addEventListener('mouseup',e=>{this.mouse[e.button]=false;});
    cv.addEventListener('contextmenu',e=>e.preventDefault());
    window.addEventListener('wheel',e=>{if(!this.locked||!G.player||!G.player.alive)return;const p=G.player;const order=[1,2,3,4,5].filter(s=>p.hasSlot(s));
      let i=order.indexOf(p.slot);i=(i+(e.deltaY>0?1:-1)+order.length)%order.length;switchSlot(p,order[i]);},{passive:true});
    window.addEventListener('keydown',e=>{
      if(e.code==='Tab'){e.preventDefault();if(G.inMatch())$('scoreboard').classList.remove('hidden'),$('sbPanel').innerHTML=scoreboardHTML();return;}
      if(!G.inMatch())return;
      if(['Space','KeyW','KeyA','KeyS','KeyD','ControlLeft','KeyC'].includes(e.code)||e.ctrlKey)e.preventDefault();
      if(Buy.open){if(e.code==='KeyB'||e.code==='Escape'){Buy.toggle(false);}else if(/^Digit\d$/.test(e.code))Buy.hotkey(e.code.slice(5));return;}
      this.keys[e.code]=true;if(e.repeat)return;
      const p=G.player;if(!p)return;
      if(e.code==='KeyB'){Buy.toggle(true);return;}
      if(!p.alive)return;
      if(/^Digit[1-5]$/.test(e.code))switchSlot(p,+e.code.slice(5));
      else if(e.code==='KeyQ'){if(p.hasSlot(p.lastSlot))switchSlot(p,p.lastSlot);}
      else if(e.code==='KeyR')startReload(p);
      else if(e.code==='KeyG')Game.playerDrop();
      else if(e.code==='KeyE')Game.playerUse();
    });
    window.addEventListener('keyup',e=>{this.keys[e.code]=false;if(e.code==='Tab')$('scoreboard').classList.add('hidden');});
    window.addEventListener('blur',()=>{this.keys={};this.mouse=[false,false,false];});
  },
  lock(){const cv=$('c');try{const r=cv.requestPointerLock();if(r&&r.catch)r.catch(()=>{});}catch(e){}},
  apply(p){
    const k=this.keys,inp=p.input,free=this.locked&&!Game.paused&&!Buy.open;
    inp.f=free&&k.KeyW?1:0;inp.b=free&&k.KeyS?1:0;inp.l=free&&k.KeyA?1:0;inp.r=free&&k.KeyD?1:0;
    inp.walk=!!(k.ShiftLeft||k.ShiftRight);inp.crouch=!!(k.ControlLeft||k.ControlRight||k.KeyC);inp.jump=free&&!!k.Space;
    inp.fire=free&&this.mouse[0];inp.fire2=free&&this.mouse[2];inp.use=free&&!!k.KeyE;
  }
};
