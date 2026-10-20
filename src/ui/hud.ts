import { formatMoney, formatTime, compassDeg } from '../core/math';
import { MOOR } from '../world/boat';
import type { GameState } from '../game/state';
import type { TimeCycle } from '../core/time';
import type { Weather } from '../core/weather';
import { ZONE_NAMES, zoneFromDist } from '../game/fish';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// HUD: DOM-елементи, оновлюються кожен кадр (без пересоздування).
// ─────────────────────────────────────────────────────────────

const W_NAMES: Record<string, string> = {
  calm: L('🌤 Тиша', `🌤 Calm`),
  breeze: L('🍃 Повіє', `🍃 Breeze`),
  wind: L('💨 Вітер', `💨 Windy`),
  storm: L('⛈ Шторм', `⛈ Storm`),
};

export interface FightHud {
  name: string;
  tension: number;
  limit: number;
  dist: number;
  stamina: number;
  pull: number;
  lean: number;
  status: string;
  jump: boolean;
  lo: number;
  hi: number;
  /** риба готує ривок: −1 ліворуч, +1 праворуч, 0 — ні */
  windup: number;
  /** риба зараз вистрибне */
  jumpWarn: boolean;
  /** скільки «терпіння» волосіні витрачено 0..1 */
  strain: number;
  trophy: boolean;
  /** новачок: показати розгорнуту підказку */
  coach: boolean;
}

export class Hud {
  private root: HTMLElement;
  private elMoney!: HTMLElement;
  private elClock!: HTMLElement;
  private elWeather!: HTMLElement;
  private elZone!: HTMLElement;
  private elFuel!: HTMLElement;
  private elFuelN!: HTMLElement;
  private elHull!: HTMLElement;
  private elHullBar!: HTMLElement;
  private elHullN!: HTMLElement;
  private elEnergy!: HTMLElement;
  private elEnergyN!: HTMLElement;
  private elHold!: HTMLElement;
  private elPrompt!: HTMLElement;
  private elAction!: HTMLElement;
  private elActionLabel!: HTMLElement;
  private elActionFill!: HTMLElement;
  private elFight!: HTMLElement;
  private elFishName!: HTMLElement;
  private elTension!: HTMLElement;
  private elTensionLimit!: HTMLElement;
  private elDist!: HTMLElement;
  private elDistN!: HTMLElement;
  private elSweet!: HTMLElement;
  private elStamina!: HTMLElement;
  private elLean!: HTMLElement;
  private elPullL!: HTMLElement;
  private elPullR!: HTMLElement;
  private elFightStatus!: HTMLElement;
  private elStrain!: HTMLElement;
  private elKeyA!: HTMLElement;
  private elKeyD!: HTMLElement;
  private elPromptBar!: HTMLElement;
  private elSpot!: HTMLElement;
  private lastSpot = '';
  private elCast!: HTMLElement;
  private elCastFill!: HTMLElement;
  private elCastSweet!: HTMLElement;
  private elFishStatus!: HTMLElement;
  private compass: HTMLCanvasElement | null = null;
  private compassCtx: CanvasRenderingContext2D | null = null;
  private chipPort!: HTMLElement;
  private chipWp!: HTMLElement;
  private chipAnchor!: HTMLElement;
  private lastAnchorChip = '';
  private chipInstr!: HTMLElement;
  private lastInstrChip = '';
  /**
   * прилади яхти (апгрейд «Прилади»): рівень і показники для чіпів.
   * 0 — лише компас: чіпи грубі (8 румбів, ≈відстань); 1 — лаг (швидкість), тиск;
   * 2 — глибина й вітер; 3 — GPS: точний курс/відстань/час; 4 — стрілка до зграї
   */
  instr: { lvl: number; speed: number; depth: number; wind: number; falling: boolean; fishBrg: number | null; fish: number; autopilot: boolean } = {
    lvl: 3, speed: 0, depth: 0, wind: 0, falling: false, fishBrg: null, fish: 0, autopilot: false,
  };
  private lastPortChip = '';
  private lastWpChip = '';
  private toasts: HTMLElement;
  private elSail!: HTMLElement;
  private lastSail = '-';
  private hintEl: HTMLElement;
  private elRoster!: HTMLElement;
  private elChatLog!: HTMLElement;
  private elChatInput!: HTMLInputElement;
  private chatSend: ((text: string) => void) | null = null;
  private rosterKey = '';
  private barRows: HTMLElement[] = [];
  private barState = [0, 1, 2].map(() => ({ v: -1, t: 0, shown: true }));
  private elTitle!: HTMLElement;
  private elCatch!: HTMLElement;

