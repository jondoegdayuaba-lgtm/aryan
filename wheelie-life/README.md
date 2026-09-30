# Wheelie Life

A solo wheelie-riding browser game. Keep the front wheel up on the balance point, weave through highway traffic and stack the multiplier. The bike and rider are modelled and rendered in **Blender** (headless `bpy`) and loaded into three.js.

## Play

- **Desktop, no server:** double-click `desktop/wheelie-life.html`.
- **Locally:** from the repo root run `python3 -m http.server 8000` and open `http://localhost:8000/wheelie-life/`.

## How it plays

The front wheel is an inverted pendulum around the rear axle. Gas lifts it, gravity pulls it back below the balance point and tips it over past it. Holding gas loops you out in under two seconds, so ease on and off, and react to how fast the wheel is moving, not just where it is.

| Input | Action |
| --- | --- |
| Space / W / Up | Gas: lifts the front wheel |
| S / Down | Brake: drops it |
| Shift | Clutch kick: pops the wheel up from the ground |
| A D / Left Right | Steer |
| Esc or P / M | Pause / mute |
| Phone | Drag to steer; Gas, Brake and Kick buttons |

Score is distance covered with the front wheel up, times a multiplier (up to x10) that grows with wheelie time and time spent in the green sweet spot. Passing a car close without touching it is worth a bonus. Hit traffic or loop out and the ride ends.

## The Blender pipeline

```sh
pip install bpy==4.2.0
python3 tools/blender/build_bike.py                 # model + export + Cycles hero render
python3 tools/blender/build_bike.py --no-render     # just re-export the model
python3 tools/blender/build_bike.py --samples 128   # nicer hero render (slow on CPU)
```

`tools/blender/build_bike.py` builds the sport bike and rider from primitives with PBR materials, then:

1. exports every part to `assets/bike.json` (rear-axle-relative, wheels as separate spinning parts), which `js/bike.js` rebuilds as three.js meshes with matching physical materials, and
2. renders `assets/hero.jpg` with Cycles, used as the menu background.

To ship the one-file build after changing anything: `npm install && npm run build:wheelie`.

## Look and honesty notes

The game uses HDR sky image-based lighting, ACES tone mapping, soft shadows, clear-coat paint and procedural asphalt. The bike is procedural: it reads as a stylised, physically-shaded model, not a photoscan. For a truly photoreal bike, drop a licensed high-poly model into Blender, keep the part names (`body`, `wheelF`, `wheelR`) and re-export.

| File | What it does |
| --- | --- |
| `js/main.js` | Game loop, balance physics, scoring, HUD, audio, input |
| `js/world.js` | Sky and lighting, scrolling road, roadside props, traffic |
| `js/bike.js` | Loads the Blender export into a pivoting bike rig |
