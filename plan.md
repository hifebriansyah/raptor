# Mecha Raptor — Game Design & Technical Plan

## 1. High Concept

A lighthearted, stylised 3D low-poly open-world sandbox game ("GTA meets cosy backyard sci-fi") built for the web with **Three.js + TypeScript**.

You play as an eccentric **Professor** who built a **Mecha Raptor** in his lab purely for fun. Between flying over rooftops, putting out neighbourhood fires with a mounted water machine gun, transforming into a thruster-boosted race mode to outrun cars, and dealing with thieves—or the Raptor's secret addiction to Grandma's cookies—every day in the neighbourhood brings playful chaos.

### Design Pillars
- **Toybox Joy First:** Switching between walking, flying, racing, and spraying water should feel snappy, expressive, and rewarding.
- **Living Little Neighbourhood:** A compact, readable GTA-style open map where emergent events (fires, street races, lab break-ins) happen naturally around you.
- **Charming Personality:** The Mecha Raptor isn't just a vehicle—it has quirks, parks at the lab, and sneaks off to Grandma's attic when it misses cookies.

---

## 2. Characters & NPCs

| Character | Role | Behaviour & Interactions |
| --- | --- | --- |
| **The Professor** | Playable Protagonist | Walks/runs on foot, mounts/dismounts the Mecha Raptor, parks it in the lab, interacts with NPCs, and investigates clues when the Raptor goes missing. |
| **Mecha Raptor** | Companion & Multi-Mode Mount | Walks/leaps, **Flies**, transforms into **Race Mode** (with thrusters), and fires a **Water Machine Gun**. Has a subtle personality—sometimes wanders off to Grandma's house for cookies. |
| **Grandma** | Mystic Baker & Quest Anchor | Lives in Grandma's House. Gives the Professor a **Premonition** (vision/map clue) whenever the Raptor is stolen, and bakes cookies that accidentally lure the Raptor into her attic. |
| **Grandchildren (Boy & Girl NPCs)** | Neighbourhood Kids | Hang out around Grandma's yard and the neighbourhood. Offer playful dialogue, gossip/hints (e.g., *"I heard metallic crunching upstairs!"* or *"A shady van sped past the lab!"*), and optional mini-challenges. |
| **Lab Thieves** | Antagonists | Periodically attempt to break into the Professor's Lab when the Raptor is parked (especially while the Professor is away). If successful, they stash the Raptor at a random hideout on the map. |
| **Traffic / Rival Drivers** | Ambient & Race NPCs | Drive along neighbourhood roads; certain sporty cars trigger spontaneous or checkpoint street races when approached in Race Mode. |

---

## 3. Open-World Map & Landmarks (GTA-Style Layout)

A compact, dense low-poly island/town (~600m × 600m) designed for fast traversal on foot, by car-mode, and in the air:

1. **The Professor's Lab (Home Base)**
   - **Parking Bay:** Designated pad to park, repair, and recharge water/thruster fuel.
   - **Security Vulnerability:** Thieves can pick the lock or smash in if you leave the Raptor unattended for too long (future upgrade: alarms/locks).
2. **Grandma's House & Attic**
   - **Downstairs / Porch:** Where Grandma, the Boy NPC, and the Girl NPC hang out. Trigger dialogue for **Premonitions** and hints.
   - **The Attic:** Accessible via stairs/ladder or roof hatch—where the Mecha Raptor hides when it sneaks off for **Grandma's cookies**.
3. **Suburban Neighbourhood & Town Centre**
   - Houses, shops, parks, and alleys where **dynamic fire events** break out.
   - Water hydrants / fountains / riverfront for quick water refills.
4. **Ring Road & Coastal Race Loop**
   - Wide roads, ramps, and shortcuts tailored for **Race Mode + Thrusters** and high-speed chases against rival cars.
5. **Thief Hideouts (3–5 Rotating Spots)**
   - Abandoned warehouse, dockyard, junkyard, forest clearing—used as destinations when the Raptor is stolen.

---

## 4. Core Gameplay Systems

