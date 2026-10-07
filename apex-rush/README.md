# Apex Rush

A low-poly time-trial racing game for the browser, with a track editor. Pick one of ten tracks (or build your own), clear every checkpoint in order, cross the line, then race the see-through ghost of your best run. Each track has gold, silver and bronze medal times.

| Track | Difficulty | What's on it |
| --- | --- | --- |
| Sunday Loop | Easy | 2 laps of rolling tarmac, a blue tunnel, a hilltop chicane |
| Rollercoaster | Easy | 2 laps over humps that throw you into the air, banked turns, boost pads and a loop |
| Kerb Sprint | Medium | 2 quick laps of esses and a walled kink |
| Quarry Jumps | Medium | A to B: two gaps to jump, a walled high road, an underpass |
| Booster Valley | Medium | A to B over three big gaps you can only clear with the boost pads |
| Big Air | Medium | A to B from the top of a tower: a ski jump, two doubles, a loop, a jump pad and a last leap to the line |
| Jump Park | Medium | 2 laps of a figure of eight: jump right over the other road, a steep banked bowl, a bump run and a jump pad |
| Skyway Eight | Hard | A figure of eight over a bridge and back through the tunnel underneath, with a chicane and a jump |
| Loop Alley | Hard | 2 laps: a bump run, two loops, a steep banked bowl, a jump pad and a big kicker jump |
| Sky Gauntlet | Expert | A to B up in the air: three jumps in a row with no walls, a jump pad over a gap, then a huge leap to the finish |

## Jumps, ramps and loops

- **Loops** take you all the way round, upside down over the top. Go in fast: too slow and you drop off the top (or roll back out). The way down comes out a little to one side of the way in, so you carry on along a new line. The camera rolls round with you.
- **Jump pads** (green arrows with a green frame) throw the car straight up into the air at whatever speed you hit them.
- **Boost pads** (glowing blue arrows) kick you past top speed. The extra speed fades over a second or two, so hit them before a jump.
- **Ramps and gaps:** a ramp's lip launches you over a gap in the road. Big ones have a hoop over the gap; the biggest ski jumps need you flat out.
- **Kickers** are short, sharp ramps on the flat that pop you into the air, and **bump runs** throw you up off each crest if you take them fast.
- **Steep banked bowls** lean right over, so you can carry a lot of speed round them.

