import { clamp, mulberry32 } from '../core/math';
import { FISH, FISH_BY_ID, fishPrice, ZONE_NAMES } from './fish';
import type { FishItem, ZoneId } from '../core/types';

// ─────────────────────────────────────────────────────────────
// Скупники риби: таверна, коптильня, ресторан, консервний завод і відлюдник
// на Сосновому острові. У кожного — свій смак (які види й розміри бере),
// своя ціна, свій попит (насичується окремо від біржі), години роботи,
// щоденні акції та замовлення на поставки з репутацією.
//
// Ігровий час — абсолютні години (день × 24 + година), їх підставляє Game.
// Акції й пропозиції замовлень детерміновані від дня — однакові в усіх,
// не треба зберігати; зберігаються репутація, попит, прийняті замовлення.
// ─────────────────────────────────────────────────────────────

export type BuyerId = 'tavern' | 'smoke' | 'chef' | 'cannery' | 'hermit';

export interface BuyerDef {
  id: BuyerId;
  name: string;
  /** хто за прилавком */
  who: string;
  icon: string;
  /** що бере — коротко, для вивіски й вікна */
  wants: string;
  blurb: string;
  /** години роботи [від, до) або null — цілодобово */
  open: [number, number] | null;
  /** види, які бере (null — будь-які) */
  species: string[] | null;
  /** причина відмови або null (беремо) */
  reject: (f: FishItem) => string | null;
  /** множник до базової ціни риби (без свіжості, попиту, акцій) */
  mult: (f: FishItem) => number;
  /** вага свіжості в ціні (біржа — 0.65) */
  freshW: number;
  /** скільки «рибин» виду бере без знижки (Infinity — не насичується) */
  free: number;
  drop: number;
  /** розсмоктування надлишку, рибин/ігрову годину */
  recover: number;
  /** партія від N риб — оптова надбавка */
  bulk?: [number, number];
  /** кольори вивіски */
  color: string;
  accent: string;
}

const avg = (id: string) => {
  const sp = FISH_BY_ID[id];
  return sp ? (sp.minKg + sp.maxKg) / 2 : 1;
};
/** трофей: верхні 20 % розмірів виду */
export function isTrophy(f: FishItem): boolean {
  const sp = FISH_BY_ID[f.speciesId];
  return !!sp && f.kg >= sp.minKg + 0.8 * (sp.maxKg - sp.minKg);
}
const nm = (id: string) => FISH_BY_ID[id]?.name ?? id;

const TAVERN = ['hamsa', 'balyk', 'leschak', 'plyotka', 'makrel', 'sula', 'krap'];
const SMOKE = ['hamsa', 'balyk', 'makrel', 'sula', 'forel', 'tunets'];
const CHEF = ['krap', 'forel', 'lusk', 'shoraga', 'tunets', 'akula'];
const HERMIT = ['lusk', 'shoraga', 'tunets', 'akula'];

