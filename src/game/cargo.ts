import { mulberry32 } from '../core/math';
import { L } from '../core/i18n';
import { seaMul } from '../core/region';
import { DAY_SECONDS } from '../core/time';
import { PORT_SITES, PORT_SITE_BY_ID, siteServices, siteToWorld } from '../world/portSites';
import { CONTINENT_BY_ID } from '../world/continents';

// ─────────────────────────────────────────────────────────────
// Вантажі й доставка: на складі кожної гавані — дошка замовлень (вино й
// кераміка з Лазурового узбережжя, хутро й сироп із Півночі, снасті й пошта
// з дому, риба в льоду звідусіль). Взяв замовлення — ящики з'являються на
// причалі біля складу; їх треба перенести на яхту (слоти на лавках кокпіту
// й у носовій каюті) і доставити на склад гавані призначення до терміну.
// Оплата: відстань × ризик маршруту (бурхливі райони) × вид вантажу;
// крихке б'ється від ударів хвиль, риба в льоду псується в дорозі,
// прострочка — половина ціни. Міжконтинентальні рейси — найприбутковіші.
// ─────────────────────────────────────────────────────────────

export type CargoShape = 'crate' | 'barrel' | 'icebox';
export type Origin = 'home' | 'med' | 'north';

export interface GoodsDef {
  id: string;
  name: string;
  /** трафаретний напис на ящику */
  stencil: string;
  icon: string;
  shape: CargoShape;
  /** колір фарби трафарету / обручів */
  color: string;
  fragile: boolean;
  perish: boolean;
  /** множник ціни */
  value: number;
  origin: Origin;
}

export const GOODS: GoodsDef[] = [
  // Лазурове узбережжя
  { id: 'wine', name: L('Вино', `Wine`), stencil: 'VINO', icon: '🍷', shape: 'crate', color: '#8e2433', fragile: true, perish: false, value: 1.45, origin: 'med' },
  { id: 'olives', name: L('Оливки', `Olives`), stencil: 'OLIVE', icon: '🫒', shape: 'barrel', color: '#5d6b2c', fragile: false, perish: false, value: 1.0, origin: 'med' },
  { id: 'pottery', name: L('Кераміка', `Pottery`), stencil: 'TERRA', icon: '🏺', shape: 'crate', color: '#b0532e', fragile: true, perish: false, value: 1.55, origin: 'med' },
  { id: 'oil', name: L('Оливкова олія', `Olive oil`), stencil: 'OLIO', icon: '🫙', shape: 'barrel', color: '#9a8a2c', fragile: false, perish: false, value: 1.2, origin: 'med' },
  { id: 'lemons', name: L('Лимони', `Lemons`), stencil: 'LIMONI', icon: '🍋', shape: 'crate', color: '#c99a12', fragile: false, perish: true, value: 1.15, origin: 'med' },
  // Північний край
  { id: 'furs', name: L('Хутро', `Furs`), stencil: 'FURS', icon: '🧥', shape: 'crate', color: '#5b3a24', fragile: false, perish: false, value: 1.5, origin: 'north' },
  { id: 'syrup', name: L('Кленовий сироп', `Maple syrup`), stencil: 'SYRUP', icon: '🍁', shape: 'barrel', color: '#a8441c', fragile: false, perish: false, value: 1.3, origin: 'north' },
  { id: 'timber', name: L('Кедрові дошки', `Cedar boards`), stencil: 'CEDAR', icon: '🪵', shape: 'crate', color: '#3f5a35', fragile: false, perish: false, value: 0.95, origin: 'north' },
  { id: 'lamps', name: L('Скляні ліхтарі', `Glass lanterns`), stencil: 'GLASS', icon: '🏮', shape: 'crate', color: '#2f5f8a', fragile: true, perish: false, value: 1.6, origin: 'north' },
  // дім і місцеві гавані
  { id: 'tools', name: L('Снасті й інструмент', `Tackle & tools`), stencil: 'TOOLS', icon: '🧰', shape: 'crate', color: '#2a3a46', fragile: false, perish: false, value: 1.0, origin: 'home' },
  { id: 'mail', name: L('Пошта', `Mail`), stencil: 'POST', icon: '✉️', shape: 'crate', color: '#c23a2c', fragile: false, perish: false, value: 1.25, origin: 'home' },
  { id: 'canned', name: L('Консерви', `Tinned fish`), stencil: 'CANS', icon: '🥫', shape: 'crate', color: '#24878c', fragile: false, perish: false, value: 1.05, origin: 'home' },
  // звідусіль: свіжа риба в льоду
  { id: 'icefish', name: L('Риба в льоду', `Iced fish`), stencil: 'ICE', icon: '🧊', shape: 'icebox', color: '#2f6fb5', fragile: false, perish: true, value: 1.35, origin: 'home' },
];
export const GOODS_BY_ID: Record<string, GoodsDef> = Object.fromEntries(GOODS.map((g) => [g.id, g]));

