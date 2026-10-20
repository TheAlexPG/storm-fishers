import type { HatKind } from '../world/character';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Капелюхи-знахідки: капітанський кашкет є від початку, решту знаходять
// на островах. Вибраний капелюх видно на аватарі (і друзям у коопі).
// ─────────────────────────────────────────────────────────────

export interface HatDef {
  id: string;
  name: string;
  icon: string;
  kind: HatKind;
  color: number;
  accent?: number;
  /** де шукати (підказка в гардеробі) */
  hint: string;
}

export const HATS: HatDef[] = [
  { id: 'captain', name: L('Капітанський кашкет', `Captain's cap`), icon: '🧢', kind: 'captain', color: 0x1d2a44, hint: L('з тобою від початку', `with you from the start`) },
  { id: 'ushanka', name: L('Вушанка', `Ushanka`), icon: '🐻', kind: 'ushanka', color: 0x6b4a32, accent: 0x8a8f99, hint: L('Чаячий острівець', `Gull Islet`) },
  { id: 'sou', name: L('Жовта зюйдвестка', `Yellow sou'wester`), icon: '🌧️', kind: 'sou', color: 0xf2c12e, hint: L('Сосновий острів, у руїнах хатини', `Pine Island, in the ruined hut`) },
  { id: 'straw', name: L('Солом\'яний бриль', `Straw hat`), icon: '👒', kind: 'straw', color: 0xe3c77a, accent: 0xc0392b, hint: L('Пальмова коса', `Palm Spit`) },
  { id: 'tricorn', name: L('Піратська треуголка', `Pirate tricorne`), icon: '🏴‍☠️', kind: 'tricorn', color: 0x24211f, accent: 0xd9b24a, hint: L('Піратська бухта', `Pirate Cove`) },
  { id: 'crown', name: L('Корона з мушель', `Seashell crown`), icon: '👑', kind: 'crown', color: 0xf3d9c4, accent: 0xe98b8b, hint: L('Мушлевий острів', `Shell Island`) },
  { id: 'beanie', name: L('Шапка з помпоном', `Bobble hat`), icon: '🧶', kind: 'beanie', color: 0xb8362c, accent: 0xf4efe4, hint: L('відкрий усі острови', `discover all the islands`) },
];

export const HAT_BY_ID: Record<string, HatDef> = Object.fromEntries(HATS.map((h) => [h.id, h]));

export function hatOf(id: string | undefined | null): HatDef {
  return HAT_BY_ID[id ?? ''] ?? HATS[0];
}
