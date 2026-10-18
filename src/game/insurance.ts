import type { UpgradeLevels } from '../core/types';
import { UPGRADES } from './upgrades';

// ─────────────────────────────────────────────────────────────
// Страховка човна (в дусі Star Citizen): щоденний внесок, що залежить
// від вартості човна (усі куплені модулі). Якщо човен затонув:
//  • без страховки — пропадає весь улов, УСІ модулі (рятувальники
//    витягують голий корпус), ще й плата за буксир;
//  • рівні страховки покривають модулі до певного рівня, частину вартості
//    улову й скорочують час очікування нового човна.
// Внесок списується щодня на світанку; не вистачило грошей — поліс згорає.
// ─────────────────────────────────────────────────────────────

export interface InsPlan {
  tier: number;
  name: string;
  /** частка вартості човна за добу */
  rate: number;
  /** мінімальний внесок, ₴/добу */
  min: number;
  /** модулі зберігаються до цього рівня (у кожному дереві) */
  keep: number;
  /** частка вартості улову, що виплачується */
  cargo: number;
  /** годин гри до видачі нового човна */
  claimH: number;
  /** плата за буксир/рятування */
  tow: number;
  blurb: string;
}

export const PLANS: InsPlan[] = [
  { tier: 0, name: 'Без страховки', rate: 0, min: 0, keep: 0, cargo: 0, claimH: 10, tow: 350, blurb: 'Затонув — втрачаєш увесь улов і всі модулі. Рятувальники витягнуть голий корпус і візьмуть за буксир.' },
  { tier: 1, name: 'Базова', rate: 0.006, min: 25, keep: 1, cargo: 0, claimH: 8, tow: 0, blurb: 'Новий корпус і перший рівень кожного модуля. Улов — твій ризик.' },
  { tier: 2, name: 'Стандарт', rate: 0.014, min: 45, keep: 3, cargo: 0, claimH: 5, tow: 0, blurb: 'Модулі до 3-го рівня відновлять. Улов не покривається.' },
  { tier: 3, name: 'Розширена', rate: 0.026, min: 80, keep: 5, cargo: 0.5, claimH: 3, tow: 0, blurb: 'Усі модулі й половина вартості улову. Човен — за 3 години.' },
  { tier: 4, name: 'Преміум «Шторм»', rate: 0.042, min: 130, keep: 5, cargo: 1, claimH: 0, tow: 0, blurb: 'Усе: модулі, повна вартість улову, новий човен одразу біля причалу.' },
];

/** вартість човна: сума цін усіх куплених рівнів */
export function boatValue(up: UpgradeLevels): number {
  let v = 0;
  for (const u of UPGRADES) for (let i = 0; i < (up[u.id] ?? 0); i++) v += u.costs[i];
  return v;
}

export function dailyPremium(tier: number, up: UpgradeLevels): number {
  const p = PLANS[tier];
  if (!p || tier === 0) return 0;
  return Math.round(Math.max(p.min, p.rate * (boatValue(up) + 2000)));
}

export interface SinkReport {
  plan: InsPlan;
  lostFish: number;
  cargoValue: number;
  payout: number;
  /** [назва модуля, був рівень, став] */
  lostModules: Array<[string, number, number]>;
  tow: number;
}

/** застосувати затоплення до рівнів модулів (мутує up), повертає втрати */
export function applySinkToUpgrades(up: UpgradeLevels, tier: number): Array<[string, number, number]> {
  const keep = PLANS[tier]?.keep ?? 0;
  const lost: Array<[string, number, number]> = [];
  for (const u of UPGRADES) {
    const lvl = up[u.id] ?? 0;
    const nl = Math.min(lvl, keep);
    if (nl < lvl) {
      lost.push([u.name, lvl, nl]);
      up[u.id] = nl;
    }
  }
  return lost;
}
