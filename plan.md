# Mecha Raptor — Next-Gen Master Plan (Godot 4 / LEGO City–Style Open World)

> **Premise & Core DNA:** Rebuild and expand the Three.js prototype into a full **Godot 4** open-world sandbox modelled after **LEGO City Undercover**—bright, colourful toy-brick city architecture, multi-height districts, elevated train, roaming vehicles & boats, Super Builds, and enterable buildings—while keeping the prototype's signature ability to fly all the way up into **Space**. You are an **eccentric 36-year-old Professor** having fun in town with his homemade **Mecha Raptor**—putting out fires, fighting thugs and zapping them to jail with a Teleport Gun, riding trains, and exploring buildings whenever you feel like it.

---

## 1. Engine Shift: Moving to Godot 4

- **Why Godot 4:** Replaces the Three.js + Rapier prototype for smoother streaming/LOD transitions (land-to-space without culling pops), native multi-scene/sub-scene loading for enterable buildings, sculpted multi-height terrain, built-in `CharacterBody3D` / `VehicleBody3D` / Jolt physics, `AnimationTree` (combo combat, freefall pose, Hulkbuster assembly), and clean 2D UI + dialogue portrait support.
- **Prototype Reference:** The current Three.js codebase (`src/`) serves as the playable prototype & gameplay reference for tuning speeds, modes, fires, races, and events.

---

## 2. Characters, Lore & Routines

