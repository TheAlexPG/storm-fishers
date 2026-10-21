import { fbm, smoothstep } from './portKit';
import { L } from '../core/i18n';
import { WS, addHaven } from '../core/region';
import { CONT_PORTS, continentHeight } from './continents';

// ─────────────────────────────────────────────────────────────
// Порти світу (чиста математика й дані — без three.js). Домашній «Шторм»
// будує port.ts; тут — ще чотири гавані на різних відстанях: суходіл під
// ними (рельєф іде в islandHeight → ходьба, мілина, карта, боти), причали,
// місця швартування й послуги з власними цінами.
//
// Локальна система порту: a — від берега в море вздовж причалу (o),
// b — поперек (l). Усі прямокутники — по осях світу (o лише ±X/±Z).
// ─────────────────────────────────────────────────────────────

/** вид послуги; main відкриває відповідне вікно. Невідомі види — у PORT_SERVICE_HANDLERS */
export type ServiceKind = 'fuel' | 'yard' | 'exchange' | 'shop' | 'office' | 'sleep' | (string & {});

export interface PortService {
  kind: ServiceKind;
  /** світові координати точки біля дверей (E у радіусі ~3 м) */
  x: number;
  z: number;
  label: string;
  name: string;
  icon: string;
}

export interface Berth {
  x: number;
  z: number;
  /** курс при шварті (нос; пружина приймає й протилежний) */
  h: number;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
}

export interface PortEcon {
  /** ₴ за літр */
  fuel: number;
  /** множник ціни ремонту на верфі (null — верфі немає) */
  repair: number | null;
  /** множник ціни риби на місцевій біржі (за замовчуванням) */
  fish: number;
  /** окремі види: місцевий попит */
  species: Record<string, number>;
}

export interface PortSite {
  id: string;
  name: string;
  sub: string;
  size: 'tiny' | 'medium' | 'large' | 'outpost';
  /** корінь причалу (край набережної) */
  x: number;
  z: number;
  /** напрям причалу в море: одиничний вектор по осі */
  ox: number;
  oz: number;
  /** суходіл: радіус, витягнутість уздовж набережної, вершина, сид */
  R: number;
  elong: number;
  peak: number;
  seed: number;
  /** містечко-плато за набережною: ширина (уздовж b), глибина (вглиб, −a), висота */
  plW: number;
  plD: number;
  plY: number;
  /** причал: довжина в море й ширина */
  pierL: number;
  pierW: number;
  econ: PortEcon;
  /** кольори будинків/дахів — характер місця (med — Середземномор'я, north — холодна Північ) */
  style: 'village' | 'town' | 'resort' | 'whaling' | 'med' | 'north';
  /** гавань на континенті (continents.ts): суходіл — континент, порт лише «прорізає» його */
  cont?: string;
  /** послуги в локальних (a, b): a < 0 — на набережній */
  svc: Array<{ kind: ServiceKind; a: number; b: number; name: string; icon: string; label: string }>;
}

// напрямки: o — у море; l — «праворуч», якщо дивитись у море
const N = { ox: 0, oz: -1 };
const E = { ox: 1, oz: 0 };
const W = { ox: -1, oz: 0 };