Everything is plain HTML, CSS and JavaScript with [three.js](https://threejs.org) (shared with Missile Run in `../vendor/three`). There's no build step and there are no image or sound files: textures are drawn on canvases and sounds are synthesised with the Web Audio API.

## Play it

- **From your desktop:** `../desktop/apex-rush.html` is the whole game in one file. Double-click it and it opens in your browser, no server needed. It works offline, except the fonts, which fall back to system fonts without internet.
- **From this folder:** ES modules don't load from `file://`, so serve the repository root and open `/apex-rush/`:

  ```sh
  python3 -m http.server 8000
  # then open http://localhost:8000/apex-rush/
  ```

- **On a website:** upload the repository as-is (the game needs `apex-rush/` and `vendor/`) to any static host, such as GitHub Pages, Netlify or your own server.

## Controls

| Keyboard | Phone | Gamepad | Does |
| --- | --- | --- | --- |
| W / Up | Gas | RT or A | Accelerate (also starts the clock) |
| S / Down | Brake | LT or X | Brake, then reverse |
| A D / Left Right | Arrow buttons | Left stick or d-pad | Steer |
| Space | | B | Handbrake, to drift |
| Enter or Backspace | Checkpoint | Y | Go back to the last checkpoint |
| R | Restart | Back | Restart the run |
| C | Camera | RB | Chase, far or hood camera |
| Esc or P | Pause button | Start | Pause |
| G, M | | | Ghost on/off, sound on/off |
| E (in the menu) | Track editor button | | Open the track editor |

The clock starts when you first press the gas, and keeps running when you go back to a checkpoint. If you fall off the road it puts you back by itself after 3 seconds.

Best times, their checkpoint splits and the ghost are kept in your browser's local storage, one per track.

## How it works

| File | What it does |
| --- | --- |
| `js/tracks.js` | The tracks as lists of points, plus their medal times |
| `js/path.js` | Turns the points into a smooth road and answers "what's under the car?" |
| `js/physics.js` | Arcade car handling: engine, brakes, grip, drifting, jumps, airtime, boost and jump pads, riding loops, walls |
| `js/loops.js` | The shape of a loop, and whether the car still sticks to it |
| `js/featuremesh.js` | Draws the boost pads, jump pads and hoops |
| `js/race.js` | Checkpoints, laps and the clock (counted in fixed 1/120 s physics steps) |
| `js/ghost.js` | Records your run and plays it back |
| `js/autopilot.js` | A robot driver for the menu's demo laps and the track checker |
| `js/trackmesh.js` | Builds the road, loops, kerbs, walls, tunnels, pillars, gates and signs |
| `js/scenery.js` | Sky, hills, trees, grandstands, buildings and boulders |
| `js/carmodel.js` | The car model |
| `js/effects.js` | Tyre smoke, skid marks and sparks |
| `js/audio.js` | Engine, tyres, wind and chimes |
| `js/input.js` | Keyboard, touch buttons and gamepads |
| `js/pieces.js` | Track editor pieces, following the road, share codes |
| `js/editor.js` | The track editor |
| `js/main.js` | Game states, camera, HUD and menus |
| `js/config.js` | Name, handling, camera and paint colours |

## Track editor

Press **Track editor** in the menu (or E). Build a track out of road pieces on a grid, the way you'd lay a toy race track, then press **Test drive** (T) to race it.

- **Pieces:** Start, Straight, tight and wide turns left and right, Slope up and Slope down (one height step each), Jump ramp, Checkpoint and Finish (keys 1 to 0 pick these), plus Boost pad, Jump pad, Kicker, Bumps, Big ramp (two height steps, for long jumps), Loop left and Loop right.
- **Loops:** a loop takes one square, and the road comes out one square to the left (Loop left) or right (Loop right), heading the same way, so the next piece goes diagonally ahead of it. Give it a run-up of a few straights so you hit it fast.
- **Placing:** click a square to put the piece there; right-click (or the Erase tool, X) removes one. R rotates the piece, Q and E change the height, and Walls and Tunnel add barriers or a tunnel to the pieces you place next. After each piece the editor turns and lifts the next one to carry on from it.
- **The road:** it runs from the Start piece, piece to piece, following the arrows. It ends at a Finish, or loops back into the Start to make a circuit (choose the laps at the top; a circuit needs at least one Checkpoint). Pieces that aren't on the road show red, and an orange square marks where the road wants to carry on.
- **Jumps:** a Jump ramp or Big ramp can clear up to four empty squares and land up to six height steps lower. Leave the squares after it empty and carry on with the landing piece facing the same way. A hoop goes up over the gap, and a Boost pad before the ramp lets you clear longer gaps.
- **Medals:** once the road is finished, a robot drives it in the background. Its time sets gold, silver and bronze, and if it can't finish, the editor tells you (usually a jump is too long, or a corner comes too soon after a jump or loop).
- **Moving around:** drag to move the view, right-drag to turn it, scroll to zoom; WASD and the arrow keys move too, and F frames the whole track. On a phone, drag, pinch and twist.
- **Saving and sharing:** Save keeps the track in your browser and adds it to the menu's track list. Share gives you a code (`APEX1:…`) to send to a friend, who pastes it into Share to load your track. Ctrl+Z and Ctrl+Y undo and redo.

The pieces are defined in `js/pieces.js` (each piece's shape, where it leads and how it turns into road points) and the editor itself is `js/editor.js`.

## Add a track to the game

Built-in tracks are written as points instead. Add an entry to `js/tracks.js`. A track is a list of points the road curves through: `[x, z]`, `[x, z, height]` or `[x, z, height, options]`, in metres. The options apply to the stretch from that point to the next:

- `cp: true` puts a checkpoint gate there.
- `walls: true` adds barriers on both sides, and `tunnel: true` adds a tunnel.
- `gap: true` leaves the road out for a jump. Give the lip a `slope` (0.1 is a good start) so it launches you, and the landing a small negative `slope`.
- `bank: 12` leans the road into the corner by that many degrees.
- `w: 16` changes the road width there.
- `boost: true` puts a boost pad there, `launch: true` a jump pad, and `hoop: true` on a jump's lip puts a hoop over the gap.
- `loop: 13` starts a loop of that radius there; it comes back down at the next point. Come in on a straight, put the next point about 20 m further on and 20 m to one side (so the way up and the way down miss each other), and carry on straight from it. Loops need speed: give them a long run-up.
- Flat-road stunts are just heights: a kicker is a short rise with a steep `slope` (0.3) at its crest, and bumps are points a few metres apart that go up and down by 0.3 m or so.

Set `closed: true` and `laps` for a circuit; otherwise the track runs from the first point to the last. Then check it from the repository root:

```sh
npm install
npm run check:tracks                 # warnings, plus a robot's time round each track
npm run check:tracks -- --svg maps   # also writes a top-down map of each track
```

The checker warns about corners tighter than the road is wide, steep slopes and roads that cross without enough headroom. It also checks that the two sides of each loop miss each other and that a robot driver can finish, which proves every jump can be cleared and every loop gone round, and it checks the editor's example track too. A bolder robot that takes corners closer to the limit gives a best case that's handy for setting gold. Use the robot's times to set the medals. Rebuild the one-file version afterwards with `npm run build:desktop`.

## Tuning

`js/config.js` holds the handling. For example, `topSpeed`, `accel` and `brake` set the pace, `steerRate`/`steerRateTop` set how sharply the car turns at low and top speed, and `grip`, `slideAt` and `driftGrip` decide how easily it slides. Change `GAME_TITLE` to rename the game; the second word is shown in red.
