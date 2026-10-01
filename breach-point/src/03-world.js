
/* =====================================================================
   World: the current map's grid, collision boxes, rays and path finding
   ===================================================================== */
const CELL=2,GW=64,GH=64,OX=-GW*CELL/2,OZ=-GH*CELL/2;
const cx=c=>OX+c*CELL+CELL/2, cz=r=>OZ+r*CELL+CELL/2;
const colOf=x=>Math.floor((x-OX)/CELL), rowOf=z=>Math.floor((z-OZ)/CELL);
const cellPos=(c,r)=>V3(cx(c),0,cz(r));

let MAP=null,SPAWNS,SPAWN_ZONE,SITES,ZONES,SITE_OF_ZONE,PLANS,SITE_SPOTS,PLANT_SPOT,HOLDS;
function useMap(id){
  MAP=MAPS[id]||MAPS.sandline;
  ({spawns:SPAWNS,spawnZone:SPAWN_ZONE,sites:SITES,zones:ZONES,siteOfZone:SITE_OF_ZONE,plans:PLANS,siteSpots:SITE_SPOTS,plantSpot:PLANT_SPOT,holds:HOLDS}=MAP);
}
function buildGrid(){
  const g=[];for(let r=0;r<GH;r++)g.push(new Array(GW).fill('#'));
  MAP.grid((c0,r0,c1,r1,ch='.')=>{for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)g[r][c]=ch;});
  return g;
}
function zoneName(p){const c=colOf(p.x),r=rowOf(p.z);for(const z of ZONES)if(c>=z[1]&&c<=z[3]&&r>=z[2]&&r<=z[4])return z[0];return MAP.name;}
function inSite(p){for(const k in SITES){const s=SITES[k];const c=colOf(p.x),r=rowOf(p.z);if(c>=s.c0&&c<=s.c1&&r>=s.r0&&r<=s.r1)return k;}return null;}
function inSpawn(team,p){const z=SPAWN_ZONE[team];const c=colOf(p.x),r=rowOf(p.z);return c>=z[0]&&c<=z[2]&&r>=z[1]&&r<=z[3];}

// Merges many boxes into one geometry with world-space UVs. ao darkens the bottom of walls (contact shadow).
class GeoBatch{
  constructor(){this.p=[];this.n=[];this.u=[];this.c=[];this.i=[];this.v=0;}
  quad(vs,n,cols,f,s,unit){
    for(let k=0;k<4;k++){const v=vs[k];this.p.push(v[0],v[1],v[2]);this.n.push(n[0],n[1],n[2]);const c=cols[k];this.c.push(c[0],c[1],c[2]);
      let uu,vv;
      if(unit){uu=(k===1||k===2)?1:0;vv=k>=2?1:0;}
      else if(f<2){uu=(f===0?-v[2]:v[2])/s;vv=v[1]/s;}else if(f<4){uu=v[0]/s;vv=v[2]/s;}else{uu=(f===4?v[0]:-v[0])/s;vv=v[1]/s;}
      this.u.push(uu,vv);}
    const b=this.v;this.i.push(b,b+1,b+2,b,b+2,b+3);this.v+=4;
  }
  box(x0,y0,z0,x1,y1,z1,o){
    o=o||{};const s=o.s||2,col=o.col||[1,1,1],unit=o.unit,skip=o.skip||0,ao=o.ao||0,dk=o.aoDark||0.45;
    const dark=[col[0]*dk,col[1]*dk,col[2]*dk];
    const F=[[[1,0,0],[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]]],[[-1,0,0],[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]]],
      [[0,1,0],[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]]],[[0,-1,0],[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]]],
      [[0,0,1],[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]],[[0,0,-1],[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]]]];
    for(let f=0;f<6;f++){
      if(skip&(1<<f))continue;const n=F[f][0],vs=F[f][1];
      if(ao&&f!==2&&f!==3){
        if(y1-y0>ao){const ym=y0+ao;
          const lo=vs.map(v=>[v[0],v[1]===y1?ym:v[1],v[2]]),hi=vs.map(v=>[v[0],v[1]===y0?ym:v[1],v[2]]);
          this.quad(lo,n,lo.map(v=>v[1]===y0?dark:col),f,s,unit);this.quad(hi,n,[col,col,col,col],f,s,unit);}
        else this.quad(vs,n,vs.map(v=>v[1]===y0?dark:col),f,s,unit);
      }else this.quad(vs,n,[col,col,col,col],f,s,unit);
    }
  }
  mesh(mat,shadow){
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.n,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(this.u,2));g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));
    g.setIndex(this.i);g.computeBoundingSphere();
    const m=new THREE.Mesh(g,mat);m.castShadow=shadow!==false;m.receiveShadow=true;m.matrixAutoUpdate=false;m.updateMatrix();return m;
  }
}

