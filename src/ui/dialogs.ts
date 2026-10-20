import { formatMoney } from '../core/math';
import { fishSellPrice, FISH, FISH_BY_ID, ZONE_NAMES } from '../game/fish';
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
import { BUYER_BY_ID, contractTitle, type BuyerId } from '../game/buyers';
import { getLang, L, switchLang, type Lang } from '../core/i18n';

/** місця в порту — кожне зі своїми послугами */
export type Venue = 'shop' | 'fuel' | 'yard' | 'office';
const VENUES: Record<Venue, { title: string; sub: string }> = {
  shop: { title: L('КРАМНИЦЯ СПОРЯДЖЕННЯ', `CHANDLERY`), sub: L('Усе, що на полицях, ставиться просто на твій човен', `Everything on the shelves goes straight onto your boat`) },
  fuel: { title: L('ЗАПРАВКА', `FUEL DOCK`), sub: L('Дизель для мотора — під навісом біля причалу', `Diesel for the engine — under the awning by the pier`) },
  yard: { title: L('ВЕРФ', `SHIPYARD`), sub: L('Латаємо корпус після штормів і скель', `We patch hulls after storms and rocks`) },
  office: { title: L('КОНТОРА ПОРТУ', `HARBOUR OFFICE`), sub: L('Страхова агенція: поліс для човна й улову', `Insurance agency: a policy for your boat and catch`) },
};
/** хто де в порту — підказка внизу кожного вікна */
const WAYFIND = L('🐟 Рибу приймає <b>біржа</b> на східній набережній · 🛠 речі — <b>крамниця</b> · ⛽ <b>заправка</b> й 🔧 <b>верф</b> — біля причалу · 🛡 поліс — <b>контора порту</b>', `🐟 Fish is bought at the <b>exchange</b> on the east promenade · 🛠 gear — <b>chandlery</b> · ⛽ <b>fuel dock</b> and 🔧 <b>shipyard</b> — by the pier · 🛡 insurance — <b>harbour office</b>`);

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

