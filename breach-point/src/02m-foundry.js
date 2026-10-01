/* =====================================================================
   Map: Foundry. A steelworks under hazy overcast daylight. Site A is
   inside the furnace hall (pour deck, crucibles, a molten channel under
   skylight gaps); site B is the open rail loading yard with ore wagons.
   Mid is the conveyor road with the conveyor gantry over it.
   Props come from work/foundry/blender/foundry_props.py (names start with fdy_).
   ===================================================================== */

// ---- surfaces (512 x 512 canvas drawings) ----
(function(){
  const wrap=(g,w,h,x,y,f)=>{for(const ox of[-w,0,w])for(const oy of[-h,0,h]){g.save();g.translate(x+ox,y+oy);f();g.restore();}};
  const stain=(g,w,h,n,col,rmin,rmax)=>{for(let i=0;i<n;i++){const x=Math.random()*w,y=Math.random()*h,rx=rand(rmin,rmax),ry=rx*rand(0.4,0.9),a=rand(0,3);
    wrap(g,w,h,x,y,()=>{g.rotate(a);g.scale(1,ry/rx);const gr=g.createRadialGradient(0,0,0,0,0,rx);gr.addColorStop(0,col);gr.addColorStop(0.7,col.replace(/[\d.]+\)$/,m=>(parseFloat(m)*0.6)+')'));gr.addColorStop(1,'rgba(0,0,0,0)');
      g.fillStyle=gr;g.beginPath();g.arc(0,0,rx,0,7);g.fill();});}};
  // stained factory-yard concrete: oil and rust stains, saw-cut joints
  SURFACES.fdy_concrete=[(g,w,h)=>{
    g.fillStyle='#7e7a72';g.fillRect(0,0,w,h);
    blotches(g,w,h,60,['#76726a','#8a867e','#6e6a62','#929086'],20,120,0.3);
    speckle(g,w,h,14000,['#4a4640','#a8a49a','#5e5a52','#3a3632'],1,2.2);
    stain(g,w,h,4,'rgba(34,30,26,.28)',30,80);
    stain(g,w,h,4,'rgba(120,70,36,.16)',20,70);
    g.strokeStyle='rgba(30,28,26,.6)';g.lineWidth=3;g.beginPath();g.moveTo(0,1);g.lineTo(w,1);g.moveTo(1,0);g.lineTo(1,h);g.stroke();
    g.strokeStyle='rgba(30,28,26,.35)';g.lineWidth=1;
    for(let i=0;i<10;i++){let x=Math.random()*w,y=Math.random()*h;g.beginPath();g.moveTo(x,y);for(let k=0;k<8;k++){x+=rand(-16,16);y+=rand(-16,16);g.lineTo(x,y);}g.stroke();}
    for(let i=0;i<4;i++){g.fillStyle='rgba(20,18,16,.18)';g.fillRect(rand(0,w),rand(0,h),rand(2,4),rand(60,200));} // tyre scuffs
  },2.4,0.92];
  // painted corrugated cladding with rust runs and grime at the bottom
  SURFACES.fdy_corrugated=[(g,w,h)=>{
    const n=28,s=w/n;
    for(let i=0;i<n;i++){const gr=g.createLinearGradient(i*s,0,i*s+s,0);gr.addColorStop(0,'#5e6a6a');gr.addColorStop(0.35,'#a2aaa6');gr.addColorStop(0.55,'#8c9692');gr.addColorStop(1,'#56605e');g.fillStyle=gr;g.fillRect(i*s,0,s,h);}
    for(let i=0;i<34;i++){const x=Math.random()*w,y=Math.random()*h*0.8,len=rand(60,260),wd=rand(3,10);const gr=g.createLinearGradient(0,y,0,y+len);
      gr.addColorStop(0,'rgba(112,64,34,.55)');gr.addColorStop(1,'rgba(112,64,34,0)');g.fillStyle=gr;g.fillRect(x,y,wd,len);}
    blotches(g,w,h,16,['#7a4424','#3a3a38','#6a6e60'],20,80,0.28);speckle(g,w,h,5000,['#2a2a2a','#d0d0c8','#7a4a2a'],1,2);
    g.fillStyle='rgba(24,24,24,.7)';g.fillRect(0,0,w,5);g.fillRect(0,h/2-2,w,4);
    g.fillStyle='rgba(30,30,30,.65)';for(let x=8;x<w;x+=s*2)for(const y of[10,h/2+8])g.fillRect(x,y,3,3);
    const gr=g.createLinearGradient(0,h*0.72,0,h);gr.addColorStop(0,'rgba(40,30,20,0)');gr.addColorStop(1,'rgba(40,30,20,.45)');g.fillStyle=gr;g.fillRect(0,0,w,h);
  },4.6,0.6,0.35];
  // soot-darkened industrial brick with a concrete band
  SURFACES.fdy_brick=[(g,w,h)=>{
    g.fillStyle='#6a625a';g.fillRect(0,0,w,h);const bh=h/16,bw=w/4;
    for(let r=0;r<16;r++)for(let i=-1;i<5;i++){const x=i*bw+(r%2)*bw/2;const l=rand(-18,14);
      g.fillStyle=`rgb(${92+l},${78+l*0.85},${70+l*0.8})`;g.fillRect(x+3,r*bh+3,bw-6,bh-6);g.fillStyle='rgba(255,255,255,.04)';g.fillRect(x+3,r*bh+3,bw-6,2);}
    g.fillStyle='#8a867c';g.fillRect(0,h*0.5-14,w,22);g.fillStyle='rgba(0,0,0,.25)';g.fillRect(0,h*0.5+6,w,3);
    speckle(g,w,h,8000,['#1a1410','#9a7a68','#3a2a22'],1,2);
    for(let i=0;i<14;i++){const x=Math.random()*w,y=Math.random()*h*0.4,len=rand(80,260),wd=rand(10,40);const gr=g.createLinearGradient(0,y,0,y+len);
      gr.addColorStop(0,'rgba(16,14,12,.26)');gr.addColorStop(1,'rgba(16,14,12,0)');g.fillStyle=gr;g.fillRect(x,y,wd,len);}
    blotches(g,w,h,10,['#18140f'],30,100,0.18);
  },3.2,0.9];
  // checker (tread) plate for the furnace hall floor
  SURFACES.fdy_plate=[(g,w,h)=>{
    g.fillStyle='#5a5c5e';g.fillRect(0,0,w,h);blotches(g,w,h,40,['#4c4e50','#6a6c6e','#545250'],20,90,0.4);
    const s=32;for(let y=0;y<h;y+=s)for(let x=0;x<w;x+=s){const a=((x+y)/s)%2?0.6:-0.6;for(const[ox,oy]of[[8,8],[24,24]]){
      g.save();g.translate(x+ox,y+oy);g.rotate(((x/s+y/s)%2?1:-1)*0.78);g.fillStyle='rgba(150,152,150,.55)';g.fillRect(-9,-2.5,18,5);g.fillStyle='rgba(20,20,20,.4)';g.fillRect(-9,2,18,1.5);g.restore();}}
    stain(g,w,h,4,'rgba(24,20,18,.3)',30,90);speckle(g,w,h,5000,['#2a2a2a','#9a9a96','#6a4a30'],1,2);
    g.strokeStyle='rgba(20,20,20,.7)';g.lineWidth=3;g.strokeRect(1.5,1.5,w-3,h-3);
    g.fillStyle='rgba(24,24,24,.8)';for(const[x,y]of[[12,12],[w-12,12],[12,h-12],[w-12,h-12],[w/2,12],[w/2,h-12],[12,h/2],[w-12,h/2]]){g.beginPath();g.arc(x,y,4,0,7);g.fill();}
  },3.6,0.5,0.55];
  // steel bar grating (deck and stairs)
  SURFACES.fdy_grate=[(g,w,h)=>{
    g.fillStyle='#181818';g.fillRect(0,0,w,h);
    for(let x=0;x<w;x+=16){g.fillStyle='#6e706e';g.fillRect(x,0,5,h);g.fillStyle='rgba(255,255,255,.12)';g.fillRect(x,0,1.5,h);}
    for(let y=0;y<h;y+=48){g.fillStyle='#5a5c5a';g.fillRect(0,y,w,4);}
    blotches(g,w,h,22,['#5a4030','#2a2a2a'],20,80,0.3);speckle(g,w,h,3000,['#2a2a2a','#9a9a96','#7a4a2a'],1,2);
    g.fillStyle='#d8a020';g.fillRect(0,0,w,18);g.fillStyle='#141414';for(let x=-20;x<w;x+=40){g.beginPath();g.moveTo(x,0);g.lineTo(x+20,0);g.lineTo(x+38,18);g.lineTo(x+18,18);g.fill();}
  },4.0,0.55,0.5];
  // yellow and black hazard paint (worn)
  SURFACES.fdy_hazard=[(g,w,h)=>{
    g.fillStyle='#d8a01c';g.fillRect(0,0,w,h);g.fillStyle='#161616';
    for(let i=-8;i<10;i++){g.beginPath();g.moveTo(i*64,0);g.lineTo(i*64+32,0);g.lineTo(i*64+32+h,h);g.lineTo(i*64+h,h);g.fill();}
    blotches(g,w,h,30,['#6a6a60','#3a3020','#a08a50'],10,60,0.35);speckle(g,w,h,7000,['#444','#e8d8a0','#7a5a2a'],1,2.4);
    for(let i=0;i<40;i++){g.fillStyle='rgba(120,116,108,.6)';g.fillRect(rand(0,w),rand(0,h),rand(6,30),rand(3,10));} // chipped paint
  },2.0,0.8];
  // dark corrugated roof sheeting with soot
  SURFACES.fdy_roof=[(g,w,h)=>{
    const n=20,s=w/n;
    for(let i=0;i<n;i++){const gr=g.createLinearGradient(i*s,0,i*s+s,0);gr.addColorStop(0,'#7a7e7c');gr.addColorStop(0.5,'#b4b8b4');gr.addColorStop(1,'#7a7e7c');g.fillStyle=gr;g.fillRect(i*s,0,s,h);}
    blotches(g,w,h,24,['#4a4642','#8a6a50'],20,90,0.3);speckle(g,w,h,4000,['#111','#888'],1,2);
  },3.8,0.7,0.3];
})();

