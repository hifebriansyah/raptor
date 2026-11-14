import * as THREE from 'three';
import { MAX_FALL } from '../entities/CharacterEntity';
import { MechaRaptor, RAPTOR_MODES, type RaptorMode } from '../entities/MechaRaptor';
import { NPCManager, type NpcId } from '../entities/NPCManager';
import { Professor } from '../entities/Professor';
import { addPoints, gameStore, showToast, type ControlMode } from '../state/gameStore';
import { AudioSystem } from '../systems/AudioSystem';
import { FlingSystem } from '../systems/FlingSystem';
import { MysterySystem } from '../systems/MysterySystem';
import { Particles } from '../systems/ParticleSystem';
import { PedestrianSystem } from '../systems/PedestrianSystem';
import { PhysicsSystem } from '../systems/PhysicsSystem';
import { RaceSystem } from '../systems/RaceSystem';
import { TrafficSystem } from '../systems/TrafficSystem';
import { VEHICLE_LABEL, Vehicle, VehicleSystem } from '../systems/VehicleSystem';
import { WaterSystem, type WaterTarget } from '../systems/WaterSystem';
import { DialogueBox, DialogueController } from '../ui/DialogueBox';
import { HUD } from '../ui/HUD';
import { PremonitionModal } from '../ui/PremonitionModal';
import { TouchControls } from '../ui/TouchControls';
import { UPGRADES, UpgradeBench, buyUpgrade } from '../ui/UpgradeBench';
import { Minimap, type MinimapMarker } from '../ui/Minimap';
import { CameraRig } from './CameraRig';
import { EventDirector } from './EventDirector';
import { SkyIslands } from './SkyIslands';
import { InputManager } from './InputManager';
import { SPACE_Y, WATER_Y, isLand, surfaceAt } from './Terrain';
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

