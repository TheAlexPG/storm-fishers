import { formatMoney, formatTime, compassDeg } from '../core/math';
import { MOOR } from '../world/boat';
import type { GameState } from '../game/state';
import type { TimeCycle } from '../core/time';
import type { Weather } from '../core/weather';
import { ZONE_NAMES, zoneFromDist } from '../game/fish';

// ─────────────────────────────────────────────────────────────
// HUD: DOM-елементи, оновлюються кожен кадр (без пересоздування).
// ─────────────────────────────────────────────────────────────

const W_NAMES: Record<string, string> = {
  calm: '🌤 Тиша',
  breeze: '🍃 Повіє',
  wind: '💨 Вітер',
  storm: '⛈ Шторм',
};

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
  private compass: HTMLCanvasElement | null = null;
  private compassCtx: CanvasRenderingContext2D | null = null;
  private chipPort!: HTMLElement;
  private chipWp!: HTMLElement;
  private lastPortChip = '';
  private lastWpChip = '';
  private toasts: HTMLElement;
  private elSail!: HTMLElement;
  private lastSail = '-';
  private hintEl: HTMLElement;

  constructor() {
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div class="hud-tl hud-card">
        <div class="money"><span class="m">0</span> <small>₴</small></div>
        <div class="bar-row"><span class="bar-label">Паливо</span><div class="bar fuel"><i></i></div><span class="bar-num">0</span></div>
        <div class="bar-row"><span class="bar-label">Корпус</span><div class="bar hull"><i></i></div><span class="bar-num">0</span></div>
        <div class="bar-row"><span class="bar-label">Енергія</span><div class="bar energy"><i></i></div><span class="bar-num">0</span></div>
      </div>
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
        </div>
      </div>
      <div class="hud-tr">
        <div class="hold-chip hud-card">🐟 Трюм <b class="h">0/8</b></div>
      </div>
      <div class="toasts"></div>
      <div class="prompt"><kbd>E</kbd><span class="ptext"></span></div>
      <div class="action-progress"><div class="ap-label"></div><div class="bar"><i></i></div></div>
      <div class="fight-ui">
        <div class="fish-name"></div>
        <div class="tension-label"><span>Тяга лінії</span><span class="tval">0 %</span></div>
        <div class="tension-bar"><i></i><div class="limit"></div></div>
        <div class="dist-row"><span>Відстань</span><span class="distn">0 м</span></div>
      </div>
      <div class="controls-hint">
        <kbd>WASD</kbd> рух · <kbd>Миша</kbd> погляд · <kbd>Shift</kbd> біг · <kbd>E</kbd> дія<br>
        <kbd>M</kbd> карта · <kbd>Esc</kbd> меню · у штурвалі: <kbd>W/S</kbd> газ, <kbd>A/D</kbd> рильє · паруси — <kbd>E</kbd> біля щогли<br>
        у воді: <kbd>Space</kbd> сплестись, <kbd>C</kbd> зануритись
      </div>
      <div class="lock-hint">🖱️ Клікни по екрану, щоб захопити мишу</div>
    `;
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
    this.elAction = root.querySelector('.action-progress')!;
    this.elActionLabel = this.elAction.querySelector('.ap-label')!;
    this.elActionFill = this.elAction.querySelector('.bar > i')!;
    this.elFight = root.querySelector('.fight-ui')!;
    this.elFishName = this.elFight.querySelector('.fish-name')!;
    this.elTension = this.elFight.querySelector('.tension-bar > i')!;
    this.elTensionLimit = this.elFight.querySelector('.tension-bar .limit')!;
    this.elDist = this.elFight.querySelector<HTMLElement>('.tension-label .tval')!;
    this.elDistN = this.elFight.querySelector<HTMLElement>('.distn')!;
    this.toasts = root.querySelector('.toasts')!;
    this.hintEl = root.querySelector('.controls-hint')!;
    this.elLockHint = root.querySelector('.lock-hint')!;
    this.compass = root.querySelector<HTMLCanvasElement>('.compass-strip');
    this.compassCtx = this.compass?.getContext('2d') ?? null;
    this.setupCompassDpi();
    this.chipPort = root.querySelector('#chip-port')!;
    this.chipWp = root.querySelector('#chip-wp')!;
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

  private _day!: HTMLElement;
  private elPromptText!: HTMLElement;
  private elLockHint!: HTMLElement;
  private lastMoney = -1;
  private lastClock = '';
  private lockHintShown = false;

  update(game: GameState, time: TimeCycle, weather: Weather, boatPos: { x: number; z: number }, extra: {
    prompt?: string | null;
    promptBite?: boolean;
    actionLabel?: string | null;
    actionProgress?: number;
    fight?: { name: string; tension: number; limit: number; dist: number } | null;
    heading?: number;
    speedKn?: number;
    sail?: string | null;
  }) {
    if (game.money !== this.lastMoney) {
      this.elMoney.textContent = Math.round(game.money).toLocaleString('uk-UA');
      this.lastMoney = game.money;
    }
    const clock = formatTime(time.hours);
    if (clock !== this.lastClock) {
      this.elClock.textContent = clock;
      this._day.textContent = `День ${time.dayCount}`;
      this.lastClock = clock;
    }
    const ws = weather.state();
    const wName = W_NAMES[ws];
    if (this.elWeather.textContent !== wName) this.elWeather.textContent = wName;
    this.elWeather.className = 'w' + (ws === 'storm' ? ' weather-storm' : '');
    this.elZone.textContent = ZONE_NAMES[zoneFromDist(Math.hypot(boatPos.x, boatPos.z))];
    const sail = extra.sail ?? '';
    if (sail !== this.lastSail) {
      this.elSail.textContent = sail;
      this.elSail.style.display = sail ? '' : 'none';
      this.lastSail = sail;
    }

    const fuelPct = (game.fuel / game.maxFuel) * 100;
    this.elFuel.style.width = fuelPct + '%';
    this.elFuelN.textContent = `${Math.round(game.fuel)} л`;
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
      this.elPromptText.textContent = extra.prompt;
    } else {
      this.elPrompt.classList.remove('show', 'bite');
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
      this.elTension.style.width = extra.fight.tension + '%';
      this.elTensionLimit.style.left = extra.fight.limit + '%';
      this.elDist.textContent = Math.round(extra.fight.tension) + ' %';
      this.elDistN.textContent = Math.round(extra.fight.dist) + ' м';
    } else {
      this.elFight.classList.remove('show');
    }

    // навігація: компасна стрічка + чіпи до порту/точки
    this.drawCompass(extra.heading ?? 0, boatPos, game.waypoint);
    this.updateNavChips(boatPos, game.waypoint);
  }

  /** азимут у градусах: 0 = північ (-Z), за годинниковою стрілкою */
  private static bearing(fx: number, fz: number, tx: number, tz: number): number {
    let b = (Math.atan2(tx - fx, -(tz - fz)) * 180) / Math.PI;
    if (b < 0) b += 360;
    return b;
  }

  private static fmtDist(d: number): string {
    return d >= 1000 ? (d / 1000).toFixed(1).replace('.', ',') + ' км' : Math.round(d) + ' м';
  }

  /** компасна стрічка: шкала курсу, рубка-лінія, маркери порту й точки */
  private drawCompass(headingRad: number, boat: { x: number; z: number }, wp: { x: number; z: number } | null) {
    const c = this.compassCtx;
    if (!c || !this.compass) return;
    const w = 300; // логічний розмір (dpr закладений у transform)
    const h = 36;
    const d0 = compassDeg(headingRad);
    c.clearRect(0, 0, w, h);
    const pxPerDeg = w / 180; // ±90° по боках
    const cx = w / 2;
    const base = h - 12;
    const P8 = ['П', 'ПСх', 'Сх', 'СхПд', 'Пд', 'ПдЗх', 'Зх', 'ЗхП'];
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
      c.strokeStyle = major ? 'rgba(255,255,255,0.95)' : mid ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.35)';
      c.lineWidth = major ? 2 : 1;
      c.beginPath();
      c.moveTo(x, base);
      c.lineTo(x, base - (major ? 14 : mid ? 10 : 6));
      c.stroke();
      if (major) {
        c.font = '700 11px -apple-system, "Segoe UI", sans-serif';
        c.fillStyle = 'rgba(255,255,255,0.9)';
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
    drawMark(Hud.bearing(boat.x, boat.z, MOOR.x, MOOR.z), '#ffd980', false);
    if (wp) drawMark(Hud.bearing(boat.x, boat.z, wp.x, wp.z), '#78dcff', true);
    // рубка-лінія (курсова риска)
    c.strokeStyle = '#ff6b5e';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx, 2);
    c.lineTo(cx, base);
    c.stroke();
    c.fillStyle = '#ff6b5e';
    c.beginPath();
    c.moveTo(cx, 2);
    c.lineTo(cx + 5, -2);
    c.lineTo(cx - 5, -2);
    c.closePath();
    c.fill();
  }

  /** чіпи: 🏠 до шварту (дому), ⚑ до точки */
  private updateNavChips(boat: { x: number; z: number }, wp: { x: number; z: number } | null) {
    const bPort = Hud.bearing(boat.x, boat.z, MOOR.x, MOOR.z);
    const dPort = Math.hypot(boat.x - MOOR.x, boat.z - MOOR.z);
    // у шварту курс сенсу не має — показуємо лише факт
    const tPort = dPort < 5 ? '🏠 у шварту' : `🏠 ${String(Math.round(bPort) % 360).padStart(3, '0')}° · ${Hud.fmtDist(dPort)}`;
    if (tPort !== this.lastPortChip) {
      this.lastPortChip = tPort;
      this.chipPort.textContent = tPort;
    }
    if (wp) {
      const bWp = Hud.bearing(boat.x, boat.z, wp.x, wp.z);
      const dWp = Math.hypot(wp.x - boat.x, wp.z - boat.z);
      const tWp = `⚑ ${String(Math.round(bWp) % 360).padStart(3, '0')}° · ${Hud.fmtDist(dWp)}`;
      if (tWp !== this.lastWpChip) {
        this.lastWpChip = tWp;
        this.chipWp.textContent = tWp;
      }
      this.chipWp.classList.remove('hidden');
    } else {
      this.chipWp.classList.add('hidden');
    }
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