/** вибір, скільки тенту стоїть на яхті (0 — знято повністю) */
const TENT_FIT: Array<[string, string]> = [
  ['☀️', L('Знято — відкритий кокпіт', `Removed — open cockpit`)],
  ['⛺', L('Лише козирок', `Sprayhood only`)],
  ['⛱', L('Козирок + біміні', `Sprayhood + bimini`)],
  ['🪟', L('+ штори', `+ curtains`)],
  ['🛋', L('+ подушки й гірлянда', `+ cushions and string lights`)],
  ['⛈', L('Штормовий (усе)', `Storm (everything)`)],
];

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
    this.show(L(`
      <h1 class="intro-title">Грозова<span>рибалка</span></h1>
      <div class="intro-sub">Storm Fishers · північне море</div>
      <p class="intro-lead">Своя яхта, тихий порт і відкрите море. Лови рибу, лови вітер у паруси, повертайся додому до заходу — або встигни до шторму.</p>
      <div class="intro-menu">
        ${hasSave ? L('<button class="btn primary" data-act="continue">Продовжити</button>', `<button class="btn primary" data-act="continue">Continue</button>`) : ''}
        <button class="btn ${hasSave ? '' : 'primary'}" data-act="new">${hasSave ? L('Нова гра', `New game`) : L('Вийти в море', `Set sail`)}</button>
      </div>
      <div class="intro-save">${hasSave && saveInfo ? L(`💾 Збережено: ${esc(saveInfo)}. `, `💾 Saved: ${esc(saveInfo)}. `) : ''}Прогрес зберігається автоматично в цьому браузері — і в соло, і в коопі. Щоб перенести на інший комп — експорт у файл.</div>
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
      ${coop ? L(`
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
      </div>`, `
      <h2>Play with friends</h2>
      <div class="coop-lobby">
        <label class="coop-field"><span>Nickname</span>
          <input id="coop-nick" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Your name" value="${esc(coop.nick)}"></label>
        <div class="coop-actions">
          <button class="btn primary" data-act="host">Create a room</button>
          <span class="coop-or">or</span>
          <input id="coop-code" maxlength="4" autocomplete="off" spellcheck="false" placeholder="CODE" value="${esc(coop.code)}">
          <button class="btn" data-act="join">Join</button>
        </div>
        <div class="coop-boat">
          <label><input type="radio" name="coop-boat" value="own" checked> on my own yacht</label>
          <label><input type="radio" name="coop-boat" value="crew"> as crew on the captain's boat</label>
        </div>
        <div class="coop-msg" id="coop-msg">Whoever creates the room is the captain: the world, weather and time are theirs. Friends enter the code and come on their own yachts (with their own progress) or as crew. You can switch boats at any time in the menu (Esc).</div>
      </div>`) : ''}
    `, `
      <h1 class="intro-title">Storm<span>Fishers</span></h1>
      <div class="intro-sub">Грозова рибалка · the North Sea</div>
      <p class="intro-lead">Your own yacht, a quiet harbour and the open sea. Catch fish, catch the wind in your sails, get home by sunset — or beat the storm.</p>
      <div class="intro-menu">
        ${hasSave ? L('<button class="btn primary" data-act="continue">Продовжити</button>', `<button class="btn primary" data-act="continue">Continue</button>`) : ''}
        <button class="btn ${hasSave ? '' : 'primary'}" data-act="new">${hasSave ? L('Нова гра', `New game`) : L('Вийти в море', `Set sail`)}</button>
      </div>
      <div class="intro-save">${hasSave && saveInfo ? L(`💾 Збережено: ${esc(saveInfo)}. `, `💾 Saved: ${esc(saveInfo)}. `) : ''}Progress saves automatically in this browser — solo and co-op alike. To move it to another computer, export it to a file.</div>
      ${this.saveToolsHtml()}
      <details class="intro-more">
        <summary>Controls</summary>
        <div class="intro-keys">
          <kbd>WASD</kbd><span>walk · at the wheel — throttle and rudder</span>
          <kbd>Mouse</kbd><span>look around</span>
          <kbd>E</kbd><span>use: wheel, halyards at the mast, rod, shop</span>
          <kbd>V</kbd><span>view at the wheel: from the stern / first person</span>
          <kbd>Space</kbd><span>reel in a fish · in water — swim up</span>
          <kbd>M</kbd><span>chart</span>
          <kbd>P</kbd><span>photo mode: free camera</span>
          <kbd>H</kbd><span>hide the interface</span>
          <kbd>Esc</kbd><span>menu</span>
        </div>
      </details>
      ${coop ? L(`
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
      </div>`, `
      <h2>Play with friends</h2>
      <div class="coop-lobby">
        <label class="coop-field"><span>Nickname</span>
          <input id="coop-nick" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Your name" value="${esc(coop.nick)}"></label>
        <div class="coop-actions">
          <button class="btn primary" data-act="host">Create a room</button>
          <span class="coop-or">or</span>
          <input id="coop-code" maxlength="4" autocomplete="off" spellcheck="false" placeholder="CODE" value="${esc(coop.code)}">
          <button class="btn" data-act="join">Join</button>
        </div>
        <div class="coop-boat">
          <label><input type="radio" name="coop-boat" value="own" checked> on my own yacht</label>
          <label><input type="radio" name="coop-boat" value="crew"> as crew on the captain's boat</label>
        </div>
        <div class="coop-msg" id="coop-msg">Whoever creates the room is the captain: the world, weather and time are theirs. Friends enter the code and come on their own yachts (with their own progress) or as crew. You can switch boats at any time in the menu (Esc).</div>
      </div>`) : ''}
    `), false, 'intro');
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
          msgEl.textContent = L('Введи нік', `Enter a nickname`);
          msgEl.className = 'coop-msg bad';
          nickEl.focus();
          return;
        }
        const code = codeEl.value.trim();
        if (join && code.length !== 4) {
          msgEl.textContent = L('Код кімнати — 4 символи (його бачить капітан у меню паузи)', `The room code is 4 characters (the captain sees it in the pause menu)`);
          msgEl.className = 'coop-msg bad';
          codeEl.focus();
          return;
        }
        this.audio.resume();
        this.audio.click();
        btns.forEach((b) => ((b as HTMLButtonElement).disabled = true));
        msgEl.textContent = join ? L('Під\'єднуємось…', `Connecting…`) : L('Створюємо кімнату…', `Creating a room…`);
        msgEl.className = 'coop-msg';
        try {
          const own = (this.panel.querySelector('input[name="coop-boat"]:checked') as HTMLInputElement | null)?.value !== 'crew';
          if (join) await coop.onJoin(nick, code, own);
          else await coop.onHost(nick);
          this.close();
        } catch (e) {
          msgEl.textContent = (e as Error).message || L('Помилка з\'єднання', `Connection error`);
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
        newBtn.textContent = L('Стерти прогрес? Клікни ще раз', `Erase progress? Click again`);
        newBtn.classList.add('danger');
        return;
      }
      this.close();
      onNew();
    });
    this.bindSaveTools();
    this.addLangSwitch('intro');
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

  /** перемикач мови EN | UA: зберегти гру й перезавантажити сторінку (так оновлюються й вивіски у світі) */
  private addLangSwitch(where: 'intro' | 'pause', beforeReload?: () => void, inRoom = false) {
    const box = document.createElement('div');
    box.className = 'lang-switch' + (where === 'intro' ? ' lang-intro' : '');
    box.innerHTML = `<span>${L('Мова', 'Language')}</span><button data-lang="en">EN</button><button data-lang="uk">UA</button>`;
    box.querySelector(`[data-lang="${getLang()}"]`)?.classList.add('on');
    let armed = false;
    box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      const l = b?.dataset.lang as Lang | undefined;
      if (!b || !l || l === getLang()) return;
      this.audio.click();
      // у кооп-кімнаті перезавантаження — це вихід із кімнати: перепитуємо
      if (inRoom && !armed) {
        armed = true;
        b.textContent = L('Ще раз — вийде з кімнати', 'Again — leaves the room');
        return;
      }
      switchLang(l, beforeReload);
    });
    if (where === 'intro') this.panel.prepend(box);
    else this.panel.querySelector('.settings')?.before(box);
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
      if (exportSave()) say(L('Файл сейву завантажено ✓ Перенеси його на інший комп і натисни там «Імпорт сейву».', `Save file downloaded ✓ Move it to the other computer and press “Import save” there.`), 'good');
      else say(L('Ще нічого не збережено.', `Nothing has been saved yet.`), 'bad');
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
        say(L(`Знайдено: <b>${esc(p.summary)}</b>.<br>${hasAnySave() ? L('Поточний прогрес у цьому браузері буде замінено. ', `Your current progress in this browser will be replaced. `) : ''}<button class="btn primary" data-act="imp-ok">Завантажити цей сейв</button>`, `Found: <b>${esc(p.summary)}</b>.<br>${hasAnySave() ? L('Поточний прогрес у цьому браузері буде замінено. ', `Your current progress in this browser will be replaced. `) : ''}<button class="btn primary" data-act="imp-ok">Load this save</button>`));
        msg.querySelector('[data-act="imp-ok"]')!.addEventListener('click', () => {
          applyImport(p);
          say(L('Сейв імпортовано — перезапуск…', `Save imported — restarting…`), 'good');
          setTimeout(() => location.reload(), 300);
        });
      } catch (e) {
        say(esc((e as Error).message), 'bad');
      }
    });
  }

  private saveToolsHtml(): string {
    return L(`<div class="save-tools">
        <button class="btn small" data-act="exp">⬇ Експорт сейву</button>
        <button class="btn small" data-act="imp">⬆ Імпорт сейву</button>
        <input type="file" accept=".json,application/json" hidden>
        <div class="save-msg"></div>
      </div>`, `<div class="save-tools">
        <button class="btn small" data-act="exp">⬇ Export save</button>
        <button class="btn small" data-act="imp">⬆ Import save</button>
        <input type="file" accept=".json,application/json" hidden>
        <div class="save-msg"></div>
      </div>`);
  }

  // ── ПАУЗА ──

  pause(opts: { onResume: () => void; onReset: () => void; onBeforeExport?: () => void; settings: Settings; onSettings: (s: Settings) => void; playTime: number; places?: Array<{ name: string; found: boolean }>; coop?: CoopPause; hats?: HatsPause; tent?: { owned: number; fit: number; onPick: (l: number) => void }; game?: GameState }) {
    this.escAllowed = false;
    const tentHtml = opts.tent && opts.tent.owned > 0 ? `
      <h2>${L('Тент на яхті', 'Canvas on the yacht')}</h2>
      <p class="sub">${L('Знімай частину або весь — куплене лишається, повернеш будь-коли. Скласти/розкласти на ходу — E біля лівого обруча біміні.', 'Take off part of it or all of it — what you bought stays yours, put it back any time. Fold/unfold under way — E by the left bimini hoop.')}</p>
      <div class="hats">${TENT_FIT.slice(0, opts.tent.owned + 1).map((t, l) => `<button class="hat${l === opts.tent!.fit ? ' on' : ''}" data-tent="${l}"><span class="hat-ico">${t[0]}</span><span class="hat-name">${t[1]}</span></button>`).join('')}</div>` : '';
    this.show(L(`
      <h1>Пауза</h1>
      <p class="sub">${opts.coop ? L('Світ живе далі — екіпаж у морі.', `The world goes on — the crew is at sea.`) : L('Час зупинений. Море чекає.', `Time has stopped. The sea is waiting.`)}</p>
      <div class="btn-row">
        <button class="btn primary" data-act="resume">Продовжити</button>
        ${opts.coop ? '' : L('<button class="btn danger" data-act="reset">Скинути гру</button>', `<button class="btn danger" data-act="reset">Reset game</button>`)}
      </div>
      ${opts.coop ? L(`
      <h2>Кімната <span class="coop-code">${esc(opts.coop.room)}</span></h2>
      <p class="sub">${opts.coop.host ? L('Ти — капітан. Друзі: відкрити гру за адресою нижче й ввести код (або просто перейти за посиланням).', `You're the captain. Friends: open the game at the address below and enter the code (or just follow the link).`) : L('Ти в екіпажі. Човном і світом керує капітан.', `You're crew. The captain runs the boat and the world.`)}</p>
      <div class="coop-link"><input readonly value="${esc(opts.coop.link)}"><button class="btn" data-act="copy">Копіювати</button></div>
      <div class="coop-players">${opts.coop.players.map((p) => `<span class="coop-chip" style="--c:${p.color}">${esc(p.nick)}${p.host ? ' ⚓' : ''}${p.me ? L(' (ти)', ` (you)`) : ''}</span>`).join('')}</div>
      ${opts.coop.boats?.length ? L(`<h2>Яхти</h2><div class="fleet">${opts.coop.boats.map((b) => `
        <div class="fleet-row${b.here ? ' here' : ''}">
          <span class="fleet-name">⛵ ${b.mine ? L('Моя яхта', `My yacht`) : L(`Яхта ${esc(b.nick)}`, `Yacht ${esc(b.nick)}`)}</span>
          <span class="fleet-crew">${b.crew.length ? L('екіпаж: ', `crew: `) + b.crew.map(esc).join(', ') : L('без екіпажу', `no crew`)}</span>
          ${b.here ? L('<span class="fleet-here">ти тут</span>', `<span class="fleet-here">you're here</span>`) : `<button class="btn small" data-board="${b.owner}">${b.mine ? L('На свою яхту', `To my yacht`) : L('На борт', `Board`)}</button>`}
        </div>`).join('')}
        ${opts.coop.boats.some((b) => b.mine) ? '' : L('<div class="fleet-row"><span class="fleet-name">⛵ Моя яхта</span><span class="fleet-crew">стоїть біля причалу</span><button class="btn small" data-board="me">Вийти на своїй</button></div>', `<div class="fleet-row"><span class="fleet-name">⛵ My yacht</span><span class="fleet-crew">moored at the pier</span><button class="btn small" data-board="me">Sail my own</button></div>`)}
      </div>`, `<h2>Yachts</h2><div class="fleet">${opts.coop.boats.map((b) => `
        <div class="fleet-row${b.here ? ' here' : ''}">
          <span class="fleet-name">⛵ ${b.mine ? L('Моя яхта', `My yacht`) : L(`Яхта ${esc(b.nick)}`, `Yacht ${esc(b.nick)}`)}</span>
          <span class="fleet-crew">${b.crew.length ? L('екіпаж: ', `crew: `) + b.crew.map(esc).join(', ') : L('без екіпажу', `no crew`)}</span>
          ${b.here ? L('<span class="fleet-here">ти тут</span>', `<span class="fleet-here">you're here</span>`) : `<button class="btn small" data-board="${b.owner}">${b.mine ? L('На свою яхту', `To my yacht`) : L('На борт', `Board`)}</button>`}
        </div>`).join('')}
        ${opts.coop.boats.some((b) => b.mine) ? '' : L('<div class="fleet-row"><span class="fleet-name">⛵ Моя яхта</span><span class="fleet-crew">стоїть біля причалу</span><button class="btn small" data-board="me">Вийти на своїй</button></div>', `<div class="fleet-row"><span class="fleet-name">⛵ My yacht</span><span class="fleet-crew">moored at the pier</span><button class="btn small" data-board="me">Sail my own</button></div>`)}
      </div>`) : ''}
      <div class="btn-row"><button class="btn danger" data-act="leave">${opts.coop.host ? L('Закрити кімнату', `Close the room`) : L('Покинути кімнату', `Leave the room`)}</button></div>`, `
      <h2>Room <span class="coop-code">${esc(opts.coop.room)}</span></h2>
      <p class="sub">${opts.coop.host ? L('Ти — капітан. Друзі: відкрити гру за адресою нижче й ввести код (або просто перейти за посиланням).', `You're the captain. Friends: open the game at the address below and enter the code (or just follow the link).`) : L('Ти в екіпажі. Човном і світом керує капітан.', `You're crew. The captain runs the boat and the world.`)}</p>
      <div class="coop-link"><input readonly value="${esc(opts.coop.link)}"><button class="btn" data-act="copy">Copy</button></div>
      <div class="coop-players">${opts.coop.players.map((p) => `<span class="coop-chip" style="--c:${p.color}">${esc(p.nick)}${p.host ? ' ⚓' : ''}${p.me ? L(' (ти)', ` (you)`) : ''}</span>`).join('')}</div>
      ${opts.coop.boats?.length ? L(`<h2>Яхти</h2><div class="fleet">${opts.coop.boats.map((b) => `
        <div class="fleet-row${b.here ? ' here' : ''}">
          <span class="fleet-name">⛵ ${b.mine ? L('Моя яхта', `My yacht`) : L(`Яхта ${esc(b.nick)}`, `Yacht ${esc(b.nick)}`)}</span>
          <span class="fleet-crew">${b.crew.length ? L('екіпаж: ', `crew: `) + b.crew.map(esc).join(', ') : L('без екіпажу', `no crew`)}</span>
          ${b.here ? L('<span class="fleet-here">ти тут</span>', `<span class="fleet-here">you're here</span>`) : `<button class="btn small" data-board="${b.owner}">${b.mine ? L('На свою яхту', `To my yacht`) : L('На борт', `Board`)}</button>`}
        </div>`).join('')}
        ${opts.coop.boats.some((b) => b.mine) ? '' : L('<div class="fleet-row"><span class="fleet-name">⛵ Моя яхта</span><span class="fleet-crew">стоїть біля причалу</span><button class="btn small" data-board="me">Вийти на своїй</button></div>', `<div class="fleet-row"><span class="fleet-name">⛵ My yacht</span><span class="fleet-crew">moored at the pier</span><button class="btn small" data-board="me">Sail my own</button></div>`)}
      </div>`, `<h2>Yachts</h2><div class="fleet">${opts.coop.boats.map((b) => `
        <div class="fleet-row${b.here ? ' here' : ''}">
          <span class="fleet-name">⛵ ${b.mine ? L('Моя яхта', `My yacht`) : L(`Яхта ${esc(b.nick)}`, `Yacht ${esc(b.nick)}`)}</span>
          <span class="fleet-crew">${b.crew.length ? L('екіпаж: ', `crew: `) + b.crew.map(esc).join(', ') : L('без екіпажу', `no crew`)}</span>
          ${b.here ? L('<span class="fleet-here">ти тут</span>', `<span class="fleet-here">you're here</span>`) : `<button class="btn small" data-board="${b.owner}">${b.mine ? L('На свою яхту', `To my yacht`) : L('На борт', `Board`)}</button>`}
        </div>`).join('')}
        ${opts.coop.boats.some((b) => b.mine) ? '' : L('<div class="fleet-row"><span class="fleet-name">⛵ Моя яхта</span><span class="fleet-crew">стоїть біля причалу</span><button class="btn small" data-board="me">Вийти на своїй</button></div>', `<div class="fleet-row"><span class="fleet-name">⛵ My yacht</span><span class="fleet-crew">moored at the pier</span><button class="btn small" data-board="me">Sail my own</button></div>`)}
      </div>`) : ''}
      <div class="btn-row"><button class="btn danger" data-act="leave">${opts.coop.host ? L('Закрити кімнату', `Close the room`) : L('Покинути кімнату', `Leave the room`)}</button></div>`) : ''}
      ${opts.places ? L(`
      <h2>Місця · ${opts.places.filter((p) => p.found).length}/${opts.places.length}</h2>
      <div class="places">${opts.places.map((p) => `<span class="place${p.found ? ' found' : ''}">${p.found ? esc(p.name) : '???'}</span>`).join('')}</div>`, `
      <h2>Places · ${opts.places.filter((p) => p.found).length}/${opts.places.length}</h2>
      <div class="places">${opts.places.map((p) => `<span class="place${p.found ? ' found' : ''}">${p.found ? esc(p.name) : '???'}</span>`).join('')}</div>`) : ''}
      ${opts.game ? L(`<h2>Замовлення · ${opts.game.trade.active.length}/3</h2>${ordersHtml(opts.game)}`, `<h2>Orders · ${opts.game.trade.active.length}/3</h2>${ordersHtml(opts.game)}`) : ''}
      ${tentHtml}
      ${opts.hats ? L(`
      <h2>Капелюхи · ${opts.hats.list.filter((h) => h.owned).length}/${opts.hats.list.length}</h2>
      <p class="sub">Знахідки з островів — зійди на берег і шукай, що блищить. Вибраний капелюх видно з-за корми й друзям.</p>
      <div class="hats">${opts.hats.list.map((h) => `<button class="hat${h.owned ? '' : ' locked'}${h.id === opts.hats!.current ? ' on' : ''}" data-hat="${h.id}" ${h.owned ? '' : 'disabled'} title="${esc(h.owned ? h.name : L('Де шукати: ', `Where to look: `) + h.hint)}"><span class="hat-ico">${h.owned ? h.icon : '❔'}</span><span class="hat-name">${esc(h.owned ? h.name : h.hint)}</span></button>`).join('')}</div>`, `
      <h2>Hats · ${opts.hats.list.filter((h) => h.owned).length}/${opts.hats.list.length}</h2>
      <p class="sub">Finds from the islands — go ashore and look for what glitters. Your chosen hat is visible from the stern and to friends.</p>
      <div class="hats">${opts.hats.list.map((h) => `<button class="hat${h.owned ? '' : ' locked'}${h.id === opts.hats!.current ? ' on' : ''}" data-hat="${h.id}" ${h.owned ? '' : 'disabled'} title="${esc(h.owned ? h.name : L('Де шукати: ', `Where to look: `) + h.hint)}"><span class="hat-ico">${h.owned ? h.icon : '❔'}</span><span class="hat-name">${esc(h.owned ? h.name : h.hint)}</span></button>`).join('')}</div>`) : ''}
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
        <label>Темп гри<input type="range" min="-100" max="100" step="25" data-k="pace"><output></output></label>
        <p class="sub">Динамічний — клює частіше, але риба дешевша; спокійний — рідше, але дорожче. У кооп-кімнаті діє темп господаря.</p>
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
        ${opts.coop ? L('<kbd>Enter</kbd><span>чат з екіпажем</span>', `<kbd>Enter</kbd><span>chat with the crew</span>`) : ''}
      </div>
    `, `
      <h1>Paused</h1>
      <p class="sub">${opts.coop ? L('Світ живе далі — екіпаж у морі.', `The world goes on — the crew is at sea.`) : L('Час зупинений. Море чекає.', `Time has stopped. The sea is waiting.`)}</p>
      <div class="btn-row">
        <button class="btn primary" data-act="resume">Continue</button>
        ${opts.coop ? '' : L('<button class="btn danger" data-act="reset">Скинути гру</button>', `<button class="btn danger" data-act="reset">Reset game</button>`)}
      </div>
      ${opts.coop ? L(`
      <h2>Кімната <span class="coop-code">${esc(opts.coop.room)}</span></h2>
      <p class="sub">${opts.coop.host ? L('Ти — капітан. Друзі: відкрити гру за адресою нижче й ввести код (або просто перейти за посиланням).', `You're the captain. Friends: open the game at the address below and enter the code (or just follow the link).`) : L('Ти в екіпажі. Човном і світом керує капітан.', `You're crew. The captain runs the boat and the world.`)}</p>
      <div class="coop-link"><input readonly value="${esc(opts.coop.link)}"><button class="btn" data-act="copy">Копіювати</button></div>
      <div class="coop-players">${opts.coop.players.map((p) => `<span class="coop-chip" style="--c:${p.color}">${esc(p.nick)}${p.host ? ' ⚓' : ''}${p.me ? L(' (ти)', ` (you)`) : ''}</span>`).join('')}</div>
      ${opts.coop.boats?.length ? L(`<h2>Яхти</h2><div class="fleet">${opts.coop.boats.map((b) => `
        <div class="fleet-row${b.here ? ' here' : ''}">
          <span class="fleet-name">⛵ ${b.mine ? L('Моя яхта', `My yacht`) : L(`Яхта ${esc(b.nick)}`, `Yacht ${esc(b.nick)}`)}</span>
          <span class="fleet-crew">${b.crew.length ? L('екіпаж: ', `crew: `) + b.crew.map(esc).join(', ') : L('без екіпажу', `no crew`)}</span>
          ${b.here ? L('<span class="fleet-here">ти тут</span>', `<span class="fleet-here">you're here</span>`) : `<button class="btn small" data-board="${b.owner}">${b.mine ? L('На свою яхту', `To my yacht`) : L('На борт', `Board`)}</button>`}
        </div>`).join('')}
        ${opts.coop.boats.some((b) => b.mine) ? '' : L('<div class="fleet-row"><span class="fleet-name">⛵ Моя яхта</span><span class="fleet-crew">стоїть біля причалу</span><button class="btn small" data-board="me">Вийти на своїй</button></div>', `<div class="fleet-row"><span class="fleet-name">⛵ My yacht</span><span class="fleet-crew">moored at the pier</span><button class="btn small" data-board="me">Sail my own</button></div>`)}
      </div>`, `<h2>Yachts</h2><div class="fleet">${opts.coop.boats.map((b) => `
        <div class="fleet-row${b.here ? ' here' : ''}">
          <span class="fleet-name">⛵ ${b.mine ? L('Моя яхта', `My yacht`) : L(`Яхта ${esc(b.nick)}`, `Yacht ${esc(b.nick)}`)}</span>
          <span class="fleet-crew">${b.crew.length ? L('екіпаж: ', `crew: `) + b.crew.map(esc).join(', ') : L('без екіпажу', `no crew`)}</span>
          ${b.here ? L('<span class="fleet-here">ти тут</span>', `<span class="fleet-here">you're here</span>`) : `<button class="btn small" data-board="${b.owner}">${b.mine ? L('На свою яхту', `To my yacht`) : L('На борт', `Board`)}</button>`}
        </div>`).join('')}
        ${opts.coop.boats.some((b) => b.mine) ? '' : L('<div class="fleet-row"><span class="fleet-name">⛵ Моя яхта</span><span class="fleet-crew">стоїть біля причалу</span><button class="btn small" data-board="me">Вийти на своїй</button></div>', `<div class="fleet-row"><span class="fleet-name">⛵ My yacht</span><span class="fleet-crew">moored at the pier</span><button class="btn small" data-board="me">Sail my own</button></div>`)}
      </div>`) : ''}
      <div class="btn-row"><button class="btn danger" data-act="leave">${opts.coop.host ? L('Закрити кімнату', `Close the room`) : L('Покинути кімнату', `Leave the room`)}</button></div>`, `
      <h2>Room <span class="coop-code">${esc(opts.coop.room)}</span></h2>
      <p class="sub">${opts.coop.host ? L('Ти — капітан. Друзі: відкрити гру за адресою нижче й ввести код (або просто перейти за посиланням).', `You're the captain. Friends: open the game at the address below and enter the code (or just follow the link).`) : L('Ти в екіпажі. Човном і світом керує капітан.', `You're crew. The captain runs the boat and the world.`)}</p>
      <div class="coop-link"><input readonly value="${esc(opts.coop.link)}"><button class="btn" data-act="copy">Copy</button></div>
      <div class="coop-players">${opts.coop.players.map((p) => `<span class="coop-chip" style="--c:${p.color}">${esc(p.nick)}${p.host ? ' ⚓' : ''}${p.me ? L(' (ти)', ` (you)`) : ''}</span>`).join('')}</div>
      ${opts.coop.boats?.length ? L(`<h2>Яхти</h2><div class="fleet">${opts.coop.boats.map((b) => `
        <div class="fleet-row${b.here ? ' here' : ''}">
          <span class="fleet-name">⛵ ${b.mine ? L('Моя яхта', `My yacht`) : L(`Яхта ${esc(b.nick)}`, `Yacht ${esc(b.nick)}`)}</span>
          <span class="fleet-crew">${b.crew.length ? L('екіпаж: ', `crew: `) + b.crew.map(esc).join(', ') : L('без екіпажу', `no crew`)}</span>
          ${b.here ? L('<span class="fleet-here">ти тут</span>', `<span class="fleet-here">you're here</span>`) : `<button class="btn small" data-board="${b.owner}">${b.mine ? L('На свою яхту', `To my yacht`) : L('На борт', `Board`)}</button>`}
        </div>`).join('')}
        ${opts.coop.boats.some((b) => b.mine) ? '' : L('<div class="fleet-row"><span class="fleet-name">⛵ Моя яхта</span><span class="fleet-crew">стоїть біля причалу</span><button class="btn small" data-board="me">Вийти на своїй</button></div>', `<div class="fleet-row"><span class="fleet-name">⛵ My yacht</span><span class="fleet-crew">moored at the pier</span><button class="btn small" data-board="me">Sail my own</button></div>`)}
      </div>`, `<h2>Yachts</h2><div class="fleet">${opts.coop.boats.map((b) => `
        <div class="fleet-row${b.here ? ' here' : ''}">
          <span class="fleet-name">⛵ ${b.mine ? L('Моя яхта', `My yacht`) : L(`Яхта ${esc(b.nick)}`, `Yacht ${esc(b.nick)}`)}</span>
          <span class="fleet-crew">${b.crew.length ? L('екіпаж: ', `crew: `) + b.crew.map(esc).join(', ') : L('без екіпажу', `no crew`)}</span>
          ${b.here ? L('<span class="fleet-here">ти тут</span>', `<span class="fleet-here">you're here</span>`) : `<button class="btn small" data-board="${b.owner}">${b.mine ? L('На свою яхту', `To my yacht`) : L('На борт', `Board`)}</button>`}
        </div>`).join('')}
        ${opts.coop.boats.some((b) => b.mine) ? '' : L('<div class="fleet-row"><span class="fleet-name">⛵ Моя яхта</span><span class="fleet-crew">стоїть біля причалу</span><button class="btn small" data-board="me">Вийти на своїй</button></div>', `<div class="fleet-row"><span class="fleet-name">⛵ My yacht</span><span class="fleet-crew">moored at the pier</span><button class="btn small" data-board="me">Sail my own</button></div>`)}
      </div>`) : ''}
      <div class="btn-row"><button class="btn danger" data-act="leave">${opts.coop.host ? L('Закрити кімнату', `Close the room`) : L('Покинути кімнату', `Leave the room`)}</button></div>`) : ''}
      ${opts.places ? L(`
      <h2>Місця · ${opts.places.filter((p) => p.found).length}/${opts.places.length}</h2>
      <div class="places">${opts.places.map((p) => `<span class="place${p.found ? ' found' : ''}">${p.found ? esc(p.name) : '???'}</span>`).join('')}</div>`, `
      <h2>Places · ${opts.places.filter((p) => p.found).length}/${opts.places.length}</h2>
      <div class="places">${opts.places.map((p) => `<span class="place${p.found ? ' found' : ''}">${p.found ? esc(p.name) : '???'}</span>`).join('')}</div>`) : ''}
      ${opts.game ? L(`<h2>Замовлення · ${opts.game.trade.active.length}/3</h2>${ordersHtml(opts.game)}`, `<h2>Orders · ${opts.game.trade.active.length}/3</h2>${ordersHtml(opts.game)}`) : ''}
      ${tentHtml}
      ${opts.hats ? L(`
      <h2>Капелюхи · ${opts.hats.list.filter((h) => h.owned).length}/${opts.hats.list.length}</h2>
      <p class="sub">Знахідки з островів — зійди на берег і шукай, що блищить. Вибраний капелюх видно з-за корми й друзям.</p>
      <div class="hats">${opts.hats.list.map((h) => `<button class="hat${h.owned ? '' : ' locked'}${h.id === opts.hats!.current ? ' on' : ''}" data-hat="${h.id}" ${h.owned ? '' : 'disabled'} title="${esc(h.owned ? h.name : L('Де шукати: ', `Where to look: `) + h.hint)}"><span class="hat-ico">${h.owned ? h.icon : '❔'}</span><span class="hat-name">${esc(h.owned ? h.name : h.hint)}</span></button>`).join('')}</div>`, `
      <h2>Hats · ${opts.hats.list.filter((h) => h.owned).length}/${opts.hats.list.length}</h2>
      <p class="sub">Finds from the islands — go ashore and look for what glitters. Your chosen hat is visible from the stern and to friends.</p>
      <div class="hats">${opts.hats.list.map((h) => `<button class="hat${h.owned ? '' : ' locked'}${h.id === opts.hats!.current ? ' on' : ''}" data-hat="${h.id}" ${h.owned ? '' : 'disabled'} title="${esc(h.owned ? h.name : L('Де шукати: ', `Where to look: `) + h.hint)}"><span class="hat-ico">${h.owned ? h.icon : '❔'}</span><span class="hat-name">${esc(h.owned ? h.name : h.hint)}</span></button>`).join('')}</div>`) : ''}
      <h2>Saving</h2>
      <p class="sub">The game saves itself. To play on another computer, export your save to a file and import it there.</p>
      ${this.saveToolsHtml()}
      <h2>Settings</h2>
      <div class="settings">
        <label>Volume<input type="range" min="0" max="100" data-k="volume"><output></output></label>
        <label>Music<input type="range" min="0" max="100" data-k="music"><output></output></label>
        <label>Mouse sensitivity<input type="range" min="30" max="250" data-k="sens"><output></output></label>
        <label>Field of view<input type="range" min="55" max="95" data-k="fov"><output></output></label>
        <label>Sharpness<input type="range" min="50" max="100" step="5" data-k="scale"><output></output></label>
        <label class="chk"><input type="checkbox" data-k="invertY"><span>Invert mouse Y</span></label>
        <label class="chk"><input type="checkbox" data-k="easyFish"><span>Easy fishing — more time to strike and to make mistakes</span></label>
        <label>Game pace<input type="range" min="-100" max="100" step="25" data-k="pace"><output></output></label>
        <p class="sub">Lively — more bites, but cheaper fish; relaxed — fewer bites, but pricier. In a co-op room the host's pace applies.</p>
      </div>
      <h2>Controls</h2>
      <div class="intro-keys">
        <kbd>WASD</kbd><span>walk · at the wheel: W/S throttle, A/D rudder</span>
        <kbd>E</kbd><span>use: wheel, halyards, rod, shop</span>
        <kbd>V</kbd><span>view at the wheel: from the stern / first person</span>
        <kbd>Space</kbd><span>reel in a fish · in water — swim up</span>
        <kbd>M</kbd><span>chart</span>
        <kbd>P</kbd><span>photo mode</span>
        <kbd>H</kbd><span>hide the interface</span>
        ${opts.coop ? L('<kbd>Enter</kbd><span>чат з екіпажем</span>', `<kbd>Enter</kbd><span>chat with the crew</span>`) : ''}
      </div>
    `), false);
    if (opts.coop) {
      const c = opts.coop;
      this.panel.querySelector('[data-act="copy"]')!.addEventListener('click', (e) => {
        void navigator.clipboard?.writeText(c.link).catch(() => {});
        (this.panel.querySelector('.coop-link input') as HTMLInputElement).select();
        (e.target as HTMLElement).textContent = L('Скопійовано ✓', `Copied ✓`);
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
    if (opts.tent) {
      const tn = opts.tent;
      this.panel.querySelectorAll<HTMLButtonElement>('[data-tent]').forEach((b) => {
        b.addEventListener('click', () => {
          tn.onPick(Number(b.dataset.tent));
          this.panel.querySelectorAll('[data-tent]').forEach((o) => o.classList.toggle('on', o === b));
          this.audio.click();
        });
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
    this.addLangSwitch('pause', opts.onBeforeExport, !!opts.coop);
    // налаштування: повзунки змінюють одразу
    const st = { ...opts.settings };
    const fmt: Record<string, (v: number) => string> = {
      volume: (v) => `${Math.round(v * 100)} %`,
      music: (v) => (v < 0.005 ? L('вимк', `off`) : `${Math.round(v * 100)} %`),
      sens: (v) => `×${v.toFixed(2).replace('.', L(',', '.'))}`,
      fov: (v) => `${Math.round(v)}°`,
      scale: (v) => (v >= 0.995 ? L('максимум', `maximum`) : `${Math.round(v * 100)} %`),
      // клювання в рази частіше/рідше, ціна — та сама частка
      pace: (v) => {
        const k = Math.pow(1.6, v);
        if (Math.abs(v) < 0.01) return L('звичайний', `normal`);
        const x = (n: number) => `×${n.toFixed(2).replace('.', L(',', '.'))}`;
        return (v > 0 ? L('динамічний', `lively`) : L('спокійний', `relaxed`)) + ` · ${L('клює', 'bites')} ${x(k)} · ${L('ціна', 'price')} ${x(1 / k)}`;
      },
    };
    const scale: Record<string, number> = { volume: 100, music: 100, sens: 100, fov: 1, scale: 100, pace: 100 };
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
        reset.textContent = L('Точно? Натисни ще раз', `Sure? Press again`);
        setTimeout(() => {
          armed = false;
          reset.textContent = L('Скинути гру', `Reset game`);
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
    const fuelPrice = game.venueFuel;
    const rk = game.venueRepair;
    const patchCost = Math.round(35 * rk), fullCost = Math.round(100 * rk);
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
        const tag = owned ? L('<span class="tag-on">✓ на човні</span>', `<span class="tag-on">✓ on the boat</span>`) : next ? `<span class="price">${formatMoney(cost)}</span>` : `<span class="price dim">${formatMoney(cost)}</span>`;
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
    const statHead = owned ? L('<tr><th></th><th>зараз</th></tr>', `<tr><th></th><th>now</th></tr>`) : L(`<tr><th></th><th>зараз</th><th></th><th>${next ? L('з цією річчю', `with this item`) : L(`на рівні ${sel.lvl}`, `at level ${sel.lvl}`)}</th></tr>`, `<tr><th></th><th>now</th><th></th><th>${next ? L('з цією річчю', `with this item`) : L(`на рівні ${sel.lvl}`, `at level ${sel.lvl}`)}</th></tr>`);
    let action: string;
    const lock = upgradeLock(sel.id, game.upgrades);
    if (owned) action = L(`<div class="sc-status ok">✓ Стоїть на твоєму човні</div>`, `<div class="sc-status ok">✓ Fitted on your boat</div>`);
    else if (next && lock) action = L(`<div class="sc-status">🔒 Спершу: ${esc(lock.replace(/^спершу /, ''))}</div>`, `<div class="sc-status">🔒 First: ${esc(lock.replace(/^спершу /, ''))}</div>`);
    else if (next) action = L(`<button class="btn primary sc-buy" data-buy="${sel.id}" ${game.money < cost ? 'disabled' : ''}>Купити й поставити — ${formatMoney(cost)}</button>
        ${game.money < cost ? L(`<div class="sc-status">Бракує ${formatMoney(cost - game.money)}</div>`, `<div class="sc-status">Short by ${formatMoney(cost - game.money)}</div>`) : ''}`, `<button class="btn primary sc-buy" data-buy="${sel.id}" ${game.money < cost ? 'disabled' : ''}>Buy and fit — ${formatMoney(cost)}</button>
        ${game.money < cost ? L(`<div class="sc-status">Бракує ${formatMoney(cost - game.money)}</div>`, `<div class="sc-status">Short by ${formatMoney(cost - game.money)}</div>`) : ''}`);
    else action = L(`<div class="sc-status">🔒 Спершу постав «${esc(def.parts[cur].name)}»</div>`, `<div class="sc-status">🔒 Fit “${esc(def.parts[cur].name)}” first</div>`);
    const showcase = L(`
      <div class="showcase">
        <div class="sc-view" data-view></div>
        <div class="sc-cat">${def.name} · рівень ${sel.lvl}/5</div>
        <h3 class="sc-name">${esc(part.name)}</h3>
        <p class="sc-blurb">${esc(part.blurb)}</p>
        <table class="sc-stats">${statHead}${statRows}</table>
        ${this.shopNote ? `<div class="sc-note">${this.shopNote}</div>` : ''}
        ${action}
      </div>`, `
      <div class="showcase">
        <div class="sc-view" data-view></div>
        <div class="sc-cat">${def.name} · level ${sel.lvl}/5</div>
        <h3 class="sc-name">${esc(part.name)}</h3>
        <p class="sc-blurb">${esc(part.blurb)}</p>
        <table class="sc-stats">${statHead}${statRows}</table>
        ${this.shopNote ? `<div class="sc-note">${this.shopNote}</div>` : ''}
        ${action}
      </div>`);

    let body = '';
    if (venue === 'shop') {
      body = `<div class="vitrine"><div class="shelves">${shelves}</div>${showcase}</div>`;
    } else if (venue === 'office') {
      body = this.insuranceTab(game);
    } else if (venue === 'fuel') {
      const need = Math.ceil(game.maxFuel - game.fuel);
      body = L(`<div class="svc-card">
          <div class="svc-gauge"><span>Бак</span><span class="dbar big"><i style="width:${Math.round((game.fuel / game.maxFuel) * 100)}%"></i></span><b>${Math.round(game.fuel)}/${game.maxFuel} л</b></div>
          <div class="svc-price">${fuelPrice} ₴ за літр</div>
          <div class="btn-row">
            <button class="btn" data-fuel="10" ${game.money < fuelPrice * 10 || game.fuel >= game.maxFuel ? 'disabled' : ''}>+10 л — ${formatMoney(fuelPrice * 10)}</button>
            <button class="btn primary" data-fuel="max" ${game.money < fuelPrice || game.fuel >= game.maxFuel ? 'disabled' : ''}>${game.money >= fuelPrice * need ? L(`Повний бак — ${formatMoney(fuelPrice * need)}`, `Full tank — ${formatMoney(fuelPrice * need)}`) : L(`На всі гроші — ${Math.floor(game.money / fuelPrice)} л`, `All your money — ${Math.floor(game.money / fuelPrice)} l`)}</button>
          </div>
        </div>`, `<div class="svc-card">
          <div class="svc-gauge"><span>Tank</span><span class="dbar big"><i style="width:${Math.round((game.fuel / game.maxFuel) * 100)}%"></i></span><b>${Math.round(game.fuel)}/${game.maxFuel} l</b></div>
          <div class="svc-price">${fuelPrice} ₴ per litre</div>
          <div class="btn-row">
            <button class="btn" data-fuel="10" ${game.money < fuelPrice * 10 || game.fuel >= game.maxFuel ? 'disabled' : ''}>+10 l — ${formatMoney(fuelPrice * 10)}</button>
            <button class="btn primary" data-fuel="max" ${game.money < fuelPrice || game.fuel >= game.maxFuel ? 'disabled' : ''}>${game.money >= fuelPrice * need ? L(`Повний бак — ${formatMoney(fuelPrice * need)}`, `Full tank — ${formatMoney(fuelPrice * need)}`) : L(`На всі гроші — ${Math.floor(game.money / fuelPrice)} л`, `All your money — ${Math.floor(game.money / fuelPrice)} l`)}</button>
          </div>
        </div>`);
    } else {
      const miss = game.maxHull - game.hull;
      const patch = Math.min(25, miss);
      body = L(`<div class="svc-card">
          <div class="svc-gauge"><span>Корпус</span><span class="dbar big${game.hull < game.maxHull * 0.4 ? ' low' : ''}"><i style="width:${Math.round((game.hull / game.maxHull) * 100)}%"></i></span><b>${Math.round(game.hull)}/${game.maxHull}</b></div>
          <div class="svc-price">${miss < 1 ? L('Корпус цілий — майстер лише кивнув', `The hull is intact — the shipwright just nodded`) : L('Майстер оглянув днище й борти', `The shipwright looked over the bottom and topsides`)}</div>
          <div class="btn-row">
            <button class="btn" data-patch ${miss < 1 || game.money < patchCost ? 'disabled' : ''}>Латка +${Math.round(patch)} — ${patchCost} ₴</button>
            <button class="btn primary" data-repair ${miss < 1 || game.money < fullCost ? 'disabled' : ''}>Повний ремонт — ${fullCost} ₴</button>
          </div>
        </div>`, `<div class="svc-card">
          <div class="svc-gauge"><span>Hull</span><span class="dbar big${game.hull < game.maxHull * 0.4 ? ' low' : ''}"><i style="width:${Math.round((game.hull / game.maxHull) * 100)}%"></i></span><b>${Math.round(game.hull)}/${game.maxHull}</b></div>
          <div class="svc-price">${miss < 1 ? L('Корпус цілий — майстер лише кивнув', `The hull is intact — the shipwright just nodded`) : L('Майстер оглянув днище й борти', `The shipwright looked over the bottom and topsides`)}</div>
          <div class="btn-row">
            <button class="btn" data-patch ${miss < 1 || game.money < patchCost ? 'disabled' : ''}>Patch +${Math.round(patch)} — ${patchCost} ₴</button>
            <button class="btn primary" data-repair ${miss < 1 || game.money < fullCost ? 'disabled' : ''}>Full repair — ${fullCost} ₴</button>
          </div>
        </div>`);
    }
    const V = VENUES[venue];

    this.show(L(`
      <div class="shop-head">
        <div><h1>${V.title}</h1><p class="sub">${game.portId === 'home' ? V.sub : `⚓ ${esc(game.venueName)} · ${V.sub}`}</p></div>
        <div class="shop-head-right">
          <div class="money-chip">${formatMoney(game.money)}</div>
        </div>
      </div>
      ${body}
      <p class="wayfind">${game.portId === 'home' ? WAYFIND : L(`⚓ <b>${esc(game.venueName)}</b> · пальне ${game.venueFuel} ₴/л${game.venueRepair !== 1 ? L(` · ремонт ×${String(game.venueRepair).replace('.', L(',', '.'))}`, ` · repairs ×${String(game.venueRepair).replace('.', L(',', '.'))}`) : ''} · вдома, у «Шторму», — повний набір послуг`, `⚓ <b>${esc(game.venueName)}</b> · fuel ${game.venueFuel} ₴/l${game.venueRepair !== 1 ? L(` · ремонт ×${String(game.venueRepair).replace('.', L(',', '.'))}`, ` · repairs ×${String(game.venueRepair).replace('.', L(',', '.'))}`) : ''} · back home at Storm Harbour — the full range of services`)}</p>
      <div class="btn-row"><button class="btn" data-close>Закрити (Esc)</button></div>
    `, `
      <div class="shop-head">
        <div><h1>${V.title}</h1><p class="sub">${game.portId === 'home' ? V.sub : `⚓ ${esc(game.venueName)} · ${V.sub}`}</p></div>
        <div class="shop-head-right">
          <div class="money-chip">${formatMoney(game.money)}</div>
        </div>
      </div>
      ${body}
      <p class="wayfind">${game.portId === 'home' ? WAYFIND : L(`⚓ <b>${esc(game.venueName)}</b> · пальне ${game.venueFuel} ₴/л${game.venueRepair !== 1 ? L(` · ремонт ×${String(game.venueRepair).replace('.', L(',', '.'))}`, ` · repairs ×${String(game.venueRepair).replace('.', L(',', '.'))}`) : ''} · вдома, у «Шторму», — повний набір послуг`, `⚓ <b>${esc(game.venueName)}</b> · fuel ${game.venueFuel} ₴/l${game.venueRepair !== 1 ? L(` · ремонт ×${String(game.venueRepair).replace('.', L(',', '.'))}`, ` · repairs ×${String(game.venueRepair).replace('.', L(',', '.'))}`) : ''} · back home at Storm Harbour — the full range of services`)}</p>
      <div class="btn-row"><button class="btn" data-close>Close (Esc)</button></div>
    `), true, 'shop venue-' + venue);

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
        this.shopNote = L(`🔧 «${esc(UPGRADE_BY_ID[id].parts[game.upgrades[id] - 1].name)}» вже на човні`, `🔧 “${esc(UPGRADE_BY_ID[id].parts[game.upgrades[id] - 1].name)}” is already on the boat`);
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
            game.spend(Math.ceil(liters * fuelPrice), 'fuel');
            game.addFuel(liters);
            this.onBoatPurchase?.({ fuel: liters });
          }
        } else {
          const liters = Math.min(Number(v), game.maxFuel - game.fuel);
          const cost = Math.ceil(liters * fuelPrice);
          if (game.money >= cost) {
            game.spend(cost, 'fuel');
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
        game.spend(fee, 'insurance'); // перший день — одразу
        game.insurance = tier;
        this.audio.click();
        refresh();
      });
    });
    this.panel.querySelector('[data-patch]')?.addEventListener('click', () => {
      if (game.money >= patchCost && game.hull < game.maxHull) {
        game.spend(patchCost, 'repair');
        game.hull = Math.min(game.maxHull, game.hull + 25);
        this.onBoatPurchase?.({ patch: 25 });
        this.audio.click();
        refresh();
      }
    });
    const rep = this.panel.querySelector('[data-repair]');
    rep?.addEventListener('click', () => {
      if (game.money >= fullCost) {
        game.spend(fullCost, 'repair');
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
    this.show(L(`
      <div class="shop-head ex-head">
        <div><h1>${game.portId === 'home' ? L('РИБНА БІРЖА', `FISH EXCHANGE`) : esc(game.venueName.toUpperCase())} <span class="ex-badge">${game.portId === 'home' ? L('«ШТОРМ»', `“STORM”`) : L('МІСЦЕВІ ЦІНИ', `LOCAL PRICES`)}</span></h1><p class="sub">День цін ${game.priceWeek} · ${esc(game.priceTrendText)}</p></div>
        <div class="shop-head-right"><div class="money-chip">${formatMoney(game.money)}</div></div>
      </div>
      ${exchangeHtml(game, this.exSel)}
      <div class="btn-row"><button class="btn" data-close>Закрити (Esc)</button></div>
    `, `
      <div class="shop-head ex-head">
        <div><h1>${game.portId === 'home' ? L('РИБНА БІРЖА', `FISH EXCHANGE`) : esc(game.venueName.toUpperCase())} <span class="ex-badge">${game.portId === 'home' ? L('«ШТОРМ»', `“STORM”`) : L('МІСЦЕВІ ЦІНИ', `LOCAL PRICES`)}</span></h1><p class="sub">Price day ${game.priceWeek} · ${esc(game.priceTrendText)}</p></div>
        <div class="shop-head-right"><div class="money-chip">${formatMoney(game.money)}</div></div>
      </div>
      ${exchangeHtml(game, this.exSel)}
      <div class="btn-row"><button class="btn" data-close>Close (Esc)</button></div>
    `), true, 'shop exchange');
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
    this.show(L(`
      ${buyerHtml(game, id)}
      ${this.byNote ? `<div class="by-note">${this.byNote}</div>` : ''}
      <div class="btn-row"><button class="btn" data-close>Закрити (Esc)</button></div>
    `, `
      ${buyerHtml(game, id)}
      ${this.byNote ? `<div class="by-note">${this.byNote}</div>` : ''}
      <div class="btn-row"><button class="btn" data-close>Close (Esc)</button></div>
    `), true, 'shop buyer');
    this.byNote = '';
    const ord = this.panel.querySelector('.by-orders');
    if (ord) ord.scrollTop = scroll;
    const refresh = () => this.buyer(game, id);
    // камбуз: продукти, рецепти й продаж страв (таверна, ресторан) — ui/kitchenUI.ts
    this.buyerExtra?.(id, this.panel, refresh);
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
        this.byNote = L(`📜 Замовлення взято: ${esc(contractTitle(c))}`, `📜 Order accepted: ${esc(contractTitle(c))}`);
        this.onTrade?.();
      }
      this.audio.click();
      refresh();
    }));
    this.panel.querySelectorAll('[data-deliver]').forEach((b) => b.addEventListener('click', () => {
      const r = game.deliverContract((b as HTMLElement).dataset.deliver!);
      if (r.done) {
        this.byNote = L(`✅ Замовлення виконано! +${formatMoney(r.reward)}`, `✅ Order completed! +${formatMoney(r.reward)}`);
        this.audio.catchJingle();
      } else if (r.delivered) {
        this.byNote = L(`Здано ${r.delivered} шт — ще трохи`, `Delivered ${r.delivered} pcs — a bit more to go`);
        this.audio.click();
      }
      this.onTrade?.();
      refresh();
    }));
    this.panel.querySelector('[data-close]')!.addEventListener('click', () => this.close());
  }

  /** замовлення змінились (зберегти гру) */
  onTrade: (() => void) | null = null;
  /** додаткова секція у вікні скупника (кухня таверни/шефа) */
  buyerExtra: ((id: string, panel: HTMLElement, refresh: () => void) => void) | null = null;

  // ── СТРАХОВКА ──
  private insuranceTab(game: GameState): string {
    const value = boatValue(game.upgrades);
    const cargo = game.hold.reduce((a, f) => a + game.sellPrice(f), 0);
    const cards = PLANS.map((p) => {
      const fee = dailyPremium(p.tier, game.upgrades);
      const cur = game.insurance === p.tier;
      const keepTxt = p.keep >= 5 ? L('усі модулі', `all modules`) : p.keep === 0 ? L('нічого', `nothing`) : L(`модулі до ${p.keep}-го рівня`, `modules up to level ${p.keep}`);
      const loseUp = UPGRADES.reduce((a, u) => a + Math.max(0, game.upgrades[u.id] - p.keep), 0);
      return L(`<div class="ins-card ${cur ? 'on' : ''} tier${p.tier}">
          <div class="ins-name">${p.name}</div>
          <div class="ins-fee">${p.tier ? L(`${formatMoney(fee)} <small>/ добу</small>`, `${formatMoney(fee)} <small>/ day</small>`) : '0 ₴'}</div>
          <ul>
            <li>🛠 ${keepTxt}</li>
            <li>🐟 улов: ${p.cargo ? Math.round(p.cargo * 100) + L('% вартості', `% of value`) : L('втрачається', `lost`)}</li>
            <li>⏱ новий човен: ${p.claimH ? p.claimH + L(' год', ` h`) : L('одразу', `immediately`)}</li>
            ${p.tow ? L(`<li>⚓ буксир: ${formatMoney(p.tow)}</li>`, `<li>⚓ tow: ${formatMoney(p.tow)}</li>`) : ''}
          </ul>
          <p>${p.blurb}</p>
          ${loseUp > 0 && game.upgrades && p.tier < 3 ? L(`<div class="ins-risk">Зараз під ризиком: ${loseUp} рів. модулів</div>`, `<div class="ins-risk">At risk right now: ${loseUp} module levels</div>`) : ''}
          ${cur ? L('<div class="ins-cur">✓ Діє</div>', `<div class="ins-cur">✓ Active</div>`) : `<button class="btn ${p.tier ? 'primary' : ''}" data-plan="${p.tier}" ${p.tier && game.money < fee ? 'disabled' : ''}>${p.tier ? L('Оформити', `Take out`) : L('Скасувати поліс', `Cancel policy`)}</button>`}
        </div>`, `<div class="ins-card ${cur ? 'on' : ''} tier${p.tier}">
          <div class="ins-name">${p.name}</div>
          <div class="ins-fee">${p.tier ? L(`${formatMoney(fee)} <small>/ добу</small>`, `${formatMoney(fee)} <small>/ day</small>`) : '0 ₴'}</div>
          <ul>
            <li>🛠 ${keepTxt}</li>
            <li>🐟 catch: ${p.cargo ? Math.round(p.cargo * 100) + L('% вартості', `% of value`) : L('втрачається', `lost`)}</li>
            <li>⏱ new boat: ${p.claimH ? p.claimH + L(' год', ` h`) : L('одразу', `immediately`)}</li>
            ${p.tow ? L(`<li>⚓ буксир: ${formatMoney(p.tow)}</li>`, `<li>⚓ tow: ${formatMoney(p.tow)}</li>`) : ''}
          </ul>
          <p>${p.blurb}</p>
          ${loseUp > 0 && game.upgrades && p.tier < 3 ? L(`<div class="ins-risk">Зараз під ризиком: ${loseUp} рів. модулів</div>`, `<div class="ins-risk">At risk right now: ${loseUp} module levels</div>`) : ''}
          ${cur ? L('<div class="ins-cur">✓ Діє</div>', `<div class="ins-cur">✓ Active</div>`) : `<button class="btn ${p.tier ? 'primary' : ''}" data-plan="${p.tier}" ${p.tier && game.money < fee ? 'disabled' : ''}>${p.tier ? L('Оформити', `Take out`) : L('Скасувати поліс', `Cancel policy`)}</button>`}
        </div>`);
    }).join('');
    return L(`<p class="sub">Вартість човна: <b>${formatMoney(value)}</b> · улов у трюмі: <b>${formatMoney(cargo)}</b>. Внесок списується щодня на світанку; не вистачить грошей — поліс згорить.</p>
      <div class="ins-grid">${cards}</div>`, `<p class="sub">Boat value: <b>${formatMoney(value)}</b> · catch in the hold: <b>${formatMoney(cargo)}</b>. The premium is charged every day at dawn; if you can't pay, the policy lapses.</p>
      <div class="ins-grid">${cards}</div>`);
  }

  /** звіт після затоплення */
  sinkReport(r: SinkReport, onClose: () => void) {
    this.escAllowed = true;
    const mods = r.lostModules.length
      ? r.lostModules.map(([n, a, b]) => L(`<li>${esc(n)}: рів. ${a} → <b>${b}</b></li>`, `<li>${esc(n)}: lvl ${a} → <b>${b}</b></li>`)).join('')
      : L('<li>Модулі вціліли ✓</li>', `<li>Modules survived ✓</li>`);
    this.show(L(`
      <h1>🌊 ЧОВЕН ЗАТОНУВ</h1>
      <p class="sub">Поліс: <b>${r.plan.name}</b>${r.plan.claimH ? L(` · новий човен через ${r.plan.claimH} год`, ` · new boat in ${r.plan.claimH} h`) : L(' · новий човен одразу', ` · new boat right away`)}</p>
      <div class="sink-grid">
        <div class="sink-col"><h2>🐟 Улов</h2>
          <p>Втрачено риби: <b>${r.lostFish}</b> (на ${formatMoney(r.cargoValue)})</p>
          <p>${r.payout ? L(`Страхова виплата: <b class="good">+${formatMoney(r.payout)}</b>`, `Insurance payout: <b class="good">+${formatMoney(r.payout)}</b>`) : L('<span class="bad">Не застраховано — нічого не повернуть</span>', `<span class="bad">Not insured — nothing will be paid back</span>`)}</p>
        </div>
        <div class="sink-col"><h2>🛠 Модулі</h2><ul>${mods}</ul></div>
      </div>
      ${r.tow ? L(`<p class="sub bad">Рятувальники взяли за буксир ${formatMoney(r.tow)}.</p>`, `<p class="sub bad">The rescuers charged ${formatMoney(r.tow)} for the tow.</p>`) : ''}
      ${r.plan.tier < 2 ? L('<p class="sub">Порада: оформи страховку в конторі порту (східна набережна), перш ніж іти в шторм.</p>', `<p class="sub">Tip: take out insurance at the harbour office (east promenade) before heading into a storm.</p>`) : ''}
      <div class="btn-row"><button class="btn primary" data-close>Далі</button></div>
    `, `
      <h1>🌊 THE BOAT SANK</h1>
      <p class="sub">Policy: <b>${r.plan.name}</b>${r.plan.claimH ? L(` · новий човен через ${r.plan.claimH} год`, ` · new boat in ${r.plan.claimH} h`) : L(' · новий човен одразу', ` · new boat right away`)}</p>
      <div class="sink-grid">
        <div class="sink-col"><h2>🐟 Catch</h2>
          <p>Fish lost: <b>${r.lostFish}</b> (worth ${formatMoney(r.cargoValue)})</p>
          <p>${r.payout ? L(`Страхова виплата: <b class="good">+${formatMoney(r.payout)}</b>`, `Insurance payout: <b class="good">+${formatMoney(r.payout)}</b>`) : L('<span class="bad">Не застраховано — нічого не повернуть</span>', `<span class="bad">Not insured — nothing will be paid back</span>`)}</p>
        </div>
        <div class="sink-col"><h2>🛠 Modules</h2><ul>${mods}</ul></div>
      </div>
      ${r.tow ? L(`<p class="sub bad">Рятувальники взяли за буксир ${formatMoney(r.tow)}.</p>`, `<p class="sub bad">The rescuers charged ${formatMoney(r.tow)} for the tow.</p>`) : ''}
      ${r.plan.tier < 2 ? L('<p class="sub">Порада: оформи страховку в конторі порту (східна набережна), перш ніж іти в шторм.</p>', `<p class="sub">Tip: take out insurance at the harbour office (east promenade) before heading into a storm.</p>`) : ''}
      <div class="btn-row"><button class="btn primary" data-close>Next</button></div>
    `), true);
    this.panel.querySelector('[data-close]')!.addEventListener('click', () => {
      this.close();
      onClose();
    });
  }

  // ── ЖУРНАЛ КАПІТАНА (стенд у хаті) ──

  stats(html: string) {
    this.show(html, true, 'stats');
    this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  // ── РАДІО ──

  radio(game: GameState, weather: Weather, time: TimeCycle) {
    this.escAllowed = true;
    const st = weather.state();
    const fc = weather.snapshot().forecast;
    let forecastText: string;
    if (fc > 0.74) forecastText = L('⚠️ ПОПЕРЕДЖЕННЯ: хвилі ростуть. Очікується ШТОРМ. Розважайся, поки може!', `⚠️ WARNING: the sea is building. A STORM is expected. Have fun while you can!`);
    else if (fc > 0.45) forecastText = L('Вітер посилиться найближчу годину. Хвилі середні.', `The wind will pick up within the hour. Moderate waves.`);
    else if (fc < 0.14) forecastText = L('Погода покращується. Можна сміливо в море.', `The weather is improving. Safe to head out.`);
    else forecastText = L(`Погода стабільна: ${st === 'storm' ? L('шторм затихає', `the storm is easing`) : st === 'wind' ? L('вітер помірнає', `the wind is moderating`) : L('хвилі невеликі', `small waves`)}.`, `The weather is stable: ${st === 'storm' ? L('шторм затихає', `the storm is easing`) : st === 'wind' ? L('вітер помірнає', `the wind is moderating`) : L('хвилі невеликі', `small waves`)}.`);

    const repRows = game.reports
      .map((r) => L(`<div class="radio-item"><b>${ZONE_NAMES[r.zone]}:</b> ${game.speciesName(r.speciesId)} клює добре (×${r.boost.toFixed(1).replace('.', L(',', '.'))})</div>`, `<div class="radio-item"><b>${ZONE_NAMES[r.zone]}:</b> ${game.speciesName(r.speciesId)} biting well (×${r.boost.toFixed(1).replace('.', L(',', '.'))})</div>`))
      .join('');

    this.show(L(`
      <h1>📻 РАДІО «ПІВНІЧНЕ МОРЕ»</h1>
      <p class="sub">Частота 161.5 · ${time.isNight ? L('нічний ефір', `night broadcast`) : L('денний ефір', `day broadcast`)}</p>
      <div class="radio-item"><b>Прогноз погоди:</b> ${forecastText}</div>
      <div class="radio-item"><b>Рибальський звіт дня:</b>${repRows || L('сигнал загубився…', `signal lost…`)}</div>
      <div class="radio-item"><b>Ціни на ринку:</b> ${game.priceTrendText} (тиждень ${game.priceWeek})${game.market.events.map((e) => `<br>${e.mult > 1 ? '📈' : '📉'} ${esc(e.text)}`).join('')}</div>
      <div class="btn-row"><button class="btn" data-close>Вимкнути (Esc)</button></div>
    `, `
      <h1>📻 “NORTH SEA” RADIO</h1>
      <p class="sub">Frequency 161.5 · ${time.isNight ? L('нічний ефір', `night broadcast`) : L('денний ефір', `day broadcast`)}</p>
      <div class="radio-item"><b>Weather forecast:</b> ${forecastText}</div>
      <div class="radio-item"><b>Daily fishing report:</b>${repRows || L('сигнал загубився…', `signal lost…`)}</div>
      <div class="radio-item"><b>Market prices:</b> ${game.priceTrendText} (week ${game.priceWeek})${game.market.events.map((e) => `<br>${e.mult > 1 ? '📈' : '📉'} ${esc(e.text)}`).join('')}</div>
      <div class="btn-row"><button class="btn" data-close>Off (Esc)</button></div>
    `), true);
    this.panel.querySelector('[data-close]')!.addEventListener('click', () => this.close());
  }
}
