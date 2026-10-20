import { GROUND_Y } from './portTerrain';

// ─────────────────────────────────────────────────────────────
// Хата рибалки в домашньому порту — розміри й точки всередині.
// Спільне для моделі (homeCottage.ts), порту (платформа підлоги)
// і гравця (чи він у хаті, що тут можна натиснути E).
// Фасад із дверима дивиться на набережну (+Z).
// ─────────────────────────────────────────────────────────────

export const COTTAGE = {
  /** центр хати */
  x: -2,
  z: -62,
  /** ширина (уздовж X) і глибина (уздовж Z), зовні по стінах */
  w: 5.6,
  d: 5,
  /** товщина стін */
  t: 0.2,
  /** висота стін від підлоги й висота фронтону */
  h: 3.1,
  rh: 2.2,
  /** підлога трохи вище бруківки — поріг */
  floorY: GROUND_Y + 0.3,
  /** ширина й висота дверного прорізу */
  doorW: 1.1,
  doorH: 2.15,
};

const C = COTTAGE;
/** внутрішні межі (по стінах) */
export const COTTAGE_IN = {
  x0: C.x - C.w / 2 + C.t,
  x1: C.x + C.w / 2 - C.t,
  z0: C.z - C.d / 2 + C.t,
  z1: C.z + C.d / 2 - C.t,
};

/** ліжко: головою до задньої стіни, у лівому куті */
export const COTTAGE_BED = { x: COTTAGE_IN.x0 + 0.72, z: COTTAGE_IN.z0 + 1.08, w: 1.3, len: 2.1 };
/** стенд прогресу на правій стіні (дивиться всередину, −X) */
export const COTTAGE_BOARD = { x: COTTAGE_IN.x1 - 0.04, y: C.floorY + 1.62, z: C.z - 0.2, w: 2.0, h: 1.27 };
/** точки для E (гравець стоїть поруч) */
export const COTTAGE_SPOTS = {
  bed: { x: COTTAGE_BED.x + 0.95, z: COTTAGE_BED.z + 0.35 },
  board: { x: COTTAGE_BOARD.x - 1.0, z: COTTAGE_BOARD.z },
};

/** гравець у хаті (з невеликим запасом, щоб у прорізі дверей теж вважалось «під дахом») */
export function insideCottage(x: number, z: number, m = 0): boolean {
  return x > COTTAGE_IN.x0 - m && x < COTTAGE_IN.x1 + m && z > COTTAGE_IN.z0 - m && z < COTTAGE_IN.z1 + m;
}
