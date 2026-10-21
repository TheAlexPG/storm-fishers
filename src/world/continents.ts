import { fbm, noise2, smoothstep } from './portKit';
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
    m: LM('med'), seed: 13.7, hill: 42, peak: 135, beachW: 22, shelf: 0.05, deep: -16,
  },
  {
    id: 'cont-north', name: L('Північний край', `The Northern Reach`), sub: L('граніт, ялиці й холодний туман', `granite, firs and cold fog`), style: 'north',
    m: LM('north'), seed: 29.3, hill: 58, peak: 330, beachW: 6, shelf: 0.22, deep: -22,
  },
];

export const CONTINENT_BY_ID: Record<string, ContinentDef> = Object.fromEntries(CONTINENTS.map((c) => [c.id, c]));

/** базовий берег: еліпс + лопаті + великі бухти й миси (від нього ставляться гавані) */
function contBase(c: ContinentDef, x: number, z: number): number {
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
  /** радіус, у якому гавань «розгладжує» рваний берег (м): маленькі бухти — менший, щоб фіорди й затоки довкола лишились */
  fade: [number, number];
}

/** заготовки: напрям від центру (рад, 0 — +X, за годинниковою на карті: +Z — «південь»), куди дивиться причал */
const PORT_SPECS: Array<{ id: string; cont: string; ang: number; o: [number, number]; plW: number; plD: number; plY: number; pierL: number; pierW: number; fade?: [number, number]; start?: [number, number] }> = [
  // Лазурове: велика гавань на західному березі (до дому) і грецьке село на північному
  { id: 'port-azzurro', cont: 'cont-med', ang: Math.PI * 1.02, o: [-1, 0], plW: 70, plD: 34, plY: 1.6, pierL: 36, pierW: 4.5 },
  { id: 'port-nikos', cont: 'cont-med', ang: -Math.PI * 0.55, o: [0, -1], plW: 44, plD: 22, plY: 1.6, pierL: 28, pierW: 3.6 },
  // Північ: портове містечко на східному березі й далека бухта на північному
  { id: 'port-cedar', cont: 'cont-north', ang: -0.05, o: [1, 0], plW: 66, plD: 34, plY: 2.0, pierL: 36, pierW: 4.5 },
  { id: 'port-grizzly', cont: 'cont-north', ang: -Math.PI * 0.42, o: [0, -1], plW: 40, plD: 20, plY: 2.2, pierL: 30, pierW: 4 },
  // маленькі бухти (як Рибальський Кут удома): причал, кілька хаток, пальне й скупка
  { id: 'cove-olive', cont: 'cont-med', ang: -2.29, start: [3150, 2250], o: [-1, 0], plW: 30, plD: 16, plY: 1.4, pierL: 22, pierW: 3, fade: [150, 300] },
  { id: 'cove-sole', cont: 'cont-med', ang: -0.5, o: [1, 0], plW: 30, plD: 16, plY: 1.4, pierL: 22, pierW: 3, fade: [150, 300] },
  { id: 'cove-luce', cont: 'cont-med', ang: 1.02, o: [0, 1], plW: 28, plD: 15, plY: 1.4, pierL: 22, pierW: 3, fade: [140, 260] },
  { id: 'cove-salmon', cont: 'cont-north', ang: -0.84, start: [-3000, 1720], o: [1, 0], plW: 30, plD: 16, plY: 2.0, pierL: 24, pierW: 3, fade: [150, 300] },
  { id: 'cove-smoke', cont: 'cont-north', ang: 1.87, o: [0, 1], plW: 28, plD: 15, plY: 2.0, pierL: 24, pierW: 3, fade: [140, 260] },
  { id: 'cove-fjord', cont: 'cont-north', ang: Math.PI, o: [-1, 0], plW: 26, plD: 14, plY: 2.0, pierL: 24, pierW: 3, fade: [120, 220] },
];