### 4.1 Professor & Lab Parking Loop
- **On-Foot Controls:** Move, jump, interact (`E` / `F`), mount/dismount Mecha Raptor.
- **Parking at the Lab:** Walking or riding onto the Lab pad parks the Raptor cleanly, refills water & thruster energy, and marks the Raptor as "Parked at Lab".
- **On-Foot Exploration:** Even without the Raptor, the Professor can sprint, use a lab scooter/bicycle (optional fallback for getting to Grandma's), and talk to NPCs.

### 4.2 Mecha Raptor Modes & Abilities
Seamless mode switching with distinct silhouettes, animations, and camera feel:

1. **Raptor Walk / Agile Mode (Default)**
   - Fast bipedal sprint, high jump, tight turning in alleys.
2. **Flight Mode**
   - Spreads mechanical wings/hover-jets to take off from anywhere.
   - Smooth 3D arcade flight (pitch/yaw/boost, hover to aim water).
   - Ideal for spotting smoke plumes across the open map and reaching rooftops or Grandma's attic window.
3. **Race Mode + Thruster**
   - Raptor folds into a sleek low-slung mecha-car / cyber-racer chassis.
   - High top speed, drifting around corners, and **Thruster Boost** (flame/plasma burst with recharge bar) to beat rival cars and hit stunt ramps.
4. **Water Machine Gun (Firefighting)**
   - Available in Walk and Flight (hover-strafe) modes.
   - Rapid-fire pressurised water stream/projectiles with splash particles.
   - Extinguishes fire nodes by reducing each fire's intensity meter to zero.

### 4.3 Dynamic World Events

#### A. Neighbourhood Fires
- **Trigger:** Periodic timer + random selection from neighbourhood buildings, bins, or park areas.
- **Feedback:** Tall smoke column visible from across the map + minimap icon + optional alert from the kids/radio.
- **Resolution:** Fly or race to the scene and douse all fire hotspots with the Water Machine Gun before the timer expires to earn Lab Points / Cookie Tokens.

#### B. Missing Raptor Mystery (Two Distinct Branches)
When the Raptor is parked at the Lab (or left unattended) and goes missing, the HUD alerts the Professor: *"Mecha Raptor is missing from the Lab!"* — creating a fun detective twist because **you don't immediately know if it was stolen or went for cookies**:

1. **Branch 1: Stolen by Thieves**
   - **Trigger:** Thieves break into the Lab (leaving footprints/broken lock clues).
   - **Loop:**
     1. Visit **Grandma's House** and talk to Grandma.
     2. Grandma enters a quirky **Premonition** cutscene/overlay (crystal ball / tea leaves / glowing minimap vision) revealing the **hideout zone** where the thieves took your Raptor.
     3. Travel to the hideout, outwit or splash the thieves with a handheld water blaster/distraction (or sneak in), and reclaim the Mecha Raptor.
2. **Branch 2: Cookie Craving (False Alarm!)**
   - **Trigger:** Occurs occasionally when the Raptor hasn't had treats in a while (no broken lock at the Lab—maybe cookie crumbs instead!).
   - **Loop:**
     1. Check Grandma's House; the **Boy & Girl NPCs** drop playful hints (*"Did you check upstairs?"* / *"Grandma's cookie jar is empty again!"*).
     2. Climb up to **Grandma's Attic** to find the Mecha Raptor happily surrounded by cookie crumbs.
     3. Mount up and head back out (with a temporary "Sugar Rush" speed/happy buff!).

---

## 5. Technical Architecture (Three.js + TypeScript)

### 5.1 Recommended Tech Stack
- **Build & Tooling:** Vite + TypeScript (strict mode)
- **3D Rendering:** `three` (Three.js) with stylised flat-shaded/low-poly materials, directional sun shadows, and hemisphere lighting
- **Physics & Collisions:** `rapier3d-compat` (fast WASM 3D physics for character controllers, car/race mode, projectiles, and triggers) or lightweight custom AABB/capsule + raycast controller for simpler arcade tuning
- **State & UI Overlay:** Lightweight React or vanilla DOM/CSS HUD + `zustand` for reactive game state (current mode, water tank, thruster fuel, minimap markers, mission state, dialogue box)
- **Audio:** Web Audio API + spatialised procedural/sample SFX (thrusters, water spray, alarms, footsteps, crunching cookies)

### 5.2 Proposed Directory Structure
```text
raptor/
├── index.html
├── package.json
├── tsconfig.json
├── public/
│   └── models/                  # Optional .glb low-poly assets (or procedural geometry first)
└── src/
    ├── main.ts                  # Entry point & render loop
    ├── game/
    │   ├── GameEngine.ts        # Scene, renderer, camera, fixed-timestep loop
    │   ├── InputManager.ts      # Keyboard/mouse bindings & mode-aware actions
    │   ├── WorldMap.ts          # Roads, buildings, Lab, Grandma's House + Attic, hideouts
    │   └── EventDirector.ts     # Schedules fires, lab break-ins, cookie escapes, races
    ├── entities/
    │   ├── Professor.ts         # On-foot controller & interaction sensor
    │   ├── MechaRaptor.ts       # State machine: Walk / Flight / Race + Water Gun
    │   ├── NPCManager.ts        # Grandma, Boy & Girl NPCs, Thieves, Traffic/Rival Cars
    │   └── FireHazard.ts        # Fire particles, smoke beacon, extinguish progress
    ├── systems/
    │   ├── PhysicsSystem.ts     # Collision, ground/flight queries, trigger zones
    │   ├── PremonitionSystem.ts # Vision shader/overlay + thief hideout reveal
    │   └── AudioSystem.ts       # SFX & ambient audio
    ├── state/
    │   └── gameStore.ts         # HUD, mission state, Raptor status (parked/stolen/attic)
    └── ui/
        ├── HUD.tsx              # Minimap, water/thruster gauges, mode indicator
        ├── DialogueBox.tsx      # Grandma & grandchildren conversations
        └── PremonitionModal.tsx # Visual clue screen when Grandma gives a premonition
```

### 5.3 Key Technical Notes
- **GTA-Style Minimap:** Render either a lightweight second orthographic top-down camera to a corner viewport/canvas or a crisp 2D canvas minimap synced to world `(x, z)` coordinates showing roads, Lab, Grandma's House, active fires, and Grandma's premonition zone.
- **Grandma's Attic Access:** Keep Grandma's House enterable seamlessly (fade roof/upper wall when inside, or include an exterior attic hatch/ramp so Flight Mode can also peek in) to avoid disruptive loading screens.
- **Procedural Placeholder Art First:** Build the Professor, Mecha Raptor (with articulated legs, wings, wheels, and water turret), buildings, and cars out of Three.js primitive groups first so gameplay feels great before investing in custom `.glb` models.

---

## 6. Phased Development Roadmap

### Phase 1 — Playable Sandbox MVP
- [x] Initialise Vite + TypeScript + Three.js project and basic HUD shell.
- [x] Build low-poly starter map (Professor's Lab pad, roads, Grandma's House exterior + attic room, a few blocks).
- [x] Implement Professor on-foot controller and Mount/Dismount flow.
- [x] Implement Mecha Raptor **Walk Mode** and **Lab Parking** trigger.
- [x] Add follow camera + basic GTA-style 2D minimap.

**Phase 1 decisions (as built):**
- Physics: **Rapier** (`@dimforge/rapier3d-compat`) with its kinematic character controller for both the Professor and the Raptor.
- HUD: **vanilla DOM + `zustand/vanilla`** and **Lucide** icons (no React yet), so `src/ui/*.ts`, not `.tsx`.
- Parking: getting off while standing on the Lab pad parks the Raptor (snaps it to the pad, refills water + thruster). Getting off anywhere else leaves it "idle in town".
- Grandma's house: walk-in door, stairs to the attic, a big east attic window (meant for the Phase 3 flight entry). Walls and roof fade while the Professor is inside.
- Map: 9×9 road grid, fixed seed so the layout is the same every load, invisible walls at ±282 m.
- Dev server: `npm run dev` on port 5195 (also the `raptor` entry in `for-fun/.claude/launch.json`).

### Phase 2 — Flight, Race Mode & Water Machine Gun
- [x] Implement **Flight Mode** (takeoff, 3D air steering, hover, landing).
- [x] Implement **Race Mode** (chassis transformation, drift/arcade car physics, **Thruster** boost + energy bar).
- [x] Implement **Water Machine Gun** (aiming reticle, water projectile stream, splash VFX, tank refill at Lab/hydrants).
- [x] Add rival AI cars on the ring road for spontaneous races.

### Phase 3 — Open-World Events, Grandma & NPCs
- [x] Implement **Neighbourhood Fire System** (random fire spawns, smoke beacons, extinguishing progress, rewards).
- [x] Implement **Grandma, Boy & Girl NPCs** with proximity dialogue prompts and stateful lines.
- [x] Implement **Lab Break-In & Theft System** (thief spawn, Raptor relocation to a hideout, Lab clues).
- [x] Implement **Grandma's Premonition** visual clue & minimap ping + Thief hideout recovery sequence.
- [x] Implement **Cookie Craving Mystery** (Raptor sneaks to **Grandma's Attic**, kids drop hints, attic discovery).

### Phase 4 — Polish, Juice & Replayability
- [x] Distinct animations/transformations for Walk ↔ Flight ↔ Race modes.
- [x] Sound effects & upbeat synth/adventure music.
- [x] Lab upgrade bench (faster thrusters, larger water tank, Lab security alarm, cookie dispenser).
- [x] Performance pass (instanced trees/buildings, particle pooling) and mobile/gamepad support if desired.

---

### Phases 2–4 decisions (as built)
- **Steering (LEGO-style only):** move with the screen; the water gun auto-locks onto the nearest fire or thief in front of you (never passers-by); hold right-click to aim freely. Race mode and vehicles steer like cars (A/D). A tank-style option was tried and removed at the user's request.
- **Running:** tap Shift once to run (Borderlands-style); it lasts until you stop moving, free-aim, or tap again.
- **Vehicles (GTA-style):** walk up to a traffic car and press E to take it (the driver jumps out and runs off); bicycles and motorbikes are parked around town (one of each by the Lab, a bicycle at Grandma's). E gets out and leaves the vehicle where it is; at most 5 taken cars stay around, and traffic is topped back up out of sight. You can challenge rivals to races in a car.
- **Double jump:** press Space again in mid-air in Walk mode to take off into Flight.
- **Jumps:** Professor 2 m, Raptor 6 m, Raptor running jump 12 m.
- **Water and Palm Isle:** the sea is real now (shallow shelf, 2.8 m deep): the Professor swims, the Raptor and vehicles wade slowly. Palm Isle sits east of the main island (palms, huts, lighthouse, piers, a pirate-shack thief hideout). The Raptor gained a 4th mode, **Boat** (key 4), a jet-boat for crossing the sea.
- **Thruster:** auto-refills after a short pause; emptying it overheats it until 30 %.
- **Controls:** `1/2/3` or `Q` switch Walk/Flight/Race; click (or `J`) sprays; Space climbs in flight and drifts in race; `Ctrl`/`C` descends; Shift runs/boosts (boost uses thruster energy). Gamepad and on-screen touch controls are supported.
- **Water:** the Raptor's tank refills at red hydrants on intersection corners, park fountains and the Lab pad. On foot the Professor has a weak handheld blaster that never runs dry (used on thieves, and for splashing passers-by).
- **Living town:** ambient cars drive the road grid and brake/honk for obstacles; ~40 pedestrians walk the sidewalks, wave at the Professor, scatter from a charging Raptor and shake off water. (Added on request.)
- **Races:** three rivals (Blaze, Volt, Nitro Nana) cruise the ring road; challenge one in Race mode for a one-lap, 8-gate race with rubber-banding. Four stunt ramps sit just outside the ring road.
- **Fires:** one at a time, roughly every 1–2 minutes, on a building 60–260 m away; 150 s to spray out every hotspot.
- **Mystery:** only when the Raptor is left alone and the Professor is 70 m+ away. Low treats → likely a cookie run (attic); otherwise a chance of theft (Lab alarm upgrade lowers it). Clues differ (footprints + snapped lock vs. crumbs), Grandma's crystal ball confirms which, and her premonition marks a zone (not the exact spot) on the minimap.
- **Economy:** one currency, Lab Points (fires, races, rescues, cookie runs), spent at the upgrade bench beside the Lab garage: Turbo Thrusters, Bigger Water Tank, Lab Security Alarm, Cookie Dispenser (3 levels each). Points, upgrades and audio settings are saved in the browser.
- **Audio:** all procedural Web Audio (no files): effects, loops (spray, thrusters, engine, wind, fire crackle) and a looping chiptune; `M` toggles music.
- **Section 7 answers:** no fallback scooter (sprinting is fast enough); the alarm reduces thefts but never removes them; the Raptor sniffs around a few metres when left idle in town.

## 7. Ideas & Things to Decide Next
- **Fallback Transport:** When the Raptor is stolen or in Grandma's attic, should the Professor have a small jet-scooter or just sprint/take shortcuts so getting to Grandma's House stays fun?
- **Theft Prevention vs. Chaos:** Should installing a Lab Alarm later reduce thefts, or keep a manual "bait/guard" toggle so players can still trigger the Premonition quest whenever they want?
- **Raptor Autonomy:** When you leave the Raptor parked outside the Lab, should it occasionally wander a few metres to sniff flowers or chase birds for extra charm?
