// Headless smoke test: boots breach-point.html, screenshots the lobby, opens a case, then simulates matches.
// Usage: THREE_JS=/path/to/three.min.js [HTML=page.html] [MAPS=a,b] node breach-point/tools/smoke.cjs [outDir] [quick|ui|maps|full]
// (three.min.js r128 is served locally so the test does not need the CDN.)
let pw;try{pw=require('playwright');}catch(e){pw=require('/opt/node-tools/node_modules/playwright');}
const fs=require('fs'),path=require('path');
const out=process.argv[2]||'.';const mode=process.argv[3]||'quick';
(async()=>{
  const b=await pw.chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  const pg=await b.newPage({viewport:{width:1280,height:720}});const errs=[];
  pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message+'\n'+(e.stack||'').split('\n').slice(0,4).join('\n')));
  pg.on('console',m=>{if(m.type()==='error'&&!/ERR_CERT|fonts\.g/.test(m.text()))errs.push('console: '+m.text());});
  await pg.route('**/three.min.js',r=>r.fulfill({body:fs.readFileSync(process.env.THREE_JS),contentType:'application/javascript'}));
  await pg.route('https://fonts.**',r=>r.abort());
  await pg.goto('file://'+path.resolve(process.env.HTML||path.join(__dirname,'../../breach-point.html')));
  await pg.waitForFunction(()=>window.__bp||document.getElementById('loading').textContent.startsWith('Failed'),null,{timeout:60000});
  const shot=async n=>{await pg.waitForTimeout(2500);await pg.screenshot({path:path.join(out,n+'.png')});};
  await shot('lobby');
  const E=(f,a)=>pg.evaluate(f,a);
  if(mode==='quick'||mode==='ui'){
    await E(()=>{window.__bp.Profile.data.coins=5000;window.__bp.Lobby.refreshTop();});
    for(const t of['inventory','loadout','store']){await pg.click(`#menuNav button[data-tab="${t}"]`);await shot('tab_'+t);}
    await pg.click('#btnOpenCase');await pg.waitForTimeout(9000);await pg.screenshot({path:path.join(out,'case.png')});
    await pg.click('#coEquip').catch(()=>{});
    await pg.click('#menuNav button[data-tab="inventory"]');await shot('inventory2');
    // give an agent and finish the match to see the payout
    await E(()=>{const {Profile,CASES}=window.__bp;const it=Profile.add({a:'W_riot',r:3});Profile.equip(it.uid,'W');const k=Profile.add({w:'knife',f:'sunsetfade',r:4,fl:0.02});Profile.equip(k.uid,'W');Profile.equip(k.uid,'S');});
    await pg.click('#menuNav button[data-tab="loadout"]');await shot('loadout2');
    await E(()=>{const {G,Input,Lobby,S}=window.__bp;document.getElementById('menu').classList.add('hidden');document.getElementById('hud').classList.remove('hidden');Lobby.hideModel();G.newMatch('W','harbor');Input.locked=true;
      const p=G.player;p.slot=3;});
    await shot('knife_vm');
    await E(()=>{const {G,Game}=window.__bp;G.score=[13,7];G.player.stats.k=17;G.player.stats.a=4;G.player.stats.mvp=3;Game.gameOver();});await shot('gameover');
    await pg.click('#btnMenu');await shot('lobby2');
  }
  const maps=mode==='ui'?[]:(process.env.MAPS?process.env.MAPS.split(','):await pg.evaluate(()=>window.__bp.MAP_ORDER.slice()));
  for(const m of maps){
    const log=await E(async(m)=>{const {G,Game,Input,S,Lobby}=window.__bp;S.map=m;document.getElementById('menu').classList.add('hidden');document.getElementById('hud').classList.remove('hidden');Lobby.hideModel();
      G.newMatch('S',m);Input.locked=true;return 'started '+m;},m);
    await shot('game_'+m);
    const res=await E((mode)=>{const {G,Game}=window.__bp;const log=[];let lastR=0;const steps=mode==='full'?60*60*30:60*60*2.2;
      for(let i=0;i<steps;i++){Game.sim(1/60);if(G.round!==lastR){lastR=G.round;log.push('R'+G.round+' '+G.score.join(':'));}
        if(G.phase==='end'&&!G._l){G._l=1;log.push('  '+document.getElementById('roundBanner').textContent.replace(/\s+/g,' ').slice(0,70));}if(G.phase!=='end')G._l=0;
        if(G.phase==='over'){log.push('OVER '+G.score.join(':')+' | '+document.getElementById('rewards').textContent.slice(0,80));break;}}
      return log.join('\n');},mode);
    console.log('== '+m+'\n'+res);
    await shot('after_'+m);
  }
  console.log(errs.length?errs.slice(0,15).join('\n'):'no errors');
  await b.close();
})();
