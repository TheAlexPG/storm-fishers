import { clamp, mulberry32 } from '../core/math';
import { FISH, FISH_BY_ID } from './fish';
import type { FishItem } from '../core/types';

// ─────────────────────────────────────────────────────────────
// Біржа риби: насичення ринку за видами + випадкові події.
//
// Кожен проданий улов «засипає» ринок свого виду (glut, у «типових рибинах»).
// Перші FREE рибин виду йдуть за повну ціну, далі кожна наступна — на DROP
// дешевше (не нижче FLOOR). Ринок розсмоктується на RECOVER одиниць за
// ігрову годину (≈ 12 рибин за добу) — різноманітний улов не страждає,
// а 15 однакових тунців поспіль продаються з помітною знижкою.
// ─────────────────────────────────────────────────────────────

/** скільки «типових рибин» виду ринок бере без знижки */
export const MARKET_FREE = 2;
/** падіння попиту за кожну типову рибину понад FREE */
export const MARKET_DROP = 0.08;
/** найнижчий множник попиту */
export const MARKET_FLOOR = 0.3;
/** розсмоктування надлишку, од./ігрову годину */
export const MARKET_RECOVER = 0.5;
/** як часто пишемо точку історії ціни (ігрові години) */
export const MARKET_SAMPLE_H = 3;
export const MARKET_HISTORY = 10;

export interface MarketEvent {
  speciesId: string;
  /** множник ціни (1.4 = +40 %) */
  mult: number;
  /** діє до цього номера дня цін (priceWeek), включно */
  until: number;
  text: string;
}

export interface MarketSave {
  glut: Record<string, number>;
  hist: Record<string, number[]>;
  prev: Record<string, number>;
  events: MarketEvent[];
  acc: number;
}

/** відмінки для оголошень: [знахідний, орудний] */
const CASES: Record<string, [string, string]> = {
  hamsa: ['шпрот', 'шпротом'],
  balyk: ['оселедця', 'оселедцем'],
  leschak: ['камбалу', 'камбалою'],
  plyotka: ['пікшу', 'пікшею'],
  makrel: ['скумбрію', 'скумбрією'],
  sula: ['сайду', 'сайдою'],
  krap: ['морського окуня', 'морським окунем'],
  forel: ['лосося', 'лососем'],
  lusk: ['тріску', 'тріскою'],
  shoraga: ['палтуса', 'палтусом'],
  tunets: ['тунця', 'тунцем'],
  akula: ['акулу', 'акулою'],
};

const BUYERS = ['Ресторан «Маяк» скуповує', 'Рибзавод шукає', 'Готель «Хвиля» замовив', 'Ярмарок у місті — розбирають'];
const GLUTS = ['Ринок завалено', 'Траулер засипав ринок'];

export function avgKg(speciesId: string): number {
  const sp = FISH_BY_ID[speciesId];
  return sp ? (sp.minKg + sp.maxKg) / 2 : 1;
}

/** скільки «типових рибин» додає ця риба (важча — більше, але не лінійно) */
export function glutUnits(item: FishItem): number {
  return clamp(Math.sqrt(item.kg / avgKg(item.speciesId)), 0.6, 1.6);
}

/** множник попиту при заданому надлишку */
export function demandAt(glut: number): number {
  return clamp(1 - MARKET_DROP * Math.max(0, glut - MARKET_FREE), MARKET_FLOOR, 1);
}

export class FishMarket {
  glut: Record<string, number> = {};
  /** історія ціни ₴/кг за видом (старі → нові) */
  hist: Record<string, number[]> = {};
  /** тижневий множник попереднього дня — для стрілки тренду */
  prev: Record<string, number> = {};
  events: MarketEvent[] = [];
  /** накопичені години до наступної точки історії */
  private acc = 0;

  demand(speciesId: string): number {
    return demandAt(this.glut[speciesId] ?? 0);
  }

  eventMult(speciesId: string): number {
    let m = 1;
    for (const e of this.events) if (e.speciesId === speciesId) m *= e.mult;
    return m;
  }

  eventFor(speciesId: string): MarketEvent | undefined {
    return this.events.find((e) => e.speciesId === speciesId);
  }

  /** множник ринку (подія × попит) поверх тижневого тренду */
  factor(speciesId: string): number {
    return this.eventMult(speciesId) * this.demand(speciesId);
  }

