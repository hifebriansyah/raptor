import * as THREE from 'three';
import { part } from './CharacterEntity';
import { Humanoid, randomLook } from './Humanoid';
import { Models } from '../game/Models';

/** Kenney Car Kit models for each kind (one picked at random); the city bus stays hand-built. */
const KENNEY_CARS: Partial<Record<CarModel, string[]>> = {
  sedan: ['sedan', 'suv', 'taxi', 'suv-luxury'],
  sports: ['sedan-sports'],
  roadster: ['hatchback-sports'],
  racecar: ['race', 'race-future'],
  firetruck: ['firetruck'],
  police: ['police'],
  van: ['van', 'delivery', 'ambulance', 'garbage-truck', 'truck'],
};
const KENNEY_BOATS: Record<BoatModel, string[]> = {
  speedboat: ['boat-speed-a', 'boat-speed-c', 'boat-speed-e'],
  fishing: ['boat-fishing-small'],
  yacht: ['boat-sail-a'],
  coastguard: ['boat-tug-a'],
};

export type CarModel = 'sedan' | 'sports' | 'roadster' | 'racecar' | 'bus' | 'firetruck' | 'police' | 'van';
export type BoatModel = 'speedboat' | 'fishing' | 'yacht' | 'coastguard';

/** Driving feel per model (used when the Professor takes one). */
export interface CarSpec {
  label: string;
  top: number;
  sprintTop: number;
  accel: number;
  steer: number;
  /** Half-size of the collision box (x, z) for traffic. */
  half: [number, number];
  /** Traffic cruising speed range (m/s). */
  cruise: [number, number];
}

export const CAR_SPECS: Record<CarModel, CarSpec> = {
  sedan: { label: 'car', top: 24, sprintTop: 30, accel: 13, steer: 1.9, half: [1.0, 2.1], cruise: [9, 13] },
  sports: { label: 'sports car', top: 30, sprintTop: 38, accel: 18, steer: 2.1, half: [1.0, 2.1], cruise: [22, 26] },
  roadster: { label: 'roadster', top: 28, sprintTop: 35, accel: 16, steer: 2.2, half: [0.95, 1.9], cruise: [11, 15] },
  racecar: { label: 'race car', top: 36, sprintTop: 46, accel: 24, steer: 2.3, half: [1.0, 2.2], cruise: [14, 18] },
  bus: { label: 'city bus', top: 16, sprintTop: 20, accel: 6, steer: 1.2, half: [1.4, 5.0], cruise: [7, 9] },
  firetruck: { label: 'fire truck', top: 20, sprintTop: 26, accel: 8, steer: 1.4, half: [1.3, 4.0], cruise: [9, 11] },
  police: { label: 'police car', top: 30, sprintTop: 38, accel: 17, steer: 2.0, half: [1.0, 2.1], cruise: [11, 14] },
  van: { label: 'van', top: 20, sprintTop: 25, accel: 10, steer: 1.6, half: [1.1, 2.5], cruise: [8, 11] },
};

export const BOAT_LABEL: Record<BoatModel, string> = { speedboat: 'speedboat', fishing: 'fishing boat', yacht: 'yacht', coastguard: 'coastguard boat' };
export const BOAT_TOP: Record<BoatModel, [number, number]> = { speedboat: [30, 40], fishing: [12, 16], yacht: [18, 24], coastguard: [26, 34] };

/** Shared see-through glass. */
const GLASS = new THREE.MeshLambertMaterial({ color: '#bfe9ff', transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });

export interface VehicleModel {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  /** Where a driver's hips go (child of group). */
  driverSeat: THREE.Object3D;
  /** The AI driver sitting inside (traffic), if any. */
  driver: Humanoid | null;
  /** Flashing lights (police / fire truck) to animate. */
  beacons: THREE.Mesh[];
  /** Closed (Kenney) cabin: whoever sits inside isn't drawn. */
  hideRider?: boolean;
}

function glass(w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), GLASS);
  m.position.set(x, y, z);
  m.renderOrder = 2;
  return m;
}

