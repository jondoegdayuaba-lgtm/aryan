
/* =====================================================================
   Agent rig. Agents are skinned meshes on a skeleton (pelvis spine chest
   neck head aim clav/upperarm/forearm/hand thigh/shin/foot). The rest pose
   is a bladed rifle stance; every frame a pose is built on top of it: aim
   pitch spread over the spine, two-bone IK for the legs (walk cycle, crouch,
   jumps, falling) and for the support arm (handguard, pistol, or hanging).
   ===================================================================== */
const GRIP_T=new THREE.Vector3(0,-0.07,0.09);   // where a gun's pistol grip goes in the weapon mount (the right fist)
const RT={q1:new THREE.Quaternion(),q2:new THREE.Quaternion(),q3:new THREE.Quaternion(),mq:new THREE.Quaternion(),
  S:new THREE.Vector3(),E:new THREE.Vector3(),W:new THREE.Vector3(),D:new THREE.Vector3(),P:new THREE.Vector3(),T:new THREE.Vector3(),
  A:new THREE.Vector3(),B:new THREE.Vector3(),X:new THREE.Vector3(),Y:new THREE.Vector3(),Z:new THREE.Vector3(),F:new THREE.Vector3(),pole:new THREE.Vector3()};

function buildCharacter(agentId){
  const root=asset(agentId+'_char');root.rotation.order='YXZ';const b={},rest=[];
  root.traverse(o=>{if(o.isBone){b[o.name.slice(agentId.length+1)]=o;rest.push([o,o.quaternion.clone(),o.position.clone()]);}});
  root.updateMatrixWorld(true);
  const restQ={},restP={};for(const k in b){restQ[k]=b[k].getWorldQuaternion(new THREE.Quaternion());restP[k]=b[k].getWorldPosition(new THREE.Vector3());}
  root.userData={agentId,b,rest,restQ,restP,gunHolder:root.getObjectByName(agentId+'_gun'),gunId:null,cls:null,ph:0,fall:Math.random()<0.5?1:-1};
  return root;
}
function setCharGun(model,id,team,skin,variant){
  const u=model.userData;const key=id?gunAsset(id,team)+(skin||'')+(variant||''):null;if(u.gunId===key)return;u.gunId=key;
  while(u.gunHolder.children.length)u.gunHolder.remove(u.gunHolder.children[0]);
  u.cls=id?WEP[id].cls:null;if(!id)return;
  const g=buildGun(id,team,skin,variant).group,name=g.name.replace(/_root$/,'');
  const gp=g.getObjectByName(name+'_grip')||g.getObjectByName(name+'_handle');
  if(id==='bomb'){g.scale.setScalar(0.8);g.rotation.x=-0.3;g.position.set(-0.08,-0.13,0.03);}
  else if(u.cls==='nade')g.position.copy(GRIP_T).add(V3(0,-0.03,0.01));
  else if(gp)g.position.copy(GRIP_T).sub(gp.position);
  u.gunHolder.add(g);
}
// rotates a bone by the world rotation q about its own origin
function rotWorld(bone,q){const pw=bone.parent.getWorldQuaternion(RT.q2);RT.q3.copy(pw).invert();bone.quaternion.premultiply(pw).premultiply(q).premultiply(RT.q3);}
function turnAxis(bone,axis,ang){if(!ang)return;RT.q1.setFromAxisAngle(axis,ang);rotWorld(bone,RT.q1);}
function turnTowards(bone,from,to){RT.q1.setFromUnitVectors(from.normalize(),to.normalize());rotWorld(bone,RT.q1);}
function setWorldQuat(bone,q){const pw=bone.parent.getWorldQuaternion(RT.q2);bone.quaternion.copy(pw.invert().multiply(q));}
function pushBone(bone,dir,d){const pw=bone.parent.getWorldQuaternion(RT.q2);bone.position.add(RT.T.copy(dir).multiplyScalar(d).applyQuaternion(pw.invert()));}
// two-bone IK: turns a (upper) and b (lower) so the head of c lands on target, bending towards pole
function ik2(a,b,c,target,pole){
  a.getWorldPosition(RT.S);b.getWorldPosition(RT.E);c.getWorldPosition(RT.W);
  const L1=RT.S.distanceTo(RT.E),L2=RT.E.distanceTo(RT.W);
  RT.D.subVectors(target,RT.S);let dist=RT.D.length();RT.D.divideScalar(dist||1);dist=clamp(dist,Math.abs(L1-L2)+0.01,(L1+L2)*0.999);
  const ca=clamp((L1*L1+dist*dist-L2*L2)/(2*L1*dist),-1,1);
  RT.P.copy(pole).addScaledVector(RT.D,-pole.dot(RT.D)).normalize();
  RT.A.copy(RT.S).addScaledVector(RT.D,L1*ca).addScaledVector(RT.P,L1*Math.sqrt(1-ca*ca));
  turnTowards(a,RT.B.subVectors(RT.E,RT.S),RT.F.subVectors(RT.A,RT.S));
  b.getWorldPosition(RT.E);c.getWorldPosition(RT.W);
  turnTowards(b,RT.B.subVectors(RT.W,RT.E),RT.F.copy(RT.S).addScaledVector(RT.D,dist).sub(RT.E));
}
/* st: {speed, phase, dirX, dirZ (model-space travel direction), crouch 0-1, look (head pitch), aim (gun pitch),
        air 0-1, arm ('rest'|'pistol'|'free'), dead 0-1, breath, headYaw} */
