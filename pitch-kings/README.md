# Pitch Kings

A 3D football (soccer) game in a single HTML file: `index.html`. Original teams, kits and players, no real clubs or branding.

Open `index.html` in a browser (double-clicking works; no server or build step). It loads three.js r128 and PeerJS 1.5.4 from cdnjs, falling back to jsDelivr, so it needs an internet connection. Textures, player models and sounds are all generated in code.

## Modes

- **Kick-Off**: you against the AI (Easy, Medium, Hard or Legendary).
- **Local 2 Player**: two players on one keyboard, or with gamepads.
- **Online Match**: one player hosts and gets a 5-character room code, the other joins with it. The host runs the simulation and streams snapshots at 30 Hz; the guest sends its inputs. It connects peer-to-peer over WebRTC through the free PeerJS signalling server, so some strict networks can block it.

## Controls

| Action | Player 1 | Player 2 (local) | Gamepad |
| --- | --- | --- | --- |
| Move | WASD (arrows too in 1-player) | Arrow keys | Left stick / D-pad |
| Sprint | Shift | Right Shift / Num 0 | RT |
| Pass | Space | K / Num 1 | A |
| Shoot (hold for power) | F | L / Num 2 | B |
| Through ball | E | O / Num 3 | Y |
| Lob / cross | R | P / Num 4 | X |
| Switch player | Q | U / Num 5 | LB |
| Tackle (sprint + tackle = slide) | C | J / Num 6 | RB |
| Pause | Esc / P | | Start |

Hold a pass or shot button to add power, then release it. Your movement direction aims shots: up or down picks the side of the goal. If you press an action just before the ball reaches you, your player plays it first time (a volley or header).

## What's in it

- **Rules**: goals, throw-ins, corners, goal kicks, kick-offs, fouls, free kicks with walls, penalties, and offside (which can be turned off). Two halves of 2, 4 or 6 real minutes, with a 0–90 minute clock.
- **Ball physics**: drag, Magnus curl and dip from spin, bounces, and rolling friction. Goal posts deflect the ball, and the nets ripple when it hits them.
- **AI**: teams keep a formation (4-3-3, 4-4-2, 4-2-3-1, 3-5-2 or 5-3-2; for 5v5, 1-2-1, 2-1-1 or 2-2) that shifts with the ball. Players press, jockey, mark, make runs in behind, and choose between shooting, passing, through balls, crosses, dribbling and clearances. Goalkeepers position on the ball-goal line, dive, catch or parry, come for loose balls, and throw or kick the ball out.
- **Presentation**: a night stadium with an instanced, animated crowd, floodlights, shadows and LED advertising boards (all brands invented). There are broadcast, wide and tele cameras, a goal celebration camera, and slow-motion replays. The HUD shows the scoreboard, a radar, and name, stamina and power bars over your player. Sound effects (kicks, whistles, crowd, cheers, near-miss groans, post hits) are made with the Web Audio API.
- **Settings**: graphics quality (Low, Medium or High), difficulty, half length, 11v11 or 5v5, offside, camera, radar and volume. They are saved in `localStorage`.

## Expanding it

The code is one `<script>` block split into numbered sections. Search for `=====` to jump between them:

1. Config & data: `TEAMS`, `FORMATIONS`, `DIFF` (AI difficulty), and `DIMS` (pitch sizes)
2. Utilities
3. Audio (`Sound`)
4. Input (`Input`, `KEYSETS`, `PAD_MAP`)
5. Network (`Net`)
6. Graphics, world: `buildWorld`, the crowd shader, and nets
7. Graphics, players: `PlayerView` and its procedural animation
8. Camera & HUD
9. Ball physics: `PHYS` and `ballIntegrate`
10. Match simulation: the `Match` class, covering rules, set pieces, kicking and tackling
11. AI: `formationTarget`, `aiTeam`, `aiCarrier`, `aiBestPass` and `aiGK`
12. App: menus, modes, the main loop, replays and online glue

Some examples:

- **Add a team**: add an entry to `TEAMS`. Player names and numbers are generated from the team's index.
- **Add a formation**: add it to `FORMATIONS[11]` or `FORMATIONS[5]` as `[x, z, label]` slots. `x` runs from -1 (own goal) to 0 (halfway) and `z` from -1 to 1 across the pitch.
- **Tune the AI**: change the numbers in `DIFF`. To change how willing the AI is to shoot, pass or dribble, edit `aiCarrier` and `aiBestPass`.
