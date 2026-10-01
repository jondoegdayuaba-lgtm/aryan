# Breach Point audit: implementation backlog

The findings JSON was cut off partway through `overlays-persist-after-quit`. That item (A7) is reconstructed from the part that arrived; anything past the cut is marked "unverified". I re-checked the line anchors with grep against the current sources: 05-engine `moveAxis`:390, `separateAgents`:444, `fireGun`:506, `weaponLogic`:554, `applyDamage`:593, `killAgent`:608, `updateNades`:642, `updateFireDamage`:688, `dropItem`:697, `dropBomb`:703, `updateItems`:708, `clearItems`:730, `tryPlant`:733, `plantBomb`:741, `updateBomb`:749. 06-bots: `roundReset`:15, `onBombPlanted`:25, rotate `setTimeout`:98, `doThrow`:107, `post`:190, `rotate`:201, `retake`:202, `buyItem`:237, `botBuy`:256. 08-game: `newMatch`:14, flags :92-107, `keyboard.lock`:146, `toMenu`:150, `usePlant`:165. 07-hud: keydown `inMatch` guard :287, Buy branch :289, hurtPunch on the camera :67. 00-head: `.overlay` z20 :101, `#menu` z30 :141.

Headless harnesses mentioned below are in `/tmp/claude-0/-home-user-aryan/9c0980e6-16d8-511f-9fe9-d939c5b9ff64/scratchpad/simaudit/` (harness.cjs plus t1, t3, t4, t6, t7b, t11, t12, t13). Copy them into `tools/` if they should survive.

---

## Package overview (ordered by value)

| # | Package | Main files | Can run in parallel with |
|---|---|---|---|
| A | Match flow, UI, input, persistence | 08-game, 07-hud (input/HUD), 00-head, 10-lobby, 09-items, 01-core | everything (needs only `clearBomb` from C) |
| B | Movement and collision | 05-engine §physics (355-451), 07-hud `Cam` | A, D, E |
| C | Bomb and item rules | 05-engine §items/bomb (697-770), 08-game:165, 03-world helper | A, B; must land before E3/E4 |
| D | Shooting and grenades | 05-engine §shoot/nades (506-692), 04-models | A, B; touches `weaponLogic`, coordinate with C3 |
| E | Bot AI correctness fixes | 06-bots | after C (uses `canDefuse` and bomb snapping) |
| F | Bot AI behaviour upgrades | 06-bots, 08-game (startRound), 02-maps, tools/check-maps.cjs | after E |
| G | World navigation | 03-world | anytime; G1 (`World.isWater`) is needed by C4 and D5 |

All of B, C and D edit 05-engine.js, but in separate function ranges. Merge conflicts should be textual only, so land them in sequence or rebase between them.

---

## Package A: match flow, UI, input, persistence (highest value: crashes, unusable menus, wrong match results)

**A1 `persisted-ids-brick-lobby` (high).** A saved unknown map or item id crashes boot every time.
- **Change.** In `boot()` in 08-game.js (around line 260), before `loadMap` and `Lobby.init`, add: `if(!MAPS[S.map])S.map=MAP_ORDER[0]||'sandline'; if(!DIFF[S.difficulty])S.difficulty='normal'; if(!QUALITY[S.quality])S.quality='high'; if(!['S','W','random'].includes(S.side))S.side='random';`. Coerce numeric settings with `Number.isFinite` and fall back to the defaults. Then call `saveSettings()`, and `loadMap(S.map)` afterwards.
- **Fallback in 10-lobby.js:122.** Use `(MAPS[S.map]||MAPS[MAP_ORDER[0]]).desc`.
- **09-items.js.** Add `Profile.known(it)`: `it.a?!!AGENT_INFO[it.a]:!!WEP[it.w]&&(!it.f||!!FINISHES[it.f])&&(!it.k||!!KNIVES[it.k])&&!!RARITY[it.r]`.
  - The inventory, case, store and loadout renderers iterate `items.filter(Profile.known)`, but unknown items stay in the save.
  - `itemName` and `itemKind` fall back to `'?'`.
  - `skinFor` returns `it&&it.f&&FINISHES[it.f]?it.f:null`.
  - `Profile.load` resets `equip[T].agent` when it is not in `AGENT_INFO`.
  - `Profile.owns` is guarded with `AGENT_INFO[agent]&&…`.
  - 10-lobby.js:181 `renderLoadout` uses the guarded `skinFor`.
- **Optional.** Give draft builds (build.py `--extra`) a different storage-key suffix.
- **Acceptance.** A node script with a stub `localStorage` holding `S.map='neonrow'` and a profile item `{w:'ak',f:'nonexistent'}` runs boot, `Lobby.init`, `renderInventory` and `renderLoadout` with no throw. `S.map` is then `'sandline'` and the unknown item is still in `Profile.data.items`.
- **Risk.** Low. Do not delete unknown items from the save.

**A2 `stale-match-end-flags` (high).** A stale flag ends or swaps the next match after round 1.
- **Change.** In `G.newMatch` (08-game.js:14), next to `this.score=[0,0]`, add `this.gameOverPending=false;this.halfPending=false;`. Also add `G.gameOverPending=G.halfPending=false;` in `Game.toMenu` (:150).
- **Design decision, optional.** If `G.gameOverPending` is set when `toMenu` runs, call `Profile.reward(G.player, G.score[0]>G.score[1], G.score[0]===G.score[1], G.score[0], S.difficulty)` before the agents are cleared. Do not call the full `gameOver()`.
- **Acceptance.** Set `gameOverPending=true`, call `toMenu()` then `newMatch()`, play round 1 to its end: there is no `gameOver` call and no side swap.
- **Risk.** Low.