  /** ціна за кг «зараз» (без свіжості/шторму) */
  perKg(speciesId: string, priceMult: Record<string, number>): number {
    const sp = FISH_BY_ID[speciesId];
    if (!sp) return 0;
    return (sp.basePrice / avgKg(speciesId)) * (priceMult[speciesId] ?? 1) * this.factor(speciesId);
  }

  /** записати продаж у ринок */
  recordSale(item: FishItem) {
    this.glut[item.speciesId] = (this.glut[item.speciesId] ?? 0) + glutUnits(item);
  }

  /** хід часу (ігрові години): надлишок розсмоктується, пишеться історія */
  tick(hours: number, priceMult: Record<string, number>) {
    if (!(hours > 0)) return;
    for (const id of Object.keys(this.glut)) {
      const g = this.glut[id] - MARKET_RECOVER * hours;
      if (g <= 0) delete this.glut[id];
      else this.glut[id] = g;
    }
    this.acc += hours;
    // сон пропускає багато годин — пишемо не більше кількох точок
    let n = 0;
    while (this.acc >= MARKET_SAMPLE_H && n < 4) {
      this.acc -= MARKET_SAMPLE_H;
      this.sample(priceMult);
      n++;
    }
    if (this.acc >= MARKET_SAMPLE_H) this.acc = 0;
  }

  sample(priceMult: Record<string, number>) {
    for (const sp of FISH) {
      const h = (this.hist[sp.id] ??= []);
      h.push(Math.round(this.perKg(sp.id, priceMult) * 10) / 10);
      if (h.length > MARKET_HISTORY) h.splice(0, h.length - MARKET_HISTORY);
    }
  }

  /** новий день цін: запам'ятати старі множники, оновити події. Повертає нову подію (для оголошення) */
  newDay(oldMult: Record<string, number>, day: number): MarketEvent | null {
    this.prev = { ...oldMult };
    this.events = this.events.filter((e) => e.until >= day);
    // детерміновано від номера дня — однаково при перезавантаженні
    const rng = mulberry32(day * 104729 + 31);
    if (this.events.length >= 2 || rng() > 0.5) return null;
    const free = FISH.filter((f) => !this.events.some((e) => e.speciesId === f.id));
    const sp = free[Math.floor(rng() * free.length)];
    if (!sp) return null;
    const boost = rng() < 0.6;
    const pct = boost ? 30 + Math.round(rng() * 4) * 5 : 25 + Math.round(rng() * 2) * 5;
    const dur = 1 + Math.floor(rng() * 2); // 1–2 доби
    const [acc, ins] = CASES[sp.id] ?? [sp.name, sp.name];
    const lead = boost ? BUYERS[Math.floor(rng() * BUYERS.length)] : GLUTS[Math.floor(rng() * GLUTS.length)];
    const days = dur === 1 ? 'до завтра' : '2 доби';
    const text = boost ? `${lead} ${acc}: +${pct}% · ${days}` : `${lead} ${ins}: −${pct}% · ${days}`;
    const ev: MarketEvent = { speciesId: sp.id, mult: boost ? 1 + pct / 100 : 1 - pct / 100, until: day + dur - 1, text };
    this.events.push(ev);
    return ev;
  }

  serialize(): MarketSave {
    return { glut: { ...this.glut }, hist: this.hist, prev: this.prev, events: this.events, acc: this.acc };
  }

  load(d: Partial<MarketSave> | undefined) {
    this.glut = {};
    this.hist = {};
    this.prev = {};
    this.events = [];
    this.acc = 0;
    if (!d || typeof d !== 'object') return;
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    if (d.glut) for (const [k, v] of Object.entries(d.glut)) if (FISH_BY_ID[k] && num(v) && v > 0) this.glut[k] = v;
    if (d.hist) {
      for (const [k, v] of Object.entries(d.hist)) {
        if (FISH_BY_ID[k] && Array.isArray(v)) this.hist[k] = v.filter(num).slice(-MARKET_HISTORY);
      }
    }
    if (d.prev) for (const [k, v] of Object.entries(d.prev)) if (num(v)) this.prev[k] = v;
    if (Array.isArray(d.events)) {
      this.events = d.events.filter(
        (e) => e && FISH_BY_ID[e.speciesId] && num(e.mult) && num(e.until) && typeof e.text === 'string',
      );
    }
    if (num(d.acc)) this.acc = d.acc!;
  }
}
