/**
 * The shape of the world: two flat islands in a shallow sea.
 *
 * - The main town island is a 560 m square (|x|, |z| ≤ 280).
 * - Palm Isle is a round island to the east.
 * - Around each island the sea floor slopes down over a few metres to SEABED_Y, so you can wade in
 *   and climb back out anywhere along the shore.
 *
 * Characters and vehicles are kept on this floor by hand (see CharacterEntity.integrate); there is
 * no ground collider.
 */

export const WATER_Y = -0.4;
export const SEABED_Y = -2.8;
/** How far out from the shoreline the sea floor reaches full depth (m). */
const SHELF = 9;

export const MAIN_ISLAND = { half: 280 };
export const PALM_ISLE = { x: 500, z: -30, r: 110 };

/** Space begins around here: the sky turns black and gravity drops to moon level. */
export const SPACE_Y = 300;

/** Gravity at a height: Earth-like below ~250 m, moon-like (35 %) above ~350 m. */
export function gravityAt(y: number): number {
  const t = Math.min(1, Math.max(0, (y - (SPACE_Y - 50)) / 100));
  return -30 * (1 - 0.65 * t);
}

/** The playable area (invisible walls stand just outside). */
export const BOUNDS = { minX: -300, maxX: 640, minZ: -300, maxZ: 300 };

/** Distance from (x, z) to the nearest land, 0 when on land. */
export function distanceToLand(x: number, z: number): number {
  const dx = Math.max(Math.abs(x) - MAIN_ISLAND.half, 0);
  const dz = Math.max(Math.abs(z) - MAIN_ISLAND.half, 0);
  const main = Math.hypot(dx, dz);
  const palm = Math.max(0, Math.hypot(x - PALM_ISLE.x, z - PALM_ISLE.z) - PALM_ISLE.r);
  return Math.min(main, palm);
}

export function isLand(x: number, z: number): boolean {
  return distanceToLand(x, z) === 0;
}

/** Height of the ground (or sea floor) under a point. */
export function floorAt(x: number, z: number): number {
  const d = distanceToLand(x, z);
  if (d === 0) return 0;
  return SEABED_Y * Math.min(1, d / SHELF);
}

/** Water depth at a point (0 on land / dry shallows). */
export function waterDepth(x: number, z: number): number {
  return Math.max(0, WATER_Y - floorAt(x, z));
}

/** The visible surface (ground on land, water out at sea). */
export function surfaceAt(x: number, z: number): number {
  return Math.max(floorAt(x, z), WATER_Y);
}
