/* =====================================================================
   Map: Neon Row. A rain-soaked city block at night. Site A is a
   back-alley night market under canopies and string lights, site B is
   the inside of a parking garage. Mid is the neon strip itself with a
   lantern plaza around a ramen kiosk. Props come from
   work/neonrow/blender/neonrow_props.py (names start with neo_).
   ===================================================================== */

// ---- surfaces (512 x 512 canvas drawings) ----
(function(){
  // draws f at (x,y) and at its wrapped copies so the texture tiles without seams
  const wrap=(g,w,h,x,y,f)=>{for(const ox of[-w,0,w])for(const oy of[-h,0,h]){g.save();g.translate(x+ox,y+oy);f();g.restore();}};
  SURFACES.neo_asphalt=[(g,w,h)=>{
    g.fillStyle='#34363c';g.fillRect(0,0,w,h);
    blotches(g,w,h,50,['#2a2c31','#3d3f46','#2e2f35','#43454c'],20,120,0.35);
    speckle(g,w,h,16000,['#1c1d21','#5a5c63','#46484f','#25262b'],1,2.4);
    for(let i=0;i<7;i++){ // puddles: darker and a little violet
      const x=Math.random()*w,y=Math.random()*h,rx=rand(35,95),ry=rand(14,40),a=rand(0,3);
      wrap(g,w,h,x,y,()=>{g.rotate(a);g.scale(1,ry/rx);const gr=g.createRadialGradient(0,0,0,0,0,rx);
        gr.addColorStop(0,'rgba(16,16,30,.75)');gr.addColorStop(0.75,'rgba(20,20,36,.55)');gr.addColorStop(1,'rgba(20,20,36,0)');
        g.fillStyle=gr;g.beginPath();g.arc(0,0,rx,0,7);g.fill();
        g.fillStyle='rgba(120,90,200,.07)';g.beginPath();g.arc(rx*0.2,0,rx*0.45,0,7);g.fill();});
    }
    g.strokeStyle='rgba(12,12,16,.65)';g.lineWidth=2;
    for(let i=0;i<9;i++){let x=Math.random()*w,y=Math.random()*h;g.beginPath();g.moveTo(x,y);for(let k=0;k<9;k++){x+=rand(-18,18);y+=rand(-18,18);g.lineTo(x,y);}g.stroke();}
    g.fillStyle='rgba(10,10,12,.5)';for(let i=0;i<5;i++){const x=rand(0,w-140),y=rand(0,h-40);g.fillRect(x,y,rand(60,140),rand(18,40));} // tar patches
  },1.6,0.4];
  SURFACES.neo_brick=[(g,w,h)=>{
    g.fillStyle='#2e2626';g.fillRect(0,0,w,h);const bh=h/16,bw=w/4;
    for(let r=0;r<16;r++)for(let i=-1;i<5;i++){const x=i*bw+(r%2)*bw/2;const l=rand(-14,12);
      g.fillStyle=`rgb(${96+l},${60+l*0.7},${56+l*0.6})`;g.fillRect(x+3,r*bh+3,bw-6,bh-6);
      g.fillStyle='rgba(255,255,255,.05)';g.fillRect(x+3,r*bh+3,bw-6,2);}
    speckle(g,w,h,9000,['#1a1212','#7a5a50','#2a2020'],1,2);
    streaks(g,w,h,24,'rgba(10,10,16,.6)',0.55);
    blotches(g,w,h,12,['#141418','#24343a'],30,100,0.3);
    const gr=g.createLinearGradient(0,h*0.7,0,h);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(8,8,12,.35)');g.fillStyle=gr;g.fillRect(0,0,w,h);
  },3.2,0.84];
  SURFACES.neo_concwall=[(g,w,h)=>{
    g.fillStyle='#5d5e63';g.fillRect(0,0,w,h);
    blotches(g,w,h,55,['#4c4d52','#6a6b70','#55565c','#45464c'],20,110,0.35);
    speckle(g,w,h,10000,['#303136','#7c7d82','#404146'],1,2);
    g.strokeStyle='rgba(25,25,30,.6)';g.lineWidth=3;g.strokeRect(1.5,1.5,w-3,h-3);g.beginPath();g.moveTo(0,h/2);g.lineTo(w,h/2);g.stroke();
    g.fillStyle='rgba(20,20,24,.7)';for(const x of[64,192,320,448])for(const y of[64,192,320,448]){g.beginPath();g.arc(x,y,4,0,7);g.fill();}
    streaks(g,w,h,30,'rgba(18,20,26,.55)',0.6);
    blotches(g,w,h,8,['#2c3a36'],30,80,0.25);
  },2.2,0.88];
  SURFACES.neo_tiles=[(g,w,h)=>{
    g.fillStyle='#1d1e23';g.fillRect(0,0,w,h);const n=4,s=w/n;
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){const l=rand(-8,8);g.fillStyle=`rgb(${84+l},${84+l},${92+l})`;g.fillRect(i*s+3,j*s+3,s-6,s-6);
      g.fillStyle='rgba(255,255,255,.035)';g.fillRect(i*s+3,j*s+3,s-6,3);}
    blotches(g,w,h,26,['#2a2b33','#4a4c58'],20,80,0.3);speckle(g,w,h,7000,['#15161a','#7a7c88'],1,2);
    g.fillStyle='rgba(150,130,220,.05)';for(let i=0;i<5;i++)g.fillRect(rand(0,w),rand(0,h),rand(40,120),rand(6,14));
  },2.4,0.36];
  SURFACES.neo_slab=[(g,w,h)=>{
    g.fillStyle='#3a3b40';g.fillRect(0,0,w,h);const s=w/2;
    for(let i=0;i<2;i++)for(let j=0;j<2;j++){const l=rand(-8,8);g.fillStyle=`rgb(${104+l},${104+l},${108+l})`;g.fillRect(i*s+4,j*s+4,s-8,s-8);}
    blotches(g,w,h,40,['#5c5d62','#85868c','#6a6b70'],20,90,0.3);speckle(g,w,h,9000,['#3c3d42','#9a9ba0'],1,2);
    streaks(g,w,h,10,'rgba(30,30,36,.35)',0.5);
  },2.0,0.6];
  SURFACES.neo_parking=[(g,w,h)=>{
    g.fillStyle='#55575b';g.fillRect(0,0,w,h);
    blotches(g,w,h,45,['#4a4c50','#606266','#505256'],20,110,0.35);speckle(g,w,h,9000,['#3a3c40','#727478'],1,2);
    for(let i=0;i<6;i++){const x=rand(60,w-60),y=Math.random()*h,r=rand(18,50);wrap(g,w,h,x,y,()=>{const gr=g.createRadialGradient(0,0,0,0,0,r);
      gr.addColorStop(0,'rgba(18,18,20,.6)');gr.addColorStop(1,'rgba(18,18,20,0)');g.fillStyle=gr;g.fillRect(-r,-r,2*r,2*r);});}
    g.fillStyle='rgba(232,228,214,.85)';g.fillRect(0,0,9,h);g.fillRect(w-9,0,9,h); // bay lines
    speckle(g,w,h,1500,['#3a3c40'],1,3);
  },1.8,0.5];
})();