const RAW_SITES: PortSite[] = [
  {
    id: 'port-kut', name: L('Рибальський Кут', `Fisher's Nook`), sub: L('село на палях · пальне, рибна лавка й наживка', `a village on stilts · fuel, a fish stall and bait`), size: 'tiny', style: 'village',
    x: -470, z: 70, ...E, R: 34, elong: 1.4, peak: 9, seed: 61,
    plW: 30, plD: 14, plY: 1.5, pierL: 20, pierW: 3.2,
    econ: { fuel: 7, repair: null, fish: 0.95, species: { hamsa: 1.35, balyk: 1.35, leschak: 1.2, plyotka: 1.15, tunets: 0.8, akula: 0.7 } },
    svc: [
      { kind: 'fuel', a: -3, b: 9, name: L('Бочка з пальним', `Fuel barrel`), icon: '⛽', label: L('Пальне в бочках (дорожче, ніж у «Шторму»)', `Fuel from barrels (pricier than at Storm Harbour)`) },
      { kind: 'exchange', a: -4, b: -8, name: L('Рибна лавка', `Fish stall`), icon: '🐟', label: L('Рибна лавка Кута — продати улов', `Fisher's Nook fish stall — sell your catch`) },
      // наживка (kutVillage / ui/baitShop.ts): баф клювання на кілька хвилин
      { kind: 'bait', a: -6, b: 20, name: L('Наживка Орисі', `Orysia's Bait`), icon: '🪱', label: L('Наживка Орисі — черв\'яки, мотиль і живець (клює швидше)', `Orysia's Bait — worms, bloodworms and live bait (faster bites)`) },
    ],
  },
  {
    id: 'port-zorya', name: L('Гавань Зорі', `Dawn Harbour`), sub: L('містечко на скелястому мисі', `a little town on a rocky cape`), size: 'medium', style: 'town',
    x: 615, z: -10, ...W, R: 62, elong: 1.3, peak: 26, seed: 71,
    plW: 54, plD: 30, plY: 1.6, pierL: 32, pierW: 4,
    econ: { fuel: 6.5, repair: 1, fish: 1.0, species: { makrel: 1.3, sula: 1.3, krap: 1.3, hamsa: 0.85, balyk: 0.85 } },
    svc: [
      { kind: 'fuel', a: -3, b: 20, name: L('Заправка', `Fuel dock`), icon: '⛽', label: L('Заправка Гавані Зорі — пальне', `Dawn Harbour fuel dock — fuel`) },
      { kind: 'yard', a: -5, b: -19, name: L('Верф', `Shipyard`), icon: '🔧', label: L('Верф Гавані Зорі — ремонт корпусу', `Dawn Harbour shipyard — hull repairs`) },
      { kind: 'exchange', a: -5, b: -4, name: L('Біржа', `Exchange`), icon: '🐟', label: L('Біржа Гавані Зорі — продати улов', `Dawn Harbour exchange — sell your catch`) },
      { kind: 'sleep', a: -17, b: 10, name: L('Заїжджий двір', `Coaching inn`), icon: '🛏', label: L('Заїжджий двір (сон)', `Coaching inn (sleep)`) },
      // картограф (ui/chartmaker.ts, обробник — main): точні лоції невідкритих місць
      { kind: 'chartmaker', a: -5, b: -11.5, name: L('Картограф', `Chartmaker`), icon: '🗺', label: L('Картограф — точні лоції рибних місць і островів', `Chartmaker — true charts of fishing grounds and islands`) },
    ],
  },
  {
    id: 'port-marina', name: L('Сонячна Марина', `Sunny Marina`), sub: L('курорт · ресторани платять за делікатеси', `a resort · restaurants pay for delicacies`), size: 'large', style: 'resort',
    x: -70, z: 560, ...N, R: 58, elong: 1.5, peak: 14, seed: 83,
    plW: 64, plD: 32, plY: 1.6, pierL: 34, pierW: 4.5,
    econ: { fuel: 8, repair: 1.25, fish: 1.05, species: { forel: 1.4, krap: 1.35, tunets: 1.35, lusk: 1.2, hamsa: 0.75, balyk: 0.75 } },
    svc: [
      { kind: 'fuel', a: -3, b: -26, name: L('Заправка', `Fuel dock`), icon: '⛽', label: L('Заправка марини — пальне', `Marina fuel dock — fuel`) },
      { kind: 'exchange', a: -5, b: -9, name: L('Ресторанна біржа', `Restaurant exchange`), icon: '🐟', label: L('Ресторанна біржа — продати улов (делікатеси дорожче)', `Restaurant exchange — sell your catch (delicacies pay more)`) },
      { kind: 'shop', a: -5, b: 9, name: L('Яхтова крамниця', `Yacht chandlery`), icon: '🛠', label: L('Яхтова крамниця — каталог речей', `Yacht chandlery — item catalogue`) },
      { kind: 'yard', a: -5, b: 25, name: L('Сервіс яхт', `Yacht service`), icon: '🔧', label: L('Сервіс яхт — ремонт корпусу (курортні ціни)', `Yacht service — hull repairs (resort prices)`) },
      { kind: 'office', a: -19, b: -17, name: L('Контора марини', `Marina office`), icon: '🛡', label: L('Контора марини — страховка', `Marina office — insurance`) },
      { kind: 'cookshop', a: -19, b: 0, name: L('Кулінарна лавка', `Cook's shop`), icon: '🍳', label: L('Кулінарна лавка — рис, лимони, трави й рецепт паельї', `Cook's shop — rice, lemons, herbs and the paella recipe`) },
      { kind: 'sleep', a: -19, b: 17, name: L('Готель «Хвиля»', `Hotel “Wave”`), icon: '🛏', label: L('Готель «Хвиля» (сон)', `Hotel “Wave” (sleep)`) },
    ],
  },
  {
    id: 'port-kray', name: L('Китобійня «Край світу»', `“World's End” Whaling Station`), sub: L('остання гавань перед відкритим океаном', `the last harbour before the open ocean`), size: 'outpost', style: 'whaling',
    x: 860, z: 690, ...N, R: 46, elong: 1.3, peak: 22, seed: 97,
    plW: 36, plD: 18, plY: 1.8, pierL: 30, pierW: 4,
    econ: { fuel: 11, repair: 1.6, fish: 1.0, species: { tunets: 1.6, akula: 1.7, shoraga: 1.55, lusk: 1.4, hamsa: 0.5, balyk: 0.5, leschak: 0.6, plyotka: 0.6 } },
    svc: [
      { kind: 'fuel', a: -3, b: 12, name: L('Цистерна', `Fuel tank`), icon: '⛽', label: L('Цистерна — пальне (дороге: край світу)', `Fuel tank — fuel (expensive: it's the world's end)`) },
      { kind: 'exchange', a: -5, b: -8, name: L('Скупка', `Buyer`), icon: '🐟', label: L('Скупка китобійні — трофеї відкритого моря дорого', `Whaling station buyer — open-sea trophies fetch a lot`) },
      { kind: 'yard', a: -12, b: 4, name: L('Слип', `Slipway`), icon: '🔧', label: L('Слип китобійні — ремонт (дорого)', `Whaling station slipway — repairs (expensive)`) },
    ],
  },
];