  constructor() {
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = L(`
      <div class="hud-tl hud-card">
        <div class="money"><span class="m">0</span> <small>₴</small></div>
        <div class="bar-row"><span class="bar-label">Паливо</span><div class="bar fuel"><i></i></div><span class="bar-num">0</span></div>
        <div class="bar-row"><span class="bar-label">Корпус</span><div class="bar hull"><i></i></div><span class="bar-num">0</span></div>
        <div class="bar-row"><span class="bar-label">Енергія</span><div class="bar energy"><i></i></div><span class="bar-num">0</span></div>
      </div>
      <div class="goal hud-card"><span class="g-step"></span><span class="g-text"></span></div>
      <div class="hud-tc">
        <div class="hud-card">
          <div class="clock"><span class="t">00:00</span><small class="d">День 1</small></div>
          <div class="wrow"><span class="w"></span>·<span class="zone"></span></div>
          <div class="sailrow"></div>
        </div>
        <canvas class="compass-strip" width="300" height="36"></canvas>
        <div class="nav-chips">
          <span class="nav-chip hud-card" id="chip-port"></span>
          <span class="nav-chip hud-card" id="chip-wp"></span>
          <span class="nav-chip hud-card hidden" id="chip-anchor"></span>
          <span class="nav-chip hud-card hidden" id="chip-instr"></span>
        </div>
      </div>
      <div class="hud-tr">
        <div class="hold-chip hud-card">🐟 Трюм <b class="h">0/8</b></div>
        <div class="ins-chip">⚠ Без страховки</div>
        <div class="roster hud-card"></div>
      </div>
      <div class="chat">
        <div class="chat-log"></div>
        <input class="chat-input" maxlength="160" autocomplete="off" spellcheck="false" placeholder="Повідомлення екіпажу… (Enter — надіслати, Esc — закрити)">
      </div>
      <div class="toasts"></div>
      <div class="title-card"></div>
      <div class="catch-slot"></div>
      <div class="prompt"><kbd>E</kbd><span class="ptext"></span><b class="pbar"><i></i></b></div>
      <div class="fish-spot"></div>
      <div class="action-progress"><div class="ap-label"></div><div class="bar"><i></i></div></div>
      <div class="cast-ui">
        <div class="cast-label">Сила закиду</div>
        <div class="cast-bar"><div class="cast-sweet"></div><i></i></div>
        <div class="cast-hint">відпусти <kbd>ЛКМ</kbd>, коли риска в зеленій зоні — клюватиме швидше</div>
      </div>
      <div class="fish-status"></div>
      <div class="fight-ui">
        <div class="fish-name"></div>
        <div class="fight-arena">
          <div class="pull-arrow left">◀</div>
          <div class="fight-core">
            <div class="tension-label"><span>Натяг</span><span class="tval">0 %</span></div>
            <div class="tension-bar"><div class="sweet"></div><i></i><div class="limit"></div></div>
            <div class="strain-bar"><i></i></div>
            <div class="lean-row"><kbd class="lk lk-a">A</kbd><div class="rod-lean"><div class="lean-dot"></div></div><kbd class="lk lk-d">D</kbd></div>
            <div class="stamina-row"><span>Сили риби</span><div class="stamina-bar"><i></i></div></div>
          </div>
          <div class="pull-arrow right">▶</div>
        </div>
        <div class="fight-status"></div>
        <div class="fight-coach"><b><kbd>Space</kbd> тримай</b> — натяг росте · <b>відпусти</b> — падає. Тримай білу риску в <b class="g">зеленій</b> зоні, і риба втомиться. Стрілка показує, куди рветься риба — нахиляй вудку <b>в інший бік</b>.</div>
        <div class="dist-row"><span><kbd>Space</kbd> тягти · <kbd>A</kbd>/<kbd>D</kbd> нахил вудки</span><span class="distn">0 м</span></div>
      </div>
      <div class="controls-hint">
        <kbd>WASD</kbd> рух · <kbd>Миша</kbd> погляд · <kbd>Shift</kbd> біг · <kbd>Space</kbd> стрибок · <kbd>E</kbd> дія з тим, що світиться<br>
        вудка в руках: <kbd>ЛКМ</kbd> закид/підсічка · <kbd>R</kbd> змотати · боротьба: <kbd>Space</kbd> тягти, <kbd>A/D</kbd> нахил<br>
        <kbd>M</kbd> карта · <kbd>Esc</kbd> меню · штурвал: <kbd>W/S</kbd> газ, <kbd>A/D</kbd> кермо, <kbd>X</kbd> двигун, <kbd>V</kbd> вигляд · <kbd>H</kbd> сховати інтерфейс · <kbd>F1</kbd> підказки
      </div>
      <div class="lock-hint">🖱️ Клікни по екрану, щоб захопити мишу</div>
    `, `
      <div class="hud-tl hud-card">
        <div class="money"><span class="m">0</span> <small>₴</small></div>
        <div class="bar-row"><span class="bar-label">Fuel</span><div class="bar fuel"><i></i></div><span class="bar-num">0</span></div>
        <div class="bar-row"><span class="bar-label">Hull</span><div class="bar hull"><i></i></div><span class="bar-num">0</span></div>
        <div class="bar-row"><span class="bar-label">Energy</span><div class="bar energy"><i></i></div><span class="bar-num">0</span></div>
      </div>
      <div class="goal hud-card"><span class="g-step"></span><span class="g-text"></span></div>
      <div class="hud-tc">
        <div class="hud-card">
          <div class="clock"><span class="t">00:00</span><small class="d">Day 1</small></div>
          <div class="wrow"><span class="w"></span>·<span class="zone"></span></div>
          <div class="sailrow"></div>
        </div>
        <canvas class="compass-strip" width="300" height="36"></canvas>
        <div class="nav-chips">
          <span class="nav-chip hud-card" id="chip-port"></span>
          <span class="nav-chip hud-card" id="chip-wp"></span>
          <span class="nav-chip hud-card hidden" id="chip-anchor"></span>
          <span class="nav-chip hud-card hidden" id="chip-instr"></span>
        </div>
      </div>
      <div class="hud-tr">
        <div class="hold-chip hud-card">🐟 Hold <b class="h">0/8</b></div>
        <div class="ins-chip">⚠ No insurance</div>
        <div class="roster hud-card"></div>
      </div>
      <div class="chat">
        <div class="chat-log"></div>
        <input class="chat-input" maxlength="160" autocomplete="off" spellcheck="false" placeholder="Message the crew… (Enter — send, Esc — close)">
      </div>
      <div class="toasts"></div>
      <div class="title-card"></div>
      <div class="catch-slot"></div>
      <div class="prompt"><kbd>E</kbd><span class="ptext"></span><b class="pbar"><i></i></b></div>
      <div class="fish-spot"></div>
      <div class="action-progress"><div class="ap-label"></div><div class="bar"><i></i></div></div>
      <div class="cast-ui">
        <div class="cast-label">Cast power</div>
        <div class="cast-bar"><div class="cast-sweet"></div><i></i></div>
        <div class="cast-hint">release <kbd>LMB</kbd> when the marker is in the green zone — bites come sooner</div>
      </div>
      <div class="fish-status"></div>
      <div class="fight-ui">
        <div class="fish-name"></div>
        <div class="fight-arena">
          <div class="pull-arrow left">◀</div>
          <div class="fight-core">
            <div class="tension-label"><span>Tension</span><span class="tval">0 %</span></div>
            <div class="tension-bar"><div class="sweet"></div><i></i><div class="limit"></div></div>
            <div class="strain-bar"><i></i></div>
            <div class="lean-row"><kbd class="lk lk-a">A</kbd><div class="rod-lean"><div class="lean-dot"></div></div><kbd class="lk lk-d">D</kbd></div>
            <div class="stamina-row"><span>Fish strength</span><div class="stamina-bar"><i></i></div></div>
          </div>
          <div class="pull-arrow right">▶</div>
        </div>
        <div class="fight-status"></div>
        <div class="fight-coach"><b><kbd>Space</kbd> hold</b> — tension rises · <b>release</b> — it drops. Keep the white marker in the <b class="g">green</b> zone and the fish will tire. The arrow shows where the fish pulls — lean the rod <b>the other way</b>.</div>
        <div class="dist-row"><span><kbd>Space</kbd> reel · <kbd>A</kbd>/<kbd>D</kbd> lean the rod</span><span class="distn">0 m</span></div>
      </div>
      <div class="controls-hint">
        <kbd>WASD</kbd> move · <kbd>Mouse</kbd> look · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · <kbd>E</kbd> use what glows<br>
        rod in hand: <kbd>LMB</kbd> cast/strike · <kbd>R</kbd> reel in · fight: <kbd>Space</kbd> reel, <kbd>A/D</kbd> lean<br>
        <kbd>M</kbd> chart · <kbd>Esc</kbd> menu · at the wheel: <kbd>W/S</kbd> throttle, <kbd>A/D</kbd> rudder, <kbd>X</kbd> engine, <kbd>V</kbd> view · <kbd>H</kbd> hide UI · <kbd>F1</kbd> hints
      </div>
      <div class="lock-hint">🖱️ Click the screen to capture the mouse</div>
    `);
    document.body.appendChild(root);
    this.root = root;

    this.elMoney = root.querySelector<HTMLElement>('.money .m')!;
    this.elClock = root.querySelector<HTMLElement>('.clock .t')!;
    const elDay = root.querySelector<HTMLElement>('.clock .d')!;
    this.elWeather = root.querySelector<HTMLElement>('.wrow .w')!;
    this.elZone = root.querySelector<HTMLElement>('.wrow .zone')!;
    this.elSail = root.querySelector<HTMLElement>('.sailrow')!;
    this.elFuel = root.querySelector<HTMLElement>('.bar.fuel > i')!;
    this.elFuelN = root.querySelectorAll<HTMLElement>('.bar-num')[0]!;
    this.elHull = root.querySelector<HTMLElement>('.bar.hull > i')!;
    this.elHullBar = root.querySelector<HTMLElement>('.bar.hull')!;
    this.elHullN = root.querySelectorAll<HTMLElement>('.bar-num')[1]!;
    this.elEnergy = root.querySelector('.bar.energy > i')!;
    this.elEnergyN = root.querySelectorAll<HTMLElement>('.bar-num')[2]!;
    this.elHold = root.querySelector('.hold-chip .h')!;
    this.elPrompt = root.querySelector('.prompt')!;
    this.elPromptText = root.querySelector('.prompt .ptext')!;
    this.elPromptKey = root.querySelector('.prompt kbd')!;
    this.elAction = root.querySelector('.action-progress')!;
    this.elActionLabel = this.elAction.querySelector('.ap-label')!;
    this.elActionFill = this.elAction.querySelector('.bar > i')!;
    this.elFight = root.querySelector('.fight-ui')!;
    this.elFishName = this.elFight.querySelector('.fish-name')!;
    this.elTension = this.elFight.querySelector('.tension-bar > i')!;
    this.elTensionLimit = this.elFight.querySelector('.tension-bar .limit')!;
    this.elDist = this.elFight.querySelector<HTMLElement>('.tension-label .tval')!;
    this.elDistN = this.elFight.querySelector<HTMLElement>('.distn')!;
    this.elSweet = this.elFight.querySelector<HTMLElement>('.tension-bar .sweet')!;
    this.elStamina = this.elFight.querySelector<HTMLElement>('.stamina-bar > i')!;
    this.elLean = this.elFight.querySelector<HTMLElement>('.lean-dot')!;
    this.elPullL = this.elFight.querySelector<HTMLElement>('.pull-arrow.left')!;
    this.elPullR = this.elFight.querySelector<HTMLElement>('.pull-arrow.right')!;
    this.elFightStatus = this.elFight.querySelector<HTMLElement>('.fight-status')!;
    this.elStrain = this.elFight.querySelector<HTMLElement>('.strain-bar > i')!;
    this.elKeyA = this.elFight.querySelector<HTMLElement>('.lk-a')!;
    this.elKeyD = this.elFight.querySelector<HTMLElement>('.lk-d')!;
    this.elPromptBar = root.querySelector<HTMLElement>('.prompt .pbar > i')!;
    this.elSpot = root.querySelector<HTMLElement>('.fish-spot')!;
    this.elCast = root.querySelector<HTMLElement>('.cast-ui')!;
    this.elCastFill = this.elCast.querySelector<HTMLElement>('.cast-bar > i')!;
    this.elCastSweet = this.elCast.querySelector<HTMLElement>('.cast-sweet')!;
    this.elFishStatus = root.querySelector<HTMLElement>('.fish-status')!;
    this.toasts = root.querySelector('.toasts')!;
    this.hintEl = root.querySelector('.controls-hint')!;
    this.elLockHint = root.querySelector('.lock-hint')!;
    this.compass = root.querySelector<HTMLCanvasElement>('.compass-strip');
    this.compassCtx = this.compass?.getContext('2d') ?? null;
    this.setupCompassDpi();
    this.elRoster = root.querySelector('.roster')!;
    this.elChatLog = root.querySelector('.chat-log')!;
    this.elChatInput = root.querySelector('.chat-input')!;
    this.elChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = this.elChatInput.value;
        this.elChatInput.value = '';
        this.closeChat();
        if (v.trim()) this.chatSend?.(v);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
      e.stopPropagation();
    });
    this.elChatInput.addEventListener('blur', () => this.closeChat());
    this.barRows = [...root.querySelectorAll<HTMLElement>('.hud-tl .bar-row')];
    this.elTitle = root.querySelector('.title-card')!;
    this.elCatch = root.querySelector('.catch-slot')!;
    this.chipPort = root.querySelector('#chip-port')!;
    this.chipWp = root.querySelector('#chip-wp')!;
    this.chipAnchor = root.querySelector('#chip-anchor')!;
    this.chipInstr = root.querySelector('#chip-instr')!;
    this._day = elDay;
  }

  /** гострий канвас компаса під devicePixelRatio (CSS 300×36) */
  private setupCompassDpi() {
    const c = this.compass;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = 300 * dpr;
    c.height = 36 * dpr;
    c.style.width = '300px';
    c.style.height = '36px';
    this.compassCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private night = false;
  private hintStart = 0;
  private hintEl2: HTMLElement | null = null;

  /** HUD у нічних тонах (темні картки, світлий текст) */
  /** попередження: в морі без страховки (з ризиком) */
  setInsWarn(text: string | null) {
    const el = (this.insChip ??= document.querySelector<HTMLElement>('.ins-chip'));
    if (!el) return;
    el.classList.toggle('show', !!text);
    if (text) el.textContent = text;
  }
  private insChip: HTMLElement | null = null;

  setNight(v: boolean) {
    if (v === this.night) return;
    this.night = v;
    this.root.classList.toggle('night', v);
  }

  private photoEl: HTMLElement | null = null;

  /** підказка фото-режиму (поза #hud, бо той схований) */
  photoHint(on: boolean) {
    if (!this.photoEl) {
      this.photoEl = document.createElement('div');
      this.photoEl.className = 'photo-hint';
      this.photoEl.innerHTML = L('<b>Фото</b> · миша — обертати · коліщатко — відстань · <kbd>P</kbd> — вийти', `<b>Photo</b> · mouse — orbit · wheel — distance · <kbd>P</kbd> — exit`);
      document.body.appendChild(this.photoEl);
    }
    this.photoEl.classList.toggle('show', on);
  }

  /** H — сховати весь HUD (фото / кіно) */
  setHidden(v: boolean) {
    this.root.classList.toggle('hidden', v);
  }

  get hidden(): boolean {
    return this.root.classList.contains('hidden');
  }

  /** підказка керування: показати на кілька секунд (старт гри), далі зникає */
  flashHints(seconds = 25) {
    this.hintStart = performance.now() + seconds * 1000;
    this.hintEl2 ??= this.root.querySelector('.controls-hint');
    this.hintEl2?.classList.remove('faded');
  }

  private _day!: HTMLElement;
  private elPromptText!: HTMLElement;
  private elPromptKey!: HTMLElement;
  private elLockHint!: HTMLElement;
  private lastMoney = -1;
  private lastClock = '';
  private lockHintShown = false;

  /** шкала закиду (null — сховати) і коротке повідомлення риболовлі поза боротьбою */
  setCast(power: number | null, status: string, sweet = { lo: 0.78, hi: 0.95 }) {
    this.elCast.classList.toggle('show', power != null);
    if (power != null) {
      this.elCastFill.style.left = power * 100 + '%';
      this.elCastSweet.style.left = sweet.lo * 100 + '%';
      this.elCastSweet.style.width = (sweet.hi - sweet.lo) * 100 + '%';
      this.elCast.classList.toggle('good', power >= sweet.lo && power <= sweet.hi);
    }
    const show = !!status && !this.elFight.classList.contains('show');
    this.elFishStatus.textContent = show ? status : '';
    this.elFishStatus.classList.toggle('show', show);
  }

  /** підказка про місце лову, поки вудка у воді (null — сховати) */
  setFishSpot(text: string | null) {
    const t = text ?? '';
    if (t === this.lastSpot) return;
    this.lastSpot = t;
    if (t) this.elSpot.textContent = t;
    this.elSpot.classList.toggle('show', !!t);
  }

  update(game: GameState, time: TimeCycle, weather: Weather, boatPos: { x: number; z: number }, extra: {
    prompt?: string | null;
    promptKey?: string;
    promptBite?: boolean;
    /** скільки лишилось часу на підсічку 0..1 */
    promptBiteLeft?: number | null;
    actionLabel?: string | null;
    actionProgress?: number;
    fight?: FightHud | null;
    heading?: number;
    speedKn?: number;
    sail?: string | null;
  }) {
    if (this.hintStart && performance.now() > this.hintStart) {
      this.hintStart = 0;
      this.hintEl2?.classList.add('faded');
    }
    if (game.money !== this.lastMoney) {
      this.elMoney.textContent = Math.round(game.money).toLocaleString(L('uk-UA', 'en-GB'));
      this.lastMoney = game.money;
    }
    const clock = formatTime(time.hours);
    if (clock !== this.lastClock) {
      this.elClock.textContent = clock;
      this._day.textContent = L(`День ${time.dayCount}`, `Day ${time.dayCount}`);
      this.lastClock = clock;
    }
    const ws = weather.state();
    const bf = weather.beaufort;
    const wName = L(`${W_NAMES[ws]} · ${bf.b} б.`, `${W_NAMES[ws]} · Bf ${bf.b}`);
    this.elWeather.title = L(`${bf.b} балів за Бофортом — ${bf.name}, ${weather.windMs.toFixed(0)} м/с`, `Beaufort ${bf.b} — ${bf.name}, ${weather.windMs.toFixed(0)} m/s`);
    if (this.elWeather.textContent !== wName) this.elWeather.textContent = wName;
    this.elWeather.className = 'w' + (ws === 'storm' ? ' weather-storm' : '');
    this.elZone.textContent = ZONE_NAMES[zoneFromDist(Math.hypot(boatPos.x, boatPos.z))];
    const sail = extra.sail ?? '';
    if (sail !== this.lastSail) {
      this.elSail.textContent = sail;
      this.elSail.style.display = sail ? '' : 'none';
      this.lastSail = sail;
    }

    // «тихий» HUD: смужка видна, коли значення низьке або щойно змінилось
    const now = performance.now();
    const quiet = (i: number, v: number, low: number) => {
      const st = this.barState[i];
      if (Math.abs(v - st.v) > 2) {
        st.v = v;
        st.t = now;
      }
      const show = v < low || now - st.t < 4000;
      if (show !== st.shown) {
        st.shown = show;
        this.barRows[i].classList.toggle('quiet', !show);
      }
    };
    quiet(0, (game.fuel / game.maxFuel) * 100, 45);
    quiet(1, (game.hull / game.maxHull) * 100, 70);
    quiet(2, game.energy, 40);

    const fuelPct = (game.fuel / game.maxFuel) * 100;
    this.elFuel.style.width = fuelPct + '%';
    this.elFuelN.textContent = L(`${Math.round(game.fuel)} л`, `${Math.round(game.fuel)} l`);
    const hullPct = (game.hull / game.maxHull) * 100;
    this.elHull.style.width = hullPct + '%';
    this.elHullBar.className = 'bar hull' + (hullPct < 30 ? ' low' : '');
    this.elHullN.textContent = `${Math.round(game.hull)}`;
    this.elEnergy.style.width = game.energy + '%';
    this.elEnergyN.textContent = `${Math.round(game.energy)}`;
    this.elHold.textContent = `${game.hold.length}/${game.holdCap}`;

    // промпт
    if (extra.prompt) {
      this.elPrompt.classList.add('show');
      this.elPrompt.classList.toggle('bite', !!extra.promptBite);
      const left = extra.promptBiteLeft;
      this.elPrompt.classList.toggle('timed', left != null);
      if (left != null) this.elPromptBar.style.width = (left * 100).toFixed(1) + '%';
      this.elPromptText.textContent = extra.prompt;
      const k = extra.promptKey ?? 'E';
      if (this.elPromptKey.textContent !== k) this.elPromptKey.textContent = k;
      this.elPromptKey.style.display = k ? '' : 'none';
    } else {
      this.elPrompt.classList.remove('show', 'bite', 'timed');
    }

    // прогрес станції
    if (extra.actionLabel) {
      this.elAction.classList.add('show');
      this.elActionLabel.textContent = extra.actionLabel;
      this.elActionFill.style.width = (extra.actionProgress ?? 0) * 100 + '%';
    } else {
      this.elAction.classList.remove('show');
    }

    // боротьба
    if (extra.fight) {
      this.elFight.classList.add('show');
      this.elFishName.textContent = extra.fight.name;
      this.elTension.style.left = extra.fight.tension + '%';
      this.elTensionLimit.style.left = extra.fight.limit + '%';
      this.elDist.textContent = Math.round(extra.fight.tension) + ' %';
      this.elDistN.textContent = Math.round(extra.fight.dist) + L(' м', ` m`);
      const f = extra.fight;
      this.elSweet.style.left = f.lo + '%';
      this.elSweet.style.width = f.hi - f.lo + '%';
      const inSweet = f.tension >= f.lo && f.tension <= f.hi;
      this.elFight.classList.toggle('sweet-on', inSweet);
      this.elFight.classList.toggle('danger', f.tension > f.limit - 6);
      this.elFight.classList.toggle('jump', f.jump);
      this.elStamina.style.width = Math.round(f.stamina * 100) + '%';
      this.elLean.style.left = 50 + f.lean * 42 + '%';
      // стрілка — куди рветься риба; підсвічена «правильна» сторона нахилу
      this.elPullL.classList.toggle('on', f.pull < 0);
      this.elPullR.classList.toggle('on', f.pull > 0);
      this.elFight.classList.toggle('countered', f.pull !== 0 && f.lean * f.pull < -0.5);
      // ривок, що готується, — блимає заздалегідь
      this.elPullL.classList.toggle('warn', f.windup < 0);
      this.elPullR.classList.toggle('warn', f.windup > 0);
      // яку клавішу тримати: навпроти ривка
      const need = f.pull !== 0 ? f.pull : f.windup;
      this.elKeyA.classList.toggle('need', need > 0);
      this.elKeyD.classList.toggle('need', need < 0);
      this.elKeyA.classList.toggle('held', f.lean < -0.5);
      this.elKeyD.classList.toggle('held', f.lean > 0.5);
      this.elFight.classList.toggle('jumpwarn', f.jumpWarn);
      this.elFight.classList.toggle('straining', f.strain > 0);
      this.elStrain.style.width = (f.strain * 100).toFixed(1) + '%';
      this.elFight.classList.toggle('coach', f.coach);
      this.elFight.classList.toggle('trophy', f.trophy);
      this.elFightStatus.textContent = f.status;
    } else {
      this.elFight.classList.remove('show');
    }

    // навігація: компасна стрічка + чіпи до порту/точки
    this.drawCompass(extra.heading ?? 0, boatPos, game.waypoint, weather.windDir, weather.wind);
    this.updateNavChips(boatPos, game.waypoint);
  }

  /** азимут у градусах: 0 = північ (-Z), за годинниковою стрілкою */
  private static bearing(fx: number, fz: number, tx: number, tz: number): number {
    let b = (Math.atan2(tx - fx, -(tz - fz)) * 180) / Math.PI;
    if (b < 0) b += 360;
    return b;
  }

  private static fmtDist(d: number): string {
    return d >= 1000 ? (d / 1000).toFixed(1).replace('.', L(',', '.')) + L(' км', ` km`) : Math.round(d) + L(' м', ` m`);
  }

  /** компасна стрічка: шкала курсу, рубка-лінія, маркери порту й точки */
  private drawCompass(headingRad: number, boat: { x: number; z: number }, wp: { x: number; z: number } | null, windDir = 0, wind = 0) {
    const c = this.compassCtx;
    if (!c || !this.compass) return;
    const w = 300; // логічний розмір (dpr закладений у transform)
    const h = 36;
    const d0 = compassDeg(headingRad);
    const ink = this.night ? '250,244,232' : '34,48,59';
    c.clearRect(0, 0, w, h);
    const pxPerDeg = w / 180; // ±90° по боках
    const cx = w / 2;
    const base = h - 12;
    const P8 = [L('П', `N`), L('ПСх', `NE`), L('Сх', `E`), L('СхПд', `SE`), L('Пд', `S`), L('ПдЗх', `SW`), L('Зх', `W`), L('ЗхП', `NW`)];
    const wrap = (a: number) => {
      // різниця кутів у діапазоні −180..180 (раніше без −180 — стрічка показувала зворотний курс)
      return ((a - d0 + 540) % 360) - 180;
    };
    // риска
    for (let a = 0; a < 360; a += 5) {
      const d = wrap(a);
      if (Math.abs(d) > 92) continue;
      const x = cx + d * pxPerDeg;
      const major = a % 45 === 0;
      const mid = a % 15 === 0;
      c.strokeStyle = `rgba(${ink},${major ? 0.9 : mid ? 0.55 : 0.3})`;
      c.lineWidth = major ? 2 : 1;
      c.beginPath();
      c.moveTo(x, base);
      c.lineTo(x, base - (major ? 14 : mid ? 10 : 6));
      c.stroke();
      if (major) {
        c.font = '800 10.5px Manrope, -apple-system, "Segoe UI", sans-serif';
        c.fillStyle = `rgba(${ink},0.9)`;
        c.textAlign = 'center';
        c.fillText(P8[a / 45], x, base - 17);
      }
    }
    // маркер порту (трикутник)
    const drawMark = (brg: number, color: string, flag: boolean) => {
      const d = wrap(brg);
      if (Math.abs(d) > 92) return;
      const x = cx + d * pxPerDeg;
      c.fillStyle = color;
      if (flag) {
        // прапор
        c.fillRect(x, 1, 1.5, 9);
        c.beginPath();
        c.moveTo(x + 1.5, 1);
        c.lineTo(x + 9, 3.5);
        c.lineTo(x + 1.5, 6);
        c.closePath();
        c.fill();
      } else {
        c.beginPath();
        c.moveTo(x, 3);
        c.lineTo(x + 4, 10);
        c.lineTo(x - 4, 10);
        c.closePath();
        c.fill();
      }
    };
    drawMark(Hud.bearing(boat.x, boat.z, this.navPort.x, this.navPort.z), '#e39a2d', false);
    if (wp) drawMark(Hud.bearing(boat.x, boat.z, wp.x, wp.z), this.night ? '#7fd6cc' : '#24878c', true);
    // рибошукач: куди найближча зграя (риб'ячий значок)
    if (this.instr.lvl >= 4 && this.instr.fishBrg != null) {
      const d = wrap(this.instr.fishBrg);
      if (Math.abs(d) <= 92) {
        const x = cx + d * pxPerDeg;
        c.fillStyle = this.night ? '#ffd34d' : '#d08a0c';
        c.beginPath();
        c.ellipse(x - 1, 6, 4.5, 2.6, 0, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.moveTo(x + 2.5, 6);
        c.lineTo(x + 6.5, 3);
        c.lineTo(x + 6.5, 9);
        c.closePath();
        c.fill();
      }
    }
    // вітер: звідки дме (стрілка вниз, «у тебе»), довжина — сила
    {
      const from = ((windDir * 180) / Math.PI + 180 + 360) % 360;
      const dRaw = wrap(from);
      // ззаду — притискаємо до краю стрічки (блідіше)
      const behind = Math.abs(dRaw) > 88;
      const d = behind ? Math.sign(dRaw) * 86 : dRaw;
      {
        const x = cx + d * pxPerDeg;
        c.globalAlpha = behind ? 0.45 : 1;
        const L = 5 + wind * 6;
        c.strokeStyle = c.fillStyle = this.night ? '#9ec9ff' : '#3a76c4';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x, 1);
        c.lineTo(x, 1 + L);
        c.stroke();
        c.beginPath();
        c.moveTo(x, 4 + L);
        c.lineTo(x + 3.5, L - 1);
        c.lineTo(x - 3.5, L - 1);
        c.closePath();
        c.fill();
        c.globalAlpha = 1;
      }
    }
    // рубка-лінія (курсова риска)
    c.strokeStyle = '#e2674a';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx, 2);
    c.lineTo(cx, base);
    c.stroke();
    c.fillStyle = '#e2674a';
    c.beginPath();
    c.moveTo(cx, 2);
    c.lineTo(cx + 5, -2);
    c.lineTo(cx - 5, -2);
    c.closePath();
    c.fill();
  }

  /** найближча відома гавань (задає main): компас і чіп ведуть до неї */
  navPort: { x: number; z: number; name: string; home: boolean } = { x: MOOR.x, z: MOOR.z, name: L('Шторм', `Storm Harbour`), home: true };

  /** чіпи: 🏠/⚓ до найближчої гавані, ⚑ до точки */
  private updateNavChips(boat: { x: number; z: number }, wp: { x: number; z: number } | null) {
    const np = this.navPort;
    const bPort = Hud.bearing(boat.x, boat.z, np.x, np.z);
    const dPort = Math.hypot(boat.x - np.x, boat.z - np.z);
    const ic = np.home ? '🏠' : '⚓';
    // у шварту курс сенсу не має — показуємо лише факт
    const tPort = dPort < 5 ? L(`${ic} у шварту${np.home ? '' : ` · ${np.name}`}`, `${ic} moored${np.home ? '' : ` · ${np.name}`}`) : `${ic} ${np.home ? '' : `${np.name} · `}${this.navText(bPort, dPort)}`;
    if (tPort !== this.lastPortChip) {
      this.lastPortChip = tPort;
      this.chipPort.textContent = tPort;
    }
    if (wp) {
      const bWp = Hud.bearing(boat.x, boat.z, wp.x, wp.z);
      const dWp = Math.hypot(wp.x - boat.x, wp.z - boat.z);
      const tWp = `⚑ ${this.navText(bWp, dWp)}`;
      if (tWp !== this.lastWpChip) {
        this.lastWpChip = tWp;
        this.chipWp.textContent = tWp;
      }
      this.chipWp.classList.remove('hidden');
    } else {
      this.chipWp.classList.add('hidden');
    }
    // прилади: швидкість (лаг), глибина й вітер (ехолот/вітромір), риба (сонар), автопілот
    const ins = this.instr;
    const parts: string[] = [];
    // лаг стоїть на тумбі з самого початку (рівень 0)
    parts.push(L(`⛵ ${(ins.speed * 1.944).toFixed(1).replace('.', ',')} вуз`, `⛵ ${(ins.speed * 1.944).toFixed(1)} kn`));
    if (ins.lvl >= 2) parts.push(L(`⇣ ${ins.depth > 240 ? '>250' : ins.depth.toFixed(ins.depth < 10 ? 1 : 0).replace('.', L(',', '.'))} м`, `⇣ ${ins.depth > 240 ? '>250' : ins.depth.toFixed(ins.depth < 10 ? 1 : 0).replace('.', L(',', '.'))} m`), L(`🌬 ${Math.round(ins.wind)} м/с`, `🌬 ${Math.round(ins.wind)} m/s`));
    else if (ins.lvl >= 1 && ins.falling) parts.push(L('🌡 тиск падає', `🌡 pressure falling`));
    if (ins.lvl >= 4) parts.push(ins.fish > 0.62 ? L('🐟 густо', `🐟 dense`) : ins.fish > 0.32 ? L('🐟 помірно', `🐟 moderate`) : L('🐟 рідко', `🐟 sparse`));
    if (ins.autopilot) parts.push(L('🤖 АВТО', `🤖 AUTO`));
    const tI = parts.join(' · ');
    if (tI !== this.lastInstrChip) {
      this.lastInstrChip = tI;
      this.chipInstr.textContent = tI;
      this.chipInstr.classList.toggle('hidden', !tI);
      this.chipInstr.classList.toggle('alarm', ins.lvl >= 2 && ins.depth < 4.5);
    }
  }

  /** курс і відстань: з GPS — точно (+ час ходу), без нього — румб і «≈» */
  private navText(brg: number, d: number): string {
    const ins = this.instr;
    if (ins.lvl >= 3) {
      const eta = ins.speed > 0.5 ? d / ins.speed / 60 : null;
      return `${String(Math.round(brg) % 360).padStart(3, '0')}° · ${Hud.fmtDist(d)}${eta != null && eta < 600 ? L(` · ${eta < 1 ? '<1' : Math.round(eta)} хв`, ` · ${eta < 1 ? '<1' : Math.round(eta)} min`) : ''}`;
    }
    const P = [L('П', `N`), L('ПнСх', `NE`), L('Сх', `E`), L('ПдСх', `SE`), L('Пд', `S`), L('ПдЗх', `SW`), L('Зх', `W`), L('ПнЗх', `NW`)];
    const rough = d < 1000 ? L(`≈${Math.max(100, Math.round(d / 100) * 100)} м`, `≈${Math.max(100, Math.round(d / 100) * 100)} m`) : L(`≈${(Math.round(d / 500) / 2).toFixed(1).replace('.', L(',', '.'))} км`, `≈${(Math.round(d / 500) / 2).toFixed(1).replace('.', L(',', '.'))} km`);
    return `${P[Math.round(brg / 45) % 8]} · ${rough}`;
  }

  /** чіп якоря: «⚓ на якорі · 18 м ланцюга» (null — сховати); warn — якір повзе */
  setAnchorChip(text: string | null, warn = false) {
    const key = (text ?? '') + (warn ? '!' : '');
    if (key === this.lastAnchorChip) return;
    this.lastAnchorChip = key;
    this.chipAnchor.textContent = text ?? '';
    this.chipAnchor.classList.toggle('hidden', !text);
    this.chipAnchor.classList.toggle('warn', warn);
  }

  toast(text: string, kind: 'good' | 'bad' | 'warn' = 'good', ms = 3200) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 450);
    }, ms);
    // не більше 4 одночасно
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
  }

  private goalKey = '';

  /** картка «що далі» (навчання); null — сховати */
  setGoal(text: string | null, step = 0, total = 0) {
    const key = text ? `${step}:${text}` : '';
    if (key === this.goalKey) return;
    this.goalKey = key;
    const el = this.root.querySelector<HTMLElement>('.goal')!;
    el.classList.toggle('show', !!text);
    if (!text) return;
    el.querySelector('.g-step')!.textContent = L(`Крок ${step}/${total}`, `Step ${step}/${total}`);
    el.querySelector('.g-text')!.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  /** великий напис посеред екрана (нова зона, світанок) — як назви місць у дорожніх іграх */
  titleCard(title: string, sub = '') {
    this.elTitle.replaceChildren();
    const t = document.createElement('div');
    t.className = 'tc-title';
    t.textContent = title;
    this.elTitle.append(t);
    if (sub) {
      const s2 = document.createElement('div');
      s2.className = 'tc-sub';
      s2.textContent = sub;
      this.elTitle.append(s2);
    }
    this.elTitle.classList.remove('show');
    void this.elTitle.offsetWidth; // перезапуск анімації
    this.elTitle.classList.add('show');
  }

  /** листівка улову: силует риби, вага, «новий вид» */
  catchCard(name: string, kg: number, speciesId: string, isNew: boolean, note = '', trophy = false, record = false) {
    const el = document.createElement('div');
    el.className = 'catch-card' + (isNew ? ' new' : '') + (trophy ? ' trophy' : record ? ' record' : '');
    const cv = document.createElement('canvas');
    cv.width = 168;
    cv.height = 84;
    drawFish(cv, speciesId);
    const info = document.createElement('div');
    info.className = 'cc-info';
    const badge = document.createElement('div');
    badge.className = 'cc-badge';
    badge.textContent = trophy ? (record ? L('🏆 Трофей · рекорд!', `🏆 Trophy · record!`) : L('🏆 Трофей!', `🏆 Trophy!`)) : isNew ? L('Новий вид!', `New species!`) : record ? L('Рекорд виду!', `Species record!`) : L('Улов', `Catch`);
    const nm = document.createElement('div');
    nm.className = 'cc-name';
    nm.textContent = name;
    const w = document.createElement('div');
    w.className = 'cc-kg';
    w.textContent = L(`${kg.toFixed(2).replace('.', L(',', '.'))} кг${note ? ' · ' + note : ''}`, `${kg.toFixed(2).replace('.', L(',', '.'))} kg${note ? ' · ' + note : ''}`);
    info.append(badge, nm, w);
    el.append(cv, info);
    this.elCatch.replaceChildren(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 500);
    }, trophy ? 6500 : isNew ? 5200 : 3600);
  }

  // ── кооп: екіпаж і чат ──

  /** список гравців у кімнаті (порожній — сховати) */
  setRoster(list: Array<{ nick: string; color: string; host: boolean; me: boolean }>) {
    const key = list.map((p) => p.nick + p.color + p.host).join('|');
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    this.elRoster.classList.toggle('show', list.length > 0);
    this.elRoster.replaceChildren(
      ...list.map((p) => {
        const row = document.createElement('div');
        row.className = 'roster-row' + (p.me ? ' me' : '');
        const dot = document.createElement('i');
        dot.style.background = p.color;
        const name = document.createElement('span');
        name.textContent = p.nick + (p.host ? ' ⚓' : '');
        row.append(dot, name);
        return row;
      }),
    );
  }

  chatLine(nick: string, text: string, color: string) {
    const row = document.createElement('div');
    row.className = 'chat-line';
    const n = document.createElement('b');
    n.style.color = color;
    n.textContent = nick + ': ';
    const t = document.createElement('span');
    t.textContent = text;
    row.append(n, t);
    this.elChatLog.appendChild(row);
    while (this.elChatLog.children.length > 8) this.elChatLog.firstChild?.remove();
    // рядок гасне за 12 с (поки чат закритий)
    setTimeout(() => row.classList.add('old'), 12000);
  }

  get chatOpen(): boolean {
    return this.root.classList.contains('chatting');
  }

  openChat(send: (text: string) => void) {
    this.chatSend = send;
    this.root.classList.add('chatting');
    // фокус після поточного keydown (інакше Enter одразу «надішле» порожнє)
    setTimeout(() => this.elChatInput.focus(), 0);
  }

  private closeChat() {
    this.root.classList.remove('chatting');
    if (document.activeElement === this.elChatInput) this.elChatInput.blur();
  }

  /** підказка «клікни, щоб захопити мишу», коли граємо без pointer lock */
  setLockHint(show: boolean) {
    if (show === this.lockHintShown) return;
    this.lockHintShown = show;
    this.elLockHint.classList.toggle('show', show);
  }

  hideHint() {
    this.hintEl.style.display = 'none';
  }

  rootEl(): HTMLElement {
    return this.root;
  }
}