export const BUYERS: BuyerDef[] = [
  {
    id: 'tavern',
    name: 'Таверна «Ситий баклан»',
    who: 'кухарка Ганна',
    icon: '🍲',
    wants: 'дрібна й середня риба · і сира, і варена',
    blurb: 'Юшка, смажена камбала й оселедець під цибулею. Ганна платить більше за біржу і менше зважає на свіжість — їй однаково в казан. Варену рибу теж бере.',
    open: [7, 24],
    species: TAVERN,
    reject: (f) => (TAVERN.includes(f.speciesId) ? null : 'для кухні завелика — неси в ресторан або на біржу'),
    mult: () => 1.09,
    freshW: 0.5,
    free: 3,
    drop: 0.07,
    recover: 0.8,
    color: '#a8452a',
    accent: '#f3d9a4',
  },
  {
    id: 'smoke',
    name: 'Коптильня Гната',
    who: 'дід Гнат',
    icon: '🔥',
    wants: 'жирна риба на вагу · оптом дорожче',
    blurb: 'Оселедець, скумбрія, лосось — у вільховий дим. Свіжість не головне, а партія від 6 рибин — плюс 10 %.',
    open: [5, 21],
    species: SMOKE,
    reject: (f) => (f.cooked ? 'варену не коптимо' : SMOKE.includes(f.speciesId) ? null : 'пісна — для диму не годиться'),
    mult: () => 1.05,
    freshW: 0.25,
    free: 5,
    drop: 0.05,
    recover: 0.6,
    bulk: [6, 1.1],
    color: '#4b3a2c',
    accent: '#f0b45a',
  },
  {
    id: 'chef',
    name: 'Ресторан «Маяк»',
    who: 'шеф Ліндстрем',
    icon: '🍽',
    wants: 'лише велика делікатесна риба · трофеї — ще дорожче',
    blurb: 'Шефу потрібне найкраще: окунь, лосось, тріска, палтус, тунець, акула — не менші за середній розмір. Трофейний екземпляр — ще ×1,6.',
    open: [11, 24],
    species: CHEF,
    reject: (f) => {
      if (!CHEF.includes(f.speciesId)) return 'не в меню';
      if (f.cooked) return 'шеф готує сам';
      if (f.kg < avg(f.speciesId)) return 'замала для подачі';
      return null;
    },
    mult: (f) => 1.75 * (isTrophy(f) ? 1.6 : 1),
    freshW: 0.4,
    free: 1,
    drop: 0.15,
    recover: 0.3,
    color: '#1f3b57',
    accent: '#e6c46a',
  },
  {
    id: 'cannery',
    name: 'Консервний завод «Балтика»',
    who: 'приймальник Степан',
    icon: '🥫',
    wants: 'будь-яка риба тоннами · дешевше, зате без насичення',
    blurb: 'Бере все: дрібну, несвіжу, варену. Ціна нижча за біржу, але ринок не засипається — скільки привіз, стільки й продав.',
    open: null,
    species: null,
    reject: () => null,
    mult: (f) => (f.cooked ? 0.75 : 0.63),
    freshW: 0.15,
    free: Infinity,
    drop: 0,
    recover: 0,
    bulk: [12, 1.08],
    color: '#56626b',
    accent: '#dfe6ea',
  },
  {
    id: 'hermit',
    name: 'Хижа Старого Остапа',
    who: 'відлюдник Остап',
    icon: '🛖',
    wants: 'глибоководна риба · рибу дня — майже вдвічі',
    blurb: 'Колишній доглядач маяка живе на Сосновому острові. Платить щедро за тріску, палтуса, тунця й акулу — і щодня мріє про якусь особливу рибу.',
    open: null,
    species: null, // + риба дня
    reject: () => null, // перевіряється з урахуванням риби дня (buyerReject)
    mult: (f) => (HERMIT.includes(f.speciesId) ? 1.77 : 0.9),
    freshW: 0.3,
    free: 2,
    drop: 0.1,
    recover: 0.4,
    color: '#3f5a3a',
    accent: '#e9dcae',
  },
];

export const BUYER_BY_ID = Object.fromEntries(BUYERS.map((b) => [b.id, b])) as Record<BuyerId, BuyerDef>;

// ── репутація ──

export const REP_LEVELS = [
  { at: 0, name: 'Новачок', bonus: 0, offers: 2, reward: 1 },
  { at: 15, name: 'Знайомий', bonus: 0.03, offers: 2, reward: 1.1 },
  { at: 40, name: 'Постачальник', bonus: 0.07, offers: 3, reward: 1.25 },
  { at: 75, name: 'Свій', bonus: 0.12, offers: 3, reward: 1.4 },
];

export function repLevel(rep: number) {
  let l = REP_LEVELS[0];
  for (const x of REP_LEVELS) if (rep >= x.at) l = x;
  return l;
}

export function nextRep(rep: number) {
  return REP_LEVELS.find((x) => x.at > rep) ?? null;
}

// ── акції ──

