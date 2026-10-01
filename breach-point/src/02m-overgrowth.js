/* =====================================================================
   Overgrowth: ancient temple ruins swallowed by the jungle.
   A is a stepped pyramid court, B a flooded bath court with a plank
   boardwalk across the pool, mid is the Idol Court. Props are the
   ovg_* Blender assets (work/overgrowth/blender/overgrowth_props.py).
   ===================================================================== */
// tileable stone courses: rows of blocks whose widths add up to the canvas width
function ovgCourses(g,w,h,rows,minW,maxW,draw){
  const rh=h/rows;
  for(let r=0;r<rows;r++){
    const ws=[];let sum=0;while(sum<w-minW){const bw=rand(minW,maxW);ws.push(bw);sum+=bw;}
    const k=w/sum;let x=rand(0,w);
    for(const bw0 of ws){const bw=bw0*k;for(const ox of[0,-w])draw(x+ox,r*rh,bw,rh,r);x+=bw;}
  }
}
function ovgMoss(g,w,h,n,a){ // moss creeping over the tops of blocks and in patches
  blotches(g,w,h,n,['#4f6f26','#62822e','#3d5a1f','#71903a'],14,60,a);
  for(let i=0;i<n*14;i++){g.fillStyle=pick(['#5b7d2a','#6f9234','#47661f']);g.globalAlpha=rand(0.25,0.6);
    g.fillRect(Math.random()*w,Math.random()*h,rand(1,3),rand(1,3));}g.globalAlpha=1;
}
function ovgBlock(g,x,y,bw,bh,base,l){
  g.fillStyle=`rgb(${base[0]+l},${base[1]+l},${base[2]+l})`;g.fillRect(x+3,y+3,bw-6,bh-6);
  g.fillStyle='rgba(255,255,240,.08)';g.fillRect(x+3,y+3,bw-6,4);g.fillStyle='rgba(0,0,0,.12)';g.fillRect(x+3,y+bh-9,bw-6,6);
  g.fillStyle='rgba(0,0,0,.08)';g.fillRect(x+bw-8,y+3,5,bh-6);
}
function ovgFret(g,x,y,s,col){ // a stepped spiral glyph
  g.strokeStyle=col;g.lineWidth=s*0.12;g.beginPath();
  g.moveTo(x,y+s);g.lineTo(x,y);g.lineTo(x+s,y);g.lineTo(x+s,y+s*0.75);g.lineTo(x+s*0.25,y+s*0.75);g.lineTo(x+s*0.25,y+s*0.25);g.lineTo(x+s*0.75,y+s*0.25);g.lineTo(x+s*0.75,y+s*0.5);g.stroke();
}
// mossy carved stone wall blocks
SURFACES.ovg_moss=[(g,w,h)=>{
  g.fillStyle='#4a4c3e';g.fillRect(0,0,w,h);
  ovgCourses(g,w,h,6,70,150,(x,y,bw,bh)=>{ovgBlock(g,x,y,bw,bh,[108,110,97],rand(-16,12));});
  speckle(g,w,h,7000,['#3e4032','#b4b29a','#6c6c56','#5a6a3a'],1,2.4);
  blotches(g,w,h,16,['#6a6a54','#a4a28a'],20,80,0.2);
  ovgMoss(g,w,h,34,0.55);
  streaks(g,w,h,18,'rgba(40,46,30,.5)',0.6);
  for(let i=0;i<10;i++){let x=Math.random()*w,y=Math.random()*h;g.strokeStyle='rgba(30,32,24,.45)';g.lineWidth=1.2;g.beginPath();g.moveTo(x,y);
    for(let k=0;k<6;k++){x+=rand(-10,10);y+=rand(4,14);g.lineTo(x,y);}g.stroke();}
},3.6,0.93];
// carved relief wall: a fret frieze and glyph panels between plain courses
SURFACES.ovg_carved=[(g,w,h)=>{
  g.fillStyle='#4c4a3c';g.fillRect(0,0,w,h);
  ovgCourses(g,w,h,8,90,170,(x,y,bw,bh,r)=>{if(r===3||r===4)return;ovgBlock(g,x,y,bw,bh,[116,116,101],rand(-14,10));});
  // frieze band across rows 3-4 (tileable: 8 panels of 64 px)
  const y0=h*3/8,bh=h*2/8;g.fillStyle='#8a8670';g.fillRect(0,y0+3,w,bh-6);
  for(let i=0;i<8;i++){const x=i*64;g.fillStyle='rgba(0,0,0,.18)';g.fillRect(x+2,y0+6,60,bh-12);
    g.fillStyle='#9a957c';g.fillRect(x+5,y0+9,54,bh-18);
    if(i%2){ovgFret(g,x+12,y0+22,40,'#4a4636');ovgFret(g,x+12,y0+72,40,'#4a4636');}
    else{g.fillStyle='#4a4636';g.fillRect(x+16,y0+22,32,30);g.fillStyle='#9a957c';g.fillRect(x+22,y0+30,7,7);g.fillRect(x+35,y0+30,7,7);g.fillRect(x+24,y0+43,16,4);
      g.fillStyle='#4a4636';for(let k=0;k<3;k++)g.fillRect(x+14+k*13,y0+66,8,40);}}
  g.fillStyle='rgba(0,0,0,.35)';g.fillRect(0,y0,w,4);g.fillRect(0,y0+bh-4,w,4);
  speckle(g,w,h,8000,['#3a3a2e','#c0bca2','#6a6a54'],1,2.4);
  ovgMoss(g,w,h,26,0.5);
  streaks(g,w,h,22,'rgba(36,40,28,.55)',0.6);
},3.8,0.92];
// packed jungle earth with grass patches, pebbles and leaf litter
SURFACES.ovg_earth=[(g,w,h)=>{
  g.fillStyle='#665641';g.fillRect(0,0,w,h);
  blotches(g,w,h,40,['#5a4b37','#76654a','#4e4231','#806d4f'],30,110,0.45);
  blotches(g,w,h,26,['#4c6a28','#5a7a2e','#41602a'],30,95,0.55);
  speckle(g,w,h,9000,['#3e3324','#8c7a5c','#5a4a34','#4f6a2a'],1,2.5);
  for(let c=0;c<22;c++){const cx_=Math.random()*w,cy_=Math.random()*h,rr=rand(20,55);
    for(let i=0;i<150;i++){const a=Math.random()*6.283,d=Math.sqrt(Math.random())*rr;const x=(cx_+Math.cos(a)*d+w)%w,y=(cy_+Math.sin(a)*d+h)%h;
      g.strokeStyle=pick(['#5f8a2c','#4c7224','#77a03a','#3e5f1e']);g.globalAlpha=rand(0.5,0.9);g.lineWidth=1.2;g.beginPath();g.moveTo(x,y);g.lineTo(x+rand(-3,3),y-rand(4,9));g.stroke();}}
  g.globalAlpha=1;
  for(let i=0;i<160;i++){g.fillStyle=pick(['#8a7a62','#6e6450','#9c907a']);g.globalAlpha=0.7;g.beginPath();g.ellipse(Math.random()*w,Math.random()*h,rand(1.5,4),rand(1,3),rand(0,3),0,7);g.fill();}
  for(let i=0;i<120;i++){g.fillStyle=pick(['#7a5a2a','#946a2e','#5e4a26','#a07a3a']);g.globalAlpha=rand(0.5,0.85);g.beginPath();g.ellipse(Math.random()*w,Math.random()*h,rand(3,7),rand(1.5,3),rand(0,3),0,7);g.fill();}
  g.globalAlpha=1;
},2.4,0.96];
// worn stone paving with moss in the joints
SURFACES.ovg_paving=[(g,w,h)=>{
  g.fillStyle='#3e4030';g.fillRect(0,0,w,h);
  ovgCourses(g,w,h,5,80,170,(x,y,bw,bh)=>{const l=rand(-16,14);g.fillStyle=`rgb(${140+l},${138+l},${122+l})`;g.fillRect(x+4,y+4,bw-8,bh-8);
    const gr=g.createRadialGradient(x+bw/2,y+bh/2,4,x+bw/2,y+bh/2,bw*0.6);gr.addColorStop(0,'rgba(255,250,230,.12)');gr.addColorStop(1,'rgba(0,0,0,.1)');g.fillStyle=gr;g.fillRect(x+4,y+4,bw-8,bh-8);});
  // moss and grass in the joints
  for(let r=0;r<=5;r++){const y=r*h/5;for(let i=0;i<130;i++){g.fillStyle=pick(['#4e6e26','#5f822e','#3f5a20']);g.globalAlpha=rand(0.4,0.8);g.fillRect(Math.random()*w,y+rand(-5,4),rand(2,6),rand(2,5));}}
  g.globalAlpha=1;speckle(g,w,h,8000,['#4a4a3a','#d0caae','#6a6a54'],1,2.2);
  ovgMoss(g,w,h,10,0.35);
  for(let i=0;i<9;i++){let x=Math.random()*w,y=Math.random()*h;g.strokeStyle='rgba(40,40,30,.5)';g.lineWidth=1.2;g.beginPath();g.moveTo(x,y);for(let k=0;k<7;k++){x+=rand(-14,14);y+=rand(-14,14);g.lineTo(x,y);}g.stroke();}
},3.2,0.9];
// big terrace blocks for the pyramid, stairs and pool edges
SURFACES.ovg_terrace=[(g,w,h)=>{
  g.fillStyle='#4a4a3a';g.fillRect(0,0,w,h);
  ovgCourses(g,w,h,4,110,200,(x,y,bw,bh)=>{ovgBlock(g,x,y,bw,bh,[136,134,115],rand(-14,12));
    g.fillStyle='rgba(60,60,40,.25)';g.fillRect(x+10,y+bh*0.5,bw-20,3);});
  speckle(g,w,h,8000,['#4a4a3a','#cfc9ad','#707058'],1,2.4);blotches(g,w,h,14,['#6e6c56','#b4ae92'],20,80,0.22);
  ovgMoss(g,w,h,18,0.45);
},3.2,0.9];
// moss and grass growing over wall tops and low walls
SURFACES.ovg_mosscap=[(g,w,h)=>{
  g.fillStyle='#4f6a2a';g.fillRect(0,0,w,h);
  blotches(g,w,h,40,['#5c7a2e','#3f5a22','#6a8a36','#47622a'],20,80,0.55);
  speckle(g,w,h,9000,['#2f4618','#7aa040','#5a7a2a','#8a9a5a'],1,3);
  for(let i=0;i<600;i++){g.strokeStyle=pick(['#6a9434','#4c7024','#83aa48']);g.globalAlpha=rand(0.4,0.8);const x=Math.random()*w,y=Math.random()*h;g.beginPath();g.moveTo(x,y);g.lineTo(x+rand(-3,3),y-rand(3,8));g.stroke();}
  g.globalAlpha=1;
},2.6,0.97];

