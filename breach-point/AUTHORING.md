# Authoring Breach Point content

`breach-point.html` is built from `breach-point/src/*.js` (joined in file-name order inside one function scope, after
`00-head.html`) plus `breach-point/models.glb` (made in Blender by `models.py`). Content is added through plug-in files,
so new maps, props and skins never need edits to the engine files.

## Tools

| Command | What it does |
| --- | --- |
| `python3 breach-point/build.py [--glb X.glb] [--out X.html] [--extra DIR ...]` | Builds the page. `--extra` also joins the `.js` files of a draft folder (in name order together with `src`). |
| `node breach-point/tools/check-maps.cjs [mapId]` | Prints each map grid and checks that every bot coordinate is walkable and reachable from both spawns. Exit code 1 on problems. |
| `breach-point/tools/syntax.sh` | Syntax-checks the joined `src` script. |
| `BP_PLUGINS=DIR python models.py OUT.glb` | Exports all Blender models; plug-in scripts from `breach-point/blender/` and every folder in `BP_PLUGINS` are run first. Needs `bpy` 4.2 (Python 3.11). |
| `python tools/preview.py X.glb out.png asset ...` | Cycles render of some assets in a row (assets are root names without `_root`). |
| `THREE_JS=three.min.js HTML=X.html MAPS=id node tools/smoke.cjs OUTDIR full` | Headless match simulation (prints round results, plants, defuses) plus screenshots. Modes: `quick`, `ui`, `maps`, `full`. |
| `THREE_JS=… HTML=X.html node tools/shots.cjs OUTDIR '[["name","mapId",col,row,yaw,pitch]]'` | In-game screenshots from chosen cells (yaw 0 = looking north/row 0, π/2 west, π south, −π/2 east). |

## Maps

A map is one file `src/02m-<id>.js` (sorted after `02-maps.js`):

```js
MAPS.mymap = { id:'mymap', name:'My Map', tag:'JUNGLE', desc:'One sentence for the lobby.', grid(F){ ... }, ... };
MAP_ORDER.push('mymap');
```

Copy the structure of `MAPS.sandline`, `MAPS.harbor` or `MAPS.frostbite` in `src/02-maps.js`. The grid is 64 × 64 cells of
2 m; `grid(F)` starts from all `#` and carves with `F(c0,r0,c1,r1,ch='.')` (inclusive). Row 0 is north. Wardens spawn in
the north, Strikers in the south by convention (not required). Built-in cells:

| Cell | Meaning |
| --- | --- |
| `#` | building / wall block (height 6–12 m, chosen per merged rectangle) |
| `.` | floor; `T` `W` also floor |
| `1`–`5` | raised floor 0.5–2.5 m (stairs must step ≤ 0.5 m per cell) |
| `=` | floor under a low roof at 3.4 m (tunnel) |
| `d` | doorway: walkable, wall above 3.2 m |
| `~` | water (not walkable; surface rendered at −0.7 m; a side touching the grid edge opens to the horizon) |
| `c` `m` `C` | crates 1.1 / 1.6 / 2.3 m (shootable through) |
| `k` `K` | container 2.6 m / stacked 5.2 m (use 3-cell runs) |
| `y` pallets 1.2 m, `n` sandbags 0.8 m, `w` low wall 1.2 m, `v` vehicle (2-cell run), `o` barrels, `u` oil drums, `z` tree, `P` plant, `-` `|` thin wooden wall |

Bot data (all `[col,row]`): `spawns`, `spawnZone`, `sites` (bomb zones A/B with `center`), `zones` (callout names, first
match wins, list specific ones first), `siteOfZone`, `plans` (per site: routes with a `stage` point, `entry` points walked
in order, `smoke` and `flash` targets that must be on floor), `siteSpots`, `plantSpot` (inside the site), `holds`
(`A`, `B`, `M` for mid: Warden spots `c` with a look target `l`). `node tools/check-maps.cjs <id>` must pass.

Other fields: `signs` (painted letters: `{t,c,x,z,nx,nz,s,y?,a?}` with x/z in cell units on a wall face, `nx/nz` the
face normal, `a` arrow ±1), `trees` (`{type, at, min, max, cell?, cellScale?}`; `type` is an asset name, a list, or
`'crane'`; `at` are decoration spots usually inside wall blocks; `cell` is the asset for `z` cells), `paved`
(`[c0,r0,c1,r1,surface?]` overlay floors), `roofs` (`[c0,r0,c1,r1,height]` high roofs; gaps act as skylights), `water`
(`true` adds bollards/lifebuoys on the quay, `'plain'` does not), `menuSpot` `[col,row]` + `menuAngle` (lobby camera),
`art` (lobby card: `{wall,wall2,ground,snowTop,draw(g,w,h)}`).

