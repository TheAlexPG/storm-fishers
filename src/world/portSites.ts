import { fbm, smoothstep } from './portKit';

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
  /** кольори будинків/дахів — характер місця */
  style: 'village' | 'town' | 'resort' | 'whaling';
  /** послуги в локальних (a, b): a < 0 — на набережній */
  svc: Array<{ kind: ServiceKind; a: number; b: number; name: string; icon: string; label: string }>;
}

// напрямки: o — у море; l — «праворуч», якщо дивитись у море
const N = { ox: 0, oz: -1 };
const E = { ox: 1, oz: 0 };
const W = { ox: -1, oz: 0 };

export const PORT_SITES: PortSite[] = [
  {
    id: 'port-kut', name: 'Рибальський Кут', sub: 'село на палях · пальне й рибна лавка', size: 'tiny', style: 'village',
    x: -470, z: 70, ...E, R: 34, elong: 1.4, peak: 9, seed: 61,
    plW: 30, plD: 14, plY: 1.5, pierL: 20, pierW: 3.2,
    econ: { fuel: 7, repair: null, fish: 0.95, species: { hamsa: 1.35, balyk: 1.35, leschak: 1.2, plyotka: 1.15, tunets: 0.8, akula: 0.7 } },
    svc: [
      { kind: 'fuel', a: -3, b: 9, name: 'Бочка з пальним', icon: '⛽', label: 'Пальне в бочках (дорожче, ніж у «Шторму»)' },
      { kind: 'exchange', a: -4, b: -8, name: 'Рибна лавка', icon: '🐟', label: 'Рибна лавка Кута — продати улов' },
    ],
  },
  {
    id: 'port-zorya', name: 'Гавань Зорі', sub: 'містечко на скелястому мисі', size: 'medium', style: 'town',
    x: 615, z: -10, ...W, R: 62, elong: 1.3, peak: 26, seed: 71,
    plW: 54, plD: 30, plY: 1.6, pierL: 32, pierW: 4,
    econ: { fuel: 6.5, repair: 1, fish: 1.0, species: { makrel: 1.3, sula: 1.3, krap: 1.3, hamsa: 0.85, balyk: 0.85 } },
    svc: [
      { kind: 'fuel', a: -3, b: 20, name: 'Заправка', icon: '⛽', label: 'Заправка Гавані Зорі — пальне' },
      { kind: 'yard', a: -5, b: -19, name: 'Верф', icon: '🔧', label: 'Верф Гавані Зорі — ремонт корпусу' },
      { kind: 'exchange', a: -5, b: -4, name: 'Біржа', icon: '🐟', label: 'Біржа Гавані Зорі — продати улов' },
      { kind: 'sleep', a: -17, b: 10, name: 'Заїжджий двір', icon: '🛏', label: 'Заїжджий двір (сон)' },
    ],
  },
  {
    id: 'port-marina', name: 'Сонячна Марина', sub: 'курорт · ресторани платять за делікатеси', size: 'large', style: 'resort',
    x: -70, z: 560, ...N, R: 58, elong: 1.5, peak: 14, seed: 83,
    plW: 64, plD: 32, plY: 1.6, pierL: 34, pierW: 4.5,
    econ: { fuel: 8, repair: 1.25, fish: 1.05, species: { forel: 1.4, krap: 1.35, tunets: 1.35, lusk: 1.2, hamsa: 0.75, balyk: 0.75 } },
    svc: [
      { kind: 'fuel', a: -3, b: -26, name: 'Заправка', icon: '⛽', label: 'Заправка марини — пальне' },
      { kind: 'exchange', a: -5, b: -9, name: 'Ресторанна біржа', icon: '🐟', label: 'Ресторанна біржа — продати улов (делікатеси дорожче)' },
      { kind: 'shop', a: -5, b: 9, name: 'Яхтова крамниця', icon: '🛠', label: 'Яхтова крамниця — каталог речей' },
      { kind: 'yard', a: -5, b: 25, name: 'Сервіс яхт', icon: '🔧', label: 'Сервіс яхт — ремонт корпусу (курортні ціни)' },
      { kind: 'office', a: -19, b: -17, name: 'Контора марини', icon: '🛡', label: 'Контора марини — страховка' },
      { kind: 'sleep', a: -19, b: 17, name: 'Готель «Хвиля»', icon: '🛏', label: 'Готель «Хвиля» (сон)' },
    ],
  },
  {
    id: 'port-kray', name: 'Китобійня «Край світу»', sub: 'остання гавань перед відкритим океаном', size: 'outpost', style: 'whaling',
    x: 860, z: 690, ...N, R: 46, elong: 1.3, peak: 22, seed: 97,
    plW: 36, plD: 18, plY: 1.8, pierL: 30, pierW: 4,
    econ: { fuel: 11, repair: 1.6, fish: 1.0, species: { tunets: 1.6, akula: 1.7, shoraga: 1.55, lusk: 1.4, hamsa: 0.5, balyk: 0.5, leschak: 0.6, plyotka: 0.6 } },
    svc: [
      { kind: 'fuel', a: -3, b: 12, name: 'Цистерна', icon: '⛽', label: 'Цистерна — пальне (дороге: край світу)' },
      { kind: 'exchange', a: -5, b: -8, name: 'Скупка', icon: '🐟', label: 'Скупка китобійні — трофеї відкритого моря дорого' },
      { kind: 'yard', a: -12, b: 4, name: 'Слип', icon: '🔧', label: 'Слип китобійні — ремонт (дорого)' },
    ],
  },
];

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