/** склад вантажів — у кожній гавані (game/cargo.ts): місце на набережній збоку від причалу */
const CARGO_SVC = (a: number, b: number): PortSite['svc'][number] => ({ kind: 'cargo', a, b, name: L('Склад', `Cargo office`), icon: '📦', label: L('Склад — замовлення на доставку вантажів', `Cargo office — delivery orders`) });
const CARGO_AT: Record<string, [number, number]> = { 'port-kut': [-9, 1], 'port-zorya': [-17, -10], 'port-marina': [-19, -29], 'port-kray': [-12, -12] };

/** гавані континентів (continents.ts): корінь причалу — на березі, що знайшла математика берега */
const CP = Object.fromEntries(CONT_PORTS.map((c) => [c.id, c]));
const cpos = (id: string) => {
  const c = CP[id];
  return { x: c.x, z: c.z, ox: c.ox, oz: c.oz, plW: c.plW, plD: c.plD, plY: c.plY, pierL: c.pierL, pierW: c.pierW, cont: c.cont };
};
const BASE_SVC = (a: number, b: number, name: string): PortSite['svc'][number] => ({ kind: 'base', a, b, name, icon: '🏡', label: L(`${name} — дім-база на цьому континенті (сон, збереження, порятунок)`, `${name} — a home base on this continent (sleep, save, rescue)`) });

