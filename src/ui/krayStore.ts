import { L } from '../core/i18n';
import { formatMoney } from '../core/math';
import { BUFF_INFO, type BuffId } from '../game/cooking';
import type { GameState } from '../game/state';

// ─────────────────────────────────────────────────────────────
// «Остання крамниця перед океаном» (Китобійня «Край світу»): провізія
// на довгий перехід — сухарі, консерви, мазь для рук, імбирна настоянка.
// З'їдаєш одразу: енергія й ті самі бафи, що й на камбузі
// (game/cooking.ts). Полиці обмежені — кілька штук на ігровий день.
// ─────────────────────────────────────────────────────────────

interface Ration {
  id: string;
  icon: string;
  name: string;
  blurb: string;
  price: number;
  energy: number;
  buffs: Array<[BuffId, number]>;
  daily: number;
}

const RATIONS = (): Ration[] => [
  {
    id: 'biscuit', icon: '🍘', price: 18, energy: 15, daily: 6, buffs: [['hearty', 600]],
    name: L('Морські сухарі', `Ship's biscuits`),
    blurb: L('Тверді, як палуба, зате не псуються місяцями. Жуєш — і сили потроху вертаються.', `Hard as a deck plank, but they keep for months. Chew one and your strength slowly comes back.`),
  },
  {
    id: 'tin', icon: '🥫', price: 40, energy: 30, daily: 3, buffs: [['hearty', 480], ['warm', 360]],
    name: L('Консерви «Китобій»', `“Whaler” tinned stew`),
    blurb: L('Тушкована тріска з картоплею й перцем. Гріє зсередини навіть у шторм.', `Stewed cod with potato and pepper. Warms you from the inside, even in a gale.`),
  },
  {
    id: 'salve', icon: '🧴', price: 30, energy: 0, daily: 2, buffs: [['warm', 720]],
    name: L('Ланолінова мазь для рук', `Lanolin hand salve`),
    blurb: L('Руки не тріскаються від солі й линви. Фали тягнеш, а не відчуваєш.', `Hands don't crack from salt and rope. You haul the halyards and barely feel it.`),
  },
  {
    id: 'tonic', icon: '🫚', price: 55, energy: 10, daily: 1, buffs: [['strength', 420]],
    name: L('Імбирна настоянка гарпунера', `Harpooner's ginger tonic`),
    blurb: L('Рецепт старого Сави. Пече, як вогонь, — і рибу тягнеш, як кита.', `Old Sava's recipe. Burns like fire — and you'll reel in fish like a whale.`),
  },
];

/** продано сьогодні (на сесію; новий ігровий день — повні полиці) */
const sold = new Map<string, number>();
let soldDay = -1;

function left(g: GameState, r: Ration): number {
  if (soldDay !== g.today) {
    sold.clear();
    soldDay = g.today;
  }
  return r.daily - (sold.get(r.id) ?? 0);
}

const buffText = (r: Ration) => r.buffs.map(([b, s]) => `${BUFF_INFO[b].icon} ${L(BUFF_INFO[b].name[0], BUFF_INFO[b].name[1])} · ${Math.round(s / 60)} ${L('хв', 'min')}`).join(' + ');

export function krayStoreHtml(g: GameState, note = ''): string {
  const cards = RATIONS().map((r) => {
    const n = left(g, r);
    const can = n > 0 && g.money >= r.price;
    return `<div class="cg-card" style="--cg:#7d8a8f">
      <div class="cg-goods"><span class="cg-icon">${r.icon}</span><span>${r.name}</span></div>
      <div class="cg-meta">${r.blurb}</div>
      <div class="cg-tags"><span class="cg-tag far">${buffText(r)}</span>${r.energy ? `<span class="cg-tag">⚡ +${r.energy}</span>` : ''}</div>
      <div class="cg-foot"><span class="cg-pay">${formatMoney(r.price)}</span>
        <button class="btn primary" data-ration="${r.id}" ${can ? '' : 'disabled'}>${n > 0 ? L(`Взяти (${n} лишилось)`, `Take (${n} left)`) : L('Скінчилось', 'Out of stock')}</button></div>
    </div>`;
  }).join('');
  return `
    <div class="cg-head">
      <div>
        <h1>🥫 ${L('Остання крамниця перед океаном', `The Last Store before the ocean`)}</h1>
        <p class="sub">${L('Китобійня «Край світу» · далі — тиждень відкритої води. Провізію їдять одразу: сили й бафи на довгу вахту.', `“World's End” Whaling Station · beyond lies a week of open water. Provisions are eaten on the spot: energy and buffs for a long watch.`)}</p>
      </div>
      <div class="money-chip">${formatMoney(g.money)}</div>
    </div>
    <div class="cg-body">
      <div class="cg-list">${cards}</div>
      ${note ? `<div class="cg-note">${note}</div>` : ''}
      <div class="cg-hint">${L('Бафи не складаються, а подовжуються до більшого. Полиці поповнюють щодня, коли приходить катер із материка.', `Buffs don't stack — they extend to the longer one. The shelves are restocked every day when the supply boat comes in.`)}</div>
    </div>
    <div class="btn-row"><button class="btn" data-close>${L('Закрити (Esc)', `Close (Esc)`)}</button></div>`;
}

/** купити й з'їсти; повертає текст для тосту або null */
export function takeRation(g: GameState, id: string): string | null {
  const r = RATIONS().find((x) => x.id === id);
  if (!r || left(g, r) <= 0 || g.money < r.price) return null;
  g.spend(r.price, 'kitchen');
  sold.set(r.id, (sold.get(r.id) ?? 0) + 1);
  if (r.energy) g.addEnergy(r.energy);
  for (const [b, s] of r.buffs) g.kitchen.addBuff(b, s);
  return `${r.icon} ${r.name} — ${L('до океану готовий!', 'ready for the ocean!')} ${buffText(r)}`;
}
