import { fbm, smoothstep } from './portKit';
import { L } from '../core/i18n';
import { LANDMASSES, type Landmass } from '../core/region';

// ─────────────────────────────────────────────────────────────
// Континенти (чиста математика — без three.js): два великі суходоли за
// океаном від стартового архіпелагу.
//   • «Лазурове узбережжя» — Середземномор'я: теплий камінь, білі містечка,
//     кипариси й оливи, широка бірюзова мілина.
//   • «Північний край» — холодне узбережжя: граніт, ялиці, сніг на вершинах,
//     круті береги й туман.
// Берег — еліпс (region.ts LANDMASSES) із бухтами й мисами від шуму; рельєф
// рахується раз у сітку 6 м (кеш) і далі білінійно — дешево для фізики,
// карт і мапи дна. Біля гаваней континенту рельєф «прорізаний»: плато
// містечка рівне, від набережної в море — глибокий канал.
// ─────────────────────────────────────────────────────────────

export type ContinentStyle = 'med' | 'north';

export interface ContinentDef {
  id: string;
  name: string;
  sub: string;
  style: ContinentStyle;
  m: Landmass;
  seed: number;
  /** висоти: пагорби, гори (м) */
  hill: number;
  peak: number;
  /** ширина пляжу (м) — вузький = скелястий берег */
  beachW: number;
  /** схил дна від берега (м глибини на метр) і найбільша глибина біля континенту */
  shelf: number;
  deep: number;
}

const LM = (id: string) => LANDMASSES.find((m) => m.id === id)!;

export const CONTINENTS: ContinentDef[] = [
  {
    id: 'cont-med', name: L('Лазурове узбережжя', `The Azure Coast`), sub: L('білі містечка, оливи й тепле море', `white towns, olive groves and a warm sea`), style: 'med',
    m: LM('med'), seed: 13.7, hill: 42, peak: 150, beachW: 22, shelf: 0.05, deep: -16,
  },
  {
    id: 'cont-north', name: L('Північний край', `The Northern Reach`), sub: L('граніт, ялиці й холодний туман', `granite, firs and cold fog`), style: 'north',
    m: LM('north'), seed: 29.3, hill: 58, peak: 270, beachW: 6, shelf: 0.22, deep: -22,
  },
];

export const CONTINENT_BY_ID: Record<string, ContinentDef> = Object.fromEntries(CONTINENTS.map((c) => [c.id, c]));

/** «внутрішня» відстань від берега, м (>0 — суша): еліпс + лопаті + бухти й миси */
export function contInside(c: ContinentDef, x: number, z: number): number {
  const m = c.m;
  const dx = x - m.x, dz = z - m.z;
  const co = Math.cos(m.rot), si = Math.sin(m.rot);
  const u = (dx * co - dz * si) / m.rx, v = (dx * si + dz * co) / m.rz;
  const r = Math.hypot(u, v);
  const a = Math.atan2(v, u);
  const k = 1 + (fbm(Math.cos(a) * 1.5 + c.seed, Math.sin(a) * 1.5 - c.seed, 4) - 0.5) * 0.42;
  const detail = (fbm(x * 0.0032 + c.seed, z * 0.0032 - c.seed, 3) - 0.5) * 190;
  return (k - r) * Math.min(m.rx, m.rz) + detail;
}

// ── гавані на березі континенту ──

export interface ContPort {
  id: string;
  cont: string;
  /** корінь причалу (край набережної) */
  x: number;
  z: number;
  ox: number;
  oz: number;
  plW: number;
  plD: number;
  plY: number;
  pierL: number;
  pierW: number;
}

/** заготовки: напрям від центру (рад, 0 — +X, за годинниковою на карті: +Z — «південь»), куди дивиться причал */
const PORT_SPECS: Array<{ id: string; cont: string; ang: number; o: [number, number]; plW: number; plD: number; plY: number; pierL: number; pierW: number }> = [
  // Лазурове: велика гавань на західному березі (до дому) і грецьке село на північному
  { id: 'port-azzurro', cont: 'cont-med', ang: Math.PI * 1.02, o: [-1, 0], plW: 70, plD: 34, plY: 1.6, pierL: 36, pierW: 4.5 },
  { id: 'port-nikos', cont: 'cont-med', ang: -Math.PI * 0.55, o: [0, -1], plW: 44, plD: 22, plY: 1.6, pierL: 28, pierW: 3.6 },
  // Північ: портове містечко на східному березі й далека бухта на північному
  { id: 'port-cedar', cont: 'cont-north', ang: -0.05, o: [1, 0], plW: 66, plD: 34, plY: 2.0, pierL: 36, pierW: 4.5 },
  { id: 'port-grizzly', cont: 'cont-north', ang: -Math.PI * 0.42, o: [0, -1], plW: 40, plD: 20, plY: 2.2, pierL: 30, pierW: 4 },
];

function placePort(sp: (typeof PORT_SPECS)[number]): ContPort {
  const c = CONTINENT_BY_ID[sp.cont];
  const m = c.m;
  // старт — на суші (60% радіуса в напрямку ang), далі вздовж причалу до води
  let x = m.x + Math.cos(sp.ang) * m.rx * 0.55, z = m.z + Math.sin(sp.ang) * m.rz * 0.55;
  for (let i = 0; i < 1200 && contInside(c, x, z) > 0; i++) {
    x += sp.o[0] * 2;
    z += sp.o[1] * 2;
  }
  // корінь причалу — трохи на суші, щоб набережна стояла на березі
  x -= sp.o[0] * 4;
  z -= sp.o[1] * 4;
  return { id: sp.id, cont: sp.cont, x: Math.round(x), z: Math.round(z), ox: sp.o[0], oz: sp.o[1], plW: sp.plW, plD: sp.plD, plY: sp.plY, pierL: sp.pierL, pierW: sp.pierW };
}

