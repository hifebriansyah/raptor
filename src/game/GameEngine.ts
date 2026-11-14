import * as THREE from 'three';
import { MechaRaptor, RAPTOR_MODES, type RaptorMode } from '../entities/MechaRaptor';
import { NPCManager, type NpcId } from '../entities/NPCManager';
import { Professor } from '../entities/Professor';
import { gameStore, showToast, type ControlMode } from '../state/gameStore';
import { AudioSystem } from '../systems/AudioSystem';
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
import { InputManager } from './InputManager';
import { WATER_Y, isLand } from './Terrain';
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

/**
 * Owns the scene, the fixed-timestep simulation loop and the gameplay rules that tie the systems
 * together: mounting/parking, mode switching, the water gun, refilling and interactions.
 */
export class GameEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
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
  /** The car/bike/motorbike the Professor is driving, if any. */
  vehicle: Vehicle | null = null;
  readonly director: EventDirector;
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
      // Race mode: Space hops straight back to Walk mode (drift is on Ctrl/C there)
      if (this.raptor.mode === 'race' && this.input.jump) {
        this.raptor.setMode('walk');
        this.input.consumeJump();
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
    if (!this.riding && s.raptorStatus === 'idle' && this.raptor.depth < 0.3 && this.raptor.mode === 'walk') this.raptor.wander(dt);

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
      thruster -= 24 * (1 - 0.15 * up.thruster) * dt;
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
      const feet = this.raptor.localToWorld(o);
      // mid-air (flight): drop to the ground below
      if (o.y === 0 && !this.raptor.grounded) {
        const down = this.physics.rayDistance(feet.clone().setY(feet.y + 0.5), feet.clone().setY(-1));
        feet.y = feet.y + 0.5 - down;
      }
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

  private handleRaptorEvents(): void {
    const ev = this.raptor.events.splice(0);
    for (const e of ev) {
      const feet = this.raptor.group.position;
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
