
/* =====================================================================
   Maps. Each map is a 64 x 64 grid of 2 m cells plus the data the bots
   need (routes, holds, spots). Cell legend:
     #  building / wall            .  floor          T W  spawn floor
     1-5 raised floor (0.5 m each)  =  floor under a low roof (tunnel)
     d  doorway (wall above)        ~  water (not walkable)
     c m C  crates 1.1 / 1.6 / 2.3 m (shootable through)
     k K  container 2.6 / stacked 5.2 m      y  pallet stack 1.2 m
     n  sandbags 0.8 m              w  low stone wall 1.2 m
     v  car / forklift              o  barrels   u  oil drums
     z  tree (blocks the cell)      P  potted plant
     -  |  thin wooden wall (shootable through)
   ===================================================================== */
const MAPS={};
const LETTER_RED='#c8322a',LETTER_PALE='#e8e2d2';

MAPS.sandline={
  id:'sandline',name:'Sandline',desc:'A sun-baked desert town. Long sightlines on A, close fights in the B tunnels.',
  grid(F){
    F(24,2,39,9);F(8,2,23,6);F(40,2,55,6);
    F(3,7,22,20);F(41,7,60,20);
    F(3,21,7,52);F(3,50,24,54);
    F(24,52,39,61);
    F(29,10,34,51);
    F(29,18,30,18,'#');F(31,18,32,18,'d');F(33,18,34,18,'#');
    F(3,42,4,42,'#');F(5,42,6,42,'d');F(7,42,7,42,'#');
    F(28,26,28,27,'1');F(27,26,27,27,'2');F(26,26,26,27,'3');F(15,26,25,27,'4');
    F(15,24,16,25,'4');F(15,23,16,23,'3');F(15,22,16,22,'2');F(15,21,16,21,'1');
    F(40,48,46,58);F(43,21,46,47);F(43,28,46,42,'=');F(43,21,44,21,'#');
    F(35,36,42,38,'=');
    F(35,13,40,15);
    F(8,6,13,7,'#');F(3,7,5,9,'#');F(41,7,43,9,'#');F(57,7,60,8,'#');F(50,2,55,3,'#');
    F(10,12,11,12,'C');F(12,12,12,12,'c');F(17,15,17,15,'m');F(5,17,6,17,'C');
    F(14,10,14,11,'c');F(19,9,20,9,'v');F(4,11,8,12,'2');F(4,13,8,13,'1');F(20,17,21,18,'#');
    F(48,12,49,12,'C');F(48,13,48,13,'C');F(52,16,53,16,'c');F(56,11,56,11,'m');
    F(45,17,46,17,'v');F(51,9,51,9,'#');F(55,15,59,19,'2');F(54,15,54,19,'1');F(47,9,47,10,'|');
    F(4,30,4,30,'c');F(7,35,7,36,'C');F(3,46,3,46,'C');F(6,24,6,24,'m');
    F(31,32,31,32,'C');F(32,32,32,32,'c');F(33,44,33,44,'-');F(30,24,30,24,'m');F(33,12,34,12,'c');
    F(46,50,46,50,'C');F(43,24,43,24,'c');
    F(24,9,24,9,'P');F(39,9,39,9,'P');F(24,61,24,61,'P');F(39,61,39,61,'P');F(22,2,22,2,'P');F(41,2,41,2,'P');
    F(26,4,26,4,'o');F(37,7,37,7,'o');F(26,58,27,58,'v');F(38,54,38,54,'o');F(10,52,10,52,'o');
  },
  spawns:{W:[[28,4],[31,4],[34,4],[29,6],[33,6]],S:[[29,57],[31,57],[33,57],[30,59],[32,59]]},
  spawnZone:{W:[23,1,40,10],S:[23,51,40,62]},
  sites:{A:{c0:6,r0:8,c1:21,r1:20,center:[12,14]},B:{c0:44,r0:9,c1:59,r1:20,center:[50,15]}},
  zones:[['A Platform',4,11,8,13],['B Platform',54,15,59,19],['Long Doors',3,41,7,43],['Mid Doors',29,17,34,19],
    ['CT Spawn',24,2,39,9],['A Site',3,7,22,20],['B Site',41,7,60,20],['CT Road',8,2,23,6],['CT Road',40,2,55,6],
    ['Long A',3,21,7,40],['Outside Long',3,44,7,54],['T Ramp',8,50,24,54],['T Spawn',24,52,39,61],['Mid',29,20,34,51],
    ['CT Mid',29,10,34,16],['Catwalk',15,21,28,27],['Connector',35,13,40,15],['Upper Tunnels',43,21,46,27],
    ['Tunnels',43,28,46,47],['Lower Tunnel',35,36,42,38],['Outside Tunnels',40,48,46,58]],
  siteOfZone:{'Long A':'A','Long Doors':'A','Catwalk':'A','A Site':'A','A Platform':'A','Outside Long':'A',
    'Tunnels':'B','Upper Tunnels':'B','B Site':'B','B Platform':'B','Outside Tunnels':'B','Lower Tunnel':'B','Connector':'B'},
  plans:{
    A:[{route:'long',stage:[5,47],entry:[[5,41],[5,31],[5,22]],smoke:[[17,4],[18,10]],flash:[[9,16]]},
       {route:'catwalk',stage:[31,30],entry:[[28,26],[21,26],[15,24],[15,21]],smoke:[[16,4]],flash:[[14,15]]}],
    B:[{route:'tunnels',stage:[45,25],entry:[[45,22],[45,19]],smoke:[[47,4],[40,14]],flash:[[50,15]]},
       {route:'mid',stage:[32,22],entry:[[31,18],[33,14],[38,14],[42,14]],smoke:[[47,4]],flash:[[46,14]]}]},
  siteSpots:{A:[[10,15],[6,15],[16,12],[18,16],[12,9],[8,19]],B:[[46,12],[52,13],[57,13],[50,18],[44,15],[53,10]]},
  plantSpot:{A:[12,14],B:[50,15]},
  holds:{A:[{c:[6,14],l:[5,30]},{c:[17,9],l:[15,21]},{c:[8,12],l:[5,22]},{c:[21,11],l:[16,23]},{c:[5,24],l:[5,44]}],
    B:[{c:[52,10],l:[45,21]},{c:[57,17],l:[45,21]},{c:[42,16],l:[45,22]},{c:[48,8],l:[45,21]}],
    M:[{c:[31,14],l:[31,30]},{c:[36,14],l:[32,24]}]},
  signs:[{t:'A',c:LETTER_RED,x:3,z:14.5,nx:1,nz:0,s:3.4},{t:'A',c:LETTER_RED,x:23,z:13.5,nx:-1,nz:0,s:3.4},
    {t:'B',c:LETTER_RED,x:61,z:12.5,nx:-1,nz:0,s:3.4},{t:'B',c:LETTER_RED,x:51.5,z:10,nx:0,nz:1,s:2.2,y:2.6},
    {t:'A',c:LETTER_PALE,x:8,z:47.5,nx:-1,nz:0,s:2.4,a:-1},{t:'B',c:LETTER_PALE,x:43,z:45.5,nx:1,nz:0,s:2.4,a:1},
    {t:'A',c:LETTER_PALE,x:29,z:30.5,nx:1,nz:0,s:2.4,a:1},{t:'B',c:LETTER_PALE,x:35,z:30.5,nx:-1,nz:0,s:2.4,a:1},
    {t:'B',c:LETTER_PALE,x:35,z:11.5,nx:-1,nz:0,s:2.2,a:1},{t:'A',c:LETTER_PALE,x:29,z:11.5,nx:1,nz:0,s:2.2,a:1}],
  trees:{type:'palm',at:[[23,13],[40,11],[9,30],[41,30],[20,44],[49,44],[25,40],[2,25],[62,14],[20,57],[44,60],[12,1],[47,1],[36,47]],min:10,max:14},
  paved:[[24,2,39,9],[29,10,34,51],[35,13,40,15],[43,21,46,47],[35,36,42,38],[40,48,46,58]],
  roofs:[],
  menuSpot:[31,44],menuAngle:0,
  theme:{
    ground:'sand',walls:[['stone',0.45],['plaster',0.55]],paving:'paving',cap:'trim',decor:'town',
    tints:[[1,0.93,0.74],[1,0.82,0.66],[1,1,0.97],[0.97,0.88,0.72],[1,0.96,0.86]],
    sky:{top:0x2f6db8,mid:0x8bbbe6,horizon:0xe6e2d6,ground:0xc9b38c,sun:0xfff2d8,sunDir:[0.42,0.82,0.38],clouds:0.35},
    sunColor:0xfff0d8,sunI:2.0,hemiSky:0xcfe2ff,hemiGround:0xc8b490,hemiI:0.85,fog:0xdcd5c4,fogNear:90,fogFar:300,
    exposure:0.85,grade:{sat:1.08,contrast:1.06,lift:[0.0,0.0,0.01],gain:[1.03,1.0,0.95]},particles:'dust'
  }
};