/** гавань: дім ('home') або PORT_SITES */
export interface Dock {
  id: string;
  name: string;
  x: number;
  z: number;
  origin: Origin;
  /** точка складу (двері) */
  sx: number;
  sz: number;
  /** куди складати ящики на набережній (світ) і напрям «у море» */
  px: number;
  pz: number;
  ox: number;
  oz: number;
}

/** склад домашнього «Шторму» (port.ts PORT_POINTS 'cargo') */
export const HOME_CARGO = { x: -46, z: -46.6 };

export const DOCKS: Dock[] = [
  { id: 'home', name: L('Шторм', `Storm Harbour`), x: 0, z: -30, origin: 'home', sx: HOME_CARGO.x, sz: HOME_CARGO.z, px: -41.5, pz: -42.6, ox: 0, oz: 1 },
  ...PORT_SITES.map((p): Dock => {
    const sv = siteServices(p).find((s) => s.kind === 'cargo');
    const svc = p.svc.find((s) => s.kind === 'cargo');
    const [px, pz] = svc ? siteToWorld(p, -2.6, svc.b + (svc.b > 0 ? -3.6 : 3.6)) : [p.x, p.z];
    const origin: Origin = p.cont ? CONTINENT_BY_ID[p.cont].style : 'home';
    return { id: p.id, name: p.name, x: p.x, z: p.z, origin, sx: sv?.x ?? p.x, sz: sv?.z ?? p.z, px, pz, ox: p.ox, oz: p.oz };
  }),
];
export const DOCK_BY_ID: Record<string, Dock> = Object.fromEntries(DOCKS.map((d) => [d.id, d]));

export interface CargoItem {
  /** де ящик: на причалі гавані відправлення, на яхті (слот), у руках, доставлений */
  where: 'pier' | 'boat' | 'hand';
  slot: number;
  /** цілість 0..1 (крихке б'ється від ударів хвиль) */
  cond: number;
}

export interface CargoOrder {
  id: string;
  goods: string;
  from: string;
  to: string;
  crates: number;
  /** повна оплата за вчасну й цілу доставку */
  pay: number;
  /** абсолютний ігровий час: узято і термін (clockH) */
  takenH: number;
  dueH: number;
  urgent: boolean;
  items: CargoItem[];
}

export interface CargoSave {
  orders?: CargoOrder[];
  taken?: string[];
  delivered?: number;
}

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** відстань «морем» між гаванями, м (пряма × 1.25 на обходи) */
export function routeDist(a: Dock, b: Dock): number {
  return Math.hypot(a.x - b.x, a.z - b.z) * 1.25;
}

/** ризик маршруту: середня сила моря вздовж шляху (бурхливі райони → дорожче) */
function routeRisk(a: Dock, b: Dock): number {
  let s = 0;
  const n = 14;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    s += seaMul(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
  }
  return 0.55 + 0.6 * (s / (n - 1));
}

/** скільки ігрових годин іде рейс під вітрилами (~4,5 м/с) */
export function travelHours(dist: number): number {
  return (dist / 4.5 / DAY_SECONDS) * 24;
}

/** скільки ящиків уміщає яхта: лави кокпіту, з трюмом — ще й носова каюта */
export function cargoSlots(holdLvl: number): number {
  return [4, 6, 7, 8, 9, 9][Math.max(0, Math.min(5, holdLvl))];
}