function placePort(sp: (typeof PORT_SPECS)[number]): ContPort {
  const c = CONTINENT_BY_ID[sp.cont];
  const m = c.m;
  // старт — на суші (60% радіуса в напрямку ang), далі вздовж причалу до води
  let x = sp.start ? sp.start[0] : m.x + Math.cos(sp.ang) * m.rx * 0.55, z = sp.start ? sp.start[1] : m.z + Math.sin(sp.ang) * m.rz * 0.55;
  for (let i = 0; i < 1200 && contBase(c, x, z) > 0; i++) {
    x += sp.o[0] * 2;
    z += sp.o[1] * 2;
  }
  // корінь причалу — трохи на суші, щоб набережна стояла на березі
  x -= sp.o[0] * 4;
  z -= sp.o[1] * 4;
  return { id: sp.id, cont: sp.cont, x: Math.round(x), z: Math.round(z), ox: sp.o[0], oz: sp.o[1], plW: sp.plW, plD: sp.plD, plY: sp.plY, pierL: sp.pierL, pierW: sp.pierW, fade: sp.fade ?? [330, 560] };
}

export const CONT_PORTS: ContPort[] = PORT_SPECS.map(placePort);

// ── рваний берег поверх базового: фіорди, затоки, півострови, лагуна, шхери ──
// Кожна риса — ламана з шириною, що змінюється від першої точки до останньої
// (у фіорду — широке гирло в морі, вузька голова вглибині суші). Риси м'яко
// згасають біля гаваней, тож причали, канали й плато містечок лишаються як були.

interface Feat {
  /** cut — вода (фіорд, затока); add — суша (півострів, мис); lagoon — мілка тепла вода в кільці суші */
  k: 'cut' | 'add' | 'lagoon';
  pts: Array<[number, number]>;
  w0: number;
  w1: number;
  /** звивистість (м): зсув точки шумом перед відстанню до лінії */
  warp: number;
}

const FEATS: Record<string, Feat[]> = {
  'cont-med': [
    // «чобіт»: довгий півострів на південний захід із п'ятою й носаком
    { k: 'add', pts: [[3380, 3660], [3120, 3900], [2900, 4060], [2700, 4170]], w0: 200, w1: 90, warp: 45 },
    { k: 'add', pts: [[3020, 4010], [3140, 4190]], w0: 95, w1: 70, warp: 30 },
    // західна затока — відділяє «чобіт» від материка
    { k: 'cut', pts: [[2380, 3560], [2760, 3640], [3060, 3560], [3200, 3430]], w0: 230, w1: 60, warp: 55 },
    // затока між «чоботом» і материком
    { k: 'cut', pts: [[3700, 4330], [3640, 3980], [3700, 3720]], w0: 230, w1: 70, warp: 50 },
    // велика східна затока (Гольфо)
    { k: 'cut', pts: [[4950, 2980], [4560, 2900], [4200, 2760], [4020, 2640]], w0: 330, w1: 80, warp: 60 },
    // північно-східна бухта й мис над нею
    { k: 'cut', pts: [[4520, 1980], [4260, 2180], [4080, 2300]], w0: 170, w1: 55, warp: 40 },
    { k: 'add', pts: [[4180, 1980], [4430, 1720], [4560, 1650]], w0: 120, w1: 60, warp: 35 },
    // південно-східна лагуна з вузьким проливом у море
    { k: 'lagoon', pts: [[4180, 3560], [4300, 3620]], w0: 150, w1: 120, warp: 25 },
    { k: 'cut', pts: [[4640, 3780], [4420, 3700], [4290, 3640]], w0: 40, w1: 28, warp: 15 },
    // бухточки на південному березі
    { k: 'cut', pts: [[4160, 4250], [4050, 4000]], w0: 120, w1: 40, warp: 35 },
  ],
  'cont-north': [
    // фіорди на західному березі — довгі, вузькі, звивисті
    { k: 'cut', pts: [[-4900, 2150], [-4560, 2230], [-4260, 2180], [-3990, 2290], [-3800, 2250]], w0: 95, w1: 22, warp: 55 },
    { k: 'cut', pts: [[-4880, 2950], [-4520, 2870], [-4230, 2930], [-3960, 2820]], w0: 85, w1: 22, warp: 55 },
    { k: 'cut', pts: [[-4560, 3800], [-4300, 3560], [-4100, 3420], [-3920, 3210]], w0: 90, w1: 20, warp: 50 },
    // південний фіорд і східний — південніше від Сідар-Гарбор
    { k: 'cut', pts: [[-3420, 4130], [-3480, 3820], [-3560, 3560], [-3540, 3330]], w0: 80, w1: 20, warp: 45 },
    { k: 'cut', pts: [[-2380, 3260], [-2700, 3170], [-2960, 3060], [-3160, 3010]], w0: 85, w1: 22, warp: 45 },
    // півострови: північно-західний ріг і південно-східна коса
    { k: 'add', pts: [[-4180, 1700], [-4430, 1420], [-4640, 1300]], w0: 170, w1: 60, warp: 45 },
    { k: 'add', pts: [[-3020, 3520], [-2830, 3800], [-2700, 3960]], w0: 150, w1: 55, warp: 40 },
  ],
};

