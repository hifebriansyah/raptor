/**
 * The shape of the world: islands in a shallow sea, mostly flat town land with a few hills.
 *
 * - The main town island is a 560 m square (|x|, |z| ≤ 280).
 * - Uptown joins it on the north side (z < −280): Observatory Hill with a winding road to the top,
 *   a road tunnel through its western flank, and cliffs down to the sea.
 * - Palm Isle is a round island to the east, with a little hill under the lighthouse.
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
/** Uptown: the hilly district joined to the town's north edge. */
export const UPTOWN = { minX: -240, maxX: 160, minZ: -470, maxZ: -280 };
/** Observatory Hill: a flat-topped hill (plateau radius, top height) easing down to `foot`. */
export const OBSERVATORY = { x: -40, z: -385, top: 30, plateau: 30, foot: 120 };
/** A gentler second hill on Uptown's east side (terraced houses). */
const EAST_HILL = { x: 95, z: -395, top: 14, plateau: 18, foot: 70 };
/** Little hill under the lighthouse on Palm Isle's east point. */
export const LIGHTHOUSE_HILL = { x: 594, z: -24, top: 9, plateau: 9, foot: 34 };
/**
 * Road tunnel through Observatory Hill's west flank: a straight corridor along x, at town level.
 * Where the hill is lower than `roof` the road runs in an open cutting instead.
 */
export const TUNNEL = { x: -120, halfWidth: 8.5, roof: 8, minZ: -470, maxZ: -250 };
/** The sunken park basin: a bowl 3.5 m deep in the park south-east of the Lab. */
export const PARK_BASIN = { x: 30, z: -30, depth: 3.5, floor: 11, rim: 20 };

/**
 * Building interiors are built deep under the town (see InteriorSystem). Anything below
 * INTERIOR_CUTOFF stands on the interior floor instead of the ground far above.
 */
export const INTERIOR_Y = -600;
const INTERIOR_CUTOFF = -300;

/** Space begins around here: the sky turns black and gravity drops to moon level. */
export const SPACE_Y = 300;

/** Gravity at a height: Earth-like below ~250 m, moon-like (35 %) above ~350 m. */
export function gravityAt(y: number): number {
  const t = Math.min(1, Math.max(0, (y - (SPACE_Y - 50)) / 100));
  return -30 * (1 - 0.65 * t);
}

/** The playable area (invisible walls stand just outside). */
export const BOUNDS = { minX: -300, maxX: 640, minZ: -490, maxZ: 300 };

/** Distance from (x, z) to the nearest land, 0 when on land. */
export function distanceToLand(x: number, z: number): number {
  const dx = Math.max(Math.abs(x) - MAIN_ISLAND.half, 0);
  const dz = Math.max(Math.abs(z) - MAIN_ISLAND.half, 0);
  const main = Math.hypot(dx, dz);
  const palm = Math.max(0, Math.hypot(x - PALM_ISLE.x, z - PALM_ISLE.z) - PALM_ISLE.r);
  const ux = Math.max(UPTOWN.minX - x, 0, x - UPTOWN.maxX);
  const uz = Math.max(UPTOWN.minZ - z, 0, z - UPTOWN.maxZ);
  return Math.min(main, palm, Math.hypot(ux, uz));
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function bump(x: number, z: number, h: { x: number; z: number; top: number; plateau: number; foot: number }): number {
  return h.top * (1 - smooth(h.plateau, h.foot, Math.hypot(x - h.x, z - h.z)));
}

/** In the tunnel / cutting corridor? */
export function inTunnelCorridor(x: number, z: number): boolean {
  return Math.abs(x - TUNNEL.x) < TUNNEL.halfWidth && z > TUNNEL.minZ && z < TUNNEL.maxZ;
}

/** Height of the land surface (hills) ignoring the tunnel; 0 for the flat town. */
export function hillHeight(x: number, z: number): number {
  let h = 0;
  if (z < UPTOWN.maxZ + 10) {
    h = Math.max(bump(x, z, OBSERVATORY), bump(x, z, EAST_HILL));
    // ease the hills down to town level where Uptown meets the town
    h *= smooth(UPTOWN.maxZ + 6, UPTOWN.maxZ - 20, z);
  }
  if (x > PALM_ISLE.x) h = Math.max(h, bump(x, z, LIGHTHOUSE_HILL));
  const dB = Math.hypot(x - PARK_BASIN.x, z - PARK_BASIN.z);
  if (dB < PARK_BASIN.rim) h -= PARK_BASIN.depth * (1 - smooth(PARK_BASIN.floor, PARK_BASIN.rim, dB));
  return h;
}

/** Inside the tunnel bore (under the hill, below its roof). */
export function inTunnel(x: number, z: number, y: number): boolean {
  if (!inTunnelCorridor(x, z)) return false;
  const h = hillHeight(x, z);
  return h >= TUNNEL.roof && y < h - 2;
}

export function isLand(x: number, z: number): boolean {
  return distanceToLand(x, z) === 0;
}

/**
 * Height of the ground (or sea floor) under a point. `y` (the asker's height) matters only in the
 * tunnel: below the hill you stand on the road, above it on the hilltop.
 */
export function floorAt(x: number, z: number, y = Infinity): number {
  if (y < INTERIOR_CUTOFF) return INTERIOR_Y;
  const d = distanceToLand(x, z);
  if (d === 0) {
    const h = hillHeight(x, z);
    if (h > 0.01 && inTunnelCorridor(x, z)) {
      if (h < TUNNEL.roof) return 0; // open cutting
      if (y < h - 2) return 0; // in the tunnel
    }
    return h;
  }
  return SEABED_Y * Math.min(1, d / SHELF);
}

/** Water depth at a point (0 on land / dry shallows). */
export function waterDepth(x: number, z: number, y = 0): number {
  if (y < INTERIOR_CUTOFF || isLand(x, z)) return 0; // only the sea is water (the park basin is dry)
  return Math.max(0, WATER_Y - floorAt(x, z, 0));
}

/** The visible surface (ground on land, water out at sea). */
export function surfaceAt(x: number, z: number, y = Infinity): number {
  const f = floorAt(x, z, y);
  return isLand(x, z) ? f : Math.max(f, WATER_Y);
}
