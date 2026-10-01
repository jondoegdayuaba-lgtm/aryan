
/* =====================================================================
   Weapons
   ===================================================================== */
function makePattern(n,up,nUp,side,seed){
  const pts=[[0,0]];let x=0,y=0;
  for(let i=1;i<n;i++){
    y+=i<nUp?up*(1-i/nUp*0.3):up*0.1*Math.sin(i*0.7+seed);
    let dx;
    if(i<nUp)dx=Math.sin(i*1.9+seed)*side*0.22;
    else{const k=i-nUp;dx=(k<9?-1:k<18?1:-0.6)*side*(0.75+0.3*Math.sin(k*1.3+seed));}
    x+=dx;pts.push([x,y]);
  }
  return pts;
}
const WEP={
  knife:{name:'Talon Knife',slot:3,cls:'knife',speed:6.35,reward:1500},
  g9:{name:'G-9',slot:2,cls:'pistol',team:'S',price:200,dmg:30,ap:0.47,rof:0.15,mag:20,res:120,reload:2.2,speed:6.1,fall:0.85,pen:0.8,
    inacc:{stand:0.3,crouch:0.25,move:2.2,jump:5,shot:0.8,max:4},recoil:{up:1.2,n:6,side:0.5,rec:6},reward:300,snd:'pistol'},
  p12:{name:'P-12',slot:2,cls:'pistol',team:'W',price:200,dmg:35,ap:0.505,rof:0.17,mag:12,res:24,reload:2.2,speed:6.1,fall:0.79,pen:0.9,
    inacc:{stand:0.25,crouch:0.2,move:2.0,jump:5,shot:0.9,max:4},recoil:{up:1.4,n:6,side:0.5,rec:6},reward:300,snd:'pistol'},
  hawk:{name:'Hawk .50',slot:2,cls:'heavy',price:700,dmg:63,ap:0.932,rof:0.27,mag:7,res:35,reload:2.2,speed:5.9,fall:0.81,pen:1.6,
    inacc:{stand:0.35,crouch:0.3,move:4.5,jump:7,shot:3,max:7},recoil:{up:3.2,n:5,side:0.8,rec:3.2},reward:300,snd:'heavy'},
  vex:{name:'Vex-9',slot:1,cls:'smg',price:1250,dmg:26,ap:0.6,rof:0.075,auto:true,mag:30,res:120,reload:2.6,speed:6.0,fall:0.8,pen:1.0,
    inacc:{stand:0.6,crouch:0.5,move:1.3,jump:3.5,shot:0.15,max:2.6},recoil:{up:0.5,n:10,side:0.35,rec:10},reward:600,snd:'smg'},
  breacher:{name:'Breacher-12',slot:1,cls:'shotgun',price:1050,dmg:26,pellets:9,cone:3.4,ap:0.5,rof:0.88,mag:8,res:32,reload:0.5,shells:true,speed:5.6,fall:0.6,pen:0.5,
    inacc:{stand:0.4,crouch:0.35,move:1.2,jump:3,shot:0.4,max:2},recoil:{up:3,n:3,side:0.5,rec:3},reward:900,snd:'shotgun'},
  ark7:{name:'AR-K7',slot:1,cls:'rifle',team:'S',price:2700,dmg:36,ap:0.775,rof:0.1,auto:true,mag:30,res:90,reload:2.45,speed:5.45,fall:0.98,pen:2.2,
    inacc:{stand:0.12,crouch:0.09,move:6,jump:9,shot:0.2,max:3},recoil:{up:0.95,n:10,side:0.62,rec:11},reward:300,snd:'rifle'},
  m4r:{name:'M-4R',slot:1,cls:'rifle',team:'W',price:3100,dmg:33,ap:0.7,rof:0.09,auto:true,mag:30,res:90,reload:3.1,speed:5.65,fall:0.97,pen:2.0,
    inacc:{stand:0.1,crouch:0.08,move:5,jump:9,shot:0.17,max:2.6},recoil:{up:0.8,n:10,side:0.5,rec:11},reward:300,snd:'rifle2'},
  longshot:{name:'Longshot',slot:1,cls:'sniper',price:4750,dmg:115,ap:0.975,rof:1.45,mag:5,res:30,reload:3.6,speed:5.2,fall:0.99,pen:3.2,
    inacc:{stand:6,scoped:0.02,crouch:5,move:9,jump:14,shot:0,max:0},recoil:{up:5,n:2,side:0,rec:2},reward:100,snd:'sniper'},
  he:{name:'HE Grenade',slot:4,cls:'nade',price:300,speed:6.2,reward:300},
  flash:{name:'Flashbang',slot:4,cls:'nade',price:200,speed:6.2},
  smoke:{name:'Smoke',slot:4,cls:'nade',price:300,speed:6.2},
  fire:{name:'Firebomb',slot:4,cls:'nade',price:400,speed:6.2,reward:300},
  bomb:{name:'Bomb',slot:5,cls:'bomb',speed:6.2}
};
for(const k in WEP){const w=WEP[k];w.id=k;if(w.recoil)w.pattern=makePattern((w.mag||10)+6,w.recoil.up,w.recoil.n,w.recoil.side,Math.random()*3);}
const NADE_ORDER=['he','flash','smoke','fire'];
const NADE_MAX={he:1,flash:2,smoke:1,fire:1};
const DEFAULT_PISTOL={S:'g9',W:'p12'};
function nadeName(id,team){return id==='fire'?(team==='W'?'Incendiary':'Firebomb'):WEP[id].name;}
function nadePrice(id,team){return id==='fire'?(team==='W'?500:400):WEP[id].price;}

