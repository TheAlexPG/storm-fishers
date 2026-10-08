import type { FishItem, FishSpecies, ZoneId } from '../core/types';

// ─────────────────────────────────────────────────────────────
// 12 видів риби, 3 зони, денні/нічні вікна.
// ─────────────────────────────────────────────────────────────

export const FISH: FishSpecies[] = [
  { id: 'hamsa',   name: 'Хамса',        basePrice: 9,    zones: ['shore'],        day: true,  night: false, rarity: 1.0,  minKg: 0.05, maxKg: 0.12 },
  { id: 'balyk',  name: 'Балійка',      basePrice: 13,   zones: ['shore'],        day: true,  night: true,  rarity: 1.0,  minKg: 0.1,  maxKg: 0.25 },
  { id: 'leschak',name: 'Лещак',        basePrice: 16,   zones: ['shore', 'mid'], day: true,  night: true,  rarity: 1.1,  minKg: 0.2,  maxKg: 0.6 },
  { id: 'plyotka',name: 'Плітка',       basePrice: 20,   zones: ['shore', 'mid'], day: true,  night: false, rarity: 1.0,  minKg: 0.15, maxKg: 0.45 },
  { id: 'makrel', name: 'Макрель',      basePrice: 34,   zones: ['mid'],          day: true,  night: true,  rarity: 1.0,  minKg: 0.4,  maxKg: 1.2 },
  { id: 'sula',   name: 'Суга',         basePrice: 46,   zones: ['mid'],          day: false, night: true,  rarity: 1.1,  minKg: 0.5,  maxKg: 1.6 },
  { id: 'krap',   name: 'Краснопірка',  basePrice: 55,   zones: ['mid'],          day: true,  night: true,  rarity: 1.2,  minKg: 0.3,  maxKg: 0.9 },
  { id: 'forel',  name: 'Форель',       basePrice: 74,   zones: ['mid', 'open'],  day: true,  night: false, rarity: 1.3,  minKg: 1.0,  maxKg: 2.8 },
  { id: 'lusk',   name: 'Луск',         basePrice: 96,   zones: ['open'],         day: false, night: true,  rarity: 1.4,  minKg: 1.2,  maxKg: 3.5 },
  { id: 'shoraga',name: 'Шорога',       basePrice: 140,  zones: ['open'],         day: false, night: true,  rarity: 1.6,  minKg: 2.0,  maxKg: 5.0 },
  { id: 'tunets', name: 'Тунець',       basePrice: 205,  zones: ['open'],         day: true,  night: true,  rarity: 1.8,  minKg: 3.0,  maxKg: 9.0 },
  { id: 'akula',  name: 'Акула',        basePrice: 340,  zones: ['open'],         day: false, night: true,  rarity: 2.4,  minKg: 6.0,  maxKg: 22.0 },
];

export const FISH_BY_ID: Record<string, FishSpecies> = Object.fromEntries(FISH.map((f) => [f.id, f]));

export const ZONE_NAMES: Record<ZoneId, string> = {
  shore: 'Узбережжя',
  mid: 'Середина',
  open: 'Відкрите море',
};

/** зона за відстанню від порту (м) */
export function zoneFromDist(d: number): ZoneId {
  if (d < 400) return 'shore';
  if (d < 900) return 'mid';
  return 'open';
}

let uidCounter = 1;
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

/** повна ціна з урахуванням свіжості */
export function fishSellPrice(item: FishItem, priceMult: Record<string, number>): number {
  const fresh = item.cooked ? 1.0 : item.freshness / 100;
  return Math.max(1, Math.round(fishPrice(item, priceMult) * (0.35 + 0.65 * fresh)));
}
