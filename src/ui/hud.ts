import { formatMoney, formatTime } from '../core/math';
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
  private toasts: HTMLElement;
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
        <kbd>M</kbd> мінімапа · <kbd>Esc</kbd> меню · у штурвалі: <kbd>W/S</kbd> газ, <kbd>A/D</kbd> рильє<br>
        у воді: <kbd>Space</kbd> сплестись, <kbd>C</kbd> зануритись
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;

    this.elMoney = root.querySelector<HTMLElement>('.money .m')!;
    this.elClock = root.querySelector<HTMLElement>('.clock .t')!;
    const elDay = root.querySelector<HTMLElement>('.clock .d')!;
    this.elWeather = root.querySelector<HTMLElement>('.wrow .w')!;
    this.elZone = root.querySelector<HTMLElement>('.wrow .zone')!;
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
    this._day = elDay;
  }

  private _day!: HTMLElement;
  private elPromptText!: HTMLElement;
  private lastMoney = -1;
  private lastClock = '';

  update(game: GameState, time: TimeCycle, weather: Weather, boatPos: { x: number; z: number }, extra: {
    prompt?: string | null;
    promptBite?: boolean;
    actionLabel?: string | null;
    actionProgress?: number;
    fight?: { name: string; tension: number; limit: number; dist: number } | null;
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

  hideHint() {
    this.hintEl.style.display = 'none';
  }

  rootEl(): HTMLElement {
    return this.root;
  }
}
