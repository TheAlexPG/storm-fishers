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
  private elRoster!: HTMLElement;
  private elChatLog!: HTMLElement;
  private elChatInput!: HTMLInputElement;
  private chatSend: ((text: string) => void) | null = null;
  private rosterKey = '';
  private elTitle!: HTMLElement;
  private elCatch!: HTMLElement;

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
        <div class="roster hud-card"></div>
      </div>
      <div class="chat">
        <div class="chat-log"></div>
        <input class="chat-input" maxlength="160" autocomplete="off" spellcheck="false" placeholder="Повідомлення екіпажу… (Enter — надіслати, Esc — закрити)">
      </div>
      <div class="toasts"></div>
      <div class="title-card"></div>
      <div class="catch-slot"></div>
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
        <kbd>M</kbd> карта · <kbd>Esc</kbd> меню · у штурвалі: <kbd>W/S</kbd> газ, <kbd>A/D</kbd> кермо, <kbd>V</kbd> вигляд · паруси — <kbd>E</kbd> біля щогли<br>
        у воді: <kbd>Space</kbd> спливти, <kbd>C</kbd> пірнути · <kbd>H</kbd> сховати інтерфейс
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
    this.elTitle = root.querySelector('.title-card')!;
    this.elCatch = root.querySelector('.catch-slot')!;
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

  private night = false;
  private hintStart = 0;
  private hintEl2: HTMLElement | null = null;

  /** HUD у нічних тонах (темні картки, світлий текст) */
  setNight(v: boolean) {
    if (v === this.night) return;
    this.night = v;
    this.root.classList.toggle('night', v);
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
    if (this.hintStart && performance.now() > this.hintStart) {
      this.hintStart = 0;
      this.hintEl2?.classList.add('faded');
    }
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
    const ink = this.night ? '250,244,232' : '34,48,59';
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
    drawMark(Hud.bearing(boat.x, boat.z, MOOR.x, MOOR.z), '#e39a2d', false);
    if (wp) drawMark(Hud.bearing(boat.x, boat.z, wp.x, wp.z), this.night ? '#7fd6cc' : '#24878c', true);
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
  catchCard(name: string, kg: number, speciesId: string, isNew: boolean, note = '') {
    const el = document.createElement('div');
    el.className = 'catch-card' + (isNew ? ' new' : '');
    const cv = document.createElement('canvas');
    cv.width = 168;
    cv.height = 84;
    drawFish(cv, speciesId);
    const info = document.createElement('div');
    info.className = 'cc-info';
    const badge = document.createElement('div');
    badge.className = 'cc-badge';
    badge.textContent = isNew ? 'Новий вид!' : 'Улов';
    const nm = document.createElement('div');
    nm.className = 'cc-name';
    nm.textContent = name;
    const w = document.createElement('div');
    w.className = 'cc-kg';
    w.textContent = `${kg.toFixed(2).replace('.', ',')} кг${note ? ' · ' + note : ''}`;
    info.append(badge, nm, w);
    el.append(cv, info);
    this.elCatch.replaceChildren(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 500);
    }, isNew ? 5200 : 3600);
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
