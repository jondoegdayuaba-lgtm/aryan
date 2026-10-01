// Validates every map: prints the grid, then checks that all bot coordinates are walkable and reachable from both spawns.
// Usage: node breach-point/tools/check-maps.cjs [mapId]
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../src/02-maps.js'),'utf8');
const MAPS=new Function(src+';return MAPS;')();
const GW=64,GH=64,WALK='.TW=d12345';
let bad=0;
for(const id of Object.keys(MAPS)){
  if(process.argv[2]&&process.argv[2]!==id)continue;
  const M=MAPS[id];const g=[];for(let r=0;r<GH;r++)g.push(new Array(GW).fill('#'));
  M.grid((c0,r0,c1,r1,ch='.')=>{for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)g[r][c]=ch;});
  for(const T of['W','S'])for(const[c,r]of M.spawns[T])if(g[r][c]==='.')g[r][c]=T==='S'?'T':'W';
  console.log('== '+id);console.log('    '+[...Array(64).keys()].map(i=>i%10).join(''));
  g.forEach((row,i)=>console.log(String(i).padStart(3)+' '+row.join('')));
  const h=(c,r)=>'12345'.includes(g[r][c])?+g[r][c]*0.5:0, ok=(c,r)=>c>=0&&r>=0&&c<GW&&r<GH&&WALK.includes(g[r][c]);
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
