# Mecha Raptor

A cheerful low-poly open-world sandbox in the browser. You are an eccentric Professor with a home-made **Mecha Raptor** that walks, flies and turns into a racer, sprays water to put out fires, and sometimes goes missing — stolen by thieves, or off to Grandma's attic for cookies.

Built with **Three.js + TypeScript + Vite**, **Rapier** physics, a plain DOM HUD driven by **zustand**, **Lucide** icons and procedural **Web Audio** (no image or sound files: everything is built from primitives and synthesised).

**Status:** all four phases of [`plan.md`](plan.md) are done, plus GTA-style vehicles, a living town, LEGO-style controls, a second island, the Raptor's Boat mode, and floating islands up in the sky and in space. Playable on desktop (keyboard + mouse or gamepad) and on touch screens.

## Run it

```bash
npm install
npm run dev          # http://localhost:5195
npm run build:local  # build for local Apache: http://localhost/for-fun/raptor/
npm run build        # relative-path build in dist/
npm run typecheck
```

`.htaccess` serves `dist/` at `/for-fun/raptor/` on the local Apache (needs `mod_rewrite`). Rebuild with `npm run build:local` after changes.

In the dev build the browser console has `game` (the engine) and `store` (the game state) for poking around, e.g. `game.director.startFire(game.professor.pos)` or `game.mystery.begin('stolen')`.

## Deploy

Live at https://raptor.situs.id (GitHub Pages behind a proxied Cloudflare CNAME to `hifebriansyah.github.io`). Every push to `main` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml): `npm ci`, `npm run build`, copy `CNAME` into `dist/`, publish `dist/`. In the repo's Pages settings, the source must be **GitHub Actions**.

## Controls

LEGO-style: you move the way you push **on screen**, and the water gun aims for you.

| Key | Action |
| --- | --- |
| W A S D | Move (relative to the camera) |
| Mouse | Look around (click to capture the mouse, Esc frees it) |
| Click | Spray water — auto-locks onto the nearest fire or thief in front of you |
| Right-click (hold) | Aim freely with the mouse instead |
| Shift (tap) | Run until you stop · boost (Raptor flight/race, faster vehicles) |
| Space | Jump · climb (flight) · handbrake (car) · hop (bikes) |
| Space ×2 | On the Raptor: in Walk mode take off into Flight; in Race or Boat mode go back to Walk |
| Ctrl / C | Descend (flight) · drift (Race mode) |
| Mouse up / down | In Flight, holding W climbs or dives the way the camera looks |
| 1 2 3 4 / Q | Raptor modes: Walk · Flight · Race · Boat |
| V | Raptor vehicle (Race / tank) mode |
| B | Raptor Boat mode |
| F | On foot: the Raptor follows you around (F again: it stays) |
| R | Call the Raptor: it flies over and lands beside you (from anywhere, even space) |
| E | Ride the Raptor · take/drive/ride vehicles · talk · use the bench · park |
| A / D | Steer in Race mode and vehicles |
| H | Horn (car, motorbike) · bell (bicycle) |
| M | Music on/off |

Gamepad works (left stick move, right stick look, A jump, X use, RT spray, L3/LB run, Y/RB mode). Phones and tablets get an on-screen joystick and buttons.

## Features

