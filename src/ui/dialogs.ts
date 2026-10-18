import { formatMoney } from '../core/math';
import { fishSellPrice, FISH, FISH_BY_ID, ZONE_NAMES } from '../game/fish';
import { demandAt, glutUnits } from '../game/market';
import { UPGRADES, UPGRADE_BY_ID, MAX_LEVEL, upgradeCost } from '../game/upgrades';
import { PartPreview } from './partPreview';
import { PLANS, boatValue, dailyPremium, type SinkReport } from '../game/insurance';
import type { UpgradeId } from '../core/types';
import type { GameState } from '../game/state';
import type { Weather } from '../core/weather';
import type { TimeCycle } from '../core/time';
import type { AudioEngine } from '../core/audio';
import type { Settings } from '../game/settings';

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

  private show(html: string, escAllowed: boolean, cls = '') {
    this.overlay.className = 'overlay' + (cls ? ' ' + cls : '');
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
    this.preview.stopLive();
    this.shopNote = '';
    this.overlay.classList.remove('show');
    document.body.classList.remove('intro-mode');
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
      <h1 class="intro-title">Штормовий<span>Рибал</span></h1>
      <div class="intro-sub">Storm Fishers · північне море</div>
      <p class="intro-lead">Своя яхта, тихий порт і відкрите море. Лови рибу, лови вітер у паруси, повертайся додому до заходу — або встигни до шторму.</p>
      <div class="intro-menu">
        ${hasSave ? '<button class="btn primary" data-act="continue">Продовжити</button>' : ''}
        <button class="btn ${hasSave ? '' : 'primary'}" data-act="new">${hasSave ? 'Нова гра' : 'Вийти в море'}</button>
      </div>
      <details class="intro-more">
        <summary>Керування</summary>
        <div class="intro-keys">
          <kbd>WASD</kbd><span>ходити · за штурвалом — газ і кермо</span>
          <kbd>Миша</kbd><span>роззирнутись</span>
          <kbd>E</kbd><span>дія: штурвал, фали біля щогли, вудка, магазин</span>
          <kbd>V</kbd><span>вид за штурвалом: з-за корми / від першої особи</span>
          <kbd>Space</kbd><span>тягнути рибу · у воді — спливти</span>
          <kbd>M</kbd><span>карта</span>
          <kbd>P</kbd><span>фото-режим: вільна камера</span>
          <kbd>H</kbd><span>сховати інтерфейс</span>
          <kbd>Esc</kbd><span>меню</span>
        </div>
      </details>
      ${coop ? `
      <h2>Грати з друзями</h2>
      <div class="coop-lobby">
        <label class="coop-field"><span>Нік</span>
          <input id="coop-nick" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Твоє ім'я" value="${esc(coop.nick)}"></label>
        <div class="coop-actions">
          <button class="btn primary" data-act="host">Створити кімнату</button>
          <span class="coop-or">або</span>
          <input id="coop-code" maxlength="4" autocomplete="off" spellcheck="false" placeholder="КОД" value="${esc(coop.code)}">
          <button class="btn" data-act="join">Приєднатися</button>
        </div>
        <div class="coop-msg" id="coop-msg">Одна яхта на всіх: хто створив кімнату — капітан, друзі вводять код. Гаманець і улов у кожного свій.</div>
      </div>` : ''}
    `, false, 'intro');
    document.body.classList.add('intro-mode');
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

  pause(opts: { onResume: () => void; onReset: () => void; settings: Settings; onSettings: (s: Settings) => void; playTime: number; places?: Array<{ name: string; found: boolean }>; coop?: CoopPause }) {
    this.escAllowed = false;
    this.show(`
      <h1>Пауза</h1>
      <p class="sub">${opts.coop ? 'Світ живе далі — екіпаж у морі.' : 'Час зупинений. Море чекає.'}</p>
      <div class="btn-row">
        <button class="btn primary" data-act="resume">Продовжити</button>
        ${opts.coop ? '' : '<button class="btn danger" data-act="reset">Скинути гру</button>'}
      </div>
      ${opts.coop ? `
      <h2>Кімната <span class="coop-code">${esc(opts.coop.room)}</span></h2>
      <p class="sub">${opts.coop.host ? 'Ти — капітан. Друзі: відкрити гру за адресою нижче й ввести код (або просто перейти за посиланням).' : 'Ти в екіпажі. Човном і світом керує капітан.'}</p>
      <div class="coop-link"><input readonly value="${esc(opts.coop.link)}"><button class="btn" data-act="copy">Копіювати</button></div>
      <div class="coop-players">${opts.coop.players.map((p) => `<span class="coop-chip" style="--c:${p.color}">${esc(p.nick)}${p.host ? ' ⚓' : ''}${p.me ? ' (ти)' : ''}</span>`).join('')}</div>
      <div class="btn-row"><button class="btn danger" data-act="leave">${opts.coop.host ? 'Закрити кімнату' : 'Покинути кімнату'}</button></div>` : ''}
      ${opts.places ? `
      <h2>Місця · ${opts.places.filter((p) => p.found).length}/${opts.places.length}</h2>
      <div class="places">${opts.places.map((p) => `<span class="place${p.found ? ' found' : ''}">${p.found ? esc(p.name) : '???'}</span>`).join('')}</div>` : ''}
      <h2>Налаштування</h2>
      <div class="settings">
        <label>Гучність<input type="range" min="0" max="100" data-k="volume"><output></output></label>
        <label>Музика<input type="range" min="0" max="100" data-k="music"><output></output></label>
        <label>Чутливість миші<input type="range" min="30" max="250" data-k="sens"><output></output></label>
        <label>Поле зору<input type="range" min="55" max="95" data-k="fov"><output></output></label>
        <label>Чіткість<input type="range" min="50" max="100" step="5" data-k="scale"><output></output></label>
        <label class="chk"><input type="checkbox" data-k="invertY"><span>Інвертувати мишу по вертикалі</span></label>
      </div>
      <h2>Керування</h2>
      <div class="intro-keys">
        <kbd>WASD</kbd><span>ходити · за штурвалом: W/S газ, A/D кермо</span>
        <kbd>E</kbd><span>дія: штурвал, фали, вудка, магазин</span>
        <kbd>V</kbd><span>вид за штурвалом: з-за корми / від першої особи</span>
        <kbd>Space</kbd><span>тягнути рибу · у воді — спливти</span>
        <kbd>M</kbd><span>карта</span>
        <kbd>P</kbd><span>фото-режим</span>
        <kbd>H</kbd><span>сховати інтерфейс</span>
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
    // налаштування: повзунки змінюють одразу
    const st = { ...opts.settings };
    const fmt: Record<string, (v: number) => string> = {
      volume: (v) => `${Math.round(v * 100)} %`,
      music: (v) => (v < 0.005 ? 'вимк' : `${Math.round(v * 100)} %`),
      sens: (v) => `×${v.toFixed(2).replace('.', ',')}`,
      fov: (v) => `${Math.round(v)}°`,
      scale: (v) => (v >= 0.995 ? 'максимум' : `${Math.round(v * 100)} %`),
    };
    const scale: Record<string, number> = { volume: 100, music: 100, sens: 100, fov: 1, scale: 100 };
    for (const el of this.panel.querySelectorAll<HTMLInputElement>('.settings input')) {
      const k = el.dataset.k as keyof Settings;
      const out = el.nextElementSibling as HTMLOutputElement | null;
      if (el.type === 'checkbox') el.checked = !!st[k];
      else {
        el.value = String(Math.round((st[k] as number) * scale[k]));
        if (out) out.textContent = fmt[k](st[k] as number);
      }
      el.addEventListener('input', () => {
        if (el.type === 'checkbox') (st as Record<string, unknown>)[k] = el.checked;
        else {
          (st as Record<string, unknown>)[k] = Number(el.value) / scale[k];
          if (out) out.textContent = fmt[k](st[k] as number);
        }
        opts.onSettings({ ...st });
      });
    }
    // скидання — у два натиски (без системного confirm)
    const reset = this.panel.querySelector<HTMLButtonElement>('[data-act="reset"]');
    let armed = false;
    reset?.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        reset.textContent = 'Точно? Натисни ще раз';
        setTimeout(() => {
          armed = false;
          reset.textContent = 'Скинути гру';
        }, 3000);
        return;
      }
      this.close();
      opts.onReset();
    });
    void opts.playTime;
  }

  // ── МАГАЗИН ──
  // Вітрина: усі речі на полицях (дерево = полиця, 5 речей по рівнях),
  // вибрана річ крутиться на вітрині з описом і характеристиками.
  // Продаж риби й сервіс — окремими вкладками.

  private preview = new PartPreview();
  private shopTab: 'vitrine' | 'fish' | 'service' | 'insurance' = 'vitrine';
  private shopSel: { id: UpgradeId; lvl: number } | null = null;
  private shopNote = '';

  shop(game: GameState) {
    this.escAllowed = true;
    // паливо: рейс у прибережну зону на моторі ≈ 40–50 ₴ — дешевше за трюм риби,
    // але вітрила все одно вигідніші (20 ₴/л робили моторні рейси збитковими)
    const fuelPrice = 6;
    // типова вибрана річ — наступна, яку можна купити
    if (!this.shopSel) {
      const next = UPGRADES.find((u) => game.upgrades[u.id] < MAX_LEVEL && (upgradeCost(u.id, game.upgrades[u.id]) ?? 1e9) <= game.money)
        ?? UPGRADES.find((u) => game.upgrades[u.id] < MAX_LEVEL) ?? UPGRADES[0];
      this.shopSel = { id: next.id, lvl: Math.min(MAX_LEVEL, game.upgrades[next.id] + 1) };
    }
    const sel = this.shopSel;

    const total = game.quote(game.hold).total;

    // ── полиці ──
    const shelves = UPGRADES.map((u) => {
      const cur = game.upgrades[u.id];
      const items = u.parts.map((part, i) => {
        const lvl = i + 1;
        const owned = lvl <= cur;
        const next = lvl === cur + 1;
        const cost = u.costs[i];
        const state = owned ? 'owned' : next ? (game.money >= cost ? 'next' : 'next poor') : 'locked';
        const tag = owned ? '<span class="tag-on">✓ на човні</span>' : next ? `<span class="price">${formatMoney(cost)}</span>` : `<span class="price dim">${formatMoney(cost)}</span>`;
        const isSel = sel.id === u.id && sel.lvl === lvl;
        return `<button class="shelf-item ${state}${isSel ? ' sel' : ''}" data-item="${u.id}:${lvl}" title="${esc(part.name)}">
            <img alt="" src="${this.preview.thumb(u.id, lvl)}">
            ${tag}
          </button>`;
      }).join('');
      return `<div class="shelf">
          <div class="shelf-label"><b>${u.name}</b><small>${u.role}</small><span class="shelf-lvl">${cur}/5</span></div>
          <div class="shelf-row">${items}</div>
        </div>`;
    }).join('');

    // ── вітрина вибраної речі ──
    const def = UPGRADE_BY_ID[sel.id];
    const cur = game.upgrades[sel.id];
    const part = def.parts[sel.lvl - 1];
    const cost = def.costs[sel.lvl - 1];
    const owned = sel.lvl <= cur;
    const next = sel.lvl === cur + 1;
    const statRows = def.stats.map((st) => {
      const a = st.value(cur);
      const b = st.value(Math.max(cur, sel.lvl));
      const better = owned ? false : st.lowerBetter ? b < a : b > a;
      return `<tr><td>${st.label}</td><td class="v">${st.fmt(a)}</td>${owned ? '' : `<td class="arr">→</td><td class="v ${better ? 'up' : ''}">${st.fmt(b)}</td>`}</tr>`;
    }).join('');
    const statHead = owned ? '<tr><th></th><th>зараз</th></tr>' : `<tr><th></th><th>зараз</th><th></th><th>${next ? 'з цією річчю' : `на рівні ${sel.lvl}`}</th></tr>`;
    let action: string;
    if (owned) action = `<div class="sc-status ok">✓ Стоїть на твоєму човні</div>`;
    else if (next) action = `<button class="btn primary sc-buy" data-buy="${sel.id}" ${game.money < cost ? 'disabled' : ''}>Купити й поставити — ${formatMoney(cost)}</button>
        ${game.money < cost ? `<div class="sc-status">Бракує ${formatMoney(cost - game.money)}</div>` : ''}`;
    else action = `<div class="sc-status">🔒 Спершу постав «${esc(def.parts[cur].name)}»</div>`;
    const showcase = `
      <div class="showcase">
        <div class="sc-view" data-view></div>
        <div class="sc-cat">${def.name} · рівень ${sel.lvl}/5</div>
        <h3 class="sc-name">${esc(part.name)}</h3>
        <p class="sc-blurb">${esc(part.blurb)}</p>
        <table class="sc-stats">${statHead}${statRows}</table>
        ${this.shopNote ? `<div class="sc-note">${this.shopNote}</div>` : ''}
        ${action}
      </div>`;

    const tab = this.shopTab;
    const tabs = `<div class="shop-tabs">
        <button class="shop-tab ${tab === 'vitrine' ? 'on' : ''}" data-tab="vitrine">🛠 Вітрина</button>
        <button class="shop-tab ${tab === 'fish' ? 'on' : ''}" data-tab="fish">🐟 Риба <span class="cnt">${game.hold.length}</span></button>
        <button class="shop-tab ${tab === 'service' ? 'on' : ''}" data-tab="service">⛽ Сервіс</button>
        <button class="shop-tab ${tab === 'insurance' ? 'on' : ''}" data-tab="insurance">🛡 Страховка${game.insurance ? '' : ' <span class="cnt warn">!</span>'}</button>
      </div>`;

    let body = '';
    if (tab === 'vitrine') {
      body = `<div class="vitrine"><div class="shelves">${shelves}</div>${showcase}</div>`;
    } else if (tab === 'fish') {
      body = this.fishTab(game, total);
    } else if (tab === 'insurance') {
      body = this.insuranceTab(game);
    } else {
      body = `<div class="fish-row">
          <span class="fname">Паливо <span class="fmeta">(${Math.round(game.fuel)}/${game.maxFuel} л · ${fuelPrice} ₴/л)</span></span>
          <button class="btn" data-fuel="10" ${game.money < fuelPrice * 10 || game.fuel >= game.maxFuel ? 'disabled' : ''} style="padding:5px 10px;font-size:12.5px">+10 л — ${formatMoney(fuelPrice * 10)}</button>
          <button class="btn" data-fuel="max" ${game.money < fuelPrice || game.fuel >= game.maxFuel ? 'disabled' : ''} style="padding:5px 10px;font-size:12.5px">${game.money >= fuelPrice * Math.ceil(game.maxFuel - game.fuel) ? `Повний бак — ${formatMoney(fuelPrice * Math.ceil(game.maxFuel - game.fuel))}` : `На всі гроші — ${Math.floor(game.money / fuelPrice)} л`}</button>
        </div>
        <div class="fish-row" style="margin-top:6px">
          <span class="fname">Ремонт корпусу <span class="fmeta">(${Math.round(game.hull)}/${game.maxHull})</span></span>
          <button class="btn" data-repair ${game.hull >= game.maxHull || game.money < 100 ? 'disabled' : ''} style="padding:5px 10px;font-size:12.5px">Повний — 100 ₴</button>
        </div>`;
    }

    this.show(`
      <div class="shop-head">
        <div><h1>КРАМНИЦЯ «ШТОРМ»</h1><p class="sub">Усе, що на полицях, ставиться просто на твій човен</p></div>
        <div class="shop-head-right">
          <div class="money-chip">${formatMoney(game.money)}</div>
          ${game.hold.length && tab !== 'fish' ? `<button class="btn" data-sellall>Продати рибу — ${formatMoney(total)}</button>` : ''}
        </div>
      </div>
      ${tabs}
      ${body}
      <div class="btn-row"><button class="btn" data-close>Закрити (Esc)</button></div>
    `, true, 'shop');

    const refresh = () => this.shop(game);
    const view = this.panel.querySelector('[data-view]') as HTMLElement | null;
    if (view) requestAnimationFrame(() => view.isConnected && this.preview.showLive(view, sel.id, sel.lvl));

    this.panel.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.shopTab = (b as HTMLElement).dataset.tab as typeof this.shopTab;
        this.shopNote = '';
        this.audio.click();
        refresh();
      });
    });
    this.panel.querySelectorAll('[data-item]').forEach((b) => {
      b.addEventListener('click', () => {
        const [id, lvl] = (b as HTMLElement).dataset.item!.split(':');
        this.shopSel = { id: id as UpgradeId, lvl: Number(lvl) };
        this.shopNote = '';
        this.audio.click();
        const sc = this.panel.querySelector('.shelves');
        const scroll = sc?.scrollTop ?? 0;
        refresh();
        const sc2 = this.panel.querySelector('.shelves');
        if (sc2) sc2.scrollTop = scroll;
      });
    });
    this.panel.querySelector('[data-buy]')?.addEventListener('click', () => {
      const id = sel.id;
      if (game.buyUpgrade(id)) {
        this.onBoatPurchase?.({ upgrade: id });
        this.audio.catchJingle();
        this.shopNote = `🔧 «${esc(UPGRADE_BY_ID[id].parts[game.upgrades[id] - 1].name)}» вже на човні`;
        // вітрина одразу показує наступну річ із цієї ж полиці
        if (game.upgrades[id] < MAX_LEVEL) this.shopSel = { id, lvl: game.upgrades[id] + 1 };
        const sc = this.panel.querySelector('.shelves');
        const scroll = sc?.scrollTop ?? 0;
        refresh();
        const sc2 = this.panel.querySelector('.shelves');
        if (sc2) sc2.scrollTop = scroll;
      }
    });

    this.panel.querySelectorAll('[data-sellgroup]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = (b as HTMLElement).dataset.sellgroup;
        game.sellMany(game.hold.filter((f) => f.speciesId === id).map((f) => f.uid));
        this.audio.click();
        refresh();
      });
    });
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
          // повний бак або стільки, на скільки вистачає грошей
          const liters = Math.min(game.maxFuel - game.fuel, Math.floor(game.money / fuelPrice));
          if (liters > 0) {
            game.money -= Math.ceil(liters * fuelPrice);
            game.addFuel(liters);
            this.onBoatPurchase?.({ fuel: liters });
          }
        } else {
          const liters = Math.min(Number(v), game.maxFuel - game.fuel);
          const cost = Math.ceil(liters * fuelPrice);
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
    this.panel.querySelectorAll('[data-plan]').forEach((b) => {
      b.addEventListener('click', () => {
        const tier = Number((b as HTMLElement).dataset.plan);
        const fee = dailyPremium(tier, game.upgrades);
        if (tier > 0 && game.money < fee) return;
        game.money -= fee; // перший день — одразу
        game.insurance = tier;
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
    this.panel.querySelector('[data-close]')!.addEventListener('click', () => this.close());
  }

  /** вкладка «Риба»: улов, згрупований за видами, + біржа */
  private fishTab(game: GameState, total: number): string {
    const m = game.market;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const kg = (v: number) => v.toFixed(2).replace('.', ',');
    const isHot = (id: string) => {
      const prev = m.prev[id];
      const trend = prev ? (game.priceMult[id] ?? 1) / prev : 1;
      const ev = m.eventMult(id);
      if (ev < 1 || m.demand(id) < 0.9) return false;
      return ev > 1 || trend > 1.05 || (game.priceMult[id] ?? 1) >= 1.1;
    };

    // ── улов за видами ──
    const groups = new Map<string, typeof game.hold>();
    for (const f of game.sellOrder(game.hold)) {
      const arr = groups.get(f.speciesId) ?? [];
      arr.push(f);
      groups.set(f.speciesId, arr);
    }
    const sorted = [...groups.entries()].sort((a, b) => game.quote(b[1]).total - game.quote(a[1]).total);
    const groupHtml = sorted.map(([id, items]) => {
      const sp = FISH_BY_ID[id];
      const q = game.quote(items);
      const d = m.demand(id);
      // попит після продажу всієї групи
      let gAfter = m.glut[id] ?? 0;
      for (const f of items) gAfter += glutUnits(f);
      const dAfter = demandAt(gAfter);
      const ev = m.eventFor(id);
      const tag = ev ? `<span class="tag ${ev.mult > 1 ? 'hot' : 'cold'}">${ev.mult > 1 ? '+' : '−'}${Math.round(Math.abs(ev.mult - 1) * 100)}%</span>`
        : d < 0.75 ? '<span class="tag cold">насичено</span>' : isHot(id) ? '<span class="tag hot">в ціні</span>' : '';
      // ціни по черзі: кожна наступна рибина цього виду — вже при нижчому попиті
      const rows = game.sellOrder(items).map((f, i) => {
        const now = game.sellPrice(f);
        const seq = q.prices[i] ?? now;
        const cut = now > 0 ? 1 - seq / now : 0;
        const tags = [
          f.cooked ? '<span class="tag cooked">варена</span>' : '',
          f.storm ? '<span class="tag storm">шторм +25%</span>' : '',
        ].join(' ');
        return `<div class="fish-row">
            <span class="fmeta">${kg(f.kg)} кг · свіжість ${f.cooked ? '—' : Math.round(f.freshness) + '%'} ${tags}</span>
            ${cut > 0.015 ? `<span class="fcut" title="Ціна, якщо продавати всіх по черзі: попит падає">−${Math.round(cut * 100)}%</span>` : ''}
            <span class="fprice">${formatMoney(seq)}</span>
            <button class="btn" data-sell="${f.uid}" style="padding:3px 10px;font-size:12px">Продати</button>
          </div>`;
      }).join('');
      return `<div class="fgroup">
          <div class="fg-head">
            <span class="fg-name">${sp?.name ?? id} <span class="fg-cnt">×${items.length}</span> ${tag}</span>
            <span class="fg-dem" title="Попит зараз → після продажу всієї групи">
              <span class="dbar"><i style="width:${pct(d)}"></i><b style="left:${pct(dAfter)}"></b></span>
              ${pct(d)}${items.length > 1 && dAfter < d - 0.005 ? ` → ${pct(dAfter)}` : ''}
            </span>
            ${items.length > 1 ? `<button class="btn" data-sellgroup="${id}" style="padding:4px 11px;font-size:12px">Усі ${items.length} — ${formatMoney(q.total)}</button>` : ''}
          </div>
          ${rows}
        </div>`;
    }).join('');

    // скільки «з'їдає» насичення ринку
    const full = game.hold.reduce((a, f) => a + fishSellPrice(f, game.priceMult, m.eventMult(f.speciesId)), 0);
    const loss = full - total;

    // ── біржа ──
    const spark = (vals: number[]) => {
      if (vals.length < 2) return '<svg class="spark" viewBox="0 0 60 18"></svg>';
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const span = hi - lo || 1;
      const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 58 + 1).toFixed(1)},${(16 - ((v - lo) / span) * 14).toFixed(1)}`);
      const up = vals[vals.length - 1] >= vals[0];
      const last = pts[pts.length - 1].split(',');
      return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 60 18"><polyline points="${pts.join(' ')}"/><circle cx="${last[0]}" cy="${last[1]}" r="1.8"/></svg>`;
    };
    const holdCount: Record<string, number> = {};
    for (const f of game.hold) holdCount[f.speciesId] = (holdCount[f.speciesId] ?? 0) + 1;
    const boardRows = FISH.map((sp) => {
      const id = sp.id;
      const known = game.discovered.includes(id);
      const now = m.perKg(id, game.priceMult);
      const d = m.demand(id);
      const prev = m.prev[id];
      const tr = prev ? (game.priceMult[id] ?? 1) / prev - 1 : 0;
      const arrow = !prev ? '<span class="tr flat">·</span>'
        : tr > 0.03 ? `<span class="tr up">↑${Math.round(tr * 100)}%</span>`
        : tr < -0.03 ? `<span class="tr down">↓${Math.round(-tr * 100)}%</span>`
        : '<span class="tr flat">→</span>';
      const ev = m.eventFor(id);
      const cls = [known ? '' : 'unk', isHot(id) ? 'hot' : '', d < 0.75 || (ev && ev.mult < 1) ? 'cold' : ''].join(' ');
      const hc = holdCount[id] ? `<span class="bd-hc" title="у трюмі">${holdCount[id]}</span>` : '';
      return `<tr class="${cls}">
          <td class="bd-n">${sp.name}${hc}</td>
          <td class="bd-p">${Math.round(now)}</td>
          <td class="bd-d"><span class="dbar${d < 0.75 ? ' low' : ''}"><i style="width:${pct(d)}"></i></span></td>
          <td>${spark([...(m.hist[id] ?? []), Math.round(now * 10) / 10])}</td>
          <td class="bd-t">${arrow}</td>
        </tr>`;
    }).join('');
    const evHtml = m.events.length
      ? m.events.map((e) => `<div class="bd-ev ${e.mult > 1 ? 'up' : 'down'}">${e.mult > 1 ? '📈' : '📉'} ${esc(e.text)}</div>`).join('')
      : '<div class="bd-ev calm">Сьогодні на біржі спокійно</div>';
    const board = `<div class="board">
        <div class="bd-head"><b>Біржа риби</b><small>день ${game.priceWeek} · ${game.priceTrendText}</small></div>
        ${evHtml}
        <table class="bd">
          <tr><th>вид</th><th>₴/кг</th><th>попит</th><th>ціна</th><th>тиждень</th></tr>
          ${boardRows}
        </table>
        <p class="bd-note">Перші 2 рибини виду — за повну ціну, далі кожна дешевша. Попит відновлюється за добу, тож різний улов вигідніший.</p>
      </div>`;

    const holdHtml = game.hold.length === 0
      ? '<p class="sub">Трюм порожній. Час ловити! Поглянь на біржу — що зараз у ціні.</p>'
      : `<div class="fish-list">${groupHtml}</div>
        <div class="btn-row sell-all-row">
          <button class="btn primary" data-sellall>Продати все — ${formatMoney(total)}</button>
          ${loss > 0 ? `<span class="sell-note">насичення ринку: −${formatMoney(loss)}</span>` : '<span class="sell-note ok">ринок бере все за повну ціну</span>'}
        </div>`;
    return `<div class="market">
        <div class="mk-hold">
          <p class="sub">Трюм ${game.hold.length}/${game.holdCap} · продаємо найдорожчі першими</p>
          ${holdHtml}
        </div>
        ${board}
      </div>`;
  }

  // ── СТРАХОВКА ──
  private insuranceTab(game: GameState): string {
    const value = boatValue(game.upgrades);
    const cargo = game.hold.reduce((a, f) => a + game.sellPrice(f), 0);
    const cards = PLANS.map((p) => {
      const fee = dailyPremium(p.tier, game.upgrades);
      const cur = game.insurance === p.tier;
      const keepTxt = p.keep >= 5 ? 'усі модулі' : p.keep === 0 ? 'нічого' : `модулі до ${p.keep}-го рівня`;
      const loseUp = UPGRADES.reduce((a, u) => a + Math.max(0, game.upgrades[u.id] - p.keep), 0);
      return `<div class="ins-card ${cur ? 'on' : ''} tier${p.tier}">
          <div class="ins-name">${p.name}</div>
          <div class="ins-fee">${p.tier ? `${formatMoney(fee)} <small>/ добу</small>` : '0 ₴'}</div>
          <ul>
            <li>🛠 ${keepTxt}</li>
            <li>🐟 улов: ${p.cargo ? Math.round(p.cargo * 100) + '% вартості' : 'втрачається'}</li>
            <li>⏱ новий човен: ${p.claimH ? p.claimH + ' год' : 'одразу'}</li>
            ${p.tow ? `<li>⚓ буксир: ${formatMoney(p.tow)}</li>` : ''}
          </ul>
          <p>${p.blurb}</p>
          ${loseUp > 0 && game.upgrades && p.tier < 3 ? `<div class="ins-risk">Зараз під ризиком: ${loseUp} рів. модулів</div>` : ''}
          ${cur ? '<div class="ins-cur">✓ Діє</div>' : `<button class="btn ${p.tier ? 'primary' : ''}" data-plan="${p.tier}" ${p.tier && game.money < fee ? 'disabled' : ''}>${p.tier ? 'Оформити' : 'Скасувати поліс'}</button>`}
        </div>`;
    }).join('');
    return `<p class="sub">Вартість човна: <b>${formatMoney(value)}</b> · улов у трюмі: <b>${formatMoney(cargo)}</b>. Внесок списується щодня на світанку; не вистачить грошей — поліс згорить.</p>
      <div class="ins-grid">${cards}</div>`;
  }

  /** звіт після затоплення */
  sinkReport(r: SinkReport, onClose: () => void) {
    this.escAllowed = true;
    const mods = r.lostModules.length
      ? r.lostModules.map(([n, a, b]) => `<li>${esc(n)}: рів. ${a} → <b>${b}</b></li>`).join('')
      : '<li>Модулі вціліли ✓</li>';
    this.show(`
      <h1>🌊 ЧОВЕН ЗАТОНУВ</h1>
      <p class="sub">Поліс: <b>${r.plan.name}</b>${r.plan.claimH ? ` · новий човен через ${r.plan.claimH} год` : ' · новий човен одразу'}</p>
      <div class="sink-grid">
        <div class="sink-col"><h2>🐟 Улов</h2>
          <p>Втрачено риби: <b>${r.lostFish}</b> (на ${formatMoney(r.cargoValue)})</p>
          <p>${r.payout ? `Страхова виплата: <b class="good">+${formatMoney(r.payout)}</b>` : '<span class="bad">Не застраховано — нічого не повернуть</span>'}</p>
        </div>
        <div class="sink-col"><h2>🛠 Модулі</h2><ul>${mods}</ul></div>
      </div>
      ${r.tow ? `<p class="sub bad">Рятувальники взяли за буксир ${formatMoney(r.tow)}.</p>` : ''}
      ${r.plan.tier < 2 ? '<p class="sub">Порада: оформи страховку в крамниці (вкладка «🛡 Страховка»), перш ніж іти в шторм.</p>' : ''}
      <div class="btn-row"><button class="btn primary" data-close>Далі</button></div>
    `, true);
    this.panel.querySelector('[data-close]')!.addEventListener('click', () => {
      this.close();
      onClose();
    });
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
      .map((r) => `<div class="radio-item"><b>${ZONE_NAMES[r.zone]}:</b> ${game.speciesName(r.speciesId)} клює добре (×${r.boost.toFixed(1).replace(".", ",")})</div>`)
      .join('');

    this.show(`
      <h1>📻 РАДІО «ПІВНІЧНЕ МОРЕ»</h1>
      <p class="sub">Частота 161.5 · ${time.isNight ? 'нічний ефір' : 'денний ефір'}</p>
      <div class="radio-item"><b>Прогноз погоди:</b> ${forecastText}</div>
      <div class="radio-item"><b>Рибальський звіт дня:</b>${repRows || 'сигнал загубився…'}</div>
      <div class="radio-item"><b>Ціни на ринку:</b> ${game.priceTrendText} (тиждень ${game.priceWeek})${game.market.events.map((e) => `<br>${e.mult > 1 ? '📈' : '📉'} ${esc(e.text)}`).join('')}</div>
      <div class="btn-row"><button class="btn" data-close>Вимкнути (Esc)</button></div>
    `, true);
    this.panel.querySelector('[data-close]')!.addEventListener('click', () => this.close());
  }
}
