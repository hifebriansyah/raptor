import { BOUNDS, MAIN_ISLAND, PALM_ISLE } from '../game/Terrain';
import type { MapFeature } from '../game/WorldMap';

const PX_PER_M = 2; // resolution of the pre-rendered base map
const VIEW_RADIUS_M = 120; // how much of the town the minimap shows around you

export interface MinimapMarker {
  x: number;
  z: number;
  color: string;
  label: string;
  /** Keep the marker on the rim when it is out of view. */
  pinToEdge?: boolean;
  /** Draw a translucent search zone of this radius (metres) instead of a dot. */
  zone?: number;
}

/**
 * GTA-style round minimap. The town is drawn once to an offscreen canvas; each frame that image is
 * rotated so "up" is where the camera faces, and markers are drawn upright on top.
 */
export class Minimap {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private size = 0;

  constructor(slot: HTMLElement, features: readonly MapFeature[]) {
    slot.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.base = cachedBase ?? (cachedBase = renderBase(features));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    const css = this.canvas.clientWidth || 180;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.canvas.height = Math.round(css * dpr);
    this.size = this.canvas.width;
  }

  /**
   * @param cx,cz   world position at the centre (the player)
   * @param camYaw  camera yaw; the map rotates so camera-forward points up
   * @param heading player facing (radians, 0 = +z)
   */
  draw(cx: number, cz: number, camYaw: number, heading: number, markers: readonly MinimapMarker[]): void {
    const { ctx, size } = this;
    const r = size / 2;
    const scale = r / VIEW_RADIUS_M; // canvas px per metre
    const cos = Math.cos(camYaw);
    const sin = Math.sin(camYaw);
    // world offset (dx, dz) → minimap pixel, rotated so camera-forward is up
    const toScreen = (wx: number, wz: number) => {
      const dx = (wx - cx) * scale;
      const dz = (wz - cz) * scale;
      return { x: r + dx * cos - dz * sin, y: r + dx * sin + dz * cos };
    };

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#3fa7d6';
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(camYaw);
    ctx.scale(scale / PX_PER_M, scale / PX_PER_M);
    ctx.translate(-(cx - BOUNDS.minX) * PX_PER_M, -(cz - BOUNDS.minZ) * PX_PER_M);
    ctx.drawImage(this.base, 0, 0);
    ctx.restore();

    // Markers (upright, clamped to the rim when far away)
    const dpr = size / 180;
    // Zones first (under the dots)
    for (const m of markers) {
      if (!m.zone) continue;
      const p = toScreen(m.x, m.z);
      ctx.beginPath();
      ctx.arc(p.x, p.y, m.zone * scale, 0, Math.PI * 2);
      ctx.fillStyle = m.color + '55';
      ctx.fill();
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = m.color;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const m of markers) {
      if (m.zone && !m.label) continue;
      let p = toScreen(m.x, m.z);
      const dx = p.x - r;
      const dy = p.y - r;
      const dist = Math.hypot(dx, dy);
      const rim = r - 12 * dpr;
      if (dist > rim) {
        if (!m.pinToEdge) continue;
        p = { x: r + (dx / dist) * rim, y: r + (dy / dist) * rim };
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${10 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.label, p.x, p.y + 0.5 * dpr);
    }

    // Player arrow at the centre, pointing along the player's heading
    const hx = Math.sin(heading);
    const hz = Math.cos(heading);
    const ang = Math.atan2(hx * sin + hz * cos, hx * cos - hz * sin);
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(ang + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -9 * dpr);
    ctx.lineTo(7 * dpr, 7 * dpr);
    ctx.lineTo(0, 3 * dpr);
    ctx.lineTo(-7 * dpr, 7 * dpr);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = '#1b1f2a';
    ctx.stroke();
    ctx.restore();

    ctx.restore();
    // Rim
    ctx.beginPath();
    ctx.arc(r, r, r - 1.5 * dpr, 0, Math.PI * 2);
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  }
}

let cachedBase: HTMLCanvasElement | null = null;

/**
 * Draw a north-up circular snapshot of the town around (x, z) — used for Grandma's premonition.
 */
export function drawSnapshot(canvas: HTMLCanvasElement, features: readonly MapFeature[], x: number, z: number, radiusM: number): void {
  const base = cachedBase ?? (cachedBase = renderBase(features));
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width;
  const r = size / 2;
  const scale = r / radiusM;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#3fa7d6';
  ctx.fillRect(0, 0, size, size);
  ctx.translate(r, r);
  ctx.scale(scale / PX_PER_M, scale / PX_PER_M);
  ctx.translate(-(x - BOUNDS.minX) * PX_PER_M, -(z - BOUNDS.minZ) * PX_PER_M);
  ctx.drawImage(base, 0, 0);
  ctx.restore();
}

function renderBase(features: readonly MapFeature[]): HTMLCanvasElement {
  const L = MAIN_ISLAND.half;
  const c = document.createElement('canvas');
  c.width = (BOUNDS.maxX - BOUNDS.minX) * PX_PER_M;
  c.height = (BOUNDS.maxZ - BOUNDS.minZ) * PX_PER_M;
  const g = c.getContext('2d')!;
  g.scale(PX_PER_M, PX_PER_M);
  g.translate(-BOUNDS.minX, -BOUNDS.minZ);
  g.fillStyle = '#3fa7d6';
  g.fillRect(BOUNDS.minX, BOUNDS.minZ, BOUNDS.maxX - BOUNDS.minX, BOUNDS.maxZ - BOUNDS.minZ);
  // main island
  g.fillStyle = '#f2dca0';
  g.fillRect(-L, -L, L * 2, L * 2);
  g.fillStyle = '#8ccf6a';
  g.fillRect(-L + 12, -L + 12, L * 2 - 24, L * 2 - 24);
  // Palm Isle
  g.fillStyle = '#f2dca0';
  g.beginPath();
  g.arc(PALM_ISLE.x, PALM_ISLE.z, PALM_ISLE.r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#9bd36a';
  g.beginPath();
  g.arc(PALM_ISLE.x, PALM_ISLE.z, PALM_ISLE.r - 18, 0, Math.PI * 2);
  g.fill();

  // Hideouts are secret: they only show up as Grandma's premonition zone.
  const order: MapFeature['kind'][] = ['park', 'road', 'building', 'lab', 'pad', 'grandma', 'hut', 'pier'];
  const colors: Record<MapFeature['kind'], string> = {
    hideout: 'transparent',
    hut: '#c08552',
    pier: '#a47148',
    sidewalk: '#c9ccd3',
    park: '#5fb34a',
    road: '#5d6470',
    building: '#c9ced8',
    lab: '#2f80ed',
    pad: '#ffd166',
    grandma: '#ff8fab',
  };
  for (const kind of order) {
    for (const f of features) {
      if (f.kind !== kind) continue;
      g.fillStyle = kind === 'building' ? shade(f.color ?? colors.building) : colors[kind];
      g.fillRect(f.x - f.w / 2, f.z - f.d / 2, f.w, f.d);
    }
  }
  return c;
}

/** Slightly darken pastel building colours so they read on the minimap. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = 0.82;
  const r = Math.round(((n >> 16) & 255) * f);
  const gg = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${gg},${b})`;
}
