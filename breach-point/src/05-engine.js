/* =====================================================================
   Renderer and graphics: PBR materials lit by a shader sky (also used
   as the reflection environment), sun shadows that follow the camera,
   and an HDR post chain (bloom, ACES tone mapping, colour grading,
   vignette, FXAA or MSAA). Quality presets scale all of it.
   ===================================================================== */
let NOW=0;
const QUALITY={
  low:{label:'Low',shadow:0,post:false,msaa:0,pr:1,bloom:false,particles:0.35,follow:false},
  medium:{label:'Medium',shadow:1024,post:true,msaa:0,pr:1,bloom:false,particles:0.6,follow:false},
  high:{label:'High',shadow:2048,post:true,msaa:4,pr:1.5,bloom:true,particles:1,follow:true,ext:55},
  ultra:{label:'Ultra',shadow:4096,post:true,msaa:4,pr:2,bloom:true,particles:1.5,follow:true,ext:46}
};
const Q=()=>QUALITY[S.quality]||QUALITY.ultra;
function vFovFor(hfov,aspect){return 2*Math.atan(Math.tan(hfov*DEG/2)/aspect)/DEG;}
const lin=hex=>new THREE.Color(hex).convertSRGBToLinear();
const GLSL_NOISE=`float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}`;
let skyMat=null,skyMesh=null,envRT=null,pmrem=null,isWebGL2=false;
function makeSkyMaterial(){
  return new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,
    uniforms:{top:{value:new THREE.Color()},mid:{value:new THREE.Color()},horizon:{value:new THREE.Color()},ground:{value:new THREE.Color()},
      sunCol:{value:new THREE.Color()},sunDir:{value:new THREE.Vector3(0,1,0)},clouds:{value:0.4},time:{value:0},stars:{value:0},cloudCol:{value:new THREE.Color(1,1,1)}},
    vertexShader:`varying vec3 vDir;void main(){vDir=normalize((modelMatrix*vec4(position,0.0)).xyz);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform vec3 top,mid,horizon,ground,sunCol,sunDir,cloudCol;uniform float clouds,time,stars;varying vec3 vDir;${GLSL_NOISE}
void main(){vec3 d=normalize(vDir);float y=d.y;vec3 col;
  if(y>0.){col=mix(horizon,mid,smoothstep(0.,0.22,y));col=mix(col,top,smoothstep(0.18,0.85,y));}else col=mix(horizon,ground,smoothstep(0.,-0.12,y));
  float sd=max(dot(d,normalize(sunDir)),0.);
  col+=sunCol*(pow(sd,900.)*40.+pow(sd,60.)*0.5+pow(sd,7.)*0.18);
  if(stars>0.&&y>0.){vec2 sp=floor(vec2(atan(d.z,d.x)*180.,asin(y)*180.));float h=hash(sp);col+=vec3(0.9,0.95,1.)*step(0.9965,h)*stars*smoothstep(0.05,0.35,y)*(0.5+0.5*sin(time*2.+h*60.));}
  if(y>0.){vec2 uv=d.xz/(y+0.12)*1.4+vec2(time*0.006,time*0.003);
    float c=fbm(uv*1.2)+fbm(uv*3.1+7.)*0.25;c=smoothstep(1.05-clouds*0.6,1.35-clouds*0.45,c+clouds*0.2);
    vec3 cc=mix(cloudCol,horizon,0.35)*(0.9+0.6*pow(sd,5.))+sunCol*pow(sd,12.)*0.3;
    col=mix(col,cc,c*smoothstep(0.,0.12,y)*0.92);}
  gl_FragColor=vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`});
}
const Post={
  ready:false,
  init(){
    const pass=(frag,uniforms)=>new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:frag});
    this.cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));this.qscene=new THREE.Scene();this.qscene.add(this.quad);this.quad.frustumCulled=false;
    this.bright=pass(`uniform sampler2D t;uniform vec2 px;varying vec2 vUv;
void main(){vec3 c=(texture2D(t,vUv+px*vec2(-1.,-1.)).rgb+texture2D(t,vUv+px*vec2(1.,-1.)).rgb+texture2D(t,vUv+px*vec2(-1.,1.)).rgb+texture2D(t,vUv+px*vec2(1.,1.)).rgb)*0.25;
float l=max(max(c.r,c.g),c.b);gl_FragColor=vec4(c*smoothstep(0.9,1.7,l),1.);}`,{t:{value:null},px:{value:new THREE.Vector2()}});
    this.blur=pass(`uniform sampler2D t;uniform vec2 dir;varying vec2 vUv;
void main(){vec3 c=texture2D(t,vUv).rgb*0.2270270270;
c+=(texture2D(t,vUv+dir*1.3846153846).rgb+texture2D(t,vUv-dir*1.3846153846).rgb)*0.3162162162;
c+=(texture2D(t,vUv+dir*3.2307692308).rgb+texture2D(t,vUv-dir*3.2307692308).rgb)*0.0702702703;gl_FragColor=vec4(c,1.);}`,{t:{value:null},dir:{value:new THREE.Vector2()}});
    this.copy=pass(`uniform sampler2D t;uniform vec2 px;varying vec2 vUv;void main(){gl_FragColor=vec4((texture2D(t,vUv+px*vec2(-1.,-1.)).rgb+texture2D(t,vUv+px*vec2(1.,-1.)).rgb+texture2D(t,vUv+px*vec2(-1.,1.)).rgb+texture2D(t,vUv+px*vec2(1.,1.)).rgb)*0.25,1.);}`,{t:{value:null},px:{value:new THREE.Vector2()}});
    this.final=pass(`uniform sampler2D tScene,tB1,tB2;uniform float exposure,bloom,vig,time,sat,contrast,useBloom;uniform vec3 lift,gain;uniform vec2 res;varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v){vec3 a=v*(v+0.0245786)-0.000090537;vec3 b=v*(0.983729*v+0.4329510)+0.238081;return a/b;}
vec3 aces(vec3 c){const mat3 I=mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777));
const mat3 O=mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602));
c=I*(c/0.6);c=RRTAndODTFit(c);return clamp(O*c,0.,1.);}
void main(){vec3 c=texture2D(tScene,vUv).rgb;
if(useBloom>0.5)c+=(texture2D(tB1,vUv).rgb*0.55+texture2D(tB2,vUv).rgb*0.85)*bloom;
c=aces(c*exposure);
float l=dot(c,vec3(0.2126,0.7152,0.0722));c=mix(vec3(l),c,sat);c=(c-0.5)*contrast+0.5;c=clamp(c*gain+lift,0.,1.);
c=mix(pow(c,vec3(0.41666))*1.055-0.055,c*12.92,step(c,vec3(0.0031308)));
vec2 q=vUv-0.5;c*=1.-vig*dot(q,q)*1.4;
c+=(fract(sin(dot(vUv*res+time,vec2(12.9898,78.233)))*43758.5453)-0.5)*0.01;
gl_FragColor=vec4(c,1.);}`,{tScene:{value:null},tB1:{value:null},tB2:{value:null},exposure:{value:1},bloom:{value:0.35},vig:{value:0.55},time:{value:0},
      sat:{value:1},contrast:{value:1},useBloom:{value:1},lift:{value:new THREE.Vector3()},gain:{value:new THREE.Vector3(1,1,1)},res:{value:new THREE.Vector2()}});
    this.fxaa=pass(`uniform sampler2D t;uniform vec2 res;varying vec2 vUv;
void main(){vec2 px=1./res;vec3 nw=texture2D(t,vUv+vec2(-1.,-1.)*px).rgb,ne=texture2D(t,vUv+vec2(1.,-1.)*px).rgb,sw=texture2D(t,vUv+vec2(-1.,1.)*px).rgb,se=texture2D(t,vUv+vec2(1.,1.)*px).rgb,m=texture2D(t,vUv).rgb;
vec3 L=vec3(0.299,0.587,0.114);float lnw=dot(nw,L),lne=dot(ne,L),lsw=dot(sw,L),lse=dot(se,L),lm=dot(m,L);
float mn=min(lm,min(min(lnw,lne),min(lsw,lse))),mx=max(lm,max(max(lnw,lne),max(lsw,lse)));
vec2 dir=vec2(-((lnw+lne)-(lsw+lse)),((lnw+lsw)-(lne+lse)));float red=max((lnw+lne+lsw+lse)*0.03125,0.0078125);
float rcp=1./(min(abs(dir.x),abs(dir.y))+red);dir=clamp(dir*rcp,vec2(-8.),vec2(8.))*px;
vec3 A=0.5*(texture2D(t,vUv+dir*(-0.1667)).rgb+texture2D(t,vUv+dir*0.1667).rgb);
vec3 B=A*0.5+0.25*(texture2D(t,vUv+dir*-0.5).rgb+texture2D(t,vUv+dir*0.5).rgb);float lb=dot(B,L);
gl_FragColor=vec4((lb<mn||lb>mx)?A:B,1.);}`,{t:{value:null},res:{value:new THREE.Vector2()}});
    this.ready=true;
  },
  resize(w,h){
    if(!this.ready)return;for(const k of['rt','ldr','b1','b2','b3','b4'])if(this[k]){this[k].dispose();this[k]=null;}
    const q=Q();if(!q.post)return;
    const ty=isWebGL2||renderer.extensions.has('OES_texture_half_float')?THREE.HalfFloatType:THREE.UnsignedByteType;
    const opt={type:ty,format:THREE.RGBAFormat,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true};
    this.rt=(q.msaa&&isWebGL2)?new THREE.WebGLMultisampleRenderTarget(w,h,opt):new THREE.WebGLRenderTarget(w,h,opt);
    if(q.msaa&&isWebGL2)this.rt.samples=q.msaa;
    this.useFxaa=!(q.msaa&&isWebGL2);
    if(this.useFxaa)this.ldr=new THREE.WebGLRenderTarget(w,h,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false});
    const o2={type:ty,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false};
    const w4=Math.max(1,w>>2),h4=Math.max(1,h>>2),w8=Math.max(1,w>>3),h8=Math.max(1,h>>3);
    this.b1=new THREE.WebGLRenderTarget(w4,h4,o2);this.b2=new THREE.WebGLRenderTarget(w4,h4,o2);this.b3=new THREE.WebGLRenderTarget(w8,h8,o2);this.b4=new THREE.WebGLRenderTarget(w8,h8,o2);
    this.w=w;this.h=h;
  },
  run(mat,target){this.quad.material=mat;renderer.setRenderTarget(target);renderer.render(this.qscene,this.cam);},
  render(withVM){
    const q=Q();
    if(!q.post||!this.rt){renderer.setRenderTarget(null);renderer.clear();renderer.render(scene,camera);if(withVM){renderer.clearDepth();renderer.render(vmScene,vmCam);}return;}
    renderer.setRenderTarget(this.rt);renderer.clear();renderer.render(scene,camera);if(withVM){renderer.clearDepth();renderer.render(vmScene,vmCam);}
    const f=this.final.uniforms;
    if(q.bloom){
      this.bright.uniforms.t.value=this.rt.texture;this.bright.uniforms.px.value.set(1/this.w,1/this.h);this.run(this.bright,this.b1);
      const b=this.blur.uniforms;
      b.t.value=this.b1.texture;b.dir.value.set(1.4/this.b1.width,0);this.run(this.blur,this.b2);
      b.t.value=this.b2.texture;b.dir.value.set(0,1.4/this.b1.height);this.run(this.blur,this.b1);
      this.copy.uniforms.t.value=this.b1.texture;this.copy.uniforms.px.value.set(0.5/this.b1.width,0.5/this.b1.height);this.run(this.copy,this.b3);
      b.t.value=this.b3.texture;b.dir.value.set(1.6/this.b3.width,0);this.run(this.blur,this.b4);
      b.t.value=this.b4.texture;b.dir.value.set(0,1.6/this.b3.height);this.run(this.blur,this.b3);
      f.tB1.value=this.b1.texture;f.tB2.value=this.b3.texture;f.useBloom.value=1;
    }else f.useBloom.value=0;
    f.tScene.value=this.rt.texture;f.time.value=NOW%100;f.res.value.set(this.w,this.h);
    if(this.useFxaa){this.run(this.final,this.ldr);this.fxaa.uniforms.t.value=this.ldr.texture;this.fxaa.uniforms.res.value.set(this.w,this.h);this.run(this.fxaa,null);}
    else this.run(this.final,null);
  }
};
// Ambient particles around the camera. A theme picks one or more presets by name.
const WEATHER={
  snow:{n:2600,size:0.09,color:0xffffff,opacity:0.9,fall:1.3,sway:0.35},
  dust:{n:700,size:0.045,color:0xfff0d0,hdr:1.6,opacity:0.5,fall:0.05,sway:0.12},
  rain:{n:2400,streak:0.55,color:0xc8d8ec,opacity:0.32,fall:16,sway:0.6},
  embers:{n:500,size:0.06,color:0xff7a2a,hdr:4,opacity:0.95,fall:-0.7,sway:0.5,add:true},
  ash:{n:900,size:0.07,color:0x8a8580,opacity:0.7,fall:0.35,sway:0.4},
  leaves:{n:260,size:0.16,color:0x6a8a3a,opacity:0.9,fall:0.6,sway:0.9},
  fireflies:{n:220,size:0.08,color:0xd8ff70,hdr:5,opacity:1,fall:0,sway:0.6,add:true,blink:true,low:true},
  spores:{n:600,size:0.05,color:0xe8f0c8,hdr:1.5,opacity:0.55,fall:-0.05,sway:0.25}
};
const Weather={sets:[],type:null,
  set(type){
    for(const w of this.sets){scene.remove(w.obj);w.obj.geometry.dispose();}this.sets=[];this.type=type;if(!type)return;
    for(const name of[].concat(type)){const P=WEATHER[name];if(!P)continue;
      const n=Math.round(P.n*Q().particles);const per=P.streak?2:1;const p=new Float32Array(n*3*per);
      for(let i=0;i<n;i++){const x=rand(-22,22),y=P.low?rand(-1.5,3):rand(-6,16),z=rand(-22,22);
        for(let k=0;k<per;k++){p[(i*per+k)*3]=x;p[(i*per+k)*3+1]=y+k*(P.streak||0);p[(i*per+k)*3+2]=z;}}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));
      const col=lin(P.color).multiplyScalar(P.hdr||1);let obj;
      if(P.streak)obj=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:col,transparent:true,opacity:P.opacity,depthWrite:false}));
      else obj=new THREE.Points(g,new THREE.PointsMaterial({map:TEX.soft,size:P.size,transparent:true,depthWrite:false,opacity:P.opacity,color:col,sizeAttenuation:true,blending:P.add?THREE.AdditiveBlending:THREE.NormalBlending}));
      obj.frustumCulled=false;scene.add(obj);this.sets.push({obj,P,n,per,seed:Math.random()*100});}
  },
  update(dt){
    const c=camera.position;
    for(const w of this.sets){const P=w.P,a=w.obj.geometry.attributes.position.array,t=NOW+w.seed,per=w.per;
      for(let i=0;i<w.n;i++){const o=i*per*3;
        let dx=Math.sin(t*0.6+i)*dt*P.sway,dy=-P.fall*dt*(0.7+(i%7)*0.08),dz=Math.cos(t*0.4+i*1.3)*dt*P.sway*0.6;
        if(P.blink)dy=Math.sin(t*0.9+i*2.1)*dt*0.3;
        const x=a[o]+dx-c.x,y=a[o+1]+dy-c.y,z=a[o+2]+dz-c.z;
        let wx=x<-22?44:x>22?-44:0,wz=z<-22?44:z>22?-44:0,wy=0;
        if(y<(P.low?-2:-6))wy=P.low?4.5:22;else if(y>(P.low?3:16))wy=P.low?-4.5:-22;
        for(let k=0;k<per;k++){const q=o+k*3;a[q]+=dx+wx;a[q+1]+=dy+wy;a[q+2]+=dz+wz;}
      }
      w.obj.geometry.attributes.position.needsUpdate=true;
      if(P.blink)w.obj.material.opacity=0.6+0.4*Math.sin(NOW*3);
    }
  }
};
let waterMesh=null;
function makeWater(rects){
  // one big sheet under the whole map; the ground has holes where the water cells are
  const geo=new THREE.PlaneGeometry(1000,1000,1,1);geo.rotateX(-Math.PI/2);geo.translate(0,-0.7,0);
  const mat=new THREE.ShaderMaterial({uniforms:{time:{value:0},sunDir:{value:new THREE.Vector3()},sunCol:{value:new THREE.Color()},sky:{value:new THREE.Color()},
      horizon:{value:new THREE.Color()},deep:{value:lin(0x0c3a48)},fogCol:{value:new THREE.Color()},fogNear:{value:60},fogFar:{value:300}},
    vertexShader:`varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`uniform float time,fogNear,fogFar;uniform vec3 sunDir,sunCol,sky,horizon,deep,fogCol;varying vec3 vW;${GLSL_NOISE}
void main(){vec2 p=vW.xz;float t=time;
  vec2 g=vec2(cos(p.x*0.35+t*1.1)+cos(p.x*0.21-p.y*0.17+t*0.8)*0.7,cos(p.y*0.31+t*0.9)+sin(p.x*0.13+p.y*0.27-t*0.7)*0.6)*0.12;
  g+=vec2(noise(p*0.9+t*0.4)-0.5,noise(p*0.9-t*0.35+9.)-0.5)*0.35;
  vec3 n=normalize(vec3(-g.x,1.,-g.y));vec3 v=normalize(cameraPosition-vW);
  float fr=0.03+0.97*pow(1.-max(dot(n,v),0.),5.);vec3 r=reflect(-v,n);
  vec3 refl=mix(horizon,sky,clamp(r.y*2.,0.,1.));float sp=pow(max(dot(r,normalize(sunDir)),0.),180.)*8.;
  vec3 col=mix(deep,refl,fr)+sunCol*sp;
  float d=length(cameraPosition-vW);col=mix(col,fogCol,smoothstep(fogNear,fogFar,d)*0.85);
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`});
  if(MAP.theme.waterColor)mat.uniforms.deep.value.copy(lin(MAP.theme.waterColor));
  waterMesh=new THREE.Mesh(geo,mat);mapGroup.add(waterMesh);
  return waterMesh;
}
let hemiMain=null,vmHemi=null,vmSun=null;
function initRenderer(){
  renderer=new THREE.WebGLRenderer({canvas:$('c'),antialias:false,powerPreference:'high-performance',stencil:false});
  isWebGL2=renderer.capabilities.isWebGL2;MAX_ANISO=renderer.capabilities.getMaxAnisotropy();
  renderer.autoClear=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputEncoding=THREE.sRGBEncoding;
  scene=new THREE.Scene();scene.fog=new THREE.Fog(0xdcd5c4,80,260);
  skyMat=makeSkyMaterial();skyMesh=new THREE.Mesh(new THREE.SphereGeometry(600,32,16),skyMat);skyMesh.renderOrder=-1;skyMesh.frustumCulled=false;scene.add(skyMesh);
  camera=new THREE.PerspectiveCamera(60,1,0.1,900);camera.rotation.order='YXZ';
  hemiMain=new THREE.HemisphereLight(0xd8e8ff,0xb59a70,0.7);scene.add(hemiMain);hemi=hemiMain;
  sun=new THREE.DirectionalLight(0xfff0d8,2.4);sun.castShadow=true;scene.add(sun);scene.add(sun.target);
  fxLight=new THREE.PointLight(0xffaa55,0,16,2);scene.add(fxLight);
  vmScene=new THREE.Scene();vmCam=new THREE.PerspectiveCamera(64,1,0.01,20);vmCam.rotation.order='YXZ';
  vmHemi=new THREE.HemisphereLight(0xe0ecff,0x8a7458,0.9);vmScene.add(vmHemi);vmSun=new THREE.DirectionalLight(0xfff0d8,1.6);vmSun.position.set(2,4,1);vmScene.add(vmSun);
  pmrem=new THREE.PMREMGenerator(renderer);
  Post.init();
  window.addEventListener('resize',onResize);applyGraphics();
}
function applyTheme(){
  const TH=MAP.theme,K=TH.sky,u=skyMat.uniforms;
  u.top.value.copy(lin(K.top));u.mid.value.copy(lin(K.mid));u.horizon.value.copy(lin(K.horizon));u.ground.value.copy(lin(K.ground));
  u.sunCol.value.copy(lin(K.sun));u.sunDir.value.set(...K.sunDir).normalize();u.clouds.value=K.clouds;u.stars.value=K.stars||0;u.cloudCol.value.copy(lin(K.cloudColor||0xffffff));
  scene.fog.color.copy(lin(TH.fog));scene.fog.near=TH.fogNear;scene.fog.far=TH.fogFar;
  hemiMain.color.copy(lin(TH.hemiSky));hemiMain.groundColor.copy(lin(TH.hemiGround));hemiMain.intensity=TH.hemiI;
  sun.color.copy(lin(TH.sunColor));sun.intensity=TH.sunI;
  vmHemi.color.copy(lin(TH.hemiSky));vmHemi.groundColor.copy(lin(TH.hemiGround));vmHemi.intensity=TH.hemiI*0.9;vmSun.color.copy(lin(TH.sunColor));vmSun.intensity=TH.sunI*0.55;
  const f=Post.final.uniforms,gr=TH.grade;f.exposure.value=TH.exposure;f.sat.value=gr.sat;f.contrast.value=gr.contrast;f.lift.value.set(...gr.lift);f.gain.value.set(...gr.gain);
  renderer.toneMappingExposure=TH.exposure;
  if(waterMesh){const w=waterMesh.material.uniforms;w.sunDir.value.copy(u.sunDir.value);w.sunCol.value.copy(u.sunCol.value);w.sky.value.copy(u.top.value);w.horizon.value.copy(u.horizon.value);
    w.fogCol.value.copy(scene.fog.color);w.fogNear.value=TH.fogNear;w.fogFar.value=TH.fogFar;}
  // reflections: a small copy of the sky rendered into a prefiltered environment map
  const envScene=new THREE.Scene(),envSphere=new THREE.Mesh(new THREE.SphereGeometry(40,32,16),skyMat);envScene.add(envSphere);
  if(envRT)envRT.dispose();
  // the sun disk is left out of the environment: the map also feeds ambient light and the sun itself is a real light
  const prevTM=renderer.toneMapping,sunC=u.sunCol.value.clone();renderer.toneMapping=THREE.NoToneMapping;skyMat.needsUpdate=true;u.sunCol.value.multiplyScalar(0.04);
  envRT=pmrem.fromScene(envScene,0.04);renderer.toneMapping=prevTM;skyMat.needsUpdate=true;envSphere.geometry.dispose();u.sunCol.value.copy(sunC);
  scene.environment=envRT.texture;vmScene.environment=envRT.texture;
  Weather.set(TH.particles);
}
function applyGraphics(){
  const q=Q();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,q.pr)*S.renderScale);
  renderer.toneMapping=q.post?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled=q.shadow>0;sun.castShadow=q.shadow>0;
  if(q.shadow){sun.shadow.mapSize.set(q.shadow,q.shadow);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}
    const ext=q.follow?q.ext:80;const c=sun.shadow.camera;c.left=-ext;c.right=ext;c.top=ext;c.bottom=-ext;c.near=1;c.far=400;c.updateProjectionMatrix();
    sun.shadow.bias=q.follow?-0.00025:-0.0005;sun.shadow.normalBias=q.follow?0.025:0.05;}
  const mark=o=>{if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.needsUpdate=true);}};
  scene.traverse(mark);vmScene.traverse(mark);
  if(MAP&&Weather.type)Weather.set(Weather.type);
  onResize();
}
function updateSun(){
  const d=skyMat.uniforms.sunDir.value,q=Q();let ctr=V3(0,0,0);
  if(q.follow&&q.shadow){
    // snap the shadow centre to the shadow-map texel grid in light space (snapping in world space makes edges crawl)
    const tex=2*q.ext/q.shadow,f=d.clone().negate(),r=new THREE.Vector3().crossVectors(f,V3(0,1,0)).normalize(),u=new THREE.Vector3().crossVectors(r,f);
    const c=V3(camera.position.x,0,camera.position.z);const a=Math.round(c.dot(r)/tex)*tex,b=Math.round(c.dot(u)/tex)*tex,k=c.dot(f);
    ctr=r.multiplyScalar(a).add(u.multiplyScalar(b)).add(f.multiplyScalar(k));}
  sun.target.position.copy(ctr);sun.position.copy(ctr).addScaledVector(d,200);sun.target.updateMatrixWorld();
  skyMesh.position.copy(camera.position);skyMat.uniforms.time.value=NOW;
  if(waterMesh)waterMesh.material.uniforms.time.value=NOW;
}
function onResize(){
  const w=window.innerWidth,h=window.innerHeight;renderer.setSize(w,h,false);
  camera.aspect=w/h;vmCam.aspect=w/h;vmCam.updateProjectionMatrix();
  const tc=$('tags');tc.width=w;tc.height=h;
  const pr=renderer.getPixelRatio();Post.resize(Math.round(w*pr),Math.round(h*pr));
}

const FX={
  pool:[],tracers:[],decals:[],decalIdx:0,smokes:[],fires:[],
  init(){
    for(let i=0;i<300;i++){const m=new THREE.SpriteMaterial({map:TEX.soft,transparent:true,depthWrite:false,fog:true});const s=new THREE.Sprite(m);s.visible=false;scene.add(s);this.pool.push({s,life:0});}
    for(let i=0;i<30;i++){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,0,0,0],3));
      const lm=new THREE.LineBasicMaterial({transparent:true,opacity:0.8});lm.color.setRGB(3.2,2.5,1.4);const l=new THREE.Line(g,lm);l.visible=false;l.frustumCulled=false;scene.add(l);this.tracers.push({l,life:0});}
    const dg=new THREE.PlaneGeometry(0.13,0.13);
    for(let i=0;i<140;i++){const m=new THREE.Mesh(dg,new THREE.MeshBasicMaterial({map:TEX.hole,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3}));m.visible=false;scene.add(m);this.decals.push(m);}
  },
  spawn(pos,o){
    let p=null;for(const q of this.pool)if(q.life<=0){p=q;break;}if(!p)return;
    p.s.visible=true;p.s.position.copy(pos);p.life=p.max=o.life||0.5;p.vel=(o.vel||V3(0,0,0)).clone();p.s0=o.s0||0.2;p.s1=o.s1||p.s0;
    p.op=o.op===undefined?1:o.op;p.grav=o.grav||0;p.drag=o.drag||0;
    const m=p.s.material;m.color.set(o.color||0xffffff).convertSRGBToLinear();if(o.add)m.color.multiplyScalar(o.hdr||3);m.blending=o.add?THREE.AdditiveBlending:THREE.NormalBlending;m.map=o.tex||TEX.soft;m.opacity=p.op;m.rotation=Math.random()*6;
    p.s.scale.setScalar(p.s0);
  },
  tracer(a,b){const t=this.tracers.find(q=>q.life<=0);if(!t)return;const pa=t.l.geometry.attributes.position;
    pa.setXYZ(0,a.x,a.y,a.z);pa.setXYZ(1,b.x,b.y,b.z);pa.needsUpdate=true;t.l.visible=true;t.life=0.06;},
  decal(p,n){const m=this.decals[this.decalIdx++%this.decals.length];m.visible=true;m.position.set(p.x+n[0]*0.012,p.y+n[1]*0.012,p.z+n[2]*0.012);
    m.lookAt(p.x+n[0],p.y+n[1],p.z+n[2]);m.rotation.z=Math.random()*6;m.scale.setScalar(rand(0.8,1.2));},
  impact(p,n,mat){
    const nv=V3(n[0],n[1],n[2]);
    for(let i=0;i<4;i++)this.spawn(p,{life:rand(0.35,0.7),vel:nv.clone().multiplyScalar(rand(0.8,2)).add(V3(rand(-0.6,0.6),rand(0,0.8),rand(-0.6,0.6))),s0:0.08,s1:rand(0.4,0.7),op:0.55,color:mat==='wood'?0x9a7a50:mat==='metal'?0xcccccc:0xd2bc94,grav:-0.5,drag:2});
    if(mat==='metal')for(let i=0;i<3;i++)this.spawn(p,{life:0.15,vel:nv.clone().multiplyScalar(3).add(V3(rand(-2,2),rand(-1,2),rand(-2,2))),s0:0.05,s1:0.02,color:0xffd080,add:true});
  },
  blood(p,dir){for(let i=0;i<6;i++)this.spawn(p,{life:rand(0.25,0.5),vel:dir.clone().multiplyScalar(rand(1,3)).add(V3(rand(-0.8,0.8),rand(-0.3,1),rand(-0.8,0.8))),s0:0.1,s1:rand(0.25,0.45),op:0.85,color:0x8a0d0d,grav:6,drag:1});},
  explosion(p,big){
    fxLight.position.copy(p);fxLight.position.y+=1;fxLight.intensity=big?8:5;fxLight.distance=big?40:18;
    const n=big?40:22;
    for(let i=0;i<n;i++)this.spawn(p.clone().add(V3(rand(-0.5,0.5),rand(0,0.8),rand(-0.5,0.5))),{life:rand(0.3,0.7),vel:V3(rand(-1,1),rand(0.2,1.2),rand(-1,1)).multiplyScalar(big?9:6),s0:big?1.5:0.8,s1:big?5:2.6,color:pick([0xffc060,0xff8a30,0xffe0a0]),add:true,drag:3});
    for(let i=0;i<n;i++)this.spawn(p.clone().add(V3(0,0.5,0)),{life:rand(1.2,2.6),vel:V3(rand(-1,1),rand(0.3,1.4),rand(-1,1)).multiplyScalar(big?5:3),s0:1,s1:big?7:3.5,op:0.6,color:0x4a4038,tex:TEX.cloud,drag:1.5});
  },
  muzzleWorld(p){fxLight.position.copy(p);fxLight.intensity=Math.max(fxLight.intensity,1.6);fxLight.distance=8;this.spawn(p,{life:0.05,s0:0.35,s1:0.5,color:0xffc070,add:true});},
  update(dt){
    for(const p of this.pool){if(p.life<=0)continue;p.life-=dt;if(p.life<=0){p.s.visible=false;continue;}
      const k=1-p.life/p.max;p.vel.y-=p.grav*dt;if(p.drag)p.vel.multiplyScalar(Math.max(0,1-p.drag*dt));p.s.position.addScaledVector(p.vel,dt);
      p.s.scale.setScalar(lerp(p.s0,p.s1,k));p.s.material.opacity=p.op*(1-k*k);}
    for(const t of this.tracers){if(t.life>0){t.life-=dt;if(t.life<=0)t.l.visible=false;}}
    fxLight.intensity=Math.max(0,fxLight.intensity-dt*30);
    // smokes
    for(let i=this.smokes.length-1;i>=0;i--){const s=this.smokes[i];s.t+=dt;
      const grow=clamp(s.t/1.3,0,1),fade=clamp((s.life-s.t)/2,0,1);s.r=3.9*Math.sqrt(grow)*(0.4+0.6*fade);
      s.mat.opacity=0.97*fade;
      for(const sp of s.sprites){sp.position.lerpVectors(s.pos,sp.userData.target,0.15+0.85*grow);sp.scale.setScalar(sp.userData.size*(0.3+0.7*grow));sp.material.rotation+=dt*0.03*sp.userData.spin;}
      if(s.t>=s.life){for(const sp of s.sprites)scene.remove(sp);this.smokes.splice(i,1);}}
    // fires
    for(let i=this.fires.length-1;i>=0;i--){const f=this.fires[i];f.t+=dt;
      if(this.smokes.some(s=>s.r>1&&s.pos.distanceTo(f.pos)<s.r+1)){f.t=Math.max(f.t,f.life-0.4);}
      const fade=clamp((f.life-f.t)/0.6,0,1);
      for(const sp of f.sprites){const u=sp.userData;u.ph+=dt*u.sp;sp.scale.set(u.size*(0.8+0.25*Math.sin(u.ph)),u.size*1.4*(0.8+0.3*Math.sin(u.ph*1.3)),1);
        sp.position.y=f.pos.y+u.size*0.6+0.1*Math.sin(u.ph*0.7);sp.material.opacity=fade*0.9;}
      if(Math.random()<dt*14)this.spawn(f.pos.clone().add(V3(rand(-2.5,2.5),0.3,rand(-2.5,2.5))),{life:rand(0.8,1.5),vel:V3(0,rand(1,2.5),0),s0:0.5,s1:2,op:0.35,color:0x2a2420,tex:TEX.cloud});
      fxLight.position.copy(f.pos);fxLight.position.y+=1.2;fxLight.distance=14;fxLight.intensity=Math.max(fxLight.intensity,2.2*fade*(0.8+0.2*Math.random()));
      if(f.t>=f.life){for(const sp of f.sprites)scene.remove(sp);scene.remove(f.scorch);this.fires.splice(i,1);}}
  },
  addSmoke(pos){
    const mat=new THREE.SpriteMaterial({map:TEX.cloud,color:0xa9a7a2,transparent:true,depthWrite:false,opacity:0.97});
    const sprites=[];
    for(let i=0;i<30;i++){const sp=new THREE.Sprite(mat.clone());const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*3.2;
      sp.userData={target:V3(pos.x+Math.cos(a)*r,pos.y+rand(0.6,3.2),pos.z+Math.sin(a)*r),size:rand(3.6,5.2),spin:rand(-1,1)};
      sp.material.color.setScalar(rand(0.3,0.4));sp.position.copy(pos);scene.add(sp);sprites.push(sp);}
    const s={pos:pos.clone(),t:0,life:18,r:0,sprites,mat:{set opacity(v){for(const sp of sprites)sp.material.opacity=v;}}};
    this.smokes.push(s);SFX.smokePop(pos);
  },
  addFire(pos,owner,wid){
    const sprites=[];
    for(let i=0;i<18;i++){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:TEX.soft,color:lin(pick([0xff9a30,0xffc050,0xff6a20])).multiplyScalar(2.5),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
      const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*2.9;sp.position.set(pos.x+Math.cos(a)*r,pos.y+0.5,pos.z+Math.sin(a)*r);
      sp.userData={size:rand(0.8,1.5),ph:Math.random()*6,sp:rand(6,11)};scene.add(sp);sprites.push(sp);}
    const scorch=new THREE.Mesh(new THREE.PlaneGeometry(7,7),new THREE.MeshBasicMaterial({map:TEX.scorch,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4}));
    scorch.rotation.x=-Math.PI/2;scorch.position.set(pos.x,pos.y+0.03,pos.z);scene.add(scorch);
    this.fires.push({pos:pos.clone(),t:0,life:7,r:3.1,owner,wid,sprites,scorch,tick:0});SFX.fire(pos,7);
  },
  smokeBlocks(a,b){
    for(const s of this.smokes){if(s.r<1)continue;const c=V3(s.pos.x,s.pos.y+1.6,s.pos.z);
      const ab=b.clone().sub(a),L2=ab.lengthSq();const t=clamp(c.clone().sub(a).dot(ab)/L2,0,1);
      if(a.clone().addScaledVector(ab,t).distanceTo(c)<s.r*0.95)return true;}
    return false;
  },
  clear(){for(const s of this.smokes)for(const sp of s.sprites)scene.remove(sp);for(const f of this.fires){for(const sp of f.sprites)scene.remove(sp);scene.remove(f.scorch);}
    this.smokes=[];this.fires=[];for(const p of this.pool){p.life=0;p.s.visible=false;}for(const d of this.decals)d.visible=false;}
};

/* =====================================================================
   Agents (the player and the bots share one body + weapon model)
   ===================================================================== */
const GRAV=20.3,JUMP_V=7.0,R_AG=0.4,STAND_H=1.8,CROUCH_H=1.25;
class Agent{
  constructor(name,squad,isPlayer){
    this.name=name;this.squad=squad;this.isPlayer=!!isPlayer;this.team='S';
    this.pos=V3(0,0,0);this.vel=V3(0,0,0);this.yaw=0;this.pitch=0;
    this.input={f:0,b:0,l:0,r:0,walk:false,crouch:false,jump:false,fire:false,fire2:false,use:false};
    this.prevFire2=false;this.stats={k:0,d:0,a:0,dmg:0,mvp:0};this.ping=isPlayer?randi(9,22):randi(12,70);
    this.money=800;this.resetLoadout();this.bot=null;this.model=null;this.agentId=null;this.botSkins={};this.knifeSkin=null;
  }
  // the finish this agent wants on a weapon it buys (player: equipped in the loadout, bots: rolled per match)
  skinPref(id){return this.isPlayer?Profile.skinFor(this.team,id):this.botSkins[id]||null;}
  resetLoadout(){this.primary=null;this.secondary=null;this.nades=[];this.hasBomb=false;this.armor=0;this.helmet=false;this.kit=false;this.slot=2;this.lastSlot=3;}
  get height(){return this.crouch?CROUCH_H:STAND_H;}
  get eyeY(){return this.pos.y+lerp(1.64,1.08,this.crouchAmt);}
  eye(out){return(out||V3()).set(this.pos.x,this.eyeY,this.pos.z);}
  curId(){switch(this.slot){case 1:return this.primary?this.primary.id:'knife';case 2:return this.secondary?this.secondary.id:'knife';
    case 4:return this.nades[this.nadeIdx]||'knife';case 5:return this.hasBomb?'bomb':'knife';default:return 'knife';}}
  curInst(){return this.slot===1?this.primary:this.slot===2?this.secondary:null;}
  hasSlot(s){return s===3||(s===1&&!!this.primary)||(s===2&&!!this.secondary)||(s===4&&this.nades.length>0)||(s===5&&this.hasBomb);}
  spawnAt(p,yaw){
    this.pos.copy(p);this.vel.set(0,0,0);this.yaw=yaw;this.pitch=0;this.alive=true;this.hp=100;this.crouch=false;this.crouchAmt=0;this.onGround=true;
    this.nextFire=0;this.reloadEnd=0;this.drawEnd=0;this.recoilIdx=0;this.lastFire=-9;this.triggerLatched=false;this.scope=0;this.throwHold=0;
    this.blindUntil=0;this.blindAmt=0;this.dmgFrom=new Map();this.plantProg=0;this.defuseProg=0;this.stepDist=0;this.vPunch=[0,0];this.hurtPunch=0;
    this.spottedUntil=0;this.jumpReady=true;this.nadeIdx=0;this.deathT=0;this.lastAttacker=null;this.fireDmgT=0;
    if(this.slot!==3&&!this.hasSlot(this.slot))this.slot=this.primary?1:2;if(!this.hasSlot(this.slot))this.slot=3;
    this.drawEnd=0;
    if(this.model){this.model.visible=!this.isPlayer;this.model.rotation.set(0,yaw,0);this.model.position.copy(p);}
  }
}
function knifeModelOf(a,id){return id==='knife'?a.knifeModel||null:null;}
function skinOf(a,id){if(id==='knife')return a.knifeSkin||null;const i=a.primary&&a.primary.id===id?a.primary:a.secondary&&a.secondary.id===id?a.secondary:null;return i&&i.skin||null;}
function weaponSpeed(a){const w=WEP[a.curId()];let s=w.speed||6;if(w.cls==='sniper'&&a.scope)s*=0.6;return s;}
function agentList(){return G.agents;}

function groundBelow(a,yMax){
  let g=0;const R=R_AG-0.02;
  for(const b of World.query(a.pos.x-R,a.pos.z-R,a.pos.x+R,a.pos.z+R)){
    if(a.pos.x+R<=b.x0||a.pos.x-R>=b.x1||a.pos.z+R<=b.z0||a.pos.z-R>=b.z1)continue;
    if(b.y1<=yMax+0.001&&b.y1>g)g=b.y1;}
  return g;
}
function ceilingAbove(a,head){
  let c=Infinity;const R=R_AG-0.02;
  for(const b of World.query(a.pos.x-R,a.pos.z-R,a.pos.x+R,a.pos.z+R)){
    if(a.pos.x+R<=b.x0||a.pos.x-R>=b.x1||a.pos.z+R<=b.z0||a.pos.z-R>=b.z1)continue;
    if(b.y0>=head-0.05&&b.y0<c)c=b.y0;}
  return c;
}
function blockedAt(a,y,H){
  const R=R_AG;
  for(const b of World.query(a.pos.x-R,a.pos.z-R,a.pos.x+R,a.pos.z+R)){
    if(a.pos.x+R<=b.x0||a.pos.x-R>=b.x1||a.pos.z+R<=b.z0||a.pos.z-R>=b.z1)continue;
    if(b.y1>y+0.01&&b.y0<y+H)return true;}
  return false;
}
function moveAxis(a,ax,d){
  if(!d)return;a.pos[ax]+=d;const R=R_AG;const H=a.height;
  const list=World.query(a.pos.x-R,a.pos.z-R,a.pos.x+R,a.pos.z+R).slice();
  for(const b of list){
    if(a.pos.x+R<=b.x0||a.pos.x-R>=b.x1||a.pos.z+R<=b.z0||a.pos.z-R>=b.z1)continue;
    if(b.y1<=a.pos.y+0.01||b.y0>=a.pos.y+H)continue;
    const step=b.y1-a.pos.y;
    if(step<=0.56&&(a.onGround||a.vel.y<=0.5)&&!blockedAt(a,b.y1,H)){a.pos.y=b.y1;a.onGround=true;if(a.vel.y<0)a.vel.y=0;continue;}
    if(ax==='x'){const pl=a.pos.x+R-b.x0,pr=b.x1-(a.pos.x-R);a.pos.x+=pl<pr?-pl-1e-4:pr+1e-4;a.vel.x=0;}
    else{const pl=a.pos.z+R-b.z0,pr=b.z1-(a.pos.z-R);a.pos.z+=pl<pr?-pl-1e-4:pr+1e-4;a.vel.z=0;}
  }
}
function physics(a,dt){
  const inp=a.input;
  const frozen=G.phase==='freeze'||a.plantProg>0||a.defuseProg>0;
  // crouch, including the crouch-jump tuck
  const wantC=inp.crouch||a.plantProg>0||a.defuseProg>0;
  if(wantC&&!a.crouch){a.crouch=true;if(!a.onGround&&!blockedAt(a,a.pos.y+0.5,CROUCH_H))a.pos.y+=0.5;}
  else if(!wantC&&a.crouch){
    if(a.onGround){if(!blockedAt(a,a.pos.y,STAND_H))a.crouch=false;}
    else{const g=groundBelow(a,a.pos.y);const ny=Math.max(g,a.pos.y-0.5);if(!blockedAt(a,ny,STAND_H)){a.pos.y=ny;a.crouch=false;}}
  }
  a.crouchAmt=clamp(a.crouchAmt+(a.crouch?1:-1)*dt*7,0,1);
  const sy=Math.sin(a.yaw),cy=Math.cos(a.yaw);
  let mx=(inp.f?1:0)-(inp.b?1:0),my=(inp.r?1:0)-(inp.l?1:0);
  let wx=-sy*mx+cy*my,wz=-cy*mx-sy*my;const wl=Math.hypot(wx,wz);if(wl>0){wx/=wl;wz/=wl;}
  if(frozen){wx=wz=0;}
  const maxS=weaponSpeed(a)*(a.crouch?0.34:inp.walk?0.52:1);
  if(a.onGround){
    if(inp.jump&&a.jumpReady&&!frozen&&!blockedAt(a,a.pos.y+0.3,a.height)){a.vel.y=JUMP_V;a.onGround=false;a.jumpReady=false;}
    const sp=Math.hypot(a.vel.x,a.vel.z);
    if(sp>0){const drop=Math.max(sp,2.0)*5.2*dt;const ns=Math.max(0,sp-drop)/sp;a.vel.x*=ns;a.vel.z*=ns;}
    if(wl>0){const cur=a.vel.x*wx+a.vel.z*wz,add=maxS-cur;if(add>0){const acc=Math.min(5.5*dt*maxS,add);a.vel.x+=acc*wx;a.vel.z+=acc*wz;}}
  }else if(wl>0){
    const ws=Math.min(maxS,0.76);const cur=a.vel.x*wx+a.vel.z*wz,add=ws-cur;if(add>0){const acc=Math.min(12*dt*maxS,add);a.vel.x+=acc*wx;a.vel.z+=acc*wz;}
  }
  if(!inp.jump)a.jumpReady=true;
  moveAxis(a,'x',a.vel.x*dt);moveAxis(a,'z',a.vel.z*dt);
  if(a.onGround){
    const g=groundBelow(a,a.pos.y+0.01);
    if(a.pos.y-g<=0.6&&a.vel.y<=0){a.pos.y=g;a.vel.y=0;}else a.onGround=false;
  }
  if(!a.onGround){
    const oldY=a.pos.y;a.vel.y-=GRAV*dt;a.pos.y+=a.vel.y*dt;
    if(a.vel.y<=0){const g=groundBelow(a,oldY+0.01);
      if(a.pos.y<=g){const impact=-a.vel.y;a.pos.y=g;a.vel.y=0;a.onGround=true;
        if(impact>4){SFX.land(a.pos,a===viewTarget());Noise.emit(a,a.pos,16);}
        if(impact>12.5)applyDamage(a,null,(impact-12.5)*9,'legs','world',{});}}
    else{const c=ceilingAbove(a,oldY+a.height);if(a.pos.y+a.height>c){a.pos.y=c-a.height;a.vel.y=0;}}
  }
  // footsteps (silent when walking or crouched)
  const hs=Math.hypot(a.vel.x,a.vel.z);
  if(a.onGround&&hs>3.0&&!frozen){a.stepDist+=hs*dt;if(a.stepDist>2.2){a.stepDist=0;SFX.step(a.pos,a===viewTarget());Noise.emit(a,a.pos,22);}}
}
function separateAgents(){
  const L=G.agents;
  for(let i=0;i<L.length;i++){const a=L[i];if(!a.alive)continue;
    for(let j=i+1;j<L.length;j++){const b=L[j];if(!b.alive)continue;
      const dx=b.pos.x-a.pos.x,dz=b.pos.z-a.pos.z,d=Math.hypot(dx,dz);
      if(d<0.75&&d>1e-4&&Math.abs(a.pos.y-b.pos.y)<1.6){const push=(0.75-d)/2,nx=dx/d,nz=dz/d;
        a.pos.x-=nx*push;a.pos.z-=nz*push;b.pos.x+=nx*push;b.pos.z+=nz*push;
        moveAxis(a,'x',0.0001);moveAxis(b,'x',0.0001);}}}
}

const Noise={emit(src,pos,radius){for(const b of G.agents){if(!b.bot||!b.alive||b.team===src.team)continue;
  const d=b.pos.distanceTo(pos);if(d<radius*(b.bot.diff.hear)){b.bot.heard={pos:pos.clone(),t:NOW,src};}}}};

/* ------------------------------- shooting ------------------------------- */
function patternAt(w,idx){const p=w.pattern;const i=Math.min(Math.floor(idx),p.length-2),f=Math.min(1,idx-i);return[lerp(p[i][0],p[i+1][0],f),lerp(p[i][1],p[i+1][1],f)];}
function inaccuracy(a,w){
  if(!w.inacc)return 0;const I=w.inacc;
  let base=a.crouch?I.crouch:I.stand;if(w.cls==='sniper'&&a.scope)base=I.scoped;
  const sp=Math.hypot(a.vel.x,a.vel.z)/(w.speed||6);
  const move=I.move*clamp((sp-0.3)/0.6,0,1);
  const jump=a.onGround?0:I.jump;
  const shot=Math.min(I.max,a.recoilIdx*I.shot);
  return base+move+jump+shot;
}
const _ro=V3(),_rd=V3();
function hitAgents(shooter,o,d,maxT){
  const res=[];const tmp={t:0,t2:0,ax:0};const ix=1/(d.x||1e-9),iy=1/(d.y||1e-9),iz=1/(d.z||1e-9);
  for(const b of G.agents){
    if(b===shooter||!b.alive)continue;
    const h=STAND_H-0.55*b.crouchAmt;
    // head sphere
    const hc=V3(b.pos.x-Math.sin(b.yaw)*0.03,b.pos.y+h-0.14,b.pos.z-Math.cos(b.yaw)*0.03);
    const oc=o.clone().sub(hc);const bq=oc.dot(d),cq=oc.lengthSq()-0.16*0.16,disc=bq*bq-cq;
    let best=null;
    if(disc>=0){const t=-bq-Math.sqrt(disc);if(t>0&&t<maxT)best={t,agent:b,zone:'head'};}
    const box={x0:b.pos.x-0.24,x1:b.pos.x+0.24,y0:b.pos.y,y1:b.pos.y+h-0.28,z0:b.pos.z-0.24,z1:b.pos.z+0.24};
    if(World.rayBox(o.x,o.y,o.z,ix,iy,iz,box,maxT,tmp)&&tmp.t>0&&(!best||tmp.t<best.t)){
      const y=o.y+d.y*tmp.t;best={t:tmp.t,agent:b,zone:y<b.pos.y+0.82*(h/STAND_H)?'legs':'body'};}
    if(best)res.push(best);
  }
  return res;
}
function traceBullet(a,w,o,d,dmgScale){
  const maxT=180;
  const hits=World.rayHits(o,d,maxT).concat(hitAgents(a,o,d,maxT)).sort((p,q)=>p.t-q.t);
  let dmg=w.dmg*(dmgScale||1),power=w.pen,wall=false,end=maxT;
  for(const h of hits){
    if(h.agent){
      if(h.agent.team===a.team)continue;
      const dist=h.t;const mult=h.zone==='head'?4:h.zone==='legs'?0.75:1;
      const dd=dmg*Math.pow(w.fall,dist/12.7)*mult;
      const hp=o.clone().addScaledVector(d,dist);FX.blood(hp,d);
      applyDamage(h.agent,a,dd,h.zone,w.id,{wb:wall,dir:d});end=dist;break;
    }
    const p=o.clone().addScaledVector(d,h.t);
    FX.decal(p,h.n);FX.impact(p,h.n,h.b?h.b.mat:'stone');if(Math.random()<0.3)SFX.impact(p,h.b&&h.b.mat==='metal');
    if(h.b&&h.b.pen>0&&power>0){const thick=(h.t2-h.t)*h.b.pen;
      if(thick<power){power-=thick;dmg*=0.78*(1-thick/(w.pen*2.2));wall=true;const ep=o.clone().addScaledVector(d,h.t2);FX.decal(ep,[-h.n[0],-h.n[1],-h.n[2]]);continue;}}
    end=h.t;break;
  }
  return end;
}
function fireGun(a,w,inst){
  inst.mag--;a.nextFire=NOW+w.rof;a.lastFire=NOW;
  const pat=patternAt(w,a.recoilIdx);a.recoilIdx=Math.min(a.recoilIdx+1,w.pattern.length-2);
  const comp=a.bot?a.bot.diff.recoilComp:0;
  const spread=inaccuracy(a,w)+(a.bot?a.bot.aimJitter:0);
  const o=a.eye();const pellets=w.pellets||1;let end=0;
  for(let i=0;i<pellets;i++){
    const ang=Math.random()*Math.PI*2;const r=(w.pellets?w.cone*Math.sqrt(Math.random())+spread*0.3*Math.random():spread*Math.random())*DEG;
    const yaw=a.yaw-pat[0]*DEG*(1-comp)+Math.cos(ang)*r,pitch=a.pitch+pat[1]*DEG*(1-comp)+Math.sin(ang)*r;
    const d=dirFromAngles(yaw,pitch);end=traceBullet(a,w,o,d);
    if(i===0||Math.random()<0.3){const s=o.clone().addScaledVector(d,1.2);s.y-=0.12;FX.tracer(s,o.clone().addScaledVector(d,Math.min(end,90)));}
  }
  const local=a===viewTarget();SFX.gun(w.snd,a.pos,local);
  Noise.emit(a,a.pos,w.snd==='pistol'?45:60);
  const mz=o.clone().addScaledVector(dirFromAngles(a.yaw,a.pitch),0.9);if(!local)FX.muzzleWorld(mz);
  if(local)VM.kick(w);
  if(w.cls==='sniper'){a.wasScoped=a.scope;a.scope=0;a.rescopeAt=a.wasScoped?NOW+w.rof:0;}
  a.spottedUntil=Math.max(a.spottedUntil,NOW+0.8);
}
function startReload(a){
  const inst=a.curInst();if(!inst)return;const w=WEP[inst.id];
  if(a.reloadEnd||inst.mag>=w.mag||inst.res<=0)return;
  a.reloadEnd=NOW+(w.shells?0.55:w.reload);a.scope=0;
  if(a===viewTarget()){VM.reload(w);SFX.reload(true,a.pos,0);}else SFX.reload(false,a.pos,0);
}
function knifeAttack(a,heavy){
  a.nextFire=NOW+(heavy?1.1:0.45);const o=a.eye(),d=dirFromAngles(a.yaw,a.pitch);
  SFX.knife(a.pos,a===viewTarget());if(a===viewTarget())VM.slash(heavy);
  const wallHit=World.rayFirst(o,d,1.8);
  let best=null;
  for(const b of G.agents){if(b===a||!b.alive||b.team===a.team)continue;
    const c=V3(b.pos.x,b.pos.y+1.1-0.4*b.crouchAmt,b.pos.z);const to=c.clone().sub(o);const dist=to.length();
    if(dist>1.9)continue;to.normalize();if(to.dot(d)<0.82)continue;if(wallHit&&wallHit.t<dist-0.3)continue;
    if(!best||dist<best.d)best={b,d:dist};}
  if(best){const b=best.b;const fwd=V3(-Math.sin(b.yaw),0,-Math.cos(b.yaw));const back=fwd.dot(V3(d.x,0,d.z).normalize())>0.5;
    const dmg=heavy?(back?180:65):(back?90:40);SFX.knifeHit(b.pos);FX.blood(V3(b.pos.x,b.pos.y+1.2,b.pos.z),d);
    applyDamage(b,a,dmg,'body','knife',{dir:d,knife:true});}
  else if(wallHit){const p=o.clone().addScaledVector(d,wallHit.t);FX.impact(p,wallHit.n,wallHit.b?wallHit.b.mat:'stone');SFX.impact(p,false);}
}
function switchSlot(a,s){
  if(!a.hasSlot(s))return false;
  if(s===4&&a.slot===4&&a.nades.length>1){a.nadeIdx=(a.nadeIdx+1)%a.nades.length;}
  else if(s===a.slot)return false;
  else{a.lastSlot=a.slot;a.slot=s;if(s===4)a.nadeIdx=Math.min(a.nadeIdx,a.nades.length-1);}
  a.reloadEnd=0;a.scope=0;a.throwHold=0;a.plantProg=0;a.drawEnd=NOW+(WEP[a.curId()].cls==='knife'?0.4:WEP[a.curId()].cls==='nade'?0.5:0.75);a.recoilIdx=0;
  if(a===viewTarget()){VM.setWeapon(a);SFX.swap();}
  return true;
}
function weaponLogic(a,dt){
  const id=a.curId(),w=WEP[id],inst=a.curInst(),inp=a.input;
  if(a.rescopeAt&&NOW>=a.rescopeAt){a.rescopeAt=0;if(w.cls==='sniper'&&a.wasScoped&&!a.reloadEnd)a.scope=a.wasScoped;}
  if(a.reloadEnd&&NOW>=a.reloadEnd){
    if(inst){const wi=WEP[inst.id];
      if(wi.shells){if(inst.res>0&&inst.mag<wi.mag){inst.mag++;inst.res--;if(a===viewTarget())SFX.shell();}
        a.reloadEnd=(inst.mag<wi.mag&&inst.res>0)?NOW+0.5:0;}
      else{const need=wi.mag-inst.mag,take=Math.min(need,inst.res);inst.mag+=take;inst.res-=take;a.reloadEnd=0;if(a===viewTarget())SFX.reload(true,a.pos,2);}}
    else a.reloadEnd=0;
  }
  if(w.recoil&&NOW-a.lastFire>w.rof*1.25)a.recoilIdx=Math.max(0,a.recoilIdx-w.recoil.rec*dt);
  const tgt=w.pattern?patternAt(w,a.recoilIdx):[0,0];
  a.vPunch[0]=lerp(a.vPunch[0],tgt[0]*0.5,Math.min(1,dt*18));a.vPunch[1]=lerp(a.vPunch[1],tgt[1]*0.5,Math.min(1,dt*18));
  a.hurtPunch=Math.max(0,a.hurtPunch-dt*12);
  if(G.phase==='freeze'||NOW<a.drawEnd){a.prevFire2=inp.fire2;if(!inp.fire)a.triggerLatched=false;return;}
  const f2edge=inp.fire2&&!a.prevFire2;a.prevFire2=inp.fire2;
  if(w.cls==='nade'){
    if((inp.fire||inp.fire2)&&!a.throwHold&&NOW>=a.nextFire){a.throwHold=inp.fire?(inp.fire2?2:1):3;if(a===viewTarget())SFX.pin();}
    else if(a.throwHold&&!inp.fire&&!inp.fire2){throwNade(a,id,a.throwHold);a.throwHold=0;}
    return;
  }
  if(w.cls==='bomb'){
    if(inp.fire)tryPlant(a,dt);else if(!inp.use)a.plantProg=0;
    return;
  }
  if(w.cls==='knife'){
    if(NOW>=a.nextFire){if(inp.fire)knifeAttack(a,false);else if(inp.fire2)knifeAttack(a,true);}
    return;
  }
  if(w.cls==='sniper'&&f2edge&&!a.reloadEnd){a.scope=(a.scope+1)%3;if(a===viewTarget())SFX.ui();}
  if(inp.fire){
    if(!inst)return;
    if(inst.mag<=0){if(!a.triggerLatched){a.triggerLatched=true;if(a===viewTarget())SFX.dryfire();startReload(a);}return;}
    if(a.reloadEnd){if(w.shells&&inst.mag>0)a.reloadEnd=0;else return;}
    if(NOW>=a.nextFire&&(w.auto||!a.triggerLatched)){fireGun(a,w,inst);a.triggerLatched=true;if(inst.mag<=0&&!a.isPlayer)startReload(a);}
  }else a.triggerLatched=false;
}

/* ------------------------------- damage ------------------------------- */
function applyDamage(v,att,dmg,zone,wid,o){
  if(!v.alive||G.phase==='over')return;
  const w=WEP[wid];const ap=w&&w.ap?w.ap:0.5;let hp=dmg;
  if(v.armor>0&&zone!=='legs'&&(zone!=='head'||v.helmet)&&wid!=='world'&&wid!=='fire'){
    hp=dmg*ap;let ad=(dmg-hp)*0.5;if(ad>v.armor){hp+=(ad-v.armor)*2;ad=v.armor;}v.armor=Math.max(0,Math.round(v.armor-ad));
  }
  hp=Math.max(1,Math.round(hp));const before=v.hp;v.hp=Math.max(0,v.hp-hp);const dealt=before-v.hp;
  if(att&&att!==v&&att.team!==v.team){att.stats.dmg+=dealt;v.dmgFrom.set(att,(v.dmgFrom.get(att)||0)+dealt);v.lastAttacker=att;
    if(att===G.player)HUD.hitMarker(zone==='head');}
  if(v.armor<=0&&zone!=='legs'&&wid!=='fire')v.hurtPunch=Math.min(3,v.hurtPunch+dealt*0.06);
  if(v===G.player||v===viewTarget()){if(att&&att!==v)HUD.damageFrom(att.pos);HUD.hurt(dealt);if(v===G.player)SFX.hurt();}
  if(v.bot&&att&&att!==v)v.bot.onHurt(att);
  if(v.plantProg>0)v.plantProg=0;
  if(v.hp<=0)killAgent(v,att,wid,zone==='head',o&&o.wb);
}
function killAgent(v,k,wid,hs,wb){
  v.alive=false;v.hp=0;v.deathT=NOW;v.stats.d++;v.plantProg=0;v.defuseProg=0;v.scope=0;
  if(k&&k!==v&&k.team!==v.team){k.stats.k++;G.roundKills.set(k,(G.roundKills.get(k)||0)+1);
    const rew=WEP[wid]&&WEP[wid].reward!==undefined?WEP[wid].reward:300;addMoney(k,rew,'Kill with '+(WEP[wid]?WEP[wid].name:wid));}
  for(const[a,d]of v.dmgFrom)if(a!==k&&a.team!==v.team&&d>=41)a.stats.a++;
  HUD.kill(k,v,wid,hs,wb);
  // drop the best gun, the bomb and the defuse kit
  const best=v.primary||v.secondary;if(best)dropItem(v,best,true);
  if(v.primary&&best===v.primary)v.primary=null;else if(best===v.secondary)v.secondary=null;
  if(v.hasBomb){v.hasBomb=false;dropBomb(v);}
  if(v.model){v.model.userData.dying=0;}
  if(v===G.player)Spectate.onPlayerDeath(k);
  for(const b of G.agents)if(b.bot&&b.alive&&b.team===v.team&&k&&k!==v)b.bot.callout(k.pos);
}
function addMoney(a,amt,why){const before=a.money;a.money=clamp(a.money+amt,0,16000);if(a===G.player&&a.money!==before)HUD.moneyDelta(a.money-before,why);}

/* ------------------------------- grenades ------------------------------- */
const nades=[];let nadeMeshCache={};
function throwNade(a,id,mode){
  const idx=a.nades.indexOf(id);if(idx<0)return;a.nades.splice(idx,1);
  const strong=mode===1?1:mode===2?0.62:0.3;
  let pitch=a.pitch;pitch=pitch+(10*DEG)*(1-Math.abs(pitch)/(Math.PI/2));
  const d=dirFromAngles(a.yaw,pitch);const speed=18*strong+2;
  const o=a.eye().addScaledVector(d,0.35);o.y-=0.1;
  launchNade(a,id,o,d.multiplyScalar(speed).addScaledVector(a.vel,1.0));
  a.nextFire=NOW+0.4;
  if(a.nades.length){a.nadeIdx=Math.min(a.nadeIdx,a.nades.length-1);a.drawEnd=NOW+0.5;if(a===viewTarget())VM.setWeapon(a);}
  else{const s=a.lastSlot!==4&&a.hasSlot(a.lastSlot)?a.lastSlot:a.primary?1:a.secondary?2:3;a.slot=4;switchSlot(a,s);}
}
function launchNade(a,id,o,vel){
  const m=buildGun(id,a.team).group;m.scale.setScalar(1.3);m.position.copy(o);scene.add(m);
  nades.push({id,owner:a,team:a.team,pos:o.clone(),vel:vel.clone(),t:0,mesh:m,still:0,done:false,spin:V3(rand(-8,8),rand(-8,8),rand(-8,8))});
  SFX.throwN(a.pos,a===viewTarget());
}
function updateNades(dt){
  for(let i=nades.length-1;i>=0;i--){const n=nades[i];n.t+=dt;
    const steps=Math.ceil(n.vel.length()*dt/0.12)+1,h=dt/steps;let bounced=false,landed=false;
    for(let s=0;s<steps&&n.still<0.25;s++){
      n.vel.y-=GRAV*0.9*h;
      for(const ax of['x','z','y']){const old=n.pos[ax];n.pos[ax]+=n.vel[ax]*h;
        if(World.pointSolid(n.pos.x,n.pos.y,n.pos.z)||n.pos.y<0.04){n.pos[ax]=old;
          if(ax==='y'&&n.vel.y<0){if(n.vel.y<-2)bounced=true;landed=true;n.vel.y*=-0.35;n.vel.x*=0.6;n.vel.z*=0.6;}
          else{if(Math.abs(n.vel[ax])>2)bounced=true;n.vel[ax]*=-0.45;const o=ax==='y'?['x','z']:ax==='x'?['y','z']:['x','y'];n.vel[o[0]]*=0.85;n.vel[o[1]]*=0.85;}}}
      if(n.pos.y<0.04)n.pos.y=0.04;
    }
    if(bounced)SFX.bounce(n.pos);
    if(landed&&Math.abs(n.vel.y)<0.6&&Math.hypot(n.vel.x,n.vel.z)<0.4){n.still+=dt;n.vel.set(0,0,0);}
    n.mesh.position.copy(n.pos);if(n.still<=0){n.mesh.rotation.x+=n.spin.x*dt;n.mesh.rotation.y+=n.spin.y*dt;n.mesh.rotation.z+=n.spin.z*dt;}
    let det=false;
    if(n.id==='he'||n.id==='flash')det=n.t>=1.6;
    else if(n.id==='smoke')det=(n.still>0.15&&n.t>1)||n.t>4;
    else if(n.id==='fire'){if(landed&&n.t>0.05)det=true;else if(n.t>2.2){det=true;n.air=true;}}
    if(det){detonate(n);scene.remove(n.mesh);nades.splice(i,1);}
  }
}
function detonate(n){
  const p=n.pos.clone();
  if(n.id==='he'){
    FX.explosion(p,false);SFX.explode(p,false);Cam.shake(p,0.6);
    for(const b of G.agents){if(!b.alive)continue;const c=V3(b.pos.x,b.pos.y+1,b.pos.z);const d=c.distanceTo(p);if(d>11)continue;
      if(World.segBlocked(p.x,p.y+0.2,p.z,c.x,c.y,c.z))continue;
      if(b.team===n.team&&b!==n.owner)continue;
      const dmg=98*Math.pow(1-d/11,1.5);if(dmg>1)applyDamage(b,n.owner,dmg,'body','he',{});}
    Noise.emit(n.owner,p,60);
  }else if(n.id==='flash'){
    FX.spawn(p,{life:0.15,s0:2,s1:6,color:0xffffff,add:true});fxLight.position.copy(p);fxLight.intensity=12;fxLight.distance=30;SFX.flashPop(p);
    for(const b of G.agents){if(!b.alive)continue;const e=b.eye();const d=e.distanceTo(p);if(d>40)continue;
      if(World.segBlocked(p.x,p.y+0.15,p.z,e.x,e.y,e.z))continue;
      const to=p.clone().sub(e).normalize();const look=dirFromAngles(b.yaw,b.pitch);const dot=look.dot(to);
      let k=dot>0.6?1:dot>0.2?0.65:dot>-0.3?0.35:0.12;k*=clamp(1.15-d/40,0,1);if(k<0.05)continue;
      const dur=4.6*k;if(NOW+dur>b.blindUntil){b.blindUntil=NOW+dur;b.blindAmt=k;b.blindStart=NOW;}
      if(b===viewTarget())SFX.ring(dur,k);
      if(b.bot)b.bot.onFlashed(dur);}
  }else if(n.id==='smoke'){FX.addSmoke(V3(p.x,Math.max(0,p.y-0.1),p.z));}
  else if(n.id==='fire'){
    if(n.air){FX.spawn(p,{life:0.4,s0:0.5,s1:2,color:0xff8a30,add:true});SFX.fire(p,0.4);return;}
    if(FX.smokes.some(s=>s.r>1&&s.pos.distanceTo(p)<s.r)){FX.spawn(p,{life:0.5,s0:0.5,s1:2.5,color:0x888888});return;}
    const gy=n.pos.y;FX.addFire(V3(p.x,gy-0.04,p.z),n.owner,'fire');
  }
}
function updateFireDamage(dt){
  for(const f of FX.fires){if(f.t>f.life-0.5)continue;
    for(const b of G.agents){if(!b.alive)continue;if(Math.hypot(b.pos.x-f.pos.x,b.pos.z-f.pos.z)>f.r||Math.abs(b.pos.y-f.pos.y)>1.4)continue;
      if(b.team===f.owner.team&&b!==f.owner)continue;
      b.fireDmgT=(b.fireDmgT||0)+dt;if(b.fireDmgT>=0.25){b.fireDmgT=0;applyDamage(b,f.owner,8,'body','fire',{});}}}
}

/* --------------------------- dropped weapons --------------------------- */
const items=[];
function dropItem(a,inst,death){
  const m=buildGun(inst.id,a.team,inst.skin).group;scene.add(m);
  const d=dirFromAngles(a.yaw,0);const p=a.eye().addScaledVector(d,0.5);p.y-=0.3;
  const it={id:inst.id,inst,pos:p,vel:death?V3(rand(-1,1),1,rand(-1,1)):d.clone().multiplyScalar(4).add(V3(0,2,0)),mesh:m,t:0,rest:false,from:a};
  m.rotation.set(0,a.yaw+rand(-0.4,0.4),Math.PI/2);items.push(it);return it;
}
function dropBomb(a){
  const m=buildGun('bomb','S').group;m.scale.setScalar(1.6);scene.add(m);const p=a.eye();p.y-=0.4;
  const it={id:'bomb',pos:p,vel:a.alive?dirFromAngles(a.yaw,0).multiplyScalar(3).add(V3(0,1.5,0)):V3(0,0,0),mesh:m,t:0,rest:false,bomb:true,from:a};
  items.push(it);G.bombItem=it;HUD.chat('The bomb has been dropped.','sys');return it;
}
function updateItems(dt){
  for(const it of items){it.t+=dt;
    if(!it.rest){it.vel.y-=GRAV*dt;const np=it.pos.clone().addScaledVector(it.vel,dt);
      if(World.pointSolid(np.x,it.pos.y,it.pos.z)){it.vel.x*=-0.3;np.x=it.pos.x;}
      if(World.pointSolid(np.x,it.pos.y,np.z)){it.vel.z*=-0.3;np.z=it.pos.z;}
      const ground=World.rayFirst(V3(np.x,it.pos.y+0.05,np.z),V3(0,-1,0),50);const gy=ground?it.pos.y+0.05-ground.t:0;
      if(np.y<=gy+0.05){np.y=gy+0.05;it.rest=true;}it.pos.copy(np);}
    it.mesh.position.copy(it.pos);
  }
  // pickups
  for(const a of G.agents){if(!a.alive)continue;
    for(let i=items.length-1;i>=0;i--){const it=items[i];if(it.t<0.6&&it.from===a)continue;
      const d=Math.hypot(a.pos.x-it.pos.x,a.pos.z-it.pos.z);if(d>1.0||Math.abs(a.pos.y-it.pos.y)>1.6)continue;
      if(it.bomb){if(a.team==='S'){a.hasBomb=true;scene.remove(it.mesh);items.splice(i,1);G.bombItem=null;if(a===G.player){SFX.pickup();HUD.chat('You picked up the bomb.','sys');}}continue;}
      const s=WEP[it.id].slot;if((s===1&&!a.primary)||(s===2&&!a.secondary)){pickupItem(a,it,i);}
    }}
}
function pickupItem(a,it,i){
  const s=WEP[it.id].slot;if(s===1)a.primary=it.inst;else a.secondary=it.inst;scene.remove(it.mesh);items.splice(i,1);
  if(a===G.player){SFX.pickup();if(a.slot===3||a.slot===s||(s===1&&a.slot===2))switchSlot(a,s);else if(a===viewTarget())VM.setWeapon(a);}
  else if(a.bot&&s===1&&a.slot!==1)switchSlot(a,1);
}
function clearItems(){for(const it of items)scene.remove(it.mesh);items.length=0;G.bombItem=null;for(const n of nades)scene.remove(n.mesh);nades.length=0;}

/* ------------------------------- the bomb ------------------------------- */
function tryPlant(a,dt){
  if(!a.hasBomb||!a.onGround||G.phase!=='live'||G.bomb)return false;
  const site=inSite(a.pos);if(!site){if(a===G.player&&!a._siteWarn){a._siteWarn=true;HUD.center('You must be on a bomb site to plant.',1.5);}return false;}
  if(a.plantProg===0){a.plantSite=site;a.plantTick=0;}
  a.plantProg+=dt;a.plantTick-=dt;if(a.plantTick<=0){a.plantTick=0.45;SFX.plantTick(a.pos);}
  if(a.plantProg>=3){plantBomb(a,site);a.plantProg=0;}
  return true;
}
function plantBomb(a,site){
  a.hasBomb=false;const m=buildGun('bomb','S');m.group.scale.setScalar(1.8);m.group.position.set(a.pos.x,a.pos.y+0.08,a.pos.z);m.group.rotation.y=a.yaw;scene.add(m.group);
  G.bomb={pos:a.pos.clone(),site,t:40,mesh:m.group,led:m.group.userData.led,planter:a,beep:0,defuser:null};
  addMoney(a,300,'Bomb planted');G.planted=true;SFX.armed();
  HUD.chat('The bomb has been planted at site '+site+'.','sys');HUD.center('BOMB PLANTED',2.5);
  if(a.slot===5){a.slot=5;switchSlot(a,a.primary?1:a.secondary?2:3);}
  for(const b of G.agents)if(b.bot)b.bot.onBombPlanted();
}
function updateBomb(dt){
  const B=G.bomb;if(!B||B.done)return;
  B.t-=dt;const iv=B.t>20?1:B.t>10?0.7:B.t>5?0.42:B.t>2?0.25:0.12;
  B.beep-=dt;if(B.beep<=0){B.beep=iv;SFX.beep(B.pos,B.t<10);if(B.led)B.led.material.color.set(0xff3030);}
  else if(B.led&&B.beep<iv-0.08)B.led.material.color.set(0x401010);
  // defuse
  let def=null;
  for(const a of G.agents){if(!a.alive||a.team!=='W'||!a.input.use||!a.onGround)continue;if(a.pos.distanceTo(B.pos)<1.7){def=a;break;}}
  if(def&&(B.defuser===def||!B.defuser)){
    if(B.defuser!==def){B.defuser=def;def.defuseProg=0;def.defTick=0;if(def===G.player)HUD.chat('Defusing...','sys');}
    def.defuseProg+=dt;def.defTick-=dt;if(def.defTick<=0){def.defTick=0.35;SFX.defuseTick(B.pos);}
    if(def.defuseProg>=(def.kit?5:10)){B.done=true;B.defused=true;def.defuseProg=0;addMoney(def,300,'Bomb defused');SFX.defused();G.endRound('W','Bomb defused',def);}
  }else if(B.defuser){B.defuser.defuseProg=0;B.defuser=null;}
  if(B.t<=0&&!B.done){
    B.done=true;FX.explosion(B.pos.clone().add(V3(0,0.5,0)),true);for(let i=0;i<4;i++)setTimeout(()=>FX.explosion(B.pos.clone().add(V3(rand(-4,4),rand(0.5,3),rand(-4,4))),true),i*120);
    SFX.explode(B.pos,true);Cam.shake(B.pos,1.5);scene.remove(B.mesh);
    for(const b of G.agents){if(!b.alive)continue;const d=b.pos.distanceTo(B.pos);if(d<22){const dmg=d<9?500:500*Math.pow(1-(d-9)/13,2);applyDamage(b,B.planter,dmg,'body','world',{});}}
    G.endRound('S','Target bombed',B.planter);
  }
}
