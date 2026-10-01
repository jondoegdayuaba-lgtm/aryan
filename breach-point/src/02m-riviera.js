/* =====================================================================
   Map: Riviera. A sunny fishing village on a hillside by the sea in the
   late-afternoon sun. Site A is the church piazza under the bell tower,
   site B is the harbour quay with boats moored along the jetty. Mid is the
   market street that drops through the fountain square; the lemon terraces
   (west) and the waterfront promenade (east) are the long routes.
   Props come from work/riviera/blender/riviera_props.py (names start with riv_).
   ===================================================================== */

// ---- surfaces (512 x 512 canvas drawings) ----
(function(){
  const wrapDraw=(g,w,h,x,y,f)=>{for(const ox of[-w,0,w])for(const oy of[-h,0,h]){g.save();g.translate(x+ox,y+oy);f();g.restore();}};
  // half-round clay roof tiles (coppi) in overlapping courses: wall caps and low-wall caps
  SURFACES.riv_terracotta=[(g,w,h)=>{
    g.fillStyle='#7a3a20';g.fillRect(0,0,w,h);const cols=16,rows=8,tw=w/cols,th=h/rows;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const x=c*tw,y=r*th,l=rand(-16,14),base=[184+l,92+l*0.7,52+l*0.5];
      const gr=g.createLinearGradient(x,0,x+tw,0);
      gr.addColorStop(0,`rgb(${base[0]*0.62|0},${base[1]*0.6|0},${base[2]*0.6|0})`);gr.addColorStop(0.35,`rgb(${base[0]|0},${base[1]|0},${base[2]|0})`);
      gr.addColorStop(0.55,`rgb(${Math.min(255,base[0]*1.12)|0},${Math.min(255,base[1]*1.12)|0},${Math.min(255,base[2]*1.1)|0})`);gr.addColorStop(1,`rgb(${base[0]*0.55|0},${base[1]*0.52|0},${base[2]*0.5|0})`);
      g.fillStyle=gr;g.fillRect(x+1,y,tw-2,th+6);
      g.fillStyle='rgba(40,16,8,.45)';g.fillRect(x+1,y+th-3,tw-2,4);           // shadow under the next course
      g.fillStyle='rgba(255,220,180,.12)';g.fillRect(x+tw*0.42,y+2,tw*0.12,th-6);
    }
    blotches(g,w,h,22,['#5a4a30','#8a8a6a','#c87a4a'],12,50,0.22);           // lichen and weathering
    speckle(g,w,h,5000,['#4a2010','#e0a070','#6a6a50'],1,2);
  },3.0,0.82];
  // lime-washed stucco, near white so the pastel tints show; a few worn patches show the stone underneath
  SURFACES.riv_stucco=[(g,w,h)=>{
    g.fillStyle='#f7f3ec';g.fillRect(0,0,w,h);
    blotches(g,w,h,50,['#efe8dc','#fffdf9','#ebe3d6'],30,130,0.22);
    speckle(g,w,h,6000,['#d8cebe','#ffffff','#c8bca8'],1,2);
    for(let i=0;i<2;i++){const x=rand(0,w),y=rand(h*0.45,h*0.9),pw=rand(50,90),ph=rand(26,44);
      wrapDraw(g,w,h,x,y,()=>{g.fillStyle='rgba(206,190,166,.32)';g.beginPath();
        for(let k=0;k<=14;k++){const a=k/14*Math.PI*2;const rr=0.8+0.25*Math.sin(a*3+x)+0.1*Math.sin(a*7);const px=Math.cos(a)*pw/2*rr,py=Math.sin(a)*ph/2*rr;k?g.lineTo(px,py):g.moveTo(px,py);}g.closePath();g.fill();
        g.fillStyle='rgba(160,140,112,.22)';for(let k=0;k<5;k++)g.fillRect(rand(-pw*0.3,pw*0.2),rand(-ph*0.3,ph*0.25),rand(12,24),rand(5,8));});}
    g.strokeStyle='rgba(140,124,104,.22)';g.lineWidth=1;
    for(let i=0;i<5;i++){let x=rand(0,w),y=rand(0,h);g.beginPath();g.moveTo(x,y);for(let k=0;k<6;k++){x+=rand(-10,10);y+=rand(4,14);g.lineTo(x,y);}g.stroke();}
    streaks(g,w,h,8,'rgba(150,140,120,.2)',0.4);
  },0.7,0.94];
  // rounded cobbles in warm grey and beige with dark joints (streets)
  SURFACES.riv_cobble=[(g,w,h)=>{
    g.fillStyle='#6e6456';g.fillRect(0,0,w,h);
    for(let y=0;y<h+24;y+=26)for(let x=-((y/26)%2?14:0);x<w+24;x+=28){const l=rand(-20,16),warm=Math.random()<0.5;
      const cx=x+rand(-2,2),cy=y+rand(-2,2),rx=rand(11,13.5),ry=rand(9.5,11.5),a=rand(0,3);
      g.fillStyle=warm?`rgb(${176+l},${160+l},${136+l})`:`rgb(${158+l},${154+l},${146+l})`;
      wrapDraw(g,w,h,cx,cy,()=>{g.beginPath();g.ellipse(0,0,rx,ry,a,0,7);g.fill();g.fillStyle='rgba(255,250,235,.16)';g.beginPath();g.ellipse(-3,-3,rx*0.55,ry*0.45,a,0,7);g.fill();
        g.fillStyle='rgba(30,24,18,.18)';g.beginPath();g.ellipse(2,3,rx*0.7,ry*0.5,a,0,7);g.fill();});}
    blotches(g,w,h,20,['#5a5040','#c8b898'],20,70,0.18);speckle(g,w,h,6000,['#2a241c','#e8dcc8'],1,2);
  },3.6,0.85];
  // big sandstone flags in running bond (piazzas and the quay)
  SURFACES.riv_flags=[(g,w,h)=>{
    g.fillStyle='#8a7a62';g.fillRect(0,0,w,h);const rows=4,rh=h/rows;
    for(let r=0;r<rows;r++){let x=-(r%2)*64;const ws=[128,96,160,128,112,144];let k=r;
      while(x<w){const bw=ws[k++%ws.length];const l=rand(-14,12);g.fillStyle=`rgb(${214+l},${196+l},${166+l})`;g.fillRect(x+3,r*rh+3,bw-6,rh-6);
        g.fillStyle='rgba(255,255,255,.08)';g.fillRect(x+3,r*rh+3,bw-6,3);g.fillStyle='rgba(60,40,20,.10)';g.fillRect(x+3,r*rh+rh-7,bw-6,4);
        if(x+bw>w){g.fillStyle=`rgb(${214+l},${196+l},${166+l})`;g.fillRect(x+3-w,r*rh+3,bw-6,rh-6);}
        x+=bw;}}
    blotches(g,w,h,26,['#b8a282','#efe2c8','#a08c6c'],20,90,0.22);speckle(g,w,h,9000,['#6a5a44','#fff4dc','#9a8a70'],1,2.2);
    for(let i=0;i<6;i++){let x=rand(0,w),y=rand(0,h);g.strokeStyle='rgba(90,70,50,.3)';g.beginPath();g.moveTo(x,y);for(let k=0;k<5;k++){x+=rand(-12,12);y+=rand(-12,12);g.lineTo(x,y);}g.stroke();}
  },2.6,0.88];
  // worn limestone treads with rounded nosings (stairs and raised terraces)
  SURFACES.riv_steps=[(g,w,h)=>{
    g.fillStyle='#d6cab2';g.fillRect(0,0,w,h);const n=4,s=h/n;
    for(let i=0;i<n;i++){const y=i*s,l=rand(-12,10);const gr=g.createLinearGradient(0,y,0,y+s);
      gr.addColorStop(0,`rgb(${236+l},${226+l},${204+l})`);gr.addColorStop(0.12,`rgb(${222+l},${210+l},${186+l})`);gr.addColorStop(0.85,`rgb(${206+l},${194+l},${170+l})`);gr.addColorStop(1,`rgb(${140+l},${126+l},${104+l})`);
      g.fillStyle=gr;g.fillRect(0,y,w,s);for(let x=rand(0,90);x<w;x+=rand(110,190)){g.fillStyle='rgba(90,74,54,.45)';g.fillRect(x,y,3,s);}}
    blotches(g,w,h,24,['#a89878','#f4ecd8'],20,80,0.2);speckle(g,w,h,8000,['#7a6a52','#ffffff','#a89880'],1,2);
  },2.4,0.9];
  // dark squared harbour masonry with a weed line (quay walls)
  SURFACES.riv_quay=[(g,w,h)=>{
    g.fillStyle='#4a463e';g.fillRect(0,0,w,h);const rows=5,rh=h/rows;
    for(let r=0;r<rows;r++){let x=-(r%2)*70;while(x<w){const bw=rand(110,170),l=rand(-14,12);g.fillStyle=`rgb(${132+l},${124+l},${108+l})`;g.fillRect(x+4,r*rh+4,bw-8,rh-8);
      g.fillStyle='rgba(255,255,255,.06)';g.fillRect(x+4,r*rh+4,bw-8,4);x+=bw;}}
    const gr=g.createLinearGradient(0,0,0,h*0.45);gr.addColorStop(0,'rgba(40,70,40,.55)');gr.addColorStop(1,'rgba(40,70,40,0)');g.fillStyle=gr;g.fillRect(0,0,w,h*0.45);
    speckle(g,w,h,7000,['#2a2820','#c8c0a8','#3a5a30'],1,2);streaks(g,w,h,16,'rgba(30,40,30,.35)',0.5);
  },3.4,0.9];
})();