**The Mecha Raptor**
- Four modes with animated transformations: **Walk** (jumps 6 m, 12 m with a running jump), **Flight** (wings, jets, hovering; flying forward follows the camera — mouse up to climb, down to dive) **Race** (folds into a racer with wheels: 42 m/s, over 3× walking, and 66 m/s boosting; drifting) and **Boat** (a jet-boat hull with a foamy wake: 30 m/s on the sea, 46 m/s boosting; only crawls on land). Wading in on foot or wheels shows a "press 4" hint; left at sea in Boat mode it stays afloat.
- **Thruster** (boost in Flight, Race and Boat): a full meter lasts about 4 s (about 12 s in Race mode, which uses it 3× more efficiently) and refills by itself at about 14 %/s once you stop boosting for a moment. Run it dry and it overheats — the gauge blinks red and boost is locked until it is back to 30 %.
- A back-mounted **water machine gun** that swivels to the target — in every mode, including Race (keep steering while the turret aims). The tank refills at red street-corner **hydrants**, park **fountains** and the **Lab pad**.
- **Turbo ram:** in Race mode while boosting (or still above normal top speed), every car — rivals too — parked vehicle, pedestrian or thief you hit is **thrown into the air**, tumbles, bounces and lands. People get up dizzy and wander back to the sidewalk, cars rejoin the road and drive on, and thieves are knocked out of the fight. (Grandma and the grandchildren are never thrown.)
- **Heavy landings** (the 12 m running jump, big ramp jumps) hit with a shockwave ring, a dust burst, debris, a crater mark, camera shake and a thump — and throw everything nearby into the air the same way.
- Get off on the Lab pad to **park** it and refill water and thrusters. Left in town, it sniffs around a few metres on its own.

**The Professor**
- Has a **parachute**: get off the Raptor high in the air (E while flying) and it opens straight away; jump or fall from a space island and it opens by itself once he is back in the atmosphere (any long fall opens it). He sinks faster while high up and slows to a gentle 3.5 m/s near the ground, and can steer while gliding.
- Walks, runs (tap Shift), jumps 2 m, **swims** in deep water (slowly, about 2 m/s), and carries a weak **water blaster** that never runs dry.
- **GTA-style vehicles:** walk up to a traffic car and press E to take it (the driver jumps out and runs off). **Bicycles** and **motorbikes** are parked around town — one of each by the Lab, a bicycle at Grandma's. Each handles differently; get out anywhere and it stays there.

**A living town**
- **Two islands in a shallow sea.** The main 560 m town island: road grid, downtown towers, suburbs, parks, beach, the **Professor's Lab** and **Grandma's house** (walk in, climb to the attic). **Palm Isle** to the east: palm groves, beach huts, a lighthouse with a spinning beam, and piers on both islands facing each other. Reach it by boat, by air, or by swimming.
- ~18 **traffic cars** that brake, honk and stop when you walk up to them; ~40 **pedestrians** who stroll, wave, scatter from speeding vehicles and the Raptor, shake off water, and cheer.
- **Rival racers** (Blaze, Volt, Nitro Nana) on the ring road: challenge one in Race mode or in a car for a one-lap, 8-checkpoint race. Stunt ramps sit just outside the ring road.

