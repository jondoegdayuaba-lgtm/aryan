# Apex Rush

A low-poly time-trial racing game for the browser. Pick one of four tracks, clear every checkpoint in order, cross the line, then race the see-through ghost of your best run. Each track has gold, silver and bronze medal times.

| Track | Difficulty | What's on it |
| --- | --- | --- |
| Sunday Loop | Easy | 2 laps of rolling tarmac, a blue tunnel, a hilltop chicane |
| Kerb Sprint | Medium | 2 quick laps of esses and a walled kink |
| Quarry Jumps | Medium | A to B: two gaps to jump, a walled high road, an underpass |
| Skyway Eight | Hard | A figure of eight over a bridge and back through the tunnel underneath, with a chicane and a jump |

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

The clock starts when you first press the gas, and keeps running when you go back to a checkpoint. If you fall off the road it puts you back by itself after 3 seconds.

Best times, their checkpoint splits and the ghost are kept in your browser's local storage, one per track.

## How it works

| File | What it does |
| --- | --- |
| `js/tracks.js` | The tracks as lists of points, plus their medal times |
| `js/path.js` | Turns the points into a smooth road and answers "what's under the car?" |
| `js/physics.js` | Arcade car handling: engine, brakes, grip, drifting, jumps and walls |
| `js/race.js` | Checkpoints, laps and the clock (counted in fixed 1/120 s physics steps) |
| `js/ghost.js` | Records your run and plays it back |
| `js/autopilot.js` | A robot driver for the menu's demo laps and the track checker |
| `js/trackmesh.js` | Builds the road, kerbs, walls, tunnels, pillars, gates and signs |
| `js/scenery.js` | Sky, hills, trees, grandstands, buildings and boulders |
| `js/carmodel.js` | The car model |
| `js/effects.js` | Tyre smoke, skid marks and sparks |
| `js/audio.js` | Engine, tyres, wind and chimes |
| `js/input.js` | Keyboard, touch buttons and gamepads |
| `js/main.js` | Game states, camera, HUD and menus |
| `js/config.js` | Name, handling, camera and paint colours |

## Make your own track

Add an entry to `js/tracks.js`. A track is a list of points the road curves through: `[x, z]`, `[x, z, height]` or `[x, z, height, options]`, in metres. The options apply to the stretch from that point to the next:

- `cp: true` puts a checkpoint gate there.
- `walls: true` adds barriers on both sides, and `tunnel: true` adds a tunnel.
- `gap: true` leaves the road out for a jump. Give the lip a `slope` (0.1 is a good start) so it launches you, and the landing a small negative `slope`.
- `bank: 12` leans the road into the corner by that many degrees.
- `w: 16` changes the road width there.

Set `closed: true` and `laps` for a circuit; otherwise the track runs from the first point to the last. Then check it from the repository root:

```sh
npm install
npm run check:tracks                 # warnings, plus a robot's time round each track
npm run check:tracks -- --svg maps   # also writes a top-down map of each track
```

The checker warns about corners tighter than the road is wide, steep slopes and roads that cross without enough headroom. It also makes sure a robot driver can finish, which proves every jump can be cleared. Use the robot's times to set the medals. Rebuild the one-file version afterwards with `npm run build:desktop`.

## Tuning

`js/config.js` holds the handling. For example, `topSpeed`, `accel` and `brake` set the pace, `steerRate`/`steerRateTop` set how sharply the car turns at low and top speed, and `grip`, `slideAt` and `driftGrip` decide how easily it slides. Change `GAME_TITLE` to rename the game; the second word is shown in red.
