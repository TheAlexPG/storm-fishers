// ─────────────────────────────────────────────────────────────
// Дрібні звуки моря, що роблять яхту живою (синтез, без файлів):
// ляскання парусів у мертвому куті, свист вітру в такелажі,
// рипіння корпусу на крені, плескіт біля борту, чайки біля порту.
// ─────────────────────────────────────────────────────────────

export interface SeaState {
  /** паруси підняті 0..1 */
  hoist: number;
  /** полощуть (мертвий кут) */
  luffing: boolean;
  /** вимпельний вітер, м/с */
  aws: number;
  /** кутова швидкість крену/тангажу, рад/с */
  rock: number;
  /** швидкість човна, м/с */
  speed: number;
  /** близько до порту й день — чайки */
  gulls: number;
  /** гравець під дахом — приглушити зовнішнє */
  sheltered: boolean;
}

export class SeaSounds {
  private flapGain: GainNode;
  private flapLfo: OscillatorNode;
  private whistleGain: GainNode;
  private whistleF: BiquadFilterNode;
  private noise: AudioBuffer;
  private creakCd = 2;
  private lapT = 1;
  private gullT = 4;

  constructor(private ctx: AudioContext, private out: AudioNode) {
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // ляскання: шум у смузі ~250 Гц, амплітуда тремтить LFO ~6 Гц
    const flapSrc = this.loop(0.8);
    const flapF = ctx.createBiquadFilter();
    flapF.type = 'bandpass';
    flapF.frequency.value = 260;
    flapF.Q.value = 0.8;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    this.flapLfo = ctx.createOscillator();
    this.flapLfo.type = 'square';
    this.flapLfo.frequency.value = 6;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.5;
    this.flapLfo.connect(lfoAmt).connect(trem.gain);
    this.flapLfo.start();
    this.flapGain = ctx.createGain();
    this.flapGain.gain.value = 0;
    flapSrc.connect(flapF).connect(trem).connect(this.flapGain).connect(out);

    // свист у вантах: вузька смуга шуму, висота росте з вітром
    const wSrc = this.loop(1.3);
    this.whistleF = ctx.createBiquadFilter();
    this.whistleF.type = 'bandpass';
    this.whistleF.frequency.value = 900;
    this.whistleF.Q.value = 14;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    wSrc.connect(this.whistleF).connect(this.whistleGain).connect(out);
  }

  private loop(rate: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  update(dt: number, st: SeaState) {
    const t = this.ctx.currentTime;
    const shelter = st.sheltered ? 0.35 : 1;
    const flap = st.luffing ? st.hoist * Math.min(1, st.aws / 8) * 0.22 : 0;
    this.flapGain.gain.setTargetAtTime(flap * shelter, t, 0.25);
    this.flapLfo.frequency.setTargetAtTime(4 + Math.min(6, st.aws * 0.4), t, 0.5);
    const wh = Math.max(0, (st.aws - 6) / 14);
    this.whistleGain.gain.setTargetAtTime(Math.min(0.05, wh * 0.05) * shelter, t, 0.6);
    this.whistleF.frequency.setTargetAtTime(700 + st.aws * 45, t, 0.8);

    // рипіння: корпус різко хитнувся
    this.creakCd -= dt;
    if (st.rock > 0.22 && this.creakCd <= 0) {
      this.creakCd = 1.2 + Math.random() * 2.5;
      this.creak(Math.min(1, st.rock / 0.6) * (st.sheltered ? 1.3 : 0.7));
    }
    // плескіт біля борту — коли човен майже стоїть
    this.lapT -= dt;
    if (this.lapT <= 0) {
      this.lapT = 1.2 + Math.random() * 2.2;
      if (st.speed < 2) this.lap(0.5 + Math.random() * 0.5);
    }
    // чайки
    this.gullT -= dt;
    if (this.gullT <= 0) {
      this.gullT = 5 + Math.random() * 14;
      if (Math.random() < st.gulls) this.gull(st.sheltered ? 0.4 : 1);
    }
  }

  private creak(power: number) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 70 + Math.random() * 60;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (1.25 + Math.random() * 0.4), t + 0.45);
    // «тертя» — швидке тремоло
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 28 + Math.random() * 20;
    const la = ctx.createGain();
    la.gain.value = 0.5;
    lfo.connect(la).connect(am.gain);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600 + Math.random() * 500;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * power, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(am).connect(bp).connect(g).connect(this.out);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.6);
    lfo.stop(t + 0.6);
  }

  private lap(power: number) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1100, t + 0.15);
    f.frequency.linearRampToValueAtTime(400, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07 * power, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random() * 1.2);
    s.stop(t + 0.75);
  }

  private gull(vol: number) {
    const ctx = this.ctx;
    // 2–4 спадних «кі-яу»
    const n = 2 + Math.floor(Math.random() * 3);
    const base = 1300 + Math.random() * 500;
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (0.28 + Math.random() * 0.12);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(base * 1.15, t);
      o.frequency.exponentialRampToValueAtTime(base * 0.62, t + 0.22);
      // носовий тембр: FM
      const m = ctx.createOscillator();
      m.frequency.value = base * 0.5;
      const mg = ctx.createGain();
      mg.gain.value = base * 0.35;
      m.connect(mg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035 * vol, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 700;
      o.connect(g).connect(hp).connect(this.out);
      o.start(t);
      m.start(t);
      o.stop(t + 0.3);
      m.stop(t + 0.3);
    }
  }
}
