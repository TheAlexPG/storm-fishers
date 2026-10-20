import { formatMoney } from '../core/math';
import { fishSellPrice, FISH, FISH_BY_ID, ZONE_NAMES } from '../game/fish';
import { demandAt, glutUnits } from '../game/market';
import { UPGRADES, UPGRADE_BY_ID, MAX_LEVEL, upgradeCost, upgradeLock } from '../game/upgrades';
import { PartPreview } from './partPreview';
import { PLANS, boatValue, dailyPremium, type SinkReport } from '../game/insurance';
import type { UpgradeId } from '../core/types';
import type { GameState } from '../game/state';
import type { Weather } from '../core/weather';
import type { TimeCycle } from '../core/time';
import type { AudioEngine } from '../core/audio';
import type { Settings } from '../game/settings';
import { exportSave, parseSaveFile, applyImport, hasAnySave } from '../game/saveTransfer';
import { exchangeHtml, drawExchange } from './exchange';
import { buyerHtml, ordersHtml } from './buyers';
import { BUYER_BY_ID, type BuyerId } from '../game/buyers';

/** місця в порту — кожне зі своїми послугами */
export type Venue = 'shop' | 'fuel' | 'yard' | 'office';
const VENUES: Record<Venue, { title: string; sub: string }> = {
  shop: { title: 'КРАМНИЦЯ СПОРЯДЖЕННЯ', sub: 'Усе, що на полицях, ставиться просто на твій човен' },
  fuel: { title: 'ЗАПРАВКА', sub: 'Дизель для мотора — під навісом біля причалу' },
  yard: { title: 'ВЕРФ', sub: 'Латаємо корпус після штормів і скель' },
  office: { title: 'КОНТОРА ПОРТУ', sub: 'Страхова агенція: поліс для човна й улову' },
};
/** хто де в порту — підказка внизу кожного вікна */
const WAYFIND = '🐟 Рибу приймає <b>біржа</b> на східній набережній · 🛠 речі — <b>крамниця</b> · ⛽ <b>заправка</b> й 🔧 <b>верф</b> — біля причалу · 🛡 поліс — <b>контора порту</b>';

// ─────────────────────────────────────────────────────────────
// Оверлеї: вступ, пауза, магазин, радіо.
// ─────────────────────────────────────────────────────────────

type CloseFn = () => void;

export interface CoopLobby {
  nick: string;
  code: string;
  onHost: (nick: string) => Promise<void>;
  onJoin: (nick: string, code: string, ownBoat: boolean) => Promise<void>;
}

