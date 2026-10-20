import './kitchen.css';
import { L, getLang } from '../core/i18n';
import { formatMoney } from '../core/math';
import type { Input } from '../core/input';
import type { AudioEngine } from '../core/audio';
import type { GameState } from '../game/state';
import type { FishItem } from '../core/types';
import type { Galley } from '../world/galley';
import {
  BUFF_INFO, dishPrice, fishValue, MAX_DISHES, PANTRY, PANTRY_IDS, qualityStars, RECIPE_BY_ID, RECIPES, STEP_INFO,
  type CookStep, type PantryId, type Recipe, type Txt,
} from '../game/cooking';

// ─────────────────────────────────────────────────────────────
// Камбуз у грі: міні-гра чаю (налити воду → вогонь → свисток → налити,
// не розливши в качку → заварити → цукор/лимон → випити), міні-гра
// готування за рецептом (нарізати / тримати жар / помішувати /
// перевернути / томити), книга рецептів з гортанням сторінок, комора й
// продаж страв у таверні/ресторані, кулінарна лавка Сонячної Марини.
// Мова: пари [uk, en] через спільний core/i18n (англійська за замовчуванням).
// ─────────────────────────────────────────────────────────────

const lang = getLang;
/** текст поточною мовою (спільний перемикач — core/i18n) */
export { L };
const T = (t: Txt) => (lang() === 'en' ? t[1] : t[0]);
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface KitchenHost {
  game: GameState;
  galley: Galley;
  audio: AudioEngine;
  camera: THREE_Camera;
  toast(msg: string, kind?: 'good' | 'warn' | 'bad', ms?: number): void;
  /** крен човна (рад) — качка заважає наливати */
  roll(): number;
  /** відкрити/закрити вікно: фаза діалогу, звільнити/захопити мишу */
  panelOpened(): void;
  panelClosed(): void;
  save(): void;
  /** кооп-екіпаж: «зварити» рибу в трюмі власника */
  cookFishInHold(f: FishItem): void;
}
type THREE_Camera = import('three').Camera;

// ── звуки камбуза (Web Audio, власні вузли поверх майстра AudioEngine) ──
class Snd {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private whistle: { o: OscillatorNode; g: GainNode; lfo: OscillatorNode } | null = null;
  private noises = new Map<string, { s: AudioBufferSourceNode; f: BiquadFilterNode; g: GainNode }>();
  constructor(private audio: AudioEngine) {}
  private init(): boolean {
    if (this.ctx) return true;
    const s = this.audio.sfx();
    if (!s) return false;
    this.ctx = s.ctx;
    this.out = s.out;
    return true;
  }
  /** свисток чайника: v 0..1 — гучність і висота */
  setWhistle(v: number) {
    if (!this.init() || !this.ctx) return;
    if (v <= 0.01) {
      if (this.whistle) {
        this.whistle.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        const w = this.whistle;
        setTimeout(() => { try { w.o.stop(); w.lfo.stop(); } catch { /* */ } }, 300);
        this.whistle = null;
      }
      return;
    }
    if (!this.whistle) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 7;
      const lg = this.ctx.createGain();
      lg.gain.value = 18;
      lfo.connect(lg).connect(o.frequency);
      o.connect(g).connect(this.out!);
      o.start();
      lfo.start();
      this.whistle = { o, g, lfo };
    }
    const t = this.ctx.currentTime;
    this.whistle.o.frequency.setTargetAtTime(1100 + v * 1300, t, 0.15);
    this.whistle.g.gain.setTargetAtTime(0.012 + v * 0.05, t, 0.1);
  }
  /** шум: наливання (булькіт), шкварчання, кипіння */
  setNoise(id: 'pour' | 'sizzle' | 'boil', v: number) {
    if (!this.init() || !this.ctx) return;
    let n = this.noises.get(id);
    if (!n && v > 0.01) {
      const ctx = this.ctx;
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = id === 'sizzle' ? 'highpass' : 'bandpass';
      f.frequency.value = id === 'pour' ? 900 : id === 'sizzle' ? 3500 : 400;
      f.Q.value = id === 'pour' ? 3 : 0.7;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.out!);
      s.start();
      n = { s, f, g };
      this.noises.set(id, n);
    }
    if (!n) return;
    const t = this.ctx.currentTime;
    const peak = id === 'pour' ? 0.09 : id === 'sizzle' ? 0.05 : 0.04;
    n.g.gain.setTargetAtTime(v * peak, t, 0.06);
    if (id === 'pour') n.f.frequency.setTargetAtTime(700 + v * 600 + Math.random() * 200, t, 0.05);
  }
  stopAll() {
    this.setWhistle(0);
    for (const id of ['pour', 'sizzle', 'boil'] as const) this.setNoise(id, 0);
  }
}

// ── стан міні-ігор ──
type TeaPhase = 'fill' | 'heat' | 'pour' | 'steep' | 'extras';
interface TeaState {
  kind: 'tea';
  phase: TeaPhase;
  fill: number;
  temp: number;
  boilT: number;
  tempScore: number;
  mug: number;
  wob: number;
  wobV: number;
  spilled: number;
  steep: number;
  steepScore: number;
  extras: PantryId[];
  msg: string;
  msgT: number;
}
interface CookState {
  kind: 'cook';
  recipe: Recipe;
  fish: FishItem[];
  step: number;
  scores: number[];
  t: number;
  // по кроках
  marker: number;
  dir: number;
  hits: number;
  zone: number;
  heat: number;
  heatDrift: number;
  inZone: number;
  stirs: number;
  lastStir: string;
  done: number;
  msg: string;
  msgT: number;
}

const STEP_TIME: Record<CookStep, number> = { chop: 0, heat: 6, stir: 5, flip: 0, simmer: 0 };