const MODE_CONTROL: Record<RaptorMode, ControlMode> = { walk: 'raptorWalk', flight: 'raptorFlight', race: 'raptorRace', boat: 'raptorBoat' };

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
  /** The car/bike/motorbike the Professor is driving, if any. */
  vehicle: Vehicle | null = null;
  readonly director: EventDirector;
  readonly sky: SkyIslands;
  private inSpace = false;
  private landShown = true;
  private sceneCount = 0;
  readonly npcs: NPCManager;
  readonly dialogue = new DialogueController();
  readonly mystery: MysterySystem;
  private talkingTo: NpcId | null = null;
  readonly audio = new AudioSystem();
  private readonly hud: HUD;
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
    this.fling.onBounce = (p, hard) => {
      const v = Math.max(0, 1 - p.distanceTo(this.camera.position) / 80);
      if (v > 0 && hard) this.audio.play('stomp', v);
    };

    this.director = new EventDirector(this.scene, this.world, this.water, this.particles);
    this.npcs = new NPCManager(this.scene, this.world.landmarks);
    this.mystery = new MysterySystem(this, this.dialogue);
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
    this.interactionSources.push(() => this.benchInteraction());
    this.hookAudio(bench);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  static async create(container: HTMLElement): Promise<GameEngine> {
    const physics = await PhysicsSystem.create();
    return new GameEngine(container, physics);
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** On the Raptor. */
  get riding(): boolean {
    return this.professor.riding && this.vehicle === null;
  }

  /** Walking around (not on the Raptor or in a vehicle). */
  get onFoot(): boolean {
    return !this.professor.riding;
  }

  /** Where the player is (whatever they are on). */
  get playerPos(): THREE.Vector3 {
    return this.vehicle ? this.vehicle.pos : this.riding ? this.raptor.pos : this.professor.pos;
  }

  // ───────────────────────────────────────────── loop

  frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.elapsed += dt;
    this.input.poll(dt);

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
    const focus = v
      ? v.group.position.clone().add(new THREE.Vector3(0, v.kind === 'car' ? 2.0 : 1.7, 0))
      : this.riding
        ? this.raptor.group.position.clone().add(new THREE.Vector3(0, this.raptor.mode === 'race' || this.raptor.mode === 'boat' ? 2.6 : 3.4, 0))
        : this.professor.group.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    this.world.update(this.playerPos);

    const mode = this.raptor.mode;
    this.rig.update(
      dt,
      this.input.consumeMouse(),
      focus,
      {
        distance: v ? (v.kind === 'car' ? 9 : 6.5) : !this.riding ? 6 : mode === 'flight' ? 15 : mode === 'race' || mode === 'boat' ? 12 : 11,
        // Swing back behind while moving, but not while free-aiming (the aim stays put) or, with
        // LEGO controls, while moving sideways across the screen (that would make you run in circles)
        recenterTo: this.holdCamera()
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
        recenterRate: v || (this.riding && (mode === 'race' || mode === 'boat')) ? 3 : !this.riding ? 2 : 1.2,
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
    this.race.render(this.elapsed);
    this.world.animate(this.elapsed);
    this.sky.update(this.elapsed, this.camera, this.scene);
    this.cullLand();
    this.director.render(dt, this.elapsed);
    this.npcs.update(dt, this.elapsed, this.professor.pos, this.dialogue.open ? this.talkingTo : null);
    this.mystery.render(dt);

    this.updateAudioLoops();
    this.hud.frame(dt, this.input.locked);
    this.drawMinimap();
    this.renderer.render(this.scene, this.camera);
  }

  private fixedStep(dt: number): void {
    const s = gameStore.getState();
    const speedMult = s.sugarRush > 0 ? 1.3 : 1;

    // Conversations and the premonition pause player control
    const modal = !!(s.dialogue || s.premonition || s.upgradeBenchOpen);
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

    // Mode switching while riding the Raptor
    if (this.riding) {
      // Double-tap Space in Race or Boat mode: back to Walk mode (drift is on Ctrl/C in Race)
      if (this.input.jump) {
        const double = this.elapsed - this.lastJumpPress < 0.35;
        this.lastJumpPress = this.elapsed;
        if (double && (this.raptor.mode === 'race' || this.raptor.mode === 'boat')) {
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

    if (this.ramming) this.ram(dt);
    if (this.input.callRaptor && !this.riding) this.callRaptor();
    if (this.input.toggleFollow && !this.riding) this.toggleFollow();
    this.updateFollowTarget();
    this.professor.aiming = this.onFoot && this.input.fire;
    this.professor.update(dt, this.input, { camYaw: this.rig.yaw, face: this.onFoot ? face : null });
    if (this.vehicle) {
      this.vehicle.drive(dt, this.input, speedMult);
      this.professor.follow(this.vehicle.pos);
      if (this.input.wasPressed('KeyH')) this.audio.play(this.vehicle.kind === 'bike' ? 'blip' : 'honk');
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
    this.pedestrians.update(dt, { threats, professorPos: this.professor.pos, professorOnFoot: this.onFoot });
    const racer = this.vehicle?.kind === 'car' ? this.vehicle.feet : this.raptor.feet;
    this.race.update(dt, racer, (this.riding && this.raptor.mode === 'race') || this.vehicle?.kind === 'car');
    this.director.update(dt, this.playerPos);
    this.updateSkyProgress();
    this.mystery.update(dt);

    this.handleInteraction();
    this.physics.step(dt);
    this.water.update(dt);
    this.input.endStep();

    const control: ControlMode = this.vehicle
      ? this.vehicle.kind === 'car'
        ? 'driveCar'
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
      this.raptorOnPad() || this.world.refillPoints.some((p) => Math.hypot(p.x - feet.x, p.z - feet.z) < REFILL_RANGE && feet.y < 4);
    const refilling = nearRefill && water < 100;
    if (refilling) {
      water += 45 * (1 + 0.5 * up.tank) * dt;
      if (Math.random() < 0.3) this.particles.splash(feet.clone().setY(feet.y + 2.5), 2);
    }
    if (this.raptorOnPad() && !this.riding) thruster = 100;

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
    return this.vehicle !== null || (this.riding && (this.raptor.mode === 'race' || this.raptor.mode === 'boat'));
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
      const surface = isLand(from.x, from.z) ? 0 : WATER_Y;
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
    if (this.vehicle) {
      const v = this.vehicle;
      const rival = v.kind === 'car' ? this.race.challengeable(v.feet, true) : null;
      if (rival) candidates.push({ prompt: `Challenge ${rival.name} to a race`, priority: 0, run: () => this.race.start(rival, v.feet) });
      candidates.push({ prompt: `Get off the ${VEHICLE_LABEL[v.kind]}`.replace('Get off the car', 'Get out of the car'), priority: 5, run: () => this.exitVehicle() });
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
    const motor = v && v.kind !== 'bike' ? Math.abs(v.speed) : this.riding && (this.raptor.mode === 'race' || this.raptor.mode === 'boat') ? speed : -1;
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
      const verb = parked.kind === 'car' ? 'Drive the car' : `Ride the ${VEHICLE_LABEL[parked.kind]}`;
      return { prompt: verb, priority: 1.5, run: () => this.enterVehicle(parked) };
    }
    const car = this.traffic.takeable(feet);
    if (car) return { prompt: 'Take the car', priority: 1.5, run: () => this.takeTrafficCar(car) };
    return null;
  }

  enterVehicle(v: Vehicle): void {
    this.vehicle = v;
    v.driven = true;
    this.professor.mount(v.kind === 'car' ? v.group : v.seat, v.kind);
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
    const side = v.kind === 'car' ? 2.0 : 1.0;
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
        const area = this.director.fireArea;
        if (area && npc.id !== 'grandma') lines = [{ speaker: npc.name, text: `There's smoke over ${area}! Hurry, Professor!` }];
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
    if (!(this.raptor.mode === 'boat' && this.raptor.depth > 0.5)) this.raptor.resetToWalk();
    this.professor.dismount(this.scene, spot, this.raptor.heading);
    // Getting off high in the air: pop the parachute (in space it opens by itself on re-entry)
    const height = spot.y - surfaceAt(spot.x, spot.z);
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
   * plunging, and a huge crater impact at the bottom. Works for the Raptor (when ridden or alone) and the Professor on foot.
   */
  private meteorFall(dt: number): void {
    const body = this.vehicle ? null : this.riding ? this.raptor : this.professor;
    if (this.professor.riding) this.professor.lastImpact = 0; // the Raptor reports its own landing
    else if (this.professor.lastImpact) {
      if (!this.vehicle) this.impact(this.professor.group.position, this.professor.lastImpact);
      this.professor.lastImpact = 0;
    }
    if (!body) return;
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
    const ground = pos.clone().setY(surfaceAt(pos.x, pos.z) + 0.06);
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
    if (this.riding || st === 'stolen' || st === 'attic') {
      if (st === 'stolen' || st === 'attic') this.following = false;
      this.raptor.followTarget = null;
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
   * Deep in space the town below is a few pixels: skip drawing it. "Land" is every scene child that is low
   * (y < SPACE_Y), not a light, not a sky layer, not the player rigs, and not an effect buffer (particles,
   * water spray: frustumCulled is off for those).
   */
  private cullLand(): void {
    const show = this.sky.landVisible;
    const n = this.scene.children.length;
    if (show ? this.landShown : this.landShown === false && n === this.sceneCount) return;
    this.landShown = show;
    this.sceneCount = n;
    for (const o of this.scene.children) {
      if ((o as THREE.Light).isLight || !o.frustumCulled || o === this.professor.group || o === this.raptor.group || this.sky.owns(o) || o.position.y >= SPACE_Y) continue;
      o.visible = show;
    }
  }

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
    for (const t of this.mystery.thievesNear(ahead, 2.6)) {
      const land = this.mystery.flingThief(t.thief);
      const v = throwDir(t.pos).multiplyScalar(speed * 0.4 + 6).setY(20 + Math.random() * 6);
      this.fling.launch(t.body, t.body.position.clone(), v, 0, (p) => land(p), 1.5);
      hits++;
    }
    if (hits) {
      this.particles.sparks(ahead.clone().setY(ahead.y + 0.5), 25 * hits);
      this.audio.play('crash', 0.7);
      this.rig.shake(0.3);
    }
  }

  /** Throw everything within `radius` of `centre` outwards and up (heavy landings). */
  private blast(centre: THREE.Vector3, radius: number, power: number): void {
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
        showToast('Splash! Press 4 to turn the Raptor into a boat');
      }
      for (const l of this.raptorEventListeners) l(e);
    }
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
    // Boat wake and spray, swimming splashes
    if (r.mode === 'boat' && this.riding && Math.abs(r.raceSpeed) > 2 && r.depth > 0.5) {
      const sp = Math.min(Math.abs(r.raceSpeed) / 30, 1.4);
      const back = r.localToWorld(new THREE.Vector3(0, 0.1, -2.6));
      back.y = WATER_Y + 0.1;
      this.particles.soft.emit({ pos: back, vel: new THREE.Vector3(0, 1.5, 0), spread: 1.2 * sp, color: '#ffffff', size: 1.2, grow: 1.8, life: 1.4, drag: 1.2, count: 2, alpha: 0.75 });
      for (const sx of [-1.2, 1.2]) {
        const bow = r.localToWorld(new THREE.Vector3(sx, 0.1, 1.6));
        bow.y = WATER_Y + 0.1;
        const out = new THREE.Vector3(sx * 3, 2.5, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.heading);
        this.particles.soft.emit({ pos: bow, vel: out.multiplyScalar(sp), spread: 0.8, color: '#e8f7ff', size: 0.45, life: 0.6, gravity: -9, count: 1, alpha: 0.9 });
      }
    }
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
    const me = this.vehicle ? this.vehicle.group.position : this.riding ? this.raptor.group.position : this.professor.group.position;
    const heading = this.vehicle ? this.vehicle.heading : this.riding ? this.raptor.heading : this.professor.heading;
    const { lab, grandma } = this.world.landmarks;
    const s = gameStore.getState();
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
  }
}
