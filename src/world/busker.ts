import type * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Вуличний гітарист Сонячної Марини: тиха боса-нова з перебору (WebAudio,
// без файлів). Звучить лише поруч — до ~26 м, плавно стихає з відстанню
// й поступається штормові. Ноти плануються наперед, як у Music.
// ─────────────────────────────────────────────────────────────

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
// Gmaj7 — Em7 — Am7 — D7: акорд (MIDI) на такт
const CHORDS: number[][] = [
  [43, 55, 59, 62, 66],
  [40, 55, 59, 62, 64],
  [45, 55, 60, 64, 67],
  [38, 54, 57, 60, 64],
];
// перебір: бас на 1 і 3, верхні голоси — синкопою
const PATTERN: Array<[number, number]> = [
  [0, 0], [0.5, 2], [1, 3], [1.5, 4], [2, 1], [2.75, 3], [3, 2], [3.5, 4],
];

export class Busker {
  private out: GainNode | null = null;
  private nextBar = 0;
  private bar = 0;
  private level = 0;
  private readonly beat = 60 / 92;

  constructor(private sfx: () => { ctx: AudioContext; out: AudioNode } | null) {}

  /** кожен кадр: де гітарист, де слухач, наскільки бурхливо */
  update(src: THREE.Vector3 | null, ear: THREE.Vector3, storm: number) {
    const d = src ? Math.hypot(src.x - ear.x, src.y - ear.y, src.z - ear.z) : 1e9;
    const want = d > 26 ? 0 : Math.pow(1 - d / 26, 1.6) * (1 - storm);
    if (want <= 0.001 && this.level <= 0.001) return;
    const a = this.sfx();
    if (!a || a.ctx.state !== 'running') return;
    const ctx = a.ctx;
    if (!this.out) {
      this.out = ctx.createGain();
      this.out.gain.value = 0;
      this.out.connect(a.out);
    }
    this.level = want;
    const t = ctx.currentTime;
    this.out.gain.setTargetAtTime(want * 0.16, t, 0.4);
    if (want <= 0.001) return;
    if (this.nextBar < t) this.nextBar = t + 0.05;
    while (this.nextBar < t + 0.6) {
      const ch = CHORDS[this.bar % CHORDS.length];
      for (const [b, i] of PATTERN) this.pluck(hz(ch[i]), this.nextBar + b * this.beat + Math.random() * 0.012, i === 0 ? 0.32 : 0.16);
      this.nextBar += this.beat * 4;
      this.bar++;
    }
  }

  /** м'який нейлон: трикутник + тиха октава, швидка атака, довге згасання */
  private pluck(f: number, t0: number, vol: number) {
    const a = this.sfx();
    if (!a || !this.out) return;
    const ctx = a.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 5, t0);
    lp.frequency.exponentialRampToValueAtTime(f * 1.4, t0 + 0.4);
    g.connect(lp).connect(this.out);
    for (const [mul, type, v] of [[1, 'triangle', 1], [2, 'sine', 0.18]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      const og = ctx.createGain();
      og.gain.value = v;
      o.connect(og).connect(g);
      o.start(t0);
      o.stop(t0 + 1.7);
    }
  }
}
