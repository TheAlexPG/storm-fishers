import { L } from '../core/i18n';
import { formatMoney } from '../core/math';
import { BUFF_INFO, type BuffId } from '../game/cooking';
import type { GameState } from '../game/state';

// ─────────────────────────────────────────────────────────────
// Джелатерія «Стелла» в Порто-Аццурро: морозиво їдять тут-таки, на
// набережній — трохи сил і бафи кухні (game/cooking.ts). Вітрина
// обмежена: кожного смаку кілька ріжків на ігровий день.
// ─────────────────────────────────────────────────────────────

interface Scoop {
  id: string;
  icon: string;
  name: string;
  blurb: string;
  price: number;
  energy: number;
  buffs: Array<[BuffId, number]>;
  daily: number;
}

const SCOOPS = (): Scoop[] => [
  {
    id: 'limone', icon: '🍋', price: 12, energy: 8, daily: 5, buffs: [['luck', 180]],
    name: L('Лимонне', `Limone`),
    blurb: L('Кисло-солодке, з лимонів гаю на пагорбі. Рибалки кажуть — на щастя.', `Sweet and sour, from the lemons of the grove on the hill. Fishermen swear it brings luck.`),
  },
  {
    id: 'pistacchio', icon: '🍨', price: 18, energy: 12, daily: 4, buffs: [['strength', 240]],
    name: L('Фісташкове', `Pistacchio`),
    blurb: L('Густе, як оливкова олія. Після нього й тунець здається легшим.', `Thick as olive oil. After a cone even a tuna feels lighter.`),
  },
  {
    id: 'stracciatella', icon: '🍦', price: 16, energy: 14, daily: 4, buffs: [['hearty', 240]],
    name: L('Страчателла', `Stracciatella`),
    blurb: L('Вершки зі стружкою шоколаду. Ситне — до вечері вистачить.', `Cream with shards of chocolate. Filling enough to last till supper.`),
  },
  {
    id: 'coppa', icon: '🍧', price: 42, energy: 22, daily: 1, buffs: [['luck', 360], ['strength', 240]],
    name: L('Кубок «Аццурра»', `Coppa “Azzurra”`),
    blurb: L('Три кульки, вишня й парасолька. Один на день — Стелла робить його лише вранці.', `Three scoops, a cherry and a paper umbrella. One a day — Stella only makes it in the morning.`),
  },
];

/** продано сьогодні (на сесію; новий ігровий день — повна вітрина) */
const sold = new Map<string, number>();
let soldDay = -1;

function left(g: GameState, s: Scoop): number {
  if (soldDay !== g.today) {
    sold.clear();
    soldDay = g.today;
  }
  return s.daily - (sold.get(s.id) ?? 0);
}

const buffText = (s: Scoop) => s.buffs.map(([b, sec]) => `${BUFF_INFO[b].icon} ${L(BUFF_INFO[b].name[0], BUFF_INFO[b].name[1])} · ${Math.round(sec / 60)} ${L('хв', 'min')}`).join(' + ');

export function gelatoHtml(g: GameState, note = ''): string {
  const cards = SCOOPS().map((s) => {
    const n = left(g, s);
    const can = n > 0 && g.money >= s.price;
    return `<div class="cg-card" style="--cg:#5fb8a8">
      <div class="cg-goods"><span class="cg-icon">${s.icon}</span><span>${s.name}</span></div>
      <div class="cg-meta">${s.blurb}</div>
      <div class="cg-tags"><span class="cg-tag far">${buffText(s)}</span><span class="cg-tag">⚡ +${s.energy}</span></div>
      <div class="cg-foot"><span class="cg-pay">${formatMoney(s.price)}</span>
        <button class="btn primary" data-scoop="${s.id}" ${can ? '' : 'disabled'}>${n > 0 ? L(`Ріжок (${n} лишилось)`, `A cone (${n} left)`) : L('Скінчилось', 'All gone')}</button></div>
    </div>`;
  }).join('');
  return `
    <div class="cg-head">
      <div>
        <h1>🍨 ${L('Джелатерія «Стелла»', `Gelateria “Stella”`)}</h1>
        <p class="sub">${L('Стелла збиває морозиво щоранку з лимонів гаю, фісташок і вершків. Їдять тут-таки, на набережній: трохи сил і бафи на вахту.', `Stella churns gelato every morning from the grove's lemons, pistachios and cream. Eat it right here on the quay: a little energy and buffs for your watch.`)}</p>
      </div>
      <div class="money-chip">${formatMoney(g.money)}</div>
    </div>
    <div class="cg-body">
      <div class="cg-list">${cards}</div>
      ${note ? `<div class="cg-note">${note}</div>` : ''}
      <div class="cg-hint">${L('Бафи не складаються, а подовжуються до більшого. Вітрина щодня нова.', `Buffs don't stack — they extend to the longer one. The counter is restocked every day.`)}</div>
    </div>
    <div class="btn-row"><button class="btn" data-close>${L('Закрити (Esc)', `Close (Esc)`)}</button></div>`;
}

/** купити й з'їсти; повертає текст для тосту або null */
export function eatGelato(g: GameState, id: string): string | null {
  const s = SCOOPS().find((x) => x.id === id);
  if (!s || left(g, s) <= 0 || g.money < s.price) return null;
  g.spend(s.price, 'kitchen');
  sold.set(s.id, (sold.get(s.id) ?? 0) + 1);
  g.addEnergy(s.energy);
  for (const [b, sec] of s.buffs) g.kitchen.addBuff(b, sec);
  return `${s.icon} ${s.name} — ${L('буоно!', 'buono!')} ${buffText(s)}`;
}