MAPS.foundry={
  id:'foundry',name:'Foundry',tag:'INDUSTRIAL',
  desc:'A steelworks under a hazy sky. A is the furnace hall with its molten channel, B is the rail yard where the ore wagons load.',
  grid(F){
    // ---- Warden side (north): admin yard and the service roads
    F(26,2,37,8);                                          // Admin Yard (Warden spawn)
    F(12,3,25,6);F(38,3,50,6);                             // west / east service roads
    F(24,3,25,4,'#');F(38,5,39,6,'#');F(20,3,21,3,'v');F(45,6,45,6,'u'); // gate posts / guard huts split the roads
    F(15,7,16,8,'d');                                      // furnace hall north door
    F(45,7,48,8);                                          // rail yard north gate
    // ---- Site A: the furnace hall (roofed at 9.5 m with skylight gaps)
    F(5,9,21,23);
    F(5,9,11,12,'4');                                      // pour deck (2 m)
    F(5,13,7,13,'3');F(5,14,7,14,'2');F(5,15,7,15,'1');    // deck stairs (south)
    F(12,9,12,11,'3');F(13,9,13,11,'2');F(14,9,14,11,'1'); // deck stairs (east)
    F(8,13,11,13,'w');                                     // plinth under the deck edge (railing on top)
    F(5,19,6,23,'#');                                      // furnace block (furnace front on its east face)
    F(7,21,11,21,'L');F(12,21,12,21,'U');                  // molten channel into a crucible
    F(19,10,19,10,'U');                                    // second crucible
    F(16,14,17,14,'I');F(10,17,11,17,'H');F(20,18,20,18,'S');F(14,19,14,19,'c');F(20,22,21,22,'C');F(17,22,17,22,'m');
    F(13,23,13,23,'u');F(21,13,21,13,'c');
    F(22,15,22,16,'d');                                    // east door to the cooling tunnel
    F(8,24,9,24,'d');                                      // south door to the slag yard
    // ---- Mid → A: cooling tunnel
    F(23,15,28,16,'=');
    // ---- Slag yard (A long) and scrap lane from the Striker side
    F(4,25,13,40);
    F(4,33,7,37,'2');F(8,33,8,37,'1');                     // slag dump (1 m)
    F(5,27,6,28,'X');                                      // slag silo (tank on a base)
    F(11,27,11,27,'H');F(9,30,10,30,'b');F(12,35,12,35,'c');F(13,39,13,39,'C');F(4,39,4,39,'u');F(10,25,10,25,'I');
    F(4,41,14,44);F(13,43,25,48);                          // scrap lane (two offset legs)
    F(8,42,8,42,'S');F(12,41,12,41,'c');F(17,45,18,45,'b');F(22,43,22,43,'m');F(5,44,5,44,'y');
    // ---- Pipe gallery: slag yard ↔ lower mid
    F(14,33,28,34);F(18,33,24,34,'=');F(15,33,15,33,'c');
    // ---- Mid: conveyor road
    F(29,9,34,43);
    F(29,20,34,21,'=');                                    // conveyor gantry overhead
    F(29,30,30,30,'#');F(31,30,32,30,'d');F(33,30,34,30,'#');   // mid doors
    F(29,12,29,12,'u');F(34,17,34,17,'c');F(31,25,31,25,'m');F(34,26,34,26,'H');F(30,36,30,36,'C');F(33,40,34,40,'b');F(29,42,29,42,'y');
    // ---- Mid → B: scale house (roofed)
    F(35,12,40,14);F(36,12,39,14,'=');F(37,14,37,14,'c');
    // ---- Site B: rail loading yard
    F(41,9,59,23);
    F(48,14,48,14,'H');F(55,13,55,13,'c');
    F(41,9,42,10,'X');                                     // ore silo
    F(56,9,57,10,'X');                                     // control booth
    F(43,12,44,12,'Q');F(52,12,53,12,'Q');                 // ore wagons on the north track
    F(47,18,48,18,'Q');                                    // ore wagon on the south track
    F(55,15,59,17,'2');F(54,15,54,17,'1');                 // loading dock (1 m)
    F(46,15,46,15,'b');F(50,20,50,20,'I');F(58,21,58,21,'S');F(44,21,44,21,'C');F(51,9,51,9,'c');F(57,19,57,19,'c');F(41,17,41,17,'y');F(53,22,53,22,'H');
    // ---- B long: ore road and the rail gate from the Striker side
    F(52,24,55,24);F(51,25,57,41);
    F(54,30,54,31,'q');                                    // ore wagon on the siding
    F(52,27,52,27,'c');F(56,35,56,35,'b');F(52,38,52,38,'m');F(57,26,57,26,'u');
    F(38,42,57,46);F(36,38,36,38,'c');
    F(43,44,44,44,'b');F(49,43,49,43,'C');F(53,45,53,45,'S');
    // ---- Coal chute: lower mid ↔ ore road
    F(35,37,50,38);F(39,37,46,38,'=');
    // ---- Striker side (south): the scrapyard gate
    F(26,44,37,53);
    F(26,44,28,46,'#');F(35,46,37,48,'#');               // weigh-bridge huts break the long lines
    F(29,47,29,47,'u');F(35,50,35,50,'c');F(26,52,27,52,'v');F(36,52,36,52,'y');
  },
  props:{
    U:{asset:'fdy_crucible',h:2.3,w:0.85,mat:'metal',pen:0,rot:'grid'},
    L:{asset:'fdy_channel',h:0.65,w:0.95,mat:'stone',pen:0,rot:0},
    I:{asset:'fdy_ingots',h:1.05,w:0.85,mat:'metal',pen:0.5,rot:'grid'},
    H:{asset:'fdy_beams',h:1.25,w:0.95,mat:'metal',pen:0.4,rot:'grid'},
    S:{asset:'fdy_spool',h:1.56,w:0.8,mat:'wood',pen:1,rot:'grid'},
    b:{asset:'fdy_barrier',h:1.0,w:0.95,mat:'metal',pen:1.5,rot:0},
    Q:{asset:'fdy_bogie',h:2.7,w:0.98,mat:'metal',pen:0.4,rot:0},
    q:{asset:'fdy_bogie',h:2.7,w:0.98,mat:'metal',pen:0.4,rot:Math.PI/2},
    X:{asset:'fdy_plate',h:4,w:0.98,mat:'metal',pen:0,rot:0}
  },
  spawns:{W:[[28,4],[31,4],[34,4],[29,6],[33,6]],S:[[29,49],[31,49],[33,49],[30,51],[32,51]]},
  spawnZone:{W:[25,1,38,9],S:[25,43,38,54]},
  sites:{A:{c0:7,r0:9,c1:21,r1:23,center:[15,17]},B:{c0:42,r0:9,c1:59,r1:23,center:[50,15]}},
  zones:[['Pour Deck',5,9,14,15],['Furnace Hall',5,9,21,23],['Cooling Tunnel',22,15,28,16],['Slag Dump',4,33,8,37],['Slag Yard',4,24,13,40],
    ['Scrap Lane',4,41,25,48],['Pipe Gallery',14,33,28,34],['Admin Yard',26,2,37,8],['West Road',12,3,25,8],['East Road',38,3,50,8],
    ['Loading Dock',54,15,59,17],['Rail Yard',41,9,59,23],['Scale House',35,12,40,14],['Ore Road',51,24,57,41],['Rail Gate',38,42,57,46],
    ['Coal Chute',35,37,50,38],['Gantry',29,20,34,21],['Mid Doors',29,29,34,31],['Upper Conveyor',29,9,34,19],['Conveyor Road',29,22,34,43],['Scrapyard',26,44,37,53]],
  siteOfZone:{'Pour Deck':'A','Furnace Hall':'A','Cooling Tunnel':'A','Slag Yard':'A','Slag Dump':'A','Scrap Lane':'A','Pipe Gallery':'A',
    'Rail Yard':'B','Loading Dock':'B','Scale House':'B','Ore Road':'B','Rail Gate':'B','Coal Chute':'B'},
  plans:{
    A:[{route:'slag',stage:[18,46],entry:[[9,41],[9,27],[8,25],[9,23],[13,22]],smoke:[[15,10],[17,17]],flash:[[12,19]]},
       {route:'tunnel',stage:[29,34],entry:[[30,16],[25,16],[22,16],[19,16]],smoke:[[15,10]],flash:[[17,16]]}],
    B:[{route:'ore',stage:[53,35],entry:[[53,27],[53,24],[51,21]],smoke:[[46,8],[42,13]],flash:[[50,16]]},
       {route:'scale',stage:[33,34],entry:[[33,13],[37,13],[40,13],[43,14]],smoke:[[46,8]],flash:[[46,14]]}]},
  siteSpots:{A:[[15,17],[9,19],[18,12],[19,20],[13,15],[16,23]],B:[[50,15],[45,10],[55,11],[48,21],[43,16],[52,18]]},
  plantSpot:{A:[15,17],B:[50,15]},
  holds:{A:[{c:[7,10],l:[9,23]},{c:[20,12],l:[22,16]},{c:[13,13],l:[9,23]},{c:[18,20],l:[9,23]},{c:[12,26],l:[8,34]}],
    B:[{c:[55,12],l:[53,24]},{c:[49,10],l:[40,13]},{c:[46,20],l:[53,24]},{c:[58,16],l:[53,24]},{c:[43,15],l:[40,13]}],
    M:[{c:[31,11],l:[31,28]},{c:[33,18],l:[31,35]}]},
  signs:[{t:'A',c:LETTER_RED,x:16,z:24,nx:0,nz:-1,s:3.4,y:3.4},{t:'A',c:LETTER_RED,x:5,z:10.5,nx:1,nz:0,s:3,y:5},
    {t:'A',c:LETTER_RED,x:13,z:7,nx:0,nz:-1,s:3,y:3.2},{t:'A',c:LETTER_PALE,x:11.5,z:25,nx:0,nz:1,s:2.8,y:3},
    {t:'B',c:LETTER_RED,x:60,z:12.5,nx:-1,nz:0,s:3.6,y:3.6},{t:'B',c:LETTER_RED,x:46,z:24,nx:0,nz:-1,s:3.2,y:3.2},
    {t:'A',c:LETTER_PALE,x:29,z:39.5,nx:1,nz:0,s:2.4,a:1},{t:'B',c:LETTER_PALE,x:35,z:40.5,nx:-1,nz:0,s:2.4,a:-1},
    {t:'A',c:LETTER_PALE,x:20,z:43,nx:0,nz:1,s:2.4,a:-1},{t:'B',c:LETTER_PALE,x:45,z:42,nx:0,nz:1,s:2.4,a:1},
    {t:'A',c:LETTER_PALE,x:21,z:7,nx:0,nz:-1,s:2.2,a:1},{t:'B',c:LETTER_PALE,x:41,z:7,nx:0,nz:-1,s:2.2,a:-1},
    {t:'B',c:LETTER_PALE,x:35,z:17.5,nx:-1,nz:0,s:2.2,a:-1},{t:'A',c:LETTER_PALE,x:29,z:18.5,nx:1,nz:0,s:2.2,a:1}],
  trees:{type:'fdy_chimney',at:[[24,11],[2,20],[39,26],[61,30]],min:1,max:1},
  paved:[[5,9,21,23,'fdy_plate'],[26,2,37,8,'slab'],[23,15,28,16,'fdy_plate'],[36,12,39,14,'fdy_plate'],[39,37,46,38,'fdy_plate'],[18,33,24,34,'fdy_plate'],
    [15,7,16,8,'fdy_hazard'],[22,15,22,16,'fdy_hazard'],[8,24,9,24,'fdy_hazard'],[31,30,32,30,'fdy_hazard']],
  roofs:[[5,9,21,11,9.5],[5,13,21,15,9.5],[5,17,21,19,9.5],[5,21,21,23,9.5]],
  extras:[],
  menuSpot:[14,17],menuAngle:1.9,
  theme:{
    ground:'fdy_concrete',walls:[['fdy_corrugated',0.45],['fdy_brick',0.35],['concretewall',0.2]],paving:'fdy_plate',stairs:'fdy_grate',roof:'fdy_roof',
    lowWall:'concretewall',lowWallCap:'fdy_hazard',cap:'trim',
    decor:{window:['fdy_window','fdy_window','fdy_windowD'],winY:4.4,winP:0.16,door:'fdy_door',doorP:0.05,lamp:'fdy_lamp',lampP:0.9,awnings:null,awnP:0,
      streetlamp:null,slP:0,extras:[{asset:'fdy_pipes',p:0.09,y:0,minH:5.5},{asset:'fdy_lamp',p:0.04,y:3.6}],vehicles:['forklift'],vehicleH:{forklift:2.2}},
    tints:[[1,0.97,0.92],[0.92,0.95,0.97],[1,0.9,0.82],[0.95,0.92,0.88],[0.88,0.9,0.86]],
    sky:{top:0x6a7078,mid:0xa8a49a,horizon:0xd8c8b0,ground:0x6a6058,sun:0xffe0b8,sunDir:[0.35,0.62,-0.45],clouds:0.85,cloudColor:0xb8b0a6},
    sunColor:0xffe2c0,sunI:1.35,hemiSky:0xc8ccd0,hemiGround:0x7a6a5a,hemiI:0.95,fog:0xb8aa98,fogNear:35,fogFar:200,
    exposure:0.86,grade:{sat:0.94,contrast:1.08,lift:[0.012,0.008,0.0],gain:[1.06,1.0,0.92]},particles:['embers','ash']
  },
  art:{wall:'#4a4440',wall2:'#6a6e6c',ground:'#7a746a',draw(g,w,h){
    // chimney stacks and a glowing furnace mouth
    for(const[x,s]of[[0.18,1],[0.3,0.8],[0.82,1.1]]){g.fillStyle='#3a2e2a';g.fillRect(w*x-5*s,h*0.12/s,10*s,h*0.7);g.fillStyle='#a83024';g.fillRect(w*x-5*s,h*0.12/s,10*s,5);
      g.fillStyle='rgba(120,110,100,.35)';g.beginPath();g.ellipse(w*x+14,h*0.08/s,22,8,-0.2,0,7);g.fill();}
    g.fillStyle='#5a5c5a';g.fillRect(w*0.52,h*0.4,w*0.2,h*0.38);
    const gr=g.createRadialGradient(w*0.62,h*0.66,2,w*0.62,h*0.66,h*0.3);gr.addColorStop(0,'rgba(255,170,60,.95)');gr.addColorStop(0.3,'rgba(255,110,30,.5)');gr.addColorStop(1,'rgba(255,90,20,0)');
    g.fillStyle=gr;g.fillRect(0,0,w,h);g.fillStyle='#ffb050';g.fillRect(w*0.58,h*0.6,w*0.08,h*0.1);
    g.fillStyle='#d8a01c';for(let i=0;i<8;i++){g.fillRect(i*w/8,h*0.76,w/16,4);}
    g.fillStyle='rgba(255,140,50,.9)';for(let i=0;i<40;i++)g.fillRect(Math.random()*w,Math.random()*h*0.8,1.5,1.5);
  }}
};
// hero props: rails, wagons, silos, booth, furnace and scenery tanks
(function(M){
  const E=M.extras,R=Math.PI;
  const skip=new Set(['43,12','44,12','52,12','53,12','47,18','48,18']);
  for(let c=41;c<=59;c++){if(!skip.has(c+',12'))E.push({asset:'fdy_rail',at:[c+0.5,12.5],rot:0});if(c>=42&&c<=53&&!skip.has(c+',18'))E.push({asset:'fdy_rail',at:[c+0.5,18.5],rot:0});}
  for(let r=24;r<=41;r++)if(r!==30&&r!==31)E.push({asset:'fdy_rail',at:[54.5,r+0.5],rot:R/2});
  for(let c=36;c<=40;c++)E.push({asset:'fdy_rail',at:[c+0.5,12.5],rot:0}); // track continues into the scale house siding
  E.push({asset:'fdy_wagon',at:[44,12.5],rot:0},{asset:'fdy_wagonY',at:[53,12.5],rot:R},{asset:'fdy_wagonY',at:[48,18.5],rot:0},{asset:'fdy_wagon',at:[54.5,31],rot:R/2});
  E.push({asset:'fdy_tank',at:[42,10],rot:0.3},{asset:'fdy_tank',at:[6,28],rot:1.2,scale:0.9});
  E.push({asset:'fdy_booth',at:[57,10],rot:R});
  for(const[x,z]of[[9,14],[15,10.5],[15,14.5],[15,18.5],[15,22.5],[19,14.5],[11,18.5]])E.push({asset:'fdy_hanglamp',at:[x,z],y:9.5,rot:0}); // high-bay lamps under the hall roof
  E.push({asset:'fdy_furnace',at:[6.35,21.5],rot:-R/2});
  for(const x of[8.5,9.5,10.5,11.5])E.push({asset:'fdy_barrier',at:[x,12.82],y:2,rot:0,collide:{w:0.95,d:0.1,h:1.0,mat:'metal',pen:1.5}}); // deck railing
  // scenery silos behind the walls
  E.push({asset:'fdy_tank',at:[20,30],rot:0,scale:1.3},{asset:'fdy_tank',at:[22.5,30.5],rot:1,scale:1.15},{asset:'fdy_tank',at:[44,30],rot:0.5,scale:1.4},
    {asset:'fdy_tank',at:[46.5,33],rot:2,scale:1.2},{asset:'fdy_tank',at:[2,47],rot:0,scale:1.3},{asset:'fdy_tank',at:[61,4],rot:0,scale:1.3});
})(MAPS.foundry);
MAP_ORDER.push('foundry');
