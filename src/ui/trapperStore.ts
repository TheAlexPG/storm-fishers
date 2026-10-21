import { L } from '../core/i18n';
import { formatMoney } from '../core/math';
import { BUFF_INFO, type BuffId } from '../game/cooking';
import type { GameState } from '../game/state';

// ─────────────────────────────────────────────────────────────
// «Лавка траппера» в Бухті Гризлі: Сайлас міняє хутро й продає те, без
// чого на Півночі не виходять у море — пемікан, чай з морошкою, хутряні
// рукавиці й оберіг з ведмежого кігтя. Бафи кухні (game/cooking.ts),
// кількість на ігровий день обмежена.
// ─────────────────────────────────────────────────────────────

interface Ware {
  id: string;
  icon: string;
  name: string;
  blurb: string;
  price: number;
  energy: number;
  buffs: Array<[BuffId, number]>;
  daily: number;
}

const WARES = (): Ware[] => [
  {
    id: 'tea', icon: '🍵', price: 12, energy: 6, daily: 5, buffs: [['warm', 480]],
    name: L('Чай з морошкою', `Cloudberry tea`),
    blurb: L('Кухоль з казана над вогнищем. Бабця Нуна каже — від нього сніг тане в бороді.', `A mug from the pot over the fire. Granny Nuna says it melts the snow in your beard.`),
  },
  {
    id: 'pemmican', icon: '🥩', price: 18, energy: 30, daily: 4, buffs: [['hearty', 600]],
    name: L('Пемікан', `Pemmican`),
    blurb: L('Сушене м\'ясо з жиром і ягодами. Брусок у кишені — і ти ситий до вечора.', `Dried meat pounded with fat and berries. One bar in your pocket keeps you fed till dusk.`),
  },
  {
    id: 'mittens', icon: '🧤', price: 65, energy: 0, daily: 1, buffs: [['strength', 600], ['warm', 300]],
    name: L('Хутряні рукавиці', `Fur mittens`),
    blurb: L('Лисяче хутро всередині, лосина шкіра зверху. Вудка з рук не вислизає навіть у шторм.', `Fox fur inside, moose hide outside. The rod won't slip from your hands even in a storm.`),
  },
  {
    id: 'claw', icon: '🐾', price: 40, energy: 0, daily: 1, buffs: [['luck', 600]],
    name: L('Оберіг з ведмежого кігтя', `Bear-claw charm`),
    blurb: L('Кіготь старого ведмедя з коси — сам скинув, кажуть. Риба його поважає.', `A claw from the old bear on the spit — he shed it himself, they say. The fish respect it.`),
  },
];

const sold = new Map<string, number>();
let soldDay = -1;

function left(g: GameState, w: Ware): number {
  if (soldDay !== g.today) {
    sold.clear();
    soldDay = g.today;
  }
  return w.daily - (sold.get(w.id) ?? 0);
}

const buffText = (w: Ware) => w.buffs.map(([b, s]) => `${BUFF_INFO[b].icon} ${L(BUFF_INFO[b].name[0], BUFF_INFO[b].name[1])} · ${Math.round(s / 60)} ${L('хв', 'min')}`).join(' + ');

export function trapperHtml(g: GameState, note = ''): string {
  const cards = WARES().map((w) => {
    const n = left(g, w);
    const can = n > 0 && g.money >= w.price;
    return `<div class="cg-card" style="--cg:#7a5636">
      <div class="cg-goods"><span class="cg-icon">${w.icon}</span><span>${w.name}</span></div>
      <div class="cg-meta">${w.blurb}</div>
      <div class="cg-tags"><span class="cg-tag far">${buffText(w)}</span>${w.energy ? `<span class="cg-tag">⚡ +${w.energy}</span>` : ''}</div>
      <div class="cg-foot"><span class="cg-pay">${formatMoney(w.price)}</span>
        <button class="btn primary" data-ware="${w.id}" ${can ? '' : 'disabled'}>${n > 0 ? L(`Купити (${n} лишилось)`, `Buy (${n} left)`) : L('Скінчилось', 'Sold out')}</button></div>
    </div>`;
  }).join('');
  return `
    <div class="cg-head">
      <div>
        <h1>🧤 ${L('Лавка траппера', `Trapper's Store`)}</h1>
        <p class="sub">${L('Сайлас тридцять років ставить пастки за частоколом і продає те, без чого на Півночі не виходять у море.', `Silas has set traps beyond the stockade for thirty years and sells what nobody up north goes to sea without.`)}</p>
      </div>
      <div class="money-chip">${formatMoney(g.money)}</div>
    </div>
    <div class="cg-body">
      <div class="cg-list">${cards}</div>
      ${note ? `<div class="cg-note">${note}</div>` : ''}
      <div class="cg-hint">${L('Бафи не складаються, а подовжуються до більшого. «Сила» — рибу підтягуєш швидше, «Рибальське щастя» — клює швидше.', `Buffs don't stack — they extend to the longer one. “Strength” reels fish in faster, “Angler's luck” makes them bite sooner.`)}</div>
    </div>
    <div class="btn-row"><button class="btn" data-close>${L('Закрити (Esc)', `Close (Esc)`)}</button></div>`;
}

/** купити; повертає текст для нотатки або null */
export function buyWare(g: GameState, id: string): string | null {
  const w = WARES().find((x) => x.id === id);
  if (!w || left(g, w) <= 0 || g.money < w.price) return null;
  g.spend(w.price, 'other');
  sold.set(w.id, (sold.get(w.id) ?? 0) + 1);
  if (w.energy) g.addEnergy(w.energy);
  for (const [b, s] of w.buffs) g.kitchen.addBuff(b, s);
  return `${w.icon} ${w.name} — ${L('твоє!', 'yours!')} ${buffText(w)}`;
}