const CONT_SITES: PortSite[] = [
  {
    id: 'port-azzurro', name: L('Порто-Аццурро', `Porto Azzurro`), sub: L('Лазурове узбережжя · білі вілли, оливи й вино', `the Azure Coast · white villas, olives and wine`), size: 'large', style: 'med',
    ...cpos('port-azzurro'), R: 56, elong: 1.4, peak: 18, seed: 111,
    econ: { fuel: 7.5, repair: 1.1, fish: 1.05, species: { lusk: 1.6, shoraga: 1.45, sula: 1.4, plyotka: 1.3, tunets: 0.85, hamsa: 1.2, makrel: 0.9 } },
    svc: [
      { kind: 'fuel', a: -3, b: -30, name: L('Заправка', `Fuel dock`), icon: '⛽', label: L('Заправка Порто-Аццурро — пальне', `Porto Azzurro fuel dock — fuel`) },
      { kind: 'exchange', a: -5, b: -14, name: L('Рибний ринок', `Fish market`), icon: '🐟', label: L('Рибний ринок — північна риба тут у ціні', `Fish market — northern fish fetches a good price here`) },
      { kind: 'cargo', a: -5, b: 12, name: L('Склад', `Cargo office`), icon: '📦', label: L('Склад порту — вино, оливки й кераміка на експорт', `Port cargo office — wine, olives and pottery for export`) },
      { kind: 'yard', a: -5, b: 28, name: L('Верф', `Shipyard`), icon: '🔧', label: L('Верф Порто-Аццурро — ремонт корпусу', `Porto Azzurro shipyard — hull repairs`) },
      { kind: 'shop', a: -20, b: -6, name: L('Яхтова крамниця', `Yacht chandlery`), icon: '🛠', label: L('Яхтова крамниця — каталог речей', `Yacht chandlery — item catalogue`) },
      BASE_SVC(-20, 18, L('Вілла на пагорбі', `Hillside villa`)),
      { kind: 'gelato', a: -11, b: -29, name: L('Джелатерія', `Gelateria`), icon: '🍨', label: L('Джелатерія «Стелла» — морозиво з бафами', `Gelateria “Stella” — gelato with buffs`) },
    ],
  },
  {
    id: 'port-nikos', name: L('Айос-Нікос', `Agios Nikos`), sub: L('грецьке село з блакитними куполами', `a Greek village with blue domes`), size: 'medium', style: 'med',
    ...cpos('port-nikos'), R: 40, elong: 1.3, peak: 14, seed: 127,
    econ: { fuel: 8, repair: null, fish: 1.0, species: { forel: 1.5, lusk: 1.4, krap: 1.25, hamsa: 1.1, tunets: 0.8 } },
    svc: [
      { kind: 'fuel', a: -3, b: 15, name: L('Бочка з пальним', `Fuel barrel`), icon: '⛽', label: L('Пальне в бочках', `Fuel from barrels`) },
      { kind: 'exchange', a: -4, b: -10, name: L('Таверна-скупка', `Taverna buyer`), icon: '🐟', label: L('Таверна купує рибу — лосось і тріска в ціні', `The taverna buys fish — salmon and cod fetch a lot`) },
      { kind: 'cargo', a: -12, b: 6, name: L('Склад', `Cargo office`), icon: '📦', label: L('Склад села — оливкова олія й мед', `Village store — olive oil and honey`) },
      { kind: 'sleep', a: -16, b: -8, name: L('Кімнати в таверні', `Taverna rooms`), icon: '🛏', label: L('Кімнати в таверні (сон)', `Taverna rooms (sleep)`) },
    ],
  },
  {
    id: 'port-cedar', name: L('Сідар-Гарбор', `Cedar Harbor`), sub: L('Північний край · лісопилки, хутро й кленовий сироп', `the Northern Reach · sawmills, furs and maple syrup`), size: 'large', style: 'north',
    ...cpos('port-cedar'), R: 58, elong: 1.35, peak: 30, seed: 139,
    econ: { fuel: 6.5, repair: 0.9, fish: 1.0, species: { tunets: 1.6, akula: 1.4, krap: 1.3, makrel: 1.3, lusk: 0.75, shoraga: 0.8, balyk: 0.8 } },
    svc: [
      { kind: 'fuel', a: -3, b: 30, name: L('Заправка', `Fuel dock`), icon: '⛽', label: L('Заправка Сідар-Гарбор — дешеве пальне', `Cedar Harbor fuel dock — cheap fuel`) },
      { kind: 'exchange', a: -5, b: 14, name: L('Рибна біржа', `Fish exchange`), icon: '🐟', label: L('Рибна біржа — теплолюбна риба тут рідкість і в ціні', `Fish exchange — warm-water fish is rare and pricey here`) },
      { kind: 'cargo', a: -5, b: -12, name: L('Склад', `Cargo office`), icon: '📦', label: L('Склад порту — деревина, хутро й сироп', `Port warehouse — timber, furs and syrup`) },
      { kind: 'yard', a: -5, b: -28, name: L('Верф', `Shipyard`), icon: '🔧', label: L('Верф Сідар-Гарбор — ремонт (дешево)', `Cedar Harbor shipyard — repairs (cheap)`) },
      { kind: 'shop', a: -20, b: 6, name: L('Яхтова крамниця', `Yacht chandlery`), icon: '🛠', label: L('Яхтова крамниця — каталог речей', `Yacht chandlery — item catalogue`) },
      BASE_SVC(-20, -18, L('Хатина з колод', `Log cabin`)),
    ],
  },
  {
    id: 'port-grizzly', name: L('Бухта Гризлі', `Grizzly Cove`), sub: L('далека факторія під снігами', `a remote trading post under the snow`), size: 'outpost', style: 'north',
    ...cpos('port-grizzly'), R: 42, elong: 1.3, peak: 26, seed: 151,
    econ: { fuel: 9.5, repair: 1.3, fish: 1.0, species: { akula: 1.7, tunets: 1.5, forel: 1.3, hamsa: 0.6, balyk: 0.6 } },
    svc: [
      { kind: 'fuel', a: -3, b: 12, name: L('Цистерна', `Fuel tank`), icon: '⛽', label: L('Цистерна — пальне (дороге: глушина)', `Fuel tank — fuel (expensive: the back of beyond)`) },
      { kind: 'exchange', a: -5, b: -8, name: L('Факторія', `Trading post`), icon: '🐟', label: L('Факторія — купує рибу', `Trading post — buys fish`) },
      { kind: 'cargo', a: -12, b: 5, name: L('Склад', `Cargo office`), icon: '📦', label: L('Склад факторії — хутро й риб\'ячий жир', `Trading post store — furs and fish oil`) },
      { kind: 'yard', a: -14, b: -10, name: L('Слип', `Slipway`), icon: '🔧', label: L('Слип факторії — ремонт (дорого)', `Trading post slipway — repairs (expensive)`) },
    ],
  },
];