/** свіжість риби в льоду 0..1 (за годинами в дорозі) */
export function iceFresh(o: CargoOrder, nowH: number): number {
  const life = Math.max(10, (o.dueH - o.takenH) * 1.15);
  return Math.max(0, Math.min(1, 1 - Math.max(0, nowH - o.takenH - life * 0.35) / (life * 0.9)));
}

export class CargoBook {
  orders: CargoOrder[] = [];
  /** розібрані пропозиції (id), щоб не з'являлися знову того ж дня */
  taken: string[] = [];
  delivered = 0;
  /** гравцю: тост (main показує) */
  onNote: ((text: string, kind: 'good' | 'warn' | 'bad') => void) | null = null;
  static readonly MAX_ACTIVE = 3;

  /** пропозиції складу гавані на сьогодні */
  offers(portId: string, day: number): CargoOrder[] {
    const from = DOCK_BY_ID[portId];
    if (!from) return [];
    const rng = mulberry32(hashStr(portId) + day * 7919);
    const size = portId === 'home' ? 'large' : PORT_SITE_BY_ID[portId]?.size ?? 'medium';
    const n = size === 'large' ? 4 : size === 'outpost' || size === 'tiny' ? 2 : 3;
    const out: CargoOrder[] = [];
    const others = DOCKS.filter((d) => d.id !== portId);
    for (let k = 0; k < n; k++) {
      const id = `${portId}:${day}:${k}`;
      // товар: місцевий, інколи — риба в льоду
      const local = GOODS.filter((g) => g.origin === from.origin && g.id !== 'icefish');
      const g = rng() < 0.22 ? GOODS_BY_ID.icefish : local[Math.floor(rng() * local.length)] ?? GOODS_BY_ID.tools;
      // куди: далекі гавані й інший клімат — частіше (там на товар попит)
      const w = others.map((d) => (0.25 + routeDist(from, d) / 1000) * (d.origin !== from.origin ? 1.8 : 1));
      let r = rng() * w.reduce((a, b) => a + b, 0), to = others[0];
      for (let i = 0; i < others.length; i++) {
        r -= w[i];
        if (r <= 0) { to = others[i]; break; }
      }
      const dist = routeDist(from, to);
      const crates = 1 + Math.floor(rng() * (g.fragile ? 3 : 4));
      const urgent = rng() < 0.25 || g.id === 'mail';
      const perCrate = (30 + (dist / 1000) * 92) * g.value * routeRisk(from, to) * (urgent ? 1.35 : 1);
      const pay = Math.round((perCrate * crates) / 5) * 5;
      const hours = travelHours(dist);
      out.push({
        id, goods: g.id, from: portId, to: to.id, crates, pay,
        takenH: 0, dueH: Math.ceil(hours * (urgent ? 1.6 : 2.4) + (urgent ? 4 : 10)), urgent,
        items: [],
      });
    }
    return out.filter((o) => !this.taken.includes(o.id));
  }

  /** узяти замовлення: ящики — на причал біля складу */
  accept(o: CargoOrder, nowH: number): boolean {
    if (this.orders.length >= CargoBook.MAX_ACTIVE || this.taken.includes(o.id)) return false;
    const dur = o.dueH;
    this.orders.push({ ...o, takenH: nowH, dueH: nowH + dur, items: Array.from({ length: o.crates }, () => ({ where: 'pier' as const, slot: -1, cond: 1 })) });
    this.taken.push(o.id);
    if (this.taken.length > 60) this.taken.splice(0, this.taken.length - 60);
    return true;
  }

  /** скільки зараз коштує доставка (крихкість, свіжість, прострочка) */
  quote(o: CargoOrder, nowH: number): { pay: number; late: boolean; cond: number; fresh: number } {
    const g = GOODS_BY_ID[o.goods];
    const cond = o.items.reduce((a, it) => a + it.cond, 0) / Math.max(1, o.items.length);
    const fresh = g?.perish ? iceFresh(o, nowH) : 1;
    const late = nowH > o.dueH;
    const k = (g?.fragile ? 0.15 + 0.85 * cond : 1) * (g?.perish ? 0.35 + 0.65 * fresh : 1) * (late ? (nowH > o.dueH + (o.dueH - o.takenH) ? 0.25 : 0.5) : 1);
    return { pay: Math.round(o.pay * k), late, cond, fresh };
  }

