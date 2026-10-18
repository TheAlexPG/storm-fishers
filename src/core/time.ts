import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Час доби. 1 доба = 600 с реального часу (10 хв).
// Сонце: сходять 6:00, заходять 18:00.
// ─────────────────────────────────────────────────────────────

export const DAY_SECONDS = 600; // реальних секунд на добу

// Палітра «теплої листівки»: м'який пастельний день, довга золота година,
// фіолетово-рожеві сутінки й синя (не чорна) місячна ніч.
const C = (x: number) => new THREE.Color(x);
const DAY_NIGHT = [
  // [год, колір неба (горизонт), колір неба (зеніт), колір туману, сила сонця]
  { h: 0.0, horizon: C(0x1d2c52), zenith: C(0x0a1230), fog: C(0x18264a), sun: 0.0 },
  { h: 4.3, horizon: C(0x1d2c52), zenith: C(0x0a1230), fog: C(0x18264a), sun: 0.0 },
  { h: 5.2, horizon: C(0x8a6a9a), zenith: C(0x2a3468), fog: C(0x6a5a86), sun: 0.1 },
  { h: 6.0, horizon: C(0xffa86e), zenith: C(0x4a6aa8), fog: C(0xe8a07a), sun: 0.35 },
  { h: 7.0, horizon: C(0xffd29a), zenith: C(0x6a9ad0), fog: C(0xf0c8a0), sun: 0.75 },
  { h: 8.5, horizon: C(0xd4e6ea), zenith: C(0x5a9ed8), fog: C(0xcfe0e6), sun: 1.0 },
  { h: 12.0, horizon: C(0xd8eaee), zenith: C(0x4a94d4), fog: C(0xd0e2e8), sun: 1.0 },
  { h: 16.0, horizon: C(0xe2e4d8), zenith: C(0x5596d0), fog: C(0xdcdcd0), sun: 1.0 },
  { h: 17.3, horizon: C(0xffcf8a), zenith: C(0x6a8cc4), fog: C(0xf2c890), sun: 0.85 },
  { h: 18.3, horizon: C(0xff9a5e), zenith: C(0x5a62a6), fog: C(0xe8946a), sun: 0.5 },
  { h: 19.1, horizon: C(0xd8708e), zenith: C(0x33316a), fog: C(0xa86a86), sun: 0.15 },
  { h: 20.0, horizon: C(0x4a3e74), zenith: C(0x141a40), fog: C(0x3a3866), sun: 0.0 },
  { h: 21.0, horizon: C(0x1d2c52), zenith: C(0x0a1230), fog: C(0x18264a), sun: 0.0 },
  { h: 24.0, horizon: C(0x1d2c52), zenith: C(0x0a1230), fog: C(0x18264a), sun: 0.0 },
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

  constructor(startHours = 8.0) {
    this.hours = startHours;
    this.recalc();
  }

  update(dt: number, speed = 1) {
    const dh = (dt / DAY_SECONDS) * 24 * speed;
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
    return (dt / DAY_SECONDS) * 24;
  }
}
