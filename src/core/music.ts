// ─────────────────────────────────────────────────────────────
// Генеративна музика (WebAudio, без файлів): м'які пади на акордах,
// рідкісні «щипки» з луною й тихий бас. Настрій іде за світом:
// вдень — світлий мажор, у сутінках і вночі — тихіше й нижче,
// у шторм музика майже стихає, лишається гул.
// ─────────────────────────────────────────────────────────────

/** MIDI → Гц */
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Chord {
  /** ноти паду (MIDI) */
  pad: number[];
  /** бас (MIDI) */
  root: number;
  /** ноти для мелодії (пентатоніка над акордом) */
  scale: number[];
}

// день: D-лідійський, теплий і «дорожній»
const DAY: Chord[] = [
  { pad: [62, 66, 69, 73, 76], root: 38, scale: [74, 76, 78, 81, 83, 86, 88] }, // Dmaj9
  { pad: [59, 62, 66, 69, 73], root: 35, scale: [71, 74, 76, 78, 81, 83, 86] }, // Bm9
  { pad: [55, 59, 62, 66, 69], root: 31, scale: [74, 76, 79, 81, 83, 86, 88] }, // Gmaj9
  { pad: [57, 61, 64, 66, 71], root: 33, scale: [73, 76, 78, 81, 83, 85, 88] }, // A6/9
];
// вечір / ніч: м'який мінор, нижче й повільніше
const NIGHT: Chord[] = [
  { pad: [57, 60, 64, 67, 71], root: 33, scale: [69, 72, 74, 76, 79, 81] }, // Am9
  { pad: [53, 57, 60, 64, 67], root: 29, scale: [69, 72, 74, 76, 77, 81] }, // Fmaj9
  { pad: [55, 60, 64, 67, 71], root: 36, scale: [67, 69, 72, 74, 76, 79] }, // Cmaj7/G
  { pad: [52, 55, 59, 62, 66], root: 28, scale: [66, 69, 71, 74, 76, 78] }, // Em9
];

export interface MusicMood {
  /** 0 день … 1 ніч */
  night: number;
  /** 0 тиша … 1 шторм */
  storm: number;
  /** заставка — музика на першому плані */
  intro: boolean;
}

export class Music {
  private out: GainNode;
  private padBus: GainNode;
  private padFilter: BiquadFilterNode;
  private pluckBus: GainNode;
  private delay: DelayNode;
  private reverb: ConvolverNode;
  private on = true;
  private nextBar = 0;
  private bar = 0;
  private chordIdx = 0;
  private melody = 3;
  private mood: MusicMood = { night: 0, storm: 0, intro: true };

  private readonly beat = 60 / 68;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);

    // реверб: згенерований імпульс (стерео шум, що згасає ~3.5 с)
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.out);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1400;
    this.padFilter.Q.value = 0.4;
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.5;
    this.padBus.connect(this.padFilter);
    this.padFilter.connect(this.out);
    this.padFilter.connect(this.reverb);

    // щипки: сухий + луна (пунктирна вісімка) + реверб
    this.pluckBus = ctx.createGain();
    this.pluckBus.gain.value = 0.5;
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = this.beat * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dlf = ctx.createBiquadFilter();
    dlf.type = 'lowpass';
    dlf.frequency.value = 2200;
    this.pluckBus.connect(this.out);
    this.pluckBus.connect(this.delay);
    this.delay.connect(dlf).connect(fb).connect(this.delay);
    dlf.connect(this.out);
    this.pluckBus.connect(this.reverb);
    dlf.connect(this.reverb);
  }

  setOn(on: boolean) {
    this.on = on;
  }

  /** кожен кадр: настрій + планування нот наперед */
  update(mood: MusicMood, ahead = 1.5) {
    this.mood = mood;
    const t = this.ctx.currentTime;
    if (this.ctx.state !== 'running') return;
    // гучність: заставка голосніше, шторм майже глушить
    const vol = !this.on ? 0 : (mood.intro ? 0.34 : 0.22) * (1 - mood.storm * 0.75) * (1 - mood.night * 0.25);
    this.out.gain.setTargetAtTime(vol, t, 1.5);
    this.padFilter.frequency.setTargetAtTime(1500 - mood.night * 700 - mood.storm * 600, t, 2);
    if (this.nextBar < t) this.nextBar = t + 0.1;
    // плануємо на 1.5 с уперед
    while (this.nextBar < t + ahead) {
      this.scheduleBar(this.nextBar);
      this.nextBar += this.beat * 4 * (1 + mood.night * 0.15);
      this.bar++;
    }
  }

  private scheduleBar(t0: number) {
    const m = this.mood;
    const prog = m.night > 0.5 ? NIGHT : DAY;
    const barLen = this.beat * 4 * (1 + m.night * 0.15);
    // акорд — кожні 2 такти
    if (this.bar % 2 === 0) {
      this.chordIdx = (this.chordIdx + 1) % prog.length;
      const ch = prog[this.chordIdx];
      const dur = barLen * 2;
      for (const n of ch.pad) this.pad(hz(n), t0, dur, 0.05);
      if (m.storm < 0.7) this.bass(hz(ch.root), t0, dur * 0.9, 0.16);
    }
    const ch = prog[this.chordIdx];
    if (m.storm > 0.85) return;
    // мелодія: вісімки з імовірністю, випадкове блукання по ладу
    const p = (m.intro ? 0.3 : 0.2) * (1 - m.night * 0.45) * (1 - m.storm);
    const step = barLen / 8;
    for (let i = 0; i < 8; i++) {
      // сильні долі частіше
      const pi = p * (i % 4 === 0 ? 1.6 : i % 2 === 0 ? 1 : 0.6);
      if (Math.random() > pi) continue;
      this.melody = Math.max(0, Math.min(ch.scale.length - 1, this.melody + Math.round((Math.random() - 0.5) * 3.2)));
      const note = ch.scale[this.melody];
      this.pluck(hz(note), Math.max(this.ctx.currentTime, t0 + i * step + (Math.random() - 0.5) * 0.02), 0.07 + Math.random() * 0.04);
    }
  }

  private pad(f: number, t0: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + Math.min(2.5, dur * 0.35));
    g.gain.setValueAtTime(vol, t0 + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t0 + dur + 2.5);
    g.connect(this.padBus);
    for (const [type, det] of [['triangle', -7], ['sine', 6]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(g);
      o.start(t0);
      o.stop(t0 + dur + 2.6);
    }
  }

  private bass(f: number, t0: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.6);
    g.gain.setTargetAtTime(0, t0 + dur * 0.6, dur * 0.25);
    o.connect(g).connect(this.out);
    o.start(t0);
    o.stop(t0 + dur + 1);
  }

  private pluck(f: number, t0: number, vol: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 6, t0);
    lp.frequency.exponentialRampToValueAtTime(f * 1.5, t0 + 0.5);
    g.connect(lp).connect(this.pluckBus);
    // м'який дзвіночок: основний тон + тиха октава
    for (const [mul, type, v] of [[1, 'triangle', 1], [2, 'sine', 0.25]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      const og = ctx.createGain();
      og.gain.value = v;
      o.connect(og).connect(g);
      o.start(t0);
      o.stop(t0 + 1.5);
    }
  }
}