export interface Promo {
  id: string;
  buyer: BuyerId;
  kind: 'species' | 'cooked' | 'bulk' | 'trophy' | 'happy';
  sp?: string;
  mult: number;
  /** абсолютні години */
  from: number;
  until: number;
  text: string;
}

/** відмінки: знахідний */
const ACC: Record<string, string> = {
  hamsa: 'шпрот', balyk: 'оселедця', leschak: 'камбалу', plyotka: 'пікшу', makrel: 'скумбрію', sula: 'сайду',
  krap: 'морського окуня', forel: 'лосося', lusk: 'тріску', shoraga: 'палтуса', tunets: 'тунця', akula: 'акулу',
};
const acc = (id: string) => ACC[id] ?? nm(id).toLowerCase();

const hh = (h: number) => `${String(Math.floor(((h % 24) + 24) % 24)).padStart(2, '0')}:00`;

/** риба дня в Остапа (детерміновано від дня) */
export function hermitWish(day: number): string {
  const r = mulberry32(day * 6151 + 7);
  const pool = FISH.filter((f) => !HERMIT.includes(f.id) && f.basePrice >= 16);
  return pool[Math.floor(r() * pool.length)].id;
}

function rollPromos(day: number): Promo[] {
  const out: Promo[] = [];
  const d0 = day * 24;
  for (const b of BUYERS) {
    const r = mulberry32(day * 92821 + b.id.length * 613 + b.id.charCodeAt(0) * 37);
    const n = r() < 0.25 ? 0 : r() < 0.7 ? 1 : 2;
    const used = new Set<string>();
    for (let i = 0; i < n; i++) {
      const kinds: Promo['kind'][] =
        b.id === 'tavern' ? ['species', 'cooked', 'happy'] :
        b.id === 'smoke' ? ['species', 'bulk'] :
        b.id === 'chef' ? ['species', 'trophy', 'happy'] :
        b.id === 'cannery' ? ['bulk', 'happy', 'species'] :
        ['trophy', 'species'];
      const kind = kinds[Math.floor(r() * kinds.length)];
      if (used.has(kind)) continue;
      used.add(kind);
      const pool = b.id === 'hermit' ? HERMIT : b.species ?? FISH.map((f) => f.id);
      const sp = pool[Math.floor(r() * pool.length)];
      const id = `${day}:${b.id}:${i}`;
      if (kind === 'species') {
        const pct = 30 + Math.round(r() * 6) * 5; // 30..60
        const evening = r() < 0.5;
        out.push({ id, buyer: b.id, kind, sp, mult: 1 + pct / 100, from: d0, until: d0 + (evening ? 18 : 24), text: `×${(1 + pct / 100).toFixed(1).replace('.', ',')} за ${acc(sp)} ${evening ? 'до вечора' : 'до кінця дня'}` });
      } else if (kind === 'cooked') {
        out.push({ id, buyer: b.id, kind, mult: 1.25, from: d0, until: d0 + 24, text: '+25 % за варену рибу (камбуз на яхті)' });
      } else if (kind === 'bulk') {
        out.push({ id, buyer: b.id, kind, mult: 1.15, from: d0, until: d0 + 24, text: '+15 % за партію від 8 рибин' });
      } else if (kind === 'trophy') {
        const tsp = (b.id === 'chef' ? CHEF : HERMIT)[Math.floor(r() * (b.id === 'chef' ? CHEF.length : HERMIT.length))];
        out.push({ id, buyer: b.id, kind, sp: tsp, mult: 2, from: d0, until: d0 + 24, text: `трофейний екземпляр (${nm(tsp).toLowerCase()}) — за подвійну ціну` });
      } else {
        const start = 9 + Math.floor(r() * 9);
        out.push({ id, buyer: b.id, kind, mult: 1.25, from: d0 + start, until: d0 + start + 3, text: `щаслива година ${hh(start)}–${hh(start + 3)}: +25 % на все` });
      }
    }
  }
  return out;
}

// ── замовлення ──

