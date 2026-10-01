// Validates every map: prints the grid, then checks that all bot coordinates are walkable and reachable from both spawns.
// Usage: node breach-point/tools/check-maps.cjs [mapId] [--extra draftDir ...]
const fs=require('fs'),path=require('path');
const SRC=path.join(__dirname,'../src');
const argv=process.argv.slice(2);const extraDirs=[];for(let i=0;i<argv.length;i++)if(argv[i]==='--extra'){extraDirs.push(argv[i+1]);argv.splice(i,2);i--;}
const ONLY=argv[0];
const plug=[SRC,...extraDirs].flatMap(d=>fs.readdirSync(d).filter(f=>/^02m-.*\.js$/.test(f)).map(f=>path.join(d,f))).sort((a,b)=>path.basename(a).localeCompare(path.basename(b)));
const src=[fs.readFileSync(path.join(SRC,'02-maps.js'),'utf8')].concat(plug.map(f=>fs.readFileSync(f,'utf8'))).join('\n');
// plug-in map files may register surfaces or weather; give them harmless stand-ins
const MAPS=new Function('const SURFACES={},WEATHER={},PATTERNS={},THREE={};const speckle=()=>{},blotches=()=>{},streaks=()=>{},rand=(a,b)=>a,pick=a=>a[0];'+src+';return MAPS;')();
const GW=64,GH=64,WALK='.TW=d12345';
let bad=0;
for(const id of Object.keys(MAPS)){
  if(ONLY&&ONLY!==id)continue;
  const M=MAPS[id];const g=[];for(let r=0;r<GH;r++)g.push(new Array(GW).fill('#'));
  M.grid((c0,r0,c1,r1,ch='.')=>{for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)g[r][c]=ch;});
  for(const T of['W','S'])for(const[c,r]of M.spawns[T])if(g[r][c]==='.')g[r][c]=T==='S'?'T':'W';
  console.log('== '+id);console.log('    '+[...Array(64).keys()].map(i=>i%10).join(''));
  g.forEach((row,i)=>console.log(String(i).padStart(3)+' '+row.join('')));
  const CP=M.props||{};
  for(const ch in CP){if(ch.length!==1||'#.TW=d12345~cmCkKynwvouz-|P'.includes(ch)){bad++;console.log('  ! custom prop char clashes with a built-in cell: '+ch);}if(!CP[ch].asset){bad++;console.log('  ! custom prop '+ch+' has no asset');}}
  const known='#.TW=d12345~cmCkKynwvouz-|P'+Object.keys(CP).join('');
  g.forEach((row,r)=>row.forEach((ch,c)=>{if(!known.includes(ch)){bad++;console.log('  ! unknown cell '+ch+' at '+c+','+r);}}));
  for(const k of['id','name','desc','theme','spawns','spawnZone','sites','zones','siteOfZone','plans','siteSpots','plantSpot','holds','signs','trees','paved','roofs','menuSpot'])if(M[k]===undefined){bad++;console.log('  ! missing field '+k);}
  if(M.id!==id){bad++;console.log('  ! id field does not match key');}
  for(const k of['A','B'])if(!M.plans[k]||!M.plans[k].length||!M.siteSpots[k]||!M.plantSpot[k]||!M.holds[k]||!M.sites[k]){bad++;console.log('  ! site '+k+' is missing plans/spots/holds');}
  if(!M.holds.M){bad++;console.log('  ! holds.M (mid) missing');}
  const h=(c,r)=>'12345'.includes(g[r][c])?+g[r][c]*0.5:0, ok=(c,r)=>c>=0&&r>=0&&c<GW&&r<GH&&WALK.includes(g[r][c])&&!CP[g[r][c]];
  const reach=(sc,sr)=>{const seen=new Uint8Array(GW*GH),q=[[sc,sr]];seen[sr*GW+sc]=1;
    while(q.length){const[c,r]=q.shift();for(const[dc,dr]of[[1,0],[-1,0],[0,1],[0,-1]]){const nc=c+dc,nr=r+dr;if(!ok(nc,nr)||seen[nr*GW+nc])continue;
      const d=h(nc,nr)-h(c,r);if(d>0.55||d<-3.1)continue;seen[nr*GW+nc]=1;q.push([nc,nr]);}}return seen;};
  const fromS=reach(...M.spawns.S[0]),fromW=reach(...M.spawns.W[0]);
  const pts=[];const add=(name,c)=>pts.push([name,c]);
  for(const T of['S','W'])M.spawns[T].forEach((c,i)=>add('spawn'+T+i,c));
  for(const k in M.plans)M.plans[k].forEach((p,i)=>{add(`plan${k}${i}.stage`,p.stage);p.entry.forEach((e,j)=>add(`plan${k}${i}.entry${j}`,e));});
  for(const k in M.siteSpots)M.siteSpots[k].forEach((c,i)=>add('spot'+k+i,c));
  for(const k in M.plantSpot)add('plant'+k,M.plantSpot[k]);
  for(const k in M.holds)M.holds[k].forEach((o,i)=>add('hold'+k+i,o.c));
  for(const[name,[c,r]]of pts){
    const issues=[];if(!ok(c,r))issues.push('not walkable ('+g[r][c]+')');
    else{if(!fromS[r*GW+c])issues.push('unreachable from S');if(!fromW[r*GW+c])issues.push('unreachable from W');}
    if(name.startsWith('plant')){const s=M.sites[name.slice(5)];if(c<s.c0||c>s.c1||r<s.r0||r>s.r1)issues.push('outside site');}
    if(issues.length){bad++;console.log('  ! '+name+' ['+c+','+r+'] '+issues.join(', '));}
  }
  for(const k in M.holds)M.holds[k].forEach((o,i)=>{const[c,r]=o.l;if(c<0||r<0||c>=GW||r>=GH){bad++;console.log('  ! hold look out of range '+k+i);}});
  for(const k of Object.keys(M.plans))for(const p of M.plans[k])for(const u of[...p.smoke,...p.flash]){const[c,r]=u;if(!ok(c,r)){bad++;console.log('  ! utility target not on floor '+k+' '+u);}}
}
console.log(bad?bad+' problem(s)':'all maps OK');process.exit(bad?1:0);
