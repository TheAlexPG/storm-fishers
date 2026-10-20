import { L } from './i18n';

// ─────────────────────────────────────────────────────────────
// Мапа світу й регіони моря (чиста математика, без three.js).
//
// WS — масштаб відстаней світу: позиції портів, островів, пам'яток, скель
// і стай множаться на нього (розміри самих об'єктів — ні). Домашній «Шторм»
// лишається в (0, 0).
//
// Регіони: море тим бурхливіше, чим далі від берега, а в «бурхливих районах»
// (штормовий пояс, рифи, відкритий океан) — ще сильніше. Біля кожної гавані —
// затишок: туди можна втекти від шторму. Усе плавне (градієнти на сотні
// метрів), детерміноване з позиції — у коопі в гостей збігається само собою.
// Погода при цьому одна на світ і змінюється повільними фазами (weather.ts):
// регіон лише підсилює її, тож у небезпечному районі між штормами спокійно,
// а шторм приходить тоді ж, коли й усюди — з тим самим попередженням.
//
// Розширення світу: WORLD — єдині межі (лоція M, стіл із картою, мапа дна
// океану shoreRes, обрізання точок ботів). Новий регіон (напр. холодний
// континент із частішими штормами) — ще один запис у ROUGH: коло або
// прямокутник (hw/hh) з м'яким краєм r і силою k; шейдер океану, фізика
// хвиль, погода біля гравця, сітки й лоція підхоплять його самі.
// ─────────────────────────────────────────────────────────────

/** масштаб відстаней світу */
export const WS = 1.8;

/** межі світу (лоція, мінімапа, підкладка): x W0..W1, z H0..H1 */
export const WORLD = { W0: -1720, W1: 1720, H0: -1010, H1: 1640 };

/** від якої відстані починається «відкрите море» і де воно вже повне */
const OFF0 = 400;
const OFF1 = 1900;

export interface RoughArea {
  id: string;
  name: string;
  x: number;
  z: number;
  /** коло: радіус впливу, м (повна сила — до 0.45 r); прямокутник: ширина м'якого краю */
  r: number;
  /** додатковий множник сили погоди в центрі (більше k — і «вітряні» фронти тут стають штормами) */
  k: number;
  /** прямокутник (півширина по x і z) — для великих кліматичних смуг (напр. холодна північ континенту) */
  hw?: number;
  hh?: number;
}

/** вага району в точці 0..1 (коло або прямокутник із м'яким краєм) */
function areaWeight(a: RoughArea, x: number, z: number): number {
  if (a.hw != null && a.hh != null) {
    const dx = Math.max(0, Math.abs(x - a.x) - a.hw), dz = Math.max(0, Math.abs(z - a.z) - a.hh);
    return 1 - smooth(0, a.r, Math.hypot(dx, dz));
  }
  const d = Math.hypot(x - a.x, z - a.z);
  return d < a.r ? 1 - smooth(a.r * 0.45, a.r, d) : 0;
}

/** гавані — затишок (дзеркало portSites: корінь причалу; домашня — у 0,0) */
export interface Haven {
  x: number;
  z: number;
  r: number;
}

/** бурхливі райони — туди варто ходити за великою рибою, але стежити за небом */
export const ROUGH: RoughArea[] = [
  { id: 'belt', name: L('Штормовий пояс', `the Storm Belt`), x: 1500, z: 600, r: 520, k: 0.45 },
  { id: 'reefs', name: L('Рифи Мушлевого', `the Shell Reefs`), x: -1380, z: 760, r: 380, k: 0.35 },
  { id: 'ocean', name: L('Відкритий океан', `the Open Ocean`), x: 350, z: 1620, r: 600, k: 0.4 },
];

