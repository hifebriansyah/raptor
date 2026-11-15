# Mecha Raptor — Game Design & Technical Plan (Three.js)

> **Premise:** A bright, toy-like open-world sandbox for the web, built with **Three.js + TypeScript**. You are an eccentric **36-year-old Professor** having fun in town with his homemade **Mecha Raptor**: putting out fires, racing rivals, chasing thieves, sailing to Palm Isle and flying all the way up into **Space**. The long-term direction is a **LEGO City Undercover–style** town (colourful toy-brick districts, a train, enterable landmarks, Super Builds), grown step by step on the existing browser game.

**Engine decision:** stay on **Three.js + Rapier in the browser**. A Godot 4 rewrite was considered and dropped: the web game already runs everywhere with a small download, deploys to GitHub Pages (raptor.situs.id) without special headers, and every planned feature below fits the current stack.

---

## 1. Design Pillars

- **Toybox joy first:** switching between walking, flying, racing, boating and spraying water feels snappy and rewarding.
- **Living little town:** a compact, readable GTA-style map where emergent events (fires, races, break-ins) happen around you.
- **Charming personality:** the Raptor is a companion, not just a vehicle: it sniffs around, follows you, sneaks off for cookies and can be stolen.
- **Up to space:** vertical flight from the streets to floating islands above the clouds stays the signature move.
- **Grow in playable slices:** every phase ships a playable build to raptor.situs.id; big ideas start as one small, working example before they spread across the map.

---

## 2. Tech Stack (as built)