**A3 `lobby-settings-behind-menu` (high).** The lobby SETTINGS dialog opens behind the menu and cannot be used.
- **Change.**
  - In 00-head.html, add `#settings{z-index:40}`. That is above `#menu` (30) and below `#picker` (45), `#caseOpen` (50) and the toast (60).
  - In the 07-hud.js keydown handler, before `if(!G.inMatch())return;` (:287), add `if(e.code==='Escape'&&!$('settings').classList.contains('hidden')){Settings.close();return;}`.
  - In `Game.start` (08-game.js, near :147), add `if(!$('settings').classList.contains('hidden'))Settings.close();`.
  - Add a smoke 'ui' step that clicks `[data-tab=settings]` and then `#btnCloseSet`.
- **Acceptance.** Read the CSS: the computed z-index of `#settings` is greater than that of `#menu`. The smoke 'ui' step passes.
- **Risk.** Low. Check that the pause-menu path still layers correctly (40 > 20 is fine).

**A4 `esc-does-not-pause-in-fullscreen` (high).** Keyboard lock captures Esc, and the game has no Escape handler of its own.
- **Change.** In 07-hud.js keydown, after `if(!G.inMatch())return;` (:287) and before `if(Buy.open)` (:289), add:
  ```js
  if(e.code==='Escape'){e.preventDefault();if(e.repeat)return;
    if(!$('settings').classList.contains('hidden')){Settings.close();return;}
    if(Buy.open){Buy.toggle(false);return;}
    if(!Game.paused&&G.phase!=='over'){Input.allowUnlock=true;if(document.pointerLockElement)document.exitPointerLock();Game.pause(true);}
    return;}
  ```
  Use the simple version: Esc never resumes, and the player clicks Resume or the canvas. This avoids a double toggle with the browser's own Esc and pointerlockchange in Firefox or windowed mode. Keep `keyboard.lock()` with no key list (08-game.js:146).
- **Check.** `Settings.close()` must go back to the pause panel when the dialog was opened from 'pause'.
- **Acceptance.** A jsdom/stub test dispatches keydown Escape with `G.phase='live'`; `Game.paused` becomes true. A second Escape with Settings open closes Settings and the game stays paused.
- **Risk.** Low to medium. Test manually in Chrome fullscreen and in Firefox windowed (by hand, not in this run).

**A5 `buy-menu-timing` (medium).** The buy menu stays open and keeps buying after buy time ends, after the plant, and while dead.
- **Change.**
  1. In 07-hud.js `Buy.render`, button handler (around :241): `b.onclick=()=>{if(!G.canBuy(p)){SFX.deny();Buy.toggle(false);return;}if(buyItem(p,id))this.render();else SFX.deny();};`. Hotkeys go through `b.click()`, so this covers them too.
  2. In the 08-game.js main loop (not in `HUD.update`, which returns early when there is no view target): `if(Buy.open){if(!G.canBuy(G.player))Buy.toggle(false);else $('buyTime').textContent='Buy time left: '+Math.ceil(G.buyEnd-NOW)+' s';}`.
  3. At 07-hud.js:289, change the branch to `if(Buy.open){if(e.repeat)return;…}`.
- **Acceptance.** Open Buy, advance `NOW` past `G.buyEnd`, run one sim frame: `Buy.open===false`. Clicking a button while dead does not change money.
- **Risk.** Low. Pointer re-lock after an automatic close needs a click; that is acceptable.

**A6 `ghost-planted-bomb` (high). Implemented in C. Listed here because A2 and A7 depend on it.** See C6.

**A7 `overlays-persist-after-quit` (medium; the finding was truncated).** Scope, flash, smoke and hurt overlays, plus the kill feed and chat, stay over the lobby after quitting.
- **Change.** In `Game.toMenu` (08-game.js:150), reset the overlays that sit outside `#hud`:
  - `$('scope').classList.add('hidden')`
  - `$('smokeOv').style.opacity=0`
  - `$('hurt').style.opacity=0`
  - `$('flash').style.opacity=0`
  - Clear the kill-feed and chat containers (07-hud.js, `HUD.kill`/`HUD.chat` targets).

  Factor this into `HUD.reset()` and also call it from `newMatch`.
- **Acceptance.** Set the overlay styles non-zero, call `toMenu()`, then assert they are reset.
- **Risk.** Low. Unverified: the exact element ids and any extra details past the truncation point.

---

## Package B: movement and collision (05-engine 355-451, 07-hud `Cam`)

**B1 `separation-teleports-along-walls` (critical).** Agent separation teleports agents along walls and sometimes out of the map.
- **Change in `separateAgents` (:444-451).**
  - Clamp `push` to 0.2 m per frame.
  - Replace the direct `pos` writes and the two `moveAxis(…, 0.0001)` calls with `moveAxis(a,'x',-nx*push); moveAxis(a,'z',-nz*push); moveAxis(b,'x',nx*push); moveAxis(b,'z',nz*push);`.
- **Change in `moveAxis` (:390-401).**
  - Record `const p0=a.pos[ax]` first.
  - Resolve each overlap against the direction of travel: if `d>0`, `pos[ax]=box.min-R-1e-4`; otherwise `pos[ax]=box.max+R+1e-4`. The early `if(!d)return` already covers `d===0`.
  - Zero `vel[ax]` only when it points into the box.
  - Repeat the box loop until nothing overlaps, at most 3 passes. If something still overlaps after that, set `pos[ax]=p0`.
  - Leave the step-up branch unchanged.
- **Acceptance.**
  - `t1.cjs` (agent on the Sandline north wall at x=-13 with a teammate pushing): |Δx| stays under 0.3 m over 60 frames.
  - `t7b.cjs` hard-bot rounds: no per-frame displacement over 0.6 m that is not explained by velocity, and no agent with `blockedAt` true at the end of a round.
  - A unit case with two crates 0.1 m apart: the agent ends up outside both.