/** A glass cabin with corner pillars and a roof; seats, a dashboard and a steering wheel inside. */
function cabin(g: THREE.Group, o: { w: number; h: number; d: number; y: number; z: number; color: string; roof?: boolean; seats?: number }): THREE.Object3D {
  const { w, h, d, y, z, color } = o;
  const pillar = 0.09;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(part(new THREE.BoxGeometry(pillar, h, pillar), color, (sx * (w - pillar)) / 2, y + h / 2, z + (sz * (d - pillar)) / 2));
  }
  if (o.roof !== false) g.add(part(new THREE.BoxGeometry(w, 0.08, d), color, 0, y + h, z));
  // windows: windscreen, rear and both sides
  g.add(glass(w - pillar * 2, h, 0.03, 0, y + h / 2, z + d / 2 - 0.02));
  g.add(glass(w - pillar * 2, h, 0.03, 0, y + h / 2, z - d / 2 + 0.02));
  for (const sx of [-1, 1]) g.add(glass(0.03, h, d - pillar * 2, (sx * (w - 0.03)) / 2, y + h / 2, z));
  // interior: seats, dashboard, steering wheel
  const seatRows = o.seats ?? 1;
  for (let r = 0; r < seatRows; r++) {
    const sz = z + d / 2 - 0.85 - r * 0.9;
    for (const sx of [-0.4, 0.4]) {
      g.add(part(new THREE.BoxGeometry(0.5, 0.12, 0.5), '#3d405b', sx, y + 0.02, sz));
      g.add(part(new THREE.BoxGeometry(0.5, 0.6, 0.1), '#3d405b', sx, y + 0.3, sz - 0.28));
    }
  }
  g.add(part(new THREE.BoxGeometry(w - 0.2, 0.18, 0.25), '#2b2d42', 0, y + 0.25, z + d / 2 - 0.2));
  const wheel = part(new THREE.TorusGeometry(0.17, 0.03, 6, 12), '#111111', -0.4, y + 0.4, z + d / 2 - 0.45);
  wheel.rotation.x = -0.5;
  g.add(wheel);
  const seat = new THREE.Object3D();
  seat.position.set(-0.4, y + 0.08, z + d / 2 - 0.85);
  g.add(seat);
  return seat;
}

function addWheels(g: THREE.Group, wheels: THREE.Object3D[], pos: [number, number][], r = 0.38, width = 0.3): void {
  for (const [wx, wz] of pos) {
    const w = new THREE.Group();
    w.position.set(wx, r, wz);
    w.add(part(new THREE.CylinderGeometry(r, r, width, 10).rotateZ(Math.PI / 2), '#222222'));
    w.add(part(new THREE.BoxGeometry(width + 0.02, r * 0.35, r * 0.35), '#bbbbbb'));
    wheels.push(w);
    g.add(w);
  }
}

function lights(g: THREE.Group, y: number, front: number, back: number, spread = 0.65): void {
  for (const sx of [-spread, spread]) {
    g.add(part(new THREE.BoxGeometry(0.4, 0.18, 0.05), '#fff8d6', sx, y, front, true));
    g.add(part(new THREE.BoxGeometry(0.4, 0.15, 0.05), '#ff3b3b', sx, y, back, true));
  }
}

/** Seat a random (or given) driver in the model. */
export function seatDriver(m: VehicleModel, look = randomLook()): Humanoid {
  const h = new Humanoid({ ...look, scale: 1 });
  h.root.visible = !m.hideRider;
  h.root.position.y = -0.9;
  h.sit();
  m.driverSeat.add(h.root);
  m.driver = h;
  return h;
}

export function removeDriver(m: VehicleModel): void {
  if (!m.driver) return;
  m.driverSeat.remove(m.driver.root);
  m.driver = null;
}

/** A Kenney car, scaled to the kind's length; wheels spin, police/fire get flashing beacons. */
function kenneyCar(model: CarModel): VehicleModel | null {
  const names = KENNEY_CARS[model];
  if (!names) return null;
  const name = names[Math.floor(Math.random() * names.length)];
  if (!Models.has(name)) return null;
  const len = CAR_SPECS[model].half[1] * 2;
  const g = Models.get(name, { length: len });
  const wheels = Models.nodes(g, 'wheel');
  const size = Models.size(name).multiplyScalar(len / Models.size(name).z);
  const seat = new THREE.Object3D();
  seat.position.set(-0.35, size.y * 0.32, size.z * 0.05);
  g.add(seat);
  const beacons: THREE.Mesh[] = [];
  if (model === 'police' || model === 'firetruck' || name === 'ambulance') {
    for (const sx of [-0.3, 0.3]) {
      const b = part(new THREE.BoxGeometry(0.45, 0.14, 0.25), sx < 0 ? '#ff3b3b' : '#4361ee', sx * size.x, size.y + 0.05, model === 'firetruck' ? size.z * 0.3 : 0, true);
      beacons.push(b);
      g.add(b);
    }
  }
  return { group: g, wheels, driverSeat: seat, driver: null, beacons, hideRider: true };
}

