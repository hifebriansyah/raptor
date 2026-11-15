# Mecha Raptor

A cheerful low-poly open-world sandbox in the browser, in the spirit of LEGO City games. You are an eccentric 36-year-old Professor with a home-made **Mecha Raptor** that walks, flies, races and grows into a Titan. You put out fires, fight thugs and zap them to jail, ride the city train, go into any building, and fly all the way up to space.

Built with **Three.js + TypeScript + Vite**, **Rapier** physics, a plain DOM HUD driven by **zustand**, **Lucide** icons and procedural **Web Audio**. Cars, boats, houses, downtown buildings, trees, the city train, the Moon Base, the rocket, meteors and the Lab Guns are **Kenney** 3D models (CC0, [kenney.nl](https://kenney.nl), in `public/models/`); the characters, the Raptor and everything else are built from primitives in code. Sound is all synthesised.

**Status:** every phase of [`plan.md`](plan.md) is built (phases 1–10). Playable on desktop (keyboard + mouse or gamepad) and on touch screens, and installable as an app.

## Run it

```bash
npm install --registry=https://registry.npmjs.org
npm run dev          # http://localhost:5195
npm run build:local  # build for local Apache: http://localhost/for-fun/raptor/
npm run build        # relative-path build in dist/
npm run typecheck
```

`.htaccess` serves `dist/` at `/for-fun/raptor/` on the local Apache (needs `mod_rewrite`). Rebuild with `npm run build:local` after changes. The default npm registry on this machine is a private one with an expired token, hence `--registry`.

In the dev build the browser console has `game` (the engine) and `store` (the game state) for poking around. Some examples:
- `game.director.startFire(game.professor.pos)`
- `game.mystery.begin('stolen')`
- `game.events.start('mech')` (also `'meteor'` and `'train'`)
- `game.travelTo(2, true)`
- `store.setState({ bolts: 1000 })`

## Deploy

Live at https://raptor.situs.id (GitHub Pages behind a proxied Cloudflare CNAME to `hifebriansyah.github.io`). Every push to `main` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml): `npm ci`, `npm run build`, copy `CNAME` into `dist/`, publish `dist/`. In the repo's Pages settings, the source must be **GitHub Actions**. The PWA manifest and service worker (`public/`) ship with the build.

## Controls

LEGO-style: you move the way you push **on screen**, and guns aim for you. The full list is also in the in-game menu (**Tab** or **P**), not on the HUD.

| Key | Action |
| --- | --- |
| W A S D | Move (relative to the camera) |
| Mouse · Arrow keys | Turn and tilt the camera (click to capture the mouse) |
| Wheel · `+` `−` | Zoom in / out · middle-click or `0`: reset zoom |
| Click · J | Spray / fire the current Lab Gun (auto-locks onto fires, thieves and thugs) |
| Right-click · K (hold) | Aim freely |
| Shift (tap) | Run until you stop · boost |
| Space | Jump · climb (flight) · handbrake (car) |
| Space ×2 | On the Raptor: Walk → Flight; Race → back to Walk |
| Space (parachute) | Cut the parachute into a spread-eagle skydive; Space again re-opens it |
| Ctrl / C | Descend (flight) · drift (Race) |
| 1 2 3 / Q, V | Raptor modes: Walk · Flight · Race (V = Race) |
| G | Giant (Hulkbuster) Mode on the Raptor |
| X | Punch/kick combo · flying kick (jump) · ground slam (falling) · shoulder bash (running) · Titan punch |
| Z · 1–5 (on foot) | Gadget wheel: Water, Shrink/Big, Teleport, Transform, Megaphone |
| T | Feed the Raptor a cookie (riding or next to it) · throw a cookie as a lure |
| E | Ride · drive · board · enter buildings · talk · use · build |
| E (in the air) | Jump off the Raptor with a parachute |
| R | Call the Raptor (from anywhere, even space) |
| F | The Raptor follows you / stays (flies alongside your boat) |
| N | Quick-travel map (teleport pads) |
| H | Horn · bell |
| M | Music on/off |
| Tab · P · Esc | Menu (the game pauses; releasing the mouse opens it too) |

Gamepad works: left stick moves, right stick looks, A jumps, X uses, B punches, RT sprays, Y switches gun or mode, LB/L3 runs, D-pad up/down zooms and Start opens the menu. Phones and tablets get an on-screen joystick and buttons, including Punch, Gun and Menu.

## Features

**Menu, camera and options**
- Title screen and pause menu with a slow flyover of the town:
  - **Continue / New Game**: New Game asks twice before wiping progress.
  - **Options**: **Crowds** (Low / Medium / High / Packed), which sets how many pedestrians, cars and boats there are, live. **Shading** (Flat, Toon cel-shading, Standard, High with sharper shadows and glow).
  - **Cheats & Extras** and a **Controls** page.
  - **Install app**: PWA with manifest, offline cache and the browser's install prompt.
- Lucide icon buttons on the HUD: zoom in, zoom out, reset zoom, sound, music, menu. A clock shows the time of day; a day lasts 12 minutes.

**The Mecha Raptor**
- Three modes:
  - **Walk**: jumps 6 m, 12 m with a running jump.
  - **Flight**: flying forward follows the camera, so mouse up climbs and down dives.
  - **Race**: 42 m/s, 66 m/s boosting.
- The old Boat mode is gone: real boats roam the sea instead, and with Follow on the Raptor flies alongside yours.
- **Giant Mode (G):** a chest rig, two gauntlets, two leg boosters and back cannons drop from the sky and lock onto the Raptor one by one. It then grows 2.6× into a **Titan Raptor**:
  - Its footsteps make shockwaves.
  - X throws a punch that sends cars flying.
  - G again sends the armour back.
- Thruster boost refills by itself; Race mode uses it 3× more efficiently. Water gun in every mode. Turbo ram and heavy landings throw everything nearby.
- Only the Raptor can become a burning **meteor** in a long fall; the Professor never does.
- **Treats:** carry cookies (Grandma fills you up to 8, Sam's café sells them).
  - Feeding the Raptor (T) refills its thrusters and gives a Sugar Rush.
  - A thrown cookie lures the Raptor over to eat it.
  - Keeping it fed stops cookie raids on Grandma's attic.
- Can be stolen **anywhere** you leave it, not only at the Lab.

**The Professor**
- 36, messy brown hair. Walks, runs, jumps 2 m, swims, parachutes and skydives.
- **Melee:**
  - Jab → hook → spinning kick → knockback finisher.
  - A flying kick in the air, or a ground slam when falling from height.
  - A shoulder bash while running.
- **Five Lab Guns:**
  - **Water**: puts out fires, splashes people.
  - **Shrink/Big**: cycles people, thugs, cars and bikes through giant, tiny and normal. Zap Gwen to make her a real kaiju.
  - **Teleport**: zaps a *dazed* thug into the police holding cells for +20 Lab Points. Healthy thugs dodge.
  - **Transform**: puts people and thugs in chicken, frog, mini-dino, penguin or duck costumes.
  - **Megaphone**: a sonic cone that throws everything in front of you.
- **GTA-style vehicles** with see-through glass and visible drivers, the Professor sitting at the wheel:
  - Sedans, sports cars, roadsters, race cars, city buses, fire trucks, police cars, vans, bicycles and motorbikes, each with its own handling.
  - **Boats**: speedboats, fishing boats, yachts and coastguard boats. Take over an AI boat and the skipper dives overboard.

**Family and townsfolk** (daily routines on the clock, 2D portraits in conversations)
- **Grandma**, the Professor's mother: always rocking on her porch by the front door, so she's easy to find. She gives premonitions when the Raptor goes missing and tops up your cookies.
- His sons **Leo (11)** and **Max (9)**: school, park, arcade, Grandma's yard.
  - Leo plays **tag**: catch him in 30 s.
  - Max hides **6 stars**: find them in 75 s.
- His wife **Gwen**, stomping about in a Godzilla costume and roaring at passers-by.
- **Sam** from the café, **Chief Bruno** at the police station, and **Cora** the train conductor.
- **Thugs** roam the sidewalks and pick fights when you are on foot, and scatter from the Raptor. Knock one down to its last bit of health and it gets dazed, with spinning stars.

**The world**
- **Town:**
  - Toy-brick buildings with studded roofs, 3.6 m storeys and 2.6 m doors.
  - **4-lane boulevards** (the ring road and two avenues) with 2-lane side streets.
  - Downtown towers, suburbs and parks, plus a **sunken park** bowl with a fountain.
- **Uptown** (north): **Observatory Hill**, with a spiral road up to the domed observatory, a 4-lane **tunnel** through the hill, a coast road along the **cliffs**, and hillside houses.
- **Palm Isle:** palms, huts, piers, the pirate shack, and the lighthouse on its own hill.
- **Every building can be entered** (E at the door): an iris wipe, then a room built on the fly.
  - Seeded interiors: houses (nap until evening or morning), shops (cookies), Sam's café, offices and towers (lift to the **roof**, then jump off and skydive).
  - Handcrafted interiors:
    - **Grandma's house** (E at her front door), on three floors: kitchen and sitting room (the cookie jar refills your cookies), the bedrooms on the 1st floor, and the dusty **attic on the 3rd floor**. On a cookie run that's where the Raptor is snoozing; waking it rides you both out into her yard.
    - **The Lab**: a hangar the Raptor can follow you into, the upgrade bench, the **Teleport Hub** with 8 portals, and a **progress wall** showing your 100 %.
    - **Police Station**: holding cells showing the thugs you've jailed.
    - **Lighthouse**: climb to the lamp gallery.
    - **Observatory**: the telescope.
    - **Pirate's treasure room**: the chest.
    - **Train stations**.
    - **Moon Base** on Moon Rock.
- **Teleport pads** in Town, Downtown, Uptown, Harbour, the Sunken Park, Palm Isle, Cloud Isle and the Moon Base. Step on one to switch it on, then quick-travel from the map (N) or any Teleport Hub portal.
- **City train:**
  - An elevated viaduct over the ring road with 4 stations; each ground-floor hall has a lift up to the platform.
  - Ride as a passenger, **drive from the cab** (W/S), or stand on the roof and ride along.
- **Up in the sky:** a smooth fade into space (stars, a ringed planet, moon gravity above about 300 m), floating islands, and the Moon Base. On the way up, small things in town thin out by size instead of the whole town popping out.

**Toys, collectibles and events**
- **Smashable props**: benches, bins, crates, mailboxes, phone booths and barrels.
  - They burst into **bolts** that fly to you, and gold bolts are worth 5.
  - Smashing quickly raises a multiplier up to ×4.
  - Props come back later.
- **10 Gold Bricks and 3 Red Bricks** hidden around the world: rooftops, sky islands, the tunnel, the lighthouse top, the observatory dome, a house, the pirate's chest, the viaduct and the cliffs. They unlock **cheats** in the menu:
  - Unlimited Turbo (2 Gold).
  - Unlimited Water (4 Gold).
  - Confetti Water (7 Gold).
  - Bolt Magnet (1 Red).
  - Big Heads (2 Red).
- **Super Builds** paid for with bolts. Each pad assembles its build piece by piece:
  - **Palm Isle Sea Bridge**, 300 bolts.
  - **Mega Ramp**, 150 bolts.
  - **Space Launch Pad**, 400 bolts: E on the pad blasts you to space.
- **Sandbox events** every few minutes:
  - **Meteor crash**: grab the glowing space rock from the crater.
  - **Runaway train**: land on the front car, swing into the cab, pull the brake.
  - **Rogue Mech**: a giant robot stomping into town; beat it in Giant Mode.
- Still here from earlier phases: **fires**, **rival races**, the **missing-Raptor mystery** (theft, or a cookie run up to Grandma's 3rd-floor attic), Lab upgrades.
- **Saved** in the browser: points, upgrades, options, cookies, pads, jailed thugs, bricks, bolts, cheats and Super Builds.

## 3D models (Kenney)

The raw Kenney downloads live in `kenney/` (git-ignored, about 57 MB). The game only ships the models it uses, copied to `public/models/` (about 5 MB):

| Folder | From | Used for |
| --- | --- | --- |
| `cars/` | Car Kit | traffic and drivable cars (sedans, SUVs, taxis, sports, race cars, vans, delivery, ambulance, garbage truck, police, fire truck), cones and boxes as props |
| `boats/` | Watercraft Pack | speedboats, fishing boat, sailing yacht, tug (coastguard) |
| `suburb/` | City Kit (Suburban) | the outskirts' and Uptown's houses, trees |
| `town/` | Modular Buildings | downtown towers and shops (tinted for variety) |
| `space/` | Space Kit | the city train (monorail cars), Moon Base hangar, dish, rover, astronaut, rocket, meteor, space rock, crater |
| `blasters/` | Blaster Kit | the five Lab Guns in the Professor's hand |

`game/Models.ts` loads them all at boot, puts each model's bottom centre at its origin, and hands out scaled copies. It also bakes static copies (buildings, trees) into a few merged meshes. If a model fails to load, the game falls back to its hand-built version. To use another Kenney model, copy its `.glb` (and its `Textures/` folder, if any) into `public/models/<folder>/` and add the name to the list in `Models.ts`.

## Speeds

Top speeds in metres per second (km/h in brackets). *Boost/run* is with Shift. Sugar Rush adds 30 %; each Turbo Thrusters level adds 12 % to boosts.

| Who / mode | Normal | Boost / run | In water |
| --- | --- | --- | --- |
| Pedestrians | 1.1–1.8 (4–6) | 4.2 (15) fleeing | — |
| Thugs | 1.4 roaming | 3.6 (13) chasing, 5 (18) fleeing | — |
| Professor on foot | 5 (18) | 9 (32) | 2 (7) swimming |
| Skydiving / parachute | 13 (47) glide | 50 (180) fall / 3.5–22 sink | — |
| Bicycle | 9 (32) | 13 (47) | ×0.25 |
| Traffic | 7–26 (25–94) by model | — | — |
| City train | 16 (58) | up to 30 (108) driven | — |
| **Raptor Walk** | 13 (47) | 22 (79) | ×0.5 wading |
| City bus / fire truck | 16 / 20 (58 / 72) | 20 / 26 (72 / 94) | ×0.25 |
| Car (sedan) | 24 (86) | 30 (108) | ×0.25 |
| **Raptor Flight** | 24 (86) | 44 (158) | skims the surface |
| Motorbike | 28 (101) | 36 (130) | ×0.25 |
| Speedboat / yacht | 30 / 18 (108 / 65) | 40 / 24 (144 / 86) | crawls on land |
| Race car | 36 (130) | 46 (166) | ×0.25 |
| **Raptor Race (V)** | 42 (151) | 66 (238) | ×0.3 |

Jumps: Professor 2 m · Raptor 6 m · Raptor running jump 12 m.

## Code map

```text
src/
  main.ts                    boot, save/load, PWA setup
  game/                      GameEngine (loop + rules), Models (Kenney loader + batching), WorldMap, Uptown,
                             Terrain (heights, interiors floor), CameraRig, InputManager, EventDirector,
                             SkyIslands, Graphics (shading presets)
  entities/                  Professor, MechaRaptor, Humanoid, NPCManager (family + routines),
                             CarModels (glass cabins, drivers, boats), FireHazard, CharacterEntity
  systems/                   Physics, Water, Particles, Traffic, Pedestrians, Vehicles (cars, bikes, boats),
                             Race, Mystery, Audio, RoadAgent, Fling, Treats, MiniGames, Interiors,
                             Teleport, Thugs, Gadgets (melee + Lab Guns), GiantMode, Train,
                             Collectibles (props, bolts, bricks, Super Builds), SandboxEvents
  state/gameStore.ts         zustand store (HUD state, settings, saves)
  ui/                        HUD, Menu, Minimap, TravelMap, DialogueBox, Portraits, IrisWipe,
                             PremonitionModal, UpgradeBench, TouchControls, install, hud.css
public/                      manifest.webmanifest, sw.js, icons/, models/ (Kenney .glb)
```

Physics runs at a fixed 60 Hz with interpolated rendering. Rapier's kinematic character controller handles walls, ramps, buildings, cars and the viaduct, but **not the ground**. `game/Terrain.ts` describes the floor (flat town, hills, the tunnel, sea floor) and characters are kept on it by hand. Interiors are built 600 m under the town, where the floor switches to the interior level. The town's LOD hides scene objects from the camera by moving them to another render layer, so systems that hide their own objects are unaffected.

## Known limits

- The physics engine is a 4.3 MB script (1.6 MB compressed), so the first load is heavy.
- People, thugs and NPCs have no physics bodies, so they can clip through walls; townsfolk walk simple sidewalk routes.
- The Titan Raptor's collision shape stays normal-sized (only the model grows).
- Traffic only drives the town grid, not the Uptown roads.
- The bus, fire truck and train have short collision capsules for their length.
- Dialogue portraits are placeholder drawings (drop real art into `public/portraits/`, see `ui/Portraits.ts`).
- Kenney cars and the monorail have opaque windows, so drivers and the Professor aren't visible inside them (they still are in boats, on bikes and in the hand-built bus).
- Busy views make around 1,500 draw calls, mostly the people and street props, which can be heavy on phones.
- Sound starts after your first click or key press (browser autoplay rules).