- **Risk.** Medium. A teammate's shove can now trigger step-up onto low crates. Check that this looks acceptable. `moveAxis` is the hot movement path, so run the full smoke afterwards.

**B2 `air-crouch-teleport` (medium).** Crouching or uncrouching in the air moves the body ±0.5 m in one frame and pops the camera.
- **Change in `physics` (:407-412).**
  - Initialise `a.tucked=false` in spawn (:355). Clear it wherever `onGround` becomes true.
  - Airborne tuck, only when the `blockedAt` check passes: `a.pos.y+=0.5;a.crouchAmt=1;a.tucked=true;`. A blocked tuck keeps the current behaviour.
  - Airborne release with `tucked`: `ny=Math.max(g,a.pos.y-0.5)`. If `!blockedAt(a,ny,STAND_H)`, set `a.pos.y=ny;a.crouch=false;a.tucked=false;a.crouchAmt=clamp((1.64-(oldEye-ny))/0.56,0,1)` so the eye stays continuous.
  - Airborne release without `tucked`: check headroom only, set `crouch=false` with no `pos` change, and let `crouchAmt` animate.
- **Acceptance.** `t4.cjs`: per-frame |ΔeyeY| is at most 0.07 m across tuck and untuck. A ground-crouch → jump → release sequence gives a peak foot height of about 1.15 m.
- **Risk.** Low. Crouch-jump onto m/v crates must still work. Verify that the max mount height is unchanged.

**B3 `crosshair-vs-shot-ray`: implemented in D (D4). It touches `Cam` in 07-hud; coordinate with B if B is also editing `Cam.update`.**

---

## Package C: bomb and item rules (05-engine 697-770, 08-game:165)

Shared helpers to add first, in 05-engine.js, and export them for 06-bots:
- `onFloor(a)`: `World.walkable(colOf(a.pos.x),rowOf(a.pos.z)) && a.pos.y<=World.heightAt(a.pos.x,a.pos.z)+0.1`
- `canDefuse(a,B)`: `Math.hypot(a.pos.x-B.pos.x,a.pos.z-B.pos.z)<1.7 && Math.abs(a.pos.y-B.pos.y)<1.3 && !World.segBlocked(eye.x,eye.y,eye.z,B.pos.x,B.pos.y+0.25,B.pos.z)`
- `clearBomb()`: `if(G.bomb&&G.bomb.mesh){scene.remove(G.bomb.mesh);G.bomb.mesh=null;}`
- `snapToFloor(it)`: `const [c,r]=World.nearestWalk(colOf(x),rowOf(z))`, then set the position to that cell's centre at `heightAt+0.05`. `nearestWalk` takes cell coordinates, not a world position.

**C1 `bomb-on-props-and-defuse-range` (high, guaranteed-win exploit). This also removes the root cause of `bots-cannot-defuse` problems 2 and 3.**
- **Change.**
  - In `tryPlant` (:733), before the `inSite` check: `if(!onFloor(a)){if(a.isPlayer)HUD.hint('You must be on the ground to plant.');return false;}`. Stair cells '1'-'5' are walkable and pass.
  - In `updateBomb` (:756), replace `a.pos.distanceTo(B.pos)<1.7` with `canDefuse(a,B)`.
  - In `updateItems` (:708), when an `it.bomb` item comes to rest on a non-walkable cell or more than 0.1 above `heightAt`, call `snapToFloor(it)`.
  - In `dropBomb` (:703), also apply the C5 ray clamp.
- **Acceptance.**
  - A player jumping onto the Sandline A crate at (14,10): `tryPlant` returns false.
  - The defuse line-of-sight check rejects a Warden behind the '|' panel at (47,9).
  - A bomb dropped on top of a crate comes to rest at a walkable cell centre.
- **Risk.** Low. Check that each map's `PLANT_SPOT` passes `onFloor` (verify in check-maps).

**C2 `defuser-takeover` (medium).** A second Warden holding E wipes the current defuser's progress.
- **Change.** In `updateBomb`:
  ```js
  const ok=a=>a&&a.alive&&a.team==='W'&&a.input.use&&a.onGround&&canDefuse(a,B);
  let def=ok(B.defuser)?B.defuser:null;
  if(!def){ if(B.defuser){B.defuser.defuseProg=0;B.defuser=null;} for(const a of G.agents)if(ok(a)){def=a;break;} }
  ```
  If `B.defuser!==def`, start a new defuse; otherwise keep the current progress. Delete the old else branch.
- **Acceptance.** `t6.cjs`: a bot 6 s into its defuse keeps its progress when the player presses E, and the defuse completes at 10 s.
- **Risk.** Low.

**C3 `e-plant-paths` (medium).** Holding E with the bomb out does nothing, and E-planting with a gun out lets you shoot while planting.
- **Change.**
  - 08-game.js:165: `const usePlant=a.hasBomb&&a.input.use&&!(a.slot===5&&a.input.fire);`
  - In `weaponLogic` (:554), after the nade and bomb branches and before the knife and gun branches:
    ```js
    const busy=a.plantProg>0||a.defuseProg>0||(inp.use&&a.hasBomb&&inSite(a.pos)&&G.phase==='live'&&!G.bomb)||(inp.use&&a.team==='W'&&G.bomb&&!G.bomb.done&&canDefuse(a,G.bomb));
    if(busy){a.triggerLatched=!!inp.fire;return;}
    ```
    Reload completion runs earlier in the function and is unaffected.
- **Acceptance.** `t6.cjs`: E held for 4 s with slot 5 plants. With a rifle out, E held plus fire produces no shots.
- **Risk.** Low. This shares the `weaponLogic` edit area with D1 and D2, so land them in sequence.