// ── силует риби для листівки улову (канвас, без асетів) ──
const FISH_LOOK: Record<string, { top: string; belly: string; long: number; tall: number; fin?: 'shark' | 'tuna' | 'flat' }> = {
  hamsa: { top: '#6f8fa6', belly: '#e6eef2', long: 0.9, tall: 0.42 },
  balyk: { top: '#4f7896', belly: '#e9f0f2', long: 1, tall: 0.46 },
  leschak: { top: '#8a7458', belly: '#e8dccb', long: 0.8, tall: 0.78, fin: 'flat' },
  plyotka: { top: '#5d6670', belly: '#e9e6e0', long: 1, tall: 0.5 },
  makrel: { top: '#2f6f7a', belly: '#eef2ee', long: 1.05, tall: 0.44 },
  sula: { top: '#3f4d5a', belly: '#cfd6da', long: 1.05, tall: 0.48 },
  krap: { top: '#c8543c', belly: '#f2cfa8', long: 0.95, tall: 0.6 },
  forel: { top: '#5f7488', belly: '#f1d6c8', long: 1.05, tall: 0.5 },
  lusk: { top: '#7a7454', belly: '#ece6cf', long: 1.05, tall: 0.55 },
  shoraga: { top: '#5a5246', belly: '#eee8dc', long: 0.95, tall: 0.7, fin: 'flat' },
  tunets: { top: '#24466e', belly: '#d9e2ea', long: 1.05, tall: 0.6, fin: 'tuna' },
  akula: { top: '#6d7b86', belly: '#e8ecee', long: 1.1, tall: 0.42, fin: 'shark' },
};

