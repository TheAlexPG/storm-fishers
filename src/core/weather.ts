import { clamp, damp, rand, chance, mulberry32 } from './math';
import type { WeatherState, WeatherSnapshot } from './types';

// ─────────────────────────────────────────────────────────────
// Погода: Тиша → Повіє → Вітер → Шторм.
// Переходи плавні (~60 с), стан тримається 2–4 год гри.
// ─────────────────────────────────────────────────────────────

const STATE_RANGE: Record<WeatherState, [number, number]> = {
  calm: [0.0, 0.14],
  breeze: [0.14, 0.45],
  wind: [0.45, 0.74],
  storm: [0.74, 1.12],
};

export function stateFromIntensity(v: number): WeatherState {
  if (v < STATE_RANGE.calm[1]) return 'calm';
  if (v < STATE_RANGE.breeze[1]) return 'breeze';
  if (v < STATE_RANGE.wind[1]) return 'wind';
  return 'storm';
}

export class Weather {
  intensity = 0.1;
  private target = 0.1;
  windDir = 0;
  private windDirTarget = 0;
  private holdTimer = 0; // секунд до наступної зміни
  private rng: () => number;
  flash = 0;
  /** між блискавками */
  private nextLightning = 6;
  onLightning: ((power: number) => void) | null = null;

  constructor(seed = Date.now() % 100000) {
    this.rng = mulberry32(seed);
  }

  update(dt: number) {
    // тримаємо стан 2–4 год гри = 50–100 с реально
    this.holdTimer -= dt;
    if (this.holdTimer <= 0) {
      this.pickTarget();
      this.holdTimer = rand(50, 100);
    }
    // плавний перехід (~60 с)
    this.intensity = damp(this.intensity, this.target, 0.05, dt);
    this.windDir = damp(this.windDir, this.windDirTarget, 0.08, dt);
    this.flash = Math.max(0, this.flash - dt * 2.2);

    // блискавки в шторм
    if (this.intensity > 0.7) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        const p = rand(0.5, 1.0);
        this.flash = Math.max(this.flash, p);
        this.onLightning?.(p);
        this.nextLightning = rand(4, 14);
      }
    }
  }

  private pickTarget() {
    // випадковий блукання: частіше в біг, рідше в шторм; з порту (тиша) — помірний вітер
    const r = this.rng();
    const cur = stateFromIntensity(this.intensity);
    const nextState: WeatherState = (() => {
      const roll = r;
      if (cur === 'calm') return roll < 0.75 ? 'breeze' : 'calm';
      if (cur === 'breeze') return roll < 0.45 ? 'calm' : roll < 0.85 ? 'wind' : 'breeze';
      if (cur === 'wind') return roll < 0.35 ? 'breeze' : roll < 0.6 ? 'storm' : 'wind';
      return roll < 0.65 ? 'wind' : 'storm'; // шторм минає
    })();
    const [a, b] = STATE_RANGE[nextState];
    this.target = a + this.rng() * (b - a);
    this.windDirTarget += rand(-1.2, 1.2);
    // іноді різкі зміни — «радіо шипить»
    if (nextState === 'storm' && chance(0.5)) this.holdTimer = rand(35, 60);
  }

  /** сила вітру 0..1 (трохи нижча за інтенсивність) */
  get wind(): number {
    return clamp(this.intensity * 0.9, 0, 1);
  }

  /** дощ 0..1 — тільки у вітрі/штормі */
  get rain(): number {
    return clamp((this.intensity - 0.45) / 0.5, 0, 1);
  }

  /** хмарність 0..1 */
  get cloudiness(): number {
    return clamp(0.15 + this.intensity * 0.85, 0, 1);
  }

  /** штормовий бонус: риба, піймана за інтенсивності > 0.6 */
  get stormBonus(): boolean {
    return this.intensity > 0.6;
  }

  state(): WeatherState {
    return stateFromIntensity(this.intensity);
  }

  snapshot(): WeatherSnapshot {
    return {
      state: this.state(),
      intensity: this.intensity,
      wind: this.wind,
      windDir: this.windDir,
      rain: this.rain,
      flash: this.flash,
      forecast: this.target,
    };
  }

  serialize(): number {
    return Math.round(this.intensity * 100);
  }

  restore(v: number) {
    this.intensity = v / 100;
    this.target = this.intensity;
  }
}