  /** здати на складі гавані: усі ящики мають бути на яхті */
  deliver(id: string, portId: string, nowH: number): { ok: boolean; pay: number; why?: string } {
    const o = this.orders.find((x) => x.id === id);
    if (!o || o.to !== portId) return { ok: false, pay: 0 };
    if (o.items.some((it) => it.where !== 'boat')) return { ok: false, pay: 0, why: L('Не всі ящики на яхті', `Not all crates are aboard`) };
    const q = this.quote(o, nowH);
    this.orders = this.orders.filter((x) => x !== o);
    this.delivered++;
    return { ok: true, pay: q.pay };
  }

  /** відмовитись: ящики лишаються на складі відправлення, неустойка 15% */
  cancel(id: string): number {
    const o = this.orders.find((x) => x.id === id);
    if (!o) return 0;
    this.orders = this.orders.filter((x) => x !== o);
    return Math.round(o.pay * 0.15);
  }

  /** зайняті слоти на яхті */
  usedSlots(): Set<number> {
    const s = new Set<number>();
    for (const o of this.orders) for (const it of o.items) if (it.where === 'boat') s.add(it.slot);
    return s;
  }

  /** ящик у руках (якщо є) */
  inHand(): { o: CargoOrder; i: number } | null {
    for (const o of this.orders) {
      const i = o.items.findIndex((it) => it.where === 'hand');
      if (i >= 0) return { o, i };
    }
    return null;
  }

  /** удар хвилі: крихке на лавках (палубні слоти 0..5) б'ється, у каюті — лише від дуже сильних */
  slam(power: number) {
    for (const o of this.orders) {
      if (!GOODS_BY_ID[o.goods]?.fragile) continue;
      for (const it of o.items) {
        if (it.where !== 'boat') continue;
        const deck = it.slot < 6;
        const hit = deck ? power * 0.05 : power > 3 ? (power - 3) * 0.03 : 0;
        if (hit > 0) it.cond = Math.max(0, it.cond - hit);
      }
    }
  }

  /** кодування вантажу на яхті для кооп-екіпажу: по 4 біти на слот (індекс товару + 1) */
  code(): number {
    let c = 0;
    for (const o of this.orders) {
      const gi = GOODS.findIndex((g) => g.id === o.goods) + 1;
      for (const it of o.items) if (it.where === 'boat' && it.slot >= 0 && it.slot < 9) c += gi * Math.pow(16, it.slot);
    }
    return c;
  }

  serialize(): CargoSave {
    // ящик у руках при збереженні — назад на причал
    return {
      orders: this.orders.map((o) => ({ ...o, items: o.items.map((it) => (it.where === 'hand' ? { where: 'pier' as const, slot: -1, cond: it.cond } : { ...it })) })),
      taken: this.taken.slice(-60),
      delivered: this.delivered,
    };
  }

  load(d: CargoSave | undefined) {
    this.orders = [];
    this.taken = [];
    this.delivered = 0;
    if (!d) return;
    if (Array.isArray(d.orders)) {
      for (const o of d.orders) {
        if (!o || !GOODS_BY_ID[o.goods] || !DOCK_BY_ID[o.from] || !DOCK_BY_ID[o.to] || !Array.isArray(o.items)) continue;
        o.items = o.items.map((it) => ({ where: it.where === 'boat' ? 'boat' : 'pier', slot: it.where === 'boat' ? it.slot : -1, cond: Number.isFinite(it.cond) ? it.cond : 1 }));
        this.orders.push(o);
      }
    }
    if (Array.isArray(d.taken)) this.taken = d.taken.filter((s) => typeof s === 'string');
    if (Number.isFinite(d.delivered)) this.delivered = d.delivered!;
  }
}

/** декодувати кооп-код у [слот → товар] */
export function decodeCargo(code: number): Array<GoodsDef | null> {
  const out: Array<GoodsDef | null> = [];
  let c = Math.max(0, Math.round(code));
  for (let s = 0; s < 9; s++) {
    const gi = c % 16;
    c = Math.floor(c / 16);
    out.push(gi > 0 ? GOODS[gi - 1] ?? null : null);
  }
  return out;
}

/** назва гавані */
export function dockName(id: string): string {
  return DOCK_BY_ID[id]?.name ?? id;
}
