# Mecha Raptor

A cheerful low-poly open-world sandbox in the browser. You are an eccentric Professor with a home-made **Mecha Raptor** that walks, flies and turns into a racer, sprays water to put out fires, and sometimes goes missing — stolen by thieves, or off to Grandma's attic for cookies.

Built with **Three.js + TypeScript + Vite**, **Rapier** physics, a plain DOM HUD driven by **zustand**, **Lucide** icons and procedural **Web Audio** (no image or sound files: everything is built from primitives and synthesised).

**Status:** all four phases of [`plan.md`](plan.md) are done, plus GTA-style vehicles, a living town, LEGO-style controls, a second island and the Raptor's Boat mode. Playable on desktop (keyboard + mouse or gamepad) and on touch screens.

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

## Controls

LEGO-style: you move the way you push **on screen**, and the water gun aims for you.

| Key | Action |
| --- | --- |
| W A S D | Move (relative to the camera) |
| Mouse | Look around (click to capture the mouse, Esc frees it) |
| Click | Spray water — auto-locks onto the nearest fire or thief in front of you |
| Right-click (hold) | Aim freely with the mouse instead |
| Shift (tap) | Run until you stop · boost (Raptor flight/race, faster vehicles) |
| Space | Jump · climb (flight) · back to Walk (Race mode) · handbrake (car) · hop (bikes) |
| Space ×2 | Double jump on the Raptor: take off into Flight |
| Ctrl / C | Descend (flight) · drift (Race mode) |
| Mouse up / down | In Flight, holding W climbs or dives the way the camera looks |
| 1 2 3 4 / Q | Raptor modes: Walk · Flight · Race · Boat |
| E | Ride the Raptor · take/drive/ride vehicles · talk · use the bench · park |
| A / D | Steer in Race mode and vehicles |
| H | Horn (car, motorbike) · bell (bicycle) |
| M | Music on/off |

Gamepad works (left stick move, right stick look, A jump, X use, RT spray, L3/LB run, Y/RB mode). Phones and tablets get an on-screen joystick and buttons.

## Features

**The Mecha Raptor**
- Four modes with animated transformations: **Walk** (jumps 6 m, 12 m with a running jump), **Flight** (wings, jets, hovering; flying forward follows the camera — mouse up to climb, down to dive) **Race** (folds into a racer with wheels, drifting, thruster boost) and **Boat** (a jet-boat hull with a foamy wake: 30 m/s on the sea, 46 m/s boosting; only crawls on land). Wading in on foot or wheels shows a "press 4" hint; left at sea in Boat mode it stays afloat.
- **Thruster** (boost in Flight and Race): a full meter lasts about 4 s and refills by itself at about 14 %/s once you stop boosting for a moment. Run it dry and it overheats — the gauge blinks red and boost is locked until it is back to 30 %.
- A back-mounted **water machine gun** that swivels to the target — in every mode, including Race (keep steering while the turret aims). The tank refills at red street-corner **hydrants**, park **fountains** and the **Lab pad**.
- Get off on the Lab pad to **park** it and refill water and thrusters. Left in town, it sniffs around a few metres on its own.

**The Professor**
- Walks, runs (tap Shift), jumps 2 m, **swims** in deep water (slowly, about 2 m/s), and carries a weak **water blaster** that never runs dry.
- **GTA-style vehicles:** walk up to a traffic car and press E to take it (the driver jumps out and runs off). **Bicycles** and **motorbikes** are parked around town — one of each by the Lab, a bicycle at Grandma's. Each handles differently; get out anywhere and it stays there.

**A living town**
- **Two islands in a shallow sea.** The main 560 m town island: road grid, downtown towers, suburbs, parks, beach, the **Professor's Lab** and **Grandma's house** (walk in, climb to the attic). **Palm Isle** to the east: palm groves, beach huts, a lighthouse with a spinning beam, and piers on both islands facing each other. Reach it by boat, by air, or by swimming.
- ~18 **traffic cars** that brake, honk and stop when you walk up to them; ~40 **pedestrians** who stroll, wave, scatter from speeding vehicles and the Raptor, shake off water, and cheer.
- **Rival racers** (Blaze, Volt, Nitro Nana) on the ring road: challenge one in Race mode or in a car for a one-lap, 8-checkpoint race. Stunt ramps sit just outside the ring road.

**Events and story**
- **Fires** break out every minute or two, with a smoke column visible across town. Spray every hotspot before the timer runs out for Lab Points.
- **Grandma, Leo and Mia** chat with tips and gossip.
- Thief hideouts now include **the pirate shack on Palm Isle**.
- **Missing Raptor mystery** (only when you leave it alone and wander off): either **thieves** steal it — ask Grandma for a **premonition**, find the hideout, soak the thieves and take it back — or it sneaks into **Grandma's attic** for cookies; the kids drop hints, and waking it gives a 60-second **Sugar Rush**.
- **Lab Points** buy **upgrades** at the bench beside the Lab garage: Turbo Thrusters, Bigger Water Tank, Lab Security Alarm, Cookie Dispenser (3 levels each).
- Points, upgrades and sound settings are **saved** in the browser.

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
