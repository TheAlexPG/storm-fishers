// ─────────────────────────────────────────────────────────────
// Налаштування гравця (localStorage, окремо від сейву гри).
// ─────────────────────────────────────────────────────────────

export interface Settings {
  /** загальна гучність 0..1 */
  volume: number;
  /** музика 0..1 */
  music: number;
  /** чутливість миші, множник 0.3..2.5 */
  sens: number;
  invertY: boolean;
  /** поле зору від першої особи, ° */
  fov: number;
  /** чіткість рендера: частка від devicePixelRatio (0.5..1) */
  scale: number;
  /** «легка риболовля»: ширші вікна підсічки й зелена зона, більше часу на помилку */
  easyFish: boolean;
  /** темп гри −1 спокійний … +1 динамічний (у кооп-кімнаті діє темп господаря) */
  pace: number;
}

const KEY = 'storm-settings';

export const DEFAULT_SETTINGS: Settings = { volume: 0.8, music: 0.7, sens: 1, invertY: false, fov: 70, scale: 1, easyFish: true, pace: 0 };

export function loadSettings(): Settings {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    for (const k of Object.keys(s) as Array<keyof Settings>) {
      if (typeof raw[k] === typeof s[k]) (s as Record<string, unknown>)[k] = raw[k];
    }
    // старий перемикач музики
    if (localStorage.getItem('storm-music') === 'off' && raw.music === undefined) s.music = 0;
  } catch {
    /* приватний режим */
  }
  return s;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ок */
  }
}