/** позиції — у масштабі світу (region.ts WS); кожна гавань — затишок від шторму */
export const PORT_SITES: PortSite[] = [
  ...RAW_SITES.map((p) => ({ ...p, x: Math.round(p.x * WS), z: Math.round(p.z * WS), svc: [...p.svc, CARGO_SVC(...(CARGO_AT[p.id] ?? [-10, 6]))] })),
  ...CONT_SITES,
];
for (const p of PORT_SITES) addHaven({ x: p.x + p.ox * p.pierL * 0.5, z: p.z + p.oz * p.pierL * 0.5, r: 150 + p.R * 1.3, name: p.name });

/**
 * Гачок для нових видів послуг (напр. окремі покупці риби): додай запис у
 * PORT_SITES[i].svc з власним kind і зареєструй обробник тут — main викличе
 * його, коли гравець натисне E біля точки. Відомі види (fuel, yard, exchange,
 * shop, office, sleep) main відкриває сам; game.portId уже виставлено.
 */
export const PORT_SERVICE_HANDLERS: Record<string, (siteId: string, game: unknown) => void> = {};

export const PORT_SITE_BY_ID: Record<string, PortSite> = Object.fromEntries(PORT_SITES.map((p) => [p.id, p]));

/** «праворуч» від напрямку в море */
function lat(p: PortSite): [number, number] {
  return [-p.oz, p.ox];
}

/** локальні (a, b) → світ */
export function siteToWorld(p: PortSite, a: number, b: number): [number, number] {
  const [lx, lz] = lat(p);
  return [p.x + p.ox * a + lx * b, p.z + p.oz * a + lz * b];
}

/** світ → локальні (a, b) */
export function worldToSite(p: PortSite, x: number, z: number): [number, number] {
  const dx = x - p.x, dz = z - p.z;
  const [lx, lz] = lat(p);
  return [dx * p.ox + dz * p.oz, dx * lx + dz * lz];
}

/** прямокутник у локальних координатах → світовий (по осях) */
export function siteRect(p: PortSite, a0: number, a1: number, b0: number, b1: number, y: number): Rect {
  const [x0, z0] = siteToWorld(p, a0, b0);
  const [x1, z1] = siteToWorld(p, a1, b1);
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y };
}

/** причал (дошки) як платформа для ходьби */
export function pierRect(p: PortSite): Rect {
  return siteRect(p, 0, p.pierL, -p.pierW / 2, p.pierW / 2, 1.1);
}