const World={
  grid:null,boxes:[],cellBoxes:[],
  reset(){this.boxes=[];this.cellBoxes=[];for(let i=0;i<GW*GH;i++)this.cellBoxes.push([]);this.walk.fill(0);this.height.fill(0);this.nearWall.fill(0);this.wallH.fill(0);},walk:new Uint8Array(GW*GH),height:new Float32Array(GW*GH),nearWall:new Uint8Array(GW*GH),
  wallH:new Float32Array(GW*GH),stamp:1,qOut:[],
  addBox(x0,y0,z0,x1,y1,z1,mat,pen){
    const b={x0,y0,z0,x1,y1,z1,mat:mat||'stone',pen:pen||0,s:0,noRay:pen===-1};if(b.noRay)b.pen=0;this.boxes.push(b);
    const c0=clamp(colOf(x0),0,GW-1),c1=clamp(colOf(x1-1e-4),0,GW-1),r0=clamp(rowOf(z0),0,GH-1),r1=clamp(rowOf(z1-1e-4),0,GH-1);
    for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)this.cellBoxes[r*GW+c].push(b);
    return b;
  },
  query(x0,z0,x1,z1){
    const out=this.qOut;out.length=0;const st=++this.stamp;
    const c0=clamp(colOf(x0),0,GW-1),c1=clamp(colOf(x1),0,GW-1),r0=clamp(rowOf(z0),0,GH-1),r1=clamp(rowOf(z1),0,GH-1);
    for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){const l=this.cellBoxes[r*GW+c];for(let i=0;i<l.length;i++){const b=l[i];if(b.s!==st){b.s=st;out.push(b);}}}
    return out;
  },
  pointSolid(x,y,z){
    if(y<0)return true;const c=colOf(x),r=rowOf(z);if(c<0||r<0||c>=GW||r>=GH)return true;
    const l=this.cellBoxes[r*GW+c];for(const b of l)if(!b.noRay&&x>b.x0&&x<b.x1&&y>b.y0&&y<b.y1&&z>b.z0&&z<b.z1)return b;return null;
  },
  // slab test; returns entry distance or -1 and writes the entry normal to _n
  rayBox(ox,oy,oz,ix,iy,iz,b,maxT,res){
    let t1=(b.x0-ox)*ix,t2=(b.x1-ox)*ix,tmin=Math.min(t1,t2),tmax=Math.max(t1,t2),ax=0;
    t1=(b.y0-oy)*iy;t2=(b.y1-oy)*iy;let a=Math.min(t1,t2),bb=Math.max(t1,t2);
    if(a>tmin){tmin=a;ax=1;}if(bb<tmax)tmax=bb;
    t1=(b.z0-oz)*iz;t2=(b.z1-oz)*iz;a=Math.min(t1,t2);bb=Math.max(t1,t2);
    if(a>tmin){tmin=a;ax=2;}if(bb<tmax)tmax=bb;
    if(tmax<Math.max(tmin,0)||tmin>maxT)return false;
    if(res){res.t=tmin;res.t2=tmax;res.ax=ax;}
    return true;
  },
  rayHits(o,d,maxT){
    const ix=1/(d.x||1e-9),iy=1/(d.y||1e-9),iz=1/(d.z||1e-9);const hits=[];const res={t:0,t2:0,ax:0};
    for(const b of this.boxes){
      if(!b.noRay&&this.rayBox(o.x,o.y,o.z,ix,iy,iz,b,maxT,res)&&res.t2>0){
        const n=[0,0,0];n[res.ax]=-Math.sign(res.ax===0?d.x:res.ax===1?d.y:d.z);
        hits.push({t:Math.max(0,res.t),t2:res.t2,b,n});
      }
    }
    if(d.y<0){const t=-o.y/d.y;if(t<maxT)hits.push({t,t2:t+100,b:null,n:[0,1,0]});}
    hits.sort((p,q)=>p.t-q.t);return hits;
  },
  rayFirst(o,d,maxT){
    const ix=1/(d.x||1e-9),iy=1/(d.y||1e-9),iz=1/(d.z||1e-9);const res={t:0,t2:0,ax:0};let best=maxT,bn=null,bb=null;
    for(const b of this.boxes){if(!b.noRay&&this.rayBox(o.x,o.y,o.z,ix,iy,iz,b,best,res)&&res.t>=0&&res.t<best){best=res.t;bb=b;bn=[0,0,0];bn[res.ax]=-Math.sign(res.ax===0?d.x:res.ax===1?d.y:d.z);}}
    if(d.y<0){const t=-o.y/d.y;if(t<best){best=t;bn=[0,1,0];bb=null;}}
    return bn?{t:best,n:bn,b:bb}:null;
  },
  segBlocked(ax,ay,az,bx,by,bz){
    const dx=bx-ax,dy=by-ay,dz=bz-az,L=Math.sqrt(dx*dx+dy*dy+dz*dz);if(L<1e-4)return false;
    const ix=L/(dx||1e-9),iy=L/(dy||1e-9),iz=L/(dz||1e-9);
    const res={t:0,t2:0,ax:0};
    for(const b of this.boxes){if(!b.noRay&&this.rayBox(ax,ay,az,ix,iy,iz,b,L-0.05,res)&&res.t>0.02)return true;}
    return false;
  },
  idx(c,r){return r*GW+c;},
  walkable(c,r){return c>=0&&r>=0&&c<GW&&r<GH&&this.walk[r*GW+c]===1;},
  nearestWalk(c,r){
    c=clamp(c,0,GW-1);r=clamp(r,0,GH-1);if(this.walkable(c,r))return[c,r];
    for(let rad=1;rad<12;rad++)for(let dr=-rad;dr<=rad;dr++)for(let dc=-rad;dc<=rad;dc++){
      if(Math.abs(dr)!==rad&&Math.abs(dc)!==rad)continue;if(this.walkable(c+dc,r+dr))return[c+dc,r+dr];}
    return[c,r];
  },
  canStep(a,b){const ha=this.height[a],hb=this.height[b];return hb-ha<=0.55&&ha-hb<=3.1;},
  findPath(from,to){
    const s=this.nearestWalk(colOf(from.x),rowOf(from.z)),t=this.nearestWalk(colOf(to.x),rowOf(to.z));
    const si=s[1]*GW+s[0],ti=t[1]*GW+t[0];
    const N=GW*GH;if(!this._g){this._g=new Float32Array(N);this._came=new Int32Array(N);this._seen=new Uint32Array(N);this._closed=new Uint32Array(N);this._gen=0;}
    const gen=++this._gen,g=this._g,came=this._came,seen=this._seen,closed=this._closed;
    const heap=[];const push=(f,i)=>{heap.push([f,i]);let k=heap.length-1;while(k>0){const p=(k-1)>>1;if(heap[p][0]<=heap[k][0])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p;}};
    const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let k=0;for(;;){const l=2*k+1,r=l+1;let m=k;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===k)break;[heap[m],heap[k]]=[heap[k],heap[m]];k=m;}}return top;};
    const hf=i=>{const dc=Math.abs(i%GW-t[0]),dr=Math.abs(((i/GW)|0)-t[1]);return(Math.max(dc,dr)+0.414*Math.min(dc,dr));};
    g[si]=0;seen[si]=gen;came[si]=-1;push(hf(si),si);let found=false,iter=0;
    while(heap.length&&iter++<6000){
      const[,i]=pop();if(closed[i]===gen)continue;closed[i]=gen;if(i===ti){found=true;break;}
      const c=i%GW,r=(i/GW)|0;
      for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
        if(!dr&&!dc)continue;const nc=c+dc,nr=r+dr;if(!this.walkable(nc,nr))continue;const ni=nr*GW+nc;
        if(!this.canStep(i,ni))continue;
        if(dr&&dc){const a=r*GW+nc,b=nr*GW+c;if(!this.walk[a]||!this.walk[b]||!this.canStep(i,a)||!this.canStep(i,b))continue;}
        const cost=(dr&&dc?1.414:1)*(1+0.5*this.nearWall[ni]);const ng=g[i]+cost;
        if(seen[ni]!==gen||ng<g[ni]){seen[ni]=gen;g[ni]=ng;came[ni]=i;push(ng+hf(ni),ni);}
      }
    }
    if(!found)return null;
    const cells=[];for(let i=ti;i!==-1;i=came[i])cells.push(i);cells.reverse();
    const pts=cells.map(i=>V3(cx(i%GW),this.height[i],cz((i/GW)|0)));
    const end=this.walkable(colOf(to.x),rowOf(to.z))?V3(to.x,this.height[rowOf(to.z)*GW+colOf(to.x)],to.z):null;
    if(end&&pts.length)pts[pts.length-1]=end;
    // string pulling
    const out=[pts[0]];let k=0;
    while(k<pts.length-1){let j=Math.min(pts.length-1,k+14);while(j>k+1&&!this.clearLine(pts[k],pts[j]))j--;out.push(pts[j]);k=j;}
    return out;
  },
  clearLine(a,b){
    const dx=b.x-a.x,dz=b.z-a.z,L=Math.hypot(dx,dz);if(L<0.01)return true;
    const px=-dz/L*0.45,pz=dx/L*0.45;const n=Math.ceil(L/0.4);
    for(const off of[-1,0,1]){let prev=this.height[rowOf(a.z+pz*off)*GW+colOf(a.x+px*off)];
      for(let i=1;i<=n;i++){const x=a.x+dx*i/n+px*off,z=a.z+dz*i/n+pz*off;const c=colOf(x),r=rowOf(z);
        if(!this.walkable(c,r))return false;const h=this.height[r*GW+c];if(h-prev>0.55||prev-h>0.6)return false;prev=h;}}
    return true;
  },
  heightAt(x,z){const c=colOf(x),r=rowOf(z);if(!this.walkable(c,r))return 0;return this.height[r*GW+c];}
};


