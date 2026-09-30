# Wheelie Life 2D

A side-view wheelie game. Hold the front wheel up, keep it near the balance point and build the multiplier. It is an original game inspired by Scratch-style wheelie games: all art is drawn in code and the billboards are made-up brands.

## Play

- **No server:** double-click `desktop/wheelie-life-2d.html`.
- **Locally:** from the repo root run `python3 -m http.server 8000` and open `http://localhost:8000/wheelie-life-2d/`.
- Rebuild the single file with `npm run build:wheelie2d`.

## Controls

| Input | Action |
| --- | --- |
| Green flag / Enter | Start or retry |
| Space / Up / W, or hold the screen | Gas: lifts the front wheel |
| Down / S (Brake button on phones) | Brake: brings the front wheel down |
| M | Mute |

## How it plays

The front wheel is an inverted pendulum around the rear axle. Gas lifts it, gravity pulls it back below the balance point and tips you over past it. Holding gas flips the bike in under two seconds, so ease on the gas and touch the brake to catch it, reacting to how fast the wheel is moving, not just where it is.

Score grows with speed while the front wheel is up, times the multiplier (up to 10). The multiplier builds with wheelie time and time spent near the balance point, and resets when the wheel touches down. A loop-out ends the ride; the high score is saved in your browser.

`game.js` holds the physics tuning (`T`), drawing and audio. There are no image or sound files.
