import { fbm, smoothstep } from './portKit';
import { portLandHeight } from './portSites';
import { continentHeight, continentAt, type ContinentDef } from './continents';
import { WS, addHaven } from '../core/region';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Форма островів у морі (чиста математика — без three.js): висота
// рельєфу, щоб на острови можна було зійти й походити, яхта сідала на
// мілину, а карта й мінікарта малювали їх через terrainHeight.
// ─────────────────────────────────────────────────────────────

export type IslandKind = 'gull' | 'pine' | 'palm' | 'pirate' | 'shell' | 'cypress' | 'fir' | 'refuge';

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
  /** острівці біля континентів і притулки в океані (не входять у «відкрий усі острови») */
  far?: boolean;
}

const RAW_ISLANDS: IslandDef[] = [
  { id: 'isl-gull', name: L('Чаячий острівець', `Gull Islet`), sub: L('зійди на берег — тут щось блищить', `go ashore — something glitters here`), kind: 'gull', x: -110, z: 196, r: 22, elong: 1.3, rot: 0.6, peak: 5, seed: 11 },
  { id: 'isl-pine', name: L('Сосновий острів', `Pine Island`), sub: L('руїни хатини доглядача', `ruins of the keeper's hut`), kind: 'pine', x: -238, z: 392, r: 44, elong: 1.25, rot: -0.4, peak: 16, seed: 23 },
  { id: 'isl-palm', name: L('Пальмова коса', `Palm Spit`), sub: L('теплий пісок посеред Північного моря', `warm sand in the middle of the North Sea`), kind: 'palm', x: 296, z: 442, r: 30, elong: 2.0, rot: 0.35, peak: 3.5, seed: 37 },
  { id: 'isl-pirate', name: L('Піратська бухта', `Pirate Cove`), sub: L('кажуть, тут закопали скриню', `they say a chest is buried here`), kind: 'pirate', x: 690, z: 520, r: 40, elong: 1.35, rot: 1.1, peak: 13, seed: 41 },
  { id: 'isl-shell', name: L('Мушлевий острів', `Shell Island`), sub: L('море приносить сюди найкращі мушлі', `the sea brings the finest shells here`), kind: 'shell', x: -668, z: 590, r: 30, elong: 1.4, rot: -1.0, peak: 7, seed: 53 },
];
/** острівці біля континентів і притулки посеред океану (абсолютні координати) */
const FAR_ISLANDS: IslandDef[] = [
  // Лазурове узбережжя
  { id: 'isl-cypress', name: L('Острів Кипарисів', `Cypress Isle`), sub: L('кипариси й біла каплиця над бірюзою', `cypresses and a white chapel above turquoise water`), kind: 'cypress', x: 2150, z: 2480, r: 40, elong: 1.35, rot: 0.4, peak: 14, seed: 201, far: true },
  { id: 'isl-chapel', name: L('Скеля Святого Ніколаса', `Saint Nicholas Rock`), sub: L('каплиця з блакитним куполом', `a chapel with a blue dome`), kind: 'cypress', x: 3250, z: 1500, r: 32, elong: 1.2, rot: -0.6, peak: 18, seed: 213, far: true },
  { id: 'isl-olive', name: L('Оливковий острів', `Olive Island`), sub: L('старий гай і теплий пісок', `an old grove and warm sand`), kind: 'cypress', x: 2560, z: 3900, r: 46, elong: 1.5, rot: 1.0, peak: 11, seed: 227, far: true },
  // Північний край
  { id: 'isl-fir', name: L('Ялиновий острів', `Fir Island`), sub: L('темний ліс до самої води', `dark forest right down to the water`), kind: 'fir', x: -2250, z: 2250, r: 44, elong: 1.3, rot: -0.3, peak: 22, seed: 239, far: true },
  { id: 'isl-granite', name: L('Гранітні Брати', `Granite Brothers`), sub: L('голі скелі, тюлені й мох', `bare rocks, seals and moss`), kind: 'fir', x: -2300, z: 3350, r: 38, elong: 1.6, rot: 0.8, peak: 20, seed: 251, far: true },
  { id: 'isl-seal', name: L('Тюленячий острівець', `Seal Islet`), sub: L('холодно, але тюлені щасливі', `cold, but the seals are happy`), kind: 'fir', x: -3300, z: 1100, r: 30, elong: 1.3, rot: 0.2, peak: 12, seed: 263, far: true },
  // притулки посеред океану: маяк і затишок від шторму
  { id: 'isl-refuge-e', name: L('Маяк Півдороги', `Halfway Light`), sub: L('притулок на шляху до Лазурового узбережжя', `a refuge on the way to the Azure Coast`), kind: 'refuge', x: 1950, z: 2150, r: 28, elong: 1.3, rot: 0.5, peak: 7, seed: 271, far: true },
  { id: 'isl-refuge-w', name: L('Вартовий маяк', `Sentinel Light`), sub: L('притулок на шляху до Північного краю', `a refuge on the way to the Northern Reach`), kind: 'refuge', x: -1950, z: 1900, r: 28, elong: 1.3, rot: -0.4, peak: 8, seed: 283, far: true },
  { id: 'isl-refuge-s', name: L('Острів Середини', `Midsea Isle`), sub: L('посеред Великого океану — сховатися від фронту', `in the middle of the Great Ocean — shelter from a front`), kind: 'refuge', x: 120, z: 3150, r: 32, elong: 1.4, rot: 0.1, peak: 9, seed: 293, far: true },
];

/** позиції — у масштабі світу (region.ts WS); далі — острівці континентів і притулки */
export const ISLANDS: IslandDef[] = [...RAW_ISLANDS.map((d) => ({ ...d, x: Math.round(d.x * WS), z: Math.round(d.z * WS) })), ...FAR_ISLANDS];
// притулки — гавані-затишки від шторму
for (const d of FAR_ISLANDS) if (d.kind === 'refuge') addHaven({ x: d.x, z: d.z, r: 320, name: d.name });

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
  // суходоли інших портів (portSites.ts) — та сама ходьба, мілина й карта
  let h = Math.max(portLandHeight(x, z), continentHeight(x, z));
  for (const d of ISLANDS) {
    const R = reach(d);
    if (Math.abs(x - d.x) > R || Math.abs(z - d.z) > R) continue;
    h = Math.max(h, islandHeightOf(d, x, z));
  }
  return h;
}

/** псевдо-«острів» для берега континенту (зійти на берег із яхти) */
const CONT_AS_ISLAND = new Map<string, IslandDef>();
function contIsland(c: ContinentDef): IslandDef {
  let d = CONT_AS_ISLAND.get(c.id);
  if (!d) {
    d = { id: c.id, name: c.name, sub: c.sub, kind: c.style === 'med' ? 'cypress' : 'fir', x: c.m.x, z: c.m.z, r: Math.min(c.m.rx, c.m.rz), elong: 1, rot: 0, peak: c.peak, seed: c.seed, far: true };
    CONT_AS_ISLAND.set(c.id, d);
  }
  return d;
}

/** острів (чи берег континенту), біля якого точка (у межах dist м від берега) */
export function islandNear(x: number, z: number, dist = 0): IslandDef | null {
  for (const d of ISLANDS) {
    const R = reach(d) + dist;
    if (Math.abs(x - d.x) > R || Math.abs(z - d.z) > R) continue;
    if (islandInside(d, x, z) > -dist) return d;
  }
  const c = continentAt(x, z, dist);
  return c ? contIsland(c) : null;
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
