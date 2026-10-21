import { L } from '../core/i18n';
import { formatMoney } from '../core/math';
import type { GameState } from '../game/state';
import type { BuffId } from '../game/cooking';

// ─────────────────────────────────────────────────────────────
// Наживка Орисі (Рибальський Кут): черв'яки, мотиль чи живець — баф клювання
// на кілька хвилин (ті самі бафи, що від страв і чаю: «Рибальське щастя»,
// «Капітанський фарт»). Окремої системи немає — лише Kitchen.addBuff.
// ─────────────────────────────────────────────────────────────

interface Bait {
  id: string;
  icon: string;
  name: string;
  desc: string;
  price: number;
  buffs: Array<[BuffId, number]>;
}

const BAITS = (): Bait[] => [
  { id: 'worm', icon: '🪱', name: L('Черв\'яки з городу', `Garden worms`), desc: L('клює на 20% швидше · 5 хв', `bites 20% sooner · 5 min`), price: 20, buffs: [['luck', 300]] },
  { id: 'blood', icon: '🦐', name: L('Мотиль і креветка', `Bloodworms & shrimp`), desc: L('клює на 20% швидше · 10 хв', `bites 20% sooner · 10 min`), price: 45, buffs: [['luck', 600]] },
  { id: 'live', icon: '🐟', name: L('Живець у відрі', `Live bait in a bucket`), desc: L('більша й рідкісніша риба, частіше трофеї + швидше клює · 5 хв', `bigger, rarer fish, more trophies + faster bites · 5 min`), price: 110, buffs: [['fortune', 300], ['luck', 300]] },
];

const TIPS = (): string[] => [
  L('«На світанку й у сутінках клює найкраще — тоді й живця не шкодуй».', `"Fish bite best at dawn and dusk — that's when live bait pays off."`),
  L('«Шпрот біля Кута дрібний, а за мисом, у глибині, ходить скумбрія».', `"Sprats by the Nook are small; mackerel run in the deep past the cape."`),
  L('«Черв\'яків копаю сама, за маяком. Свіжі, аж крутяться!»', `"I dig the worms myself, behind the lighthouse. Fresh and wriggly!"`),
  L('«Як вітер з моря — бери мотиля, риба голодна».', `"When the wind's off the sea, take bloodworms — the fish are hungry."`),
];

export function baitHtml(game: GameState): string {
  const k = game.kitchen;
  const left = (id: BuffId) => Math.max(0, Math.round(k.buffs.find((b) => b.id === id)?.left ?? 0));
  const active = (['luck', 'fortune'] as BuffId[]).filter((id) => left(id) > 0);
  const tips = TIPS();
  const tip = tips[Math.floor((Date.now() / 60000) % tips.length)];
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `
    <div class="cg-head"><div>
      <h1>🪱 ${L('Наживка Орисі', `Orysia's Bait`)}</h1>
      <p class="sub">${L('Рибальський Кут · тітка Орися торгує наживкою з будки біля містка', `Fisher's Nook · Aunt Orysia sells bait from a hut by the boardwalk`)}</p>
    </div><div class="money-chip">${formatMoney(game.money)}</div></div>
    <p class="cg-meta">${tip}</p>
    ${BAITS().map((b) => `
    <div class="cg-base">
      <div><b>${b.icon} ${b.name}</b><br><span class="cg-meta">${b.desc}</span></div>
      <button class="btn primary" data-bait="${b.id}" ${game.money < b.price ? 'disabled' : ''}>${L('Купити', `Buy`)} ${formatMoney(b.price)}</button>
    </div>`).join('')}
    ${active.length ? `<p class="cg-meta">${L('Діє зараз', `Active now`)}: ${active.map((id) => `${id === 'luck' ? L('🍀 рибальське щастя', `🍀 angler's luck`) : L('✨ капітанський фарт', `✨ skipper's fortune`)} ${fmt(left(id))}`).join(' · ')}</p>` : ''}
    <div class="btn-row"><button class="btn" data-close>${L('Закрити (Esc)', `Close (Esc)`)}</button></div>`;
}

/** кнопки «Купити»; onBought — тост/звук/збереження в main */
export function bindBait(panel: HTMLElement, game: GameState, onBought: (name: string) => void) {
  panel.querySelectorAll<HTMLButtonElement>('[data-bait]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = BAITS().find((x) => x.id === btn.dataset.bait);
      if (!b || game.money < b.price) return;
      game.spend(b.price, 'other');
      for (const [id, sec] of b.buffs) game.kitchen.addBuff(id, sec);
      onBought(`${b.icon} ${b.name}`);
    });
  });
}
