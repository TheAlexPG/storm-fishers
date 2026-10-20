// ─────────────────────────────────────────────────────────────
// Звук радіо в каюті (WebAudio, без файлів): «AM»-тракт (смуга 280–3200 Гц),
// шипіння ефіру між станціями, «голос диктора» (склади з формантами
// голосних), перемовини на 16-му каналі з клацанням шумодава і дві
// музичні станції, що грають «наживо» (крок рахується від часу, тож
// повернувшись на станцію, потрапляєш у середину пісні, а не на початок).
// ─────────────────────────────────────────────────────────────

export type RadioContent = 'none' | 'voice' | 'chat' | 'music';

export interface RadioAudioState {
  /** чи чути взагалі (у салоні 1, на палубі тихо) */
  audible: number;
  on: boolean;
  /** сила сигналу станції 0..1 (між станціями — 0) */
  signal: number;
  /** ручку саме крутять — сплеск шипіння */
  sweep: number;
  content: RadioContent;
  /** музичний стиль станції */
  style: number;
  /** гучність ручки 0..1 */
  volume: number;
}

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// голосні: дві форманти (Гц) — «мова» крізь ефір
const VOWELS: Array<[number, number]> = [[800, 1200], [500, 900], [480, 1750], [320, 2250], [360, 820], [650, 1550]];

interface Style {
  bpm: number;
  /** кроків у такті */
  steps: number;
  /** акорди: корінь (MIDI) + інтервали */
  chords: Array<[number, number[]]>;
  /** мелодія: на кожен крок ступінь (індекс у ладу) або -1 */
  melody: number[];
  scale: number[];
}

const STYLES: Style[] = [
  // 0 — «Хвиля FM»: моряцька пісня 6/8, акордеон «ум-па-па»
  {
    bpm: 132,
    steps: 6,
    chords: [[50, [0, 3, 7]], [53, [0, 4, 7]], [48, [0, 4, 7]], [45, [0, 4, 7]], [50, [0, 3, 7]], [55, [0, 3, 7]], [45, [0, 4, 7]], [50, [0, 3, 7]]],
    melody: [
      4, -1, 5, 6, -1, 4, 3, -1, 2, 3, -1, 4, 2, -1, 1, 0, -1, 1, 2, -1, -1, -1, -1, -1,
      4, -1, 5, 6, -1, 7, 8, -1, 7, 6, -1, 5, 4, -1, 2, 3, -1, 1, 0, -1, -1, -1, -1, -1,
    ],
    scale: [62, 64, 65, 67, 69, 70, 72, 74, 76],
  },
  // 1 — «Нічний бриз»: повільний лаунж, м'які септакорди
  {
    bpm: 76,
    steps: 4,
    chords: [[48, [0, 4, 7, 11]], [45, [0, 3, 7, 10]], [50, [0, 3, 7, 10]], [43, [0, 4, 7, 10]]],
    melody: [4, -1, 3, 2, -1, -1, 4, 5, 7, -1, 6, 4, -1, -1, -1, -1],
    scale: [60, 62, 64, 67, 69, 72, 74, 76],
  },
];

export class RadioAudio {
  private out: GainNode;
  private content: GainNode;
  private staticGain: GainNode;
  readonly analyser: AnalyserNode;
  private bins: Uint8Array<ArrayBuffer>;
  private t0: number;
  private nextStep = -1;
  private lastStyle = -1;
  private sylT = 0;
  private chatT = 0;
  private chatOn = false;

  constructor(private ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    // AM-тракт: срізаємо низ і верх — звучить як маленький динамік
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 280;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    lp.Q.value = 0.9;
    this.content = ctx.createGain();
    this.content.gain.value = 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.7;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.content.connect(hp).connect(lp).connect(this.analyser).connect(this.out);
    // шипіння ефіру
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.5;
    this.staticGain = ctx.createGain();
    this.staticGain.gain.value = 0;
    src.connect(bp).connect(this.staticGain).connect(this.out);
    src.start();
    this.t0 = ctx.currentTime;
  }

  /** спектр того, що грає (0..255 на смугу) — для екрана радіо */
  spectrum(): Uint8Array {
    this.analyser.getByteFrequencyData(this.bins);
    return this.bins;
  }