MAPS.harbor={
  id:'harbor',name:'Harbor',desc:'Container docks at golden hour. Site A is inside a warehouse, B is an open container yard.',
  grid(F){
    F(26,2,38,8);F(8,2,25,5);F(39,2,55,5);               // CT spawn and roads
    F(4,7,20,20);                                          // A warehouse interior
    F(15,6,16,6,'d');F(6,21,7,21,'d');F(21,13,21,14,'d');  // warehouse doors (north, south, east)
    F(22,13,28,14,'=');                                    // office corridor from mid
    F(40,6,55,20);                                         // B container yard
    F(3,22,9,52);F(3,50,24,55);                            // rail yard and the path from T
    F(24,54,40,61);                                        // T spawn
    F(29,9,34,53);                                         // quay road (mid)
    F(29,26,30,26,'#');F(31,26,32,26,'d');F(33,26,34,26,'#');
    F(35,15,39,17);                                        // connector to B
    F(49,22,55,53);F(40,52,55,58);                         // pier and the path from T
    F(49,21,53,21);
    F(56,0,63,63,'~');                                     // the sea
    // A warehouse cover
    F(8,10,10,10,'k');F(8,14,8,16,'K');F(13,17,15,17,'k');F(15,10,16,10,'C');F(12,13,12,13,'y');
    F(17,7,20,8,'4');F(17,9,20,9,'3');F(17,10,20,10,'2');F(17,11,20,11,'1');F(17,12,18,12,'c');
    F(4,18,5,19,'y');F(19,18,19,19,'C');
    // B container yard
    F(43,9,43,11,'K');F(47,8,49,8,'k');F(47,13,49,13,'k');F(52,10,52,12,'k');F(45,17,47,17,'k');
    F(53,16,53,16,'C');F(41,14,41,14,'y');F(50,18,50,18,'u');F(55,8,55,9,'y');
    // rail yard
    F(8,27,8,29,'k');F(4,33,4,35,'K');F(7,40,7,42,'k');F(5,46,6,46,'y');F(9,36,9,36,'c');F(3,24,3,24,'u');
    // quay road
    F(31,33,31,33,'C');F(32,33,32,33,'c');F(33,42,34,42,'n');F(29,20,29,20,'y');F(34,11,34,11,'u');
    // pier
    F(51,26,51,28,'k');F(54,33,54,35,'K');F(50,40,51,40,'v');F(53,46,53,46,'y');F(52,30,52,30,'c');F(49,48,49,48,'u');
    F(26,7,26,7,'u');F(38,3,38,3,'y');F(27,59,28,59,'v');F(39,55,39,55,'u');F(12,53,12,53,'y');
  },
  spawns:{W:[[29,4],[32,4],[35,4],[30,6],[34,6]],S:[[29,58],[31,58],[33,58],[35,58],[32,60]]},
  spawnZone:{W:[25,1,39,9],S:[23,53,41,62]},
  sites:{A:{c0:5,r0:8,c1:19,r1:19,center:[11,13]},B:{c0:42,r0:7,c1:55,r1:20,center:[49,15]}},
  zones:[['Office',17,7,20,12],['Warehouse',4,7,20,20],['Office Hall',21,13,28,14],['CT Spawn',26,2,38,8],['CT Road',8,2,25,5],
    ['CT Road',39,2,55,5],['Container Yard',40,6,55,20],['Rail Yard',3,21,9,49],['Rail Gate',3,50,24,55],['T Spawn',24,54,40,61],
    ['Mid Gate',29,25,34,27],['Quay',29,9,34,53],['Connector',35,15,39,17],['Pier',49,21,55,51],['Pier Gate',40,52,55,58]],
  siteOfZone:{'Warehouse':'A','Office':'A','Office Hall':'A','Rail Yard':'A','Rail Gate':'A','Container Yard':'B','Pier':'B','Pier Gate':'B','Connector':'B'},
  plans:{
    A:[{route:'rail',stage:[6,30],entry:[[6,24],[6,21],[7,17]],smoke:[[15,4],[17,13]],flash:[[10,16]]},
       {route:'office',stage:[31,20],entry:[[30,14],[24,14],[21,13],[17,14]],smoke:[[15,4]],flash:[[13,14]]}],
    B:[{route:'pier',stage:[52,38],entry:[[52,24],[51,21],[51,17]],smoke:[[45,4],[38,16]],flash:[[48,15]]},
       {route:'connector',stage:[32,22],entry:[[32,17],[36,16],[40,16]],smoke:[[47,4]],flash:[[45,15]]}]},
  siteSpots:{A:[[11,12],[6,12],[14,15],[18,15],[10,18],[16,8]],B:[[45,12],[50,11],[53,14],[48,17],[44,19],[51,8]]},
  plantSpot:{A:[11,12],B:[49,15]},
  holds:{A:[{c:[19,8],l:[6,20]},{c:[6,9],l:[6,21]},{c:[13,8],l:[21,14]},{c:[10,15],l:[6,21]},{c:[5,25],l:[6,45]}],
    B:[{c:[50,9],l:[51,21]},{c:[45,15],l:[51,21]},{c:[54,12],l:[51,21]},{c:[44,8],l:[40,16]}],
    M:[{c:[31,12],l:[31,30]},{c:[33,22],l:[31,40]}]},
  signs:[{t:'A',c:LETTER_RED,x:4,z:13.5,nx:1,nz:0,s:3.6,y:3},{t:'A',c:LETTER_PALE,x:10,z:6,nx:0,nz:-1,s:3,y:3.2},
    {t:'B',c:LETTER_RED,x:48.5,z:6,nx:0,nz:1,s:3.2,y:3.4},{t:'B',c:LETTER_PALE,x:49,z:30.5,nx:1,nz:0,s:2.6,a:1},
    {t:'A',c:LETTER_PALE,x:10,z:44.5,nx:-1,nz:0,s:2.4,a:-1},{t:'A',c:LETTER_PALE,x:29,z:15.5,nx:1,nz:0,s:2.2,a:1},
    {t:'B',c:LETTER_PALE,x:35,z:19.5,nx:-1,nz:0,s:2.2,a:-1}],
  trees:{type:'crane',at:[[60,12],[60,40]],min:1,max:1},
  paved:[[26,2,38,8],[4,7,20,20],[22,13,28,14],[49,22,55,53,'woodplank']],
  roofs:[[4,7,20,9,8.2],[4,11,20,13,8.2],[4,15,20,17,8.2],[4,19,20,20,8.2]],
  water:true,
  menuSpot:[52,44],menuAngle:0,
  theme:{
    ground:'concrete',walls:[['brick',0.45],['corrugated',0.3],['concretewall',0.25]],paving:'slab',cap:'trim',decor:'docks',
    tints:[[1,0.9,0.85],[0.85,0.92,1],[1,1,1],[0.9,1,0.92],[1,0.95,0.85]],
    sky:{top:0x3a5a9a,mid:0xd99a6a,horizon:0xffc890,ground:0x7a6a5a,sun:0xffb070,sunDir:[0.75,0.32,0.45],clouds:0.55},
    sunColor:0xffc488,sunI:2.2,hemiSky:0xc0cce8,hemiGround:0x9a8a7a,hemiI:0.8,fog:0xe8b890,fogNear:70,fogFar:280,
    exposure:0.9,grade:{sat:1.12,contrast:1.08,lift:[0.01,0.0,0.02],gain:[1.06,0.99,0.92]},particles:'dust'
  }
};