**Events and story**
- **Fires** break out every minute or two, with a smoke column visible across town. Spray every hotspot before the timer runs out for Lab Points.
- **Grandma, Leo and Mia** chat with tips and gossip.
**Up in the sky and in space**
- Fly up into the sky. Above about 300 m you are **in space**: the sky turns black, stars and a ringed planet appear, and **gravity drops to moon level** (the Raptor's 6 m jump becomes about 17 m). The flight ceiling is 900 m; **Shift + Space** climbs fast (space in about 13 s).
- **Floating islands** to land on and explore, each worth **+25 Lab Points** the first time you set foot on it: **Cloud Isle** (170 m, above the town: temple ruins, trees, a waterfall), the **Crystal Star Isle** and the **Satellite Star Isle** (420–470 m, in space), and **Moon Rock** (520 m: craters and a flag). They show on the minimap once you are airborne. Step off the edge for a very long fall home.
- **Meteor fall:** a long drop (from space or the clouds) builds up to 110 m/s. Past 55 m/s the Professor or Raptor trails fire and smoke with a growing camera shake, and landing makes a huge crater, fireball and blast that scales with the fall speed.
- **Altitude culling** (like LEGO Marvel 2): stars, planet and the space islands are only drawn above about 190 m; above about 400 m the town, sea, traffic, people and Cloud Isle are not drawn at all (they come back below about 370 m).
- Thief hideouts now include **the pirate shack on Palm Isle**.
- **Missing Raptor mystery** (only when you leave it alone and wander off): either **thieves** steal it — ask Grandma for a **premonition**, find the hideout, soak the thieves and take it back — or it sneaks into **Grandma's attic** for cookies; the kids drop hints, and waking it gives a 60-second **Sugar Rush**.
- **Lab Points** buy **upgrades** at the bench beside the Lab garage: Turbo Thrusters, Bigger Water Tank, Lab Security Alarm, Cookie Dispenser (3 levels each).
- Points, upgrades and sound settings are **saved** in the browser.

## Speeds

Top speeds in metres per second (km/h in brackets). *Boost/run* is with Shift (tap Shift to run on foot; boost uses thruster energy). Sugar Rush adds 30 % to the Professor's vehicles and the Raptor; each Turbo Thrusters level adds 12 % to boosts.

| Who / mode | Normal | Boost / run | In water |
| --- | --- | --- | --- |
| Pedestrians | 1.1–1.8 (4–6) | 4.2 (15) fleeing | — |
| Thieves | 1.2 guarding | 4.3 (15) chasing, 7 (25) fleeing | — |
| Professor on foot | 5 (18) | 9 (32) | 2 (7) swimming, 3.6 (13) fast |
| Bicycle | 9 (32) | 13 (47) | ×0.25 |
| Traffic cars | 9–13 (32–47) | — | — |
| **Raptor Walk** | 13 (47) | 22 (79) | ×0.5 wading |
| Car (taken) | 24 (86) | 30 (108) | ×0.25 |
| **Raptor Flight** | 24 (86) | 44 (158) | skims the surface |
| Rival racers | 24 (86) cruising | 40–56 (144–202) racing | — |
| Motorbike | 28 (101) | 36 (130) | ×0.25 |
| **Raptor Boat** | 30 (108) on water | 46 (166) | 3.5 (13) on land |
| **Raptor Race (V)** | 42 (151) — 3.2× Walk | 66 (238) | ×0.3 |

Jumps: Professor 2 m · Raptor 6 m · Raptor running jump 12 m (lands with an impact shockwave).

## Code map

```text
src/
  main.ts                    boot, save/load
  game/                      GameEngine (loop + rules), WorldMap, CameraRig, InputManager, EventDirector
  entities/                  Professor, MechaRaptor, Humanoid, NPCManager, FireHazard, CharacterEntity
  systems/                   PhysicsSystem, WaterSystem, ParticleSystem, TrafficSystem, PedestrianSystem,
                             VehicleSystem, RaceSystem, MysterySystem, AudioSystem, RoadAgent
  state/gameStore.ts         zustand store (HUD state, objectives, upgrades, saves)
  ui/                        HUD, Minimap, DialogueBox, PremonitionModal, UpgradeBench, TouchControls, hud.css
```

Physics runs at a fixed 60 Hz with interpolated rendering. Characters and vehicles use Rapier's kinematic character controller for walls, ramps, stairs, piers, buildings and cars, but **not for the ground**: there is no ground collider. `game/Terrain.ts` describes the islands, the sloping shores and the sea floor, and characters are kept on it by hand (swimmers and boats float at the water surface). Letting the controller handle it caused two bugs, now fixed: on one huge 600 m box the Professor slowly sank in and froze for up to 2 s, and on a heightfield the Raptor in Race mode kept tripping over its internal edges at speed (false "crashes" that cut its speed).

## Known limits

- The physics engine is a 4.3 MB script (1.6 MB compressed), so the first load is heavy.
- People, thieves and NPCs have no physics bodies, so they can clip through walls.
- Taken cars have no visible driver inside; the Professor is hidden while driving.
- Sound starts after your first click or key press (browser autoplay rules).