/* ------------------- map construction (collision + visuals) ------------------- */
function mergeRects(g,pred){
  const used=new Uint8Array(GW*GH),rects=[];
  for(let r=0;r<GH;r++)for(let c=0;c<GW;c++){
    if(used[r*GW+c]||!pred(g[r][c]))continue;const ch=g[r][c];let w=1;
    while(c+w<GW&&!used[r*GW+c+w]&&g[r][c+w]===ch)w++;
    let h=1;outer:while(r+h<GH){for(let k=0;k<w;k++){if(used[(r+h)*GW+c+k]||g[r+h][c+k]!==ch)break outer;}h++;}
    for(let rr=r;rr<r+h;rr++)for(let k=0;k<w;k++)used[rr*GW+c+k]=1;
    rects.push({c0:c,r0:r,c1:c+w-1,r1:r+h-1,ch});
  }
  return rects;
}
const WALKCH='.TW=d12345';
let scene,renderer,camera,sun,hemi,fxLight,vmScene,vmCam,mapGroup=null;
const MAT={};
function mapMaterial(name){
  if(MAT[name])return MAT[name];
  if(name==='trim'){MAT[name]=new THREE.MeshStandardMaterial({color:new THREE.Color(0x8a7558).convertSRGBToLinear(),roughness:0.85,vertexColors:true});return MAT[name];}
  const t=getTex(name);
  MAT[name]=new THREE.MeshStandardMaterial({map:t.map,normalMap:t.normal,normalScale:new THREE.Vector2(t.ns,t.ns),roughness:t.rough,metalness:t.metal||0,vertexColors:true,envMapIntensity:0.8});
  return MAT[name];
}
const rectXZ=R=>[OX+R.c0*CELL,OZ+R.r0*CELL,OX+(R.c1+1)*CELL,OZ+(R.r1+1)*CELL];
function disposeGroup(gr){gr.traverse(o=>{if(o.geometry&&!o.userData.sharedGeo)o.geometry.dispose();});}
// What gets hung on wall faces and parked in 'v' cells. A theme names a preset or gives its own object
// (any field left out falls back to the town preset). Asset fields may be a name or a list to pick from.
const DECOR_PRESETS={
  town:{window:'window',winY:3.7,winP:0.2,door:'door',doorP:0.06,lamp:'lamp',lampP:0.5,awnings:['awnR','awnB','awnG'],awnP:0.1,streetlamp:null,slP:0,extras:[],vehicles:['van','sedan','sedan2'],vehicleH:{}},
  docks:{window:'window',winY:3.7,winP:0.13,door:'door',doorP:0.06,lamp:'lamp',lampP:0.5,awnings:null,awnP:0,streetlamp:'streetlamp',slP:0.075,extras:[],vehicles:['forklift','van'],vehicleH:{forklift:2.2}},
  village:{window:'window',winY:3.2,winP:0.22,door:'door',doorP:0.06,lamp:'lamp',lampP:0.5,awnings:null,awnP:0,streetlamp:'streetlamp',slP:0.075,extras:[],vehicles:['van','sedan','sedan2'],vehicleH:{}}
};
const pickA=a=>Array.isArray(a)?pick(a):a;
function buildMap(){
  if(mapGroup){scene.remove(mapGroup);disposeGroup(mapGroup);}
  mapGroup=new THREE.Group();scene.add(mapGroup);
  World.reset();
  const g=buildGrid();World.grid=g;const TH=MAP.theme;
  const D=typeof TH.decor==='string'?DECOR_PRESETS[TH.decor]:Object.assign({},DECOR_PRESETS.town,TH.decor||{});
  const CP=MAP.props||{};
  for(let r=0;r<GH;r++)for(let c=0;c<GW;c++){const ch=g[r][c];const i=r*GW+c;
    World.walk[i]=WALKCH.includes(ch)&&!CP[ch]?1:0;World.height[i]='12345'.includes(ch)?(+ch)*0.5:0;}
  for(let r=0;r<GH;r++)for(let c=0;c<GW;c++){let n=0;for(const[dc,dr]of[[1,0],[-1,0],[0,1],[0,-1]])if(!World.walkable(c+dc,r+dr))n=1;World.nearWall[r*GW+c]=n;}
  const roofAt=new Float32Array(GW*GH);
  for(const[c0,r0,c1,r1,h]of MAP.roofs)for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)roofAt[r*GW+c]=h;
  const nearRoof=(R)=>{let m=0;for(let r=R.r0-1;r<=R.r1+1;r++)for(let c=R.c0-1;c<=R.c1+1;c++)if(r>=0&&c>=0&&r<GH&&c<GW)m=Math.max(m,roofAt[r*GW+c]);return m;};
  const B={};const batch=k=>B[k]||(B[k]=new GeoBatch());
  // ground
  const gs=GW*CELL/2+160,gc=TH.groundTint||[0.8,0.8,0.8],gb=batch(TH.ground),gopt={s:6,skip:63-4,col:gc};
  const open={W:false,E:false,N:false,S:false};
  for(let i=0;i<GW;i++){if(g[i][0]==='~')open.W=true;if(g[i][GW-1]==='~')open.E=true;if(g[0][i]==='~')open.N=true;if(g[GH-1][i]==='~')open.S=true;}
  for(const R of mergeRects(g,ch=>ch!=='~')){const[x0,z0,x1,z1]=rectXZ(R);gb.box(x0,-0.05,z0,x1,0,z1,gopt);}
  const e0=OX,e1=OX+GW*CELL,f0=OZ,f1=OZ+GH*CELL;
  if(!open.W)gb.box(-gs,-0.05,f0,e0,0,f1,gopt);if(!open.E)gb.box(e1,-0.05,f0,gs,0,f1,gopt);
  if(!open.N)gb.box(open.W?e0:-gs,-0.05,-gs,open.E?e1:gs,0,f0,gopt);if(!open.S)gb.box(open.W?e0:-gs,-0.05,f1,open.E?e1:gs,0,gs,gopt);
  // walls
  const wallMats=TH.walls;const pickWall=()=>{let r=Math.random(),acc=0;for(const[m,w]of wallMats){acc+=w;if(r<acc)return m;}return wallMats[0][0];};
  for(const R of mergeRects(g,ch=>ch==='#')){
    const[x0,z0,x1,z1]=rectXZ(R);
    const edge=R.c0<=1||R.r0<=1||R.c1>=GW-2||R.r1>=GH-2;const big=(R.c1-R.c0+1)*(R.r1-R.r0+1)>30;
    let h=edge?rand(9,12):big?rand(7.5,10):rand(6,8.5);const rf=nearRoof(R);if(rf)h=Math.max(h,rf+rand(0.9,1.6));
    for(let r=R.r0;r<=R.r1;r++)for(let c=R.c0;c<=R.c1;c++)World.wallH[r*GW+c]=h;
    const m=pickWall();const col=pick(TH.tints);
    batch(m).box(x0,0,z0,x1,h,z1,{s:4,col,skip:8,ao:1.6,aoDark:0.5});
    const isW=(c,r)=>c<0||r<0||c>=GW||r>=GH||g[r][c]==='#';let wN=false,wS=false,wW=false,wE=false;
    for(let c=R.c0;c<=R.c1;c++){if(isW(c,R.r0-1))wN=true;if(isW(c,R.r1+1))wS=true;}
    for(let r=R.r0;r<=R.r1;r++){if(isW(R.c0-1,r))wW=true;if(isW(R.c1+1,r))wE=true;}
    const ov=TH.cap==='snowcap'?0.1:0.12,tx0=x0-(wW?0:ov),tx1=x1+(wE?0:ov),tz0=z0-(wN?0:ov),tz1=z1+(wS?0:ov);
    if(TH.cap==='snowcap')batch('snow').box(tx0,h,tz0,tx1,h+0.28,tz1,{s:3,col:[1,1,1]});
    else if(TH.cap==='trim')batch('trim').box(tx0,h-0.05,tz0,tx1,h+0.25,tz1,{col:[1,1,1]});
    else if(TH.cap&&TH.cap!=='none')batch(TH.cap).box(tx0,h-0.05,tz0,tx1,h+0.25,tz1,{s:3,col:[1,1,1]});
    World.addBox(x0,-1,z0,x1,h,z1,'stone',0);
  }
  // windows, doors, lamps and awnings on wall faces next to open cells
  let awnings=0;
  for(let r=1;r<GH-1;r++)for(let c=1;c<GW-1;c++){
    if(g[r][c]!=='#')continue;const h=World.wallH[r*GW+c];
    for(const[dc,dr]of[[1,0],[-1,0],[0,1],[0,-1]]){
      const nch=g[r+dr][c+dc];if(nch==='#'||nch==='='||nch==='d'||nch==='~')continue;
      if(roofAt[(r+dr)*GW+c+dc])continue;
      const fx=cx(c)+dc*1.0,fz=cz(r)+dr*1.0;const rnd=Math.random(),rot=yawTo(dc,dr),hb=World.height[(r+dr)*GW+c+dc];
      let acc=D.winP;
      if(D.window&&h>5.5&&rnd<acc)PropBatch.add(pickA(D.window),fx,D.winY+hb,fz,rot);
      else if(D.door&&rnd<(acc+=D.doorP)&&WALKCH.includes(nch)){PropBatch.add(pickA(D.door),fx,hb,fz,rot);if(D.lamp&&Math.random()<D.lampP)PropBatch.add(pickA(D.lamp),fx+(dr?1:0),2.9+hb,fz+(dc?1:0),rot);}
      else if(D.awnings&&rnd<(acc+=D.awnP)&&awnings<30&&h>5){awnings++;PropBatch.add(pickA(D.awnings),fx,3.4+hb,fz,rot);}
      else if(D.streetlamp&&rnd<(acc+=D.slP)&&h>5)PropBatch.add(pickA(D.streetlamp),fx-dc*0.02,0,fz-dr*0.02,rot);
      else for(const e of D.extras){if(rnd<(acc+=e.p)){if(h>=(e.minH||0))PropBatch.add(pickA(e.asset),fx+dc*(e.out||0),(e.y||0)+hb,fz+dr*(e.out||0),rot,e.scale);break;}}
    }
  }
  // raised floors / stairs
  for(const R of mergeRects(g,ch=>'12345'.includes(ch))){
    const h=(+R.ch)*0.5;const[x0,z0,x1,z1]=rectXZ(R);
    batch(TH.stairs||TH.paving).box(x0,0,z0,x1,h,z1,{s:3,col:[1,0.97,0.93],skip:8,ao:Math.min(h,0.6),aoDark:0.6});
    World.addBox(x0,-1,z0,x1,h,z1,'stone',0);
  }
  MAP.paved.forEach((p,i)=>batch(p[4]||TH.paving).box(OX+p[0]*CELL,0,OZ+p[1]*CELL,OX+(p[2]+1)*CELL,0.02+i*0.004,OZ+(p[3]+1)*CELL,{s:3,col:[0.95,0.93,0.9],skip:63-4}));
  // low walls
  for(const R of mergeRects(g,ch=>ch==='w')){const[x0,z0,x1,z1]=rectXZ(R);const i0=0.15;
    batch(TH.lowWall||'stone').box(x0+i0,0,z0+i0,x1-i0,1.1,z1-i0,{s:3,col:[0.92,0.9,0.88],ao:0.5,aoDark:0.6});
    batch(TH.cap==='snowcap'?'snow':TH.lowWallCap||'trim').box(x0+0.05,1.1,z0+0.05,x1-0.05,1.22,z1-0.05,{s:3,col:[1,1,1]});
    World.addBox(x0+0.05,0,z0+0.05,x1-0.05,1.22,z1-0.05,'stone',0);}
  // single-cell props
  for(let r=0;r<GH;r++)for(let c=0;c<GW;c++){
    const ch=g[r][c];const x=cx(c),z=cz(r);
    if(CP[ch]){ // map-specific single-cell prop: {asset, h, w, mat, pen, rot, scale, y}
      const p=CP[ch];const rot=p.rot==='random'?rand(0,6.283):p.rot==='grid'||p.rot===undefined?pick([0,Math.PI/2,Math.PI,-Math.PI/2]):p.rot;
      PropBatch.add(pickA(p.asset),x,p.y||0,z,rot,p.scale);const w=p.w===undefined?0.95:p.w;
      if(p.h)World.addBox(x-w,0,z-w,x+w,p.h,z+w,p.mat||'stone',p.pen||0);
    }else if(ch==='c'||ch==='m'||ch==='C'){
      const h=ch==='c'?1.1:ch==='m'?1.6:2.3;
      PropBatch.add(ch==='c'?'crateS':ch==='m'?'crateM':'crateC',x,0,z,pick([0,Math.PI/2,Math.PI,-Math.PI/2]));
      World.addBox(x-0.95,0,z-0.95,x+0.95,h,z+0.95,'wood',1);
    }else if(ch==='-'||ch==='|'){
      const ax=ch==='-';const x0=ax?x-1:x-0.12,x1=ax?x+1:x+0.12,z0=ax?z-0.12:z-1,z1=ax?z+0.12:z+1;
      PropBatch.add('panel',x,0,z,ax?0:Math.PI/2);World.addBox(x0,0,z0,x1,3,z1,'wood',1);
    }else if(ch==='P'){
      PropBatch.add('plant',x,0,z,rand(0,6));World.addBox(x-0.32,0,z-0.32,x+0.32,0.75,z+0.32,'stone',0);
    }else if(ch==='y'){
      PropBatch.add('pallets',x,0,z,pick([0,Math.PI/2]),[1.55,1.03,1.82]);World.addBox(x-0.93,0,z-0.93,x+0.93,1.2,z+0.93,'wood',1);
    }else if(ch==='z'){
      PropBatch.add(pickA(MAP.trees.cell||(MAP.trees.type==='palm'?'palm':MAP.trees.type==='pineSnow'?'pineSnow':'pine')),x,0,z,rand(0,6),MAP.trees.cellScale?rand(...MAP.trees.cellScale):rand(5.5,7));
      World.addBox(x-0.45,0,z-0.45,x+0.45,6,z+0.45,'wood',1.5);
    }else if(ch==='d'){
      let top=7;for(const[dc,dr]of[[1,0],[-1,0],[0,1],[0,-1]]){const nr=r+dr,nc=c+dc;if(nr>=0&&nc>=0&&nr<GH&&nc<GW)top=Math.max(top,World.wallH[nr*GW+nc]);}
      batch(pickWall()).box(x-1,3.2,z-1,x+1,top,z+1,{s:4,col:[0.95,0.93,0.9],skip:8});batch('trim').box(x-1,3.0,z-1.05,x+1,3.2,z+1.05,{col:[0.6,0.45,0.3]});
      World.addBox(x-1,3.2,z-1,x+1,top,z+1,'stone',0);
    }else if(ch==='o'||ch==='u'){
      for(const[ox,oz]of[[-0.45,-0.4],[0.45,-0.35],[0.05,0.45]]){
        PropBatch.add(ch==='o'?'barrel':pick(['drumB','drumR']),x+ox,0,z+oz,rand(0,6));
        World.addBox(x+ox-0.34,0,z+oz-0.34,x+ox+0.34,1.0,z+oz+0.34,ch==='o'?'wood':'metal',ch==='o'?1.4:1.2);}
    }
  }
  // sandbags, containers, cars (merged rectangles)
  for(const R of mergeRects(g,ch=>ch==='n')){const[x0,z0,x1,z1]=rectXZ(R);const alongX=(R.c1-R.c0)>=(R.r1-R.r0);
    for(let r=R.r0;r<=R.r1;r++)for(let c=R.c0;c<=R.c1;c++)PropBatch.add('sandbags',cx(c),0,cz(r),alongX?0:Math.PI/2);
    if(alongX)World.addBox(x0,0,(z0+z1)/2-0.45,x1,0.85,(z0+z1)/2+0.45,'stone',0);else World.addBox((x0+x1)/2-0.45,0,z0,(x0+x1)/2+0.45,0.85,z1,'stone',0);}
  const contCols=['contR','contB','contG','contO','contW'];
  for(const R of mergeRects(g,ch=>ch==='k'||ch==='K')){const[x0,z0,x1,z1]=rectXZ(R);const alongX=(x1-x0)>(z1-z0);
    const len=alongX?x1-x0:z1-z0;const n=Math.max(1,Math.round(len/6));const stack=R.ch==='K'?2:1;
    for(let i=0;i<n;i++){const t=(i+0.5)/n;const px=alongX?lerp(x0,x1,t):(x0+x1)/2,pz=alongX?(z0+z1)/2:lerp(z0,z1,t);
      for(let s=0;s<stack;s++)PropBatch.add(pick(contCols),px+(s?rand(-0.1,0.1):0),s*2.6,pz,(alongX?Math.PI/2:0)+(Math.random()<0.5?Math.PI:0)+(s?rand(-0.05,0.05):0));}
    World.addBox(x0+0.02,0,z0+0.02,x1-0.02,2.6*stack,z1-0.02,'metal',0.6);}
  for(const R of mergeRects(g,ch=>ch==='v')){
    const[x0,z0,x1,z1]=rectXZ(R);const alongX=(x1-x0)>(z1-z0);
    const kind=pickA(D.vehicles);
    PropBatch.add(kind,(x0+x1)/2,0,(z0+z1)/2,(alongX?Math.PI/2:0)+(Math.random()<0.5?Math.PI:0));
    World.addBox(x0+0.15,0,z0+0.15,x1-0.15,(D.vehicleH&&D.vehicleH[kind])||1.5,z1-0.15,'metal',2.5);
  }
  // low tunnel roofs
  const roofMat=TH.roof||'stone';
  for(const R of mergeRects(g,ch=>ch==='=')){
    const[x0,z0,x1,z1]=rectXZ(R);
    batch(roofMat).box(x0,3.4,z0,x1,4.2,z1,{s:4,col:[0.8,0.78,0.75]});World.addBox(x0,3.4,z0,x1,4.2,z1,'stone',0);
    for(let x=x0+1;x<x1;x+=4)batch('trim').box(x-0.15,3.1,z0,x+0.15,3.4,z1,{col:[0.55,0.4,0.28]});
  }
  // high roofs (warehouse, lodge); the gaps between them are skylights
  for(const[c0,r0,c1,r1,h]of MAP.roofs){
    const x0=OX+c0*CELL,z0=OZ+r0*CELL,x1=OX+(c1+1)*CELL,z1=OZ+(r1+1)*CELL;
    batch(roofMat).box(x0,h,z0,x1,h+0.4,z1,{s:4,col:[0.85,0.85,0.85]});World.addBox(x0,h,z0,x1,h+0.4,z1,'stone',0);
    for(let x=x0+2;x<x1;x+=4)batch('trim').box(x-0.12,h-0.35,z0,x+0.12,h,z1,{col:[0.45,0.4,0.36]});
  }
  // water: invisible railings stop players, the surface is a shader plane
  const waterRects=mergeRects(g,ch=>ch==='~');
  for(const R of waterRects){const[x0,z0,x1,z1]=rectXZ(R);World.addBox(x0,-3,z0,x1,4,z1,'stone',-1);}
  if(waterRects.length)makeWater(waterRects.map(rectXZ));
  // quay walls and details along every edge between land and water
  const quay=new GeoBatch();let qn=0;
  for(let r=0;r<GH;r++)for(let c=0;c<GW;c++){if(g[r][c]==='~')continue;
    for(const[dc,dr]of[[1,0],[-1,0],[0,1],[0,-1]]){const nc=c+dc,nr=r+dr;if(nc<0||nr<0||nc>=GW||nr>=GH||g[nr][nc]!=='~')continue;
      const ex=cx(c)+dc,ez=cz(r)+dr;qn++;
      if(dc)quay.box(ex-(dc>0?0:0.3),-1.6,ez-1,ex+(dc>0?0.3:0),0.02,ez+1,{s:3,col:[0.8,0.8,0.8]});else quay.box(ex-1,-1.6,ez-(dr>0?0:0.3),ex+1,0.02,ez+(dr>0?0.3:0),{s:3,col:[0.8,0.8,0.8]});
      if(World.walkable(c,r)&&MAP.water!=='plain'){const k=dc?r:c;if(k%4===0)PropBatch.add('bollard',ex-dc*0.35,0,ez-dr*0.35,0);
        if(k%12===6)PropBatch.add('lifebuoy',ex-dc*0.12,0,ez-dr*0.12,yawTo(-dc,-dr)+Math.PI);}}}
  if(qn)mapGroup.add(quay.mesh(mapMaterial(TH.quay||'concretewall')));
  // trees, cranes and other scenery outside the playable area
  for(const[c,r]of MAP.trees.at){
    const t=pickA(MAP.trees.type);
    if(t==='crane')PropBatch.add('crane',cx(c),0,cz(r),Math.PI/2);
    else PropBatch.add(t,cx(c)+rand(-0.5,0.5),0,cz(r)+rand(-0.5,0.5),rand(0,6),rand(MAP.trees.min,MAP.trees.max));
  }
  // hand-placed hero props: {asset, at:[col,row] (fractions allowed), y, rot, scale, collide:{w,d,h,mat,pen}}
  for(const e of MAP.extras||[]){const x=OX+e.at[0]*CELL,z=OZ+e.at[1]*CELL;PropBatch.add(pickA(e.asset),x,e.y||0,z,e.rot||0,e.scale);
    if(e.collide){const k=e.collide;World.addBox(x-k.w,(e.y||0),z-(k.d||k.w),x+k.w,(e.y||0)+k.h,z+(k.d||k.w),k.mat||'stone',k.pen||0);}}
  PropBatch.build(mapGroup);
  for(const k in B){if(!B[k].v)continue;mapGroup.add(B[k].mesh(mapMaterial(k),k!==TH.ground));}
  for(const s of MAP.signs)addDecal(letterTex(s.t,s.c,s.a),OX+s.x*CELL+s.nx*0.03,s.y||2.8,OZ+s.z*CELL+s.nz*0.03,s.nx,s.nz,s.s);
}
function addDecal(tex,x,y,z,nx,nz,size){
  const m=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshStandardMaterial({map:tex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,roughness:0.9}));
  m.position.set(x,y,z);m.rotation.y=Math.atan2(nx,nz);m.receiveShadow=true;mapGroup.add(m);
}