export interface Contract {
  id: string;
  buyer: BuyerId;
  /** вид (або будь-який із зони) */
  sp?: string;
  zone?: ZoneId;
  /** скільки рибин (або кг, якщо kg) */
  n?: number;
  kg?: number;
  minKg?: number;
  minFresh?: number;
  /** доставлено: рибин або кг */
  got: number;
  deadline: number;
  reward: number;
  rep: number;
  title: string;
}

/** що замовлення просить (людською мовою) */
export function contractTitle(c: Omit<Contract, 'title' | 'got' | 'id'>): string {
  let t: string;
  if (c.kg) t = c.sp ? `${fmtKg(c.kg)} кг · ${nm(c.sp)}` : `${fmtKg(c.kg)} кг риби · ${c.zone ? ZONE_NAMES[c.zone].toLowerCase() : 'будь-якої'}`;
  else t = `${c.n ?? 1} × ${nm(c.sp ?? '')}`;
  if (c.minKg) t += c.kg ? ` (кожна від ${fmtKg(c.minKg)} кг)` : ` від ${fmtKg(c.minKg)} кг`;
  if (c.minFresh) t += `, свіжість ≥ ${c.minFresh} %`;
  return t;
}

/** вага замовлення: дрібне — з точністю 0,1 кг, велике — 0,5 кг */
function roundKg(v: number): number {
  return v < 3 ? Math.max(0.2, Math.round(v * 10) / 10) : Math.round(v * 2) / 2;
}

function fmtKg(v: number): string {
  return (Math.round(v * 10) / 10).toString().replace('.', ',');
}

/** типова ціна рибини виду на біржі (без трендів) */
/** типова ціна сирої рибини на біржі, коли привезена в порт (свіжість уже зійшла) */
// типова виручка за рибину: свіжість у середньому ~70 % → множник біржі ≈0.8
const typical = (id: string) => (FISH_BY_ID[id]?.basePrice ?? 10) * 0.6;

function rollOffers(day: number, b: BuyerDef, rep: number, discovered: string[]): Contract[] {
  const lvl = repLevel(rep);
  const r = mulberry32(day * 31337 + b.id.charCodeAt(0) * 911 + b.id.length * 7 + Math.floor(rep / 15) * 3);
  const out: Contract[] = [];
  const known = (ids: string[]) => {
    const k = ids.filter((id) => discovered.includes(id));
    return k.length ? k : ids.slice(0, 3);
  };
  const d0 = day * 24;
  for (let i = 0; i < lvl.offers; i++) {
    // дедлайн — у робочі години всіх скупників (12:00, 18:00, 20:00), від завтра до післязавтра
    const deadline = d0 + 24 * (1 + Math.floor(r() * 2)) + [12, 18, 20][Math.floor(r() * 3)];
    let c: Omit<Contract, 'title' | 'got' | 'id'>;
    const big = 1 + Math.floor(rep / 25) * 0.25; // з репутацією — більші партії
    if (b.id === 'tavern') {
      const pool = known(TAVERN.slice(0, 5));
      const sp = pool[Math.floor(r() * pool.length)];
      // замовлення — на вагу (риба в грі важиться): ~4–7 середніх рибин
      const kg = roundKg(avg(sp) * (4 + Math.floor(r() * 4)) * big);
      c = { buyer: b.id, sp, kg, deadline, reward: Math.round(((kg / avg(sp)) * typical(sp) * 3 + 30) * lvl.reward), rep: 6 };
    } else if (b.id === 'smoke') {
      const pool = known(SMOKE);
      const sp = pool[Math.floor(r() * pool.length)];
      const kg = roundKg(avg(sp) * (6 + Math.floor(r() * 6)) * big);
      c = { buyer: b.id, sp, kg, deadline, reward: Math.round(((kg / avg(sp)) * typical(sp) * 3 + 40) * lvl.reward), rep: 6 };
    } else if (b.id === 'chef') {
      const pool = known(CHEF);
      const sp = pool[Math.floor(r() * pool.length)];
      const n = r() < 0.6 ? 1 : 2;
      const minKg = Math.round(avg(sp) * (1.1 + r() * 0.25) * 10) / 10;
      // загальна вага, кожна рибина — не менша за minKg
      const kg = n === 1 ? minKg : roundKg(minKg * n);
      c = { buyer: b.id, sp, kg, minKg, deadline, reward: Math.round(((kg / avg(sp)) * typical(sp) * 4.5 + 60) * lvl.reward), rep: 9 };
    } else if (b.id === 'cannery') {
      const zone: ZoneId = rep >= 40 && r() < 0.5 ? 'mid' : r() < 0.6 ? 'shore' : 'mid';
      const kg = Math.round((zone === 'shore' ? 1.5 + r() * 2 : 3 + r() * 4) * big * 2) / 2;
      const perKg = zone === 'shore' ? 23 : 16;
      c = { buyer: b.id, zone, kg, deadline, reward: Math.round((kg * perKg * 2.2 + 40) * lvl.reward), rep: 5 };
    } else {
      const sp = HERMIT[Math.floor(r() * (rep >= 40 ? 4 : 3))];
      const n = r() < 0.65 ? 1 : 2;
      const minKg = r() < 0.5 ? Math.round(avg(sp) * 10) / 10 : undefined;
      const kg = roundKg(avg(sp) * n * 1.1);
      c = { buyer: b.id, sp, kg, minKg, deadline: deadline + 24, reward: Math.round(((kg / avg(sp)) * typical(sp) * 4.5 + 100) * lvl.reward), rep: 10 };
    }
    out.push({ ...c, id: `${day}:${b.id}:o${i}`, got: 0, title: contractTitle(c) });
  }
  return out;
}