/** місця швартування: по обидва боки причалу, від краю до берега */
export function siteBerths(p: PortSite): Berth[] {
  const h = Math.atan2(p.ox, p.oz);
  const out: Berth[] = [];
  const off = p.pierW / 2 + 2.1;
  for (let a = p.pierL - 6; a >= 6; a -= 12) {
    for (const s of [1, -1]) {
      const [x, z] = siteToWorld(p, a, s * off);
      out.push({ x, z, h });
    }
  }
  return out;
}

/** послуги у світових координатах */
export function siteServices(p: PortSite): PortService[] {
  return p.svc.map((s) => {
    const [x, z] = siteToWorld(p, s.a, s.b);
    return { kind: s.kind, x, z, label: s.label, name: s.name, icon: s.icon };
  });
}

/** охоплення суходолу (для швидких відсічок) */
const reach = (p: PortSite) => p.R * Math.sqrt(p.elong) * 1.7 + 30;

/** висота суходолу одного порту */
export function siteHeight(p: PortSite, x: number, z: number): number {
  const [a, b] = worldToSite(p, x, z);
  const hw = p.plW / 2;
  // плато містечка
  if (a <= 0 && a >= -p.plD && Math.abs(b) <= hw) return p.plY;
  // природний берег: «острів» за набережною (центр углиб від причалу)
  const ca = a + p.R * 0.55;
  // довга вісь — уздовж набережної (b)
  const u = ca * Math.sqrt(p.elong), v = b / Math.sqrt(p.elong);
  const dist = Math.hypot(u, v);
  const ang = Math.atan2(v, u);
  const k = 1 + (fbm(Math.cos(ang) * 1.3 + p.seed, Math.sin(ang) * 1.3 - p.seed, 3) - 0.5) * 0.45;
  const s = p.R * k - dist;
  let h: number;
  if (s < 0) h = Math.max(-9, s * 0.5);
  else {
    const beach = Math.min(s, 9) * 0.14;
    const hill = smoothstep(10, 10 + p.R * 0.6, s) * (p.peak - 1.2) * (0.7 + 0.6 * fbm(x * 0.04 + p.seed, z * 0.04 - p.seed, 3));
    h = beach + Math.max(0, hill);
  }
  // біля плато — плавний з'їзд до висоти містечка (набережна не висить над схилом)
  const da = a > 0 ? a : a < -p.plD ? -p.plD - a : 0;
  const db = Math.max(0, Math.abs(b) - hw);
  const d = Math.hypot(da, db);
  if (a <= 0 || db > 0) {
    if (d < 16) h = p.plY + (h - p.plY) * smoothstep(0, 16, d);
  }
  // гавань: від набережної в море — глибоко (канал для яхт)
  if (a > 0) {
    const side = smoothstep(hw + 14, hw + 4, Math.abs(b));
    const deep = -5.5;
    h = h + (Math.min(h, deep) - h) * side;
  }
  return h;
}

/** земля гавані з урахуванням континенту (будинки, рельєф гавані) */
export function siteGround(p: PortSite, x: number, z: number): number {
  const h = siteHeight(p, x, z);
  return p.cont ? Math.max(h, continentHeight(x, z)) : h;
}

/** найвища точка суходолів портів (−99 — далеко) */
export function portLandHeight(x: number, z: number): number {
  let h = -99;
  for (const p of PORT_SITES) {
    const R = reach(p);
    if (Math.abs(x - p.x) > R || Math.abs(z - p.z) > R) continue;
    h = Math.max(h, siteHeight(p, x, z));
  }
  return h;
}

/** порт, у межах якого точка (суходіл + гавань) */
export function siteAt(x: number, z: number, extra = 0): PortSite | null {
  for (const p of PORT_SITES) {
    const R = p.R * Math.sqrt(p.elong) + 25 + extra;
    if (Math.hypot(x - p.x, z - p.z) < R) return p;
  }
  return null;
}

/** обмеження для швидких перевірок: bbox суходолу (для мінімапи/карти) */
export function siteBox(p: PortSite): [number, number, number, number] {
  const R = reach(p);
  return [p.x - R, p.z - R, p.x + R, p.z + R];
}
