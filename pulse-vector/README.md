# Pulse Vector

A rhythm platformer in the style of Geometry Dash, written as one self-contained file: `pulse-vector.html`. It has no images, libraries or sound files. Everything is drawn on a canvas, and the music is synthesised live with the Web Audio API. To play, open the file in a browser, either by double-clicking it or from any static host.

## What's in it

- **8 game modes**: cube, ship, ball, UFO, wave, robot, spider and swing, switched by portals.
- **Other portals**: speed (0.5x–4x), gravity, mini/normal size, mirror and dual.
- **Orbs**: yellow, pink, red, blue, green and black. **Pads**: yellow, pink, red and blue.
- **3 levels**, each with its own generated song locked to the beat:
  - *First Pulse* (Easy, 69 s)
  - *Neon Avenue* (Normal, 81 s)
  - *Overclock* (Hard, 61 s)
- **Practice mode**: Z places a checkpoint and X removes it. There are on-screen buttons for touch.
- **In-level HUD**: attempt counter and a % progress bar. Best normal % and best practice % are saved for each level.
- **Icon kit**: 12 cube designs and 16 colours, with a primary and a secondary colour. The choice carries into every mode's icon.
- **Pause menu** (Esc or the ❚❚ button): resume, restart, practice toggle, music and effects volume, and hitbox view.
- **Level editor**: place objects on a grid, test-play, save to the level select, and export/import as text.
- Progress and settings are saved in `localStorage`. Every access is wrapped in try/catch, so the game also runs where storage is blocked.

Controls: click, tap, Space, ↑ or W to jump or fly. Hold to keep jumping or flying.

## Research summary (what the real game does)

- **Speed.** The game scrolls at a constant speed set by speed portals, measured in blocks per second:
  - 0.5x: 8.372
  - 1x: 10.386
  - 2x: 12.914
  - 3x: 15.6
  - 4x: 19.2
- **Physics.** Since update 2.2 it runs at 240 ticks per second. One block is 30 units.
- **Cube.** A tap jumps about 2.2 blocks high, and holding auto-jumps on every landing. In the air the icon spins; a flat jump is about a half turn (180°), not a quarter turn. On landing it snaps to the nearest 90°. The spin is cosmetic: the hitbox never rotates.
- **Hitboxes.** The player has two:
  - The *outer* box (red when hitboxes are shown) touches hazards, so a spike kills on contact.
  - A small *inner* box (blue) kills only when it ends up inside a solid block.
  
  You can land on a block's top, and be snapped up onto it if you clip the corner slightly. Hitting the side drives the inner box into the block, which kills. A spike's hitbox is a thin box in the middle of the triangle, much smaller than the art.
- **Game modes:**
  - Ship: hold to rise, release to fall.
  - Ball: click on a surface to flip gravity.
  - UFO: every click is a small hop in the air.
  - Wave: moves at 45° and holds direction while held. Mini wave moves at about 63°.
  - Robot: hold for a higher jump.
  - Spider: click to teleport instantly to the opposite surface.
  - Swing: every click flips gravity, with momentum.
  
  Ship, UFO, wave and swing play in a 10-block-tall corridor. Ball and spider use an 8-block corridor.
- **Orbs** need a click while you overlap them:
  - Yellow: jump
  - Pink: small jump
  - Red: big jump
  - Blue: flip gravity
  - Green: flip gravity, then jump
  - Black: slam toward the ground
- **Pads** fire on touch: yellow, pink and red launch you at different heights, and blue flips gravity.
- **Practice and progress.** Practice mode lets you drop checkpoints and respawn there. Normal mode restarts from 0% on every death, with an attempt counter, and the best % is kept.
- **Music sync.** Levels are synced to the song because the scroll speed is constant. Designers place obstacles at the distance the player covers per beat.

## Physics values used

All values are in blocks and seconds, simulated at a fixed 240 Hz.

