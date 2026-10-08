import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Час доби. 1 доба = 600 с реального часу (10 хв).
// Сонце: сходять 6:00, заходять 18:00.
// ─────────────────────────────────────────────────────────────

export const DAY_SECONDS = 600; // реальних секунд на добу

const DAY_NIGHT = [
  // [год, колір неба (горизонт), колір неба (зеніт), колір туману, сила сонця]
  { h: 0.0, horizon: new THREE.Color(0x0a1030), zenith: new THREE.Color(0x050818), fog: new THREE.Color(0x0a1030), sun: 0.0 },
  { h: 4.5, horizon: new THREE.Color(0x0a1030), zenith: new THREE.Color(0x050818), fog: new THREE.Color(0x0a1030), sun: 0.0 },
  { h: 5.5, horizon: new THREE.Color(0xff9a5a), zenith: new THREE.Color(0x2a3a6a), fog: new THREE.Color(0xd98a5a), sun: 0.25 },
  { h: 6.5, horizon: new THREE.Color(0xffc46a), zenith: new THREE.Color(0x5a8ac0), fog: new THREE.Color(0xe8b488), sun: 0.7 },
  { h: 8.0, horizon: new THREE.Color(0xbcd8e6), zenith: new THREE.Color(0x4a90d0), fog: new THREE.Color(0xbcd8e6), sun: 1.0 },
  { h: 12.0, horizon: new THREE.Color(0xc2dcea), zenith: new THREE.Color(0x3a86c8), fog: new THREE.Color(0xbcd8e6), sun: 1.0 },
  { h: 16.5, horizon: new THREE.Color(0xbcd8e6), zenith: new THREE.Color(0x4a90d0), fog: new THREE.Color(0xbcd8e6), sun: 1.0 },
  { h: 18.0, horizon: new THREE.Color(0xffa050), zenith: new THREE.Color(0x5468a8), fog: new THREE.Color(0xe89a60), sun: 0.55 },
  { h: 19.0, horizon: new THREE.Color(0xd86a8a), zenith: new THREE.Color(0x2a2a5a), fog: new THREE.Color(0xa06a80), sun: 0.2 },
  { h: 20.0, horizon: new THREE.Color(0x2a2a55), zenith: new THREE.Color(0x0a0a28), fog: new THREE.Color(0x2a2a55), sun: 0.0 },
  { h: 24.0, horizon: new THREE.Color(0x0a1030), zenith: new THREE.Color(0x050818), fog: new THREE.Color(0x0a1030), sun: 0.0 },
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
