import * as THREE from 'three';
import { MAX_FALL } from '../entities/CharacterEntity';
import { MechaRaptor, RAPTOR_MODES, type RaptorMode } from '../entities/MechaRaptor';
import { NPCManager, type NpcId } from '../entities/NPCManager';
import { Professor } from '../entities/Professor';
import { CHEAT_COST, CROWD_COUNTS, addPoints, brickCount, gameStore, showToast, type CheatId, type ControlMode } from '../state/gameStore';
import { AudioSystem } from '../systems/AudioSystem';
import { FlingSystem } from '../systems/FlingSystem';
import { GRANDMA_ATTIC_SPOT, InteriorSystem, type InteriorDef, type InteriorKind } from '../systems/InteriorSystem';
import { MiniGames } from '../systems/MiniGames';
import { TeleportSystem } from '../systems/TeleportSystem';
import { GadgetSystem } from '../systems/GadgetSystem';
import { Collectibles } from '../systems/Collectibles';
import { SandboxEvents } from '../systems/SandboxEvents';
import { TrainSystem, RAIL_Y } from '../systems/TrainSystem';
import { ThugSystem } from '../systems/ThugSystem';
import { GiantMode } from '../systems/GiantMode';
import { Humanoid } from '../entities/Humanoid';
import { Gem } from 'lucide';
import { IrisWipe } from '../ui/IrisWipe';
import { TravelMap } from '../ui/TravelMap';
import type { BuildingDoor, SpecialDoor } from './WorldMap';
import { MysterySystem } from '../systems/MysterySystem';
import { Particles } from '../systems/ParticleSystem';
import { PedestrianSystem } from '../systems/PedestrianSystem';
import { PhysicsSystem } from '../systems/PhysicsSystem';
import { RaceSystem } from '../systems/RaceSystem';
import { TrafficSystem } from '../systems/TrafficSystem';
import { TreatSystem } from '../systems/TreatSystem';
import { Vehicle, VehicleSystem } from '../systems/VehicleSystem';
import { WaterSystem, type WaterTarget } from '../systems/WaterSystem';
import { DialogueBox, DialogueController } from '../ui/DialogueBox';
import { HUD } from '../ui/HUD';
import { PremonitionModal } from '../ui/PremonitionModal';
import { TouchControls } from '../ui/TouchControls';
import { UPGRADES, UpgradeBench, buyUpgrade } from '../ui/UpgradeBench';
import { Minimap, type MinimapMarker } from '../ui/Minimap';
import { Menu } from '../ui/Menu';
import { Graphics } from './Graphics';
import { Models } from './Models';
import { CameraRig } from './CameraRig';
import { EventDirector } from './EventDirector';
import { SkyIslands } from './SkyIslands';
import { InputManager } from './InputManager';
import { SPACE_Y, WATER_Y, floorAt, isLand, surfaceAt } from './Terrain';
import { WorldMap } from './WorldMap';

const STEP = 1 / 60;
/** How close (m, feet to feet) the Professor must be to hop on. */
const MOUNT_RANGE = 3.4;
const REFILL_RANGE = 5.5;

/** Something the Professor can do right now with E; the closest one wins the prompt. */
export interface Interaction {
  prompt: string;
  /** Lower wins. */
  priority: number;
  run(): void;
}

const MODE_CONTROL: Record<RaptorMode, ControlMode> = { walk: 'raptorWalk', flight: 'raptorFlight', race: 'raptorRace' };

/** Falling faster than this (m/s) starts to burn. */
const METEOR_FROM = 55;

/**
 * Owns the scene, the fixed-timestep simulation loop and the gameplay rules that tie the systems
 * together: mounting/parking, mode switching, the water gun, refilling and interactions.
 */
