
/* =====================================================================
   Bots
   ===================================================================== */
const DIFF={
  easy:{react:0.75,turn:220,aimErr:4.0,head:0.15,recoilComp:0.3,aimJitter:1.2,hear:0.7,fov:100,stop:0.3,util:0.35},
  normal:{react:0.42,turn:460,aimErr:2.2,head:0.35,recoilComp:0.62,aimJitter:0.45,hear:1.0,fov:120,stop:0.75,util:0.65},
  hard:{react:0.22,turn:820,aimErr:1.1,head:0.6,recoilComp:0.85,aimJitter:0.12,hear:1.25,fov:140,stop:1,util:0.9}
};
const cp=c=>{const p=cellPos(c[0],c[1]);p.y=World.heightAt(p.x,p.z);return p;};

class Bot{
  constructor(a){this.a=a;this.diff=DIFF[S.difficulty]||DIFF.normal;}
  get aimJitter(){return this.diff.aimJitter;}
  roundReset(){
    this.diff=DIFF[S.difficulty]||DIFF.normal;
    Object.assign(this,{path:null,pi:0,goal:null,target:null,reactAt:0,lastSeen:null,lastSeenT:-99,heard:null,alert:null,lookAt:null,lookUntil:0,
      mode:'idle',scanT:Math.random()*0.15,stuckT:0,stuckCheck:NOW,lastPos:this.a.pos.clone(),stuckN:0,action:null,burst:0,pauseUntil:0,
      errYaw:0,errPitch:0,aimHead:false,flashedUntil:0,holdLook:null,waitUntil:0,entryIdx:0,spot:null,firePulse:false,rotated:false,util:[],thinkT:0,crouchHold:false,strafe:0,strafeT:0,defuser:false});
  }
  // ---------------- events ----------------
  onHurt(att){if(!this.target){this.lookAt=att.eye();this.lookUntil=NOW+1.2;this.lastSeen=att.pos.clone();this.lastSeenT=NOW;}}
  onFlashed(d){this.flashedUntil=NOW+d*0.85;}
  callout(p){if(!this.target)this.alert={pos:p.clone(),t:NOW};}
  onBombPlanted(){this.path=null;if(this.a.team==='S'){this.mode='post';this.spot=null;}else{this.mode='retake';}}
  // ---------------- helpers ----------------
  goTo(p){
    if(!this.goal||this.goal.distanceTo(p)>1.2||!this.path){this.goal=p.clone();this.path=World.findPath(this.a.pos,p);this.pi=1;}
  }
  atGoal(r){return this.goal&&Math.hypot(this.a.pos.x-this.goal.x,this.a.pos.z-this.goal.z)<(r||0.9);}
  moveDir(){ // returns [dx,dz] toward the next path point or null
    const P=this.path;if(!P)return null;
    while(this.pi<P.length){const n=P[this.pi];const d=Math.hypot(n.x-this.a.pos.x,n.z-this.a.pos.z);if(d<0.55&&this.pi<P.length-1)this.pi++;else break;}
    const n=P[Math.min(this.pi,P.length-1)];const dx=n.x-this.a.pos.x,dz=n.z-this.a.pos.z;const d=Math.hypot(dx,dz);
    if(this.pi>=P.length-1&&d<0.35)return null;
    return[dx/d,dz/d];
  }
  setMove(dir,walk){
    const inp=this.a.input;inp.f=inp.b=inp.l=inp.r=0;inp.walk=!!walk;if(!dir)return;
    const want=yawTo(dir[0],dir[1]);const rel=angDiff(this.a.yaw,want); // relative to facing
    const o=Math.round(rel/(Math.PI/4));const k=((o%8)+8)%8;
    // 0 fwd, 1 fwd-left, 2 left, 3 back-left, 4 back, 5 back-right, 6 right, 7 fwd-right
    inp.f=(k===0||k===1||k===7)?1:0;inp.b=(k===3||k===4||k===5)?1:0;inp.l=(k===1||k===2||k===3)?1:0;inp.r=(k===5||k===6||k===7)?1:0;
  }
  turnTo(yaw,pitch,dt,rate){
    const a=this.a;const r=(rate||this.diff.turn)*DEG*dt;
    const dy=angDiff(a.yaw,yaw);a.yaw+=clamp(dy,-r,r)*Math.min(1,0.35+Math.abs(dy)*2.5);
    const dp=pitch-a.pitch;a.pitch+=clamp(dp,-r,r)*Math.min(1,0.35+Math.abs(dp)*2.5);
  }
  canSee(e){
    const a=this.a;if(NOW<this.flashedUntil)return 0;
    const eye=a.eye();const head=V3(e.pos.x,e.pos.y+STAND_H-0.55*e.crouchAmt-0.14,e.pos.z),chest=V3(e.pos.x,e.pos.y+1.05-0.35*e.crouchAmt,e.pos.z);
    const d=eye.distanceTo(head);if(d>95)return 0;
    if(e!==this.target&&d>3.5){const ang=Math.abs(angDiff(a.yaw,yawTo(e.pos.x-a.pos.x,e.pos.z-a.pos.z)));if(ang>this.diff.fov*DEG/2)return 0;}
    let vis=0;
    if(!World.segBlocked(eye.x,eye.y,eye.z,head.x,head.y,head.z)&&!FX.smokeBlocks(eye,head))vis|=1;
    if(!World.segBlocked(eye.x,eye.y,eye.z,chest.x,chest.y,chest.z)&&!FX.smokeBlocks(eye,chest))vis|=2;
    return vis;
  }
  ensureGun(){
    const a=this.a;const p=a.primary,s=a.secondary;
    const ok=i=>i&&(i.mag>0||i.res>0);
    if(a.slot===1&&ok(p))return;if(a.slot===2&&ok(s)&&!ok(p))return;
    if(ok(p))switchSlot(a,1);else if(ok(s))switchSlot(a,2);else if(a.slot!==3)switchSlot(a,3);
  }
  // ---------------- perception ----------------
  scan(){
    const a=this.a;let best=null,bestScore=1e9,bestVis=0;
    for(const e of G.agents){if(!e.alive||e.team===a.team)continue;const vis=this.canSee(e);if(!vis)continue;
      e.spottedUntil=NOW+2;const sc=a.pos.distanceTo(e.pos)-(e===this.target?8:0);if(sc<bestScore){bestScore=sc;best=e;bestVis=vis;}}
    if(best){
      if(best!==this.target){this.target=best;const d=a.pos.distanceTo(best.pos);
        this.reactAt=NOW+this.diff.react*rand(0.8,1.35)+(this.target&&d<6?-0.05:0);
        const err=this.diff.aimErr*(0.6+d/35);this.errYaw=rand(-err,err)*DEG;this.errPitch=rand(-err,err)*DEG*0.6;
        this.aimHead=Math.random()<this.diff.head;
        for(const b of G.agents)if(b!==a&&b.bot&&b.alive&&b.team===a.team)b.bot.callout(best.pos);
        const z=SITE_OF_ZONE[zoneName(best.pos)];if(z&&a.team==='W')G.intel={site:z,t:NOW};}
      this.visFlags=bestVis;this.lastSeen=best.pos.clone();this.lastSeenT=NOW;
    }else if(this.target&&NOW-this.lastSeenT>0.35){this.target=null;}
  }
  // ---------------- strategy ----------------
  think(){
    const a=this.a;const T=a.team;
    if(G.phase!=='live')return;
    if(T==='S'){
      if(G.bomb){this.mode='post';return;}
      if(G.bombItem&&!G.agents.some(o=>o.alive&&o.team==='S'&&o.bot&&o!==a&&o.bot.mode==='getbomb'&&o.pos.distanceTo(G.bombItem.pos)<a.pos.distanceTo(G.bombItem.pos))){this.mode='getbomb';return;}
      if(this.mode==='getbomb'&&!G.bombItem)this.mode='exec';
      const plan=this.plan;
      if(this.mode==='idle')this.mode='stage';
      if(this.mode==='stage'&&this.atGoal(1.5)){this.mode='wait';this.waitUntil=Math.max(G.execAt,NOW+0.5);}
      if((this.mode==='wait'||this.mode==='stage')&&(NOW>=G.execAt||G.roundTime<40)){this.mode='exec';this.entryIdx=0;this.queueUtil(plan);}
      if(a.hasBomb&&(this.mode==='exec'||this.mode==='site')&&inSite(a.pos))this.mode='plant';
    }else{
      if(G.bomb){this.mode='retake';return;}
      if(this.mode==='idle')this.mode='hold';
      if(G.intel&&!this.rotated&&this.hold&&this.hold.site!==G.intel.site&&this.hold.site!=='M'&&NOW-G.intel.t<12){
        this.rotated=true;const delay=rand(1,4);setTimeout(()=>{if(this.a.alive&&!G.bomb&&G.phase==='live'){this.mode='rotate';this.rotSite=G.intel?G.intel.site:this.hold.site;this.path=null;}},delay*1000);}
    }
  }
  queueUtil(plan){
    const a=this.a;if(Math.random()>this.diff.util)return;
    const i=this.planIdx||0;
    if(a.nades.includes('smoke')&&plan.smoke[i%plan.smoke.length])this.util.push({id:'smoke',c:plan.smoke[i%plan.smoke.length]});
    if(a.nades.includes('flash')&&plan.flash.length)this.util.push({id:'flash',c:plan.flash[0],delay:1.2});
  }
  doThrow(id,target){ // a lob that lands on target (bots know their lineups)
    const a=this.a;if(!a.nades.includes(id))return false;
    const o=a.eye();const dx=target.x-o.x,dz=target.z-o.z,dy=(target.y+0.2)-o.y;const dist=Math.hypot(dx,dz);
    const T=clamp(dist/11,0.7,2.6)+0.35;const g=GRAV*0.9;
    const vel=V3(dx/T,(dy+0.5*g*T*T)/T,dz/T).add(V3(rand(-0.25,0.25),0,rand(-0.25,0.25)));
    a.yaw=yawTo(dx,dz);a.pitch=Math.atan2(vel.y,Math.hypot(vel.x,vel.z))*0.6;
    a.nades.splice(a.nades.indexOf(id),1);launchNade(a,id,o.addScaledVector(vel.clone().normalize(),0.4),vel);
    a.nadeIdx=0;return true;
  }
  // ---------------- per-frame ----------------
  update(dt){
    const a=this.a,inp=a.input;inp.fire=false;inp.fire2=false;inp.jump=false;inp.use=false;inp.crouch=false;
    if(!a.alive)return;
    if(G.phase==='freeze'){this.setMove(null);return;}
    this.scanT-=dt;if(this.scanT<=0){this.scanT=0.1+Math.random()*0.06;this.scan();}
    this.thinkT-=dt;if(this.thinkT<=0){this.thinkT=0.25;this.think();}
    const blind=NOW<this.flashedUntil;
    // standing in fire: get out
    for(const f of FX.fires){if(Math.hypot(a.pos.x-f.pos.x,a.pos.z-f.pos.z)<f.r+0.5&&f.t<f.life-0.5){const away=[a.pos.x-f.pos.x,a.pos.z-f.pos.z];const l=Math.hypot(away[0],away[1])||1;
      this.setMove([away[0]/l,away[1]/l]);this.ensureGun();if(this.target)this.engage(dt,true);return;}}
    // queued utility
    if(this.util.length&&this.mode==='exec'&&!this.target){
      const u=this.util[0];if(!u.at)u.at=NOW+(u.delay||0)+rand(0.1,0.6);
      if(NOW>=u.at){this.util.shift();this.doThrow(u.id,cp(u.c));}
    }
    if(this.target&&this.target.alive){this.engage(dt,false);return;}
    if(this.target&&!this.target.alive)this.target=null;
    if(this.mode!=='plant')this.ensureGun();
    if(a.reloadEnd===0&&a.curInst()&&a.curInst().mag<WEP[a.curInst().id].mag*0.5&&a.curInst().res>0&&NOW-this.lastSeenT>2)startReload(a);
    this.navigate(dt,blind);
  }
  engage(dt,moving){
    const a=this.a,e=this.target,inp=a.input;this.ensureGun();
    const w=WEP[a.curId()];const d=a.pos.distanceTo(e.pos);
    // aim point
    const headY=e.pos.y+STAND_H-0.55*e.crouchAmt-0.14,chestY=e.pos.y+1.05-0.35*e.crouchAmt;
    const aimY=(this.aimHead&&(this.visFlags&1))||!(this.visFlags&2)?headY:chestY;
    const lead=0.06;const tx=e.pos.x+e.vel.x*lead,tz=e.pos.z+e.vel.z*lead;
    const eye=a.eye();const dx=tx-eye.x,dz=tz-eye.z,dy=aimY-eye.y;
    this.errYaw*=Math.exp(-dt*2.8);this.errPitch*=Math.exp(-dt*2.8);
    const wantYaw=yawTo(dx,dz)+this.errYaw,wantPitch=Math.atan2(dy,Math.hypot(dx,dz))+this.errPitch;
    const blind=NOW<this.flashedUntil;
    this.turnTo(wantYaw+(blind?rand(-0.5,0.5):0),wantPitch,dt,blind?120:undefined);
    const visible=NOW-this.lastSeenT<0.2;
    const errA=Math.hypot(angDiff(a.yaw,wantYaw-this.errYaw),a.pitch-(wantPitch-this.errPitch));
    const tol=Math.atan2(0.32,d)+0.6*DEG;
    // movement while fighting
    if(!moving){
      if(w.cls==='knife'){this.goTo(e.pos);this.setMove(this.moveDir());}
      else if(Math.random()<this.diff.stop&&visible&&NOW>=this.reactAt-0.05){this.setMove(null);if(d>16&&w.cls!=='sniper'&&this.diff.stop>0.9&&a.recoilIdx>3)inp.crouch=true;}
      else{this.strafeT-=dt;if(this.strafeT<=0){this.strafeT=rand(0.3,0.8);this.strafe=pick([-1,1,0]);}
        const s=this.strafe;const r=[Math.cos(a.yaw)*s,-Math.sin(a.yaw)*s];this.setMove(s?r:null,false);}
      if(!visible&&this.lastSeen&&NOW-this.lastSeenT<3&&a.team==='S'){this.goTo(this.lastSeen);this.setMove(this.moveDir(),true);}
    }
    if(!visible||NOW<this.reactAt||blind&&Math.random()<0.8)return;
    // sniper scoping
    if(w.cls==='sniper'){if(d>7&&a.scope===0&&NOW>=a.nextFire&&!a.reloadEnd){inp.fire2=true;return;}}
    if(errA>tol*(w.cls==='shotgun'?3:1.4))return;
    if(NOW<this.pauseUntil)return;
    if(w.cls==='knife'){if(d<1.8)inp.fire=true;return;}
    if(w.auto){
      inp.fire=true;this.burst++;
      const maxB=d>28?1:d>16?3:d>9?6:30;
      if(this.burst>=maxB&&NOW>=a.nextFire-0.01){this.burst=0;this.pauseUntil=NOW+(d>28?rand(0.28,0.4):rand(0.18,0.3));}
    }else{this.firePulse=!this.firePulse;inp.fire=this.firePulse;if(w.cls==='heavy'||w.cls==='sniper')this.pauseUntil=NOW+(w.cls==='heavy'?0.12:0);}
  }
  navigate(dt,blind){
    const a=this.a,inp=a.input;let dest=null,look=null,walk=false,hold=false;
    const T=a.team;
    if(T==='S'){
      const plan=this.plan;
      switch(this.mode){
        case 'stage':dest=cp(plan.stage);break;
        case 'wait':dest=cp(plan.stage);hold=true;look=cp(plan.entry[0]);break;
        case 'exec':{
          const e=plan.entry;if(this.entryIdx<e.length){dest=cp(e[this.entryIdx]);if(this.atGoal(1.6))this.entryIdx++;}
          else{if(!this.spot)this.spot=pick(SITE_SPOTS[G.plan.site]);dest=cp(this.spot);if(this.atGoal(1))this.mode='site';}
          break;}
        case 'site':if(!this.spot)this.spot=pick(SITE_SPOTS[G.plan.site]);dest=cp(this.spot);hold=this.atGoal(1);look=hold?cp(pick(HOLDS[G.plan.site]).l):null;if(!this.holdLook||Math.random()<0.004)this.holdLook=look;look=this.holdLook;break;
        case 'plant':{dest=cp(PLANT_SPOT[G.plan.site]);
          if(inSite(a.pos)&&(this.atGoal(1.2)||Math.random()<0.002)&&!this.target){this.setMove(null);if(a.slot!==5)switchSlot(a,5);else{inp.fire=true;}inp.crouch=true;return;}
          break;}
        case 'getbomb':dest=G.bombItem?G.bombItem.pos.clone():null;break;
        case 'post':{const B=G.bomb;if(!B)break;
          if(!this.spot)this.spot=pick(SITE_SPOTS[B.site]);dest=cp(this.spot);hold=this.atGoal(1.2);
          if(hold){if(!this.holdLook)this.holdLook=cp(pick(HOLDS[B.site]).l);look=this.holdLook;}
          if(B.defuser&&a.nades.includes('fire')&&a.pos.distanceTo(B.pos)<35&&!this.firedMolly){this.firedMolly=true;this.doThrow('fire',B.pos);}
          if(B.defuser&&!this.target){dest=B.pos.clone();hold=false;}
          break;}
        default:dest=cp(SITE_SPOTS[G.plan.site][0]);
      }
    }else{
      switch(this.mode){
        case 'hold':dest=cp(this.hold.c);hold=this.atGoal(0.8);look=cp(this.hold.l);if(hold&&this.crouchHold)inp.crouch=true;break;
        case 'rotate':{if(!this.spot)this.spot=pick(HOLDS[this.rotSite]).c;dest=cp(this.spot);hold=this.atGoal(1);if(hold)look=cp(pick(HOLDS[this.rotSite]).l);break;}
        case 'retake':{const B=G.bomb;if(!B)break;dest=B.pos.clone();
          const alive=G.agents.filter(o=>o.alive&&o.team==='W');const nearest=alive.sort((p,q)=>p.pos.distanceTo(B.pos)-q.pos.distanceTo(B.pos))[0];
          const close=a.pos.distanceTo(B.pos)<1.5;
          if(nearest!==a&&a.pos.distanceTo(B.pos)<12){if(!this.spot)this.spot=pick(SITE_SPOTS[B.site]);dest=cp(this.spot);}
          if(close&&nearest===a){
            const need=(a.kit?5:10);const danger=NOW-this.lastSeenT<1.2;
            if(!danger||B.t<need+1.5){this.setMove(null);inp.use=true;inp.crouch=true;this.turnTo(a.yaw,-0.6,dt);return;}
          }
          if(!this.retakeUtil&&a.pos.distanceTo(B.pos)<30&&Math.random()<this.diff.util){this.retakeUtil=true;if(a.nades.includes('flash'))this.doThrow('flash',B.pos.clone().add(V3(0,1.5,0)));else if(a.nades.includes('he'))this.doThrow('he',B.pos);}
          break;}
      }
    }
    if(!dest){this.setMove(null);return;}
    if(!hold){this.goTo(dest);}
    let dir=hold?null:this.moveDir();
    if(!hold&&!dir&&this.atGoal(1.5))dir=null;
    // stuck handling
    if(NOW-this.stuckCheck>0.9){const moved=a.pos.distanceTo(this.lastPos);
      if(dir&&moved<0.35){this.stuckN++;inp.jump=true;this.path=null;
        if(this.stuckN>2){const p=a.pos.clone().add(V3(rand(-3,3),0,rand(-3,3)));this.path=World.findPath(a.pos,p);this.pi=1;}}
      else this.stuckN=0;this.lastPos.copy(a.pos);this.stuckCheck=NOW;}
    this.setMove(dir,walk);
    // look direction
    let lookYaw=a.yaw,lookPitch=0;
    if(this.lookAt&&NOW<this.lookUntil){const e=a.eye();lookYaw=yawTo(this.lookAt.x-e.x,this.lookAt.z-e.z);lookPitch=Math.atan2(this.lookAt.y-e.y,Math.hypot(this.lookAt.x-e.x,this.lookAt.z-e.z));}
    else if(this.heard&&NOW-this.heard.t<2.5){lookYaw=yawTo(this.heard.pos.x-a.pos.x,this.heard.pos.z-a.pos.z);}
    else if(this.alert&&NOW-this.alert.t<2.5&&a.pos.distanceTo(this.alert.pos)<40){lookYaw=yawTo(this.alert.pos.x-a.pos.x,this.alert.pos.z-a.pos.z);}
    else if(look){lookYaw=yawTo(look.x-a.pos.x,look.z-a.pos.z);}
    else if(dir){lookYaw=yawTo(dir[0],dir[1]);}
    this.turnTo(lookYaw,lookPitch,dt,Math.min(this.diff.turn,360));
    if(dir)this.setMove(dir,walk);
  }
}

