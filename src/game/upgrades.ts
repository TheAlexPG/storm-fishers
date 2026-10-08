import type { UpgradeId, UpgradeLevels } from '../core/types';

// ─────────────────────────────────────────────────────────────
// 7 дерев апгрейдів × 5 рівнів. Правило: жодного «невидимого»
// апгрейду — кожен змінює вигляд човна / звук / поведінку.
// ─────────────────────────────────────────────────────────────

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: (lvl: number) => string;
  costs: number[]; // вартість рівнів 1..5
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'engine',
    name: 'Двигун',
    desc: (l) => `+${l * 20} % потужності (${Math.round(34 * (1 + l * 0.2))} км/год)`,
    costs: [400, 800, 1600, 3200, 6000],
  },
  {
    id: 'hull',
    name: 'Корпус',
    desc: (l) => `+${l * 40} міцності (макс. ${100 + l * 40})`,
    costs: [350, 700, 1400, 2800, 5000],
  },
  {
    id: 'hold',
    name: 'Трюм',
    desc: (l) => `місткість ${8 + l * 6} шт.`,
    costs: [300, 600, 1200, 2400, 4500],
  },
  {
    id: 'rod',
    name: 'Вудка',
    desc: (l) => `закид до ${Math.round(8 + l * 1.2)} м, швидший клюв, міцніша леска`,
    costs: [300, 650, 1300, 2600, 4800],
  },
  {
    id: 'fuel',
    name: 'Паливний бак',
    desc: (l) => `об'єм ${40 + l * 100} л`,
    costs: [250, 500, 1000, 2000, 3800],
  },
  {
    id: 'lights',
    name: 'Світло палуби',
    desc: (l) => `світло: ${l === 0 ? 'одна фара' : l < 4 ? `${l + 1} ліхтарі` : '4 ліхтарі + прожектор'}`,
    costs: [200, 450, 900, 1800, 3500],
  },
  {
    id: 'stab',
    name: 'Стабілізатор',
    desc: (l) => `−${l * 25} % крену`,
    costs: [500, 1000, 2000, 4000, 7500],
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
export const MAX_LEVEL = 5;

export function defaultUpgrades(): UpgradeLevels {
  return { engine: 0, hull: 0, hold: 0, rod: 0, fuel: 0, lights: 0, stab: 0 };
}

export function upgradeCost(id: UpgradeId, currentLevel: number): number | null {
  const def = UPGRADE_BY_ID[id];
  if (!def || currentLevel >= MAX_LEVEL) return null;
  return def.costs[currentLevel];
}

// ── Ефекти (читає фізика/ігри) ──
export const eff = {
  enginePower: (l: number) => 1 + l * 0.2,
  maxHull: (l: number) => 100 + l * 40,
  holdCap: (l: number) => 8 + l * 6,
  castDist: (l: number) => 8 + l * 1.2,
  biteSpeed: (l: number) => 1 + l * 0.08,
  lineStrength: (l: number) => 1 + l * 0.15,
  maxFuel: (l: number) => 40 + l * 100,
  lightRadius: (l: number) => 6 + l * 3,
  rollDamp: (l: number) => 1 + l * 0.3,
};