**C4 `water-no-floor` (medium, item part). Needs G1 `World.isWater`.** Dropped items land on an invisible floor at y=0 over water, and a bomb dropped at the quay cannot be recovered.
- **Change in `updateItems`.** When an item comes to rest and `World.isWater(it.pos.x,it.pos.z)`:
  - Bomb: `snapToFloor(it)`, splash FX, `HUD.chat('The bomb washed back onto the quay.','sys')`. Keep `G.bombItem` pointing at it.
  - Guns: remove them from the scene and splice them out, iterating the list backwards.
- **Change in `dropBomb`.** If `World.isWater` at `pos+vel*0.45`, zero the horizontal velocity.
- **Acceptance.** `t13.cjs`: a quay-edge G drop ends within 1.0 m of a walkable cell, and a bot in 'getbomb' picks it up.
- **Risk.** Low.

**C5 `drop-inside-wall` (low).** Guns dropped while facing a wall spawn and rest inside the wall.
- **Change.** In `dropItem` (:697) and `dropBomb`:
  ```js
  const e=a.eye(),h=World.rayFirst(e,d,0.5),off=h?Math.max(0,h.t-0.15):0.5,p=e.clone().addScaledVector(d,off);
  ```
  In `updateItems`, non-rest branch: if `World.pointSolid(it.pos.x,it.pos.y,it.pos.z)`, set `it.pos.x/z` to `it.from.pos.x/z`. Store `it.from` in `dropItem`. Make the x/z bounce revert to the last non-solid position.
- **Acceptance.** `t13.cjs`: a gun dropped facing the wall comes to rest with z at or above -59.85, outside the wall face.
- **Risk.** Low.

**C6 `ghost-planted-bomb` (high).** The planted bomb model is never removed after a defuse or elimination win.
- **Change.** Make `clearItems` (:730) also call `clearBomb()`. `startRound` calls `clearItems` before `this.bomb=null` (08-game.js:43-44), and `newMatch` and `toMenu` also call it. Do not dispose the bomb's geometry or materials, because `buildGun` may share cached resources.
- **Also.** Where a fire ends (05-engine around :302) and in `FX.clear` (around :328), add `f.scorch.geometry.dispose();f.scorch.material.dispose();`. Never dispose `TEX.scorch`, which is shared.
- **Acceptance.** Plant, defuse, then `startRound`: `scene.children` contains no bomb group. Ten rounds give a constant `scene.children.length`.
- **Risk.** Low.

**C7 `bomb-kill-credit` (low).** The bomb explosion credits the planter with kills and $300 per victim.
- **Chosen fix.** In `killAgent` (:608), add `&&wid!=='world'` to the kill-credit guard. This keeps the kill feed name and bomb icon. Rejected alternative: passing a null attacker, which loses the killer in the feed.
- **Acceptance.** A detonation that kills 2 Wardens leaves the planter's kills and money unchanged.
- **Risk.** Low. F7 also edits `killAgent`; merge carefully.

**C8 Noise on plant and defuse (from `hearing-model` item 3).** Add `Noise.emit(a,a.pos,25)` next to `SFX.plantTick` in `tryPlant`, and `Noise.emit(def,B.pos,20)` next to `SFX.defuseTick` in `updateBomb`. It is placed here to avoid touching these functions twice.

---

## Package D: shooting and grenades (05-engine 506-692, 04-models)

**D1 `first-shot-spread` (high).** The first shot always includes one shot of spread.
- **Change.** In `fireGun` (:506-510):
  ```js
  const pat=patternAt(w,a.recoilIdx);
  const spread=inaccuracy(a,w)+(a.bot?a.bot.aimJitter:0);
  a.recoilIdx=Math.min(a.recoilIdx+1,w.pattern.length-2);
  ```
  Remove the later `const spread=` line.
- **Acceptance.** `t3.cjs`: the first-bullet spread equals the crosshair value (Hawk 0.35°, G-9 0.30°, AR-K7 0.12°).
- **Risk.** Medium for balance. Hawk and pistols get much stronger, and sprays get one `I.shot` step tighter. Consider retuning `I.shot` for Hawk.

**D2 `frame-rate-dependent-fire-rate` (medium).** Automatic fire rate depends on frame rate.
- **Change.** In `fireGun`, replace `a.nextFire=NOW+w.rof` with:
  ```js
  const carry=w.auto&&a.triggerLatched&&NOW-a.nextFire<0.1;
  a.nextFire=(carry?a.nextFire:NOW)+w.rof;
  ```
  Do not add a multi-shot while loop. `dt` is capped at 0.05, which is below the smallest `rof` (Vex 0.075).
- **Acceptance.** `t12.cjs`: AR-K7, M-4R and Vex fire at 97% or more of nominal at 30, 60 and 144 fps.
- **Risk.** Low. Check that `triggerLatched` is set before `fireGun` is reached on held fire; otherwise use `a.lastFire>0`.

**D3 `knife-armor` (medium).** Knife backstabs do not kill armoured targets.
- **Change.** 04-models.js:17: add `ap:0.85` to `WEP.knife`.
- **Acceptance.** A heavy backstab (180) against armour 100 kills.
- **Risk.** None.

**D4 `crosshair-vs-shot-ray` (low).** Hit flinch and stair smoothing move the crosshair away from where bullets go.
- **Chosen model.** A real CS-style aim punch.
- **Change.**
  - In `fireGun` (:514) and the knife trace (:532), set `pitch=a.pitch+a.hurtPunch*DEG+…`, with the same sign as 07-hud.js:67.
  - For the local player (`a===G.player&&Spectate.mode==='alive'&&typeof Cam!=='undefined'`), set the origin y to `Math.max(Cam.eyeY, a.eye().y-0.6)`.
- **Alternative.** Remove `hurtPunch` from `Cam.update` instead. Decide which one before implementing.
- **Acceptance.** Read the code: the camera pitch and the shot pitch use the same terms. A shot taken on the stair step frame starts at `Cam.eyeY`.
- **Risk.** Low.

