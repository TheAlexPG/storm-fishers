import { clamp, mulberry32 } from '../core/math';
import { FISH, FISH_BY_ID } from './fish';
import type { FishItem, ZoneId } from '../core/types';

// ─────────────────────────────────────────────────────────────
// Жива біржа риби: запас × споживання × підвіз.
//
// Кожен ринок (біржа порту) тримає за видами ЗАПАС риби в «типових рибинах».
// Норма запасу T залежить від виду (дешевої риби місто з'їдає більше) і розміру
// порту. Місто їсть рибу щогодини (≈ T за MARKET_TAU год, удень і на вихідних —
// більше), а підвозять її рибалки: фонова флотилія безперервно і боти-траулери
// партіями, коли швартуються. У шторм не ловить ніхто — запас тане, ціна росте;
// після довгого штилю рибу везуть усі — ціна сповзає.
//
// Ціна = базова × тижневий тренд × подія × f(запас / норма):
//   f = √(T / S), у межах FACTOR_MIN…FACTOR_MAX. Одна продана рибина зсуває
// запас на ~1/T — ледь помітно; 30 однакових рибин — помітно (−30…−45 % на хвості),
// і надлишок місто доїдає за 1–2 ігрові доби.
// ─────────────────────────────────────────────────────────────

/** стала «з'їдання» надлишку, ігрові години */
export const MARKET_TAU = 20;
export const FACTOR_MIN = 0.55;
export const FACTOR_MAX = 1.45;
/** частка підвозу домашньої біржі, яку привозять видимі боти (решта — фонова флотилія) */
const BOT_SHARE = 0.45;
/** зони, де ловлять боти «Шторму» (bots.ts: 140–820 м від порту) */
const BOT_ZONES: ZoneId[] = ['shore', 'mid'];
/** фоновий «невиловлений боту» улов доходить на ринок за стільки годин */
const POOL_LEAK_H = 30;
/** як часто пишемо точку історії ціни (ігрові години) */
export const MARKET_SAMPLE_H = 3;
/** точок історії: 8 на добу × 6 діб — вистачає на графік біржі */
export const MARKET_HISTORY = 48;
/** новин про підвіз пам'ятаємо */
const NEWS_MAX = 6;

export interface MarketEvent {
  speciesId: string;
  /** множник ціни (1.4 = +40 %) */
  mult: number;
  /** діє до цього номера дня цін (priceWeek), включно */
  until: number;
  text: string;
}

/** новина про підвіз (бот здав улов) */
export interface MarketNews {
  /** ігровий час (абс. години), щоб не показувати двічі */
  h: number;
  who: string;
  text: string;
}

export interface MarketSave {
  /** запас за видами, типові рибини */
  stock?: Record<string, number>;
  /** ще не довезений улов фонової флотилії (його частку привозять боти) */
  pool?: Record<string, number>;
  /** старі сейви: надлишок над «повним попитом» */
  glut?: Record<string, number>;
  hist: Record<string, number[]>;
  prev: Record<string, number>;
  events: MarketEvent[];
  acc: number;
  news?: MarketNews[];
}

/** стан світу для кроку ринку */
export interface MarketCtx {
  /** година доби 0..24 */
  hour: number;
  /** номер дня (для вихідних) */
  day: number;
  /** сила погоди 0..~1.1 (Weather.base) */
  weather: number;
}