/* ------------------------------- buying ------------------------------- */
function buyItem(a,item,quiet){
  const T=a.team;const r=priceOf(item,a);if(r===null||a.money<r)return false;
  if(item==='kevlar'){if(a.armor>=100)return false;a.armor=100;}
  else if(item==='helmet'){if(a.armor>=100&&a.helmet)return false;a.armor=100;a.helmet=true;}
  else if(item==='kit'){if(T!=='W'||a.kit)return false;a.kit=true;}
  else if(WEP[item].cls==='nade'){const cnt=a.nades.filter(n=>n===item).length;if(cnt>=NADE_MAX[item]||a.nades.length>=4)return false;
    a.nades.push(item);a.nades.sort((p,q)=>NADE_ORDER.indexOf(p)-NADE_ORDER.indexOf(q));}
  else{const w=WEP[item];if(w.team&&w.team!==T)return false;
    const inst={id:item,mag:w.mag,res:w.res,skin:a.skinPref(item)};
    if(w.slot===1){if(a.primary&&a.primary.id===item)return false;if(a.primary)dropItem(a,a.primary,false);a.primary=inst;if(a.slot!==1||a.isPlayer)switchSlot(a,1);}
    else{if(a.secondary&&a.secondary.id===item)return false;if(a.secondary)dropItem(a,a.secondary,false);a.secondary=inst;switchSlot(a,2);}
  }
  a.money-=r;if(a===viewTarget()&&WEP[a.curId()])VM.setWeapon(a);if(!quiet&&a===G.player)SFX.buy();
  return true;
}
function priceOf(item,a){
  if(item==='kevlar')return 650;if(item==='helmet')return a.armor>=100?350:1000;if(item==='kit')return 400;
  const w=WEP[item];if(!w)return null;if(w.cls==='nade')return nadePrice(item,a.team);return w.price;
}
function botBuy(a,teamAvg,pistolRound){
  const T=a.team,rifle=T==='S'?'ark7':'m4r';const m=()=>a.money;
  if(pistolRound){const r=Math.random();if(r<0.45)buyItem(a,'kevlar',true);else if(r<0.7)buyItem(a,'hawk',true);else{buyItem(a,'flash',true);buyItem(a,'smoke',true);}
    if(T==='W'&&m()>=400&&Math.random()<0.3)buyItem(a,'kit',true);return;}
  const hasGun=a.primary&&(a.primary.id===rifle||a.primary.id==='longshot');
  const eco=teamAvg<2700&&m()<3700&&!hasGun;
  if(eco){if(m()>2100&&Math.random()<0.5){buyItem(a,pick(['vex','breacher']),true);buyItem(a,'kevlar',true);}
    else if(m()>1200&&Math.random()<0.5)buyItem(a,'hawk',true);
    return;}
  if(!hasGun){
    const awper=G.agents.some(o=>o!==a&&o.team===T&&o.primary&&o.primary.id==='longshot');
    if(!awper&&m()>=6200&&Math.random()<0.4)buyItem(a,'longshot',true);
    else if(m()>=WEP[rifle].price+650)buyItem(a,rifle,true);
    else if(m()>=1900)buyItem(a,'vex',true);
  }
  if(m()>=1000)buyItem(a,'helmet',true);else if(m()>=650)buyItem(a,'kevlar',true);
  for(const n of shuffle(['smoke','flash','he','fire','flash']))if(m()>=nadePrice(n,T)+100)buyItem(a,n,true);
  if(T==='W'&&m()>=400)buyItem(a,'kit',true);
}