/** гавані-затишки: домашня — тут, інші додає portSites.ts при завантаженні */
const HAVENS: Haven[] = [{ x: 0, z: -20, r: 260 }];
export function addHaven(h: Haven) {
  HAVENS.push(h);
}
export function havens(): readonly Haven[] {
  return HAVENS;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** наскільки «відкрите» море в точці: 0 біля берега … 1 далеко */
export function offshore(x: number, z: number): number {
  return smooth(OFF0, OFF1, Math.hypot(x, z));
}

/** бурхливість району 0..~0.5 (сума бурхливих районів) */
export function roughness(x: number, z: number): number {
  let s = 0;
  for (const a of ROUGH) s += a.k * areaWeight(a, x, z);
  return s;
}

/** затишок гавані: 0 — у гавані … 1 — відкрита вода */
export function exposure(x: number, z: number): number {
  let e = 1;
  for (const h of HAVENS) {
    const d = Math.hypot(x - h.x, z - h.z);
    if (d < h.r) e = Math.min(e, smooth(h.r * 0.35, h.r, d));
  }
  return e;
}

/** найсильніший бурхливий район у точці (для підказок) */
export function roughAt(x: number, z: number): { area: RoughArea | null; v: number } {
  let best: RoughArea | null = null, v = 0;
  for (const a of ROUGH) {
    const w = areaWeight(a, x, z);
    if (w > v) { v = w; best = a; }
  }
  return { area: best, v };
}

/** найближча гавань-затишок і відстань до неї */
export function nearestHaven(x: number, z: number): { h: Haven; d: number } {
  let h = HAVENS[0], d = Infinity;
  for (const q of HAVENS) {
    const e = Math.hypot(x - q.x, z - q.z);
    if (e < d) { d = e; h = q; }
  }
  return { h, d };
}

/** множник сили погоди в точці (0.7 у гавані … ~1.9 у штормовому поясі) */
export function seaMul(x: number, z: number): number {
  const m = 0.7 + 0.75 * offshore(x, z) + roughness(x, z);
  return 0.7 + (m - 0.7) * exposure(x, z);
}

/**
 * Роздільність мапи дна (ocean.setShore), м/піксель: 2 м, поки світ уміщається
 * в maxPx пікселів по більшій стороні; більший світ — грубіше (текстура ≤ maxPx).
 */
export function shoreRes(maxPx = 2048): number {
  return Math.max(2, Math.ceil(Math.max(WORLD.W1 - WORLD.W0, WORLD.H1 - WORLD.H0) / maxPx));
}

/** точка в межах світу (з відступом m від краю) */
export function clampToWorld(x: number, z: number, m = 0): [number, number] {
  return [Math.min(WORLD.W1 - m, Math.max(WORLD.W0 + m, x)), Math.min(WORLD.H1 - m, Math.max(WORLD.H0 + m, z))];
}

/** найбільша локальна сила погоди (хвилі/фізика не розганяються безмежно) */
export const LOCAL_MAX = 1.75;

/**
 * Локальна сила погоди з глобальної (base) і множника місця (mul).
 * Підсилення бурхливих районів діє здебільшого в негоду: у ясну погоду там
 * лише трохи вища хвиля (можна спокійно рибалити), а фронт перетворюється на
 * справжній шторм. Біля берега (mul < 1) затишно завжди.
 */
export function localIntensity(base: number, mul: number): number {
  const k = mul > 1 ? 0.35 + 0.65 * smooth(0.3, 0.8, base) : 1;
  return Math.min(LOCAL_MAX, base * (1 + (mul - 1) * k));
}

/** GLSL-дзеркало seaMul/localIntensity (з даних регіонів на момент компіляції шейдера) */
export function regionGlsl(): string {
  const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const rough = ROUGH.map((a) =>
    a.hw != null && a.hh != null
      ? `  { vec2 q = max(abs(p - vec2(${f(a.x)}, ${f(a.z)})) - vec2(${f(a.hw)}, ${f(a.hh!)}), 0.0); s += ${f(a.k)} * (1.0 - smoothstep(0.0, ${f(a.r)}, length(q))); }`
      : `  { float d = length(p - vec2(${f(a.x)}, ${f(a.z)})); s += ${f(a.k)} * (1.0 - smoothstep(${f(a.r * 0.45)}, ${f(a.r)}, d)); }`,
  ).join('\n');
  const hav = HAVENS.map((h) => `  e = min(e, smoothstep(${f(h.r * 0.35)}, ${f(h.r)}, length(p - vec2(${f(h.x)}, ${f(h.z)}))));`).join('\n');
  return `
float seaMul(vec2 p) {
  float t = smoothstep(${f(OFF0)}, ${f(OFF1)}, length(p));
  float s = 0.0;
${rough}
  float e = 1.0;
${hav}
  float m = 0.7 + 0.75 * t + s;
  return 0.7 + (m - 0.7) * e;
}
float localIntensity(float base, float mul) {
  float k = mul > 1.0 ? 0.35 + 0.65 * smoothstep(0.3, 0.8, base) : 1.0;
  return min(${f(LOCAL_MAX)}, base * (1.0 + (mul - 1.0) * k));
}
`;
}