/** відмінки для оголошень: [знахідний, орудний, родовий] */
const CASES: Record<string, [string, string, string]> = {
  hamsa: ['шпрот', 'шпротом', 'шпроту'],
  balyk: ['оселедця', 'оселедцем', 'оселедця'],
  leschak: ['камбалу', 'камбалою', 'камбали'],
  plyotka: ['пікшу', 'пікшею', 'пікші'],
  makrel: ['скумбрію', 'скумбрією', 'скумбрії'],
  sula: ['сайду', 'сайдою', 'сайди'],
  krap: ['морського окуня', 'морським окунем', 'морського окуня'],
  forel: ['лосося', 'лососем', 'лосося'],
  lusk: ['тріску', 'тріскою', 'тріски'],
  shoraga: ['палтуса', 'палтусом', 'палтуса'],
  tunets: ['тунця', 'тунцем', 'тунця'],
  akula: ['акулу', 'акулою', 'акули'],
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

/** норма запасу виду на домашній біржі (типові рибини): дешевої риби місто їсть більше */
export function marketTarget(speciesId: string): number {
  const sp = FISH_BY_ID[speciesId];
  return sp ? 52 / Math.sqrt(sp.basePrice / 9) : 20;
}

/** множник ціни від запасу: дефіцит — дорожче, надлишок — дешевше */
export function stockFactor(stock: number, target: number): number {
  return clamp(Math.sqrt(target / Math.max(stock, target * 0.2)), FACTOR_MIN, FACTOR_MAX);
}

/** чи ловить хтось у таку погоду: штиль — уся флотилія в морі, шторм — ніхто */
export function fishingFactor(weather: number): number {
  // середнє за погодний цикл (тиша ~45 %, вітер ~30 %, шторм ~25 %) ≈ 1 — ціна в середньому «звична»
  if (weather < 0.3) return 1.5;
  if (weather < 0.58) return 1.5 - ((weather - 0.3) / 0.28) * 0.85;
  return 0;
}

/** споживання: удень і ввечері їдять більше, на вихідних — ще більше, у шторм — менше */
export function consumeMult(ctx: MarketCtx): number {
  const dayCurve = 1 + 0.45 * Math.sin(((ctx.hour - 9) / 24) * Math.PI * 2);
  const dow = ((ctx.day % 7) + 7) % 7;
  const weekend = dow === 0 || dow === 6 ? 1.2 : 1;
  const storm = ctx.weather > 0.75 ? 0.85 : 1;
  return dayCurve * weekend * storm;
}

export function isWeekend(day: number): boolean {
  const dow = ((day % 7) + 7) % 7;
  return dow === 0 || dow === 6;
}

/** назва виду в родовому відмінку («тріски») */
export function speciesGen(speciesId: string): string {
  return CASES[speciesId]?.[2] ?? (FISH_BY_ID[speciesId]?.name ?? speciesId).toLowerCase();
}

export class FishMarket {
  /** запас за видами (типові рибини); немає запису — норма */
  stock: Record<string, number> = {};
  /** частка улову фонової флотилії, яку довезуть боти (лише домашня біржа) */
  pool: Record<string, number> = {};
  /** історія ціни ₴/кг за видом (старі → нові) */
  hist: Record<string, number[]> = {};
  /** тижневий множник попереднього дня — для стрілки тренду */
  prev: Record<string, number> = {};
  events: MarketEvent[] = [];
  /** хто що здав (біжучий рядок біржі, канал 16) */
  news: MarketNews[] = [];
  /** розмір ринку: множник норми й споживання (село — менше, курорт — більше) */
  scale = 1;
  /** кооп-гість: запаси приходять від капітана кімнати — свого підвозу/споживання немає */
  remote = false;
  /** накопичені години до наступної точки історії */
  protected acc = 0;

  /** частка улову виду, яку фонова флотилія везе саме сюди (місцеві види — більше) */
  supplyBias(_speciesId: string): number {
    return 1;
  }

  /** чи привозять сюди боти (домашня біржа «Шторму») */
  get hasBots(): boolean {
    return true;
  }

  target(speciesId: string): number {
    return marketTarget(speciesId) * this.scale;
  }

  stockOf(speciesId: string): number {
    return this.stock[speciesId] ?? this.target(speciesId) * this.supplyBias(speciesId);
  }

  /** множник ціни від запасу (дефіцит > 1, надлишок < 1) */
  demand(speciesId: string): number {
    return stockFactor(this.stockOf(speciesId), this.target(speciesId));
  }

  eventMult(speciesId: string): number {
    let m = 1;
    for (const e of this.events) if (e.speciesId === speciesId) m *= e.mult;
    return m;
  }

  eventFor(speciesId: string): MarketEvent | undefined {
    return this.events.find((e) => e.speciesId === speciesId);
  }

  /** множник ринку (подія × запас) поверх тижневого тренду */
  factor(speciesId: string): number {
    return this.eventMult(speciesId) * this.demand(speciesId);
  }

  /** множник ринку при заданому запасі (прорахунок кількох продажів поспіль) */
  factorAt(speciesId: string, stock: number): number {
    return this.eventMult(speciesId) * stockFactor(stock, this.target(speciesId));
  }

  /** ціна за кг «зараз» для свіжої риби (без свіжості/шторму) */
  perKg(speciesId: string, priceMult: Record<string, number>): number {
    const sp = FISH_BY_ID[speciesId];
    if (!sp) return 0;
    return (sp.basePrice / avgKg(speciesId)) * (priceMult[speciesId] ?? 1) * this.factor(speciesId);
  }

  /** записати продаж у ринок */
  recordSale(item: FishItem) {
    this.addStock(item.speciesId, glutUnits(item));
  }

  addStock(speciesId: string, units: number) {
    if (!FISH_BY_ID[speciesId] || !(units > 0)) return;
    this.stock[speciesId] = this.stockOf(speciesId) + units;
  }

  /**
   * хід часу (ігрові години): споживання й підвіз (якщо ctx і не гість),
   * запис історії ціни
   */
  tick(hours: number, priceMult: Record<string, number>, ctx?: MarketCtx) {
    if (!(hours > 0)) return;
    if (ctx && !this.remote) this.simulate(hours, ctx);
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

  /** споживання міста й підвіз флотилії (крок ≤ 1 год, щоб сон не «перескакував» рівновагу) */
  protected simulate(hours: number, ctx: MarketCtx) {
    let left = hours;
    let h = ctx.hour;
    while (left > 1e-6) {
      const dt = Math.min(1, left);
      const c: MarketCtx = { ...ctx, hour: h % 24 };
      const cm = consumeMult(c);
      const ff = fishingFactor(ctx.weather);
      for (const sp of FISH) {
        const id = sp.id;
        // боти «Шторму» ловлять біля берега й на середині — рибу відкритого моря везе лише фонова флотилія
        const bots = this.hasBots && sp.zones.some((z) => BOT_ZONES.includes(z)) ? BOT_SHARE : 0;
        const T = this.target(id);
        const base = T / MARKET_TAU; // рибин/год у нормі
        const bias = this.supplyBias(id);
        let S = this.stockOf(id);
        // фонова флотилія — одразу на ринок; частка ботів — у «пул», який вони привезуть партіями
        S += base * ff * bias * (1 - bots) * dt;
        if (bots) {
          const p = (this.pool[id] ?? 0) + base * ff * bias * bots * dt;
          // що не забрали боти (чужі зони, ніхто не вийшов) — однаково доходить, але повільно
          const leak = (p * dt) / POOL_LEAK_H;
          this.pool[id] = p - leak;
          S += leak;
        }
        // місто їсть: пропорційно запасу (надлишок тане, дефіцит — повільніше)
        S -= base * cm * (S / T) * dt;
        this.stock[id] = Math.max(T * 0.05, S);
      }
      left -= dt;
      h += dt;
    }
  }

  /**
   * бот пришвартувався й здає улов: забирає частку «пулу» видів своєї зони.
   * Повертає [вид, типові рибини] по спаданню — для новини.
   */
  botUnload(zones: ZoneId[], share: number): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    for (const sp of FISH) {
      if (!sp.zones.some((z) => zones.includes(z))) continue;
      const p = this.pool[sp.id] ?? 0;
      const take = p * clamp(share, 0, 1);
      if (take < 0.05) continue;
      this.pool[sp.id] = p - take;
      this.addStock(sp.id, take);
      out.push([sp.id, take]);
    }
    return out.sort((a, b) => b[1] * avgKg(b[0]) - a[1] * avgKg(a[0]));
  }

  pushNews(n: MarketNews) {
    this.news.push(n);
    if (this.news.length > NEWS_MAX) this.news.splice(0, this.news.length - NEWS_MAX);
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

  /** скільки ігрових годин, доки запас повернеться до норми (±5 %) без нового підвозу */
  recoverHours(speciesId: string): number {
    const T = this.target(speciesId);
    const dev = Math.abs(this.stockOf(speciesId) - T) / T;
    return dev < 0.05 ? 0 : MARKET_TAU * Math.log(dev / 0.05);
  }

  /** запас відносно норми: 1 — норма, 1.5 — надлишок, 0.6 — дефіцит */
  stockRatio(speciesId: string): number {
    return this.stockOf(speciesId) / this.target(speciesId);
  }

  /**
   * архів біржі: якщо історії мало (нова гра / старий сейв), домалювати
   * попередні дні детерміновано від номера дня — графіки одразу живі.
   * Ціна блукає навколо базової (тижневі хвилі + дрібний шум) і сходиться до поточної.
   */
  backfill(priceMult: Record<string, number>, day: number) {
    for (const sp of FISH) {
      const h = (this.hist[sp.id] ??= []);
      const need = MARKET_HISTORY - h.length;
      if (need <= 0) continue;
      const base = sp.basePrice / avgKg(sp.id);
      const end = h.length ? h[0] : this.perKg(sp.id, priceMult);
      const rng = mulberry32(day * 7477 + sp.id.length * 131 + sp.id.charCodeAt(0) * 17);
      const ph = rng() * Math.PI * 2;
      const pre: number[] = [];
      let walk = 0;
      for (let i = 0; i < need; i++) {
        // i = 0 — найстаріша точка
        walk = walk * 0.85 + (rng() - 0.5) * 0.06;
        const wave = 0.1 * Math.sin(ph + i * 0.26) + walk;
        pre.push(base * (1 + wave));
      }
      // плавно звести кінець архіву до першої справжньої точки
      const k = Math.min(8, need);
      for (let j = 0; j < k; j++) {
        const i = need - k + j;
        const t = (j + 1) / (k + 1);
        pre[i] = pre[i] * (1 - t) + end * t;
      }
      this.hist[sp.id] = [...pre.map((v) => Math.round(v * 10) / 10), ...h];
    }
  }

  /** запаси в масиві за порядком FISH (кооп-знімок) */
  packStock(): number[] {
    return FISH.map((sp) => Math.round(this.stockOf(sp.id) * 100) / 100);
  }

  unpackStock(a: unknown) {
    if (!Array.isArray(a)) return;
    FISH.forEach((sp, i) => {
      const v = a[i];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) this.stock[sp.id] = v;
    });
  }

  serialize(): MarketSave {
    const r = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));
    return { stock: r(this.stock), pool: r(this.pool), hist: this.hist, prev: this.prev, events: this.events, acc: this.acc, news: this.news };
  }

  load(d: Partial<MarketSave> | undefined) {
    this.stock = {};
    this.pool = {};
    this.hist = {};
    this.prev = {};
    this.events = [];
    this.news = [];
    this.acc = 0;
    if (!d || typeof d !== 'object') return;
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    this.loadStock(d.stock, d.glut);
    if (d.pool) for (const [k, v] of Object.entries(d.pool)) if (FISH_BY_ID[k] && num(v) && v >= 0) this.pool[k] = v;
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
    if (Array.isArray(d.news)) this.news = d.news.filter((n) => n && num(n.h) && typeof n.text === 'string' && typeof n.who === 'string').slice(-NEWS_MAX);
    if (num(d.acc)) this.acc = d.acc;
  }

  /** запаси з сейву; старі сейви — «надлишок над нормою» (glut) → норма + надлишок */
  loadStock(stock: Record<string, number> | undefined, glut?: Record<string, number>) {
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    if (stock && typeof stock === 'object') {
      for (const [k, v] of Object.entries(stock)) if (FISH_BY_ID[k] && num(v) && v >= 0) this.stock[k] = v;
    } else if (glut && typeof glut === 'object') {
      for (const [k, v] of Object.entries(glut)) if (FISH_BY_ID[k] && num(v) && v > 0) this.stock[k] = this.target(k) + v;
    }
  }
}