/* =====================================================================
   Models: every character, weapon and prop was modelled in Blender
   (see the bpy script in the repo) and is embedded below as a GLB.
   A small GLB reader turns it into three.js objects.
   ===================================================================== */
const ASSET={};
function loadGLB(b64){
  const bin=atob(b64);const buf=new ArrayBuffer(bin.length);const u8=new Uint8Array(buf);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  const dv=new DataView(buf);if(dv.getUint32(0,true)!==0x46546C67)throw new Error('not a GLB');
  let off=12,json=null,binOff=0;
  while(off<buf.byteLength){const len=dv.getUint32(off,true),type=dv.getUint32(off+4,true);
    if(type===0x4E4F534A)json=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,off+8,len)));else if(type===0x004E4942)binOff=off+8;off+=8+len;}
  const CT={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
  const NC={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
  // packed accessors (build.py): int16/int8 VEC4 with extras.q = {n, o, s} or {n, norm} decode to float
  const accessor=i=>{const a=json.accessors[i],q=a.extras&&a.extras.q,r=rawAccessor(i);if(!q)return r;const out=new Float32Array(a.count*q.n);
    for(let k=0;k<a.count;k++)for(let c=0;c<q.n;c++)out[k*q.n+c]=q.norm?r[k*4+c]/q.norm:r[k*4+c]/32767*q.s[c]+q.o[c];return out;};
  const rawAccessor=i=>{const a=json.accessors[i],bv=json.bufferViews[a.bufferView];const T=CT[a.componentType],n=NC[a.type];
    const start=binOff+(bv.byteOffset||0)+(a.byteOffset||0);const stride=bv.byteStride||0;
    if(!stride||stride===n*T.BYTES_PER_ELEMENT)return new T(buf.slice(start,start+a.count*n*T.BYTES_PER_ELEMENT));
    const out=new T(a.count*n);const src=new DataView(buf);
    for(let k=0;k<a.count;k++)for(let c=0;c<n;c++){const o=start+k*stride+c*T.BYTES_PER_ELEMENT;
      out[k*n+c]=T===Float32Array?src.getFloat32(o,true):T===Uint16Array?src.getUint16(o,true):T===Uint32Array?src.getUint32(o,true):src.getUint8(o);}
    return out;};
  const mats=(json.materials||[]).map(m=>{const p=m.pbrMetallicRoughness||{};const f=p.baseColorFactor||[1,1,1,1];
    const metal=p.metallicFactor!==undefined?p.metallicFactor:1,rough=p.roughnessFactor!==undefined?p.roughnessFactor:1;
    const name=m.name||'';const col=new THREE.Color(f[0],f[1],f[2]).convertSRGBToLinear();
    const isGun=/^g_/.test(name),isSkin=/_skin$/.test(name),isChar=/^[SW]_[a-z]+_/.test(name)&&!isSkin;
    const plain=isSkin||/glass|lens|screen|g_red|visor|lamp|wrap|bottle|led|snow$|patch|clabel|glow|emit|neon|^ch_/.test(name);
    const pat=isChar&&name.match(/_(camo|digi|snowcamo|plaid)$/);
    const mt=new THREE.MeshStandardMaterial({color:col,metalness:isGun?metal:Math.min(metal,0.15),roughness:Math.max(isGun?0.08:0.35,rough),transparent:m.alphaMode==='BLEND'||f[3]<1,opacity:f[3],
      map:plain?null:pat?clothTex(pat[1],f):isChar?TEX.fabric:TEX.detail,normalMap:plain?null:isChar?TEX.fabricN:TEX.detailN,envMapIntensity:isGun?0.9:isChar?0.55:0.8});
    if(pat)mt.color.setRGB(1,1,1);
    if(isChar)mt.normalScale.set(0.6,0.6);
    if(isSkin){mt.roughness=0.52;mt.envMapIntensity=0.45;}
    // emissive convention for Blender materials: names with 'emit' or 'neon' glow (and bloom); 'emit2'/'emit4' scale it
    if(/screen|lampglass|g_red|emit|neon/.test(name)){mt.emissive=col.clone();const k=name.match(/emit(\d+)/);mt.emissiveIntensity=k?+k[1]:/neon/.test(name)?4:/lampglass/.test(name)?2.2:1.6;}
    mt.name=name;return mt;});
  const defMat=new THREE.MeshStandardMaterial({color:0xcccccc});
  const meshes=(json.meshes||[]).map(m=>m.primitives.map(pr=>{const g=new THREE.BufferGeometry();const A=pr.attributes;
    g.setAttribute('position',new THREE.BufferAttribute(accessor(A.POSITION),3));
    if(A.NORMAL!==undefined)g.setAttribute('normal',new THREE.BufferAttribute(accessor(A.NORMAL),3));else g.computeVertexNormals();
    // vertex colours (baked ambient occlusion, face shading) multiply the material colour
    if(A.COLOR_0!==undefined){const a=json.accessors[A.COLOR_0],src=accessor(A.COLOR_0),n=NC[a.type],sc=a.componentType===5126?1:a.componentType===5123?1/65535:1/255;
      const c=new Float32Array(a.count*3);for(let k=0;k<a.count;k++)for(let j=0;j<3;j++)c[k*3+j]=src[k*n+j]*sc;g.setAttribute('color',new THREE.BufferAttribute(c,3));}
    if(A.JOINTS_0!==undefined){const w=json.accessors[A.WEIGHTS_0];
      g.setAttribute('skinIndex',new THREE.BufferAttribute(accessor(A.JOINTS_0),4));g.setAttribute('skinWeight',new THREE.BufferAttribute(accessor(A.WEIGHTS_0),4,w.componentType!==5126));}
    if(pr.indices!==undefined)g.setIndex(new THREE.BufferAttribute(accessor(pr.indices),1));
    g.computeBoundingSphere();return{g,m:pr.material!==undefined?mats[pr.material]:defMat};}));
  const joints=new Set();for(const sk of json.skins||[])for(const j of sk.joints)joints.add(j);
  const nodes=json.nodes.map((n,i)=>{const o=joints.has(i)?new THREE.Bone():new THREE.Group();o.name=n.name||'';
    if(n.mesh!==undefined)for(const p of meshes[n.mesh]){const sk=n.skin!==undefined&&!!p.g.attributes.skinIndex;
      const me=sk?new THREE.SkinnedMesh(p.g,matVariant(p.m,!!p.g.attributes.color,true)):new THREE.Mesh(p.g,matVariant(p.m,!!p.g.attributes.color,false));
      me.castShadow=true;me.receiveShadow=true;me.name=o.name+'#mesh';o.add(me);}
    if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale);}
    else{if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);}
    return o;});
  json.nodes.forEach((n,i)=>{if(n.children)for(const c of n.children)nodes[i].add(nodes[c]);});
  // skins: every skinned primitive of a node shares one skeleton; glTF ignores the mesh node's own transform,
  // which an identity bind matrix with three's 'attached' bind mode reproduces
  json.nodes.forEach((n,i)=>{if(n.skin===undefined||n.mesh===undefined)return;const sk=json.skins[n.skin];
    const ibm=sk.inverseBindMatrices!==undefined?accessor(sk.inverseBindMatrices):null;
    const skel=new THREE.Skeleton(sk.joints.map(j=>nodes[j]),sk.joints.map((j,k)=>{const m=new THREE.Matrix4();if(ibm)m.fromArray(ibm,k*16);return m;}));
    for(const me of nodes[i].children)if(me.isSkinnedMesh){me.bind(skel,new THREE.Matrix4());me.frustumCulled=false;}});
  for(const i of json.scenes[json.scene||0].nodes){const o=nodes[i];ASSET[o.name.replace(/_root$/,'')]=o;
    o.position.set(0,0,0);o.updateMatrixWorld(true);const v=new THREE.Vector3(),n=new THREE.Vector3();
    o.traverse(me=>{if(me.isSkinnedMesh)o.userData.skinned=true;if(!me.isMesh||me.geometry.attributes.uv)return;const P=me.geometry.attributes.position,NN=me.geometry.attributes.normal;
      const NM=new THREE.Matrix3().getNormalMatrix(me.matrixWorld);const uv=new Float32Array(P.count*2);
      for(let k=0;k<P.count;k++){v.fromBufferAttribute(P,k).applyMatrix4(me.matrixWorld);n.fromBufferAttribute(NN,k).applyMatrix3(NM);
        const ax=Math.abs(n.x),ay=Math.abs(n.y),az=Math.abs(n.z);
        if(ax>=ay&&ax>=az){uv[k*2]=v.z;uv[k*2+1]=v.y;}else if(ay>=az){uv[k*2]=v.x;uv[k*2+1]=v.z;}else{uv[k*2]=v.x;uv[k*2+1]=v.y;}}
      me.geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));});
  }
}
// material copies for vertex colours and skinning (three r128 needs both flags on the material)
const MATVAR=new Map();
function matVariant(m,vc,sk){
  if(!vc&&!sk)return m;let v=MATVAR.get(m);if(!v)MATVAR.set(m,v={});const k=(vc?'v':'')+(sk?'s':'');
  if(!v[k]){const c=m.clone();c.vertexColors=vc;c.skinning=sk;c.name=m.name;v[k]=c;}return v[k];
}
function asset(name){const t=ASSET[name];if(!t)throw new Error('missing model '+name);const o=t.clone();o.position.set(0,0,0);
  if(t.userData.skinned){const bones={},done=new Map();o.traverse(b=>{if(b.isBone)bones[b.name]=b;});
    o.traverse(me=>{if(!me.isSkinnedMesh)return;let sk=done.get(me.skeleton);
      if(!sk){sk=new THREE.Skeleton(me.skeleton.bones.map(b=>bones[b.name]),me.skeleton.boneInverses.map(m=>m.clone()));done.set(me.skeleton,sk);}
      me.bind(sk,me.bindMatrix);});}
  return o;}

