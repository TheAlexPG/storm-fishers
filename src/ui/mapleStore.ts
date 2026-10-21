import { L } from '../core/i18n';
import { formatMoney } from '../core/math';
import { BUFF_INFO, type BuffId } from '../game/cooking';
import type { GameState } from '../game/state';

// ─────────────────────────────────────────────────────────────
// «Кленова лавка» у Сідар-Гарбор: генеральна крамниця з ґанком і
// кріслом-гойдалкою. Північні смаколики, які їдять тут-таки: млинці з
// сиропом, тягучка на снігу, сніданок лісоруба, гаряче какао — енергія й
// бафи кухні (game/cooking.ts). Кожного — кілька порцій на ігровий день.
// ─────────────────────────────────────────────────────────────

interface Treat {
  id: string;
  icon: string;
  name: string;
  blurb: string;
  price: number;
  energy: number;
  buffs: Array<[BuffId, number]>;
  daily: number;
}

const TREATS = (): Treat[] => [
  {
    id: 'cocoa', icon: '☕', price: 12, energy: 8, daily: 5, buffs: [['warm', 420]],
    name: L('Гаряче какао з кленовим сиропом', `Hot cocoa with maple syrup`),
    blurb: L('Кухоль, що гріє долоні. На Півночі без нього на палубу не виходять.', `A mug that warms your palms. Up north nobody goes on deck without one.`),
  },
  {
    id: 'pancakes', icon: '🥞', price: 20, energy: 22, daily: 4, buffs: [['hearty', 300], ['warm', 180]],
    name: L('Млинці з кленовим сиропом', `Pancakes with maple syrup`),
    blurb: L('Стос із трьох, сироп стікає по краях. Ерл каже — «на добру вахту».', `A stack of three, syrup running down the sides. Earl calls it “a good-watch breakfast”.`),
  },
  {
    id: 'taffy', icon: '🍬', price: 10, energy: 4, daily: 3, buffs: [['luck', 180]],
    name: L('Кленова тягучка на снігу', `Maple taffy on snow`),
    blurb: L('Гарячий сироп ллють на чистий сніг і накручують на паличку. Кажуть, на щастя.', `Hot syrup poured on clean snow and rolled on a stick. They say it brings luck.`),
  },
  {
    id: 'logger', icon: '🍳', price: 48, energy: 38, daily: 1, buffs: [['strength', 360], ['hearty', 300]],
    name: L('Сніданок лісоруба', `Logger's breakfast`),
    blurb: L('Яйця, бекон, квасоля, млинець і кава. Один на день — лісоруби розбирають зранку.', `Eggs, bacon, beans, a pancake and coffee. One a day — the loggers clear it out by morning.`),
  },
];

const sold = new Map<string, number>();
let soldDay = -1;

function left(g: GameState, t: Treat): number {
  if (soldDay !== g.today) {
    sold.clear();
    soldDay = g.today;
  }
  return t.daily - (sold.get(t.id) ?? 0);
}

const buffText = (t: Treat) => t.buffs.map(([b, s]) => `${BUFF_INFO[b].icon} ${L(BUFF_INFO[b].name[0], BUFF_INFO[b].name[1])} · ${Math.round(s / 60)} ${L('хв', 'min')}`).join(' + ');

export function mapleHtml(g: GameState, note = ''): string {
  const cards = TREATS().map((t) => {
    const n = left(g, t);
    const can = n > 0 && g.money >= t.price;
    return `<div class="cg-card" style="--cg:#b5652f">
      <div class="cg-goods"><span class="cg-icon">${t.icon}</span><span>${t.name}</span></div>
      <div class="cg-meta">${t.blurb}</div>
      <div class="cg-tags"><span class="cg-tag far">${buffText(t)}</span><span class="cg-tag">⚡ +${t.energy}</span></div>
      <div class="cg-foot"><span class="cg-pay">${formatMoney(t.price)}</span>
        <button class="btn primary" data-treat="${t.id}" ${can ? '' : 'disabled'}>${n > 0 ? L(`Взяти (${n} лишилось)`, `Have one (${n} left)`) : L('Скінчилось', 'All gone')}</button></div>
    </div>`;
  }).join('');
  return `
    <div class="cg-head">
      <div>
        <h1>🍁 ${L('Кленова лавка', `Maple General Store`)}</h1>
        <p class="sub">${L('Старий Ерл тримає крамницю сорок зим. Сироп — з власного кленового гаю за лісопилкою, млинці — гарячі, какао — на будь-яку погоду.', `Old Earl has kept the store for forty winters. The syrup comes from his own sugar bush behind the sawmill, the pancakes are hot and the cocoa fits any weather.`)}</p>
      </div>
      <div class="money-chip">${formatMoney(g.money)}</div>
    </div>
    <div class="cg-body">
      <div class="cg-list">${cards}</div>
      ${note ? `<div class="cg-note">${note}</div>` : ''}
      <div class="cg-hint">${L('Бафи не складаються, а подовжуються до більшого. «Зігрівся» — праця на холодному вітрі втомлює менше.', `Buffs don't stack — they extend to the longer one. “Warmed up” — work in the cold wind tires you less.`)}</div>
    </div>
    <div class="btn-row"><button class="btn" data-close>${L('Закрити (Esc)', `Close (Esc)`)}</button></div>`;
}

/** купити й з'їсти; повертає текст для нотатки або null */
export function eatTreat(g: GameState, id: string): string | null {
  const t = TREATS().find((x) => x.id === id);
  if (!t || left(g, t) <= 0 || g.money < t.price) return null;
  g.spend(t.price, 'kitchen');
  sold.set(t.id, (sold.get(t.id) ?? 0) + 1);
  g.addEnergy(t.energy);
  for (const [b, s] of t.buffs) g.kitchen.addBuff(b, s);
  return `${t.icon} ${t.name} — ${L('смакота!', 'delicious!')} ${buffText(t)}`;
}
