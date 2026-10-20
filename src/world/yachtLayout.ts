// ─────────────────────────────────────────────────────────────
// Компонування вітрильної яхти «Шторм» — спільне для моделі, гравця
// й океану (вода не малюється всередині корпусу).
// Локальні координати: +Z — нос, +X — правий борт (з-за штурвала — ліворуч,
// див. dialTexture), y = 0 — ватерлінія.
//
//   корма z=-4.7 ── відкритий кокпіт (тент — апгрейд) ── рубка (над салоном) ── бак з вудкою ── нос z=+4.7
//                         ▼ сходи (компаньйон) z -0.6..0.6
//                      салон у корпусі: камбуз | штурманський стіл | дивани | V-койка
// ─────────────────────────────────────────────────────────────

export const HULL_LEN = 9.4;
export const HALF_LEN = HULL_LEN / 2;
export const MAX_HALF_BEAM = 1.8;
export const DECK_Y = 1.05;
/** фактична ватерлінія у спокійній воді (рівновага буївності човна) */
export const WATERLINE_Y = 0.5;

/** напівширина корпусу на рівні палуби (локальне z) */
export function hullHalfWidth(z: number): number {
  const t = z / HALF_LEN;
  if (t <= -1 || t >= 1) return t <= -1 ? MAX_HALF_BEAM - 0.25 : 0;
  if (t < 0) return MAX_HALF_BEAM - 0.25 * t * t; // широка корма (транец 1.55)
  return MAX_HALF_BEAM * Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 0.75);
}

/** дно секції по центру (кіль-лінія канойного корпусу, без фін-кіля) */
export function hullBottomY(z: number): number {
  const t = z / HALF_LEN;
  if (t >= 0) {
    const s = smooth(0.55, 1.0, t);
    return -0.85 + (DECK_Y + 0.85) * Math.pow(s, 1.8); // похилий форштевень
  }
  const s = smooth(-0.35, -1.0, t);
  return -0.85 + 1.45 * s; // корма піднімається до транца (над ватерлінією)
}

/** погибь (sheer): борт трохи вищий на носі */
export function sheerY(z: number): number {
  const t = Math.max(0, z / HALF_LEN);
  return DECK_Y + 0.06 + 0.28 * t * t;
}

/** x корпусу на висоті y у секції z (для ілюмінаторів і кріплень) */
export function hullXAt(y: number, z: number): number {
  const top = sheerY(z);
  const bot = hullBottomY(z);
  const r = Math.min(1, Math.max(0, (top - y) / (top - bot)));
  const th = Math.asin(Math.pow(r, 1 / 1.6));
  return hullHalfWidth(z) * Math.sqrt(Math.cos(th));
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ── палуба ──
/** рубка (deckhouse) над салоном: тверда на рівні палуби, окрім прорізу трапа */
export const HOUSE = { x: 0.92, z0: -0.6, z1: 2.6, top: DECK_Y + 0.72 };
/** кокпіт: коамінги ±COCKPIT.x, z0..z1 — відкритий (без даху): з-за штурвала видно паруси */
export const COCKPIT = { x: 1.0, z0: -4.35, z1: -0.6 };
/**
 * кормова дуга (нержавійка) над транцем: сонячні панелі, антена, ліхтар, кофр.
 * Рама на висоті y між z0..z1 — за спиною стерновика, щоб не закривати паруси.
 */
export const ARCH = { x: 1.05, y: DECK_Y + 2.22, z0: -4.78, z1: -4.16, foot: -4.45 };
/** тент (апгрейд): козирок над трапом, біміні над штурвалом, штори кокпіту */
export const TENT = {
  /** біміні: від рами дуги до переднього обруча */
  bz0: ARCH.z1 + 0.02,
  bz1: -2.9,
  /** висота біміні: біля дуги / біля переднього обруча (по центру) */
  by0: ARCH.y - 0.04,
  by1: DECK_Y + 2.06,
  bx: 1.08,
  /** козирок над трапом: від кормового обруча до даху рубки */
  sz0: HOUSE.z0 + 0.03,
  sz1: 0.5,
  sx: 0.86,
  sh: 0.94,
};

// ── трап (компаньйон) ──
export const SOLE_Y = -0.5; // підлога салону
export const STAIR = { x: 0.38, zTop: -0.6, zBot: 0.6 };
export function stairY(z: number): number {
  const f = Math.min(1, Math.max(0, (z - STAIR.zTop) / (STAIR.zBot - STAIR.zTop)));
  return DECK_Y + (SOLE_Y - DECK_Y) * f;
}

// ── салон: вільний прохід (меблі — поза ним) ──
export const SALOON = { x: 0.52, z0: STAIR.zBot, z1: 2.62 };

export interface Box2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** тверді перешкоди на рівні палуби */
export const DECK_COLLIDERS: Box2[] = [
  // рубка, ліворуч і праворуч трапа, та її носова частина
  { x0: -HOUSE.x, x1: -STAIR.x, z0: HOUSE.z0, z1: 2.0 },
  { x0: STAIR.x, x1: HOUSE.x, z0: HOUSE.z0, z1: 2.0 },
  { x0: -STAIR.x, x1: STAIR.x, z0: STAIR.zBot, z1: 2.0 },
  // носова частина рубки звужується (похила стінка) — прохід бічною палубою
  { x0: -HOUSE.x + 0.2, x1: HOUSE.x - 0.2, z0: 2.0, z1: HOUSE.z1 },
  // лави кокпіту
  { x0: -1.0, x1: -0.58, z0: -2.43, z1: -0.77 },
  { x0: 0.58, x1: 1.0, z0: -2.43, z1: -0.77 },
  // штурвальна тумба
  { x0: -0.18, x1: 0.18, z0: -3.8, z1: -3.2 },
];

/** межі ходьби по палубі: всередині обрису корпусу з відступом */
export function deckLimitX(z: number, r: number): number {
  return Math.max(0.05, hullHalfWidth(z) - 0.1 - r);
}

// ── рангоут ──
export const RIG = {
  mastZ: 1.55,
  base: HOUSE.top,
  top: HOUSE.top + 11.2,
  /** гік — над головою (≈2.3 м над кокпітом), вище за біміні й козирок */
  boomY: DECK_Y + 2.3,
  boomZ1: -2.7,
};
