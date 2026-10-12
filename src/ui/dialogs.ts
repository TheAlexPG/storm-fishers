import { formatMoney } from '../core/math';
import { fishSellPrice, FISH_BY_ID, ZONE_NAMES, zoneFromDist } from '../game/fish';
import { UPGRADES, upgradeCost } from '../game/upgrades';
import type { GameState } from '../game/state';
import type { Weather } from '../core/weather';
import type { TimeCycle } from '../core/time';
import type { AudioEngine } from '../core/audio';
import type { Boat } from '../world/boat';
import type { Player } from '../world/player';

// ─────────────────────────────────────────────────────────────
// Оверлеї: вступ, пауза, магазин, радіо.
// ─────────────────────────────────────────────────────────────

type CloseFn = () => void;

export class Dialogs {
  private overlay: HTMLElement;
  private panel: HTMLElement;
  private open = false;
  private closeFn: CloseFn | null = null;
  private escHandler = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && this.open && this.escAllowed) {
      e.preventDefault();
      this.close();
    }
  };

  constructor(private audio: AudioEngine) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    this.overlay.appendChild(this.panel);
    document.body.appendChild(this.overlay);
    window.addEventListener('keydown', this.escHandler);
  }

  get isOpen() {
    return this.open;
  }

  /** escAllowed = чи закривається меню по Esc (у паузі — ні, бо Esc і так виводить з pointer lock) */
  private escAllowed = true;

  private show(html: string, escAllowed: boolean) {
    this.panel.innerHTML = html;
    this.overlay.classList.add('show');
    this.open = true;
    this.escAllowed = escAllowed;
  }

  close() {
    // closeFn — ПЕРСИСТЕНТНИЙ колбек (реєструється один раз у Game),
    // тому його НЕ виводимо в null: інакше після першого закриття
    // (інтро) phase залишався б 'dialog' і світ би застигав.
    if (!this.open) return; // захист від подвійного закриття в одному кадрі
    this.overlay.classList.remove('show');
    this.open = false;
    this.closeFn?.();
  }

  onClose(fn: CloseFn) {
    this.closeFn = fn;
  }

  // ── ВСТУП ──

  intro(hasSave: boolean, onNew: () => void, onContinue: () => void) {
    this.escAllowed = false;
    this.show(`
      <h1 class="intro-title">ШТОРМОВИЙ РИБАЛ</h1>
      <div class="intro-sub">Storm Fishers · pлавне море, жирні хвилі</div>
      <p class="sub">
        Ти — капітан рибальського човна «Шторм». Ходь по палубі, керування барраком,
        ловля риби, рутини, погода і шторми. Продай улов у порту — прокачай човен — вийди далі в море.
      </p>
      <div class="intro-keys">
        <kbd>WASD</kbd><span>рух / у штурвалі — газ і рильє</span>
        <kbd>Миша</kbd><span>погляд</span>
        <kbd>Shift</kbd><span>біг</span>
        <kbd>E</kbd><span>дія: станції, магазин, залізти</span>
        <kbd>Space</kbd><span>боротьба за рибу (тяга) / сплестись у воді</span>
        <kbd>M</kbd><span>карта (штурвальна)</span>
        <kbd>Esc</kbd><span>меню</span>
      </div>
      <div class="btn-row">
        ${hasSave ? '<button class="btn" data-act="continue">Продовжити</button>' : ''}
        <button class="btn primary" data-act="new">Нова гра</button>
      </div>
    `, false);
    this.panel.querySelector('[data-act="new"]')!.addEventListener('click', () => {
      this.audio.resume();
      this.audio.click();
      this.close();
      onNew();
    });
    const cont = this.panel.querySelector('[data-act="continue"]');
    if (cont) {
      cont.addEventListener('click', () => {
        this.audio.resume();
        this.audio.click();
        this.close();
        onContinue();
      });
    }
  }

  // ── ПАУЗА ──

  pause(opts: { onResume: () => void; onReset: () => void; sound: boolean; onToggleSound: () => void; playTime: number }) {
    this.escAllowed = false;
    this.show(`
      <h1 style="font-size:26px">ПАУЗА</h1>
      <p class="sub">Час зупинений. Море чекає.</p>
      <div class="btn-row">
        <button class="btn primary" data-act="resume">Продовжити</button>
        <button class="btn" data-act="sound">Звук: ${opts.sound ? 'вкл' : 'вимк'}</button>
        <button class="btn danger" data-act="reset">Скинути гру</button>
      </div>
      <h2>Керування</h2>
      <div class="intro-keys">
        <kbd>WASD</kbd><span>рух · у штурвалі: W/S газ, A/D рильє</span>
        <kbd>E</kbd><span>станції / магазин / залізти</span>
        <kbd>Space</kbd><span>тяга лінії · у воді — сплестись</span>
        <kbd>M</kbd><span>карта (штурвальна)</span>
      </div>
    `, false);
    this.panel.querySelector('[data-act="resume"]')!.addEventListener('click', () => {
      this.audio.click();
      this.close();
      opts.onResume();
    });
    this.panel.querySelector('[data-act="sound"]')!.addEventListener('click', () => {
      opts.onToggleSound();
      this.panel.querySelector('[data-act="sound"]')!.textContent = `Звук: ${!opts.sound ? 'вкл' : 'вимк'}`;
    });
    this.panel.querySelector('[data-act="reset"]')!.addEventListener('click', () => {
      if (confirm('Точно скинути весь прогрес?')) {
        this.close();
        opts.onReset();
      }
    });
    void opts.playTime;
  }

  // ── МАГАЗИН ──

  shop(game: GameState) {
    this.escAllowed = true;
    const fuelPrice = 20;
    const holdRows = game.hold
      .map((f) => {
        const sp = FISH_BY_ID[f.speciesId];
        const price = fishSellPrice(f, game.priceMult);
        const tags = [
          f.cooked ? '<span class="tag cooked">варена</span>' : '',
          f.storm ? '<span class="tag storm">штормова +25%</span>' : '',
        ].join(' ');
        return `
          <div class="fish-row">
            <span class="fname">${sp?.name ?? f.speciesId} ${tags}</span>
            <span class="fmeta">${f.kg.toFixed(2)} кг · свіжість ${f.cooked ? '—' : Math.round(f.freshness) + '%'}</span>
            <span class="fprice">${formatMoney(price)}</span>
            <button class="btn" data-sell="${f.uid}" style="padding:4px 10px;font-size:12px">Продати</button>
          </div>`;
      })
      .join('');
    const total = game.hold.reduce((a, f) => a + fishSellPrice(f, game.priceMult), 0);

    const upgCards = UPGRADES.map((u) => {
      const lvl = game.upgrades[u.id];
      const cost = upgradeCost(u.id, lvl);
      const pips = Array.from({ length: 5 }, (_, i) => `<div class="pip ${i < lvl ? 'on' : ''}"></div>`).join('');
      const desc = cost != null ? u.desc(lvl + 1) : 'МАКСИМУМ';
      return `
        <div class="upg-card">
          <h3>${u.name} <span style="font-size:12px;opacity:0.6">рів. ${lvl}/5</span></h3>
          <div class="pips">${pips}</div>
          <div class="desc">${desc}</div>
          ${cost != null ? `<button class="btn" data-upg="${u.id}" ${game.money < cost ? 'disabled' : ''} style="width:100%;padding:7px">${formatMoney(cost)}</button>` : '<div style="font-size:12px;color:var(--accent);text-align:center">Повна прокачка ✓</div>'}
        </div>`;
    }).join('');

    this.show(`
      <h1>ПОРТ «ШТОРМ»</h1>
      <p class="sub">Гроші: <b style="color:var(--sun)">${formatMoney(game.money)}</b> · ${game.priceTrendText} · тиж. ${game.priceWeek}</p>
      <h2>🐟 Продаж риби — трюм ${game.hold.length}/${game.holdCap}</h2>
      ${game.hold.length === 0 ? '<p class="sub">Трюм порожній. Час ловити!</p>' : `
        <div class="fish-list">${holdRows}</div>
        <div class="btn-row"><button class="btn primary" data-sellall>Продати все — ${formatMoney(total)}</button></div>
      `}
      <h2>⛽ Сервіс</h2>
      <div class="fish-row">
        <span class="fname">Паливо <span class="fmeta">(${Math.round(game.fuel)}/${game.maxFuel} л · ${fuelPrice} ₴/л)</span></span>
        <button class="btn" data-fuel="10" ${game.money < 200 || game.fuel >= game.maxFuel ? 'disabled' : ''} style="padding:5px 10px;font-size:12.5px">+10 л</button>
        <button class="btn" data-fuel="max" ${game.money < fuelPrice || game.fuel >= game.maxFuel ? 'disabled' : ''} style="padding:5px 10px;font-size:12.5px">Повний бак — ${formatMoney(fuelPrice * (game.maxFuel - game.fuel))}</button>
      </div>
      <div class="fish-row" style="margin-top:6px">
        <span class="fname">Ремонт корпусу <span class="fmeta">(${Math.round(game.hull)}/${game.maxHull})</span></span>
        <button class="btn" data-repair ${game.hull >= game.maxHull || game.money < 100 ? 'disabled' : ''} style="padding:5px 10px;font-size:12.5px">Повний — 100 ₴</button>
      </div>
      <h2>🔧 Апгрейди</h2>
      <div class="upg-grid">${upgCards}</div>
      <div class="btn-row"><button class="btn" data-close>Закрити (Esc)</button></div>
    `, true);

    const refresh = () => this.shop(game);

    this.panel.querySelectorAll('[data-sell]').forEach((b) => {
      b.addEventListener('click', () => {
        game.sellOne(Number((b as HTMLElement).dataset.sell));
        this.audio.click();
        refresh();
      });
    });
    const sa = this.panel.querySelector('[data-sellall]');
    sa?.addEventListener('click', () => {
      game.sellAll();
      this.audio.click();
      refresh();
    });
    this.panel.querySelectorAll('[data-fuel]').forEach((b) => {
      b.addEventListener('click', () => {
        const v = (b as HTMLElement).dataset.fuel;
        if (v === 'max') {
          const cost = fuelPrice * (game.maxFuel - game.fuel);
          if (game.money >= cost) {
            game.money -= cost;
            game.fuel = game.maxFuel;
          }
        } else {
          const liters = Number(v);
          const cost = liters * fuelPrice;
          if (game.money >= cost) {
            game.money -= cost;
            game.addFuel(liters);
          }
        }
        this.audio.click();
        refresh();
      });
    });
    const rep = this.panel.querySelector('[data-repair]');
    rep?.addEventListener('click', () => {
      if (game.money >= 100) {
        game.money -= 100;
        game.hull = game.maxHull;
        this.audio.click();
        refresh();
      }
    });
    this.panel.querySelectorAll('[data-upg]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = (b as HTMLElement).dataset.upg as any;
        if (game.buyUpgrade(id)) {
          this.audio.catchJingle();
          refresh();
        }
      });
    });
    this.panel.querySelector('[data-close]')!.addEventListener('click', () => this.close());
  }

  // ── РАДІО ──

  radio(game: GameState, weather: Weather, time: TimeCycle) {
    this.escAllowed = true;
    const st = weather.state();
    const fc = weather.snapshot().forecast;
    let forecastText: string;
    if (fc > 0.74) forecastText = '⚠️ ПОПЕРЕДЖЕННЯ: хвилі ростуть. Очікується ШТОРМ. Розважайся, поки може!';
    else if (fc > 0.45) forecastText = 'Вітер посилиться найближчу годину. Хвилі середні.';
    else if (fc < 0.14) forecastText = 'Погода покращується. Можна сміливо в море.';
    else forecastText = `Погода стабільна: ${st === 'storm' ? 'шторм затихає' : st === 'wind' ? 'вітер помірнає' : 'хвилі невеликі'}.`;

    const repRows = game.reports
      .map((r) => `<div class="radio-item"><b>${ZONE_NAMES[r.zone]}:</b> ${game.speciesName(r.speciesId)} клює добре (×${r.boost.toFixed(1)})</div>`)
      .join('');

    this.show(`
      <h1>📻 РАДІО «ПІВНІЧНЕ МОРЕ»</h1>
      <p class="sub">Частота 161.5 · ${time.isNight ? 'нічний ефір' : 'денний ефір'}</p>
      <div class="radio-item"><b>Прогноз погоди:</b> ${forecastText}</div>
      <div class="radio-item"><b>Рибальський звіт дня:</b>${repRows || 'сигнал загубився…'}</div>
      <div class="radio-item"><b>Ціни на ринку:</b> ${game.priceTrendText} (тиждень ${game.priceWeek})</div>
      <div class="btn-row"><button class="btn" data-close>Вимкнути (Esc)</button></div>
    `, true);
    this.panel.querySelector('[data-close]')!.addEventListener('click', () => this.close());
  }

  /** приборна панель: суднові показники (E на панелі у кокпіті) */
  gauges(game: GameState, weather: Weather, time: TimeCycle, boat: Boat, player: Player) {
    this.escAllowed = true;
    const kn = boat.vel.length() * 1.944;
    const deg = Math.round(((boat.heading * 180) / Math.PI) % 360) % 360;
    const P8 = ['П', 'ПСх', 'Сх', 'СхПд', 'Пд', 'ПдЗх', 'Зх', 'ЗхП'];
    const course = `${P8[Math.round(deg / 45) % 8]} · ${String(deg).padStart(3, '0')}°`;
    const throttlePct = Math.round(Math.abs(boat.throttle) * 100);
    // запас ходу: паливо / (|газ|·0.055 л/с) · швидкість (м/с)
    let range = '—';
    if (boat.engineOn && Math.abs(boat.throttle) > 0.05) {
      const km = (game.fuel / (Math.abs(boat.throttle) * 0.055)) * (boat.vel.length() / 1000);
      range = `≈ ${km >= 1 ? km.toFixed(1).replace('.', ',') : Math.round(km * 10) / 10} км`;
    }
    const wave = 0.1 + weather.intensity * 2.5;
    const water = 11 + 4 * time.daylight;
    const zone = ZONE_NAMES[zoneFromDist(Math.hypot(boat.pos.x, boat.pos.z))];
    const loc = player.inCabin ? 'у салоні' : player.sheltered ? 'у кокпіті (під дахом)' : 'на палубі';
    this.show(`
      <h1>🧭 ПРИБОРНА ПАНЕЛЬ</h1>
      <p class="sub">Суднові показники · ти ${loc}</p>
      <div class="panel-grid">
        <div class="pv"><span>Курс</span><b>${course}</b></div>
        <div class="pv"><span>Швидкість</span><b>${kn.toFixed(1)} вузлів</b></div>
        <div class="pv"><span>Газ</span><b>${throttlePct} %</b></div>
        <div class="pv"><span>Паливо</span><b>${Math.round(game.fuel)} / ${game.maxFuel} л</b></div>
        <div class="pv"><span>Запас ходу</span><b>${range}</b></div>
        <div class="pv"><span>Двигун</span><b>${boat.engineOn ? (boat.engineLoad > 0.5 ? 'навантажений' : 'працює') : 'зупинений'}</b></div>
        <div class="pv"><span>Вітер</span><b>${weather.wind.toFixed(1)} м/с</b></div>
        <div class="pv"><span>Хвиля</span><b>${wave.toFixed(1)} м</b></div>
        <div class="pv"><span>Темп. води</span><b>${water.toFixed(1)} °C</b></div>
        <div class="pv"><span>Зона</span><b>${zone}</b></div>
      </div>
      <div class="btn-row"><button class="btn" data-close>Закрити (Esc)</button></div>
    `, true);
    this.panel.querySelector('[data-close]')!.addEventListener('click', () => this.close());
  }
}
