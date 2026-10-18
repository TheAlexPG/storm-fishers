// ─────────────────────────────────────────────────────────────
// Синтезований звук (WebAudio), без зовнішніх асетів.
// Мотор, вітер, дощ, хвилі, сплески, блискавка, UI, клювання.
// ─────────────────────────────────────────────────────────────

import { Music, type MusicMood } from './music';
import { SeaSounds, type SeaState } from './seaSounds';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  musicOn = true;
  /** загальна гучність 0..1 (з налаштувань) */
  volume = 0.8;
  private musicVol = 0.7;
  private music: Music | null = null;
  private sea: SeaSounds | null = null;

  // вузли "живих" звуків
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private waveGain: GainNode | null = null;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7 * this.volume;
      this.master.connect(ctx.destination);

      // спільний буфер шуму (2 с білого шуму)
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // вітер: низькопропускний шум
      const wind = ctx.createBufferSource();
      wind.buffer = buf;
      wind.loop = true;
      const windF = ctx.createBiquadFilter();
      windF.type = 'lowpass';
      windF.frequency.value = 420;
      windF.Q.value = 0.6;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      wind.connect(windF).connect(this.windGain).connect(this.master!);
      wind.start();

      // дощ: середній шум
      const rain = ctx.createBufferSource();
      rain.buffer = buf;
      rain.loop = true;
      rain.playbackRate.value = 1.4;
      const rainF = ctx.createBiquadFilter();
      rainF.type = 'bandpass';
      rainF.frequency.value = 3200;
      rainF.Q.value = 0.35;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      rain.connect(rainF).connect(this.rainGain).connect(this.master!);
      rain.start();

      // хвилі: дуже низький шум (набій)
      const wave = ctx.createBufferSource();
      wave.buffer = buf;
      wave.loop = true;
      wave.playbackRate.value = 0.5;
      const waveF = ctx.createBiquadFilter();
      waveF.type = 'lowpass';
      waveF.frequency.value = 160;
      this.waveGain = ctx.createGain();
      this.waveGain.gain.value = 0;
      wave.connect(waveF).connect(this.waveGain).connect(this.master!);
      wave.start();

      // мотор: 2 осцилятори (оберти + гармоніка)
      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 40;
      this.engineOsc2 = ctx.createOscillator();
      this.engineOsc2.type = 'square';
      this.engineOsc2.frequency.value = 20;
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 300;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      const e2g = ctx.createGain();
      e2g.gain.value = 0.4;
      this.engineOsc.connect(this.engineFilter);
      this.engineOsc2.connect(e2g).connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain).connect(this.master!);
      this.engineOsc.start();
      this.engineOsc2.start();
      this.music = new Music(ctx, this.master!);
      this.sea = new SeaSounds(ctx, this.master!);
      this.music.setOn(this.musicOn);
      this.music.level = this.musicVol;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  private noiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = this.ctx.sampleRate * 1.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** викликати після user gesture */
  resume() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.7 * this.volume, this.ctx.currentTime, 0.05);
    }
  }

  /** гучність з налаштувань: загальна й музики (0..1) */
  setLevels(volume: number, music: number) {
    this.volume = volume;
    this.musicVol = music;
    this.musicOn = music > 0.001;
    if (this.music) {
      this.music.level = music;
      this.music.setOn(this.musicOn);
    }
    this.setMuted(this.muted);
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    this.music?.setOn(on);
  }

  /** кожен кадр: дрібні звуки яхти й моря */
  updateSea(dt: number, st: SeaState) {
    if (this.ctx?.state === 'running') this.sea?.update(dt, st);
  }

  /** кожен кадр: настрій музики */
  updateMusic(mood: MusicMood) {
    this.music?.update(mood);
  }

  /** мотор: throttle 0..1, engineOn, load 0..1 */
  setEngine(throttle: number, on: boolean, load: number) {
    if (!this.ctx || !this.engineGain || !this.engineOsc || !this.engineOsc2 || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    if (!on || throttle <= 0.01) {
      this.engineGain.gain.setTargetAtTime(0, t, 0.15);
      return;
    }
    const f = 34 + throttle * 95 + load * 12;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.12);
    this.engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.12);
    this.engineFilter.frequency.setTargetAtTime(200 + throttle * 700, t, 0.12);
    this.engineGain.gain.setTargetAtTime(0.16 + throttle * 0.16, t, 0.1);
  }

  /** вітер/дощ/хвилі 0..1 */
  setAmbience(wind: number, rain: number, wave: number, nearWater: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain?.gain.setTargetAtTime(wind * 0.5 * (0.4 + 0.6 * nearWater), t, 0.3);
    this.rainGain?.gain.setTargetAtTime(rain * 0.35, t, 0.3);
    this.waveGain?.gain.setTargetAtTime(wave * 0.55 * (0.3 + 0.7 * nearWater), t, 0.5);
  }

  /** сплеск / об'єднання води (0..1 сила) */
  splash(power = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const buf = this.noiseBuffer();
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900 + power * 900;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.25 * power, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5 + power * 0.4);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 1.2);
  }

  /** гуркіт блискавки з затримкою */
  thunder(power = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const buf = this.noiseBuffer();
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 120;
    const g = ctx.createGain();
    const t = ctx.currentTime + 0.15 + Math.random() * 0.4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * power, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 2.6);
  }

  /** клювання! */
  bite() {
    this.beep(880, 0.07, 'sine', 0.3);
    setTimeout(() => this.beep(1180, 0.09, 'sine', 0.3), 90);
  }

  /** улов! */
  catchJingle() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => setTimeout(() => this.beep(n, 0.09, 'triangle', 0.28), i * 90));
  }

  /** відрив */
  snap() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const buf = this.noiseBuffer();
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2000;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.3);
    src.stop(t + 0.3);
  }

  click() {
    this.beep(660, 0.04, 'sine', 0.15);
  }

  private beep(freq: number, dur: number, type: OscillatorType, vol: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** крок: 0 — тик-дерево палуби, 1 — гулкі дошки причалу, 2 — бруківка/земля */
  step(surface: number, run: boolean) {
    const ctx = this.ensure();
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const vol = (run ? 0.09 : 0.06) * (0.8 + Math.random() * 0.4);
    // клацання: короткий шум через смугу
    const s = ctx.createBufferSource();
    s.buffer = this.stepBuf ??= (() => {
      const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      return b;
    })();
    s.playbackRate.value = 0.85 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = surface === 0 ? 1400 : surface === 1 ? 700 : 2400;
    f.Q.value = surface === 2 ? 0.6 : 1.4;
    const g = ctx.createGain();
    g.gain.value = vol * (surface === 2 ? 0.6 : 1);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    // дерево ще й «гуде» — низький тон дошки
    if (surface !== 2) {
      const o = ctx.createOscillator();
      o.frequency.value = (surface === 1 ? 110 : 190) * (0.9 + Math.random() * 0.2);
      const og = ctx.createGain();
      og.gain.setValueAtTime(vol * 0.8, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + (surface === 1 ? 0.16 : 0.08));
      o.connect(og).connect(this.master);
      o.start(t);
      o.stop(t + 0.2);
    }
  }
  private stepBuf: AudioBuffer | null = null;

  /** дзвін буя: негармонічні обертони, довге згасання */
  bell(vol: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master || vol <= 0.01) return;
    const t = ctx.currentTime;
    const f0 = 392;
    for (const [m, a, d] of [[1, 1, 4], [2.76, 0.5, 2.6], [5.4, 0.25, 1.6], [8.93, 0.12, 0.9], [0.5, 0.3, 5]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f0 * m;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12 * a * vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + d + 0.1);
    }
  }

  // радіо: шипіння ефіру (настройка — гучно, станція — тихий фон) + писк «морзе»
  private radioGain: GainNode | null = null;
  private radioT = 0;
  setRadio(on: boolean, tuning: number, voice: boolean, dt: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (!this.radioGain) {
      const buf = this.noiseBuffer();
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 0.7;
      this.radioGain = ctx.createGain();
      this.radioGain.gain.value = 0;
      src.connect(bp).connect(this.radioGain).connect(this.master);
      src.start();
    }
    const target = on ? 0.012 + tuning * 0.09 : 0;
    this.radioGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
    // «голос диктора» — короткі тональні сплески (ніби мова крізь ефір)
    if (on && voice && tuning < 0.2) {
      this.radioT -= dt;
      if (this.radioT <= 0) {
        this.radioT = 0.08 + Math.random() * 0.22;
        if (Math.random() < 0.75) this.beep(320 + Math.random() * 260, 0.07 + Math.random() * 0.08, 'triangle', 0.018);
      }
    }
  }

  /** дзвіночок на кінчику вудки: дрібне дзеленчання (клює на стійці) */
  tinkle(vol = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    for (let k = 0; k < 5; k++) {
      const t = t0 + k * 0.09 + Math.random() * 0.03;
      for (const [m, a] of [[1, 1], [2.4, 0.4], [4.1, 0.2]] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = 2350 * m * (1 + (Math.random() - 0.5) * 0.02);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05 * a * vol, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 0.4);
      }
    }
  }

  /** відкрито нове місце: тепле арпеджіо */
  discover() {
    const notes = [587, 740, 880, 1175];
    notes.forEach((n, i) => setTimeout(() => this.beep(n, 0.5, 'triangle', 0.12), i * 140));
  }

  /** стукіт об корпус (хвиля б'є) */
  thump(power: number) {
    this.beep(70 + power * 30, 0.12, 'sine', 0.22 * power);
  }
}
