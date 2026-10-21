import { L } from '../core/i18n';
import { formatMoney } from '../core/math';
import { BUFF_INFO, type BuffId } from '../game/cooking';
import type { GameState } from '../game/state';

// ─────────────────────────────────────────────────────────────
// «Мезе тітки Деспіни» в Айос-Нікосі: грецькі страви, які їдять тут-таки
// на терасі під виноградом — енергія й бафи кухні (game/cooking.ts).
// Таверна-скупка поруч купує рибу; Деспіна — лише годує. Кожної страви
// кілька порцій на ігровий день.
// ─────────────────────────────────────────────────────────────

interface Dish {
  id: string;
  icon: string;
  name: string;
  blurb: string;
  price: number;
  energy: number;
  buffs: Array<[BuffId, number]>;
  daily: number;
}

const DISHES = (): Dish[] => [
  {
    id: 'loukoumades', icon: '🍯', price: 12, energy: 10, daily: 5, buffs: [['warm', 240]],
    name: L('Лукумадес з медом', `Loukoumades with honey`),
    blurb: L('Гарячі пончики-кульки, политі чебрецевим медом і посипані корицею.', `Hot little doughnuts drizzled with thyme honey and dusted with cinnamon.`),
  },
  {
    id: 'horiatiki', icon: '🥗', price: 18, energy: 16, daily: 4, buffs: [['hearty', 240]],
    name: L('Хоріатікі', `Horiatiki salad`),
    blurb: L('Помідори, огірок, червона цибуля, оливки й товстий шмат фети з орегано.', `Tomatoes, cucumber, red onion, olives and a thick slab of feta with oregano.`),
  },
  {
    id: 'kalamarakia', icon: '🦑', price: 28, energy: 20, daily: 3, buffs: [['strength', 300]],
    name: L('Кальмари в клярі', `Fried kalamarakia`),
    blurb: L('Хрусткі кільця кальмара з лимоном. Сьогоднішній улов Яніса.', `Crispy squid rings with a squeeze of lemon. Today's catch from Yannis.`),
  },
  {
    id: 'moussaka', icon: '🍆', price: 45, energy: 35, daily: 2, buffs: [['hearty', 360], ['warm', 240]],
    name: L('Мусака', `Moussaka`),
    blurb: L('Баклажани, м\'ясо й бешамель — з печі, ще шкварчить. Ситно до вечора.', `Aubergine, meat and béchamel straight from the oven, still sizzling. Keeps you full till evening.`),
  },
  {
    id: 'htapodi', icon: '🐙', price: 70, energy: 25, daily: 1, buffs: [['luck', 360], ['strength', 240]],
    name: L('Восьминіг на грилі', `Grilled octopus`),
    blurb: L('Той, що сох на мотузці. Деспіна каже: «Хто їсть восьминога — до того риба сама пливе».', `The one that was drying on the line. Despina says: “Eat the octopus and the fish will come to you.”`),
  },
];

/** продано сьогодні (на сесію; новий ігровий день — повна кухня) */
const sold = new Map<string, number>();
let soldDay = -1;

function left(g: GameState, d: Dish): number {
  if (soldDay !== g.today) {
    sold.clear();
    soldDay = g.today;
  }
  return d.daily - (sold.get(d.id) ?? 0);
}

const buffText = (d: Dish) => d.buffs.map(([b, s]) => `${BUFF_INFO[b].icon} ${L(BUFF_INFO[b].name[0], BUFF_INFO[b].name[1])} · ${Math.round(s / 60)} ${L('хв', 'min')}`).join(' + ');

export function mezeHtml(g: GameState, note = ''): string {
  const cards = DISHES().map((d) => {
    const n = left(g, d);
    const can = n > 0 && g.money >= d.price;
    return `<div class="cg-card" style="--cg:#2f6fb5">
      <div class="cg-goods"><span class="cg-icon">${d.icon}</span><span>${d.name}</span></div>
      <div class="cg-meta">${d.blurb}</div>
      <div class="cg-tags"><span class="cg-tag far">${buffText(d)}</span><span class="cg-tag">⚡ +${d.energy}</span></div>
      <div class="cg-foot"><span class="cg-pay">${formatMoney(d.price)}</span>
        <button class="btn primary" data-meze="${d.id}" ${can ? '' : 'disabled'}>${n > 0 ? L(`З'їсти (${n} лишилось)`, `Eat (${n} left)`) : L('Скінчилось', 'All gone')}</button></div>
    </div>`;
  }).join('');
  return `
    <div class="cg-head">
      <div>
        <h1>🫒 ${L('Мезе тітки Деспіни', `Aunt Despina's Meze`)}</h1>
        <p class="sub">${L('Сині столики під виноградом, тарілки з печі просто на терасу. Страви їдять тут-таки: сили й бафи на вахту. Рибу купує таверна поруч.', `Blue tables under the vine, plates straight from the oven to the terrace. Dishes are eaten right here: energy and buffs for your watch. The taverna next door buys fish.`)}</p>
      </div>
      <div class="money-chip">${formatMoney(g.money)}</div>
    </div>
    <div class="cg-body">
      <div class="cg-list">${cards}</div>
      ${note ? `<div class="cg-note">${note}</div>` : ''}
      <div class="cg-hint">${L('Бафи не складаються, а подовжуються до більшого. Кожної страви — кілька порцій на день.', `Buffs don't stack — they extend to the longer one. Only a few portions of each dish a day.`)}</div>
    </div>
    <div class="btn-row"><button class="btn" data-close>${L('Закрити (Esc)', `Close (Esc)`)}</button></div>`;
}

/** купити й з'їсти; повертає текст для нотатки або null */
export function eatMeze(g: GameState, id: string): string | null {
  const d = DISHES().find((x) => x.id === id);
  if (!d || left(g, d) <= 0 || g.money < d.price) return null;
  g.spend(d.price, 'kitchen');
  sold.set(d.id, (sold.get(d.id) ?? 0) + 1);
  g.addEnergy(d.energy);
  for (const [b, s] of d.buffs) g.kitchen.addBuff(b, s);
  return `${d.icon} ${d.name} — ${L('як у мами!', 'just like mama makes!')} ${buffText(d)}`;
}
