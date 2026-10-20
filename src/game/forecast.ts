import { beaufort, stateFromIntensity } from '../core/weather';
import type { WeatherState } from '../core/types';

// ─────────────────────────────────────────────────────────────
// Прогноз на 3 дні для екрана радіо. Погода в грі не планує днів наперед,
// тож прогноз виводиться: «сьогодні» — з поточної сили й цілі погоди,
// далі — детермінований (за номером дня) дрейф із ухилом у нинішній тренд.
// Однаковий у всіх гравців кімнати (день і погода спільні).
// TODO: якщо погода отримає власний план на дні — брати його звідти.
// ─────────────────────────────────────────────────────────────

export interface ForecastDay {
  label: string;
  state: WeatherState;
  /** сила погоди 0..~1.1 */
  power: number;
  windMs: number;
  bf: number;
  /** хвиля у відкритому морі, м */
  waveM: number;
  /** ймовірність шторму, % */
  storm: number;
  /** напрям вітру (рад, звідки дме) */
  dir: number;
}

function hash(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

function day(label: string, power: number, dir: number): ForecastDay {
  const p = Math.max(0, Math.min(1.1, power));
  const windMs = 1.5 + p * 0.9 * 19;
  return {
    label,
    state: stateFromIntensity(p),
    power: p,
    windMs,
    bf: beaufort(windMs).b,
    waveM: Math.round((0.2 + p * p * 4.2) * 10) / 10,
    storm: Math.round(Math.max(0, Math.min(1, (p - 0.4) / 0.5)) * 100),
    dir,
  };
}

const DAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'];

/** base/target — Weather.base і snapshot().forecast; dayCount — GameState.dayCount */
export function forecast3(base: number, target: number, windDir: number, dayCount: number): ForecastDay[] {
  const out: ForecastDay[] = [];
  const today = Math.max(base, target) * 0.6 + (base + target) * 0.2;
  out.push(day('Сьогодні', today, windDir));
  let p = today;
  for (let i = 1; i <= 2; i++) {
    const r = hash(dayCount * 7919 + i * 104729);
    const r2 = hash(dayCount * 31337 + i * 7);
    // повільний дрейф: середнє ~0.4, рідкісні штормові дні
    p = p * 0.45 + 0.4 * 0.35 + (r - 0.5) * 0.55 + (r2 > 0.86 ? 0.35 : 0);
    out.push(day(i === 1 ? 'Завтра' : DAYS[(dayCount + i) % 7], p, windDir + (r2 - 0.5) * 2));
  }
  return out;
}