| Mode | Values |
|---|---|
| Cube | gravity 114.98 b/s², jump 22.36 b/s (2.17 blocks high, 0.389 s air time), max fall 26 b/s, spin 180° per flat jump |
| Mini | 0.6× size, jump velocity ×0.8 |
| Ship | fall accel 46, lift accel 52, max climb 12.8, max fall 15 (mini: accel ×1.25) |
| Ball | gravity 69, flip push 6, max fall 22 |
| UFO | gravity 75, hop 15 (1.5 blocks), max fall 20 |
| Wave | vertical speed = horizontal speed (45°), mini ×2 |
| Robot | gravity 114.98, jump 13, holding keeps that speed for up to 0.24 s (≈0.7–4 blocks) |
| Spider | gravity 69, instant teleport to the nearest surface overhead |
| Swing | gravity 55, max vertical speed 11, each click flips gravity and keeps momentum |
| Orbs (cube) | yellow 22.36, pink 16, red 30.9, black −30, blue = flip + 8 toward the new floor, green = flip + 22.36 |
| Pads (cube) | yellow 31.3, pink 20.8, red 39, blue = flip |
| Orb/pad scale by mode | robot 0.9, UFO/ball/spider 0.7, swing 0.6, ship 0.55, wave ignores all but gravity orbs |
| Hitboxes | outer 1×1 (wave 0.34), inner 0.3×0.3, spike 0.2×0.42, corner snap 0.3 blocks |
| Corridors | ship/UFO/wave/swing 10 blocks, ball/spider 8 (also dual mode: 10) |

The speeds, the 240 Hz tick, the cube's gravity and jump, the 180° spin with 90° snapping, and the corridor heights come from the real game. The ship, ball, UFO, robot, spider and swing numbers, the orb/pad strengths, and the exact hitbox fractions are tuned estimates that match the feel described in my research.

## Adding a level

Levels live in the `LEVELS` section of the HTML. A level is a list of **chunks**. Each chunk is an array of strings, top row first, and the bottom string sits on the ground:

```js
LEVELS.push({ id: 'mine', name: 'My Level', difficulty: 'normal', speed: 1, bpb: 5, song: 0,
  colors: { bg: [200, 70], ground: [220, 75] },
  chunks: [
    ['....................'],
    ['^....^....^^...^^^..'],
    [
      '.........###......',
      '....######^^^##...',
    ],
    { speed: 2, rows: ['S.........#.....'] },   // a chunk can change speed
  ] });
```

`bpb` is the number of blocks per beat at the starting speed. The tempo is derived from it, and every chunk starts exactly on a beat, so an obstacle every `bpb` columns lands on the beat. The characters are:

| | |
|---|---|
| `#` block, `=` half slab | `^` spike, `v` ceiling spike, `,` `'` small spikes |
| `y p r b g k` orbs (yellow pink red blue green black) | `Y P R B` pads |
| `C S O U W T D N` cube ship ball UFO wave robot spider swing portals | `0`–`4` speed 0.5x–4x |
| `G` / `F` gravity normal / flipped | `m` / `M` mini / normal size |
| `X` / `x` mirror on / off | `&` / `|` dual on / off |

A portal covers 3 blocks around its cell. Stacking the same portal vertically makes one tall portal, and a flying corridor is centred on it.

The editor's export uses the same characters, with one object per line: `<char> <x> <y>`.

To check that every built-in level can still be beaten after editing, run:

```sh
node pulse-vector/tools/verify-levels.cjs
```

It runs the game's own physics with a search bot and reports any section it can't get past.

## What isn't identical to the real game

- Physics constants other than speed and cube gravity/jump are estimates. Real GD also tweaks jump strength slightly per speed; here it is the same at every speed.
- There are no slopes, dash orbs, spider orbs, teleport portals, triggers or coins, and no separate practice song. Practice mode replays the level song from the checkpoint.
- Dual mode uses one input for both icons (no 2-player split).
- Portals that sit on the beat stay in sync. A speed change in the middle of a chunk drifts until the next chunk re-syncs it.
- Input is sampled once per frame and applied to the 240 Hz physics. The real game time-stamps clicks between frames.