**D5 `molotov-ignores-geometry` (medium) plus `water-no-floor` grenade part (needs G1).**
- **Change in `detonate` (:659/685).**
  - `const gh=World.heightAt(p.x,p.z)`. If the grenade is over water, fizzle it (puff, no `addFire`).
  - Otherwise set `fire.onProp = p.y-gh>0.1`; such a fire uses radius 1.2 and a vertical band of 0.5.
- **Change in `updateNades` (:642-651).** The floor is `World.isWater(n.pos.x,n.pos.z)?-0.7:0.04`. A molotov touching water fizzles. A smoke over water detonates at -0.6. HE and flash keep their timer.
- **Change in `FX.addFire`.** Skip any sprite where `World.pointSolid(x,pos.y+0.2,z)` or `segBlocked(centre→sprite)` is true.
- **Change in `updateFireDamage` (:688).** Rewrite it as one tick per agent per frame: take the first valid fire, which requires radius, the vertical band (`f.onProp?0.5:1.4`), the team rule and `!World.segBlocked(f.pos.x,f.pos.y+0.3,f.pos.z,b.pos.x,b.pos.y+0.3,b.pos.z)`. With no fire, `fireDmgT=0`. Otherwise `fireDmgT+=dt` and every 0.25 s apply 8 'fire' damage.
- **Acceptance.** `t11.cjs`:
  - A Warden behind the '|' panel at (47,9) takes 0 damage.
  - A Warden on the floor beside a crate fire takes 0 damage.
  - Two overlapping fires deal the same damage per second as one.
  - A Harbor sea molotov makes no fire.
- **Risk.** Medium. Make sure that a fire on the floor next to a low wall still damages agents on the same side.

**D6 `flash-smoke-and-bot-blind`, engine part (low).** Flashbangs blind through smoke, and bots go fully blind from flashes behind them.
- **Change.** In the flash branch of `detonate` (674-680), after `segBlocked`, add `if(FX.smokeBlocks(V3(p.x,p.y+0.15,p.z),e))continue;`, and call `b.bot.onFlashed(dur,k)`.
- **Bot side.** See E9; land both in the same PR.
- **Risk.** Low.

---

## Package E: bot AI correctness (06-bots; after C)

**E1 `stuck-detour-freezes-bot` (high).** Stuck recovery swaps in a random 3 m path and then freezes the bot.
- **Change.**
  - In the `stuckN>2` branch (:219-222), also set `this.detourUntil=NOW+2`.
  - In `goTo`, at the top: `if(this.detourUntil&&NOW<this.detourUntil&&this.path)return;`.
  - In `navigate`, right after `let dir=hold?null:this.moveDir();`:
    ```js
    if(!hold&&!dir&&this.path&&!this.atGoal(1.2)&&NOW>(this.repathAt||0)){this.detourUntil=0;this.repathAt=NOW+0.5;this.path=null;this.stuckN=0;this.goTo(dest);dir=this.moveDir();}
    ```
  - Add `repathAt:0,detourUntil:0` to `roundReset`.
  - Delete the no-op line 217.
  - Optional: after 3 re-paths to the same exec entry, advance `entryIdx`.
- **Acceptance.** In a headless round, force a bot into the stuck branch: it reaches its original `dest` within 10 s. In `t7b.cjs`, count of bots stationary for more than 5 s with `!hold`: 0.
- **Risk.** Low.

**E2 `postplant-own-bomb-kills-strikers` (high).** Post-plant Strikers stay inside the blast and die to their own bomb.
- **Change.**
  - In `onBombPlanted` (:25), for S bots, compute `this.exitPt`: walk `World.findPath(B.pos, cp(this.plan.stage))` and take the first node at least 24 m from `B.pos`, or the last node.
  - In case 'post' (:190), first:
    ```js
    const d=a.pos.distanceTo(B.pos);
    if(B.t<(24-d)/RUN_SPEED+3&&!(B.defuser&&B.t>4)){dest=this.exitPt;hold=false;look=B.pos.clone();break;}
    ```
    Use the run-speed constant from 05-engine; do not hard-code 5.2.
  - Gate the defuser rush (:194) with `B.t>3`.
  - Clear `exitPt` in `roundReset`.
- **Acceptance.** In headless S-detonation wins on all three maps, the alive-S count before and after the explosion is equal.
- **Risk.** Low.

**E3 `bots-cannot-defuse` (high, problem 1 plus the bot side of C1).** Bots never defuse when the human is closer.
- **Change.**
  - Defuser election (:203):
    ```js
    G.agents.filter(o=>o.alive&&o.team==='W'&&(o.bot||B.defuser===o||Math.hypot(o.pos.x-B.pos.x,o.pos.z-B.pos.z)<2))
    ```
  - Bot `close` test (:204) becomes `canDefuse(a,B)`, with the bot steering to a horizontal distance under 1.4.
  - When `moveDir()` is null and the bomb is within 3 m horizontally, `setMove` straight toward `B.pos`. Apply the same to 'getbomb' (:189).
  - Widen the pickup radius for the bomb only to 1.4 m (05-engine :720; coordinate with C).
- **Dropped.** The climb/jump logic is not needed, because C1 guarantees floor plants and snapped drops.
- **Acceptance.** With the player W alive, idle and nearer than the bots: a bot defuses. A bomb dropped on a crate is collected by a bot.
- **Risk.** Low.