export const CONT_PORTS: ContPort[] = PORT_SPECS.map(placePort);

/** висота континенту без гаваней */
function rawHeight(c: ContinentDef, x: number, z: number): number {
  const s = contInside(c, x, z);
  if (s < 0) return Math.max(c.deep, -1.0 + s * c.shelf);
  const n1 = fbm(x * 0.004 + c.seed, z * 0.004 - c.seed, 3);
  const beach = Math.min(s, c.beachW) * (1.8 / c.beachW);
  const hills = smoothstep(c.beachW * 0.6, 300, s) * c.hill * (0.3 + 0.9 * n1);
  const rf = fbm(x * 0.0016 - c.seed, z * 0.0016 + c.seed * 0.7, 4);
  const ridge = 1 - Math.abs(rf * 2 - 1);
  const mount = smoothstep(160, 700, s) * c.peak * ridge * ridge;
  // Північ: скелясті уступи біля води
  const cliff = c.style === 'north' ? smoothstep(2, 16, s) * 4 * n1 : 0;
  return beach + hills + mount + cliff;
}

/** гавань «прорізає» рельєф: рівне плато містечка й канал від набережної в море */
function carve(p: ContPort, x: number, z: number, h: number): number {
  const dx = x - p.x, dz = z - p.z;
  const a = dx * p.ox + dz * p.oz;
  const b = dx * -p.oz + dz * p.ox;
  if (a < -p.plD - 160 || a > p.pierL + 200 || Math.abs(b) > p.plW / 2 + 160) return h;
  const hw = p.plW / 2;
  // за набережною: не вище за плато, далі — плавний підйом схилу
  const da = a > 0 ? 0 : Math.max(0, -p.plD - a);
  const db = Math.max(0, Math.abs(b) - hw);
  const d = Math.hypot(da, db);
  const cap = p.plY + Math.max(0, d - 6) * 0.45;
  if (a <= 4) h = Math.min(h, cap);
  // від набережної в море — глибокий канал (яхта підходить до причалу)
  if (a > -1) {
    const side = smoothstep(hw + 40, hw + 10, Math.abs(b)) * smoothstep(-1, 5, a) * (1 - smoothstep(p.pierL + 90, p.pierL + 180, a));
    h = h + (Math.min(h, -6) - h) * side;
  }
  return h;
}

// ── кеш висот: сітка 6 м на кожен континент ──

const STEP = 6;
interface Grid {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  h: Float32Array;
}
const grids: Array<Grid | null> = CONTINENTS.map(() => null);

function bbox(c: ContinentDef): [number, number, number, number] {
  const R = Math.max(c.m.rx, c.m.rz) * 1.38 + 260;
  return [c.m.x - R, c.m.z - R, c.m.x + R, c.m.z + R];
}
export const CONT_BOXES = CONTINENTS.map(bbox);

function grid(i: number): Grid {
  let g = grids[i];
  if (g) return g;
  const c = CONTINENTS[i];
  const [x0, z0, x1, z1] = CONT_BOXES[i];
  const nx = Math.ceil((x1 - x0) / STEP) + 1, nz = Math.ceil((z1 - z0) / STEP) + 1;
  const h = new Float32Array(nx * nz);
  const ports = CONT_PORTS.filter((p) => p.cont === c.id);
  for (let j = 0; j < nz; j++) {
    for (let k = 0; k < nx; k++) {
      const x = x0 + k * STEP, z = z0 + j * STEP;
      let v = rawHeight(c, x, z);
      for (const p of ports) v = carve(p, x, z, v);
      h[j * nx + k] = v;
    }
  }
  g = { x0, z0, nx, nz, h };
  grids[i] = g;
  return g;
}

/** висота континенту (−99 — далеко від усіх) */
export function continentHeight(x: number, z: number): number {
  for (let i = 0; i < CONTINENTS.length; i++) {
    const b = CONT_BOXES[i];
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
    const g = grid(i);
    const fx = (x - g.x0) / STEP, fz = (z - g.z0) / STEP;
    const ix = Math.min(g.nx - 2, Math.max(0, Math.floor(fx))), iz = Math.min(g.nz - 2, Math.max(0, Math.floor(fz)));
    const tx = fx - ix, tz = fz - iz;
    const H = g.h, o = iz * g.nx + ix;
    return (H[o] * (1 - tx) + H[o + 1] * tx) * (1 - tz) + (H[o + g.nx] * (1 - tx) + H[o + g.nx + 1] * tx) * tz;
  }
  return -99;
}

/** континент, біля берега якого точка (висота дна вище за −dist·0.5) */
export function continentAt(x: number, z: number, dist = 0): ContinentDef | null {
  for (let i = 0; i < CONTINENTS.length; i++) {
    const b = CONT_BOXES[i];
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
    if (contInside(CONTINENTS[i], x, z) > -dist) return CONTINENTS[i];
  }
  return null;
}

/** континент, у межах якого (з морем довкола) точка — для клімату, назв і «ти приплив» */
export function continentRegion(x: number, z: number): ContinentDef | null {
  for (let i = 0; i < CONTINENTS.length; i++) {
    const b = CONT_BOXES[i];
    if (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]) return CONTINENTS[i];
  }
  return null;
}