export class KitchenUI {
  private mg: TeaState | CookState | null = null;
  private hudEl: HTMLElement;
  private cv: HTMLCanvasElement;
  private cx: CanvasRenderingContext2D;
  private titleEl: HTMLElement;
  private hintEl: HTMLElement;
  private msgEl: HTMLElement;
  private overlay: HTMLElement;
  private panel: HTMLElement;
  private buffsEl: HTMLElement;
  private snd: Snd;
  private page = 0;
  private sel = '';
  private tab: 'recipes' | 'pantry' | 'dishes' = 'recipes';
  private escH = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && this.overlay.classList.contains('show')) {
      e.stopPropagation();
      this.close();
    }
  };

  constructor(private h: KitchenHost) {
    this.snd = new Snd(h.audio);
    this.hudEl = document.createElement('div');
    this.hudEl.id = 'kitchen-mg';
    this.hudEl.innerHTML = `<div class="km-title"></div><canvas width="840" height="200"></canvas><div class="km-msg"></div><div class="km-hint"></div>`;
    document.body.appendChild(this.hudEl);
    this.cv = this.hudEl.querySelector('canvas')!;
    this.cx = this.cv.getContext('2d')!;
    this.titleEl = this.hudEl.querySelector('.km-title')!;
    this.hintEl = this.hudEl.querySelector('.km-hint')!;
    this.msgEl = this.hudEl.querySelector('.km-msg')!;
    this.overlay = document.createElement('div');
    this.overlay.id = 'kitchen-panel';
    this.overlay.className = 'overlay';
    this.overlay.innerHTML = '<div class="kp"></div>';
    document.body.appendChild(this.overlay);
    this.panel = this.overlay.querySelector('.kp')!;
    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });
    window.addEventListener('keydown', this.escH, true);
    this.buffsEl = document.createElement('div');
    this.buffsEl.id = 'buff-chips';
    document.body.appendChild(this.buffsEl);
  }

  get active(): boolean {
    return !!this.mg;
  }
  /** активна або щойно закінчилась (тієї ж миті E ще «натиснута» для решти гри) */
  get busy(): boolean {
    return !!this.mg || performance.now() - this.endedAt < 250;
  }
  private endedAt = -1e9;
  get panelOpen(): boolean {
    return this.overlay.classList.contains('show');
  }

  // ───────────── підписи станцій ─────────────
  kettleLabel(): string {
    return this.mg ? L('Чайник — уже на вогні', 'Kettle — already on') : L(`Чайник — заварити чай (${this.h.game.kitchen.pantry.tea} заварок)`, `Kettle — brew tea (${this.h.game.kitchen.pantry.tea} left)`);
  }
  stoveLabel(): string {
    return L('Плита — готувати за рецептом', 'Stove — cook a recipe');
  }
  bookLabel(): string {
    const k = this.h.game.kitchen;
    return L(`Книга рецептів (${k.known.length}/${RECIPES.length}) · страви: ${k.dishes.length}`, `Cookbook (${k.known.length}/${RECIPES.length}) · dishes: ${k.dishes.length}`);
  }

  // ───────────── чай ─────────────
  startTea() {
    const k = this.h.game.kitchen;
    if (this.mg) return;
    if (k.pantry.tea <= 0) {
      this.h.toast(L('Заварка скінчилась — купи чай у таверні «Ситий баклан»', 'Out of tea leaves — buy some at the "Full Cormorant" tavern'), 'warn', 3000);
      return;
    }
    this.mg = { kind: 'tea', phase: 'fill', fill: 0, temp: 18, boilT: 0, tempScore: 0, mug: 0, wob: 0, wobV: 0, spilled: 0, steep: 0, steepScore: 0, extras: [], msg: '', msgT: 0 };
    this.h.galley.setMug(0);
    this.hudEl.classList.add('show');
    this.h.audio.click();
  }

  // ───────────── готування ─────────────
  /** вибір рецепта (вікно), далі — міні-гра біля плити */
  openStove() {
    if (this.mg) return;
    this.tab = 'recipes';
    this.renderPicker();
    this.open();
  }

  private startCook(r: Recipe, fish: FishItem[]) {
    const k = this.h.game.kitchen;
    k.usePantry(r);
    this.mg = { kind: 'cook', recipe: r, fish, step: 0, scores: [], t: 0, marker: 0, dir: 1, hits: 0, zone: 0.5, heat: 0.5, heatDrift: 0, inZone: 0, stirs: 0, lastStir: '', done: 0, msg: '', msgT: 0 };
    this.initStep();
    this.h.galley.setPan(true, r.steps.includes('simmer') && !r.steps.includes('flip'));
    this.h.galley.setDone(0);
    this.hudEl.classList.add('show');
  }

  private initStep() {
    const m = this.mg as CookState;
    m.t = 0;
    m.marker = 0;
    m.dir = 1;
    m.hits = 0;
    m.zone = 0.3 + Math.random() * 0.4;
    m.heat = 0.5;
    m.heatDrift = 0;
    m.inZone = 0;
    m.stirs = 0;
    m.lastStir = '';
    m.done = 0;
  }

  /** кадр міні-гри; input — клавіатура/миша (миша вільна, але вже з'їдена) */
  update(dt: number, input: Input, t: number, live: boolean) {
    const k = this.h.game.kitchen;
    if (live) {
      const energy = k.update(dt);
      if (energy) this.h.game.addEnergy(energy);
    }
    this.renderBuffs();
    this.h.galley.update(dt, t);
    const m = this.mg;
    if (!m || !live) return;
    if (m.msgT > 0) {
      m.msgT -= dt;
      if (m.msgT <= 0) m.msg = '';
    }
    if (input.pressed('KeyQ')) {
      this.abort();
      return;
    }
    if (m.kind === 'tea') this.teaStep(m, dt, input);
    else this.cookStep(m, dt, input);
    if (this.mg) this.draw();
  }

  private say(m: TeaState | CookState, msg: string, sec = 1.8) {
    m.msg = msg;
    m.msgT = sec;
  }

  private teaStep(m: TeaState, dt: number, input: Input) {
    const g = this.h.galley;
    const act = input.pressed('KeyE') || input.pressed('Mouse0');
    switch (m.phase) {
      case 'fill': {
        const pouring = input.down('Space');
        if (pouring) {
          m.fill += dt * 0.32;
          if (m.fill > 1) {
            m.fill = 0.92;
            m.spilled++;
            this.say(m, L('Перелив! Вода по всій плиті', 'Overfilled! Water all over the stove'));
            this.h.audio.splash(0.1);
          }
        }
        this.snd.setNoise('pour', pouring ? 0.6 : 0);
        if (act) {
          if (m.fill < 0.3) this.say(m, L('Замало води — тримай Space біля крана', 'Not enough water — hold Space at the tap'));
          else {
            m.phase = 'heat';
            g.setFlame(true);
            this.snd.setNoise('pour', 0);
            this.h.audio.click();
          }
        }
        break;
      }
      case 'heat': {
        // більше води — довше; на хвилях полум'я задуває — трохи повільніше
        m.temp = Math.min(100, m.temp + dt * (9.5 / (0.55 + m.fill)) * (1 - Math.min(0.3, Math.abs(this.h.roll()) * 2)));
        if (m.temp >= 99.5) m.boilT += dt;
        g.setBoil(Math.max(0, (m.temp - 40) / 60));
        this.snd.setWhistle(m.temp > 92 ? (m.temp - 92) / 8 : 0);
        this.snd.setNoise('boil', Math.max(0, (m.temp - 60) / 40));
        if (m.boilT > 9 && m.boilT - dt <= 9) this.say(m, L('Википає! Знімай чайник (E)', 'Boiling away! Take the kettle off (E)'));
        if (act) {
          // ідеал — свисток (96–100°) і не довше кількох секунд кипіння
          m.tempScore = m.temp < 96 ? Math.max(0, (m.temp - 60) / 36) * 0.8 : m.boilT > 7 ? Math.max(0.35, 1 - (m.boilT - 7) / 14) : 1;
          if (m.temp < 85) this.say(m, L('Ще не закипів — чай буде ледь теплий', 'Not boiling yet — the tea will be lukewarm'));
          else if (m.boilT > 7) this.say(m, L('Перекип — вода «плоска», але гаряча', 'Over-boiled — flat water, but hot'));
          m.phase = 'pour';
          g.setFlame(false);
          this.snd.setWhistle(0);
          this.snd.setNoise('boil', 0);
        }
        break;
      }
      case 'pour': {
        const pouring = input.down('Space');
        // качка розгойдує руку; A/D — тримати струмінь над кухлем
        const roll = this.h.roll();
        const lean = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
        m.wobV += (roll * 9 + Math.sin(performance.now() / 370) * 0.9 + (Math.random() - 0.5) * 2.2) * dt + lean * 3.2 * dt;
        m.wobV *= Math.exp(-dt * 1.6);
        m.wob = Math.max(-1.4, Math.min(1.4, m.wob + m.wobV * dt));
        g.pourTilt += ((pouring ? 0.9 : 0) - g.pourTilt) * (1 - Math.exp(-dt * 8));
        this.snd.setNoise('pour', pouring ? 0.8 : 0);
        if (pouring) {
          if (Math.abs(m.wob) > 1) {
            m.spilled += dt;
            if (m.spilled - dt < Math.floor(m.spilled) + 0.02) this.h.audio.splash(0.06);
            if (m.msgT <= 0) this.say(m, L('Ллєш повз кухоль! A/D — вирівняй', 'Spilling! A/D to steady it'), 1);
          } else m.mug += dt * 0.42;
          if (m.mug > 1) {
            m.mug = 1;
            m.spilled += 1.5;
            this.say(m, L('Через край!', 'Over the brim!'));
          }
        }
        g.setMug(m.mug, 0xd9c7a0);
        if (act && !pouring) {
          if (m.mug < 0.5) this.say(m, L('Налий хоча б пів кухля (тримай Space)', 'Pour at least half a mug (hold Space)'));
          else {
            m.phase = 'steep';
            g.pourTilt = 0;
            this.snd.setNoise('pour', 0);
            this.h.game.kitchen.pantry.tea = Math.max(0, this.h.game.kitchen.pantry.tea - 1);
            this.h.audio.click();
          }
        }
        break;
      }
      case 'steep': {
        m.steep += dt;
        const c = Math.min(1, m.steep / 5);
        g.setMug(m.mug, lerpColor(0xd9c7a0, 0x7a3f12, c));
        if (act || m.steep > 9) {
          // 3–5 с — ідеал; швидше — водянистий, довше — гіркий
          m.steepScore = m.steep < 3 ? Math.max(0, m.steep / 3) * 0.85 : m.steep <= 5 ? 1 : Math.max(0.2, 1 - (m.steep - 5) / 4);
          this.say(m, m.steep < 2 ? L('Ледь забарвився — водянистий', 'Barely coloured — weak') : m.steep > 6 ? L('Перестояв — гіркуватий', 'Over-steeped — a bit bitter') : L('Ідеальний колір!', 'Perfect colour!'));
          m.phase = 'extras';
        }
        break;
      }
      case 'extras': {
        const k = this.h.game.kitchen;
        const add = (id: PantryId) => {
          if (m.extras.includes(id)) return;
          if ((k.pantry[id] ?? 0) <= 0) {
            this.say(m, L(`Немає: ${T(PANTRY[id].name).toLowerCase()}`, `Out of ${T(PANTRY[id].name).toLowerCase()}`));
            return;
          }
          k.pantry[id]--;
          m.extras.push(id);
          this.h.audio.click();
        };
        if (input.pressed('Digit1')) add('sugar');
        if (input.pressed('Digit2')) add('lemon');
        if (input.pressed('Digit3')) add('herbs');
        if (act) this.finishTea(m);
        break;
      }
    }
  }

  private finishTea(m: TeaState) {
    const k = this.h.game.kitchen;
    const pour = Math.max(0, 1 - m.spilled * 0.18) * (m.mug >= 0.75 && m.mug <= 0.97 ? 1 : 0.8);
    let q = Math.max(0, Math.min(1, m.tempScore * 0.35 + m.steepScore * 0.4 + pour * 0.25));
    // ідеальний — саме заварювання (окріп, настій, не розлив), добавки не рахуються
    const perfect = q >= 0.9;
    if (m.extras.length) q = Math.min(1, q + 0.06 * m.extras.length);
    this.h.game.addEnergy(10 + 22 * q);
    k.addBuff('warm', 180 + 360 * q);
    if (m.extras.includes('lemon')) k.addBuff('luck', 90 + 150 * q);
    if (m.extras.includes('herbs')) k.addBuff('hearty', 120 + 180 * q);
    if (perfect) k.addBuff('fortune', 300);
    k.teas++;
    const name = m.extras.includes('lemon') ? L('Чай з лимоном', 'Lemon tea') : m.extras.includes('herbs') ? L('Трав\'яний чай', 'Herbal tea') : m.extras.includes('sugar') ? L('Солодкий чай', 'Sweet tea') : L('Чорний чай', 'Black tea');
    this.h.toast(`☕ ${name} ${qualityStars(q)} · ${L('зігрівся', 'warmed up')}${m.extras.includes('lemon') ? ' · 🍀' : ''}${perfect ? L(' · ✨ ідеальний! Капітанський фарт', ' · ✨ perfect! Skipper\'s fortune') : ''}`, 'good', perfect ? 5000 : 3500);
    this.h.galley.setMug(0);
    this.h.galley.showHandMug(this.h.camera, 4.5);
    this.end();
    this.h.save();
  }

  private cookStep(m: CookState, dt: number, input: Input) {
    const g = this.h.galley;
    const step = m.recipe.steps[m.step];
    const act = input.pressed('KeyE') || input.pressed('Mouse0');
    m.t += dt;
    const roll = this.h.roll();
    let score: number | null = null;
    switch (step) {
      case 'chop': {
        m.marker += m.dir * dt * (1.1 + m.hits * 0.25);
        if (m.marker > 1) { m.marker = 1; m.dir = -1; }
        if (m.marker < 0) { m.marker = 0; m.dir = 1; }
        if (act) {
          const d = Math.abs(m.marker - m.zone);
          const s = d < 0.07 ? 1 : d < 0.15 ? 0.6 : 0.15;
          m.inZone += s;
          m.hits++;
          this.h.audio.thump(0.15);
          this.say(m, s >= 1 ? L('Рівно!', 'Clean cut!') : s > 0.5 ? L('Майже', 'Close') : L('Криво…', 'Ragged…'), 0.8);
          m.zone = 0.2 + Math.random() * 0.6;
          if (m.hits >= 3) score = m.inZone / 3;
        }
        break;
      }
      case 'heat': {
        const lean = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
        m.heatDrift += ((Math.random() - 0.5) * 1.6 + roll * 2) * dt;
        m.heatDrift *= Math.exp(-dt * 0.6);
        m.heat = Math.max(0, Math.min(1, m.heat + (m.heatDrift * 0.35 + lean * 0.55 + 0.04) * dt));
        const ok = m.heat > 0.42 && m.heat < 0.68;
        if (ok) m.inZone += dt;
        m.done = Math.min(1.3, m.done + dt * m.heat * 0.22);
        g.setDone(m.done);
        g.setPanSteam(0.3 + m.heat);
        this.snd.setNoise('sizzle', 0.3 + m.heat * 0.7);
        if (m.t >= STEP_TIME.heat) score = Math.min(1, m.inZone / (STEP_TIME.heat * 0.8));
        break;
      }
      case 'stir': {
        for (const key of ['KeyA', 'KeyD']) {
          if (input.pressed(key) && m.lastStir !== key) {
            m.stirs++;
            m.lastStir = key;
            g.stir();
          }
        }
        g.setPanSteam(0.6);
        this.snd.setNoise('boil', 0.5);
        if (m.t >= STEP_TIME.stir) score = Math.min(1, m.stirs / 12);
        break;
      }
      case 'flip': {
        m.done = Math.min(1.35, m.done + dt * 0.24);
        g.setDone(m.done);
        g.setPanSteam(0.5 + m.done * 0.5);
        this.snd.setNoise('sizzle', 0.7);
        if (act || m.done >= 1.35) {
          score = m.done >= 0.85 && m.done <= 1.05 ? 1 : m.done < 0.85 ? Math.max(0.1, m.done / 0.85) * 0.7 : Math.max(0.05, 1 - (m.done - 1.05) * 3);
          this.say(m, score >= 1 ? L('Золотава скоринка!', 'Golden crust!') : m.done > 1.05 ? L('Підгоріло…', 'A bit burnt…') : L('Блідувато', 'Too pale'), 1.2);
          g.flip();
          m.done = Math.min(m.done, 0.6);
        }
        break;
      }
      case 'simmer': {
        m.done += dt / 6;
        g.setDone(Math.min(1, m.done));
        g.setPanSteam(0.4 + m.done);
        this.snd.setNoise('boil', 0.3 + m.done * 0.6);
        if (act || m.done >= 1.15) {
          score = m.done >= 0.7 && m.done <= 0.92 ? 1 : m.done < 0.7 ? Math.max(0.1, m.done / 0.7) * 0.7 : Math.max(0.1, 1 - (m.done - 0.92) * 3);
          this.say(m, score >= 1 ? L('Саме те!', 'Just right!') : m.done < 0.7 ? L('Недоварено', 'Underdone') : L('Розварилось', 'Overcooked'), 1.2);
        }
        break;
      }
    }
    if (score != null) {
      m.scores.push(Math.max(0, Math.min(1, score)));
      this.snd.setNoise('sizzle', 0);
      this.snd.setNoise('boil', 0);
      m.step++;
      if (m.step >= m.recipe.steps.length) this.finishCook(m);
      else this.initStep();
    }
  }

  private finishCook(m: CookState) {
    const game = this.h.game;
    const k = game.kitchen;
    const q = m.scores.reduce((a, b) => a + b, 0) / Math.max(1, m.scores.length);
    const r = m.recipe;
    if (r.boilsFish) {
      const f = m.fish[0];
      const live = game.hold.find((x) => x.uid === f.uid);
      if (live && !live.cooked) {
        live.cooked = true;
        this.h.cookFishInHold(live);
      }
      this.h.toast(`🐟 ${L('Зварено', 'Boiled')}: ${game.speciesName(f.speciesId).toLowerCase()} — ${L('у трюмі, продається дорожче', 'in the hold, sells for more')}`, 'good', 3000);
    } else {
      // риба йде з трюму (у коопі — з трюму власника, через holdHook)
      let base = 0;
      for (const f of m.fish) if (game.removeFish(f.uid)) base += fishValue(f);
      k.addDish(r.id, q, base);
      this.h.toast(`${r.icon} ${T(r.name)} ${qualityStars(q)} — ${L('у книзі рецептів → «Страви»', 'see Cookbook → "Dishes"')}`, 'good', 3600);
    }
    k.cooked++;
    this.h.audio.catchJingle();
    this.end();
    this.h.save();
  }

  /** перервати (Q / Esc): продукти пропали, риба ціла */
  abort() {
    if (!this.mg) return;
    this.h.toast(this.mg.kind === 'tea' ? L('Чай відкладено', 'Tea abandoned') : L('Готування перервано — продукти пропали, риба ціла', 'Cooking stopped — ingredients lost, the fish is fine'), 'warn', 2400);
    this.end();
  }

  private end() {
    this.mg = null;
    this.endedAt = performance.now();
    this.hudEl.classList.remove('show');
    this.snd.stopAll();
    const g = this.h.galley;
    g.setFlame(false);
    g.setBoil(0);
    g.pourTilt = 0;
    g.setPan(false);
  }

  // ───────────── HUD міні-гри (canvas) ─────────────
  private draw() {
    const m = this.mg!;
    const x = this.cx;
    const W = 840, H = 200;
    x.clearRect(0, 0, W, H);
    const bar = (y: number, v: number, lo: number, hi: number, label: string, color = '#fffaf0', marker = true) => {
      x.fillStyle = 'rgba(255,255,255,0.16)';
      rr(x, 30, y, W - 60, 30, 15);
      x.fill();
      if (hi > lo) {
        x.fillStyle = 'rgba(79,183,168,0.45)';
        rr(x, 30 + (W - 60) * lo, y, (W - 60) * (hi - lo), 30, 6);
        x.fill();
      }
      if (marker) {
        const px = 30 + (W - 60) * Math.max(0, Math.min(1, v));
        x.fillStyle = color;
        rr(x, px - 6, y - 4, 12, 38, 6);
        x.fill();
      } else {
        x.fillStyle = color;
        rr(x, 30, y, (W - 60) * Math.max(0, Math.min(1, v)), 30, 15);
        x.fill();
      }
      x.font = '800 22px Manrope, sans-serif';
      x.fillStyle = 'rgba(255,255,255,0.85)';
      x.textAlign = 'left';
      x.fillText(label, 32, y - 10);
    };
    let title = '', hint = '';
    if (m.kind === 'tea') {
      title = `☕ ${L('Чай', 'Tea')}`;
      switch (m.phase) {
        case 'fill':
          bar(70, m.fill, 0.55, 0.85, L('Вода в чайнику', 'Water in the kettle'), '#8fd3ff', false);
          hint = L('Space — набирати воду з крана · E — на вогонь', 'Space — fill from the tap · E — onto the flame');
          break;
        case 'heat': {
          bar(70, (m.temp - 18) / 82, (96 - 18) / 82, 1, `${L('Температура', 'Temperature')} ${Math.round(m.temp)}°C${m.temp >= 99.5 ? ' · ' + L('КИПИТЬ', 'BOILING') : m.temp > 92 ? ' · ' + L('свистить!', 'whistling!') : ''}`, '#ff9d6b', false);
          hint = m.temp > 92 ? L('Свисток! E — знімай і наливай', 'Whistle! E — take it off and pour') : L('Чекай свистка… (E — зняти раніше)', 'Wait for the whistle… (E to take it off early)');
          break;
        }
        case 'pour':
          bar(56, 0.5 + m.wob * 0.36, 0.5 - 0.36, 0.5 + 0.36, L('Струмінь над кухлем (качка!)', 'Stream over the mug (mind the swell!)'), Math.abs(m.wob) > 1 ? '#ff7a6b' : '#fffaf0');
          bar(140, m.mug, 0.75, 0.97, L('Кухоль', 'Mug'), '#c9862e', false);
          hint = L('Тримай Space — лий · A/D — вирівнюй руку · відпусти й E, коли кухоль повний', 'Hold Space to pour · A/D to steady · release and press E when full');
          break;
        case 'steep':
          bar(70, m.steep / 8, 3 / 8, 5 / 8, `${L('Заварювання', 'Steeping')} ${m.steep.toFixed(1)} ${L('с', 's')}`, '#7a3f12', false);
          hint = L('E — вийняти заварку, коли смужка в зеленому (3–5 с)', 'E — take the leaves out in the green (3–5 s)');
          break;
        case 'extras': {
          const k = this.h.game.kitchen;
          x.font = '700 28px Manrope, sans-serif';
          x.textAlign = 'center';
          x.fillStyle = '#fffaf0';
          const it = (id: PantryId, n: number) => `${n} ${PANTRY[id].icon} ${T(PANTRY[id].name).split(' ')[0]} (${k.pantry[id]})${m.extras.includes(id) ? ' ✓' : ''}`;
          x.fillText(`${it('sugar', 1)}    ${it('lemon', 2)}    ${it('herbs', 3)}`, W / 2, 95);
          hint = L('1/2/3 — додати до чаю · E — пити!', '1/2/3 — add to the tea · E — drink!');
          break;
        }
      }
    } else {
      const step = m.recipe.steps[m.step];
      title = `${m.recipe.icon} ${T(m.recipe.name)} · ${m.step + 1}/${m.recipe.steps.length}: ${T(STEP_INFO[step].name)}`;
      hint = T(STEP_INFO[step].hint) + ' · Q — ' + L('кинути', 'quit');
      switch (step) {
        case 'chop':
          bar(70, m.marker, m.zone - 0.07, m.zone + 0.07, `${L('Ніж', 'Knife')} · ${m.hits}/3`, '#e8eef2');
          break;
        case 'heat':
          bar(56, m.heat, 0.42, 0.68, L('Жар', 'Heat'), m.heat > 0.68 ? '#ff7a6b' : m.heat < 0.42 ? '#8fd3ff' : '#fffaf0');
          bar(140, m.t / STEP_TIME.heat, 0, 0, L('Час', 'Time'), 'rgba(255,255,255,0.55)', false);
          break;
        case 'stir':
          bar(56, Math.min(1, m.stirs / 12), 0.95, 1, `${L('Помішано', 'Stirred')} ${m.stirs}/12`, '#d8b26a', false);
          bar(140, m.t / STEP_TIME.stir, 0, 0, L('Час', 'Time'), 'rgba(255,255,255,0.55)', false);
          break;
        case 'flip':
          bar(70, m.done / 1.35, 0.85 / 1.35, 1.05 / 1.35, L('Скоринка', 'Crust'), m.done > 1.05 ? '#5a3020' : '#e0a050', false);
          break;
        case 'simmer':
          bar(70, m.done / 1.15, 0.7 / 1.15, 0.92 / 1.15, L('Готовність', 'Doneness'), '#d8b26a', false);
          break;
      }
    }
    this.titleEl.textContent = title;
    this.hintEl.textContent = hint;
    this.msgEl.textContent = m.msg;
    this.msgEl.classList.toggle('on', !!m.msg);
  }

  private renderBuffs() {
    const k = this.h.game.kitchen;
    const html = k.buffs.map((b) => {
      const i = BUFF_INFO[b.id];
      const mins = Math.ceil(b.left / 60);
      return `<span class="bf" title="${esc(T(i.name))} — ${esc(T(i.desc))}"><i>${i.icon}</i><b>${mins}${L('хв', 'm')}</b><em style="width:${Math.round((b.left / b.max) * 100)}%"></em></span>`;
    }).join('');
    if (this.buffsEl.dataset.h !== html) {
      this.buffsEl.dataset.h = html;
      this.buffsEl.innerHTML = html;
    }
  }

  // ───────────── вікна: книга рецептів, вибір рецепта, лавка ─────────────
  private open() {
    if (!this.panelOpen) {
      this.overlay.classList.add('show');
      this.h.panelOpened();
    }
  }
  close() {
    if (!this.panelOpen) return;
    const nested = this.overlay.classList.contains('nested');
    this.overlay.classList.remove('show', 'nested');
    if (nested) {
      // повернулись у вікно скупника — оновити гроші/кнопки
      const r = this.nestedRefresh;
      this.nestedRefresh = null;
      r?.();
    } else this.h.panelClosed();
  }

  openBook() {
    this.tab = 'recipes';
    this.renderBook();
    this.open();
  }

  private bookShell(right: string, left: string, mode: 'book' | 'stove'): string {
    const tabs = (['recipes', 'pantry', 'dishes'] as const).map((t) => `<button class="kb-tab ${this.tab === t ? 'on' : ''}" data-tab="${t}">${t === 'recipes' ? '📖 ' + L('Рецепти', 'Recipes') : t === 'pantry' ? '🧺 ' + L('Комора', 'Pantry') : `🍽 ${L('Страви', 'Dishes')} (${this.h.game.kitchen.dishes.length}/${MAX_DISHES})`}</button>`).join('');
    return `
      <div class="kb ${mode}">
        <div class="kb-tabs">${tabs}<button class="kb-x" data-close>✕</button></div>
        <div class="kb-spread">
          <div class="kb-page left">${left}</div>
          <div class="kb-gutter"></div>
          <div class="kb-page right flip-${this.page % 2}">${right}</div>
        </div>
        <div class="kb-foot">${mode === 'stove' ? L('Плита: вибери рецепт праворуч і натисни «Готувати». Риба береться з трюму (спершу дешевша).', 'Stove: pick a recipe and press "Cook". Fish comes from the hold (cheapest first).') : L('Чайник праворуч від плити — чай гріє й бадьорить. Продукти — у таверні «Ситий баклан», делікатеси — у Сонячній Марині.', 'The kettle sits right of the stove — tea warms you up. Groceries at the "Full Cormorant" tavern, delicacies in Sonyachna Marina.')} · Esc</div>
      </div>`;
  }

  private recipeList(): string {
    const k = this.h.game.kitchen;
    return `<h2 class="kb-h">${L('Камбузна книга', 'Galley Cookbook')}</h2><ul class="kb-list">${RECIPES.map((r) => {
      const known = k.known.includes(r.id);
      const can = known && k.pantryOk(r) && !!k.fishFor(r, this.h.game.hold);
      return `<li class="${known ? '' : 'unk'} ${this.sel === r.id ? 'sel' : ''} ${can ? 'can' : ''}" data-rec="${r.id}"><span>${known ? r.icon : '❔'}</span>${known ? esc(T(r.name)) : '· · · · · ·'}${can ? '<em>✓</em>' : ''}</li>`;
    }).join('')}</ul>`;
  }

  private recipePage(r: Recipe | undefined, cookBtn: boolean): string {
    const k = this.h.game.kitchen;
    if (!r) return `<p class="kb-note">${L('Обери рецепт ліворуч.', 'Pick a recipe on the left.')}</p>`;
    if (!k.known.includes(r.id)) {
      const where = { tavern: L('купити в таверні «Ситий баклан»', 'buy at the "Full Cormorant" tavern'), chef: L('купити в ресторані «Маяк» у шефа', 'buy from the chef at the "Lighthouse" restaurant'), marina: L('кулінарна лавка Сонячної Марини', 'the cookery shop in Sonyachna Marina'), island: L('записка в пляшці на одному з островів', 'a note in a bottle on one of the islands'), experiment: L('вигадай сам: «Експеримент» біля плити', 'invent it: "Experiment" at the stove'), start: '' }[r.source];
      return `<div class="kb-unknown"><div class="kb-big">❔</div><h3>${L('Невідомий рецепт', 'Unknown recipe')}</h3><p>${L('Де дізнатись', 'Where to learn')}: <b>${where}</b></p></div>`;
    }
    const fishOk = !!k.fishFor(r, this.h.game.hold);
    const ing = (Object.entries(r.pantry) as Array<[PantryId, number]>).map(([id, n]) => {
      const ok = (k.pantry[id] ?? 0) >= n;
      return `<li class="${ok ? 'ok' : 'no'}">${PANTRY[id].icon} ${esc(T(PANTRY[id].name))} ×${n} <small>(${k.pantry[id] ?? 0})</small></li>`;
    }).join('');
    const buffs = r.buffs.map(([b, s]) => `<span class="kb-buff">${BUFF_INFO[b].icon} ${esc(T(BUFF_INFO[b].name))} · ~${Math.round(s / 60)} ${L('хв', 'min')}</span>`).join('');
    const can = fishOk && k.pantryOk(r);
    return `
      <div class="kb-dish"><div class="kb-big">${r.icon}</div><h3>${esc(T(r.name))}${r.premium ? ` <span class="kb-prem">${L('делікатес', 'delicacy')}</span>` : ''}</h3></div>
      <p class="kb-blurb">${esc(T(r.blurb))}</p>
      <h4>${L('Потрібно', 'You need')}</h4>
      <ul class="kb-ing"><li class="${fishOk ? 'ok' : 'no'}">🐟 ${esc(T(r.fish.label))}</li>${ing}</ul>
      <h4>${L('Кроки', 'Steps')}</h4>
      <p class="kb-steps">${r.steps.map((s) => esc(T(STEP_INFO[s].name))).join(' → ')}</p>
      ${r.boilsFish ? '' : `<h4>${L('Ефект', 'Effect')}</h4><p>+${r.energy} ${L('енергії', 'energy')} ${buffs}</p>`}
      ${cookBtn ? `<button class="btn primary kb-cook" data-cook="${r.id}" ${can ? '' : 'disabled'}>${can ? '🔥 ' + L('Готувати', 'Cook') : fishOk ? L('Бракує продуктів', 'Missing groceries') : L('Немає потрібної риби в трюмі', 'No suitable fish in the hold')}</button>` : ''}`;
  }

  private pantryPage(): string {
    const k = this.h.game.kitchen;
    return `<h2 class="kb-h">${L('Комора', 'Pantry')}</h2><ul class="kb-pantry">${PANTRY_IDS.map((id) => `<li><span>${PANTRY[id].icon}</span>${esc(T(PANTRY[id].name))}<b>${k.pantry[id]}</b></li>`).join('')}</ul>
      <p class="kb-note">${L(`Заварено чаїв: ${k.teas} · страв приготовано: ${k.cooked}`, `Teas brewed: ${k.teas} · dishes cooked: ${k.cooked}`)}</p>`;
  }

  private dishesPage(): string {
    const k = this.h.game.kitchen;
    if (!k.dishes.length) return `<h2 class="kb-h">${L('Страви', 'Dishes')}</h2><p class="kb-note">${L('Поки порожньо. Приготуй щось на плиті — з\'їси тут або продаси в таверні чи ресторані.', 'Nothing yet. Cook something at the stove — eat it here or sell it at the tavern or restaurant.')}</p>`;
    return `<h2 class="kb-h">${L('Страви', 'Dishes')}</h2><ul class="kb-dishes">${k.dishes.map((d) => {
      const r = RECIPE_BY_ID[d.recipe];
      return `<li><span>${r.icon}</span><div><b>${esc(T(r.name))}</b><small>${qualityStars(d.q)} · ${L('таверна', 'tavern')} ${formatMoney(dishPrice(d, 'tavern'))}${r.premium ? ` · ${L('ресторан', 'restaurant')} ${formatMoney(dishPrice(d, 'chef'))}` : ''}</small></div><button class="btn small primary" data-eat="${d.id}">${L('З\'їсти', 'Eat')}</button></li>`;
    }).join('')}</ul>`;
  }

  private renderBook() {
    const left = this.tab === 'recipes' ? this.recipeList() : this.tab === 'pantry' ? this.pantryPage() : this.dishesPage();
    const right = this.tab === 'recipes' ? this.recipePage(RECIPE_BY_ID[this.sel], false) : this.tab === 'dishes' ? this.buffsPage() : this.shoppingHint();
    this.panel.innerHTML = this.bookShell(right, left, 'book');
    this.bindBook(false);
  }

  private renderPicker() {
    if (!this.sel || !this.h.game.kitchen.known.includes(this.sel)) this.sel = this.bestRecipe();
    const left = this.recipeList() + this.experimentBox();
    const right = this.recipePage(RECIPE_BY_ID[this.sel], true);
    this.panel.innerHTML = this.bookShell(right, left, 'stove');
    this.bindBook(true);
  }

  private bestRecipe(): string {
    const k = this.h.game.kitchen;
    const ok = RECIPES.filter((r) => k.known.includes(r.id) && k.pantryOk(r) && k.fishFor(r, this.h.game.hold));
    return (ok.find((r) => !r.boilsFish) ?? ok[0] ?? RECIPES[0]).id;
  }

  private experimentBox(): string {
    const k = this.h.game.kitchen;
    return `<div class="kb-exp"><h4>🧪 ${L('Експеримент', 'Experiment')}</h4><p>${L('Познач продукти (+ будь-яка риба з трюму). Вгадаєш склад — відкриєш новий рецепт.', 'Tick groceries (+ any fish from the hold). Guess the mix and you discover a new recipe.')}</p>
      <div class="kb-chips">${PANTRY_IDS.filter((id) => id !== 'tea' && id !== 'sugar').map((id) => `<label class="${k.pantry[id] ? '' : 'off'}"><input type="checkbox" value="${id}" ${k.pantry[id] ? '' : 'disabled'}>${PANTRY[id].icon}</label>`).join('')}</div>
      <button class="btn small" data-exp>${L('Спробувати', 'Try it')}</button></div>`;
  }

  private buffsPage(): string {
    const k = this.h.game.kitchen;
    const list = k.buffs.length
      ? k.buffs.map((b) => `<li>${BUFF_INFO[b.id].icon} <b>${esc(T(BUFF_INFO[b.id].name))}</b> — ${esc(T(BUFF_INFO[b.id].desc))} <small>(${Math.ceil(b.left / 60)} ${L('хв', 'min')})</small></li>`).join('')
      : `<li class="kb-note">${L('Зараз нічого не діє. Чай, юшка чи стейк дають бонуси на кілька хвилин.', 'Nothing active. Tea, broth or a steak give bonuses for a few minutes.')}</li>`;
    return `<h3>${L('Що діє зараз', 'Active effects')}</h3><ul class="kb-bufflist">${list}</ul>`;
  }

  private shoppingHint(): string {
    return `<h3>${L('Де брати продукти', 'Where to buy')}</h3><ul class="kb-bufflist">
      <li>🍲 <b>${L('Таверна «Ситий баклан»', '"Full Cormorant" tavern')}</b> — ${L('комора Ганни: чай, цукор, сіль, цибуля, картопля, масло, лимони, трави; рецепти простих страв', 'Hanna\'s pantry: tea, sugar, salt, onion, potato, butter, lemons, herbs; simple recipes')}</li>
      <li>🍽 <b>${L('Ресторан «Маяк»', '"Lighthouse" restaurant')}</b> — ${L('рецепти шефа; купує делікатеси', 'the chef\'s recipes; buys delicacies')}</li>
      <li>🍳 <b>${L('Кулінарна лавка, Сонячна Марина', 'Cookery shop, Sonyachna Marina')}</b> — ${L('рис, лимони, трави дешевше; паелья', 'rice, lemons, herbs cheaper; paella')}</li>
    </ul>`;
  }

  private bindBook(stove: boolean) {
    const rerender = () => (stove ? this.renderPicker() : this.renderBook());
    this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.panel.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.tab as typeof this.tab;
      this.page++;
      this.h.audio.click();
      if (stove && this.tab !== 'recipes') this.renderBook();
      else rerender();
    }));
    this.panel.querySelectorAll<HTMLElement>('[data-rec]').forEach((li) => li.addEventListener('click', () => {
      this.sel = li.dataset.rec!;
      this.page++;
      this.h.audio.click();
      rerender();
    }));
    this.panel.querySelectorAll<HTMLElement>('[data-cook]').forEach((b) => b.addEventListener('click', () => {
      const r = RECIPE_BY_ID[b.dataset.cook!];
      const k = this.h.game.kitchen;
      const fish = r && k.fishFor(r, this.h.game.hold);
      if (!r || !fish || !k.pantryOk(r)) return;
      this.close();
      this.startCook(r, fish);
    }));
    this.panel.querySelectorAll<HTMLElement>('[data-eat]').forEach((b) => b.addEventListener('click', () => {
      const r = this.h.game.kitchen.eat(Number(b.dataset.eat), (e) => this.h.game.addEnergy(e));
      if (r) {
        this.h.toast(`${r.icon} ${T(r.name)} — ${L('смачно!', 'delicious!')} ${r.buffs.map(([x]) => BUFF_INFO[x].icon).join(' ')}`, 'good', 3000);
        this.h.audio.catchJingle();
        this.h.save();
      }
      rerender();
    }));
    this.panel.querySelector('[data-exp]')?.addEventListener('click', () => {
      const k = this.h.game.kitchen;
      const chosen = [...this.panel.querySelectorAll<HTMLInputElement>('.kb-chips input:checked')].map((i) => i.value as PantryId);
      const r = chosen.length ? k.experiment(chosen) : null;
      if (!r) {
        this.h.toast(L('Нічого путнього не виходить… Продукти цілі — спробуй інше поєднання', 'Nothing good comes of it… groceries are safe — try another mix'), 'warn', 3000);
        return;
      }
      k.learn(r.id);
      this.sel = r.id;
      this.h.toast(`📖 ${L('Новий рецепт', 'New recipe')}: ${r.icon} ${T(r.name)}!`, 'good', 3500);
      this.h.audio.catchJingle();
      this.h.save();
      this.page++;
      rerender();
    });
  }

  // ───────────── продукти, рецепти й продаж страв у скупників ─────────────
  /** смужка у вікні скупника (таверна/ресторан): кухня відкривається окремим вікном поверх */
  buyerSection(buyer: string, panel: HTMLElement, refresh: () => void) {
    if (buyer !== 'tavern' && buyer !== 'chef') return;
    const where = buyer === 'tavern' ? 'tavern' : 'chef';
    const k = this.h.game.kitchen;
    const sell = k.dishes.filter((d) => dishPrice(d, where) > 0).length;
    const strip = document.createElement('div');
    strip.className = 'kshop-strip';
    strip.innerHTML = `<span>👩‍🍳 <b>${where === 'tavern' ? L('Кухня таверни', 'Tavern kitchen') : L('Кухня шефа', 'Chef\'s kitchen')}</b> · ${where === 'tavern' ? L('продукти, рецепти', 'groceries, recipes') : L('рецепти шефа', 'chef\'s recipes')} · ${L('страви на продаж', 'dishes to sell')}: ${sell}</span><button class="btn small primary">${L('Відкрити', 'Open')}</button>`;
    const row = panel.querySelector('.btn-row');
    if (row) row.before(strip);
    else panel.appendChild(strip);
    strip.querySelector('button')!.addEventListener('click', () => this.openShopWindow(where, refresh));
  }

  /** кулінарна лавка Сонячної Марини (послуга порту) */
  openMarinaShop() {
    this.openShopWindow('marina', null);
  }

  /** вікно лавки; parentRefresh — поверх вікна скупника (фазу гри не чіпаємо, після — оновити його) */
  private openShopWindow(where: 'tavern' | 'chef' | 'marina', parentRefresh: (() => void) | null) {
    const title = where === 'tavern' ? L('Кухня таверни «Ситий баклан»', '"Full Cormorant" tavern kitchen') : where === 'chef' ? L('Кухня ресторану «Маяк»', '"Lighthouse" restaurant kitchen') : L('Кулінарна лавка «Сонячна Марина»', 'Sonyachna Marina cookery shop');
    const draw = () => {
      this.panel.innerHTML = `<div class="kb shopwin"><div class="kb-tabs"><b class="kb-shop-title">🍳 ${title}</b><button class="kb-x" data-close>✕</button></div><div class="kshop">${this.shopHtml(where)}</div></div>`;
      this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.close());
      this.bindShop(this.panel.querySelector('.kshop')!, where, draw);
    };
    draw();
    this.nestedRefresh = parentRefresh;
    if (parentRefresh) this.overlay.classList.add('show', 'nested');
    else this.open();
  }
  private nestedRefresh: (() => void) | null = null;

  private stock(where: 'tavern' | 'chef' | 'marina'): { pantry: Array<[PantryId, number]>; recipes: Recipe[] } {
    if (where === 'tavern') return { pantry: (['tea', 'sugar', 'salt', 'onion', 'potato', 'butter', 'lemon', 'herbs'] as PantryId[]).map((id) => [id, PANTRY[id].price]), recipes: RECIPES.filter((r) => r.source === 'tavern') };
    if (where === 'chef') return { pantry: [], recipes: RECIPES.filter((r) => r.source === 'chef') };
    return { pantry: (['rice', 'lemon', 'herbs', 'butter', 'tea'] as PantryId[]).map((id) => [id, Math.max(2, Math.round(PANTRY[id].price * (id === 'rice' || id === 'lemon' || id === 'herbs' ? 0.7 : 1.2)))]), recipes: RECIPES.filter((r) => r.source === 'marina') };
  }

  private shopHtml(where: 'tavern' | 'chef' | 'marina'): string {
    const g = this.h.game;
    const k = g.kitchen;
    const st = this.stock(where);
    const pantry = st.pantry.length ? `<div class="ks-col"><h4>🧺 ${where === 'tavern' ? L('Комора Ганни', 'Hanna\'s pantry') : L('Продукти', 'Groceries')}</h4><div class="ks-grid">${st.pantry.map(([id, p]) => `<button class="ks-item" data-buy="${id}" data-price="${p}" ${g.money >= p ? '' : 'disabled'}><span>${PANTRY[id].icon}</span><b>${esc(T(PANTRY[id].name).split(' (')[0])}</b><small>${formatMoney(p)} · ×${k.pantry[id]}</small></button>`).join('')}</div></div>` : '';
    const recs = st.recipes.length ? `<div class="ks-col"><h4>📜 ${L('Рецепти', 'Recipes')}</h4>${st.recipes.map((r) => k.known.includes(r.id) ? `<div class="ks-rec known">${r.icon} ${esc(T(r.name))} <small>✓ ${L('у книзі', 'in your book')}</small></div>` : `<button class="ks-rec" data-recipe="${r.id}" ${g.money >= (r.price ?? 0) ? '' : 'disabled'}>${r.icon} ${esc(T(r.name))} <b>${formatMoney(r.price ?? 0)}</b></button>`).join('')}</div>` : '';
    let dishes = '';
    if (where !== 'marina') {
      const buyer = where;
      const rows = k.dishes.map((d) => ({ d, p: dishPrice(d, buyer) })).filter((x) => x.p > 0);
      dishes = `<div class="ks-col"><h4>🍽 ${buyer === 'tavern' ? L('Ганна купує страви', 'Hanna buys dishes') : L('Шеф бере делікатеси', 'The chef takes delicacies')}</h4>${rows.length ? rows.map(({ d, p }) => `<button class="ks-rec" data-selldish="${d.id}">${RECIPE_BY_ID[d.recipe].icon} ${esc(T(RECIPE_BY_ID[d.recipe].name))} ${qualityStars(d.q)} <b>+${formatMoney(p)}</b></button>`).join('') : `<p class="kb-note">${buyer === 'tavern' ? L('Принеси приготовані страви (книга рецептів → «Страви»).', 'Bring cooked dishes (cookbook → "Dishes").') : L('Лише делікатеси: лосось з лимоном, стейк з тунця, уха, паелья.', 'Delicacies only: lemon salmon, tuna steak, ukha, paella.')}</p>`}</div>`;
    }
    return `<div class="ks-head">👩‍🍳 ${where === 'tavern' ? L('Кухня таверни', 'Tavern kitchen') : where === 'chef' ? L('Кухня шефа', 'Chef\'s kitchen') : L('Делікатеси півдня', 'Southern delicacies')}</div><div class="ks-cols">${pantry}${recs}${dishes}</div>`;
  }

  private bindShop(root: HTMLElement, where: 'tavern' | 'chef' | 'marina', refresh: () => void) {
    const g = this.h.game;
    const k = g.kitchen;
    root.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.buy as PantryId;
      const p = Number(b.dataset.price);
      if (g.money < p) return;
      g.money -= p;
      k.pantry[id] = (k.pantry[id] ?? 0) + 1;
      this.h.audio.click();
      this.h.save();
      refresh();
    }));
    root.querySelectorAll<HTMLElement>('[data-recipe]').forEach((b) => b.addEventListener('click', () => {
      const r = RECIPE_BY_ID[b.dataset.recipe!];
      if (!r || g.money < (r.price ?? 0) || !k.learn(r.id)) return;
      g.money -= r.price ?? 0;
      this.h.toast(`📖 ${L('Новий рецепт', 'New recipe')}: ${r.icon} ${T(r.name)}`, 'good', 3000);
      this.h.audio.catchJingle();
      this.h.save();
      refresh();
    }));
    root.querySelectorAll<HTMLElement>('[data-selldish]').forEach((b) => b.addEventListener('click', () => {
      if (where === 'marina') return;
      const id = Number(b.dataset.selldish);
      const i = k.dishes.findIndex((d) => d.id === id);
      if (i < 0) return;
      const p = dishPrice(k.dishes[i], where);
      if (!p) return;
      k.dishes.splice(i, 1);
      g.money += p;
      g.stats.totalEarned += p;
      this.h.toast(`🍽 +${formatMoney(p)}`, 'good', 2200);
      this.h.audio.catchJingle();
      this.h.save();
      refresh();
    }));
  }

  /** записка з острова вчить рецепт */
  learnFromNote(id: string) {
    const r = RECIPE_BY_ID[id];
    if (r && this.h.game.kitchen.learn(id)) this.h.toast(`📖 ${L('У записці — рецепт', 'The note holds a recipe')}: ${r.icon} ${T(r.name)}!`, 'good', 4000);
  }
}

function rr(x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, r: number) {
  x.beginPath();
  x.roundRect(X, Y, Math.max(0, w), h, Math.min(r, Math.abs(w) / 2, h / 2));
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