// Static props are baked into one merged mesh per material so a whole town of them costs a handful of draw calls.
const PropBatch={groups:new Map(),
  add(name,x,y,z,rotY,scale){
    const t=ASSET[name];if(!t)return;const sc=Array.isArray(scale)?V3(scale[0],scale[1],scale[2]):V3(scale||1,scale||1,scale||1);
    const root=new THREE.Matrix4().compose(V3(x,y,z),new THREE.Quaternion().setFromAxisAngle(V3(0,1,0),rotY||0),sc);
    t.position.set(0,0,0);t.updateMatrixWorld(true);
    t.traverse(o=>{if(!o.isMesh)return;const M=root.clone().multiply(o.matrixWorld);const N=new THREE.Matrix3().getNormalMatrix(M);
      let G=this.groups.get(o.material);if(!G){G={p:[],n:[],u:[],i:[],v:0};this.groups.set(o.material,G);}
      const P=o.geometry.attributes.position,NN=o.geometry.attributes.normal,UV=o.geometry.attributes.uv,I=o.geometry.index;const v=new THREE.Vector3();
      for(let k=0;k<P.count;k++){v.fromBufferAttribute(P,k).applyMatrix4(M);G.p.push(v.x,v.y,v.z);v.fromBufferAttribute(NN,k).applyMatrix3(N).normalize();G.n.push(v.x,v.y,v.z);
        G.u.push(UV?UV.getX(k)*sc.x:0,UV?UV.getY(k)*sc.y:0);}
      if(I)for(let k=0;k<I.count;k++)G.i.push(G.v+I.getX(k));else for(let k=0;k<P.count;k++)G.i.push(G.v+k);
      G.v+=P.count;});
  },
  build(parent){for(const[m,G]of this.groups){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(G.p,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(G.n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(G.u,2));g.setIndex(G.i);g.computeBoundingSphere();
    const me=new THREE.Mesh(g,m);me.castShadow=!m.transparent;me.receiveShadow=true;me.matrixAutoUpdate=false;(parent||scene).add(me);}this.groups.clear();}
};

function gunAsset(id,team){return id==='fire'?(team==='W'?'fireW':'fireS'):id;}
// builds a gun pointing down -z with {group, muzzle, fore}; skin is a finish id from FINISHES (optional)
const SKIN_SKIP=/barrel|brake|flash|bolt|knob|bead|lens|glass|screen|led|optic|scope|ocu|obj|turret|mount|trigger|tooth|rail|handle|cable|_fore|_muzzle/;
const skinMatCache={};
function skinMaterial(fid){
  if(skinMatCache[fid])return skinMatCache[fid];const F=FINISHES[fid];
  const m=new THREE.MeshStandardMaterial({map:finishTex(fid),metalness:F.metal,roughness:F.rough,normalMap:TEX.detailN,envMapIntensity:1.3});
  if(F.glow){m.emissiveMap=m.map;m.emissive=new THREE.Color(0xffffff);m.emissiveIntensity=F.glow;}
  return skinMatCache[fid]=m;
}
function buildGun(id,team,skin,variant){
  const name=id==='knife'&&variant&&ASSET[variant]?variant:gunAsset(id,team);const group=asset(name);
  const mz=group.getObjectByName(name+'_muzzle'),fo=group.getObjectByName(name+'_fore');
  const out={group,muzzle:mz?mz.position.clone():V3(0,0,-0.5),fore:fo?fo.position.clone():V3(0,0,-0.3)};
  if(id==='bomb'){const led=group.getObjectByName('bomb_led');if(led){const m=led.children[0];m.material=m.material.clone();group.userData.led=m;}}
  if(skin&&FINISHES[skin]&&WEP[id]&&WEP[id].cls!=='nade'&&id!=='bomb'){
    const sm=skinMaterial(skin);
    group.traverse(o=>{if(o.isMesh&&!SKIN_SKIP.test(o.name)&&!/glass|lens|screen|red/.test(o.material.name))o.material=sm;});
  }
  return out;
}
// side-view silhouette icons made by projecting the Blender gun meshes
const ICON={};
function makeIcons(){
  for(const id of['knife','g9','p12','hawk','vex','breacher','ark7','m4r','longshot','he','flash','smoke','fire','bomb']){
    const t=ASSET[gunAsset(id,'S')];t.updateMatrixWorld(true);const tris=[];let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;const v=new THREE.Vector3();
    t.traverse(o=>{if(!o.isMesh)return;const P=o.geometry.attributes.position,I=o.geometry.index;const pts=[];
      for(let k=0;k<P.count;k++){v.fromBufferAttribute(P,k).applyMatrix4(o.matrixWorld);
        const px=id==='bomb'?v.x:-v.z;pts.push([px,v.y]);x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,v.y);y1=Math.max(y1,v.y);}
      const n=I?I.count:P.count;for(let k=0;k<n;k+=3){const a=I?I.getX(k):k,b=I?I.getX(k+1):k+1,c=I?I.getX(k+2):k+2;tris.push(pts[a],pts[b],pts[c]);}});
    const H=64,sc=Math.min((H-8)/(y1-y0),220/(x1-x0));const W=Math.ceil((x1-x0)*sc+8);
    const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
    // each triangle is filled on its own: front and back faces have opposite winding and would cancel in one path
    const draw=(ox,oy)=>{for(let k=0;k<tris.length;k+=3){g.beginPath();for(let j=0;j<3;j++){const p=tris[k+j];const X=4+(p[0]-x0)*sc+ox,Y=H/2-(p[1]-(y0+y1)/2)*sc+oy;j?g.lineTo(X,Y):g.moveTo(X,Y);}g.closePath();g.fill();g.stroke();}};
    g.lineWidth=0.6;g.lineJoin='round';
    g.fillStyle=g.strokeStyle='#000';for(const[ox,oy]of[[-2,0],[2,0],[0,-2],[0,2]])draw(ox,oy);g.fillStyle=g.strokeStyle='#f4f1e8';draw(0,0);
    ICON[id]=c.toDataURL();
  }
}
const HS_SVG='<svg viewBox="0 0 24 24"><circle cx="12" cy="11" r="7" fill="none" stroke="#ff5a4f" stroke-width="2.2"/><path d="M12 1v6M12 15v8M1 11h6M17 11h6" stroke="#ff5a4f" stroke-width="2.2"/></svg>';
const WB_SVG='<svg viewBox="0 0 24 24"><path d="M4 3h5v18H4z" fill="#f4f1e8"/><path d="M1 12h22" stroke="#ff5a4f" stroke-width="2.4" stroke-dasharray="3 2"/></svg>';