export class GameEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  private readonly sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  readonly rig = new CameraRig(this.camera);
  readonly input: InputManager;
  readonly world: WorldMap;
  readonly professor: Professor;
  readonly raptor: MechaRaptor;
  readonly particles: Particles;
  readonly water: WaterSystem;
  readonly traffic: TrafficSystem;
  readonly pedestrians: PedestrianSystem;
  readonly race: RaceSystem;
  readonly vehicles: VehicleSystem;
  /** Throws cars, bikes and people around (turbo ram, landing blasts). */
  readonly fling: FlingSystem;
  readonly treats: TreatSystem;
  /** The car/bike/motorbike the Professor is driving, if any. */
  vehicle: Vehicle | null = null;
  readonly director: EventDirector;
  readonly sky: SkyIslands;
  private inSpace = false;
  readonly npcs: NPCManager;
  readonly dialogue = new DialogueController();
  readonly mystery: MysterySystem;
  readonly minigames: MiniGames;
  readonly thugs: ThugSystem;
  readonly gadgets: GadgetSystem;
  readonly giant: GiantMode;
  readonly train: TrainSystem;
  collectibles!: Collectibles;
  events!: SandboxEvents;
  /** Riding the city train (as a passenger, or driving from the cab). */
  trainRide: { car: number; cab: boolean } | null = null;
  /** Later systems (smashables) react to punches and blasts. */
  onMeleeHit: ((pos: THREE.Vector3, radius: number, power: number) => void) | null = null;
  /** …and to gun bolts (returns true if the bolt hit something of theirs). */
  onBoltHit: ((gun: import('../state/gameStore').GunId, pos: THREE.Vector3) => boolean) | null = null;
  private talkingTo: NpcId | null = null;
  readonly audio = new AudioSystem();
  private readonly hud: HUD;
  readonly menu: Menu;
  readonly interiors: InteriorSystem;
  readonly teleports: TeleportSystem;
  private readonly travel: TravelMap;
  readonly iris: IrisWipe;
  /** While indoors: where to come back out (and the room's definition). */
  private outside: { pos: THREE.Vector3; facing: number; def: InteriorDef } | null = null;
  /** The café's front door (Sam's café sells cookies). */
  private cafeDoor: THREE.Vector3 | null = null;
  private telescopeUsed = false;
  private chestOpened = false;
  readonly graphics: Graphics;
  private readonly minimap: Minimap;
  private accumulator = 0;
  private last = performance.now();
  elapsed = 0;
  /** Where the reticle points in the world (updated each frame from the camera). */
  private readonly aimPoint = new THREE.Vector3();
  private emptyWarned = false;
  private lastWetHint = -999;
  /** When Space was last pressed while riding (for double-taps). */
  private lastJumpPress = -1;
  /** Seconds since the thruster last boosted (auto-refill starts after a short pause). */
  private boostPause = 0;
  /** LEGO scheme: what the water gun is locked onto. */
  private lockTarget: WaterTarget | null = null;
  private fxTimer = 0;

  private constructor(
    container: HTMLElement,
    readonly physics: PhysicsSystem,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.append(this.renderer.domElement);
    this.input = new InputManager(this.renderer.domElement);

    this.setupLighting();
    this.world = new WorldMap(this.scene, physics);
    this.train = new TrainSystem(this.scene, physics, this.world.specialDoors);
    this.particles = new Particles(this.scene);
    this.sky = new SkyIslands(this.scene, physics);
    this.water = new WaterSystem(this.scene, physics, this.particles);

    const { labPad, professorSpawn } = this.world.landmarks;
    this.professor = new Professor(physics, professorSpawn);
    this.raptor = new MechaRaptor(physics, new THREE.Vector3(labPad.x, 0, labPad.z));
    this.raptor.teleport(this.padCenterForRaptor(), labPad.facing);
    this.professor.heading = Math.PI;
    this.scene.add(this.professor.group, this.raptor.group);
    this.rig.yaw = 0.5;

    this.traffic = new TrafficSystem(this.scene, physics);
    this.pedestrians = new PedestrianSystem(this.scene, this.water);
    this.race = new RaceSystem(this.scene, this.traffic, (p) => this.pedestrians.cheer(p, 60));
    this.vehicles = new VehicleSystem(this.scene, physics, this.world.landmarks);
    this.fling = new FlingSystem(this.particles);
    this.treats = new TreatSystem(this.scene);
    this.fling.onBounce = (p, hard) => {
      const v = Math.max(0, 1 - p.distanceTo(this.camera.position) / 80);
      if (v > 0 && hard) this.audio.play('stomp', v);
    };

    this.director = new EventDirector(this.scene, this.world, this.water, this.particles);
    this.npcs = new NPCManager(this.scene, this.world.landmarks, this.world.doors, this.world.stationSpot);
    this.npcs.onRoar = (p) => {
      this.pedestrians.scare(p, 10);
      const d = p.distanceTo(this.professor.pos);
      if (d < 60) this.audio.play('stomp', Math.max(0.3, 1 - d / 60));
      if (d < 20) showToast('Gwen: "RAAAWR!" (the passers-by scatter)');
    };
    this.mystery = new MysterySystem(this, this.dialogue);
    this.thugs = new ThugSystem(this.scene, this.water);
    this.thugs.onPunch = (dir) => this.punched(dir);
    this.gadgets = new GadgetSystem(this);
    this.giant = new GiantMode(this);
    this.minigames = new MiniGames({
      scene: this.scene,
      player: () => this.playerPos,
      professorOnFoot: () => this.onFoot,
      npcPos: (id) => this.npcs.position(id),
      flee: (id, from) => this.npcs.flee(id, from),
      sound: (n) => this.audio.play(n),
    });
    this.interactionSources.push(
      () => this.mystery.interaction(),
      () => this.npcInteraction(),
      () => this.vehicleInteraction(),
    );
    this.markerSources.push(
      () => this.director.markers(),
      () => this.mystery.markers(),
      () => this.sky.markers(this.playerPos.y),
    );

    this.hud = new HUD(container);
    this.minimap = new Minimap(this.hud.minimapSlot, this.world.features);
    new DialogueBox(this.hud.root);
    new PremonitionModal(this.hud.root, this.world.features);
    const bench = new UpgradeBench(this.hud.root);
    if (TouchControls.wanted()) new TouchControls(this.hud.root, this.input);
    this.menu = new Menu(this.hud.root);
    this.interiors = new InteriorSystem(this.scene, physics);
    this.teleports = new TeleportSystem(this.scene, this.world.landmarks.lab);
    this.teleports.onActivate = () => this.audio.play('magic');
    this.world.specialDoors.push({ id: 'moonbase', pos: this.sky.buildMoonBase(), facing: 0, label: 'the Moon Base' });
    this.iris = new IrisWipe(this.hud.root);
    this.travel = new TravelMap(this.hud.root, this.world.features, this.teleports.pads);
    this.travel.onPick = (i) => this.travelTo(i);
    const shops = this.world.doors.filter((d) => d.kind === 'shop');
    if (shops.length) this.cafeDoor = shops.reduce((a, b) => (Math.hypot(b.pos.x - 90, b.pos.z - 30) < Math.hypot(a.pos.x - 90, a.pos.z - 30) ? b : a)).pos;
    this.collectibles = new Collectibles(this);
    this.events = new SandboxEvents(this);
    this.markerSources.push(() => this.events.markers());
    this.interactionSources.push(
      () => this.collectibles.interaction(),
      () => this.trainInteraction(),
      () => this.doorInteraction(),
      () => this.interiorInteraction(),
    );
    this.markerSources.push(() => this.teleports.markers(this.playerPos.y));
    this.menu.onResume = () => {
      const req = this.renderer.domElement.requestPointerLock?.() as unknown;
      if (req instanceof Promise) req.catch(() => {});
      this.audio.play('blip');
    };
    this.hud.onMenu = () => this.toggleMenu();
    const cheat = (id: CheatId, label: string) => {
      const cost = CHEAT_COST[id];
      const name = cost.kind === 'gold' ? 'Gold Brick' : 'Red Brick';
      return {
        label: `${label} · ${cost.n} ${name}${cost.n > 1 ? 's' : ''}`,
        icon: Gem,
        on: () => gameStore.getState().cheats[id],
        toggle: () => {
          const s = gameStore.getState();
          const have = brickCount(cost.kind);
          if (have < cost.n) return showToast(`Find ${cost.n - have} more ${name}${cost.n - have > 1 ? 's' : ''} to unlock this`);
          gameStore.setState({ cheats: { ...s.cheats, [id]: !s.cheats[id] } });
        },
      };
    };
    this.menu.extras = [cheat('turbo', 'Unlimited Turbo'), cheat('water', 'Unlimited Water'), cheat('magnet', 'Bolt Magnet'), cheat('bighead', 'Big Heads'), cheat('confetti', 'Confetti Water')];
    const applyCheats = () => {
      const c = gameStore.getState().cheats;
      Humanoid.bigHeads = c.bighead;
      this.professor.head.scale.setScalar(c.bighead ? 1.8 : 1);
      this.water.confetti = c.confetti;
    };
    applyCheats();
    gameStore.subscribe((st, prev) => {
      if (st.cheats !== prev.cheats) applyCheats();
    });
    const GUN_INDEX = { water: 0, size: 1, teleport: 2, transform: 3, megaphone: 4 } as const;
    this.professor.setGun(GUN_INDEX[gameStore.getState().gun]);
    gameStore.subscribe((st, prev) => {
      if (st.gun !== prev.gun) this.professor.setGun(GUN_INDEX[st.gun]);
    });
    this.hud.onZoom = (steps) => this.input.zoomBy(steps);
    this.hud.onZoomReset = () => this.input.resetZoom();
    // Esc (or switching windows) releases the mouse: pause into the menu
    let wasLocked = false;
    document.addEventListener('pointerlockchange', () => {
      const locked = this.input.locked;
      const st = gameStore.getState();
      if (wasLocked && !locked && !st.menuOpen && !st.upgradeBenchOpen && !st.dialogue && !st.premonition) gameStore.setState({ menuOpen: true });
      wasLocked = locked;
    });
    this.graphics = new Graphics(this.renderer, this.scene, this.camera, this.sun);
    this.applySettings();
    gameStore.subscribe((st, prev) => {
      if (st.settings !== prev.settings) this.applySettings();
    });
    this.interactionSources.push(() => this.benchInteraction());
    this.hookAudio(bench);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  static async create(container: HTMLElement, onProgress?: (k: number) => void): Promise<GameEngine> {
    const [physics] = await Promise.all([PhysicsSystem.create(), Models.load(onProgress)]);
    return new GameEngine(container, physics);
  }

  private toggleMenu(): void {
    const open = gameStore.getState().menuOpen;
    if (open) this.menu.close();
    else gameStore.setState({ menuOpen: true });
  }

  /** Crowd density and shading from the Options menu. */
  private applySettings(): void {
    const { crowd, quality } = gameStore.getState().settings;
    const n = CROWD_COUNTS[crowd];
    this.pedestrians.setCount(n.walkers, this.playerPos);
    this.traffic.setAmbient(n.cars);
    this.vehicles.setBoats(n.boats);
    this.crowdChanged?.(n);
    this.graphics.set(quality);
  }

  /** Later systems (sea boats) listen for crowd changes. */
  crowdChanged: ((n: (typeof CROWD_COUNTS)['medium']) => void) | null = null;

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** On the Raptor. */
  get riding(): boolean {
    return this.professor.riding && this.vehicle === null && this.trainRide === null;
  }

  /** Walking around (not on the Raptor or in a vehicle). */
  get onFoot(): boolean {
    return !this.professor.riding;
  }

  /** Where the player is in the outside world (the door they went in by, while indoors). */
  get worldPos(): THREE.Vector3 {
    return this.outside ? this.outside.pos : this.playerPos;
  }

  /** Where the player is (whatever they are on). */
  get playerPos(): THREE.Vector3 {
    if (this.trainRide) return this.train.cars[this.trainRide.car].pos.clone().setY(RAIL_Y + 1.5);
    return this.vehicle ? this.vehicle.pos : this.riding ? this.raptor.pos : this.professor.pos;
  }

  // ───────────────────────────────────────────── loop

  frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.input.poll(dt);

    // Menu: Tab / P / Start toggle it; while open the world is frozen (still drawn behind it)
    if (this.input.menuToggle) this.toggleMenu();
    if (gameStore.getState().menuOpen) {
      this.input.endStep();
      this.input.consumeMouse();
      this.audio.setLoop('spray', 0);
      this.audio.setLoop('thruster', 0);
      this.audio.setLoop('engine', 0);
      this.audio.setLoop('wind', 0);
      this.audio.setLoop('fire', 0);
      this.hud.frame(dt, true);
      // slow flyover around the player behind the menu
      this.rig.yaw += dt * 0.12;
      const focus = this.playerPos.clone().setY(this.playerPos.y + 3);
      this.rig.update(dt, { dx: 0, dy: 0 }, focus, { distance: 26, recenterTo: null, zoomRange: [1, 1] }, this.physics, this.world.cameraIgnore);
      this.world.update(this.playerPos);
      this.sky.update(this.elapsed, this.camera, this.scene);
      this.sun.position.copy(focus).add(new THREE.Vector3(40, 80, 25));
      this.sun.target.position.copy(focus);
      this.graphics.render(dt);
      return;
    }
    this.elapsed += dt;
    this.rig.applyZoom(this.input.consumeZoom(dt));

    this.accumulator += dt;
    while (this.accumulator >= STEP) {
      this.fixedStep(STEP);
      this.accumulator -= STEP;
    }
    const alpha = this.accumulator / STEP;

    this.raptor.sync(alpha);
    this.professor.sync(alpha);
    this.vehicles.render(dt, alpha, this.camera);
    if (this.vehicle) this.professor.pedalSpeed = this.vehicle.speed;
    const status = gameStore.getState().raptorStatus;
    const parked = status === 'parked' || status === 'stolen' || status === 'attic';
    this.raptor.animate(dt, this.elapsed, parked);
    this.professor.animate(dt, this.elapsed);
    this.handleRaptorEvents();
    this.meteorFall(dt);
    this.updateImpacts(dt);
    this.fling.update(dt);
    for (const veh of this.vehicles.vehicles) {
      for (const e of veh.events.splice(0)) {
        const p = veh.group.position.clone().setY(veh.group.position.y + 0.8);
        if (e === 'crash') {
          this.particles.sparks(p, 24);
          this.audio.play('crash', veh === this.vehicle ? 0.8 : 0.3);
        } else this.audio.play('jump', 0.5);
      }
    }
    this.emitEffects(dt);

    const v = this.vehicle;
    const tr = this.trainRide ? this.train.cars[this.trainRide.car] : null;
    const focus = tr
      ? tr.group.position.clone().add(new THREE.Vector3(0, 3, 0))
      : v
      ? v.group.position.clone().add(new THREE.Vector3(0, v.kind === 'car' || v.kind === 'boat' ? (v.carModel === 'bus' || v.carModel === 'firetruck' || v.boatModel === 'yacht' ? 3.2 : 2.0) : 1.7, 0))
      : this.riding
        ? this.raptor.group.position.clone().add(new THREE.Vector3(0, this.raptor.mode === 'race' ? 2.6 : 3.4, 0))
        : this.professor.group.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    this.world.update(this.playerPos);

    const mode = this.raptor.mode;
    this.rig.update(
      dt,
      this.input.consumeMouse(),
      focus,
      {
        zoomRange: this.interiors.inside ? [0.45, 1.1] : undefined,
        distance: tr ? 18 : this.giant.active && this.riding ? 11 * this.giant.scale : this.interiors.inside ? (this.riding ? 9 : 4.6) : v ? (v.carModel === 'bus' || v.carModel === 'firetruck' || v.boatModel === 'yacht' ? 16 : v.kind === 'car' || v.kind === 'boat' ? 10 : 6.5) : !this.riding ? 6 : mode === 'flight' ? 15 : mode === 'race' ? 12 : 11,
        // Swing back behind while moving, but not while free-aiming (the aim stays put) or, with
        // LEGO controls, while moving sideways across the screen (that would make you run in circles)
        recenterTo: tr
          ? tr.heading
          : this.holdCamera()
          ? null
          : v
            ? Math.abs(v.speed) > 2
              ? v.heading
              : null
            : this.riding
              ? this.raptor.horizontalSpeed > 3
                ? this.raptor.heading
                : null
              : this.professor.horizontalSpeed > 1.5
                ? this.professor.heading
                : null,
        recenterRate: v || (this.riding && (mode === 'race')) ? 3 : !this.riding ? 2 : 1.2,
        shoulder: this.freeAiming() ? (this.riding ? { right: 2.4, up: 1.2 } : { right: 0.9, up: 0.3 }) : undefined,
      },
      this.physics,
      this.world.cameraIgnore,
    );
    this.updateAimPoint();
    this.raptor.aimAt(this.canSpray() && (this.freeAiming() || this.lockTarget || this.input.fire) ? this.aimPoint : null);
    this.hud.setLock(this.lockScreenPos());

    this.sun.position.copy(focus).add(new THREE.Vector3(40, 80, 25));
    this.sun.target.position.copy(focus);

    this.particles.update(dt);
    this.water.render();
    this.traffic.render(dt);
    this.pedestrians.render(dt, this.camera);
    this.thugs.render(dt, this.elapsed);
    this.race.render(this.elapsed);
    this.world.animate(this.elapsed);
    this.sky.update(this.elapsed, this.camera, this.scene);
    this.cullLand();
    this.director.render(dt, this.elapsed);
    this.npcs.update(dt, this.elapsed, gameStore.getState().clock, this.professor.pos, this.dialogue.open ? this.talkingTo : null);
    this.mystery.render(dt);

    this.updateAudioLoops();
    this.hud.frame(dt, this.input.locked);
    this.drawMinimap();
    this.graphics.render(dt);
  }

  private fixedStep(dt: number): void {
    const s = gameStore.getState();
    const speedMult = s.sugarRush > 0 ? 1.3 : 1;

    // Conversations and the premonition pause player control
    if (this.input.mapToggle && !s.dialogue && !s.premonition && !s.upgradeBenchOpen) this.travel.toggle();
    const modal = !!(s.dialogue || s.premonition || s.upgradeBenchOpen || this.travel.open || this.iris.busy);
    if (this.input.toggleMusic) gameStore.setState({ musicOn: !s.musicOn });
    if (s.upgradeBenchOpen) {
      if (this.input.confirm || this.input.cancel) gameStore.setState({ upgradeBenchOpen: false });
      UPGRADES.forEach((u, i) => {
        if (this.input.wasPressed(`Digit${i + 1}`) && buyUpgrade(u.id)) this.audio.play('reward');
      });
    } else if (s.premonition && this.input.confirm) {
      gameStore.setState({ premonition: null });
      this.mystery.premonitionClosed();
    } else if (s.dialogue && this.input.confirm) {
      this.dialogue.advance();
    }
    if (modal) {
      this.professor.idle(dt);
      this.raptor.update(dt, null);
      this.director.update(dt, this.professor.pos);
      this.traffic.update(dt, [{ pos: this.raptor.pos, radius: 1.4 }, { pos: this.professor.pos, radius: 0.5 }, ...this.pedestrians.obstacles]);
      this.physics.step(dt);
      this.water.update(dt);
      this.input.endStep();
      return;
    }

    if (this.input.giantToggle) this.giant.toggle();
    this.giant.update(dt);
    // Mode switching while riding the Raptor (not while a Titan)
    if (this.riding && !this.giant.active) {
      // Double-tap Space in Race mode: back to Walk mode (drift is on Ctrl/C in Race)
      if (this.input.jump) {
        const double = this.elapsed - this.lastJumpPress < 0.35;
        this.lastJumpPress = this.elapsed;
        if (double && (this.raptor.mode === 'race')) {
          this.raptor.setMode('walk');
          this.input.consumeJump();
          this.lastJumpPress = -1;
        }
      }
      // Double jump: press jump again in mid-air in Walk mode to spread the wings and take off
      if (this.raptor.mode === 'walk' && !this.raptor.grounded && this.input.jump) this.raptor.setMode('flight');
      const req = this.input.modeRequest();
      if (req) {
        const next = req === 'cycle' ? RAPTOR_MODES[(RAPTOR_MODES.indexOf(this.raptor.mode) + 1) % RAPTOR_MODES.length] : req;
        this.raptor.setMode(next);
      }
    }

    const face = this.faceHeading();
    this.updateTrain(dt);

    if (this.ramming) this.ram(dt);
    if (this.onFoot && !this.interiors.inside) {
      const req = this.input.gunRequest();
      if (req !== null) this.gadgets.selectGun(req === 'cycle' ? 'cycle' : (['water', 'size', 'teleport', 'transform', 'megaphone'] as const)[req]);
    }
    if (this.input.melee && this.onFoot) this.gadgets.melee();
    this.gadgets.update(dt);
    this.collectibles.update(dt);
    this.events.update(dt);
    this.thugs.update(dt, this.professor.pos, this.onFoot && !this.interiors.inside, this.raptor.pos, this.worldPos);
    if (this.input.treat) this.useTreat();
    this.treats.update(dt);
    this.updateLure();
    if (this.input.callRaptor && !this.riding) this.callRaptor();
    if (this.input.toggleFollow && !this.riding) this.toggleFollow();
    this.updateFollowTarget();
    this.professor.aiming = this.onFoot && this.input.fire;
    this.professor.update(dt, this.input, { camYaw: this.rig.yaw, face: this.onFoot ? face : null });
    if (this.vehicle) {
      this.vehicle.drive(dt, this.input, speedMult);
      this.professor.follow(this.vehicle.pos);
      if (this.input.wasPressed('KeyH')) this.audio.play(this.vehicle.kind === 'bike' ? 'blip' : 'honk');
      if (this.vehicle.kind === 'boat' && Math.abs(this.vehicle.speed) > 3) this.boatWake(this.vehicle);
    }
    this.vehicles.update(dt);
    this.vehicles.prune(this.playerPos);
    this.traffic.refill(dt, this.playerPos);
    this.raptor.update(
      dt,
      this.riding
        ? {
            input: this.input,
            camYaw: this.rig.yaw,
            camPitch: this.rig.pitch,
            speedMult,
            canBoost: s.thruster > 1 && !s.thrusterOverheat,
            boostMult: 1 + 0.12 * s.upgrades.thruster,
            face,
          }
        : null,
    );
    if (!this.riding && !this.following && s.raptorStatus === 'idle' && this.raptor.depth < 0.3 && this.raptor.mode === 'walk' && !this.raptor.summonTarget) this.raptor.wander(dt);

    this.updateResources(dt);
    this.updateWaterGun(dt);

    const obstacles = [
      { pos: this.raptor.pos, radius: 1.4 },
      ...(this.vehicle ? [] : [{ pos: this.professor.pos, radius: 0.5 }]),
      ...this.vehicles.obstacles(),
      ...this.pedestrians.obstacles,
    ];
    this.traffic.update(dt, obstacles, this.onFoot ? this.professor.feet : null);
    const threats = [{ pos: this.raptor.pos, speed: this.riding && this.raptor.mode === 'race' ? 99 : this.raptor.horizontalSpeed, radius: this.riding && this.raptor.mode === 'race' ? 12 : 8 }];
    if (this.vehicle) threats.push({ pos: this.vehicle.pos, speed: Math.abs(this.vehicle.speed), radius: this.vehicle.kind === 'car' ? 9 : 5 });
    const solids = [{ pos: this.raptor.pos, radius: this.raptor.mode === 'race' ? 1.6 : 1.3 }];
    if (this.onFoot) solids.push({ pos: this.professor.pos, radius: 0.4 });
    if (this.vehicle) solids.push({ pos: this.vehicle.pos, radius: this.vehicle.kind === 'car' ? 1.6 : 0.6 });
    this.pedestrians.update(dt, { threats, professorPos: this.professor.pos, professorOnFoot: this.onFoot, solids });
    const racer = this.vehicle?.kind === 'car' ? this.vehicle.feet : this.raptor.feet;
    this.race.update(dt, racer, (this.riding && this.raptor.mode === 'race') || this.vehicle?.kind === 'car');
    this.director.update(dt, this.playerPos);
    this.updateSkyProgress();
    this.mystery.update(dt);
    this.minigames.update(dt);
    this.teleports.update(dt, this.riding ? this.raptor.feet : this.professor.feet);
    this.interiors.update(dt, this.elapsed, this.professor.pos);

    this.handleInteraction();
    this.physics.step(dt);
    this.water.update(dt);
    this.input.endStep();

    const control: ControlMode = this.trainRide
      ? this.trainRide.cab
        ? 'driveTrain'
        : 'rideTrain'
      : this.vehicle
      ? this.vehicle.kind === 'car'
        ? 'driveCar'
        : this.vehicle.kind === 'boat'
          ? 'driveBoat'
          : this.vehicle.kind === 'bike'
          ? 'rideBike'
          : 'rideMotorbike'
      : this.riding
        ? MODE_CONTROL[this.raptor.mode]
        : 'onFoot';
    if (control !== s.control) gameStore.setState({ control });
  }

  // ───────────────────────────────────────────── resources: water + thruster

  private updateResources(dt: number): void {
    const s = gameStore.getState();
    // the clock: 12 real minutes per day
    const clock = (s.clock + (dt * 24) / 720) % 24;
    if (Math.floor(clock * 60) !== Math.floor(s.clock * 60)) gameStore.setState({ clock });
    else s.clock = clock;
    let { water, thruster, thrusterOverheat } = s;
    const up = s.upgrades;

    // Thruster: drains while boosting; auto-refills quickly after a short pause. Running it dry
    // overheats it: no boost until it is back to 30 % (so it can't flicker at empty).
    if (this.raptor.boosting) {
      // Race mode uses the thruster 3× more efficiently (a full meter lasts ≈ 12 s instead of ≈ 4 s)
      const efficiency = this.raptor.mode === 'race' ? 3 : 1;
      thruster -= (24 * (1 - 0.15 * up.thruster) * dt) / efficiency;
      this.boostPause = 0;
      // boost needs > 1 %, so "empty" is ≤ 1 %
      if (thruster <= 1) {
        thruster = 0;
        thrusterOverheat = true;
      }
    } else {
      this.boostPause += dt;
      if (this.boostPause > 0.8) thruster += 14 * (1 + 0.25 * up.thruster) * dt;
    }
    if (thrusterOverheat && thruster >= 30) thrusterOverheat = false;

    // Refill water at hydrants, fountains and the Lab pad
    const feet = this.raptor.feet;
    const nearRefill =
      this.raptorOnPad() || this.world.refillPoints.some((p) => Math.hypot(p.x - feet.x, p.z - feet.z) < REFILL_RANGE && Math.abs(feet.y - p.y) < 4);
    const refilling = nearRefill && water < 100;
    if (refilling) {
      water += 45 * (1 + 0.5 * up.tank) * dt;
      if (Math.random() < 0.3) this.particles.splash(feet.clone().setY(feet.y + 2.5), 2);
    }
    if (this.raptorOnPad() && !this.riding) thruster = 100;

    if (s.cheats.turbo) {
      thruster = 100;
      thrusterOverheat = false;
    }
    if (s.cheats.water) water = 100;
    water = THREE.MathUtils.clamp(water, 0, 100);
    thruster = THREE.MathUtils.clamp(thruster, 0, 100);
    if (water > 20) this.emptyWarned = false;
    if (Math.abs(water - s.water) > 0.05 || Math.abs(thruster - s.thruster) > 0.05 || refilling !== s.refilling || thrusterOverheat !== s.thrusterOverheat) {
      gameStore.setState({ water, thruster, refilling, thrusterOverheat });
    }
  }

  /** The Raptor's water gun works in every mode (in Race mode the turret aims while you steer). */
  private canSpray(): boolean {
    return this.riding;
  }

  private updateWaterGun(dt: number): void {
    const s = gameStore.getState();
    const aiming = (this.canSpray() || this.onFoot) && this.input.freeAim;
    if (aiming !== s.aiming) gameStore.setState({ aiming });
    if (!this.input.fire || s.dialogue || s.premonition || s.upgradeBenchOpen) {
      this.water.idle();
      return;
    }

    if (this.canSpray()) {
      if (s.water <= 0) {
        if (!this.emptyWarned) {
          showToast('Water tank empty! Refill at a hydrant, a park fountain or the Lab pad');
          this.emptyWarned = true;
        }
        this.water.idle();
        return;
      }
      const fired = this.water.spray(dt, this.raptor.muzzleWorld(), this.aimPoint, {
        rate: 22,
        speed: 46,
        spread: 0.05,
        power: 1,
        source: 'raptor',
        inherit: this.raptor.velocity.clone().setY(this.raptor.mode === 'flight' ? this.raptor.vy : 0),
      });
      const cost = 0.4 / (1 + 0.5 * s.upgrades.tank);
      gameStore.setState({ water: Math.max(0, s.water - fired * cost) });
    } else if (this.onFoot && s.gun !== 'water') {
      this.water.idle();
      this.gadgets.fire(this.aimPoint);
    } else if (this.onFoot) {
      // Handheld water blaster: weaker, short range, never runs dry
      const hand = this.professor.handWorld();
      this.water.spray(dt, hand, this.aimPoint, { rate: 12, speed: 28, spread: 0.06, power: 0.4, source: 'professor' });
    } else {
      this.water.idle();
    }
  }

  /** Aiming with the mouse (hold right-click); otherwise the water gun auto-aims. */
  private freeAiming(): boolean {
    return (this.canSpray() || this.onFoot) && this.input.freeAim;
  }

  /** Cars, bikes and the Raptor's race mode steer like vehicles, so the camera may always follow them. */
  private get steeringVehicle(): boolean {
    return this.vehicle !== null || (this.riding && (this.raptor.mode === 'race'));
  }

  private holdCamera(): boolean {
    // vehicles and Race mode follow behind, except while you free-aim with the mouse
    if (this.steeringVehicle) return this.input.freeAim;
    // don't swing round while free-aiming, or while moving sideways across the screen (you'd run in circles)
    return this.input.freeAim || Math.abs(this.input.moveAxis().x) > 0.3;
  }

  /** Heading the character should face this step (aiming), or null to steer normally. */
  private faceHeading(): number | null {
    if (this.steeringVehicle) return null;
    if (this.input.freeAim) return Math.atan2(-Math.sin(this.rig.yaw), -Math.cos(this.rig.yaw));
    if (this.input.fire && this.lockTarget) {
      const from = this.riding ? this.raptor.pos : this.professor.pos;
      const t = this.lockTarget.position;
      return Math.atan2(t.x - from.x, t.z - from.z);
    }
    return null;
  }

  private updateAimPoint(): void {
    if (!this.input.freeAim) {
      this.updateAutoAim();
      return;
    }
    this.lockTarget = null;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const from = this.camera.position.clone();
    const far = from.clone().addScaledVector(dir, 160);
    let d = this.physics.rayDistance(from, far, this.world.cameraIgnore);
    // there is no ground collider: stop the ray at the ground / water surface (≈ flat)
    if (dir.y < -1e-3) {
      const surface = isLand(from.x, from.z) ? floorAt(from.x, from.z, from.y) : WATER_Y;
      d = Math.min(d, (from.y - surface) / -dir.y);
    }
    this.aimPoint.copy(from).addScaledVector(dir, Math.max(d, 8));
    // don't aim below ground
    if (this.aimPoint.y < 0) this.aimPoint.y = 0;
  }

  /**
   * LEGO auto-aim: lock onto the best fire hotspot or thief in front of you (never passers-by),
   * keep the lock while the trigger is held, otherwise spray straight ahead.
   */
  private updateAutoAim(): void {
    const canAim = this.canSpray() || this.onFoot;
    if (!canAim) {
      this.lockTarget = null;
      return;
    }
    const shooter = this.riding ? this.raptor : this.professor;
    const origin = shooter.pos;
    const range = this.riding ? 48 : 24;
    const valid = (t: WaterTarget, r: number) => this.water.targets.has(t) && t.position.distanceTo(origin) < r;

    if (!(this.input.fire && this.lockTarget && valid(this.lockTarget, range * 1.2))) {
      let best: WaterTarget | null = null;
      let bestScore = Infinity;
      for (const t of this.water.targets) {
        if (t.kind !== 'fire' && t.kind !== 'thief') continue;
        const d = t.position.distanceTo(origin);
        if (d > range) continue;
        let diff = Math.atan2(t.position.x - origin.x, t.position.z - origin.z) - shooter.heading;
        diff = Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff)));
        if (diff > (75 * Math.PI) / 180) continue;
        const score = d * (1 + diff * 1.5) * (t.kind === 'thief' && this.onFoot ? 0.7 : 1);
        if (score < bestScore) {
          bestScore = score;
          best = t;
        }
      }
      this.lockTarget = best;
    }

    if (this.lockTarget) {
      this.aimPoint.copy(this.lockTarget.position);
    } else {
      // Nothing to lock onto: spray straight ahead and a little down
      const ahead = this.riding ? 22 : 10;
      const feetY = this.riding ? this.raptor.feet.y : this.professor.feet.y;
      this.aimPoint.set(origin.x + Math.sin(shooter.heading) * ahead, Math.max(0, feetY + (this.riding ? 0.5 : 0.8)), origin.z + Math.cos(shooter.heading) * ahead);
    }
  }

  /** Where to draw the lock-on marker (CSS pixels), or null. */
  private lockScreenPos(): { x: number; y: number; firing: boolean } | null {
    if (!this.lockTarget || this.input.freeAim) return null;
    const s = gameStore.getState();
    if (s.dialogue || s.premonition || s.upgradeBenchOpen) return null;
    const p = this.lockTarget.position.clone().project(this.camera);
    if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, firing: this.input.fire };
  }

  // ───────────────────────────────────────────── interactions: mount, dismount, park, race…

  /** Extra interaction sources (added by later systems). */
  readonly interactionSources: (() => Interaction | null)[] = [];

  private handleInteraction(): void {
    const s = gameStore.getState();
    if (s.dialogue || s.premonition || s.upgradeBenchOpen) {
      if (s.prompt !== null) gameStore.setState({ prompt: null });
      return;
    }
    const candidates: Interaction[] = [];
    if (this.trainRide) {
      if (this.train.runaway && this.trainRide.cab) candidates.push({ prompt: 'Pull the emergency brake!', priority: 0, run: () => this.onBrake?.() });
      const at = this.train.stoppedAt;
      candidates.push({ prompt: at ? `Get off at ${at.name}` : 'Climb out onto the roof', priority: 5, run: () => this.leaveTrain() });
    } else if (this.vehicle) {
      const v = this.vehicle;
      const rival = v.kind === 'car' ? this.race.challengeable(v.feet, true) : null;
      if (rival) candidates.push({ prompt: `Challenge ${rival.name} to a race`, priority: 0, run: () => this.race.start(rival, v.feet) });
      candidates.push({ prompt: v.kind === 'car' ? `Get out of the ${v.label}` : `Get off the ${v.label}`, priority: 5, run: () => this.exitVehicle() });
    } else if (this.riding) {
      const rival = this.race.challengeable(this.raptor.feet, this.raptor.mode === 'race');
      if (rival) candidates.push({ prompt: `Challenge ${rival.name} to a race`, priority: 0, run: () => this.race.start(rival, this.raptor.feet) });
      candidates.push({ prompt: this.raptorOnPad() ? 'Park at the Lab' : 'Hop off', priority: 5, run: () => this.dismount() });
    } else if (this.canMount()) {
      candidates.push({ prompt: 'Ride the Mecha Raptor', priority: 2, run: () => this.mount() });
    }
    for (const src of this.interactionSources) {
      const c = src();
      if (c) candidates.push(c);
    }
    candidates.sort((a, b) => a.priority - b.priority);
    const best = candidates[0] ?? null;
    const prompt = best?.prompt ?? null;
    if (s.prompt !== prompt) gameStore.setState({ prompt });
    if (best && this.input.interact) best.run();
  }

  private benchInteraction(): Interaction | null {
    if (!this.onFoot) return null;
    const b = this.world.landmarks.labBench;
    const f = this.professor.feet;
    if (Math.hypot(f.x - b.x, f.z - b.z) > 3.2) return null;
    return { prompt: 'Open the upgrade bench', priority: 2, run: () => gameStore.setState({ upgradeBenchOpen: true }) };
  }

  // ───────────────────────────────────────────── audio

  private hookAudio(bench: UpgradeBench): void {
    const a = this.audio;
    const near = (p: THREE.Vector3, range: number) => Math.max(0, 1 - p.distanceTo(this.camera.position) / range);
    this.raptorEventListeners.push((e) => {
      const v = this.riding ? 1 : near(this.raptor.pos, 60);
      if (v <= 0) return;
      if (e === 'transform') a.play('transform', v);
      if (e === 'jump' || e === 'takeoff') a.play('jump', v);
      if (e === 'landed') a.play('land', v);
      if (e === 'crash') a.play('crash', v);
      if (e === 'stomp' && this.raptor.mode === 'walk') a.play('stomp', v * 0.6);
    });
    this.director.onEvent = (e, pos) => {
      if (e === 'fireStart') a.play('alarm', 0.8);
      if (e === 'hotspotOut') a.play('sizzle', Math.max(0.3, near(pos, 120)));
      if (e === 'fireOut') {
        a.play('reward');
        this.pedestrians.cheer(pos, 70);
      }
      if (e === 'fireFailed') a.play('lose');
    };
    this.mystery.onEvent = (e) => {
      if (e === 'missing') a.play('alarm');
      if (e === 'premonition') a.play('magic');
      if (e === 'caught') a.play('shoo');
      if (e === 'soaked') a.play('splash');
      if (e === 'recovered') a.play('reward');
      if (e === 'cookies') {
        a.play('crunch');
        a.play('reward');
      }
    };
    this.race.onEvent = (e) => a.play(e === 'win' ? 'reward' : e === 'lose' ? 'lose' : 'gate');
    this.dialogue.onLine = () => a.play('blip');
    this.traffic.onHonk = (p) => {
      const v = near(p, 70);
      if (v > 0) a.play('honk', v);
    };
    this.pedestrians.onSoaked = (p) => a.play('splash', Math.max(0.2, near(p, 50)));
    bench.onBuy = () => a.play('reward');
  }

  private updateAudioLoops(): void {
    const a = this.audio;
    const s = gameStore.getState();
    const modal = !!(s.dialogue || s.premonition || s.upgradeBenchOpen);
    const spraying = this.input.fire && !modal && ((this.canSpray() && s.water > 0) || this.onFoot);
    a.setLoop('spray', spraying ? (this.riding ? 1 : 0.5) : 0);
    a.setLoop('thruster', this.raptor.boosting ? 1 : 0);
    const speed = this.raptor.horizontalSpeed;
    const v = this.vehicle;
    const motor = v && v.kind !== 'bike' ? Math.abs(v.speed) : this.riding && (this.raptor.mode === 'race') ? speed : -1;
    a.setLoop('engine', motor >= 0 ? 0.4 + motor / 50 : 0, Math.max(0, motor) * (v?.kind === 'motorbike' ? 1.6 : 1));
    a.setLoop('wind', this.riding && this.raptor.mode === 'flight' ? 0.2 + speed / 40 : 0, speed);
    const fire = this.director.fire;
    a.setLoop('fire', fire ? Math.max(0, 1 - fire.centre.distanceTo(this.camera.position) / 120) : 0);
  }

  // ───────────────────────────────────────────── vehicles (GTA-style)

  private vehicleInteraction(): Interaction | null {
    if (!this.onFoot) return null;
    const feet = this.professor.feet;
    const parked = this.vehicles.nearest(feet);
    if (parked) {
      if (parked.route) return { prompt: `Take over the ${parked.label}`, priority: 1.5, run: () => this.takeBoat(parked) };
      const verb = parked.kind === 'car' || parked.kind === 'boat' ? `Drive the ${parked.label}` : `Ride the ${parked.label}`;
      return { prompt: verb, priority: 1.5, run: () => this.enterVehicle(parked) };
    }
    const car = this.traffic.takeable(feet);
    if (car) return { prompt: 'Take the car', priority: 1.5, run: () => this.takeTrafficCar(car) };
    return null;
  }

  enterVehicle(v: Vehicle): void {
    this.vehicle = v;
    v.driven = true;
    this.professor.mount(v.seat, v.kind);
    if (v.model?.hideRider) this.professor.group.visible = false; // closed Kenney cabin
  }

  /** GTA-style at sea: climb aboard an AI boat and the skipper dives overboard. */
  private takeBoat(v: Vehicle): void {
    const splash = this.vehicles.takeBoat(v);
    this.particles.splash(splash.setY(WATER_Y + 0.3), 30);
    this.audio.play('splash');
    const lines = ['"Ahoy! That\'s my boat!"', '"Man overboard! Oh wait, that\'s me."', '"I just washed that deck!"'];
    showToast(`The skipper dives overboard: ${lines[Math.floor(Math.random() * lines.length)]}`);
    this.enterVehicle(v);
  }

  private takeTrafficCar(car: ReturnType<TrafficSystem['take']>): void {
    const roadCentre = car.agent.centre.clone();
    const dir = { ...car.agent.dir };
    const driverAt = car.agent.world.clone().add(new THREE.Vector3(-car.agent.right.x * 1.6, 0, -car.agent.right.z * 1.6));
    this.traffic.take(car);
    const v = this.vehicles.fromTraffic(car);
    this.pedestrians.addFleeing(driverAt, roadCentre, dir);
    const lines = ['"Hey! That\'s my car!"', '"Is that a lab coat?! Bring it back!"', '"Not again! Third time this week!"', '"I\'m calling my mum!"'];
    showToast(`The driver jumps out: ${lines[Math.floor(Math.random() * lines.length)]}`);
    this.audio.play('honk');
    this.enterVehicle(v);
  }

  exitVehicle(): void {
    const v = this.vehicle;
    if (!v) return;
    const { radius, halfHeight } = this.professor.capsule;
    const side = v.kind === 'car' ? (v.carModel === 'bus' || v.carModel === 'firetruck' ? 2.4 : 2.0) : v.kind === 'boat' ? 2.6 : 1.0;
    const offsets = [new THREE.Vector3(side, 0, 0), new THREE.Vector3(-side, 0, 0), new THREE.Vector3(0, 0, -side * 1.6), new THREE.Vector3(0, 0, side * 1.6)];
    for (const o of offsets) {
      const feet = v.localToWorld(o);
      const centre = feet.clone().setY(feet.y + this.professor.footOffset);
      if (!this.physics.isFree(centre, radius, halfHeight)) continue;
      v.driven = false;
      this.vehicle = null;
      this.professor.dismount(this.scene, feet, v.heading);
      return;
    }
    showToast('No room to get out here');
  }

  private npcInteraction(): Interaction | null {
    if (!this.onFoot) return null;
    const npc = this.npcs.nearest(this.professor.feet);
    if (!npc) return null;
    return {
      prompt: `Talk to ${npc.name}`,
      priority: 3,
      run: () => {
        this.talkingTo = npc.id;
        const special = this.mystery.linesFor(npc.id);
        if (special) {
          this.dialogue.start(special.lines, special.after);
          return;
        }
        let lines = this.npcs.defaultLines(npc.id);
        if (npc.id === 'grandma' && gameStore.getState().treatStock < 8) {
          gameStore.setState({ treatStock: 8 });
          lines = [...lines, { speaker: 'Grandma', text: 'Take some cookies for the road, dear. Eight, fresh from the oven! (Press T to use one.)' }];
        }
        const area = this.director.fireArea;
        if (area && npc.id !== 'grandma') lines = [{ speaker: npc.name, text: `There's smoke over ${area}! Hurry!` }];
        else if (this.minigames.canStart(npc.id)) {
          this.dialogue.start(lines, () => this.minigames.start(npc.id));
          return;
        }
        this.dialogue.start(lines);
      },
    };
  }

  canMount(): boolean {
    const st = gameStore.getState().raptorStatus;
    if (st === 'stolen' || st === 'attic') return false;
    return this.nearRaptor();
  }

  nearRaptor(): boolean {
    const a = this.professor.feet;
    const b = this.raptor.feet;
    return Math.hypot(a.x - b.x, a.z - b.z) < MOUNT_RANGE && Math.abs(a.y - b.y) < 2.5;
  }

  raptorOnPad(): boolean {
    const { labPad } = this.world.landmarks;
    const f = this.raptor.feet;
    return Math.hypot(f.x - labPad.x, f.z - labPad.z) < labPad.radius && f.y < 1;
  }

  mount(): void {
    this.professor.mount(this.raptor.saddle);
    this.raptor.ridden = true;
    this.raptor.events.push('stomp');
    gameStore.setState({ control: 'raptorWalk', raptorStatus: 'ridden' });
  }

  dismount(): void {
    const park = this.raptorOnPad();
    if (park) {
      const { labPad } = this.world.landmarks;
      this.raptor.teleport(this.padCenterForRaptor(), labPad.facing);
    }
    const spot = this.findDismountSpot();
    if (!spot) {
      showToast('No room to hop off here');
      return;
    }
    this.raptor.ridden = false;
    this.raptor.resetToWalk();
    this.professor.dismount(this.scene, spot, this.raptor.heading);
    // Getting off high in the air: pop the parachute (in space it opens by itself on re-entry)
    const height = spot.y - surfaceAt(spot.x, spot.z, spot.y);
    if (height > 8 && spot.y < 290) this.professor.deployParachute();

    if (park) {
      gameStore.setState({ control: 'onFoot', raptorStatus: 'parked', water: 100, thruster: 100 });
      showToast('Parked at the Lab · water and thrusters refilled');
    } else {
      gameStore.setState({ control: 'onFoot', raptorStatus: 'idle' });
    }
  }

  /** A free spot next to the Raptor for the Professor's feet: left side first, then right, back, front. */
  private findDismountSpot(): THREE.Vector3 | null {
    const { radius, halfHeight } = this.professor.capsule;
    const lift = this.professor.footOffset;
    const offsets = [
      new THREE.Vector3(2.0, 0, 0),
      new THREE.Vector3(-2.0, 0, 0),
      new THREE.Vector3(0, 0, -2.6),
      new THREE.Vector3(0, 0, 2.4),
      new THREE.Vector3(0, 3.6, 0),
    ];
    for (const o of offsets) {
      // Mid-air (flight) the Professor steps off right beside the Raptor and falls from there
      // (high up his parachute opens, see dismount()).
      const feet = this.raptor.localToWorld(o);
      const centre = feet.clone().setY(feet.y + lift);
      if (this.physics.isFree(centre, radius, halfHeight)) return feet;
    }
    return null;
  }

  padCenterForRaptor(): THREE.Vector3 {
    const { labPad } = this.world.landmarks;
    return new THREE.Vector3(labPad.x, this.raptor.footOffset, labPad.z);
  }

  // ───────────────────────────────────────────── effects

  /** Listeners for Raptor events (audio in Phase 4). */
  readonly raptorEventListeners: ((e: string) => void)[] = [];

  /** Expanding shockwave rings and fading crater marks from hard landings. */
  private readonly impacts: { ring: THREE.Mesh; crater: THREE.Mesh; t: number; strength: number }[] = [];

  /**
   * Falling from space (or far up in the clouds) builds up to meteor speed: a fiery trail and a shaking camera while
   * plunging, and a huge crater impact at the bottom. Only the Raptor (ridden or alone): the Professor on his own never burns up.
   */
  private meteorFall(dt: number): void {
    // The Professor never burns up: his hard landings thump, but only the Raptor becomes a meteor
    if (this.professor.riding) this.professor.lastImpact = 0; // the Raptor reports its own landing
    else if (this.professor.lastImpact) {
      if (!this.vehicle) this.impact(this.professor.group.position, Math.min(this.professor.lastImpact, 50));
      this.professor.lastImpact = 0;
    }
    const body = this.raptor;
    const speed = -body.vy;
    const feet = body.group.position;
    if (speed < METEOR_FROM || feet.y < 12) return;
    const heat = Math.min(1, (speed - METEOR_FROM) / (MAX_FALL - METEOR_FROM));
    const tail = feet.clone().setY(feet.y + 1.2);
    this.particles.glow.emit({ pos: tail, vel: new THREE.Vector3(0, 6 + 8 * heat, 0), spread: 1.2 + 1.8 * heat, color: heat > 0.6 ? '#ffd166' : '#ff7b00', size: 0.9 + 1.4 * heat, grow: 1.5, life: 0.5, drag: 1, count: 2 + Math.round(5 * heat), alpha: 0.9 });
    this.particles.soft.emit({ pos: tail.clone().setY(tail.y + 1.5), vel: new THREE.Vector3(0, 4, 0), spread: 1.5, color: '#3a2f2a', size: 1.2, grow: 3, life: 1.1, drag: 1.5, count: 1 + Math.round(2 * heat), alpha: 0.5 });
    this.rig.shake(0.08 + 0.3 * heat * Math.min(1, dt * 60));
  }

  /** A heavy landing: shockwave, dust, debris, a crater mark, camera shake, a thump, and panic. */
  private impact(pos: THREE.Vector3, fallSpeed: number): void {
    const meteor = Math.max(0, fallSpeed - 60) / 50; // 0 for ordinary hard landings, 1 at terminal speed
    const strength = THREE.MathUtils.clamp((fallSpeed - 18) / 10, 0.35, 1.2) + 2 * meteor;
    const ground = pos.clone().setY(surfaceAt(pos.x, pos.z, pos.y + 1) + 0.06);
    // dust ring blasting outwards
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a), 0.25, Math.sin(a)).multiplyScalar(10 + 8 * strength);
      this.particles.soft.emit({ pos: ground.clone().add(new THREE.Vector3(Math.cos(a), 0.2, Math.sin(a))), vel: v, spread: 1.5, color: '#d9c7a3', size: 1.6, grow: 4 * strength, life: 1.1, drag: 3, alpha: 0.7 });
    }
    // debris chunks flying up
    this.particles.soft.emit({ pos: ground.clone().setY(ground.y + 0.3), vel: new THREE.Vector3(0, 9 * strength, 0), spread: 6, color: '#8d7b68', size: 0.35, life: 1.2, gravity: -22, count: 24 });
    this.particles.sparks(ground.clone().setY(ground.y + 0.5), 30, '#ffd166');
    if (meteor > 0) {
      // fireball and a rain of burning rubble
      this.particles.glow.emit({ pos: ground.clone().setY(ground.y + 1), vel: new THREE.Vector3(0, 14, 0), spread: 5, color: '#ff7b00', size: 3.5, grow: 5, life: 0.9, drag: 1.5, count: 30, alpha: 0.9 });
      this.particles.sparks(ground.clone().setY(ground.y + 0.8), Math.round(80 * meteor), '#ff9f1c');
    }
    // shockwave ring + crater mark (removed again after 5 s)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.position.copy(ground);
    const crater = new THREE.Mesh(
      new THREE.CircleGeometry(2.6 + 1.6 * strength, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#4a3b2c', transparent: true, opacity: 0.55, depthWrite: false }),
    );
    crater.position.copy(ground).setY(ground.y - 0.02);
    this.scene.add(ring, crater);
    this.impacts.push({ ring, crater, t: 0, strength });
    // feel it
    this.rig.shake(0.5 + 0.9 * strength);
    this.audio.play('land', 1);
    this.audio.play('crash', 0.6 + 0.4 * strength);
    this.pedestrians.scare(ground, 18 + 12 * strength);
    // the blast throws everything close by into the air
    this.blast(ground, 9 + 7 * strength, strength);
  }

  // ───────────────────────────────────────────── the city train

  /** Runaway-train event hook (the brake). */
  onBrake: (() => void) | null = null;

  private updateTrain(dt: number): void {
    const t = this.train;
    if (this.trainRide?.cab) t.drive(this.input.moveAxis().z);
    t.update(dt);
    // people (and the Raptor) standing on a roof ride along
    if (this.onFoot) {
      const car = t.roofUnder(this.professor.feet);
      if (car) this.professor.nudge(car.delta);
    }
    const rc = t.roofUnder(this.raptor.feet);
    if (rc && !this.raptor.summonTarget) this.raptor.nudge(rc.delta);
    if (this.trainRide) {
      const car = t.cars[this.trainRide.car];
      this.professor.follow(car.pos.clone().setY(RAIL_Y + 1.5));
    }
  }

  private trainInteraction(): Interaction | null {
    if (!this.onFoot || this.trainRide) return null;
    if (this.train.runaway && this.train.roofUnder(this.professor.feet) === this.train.cars[0]) {
      return { prompt: 'Swing down into the cab!', priority: 0.5, run: () => this.boardTrain(0, true) };
    }
    const at = this.train.stoppedAt;
    if (!at) return null;
    const i = this.train.doorNear(this.professor.feet);
    if (i === null) return null;
    return i === 0
      ? { prompt: 'Drive the train from the cab', priority: 1.3, run: () => this.boardTrain(0, true) }
      : { prompt: 'Board the train', priority: 1.3, run: () => this.boardTrain(i, false) };
  }

  private boardTrain(i: number, cab: boolean): void {
    const car = this.train.cars[i];
    this.trainRide = { car: i, cab };
    this.professor.mount(cab ? car.seat : car.passengerSeat, 'car');
    if (Models.has('monorail_trainFront')) this.professor.group.visible = false; // closed Kenney carriage
    if (cab) {
      this.train.driver = 'player';
      if (this.train.conductor) this.train.conductor.root.visible = false;
      showToast('All aboard! W to speed up, S to brake. E gets you off.');
    } else showToast('All aboard! Next stop… somewhere. E gets you off.');
    this.audio.play('blip');
  }

  private leaveTrain(): void {
    const ride = this.trainRide;
    if (!ride) return;
    const car = this.train.cars[ride.car];
    const at = this.train.stoppedAt;
    this.trainRide = null;
    if (ride.cab) {
      this.train.releaseToAi();
      if (this.train.conductor) this.train.conductor.root.visible = true;
    }
    const spot = at ? at.platform.clone() : car.pos.clone().setY(RAIL_Y + 3.3);
    this.professor.dismount(this.scene, spot, car.heading);
  }

  // ───────────────────────────────────────────── combat helpers

  /** Ground (or interior floor) height under a point. */
  groundBelow(p: THREE.Vector3): number {
    return surfaceAt(p.x, p.z, p.y);
  }

  /** Titan footsteps and punches: dust, a thump and a blast that throws things. */
  giantStomp(at: THREE.Vector3, radius: number, power: number): void {
    const ground = at.clone().setY(surfaceAt(at.x, at.z, at.y + 1) + 0.1);
    this.particles.soft.emit({ pos: ground, vel: new THREE.Vector3(0, 2, 0), spread: radius * 0.4, color: '#d9c7a3', size: 1.5, grow: 3, life: 0.9, drag: 2, count: 10, alpha: 0.6 });
    this.rig.shake(0.15 + 0.25 * power);
    this.audio.play('stomp', 0.5 + 0.3 * power);
    this.blast(ground, radius, power);
    this.pedestrians.scare(ground, radius * 3);
  }

  /** A Rogue Mech footstep: throws cars and people about (but doesn't hurt the mech). */
  mechStomp(at: THREE.Vector3): void {
    const ground = at.clone().setY(surfaceAt(at.x, at.z) + 0.1);
    this.particles.soft.emit({ pos: ground, vel: new THREE.Vector3(0, 2, 0), spread: 3, color: '#d9c7a3', size: 1.6, grow: 3, life: 0.9, drag: 2, count: 10, alpha: 0.6 });
    const d = ground.distanceTo(this.camera.position);
    if (d < 120) {
      this.rig.shake(0.5 * (1 - d / 120));
      this.audio.play('stomp', 1 - d / 120);
    }
    this.blast(ground, 7, 0.8, false);
    this.pedestrians.scare(ground, 30);
  }

  /** A meteor hits town. */
  meteorImpact(at: THREE.Vector3): void {
    this.impact(at, 110);
  }

  /** The Professor's ground slam (X falling from high up): a small shockwave. */
  groundSlam(feet: THREE.Vector3): void {
    this.impact(feet.clone(), 30);
  }

  /** A thug landed a punch: knocked back, a rattle and an "oof". */
  private punched(dir: THREE.Vector3): void {
    if (!this.onFoot || this.professor.attack?.kind === 'bash') return;
    this.professor.dash = { vel: dir.clone().multiplyScalar(7), time: 0.18 };
    this.professor.vy = Math.max(this.professor.vy, 4);
    this.rig.shake(0.25);
    this.audio.play('crash', 0.4);
    const s = gameStore.getState();
    if (s.bolts > 0) {
      gameStore.setState({ bolts: Math.max(0, s.bolts - 5) });
      showToast('Oof! You dropped some bolts.');
    } else showToast('Oof! Punch back with X!');
  }

  // ───────────────────────────────────────────── buildings: going in and out

  private doorInteraction(): Interaction | null {
    if (!this.onFoot || this.interiors.inside || this.iris.busy) return null;
    const f = this.professor.feet;
    const near = (p: THREE.Vector3, r: number) => Math.hypot(p.x - f.x, p.z - f.z) < r && Math.abs(p.y - f.y) < 2;
    // (Grandma's door is right beside her rocking chair, so it needs you closer)
    for (const d of this.world.specialDoors) if (near(d.pos, d.id === 'grandma' ? 1.5 : 2.4)) return { prompt: `Enter ${d.label}`, priority: 1.2, run: () => this.enterSpecial(d) };
    let best: BuildingDoor | null = null;
    for (const d of this.world.doors) if (near(d.pos, 1.9) && (!best || d.pos.distanceTo(f) < best.pos.distanceTo(f))) best = d;
    if (!best) return null;
    const d = best;
    const cafe = this.cafeDoor !== null && d.pos.distanceTo(this.cafeDoor) < 0.5;
    const label = cafe ? 'Sam’s café' : { house: 'the house', shop: 'the shop', office: 'the office', tower: 'the tower' }[d.kind];
    return { prompt: `Go into ${label}`, priority: 1.4, run: () => this.enterTown(d, cafe) };
  }

  private enterTown(d: BuildingDoor, cafe: boolean): void {
    const out = new THREE.Vector3(Math.sin(d.facing), 0, Math.cos(d.facing));
    const kind: InteriorKind = cafe ? 'cafe' : d.kind;
    const title = cafe ? 'Sam’s Café' : { house: 'A cosy house', shop: 'The corner shop', office: 'The office', tower: 'Tower lobby' }[d.kind];
    const b = d.building;
    this.goInside({
      kind,
      title,
      seed: Math.round(d.pos.x * 73 + d.pos.z * 151),
      exitTo: d.pos.clone().addScaledVector(out, 1.4),
      exitFacing: d.facing,
      roof: d.kind === 'office' || d.kind === 'tower' ? new THREE.Vector3(b.x, floorAt(b.x, b.z) + b.h + 0.35, b.z) : undefined,
      people: this.npcs.insideAt(d.pos),
      color: d.color,
    });
  }

  private enterSpecial(d: SpecialDoor): void {
    const out = new THREE.Vector3(Math.sin(d.facing), 0, Math.cos(d.facing));
    const kind: Record<SpecialDoor['id'], InteriorKind> = { lab: 'lab', police: 'police', lighthouse: 'lighthouse', observatory: 'observatory', grandma: 'grandma', shack: 'shack', station: 'station', moonbase: 'moonbase' };
    const title: Record<SpecialDoor['id'], string> = { lab: 'The Lab · Teleport Hub', police: 'Police Station', lighthouse: 'The Lighthouse', observatory: 'The Observatory', grandma: 'Grandma’s house', shack: 'The Pirate’s Treasure Room', station: 'Train Station', moonbase: 'Moon Base' };
    let roof: THREE.Vector3 | undefined;
    if (d.id === 'lighthouse') roof = new THREE.Vector3(d.pos.x + 3.2, d.pos.y + 22.1, d.pos.z);
    if (d.roof) roof = d.roof.clone();
    this.goInside({ kind: kind[d.id], title: title[d.id], seed: d.id.length * 97, exitTo: d.pos.clone().addScaledVector(out, 1.2), exitFacing: d.facing, roof });
  }

  private goInside(def: InteriorDef): void {
    void this.iris.play(() => {
      const { spawn, facing } = this.interiors.enter(def, gameStore.getState().jailed);
      this.outside = { pos: def.exitTo.clone(), facing: def.exitFacing, def };
      this.professor.teleport(spawn.clone().setY(spawn.y + this.professor.footOffset), facing);
      this.rig.yaw = facing + Math.PI;
      this.rig.pitch = 0.3;
      const st = gameStore.getState().raptorStatus;
      // cookie run: the Raptor is snoozing in Grandma's attic (3rd floor)
      if (def.kind === 'grandma' && st === 'attic') {
        this.raptor.teleport(GRANDMA_ATTIC_SPOT.clone().setY(GRANDMA_ATTIC_SPOT.y + this.raptor.footOffset), Math.PI / 2);
      } else if (this.interiors.roomy && def.kind !== 'grandma' && this.following && st !== 'stolen' && st !== 'attic') {
      // the Lab hangar is big enough for the Raptor to trot in after you
        this.raptor.summonTarget = null;
        this.raptor.teleport(spawn.clone().add(new THREE.Vector3(-4, this.raptor.footOffset, -3)), facing);
      }
      this.audio.play('blip');
    }, def.title);
  }

  /** Back outside by the door (or up on the roof). */
  /** Back outside by the door (or up on the roof). Riding the Raptor, you come out together into the yard. */
  leaveInterior(toRoof = false): void {
    const o = this.outside;
    if (!o) return;
    void this.iris.play(() => {
      const raptorInside = this.raptor.pos.y < -300;
      const riding = this.riding;
      this.interiors.leave();
      this.outside = null;
      const out = new THREE.Vector3(Math.sin(o.facing), 0, Math.cos(o.facing));
      if (riding) {
        const yard = o.pos.clone().addScaledVector(out, 5);
        this.raptor.teleport(yard.setY(floorAt(yard.x, yard.z) + this.raptor.footOffset), o.facing);
      } else {
        const to = toRoof && o.def.roof ? o.def.roof : o.pos;
        this.professor.teleport(to.clone().setY(to.y + this.professor.footOffset), o.facing);
        if (raptorInside && gameStore.getState().raptorStatus === 'attic') {
          // still asleep in the attic: it stays hidden in Grandma's house
          const spot = this.world.landmarks.atticSpot;
          this.raptor.teleport(spot.clone().setY(spot.y + this.raptor.footOffset), Math.PI / 2);
        } else if (raptorInside) {
          const side = new THREE.Vector3(Math.cos(o.facing), 0, -Math.sin(o.facing)).multiplyScalar(4);
          this.raptor.teleport(o.pos.clone().add(side).setY(o.pos.y + this.raptor.footOffset), o.facing);
        }
      }
      this.rig.yaw = o.facing + Math.PI;
      if (toRoof) showToast('Up on the roof! Jump off and skydive (Space cuts the parachute).');
    }, toRoof ? 'Up we go…' : undefined);
  }

  /** E prompts for things to do indoors. */
  private interiorInteraction(): Interaction | null {
    if (!this.interiors.inside || this.iris.busy) return null;
    if (this.riding) {
      // on the Raptor indoors (the Lab hangar, Grandma's attic): you can only ride out
      const a = this.interiors.actionNear(this.raptor.feet);
      if (a?.id === 'exit') return { prompt: 'Ride out', priority: 1, run: () => this.leaveInterior(false) };
      return null;
    }
    if (!this.onFoot) return null;
    const f = this.professor.feet;
    const person = this.interiors.personNear(f);
    const a = this.interiors.actionNear(f);
    if (a) return { prompt: a.prompt, priority: 1, run: () => this.interiorAction(a.id) };
    if (person) return { prompt: `Talk to ${person.name}`, priority: 1.1, run: () => this.talkIndoors(person) };
    return null;
  }

  private talkIndoors(p: { id: string; name: string }): void {
    const named = ['grandma', 'leo', 'max', 'gwen', 'sam', 'bruno', 'cora'];
    if (named.includes(p.id)) {
      this.dialogue.start(this.npcs.defaultLines(p.id as NpcId));
      return;
    }
    const lines: Record<string, string[]> = {
      resident: ['Oh! Hello, Professor. Do… you always just walk into people’s houses?', 'Wipe your feet! Is that a dinosaur outside?', 'Tea? No? Off you go then.'],
      clerk: ['Welcome! Everything’s on sale. Except the cookies. The cookies are full price.', 'Can I help you? You look like you’re about to invent something.'],
      barista: ['One extra-large hot chocolate for the Professor? Coming up!'],
      worker: ['Shh, I’m in a meeting. With my sandwich.', 'Is it Friday yet?'],
      receptionist: ['The lift goes all the way to the roof. Great view! Please don’t jump off it.'],
      astronomer: ['Look through the telescope! On a clear day you can see the Moon Base.'],
      astronaut: ['Welcome to the Moon Base! Mind the low gravity, the coffee floats.'],
      thug: ['Lemme out! I’ll be good! …ish.'],
      bruno: [`We’ve got ${gameStore.getState().jailed} of your catches behind bars, Professor.`],
    };
    const pool = lines[p.id] ?? ['Hello!'];
    this.dialogue.start([{ speaker: p.name, text: pool[Math.floor(Math.random() * pool.length)] }]);
  }

  private interiorAction(id: string): void {
    const s = gameStore.getState();
    if (id === 'exit') return this.leaveInterior(false);
    if (id === 'roof') return this.leaveInterior(true);
    if (id === 'bench') return gameStore.setState({ upgradeBenchOpen: true });
    if (id.startsWith('portal:')) return this.travelTo(Number(id.slice(7)), true);
    if (id === 'nap') {
      const evening = s.clock < 15;
      gameStore.setState({ clock: evening ? 18 : 7 });
      showToast(evening ? 'Zzz… You nap until the evening.' : 'Zzz… You sleep until morning. Good morning!');
      return;
    }
    if (id === 'buyCookies' || id === 'buyCookie') {
      const n = id === 'buyCookies' ? 3 : 1;
      const cost = id === 'buyCookies' ? 10 : 5;
      if (s.labPoints < cost) return showToast(`Need ${cost} Lab Points`);
      gameStore.setState({ labPoints: s.labPoints - cost, treatStock: s.treatStock + n });
      this.audio.play('reward');
      return showToast(`Bought ${n} cookie${n > 1 ? 's' : ''}! (${s.treatStock + n} carried)`);
    }
    if (id === 'cells') {
      this.dialogue.start([
        { speaker: 'Chief Bruno', text: s.jailed ? `${s.jailed} thug${s.jailed > 1 ? 's' : ''} in the cells, all thanks to you. Keep zapping them in!` : 'Cells are empty, Professor. Rough up a thug, then zap them here with your Teleport Gun.' },
      ]);
      return;
    }
    if (id === 'telescope') {
      const unseen = this.sky.islands.filter((i) => !i.discovered).map((i) => i.name);
      showToast(unseen.length ? `Through the telescope you spot ${unseen[0]} floating high above!` : 'You can see every floating island from here. Gorgeous!');
      if (!this.telescopeUsed) {
        this.telescopeUsed = true;
        addPoints(10);
        this.audio.play('reward');
      }
      return;
    }
    if (id === 'chest') {
      if (this.chestOpened) return showToast('The chest is empty now. Arr.');
      this.chestOpened = true;
      addPoints(50);
      this.audio.play('reward');
      return showToast('Pirate treasure! +50 Lab Points');
    }
    if (id === 'progress') return this.showProgress();
    if (id === 'grandmaJar') {
      const st = gameStore.getState();
      if (st.raptorStatus === 'attic') return showToast('Empty! Just crumbs… and a trail of them leading up the stairs.');
      if (st.treatStock < 8) {
        gameStore.setState({ treatStock: 8 });
        return showToast('You help yourself to cookies (8 carried). Grandma won’t mind. Probably.');
      }
      return showToast('Mmm, still warm. You already have plenty of cookies.');
    }
    if (id === 'moonlog') {
      this.dialogue.start([
        { speaker: 'Professor', text: '“Day 12: still no cheese found on the Moon. The Professor promised there would be cheese.”' },
        { speaker: 'Professor', text: 'Hmm. I may owe the astronauts an apology. And some cheese.' },
      ]);
      return;
    }
    this.onInteriorAction?.(id);
  }

  /** Later systems (gold bricks) handle extra interior actions. */
  onInteriorAction: ((id: string) => void) | null = null;

  /** The progress wall: how much of the world you've done. */
  showProgress(): void {
    const s = gameStore.getState();
    const parts = this.progressParts();
    const pct = Math.round((parts.reduce((a, p) => a + p.done / p.of, 0) / parts.length) * 100);
    showToast(`Progress ${pct}% · ` + parts.map((p) => `${p.label} ${p.done}/${p.of}`).join(' · ') + (s.labPoints ? ` · ${s.labPoints} pts` : ''));
  }

  /** Pieces of the 100 % (later phases add more). */
  readonly progressParts = (): { label: string; done: number; of: number }[] => [
    { label: 'Pads', done: gameStore.getState().pads.length, of: this.teleports.pads.length },
    { label: 'Sky isles', done: this.sky.islands.filter((i) => i.discovered).length, of: this.sky.islands.length },
    { label: 'Upgrades', done: Object.values(gameStore.getState().upgrades).reduce((a, b) => a + b, 0), of: 12 },
    { label: 'Jailed', done: Math.min(9, gameStore.getState().jailed), of: 9 },
    { label: 'Gold Bricks', done: this.collectibles.counts().gold, of: 10 },
    { label: 'Red Bricks', done: this.collectibles.counts().red, of: 3 },
    { label: 'Super Builds', done: this.collectibles.counts().builds, of: 3 },
  ];

  /** The Space Launch Pad: a rocket-powered hop all the way up past the clouds. */
  launchToSpace(): void {
    const body = this.riding ? this.raptor : this.onFoot ? this.professor : null;
    if (!body) return;
    if (this.riding && this.raptor.mode !== 'walk') this.raptor.setMode('walk');
    body.vy = 150;
    body.grounded = false;
    this.particles.glow.emit({ pos: body.feet.clone(), vel: new THREE.Vector3(0, -6, 0), spread: 3, color: '#ff7b00', size: 2.5, grow: 4, life: 1.2, drag: 1, count: 40, alpha: 0.9 });
    this.rig.shake(1);
    this.audio.play('jump');
    this.audio.play('alarm', 0.5);
    showToast('3… 2… 1… BLAST OFF! (In space, low gravity. Coming back down, the parachute opens by itself.)');
  }

  /** Quick travel to a teleport pad (from the map, or from a hub portal). */
  travelTo(i: number, fromHub = false): void {
    if (this.vehicle) return showToast('Get out of the vehicle first');
    const pad = this.teleports.pads[i];
    if (!pad) return;
    if (!fromHub && !this.teleports.isOn(i)) return;
    void this.iris.play(() => {
      if (this.interiors.inside) {
        this.interiors.leave();
        this.outside = null;
      }
      const body = this.riding ? this.raptor : this.professor;
      body.teleport(pad.pos.clone().add(new THREE.Vector3(0, body.footOffset + 0.1, 2.4)), body.heading);
      if (!this.teleports.isOn(i)) gameStore.setState((st) => ({ pads: [...st.pads, i] }));
      this.audio.play('magic');
    }, pad.name);
  }

  // ───────────────────────────────────────────── treats (T)

  /** Feed the Raptor (riding, or standing next to it), or throw a cookie as a lure. */
  private useTreat(): void {
    const s = gameStore.getState();
    if (s.treatStock <= 0) {
      showToast('Out of cookies! Grandma always has more');
      return;
    }
    const available = s.raptorStatus !== 'stolen' && s.raptorStatus !== 'attic';
    if (available && (this.riding || (this.onFoot && this.nearRaptor()))) {
      this.feedRaptor(true);
      return;
    }
    if (!this.onFoot) return;
    const dir = new THREE.Vector3(Math.sin(this.professor.heading), 0, Math.cos(this.professor.heading));
    this.treats.throw(this.professor.handWorld(), dir);
    gameStore.setState({ treatStock: s.treatStock - 1 });
    this.audio.play('jump', 0.4);
    showToast(`Cookie thrown! (${s.treatStock - 1} left)`);
  }

  /** Nom: treats meter up, thruster refilled, a burst of Sugar Rush. */
  private feedRaptor(fromStock: boolean): void {
    const s = gameStore.getState();
    gameStore.setState({
      treats: Math.min(100, s.treats + 40),
      thruster: 100,
      thrusterOverheat: false,
      sugarRush: Math.max(s.sugarRush, 15),
      treatStock: fromStock ? s.treatStock - 1 : s.treatStock,
    });
    this.particles.crumbs(this.raptor.localToWorld(new THREE.Vector3(0, 2.6, 1.8)), 14);
    this.audio.play('crunch');
    showToast(fromStock ? `The Raptor gobbles the cookie! Thrusters full, Sugar Rush! (${s.treatStock - 1} left)` : 'The Raptor found your cookie! Nom nom.');
  }

  /** A thrown cookie lures the Raptor over (when it isn't ridden or missing); townsfolk come to look. */
  private updateLure(): void {
    const st = gameStore.getState().raptorStatus;
    if (this.riding || st === 'stolen' || st === 'attic') return;
    const r = this.raptor;
    const near = this.treats.nearest(r.feet, 4);
    if (near) {
      this.treats.eat(near);
      r.summonTarget = null;
      this.feedRaptor(false);
      if (st === 'parked') gameStore.setState({ raptorStatus: 'idle' });
      return;
    }
    if (r.summonTarget) return;
    const lure = this.treats.nearest(r.feet, 80);
    if (lure && Math.random() < 0.05) {
      r.summon(lure.pos.clone().setY(lure.pos.y));
      if (st === 'parked') gameStore.setState({ raptorStatus: 'idle' });
    }
  }

  // ───────────────────────────────────────────── the Raptor follows you (F)

  /** The Raptor trots after the Professor while he is on foot. */
  private following = false;

  private toggleFollow(): void {
    const st = gameStore.getState().raptorStatus;
    if (st === 'stolen' || st === 'attic') {
      showToast("The Raptor can't follow you. It's missing!");
      return;
    }
    this.following = !this.following;
    if (this.following && st === 'parked') gameStore.setState({ raptorStatus: 'idle' });
    showToast(this.following ? 'Raptor: following you! (F to make it stay)' : 'Raptor: staying here.');
    this.audio.play('blip');
  }

  /** Each step: point the Raptor at the Professor (or fly it over if he got far away / up high). */
  private updateFollowTarget(): void {
    const st = gameStore.getState().raptorStatus;
    this.raptor.escortTarget = null;
    if (this.interiors.inside && !this.interiors.roomy && !this.riding) {
      this.raptor.followTarget = null; // it waits outside
      return;
    }
    if (this.riding || st === 'stolen' || st === 'attic') {
      if (st === 'stolen' || st === 'attic') this.following = false;
      this.raptor.followTarget = null;
      return;
    }
    // Sailing with Follow on: the Raptor flies alongside the boat
    if (this.following && this.vehicle?.kind === 'boat' && !this.raptor.summonTarget) {
      this.raptor.followTarget = null;
      this.raptor.escortTarget = this.vehicle.localToWorld(new THREE.Vector3(-6, 0, -2));
      return;
    }
    if (!this.following || this.raptor.summonTarget) {
      this.raptor.followTarget = null;
      return;
    }
    const me = this.professor.feet;
    const r = this.raptor.feet;
    const far = Math.hypot(me.x - r.x, me.z - r.z) > 70 || Math.abs(me.y - r.y) > 8;
    const settled = this.professor.grounded || this.professor.swimming;
    if (far && settled) {
      this.raptor.followTarget = null;
      this.callRaptor(true);
      return;
    }
    this.raptor.followTarget = settled ? me : null;
  }

  // ───────────────────────────────────────────── calling the Raptor (R)

  /**
   * Whistle for the Raptor: it flies over and lands beside the Professor. From far away (another
   * island, deep space, the other side of town) it swoops in from just out of sight instead.
   */
  private callRaptor(quiet = false): void {
    const s = gameStore.getState();
    if (s.raptorStatus === 'stolen' || s.raptorStatus === 'attic') {
      showToast("The Raptor can't hear you. It's missing! Find out where it went.");
      return;
    }
    if (this.interiors.inside && !this.interiors.roomy) {
      showToast('The Raptor won’t fit through the door! It’s waiting outside.');
      return;
    }
    const me = this.professor.feet;
    // land a few metres to the Professor's right
    const right = new THREE.Vector3(Math.cos(this.professor.heading), 0, -Math.sin(this.professor.heading));
    const target = me.clone().addScaledVector(right, -3.5);
    if (this.vehicle) target.addScaledVector(right, -2);
    const r = this.raptor;
    if (r.feet.distanceTo(target) < 5 && r.grounded) {
      showToast("The Raptor is right here!");
      return;
    }
    const far = Math.hypot(r.pos.x - target.x, r.pos.z - target.z) > 220 || Math.abs(r.pos.y - target.y) > 100;
    if (far) {
      const dir = new THREE.Vector3(r.pos.x - target.x, 0, r.pos.z - target.z);
      if (dir.lengthSq() < 1) dir.set(1, 0, 0);
      dir.normalize();
      r.teleport(target.clone().addScaledVector(dir, 70).setY(target.y + 45 + r.footOffset), Math.atan2(-dir.x, -dir.z));
    }
    r.summon(target);
    if (s.raptorStatus === 'parked') gameStore.setState({ raptorStatus: 'idle' });
    if (quiet) return;
    showToast('You whistle for the Raptor. Here it comes!');
    this.audio.play('blip');
    this.audio.play('magic', 0.6);
  }

  // ───────────────────────────────────────────── up in the sky

  /**
   * Distance LOD for the land: high up, every scene child that would look tiny on screen (people,
   * cars, trees, small houses…) is moved off the camera's render layer, smallest first, so the town
   * thins out smoothly while climbing instead of vanishing at once. The ground, sea and big merged
   * blocks stay (they are a handful of draw calls and look like a planet surface from space).
   * Layers are used instead of `visible`, so systems that hide their own objects are not disturbed.
   */
  private cullLand(): void {
    const kids = this.scene.children;
    const n = kids.length;
    if (!n) return;
    const cam = this.camera.position;
    const high = cam.y > 110;
    if (!high && this.lodHidden === 0) return;
    const batch = Math.min(n, 160);
    for (let i = 0; i < batch; i++) {
      this.lodCursor = (this.lodCursor + 1) % n;
      const o = kids[this.lodCursor];
      if ((o as THREE.Light).isLight || !o.frustumCulled || o === this.professor.group || o === this.raptor.group || this.sky.owns(o) || o.position.y >= SPACE_Y - 40) continue;
      let r = o.userData.lodRadius as number | undefined;
      if (r === undefined) {
        const box = new THREE.Box3().setFromObject(o);
        r = box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length() / 2;
        o.userData.lodRadius = r;
        o.userData.lodCentre = box.isEmpty() ? o.position.clone() : box.getCenter(new THREE.Vector3()).sub(o.position);
      }
      const c = (o.userData.lodCentre as THREE.Vector3).clone().add(o.position);
      const hide = high && r < 400 && r / Math.max(1, c.distanceTo(cam)) < 0.006;
      if (hide === !!o.userData.lodOff) continue;
      o.userData.lodOff = hide;
      this.lodHidden += hide ? 1 : -1;
      o.traverse((d) => (hide ? d.layers.set(1) : d.layers.set(0)));
    }
  }

  private lodCursor = 0;
  private lodHidden = 0;

  /** "You've reached space" once per trip up, and a bonus the first time you land on each floating island. */
  private updateSkyProgress(): void {
    const y = this.playerPos.y;
    if (!this.inSpace && y > 300) {
      this.inSpace = true;
      showToast("You've reached space! Gravity is low up here: big jumps!");
      this.audio.play('magic');
    } else if (this.inSpace && y < 260) this.inSpace = false;

    const standing = this.onFoot ? this.professor : this.riding ? this.raptor : null;
    if (!standing || !standing.grounded) return;
    const isl = this.sky.islandAt(standing.feet);
    if (isl && !isl.discovered) {
      isl.discovered = true;
      addPoints(25);
      showToast(`Discovered ${isl.name}! +25 Lab Points`);
      this.audio.play('reward');
    }
  }

  // ───────────────────────────────────────────── throwing things around

  /** Race mode on turbo (boosting, or still faster than normal top speed) bulldozes everything. */
  private get ramming(): boolean {
    return this.riding && this.raptor.mode === 'race' && (this.raptor.boosting || this.raptor.raceSpeed > 45);
  }

  /** Throw whatever the turbo-charged Raptor is about to hit, before it can block it. */
  private ram(dt: number): void {
    const r = this.raptor;
    const ahead = r.pos.clone().addScaledVector(r.velocity, dt * 2);
    const fwd = new THREE.Vector3(Math.sin(r.heading), 0, Math.cos(r.heading));
    const speed = Math.abs(r.raceSpeed);
    let hits = 0;
    const throwDir = (p: THREE.Vector3) => {
      const side = new THREE.Vector3(p.x - r.pos.x, 0, p.z - r.pos.z).normalize();
      return fwd.clone().multiplyScalar(0.8).add(side.multiplyScalar(0.6)).normalize();
    };
    for (const car of this.traffic.near(ahead, 4.2)) {
      this.traffic.beginFling(car);
      const v = throwDir(car.agent.world).multiplyScalar(speed * 0.55 + 6).setY(18 + Math.random() * 6);
      this.fling.launch(car.mesh, car.mesh.position.clone(), v, 0, (p) => this.traffic.endFling(car, p), 0.7);
      hits++;
    }
    for (const veh of this.vehicles.near(ahead, 3.6)) {
      if (veh.kind !== 'car' && veh.pos.distanceTo(ahead) > 2.8) continue;
      this.vehicles.beginFling(veh);
      const v = throwDir(veh.pos).multiplyScalar(speed * 0.55 + 6).setY(18 + Math.random() * 6);
      this.fling.launch(veh.group, veh.group.position.clone(), v, 0, (p, h) => this.vehicles.endFling(veh, p, h), veh.kind === 'car' ? 0.7 : 1.2);
      hits++;
    }
    for (const w of this.pedestrians.near(ahead, 2.6)) {
      const body = this.pedestrians.beginFling(w);
      const v = throwDir(w.pos).multiplyScalar(speed * 0.4 + 6).setY(20 + Math.random() * 6);
      this.fling.launch(body, body.position.clone(), v, 0, (p) => this.pedestrians.endFling(w, p), 1.5);
      hits++;
    }
    for (const t of this.thugs.near(ahead, 2.6)) {
      this.thugs.hurt(t, 1, throwDir(t.pos));
      const body = this.thugs.beginFling(t);
      const v = throwDir(t.pos).multiplyScalar(speed * 0.4 + 6).setY(20 + Math.random() * 6);
      this.fling.launch(body, body.position.clone(), v, 0, (p) => this.thugs.endFling(t, p), 1.5);
      hits++;
    }
    for (const t of this.mystery.thievesNear(ahead, 2.6)) {
      const land = this.mystery.flingThief(t.thief);
      const v = throwDir(t.pos).multiplyScalar(speed * 0.4 + 6).setY(20 + Math.random() * 6);
      this.fling.launch(t.body, t.body.position.clone(), v, 0, (p) => land(p), 1.5);
      hits++;
    }
    this.onMeleeHit?.(ahead, 3, 2);
    if (hits) {
      this.particles.sparks(ahead.clone().setY(ahead.y + 0.5), 25 * hits);
      this.audio.play('crash', 0.7);
      this.rig.shake(0.3);
    }
  }

  /** Throw everything within `radius` of `centre` outwards and up (heavy landings). */
  private blast(centre: THREE.Vector3, radius: number, power: number, notify = true): void {
    const out = (p: THREE.Vector3, d: number, base: number) => {
      const dir = new THREE.Vector3(p.x - centre.x, 0, p.z - centre.z);
      if (dir.lengthSq() < 1e-4) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      const k = (1 - d / radius) * power;
      return dir.normalize().multiplyScalar(base * (0.5 + k)).setY(12 + 12 * k);
    };
    for (const car of this.traffic.near(centre, radius + 2)) {
      const d = car.agent.world.distanceTo(centre);
      this.traffic.beginFling(car);
      this.fling.launch(car.mesh, car.mesh.position.clone(), out(car.agent.world, d, 10), 0, (p) => this.traffic.endFling(car, p), 0.7);
    }
    for (const veh of this.vehicles.near(centre, radius + 1)) {
      const d = veh.pos.distanceTo(centre);
      this.vehicles.beginFling(veh);
      this.fling.launch(veh.group, veh.group.position.clone(), out(veh.pos, d, 10), 0, (p, h) => this.vehicles.endFling(veh, p, h), 1);
    }
    for (const w of this.pedestrians.near(centre, radius)) {
      const d = w.pos.distanceTo(centre);
      const body = this.pedestrians.beginFling(w);
      this.fling.launch(body, body.position.clone(), out(w.pos, d, 12), 0, (p) => this.pedestrians.endFling(w, p), 1.5);
    }
    for (const t of this.thugs.near(centre, radius)) {
      const d = t.pos.distanceTo(centre);
      this.thugs.hurt(t, 1, new THREE.Vector3(t.pos.x - centre.x, 0, t.pos.z - centre.z));
      const body = this.thugs.beginFling(t);
      this.fling.launch(body, body.position.clone(), out(t.pos, d, 12), 0, (p) => this.thugs.endFling(t, p), 1.5);
    }
    if (notify) this.onMeleeHit?.(centre, radius, power * 2);
    for (const t of this.mystery.thievesNear(centre, radius)) {
      const d = t.pos.distanceTo(centre);
      const land = this.mystery.flingThief(t.thief);
      this.fling.launch(t.body, t.body.position.clone(), out(t.pos, d, 12), 0, (p) => land(p), 1.5);
    }
  }

  private updateImpacts(dt: number): void {
    for (const fx of this.impacts.slice()) {
      fx.t += dt;
      const k = Math.min(fx.t / 0.6, 1);
      fx.ring.scale.setScalar(1 + k * (14 + 10 * fx.strength));
      (fx.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      (fx.crater.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.min(1, Math.max(0, (5 - fx.t) / 1.5));
      if (fx.t > 5) {
        this.scene.remove(fx.ring, fx.crater);
        fx.ring.geometry.dispose();
        fx.crater.geometry.dispose();
        (fx.ring.material as THREE.Material).dispose();
        (fx.crater.material as THREE.Material).dispose();
        this.impacts.splice(this.impacts.indexOf(fx), 1);
      }
    }
  }

  private handleRaptorEvents(): void {
    const ev = this.raptor.events.splice(0);
    for (const e of ev) {
      const feet = this.raptor.group.position;
      if (e === 'impact') this.impact(feet, this.raptor.impactSpeed);
      if (e === 'transform') {
        this.particles.sparks(feet.clone().setY(feet.y + 2), 40, '#5ef2ff');
        this.particles.sparks(feet.clone().setY(feet.y + 2), 20, '#ffd166');
      }
      if (e === 'landed' || (e === 'stomp' && this.raptor.mode === 'walk' && this.riding)) {
        this.particles.soft.emit({ pos: feet.clone().setY(feet.y + 0.2), vel: new THREE.Vector3(0, 1, 0), spread: 1.5, color: '#d8c8a8', size: 0.8, grow: 1.5, life: 0.7, drag: 2, count: e === 'landed' ? 14 : 3, alpha: 0.6 });
      }
      if (e === 'crash') this.particles.sparks(feet.clone().setY(feet.y + 1), 30);
      if (e === 'wet' && this.riding && this.elapsed - this.lastWetHint > 30) {
        this.lastWetHint = this.elapsed;
        showToast('Splash! Press 2 to fly over the sea, or hop on a boat at the pier');
      }
      for (const l of this.raptorEventListeners) l(e);
    }
  }

  private wakeTimer = 0;

  /** White wake behind a moving boat. */
  private boatWake(v: Vehicle): void {
    if ((this.wakeTimer = (this.wakeTimer + 1) % 2) !== 0) return;
    const sp = Math.min(Math.abs(v.speed) / 30, 1.4);
    const back = v.localToWorld(new THREE.Vector3(0, 0, -3));
    back.y = WATER_Y + 0.1;
    this.particles.soft.emit({ pos: back, vel: new THREE.Vector3(0, 1.5, 0), spread: 1.2 * sp, color: '#ffffff', size: 1.2, grow: 1.8, life: 1.4, drag: 1.2, count: 2, alpha: 0.75 });
  }

  private emitEffects(dt: number): void {
    this.fxTimer -= dt;
    if (this.fxTimer > 0) return;
    this.fxTimer = 0.03;
    const r = this.raptor;
    if (r.boosting) {
      for (const sx of [-0.4, 0.4]) {
        const p = r.localToWorld(new THREE.Vector3(sx, r.mode === 'race' ? 1.25 : 2.1, -1.9));
        const back = new THREE.Vector3(0, 0, -6).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.heading);
        this.particles.glow.emit({ pos: p, vel: back.add(r.velocity.clone().multiplyScalar(0.5)), spread: 0.8, color: '#ff8c42', size: 0.7, grow: -0.6, life: 0.35, count: 2 });
      }
    }
    if (r.mode === 'flight' && this.riding) {
      for (const sx of [-0.85, 0.85]) {
        const p = r.localToWorld(new THREE.Vector3(sx, 1.4, -0.1));
        this.particles.glow.emit({ pos: p, vel: new THREE.Vector3(0, -8, 0).add(r.velocity.clone().multiplyScalar(0.6)), spread: 0.6, color: '#ffd166', size: 0.45, grow: -0.4, life: 0.25 });
      }
    }
    // Swimming splashes
    if (this.onFoot && this.professor.swimming && this.professor.horizontalSpeed > 0.5) {
      const p = this.professor.pos.clone().setY(WATER_Y + 0.1);
      this.particles.soft.emit({ pos: p, vel: new THREE.Vector3(0, 1.2, 0), spread: 0.8, color: '#ffffff', size: 0.5, grow: 0.8, life: 0.6, count: 1, alpha: 0.7 });
    }
    if (r.drifting) {
      for (const sx of [-0.95, 0.95]) {
        const p = r.localToWorld(new THREE.Vector3(sx, 0.3, -0.9));
        this.particles.soft.emit({ pos: p, vel: new THREE.Vector3(0, 1, 0), spread: 0.6, color: '#e9ecef', size: 1, grow: 2.5, life: 1.0, drag: 1.5, alpha: 0.5 });
      }
    }
  }

  // ───────────────────────────────────────────── scene setup + UI

  private setupLighting(): void {
    this.scene.background = new THREE.Color('#bfe3ff');
    this.scene.fog = new THREE.Fog('#bfe3ff', 180, 560);
    this.scene.add(new THREE.HemisphereLight('#dff1ff', '#7fbf5f', 1.6));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -60;
    s.right = s.top = 60;
    s.near = 1;
    s.far = 240;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
  }

  /** Extra minimap markers from later systems. */
  readonly markerSources: (() => MinimapMarker[])[] = [];

  private drawMinimap(): void {
    const me = this.outside ? this.outside.pos : this.vehicle ? this.vehicle.group.position : this.riding ? this.raptor.group.position : this.professor.group.position;
    const heading = this.vehicle ? this.vehicle.heading : this.riding ? this.raptor.heading : this.professor.heading;
    const { lab } = this.world.landmarks;
    const s = gameStore.getState();
    const grandma = this.npcs.position('grandma');
    const markers: MinimapMarker[] = [
      { x: lab.x, z: lab.z - 8, color: '#2f80ed', label: 'L', pinToEdge: true },
      { x: grandma.x, z: grandma.z, color: '#e75480', label: 'G', pinToEdge: true },
    ];
    if (!this.riding && (s.raptorStatus === 'idle' || s.raptorStatus === 'parked')) {
      const r = this.raptor.group.position;
      markers.push({ x: r.x, z: r.z, color: '#2a9d8f', label: 'R', pinToEdge: true });
    }
    const gate = this.race.nextGate;
    if (gate) markers.push({ x: gate.x, z: gate.z, color: '#ffb703', label: '▲', pinToEdge: true });
    if (this.riding && s.water < 35) {
      const nearest = this.world.refillPoints.reduce((a, b) => (a.distanceToSquared(me) < b.distanceToSquared(me) ? a : b));
      markers.push({ x: nearest.x, z: nearest.z, color: '#4cc9f0', label: 'W', pinToEdge: true });
    }
    for (const src of this.markerSources) markers.push(...src());
    this.minimap.draw(me.x, me.z, this.rig.yaw, heading, markers);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
    this.graphics?.resize(w, h);
  }
}