| Character | Updated Lore | Behaviour & Routine |
| --- | --- | --- |
| **The Professor** | **36 years old** — energetic young inventor & eccentric dad just having fun with his creations. | Walks, sprints, punches/kicks in combos, uses 5 Lab Guns, skydives, drives/rides vehicles & boats, mounts the Raptor. |
| **Prof's Wife** | Playful partner who **loves wearing a goofy Godzilla costume** (like the LEGO T-Rex mascot suit, face peeking out the dino mouth). | Stomps cheerfully around town/park/Lab on her daily routine, playfully roars at pedestrians, cheers on the Raptor (and becomes a hilarious giant kaiju if zapped with the Big Gun!). |
| **Mecha Raptor** | Homemade multi-mode companion (`Walk`, `Flight`, `Race`, plus **Hulkbuster Giant Mode** — *Boat mode removed*). | Sniffs around when idle, follows on foot or **flies alongside when you ride a sea boat**, can be abducted **anywhere** if left behind. |
| **Two Sons (Ages 9 & 11)** | The Professor's two energetic kids (replacing the old "grandchildren" lore). | Follow daily routines (school/park/arcade/Grandma's yard), drop gossip/clues, and challenge you to mini-games. |
| **Grandma (Prof's Mother)** | Actually the **Professor's mother**—he calls her "Grandma" out of habit because his 9- and 11-year-old sons call her Grandma. | Daily routine (kitchen/porch/market/garden); bakes cookies/treats, gives **Premonitions** when the Raptor goes missing. |
| **Named Town NPCs** | Shopkeepers, Train Conductor, Rival Racers, Police Chief, etc. | Follow time-of-day routines (home → work → park/café). |

- **Character & NPC Art Style (No Minifigures):** Characters and NPCs do **not** use LEGO minifigure proportions (no cylinder heads, claw hands, or stiff brick legs). Instead, they use a clean **stylized low-poly human look** with natural proportions and articulated joints (head, torso, arms, hands, legs, feet, hair, coats/costumes) so punch/kick combos, skydiving, sitting in cars, and the Wife's Godzilla mascot suit animate fluidly.
- **2D Dialogue Portraits:** Every named NPC interaction displays a **2D character portrait frame** (using placeholder images now, ready to swap in custom 2D art later).

---

## 3. Prototype Bugs & Core Changes to Fix

Every known issue from the Three.js build is addressed directly in the Godot design:

1. **Smooth Land ↔ Space Transition:** Replace the hard 190 m / 400 m altitude culling pop with continuous atmospheric sky/star shader blending, gradual distance fog, and smooth Godot LOD / impostors for the city below.
2. **Real Raptor ↔ Vehicle & NPC Collisions:** Raptor, traffic vehicles, and NPCs have proper solid collision layers—normal bumps push, stop, or knock cleanly instead of ghosting through each other (while Turbo Ram / Megaphone Gun still fling them).
3. **Meaningful Treats / Cookies:** Give treats real gameplay purpose—feed the Raptor for instant thruster/stamina refill, on-demand **Sugar Rush**, healing/happiness, or toss treats as a distraction/lure (and keeping treats stocked prevents attic cookie raids).
4. **Meteor Fall = Raptor Only:** The Professor falling alone **never** triggers a blazing meteor fall. Only the **Mecha Raptor** (solo or with Professor riding) builds up into a fiery meteor impact.
5. **Parachute Cancel & LEGO 2 Skydive Pose:** Pressing `Space` while parachuting **removes/detaches the parachute** and switches the Professor into a **LEGO Marvel 2–style spread-eagle freefall pose** (press `Space` again to re-deploy before landing).
6. **Abduction Anywhere:** Thieves can snatch the Mecha Raptor **anywhere you leave it behind** around the world—not only when parked at the Lab.
7. **Proper Building-to-Character Scale:** Re-proportion doorways (~2.4–2.8 m), storey heights (~3.5–4 m), sidewalks, vehicles, and towers to match the Professor (1.75 m) and Mecha Raptor naturally.
8. **4-Lane Boulevards & 2-Lane Streets:** Keep residential/side roads at 2 lanes and widen main city avenues / ring highway stretches into **4-lane roads**.
9. **Remove Raptor Boat Mode + Fly-Along Support:** Remove `Boat` mode from the Mecha Raptor. Instead, **ambient boats roam the sea** (boardable/drivable like GTA vehicles), and if Follow (`F`) is active while the Professor sails a boat, the Raptor **follows in Flight mode**.
10. **Transparent Car Glass & Visible Drivers:** Replace opaque car cabs/windows with **transparent windshields & side windows**, an interior seat/steering wheel, and a **visible driver** inside (traffic NPCs sit inside their cars, and the **Professor is visibly seated inside** while driving instead of hidden).
11. **Camera Zoom In / Out / Reset:** Smoothly zoom the third-person camera closer or further away (mouse wheel / `+` `-` or pad bindings, clamped cleanly indoors vs. outdoors vs. Hulkbuster Giant Mode), plus a one-press **Reset Camera Zoom** button (e.g. middle-click / dedicated key).

---

## 4. World Structure & Core Pillars

1. **LEGO City–Style Main Menu, World Design & Settings:** Bright, colourful LEGO City–inspired world & level design (vibrant modular buildings, clear district landmarks, interactive build pads) paired with stylized non-minifigure characters, a live 3D flyover of the living city + **New Game**, **Continue**, **Options** (**Crowdness / Population Density** — Low / Medium / High / Packed scaling pedestrians, road traffic & sea boats — plus **Shading / Visual Quality** presets: Flat Low-Poly, Toon/Cel, and High with soft shadows, SSAO & glow), and **Extras / Cheats**.
2. **Multi-Height LEGO City Districts:** Sculpted hills, stepped city districts (*Downtown*, *Suburbs & Lab*, *Uptown / Observatory Hill*, *Harbour & Beach*, *Park*, and *Palm Isle*), coastal cliffs, sunken park basin, and a raised lighthouse hill—connected by sloped 2-lane/4-lane roads, bridges, tunnels, and viaducts.
3. **Every Building Is Enterable (Separate Scene/Map Loads):**
   - Walk up to any door (suburban houses, downtown towers, cafés, shops, banks, Police Station Holding Jail, Lab, train stations, lighthouse, pirate shack) and press `E` to iris-wipe load into an isolated Godot interior scene, then return to your exact exterior spot (with Raptor waiting outside, or inside huge hangar/hub interiors).
   - Tall towers feature internal elevators/stairs with **rooftop exits** for skydiving and Gold Bricks.
   - **Two Tiers:** Handcrafted landmarks (Lab + Teleport Hub, Police Station Jail showing captured thugs, Bank Vault, Lighthouse, Space/Moon Base) + deterministic seeded interior archetypes for every town building.
4. **LEGO City Train & Stations:** Elevated viaduct loop circling the city (plus optional Palm Isle sea rail bridge Super Build) with 4–5 enterable stations and a live multi-car train you can board, ride on the roof, drive from the cab, or defend from thugs.
5. **Quick Travel & Teleport Hub:**
   - Physical **Teleport Hub** wing in the Lab with glowing portals to every district/island (Town, Downtown, Uptown Hill, Palm Isle, Cloud Isle, Space Base) plus a 100% progress & Extras wall.
   - Discoverable **Teleport Pads** across districts, islands, and orbit for instant map quick-travel.
6. **Sky & Space Layer (Above the City):** Keep the prototype's signature vertical flight up past Cloud Isle into the 300 m+ Space zone (moon gravity, stars, ringed planet, floating space islands, and an enterable **Moon/Space Base**).

---

## 5. Gameplay, Vehicles, Combat & Toys

### A. Giant Mode ("Hulkbuster" Drop-Pod Assembly)
- No sudden scale-up pop: activating **Giant Mode** calls down oversized **armour & mech modules** from the sky/Lab (chest rig, heavy gauntlets, leg boosters, back cannons) that fly in and **lock/combine onto the Mecha Raptor** piece by piece into a **Hulkbuster-style Titan Mecha Raptor**—built for smashing heavy barriers, tossing trucks, and brawling giant monsters.

### B. Professor Melee Combo & 5 Eccentric Lab Guns
- **Punch & Kick Combo:** 3–4 hit ground chain (*Jab → Hook → Spinning Kick → Knockback Finisher*), mid-air **Flying Kick / Ground Slam**, and sprint **Dropkick / Shoulder Bash** to shatter props and stun thugs.
- **The 5 Lab Guns (On-Foot Gadget Wheel):**
  1. **Shrink / Normal / Big Gun:** Cycles targets between tiny, normal, and giant (NPCs, vehicles, props, blockers, or giant monsters).
  2. **Teleport Gun:** Healthy thugs evade it effortlessly; beat a thug to **low health** first, then zap them straight into the **Police Station Holding Jail** (where you can visit them behind bars!).
  3. **Water Gun:** Puts out small fires, splashes NPCs, cools hazards, waters plants, and shorts out bots.
  4. **Transform Gun (Animal Costume Ray):** Turns NPCs or thugs into goofy **animal costumes** (chicken, frog, mini-dino, penguin, duck) flapping/hopping around in panic.
  5. **Megaphone Gun (Sonic Blast):** Launches vehicles, bikes, NPCs, thugs, and loose props flying through the air.

### C. Expanded Vehicles & Roaming Boats
- **Road Variety & Visible Interiors:** Sedans, **race cars**, **roadsters**, **city buses**, **fire trucks**, police cruisers, vans, motorbikes, and bicycles—all with distinct speed, mass, and handling, plus **transparent glass windows** so you can see the AI driver or the **Professor** seated at the wheel.
- **Sea Traffic:** Roaming **AI boats** (speedboats, fishing boats, yachts, coastguard) cruising around the town coast and Palm Isle—swim or fly up and board/take them over, while the Raptor flies beside you if Follow is on.
- **Vehicle Call-In Pads:** Unlockable rides summoned via Vehicle Tokens at roadside/harbour pads.

### D. Smashable World, Collectibles & Cheats
- **Destructible Props & Bolts/Studs:** Indoors and outdoors shatter into magnetic Bolts with a Hero/Multiplier bar.
- **Gold Bricks, Red/Pink Bricks & Super Builds:** Unlock **Cheat Mode** toggles (**Unlimited Turbo**, **Unlimited Water**, Bolt Magnet, Big Head, Confetti Water, etc.) plus permanent Super Builds (Palm Isle bridge, mega-ramps, Space launch pad).
- **Optional Sandbox Scenarios:** Burning buildings, rival races, Raptor abductions anywhere, runaway train events, meteor crashes, and optional **Giant Monster / Rogue Mech** encounters (great excuse to deploy Hulkbuster Giant Mode!).

---

## 6. Godot 4 Phased Roadmap

### Phase 1 — Godot Core, Scale, Terrain & Menu Foundation
- [x] Set up Godot 4 project structure, input actions (keyboard/mouse/gamepad/touch), and **LEGO City–style 3D Main Menu** + **Options** (including **Shading** presets & graphics settings)
- [x] Build **multi-height sculpted terrain** (hills, terraces, 2-lane & 4-lane roads, bridges, Palm Isle hill) with **proper character-to-building scale**
- [x] Implement **Professor** (36 yo model, walk/sprint, parachute + `Space`-to-cut **LEGO 2 skydive pose**) and **Mecha Raptor** (`Walk`, `Flight`, `Race` — no Boat mode, meteor fall **only** on Raptor, real vehicle/NPC collisions) + **Camera Zoom In / Out / Reset**
- [x] Smooth **Land ↔ Space** sky/fog/LOD transition + Cloud Isle & Space islands

### Phase 2 — Living City, Boats, Routines & Enterable Interiors
- [x] Add **road vehicle variety** (race car, roadster, bus, fire truck, police car, bikes) with **transparent glass & visible drivers** + **roaming sea boats** (with Raptor fly-along follow) + **Crowdness** density setting (pedestrians, traffic & boats)
- [x] Add **named NPC daily routines** (Prof's wife in her Godzilla costume, two sons ages 9 & 11, Prof's mother "Grandma", citizens) + **2D portrait placeholder dialogue UI**
- [ ] Build Godot **Interior Scene Switcher** (iris wipe, doorstep & tower rooftop exits) + door triggers on every building
- [ ] Build **Lab Inside**, **Teleport Hub**, **Police Station Holding Jail**, and initial seeded building archetypes
- [ ] Implement **District Teleport Pads** + Map Quick-Travel

### Phase 3 — Combat, 5 Lab Guns, Hulkbuster Giant Mode & Abductions
- [ ] Implement Professor **punch & kick combo** + **5-Gun Gadget Wheel** (Size, Teleport-to-Jail, Water, Transform Costume, Megaphone)
- [ ] Implement **Hulkbuster Giant Mode** (flying drop-pod armour parts combining onto the Mecha Raptor)
- [ ] Rework **Treats** (useful buffs/lures/prevent raids) and **Raptor abduction anywhere** when left behind
- [ ] Add **Cheat Mode / Extras** menu (**Unlimited Turbo**, **Unlimited Water**, mutators)

### Phase 4 — LEGO City Train, Smashables & Sandbox Events
- [ ] Build elevated rail viaduct, **enterable Train Stations**, and live multi-car drivable **City Train**
- [ ] Add destructible props + magnetic **Bolts/Studs**, **Gold/Red Bricks**, and **Super Build** pads
- [ ] Port/expand **fires**, **rival races**, **Space Moon Base**, and optional **Giant Monster / Kaiju** encounters
