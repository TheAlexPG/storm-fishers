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

/** наскільки «відкрите» море в точці: 0 біля берега (до ~350 м) … 1 далеко (2 км+) */
export function offshore(x: number, z: number): number {
  const d = Math.hypot(x, z);
  const t = Math.min(1, Math.max(0, (d - 350) / 1650));
  return t * t * (3 - 2 * t);
}

/** множник сили погоди: біля берега затишно, у відкритому морі — значно сильніше */
export function seaFactor(off: number): number {
  return 0.7 + 0.75 * off;
}

/** шкала Бофорта за швидкістю вітру (м/с) */
const BEAUFORT: Array<[number, string]> = [
  [0.3, 'штиль'], [1.6, 'тихий'], [3.4, 'легкий'], [5.5, 'слабкий'], [8.0, 'помірний'], [10.8, 'свіжий'],
  [13.9, 'сильний'], [17.2, 'міцний'], [20.8, 'дуже міцний'], [24.5, 'шторм'], [28.5, 'сильний шторм'], [32.7, 'жорстокий шторм'], [Infinity, 'ураган'],
];
export function beaufort(ms: number): { b: number; name: string } {
  for (let i = 0; i < BEAUFORT.length; i++) if (ms < BEAUFORT[i][0]) return { b: i, name: BEAUFORT[i][1] };
  return { b: 12, name: 'ураган' };
}

export class Weather {
  /** загальна сила погоди (синхронізується в коопі); локальна — intensity */
  base = 0.1;
  /** множник «відкритого моря» в точці гравця (seaFactor) */
  localMul = 1;
  /** локальна сила погоди 0..~1.6 біля гравця */
  get intensity(): number {
    return this.base * this.localMul;
  }
  set intensity(v: number) {
    this.base = v;
  }
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
    this.base = damp(this.base, this.target, 0.05, dt);
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
    // у відкритому морі шторми частіші (гравець далеко — ціль погоди важча)
    const cur = stateFromIntensity(this.base);
    const far = this.localMul > 1.15;
    const nextState: WeatherState = (() => {
      const roll = r;
      if (cur === 'calm') return roll < 0.75 ? 'breeze' : 'calm';
      if (cur === 'breeze') return roll < (far ? 0.25 : 0.45) ? 'calm' : roll < (far ? 0.92 : 0.85) ? 'wind' : 'breeze';
      if (cur === 'wind') return roll < (far ? 0.2 : 0.35) ? 'breeze' : roll < (far ? 0.7 : 0.6) ? 'storm' : 'wind';
      return roll < (far ? 0.45 : 0.65) ? 'wind' : 'storm'; // шторм минає (далеко — довше)
    })();
    const [a, b] = STATE_RANGE[nextState];
    this.target = a + this.rng() * (b - a);
    this.windDirTarget += rand(-1.2, 1.2);
    // іноді різкі зміни — «радіо шипить»
    if (nextState === 'storm' && chance(0.5)) this.holdTimer = rand(35, 60);
  }

  /** сила вітру 0..1 (трохи нижча за інтенсивність) */
  get wind(): number {
    return clamp(this.intensity * 0.9, 0, 1.5);
  }

  /** справжній вітер біля гравця, м/с (дзеркало trueWindSpeed у sails) */
  get windMs(): number {
    return 1.5 + this.wind * 19;
  }
  get beaufort() {
    return beaufort(this.windMs);
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
    return Math.round(this.base * 100);
  }

  /** кооп-клієнт: стан погоди від капітана */
  applyNet(intensity: number, target: number, windDir: number, flash: number) {
    this.base = intensity;
    this.target = target;
    this.windDir = windDir;
    this.flash = Math.max(this.flash, flash);
    this.holdTimer = 1e9;
  }

  /** кооп-клієнт: лише згасання спалаху (решта — від капітана) */
  updatePassive(dt: number) {
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  restore(v: number) {
    this.base = v / 100;
    this.target = this.base;
  }
}