export interface CoopPause {
  room: string;
  link: string;
  host: boolean;
  players: Array<{ nick: string; color: string; host: boolean; me: boolean }>;
  onLeave: () => void;
  /** яхти кімнати: перейти на борт */
  boats?: Array<{ owner: number; nick: string; crew: string[]; mine: boolean; here: boolean }>;
  onBoard?: (owner: number) => void;
}

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface HatsPause {
  list: Array<{ id: string; name: string; icon: string; owned: boolean; hint: string }>;
  current: string;
  onPick: (id: string) => void;
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
  onBoatPurchase: ((p: { fuel?: number; repair?: boolean; patch?: number; upgrade?: string }) => void) | null = null;

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

  intro(hasSave: boolean, onNew: () => void, onContinue: () => void, coop?: CoopLobby, saveInfo?: string) {
    this.escAllowed = false;
    this.show(`
      <h1 class="intro-title">Грозова<span>рибалка</span></h1>
      <div class="intro-sub">Storm Fishers · північне море</div>
      <p class="intro-lead">Своя яхта, тихий порт і відкрите море. Лови рибу, лови вітер у паруси, повертайся додому до заходу — або встигни до шторму.</p>
      <div class="intro-menu">
        ${hasSave ? '<button class="btn primary" data-act="continue">Продовжити</button>' : ''}
        <button class="btn ${hasSave ? '' : 'primary'}" data-act="new">${hasSave ? 'Нова гра' : 'Вийти в море'}</button>
      </div>
      <div class="intro-save">${hasSave && saveInfo ? `💾 Збережено: ${esc(saveInfo)}. ` : ''}Прогрес зберігається автоматично в цьому браузері — і в соло, і в коопі. Щоб перенести на інший комп — експорт у файл.</div>
      ${this.saveToolsHtml()}
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
        <div class="coop-boat">
          <label><input type="radio" name="coop-boat" value="own" checked> на своїй яхті</label>
          <label><input type="radio" name="coop-boat" value="crew"> в екіпаж до капітана</label>
        </div>
        <div class="coop-msg" id="coop-msg">Хто створив кімнату — капітан: світ, погода й час — його. Друзі вводять код і приходять на своїх яхтах (зі своїм прогресом) або в екіпаж. Пересісти на іншу яхту можна будь-коли в меню (Esc).</div>
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
          const own = (this.panel.querySelector('input[name="coop-boat"]:checked') as HTMLInputElement | null)?.value !== 'crew';
          if (join) await coop.onJoin(nick, code, own);
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
    const newBtn = this.panel.querySelector('[data-act="new"]') as HTMLButtonElement;
    let armed = false;
    newBtn.addEventListener('click', () => {
      this.audio.resume();
      this.audio.click();
      // є сейв — перепитуємо, щоб випадково не стерти прогрес
      if (hasSave && !armed) {
        armed = true;
        newBtn.textContent = 'Стерти прогрес? Клікни ще раз';
        newBtn.classList.add('danger');
        return;
      }
      this.close();
      onNew();
    });
    this.bindSaveTools();
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

  /** кнопки експорту/імпорту сейву (файл .json) */
  private bindSaveTools(beforeExport?: () => void) {
    const root = this.panel.querySelector('.save-tools');
    if (!root) return;
    const msg = root.querySelector('.save-msg') as HTMLElement;
    const file = root.querySelector('input[type=file]') as HTMLInputElement;
    const say = (html: string, cls = '') => {
      msg.innerHTML = html;
      msg.className = 'save-msg ' + cls;
    };
    root.querySelector('[data-act="exp"]')!.addEventListener('click', () => {
      this.audio.click();
      beforeExport?.();
      if (exportSave()) say('Файл сейву завантажено ✓ Перенеси його на інший комп і натисни там «Імпорт сейву».', 'good');
      else say('Ще нічого не збережено.', 'bad');
    });
    root.querySelector('[data-act="imp"]')!.addEventListener('click', () => {
      this.audio.click();
      file.value = '';
      file.click();
    });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const p = await parseSaveFile(f);
        say(`Знайдено: <b>${esc(p.summary)}</b>.<br>${hasAnySave() ? 'Поточний прогрес у цьому браузері буде замінено. ' : ''}<button class="btn primary" data-act="imp-ok">Завантажити цей сейв</button>`);
        msg.querySelector('[data-act="imp-ok"]')!.addEventListener('click', () => {
          applyImport(p);
          say('Сейв імпортовано — перезапуск…', 'good');
          setTimeout(() => location.reload(), 300);
        });
      } catch (e) {
        say(esc((e as Error).message), 'bad');
      }
    });
  }

  private saveToolsHtml(): string {
    return `<div class="save-tools">
        <button class="btn small" data-act="exp">⬇ Експорт сейву</button>
        <button class="btn small" data-act="imp">⬆ Імпорт сейву</button>
        <input type="file" accept=".json,application/json" hidden>
        <div class="save-msg"></div>
      </div>`;
  }

  // ── ПАУЗА ──

  pause(opts: { onResume: () => void; onReset: () => void; onBeforeExport?: () => void; settings: Settings; onSettings: (s: Settings) => void; playTime: number; places?: Array<{ name: string; found: boolean }>; coop?: CoopPause; hats?: HatsPause; game?: GameState }) {
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
      ${opts.coop.boats?.length ? `<h2>Яхти</h2><div class="fleet">${opts.coop.boats.map((b) => `
        <div class="fleet-row${b.here ? ' here' : ''}">
          <span class="fleet-name">⛵ ${b.mine ? 'Моя яхта' : `Яхта ${esc(b.nick)}`}</span>
          <span class="fleet-crew">${b.crew.length ? 'екіпаж: ' + b.crew.map(esc).join(', ') : 'без екіпажу'}</span>
          ${b.here ? '<span class="fleet-here">ти тут</span>' : `<button class="btn small" data-board="${b.owner}">${b.mine ? 'На свою яхту' : 'На борт'}</button>`}
        </div>`).join('')}
        ${opts.coop.boats.some((b) => b.mine) ? '' : '<div class="fleet-row"><span class="fleet-name">⛵ Моя яхта</span><span class="fleet-crew">стоїть біля причалу</span><button class="btn small" data-board="me">Вийти на своїй</button></div>'}
      </div>` : ''}
      <div class="btn-row"><button class="btn danger" data-act="leave">${opts.coop.host ? 'Закрити кімнату' : 'Покинути кімнату'}</button></div>` : ''}
      ${opts.places ? `
      <h2>Місця · ${opts.places.filter((p) => p.found).length}/${opts.places.length}</h2>
      <div class="places">${opts.places.map((p) => `<span class="place${p.found ? ' found' : ''}">${p.found ? esc(p.name) : '???'}</span>`).join('')}</div>` : ''}
      ${opts.game ? `<h2>Замовлення · ${opts.game.trade.active.length}/3</h2>${ordersHtml(opts.game)}` : ''}
      ${opts.hats ? `
      <h2>Капелюхи · ${opts.hats.list.filter((h) => h.owned).length}/${opts.hats.list.length}</h2>
      <p class="sub">Знахідки з островів — зійди на берег і шукай, що блищить. Вибраний капелюх видно з-за корми й друзям.</p>
      <div class="hats">${opts.hats.list.map((h) => `<button class="hat${h.owned ? '' : ' locked'}${h.id === opts.hats!.current ? ' on' : ''}" data-hat="${h.id}" ${h.owned ? '' : 'disabled'} title="${esc(h.owned ? h.name : 'Де шукати: ' + h.hint)}"><span class="hat-ico">${h.owned ? h.icon : '❔'}</span><span class="hat-name">${esc(h.owned ? h.name : h.hint)}</span></button>`).join('')}</div>` : ''}
      <h2>Збереження</h2>
      <p class="sub">Гра зберігається сама. Щоб грати на іншому комп'ютері — експортуй сейв у файл і імпортуй його там.</p>
      ${this.saveToolsHtml()}
      <h2>Налаштування</h2>
      <div class="settings">
        <label>Гучність<input type="range" min="0" max="100" data-k="volume"><output></output></label>
        <label>Музика<input type="range" min="0" max="100" data-k="music"><output></output></label>
        <label>Чутливість миші<input type="range" min="30" max="250" data-k="sens"><output></output></label>
        <label>Поле зору<input type="range" min="55" max="95" data-k="fov"><output></output></label>
        <label>Чіткість<input type="range" min="50" max="100" step="5" data-k="scale"><output></output></label>
        <label class="chk"><input type="checkbox" data-k="invertY"><span>Інвертувати мишу по вертикалі</span></label>
        <label class="chk"><input type="checkbox" data-k="easyFish"><span>Легка риболовля — більше часу на підсічку й помилки</span></label>
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
      this.panel.querySelectorAll<HTMLElement>('[data-board]').forEach((b) =>
        b.addEventListener('click', () => {
          const v = b.dataset.board!;
          this.close();
          c.onBoard?.(v === 'me' ? -1 : Number(v));
        }),
      );
      this.panel.querySelector('[data-act="leave"]')!.addEventListener('click', () => {
        this.close();
        c.onLeave();
      });
    }
    if (opts.hats) {
      const hs = opts.hats;
      this.panel.querySelectorAll<HTMLButtonElement>('[data-hat]').forEach((b) => {
        b.addEventListener('click', () => {
          hs.onPick(b.dataset.hat!);
          this.panel.querySelectorAll('[data-hat]').forEach((o) => o.classList.toggle('on', o === b));
          this.audio.click();
        });
      });
    }
    this.panel.querySelector('[data-act="resume"]')!.addEventListener('click', () => {
      this.audio.click();
      this.close();
      opts.onResume();
    });
    this.bindSaveTools(opts.onBeforeExport);
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
  private venue: Venue = 'shop';
  private exSel = '';
  private shopSel: { id: UpgradeId; lvl: number } | null = null;
  private shopNote = '';

  shop(game: GameState, venue: Venue = this.venue) {
    this.venue = venue;
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
    const lock = upgradeLock(sel.id, game.upgrades);
    if (owned) action = `<div class="sc-status ok">✓ Стоїть на твоєму човні</div>`;
    else if (next && lock) action = `<div class="sc-status">🔒 Спершу: ${esc(lock.replace(/^спершу /, ''))}</div>`;
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

    let body = '';
    if (venue === 'shop') {
      body = `<div class="vitrine"><div class="shelves">${shelves}</div>${showcase}</div>`;
    } else if (venue === 'office') {
      body = this.insuranceTab(game);
    } else if (venue === 'fuel') {
      const need = Math.ceil(game.maxFuel - game.fuel);
      body = `<div class="svc-card">
          <div class="svc-gauge"><span>Бак</span><span class="dbar big"><i style="width:${Math.round((game.fuel / game.maxFuel) * 100)}%"></i></span><b>${Math.round(game.fuel)}/${game.maxFuel} л</b></div>
          <div class="svc-price">${fuelPrice} ₴ за літр</div>
          <div class="btn-row">
            <button class="btn" data-fuel="10" ${game.money < fuelPrice * 10 || game.fuel >= game.maxFuel ? 'disabled' : ''}>+10 л — ${formatMoney(fuelPrice * 10)}</button>
            <button class="btn primary" data-fuel="max" ${game.money < fuelPrice || game.fuel >= game.maxFuel ? 'disabled' : ''}>${game.money >= fuelPrice * need ? `Повний бак — ${formatMoney(fuelPrice * need)}` : `На всі гроші — ${Math.floor(game.money / fuelPrice)} л`}</button>
          </div>
        </div>`;
    } else {
      const miss = game.maxHull - game.hull;
      const patch = Math.min(25, miss);
      body = `<div class="svc-card">
          <div class="svc-gauge"><span>Корпус</span><span class="dbar big${game.hull < game.maxHull * 0.4 ? ' low' : ''}"><i style="width:${Math.round((game.hull / game.maxHull) * 100)}%"></i></span><b>${Math.round(game.hull)}/${game.maxHull}</b></div>
          <div class="svc-price">${miss < 1 ? 'Корпус цілий — майстер лише кивнув' : 'Майстер оглянув днище й борти'}</div>
          <div class="btn-row">
            <button class="btn" data-patch ${miss < 1 || game.money < 35 ? 'disabled' : ''}>Латка +${Math.round(patch)} — 35 ₴</button>
            <button class="btn primary" data-repair ${miss < 1 || game.money < 100 ? 'disabled' : ''}>Повний ремонт — 100 ₴</button>
          </div>
        </div>`;
    }
    const V = VENUES[venue];

    this.show(`
      <div class="shop-head">
        <div><h1>${V.title}</h1><p class="sub">${V.sub}</p></div>
        <div class="shop-head-right">
          <div class="money-chip">${formatMoney(game.money)}</div>
        </div>
      </div>
      ${body}
      <p class="wayfind">${WAYFIND}</p>
      <div class="btn-row"><button class="btn" data-close>Закрити (Esc)</button></div>
    `, true, 'shop venue-' + venue);

    const refresh = () => this.shop(game);
    const view = this.panel.querySelector('[data-view]') as HTMLElement | null;
    if (view) requestAnimationFrame(() => view.isConnected && this.preview.showLive(view, sel.id, sel.lvl));

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
    this.panel.querySelector('[data-patch]')?.addEventListener('click', () => {
      if (game.money >= 35 && game.hull < game.maxHull) {
        game.money -= 35;
        game.hull = Math.min(game.maxHull, game.hull + 25);
        this.onBoatPurchase?.({ patch: 25 });
        this.audio.click();
        refresh();
      }
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

  // ── РИБНА БІРЖА ──
  // Окреме місце в порту: тут лише продають рибу. Табло котирувань, графік
  // вибраного виду, попит/насичення, біжучий рядок новин і прогноз виторгу.
  exchange(game: GameState) {
    this.escAllowed = true;
    if (!this.exSel || !FISH_BY_ID[this.exSel]) {
      // типово — найцінніша група в трюмі, інакше найдорожчий відомий вид
      const top = game.sellOrder(game.hold)[0]?.speciesId;
      this.exSel = top ?? [...FISH].reverse().find((f) => game.discovered.includes(f.id))?.id ?? FISH[0].id;
    }
    const scroll = this.panel.querySelector('.ex-board')?.scrollTop ?? 0;
    this.show(`
      <div class="shop-head ex-head">
        <div><h1>РИБНА БІРЖА <span class="ex-badge">«ШТОРМ»</span></h1><p class="sub">День цін ${game.priceWeek} · ${esc(game.priceTrendText)}</p></div>
        <div class="shop-head-right"><div class="money-chip">${formatMoney(game.money)}</div></div>
      </div>
      ${exchangeHtml(game, this.exSel)}
      <div class="btn-row"><button class="btn" data-close>Закрити (Esc)</button></div>
    `, true, 'shop exchange');
    const board = this.panel.querySelector('.ex-board');
    if (board) board.scrollTop = scroll;
    requestAnimationFrame(() => this.open && drawExchange(this.panel, game));
    const refresh = () => this.exchange(game);
    this.panel.querySelectorAll('[data-sp]').forEach((b) => {
      b.addEventListener('click', () => {
        this.exSel = (b as HTMLElement).dataset.sp!;
        this.audio.click();
        refresh();
      });
    });
    this.panel.querySelectorAll('[data-sellgroup]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = (b as HTMLElement).dataset.sellgroup;
        game.sellMany(game.hold.filter((f) => f.speciesId === id).map((f) => f.uid));
        this.audio.catchJingle();
        refresh();
      });
    });
    this.panel.querySelectorAll('[data-sell1]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = (b as HTMLElement).dataset.sell1;
        const f = game.sellOrder(game.hold.filter((x) => x.speciesId === id))[0];
        if (f) game.sellOne(f.uid);
        this.audio.click();
        refresh();
      });
    });
    this.panel.querySelector('[data-sellall]')?.addEventListener('click', () => {
      game.sellAll();
      this.audio.catchJingle();
      refresh();
    });
    this.panel.querySelector('[data-close]')!.addEventListener('click', () => this.close());
  }

  // ── СКУПНИКИ (таверна, коптильня, ресторан, завод, Остап) ──
  private byNote = '';

  buyer(game: GameState, id: BuyerId) {
    this.escAllowed = true;
    const scroll = this.panel.querySelector('.by-orders')?.scrollTop ?? 0;
    this.show(`
      ${buyerHtml(game, id)}
      ${this.byNote ? `<div class="by-note">${this.byNote}</div>` : ''}
      <div class="btn-row"><button class="btn" data-close>Закрити (Esc)</button></div>
    `, true, 'shop buyer');
    this.byNote = '';
    const ord = this.panel.querySelector('.by-orders');
    if (ord) ord.scrollTop = scroll;
    const refresh = () => this.buyer(game, id);
    const sell = (uids: number[]) => {
      const v = game.sellToBuyer(id, uids);
      if (v) this.byNote = `+${formatMoney(v)}`;
      this.audio.catchJingle();
      refresh();
    };
    this.panel.querySelectorAll('[data-bsell1]').forEach((b) => b.addEventListener('click', () => {
      const sp = (b as HTMLElement).dataset.bsell1!;
      const items = game.hold.filter((f) => f.speciesId === sp);
      const q = game.buyerQuote(id, items);
      const best = [...q.prices.entries()].sort((a, c) => c[1] - a[1])[0];
      if (best) sell([best[0]]);
    }));
    this.panel.querySelectorAll('[data-bsellsp]').forEach((b) => b.addEventListener('click', () => {
      const sp = (b as HTMLElement).dataset.bsellsp!;
      sell(game.hold.filter((f) => f.speciesId === sp).map((f) => f.uid));
    }));
    this.panel.querySelector('[data-bsellall]')?.addEventListener('click', () => sell(game.hold.map((f) => f.uid)));
    this.panel.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => {
      const cid = (b as HTMLElement).dataset.accept!;
      const c = game.trade.offers(BUYER_BY_ID[id], game.clockH, game.discovered).find((x) => x.id === cid);
      if (c && game.trade.accept(c)) {
        this.byNote = `📜 Замовлення взято: ${esc(c.title)}`;
        this.onTrade?.();
      }
      this.audio.click();
      refresh();
    }));
    this.panel.querySelectorAll('[data-deliver]').forEach((b) => b.addEventListener('click', () => {
      const r = game.deliverContract((b as HTMLElement).dataset.deliver!);
      if (r.done) {
        this.byNote = `✅ Замовлення виконано! +${formatMoney(r.reward)}`;
        this.audio.catchJingle();
      } else if (r.delivered) {
        this.byNote = `Здано ${r.delivered} шт — ще трохи`;
        this.audio.click();
      }
      this.onTrade?.();
      refresh();
    }));
    this.panel.querySelector('[data-close]')!.addEventListener('click', () => this.close());
  }

  /** замовлення змінились (зберегти гру) */
  onTrade: (() => void) | null = null;

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
      ${r.plan.tier < 2 ? '<p class="sub">Порада: оформи страховку в конторі порту (східна набережна), перш ніж іти в шторм.</p>' : ''}
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
