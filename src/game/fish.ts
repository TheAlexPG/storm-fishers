import type { FishItem, FishSpecies, ZoneId } from '../core/types';

// ─────────────────────────────────────────────────────────────
// 12 видів риби, 3 зони, денні/нічні вікна.
// ─────────────────────────────────────────────────────────────

export const FISH: FishSpecies[] = [
  { id: 'hamsa',   name: 'Шпрот',        basePrice: 9,    zones: ['shore'],        day: true,  night: false, rarity: 1.0,  minKg: 0.05, maxKg: 0.12 },
  { id: 'balyk',  name: 'Оселедець',    basePrice: 13,   zones: ['shore'],        day: true,  night: true,  rarity: 1.0,  minKg: 0.1,  maxKg: 0.25 },
  { id: 'leschak',name: 'Камбала',      basePrice: 16,   zones: ['shore', 'mid'], day: true,  night: true,  rarity: 1.1,  minKg: 0.2,  maxKg: 0.6 },
  { id: 'plyotka',name: 'Пікша',        basePrice: 20,   zones: ['shore', 'mid'], day: true,  night: false, rarity: 1.0,  minKg: 0.15, maxKg: 0.45 },
  { id: 'makrel', name: 'Скумбрія',     basePrice: 34,   zones: ['mid'],          day: true,  night: true,  rarity: 1.0,  minKg: 0.4,  maxKg: 1.2 },
  { id: 'sula',   name: 'Сайда',        basePrice: 46,   zones: ['mid'],          day: false, night: true,  rarity: 1.1,  minKg: 0.5,  maxKg: 1.6 },
  { id: 'krap',   name: 'Морський окунь', basePrice: 55,   zones: ['mid'],          day: true,  night: true,  rarity: 1.2,  minKg: 0.3,  maxKg: 0.9 },
  { id: 'forel',  name: 'Лосось',       basePrice: 74,   zones: ['mid', 'open'],  day: true,  night: false, rarity: 1.3,  minKg: 1.0,  maxKg: 2.8 },
  { id: 'lusk',   name: 'Тріска',       basePrice: 96,   zones: ['open'],         day: false, night: true,  rarity: 1.4,  minKg: 1.2,  maxKg: 3.5 },
  { id: 'shoraga',name: 'Палтус',       basePrice: 140,  zones: ['open'],         day: false, night: true,  rarity: 1.6,  minKg: 2.0,  maxKg: 5.0 },
  { id: 'tunets', name: 'Тунець',       basePrice: 205,  zones: ['open'],         day: true,  night: true,  rarity: 1.8,  minKg: 3.0,  maxKg: 9.0 },
  { id: 'akula',  name: 'Акула',        basePrice: 340,  zones: ['open'],         day: false, night: true,  rarity: 2.4,  minKg: 6.0,  maxKg: 22.0 },
];

export const FISH_BY_ID: Record<string, FishSpecies> = Object.fromEntries(FISH.map((f) => [f.id, f]));

export const ZONE_NAMES: Record<ZoneId, string> = {
  shore: 'Узбережжя',
  mid: 'Середина',
  open: 'Відкрите море',
};

/** де на карті стоять стаї з радіо-звітів (за зонами) — карта малює їх тут */
export const SCHOOL_ANCHORS: Record<ZoneId, [number, number]> = {
  shore: [150, 110],
  mid: [-380, 520],
  open: [600, 720],
};

// ─────────────────────────────────────────────────────────────
// Місце лову: далеко від берега й від стай клює рідко, але риба більша
// й частіше трапляється трофей; на стаї — часто, але дрібніше.
// ─────────────────────────────────────────────────────────────

export interface FishingSpot {
  /** віддаленість від порту 0..1 */
  far: number;
  /** близькість до стаї з радіо-звіту 0..1 */
  heat: number;
  /** множник часу очікування клювання */
  wait: number;
  /** шанс трофея (без вудки) */
  trophy: number;
  /** коротка підказка гравцю */
  hint: string;
}

export const SCHOOL_R = 120;

export function fishingSpot(x: number, z: number, reports: ReadonlyArray<{ zone: ZoneId }>): FishingSpot {
  const d = Math.hypot(x, z);
  const far = Math.min(1, Math.max(0, (d - 120) / 1000));
  let heat = 0;
  for (const r of reports) {
    const [ax, az] = SCHOOL_ANCHORS[r.zone];
    const q = Math.hypot(x - ax, z - az) / SCHOOL_R;
    heat = Math.max(heat, Math.exp(-q * q));
  }
  const cold = 1 - heat;
  const wait = (0.75 + 0.95 * far) * (1 - 0.55 * heat);
  const trophy = 0.02 + 0.15 * far * cold;
  const hint =
    heat > 0.45 ? '🐟 Тут стая — клює часто, риба дрібніша'
    : far > 0.55 ? '🌊 Глибока вода — клює рідко · шанс на трофей ↑'
    : far > 0.25 ? 'Відкрита вода — клює помірно, трапляються великі'
    : 'Біля берега — клює швидко, риба невелика';
  return { far, heat, wait, trophy, hint };
}

/** вага риби: на стаї — дрібніша; далеко й поза стаями — «товстий хвіст» трофеїв */
export function rollKg(sp: FishSpecies, spot: FishingSpot, rodTrophy: number, rnd: () => number = Math.random): { kg: number; trophy: boolean } {
  const r = (a: number, b: number) => a + (b - a) * rnd();
  let kg = r(sp.minKg, sp.maxKg) * r(0.85, 1.15) * (1 - 0.18 * spot.heat) * (1 + 0.15 * spot.far) * (1 + rodTrophy * 0.2);
  const p = spot.trophy + rodTrophy * 0.08;
  const trophy = rnd() < p;
  if (trophy) kg = Math.max(kg, sp.maxKg) * r(1.25, 1.9);
  return { kg, trophy };
}

/** трофей — набагато більший за звичайний максимум виду */
export function isTrophy(speciesId: string, kg: number): boolean {
  const sp = FISH_BY_ID[speciesId];
  return !!sp && kg >= sp.maxKg * 1.2;
}

/** зона за відстанню від порту (м) */
export function zoneFromDist(d: number): ZoneId {
  if (d < 400) return 'shore';
  if (d < 900) return 'mid';
  return 'open';
}

// випадкова база: uid не повторюються між перезапусками й гравцями (спільний трюм у коопі)
let uidCounter = Math.floor(Math.random() * 2 ** 40);
export function makeFish(speciesId: string, kg: number, storm: boolean): FishItem {
  return {
    uid: uidCounter++,
    speciesId,
    kg,
    freshness: 100,
    cooked: false,
    storm,
  };
}

/** ціна за одиницю (без свіжості) */
export function fishPrice(item: FishItem, priceMult: Record<string, number>): number {
  const sp = FISH_BY_ID[item.speciesId];
  if (!sp) return 0;
  const mult = priceMult[item.speciesId] ?? 1;
  const perKg = sp.basePrice / ((sp.minKg + sp.maxKg) / 2);
  let v = item.kg * perKg * mult;
  v *= item.cooked ? 1.5 : 1.0;
  if (item.storm) v *= 1.25;
  return v;
}

/** повна ціна з урахуванням свіжості; market — множник біржі (подія × попит) */
export function fishSellPrice(item: FishItem, priceMult: Record<string, number>, market = 1): number {
  const fresh = item.cooked ? 1.0 : item.freshness / 100;
  return Math.max(1, Math.round(fishPrice(item, priceMult) * market * (0.35 + 0.65 * fresh)));
}
