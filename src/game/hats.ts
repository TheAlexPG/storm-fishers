import type { HatKind } from '../world/character';

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
  { id: 'captain', name: 'Капітанський кашкет', icon: '🧢', kind: 'captain', color: 0x1d2a44, hint: 'з тобою від початку' },
  { id: 'ushanka', name: 'Вушанка', icon: '🐻', kind: 'ushanka', color: 0x6b4a32, accent: 0x8a8f99, hint: 'Чаячий острівець' },
  { id: 'sou', name: 'Жовта зюйдвестка', icon: '🌧️', kind: 'sou', color: 0xf2c12e, hint: 'Сосновий острів, у руїнах хатини' },
  { id: 'straw', name: 'Солом\'яний бриль', icon: '👒', kind: 'straw', color: 0xe3c77a, accent: 0xc0392b, hint: 'Пальмова коса' },
  { id: 'tricorn', name: 'Піратська треуголка', icon: '🏴‍☠️', kind: 'tricorn', color: 0x24211f, accent: 0xd9b24a, hint: 'Піратська бухта' },
  { id: 'crown', name: 'Корона з мушель', icon: '👑', kind: 'crown', color: 0xf3d9c4, accent: 0xe98b8b, hint: 'Мушлевий острів' },
  { id: 'beanie', name: 'Шапка з помпоном', icon: '🧶', kind: 'beanie', color: 0xb8362c, accent: 0xf4efe4, hint: 'відкрий усі острови' },
];

export const HAT_BY_ID: Record<string, HatDef> = Object.fromEntries(HATS.map((h) => [h.id, h]));

export function hatOf(id: string | undefined | null): HatDef {
  return HAT_BY_ID[id ?? ''] ?? HATS[0];
}
