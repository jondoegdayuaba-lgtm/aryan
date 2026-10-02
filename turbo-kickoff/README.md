# Turbo Kickoff

A 3D car-soccer game for the browser, inspired by Rocket League. A Blender script generates every 3D model, and the game runs on [three.js](https://threejs.org) with [cannon-es](https://pmndrs.github.io/cannon-es/) physics.

## Play it

**`turbo-kickoff.html` is the whole game in one file.** Save it anywhere (your desktop is fine) and double-click it. It opens in your browser and runs offline, with no web server or install.

Pick a bot difficulty, then **1v1**, **2v2** (you and a bot against two bots) or **Free play**.

| Key | What it does |
| --- | --- |
| W / S | Drive / reverse. In the air: tilt the nose down / up |
| A / D | Steer. In the air: turn |
| Space | Jump. Hold for a higher jump. Press again in the air to double jump, or with W/A/S/D to flip into the ball |
| Shift | Boost (uses the boost meter; drive over pads to refill it) |
| Shift in the air | Fly (aerials) |
| Q / E | Air roll |
| X | Powerslide (in the air, X + A/D also rolls) |
| C | Ball cam on / off |
| Esc or P | Pause |
| M | Mute |
| R / B | Free play only: reset the ball / toggle unlimited boost |

A gamepad works too: RT/LT drive, left stick steer, A jump, B boost, X powerslide, Y ball cam, LB/RB air roll, Start pause.

How a match works:

- Matches last 5 minutes. Each kickoff counts down 3-2-1-GO, and the clock only runs while the ball is in play.
- When the clock hits 0:00 the match ends as soon as the ball touches the ground. If the score is tied, overtime starts and the next goal wins.
- Small pads give 12 boost and big pads fill you to 100. Small pads recharge in 4 seconds, big ones in 10.
- Drive fast up the curved walls to get onto the walls and ceiling; slow down and you'll fall off.
- The end screen shows everyone's score, goals, assists, saves and shots, and the MVP (top scorer on the winning team). Goals earn 100 points, assists and saves 50, shots on goal 20.

## Folder setup

```
turbo-kickoff/
├── turbo-kickoff.html            the whole game in one file (built from the files below)
├── index.html                    the game page, for running from a web server
├── css/style.css                 menus and HUD
├── js/                           the game code
│   ├── main.js                   renderer, menus, main loop
│   ├── game.js                   a match: kickoffs, clock, goals, overtime, stats, boost pads
│   ├── car.js                    car physics: driving, walls and ceiling, jumps, flips, boost, air control
│   ├── ball.js                   ball physics and ball prediction
│   ├── arena.js                  the arena's exact shape, used for collisions
│   ├── ai.js                     the bots (easy / medium / hard)
│   ├── camera.js                 chase camera and ball cam
│   ├── effects.js                boost flames, particles, goal explosions, shadows
│   ├── audio.js                  synthesised sounds
│   ├── input.js                  keyboard and gamepad
│   ├── ui.js                     scoreboard, boost meter, countdown, end screen
│   ├── assets.js                 loads the models
│   └── config.js                 tuning: physics, match length, bot difficulty
├── assets/models/                the exported .glb models and arena_layout.json
├── blender/
│   └── turbo_kickoff_assets.py   makes the models in Blender (Part 1, below)
├── tools/build-single.mjs        rebuilds turbo-kickoff.html
└── vendor/                       three.js r186 (with the add-ons the game uses) and cannon-es 0.20
```

## Run it locally (for working on the code)

Browsers won't load ES modules from `file://`, so to run `index.html` serve the folder:

```sh
cd turbo-kickoff
python3 -m http.server 8000
# then open http://localhost:8000
```

`npx http-server` or any other static server works too. Edits to `js/` show up when you reload the page.

After changing the code or the models, rebuild the one-file version from the repository root:

```sh
npm install
npm run build:turbo
```

To use models you exported yourself from Blender, put them in `turbo-kickoff/assets/models/` (replacing the ones there) and rebuild.

In the browser console, `turboKickoff.match` is the running match, which is handy for poking at things (`turboKickoff.match.ball.vel`, `turboKickoff.match.player.boost = 100`).

### How the physics works

cannon-es simulates the car hitboxes (Rocket League Octane sized boxes) and the ball, so car-ball and car-car hits bounce realistically. The arena is not a cannon-es mesh. `js/arena.js` describes its exact curved shape as maths, the same shape the Blender script builds, and the cars and ball collide against that. It's smooth, cheap and lets the cars drive up the walls and over the ceiling: a car on a surface lines itself up with it and sticks while it's fast enough. Hits get an extra Rocket League style kick on top of the physical bounce so you can shoot hard, and a flip adds 20% more.

## Making the 3D models in Blender

The models in `assets/models/` are already exported, so you only need this to change them.

You need **Blender 4.2 or newer** (free from [blender.org](https://www.blender.org/download/)). The script has been tested with Blender 4.2 LTS and 5.0.

### Steps

1. Open Blender. On the splash screen, choose **General** (or **File → New → General**).
2. Click the **Scripting** tab at the top of the window. You get a Python console, a Text Editor and an Info log.
3. Get the script into the Text Editor, either way:
   - **Open it (recommended):** click **Open** in the Text Editor and pick `turbo-kickoff/blender/turbo_kickoff_assets.py` from this project. The models then export straight into `turbo-kickoff/assets/models/`.
   - **Paste it:** click **+ New** and paste in the whole file. The models then go to a `TurboKickoff/models` folder in your home folder (see below).
4. Click **Run Script** (the ▶ button above the text), or hover over the text and press **Alt+P**.
5. After a second or two a message pops up showing the folder the files went to. The viewport switches to Material Preview and shows the arena with the ball on the centre spot, a car from each team on its kickoff spot, and all 34 boost pads. Press **Home** with the mouse over the viewport to see the whole stadium.

The script deletes Blender's start-up cube (it would sit inside the arena) and leaves your other objects alone. You can run it as often as you like: it rebuilds everything and overwrites the files.

### Where the files go

| How you ran it | Export folder |
| --- | --- |
| Set `EXPORT_DIR` at the top of the script | That folder |
| Opened the file from `turbo-kickoff/blender/` | `turbo-kickoff/assets/models/` |
| Pasted it into a new text block | `TurboKickoff/models` in your home folder: `C:\Users\<you>\TurboKickoff\models` on Windows, `/Users/<you>/TurboKickoff/models` on macOS, `/home/<you>/TurboKickoff/models` on Linux |

If the files didn't land in `turbo-kickoff/assets/models/`, copy all seven of them there. That is where the game loads them from.

You can also run the script without opening Blender's window. It then writes straight into `turbo-kickoff/assets/models/`:

```sh
blender --background --python turbo-kickoff/blender/turbo_kickoff_assets.py
```

On Windows, `blender` is something like `"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe"`.

### What you get

| File | What's in it | Triangles |
| --- | --- | --- |
| `car_blue.glb` | Chunky low-poly sports car: big wheels with spoked rims, wheel arches, racing stripes, a spoiler, and twin rocket boosters with glowing nozzles. Blue with white stripes. | 1,632 |
| `car_orange.glb` | The same car in orange with dark stripes | 1,632 |
| `ball.glb` | Soccer-style ball: 30 light hexagon panels and 12 dark pentagons with glowing cores, with grooved seams | 840 |
| `arena.glb` | Stadium with turf stripes, a ramp from the floor up into glass walls that curve over into the ceiling, rounded corners, a goal at each end with glowing frames and net lines, neon floor lines, "TURBO KICKOFF" banners, LED boards, tiered stands with a crowd, and floodlight towers | about 21,000 |
| `boost_pad_small.glb` | Small hexagonal pad with a glowing ring and a floating glowing chip | 88 |
| `boost_pad_big.glb` | Big pad with a glowing ring, four claws and a glowing orb | 284 |
| `arena_layout.json` | Arena and goal sizes, the 34 boost pad positions (Rocket League's standard layout, scaled to this arena) and 5 kickoff spots per team | |

The game looks these parts up by name:

- **Cars:** `Body`, `Wheel_FL`, `Wheel_FR`, `Wheel_RL`, `Wheel_RR`, `BoostExit_L` and `BoostExit_R`. Each wheel's origin is its hub, so it can spin and steer. The two boost exits are empty points where the boost flames come out.
- **Boost pads:** `BoostPad_Small_Glow` and `BoostPad_Big_Orb`, the parts hidden while a pad recharges.
- **Arena:** `Arena_Floor`, `Arena_Walls`, `Arena_Ceiling`, `Arena_Goal_Blue`, `Arena_Goal_Orange`, `Arena_Lines`, `Arena_Trim`, `Arena_Stands`, `Arena_Crowd`, `Arena_Lights` and `Arena_Ground`. To make the game lighter on a slow device, hide `Arena_Crowd` (about 10,000 of the arena's triangles).

### Sizes and directions

- Everything is in metres. The car is 1.25 m long and 0.62 m tall, and the ball is 1.86 m across (3× the car's height).
- The arena is 72 m wide, 96 m long and 20 m high. Its corners are rounded (10 m radius), a 3 m ramp curves from the floor up into the walls, and a 6 m curve takes the walls over into the ceiling. The goals are 17.8 m wide, 6.4 m tall and 8.8 m deep.
- In three.js, Y is up. The blue goal is at +Z (its goal line at z = 48) and the orange goal is at −Z. Cars face +Z.
- Glowing parts use emissive materials with a strength above 1 (`KHR_materials_emissive_strength`), so they light up with a bloom pass. The glass walls, ceiling and goal nets are see-through.
- The floor, walls, ceiling and goals form one closed shell, with every face pointing into the playing space.

### Changing things

These settings are at the top of the script. Run it again after editing.

| Setting | What it changes |
| --- | --- |
| `TEAMS` | Team colours: car body, accent stripes, glow, seats |
| `ARENA_HALF_WIDTH`, `ARENA_HALF_LENGTH`, `ARENA_HEIGHT`, `CORNER_RADIUS`, `FLOOR_CURVE`, `CEILING_CURVE` | Arena size and shape. The floor, walls, lines, stands, pad positions and `arena_layout.json` all follow. |
| `GOAL_HALF_WIDTH`, `GOAL_HEIGHT`, `GOAL_DEPTH` | Goal size |
| `BALL_RADIUS` | Ball size |
| `CROWD_SEED` | Where the fans sit |
| `EXPORT_DIR` | Where the files are saved |

### Checking the models

- Drag a `.glb` file onto [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com/) or the [three.js editor](https://threejs.org/editor/).
- Or, in Blender, use **File → Import → glTF 2.0**.

### Troubleshooting

- **Nothing seems to happen, or there's an error:** the full output is in the system console. On Windows use **Window → Toggle System Console**; on macOS and Linux, start Blender from a terminal.
- **"Permission denied":** set `EXPORT_DIR` to a folder you can write to, such as your Documents folder.
- **"Arena sizes don't fit together":** an edited size clashes with another, for example a goal wider than the straight part of the end wall.
