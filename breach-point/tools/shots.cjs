// In-game screenshots from chosen spots: THREE_JS=... HTML=page.html node tools/shots.cjs outDir '[["name","mapId",col,row,yaw,pitch],...]'
// yaw 0 looks north (towards row 0), PI/2 west, PI south, -PI/2 east. Optional 7th item: quality preset.
let pw;try{pw=require('playwright');}catch(e){pw=require('/opt/node-tools/node_modules/playwright');}
const fs=require('fs'),path=require('path');
(async()=>{const out=process.argv[2],V=JSON.parse(process.argv[3]);
const b=await pw.chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const pg=await b.newPage({viewport:{width:1280,height:720}});pg.on('pageerror',e=>console.log('PAGEERROR',e.message));
pg.on('console',m=>{if(m.type()==='error'&&!/ERR_CERT|fonts/.test(m.text()))console.log('console:',m.text());});
await pg.route('**/three.min.js',r=>r.fulfill({body:fs.readFileSync(process.env.THREE_JS),contentType:'application/javascript'}));
await pg.route('https://fonts.**',r=>r.abort());
await pg.goto('file://'+path.resolve(process.env.HTML||path.join(__dirname,'../../breach-point.html')));
await pg.waitForFunction(()=>window.__bp||document.getElementById('loading').textContent.startsWith('Failed'),null,{timeout:90000});
const failed=await pg.evaluate(()=>!window.__bp&&document.getElementById('loading').textContent);if(failed){console.log(failed);process.exit(1);}
for(const [name,m,c,r,yaw,pitch,q] of V){
  await pg.evaluate(([m,c,r,yaw,pitch,q])=>{const {G,Input,Lobby,S,applyGraphics,cellPos,World}=window.__bp;if(q&&S.quality!==q){S.quality=q;applyGraphics();}
    if(!G.player||window.__curMap!==m){document.getElementById('menu').classList.add('hidden');document.getElementById('hud').classList.remove('hidden');Lobby.hideModel();G.newMatch('W',m);Input.locked=true;window.__curMap=m;}
    const p=G.player;const cp=cellPos(c,r);p.pos.set(cp.x,World.heightAt(cp.x,cp.z),cp.z);p.vel.set(0,0,0);p.yaw=yaw;p.pitch=pitch;G.phaseT=99;},[m,c,r,yaw,pitch,q]);
  await pg.waitForTimeout(3500);await pg.screenshot({path:path.join(out,name+'.png')});console.log('shot',name);
}
await b.close();})();