**E4 `retake-spot-oscillation` (high).** Retaking Wardens jitter on the 12 m ring around the bomb and re-run A* each flip.
- **Change.**
  - `onBombPlanted(){this.path=null;this.spot=null;this.holdLook=null;this.mode=this.a.team==='S'?'post':'retake';}`
  - In retake, when `!this.spot`, use `freeSpot(SITE_SPOTS[B.site].filter(c=>cp(c).distanceTo(B.pos)<=9))`, falling back to the closest spot. `freeSpot` is introduced in F3; if F3 is not done yet, use a plain filter for now.
  - Latch: `if(!this.retakeIn&&d<12)this.retakeIn=true;else if(this.retakeIn&&d>16)this.retakeIn=false;`. Use the spot only while the latch is set. At the spot, `hold=this.atGoal(1)` and `look=B.pos`.
- **Acceptance.** Count `findPath` calls per W bot during a retake: at most 5 per 10 s. No dest flips at the 12 m boundary.
- **Risk.** Low.

**E5 `rotation-bugs` (medium).** Rotating Wardens shake between look targets, stack on taken holds, and rotate on a wall-clock `setTimeout`.
- **Change.**
  - Replace the `setTimeout` (:98) with `this.rotateAt=NOW+rand(1,4);this.rotateRound=G.round;`.
  - In `think()`, when `NOW>=rotateAt`, check alive, `!G.bomb`, `phase==='live'` and `G.round===rotateRound`, then switch to rotate.
  - In rotate (:201), pick once: `this.rotHold=pick(free holds)` (excluding the `hold`/`rotHold` of other alive W bots). Then `dest=cp(rotHold.c)` and `look=hold?cp(rotHold.l):null`.
  - Use a per-round `G.rotations` counter: one rotator per site on the first intel, a second only on fresh intel or 2 or more enemies seen.
  - Reset `rotateAt`, `rotHold` and `G.rotations` at round start.
- **Acceptance.** `tools/smoke.cjs` now shows rotations. The look target stays constant per bot.
- **Risk.** Low. Smoke baselines will change.

**E6 `getbomb-stampede` (medium).** Usually 2-3 Strikers rush a dropped bomb and never stop.
- **Change.**
  - In `think()` for S, elect one fetcher: `G.bombFetcher`, the nearest alive S bot, re-elected when it dies. The fetcher saves `prevMode`/`prevEntryIdx` and enters 'getbomb'.
  - A non-fetcher in 'getbomb' restores its previous mode.
  - Replace line 88 with the restore logic: 'stage' if the previous mode was idle/stage/wait and `NOW<G.execAt`; otherwise 'exec' with `entryIdx=0` and `queueUtil(plan)`.
  - Clear `G.bombFetcher` in 08-game.js:44 and at the 05-engine pickup (:721).
  - Stagger `thinkT` with `Math.random()*0.25` in `roundReset`.
- **Acceptance.** On a bomb drop, exactly 1 bot is in 'getbomb'.
- **Risk.** Low.

**E7 `bot-grenade-lobs-fail` (high).** Flashes and HEs burst high in the air, far mollies fizzle, smokes land on roofs, and throws reach 30-40 m/s.
- **Change.**
  - In `doThrow` (:107): `T=Math.min(clamp(dist/11,0.7,2.6)+0.35, flash/he?1.45:fire?2.0:3.5)`.
  - If the required horizontal speed is above 20 m/s, return false so the util stays queued, and re-try each think tick while walking the entry path.
  - Sample the arc every 0.1 s with `World.pointSolid`; if it is blocked, return false.
  - Pop flashes aim at `target.y+1.5`.
  - Rate-limit yaw instead of snapping (:112).
  - After a flash, look away for 1.2 s.
  - The queue at :130 must only `shift()` when `doThrow` returns true, with a time-out drop.
  - Gates: retake (:210) at under 14 m, post-plant molly (:193) at under 18 m.
  - Data and tooling: move the roofed util cells (Harbor A rail smoke [17,13], flash [10,16]; Frostbite B smoke [16,12]) to open cells in 02-maps.js. Make tools/check-maps.cjs fail when a util cell is under `MAP.roofs`.
- **Acceptance.** Replay the doThrow formula offline over every plan: all flash/HE bursts happen within 2 m of the target height, no throw exceeds 20 m/s, and check-maps passes.
- **Risk.** Medium. Bots throw less often until they reach range.

**E8 `utility-usage-gaps`, quick part (medium).** Bots buy utility they never throw, and some utility fires once per match.
- **Change.**
  - In `roundReset`, add `firedMolly:false,retakeUtil:false,utilRoll:Math.random()<this.diff.util`.
  - Line 210 uses `this.utilRoll` and sets `retakeUtil=true` only when `doThrow` returns true.
  - In `queueUtil`, spread targets with `plan.flash[i%plan.flash.length]` and stagger them by `i*0.4` s.
- **Larger part.** Side-specific buying and new throw uses go to F.
- **Acceptance.** Molly and retake util fire in rounds 2 and later. The util rate tracks the `diff.util` setting.
- **Risk.** Low. Depends on E7.

**E9 `flash-smoke-and-bot-blind`, bot part.**
- **Change.** `onFlashed(d,k){if(k<0.3){this.reactAt=Math.max(this.reactAt,NOW+k);return;}this.flashedUntil=Math.max(this.flashedUntil,NOW+d*0.85);}`
- Land it with D6.

---

## Package F: bot AI behaviour upgrades (06-bots, 08-game startRound, 02-maps, check-maps; after E)

Order inside F: F1 → F2 → F3 → F4 → F5, then the rest.

**F1 `postplant-faces-wrong-way` (high).** Strikers on site and post-plant look toward their own entry.
- **Change.**
  - At map load, compute `RETAKE_LOOKS[site]`: for each W spawn cell and each `HOLDS.M` centre, take `findPath` to `PLANT_SPOT[site]`. Walking back from the plant end, take the first node at least 8 m out that some `SITE_SPOT` can see (`segBlocked` eye to eye). Deduplicate nodes within 6 m.
  - In 'post' and 'site', the bot at its spot picks a visible, unclaimed look, round-robin via an index on `B`. Keep one bot on the original `HOLDS` look for flanks.
  - Optional: authored `postLooks` per site, validated in check-maps.