export function contractNeed(c: Contract): number {
  return c.kg ?? c.n ?? 1;
}

/** чи підходить риба під замовлення */
export function fitsContract(c: Contract, f: FishItem): boolean {
  const sp = FISH_BY_ID[f.speciesId];
  if (!sp) return false;
  if (c.sp && f.speciesId !== c.sp) return false;
  if (c.zone && !sp.zones.includes(c.zone)) return false;
  if (c.minKg && f.kg < c.minKg - 1e-6) return false;
  if (c.minFresh && (f.cooked || f.freshness < c.minFresh)) return false;
  if (f.cooked && c.buyer !== 'cannery') return false;
  return true;
}

// ── збереження ──

export interface TradeSave {
  rep: Partial<Record<BuyerId, number>>;
  glut: Partial<Record<BuyerId, Record<string, number>>>;
  active: Contract[];
  /** прийняті/відхилені пропозиції (щоб не з'являлись знову того ж дня) */
  taken: string[];
  done: number;
  failed: number;
}

export const MAX_CONTRACTS = 3;

export class FishTrade {
  rep: Record<BuyerId, number> = { tavern: 0, smoke: 0, chef: 0, cannery: 0, hermit: 0 };
  glut: Record<BuyerId, Record<string, number>> = { tavern: {}, smoke: {}, chef: {}, cannery: {}, hermit: {} };
  active: Contract[] = [];
  taken: string[] = [];
  done = 0;
  failed = 0;
  private promoCache: { day: number; list: Promo[] } | null = null;

  static day(nowH: number) {
    return Math.floor(nowH / 24);
  }

  isOpen(b: BuyerDef, nowH: number): boolean {
    if (!b.open) return true;
    const h = ((nowH % 24) + 24) % 24;
    return h >= b.open[0] && h < b.open[1];
  }

  promos(nowH: number, buyer?: BuyerId): Promo[] {
    const day = FishTrade.day(nowH);
    if (this.promoCache?.day !== day) this.promoCache = { day, list: rollPromos(day) };
    return this.promoCache.list.filter((p) => nowH >= p.from && nowH < p.until && (!buyer || p.buyer === buyer));
  }

  /** акції, що почнуться пізніше сьогодні (анонс на дошці) */
  upcoming(nowH: number, buyer: BuyerId): Promo[] {
    this.promos(nowH);
    return this.promoCache!.list.filter((p) => p.buyer === buyer && p.from > nowH);
  }