MAPS.overgrowth={
  id:'overgrowth',name:'Overgrowth',tag:'JUNGLE',
  desc:'Temple ruins lost in the jungle. A is a stepped pyramid court, B a flooded bath court crossed by a plank walk.',
  grid(F){
    // north: Warden temple gate, colonnades and the steps down to each site
    F(26,2,37,9);F(31,5,32,6,'#');                        // Temple Gate (Warden spawn) around an overgrown obelisk
    F(14,4,23,8);F(24,4,25,6);F(40,4,49,8);F(38,6,39,8);  // West / East Colonnade and their gates
    F(5,4,13,7);F(50,4,58,7);                             // colonnade wings
    F(11,9,17,13);F(46,9,52,13);                          // Temple Steps (to A), Bath Steps (to B)
    F(5,8,7,13);F(56,8,58,13);                            // Vine Stair (A north-west), Bath Stair (B north-east)
    // the sites
    F(4,14,21,31);                                        // A: pyramid court
    F(42,14,59,31);                                       // B: flooded court
    // mid
    F(29,10,34,29);                                       // Upper Hall
    F(29,19,30,19,'#');F(31,19,32,19,'d');F(33,19,34,19,'#');
    F(24,30,39,39);                                       // Idol Court
    F(29,40,34,50);                                       // Lower Mid
    F(25,51,38,58);                                       // Base Camp (Striker spawn)
    // A side: Serpent Hall tunnel from the Idol Court, Camp West and the Jungle Path bend
    F(22,26,27,27,'=');F(26,28,27,29,'=');
    F(10,43,23,49);F(20,49,24,52);
    F(10,40,15,43);F(5,38,15,40);F(5,32,10,37);
    // B side: Moat Bridge from the Idol Court, Camp East and the Aqueduct bend with its canal
    F(36,29,37,29,'1');F(36,28,37,28,'2');F(36,27,37,27,'3');F(36,25,41,26,'4');
    F(38,23,41,24,'~');F(38,27,41,28,'~');
    F(42,25,42,26,'3');F(43,25,43,26,'2');F(44,25,44,26,'1');
    F(40,43,53,49);F(40,49,43,52);F(39,53,43,55);
    F(48,40,53,43);F(48,38,57,40);F(52,32,57,37);
    F(58,33,58,39,'~');
    // A: stepped pyramid (1 m terrace ring, 2 m top) with stairs on the north, south and east
    F(8,18,16,26,'2');F(10,20,14,24,'4');
    F(11,27,13,27,'1');F(11,25,13,25,'3');
    F(11,17,13,17,'1');F(11,19,13,19,'3');
    F(17,21,17,23,'1');F(15,21,15,23,'3');
    F(8,21,10,23,'#');                                    // shrine tower on the pyramid's west side
    // B: pool with a plank walk across it
    F(46,18,55,25,'~');F(46,21,55,22);
    F(50,26,52,29,'#');                                   // ruined bath house
    // ---- cover and props
    // Temple Gate and colonnades
    F(26,2,26,2,'S');F(37,2,37,2,'S');F(27,9,27,9,'Y');F(36,9,36,9,'Y');
    for(const c of[16,19,22])F(c,4,c,4,'R');for(const c of[16,19,22])F(c,8,c,8,'R');
    for(const c of[41,44,47])F(c,4,c,4,'R');for(const c of[41,44])F(c,8,c,8,'R');
    F(11,9,11,9,'F');F(52,9,52,9,'F');F(17,12,17,12,'j');F(46,12,46,12,'j');
    for(const c of[7,10])F(c,4,c,4,'R');for(const c of[53,56])F(c,4,c,4,'R');F(5,7,5,7,'F');F(58,7,58,7,'F');F(7,11,7,11,'j');F(56,11,56,11,'j');
    // A court
    F(5,15,5,15,'R');F(20,15,20,15,'R');F(8,15,8,15,'F');F(15,15,16,15,'w');F(21,14,21,14,'Y');
    F(4,19,4,19,'j');F(5,22,5,22,'G');F(6,26,6,26,'F');
    F(12,29,12,29,'A');F(6,29,7,29,'w');F(18,30,18,30,'R');F(15,31,15,31,'F');F(4,31,4,31,'Y');
    F(19,18,19,18,'R');F(21,21,21,21,'F');F(20,25,20,25,'j');F(20,29,20,29,'L');
    // B court
    F(45,17,45,17,'R');F(56,17,56,17,'R');F(56,26,56,26,'R');
    F(43,14,43,14,'F');F(49,15,50,15,'w');F(59,14,59,14,'j');F(42,17,42,17,'Y');F(59,17,59,17,'Y');
    F(58,19,58,19,'A');F(59,24,59,25,'w');
    F(43,19,43,20,'w');F(42,23,42,23,'F');
    F(49,29,49,29,'L');F(55,28,56,28,'w');F(47,30,47,30,'F');F(58,30,58,30,'j');F(44,29,45,29,'w');
    // Upper Hall
    F(29,13,29,13,'R');F(34,16,34,16,'j');F(34,23,34,23,'F');F(29,26,29,26,'R');
    // Idol Court
    F(29,34,30,35,'#');F(31,34,32,35,'i');F(33,34,34,35,'#');F(30,36,30,36,'Y');F(33,36,33,36,'Y');   // idol shrine gate
    F(24,38,24,38,'R');F(39,38,39,38,'R');F(28,32,28,33,'w');F(35,37,36,37,'w');F(24,34,24,34,'F');F(39,33,39,33,'F');
    // Lower Mid
    F(30,44,30,44,'L');F(34,47,34,47,'F');F(33,41,33,41,'j');F(29,49,29,49,'F');
    // Base Camp (expedition tents and supplies)
    F(26,57,26,58,'X');F(37,57,37,58,'X');
    F(26,53,26,53,'C');F(26,54,26,54,'c');F(37,51,37,51,'m');F(36,51,36,51,'c');F(34,58,34,58,'C');F(35,58,35,58,'c');F(29,58,29,58,'o');F(31,58,31,58,'Y');
    // Camp West and the Jungle Path
    F(12,44,12,44,'z');F(21,44,21,44,'z');F(16,48,16,48,'z');F(19,47,19,47,'L');F(11,49,11,49,'F');F(23,46,23,46,'F');F(14,46,14,46,'c');F(22,51,22,51,'F');
    F(6,33,6,33,'z');F(9,36,9,36,'z');F(14,42,14,42,'z');F(5,35,5,35,'F');F(13,41,13,41,'F');F(10,43,10,43,'F');F(8,34,8,34,'G');F(5,39,5,39,'j');F(11,39,11,39,'z');
    // Camp East and the Aqueduct
    F(42,44,42,44,'z');F(47,48,47,48,'z');F(44,46,44,46,'c');F(50,45,50,45,'C');F(52,48,52,48,'o');F(40,47,40,47,'F');F(42,55,42,55,'F');F(41,50,41,50,'F');
    F(52,35,52,35,'F');F(55,39,55,39,'j');F(49,44,49,44,'z');F(53,41,53,41,'G');F(57,32,57,32,'R');F(57,37,57,37,'F');
  },
  props:{
    R:{asset:'ovg_column',h:2.6,w:0.55,mat:'stone',rot:'random'},
    S:{asset:'ovg_stela',h:2.8,w:0.55,mat:'stone',rot:Math.PI},
    F:{asset:'ovg_fern',h:0.85,w:0.6,mat:'wood',pen:3,rot:'random'},
    A:{asset:'ovg_altar',h:1.2,w:0.95,mat:'stone',rot:'grid'},
    L:{asset:'ovg_log',h:0.8,w:0.95,mat:'wood',pen:1,rot:0},
    G:{asset:'ovg_log',h:0.8,w:0.95,mat:'wood',pen:1,rot:Math.PI/2},
    Y:{asset:'ovg_brazier',h:1.3,w:0.42,mat:'stone',rot:'random'},
    j:{asset:'ovg_rubble',h:0.6,w:0.8,mat:'stone',rot:'random'},
    i:{asset:'ovg_rubble',h:3.4,w:1.0,mat:'stone',rot:'random'},
    X:{asset:'ovg_bedroll',h:2.0,w:0.95,mat:'wood',pen:1,rot:0}
  },
  extras:[
    {asset:'ovg_idol',at:[32,35],rot:Math.PI},
    {asset:'ovg_tent',at:[26.5,58],rot:0},{asset:'ovg_tent',at:[37.5,58],rot:0},
    // pyramid top: altar and braziers
    {asset:'ovg_altar',at:[11.62,22.5],y:2,rot:-Math.PI/2,collide:{w:0.62,d:0.95,h:1.2}},
    {asset:'ovg_brazier',at:[10.5,20.5],y:2,collide:{w:0.4,h:1.3}},{asset:'ovg_brazier',at:[10.5,24.5],y:2,collide:{w:0.4,h:1.3}},
    // flooded court: broken columns standing in the pool
    {asset:'ovg_column',at:[48.5,19.5],y:-0.9,rot:0.4},{asset:'ovg_column',at:[53.5,24.5],y:-0.9,rot:2.1},{asset:'ovg_column',at:[51.5,18.5],y:-1.2,rot:1.2,scale:0.9},
    // plank walk across the pool and rope rails on the moat bridge
    ...[46,47,48,49,50,51,52,53,54,55].map(c=>({asset:'ovg_bridge',at:[c+0.5,22],rot:0})),
    ...[38,39,40,41].map(c=>({asset:'ovg_bridge',at:[c+0.5,26],y:2,rot:0})),
    // lily pads on the pool, the moat and the canal
    ...[[47.3,18.9,0],[54.2,19.7,1],[50.6,24.5,2],[46.9,24.2,3],[52.4,18.6,4],[39.5,23.8,5],[40.7,28.1,1],[58.5,35.2,2]].map(([x,z,r])=>({asset:'ovg_lilies',at:[x,z],y:-0.7,rot:r,scale:0.8}))
  ],
  spawns:{W:[[28,3],[33,3],[35,5],[28,7],[34,8]],S:[[29,54],[31,55],[33,54],[30,57],[33,57]]},
  spawnZone:{W:[26,2,37,9],S:[25,51,38,58]},
  sites:{A:{c0:4,r0:14,c1:21,r1:31,center:[12,22]},B:{c0:42,r0:14,c1:59,r1:31,center:[51,21]}},
  zones:[['Pyramid Top',10,20,14,24],['Pyramid',8,17,17,27],['A Court',4,14,21,31],['Temple Steps',11,9,17,13],['Vine Stair',5,8,7,13],['West Colonnade',5,4,25,8],
    ['Temple Gate',26,2,37,9],['East Colonnade',38,4,58,8],['Bath Steps',46,9,52,13],['Bath Stair',56,8,58,13],['Boardwalk',46,21,55,22],['Flooded Court',42,14,59,31],
    ['Upper Hall',29,10,34,29],['Serpent Hall',22,26,27,29],['Moat Bridge',36,25,41,29],['Idol Court',24,30,39,39],['Lower Mid',29,40,34,50],
    ['Base Camp',25,51,38,58],['Jungle Path',5,32,15,42],['Camp West',10,43,24,52],['Aqueduct',48,32,58,42],['Camp East',39,43,53,55]],
  siteOfZone:{'Pyramid Top':'A','Pyramid':'A','A Court':'A','Temple Steps':'A','Vine Stair':'A','West Colonnade':'A','Bath Stair':'B','Jungle Path':'A','Camp West':'A','Serpent Hall':'A',
    'Flooded Court':'B','Boardwalk':'B','Bath Steps':'B','East Colonnade':'B','Aqueduct':'B','Camp East':'B','Moat Bridge':'B'},
  plans:{
    A:[{route:'jungle',stage:[17,46],entry:[[12,41],[7,39],[7,33],[8,29]],smoke:[[13,12],[19,16]],flash:[[12,22]]},
       {route:'serpent',stage:[26,33],entry:[[26,29],[25,26],[21,26],[18,25]],smoke:[[13,12]],flash:[[16,23]]}],
    B:[{route:'aqueduct',stage:[45,46],entry:[[50,39],[55,37],[55,32],[57,27]],smoke:[[50,12],[44,21]],flash:[[57,22]]},
       {route:'bridge',stage:[36,32],entry:[[36,28],[38,25],[42,25],[45,27]],smoke:[[50,12]],flash:[[50,21]]}]},
  siteSpots:{A:[[12,22],[13,21],[11,23],[6,17],[19,20],[7,28],[17,28]],B:[[57,22],[57,15],[44,16],[44,27],[48,28],[54,30],[50,21]]},
  plantSpot:{A:[12,22],B:[57,22]},
  holds:{A:[{c:[13,21],l:[8,33]},{c:[19,16],l:[21,26]},{c:[5,17],l:[7,31]},{c:[13,11],l:[12,27]},{c:[17,24],l:[22,26]}],
    B:[{c:[57,15],l:[55,31]},{c:[44,15],l:[43,25]},{c:[52,14],l:[56,29]},{c:[58,23],l:[56,31]}],
    M:[{c:[31,13],l:[31,28]},{c:[33,24],l:[36,31]}]},
  signs:[{t:'A',c:LETTER_RED,x:4,z:23,nx:1,nz:0,s:3.6,y:3.4},{t:'A',c:LETTER_RED,x:11,z:22.5,nx:1,nz:0,s:2.6,y:4.6},{t:'A',c:LETTER_RED,x:22,z:19.5,nx:-1,nz:0,s:3.2,y:3.2},
    {t:'A',c:LETTER_RED,x:17.5,z:32,nx:0,nz:-1,s:3,y:3},
    {t:'B',c:LETTER_RED,x:60,z:21.5,nx:-1,nz:0,s:3.6,y:3.4},{t:'B',c:LETTER_RED,x:44,z:14,nx:0,nz:1,s:3,y:3.2},
    {t:'B',c:LETTER_RED,x:46.5,z:32,nx:0,nz:-1,s:3,y:3},
    {t:'A',c:LETTER_PALE,x:27,z:51,nx:0,nz:1,s:2.2,y:2.7,a:-1},{t:'B',c:LETTER_PALE,x:36.5,z:51,nx:0,nz:1,s:2.2,y:2.7,a:1},
    {t:'A',c:LETTER_PALE,x:25,z:30,nx:0,nz:1,s:2.2,y:2.6,a:1},{t:'B',c:LETTER_PALE,x:39,z:30,nx:0,nz:1,s:2.2,y:2.6,a:-1},
    {t:'A',c:LETTER_PALE,x:19,z:43,nx:0,nz:1,s:2.4,y:2.7,a:-1},{t:'B',c:LETTER_PALE,x:44,z:43,nx:0,nz:1,s:2.4,y:2.7,a:1},
    {t:'A',c:LETTER_PALE,x:13,z:38,nx:0,nz:1,s:2.2,y:2.6,a:-1},{t:'B',c:LETTER_PALE,x:50,z:38,nx:0,nz:1,s:2.2,y:2.6,a:1},
    {t:'A',c:LETTER_PALE,x:27.5,z:10,nx:0,nz:-1,s:2.2,y:2.8,a:1},{t:'B',c:LETTER_PALE,x:36.5,z:10,nx:0,nz:-1,s:2.2,y:2.8,a:-1}],
  trees:{type:['ovg_tree','ovg_treeB'],cell:['ovg_tree','ovg_treeB'],cellScale:[0.52,0.64],min:0.85,max:1.25,
    at:[[2,13],[2,24],[2,34],[23,15],[25,21],[38,15],[38,20],[8,2],[20,1],[44,1],[56,2],[61,12],[61,25],[62,40],[6,57],[20,58],[44,58],[58,56],
      [5,44],[3,52],[20,36],[24,44],[18,41],[41,42],[45,34],[44,37],[61,49],[36,62],[12,62]]},
  paved:[[26,2,37,9],[14,4,25,8],[38,4,49,8],[5,4,13,7],[50,4,58,7],[5,8,7,13],[56,8,58,13],[29,10,34,29],[24,30,39,39],[29,40,34,50],[22,26,27,27],[26,28,27,29],
    [42,14,59,17],[42,18,45,31],[56,18,59,31],[46,26,55,31],[48,38,57,40],[52,32,57,37]],
  roofs:[],
  water:'plain',
  menuSpot:[31,38],menuAngle:0,
  art:{wall:'#55604a',wall2:'#6c6c56',ground:'#4a5530',draw(g,w,h){
    const st=['#7a7862','#86846c','#908e74','#9a987e'];
    for(let i=0;i<4;i++){const bw=w*(0.42-i*0.08),bh=h*0.07;g.fillStyle=st[i];g.fillRect(w*0.32-bw/2,h*0.78-bh*(i+1),bw,bh);}
    g.fillStyle='#5e5c4a';g.fillRect(w*0.32-6,h*0.78-h*0.28,12,h*0.28);
    g.fillStyle='#ff9a3a';g.beginPath();g.arc(w*0.32-w*0.09,h*0.78-h*0.3,3,0,7);g.arc(w*0.32+w*0.09,h*0.78-h*0.3,3,0,7);g.fill();
    for(const[x,y,r,c]of[[0.05,0.22,34,'#2f5222'],[0.18,0.12,30,'#3c6a28'],[0.86,0.18,38,'#2f5222'],[0.7,0.1,28,'#46762e'],[0.98,0.32,26,'#3c6a28'],[0.55,0.06,22,'#2a4a1e']]){
      g.fillStyle=c;g.beginPath();g.ellipse(w*x,h*y,r*1.3,r*0.7,0,0,7);g.fill();}
    g.strokeStyle='rgba(60,90,40,.85)';g.lineWidth=2;for(const x of[0.08,0.15,0.83,0.9,0.95]){g.beginPath();g.moveTo(w*x,h*0.2);g.quadraticCurveTo(w*x+6,h*0.4,w*x-2,h*(0.5+Math.random()*0.15));g.stroke();}
    g.fillStyle='rgba(230,255,150,.9)';for(let i=0;i<14;i++)g.fillRect(Math.random()*w,h*0.35+Math.random()*h*0.4,2,2);}},
  theme:{
    ground:'ovg_earth',walls:[['ovg_moss',0.6],['ovg_carved',0.4]],paving:'ovg_paving',stairs:'ovg_terrace',roof:'ovg_terrace',
    lowWall:'ovg_terrace',lowWallCap:'ovg_mosscap',cap:'ovg_mosscap',quay:'ovg_terrace',groundTint:[0.86,0.86,0.82],waterColor:0x1c3a2a,
    decor:{window:null,winP:0,door:null,doorP:0,lamp:null,lampP:0,awnings:null,awnP:0,streetlamp:null,slP:0,
      extras:[{asset:'ovg_vines',p:0.16,minH:5},{asset:'ovg_fern',p:0.06,out:0.45}],vehicles:['van'],vehicleH:{}},
    tints:[[1,1,1],[0.92,0.97,0.9],[1,0.97,0.9],[0.9,0.95,0.92],[0.96,1,0.94]],
    sky:{top:0x5e7c74,mid:0x9cb3a0,horizon:0xd0d8c0,ground:0x46522f,sun:0xfff0c8,sunDir:[0.45,0.62,0.55],clouds:0.85,cloudColor:0xe6ece0},
    sunColor:0xfff2dc,sunI:1.6,hemiSky:0xd4e2d8,hemiGround:0x7c8a66,hemiI:1.05,fog:0xa4b4a2,fogNear:34,fogFar:195,
    exposure:0.82,grade:{sat:1.0,contrast:1.03,lift:[0.012,0.018,0.014],gain:[0.98,1.02,0.98]},particles:['spores','leaves']
  }
};
MAP_ORDER.push('overgrowth');