- **Acceptance.** Recompute the dot-product metric from the finding: the average for the post look against the W-spawn direction is above 0.
- **Risk.** Low. Map-load cost is a few `findPath` calls.

**F2 `retake-and-save-logic` (high).** Retakes trickle in one at a time, and nobody saves.
- **Step 1, quick.**
  - Defuse only if `B.t>need+0.3` (`need=a.kit?5:10`).
  - New 'save' mode when `B.t<need+pathLen/RUN_SPEED+0.5`, or when alive W ≤ 1 and known S ≥ 3 and `B.t<need+8`.
  - In 'save', dest is the farthest reachable node more than 25 m from the bomb (the bot's hold or W spawn), with `walk=true`.
  - Also handle S late saves.
- **Step 2.**
  - Shared per-site `gather` point computed in `onBombPlanted`: the last node on the path from W spawn that is 18-25 m from the bomb with no line of sight to `SITE_SPOTS`.
  - Hold there until 2 or more W bots are within 6 m, or the timer requires leaving.
  - Throw utility (E7), then push with a 0.3-0.6 s stagger, using F1 angles as looks.
- **Acceptance.** No W bot dies to the explosion while defusing with `B.t<need`. Headless retake arrivals within 2 s of each other in at least 60% of retakes.
- **Risk.** Medium. Conflicts with E4's latch logic: F2 replaces the dest selection in retake, so implement it as an extension of E4.

**F3 `stacking-and-exposed-staging` (medium).** Bots stack on the same cell, and S staging points are in view of W holds.
- **Change.**
  - Add `freeSpot(list)`, which skips spots held by alive teammates. Use it at :183, :185, :191 and in retake.
  - Per-bot `this.stageCell`: walkable cells within 2 cells of `plan.stage` in ring order, indexed by `planIdx`, rejecting cells in line of sight of any `HOLDS c`.
  - Move the stage cells in 02-maps.js: Harbor connector [32,22] (:124) and Frostbite bridge [32,31] (:190).
  - check-maps.cjs warns when a stage cell is within 4 cells of, or in line of sight of, a hold.
- **Acceptance.** No two bots share a spot cell in 'site', 'post' or 'retake'. check-maps is clean.
- **Risk.** Low.

**F4 `lost-target-amnesia` (medium).** Bots forget an enemy as soon as line of sight breaks.
- **Change.**
  - `this.mem={pos,t,e}` when the target is dropped (:79).
  - New look branch in `navigate` when `NOW-mem.t<3`, aiming at head height with yaw and pitch.
  - S bots walk while their dest is within 10 m of `mem.pos`.
  - Re-acquiring the same enemy, or one within 2.5 m of `mem.pos`, uses half the reaction time.
  - `canSee` FOV treats `mem.e` like the target.
  - Delete the dead chase at :159; the trade logic (F7) covers chasing.
- **Acceptance.** Peek → hide → re-peek within 2 s: the second reaction is about 50% of the first, and the bot is facing the peek spot.
- **Risk.** Medium. Hard bots get noticeably stronger.

**F5 `exec-no-angle-clearing` (medium).** Execs run nose-first with no angle clearing and the same timing every round.
- **Change.**
  - In exec, within about 30 m of the last entry, look at `HOLDS[site][(planIdx+k)%n].c` at head height when it has line of sight, marking spots cleared after 0.35 s.
  - `walk=true` from 12 m before the final entry until first contact. Rotators walk the last 10 m.
  - The carrier waits `rand(1,2)` s in 'wait'.
  - In 08-game.js `startRound`: 20% rush (`FREEZE+5..9`), 60% default (22-42), 20% late (55-70, clamped). Optional 15% fake.
  - Plant point: `pick(SITE_SPOTS)`, or `PLANT_SPOT` plus jitter, validated with `inSite` and `onFloor`.
- **Risk.** Medium. Watch the `roundTime<40` fallback with late execs.

**F6 `hearing-model` (medium, bot side; the engine emits are in C8).**
- **Change.**
  - In `Noise.emit` (05-engine:454; a small engine touch): `r*=0.5` if `segBlocked` between source and listener, and store `heard.d`.
  - `heard` overrides the hold look only if `d<25` or the sound is on the bot's own site, as a 0.8 s glance.
  - S 'post' rush or molly only when the defuser is heard (`heard.src===B.defuser` within 1 s) or seen.
  - Optional: `canSee`'s 3.5 m FOV bypass requires horizontal speed above 3.
- **Risk.** Low.

**F7 `no-trading-or-fallback` (medium).** A teammate's death only turns heads; no trading, peeking or falling back.
- **Change.**
  - `killAgent` → `callout(k.pos, v.pos)`. This is a 05-engine edit; merge with C7.
  - One trader per death: the closest free teammate within 15 m, `this.trade={pos,from,until:NOW+3}`.
  - The navigate trade branch walks to `from` and pre-aims at `pos`.
  - W holder fallback when alone and 2 or more S are spotted in their zone.
  - Optional shoulder-peek.
- **Risk.** Medium.

**F8 `uncoordinated-economy` (medium).** Each bot decides eco or force on its own.
- **Change.**
  - In 08-game.js:59-60, compute a team decision once per side from bot money only plus the loss-streak forecast (`money+1400+500*streak`): 'full' (4 or more can afford rifle+helmet), 'force' (last round of a half, match point, or enemy likely on eco), or 'eco'.
  - Pass it as a 4th argument to `botBuy`.
  - `botBuy` (:256) switches on the decision. Under 'full', poor bots buy vex plus kevlar.
  - Side-specific grenades: S buys smoke and flash, W buys fire and HE (completes E8).
- **Acceptance.** Over 30 simulated rounds, the share of team buys with mixed primary classes drops below 15%.
- **Risk.** Low.

**F9 `no-team-communication` (medium).** Bot teammates never tell the human the plan or call out enemies.
- **Change.**
  - In `startRound`, after plans are assigned, when the player is S: `HUD.chat(`Team: going ${site}…`,'S')`.
  - Rate-limited zone callouts in `scan` on target change: same team as the player, a new zone or more than 4 s since the last callout.
  - KeyZ/KeyX during the buy phase set `G.plan.site` and rebuild the S bots' plans. Check that these keys are free.
  - Do not add bomb-dropped or planted lines; those already exist at 05-engine:706 and :745.
- **Risk.** Low. Touches 07-hud keydown, so merge after A4.

**F10 `engagement-micro` (low).** Fight movement is a per-frame coin flip, and other engagement details.
- **Change.**
  - Roll strafe or stop per cycle (`strafeT`), and fire only below 30% of max speed.
  - While reloading, back off along the path. Switch to the pistol only when mag is 0, distance under 10 m and the secondary has ammo (`ensureGun` `allowPistol` override).
  - Reaction scaling: `react*=(1+0.4*ang/(fov/2))*(1+min(d,60)/150)`, plus 25% for a head-only view.
  - Pre-scope snipers in hold, post or site holds.
- **Risk.** Medium for difficulty balance.

---

## Package G: world navigation (03-world)

**G1 `World.isWater(x,z)` helper.** Bounds-checked `MAP.grid[rowOf(z)][colOf(x)]==='~'`. Prerequisite for C4 and D5. Trivial.

**G2 `extras-collision-not-in-navgrid` (low; it becomes real once the Overgrowth draft lands).** Hero props with collision boxes are invisible to path finding.
- **Change.**
  - In `buildMap`, inside the extras loop (:346-347), after `World.addBox`: if `(e.y||0)+k.h` is more than 0.55 above `World.height` at that cell, set `World.walk[r*GW+c]=0` for each cell whose centre lies inside the box expanded by `R_AG`. If no cell centre is covered, block the cell under the box centre.
  - Move the nearWall pass (:207) into `World.computeNearWall()` and call it after extras.
  - Update AUTHORING.md:58-59 to say that colliding extras block navigation.
  - Alternative for the draft: place the altar and braziers as 'A'/'Y' prop cells.
- **Acceptance.** Load Overgrowth headless: the cells under `ovg_altar` are non-walkable, and `findPath` across the dais avoids them.
- **Risk.** Low. Verify the dais still has a lane of at least 2 cells.

---

## Cross-cutting changes

1. **Shared helpers.** `onFloor`, `canDefuse`, `clearBomb` and `snapToFloor` live in 05-engine (C). `World.isWater` (G1) and `freeSpot` (06-bots, F3; E4 uses an interim filter) are the others. Land C's helpers before E3, E4 and C3.
2. **05-engine.js is edited by B, C, D and F (F6 `Noise.emit`, F7 `killAgent` callout).** Function ranges do not overlap except:
   - `weaponLogic`: C3 busy guard and D2 (`fireGun` only). Insert the C3 guard after the bomb branch.
   - `killAgent`: C7 guard and F7 callout signature.
   - `detonate`: D5 and D6.
   - `updateBomb`/`tryPlant`: C1, C2 and C8. Do all of these in C.
3. **Interface changes.** `bot.onFlashed(dur,k)` (D6 with E9), `bot.callout(pos,victimPos)` (F7) and `botBuy(a,avg,pistol,decision)` (F8) change call sites and callees together.
4. **Bot movement speed constant.** E2 and F2 need `RUN_SPEED` exported from 05-engine; do not hard-code 5.2.
5. **Baselines change.** Smoke, headless and balance baselines shift after B1, D1, E5 (rotations now happen headless) and F4/F10. Re-record them after each package.
6. **Map data and tooling.** 02-maps.js and tools/check-maps.cjs are edited by E7 (roofed util cells), F1 (`postLooks`, optional) and F3 (stage cells). One owner should do all map edits in sequence.

## Conflicts and decisions made

- **`bomb-on-props` vs `bots-cannot-defuse`.** Both define defuse rules. Decision:
  - Floor-only plants (C1).
  - One `canDefuse`: horizontal under 1.7, |dy| under 1.3, plus line of sight. The other finding's |dy|<1.9 is rejected because it allows defusing through obstacles.
  - Bomb drops snap to the floor, so the bot crate-climbing logic (crouch-jump) is dropped.
- **`bomb-kill-credit`.** The two proposed fixes conflict. Decision: the `wid!=='world'` guard in `killAgent`, which keeps the feed; the null-attacker option is rejected. Do not add a `phase==='live'` guard.
- **Fire-rate.** Carry-over only. The multi-shot loop is rejected (dt cap 0.05 < min rof).
- **Crosshair (D4).** Product decision: a real aim punch (recommended) or a visual-only flinch. Pick one before D4.
- **`stale-match-end-flags` payout on quit.** Optional design decision. If adopted, use only `Profile.reward`, not `gameOver()`.
- **Retake dest logic.** E4 (latch and spots) is extended, not replaced, by F2 (gather and save) and F1 (looks). Implement E4 first and keep its structure.
- **Grenade work overlap.** E7 (doThrow/T/speed), E8 (flags and roll) and F8 (side-specific buys) all touch utility. Do them in the order E7 → E8 → F8. F2's retake utility uses E7's gates.
- **E6 and C3/C1.** E6 depends on dropped bombs being reachable (C1/C4 snapping). Without it, the elected fetcher can still stall.
- **B1 side effect.** Separation pushes may now step agents up onto low crates. This interacts with C1: an agent pushed onto a crate inside a site cannot plant there, which is intended.