Custom cells: `props: { 'X': {asset:'statue', h:2.5, w:0.9, mat:'stone', pen:0, rot:'grid'|'random'|radians, scale, y} }`
places a Blender asset in every `X` cell with a collision box (half-width `w`, height `h`; `pen` > 0 makes it
shootable through, `mat` is `stone`/`wood`/`metal`). Custom cells are not walkable. `extras: [{asset, at:[col,row],
y, rot, scale, collide:{w,d,h,mat,pen}}]` places single hero props anywhere (fractional cells allowed).

`theme`: `ground`, `walls` (`[[surface, weight], …]`), `paving`, `stairs?`, `roof` (surface for `=` and `roofs`),
`lowWall?`, `lowWallCap?`, `cap` (`'trim'`, `'snowcap'`, a surface name or `'none'`), `quay?`, `groundTint?` `[r,g,b]`,
`waterColor?`, `tints` (wall colour multipliers), `decor`, `sky` (`top, mid, horizon, ground, sun` hex, `sunDir`
`[x,y,z]`, `clouds` 0–1, `stars` 0–1 for night, `cloudColor?`), `sunColor`, `sunI`, `hemiSky`, `hemiGround`, `hemiI`,
`fog`, `fogNear`, `fogFar`, `exposure`, `grade` (`sat, contrast, lift[3], gain[3]`), `particles` (a `WEATHER` preset or a
list: `snow dust rain embers ash leaves fireflies spores`). Night maps: low `sunI` (moonlight), `stars`, dark sky, and
emissive props for light.

`decor` is `'town'`, `'docks'`, `'village'` or an object overriding the town preset: `{window, winY, winP, door, doorP,
lamp, lampP, awnings, awnP, streetlamp, slP, extras:[{asset, p, y, out, minH, scale}], vehicles:[…], vehicleH:{asset:h}}`
(asset fields may be lists). Wall faces next to open cells get one of these by cumulative probability.

Surfaces (wall/ground/paving textures) are canvas drawings. Add new ones in the map file:
`SURFACES.moss = [(g,w,h)=>{ /* draw on a 512×512 canvas */ }, normalStrength, roughness, metalness];`
Helpers `speckle`, `blotches`, `streaks`, `rand`, `pick` are available. Existing: `sand stone plaster plasterw paving
concrete slab brick corrugated concretewall snow logs cobble woodplank`.

## Blender models

A plug-in is a Python file in `breach-point/blender/` (or a `BP_PLUGINS` folder) run inside `models.py`, so it can use
its helpers: `mat(name, 0xRRGGBB, metal, rough, alpha)`, `box(name, (sx,sy,sz), (x,y,z), mat, parent, bevel, rot)`,
`cyl(name, r, depth, loc, mat, parent, rot, verts, r2)`, `sphere(name, r, loc, mat, parent, scale, seg, rings)`,
`limb(name, a, b, r, mat, parent, r2, verts)`, `empty(name, loc, parent)`, `gun(id, builder)`, `G` (gun materials) and
`RX` (π/2). Call your builders at the end of the file.

- An asset is an empty named `<asset>_root` at the origin with everything parented to it; the game refers to it as
  `<asset>`. Every object and material name must be unique across all plug-ins: prefix them with the asset name.
- Axes: +Y is the asset's front (becomes −Z in three.js), +Z is up, origin at the bottom centre. Wall decor sits on
  the wall face with its front facing +Y. Sizes are in metres.
- Colours are given as hex and appear exactly like that in game. Material names containing `emit` or `neon` glow
  (`emit2`, `emit4` set the strength), which also blooms; use them for lit windows, signs, molten metal.
- Keep props light (a few hundred to ~3000 triangles); static props are merged per material at load.
- Knives: build with `gun('knife_<name>', builder)` and create `<id>_muzzle` (tip) and `<id>_fore` empties. Blade
  parts are painted by finishes; parts whose names contain `handle` keep their own material.

## Skins, knives and cases

Add a file `src/09s-<name>.js` (sorted after `09-items.js`):

```js
Object.assign(FINISHES, { myfinish:{name:'My Finish', pat:'camo', cols:['#..','#..'], metal:0.2, rough:0.5, scale:0.5, glow?, mirror?, clean?, res?} });
PATTERNS.mypattern = (g,w,h,cols,wrapDraw,finish) => { /* paint a tileable 256×256 texture; background is cols[0] */ };
KNIVES.knife_hook = { name:'Hook Knife' };
CASES.push({ id:'mycase', name:'My Case', price:300, color:'#hex', items:[ {w:'ark7', f:'myfinish', r:2}, {w:'knife', k:'knife_hook', f:'myfinish', r:4}, {a:'S_brute', r:3} ] });
```

Rarities `r`: 0 Standard, 1 Superior, 2 Elite, 3 Mythic, 4 Relic (knives). Weapons that take finishes: `ark7 m4r longshot
vex breacher g9 p12 hawk knife`. A knife item may leave out `f` (a plain "Vanilla" knife). Built-in patterns: `camo tiger
topo hex digital fade marble flames web carbon circuit galaxy splatter stripes damascus chrome`. `scale` is metres per
texture tile (guns are 0.2–1 m long); `glow` makes the finish emissive; `mirror` mirrors the tiling.
