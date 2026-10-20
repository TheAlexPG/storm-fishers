import type { UpgradeLevels } from '../core/types';
import { UPGRADES } from './upgrades';
import { L } from '../core/i18n';

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
  { tier: 0, name: L('Без страховки', `No insurance`), rate: 0, min: 0, keep: 0, cargo: 0, claimH: 10, tow: 350, blurb: L('Затонув — втрачаєш увесь улов і всі модулі. Рятувальники витягнуть голий корпус і візьмуть за буксир.', `If you sink you lose the whole catch and every module. Rescuers will tow in the bare hull and charge for it.`) },
  { tier: 1, name: L('Базова', `Basic`), rate: 0.006, min: 25, keep: 1, cargo: 0, claimH: 8, tow: 0, blurb: L('Новий корпус і перший рівень кожного модуля. Улов — твій ризик.', `A new hull and the first level of every module. The catch is your risk.`) },
  { tier: 2, name: L('Стандарт', `Standard`), rate: 0.014, min: 45, keep: 3, cargo: 0, claimH: 5, tow: 0, blurb: L('Модулі до 3-го рівня відновлять. Улов не покривається.', `Modules restored up to level 3. The catch isn't covered.`) },
  { tier: 3, name: L('Розширена', `Extended`), rate: 0.026, min: 80, keep: 5, cargo: 0.5, claimH: 3, tow: 0, blurb: L('Усі модулі й половина вартості улову. Човен — за 3 години.', `All modules and half the value of the catch. A boat within 3 hours.`) },
  { tier: 4, name: L('Преміум «Шторм»', `Premium “Storm”`), rate: 0.042, min: 130, keep: 5, cargo: 1, claimH: 0, tow: 0, blurb: L('Усе: модулі, повна вартість улову, новий човен одразу біля причалу.', `Everything: modules, the full value of the catch, a new boat right at the pier.`) },
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