  reject(b: BuyerDef, f: FishItem, nowH: number): string | null {
    if (b.id === 'hermit') {
      if (f.cooked) return 'варену не бере';
      if (HERMIT.includes(f.speciesId) || f.speciesId === hermitWish(FishTrade.day(nowH))) return null;
      return 'Остапу таке не треба';
    }
    return b.reject(f);
  }

  demand(b: BuyerDef, sp: string, glut = this.glut[b.id][sp] ?? 0): number {
    if (!Number.isFinite(b.free)) return 1;
    return clamp(1 - b.drop * Math.max(0, glut - b.free), 0.35, 1);
  }

  /** множник акцій для цієї риби (без оптових — їх рахує quote) */
  promoMult(b: BuyerDef, f: FishItem, nowH: number): number {
    let m = 1;
    for (const p of this.promos(nowH, b.id)) {
      if (p.kind === 'species' && p.sp === f.speciesId) m *= p.mult;
      else if (p.kind === 'cooked' && f.cooked) m *= p.mult;
      else if (p.kind === 'trophy' && p.sp === f.speciesId && isTrophy(f)) m *= p.mult;
      else if (p.kind === 'happy') m *= p.mult;
    }
    if (b.id === 'hermit' && f.speciesId === hermitWish(FishTrade.day(nowH))) m *= 1.9;
    return m;
  }

  /** ціна однієї рибини (glut — поточний надлишок виду в цього скупника) */
  price(b: BuyerDef, f: FishItem, priceMult: Record<string, number>, nowH: number, glut?: number): number {
    const fresh = f.cooked ? 1 : f.freshness / 100;
    const v = fishPrice(f, priceMult) * b.mult(f) * this.demand(b, f.speciesId, glut) * this.promoMult(b, f, nowH) * (1 + repLevel(this.rep[b.id]).bonus) * (1 - b.freshW + b.freshW * fresh);
    return Math.max(1, Math.round(v));
  }

  /** прорахунок продажу партії: ціни по черзі (попит падає), оптові надбавки */
  quote(b: BuyerDef, items: FishItem[], priceMult: Record<string, number>, nowH: number): { total: number; prices: Map<number, number>; bulk: number } {
    const glut: Record<string, number> = { ...this.glut[b.id] };
    const ok = items.filter((f) => !this.reject(b, f, nowH));
    const sorted = ok.sort((a, c) => this.price(b, c, priceMult, nowH) - this.price(b, a, priceMult, nowH));
    let bulk = 1;
    if (b.bulk && sorted.length >= b.bulk[0]) bulk *= b.bulk[1];
    for (const p of this.promos(nowH, b.id)) if (p.kind === 'bulk' && sorted.length >= 8) bulk *= p.mult;
    const prices = new Map<number, number>();
    let total = 0;
    for (const f of sorted) {
      const g = glut[f.speciesId] ?? 0;
      const v = Math.max(1, Math.round(this.price(b, f, priceMult, nowH, g) * bulk));
      glut[f.speciesId] = g + clamp(Math.sqrt(f.kg / avg(f.speciesId)), 0.6, 1.6);
      prices.set(f.uid, v);
      total += v;
    }
    return { total, prices, bulk };
  }

  recordSale(b: BuyerDef, f: FishItem) {
    if (!Number.isFinite(b.free)) return;
    const g = this.glut[b.id];
    g[f.speciesId] = (g[f.speciesId] ?? 0) + clamp(Math.sqrt(f.kg / avg(f.speciesId)), 0.6, 1.6);
  }

  addRep(id: BuyerId, v: number) {
    this.rep[id] = clamp(Math.round((this.rep[id] + v) * 10) / 10, 0, 100);
  }

  /** пропозиції замовлень у скупника на сьогодні (без уже взятих) */
  offers(b: BuyerDef, nowH: number, discovered: string[]): Contract[] {
    const day = FishTrade.day(nowH);
    return rollOffers(day, b, this.rep[b.id], discovered).filter((c) => !this.taken.includes(c.id) && c.deadline > nowH + 2);
  }