function drawFish(cv: HTMLCanvasElement, id: string) {
  const g = cv.getContext('2d')!;
  const L = FISH_LOOK[id] ?? FISH_LOOK.balyk;
  const W = cv.width, H = cv.height;
  const cx = W * 0.45, cy = H * 0.52;
  const rx = W * 0.33 * L.long, ry = H * 0.42 * L.tall;
  const grad = g.createLinearGradient(0, cy - ry, 0, cy + ry);
  grad.addColorStop(0, L.top);
  grad.addColorStop(0.55, L.top);
  grad.addColorStop(0.62, L.belly);
  grad.addColorStop(1, L.belly);
  g.fillStyle = grad;
  // хвіст
  g.beginPath();
  g.moveTo(cx + rx * 0.82, cy);
  g.lineTo(cx + rx * 1.35, cy - ry * (L.fin === 'tuna' || L.fin === 'shark' ? 1.15 : 0.8));
  g.quadraticCurveTo(cx + rx * 1.18, cy, cx + rx * 1.35, cy + ry * (L.fin === 'shark' ? 0.6 : 0.8));
  g.closePath();
  g.fill();
  // спинний плавець
  g.fillStyle = L.top;
  g.beginPath();
  const fh = L.fin === 'shark' ? 1.25 : L.fin === 'flat' ? 0.35 : 0.6;
  g.moveTo(cx - rx * 0.2, cy - ry * 0.9);
  g.quadraticCurveTo(cx + rx * 0.05, cy - ry * (0.9 + fh), cx + rx * 0.35, cy - ry * 0.8);
  g.closePath();
  g.fill();
  // тіло
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(cx - rx, cy);
  g.bezierCurveTo(cx - rx * 0.7, cy - ry * 1.15, cx + rx * 0.6, cy - ry * 1.05, cx + rx * 0.9, cy);
  g.bezierCurveTo(cx + rx * 0.6, cy + ry * 1.05, cx - rx * 0.7, cy + ry * 1.1, cx - rx, cy);
  g.fill();
  // зябра й око
  g.strokeStyle = 'rgba(30,40,50,0.35)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(cx - rx * 0.45, cy, ry * 0.55, -0.9, 0.9);
  g.stroke();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(cx - rx * 0.72, cy - ry * 0.22, Math.max(3, ry * 0.16), 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1d2630';
  g.beginPath();
  g.arc(cx - rx * 0.74, cy - ry * 0.22, Math.max(1.6, ry * 0.09), 0, Math.PI * 2);
  g.fill();
}