/**
 * Біржа іншого порту: свої запаси й споживання (розмір порту), свої місцеві
 * ціни видів і свій підвіз (фонова флотилія порту — більше «місцевої» риби);
 * події — спільні з домашньою біржею (новини ті самі). Історія — своя
 * (на старті — домашня в місцевому масштабі).
 */
export class PortMarket extends FishMarket {
  constructor(
    private home: FishMarket,
    private local: (speciesId: string) => number,
    scale: number,
    private bias: (speciesId: string) => number,
  ) {
    super();
    this.scale = scale;
    Object.defineProperty(this, 'events', { get: () => home.events });
    Object.defineProperty(this, 'prev', { get: () => home.prev });
  }

  override get hasBots(): boolean {
    return false;
  }

  override supplyBias(speciesId: string): number {
    return this.bias(speciesId);
  }

  override eventMult(speciesId: string): number {
    return this.home.eventMult(speciesId);
  }

  override eventFor(speciesId: string): MarketEvent | undefined {
    return this.home.eventFor(speciesId);
  }

  override factor(speciesId: string): number {
    return super.factor(speciesId) * this.local(speciesId);
  }

  override factorAt(speciesId: string, stock: number): number {
    return super.factorAt(speciesId, stock) * this.local(speciesId);
  }

  /** історія: якщо своєї немає — домашня в місцевому масштабі */
  seedHistory() {
    for (const [id, h] of Object.entries(this.home.hist)) {
      if (this.hist[id]?.length) continue;
      const k = this.local(id);
      this.hist[id] = h.map((v) => Math.round(v * k * 10) / 10);
    }
  }
}