MAPS.frostbite={
  id:'frostbite',name:'Frostbite',desc:'A snowed-in mountain village. B is a timber lodge, A is the chapel square past the bridge.',
  grid(F){
    F(26,2,37,8);F(8,2,25,4);F(38,2,55,5);               // CT spawn and roads
    F(4,6,19,19);                                          // B lodge (north half roofed)
    F(10,5,11,5,'d');F(6,20,7,20,'d');F(20,14,20,15,'d');
    F(21,14,28,15,'=');                                    // sawmill passage from mid
    F(42,6,60,20);                                         // A chapel square
    F(3,21,9,52);F(3,50,24,54);                            // pine trail and the path from T
    F(24,54,39,61);                                        // T spawn
    F(29,9,34,53);                                         // main street (mid)
    F(29,36,30,36,'#');F(31,36,32,36,'d');F(33,36,34,36,'#');
    // bridge (A short): stairs up from mid, raised walkway, stairs down into the square
    F(35,28,35,29,'1');F(36,28,36,29,'2');F(37,28,37,29,'3');F(38,28,46,29,'4');
    F(45,26,46,27,'4');F(45,25,46,25,'3');F(45,24,46,24,'2');F(45,23,46,23,'1');F(45,21,46,22);
    F(54,21,60,52);F(39,50,60,54);                         // market street (A long) and the path from T
    F(42,21,44,21,'#');F(47,21,53,21,'#');
    // lodge interior
    F(4,6,8,7,'3');F(4,8,8,8,'2');F(4,9,8,9,'1');F(12,8,13,9,'c');F(16,7,17,7,'c');F(10,12,11,12,'-');
    F(15,11,15,13,'|');F(6,16,7,16,'w');F(13,17,14,17,'C');F(18,18,18,18,'u');F(4,13,4,13,'o');
    // chapel square
    F(50,12,51,13,'w');F(45,9,46,9,'n');F(56,9,56,11,'C');F(44,16,44,16,'c');F(55,17,56,17,'n');F(48,18,48,18,'v');
    F(58,13,59,14,'#');F(53,7,54,7,'P');
    // pine trail
    F(5,25,5,25,'z');F(8,29,8,29,'z');F(4,33,4,33,'z');F(7,37,7,38,'z');F(3,43,3,43,'z');F(6,46,6,46,'z');F(9,32,9,32,'c');F(5,40,5,40,'n');
    // main street
    F(31,22,31,22,'C');F(32,22,32,22,'c');F(33,44,34,44,'n');F(29,12,29,12,'o');F(34,30,34,30,'w');
    // market street
    F(55,26,56,26,'n');F(59,30,59,31,'C');F(55,36,55,36,'c');F(58,41,58,42,'v');F(56,47,57,47,'n');F(60,24,60,24,'o');
    F(26,7,26,7,'o');F(37,3,37,3,'u');F(26,58,26,59,'v');F(38,55,38,55,'o');F(12,52,12,52,'n');F(45,52,45,52,'C');
  },
  spawns:{W:[[28,4],[31,4],[34,4],[29,6],[33,6]],S:[[29,57],[31,57],[33,57],[30,59],[32,59]]},
  spawnZone:{W:[25,1,38,9],S:[23,53,40,62]},
  sites:{B:{c0:5,r0:8,c1:18,r1:19,center:[11,14]},A:{c0:44,r0:7,c1:59,r1:20,center:[51,15]}},
  zones:[['Lodge Loft',4,6,8,9],['Lodge',4,6,19,19],['Sawmill',20,14,28,15],['Chapel Square',42,6,60,20],['Bridge',35,21,46,29],
    ['CT Spawn',26,2,37,8],['CT Road',8,2,25,5],['CT Road',38,2,55,5],['Pine Trail',3,20,9,49],['Trail Gate',3,50,24,54],
    ['T Spawn',24,54,39,61],['Church Gate',29,35,34,37],['Main Street',29,9,34,53],['Market Street',54,21,60,49],['Market Gate',39,50,60,54]],
  siteOfZone:{'Lodge':'B','Lodge Loft':'B','Sawmill':'B','Pine Trail':'B','Trail Gate':'B','Chapel Square':'A','Bridge':'A','Market Street':'A','Market Gate':'A'},
  plans:{
    B:[{route:'trail',stage:[6,35],entry:[[6,24],[6,20],[8,17]],smoke:[[10,4],[16,12]],flash:[[10,14]]},
       {route:'sawmill',stage:[31,24],entry:[[30,15],[24,15],[20,14],[16,15]],smoke:[[10,4]],flash:[[12,15]]}],
    A:[{route:'market',stage:[57,34],entry:[[57,24],[57,21],[56,18]],smoke:[[48,4],[46,22]],flash:[[52,15]]},
       {route:'bridge',stage:[32,31],entry:[[35,29],[42,29],[45,26],[45,22]],smoke:[[48,4]],flash:[[49,15]]}]},
  siteSpots:{B:[[11,14],[6,12],[16,10],[9,18],[14,16],[17,13]],A:[[48,12],[53,10],[57,16],[46,18],[52,17],[45,13]]},
  plantSpot:{B:[11,14],A:[51,15]},
  holds:{B:[{c:[6,7],l:[6,20]},{c:[17,9],l:[20,14]},{c:[12,10],l:[6,20]},{c:[16,18],l:[20,15]},{c:[5,23],l:[6,45]}],
    A:[{c:[52,11],l:[57,21]},{c:[49,9],l:[45,21]},{c:[58,9],l:[57,21]},{c:[45,15],l:[45,22]}],
    M:[{c:[31,12],l:[31,30]},{c:[33,33],l:[31,48]}]},
  signs:[{t:'B',c:LETTER_RED,x:4,z:15.5,nx:1,nz:0,s:3.2},{t:'B',c:LETTER_PALE,x:13,z:5,nx:0,nz:-1,s:2.6,y:3.1},
    {t:'A',c:LETTER_RED,x:61,z:12.5,nx:-1,nz:0,s:3.4},{t:'A',c:LETTER_RED,x:51,z:6,nx:0,nz:1,s:3,y:3.2},
    {t:'B',c:LETTER_PALE,x:10,z:41.5,nx:-1,nz:0,s:2.4,a:-1},{t:'A',c:LETTER_PALE,x:54,z:40.5,nx:1,nz:0,s:2.4,a:1},
    {t:'A',c:LETTER_PALE,x:35,z:31.5,nx:-1,nz:0,s:2.2,a:1},{t:'B',c:LETTER_PALE,x:29,z:17.5,nx:1,nz:0,s:2.2,a:1}],
  trees:{type:'pineSnow',at:[[23,10],[40,10],[12,30],[20,40],[40,33],[48,40],[2,15],[62,30],[22,58],[42,59],[14,1],[46,1],[62,55],[1,40]],min:9,max:13},
  paved:[[26,2,37,8],[29,9,34,53],[42,6,60,20],[4,6,19,19,'woodplank'],[20,14,28,15,'woodplank']],
  roofs:[[4,6,19,12,5.0]],
  menuSpot:[52,16],menuAngle:0.6,
  theme:{
    ground:'snow',walls:[['logs',0.4],['plasterw',0.35],['stone',0.25]],paving:'cobble',cap:'snowcap',decor:'village',
    tints:[[1,1,1],[0.95,0.97,1],[1,0.96,0.92],[0.92,0.95,1],[1,0.98,0.95]],
    sky:{top:0x5a7898,mid:0xa8bccc,horizon:0xdfe6ec,ground:0xd8dfe6,sun:0xfff4e8,sunDir:[-0.35,0.55,0.55],clouds:0.75},
    sunColor:0xeaf0ff,sunI:1.4,hemiSky:0xdce8ff,hemiGround:0xc8d0da,hemiI:0.85,fog:0xd4dce4,fogNear:45,fogFar:210,
    exposure:0.78,grade:{sat:0.92,contrast:1.05,lift:[0.0,0.01,0.03],gain:[0.97,1.0,1.05]},particles:'snow'
  }
};
const MAP_ORDER=['sandline','harbor','frostbite'];
