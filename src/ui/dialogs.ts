import { formatMoney } from '../core/math';
import { fishSellPrice, FISH_BY_ID, ZONE_NAMES } from '../game/fish';
import { UPGRADES, upgradeCost } from '../game/upgrades';
import type { GameState } from '../game/state';
import type { Weather } from '../core/weather';
import type { TimeCycle } from '../core/time';
import type { AudioEngine } from '../core/audio';

// ─────────────────────────────────────────────────────────────
// Оверлеї: вступ, пауза, магазин, радіо.
// ─────────────────────────────────────────────────────────────

type CloseFn = () => void;

export interface CoopLobby {
  nick: string;
  code: string;
  onHost: (nick: string) => Promise<void>;
  onJoin: (nick: string, code: string) => Promise<void>;
}

export interface CoopPause {
  room: string;
  link: string;
  host: boolean;
  players: Array<{ nick: string; color: string; host: boolean; me: boolean }>;
  onLeave: () => void;
}

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

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
  /** кооп-гість: покупки для спільного човна (паливо/ремонт/апгрейд) — капітану */
  onBoatPurchase: ((p: { fuel?: number; repair?: boolean; upgrade?: string }) => void) | null = null;

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

  intro(hasSave: boolean, onNew: () => void, onContinue: () => void, coop?: CoopLobby) {
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
      ${coop ? `
      <h2>👥 Грати з друзями</h2>
      <div class="coop-lobby">
        <label class="coop-field"><span>Нік</span>
          <input id="coop-nick" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Твоє ім'я" value="${esc(coop.nick)}"></label>
        <div class="coop-actions">
          <button class="btn primary" data-act="host">Створити кімнату</button>
          <span class="coop-or">або</span>
          <input id="coop-code" maxlength="4" autocomplete="off" spellcheck="false" placeholder="КОД" value="${esc(coop.code)}">
          <button class="btn" data-act="join">Приєднатися</button>
        </div>
        <div class="coop-msg" id="coop-msg">Капітан (хто створив кімнату) веде човен і світ зі свого сейву. Друзі відкривають ту саму адресу гри й вводять код — одна яхта на всіх, у кожного свій гаманець і улов.</div>
      </div>` : ''}
    `, false);
    if (coop) {
      const nickEl = this.panel.querySelector('#coop-nick') as HTMLInputElement;
      const codeEl = this.panel.querySelector('#coop-code') as HTMLInputElement;
      const msgEl = this.panel.querySelector('#coop-msg') as HTMLElement;
      const btns = this.panel.querySelectorAll('[data-act="host"], [data-act="join"]');
      codeEl.addEventListener('input', () => {
        codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      });
      const run = async (join: boolean) => {
        const nick = nickEl.value.trim();
        if (!nick) {
          msgEl.textContent = 'Введи нік';
          msgEl.className = 'coop-msg bad';
          nickEl.focus();
          return;
        }
        const code = codeEl.value.trim();
        if (join && code.length !== 4) {
          msgEl.textContent = 'Код кімнати — 4 символи (його бачить капітан у меню паузи)';
          msgEl.className = 'coop-msg bad';
          codeEl.focus();
          return;
        }
        this.audio.resume();
        this.audio.click();
        btns.forEach((b) => ((b as HTMLButtonElement).disabled = true));
        msgEl.textContent = join ? 'Під\'єднуємось…' : 'Створюємо кімнату…';
        msgEl.className = 'coop-msg';
        try {
          if (join) await coop.onJoin(nick, code);
          else await coop.onHost(nick);
          this.close();
        } catch (e) {
          msgEl.textContent = (e as Error).message || 'Помилка з\'єднання';
          msgEl.className = 'coop-msg bad';
          btns.forEach((b) => ((b as HTMLButtonElement).disabled = false));
        }
      };
      this.panel.querySelector('[data-act="host"]')!.addEventListener('click', () => void run(false));
      this.panel.querySelector('[data-act="join"]')!.addEventListener('click', () => void run(true));
      codeEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void run(true);
      });
    }
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

  pause(opts: { onResume: () => void; onReset: () => void; sound: boolean; onToggleSound: () => void; playTime: number; coop?: CoopPause }) {
    this.escAllowed = false;
    this.show(`
      <h1 style="font-size:26px">ПАУЗА</h1>
      <p class="sub">${opts.coop ? 'Світ живе далі — екіпаж у морі.' : 'Час зупинений. Море чекає.'}</p>
      <div class="btn-row">
        <button class="btn primary" data-act="resume">Продовжити</button>
        <button class="btn" data-act="sound">Звук: ${opts.sound ? 'вкл' : 'вимк'}</button>
        ${opts.coop ? '' : '<button class="btn danger" data-act="reset">Скинути гру</button>'}
      </div>
      ${opts.coop ? `
      <h2>👥 Кімната <span class="coop-code">${esc(opts.coop.room)}</span></h2>
      <p class="sub">${opts.coop.host ? 'Ти — капітан. Друзі: відкрити гру за адресою нижче й ввести код (або просто перейти за посиланням).' : 'Ти в екіпажі. Човном і світом керує капітан.'}</p>
      <div class="coop-link"><input readonly value="${esc(opts.coop.link)}"><button class="btn" data-act="copy">Копіювати</button></div>
      <div class="coop-players">${opts.coop.players.map((p) => `<span class="coop-chip" style="--c:${p.color}">${esc(p.nick)}${p.host ? ' ⚓' : ''}${p.me ? ' (ти)' : ''}</span>`).join('')}</div>
      <div class="btn-row"><button class="btn danger" data-act="leave">${opts.coop.host ? 'Закрити кімнату' : 'Покинути кімнату'}</button></div>` : ''}
      <h2>Керування</h2>
      <div class="intro-keys">
        <kbd>WASD</kbd><span>рух · у штурвалі: W/S газ, A/D рильє</span>
        <kbd>E</kbd><span>станції / магазин / залізти</span>
        <kbd>Space</kbd><span>тяга лінії · у воді — сплестись</span>
        <kbd>M</kbd><span>карта (штурвальна)</span>
        ${opts.coop ? '<kbd>Enter</kbd><span>чат з екіпажем</span>' : ''}
      </div>
    `, false);
    if (opts.coop) {
      const c = opts.coop;
      this.panel.querySelector('[data-act="copy"]')!.addEventListener('click', (e) => {
        void navigator.clipboard?.writeText(c.link).catch(() => {});
        (this.panel.querySelector('.coop-link input') as HTMLInputElement).select();
        (e.target as HTMLElement).textContent = 'Скопійовано ✓';
      });
      this.panel.querySelector('[data-act="leave"]')!.addEventListener('click', () => {
        this.close();
        c.onLeave();
      });
    }
    this.panel.querySelector('[data-act="resume"]')!.addEventListener('click', () => {
      this.audio.click();
      this.close();
      opts.onResume();
    });
    this.panel.querySelector('[data-act="sound"]')!.addEventListener('click', () => {
      opts.onToggleSound();
      this.panel.querySelector('[data-act="sound"]')!.textContent = `Звук: ${!opts.sound ? 'вкл' : 'вимк'}`;
    });
    this.panel.querySelector('[data-act="reset"]')?.addEventListener('click', () => {
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
            this.onBoatPurchase?.({ fuel: game.maxFuel - game.fuel });
            game.fuel = game.maxFuel;
          }
        } else {
          const liters = Number(v);
          const cost = liters * fuelPrice;
          if (game.money >= cost) {
            game.money -= cost;
            game.addFuel(liters);
            this.onBoatPurchase?.({ fuel: liters });
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
        this.onBoatPurchase?.({ repair: true });
        this.audio.click();
        refresh();
      }
    });
    this.panel.querySelectorAll('[data-upg]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = (b as HTMLElement).dataset.upg as any;
        if (game.buyUpgrade(id)) {
          this.onBoatPurchase?.({ upgrade: id });
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
}