export function buildCarModel(model: CarModel, color: string): VehicleModel {
  const k = kenneyCar(model);
  if (k) return k;
  const g = new THREE.Group();
  const wheels: THREE.Object3D[] = [];
  const beacons: THREE.Mesh[] = [];
  let seat: THREE.Object3D;
  switch (model) {
    case 'bus': {
      g.add(part(new THREE.BoxGeometry(2.6, 0.9, 10), color, 0, 0.85, 0));
      g.add(part(new THREE.BoxGeometry(2.6, 0.25, 10), '#ffffff', 0, 1.42, 0));
      seat = cabin(g, { w: 2.6, h: 1.3, d: 9.8, y: 1.55, z: 0, color, seats: 6 });
      g.add(part(new THREE.BoxGeometry(2.0, 0.3, 0.06), '#111111', 0, 2.95, 5.0)); // destination board
      g.add(part(new THREE.BoxGeometry(1.8, 0.2, 0.07), '#ffd166', 0, 2.95, 5.02, true));
      addWheels(g, wheels, [[-1.2, 3.4], [1.2, 3.4], [-1.2, -3.4], [1.2, -3.4]], 0.5, 0.4);
      lights(g, 0.8, 5.02, -5.02, 0.9);
      break;
    }
    case 'firetruck': {
      g.add(part(new THREE.BoxGeometry(2.4, 1.0, 8), color, 0, 0.95, 0));
      seat = cabin(g, { w: 2.4, h: 1.1, d: 2.2, y: 1.45, z: 2.8, color, seats: 2 });
      g.add(part(new THREE.BoxGeometry(2.3, 1.1, 5.4), color, 0, 2.0, -1.2));
      g.add(part(new THREE.BoxGeometry(2.42, 0.12, 5.4), '#ffffff', 0, 1.7, -1.2));
      const ladder = new THREE.Group();
      ladder.position.set(0, 2.7, -1.2);
      for (const sx of [-0.35, 0.35]) ladder.add(part(new THREE.BoxGeometry(0.08, 0.08, 6), '#dee2e6', sx, 0, 0));
      for (let i = 0; i < 10; i++) ladder.add(part(new THREE.BoxGeometry(0.7, 0.05, 0.05), '#dee2e6', 0, 0, -2.8 + i * 0.62));
      g.add(ladder);
      for (const sx of [-0.6, 0.6]) {
        const b = part(new THREE.BoxGeometry(0.4, 0.18, 0.3), sx < 0 ? '#ff3b3b' : '#4cc9f0', sx, 2.66, 2.8, true);
        beacons.push(b);
        g.add(b);
      }
      addWheels(g, wheels, [[-1.1, 2.7], [1.1, 2.7], [-1.1, -2.6], [1.1, -2.6]], 0.48, 0.38);
      lights(g, 0.9, 4.02, -4.02, 0.85);
      break;
    }
    case 'van': {
      g.add(part(new THREE.BoxGeometry(2.2, 0.9, 5), color, 0, 0.8, 0));
      seat = cabin(g, { w: 2.2, h: 1.0, d: 1.6, y: 1.25, z: 1.6, color });
      g.add(part(new THREE.BoxGeometry(2.2, 1.6, 3.2), color, 0, 2.05, -0.8));
      g.add(part(new THREE.BoxGeometry(2.22, 0.3, 2.6), '#ffffff', 0, 2.1, -0.8));
      addWheels(g, wheels, [[-1.05, 1.7], [1.05, 1.7], [-1.05, -1.7], [1.05, -1.7]], 0.42);
      lights(g, 0.85, 2.52, -2.52);
      break;
    }
    case 'roadster': {
      g.add(part(new THREE.BoxGeometry(1.9, 0.6, 3.8), color, 0, 0.62, 0));
      g.add(part(new THREE.BoxGeometry(1.7, 0.25, 1.2), color, 0, 1.0, 1.1)); // bonnet bump
      // open top: low windscreen only
      g.add(glass(1.6, 0.45, 0.04, 0, 1.15, 0.45));
      for (const sx of [-0.4, 0.4]) {
        g.add(part(new THREE.BoxGeometry(0.5, 0.12, 0.5), '#5c4033', sx, 0.95, -0.25));
        g.add(part(new THREE.BoxGeometry(0.5, 0.55, 0.1), '#5c4033', sx, 1.2, -0.53));
      }
      const wheel = part(new THREE.TorusGeometry(0.17, 0.03, 6, 12), '#111111', -0.4, 1.3, 0.15);
      wheel.rotation.x = -0.5;
      g.add(wheel);
      seat = new THREE.Object3D();
      seat.position.set(-0.4, 1.0, -0.25);
      g.add(seat);
      addWheels(g, wheels, [[-0.95, 1.25], [0.95, 1.25], [-0.95, -1.25], [0.95, -1.25]], 0.36);
      lights(g, 0.7, 1.92, -1.92, 0.6);
      break;
    }
    case 'racecar': {
      g.add(part(new THREE.BoxGeometry(1.2, 0.5, 4.2), color, 0, 0.5, 0));
      g.add(part(new THREE.BoxGeometry(2.0, 0.08, 0.6), color, 0, 0.35, 2.1)); // front wing
      g.add(part(new THREE.BoxGeometry(2.0, 0.08, 0.5), '#111111', 0, 1.2, -1.9)); // rear wing
      for (const sx of [-0.8, 0.8]) g.add(part(new THREE.BoxGeometry(0.06, 0.6, 0.4), '#111111', sx, 0.9, -1.9));
      g.add(part(new THREE.BoxGeometry(0.2, 0.5, 4.22), '#ffffff', 0, 0.51, 0));
      g.add(part(new THREE.CylinderGeometry(0.2, 0.25, 0.8, 8).rotateX(Math.PI / 2), '#3d405b', 0, 1.0, -1.0)); // airbox
      g.add(glass(0.8, 0.25, 0.04, 0, 0.95, 0.55));
      const wheel = part(new THREE.TorusGeometry(0.15, 0.03, 6, 12), '#111111', 0, 0.95, 0.25);
      wheel.rotation.x = -0.3;
      g.add(wheel);
      seat = new THREE.Object3D();
      seat.position.set(0, 0.55, -0.3);
      g.add(seat);
      addWheels(g, wheels, [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.4], [0.95, -1.4]], 0.42, 0.45);
      lights(g, 0.5, 2.12, -2.12, 0.35);
      break;
    }
    default: {
      // sedan, sports (rival racers) and police
      const sporty = model === 'sports';
      const bodyH = sporty ? 0.65 : 0.8;
      g.add(part(new THREE.BoxGeometry(2, bodyH, 4.2), color, 0, 0.35 + bodyH / 2, 0));
      if (model === 'police') {
        for (const sz of [-1.2, 1.2]) g.add(part(new THREE.BoxGeometry(2.02, bodyH * 0.5, 1.3), '#ffffff', 0, 0.35 + bodyH * 0.55, sz * 0.9));
      }
      seat = cabin(g, { w: sporty ? 1.6 : 1.75, h: sporty ? 0.6 : 0.8, d: sporty ? 1.9 : 2.3, y: 0.35 + bodyH, z: -0.25, color, seats: sporty ? 1 : 2 });
      if (sporty) {
        g.add(part(new THREE.BoxGeometry(0.4, bodyH + 0.02, 4.22), '#ffffff', 0, 0.35 + bodyH / 2, 0));
        g.add(part(new THREE.BoxGeometry(1.9, 0.1, 0.5), '#222222', 0, 0.35 + bodyH + 0.45, -1.9));
        for (const sx of [-0.7, 0.7]) g.add(part(new THREE.BoxGeometry(0.1, 0.4, 0.1), '#222222', sx, 0.35 + bodyH + 0.2, -1.9));
      }
      if (model === 'police') {
        const roofY = 0.35 + bodyH + 0.8 + 0.12;
        for (const sx of [-0.35, 0.35]) {
          const b = part(new THREE.BoxGeometry(0.55, 0.16, 0.3), sx < 0 ? '#ff3b3b' : '#4361ee', sx, roofY, -0.25, true);
          beacons.push(b);
          g.add(b);
        }
      }
      addWheels(g, wheels, [[-1, 1.35], [1, 1.35], [-1, -1.35], [1, -1.35]]);
      lights(g, 0.35 + bodyH * 0.6, 2.11, -2.11);
    }
  }
  return { group: g, wheels, driverSeat: seat, driver: null, beacons };
}

