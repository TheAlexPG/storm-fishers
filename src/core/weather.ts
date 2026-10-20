import { clamp, damp, rand, mulberry32 } from './math';
import type { WeatherState, WeatherSnapshot } from './types';

// ─────────────────────────────────────────────────────────────
// Погода: Тиша → Повіє → Вітер → Шторм — довгими фазами, щоб встигнути
// вийти в море й відчути шторм (реальні хвилини; доба = 10 хв):
//   ясно 8–14 хв (тиша/легкий бриз, міняються раз на 2–4 хв)
//   → фронт 2,5–4 хв (вітер наростає; за ~4 хв до нього — штормове попередження)
//   → шторм 5–8 хв (65 %) або просто вітряно 4–7 хв
//   → стихає 2,5–3,5 хв → знову ясно.
// Сила погоди тягнеться до цілі повільно (~40 с), тож шторм наростає хвилинами.
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
  /** секунд до наступного кроку погоди (тести «заморожують» великим числом) */
  private holdTimer = 0;
  /** фаза погодного циклу і скільки їй лишилось (реальні секунди) */
  phase: 'fair' | 'front' | 'storm' | 'windy' | 'ease' = 'fair';
  private phaseLeft = 0;
  /** наступний фронт принесе шторм (відомо заздалегідь — для прогнозу й ботів) */
  private nextStorm = true;
  private rng: () => number;
  flash = 0;
  /** між блискавками */
  private nextLightning = 6;
  onLightning: ((power: number) => void) | null = null;

  constructor(seed = Date.now() % 100000) {
    this.rng = mulberry32(seed);
    this.phaseLeft = rand(360, 600);
    this.nextStorm = this.rng() < 0.65;
  }

  update(dt: number) {
    if (this.holdTimer < 1e8) {
      this.holdTimer -= dt;
      this.phaseLeft -= dt;
      if (this.phaseLeft <= 0) this.nextPhase();
      else if (this.holdTimer <= 0) this.wobble();
    }
    // плавний перехід (стала ~40 с: шторм наростає хвилинами, а не стрибком)
    this.base = damp(this.base, this.target, 0.025, dt);
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

  /**
   * Пропуск часу (сон): цикл погоди проходить стільки ж реальних секунд, скільки
   * відповідає пропущеним ігровим годинам — фази змінюються, сила й напрям вітру
   * встигають дійти до нових цілей. Без блискавок/звуків. Кооп-гість і заморожені
   * тести (holdTimer ≥ 1e8) не рахують — погоду їм дає капітан.
   */
  advance(sec: number) {
    if (this.holdTimer >= 1e8 || !(sec > 0)) return;
    let left = sec;
    while (left > 0) {
      const step = Math.min(left, 2);
      this.holdTimer -= step;
      this.phaseLeft -= step;
      if (this.phaseLeft <= 0) this.nextPhase();
      else if (this.holdTimer <= 0) this.wobble();
      this.base = damp(this.base, this.target, 0.025, step);
      this.windDir = damp(this.windDir, this.windDirTarget, 0.08, step);
      left -= step;
    }
    this.flash = 0;
    this.nextLightning = rand(4, 14);
  }

  /** наступна фаза циклу */
  private nextPhase() {
    const far = this.localMul > 1.15;
    switch (this.phase) {
      case 'fair':
        this.phase = 'front';
        this.phaseLeft = rand(150, 240);
        break;
      case 'front':
        this.phase = this.nextStorm ? 'storm' : 'windy';
        // далеко в морі шторм тримається довше
        this.phaseLeft = this.nextStorm ? rand(300, 480) * (far ? 1.15 : 1) : rand(240, 420);
        break;
      case 'storm':
      case 'windy':
        this.phase = 'ease';
        this.phaseLeft = rand(150, 210);
        break;
      default:
        this.phase = 'fair';
        this.phaseLeft = rand(480, 840);
        this.nextStorm = this.rng() < (far ? 0.75 : 0.65);
    }
    this.windDirTarget += rand(-1.2, 1.2);
    this.wobble();
  }

  /** ціль у межах фази; дрібні зміни раз на кілька хвилин */
  private wobble() {
    const pick = (st: WeatherState, lo = 0, hi = 1) => {
      const [a, b] = STATE_RANGE[st];
      return a + (b - a) * (lo + (hi - lo) * this.rng());
    };
    switch (this.phase) {
      case 'fair':
        this.target = this.rng() < 0.4 ? pick('calm', 0.3) : pick('breeze', 0, 0.75);
        this.holdTimer = rand(120, 240);
        break;
      case 'front':
        this.target = pick('wind', 0.2, 0.9);
        this.holdTimer = 1e3;
        break;
      case 'storm':
        this.target = pick('storm', 0.15, 0.85);
        this.holdTimer = rand(90, 150);
        this.windDirTarget += rand(-0.4, 0.4);
        break;
      case 'windy':
        this.target = pick('wind', 0.1, 1);
        this.holdTimer = rand(100, 160);
        break;
      case 'ease':
        this.target = pick('breeze', 0.3, 1);
        this.holdTimer = 1e3;
        break;
    }
  }

  /** очікувана сила погоди найближчим часом (прогноз по радіо, рішення ботів) */
  get forecast(): number {
    if (this.holdTimer >= 1e8) return this.target; // кооп-гість / тест: ціль від капітана
    const peak = this.nextStorm ? 0.86 : 0.6;
    switch (this.phase) {
      case 'fair':
        return this.phaseLeft < 240 ? peak : this.target;
      case 'front':
        return peak;
      case 'storm':
      case 'windy':
        return this.phaseLeft < 150 ? 0.35 : Math.max(this.target, this.phase === 'storm' ? 0.8 : 0.5);
      default:
        return this.target;
    }
  }

  /** через скільки реальних секунд почнеться шторм (null — не очікується найближчим часом) */
  get stormEta(): number | null {
    if (this.holdTimer >= 1e8) return this.netEta;
    if (!this.nextStorm) return null;
    if (this.phase === 'fair' && this.phaseLeft < 300) return this.phaseLeft + 150;
    if (this.phase === 'front') return Math.max(0, this.phaseLeft);
    return null;
  }
  /** кооп-гість: прогноз від капітана */
  private netEta: number | null = null;

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
      forecast: this.forecast,
    };
  }

  serialize(): number {
    return Math.round(this.base * 100);
  }

  /** кооп-клієнт: стан погоди від капітана */
  applyNet(intensity: number, target: number, windDir: number, flash: number, eta?: number) {
    this.base = intensity;
    this.target = target;
    this.netEta = eta == null || eta < 0 ? null : eta;
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
    // фаза за силою: після сейву в шторм — шторм ще потриває
    const st = stateFromIntensity(this.base);
    this.phase = st === 'storm' ? 'storm' : st === 'wind' ? 'windy' : 'fair';
    this.phaseLeft = st === 'storm' ? rand(180, 300) : st === 'wind' ? rand(120, 240) : rand(300, 600);
    this.nextStorm = this.rng() < 0.65;
    this.wobble();
    this.target = this.base;
  }
}