  update(st: RadioAudioState, dt: number) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const live = st.on && st.audible > 0.01;
    this.out.gain.setTargetAtTime(live ? st.volume * st.audible * 0.9 : 0, now, 0.06);
    const sig = live ? st.signal : 0;
    this.content.gain.setTargetAtTime(sig * sig, now, 0.05);
    this.staticGain.gain.setTargetAtTime(live ? 0.02 + (1 - sig) * 0.12 + st.sweep * 0.1 : 0, now, 0.05);
    if (!live || sig < 0.05) {
      this.nextStep = -1;
      return;
    }
    if (st.content === 'music') this.music(st.style, now);
    else this.nextStep = -1;
    if (st.content === 'voice') this.voice(dt, now, 1);
    if (st.content === 'chat') this.chat(dt, now);
  }

  // ── музика: «прямий ефір» ──
  private music(styleIdx: number, now: number) {
    const s = STYLES[styleIdx] ?? STYLES[0];
    const stepDur = 60 / s.bpm / (s.steps === 6 ? 2 : 1);
    if (this.lastStyle !== styleIdx) {
      this.lastStyle = styleIdx;
      this.nextStep = -1;
    }
    if (this.nextStep < 0) this.nextStep = Math.ceil((now - this.t0) / stepDur);
    while (this.t0 + this.nextStep * stepDur < now + 0.25) {
      const k = this.nextStep++;
      const t = Math.max(now, this.t0 + k * stepDur);
      const barN = Math.floor(k / s.steps);
      const inBar = k % s.steps;
      const [root, iv] = s.chords[barN % s.chords.length];
      const m = s.melody[k % s.melody.length];
      if (styleIdx === 0) {
        // ум — бас; па-па — акорд акордеону
        if (inBar === 0 || inBar === 3) this.tone(hz(root - 12 + (inBar === 3 ? 7 : 0)), t, stepDur * 1.6, 0.22, 'triangle', 900);
        if (inBar === 1 || inBar === 2 || inBar === 4 || inBar === 5) for (const i of iv) this.reed(hz(root + 12 + i), t, stepDur * 0.7, 0.045);
        if (m >= 0) this.reed(hz(s.scale[m] ?? 62), t, stepDur * 1.8, 0.09);
      } else {
        if (inBar === 0) {
          this.tone(hz(root - 12), t, stepDur * 3.6, 0.2, 'sine', 600);
          for (const i of iv) this.keys(hz(root + 12 + i), t, stepDur * 3.8, 0.05);
        }
        if (inBar === 2) for (const i of iv) this.keys(hz(root + 12 + i), t, stepDur * 1.5, 0.03);
        if (m >= 0) this.keys(hz(s.scale[m] ?? 72), t + 0.02, stepDur * 2.2, 0.08);
        // щітки по малому барабану
        this.brush(t, inBar % 2 ? 0.05 : 0.025);
      }
    }
  }

  private tone(f: number, t: number, dur: number, vol: number, type: OscillatorType, cut: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cut;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.content);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** «акордеон»: два розлаштовані пилкоподібні язички з тремоло */
  private reed(f: number, t: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    lp.connect(g).connect(this.content);
    for (const d of [-4, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = d;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** «електропіаніно»: синус + тихий обертон, м'яка атака */
  private keys(f: number, t: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.content);
    for (const [m, a] of [[1, 1], [2, 0.25], [3.01, 0.08]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * m;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private noiseBuf: AudioBuffer | null = null;
  private brush(t: number, vol: number) {
    const ctx = this.ctx;
    if (!this.noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 0.2);
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = vol;
    s.connect(hp).connect(g).connect(this.content);
    s.start(t);
  }

  // ── голос: склади з формантами (не слова — «мова крізь ефір») ──
  private voice(dt: number, now: number, pitch: number) {
    this.sylT -= dt;
    if (this.sylT > 0) return;
    // пауза між «словами» і реченнями
    const r = Math.random();
    if (r < 0.16) {
      this.sylT = 0.18 + Math.random() * (r < 0.04 ? 0.7 : 0.12);
      return;
    }
    const dur = 0.07 + Math.random() * 0.11;
    this.sylT = dur * 0.92;
    this.syllable(now + 0.02, dur, (105 + Math.random() * 40) * pitch);
  }

  private syllable(t: number, dur: number, f0: number) {
    const ctx = this.ctx;
    const [f1, f2] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * (1 + (Math.random() - 0.5) * 0.15), t);
    o.frequency.linearRampToValueAtTime(f0 * (0.9 + Math.random() * 0.2), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [f, q, a] of [[f1, 6, 1], [f2, 8, 0.55]] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = a * 0.9;
      o.connect(bp).connect(fg).connect(g);
    }
    g.connect(this.content);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  // ── канал 16: уривки перемовин, між ними тиша і клацання шумодава ──
  private chat(dt: number, now: number) {
    this.chatT -= dt;
    if (this.chatT <= 0) {
      this.chatOn = !this.chatOn;
      this.chatT = this.chatOn ? 1.6 + Math.random() * 2.8 : 1.2 + Math.random() * 3.5;
      this.squelch(now + 0.01);
      // різні голоси — різна висота
      this.chatPitch = 0.85 + Math.random() * 0.5;
    }
    if (this.chatOn) this.voice(dt, now, this.chatPitch);
  }
  private chatPitch = 1;

  private squelch(t: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.content);
    o.start(t);
    o.stop(t + 0.06);
  }
}