function poseCharacter(m,st){
  const u=m.userData,B=u.b;if(!B||!B.pelvis)return;
  for(const r of u.rest){r[0].quaternion.copy(r[1]);r[0].position.copy(r[2]);}
  m.updateMatrixWorld(true);
  const mq=m.getWorldQuaternion(RT.mq);
  const X=RT.X.set(1,0,0).applyQuaternion(mq),Y=RT.Y.set(0,1,0).applyQuaternion(mq),Z=RT.Z.set(0,0,1).applyQuaternion(mq);
  const dead=st.dead||0,air=(st.air||0)*(1-dead),c=Math.max(st.crouch||0,dead*0.55);
  const sw=Math.min(1,(st.speed||0)/4.5)*(1-air)*(1-dead),ph=st.phase||0;
  const look=(st.look||0)*(1-dead),aim=(st.aim!==undefined?st.aim:st.look||0)*(1-dead)-dead*1.1,lean=0.3*c+0.07*sw+0.1*air;
  // hips: crouch drop, bob and swing with the stride
  pushBone(B.pelvis,Y,-(0.5*c+sw*0.035*(1+Math.cos(ph*2))*0.5+air*0.04));
  turnAxis(B.pelvis,Y,Math.sin(ph)*0.14*sw);
  // spine: aim pitch shared with the chest, crouch lean, counter-twist to the hips, breathing
  turnAxis(B.spine,X,0.2*look-lean);turnAxis(B.spine,Y,-Math.sin(ph)*0.12*sw);
  turnAxis(B.chest,X,0.25*look+(st.breath||0)*0.015);
  turnAxis(B.neck,X,0.2*look+0.5*lean);
  turnAxis(B.head,X,0.25*look+0.5*lean+dead*0.4);if(st.headYaw)turnAxis(B.head,Y,st.headYaw);
  turnAxis(B.aim,X,aim-0.45*look+lean);
  // legs: feet planted on their rest spots, moved by the walk cycle
  const stride=0.3*sw,dx=st.dirX||0,dz=st.dirZ===undefined?-1:st.dirZ;
  for(const s of ['L','R']){
    const sd=s==='L'?-1:1,p=ph+(s==='L'?0:Math.PI),swing=Math.sin(p),lift=Math.max(0,Math.cos(p));
    const T=RT.T.copy(u.restP['foot'+s]);
    T.x+=dx*swing*stride+sd*0.035*c;T.z+=dz*swing*stride-0.07*c+(s==='L'?-0.08:0.05)*c*(1-dead);T.y+=lift*0.11*sw+0.15*air+(s==='L'?0.06:0)*air;
    T.applyMatrix4(m.matrixWorld);
    RT.pole.copy(Z).multiplyScalar(-1).addScaledVector(X,sd*0.12);
    ik2(B['thigh'+s],B['shin'+s],B['foot'+s],T,RT.pole.clone());
    RT.q1.copy(mq).multiply(u.restQ['foot'+s]);setWorldQuat(B['foot'+s],RT.q1);
    turnAxis(B['foot'+s],X,(-lift*0.35*sw+Math.max(0,-Math.cos(p))*0.2*sw*Math.max(0,swing))-0.35*air);
  }
  // support arm
  const arm=dead?'free':st.arm||'rest';
  if(arm==='pistol'){
    B.handR.getWorldPosition(RT.A);RT.A.addScaledVector(X,-0.07).addScaledVector(Y,-0.035).addScaledVector(Z,-0.01);
    RT.pole.copy(X).multiplyScalar(-0.5).addScaledVector(Y,-1);ik2(B.upperarmL,B.forearmL,B.handL,RT.A.clone(),RT.pole.clone());
  }else if(arm==='free'){
    B.upperarmL.getWorldPosition(RT.A);RT.A.addScaledVector(Y,-0.5).addScaledVector(X,-0.07).addScaledVector(Z,dead?0.1:-0.07);
    RT.pole.copy(Z).addScaledVector(X,-0.3);ik2(B.upperarmL,B.forearmL,B.handL,RT.A.clone(),RT.pole.clone());
  }
}
// the support-hand mode for a weapon class
function armMode(cls){return cls==='pistol'||cls==='heavy'||cls==='bomb'?'pistol':cls==='knife'||cls==='nade'?'free':'rest';}
