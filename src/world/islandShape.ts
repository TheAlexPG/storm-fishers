import { fbm, smoothstep } from './portKit';

// ─────────────────────────────────────────────────────────────
// Форма островів у морі (чиста математика — без three.js): висота
// рельєфу, щоб на острови можна було зійти й походити, яхта сідала на
// мілину, а карта й мінікарта малювали їх через terrainHeight.
// ─────────────────────────────────────────────────────────────

export type IslandKind = 'gull' | 'pine' | 'palm' | 'pirate' | 'shell';

export interface IslandDef {
  id: string;
  name: string;
  sub: string;
  kind: IslandKind;
  x: number;
  z: number;
  /** радіус берегової лінії, м */
  r: number;
  /** витягнутість (довга вісь / коротка) і її поворот */
  elong: number;
  rot: number;
  /** висота вершини, м */
  peak: number;
  seed: number;
}

export const ISLANDS: IslandDef[] = [
  { id: 'isl-gull', name: 'Чаячий острівець', sub: 'зійди на берег — тут щось блищить', kind: 'gull', x: -110, z: 196, r: 22, elong: 1.3, rot: 0.6, peak: 5, seed: 11 },
  { id: 'isl-pine', name: 'Сосновий острів', sub: 'руїни хатини доглядача', kind: 'pine', x: -238, z: 392, r: 44, elong: 1.25, rot: -0.4, peak: 16, seed: 23 },
  { id: 'isl-palm', name: 'Пальмова коса', sub: 'теплий пісок посеред Північного моря', kind: 'palm', x: 296, z: 442, r: 30, elong: 2.0, rot: 0.35, peak: 3.5, seed: 37 },
  { id: 'isl-pirate', name: 'Піратська бухта', sub: 'кажуть, тут закопали скриню', kind: 'pirate', x: 690, z: 520, r: 40, elong: 1.35, rot: 1.1, peak: 13, seed: 41 },
  { id: 'isl-shell', name: 'Мушлевий острів', sub: 'море приносить сюди найкращі мушлі', kind: 'shell', x: -668, z: 590, r: 30, elong: 1.4, rot: -1.0, peak: 7, seed: 53 },
];

/** найдовший радіус з урахуванням витягнутості й шуму берега (+ підводний схил) */
const reach = (d: IslandDef) => d.r * Math.sqrt(d.elong) * 1.3 + 14;

/** локальні координати острова: (u — уздовж довгої осі, v — поперек), відстань «у радіусах» */
function local(d: IslandDef, x: number, z: number) {
  const dx = x - d.x, dz = z - d.z;
  const c = Math.cos(d.rot), s = Math.sin(d.rot);
  const u = (dx * c - dz * s) / Math.sqrt(d.elong);
  const v = (dx * s + dz * c) * Math.sqrt(d.elong);
  return { u, v, dist: Math.hypot(u, v) };
}

/** «внутрішня» відстань від берегової лінії, м (>0 — суша) */
export function islandInside(d: IslandDef, x: number, z: number): number {
  const { u, v, dist } = local(d, x, z);
  const a = Math.atan2(v, u);
  // нерівний берег: шум по колу (неперервний за кутом)
  const k = 1 + (fbm(Math.cos(a) * 1.4 + d.seed, Math.sin(a) * 1.4 - d.seed, 3) - 0.5) * 0.5;
  return d.r * k - dist;
}

/** висота одного острова (дуже глибоко — далеко від нього) */
export function islandHeightOf(d: IslandDef, x: number, z: number): number {
  const s = islandInside(d, x, z);
  if (s < 0) return Math.max(-9, s * 0.5); // крутий підводний схил: кіль сідає за ~2.5 м від води
  // пляж (пологий), далі — пагорб до вершини з горбиками
  const beach = Math.min(s, 9) * 0.13;
  const hill = smoothstep(8, 8 + d.r * 0.65, s) * (d.peak - 1.1) * (0.75 + 0.5 * fbm(x * 0.05 + d.seed, z * 0.05 - d.seed, 3));
  return beach + Math.max(0, hill);
}

/** найвища точка серед островів (або −99, якщо поруч немає жодного) */
export function islandHeight(x: number, z: number): number {
  let h = -99;
  for (const d of ISLANDS) {
    const R = reach(d);
    if (Math.abs(x - d.x) > R || Math.abs(z - d.z) > R) continue;
    h = Math.max(h, islandHeightOf(d, x, z));
  }
  return h;
}

/** острів, біля якого точка (у межах dist м від берега) */
export function islandNear(x: number, z: number, dist = 0): IslandDef | null {
  for (const d of ISLANDS) {
    const R = reach(d) + dist;
    if (Math.abs(x - d.x) > R || Math.abs(z - d.z) > R) continue;
    if (islandInside(d, x, z) > -dist) return d;
  }
  return null;
}

/** тверді перешкоди на островах (хатина, дерева, скелі) — кола; заповнює Islands */
export const ISLAND_SOLIDS: Array<{ x: number; z: number; r: number }> = [];

/** витіснити тіло з перешкод острова */
export function resolveIslandSolids(x: number, z: number, r: number): [number, number] {
  for (const o of ISLAND_SOLIDS) {
    const dx = x - o.x, dz = z - o.z;
    const min = o.r + r;
    if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
    const d = Math.hypot(dx, dz);
    if (d < min && d > 1e-4) {
      x = o.x + (dx / d) * min;
      z = o.z + (dz / d) * min;
    }
  }
  return [x, z];
}