  accept(c: Contract): boolean {
    if (this.active.length >= MAX_CONTRACTS || this.taken.includes(c.id)) return false;
    this.taken.push(c.id);
    if (this.taken.length > 60) this.taken.splice(0, this.taken.length - 60);
    this.active.push({ ...c });
    return true;
  }

  /** хід часу: попит відновлюється, прострочені замовлення згорають */
  tick(hours: number, nowH: number): Contract[] {
    if (hours > 0) {
      for (const b of BUYERS) {
        const g = this.glut[b.id];
        for (const k of Object.keys(g)) {
          const v = g[k] - b.recover * hours;
          if (v <= 0) delete g[k];
          else g[k] = v;
        }
      }
    }
    const failed = this.active.filter((c) => c.deadline <= nowH);
    if (failed.length) {
      this.active = this.active.filter((c) => c.deadline > nowH);
      for (const c of failed) {
        this.addRep(c.buyer, -4);
        this.failed++;
      }
    }
    return failed;
  }

  /** найближчий дедлайн серед активних */
  nextDeadline(): Contract | null {
    return this.active.reduce<Contract | null>((a, c) => (!a || c.deadline < a.deadline ? c : a), null);
  }

  /** тексти акцій для біжучого рядка біржі / радіо */
  tickerTexts(nowH: number): string[] {
    return this.promos(nowH).map((p) => `${BUYER_BY_ID[p.buyer].icon} ${shortName(p.buyer)}: ${p.text}`);
  }

  serialize(): TradeSave {
    return { rep: { ...this.rep }, glut: JSON.parse(JSON.stringify(this.glut)), active: this.active.map((c) => ({ ...c })), taken: [...this.taken], done: this.done, failed: this.failed };
  }

  load(d: Partial<TradeSave> | undefined) {
    this.rep = { tavern: 0, smoke: 0, chef: 0, cannery: 0, hermit: 0 };
    this.glut = { tavern: {}, smoke: {}, chef: {}, cannery: {}, hermit: {} };
    this.active = [];
    this.taken = [];
    this.done = 0;
    this.failed = 0;
    if (!d || typeof d !== 'object') return;
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    for (const b of BUYERS) {
      const r = d.rep?.[b.id];
      if (num(r)) this.rep[b.id] = clamp(r, 0, 100);
      const g = d.glut?.[b.id];
      if (g && typeof g === 'object') for (const [k, v] of Object.entries(g)) if (FISH_BY_ID[k] && num(v) && v > 0) this.glut[b.id][k] = v;
    }
    if (Array.isArray(d.active)) {
      this.active = d.active
        .filter((c) => c && BUYER_BY_ID[c.buyer as BuyerId] && num(c.deadline) && num(c.reward) && num(c.got) && typeof c.id === 'string' && (!c.sp || FISH_BY_ID[c.sp]))
        .slice(0, MAX_CONTRACTS)
        .map((c) => ({ ...c, title: typeof c.title === 'string' ? c.title : contractTitle(c) }));
    }
    if (Array.isArray(d.taken)) this.taken = d.taken.filter((v) => typeof v === 'string').slice(-60);
    if (num(d.done)) this.done = d.done;
    if (num(d.failed)) this.failed = d.failed;
  }
}

export function shortName(id: BuyerId): string {
  return { tavern: 'Таверна', smoke: 'Коптильня', chef: 'Ресторан «Маяк»', cannery: 'Консервний завод', hermit: 'Остап' }[id];
}

/** «до 18:00 завтра» */
export function fmtDeadline(deadline: number, nowH: number): string {
  const dDay = FishTrade.day(deadline) - FishTrade.day(nowH);
  const left = deadline - nowH;
  const when = dDay <= 0 ? 'сьогодні' : dDay === 1 ? 'завтра' : 'післязавтра';
  return `до ${hh(deadline)} ${when} · ${left < 1 ? 'менше години' : `${Math.floor(left)} год`}`;
}