MAPS.neonrow={
  id:'neonrow',name:'Neon Row',tag:'NIGHT',
  desc:'A rain-soaked city block at night. A is a back-alley night market, B is a parking garage. Mid is the neon strip.',
  grid(F){
    // ---- Warden side (north): station plaza and tram street
    F(26,2,37,8);                                          // Station (Warden spawn)
    F(13,5,25,8);F(38,2,50,4);                             // Tram Street west / east (offset rows: no long line)
    F(13,9,16,9);                                          // Market Gate (north door of A)
    F(21,7,22,8,'#');F(40,3,41,4,'#');                     // tram shelters (break the long tram-street line)
    F(44,5,47,8);                                          // Garage ramp (north door of B)
    // ---- Site A: the night market
    F(5,10,19,23);
    F(5,10,8,13,'3');F(5,14,6,14,'2');F(5,15,6,15,'1');    // tea-house terrace and its stairs
    F(10,12,11,12,'S');F(16,12,17,12,'S');                 // stalls (facing south)
    F(10,19,11,19,'N');F(16,19,17,19,'N');                 // stalls (facing north)
    F(19,15,19,16,'J');                                    // stalls on the east wall (facing west)
    F(13,15,13,15,'c');F(14,15,14,15,'m');F(8,18,8,18,'P');F(18,22,18,22,'o');F(19,11,19,11,'c');F(12,14,12,14,'F');F(16,16,16,16,'F');
    F(5,22,5,22,'D');F(12,22,12,22,'c');
    // ---- Site B: the parking garage (roofed at 5 m)
    F(42,9,59,22);
    F(55,9,59,22,'3');F(52,16,52,18,'1');F(53,16,53,18,'2');F(54,16,54,18,'3');   // split-level deck and ramp
    F(57,12,57,13,'5');F(58,19,58,19,'5');                 // concrete blocks on the deck
    F(45,12,45,12,'Q');F(49,12,49,12,'Q');F(45,19,45,19,'Q');F(49,19,49,19,'Q');   // columns
    F(43,9,43,10,'v');F(51,9,51,10,'v');F(53,9,53,10,'v');F(42,20,42,21,'v');F(47,21,47,22,'v');
    F(47,16,47,16,'c');F(52,12,52,12,'m');F(42,12,42,12,'>');F(44,22,45,22,'H');
    F(49,17,50,18,'#');                                    // lift core
    // ---- Mid: Neon Row (upper), Lantern Plaza with the ramen kiosk, Neon Row (lower)
    F(28,9,35,22);
    F(29,19,29,20,'v');F(34,12,34,12,'I');F(30,15,33,16,'#');F(28,22,28,22,'>');F(35,22,35,22,'<');   // newsstand in the middle of the row
    F(35,11,35,11,'<');F(33,12,33,12,'c');F(28,21,28,21,'P');F(35,21,35,21,'P');
    F(22,23,41,33);
    F(28,26,35,28,'#');F(41,23,41,23,'#');                 // kiosk; corner of the garage wall
    F(38,30,41,33,'2');F(37,30,37,33,'1');                 // stage (raised 1 m)
    F(30,24,31,24,'H');F(25,30,25,30,'H');F(23,24,23,24,'c');F(40,25,40,25,'D');F(27,32,27,32,'c');F(22,33,22,33,'P');F(35,32,35,32,'^');F(36,26,36,26,'F');
    F(29,34,34,53);
    F(29,40,32,41,'#');F(31,47,34,48,'#');                 // staggered shop fronts: no straight line down the row
    F(33,43,33,44,'v');F(33,37,33,37,'I');F(29,49,29,49,'D');
    // ---- Routes to A: Noodle Bar (short, from the plaza) and Laundry Alley (long)
    F(16,25,21,26,'=');F(16,24,17,24,'=');F(21,26,21,26,'^'); // Noodle Bar (low roof) with a vending machine
    F(9,24,13,41);F(12,24,13,25,'#');                      // Laundry Alley (upper)
    F(9,30,11,32,'#');F(11,37,13,39,'#');                  // laundromat and boiler house: the alley zig-zags
    F(4,40,8,54);                                          // Laundry Alley (lower)
    F(4,43,5,48,'2');F(4,49,5,49,'1');                     // loading dock
    F(9,35,9,35,'c');F(13,28,13,28,'D');F(8,46,8,46,'D');F(7,52,7,52,'D');
    F(5,55,24,58);                                         // Back Street
    F(12,55,12,55,'D');F(15,57,16,57,'v');F(19,58,19,58,'o');F(8,58,8,58,'c');
    F(17,55,18,56,'#');F(21,56,22,58,'#');                 // corner shops on the back street
    // ---- Routes to B: Service Lane (short, from the plaza) and the taxi rank (long)
    F(37,14,40,22);F(41,15,41,16,'d');                     // Service Lane and the garage side door
    F(39,19,40,20,'#');F(37,15,37,15,'D');F(37,21,37,21,'c');
    F(49,24,54,41);F(54,40,58,49);                         // Taxi Rank (upper / lower)
    F(50,23,53,23);                                        // garage south entrance
    F(49,29,52,30,'#');F(51,34,54,35,'#');                 // taxi office and a cab shelter: staggered
    F(54,37,54,38,'v');F(50,26,50,26,'I');F(54,27,54,27,'c');F(57,44,57,45,'v');F(54,47,54,47,'D');
    F(39,50,58,53);F(36,51,38,53);                         // Depot Lane and its exit from the depot
    F(41,52,42,53,'#');                                    // ticket booth
    F(44,52,45,52,'v');F(50,50,50,50,'H');F(40,50,40,50,'o');F(56,51,56,51,'c');
    // ---- Striker side (south): the bus depot
    F(25,54,38,61);
    F(25,54,26,55,'#');                                    // depot office
    F(26,59,26,60,'v');F(37,59,37,60,'v');F(28,56,28,56,'H');F(36,56,36,56,'H');
    // ---- Warden side cover
    F(19,5,20,5,'v');F(24,8,24,8,'D');F(47,2,48,2,'v');F(49,4,49,4,'H');
    F(27,7,27,7,'H');F(36,7,36,7,'H');F(30,2,30,2,'V');F(33,2,33,2,'V');
  },
  // custom cells: market stalls by facing, vending machines by facing, dumpsters, barriers, garage columns
  props:{
    S:{asset:['neo_stallR','neo_stallT'],h:1.0,w:0.9,mat:'wood',pen:1,rot:Math.PI},
    N:{asset:['neo_stallR','neo_stallT'],h:1.0,w:0.9,mat:'wood',pen:1,rot:0},
    J:{asset:['neo_stallR','neo_stallT'],h:1.0,w:0.9,mat:'wood',pen:1,rot:Math.PI/2},
    V:{asset:['neo_vendRed','neo_vendBlue'],h:1.95,w:0.55,mat:'metal',pen:0.5,rot:Math.PI},
    '^':{asset:['neo_vendRed','neo_vendBlue'],h:1.95,w:0.55,mat:'metal',pen:0.5,rot:0},
    '<':{asset:['neo_vendRed','neo_vendBlue'],h:1.95,w:0.55,mat:'metal',pen:0.5,rot:Math.PI/2},
    '>':{asset:['neo_vendRed','neo_vendBlue'],h:1.95,w:0.55,mat:'metal',pen:0.5,rot:-Math.PI/2},
    D:{asset:'neo_dumpster',h:1.2,w:0.95,mat:'metal',pen:0.6,rot:'grid'},
    H:{asset:'neo_barrier',h:0.85,w:0.95,mat:'stone',pen:0,rot:0},
    I:{asset:'neo_barrier',h:0.85,w:0.95,mat:'stone',pen:0,rot:Math.PI/2},
    Q:{asset:'neo_pillar',h:5,w:0.38,mat:'stone',pen:0,rot:0},
    F:{asset:'neo_tables',h:0.8,w:0.85,mat:'wood',pen:1,rot:'random'}
  },
  spawns:{W:[[28,4],[31,4],[34,4],[29,6],[33,6]],S:[[29,57],[31,57],[33,57],[30,59],[32,59]]},
  spawnZone:{W:[25,1,38,9],S:[24,53,39,62]},
  sites:{A:{c0:5,r0:10,c1:19,r1:23,center:[13,16]},B:{c0:42,r0:9,c1:59,r1:22,center:[48,15]}},
  zones:[['Tea House',5,10,8,15],['Market',5,10,19,23],['Market Gate',13,9,16,9],['Noodle Bar',16,24,21,26],
    ['Deck',55,9,59,22],['Ramp',52,16,54,18],['Garage',42,9,59,22],['Garage Ramp',44,5,47,8],['Service Lane',37,14,41,22],
    ['Station',26,2,37,8],['Tram West',13,5,25,8],['Tram East',38,2,50,4],
    ['Upper Row',28,9,35,22],['Kiosk',29,25,34,29],['Stage',37,30,41,33],['Lantern Plaza',22,23,41,33],['Lower Row',29,34,34,53],
    ['Laundry Alley',9,24,13,41],['Loading Dock',4,43,5,49],['Lower Laundry',4,40,8,54],['Back Street',5,55,24,58],
    ['Taxi Rank',49,23,58,49],['Depot Lane',36,50,58,53],['Bus Depot',25,54,38,61]],
  siteOfZone:{'Market':'A','Tea House':'A','Market Gate':'A','Noodle Bar':'A','Laundry Alley':'A','Lower Laundry':'A','Loading Dock':'A','Back Street':'A',
    'Garage':'B','Deck':'B','Ramp':'B','Garage Ramp':'B','Service Lane':'B','Taxi Rank':'B','Depot Lane':'B'},
  plans:{
    A:[{route:'laundry',stage:[11,34],entry:[[11,28],[10,24],[10,21]],smoke:[[14,8],[17,14]],flash:[[12,17]]},
       {route:'noodle',stage:[24,29],entry:[[22,26],[19,25],[17,24],[16,20]],smoke:[[14,8]],flash:[[14,18]]}],
    B:[{route:'rank',stage:[51,37],entry:[[52,26],[52,23],[50,19]],smoke:[[46,8],[41,16]],flash:[[48,16]]},
       {route:'service',stage:[38,28],entry:[[38,22],[39,17],[41,16],[44,16]],smoke:[[46,8]],flash:[[47,14]]}]},
  siteSpots:{A:[[13,17],[7,18],[18,11],[17,21],[9,15],[6,11]],B:[[47,15],[51,13],[57,11],[48,20],[44,14],[57,20]]},
  plantSpot:{A:[13,17],B:[48,15]},
  holds:{A:[{c:[7,11],l:[10,24]},{c:[18,11],l:[17,23]},{c:[6,20],l:[10,24]},{c:[15,13],l:[17,23]},{c:[11,15],l:[10,24]}],
    B:[{c:[57,11],l:[52,23]},{c:[57,20],l:[41,16]},{c:[44,13],l:[41,16]},{c:[48,11],l:[52,23]},{c:[56,21],l:[51,23]}],
    M:[{c:[29,13],l:[28,23]},{c:[33,19],l:[24,25]},{c:[38,15],l:[38,23]}]},
  // painted letters: site letters next to each site, direction arrows on the routes (kept low, under awnings and windows)
  signs:[{t:'A',c:'#ff4d7a',x:10.5,z:10,nx:0,nz:1,s:2.6,y:2.2},{t:'A',c:'#ff4d7a',x:20,z:21.5,nx:-1,nz:0,s:2.6,y:1.9},
    {t:'B',c:'#ff4d7a',x:42,z:11,nx:1,nz:0,s:2.6,y:2.2},{t:'B',c:'#ff4d7a',x:60,z:14.5,nx:-1,nz:0,s:2.4,y:3.4},{t:'B',c:'#ff4d7a',x:50,z:19,nx:0,nz:1,s:1.8,y:2.0},
    {t:'A',c:LETTER_PALE,x:30.5,z:29,nx:0,nz:1,s:2.0,y:1.7,a:-1},{t:'B',c:LETTER_PALE,x:33.5,z:29,nx:0,nz:1,s:2.0,y:1.7,a:1},
    {t:'A',c:LETTER_PALE,x:20,z:55,nx:0,nz:1,s:2.2,y:1.8,a:-1},{t:'B',c:LETTER_PALE,x:46,z:50,nx:0,nz:1,s:2.2,y:1.8,a:1},
    {t:'A',c:LETTER_PALE,x:22,z:30,nx:1,nz:0,s:2.0,y:1.7,a:1},{t:'B',c:LETTER_PALE,x:37,z:19,nx:1,nz:0,s:2.0,y:1.7,a:1},
    {t:'A',c:LETTER_PALE,x:14,z:33,nx:-1,nz:0,s:2.0,y:1.7,a:-1},{t:'B',c:LETTER_PALE,x:49,z:32,nx:1,nz:0,s:2.0,y:1.7,a:1}],
  // rooftop skyline: billboards, masts and water tanks standing inside building blocks
  trees:{type:['neo_billboard','neo_antenna','neo_watertank','neo_watertank'],
    at:[[3,4],[24,19],[24,38],[18,48],[44,40],[45,28],[60,30],[60,5],[2,30],[21,0],[45,60],[10,61],[57,58],[24,12],[47,31]],min:11,max:15},
  paved:[[26,2,37,8,'neo_tiles'],[5,10,19,23,'neo_tiles'],[22,23,41,33,'neo_tiles'],[42,9,54,22,'neo_parking'],[25,54,38,61,'neo_tiles'],
    [28,9,28,22],[35,9,35,22],[29,34,29,53],[34,34,34,53]],
  roofs:[[42,9,59,22,5.0]],
  // hand-placed hero props: neon letters, string lights, tarps, steam vents, garage lights
  extras:[
    {asset:'neo_letterA',at:[5,18.5],y:2.2,rot:-Math.PI/2},
    {asset:'neo_letterB',at:[49.5,9],y:1.4,rot:Math.PI},
    {asset:'neo_signBladeP',at:[20,13],y:3.4,rot:Math.PI/2},
    {asset:'neo_lights8',at:[11,16],y:3.1,rot:Math.PI/2},{asset:'neo_lights8',at:[17,16],y:3.1,rot:Math.PI/2},
    {asset:'neo_lights8',at:[15,9.5],y:4.6},{asset:'neo_lights12',at:[11.5,28],y:4.4},{asset:'neo_lights12',at:[11.5,34],y:4.4},
    {asset:'neo_lights12',at:[32,12],y:5.2,scale:[1.4,1,1]},{asset:'neo_lights12',at:[32,18],y:5.2,scale:[1.4,1,1]},
    {asset:'neo_lights12',at:[32,37],y:5.0},{asset:'neo_lights12',at:[32,44],y:5.0},{asset:'neo_lights12',at:[32,51],y:5.0},
    {asset:'neo_tarpR',at:[11,34.5],y:4.6,scale:[1.4,1,1]},{asset:'neo_tarpT',at:[19,7],y:4.8,rot:Math.PI/2},
    {asset:'neo_vent',at:[12.5,35.5]},{asset:'neo_vent',at:[30.5,45.5]},{asset:'neo_vent',at:[52,32]},{asset:'neo_vent',at:[24.5,27.5]},{asset:'neo_vent',at:[33.5,20.5]},
    {asset:'neo_tube',at:[44,11],y:4.4},{asset:'neo_tube',at:[48,11],y:4.4},{asset:'neo_tube',at:[52,11],y:4.4},
    {asset:'neo_tube',at:[44,16],y:4.4},{asset:'neo_tube',at:[48,16],y:4.4},{asset:'neo_tube',at:[52,13],y:4.4},
    {asset:'neo_tube',at:[44,21],y:4.4},{asset:'neo_tube',at:[48,21],y:4.4},{asset:'neo_tube',at:[52,21],y:4.4},
    {asset:'neo_tube',at:[57.5,12],y:4.4},{asset:'neo_tube',at:[57.5,18],y:4.4},
    {asset:'neo_tube',at:[18,26],y:2.8,rot:Math.PI/2},{asset:'neo_tube',at:[21,26],y:2.8,rot:Math.PI/2},
    // the noodle bar: neon and lit shop windows on its walls
    {asset:'neo_signBowl',at:[19.5,27],y:1.5},{asset:'neo_signOpen',at:[17,27],y:1.9},
    {asset:'neo_winWarm',at:[20.5,25],y:1.0,rot:Math.PI},{asset:'neo_signCocktail',at:[18.5,25],y:1.6,rot:Math.PI},
    {asset:'neo_lights8',at:[18.5,25.5],y:3.0},
    // shop fronts on the blocks that break the long sightlines
    {asset:'neo_winWarm',at:[31,17],y:0.9,rot:Math.PI},{asset:'neo_signBowl',at:[32.6,17],y:1.9,rot:Math.PI},          // newsstand
    {asset:'neo_signOpen',at:[31.4,15],y:1.9},{asset:'neo_winCool',at:[32.8,15],y:0.9},
    {asset:'neo_winWarm',at:[30,42],y:0.9,rot:Math.PI},{asset:'neo_signCocktail',at:[31.6,42],y:1.9,rot:Math.PI},   // lower row shops
    {asset:'neo_signBowl',at:[30.5,40],y:1.9},{asset:'neo_winCool',at:[32.5,47],y:0.9},
    {asset:'neo_winWarm',at:[31.6,49],y:0.9,rot:Math.PI},{asset:'neo_signArrow',at:[31.6,49],y:2.5,rot:Math.PI},
    {asset:'neo_lamppost',at:[29,36],rot:-Math.PI/2},{asset:'neo_lamppost',at:[35,45],rot:Math.PI/2},{asset:'neo_lamppost',at:[29,51.5],rot:-Math.PI/2},
    {asset:'neo_winCool',at:[12,30.6],y:0.9,rot:-Math.PI/2},{asset:'neo_winCool',at:[12,31.9],y:0.9,rot:-Math.PI/2},   // laundromat
    {asset:'neo_signOpen',at:[12,31.25],y:2.3,rot:-Math.PI/2},{asset:'neo_acunit',at:[10,30],y:2.8},
    {asset:'neo_acunit',at:[11,38],y:2.6,rot:Math.PI/2},{asset:'neo_signArrow',at:[12.5,37],y:1.9},                  // boiler house
    {asset:'neo_signOpen',at:[50.2,31],y:1.9,rot:Math.PI},{asset:'neo_winWarm',at:[51.6,31],y:0.9,rot:Math.PI},       // taxi office
    {asset:'neo_winCool',at:[52.5,34],y:0.9},{asset:'neo_winWarm',at:[50.4,29],y:0.9},{asset:'neo_signCocktail',at:[51.8,29],y:1.9},
    {asset:'neo_winCool',at:[49,18],y:0.9,rot:Math.PI/2}                                                             // garage lift lobby
  ],
  menuSpot:[14,14],menuAngle:-2.6,
  art:{wall:'#1d1a30',wall2:'#2b2342',ground:'#17161f',draw(g,w,h){
    const neon=['#ff3fa8','#3cf0ff','#ffa526','#ff4cf2','#7dff6a'];
    for(let i=0;i<14;i++){g.fillStyle=pick(['#ffc06a','#9cc2ff','#ffb468']);g.globalAlpha=0.8;g.fillRect(rand(0,w),rand(h*0.42,h*0.74),3,4);}
    for(let i=0;i<6;i++){const c=pick(neon),x=rand(8,w-30),y=rand(h*0.4,h*0.68);g.globalAlpha=1;g.shadowColor=c;g.shadowBlur=8;g.strokeStyle=c;g.lineWidth=2;
      if(i%2)g.strokeRect(x,y,rand(12,26),rand(6,10));else{g.beginPath();g.arc(x,y,rand(4,7),0,7);g.stroke();}}
    g.shadowBlur=0;g.globalAlpha=0.35;g.strokeStyle='#b8c8ec';g.lineWidth=1;
    for(let i=0;i<70;i++){const x=rand(0,w),y=rand(0,h);g.beginPath();g.moveTo(x,y);g.lineTo(x-2,y+9);g.stroke();}
    g.globalAlpha=1;}},
  theme:{
    ground:'neo_asphalt',walls:[['neo_brick',0.45],['neo_concwall',0.3],['brick',0.1],['corrugated',0.15]],paving:'neo_tiles',stairs:'neo_slab',
    roof:'neo_concwall',lowWall:'neo_concwall',lowWallCap:'neo_concwall',cap:'neo_concwall',
    tints:[[0.78,0.74,0.84],[0.9,0.84,0.86],[0.74,0.78,0.88],[0.92,0.86,0.8],[0.82,0.82,0.9]],groundTint:[1,1,1],
    decor:{window:['neo_winWarm','neo_winWarm','neo_winCool','window'],winY:3.6,winP:0.24,door:'neo_shutter',doorP:0.07,lamp:null,lampP:0,
      awnings:['awnR','awnB'],awnP:0.04,streetlamp:'neo_lamppost',slP:0.045,
      extras:[{asset:['neo_signBowl','neo_signOpen','neo_signArrow','neo_signCocktail'],p:0.1,y:3.0,minH:5.5},
        {asset:['neo_signBladeP','neo_signBladeC'],p:0.05,y:3.4,minH:7},
        {asset:'neo_acunit',p:0.06,y:4.8,minH:6.5},{asset:'neo_pipes',p:0.04,y:0,minH:7.5},{asset:'neo_bags',p:0.03,y:0}],
      vehicles:['neo_taxi','neo_taxi','sedan','sedan2','van'],vehicleH:{neo_taxi:1.5}},
    // night: dark navy sky with a magenta city glow on the horizon, cool moonlight, warm street-light bounce from below
    sky:{top:0x070a1c,mid:0x181b3c,horizon:0x5a3358,ground:0x0e0d16,sun:0xc8d4ff,sunDir:[-0.35,0.55,-0.45],clouds:0.7,stars:0.3,cloudColor:0x3d3552},
    sunColor:0xbfcaff,sunI:0.85,hemiSky:0x9096b8,hemiGround:0x7a5e4e,hemiI:1.95,fog:0x2a2438,fogNear:30,fogFar:175,
    exposure:1.25,grade:{sat:1.02,contrast:1.06,lift:[0.005,0.0,0.02],gain:[1.04,1.0,1.02]},particles:'rain'
  }
};
MAP_ORDER.push('neonrow');