- **Build:** Vite 7 + TypeScript 5.9 (strict). `npm run dev` (port 5195), `npm run build`, `npm run build:local` (base `/for-fun/raptor/` for Apache at http://localhost/for-fun/raptor/).
- **Rendering:** `three` 0.187, flat-shaded low-poly materials, sun shadows (PCF), hemisphere light, merged/instanced geometry for town blocks.
- **Physics:** `@dimforge/rapier3d-compat` kinematic character controllers. No ground collider: `game/Terrain.ts` defines the floor and characters are clamped to it by hand (fixes sinking/tripping seen with cuboid and heightfield grounds).
- **Loop:** fixed 60 Hz simulation, interpolated rendering.
- **State & UI:** vanilla DOM + `zustand/vanilla`, **Lucide** icons, procedural Web Audio (no audio files), progress saved in `localStorage`.
- **Deploy:** GitHub Actions builds the Vite site to GitHub Pages at raptor.situs.id (`CNAME` copied into `dist/`).
- **Installs:** the default npm registry on this machine is a private one with an expired token; install with `npm ci --registry=https://registry.npmjs.org`.

### Code map
```text
src/
├── main.ts                 # entry: load save, start engine
├── game/                   # GameEngine, InputManager, CameraRig, Terrain, WorldMap, SkyIslands, EventDirector
├── entities/               # CharacterEntity, Professor, MechaRaptor, Humanoid, NPCManager, FireHazard
├── systems/                # Physics, Particles, Water, Traffic, Pedestrians, Vehicles, Race, Mystery, Fling, Audio, RoadAgent
├── state/gameStore.ts      # modes, resources, objectives, dialogue, save
└── ui/                     # HUD, Minimap, DialogueBox, PremonitionModal, UpgradeBench, TouchControls
```

---

## 3. Characters

| Character | Before phases 5–10 | Now (built) |
| --- | --- | --- |
| **The Professor** | Walks, runs (tap Shift), swims, jumps 2 m, rides the Raptor, takes cars/bikes/motorbikes, parachutes. | 36 years old; punch/kick combos, 5 Lab Guns, skydive pose. |
| **Mecha Raptor** | Walk, Flight, Race, Boat modes; water gun; follows, can be called, stolen or lured to the attic. | Hulkbuster Giant Mode; flies alongside when the Professor sails a boat. |
| **Grandma** | Bakes cookies, gives Premonitions when the Raptor is missing. | Becomes the Professor's mother (he calls her "Grandma" because his sons do); daily routine. |
| **Leo & Mia** | Grandchildren in Grandma's yard with hints. | Replaced by the Professor's **two sons (9 and 11)** with routines and mini-games. |
| **Prof's Wife** | — | Wears a goofy Godzilla costume, stomps around town, roars at pedestrians, cheers on the Raptor. |
| **Town NPCs** | ~40 pedestrians, 18 traffic cars, 3 rival racers, thieves. | Named shopkeepers, train conductor, police chief with time-of-day routines. |

- **Art style:** stylised low-poly humans with natural proportions (no minifigure cylinder heads or claw hands).
- **Dialogue portraits:** 2D portrait frame per named NPC (placeholder images first).

---

## 4. Current Game (as built)

- **Steering (LEGO-style only):** move relative to the screen; the water gun auto-locks onto the nearest fire or thief in front of you; hold right-click (or K) to aim freely. Race mode and vehicles steer like cars.
- **Running:** tap Shift once to run (Borderlands-style) until you stop, free-aim or tap again.
- **Modes:** `1`–`3` or `Q` cycle Walk/Flight/Race; `V` Race; double-tap Space returns to Walk from Race, and takes off into Flight when in the air. (Boat mode was replaced by real boats in Phase 6.)
- **Jumps:** Professor 2 m, Raptor 6 m, Raptor running jump 12 m. Heavy landings make a shockwave that flings nearby cars and people.
- **Speeds:** Raptor walk 13 / run 22, flight 24 / boost 44, race 42 / boost 66 m/s (see README for the full table).
- **Thruster:** auto-refills after a short pause, overheats when empty until 30 %, 3× more efficient in Race mode. Turbo ramming flings vehicles and pedestrians.
- **Vehicles (GTA-style):** E takes a traffic car (driver runs off), bicycles and motorbikes are parked around town; at most 5 taken cars stay around.
- **Water & Palm Isle:** real sea with a shallow shelf; the Professor swims, vehicles wade; Palm Isle has palms, huts, a lighthouse, piers and the pirate-shack hideout.
- **Sky & space:** sky fades to space above ~300 m with stars and a ringed planet, moon gravity, 900 m ceiling, four floating islands with discovery bonuses. Clouds removed.
- **Calling & following:** `R` calls the Raptor (warps in when stranded far away or in space), `F` toggles follow on foot.
- **Parachute:** getting off high in the air opens it; falling from a space island opens it on re-entry. Sink rate eases with height.
- **Events:** one fire at a time (150 s), one-lap rival races with 8 gates, the missing-Raptor mystery (theft with Grandma's premonition vs. cookie run to the attic).
- **Economy:** Lab Points spent at the Lab upgrade bench (Turbo Thrusters, Bigger Water Tank, Lab Security Alarm, Cookie Dispenser; 3 levels each).
- **Input:** keyboard + mouse, gamepad, on-screen touch controls; `M` music.

---

## 5. Roadmap

Earlier phases 1–4 (sandbox MVP; flight, race and water gun; fires, Grandma, mystery; polish and upgrades) and all the follow-up features in section 4 are done.

### Phase 5 — Controls, Menu & Camera
- [x] **Arrow keys** turn/tilt the camera exactly like the mouse (WASD stays for movement)
- [x] **Camera zoom** in/out (mouse wheel, `+`/`-`, pad) with a one-press **reset** (middle-click / key), clamped per mode
- [x] **Menu** on `Tab` + a Lucide menu icon button in the HUD corner (avoids the Esc / pointer-lock clash): Continue, New Game, Options, Controls
- [x] Move the **key bindings** list from the live HUD into the menu
- [x] **Options:** crowd density (Low / Medium / High / Packed: pedestrians, traffic, boats) and visual quality (Flat, Toon, High with soft shadows + bloom)
- [x] **Install** button: PWA manifest + service worker + `beforeinstallprompt`, with a hint when already installed

### Phase 6 — Fixes & Core Changes
- [x] **Smooth land ↔ space:** replace the altitude culling pop with gradual fog, sky/star blending and fading LOD for the town
- [x] **Solid collisions:** Rapier colliders for traffic, parked vehicles and pedestrians so normal bumps push or stop instead of ghosting (turbo ram and blasts still fling)
- [x] **Meteor fall only for the Raptor:** the Professor falling alone never becomes a blazing meteor
- [x] **Parachute cut:** Space while parachuting drops the canopy into a spread-eagle skydive pose; Space again re-opens it
- [x] **Useful treats:** feed the Raptor for instant thruster refill or a Sugar Rush, throw treats as a lure, keeping it fed prevents attic raids
- [x] **Abduction anywhere:** thieves can take the Raptor wherever it is left behind, not only at the Lab
- [x] **Raptor Boat mode → sea boats:** replace Raptor Boat mode with drivable ambient boats; with Follow on, the Raptor flies alongside
- [x] **See-through cars:** transparent windows, seats and wheel, visible drivers, and the Professor seated visibly while driving

### Phase 7 — Living City
- [x] **Scale pass:** doors ~2.4–2.8 m, storeys ~3.5–4 m, sidewalks and vehicles matched to the Professor (1.75 m) and Raptor
- [x] **4-lane boulevards** for main avenues and the ring road, 2-lane side streets
- [x] **Multi-height districts:** Downtown, Suburbs & Lab, Uptown / Observatory Hill, Harbour & Beach, Park, Palm Isle (hills, slopes, bridges, a tunnel) — extend `Terrain.floorAt` with height layers
- [x] **Vehicle variety:** race car, roadster, bus, fire truck, police car, van, each with its own speed and handling
- [x] **Sea traffic:** AI speedboats, fishing boats, yachts and coastguard around the coast and Palm Isle
- [x] **Family & named NPCs:** wife in the Godzilla costume, two sons, Grandma as the Professor's mother, shopkeepers, with daily routines and 2D portrait dialogue

### Phase 8 — Interiors & Quick Travel
- [x] **Interior switcher:** E at a door → iris wipe into a separate interior scene group, then back to the same spot outside (Raptor waits outside)
- [x] **Landmarks first:** Lab inside + Teleport Hub, Police Station with holding jail, Grandma's house; then seeded interior types (house, shop, café, office) for other buildings
- [x] **Towers:** stairs/elevator to rooftop exits for skydiving
- [x] **Teleport pads** in each district, island and space, plus quick travel from the map

### Phase 9 — Combat, Lab Guns & Giant Mode
- [x] **Melee:** jab → hook → spinning kick → finisher, flying kick / ground slam, sprint dropkick
- [x] **Gadget wheel with 5 Lab Guns:** Size (shrink/normal/big), Teleport-to-Jail (works on weakened thugs), Water, Transform (animal costumes), Megaphone (sonic blast that flings)
- [x] **Hulkbuster Giant Mode:** armour modules fly in and lock onto the Raptor piece by piece
- [x] **Cheats / Extras:** unlimited turbo, unlimited water, bolt magnet, big heads, confetti water

### Phase 10 — Train, Smashables & Sandbox Events
- [x] **City train:** elevated loop with 4–5 stations; board, ride the roof or drive from the cab
- [x] **Smashable props** that drop magnetic bolts, a multiplier bar, **Gold/Red Bricks** and **Super Build** pads (Palm Isle bridge, mega-ramps, space launch pad)
- [x] **More events:** burning buildings, runaway train, meteor crashes, **Moon/Space Base**, optional giant monster encounters for Giant Mode

### Phases 5–10 decisions (as built)
- **Menu keys:** `Tab` or `P`, gamepad Start, the touch Menu button, the HUD menu icon. Releasing the mouse (Esc, switching windows) also opens it. The game pauses behind it with a slow camera flyover. It doubles as the title screen (Play/Continue, New Game asks twice).
- **Shading:** four presets instead of three: Flat (no shadows), Toon (3-step cel ramp, applied by swapping materials), Standard (default), High (4K shadow map, wider shadow area, bloom).
- **Crowds** change live: pedestrians are added or removed out of sight; cars are topped up or dropped out of sight; AI boats are added or removed.
- **Install:** PWA manifest, network-first service worker, `beforeinstallprompt` button; iOS gets a "Share → Add to Home Screen" hint.
- **Land ↔ space:** the hard 400 m cut was replaced by size-based LOD. Each scene object is hidden when it looks tiny from the camera, using render layers so systems' own visibility flags aren't touched. Ground, sea and merged blocks always stay.
- **Collisions:** traffic already had kinematic colliders; people now get shoved aside by the Professor, the Raptor and driven vehicles instead of being walked through.
- **Parachute:** Space cuts it into a skydive (13 m/s glide, 50 m/s fall, so never a meteor); Space again re-opens it. It doesn't auto-open again until you land.
- **Treats:** you carry a cookie stock (starts at 4, Grandma tops up to 8, the café sells 3 for 10 points, shops 1 for 5). Feeding: +40 treats, full thruster, 15 s Sugar Rush.
- **Abduction anywhere:** thieves strike anywhere the Raptor is left; the chance is higher in town than at the alarmed Lab.
- **Boats:** a speedboat at each pier plus AI boats (speedboat, fishing boat, yacht, coastguard) looping Palm Isle and the east channel. With Follow on, the Raptor flies 5 m above and beside your boat.
- **Cars:** one model builder for traffic and taken cars: glass cabin, seats, steering wheel, a seated driver, flashing beacons on police cars and fire trucks.
- **4-lane roads:** the ring road (x and z = ±240) plus the avenues x = −120 and z = 120, 18 m wide. Blocks shrink to fit; some cars take the outer lane; sidewalks move out.
- **Hills:** Uptown is a new 400 × 190 m district joined to the north edge (Observatory Hill 30 m, an east hill 14 m). The avenue x = −120 runs through a cutting and a tunnel. Palm Isle gained a 9 m lighthouse hill, and the town a 3.5 m sunken park. `floorAt(x, z, y)` takes the asker's height so the tunnel works.
- **Grandma's house:** no longer walk-in. Press E at the front door to enter a three-floor interior (ground floor, bedrooms, attic on the 3rd floor). The cookie-run Raptor waits in that attic; waking it rides you out into the yard. Grandma stays on her porch all day instead of following a routine.
- **Family:** Grandma is the Professor's mother; the grandchildren Leo and Mia became his sons Leo (11) and Max (9); his wife Gwen wears the Godzilla suit. Routines walk simple L-shaped sidewalk routes; people "go inside" buildings (hidden), and you meet them in that interior.
- **Interiors:** built on the fly 600 m under the town (the floor rule switches below −300 m) and torn down on leaving. Ceilings don't cast shadows so the sun still lights rooms. The Raptor can only follow you into the Lab hangar (and the Moon Base).
- **Teleport pads:** 8 pads; the Lab hub portals work even for pads you haven't found (and switch them on).
- **Combat:** thugs have 3 health; at 1 they are dazed for 14 s, and only then does the Teleport Gun work (+20 points, +1 jailed). A thug's punch knocks the Professor back and costs 5 bolts.
- **Giant Mode:** visual scale only (the physics capsule stays normal), with the rider scaled back to normal size. You can't switch modes while a Titan.
- **Bricks and cheats:** 10 Gold and 3 Red Bricks. Cheats unlock at 2/4/7 Gold (Turbo/Water/Confetti) and 1/2 Red (Magnet/Big Heads).
- **Train:** a 1.9 km rounded-square loop at 10 m over the ring road; pillars 10 m off every intersection so cross traffic is clear. The 4 cars stop 7 s at each station. People and the Raptor on a roof are carried along by the train's movement each step.
- **Events:** one at a time every 3–5 minutes (meteor, runaway train, Rogue Mech), and not during a mystery, race or while you're indoors. Only Titan hits (and rams or megaphones, weakly) hurt the mech, which has 10 health.

---

## 6. Technical Notes for the Roadmap

- **Interiors:** keep one Three.js scene; build each interior as a `Group` far from the town (or hidden), swap visibility behind a CSS iris wipe, and remember the doorstep position. Seeded interiors use the building's id as the seed.
- **Performance:** keep merging static geometry and using `InstancedMesh` for repeated props, boats and pedestrians; scale crowd density from Options; add `LOD` objects for districts seen from the sky.
- **Height layers:** roads and districts on slopes need `floorAt` to return the right level under bridges and inside tunnels (use the nearest floor below the character).
- **Physics budget:** solid NPC/vehicle collisions should use simple capsule/cuboid colliders and turn off for far-away agents.
- **Install (PWA):** a manifest and small service worker in `public/`; the workflow already deploys `dist/` to raptor.situs.id.
- **Docs:** README stays current with every change; this plan records decisions as each phase lands.
