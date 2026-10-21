import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Час доби. Базова доба = 600 с реального часу (10 хв); множник scale
// (темп гри, game/pace.ts dayScale) робить її довшою — за замовчуванням 20 хв.
// Сонце: сходять 6:00, заходять 18:00.
// ─────────────────────────────────────────────────────────────

export const DAY_SECONDS = 600; // реальних секунд на базову добу (без множника темпу)

// Палітра «теплої листівки»: м'який пастельний день, довга золота година,
// фіолетово-рожеві сутінки й синя (не чорна) місячна ніч.
const C = (x: number) => new THREE.Color(x);
const DAY_NIGHT = [
  // [год, колір неба (горизонт), колір неба (зеніт), колір туману, сила сонця]
  // стилізація в дусі Sea of Thieves: насичений синій зеніт, бірюзово-теплий обрій,
  // соковиті рожево-помаранчеві заходи й фіолетова (не чорна) ніч
  { h: 0.0, horizon: C(0x23306a), zenith: C(0x090e2e), fog: C(0x1c2858), sun: 0.0 },
  { h: 4.3, horizon: C(0x23306a), zenith: C(0x090e2e), fog: C(0x1c2858), sun: 0.0 },
  { h: 5.2, horizon: C(0x9a66a8), zenith: C(0x2a2e72), fog: C(0x765c96), sun: 0.1 },
  { h: 6.0, horizon: C(0xff9468), zenith: C(0x4660b2), fog: C(0xee9c80), sun: 0.35 },
  { h: 7.0, horizon: C(0xffcc90), zenith: C(0x4f88d8), fog: C(0xf2c8a2), sun: 0.75 },
  { h: 8.5, horizon: C(0xb4e2ea), zenith: C(0x2c7ad8), fog: C(0xc2e0e6), sun: 1.0 },
  { h: 12.0, horizon: C(0xaee0ea), zenith: C(0x2470d4), fog: C(0xbcdee6), sun: 1.0 },
  { h: 16.0, horizon: C(0xc4e2dc), zenith: C(0x2f78d2), fog: C(0xcadfd8), sun: 1.0 },
  { h: 17.3, horizon: C(0xffc078), zenith: C(0x4a7ccc), fog: C(0xf4c690), sun: 0.85 },
  { h: 18.3, horizon: C(0xff7c46), zenith: C(0x4a4aa6), fog: C(0xec8c66), sun: 0.5 },
  { h: 19.1, horizon: C(0xe25c8c), zenith: C(0x2e2a76), fog: C(0xb0608a), sun: 0.15 },
  { h: 20.0, horizon: C(0x4c3a86), zenith: C(0x131848), fog: C(0x3c3672), sun: 0.0 },
  { h: 21.0, horizon: C(0x23306a), zenith: C(0x090e2e), fog: C(0x1c2858), sun: 0.0 },
  { h: 24.0, horizon: C(0x23306a), zenith: C(0x090e2e), fog: C(0x1c2858), sun: 0.0 },
];

export class TimeCycle {
  /** безперервні години 0..24 */
  hours = 8.0;
  dayCount = 1;
  /** 0..1 — 1 вдень, 0 вночі (плавний) */
  daylight = 1;
  sunDir = new THREE.Vector3(0.4, 0.8, 0.25).normalize();
  skyHorizon = new THREE.Color(0xbcd8e6);
  skyZenith = new THREE.Color(0x4a90d0);
  fogColor = new THREE.Color(0xbcd8e6);
  sunStrength = 1;
  isNight = false;

  /** у скільки разів доба довша за базову (ставить main із темпу гри) */
  scale = 1;

  /** реальних секунд на поточну добу */
  get daySeconds(): number {
    return DAY_SECONDS * this.scale;
  }

  constructor(startHours = 8.0) {
    this.hours = startHours;
    this.recalc();
  }

  update(dt: number, speed = 1) {
    const dh = (dt / this.daySeconds) * 24 * speed;
    this.hours += dh;
    if (this.hours >= 24) {
      this.hours -= 24;
      this.dayCount++;
    }
    this.recalc();
  }

  private recalc() {
    // сонце: 6:00 — горизонт, 12:00 — зеніт, 18:00 — горизонт
    const a = ((this.hours - 6) / 12) * Math.PI;
    const elev = Math.sin(a);
    const azim = Math.cos(a); // + вдень
    // напрямок: схід (+X) → південь (верх) → захід (−X), трохи на південь (−Z)
    this.sunDir.set(azim, Math.max(elev, -0.45), -0.35).normalize();
    this.isNight = elev < 0.02;
    // daylight 0..1 плавний (схід/захід ~1 год)
    this.daylight = THREE.MathUtils.smoothstep(elev, -0.08, 0.18);

    // інтерполяція палітри
    let i = 0;
    while (i < DAY_NIGHT.length - 2 && DAY_NIGHT[i + 1].h < this.hours) i++;
    const p0 = DAY_NIGHT[i];
    const p1 = DAY_NIGHT[i + 1];
    const t = THREE.MathUtils.clamp((this.hours - p0.h) / (p1.h - p0.h || 1), 0, 1);
    this.skyHorizon.copy(p0.horizon).lerp(p1.horizon, t);
    this.skyZenith.copy(p0.zenith).lerp(p1.zenith, t);
    this.fogColor.copy(p0.fog).lerp(p1.fog, t);
    this.sunStrength = THREE.MathUtils.lerp(p0.sun, p1.sun, t);
  }

  /** сон до світанку: повертає години, що минули */
  sleepToDawn(): number {
    let delta = (6 - this.hours + 24) % 24;
    if (delta < 0.01) delta = 24; // вже світанок — спимо цілу добу
    const days = this.hours + delta >= 24 ? 1 : 0;
    this.hours = (this.hours + delta) % 24;
    this.dayCount += days;
    this.recalc();
    return delta;
  }

  /** години дня (для свіжості тощо) */
  gameHourDelta(dt: number): number {
    return (dt / this.daySeconds) * 24;
  }
}