MAPS.riviera={
  id:'riviera',name:'Riviera',tag:'COAST',
  desc:'A pastel fishing village above the sea. A is the church piazza under the bell tower, B is the harbour quay with the moored boats.',
  grid(F){
    F(57,0,63,63,'~');                                    // the open sea along the east edge
    F(25,1,38,8);                                          // Warden spawn (upper town)
    F(13,6,24,8);F(13,9,16,10);                            // via alta and the church lane down into the piazza
    F(39,1,50,3);F(47,4,50,8);                             // quay road and the ramp down to the harbour
    F(4,11,20,25);                                         // A: church piazza
    F(43,9,56,24);F(57,13,60,14);                          // B: harbour quay and the jetty
    F(30,9,34,18);F(24,17,29,27);                          // market street (upper mid), stepping west half way down
    F(21,17,23,19);F(21,17,21,19,'d');                     // vicolo arch from mid into the piazza
    F(35,13,38,15);F(38,15,42,17);F(36,13,38,15,'=');F(39,15,41,17,'=');   // net loft from mid to the quay (roofed)
    F(25,28,38,35);                                        // fountain square
    F(35,36,38,44);F(30,45,35,52);                         // lower mid
    F(24,53,37,60);                                        // Striker spawn (lower town)
    F(3,50,22,53);F(21,54,23,56);                          // lower alleys
    F(3,27,8,40);F(8,39,13,49);F(5,26,7,26,'d');           // lemon terraces (A long) and the gate into the piazza
    F(9,31,24,32);                                         // scalinata: stairs over the hill to the fountain square
    F(9,31,9,32,'1');F(10,31,10,32,'2');F(11,31,11,32,'3');F(12,31,19,32,'4');F(20,31,20,32,'3');F(21,31,21,32,'2');F(22,31,22,32,'1');
    F(38,56,41,58);F(40,51,56,55);F(51,25,56,51);          // fish market and the waterfront promenade (B long)
    F(54,34,56,39,'~');                                    // fishing inlet
    F(39,41,50,42,'=');                                    // cantina: cellar passage from lower mid to the waterfront
    F(51,43,53,44,'#');                                    // net shed on the promenade
    // A: piazza
    F(4,11,5,12,'Q');                                      // bell tower footprint
    F(4,15,6,22,'2');F(7,15,7,22,'1');                     // raised terrace along the west side
    F(17,12,17,12,'f');F(19,13,19,13,'f');F(17,15,17,15,'f');
    F(10,16,10,16,'U');F(15,21,15,21,'U');
    F(11,23,13,23,'w');F(10,23,10,23,'L');F(14,23,14,23,'L');
    F(20,24,20,25,'z');F(9,25,9,25,'G');F(18,19,18,19,'c');F(13,13,13,13,'L');
    // B: harbour quay
    F(43,9,46,10,'3');F(43,11,46,11,'2');F(43,12,46,12,'1');   // harbour office platform
    F(52,10,52,12,'B');F(45,21,47,21,'B');                 // boats hauled out on the quay
    F(55,10,55,10,'C');F(47,15,47,15,'C');F(44,18,44,18,'C');F(54,16,54,16,'y');F(49,12,49,12,'G');F(56,19,56,19,'G');
    F(50,20,50,20,'N');F(53,18,53,18,'N');F(55,22,55,22,'o');
    // mid
    F(30,11,30,11,'U');F(34,9,34,9,'L');F(32,15,32,15,'G');F(29,23,29,23,'U');F(24,26,24,26,'L');F(29,25,29,26,'v');F(29,18,29,18,'L');
    F(31,31,32,32,'X');                                    // fountain
    F(26,29,26,29,'f');F(27,34,27,34,'f');F(36,29,36,29,'f');F(25,35,25,35,'L');F(38,28,38,28,'L');F(36,34,36,34,'U');
    F(35,39,35,39,'U');F(38,37,38,37,'N');F(37,43,37,43,'c');F(35,48,35,48,'G');F(30,46,30,46,'L');F(31,50,31,50,'N');
    // waterfront, cantina and fish market
    F(52,28,52,30,'B');F(55,27,55,27,'G');F(53,33,53,33,'w');F(52,40,52,40,'w');F(55,45,55,45,'C');F(53,47,53,47,'G');F(51,48,51,48,'N');F(56,49,56,49,'o');
    F(42,42,42,42,'o');F(47,41,47,41,'o');
    F(44,53,44,53,'U');F(48,52,48,52,'U');F(41,52,41,52,'G');F(50,55,50,55,'N');F(53,53,53,53,'G');F(55,55,55,55,'o');
    // lemon terraces and lower alleys
    F(3,33,4,38,'2');F(3,32,4,32,'1');
    F(8,29,8,29,'L');F(6,36,6,36,'L');F(3,29,3,29,'z');F(8,37,8,37,'G');
    F(10,44,12,44,'w');F(8,44,8,44,'L');F(13,41,13,41,'L');F(13,48,13,48,'z');F(9,47,9,47,'c');
    F(14,52,14,52,'G');F(19,50,19,50,'c');F(4,53,4,53,'o');F(9,51,9,51,'L');F(17,53,17,53,'N');
    // spawns and roads
    F(25,1,25,1,'L');F(38,1,38,1,'L');F(26,8,26,8,'f');F(37,7,37,7,'U');F(24,6,24,6,'L');F(19,8,19,8,'f');F(49,1,49,1,'N');F(41,3,41,3,'G');
    F(25,59,26,59,'v');F(36,60,36,60,'G');F(24,53,24,53,'L');
  },
  props:{
    Q:{asset:'riv_blank',h:22,w:1,mat:'stone',rot:0},
    X:{asset:'riv_blank',h:0.9,w:1,mat:'stone',rot:0},
    B:{asset:'riv_blank',h:1.5,w:0.95,mat:'wood',pen:1,rot:0},
    U:{asset:['riv_stall','riv_stallB'],h:1.05,w:0.92,mat:'wood',pen:1,rot:'grid'},
    f:{asset:'riv_cafe',h:0.8,w:0.75,mat:'metal',pen:1,rot:'random'},
    L:{asset:'riv_lemonpot',h:1.1,w:0.5,mat:'stone',rot:'random'},
    N:{asset:'riv_netcoil',h:0.7,w:0.8,mat:'wood',pen:1,rot:'random'},
    G:{asset:'riv_fishcrates',h:1.1,w:0.85,mat:'wood',pen:1,rot:'grid'}
  },
  extras:[
    {asset:'riv_belltower',at:[5,12]},
    {asset:'riv_churchfront',at:[9,11],rot:Math.PI},
    {asset:'riv_fountain',at:[32,32],collide:{w:0.3,h:2.7,mat:'stone'}},
    {asset:'riv_boatR',at:[52.5,11.5],rot:0.04},
    {asset:'riv_boatG',at:[46.5,21.5],rot:Math.PI/2},
    {asset:'riv_boat',at:[52.5,29.5],rot:Math.PI-0.03},
    // moored in the water
    {asset:'riv_boat',at:[59.6,11.9],y:-0.95,rot:Math.PI/2+0.05},
    {asset:'riv_boatR',at:[59.4,16.1],y:-0.95,rot:-Math.PI/2-0.04},
    {asset:'riv_boatG',at:[58.3,21.6],y:-0.95,rot:0.06},
    {asset:'riv_boat',at:[58.3,7.5],y:-0.95,rot:Math.PI-0.05},
    {asset:'riv_boatG',at:[55.6,36.8],y:-0.95,rot:0.03},
    {asset:'riv_boatR',at:[58.4,30],y:-0.95,rot:Math.PI+0.04},
    {asset:'riv_boat',at:[58.4,46],y:-0.95,rot:0.05},
    // out at sea: lighthouse on the breakwater and boats on the horizon
    {asset:'riv_lighthouse',at:[80,10],y:-0.8},
    {asset:'riv_boatR',at:[74,34],y:-0.95,rot:0.7},
    {asset:'riv_boat',at:[92,52],y:-0.95,rot:-0.4}
  ],
  spawns:{W:[[28,4],[31,4],[34,4],[29,6],[33,6]],S:[[28,56],[30,57],[32,57],[34,56],[31,59]]},
  spawnZone:{W:[25,1,38,8],S:[24,53,37,60]},
  sites:{A:{c0:4,r0:11,c1:20,r1:25,center:[12,18]},B:{c0:43,r0:9,c1:56,r1:24,center:[49,17]}},
  zones:[['Bell Tower',4,11,7,14],['Terrace',4,15,7,22],['Piazza',4,11,20,25],['Church Lane',13,9,16,10],['Via Alta',13,6,24,8],
    ['Warden Spawn',25,1,38,8],['Quay Road',39,1,50,8],['Harbour Office',43,9,46,12],['Jetty',57,13,60,14],['Quay',43,9,56,24],
    ['Vicolo',21,17,23,19],['Net Loft',35,13,42,17],['Market Street',24,9,34,27],['Fountain Square',25,28,38,35],['Scalinata',9,31,24,32],
    ['Cantina',39,41,50,42],['Lower Mid',30,36,38,52],['Inlet',51,33,56,40],['Waterfront',51,25,56,50],['Striker Spawn',24,53,37,60],
    ['Fish Market',38,51,56,58],['Lower Alleys',3,50,23,56],['Lemon Terraces',3,26,13,49]],
  siteOfZone:{'Piazza':'A','Bell Tower':'A','Terrace':'A','Vicolo':'A','Scalinata':'A','Lemon Terraces':'A','Lower Alleys':'A',
    'Quay':'B','Harbour Office':'B','Jetty':'B','Net Loft':'B','Waterfront':'B','Inlet':'B','Cantina':'B','Fish Market':'B'},
  plans:{
    A:[{route:'terraces',stage:[11,46],entry:[[6,38],[6,30],[6,26],[9,21]],smoke:[[14,10],[19,16]],flash:[[10,19]]},
       {route:'vicolo',stage:[27,24],entry:[[25,18],[21,18],[18,18]],smoke:[[14,11]],flash:[[15,18]]},
       {route:'scalinata',stage:[27,32],entry:[[23,31],[15,31],[9,31],[6,28],[6,26],[9,21]],smoke:[[15,12],[18,17]],flash:[[11,19]]}],
    B:[{route:'waterfront',stage:[54,48],entry:[[52,37],[53,27],[53,25],[51,22]],smoke:[[48,8],[44,15]],flash:[[51,18]]},
       {route:'loft',stage:[31,13],entry:[[34,14],[38,14],[40,16],[44,16]],smoke:[[48,8]],flash:[[48,16]]},
       {route:'cantina',stage:[36,42],entry:[[39,42],[46,42],[51,41],[53,27],[53,25],[51,22]],smoke:[[48,8],[44,15]],flash:[[50,18]]}]},
  siteSpots:{A:[[12,18],[9,13],[15,13],[18,21],[10,21],[13,16]],B:[[49,17],[46,15],[51,15],[54,20],[48,23],[50,10]]},
  plantSpot:{A:[12,18],B:[49,17]},
  holds:{A:[{c:[5,17],l:[6,26]},{c:[18,14],l:[21,18]},{c:[15,10],l:[21,18]},{c:[11,13],l:[6,26]},{c:[6,24],l:[6,34]}],
    B:[{c:[44,10],l:[53,26]},{c:[55,12],l:[43,16]},{c:[48,22],l:[53,27]},{c:[50,10],l:[43,16]},{c:[54,24],l:[53,36]}],
    M:[{c:[32,10],l:[32,18]},{c:[27,25],l:[33,36]},{c:[37,30],l:[36,42]}]},
  signs:[
    {t:'A',c:LETTER_RED,x:21,z:13,nx:-1,nz:0,s:3.2},{t:'A',c:LETTER_RED,x:4,z:24,nx:1,nz:0,s:2.6},
    {t:'B',c:LETTER_RED,x:43,z:21,nx:1,nz:0,s:3.2},{t:'B',c:LETTER_RED,x:47,z:25,nx:0,nz:-1,s:3.0},
    {t:'A',c:LETTER_PALE,x:18,z:50,nx:0,nz:1,s:2.4,a:-1},{t:'B',c:LETTER_PALE,x:45,z:51,nx:0,nz:1,s:2.4,a:1},
    {t:'A',c:LETTER_PALE,x:31,z:28,nx:0,nz:1,s:2.2,a:-1},{t:'B',c:LETTER_PALE,x:36.5,z:28,nx:0,nz:1,s:2.2,a:1},
    {t:'B',c:LETTER_PALE,x:35,z:11,nx:-1,nz:0,s:2.2,a:1},{t:'A',c:LETTER_PALE,x:24,z:21.5,nx:1,nz:0,s:2.2,a:1},
    {t:'A',c:LETTER_PALE,x:9,z:36,nx:-1,nz:0,s:2.2,a:-1},{t:'B',c:LETTER_PALE,x:51,z:36,nx:1,nz:0,s:2.2,a:1}],
  trees:{type:'riv_cypress',cell:'riv_cypress',cellScale:[6,8],
    at:[[2,8],[20,2],[22,24],[12,28],[16,36],[2,46],[18,38],[20,42],[27,40],[42,30],[46,36],[40,22],[44,47],[24,12],[37,11],[53,4],[1,56],[22,62],[41,62],[47,58]],min:9,max:13},
  paved:[[4,11,20,25,'riv_flags'],[25,28,38,35,'riv_flags'],[25,1,38,8,'riv_flags'],[43,9,56,24,'riv_flags'],[57,13,60,14,'woodplank'],[40,51,56,55,'riv_flags']],
  roofs:[],
  water:true,
  menuSpot:[53,26],menuAngle:-Math.PI/2+0.25,
  art:{wall:'#f2c4bc',wall2:'#f4e4a4',ground:'#cdbb9c',
    draw(g,w,h){
      g.fillStyle='#2a7a96';g.fillRect(w*0.62,h*0.7,w*0.38,h*0.08);                       // sea
      g.fillStyle='rgba(255,255,255,.5)';for(let i=0;i<8;i++)g.fillRect(w*0.64+Math.random()*w*0.34,h*0.72+Math.random()*h*0.05,8,1);
      g.fillStyle='#f4f0e8';g.fillRect(w*0.86,h*0.48,6,h*0.22);g.fillStyle='#b8302a';g.fillRect(w*0.86,h*0.54,6,h*0.04);g.fillRect(w*0.86,h*0.62,6,h*0.04);
      g.fillStyle='#ffe6a0';g.fillRect(w*0.858,h*0.45,8,h*0.03);
      g.fillStyle='#e8b48a';g.fillRect(w*0.18,h*0.2,w*0.07,h*0.58);                       // bell tower
      g.fillStyle='#3a2a20';g.fillRect(w*0.195,h*0.26,w*0.04,h*0.06);
      g.fillStyle='#b85a34';g.beginPath();g.moveTo(w*0.17,h*0.2);g.lineTo(w*0.26,h*0.2);g.lineTo(w*0.215,h*0.09);g.fill();
      g.fillStyle='#24442a';for(const px of[0.08,0.4,0.55]){g.beginPath();g.ellipse(w*px,h*0.56,6,h*0.2,0,0,7);g.fill();}
      g.fillStyle='#f2f0ea';g.beginPath();g.moveTo(w*0.7,h*0.7);g.lineTo(w*0.8,h*0.7);g.lineTo(w*0.78,h*0.74);g.lineTo(w*0.71,h*0.74);g.fill();
      g.fillStyle='#2e6ab0';g.fillRect(w*0.705,h*0.705,w*0.09,2);
    }},
  theme:{
    ground:'riv_cobble',walls:[['riv_stucco',1]],paving:'riv_flags',stairs:'riv_steps',roof:'woodplank',
    lowWall:'riv_stucco',lowWallCap:'riv_terracotta',cap:'riv_terracotta',quay:'riv_quay',groundTint:[0.96,0.93,0.88],waterColor:0x0e5a74,
    tints:[[1,0.7,0.68],[1,0.87,0.5],[0.62,0.8,1],[1,1,0.98],[1,0.78,0.58],[1,0.74,0.76],[1,0.9,0.56],[0.7,0.86,1],[0.8,0.94,0.8]],
    decor:{window:['riv_window','riv_windowG','riv_windowY','riv_window'],winY:3.3,winP:0.24,door:['riv_door','riv_doorB','riv_door'],doorP:0.07,
      lamp:'lamp',lampP:0.45,awnings:['awnR','awnB','awnG'],awnP:0.06,streetlamp:'streetlamp',slP:0.03,
      extras:[{asset:'riv_flowerbox',p:0.07,y:1.55},{asset:'riv_bougain',p:0.05,minH:5}],vehicles:['sedan','sedan2','van'],vehicleH:{}},
    sky:{top:0x3d7cc6,mid:0x9ccbec,horizon:0xf6e4c8,ground:0xcab89c,sun:0xffe2b0,sunDir:[-0.55,0.5,0.5],clouds:0.25,cloudColor:0xfff4e4},
    sunColor:0xffdcb0,sunI:2.3,hemiSky:0xcfe4ff,hemiGround:0xd6c0a0,hemiI:0.85,fog:0xeadcc6,fogNear:85,fogFar:330,
    exposure:0.82,grade:{sat:1.12,contrast:1.05,lift:[0.01,0.005,0.0],gain:[1.05,1.0,0.94]},particles:'dust'
  }
};
MAP_ORDER.push('riviera');