/** відстань від точки до ламаної й частка шляху вздовж неї (0..1) */
function polyDist(pts: Array<[number, number]>, x: number, z: number): [number, number] {
  let best = 1e9, bt = 0, acc = 0, total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz, len = Math.sqrt(L2);
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) { best = d; bt = (acc + t * len) / total; }
    acc += len;
  }
  return [best, bt];
}

/** затухання рис біля гаваней (1 — далеко, 0 — біля причалу) */
function portFade(c: ContinentDef, x: number, z: number): number {
  let f = 1;
  for (const p of CONT_PORTS) if (p.cont === c.id) f = Math.min(f, smoothstep(p.fade[0], p.fade[1], Math.hypot(x - p.x, z - p.z)));
  return f;
}

/** «внутрішня» відстань від берега, м (>0 — суша): базовий берег + рваний берег */
export function contInside(c: ContinentDef, x: number, z: number): number {
  const base = contBase(c, x, z);
  if (base < -700) return base;
  const fade = portFade(c, x, z);
  if (fade <= 0) return base;
  const sd = c.seed;
  // дрібні бухточки й мисики вздовж берега
  let s = base + (fbm(x * 0.0085 + sd * 1.7, z * 0.0085 - sd, 3) - 0.5) * (c.style === 'north' ? 150 : 115) * smoothstep(320, 60, Math.abs(base));
  for (const f of FEATS[c.id] ?? []) {
    const wx = x + (fbm(x * 0.006 + sd, z * 0.006, 2) - 0.5) * 2 * f.warp;
    const wz = z + (fbm(x * 0.006 - 31, z * 0.006 + sd, 2) - 0.5) * 2 * f.warp;
    const [d, t] = polyDist(f.pts, wx, wz);
    const w = f.w0 + (f.w1 - f.w0) * t;
    if (f.k === 'add') s = Math.max(s, w - d);
    else if (f.k === 'cut') s = Math.min(s, d - w);
    // лагуна мілка: дно не глибше за ~2.5 м (пісок видно крізь бірюзу)
    else s = Math.min(s, Math.max(d - w, -30));
  }
  // Північ: шхери — гранітні острівці в смузі ~40–300 м від берега
  if (c.style === 'north' && s < -30 && s > -320) {
    const n = fbm(x * 0.0105 + sd, z * 0.0105 - sd * 0.6, 3);
    const band = smoothstep(-320, -220, s) * smoothstep(-30, -70, s);
    if (n > 0.66) s = Math.max(s, ((n - 0.66) * 1300 - 18) * band - 40 * (1 - band));
  }
  return base + (s - base) * fade;
}

/** висота континенту без гаваней */
function rawHeight(c: ContinentDef, x: number, z: number): number {
  const s = contInside(c, x, z);
  if (s < 0) return Math.max(c.deep, -1.0 + s * c.shelf);
  const n1 = fbm(x * 0.004 + c.seed, z * 0.004 - c.seed, 3);
  const beach = Math.min(s, c.beachW) * (1.8 / c.beachW);
  const hills = smoothstep(c.beachW * 0.6, 300, s) * c.hill * (0.3 + 0.9 * n1);
  // хребти, а не купол: гостра «ребриста» сума октав зі зсунутим шумом —
  // ланцюги вершин із сідлами й долинами; висота насичується вже за ~500 м
  // від берега, тож середина не стає одним горбом
  const wx = x + (fbm(x * 0.0009 + c.seed, z * 0.0009, 2) - 0.5) * 700;
  const wz = z + (fbm(x * 0.0009 - 7, z * 0.0009 + c.seed, 2) - 0.5) * 700;
  let ridge = 0, amp = 1, norm = 0, fx = wx * 0.00125, fz = wz * 0.00125;
  for (let o = 0; o < 4; o++) {
    const r = 1 - Math.abs(noise2(fx + c.seed * (o + 1), fz - c.seed) * 2 - 1);
    ridge += r * r * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.1;
    fz *= 2.1;
  }
  ridge /= norm;
  const mount = smoothstep(90, 520, s) * c.peak * Math.min(1.15, Math.max(0, ridge * 2.5 - 0.62));
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