/** Flash beacons (call each frame). */
export function flashBeacons(m: { beacons: THREE.Mesh[] }, time: number): void {
  m.beacons.forEach((b, i) => (b.visible = Math.floor(time * 6 + i) % 2 === 0));
}

export function buildBoatModel(model: BoatModel, color: string): VehicleModel {
  const names = KENNEY_BOATS[model];
  const kname = names[Math.floor(Math.random() * names.length)];
  if (Models.has(kname)) {
    const len = 6 * (model === 'yacht' ? 1.6 : model === 'fishing' ? 1.25 : 1);
    const g = Models.get(kname, { length: len });
    // sit the hull a little into the water
    g.children[0].position.y = -0.45;
    const size = Models.size(kname).multiplyScalar(len / Models.size(kname).z);
    const seat = new THREE.Object3D();
    seat.position.set(0, size.y * 0.5 - 0.3, -len * 0.12);
    g.add(seat);
    return { group: g, wheels: [], driverSeat: seat, driver: null, beacons: [] };
  }
  const g = new THREE.Group();
  const beacons: THREE.Mesh[] = [];
  const size = model === 'yacht' ? 1.6 : model === 'fishing' ? 1.25 : 1;
  const L = 6 * size;
  const W = 2.4 * size;
  // hull: a box with a pointed bow
  g.add(part(new THREE.BoxGeometry(W, 0.9, L * 0.7), model === 'coastguard' ? '#ffffff' : color, 0, 0.1, -L * 0.1));
  const bow = part(new THREE.CylinderGeometry(0.01, W / 2, L * 0.35, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), model === 'coastguard' ? '#ffffff' : color, 0, 0.1, L * 0.42);
  bow.scale.set(1, 0.64, 1);
  g.add(bow);
  g.add(part(new THREE.BoxGeometry(W + 0.04, 0.18, L * 0.7), model === 'coastguard' ? '#e85d04' : '#ffffff', 0, 0.42, -L * 0.1)); // stripe
  g.add(part(new THREE.BoxGeometry(W - 0.2, 0.06, L * 0.66), '#d4a373', 0, 0.56, -L * 0.1)); // deck
  let seat: THREE.Object3D;
  if (model === 'speedboat') {
    g.add(glass(W - 0.3, 0.45, 0.05, 0, 0.85, 0.6));
    const wheel = part(new THREE.TorusGeometry(0.17, 0.03, 6, 12), '#111111', -0.4, 1.0, 0.25);
    wheel.rotation.x = -0.5;
    g.add(wheel);
    for (const sx of [-0.45, 0.45]) g.add(part(new THREE.BoxGeometry(0.55, 0.5, 0.55), '#ffffff', sx, 0.85, -0.2));
    seat = new THREE.Object3D();
    seat.position.set(-0.45, 1.1, -0.2);
  } else {
    // wheelhouse with glass
    const cz = model === 'fishing' ? 1.0 : 0;
    seat = cabin(g, { w: W * 0.7, h: 1.3, d: L * 0.28, y: 0.6, z: cz, color: model === 'coastguard' ? '#e85d04' : '#ffffff' });
    if (model === 'yacht') {
      g.add(part(new THREE.BoxGeometry(W * 0.8, 0.9, L * 0.3), '#ffffff', 0, 1.05, -L * 0.25));
      g.add(part(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), '#dee2e6', 0, 3.6, L * 0.05)); // mast
    }
    if (model === 'fishing') {
      g.add(part(new THREE.CylinderGeometry(0.05, 0.05, 3.5, 6), '#8d6e63', 0, 2.3, -1.6));
      const boom = part(new THREE.CylinderGeometry(0.04, 0.04, 3, 6).rotateZ(Math.PI / 2.6), '#8d6e63', 0.9, 3.2, -1.6);
      g.add(boom);
    }
    if (model === 'coastguard') {
      const b = part(new THREE.BoxGeometry(0.5, 0.18, 0.3), '#4361ee', 0, 2.05, 0, true);
      beacons.push(b);
      g.add(b);
    }
  }
  g.add(seat);
  return { group: g, wheels: [], driverSeat: seat, driver: null, beacons };
}
