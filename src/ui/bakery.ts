import { L } from '../core/i18n';
import { formatMoney } from '../core/math';
import { BUFF_INFO, type BuffId } from '../game/cooking';
import type { GameState } from '../game/state';

// ─────────────────────────────────────────────────────────────
// Пекарня «Тепла скоринка» в рідній гавані: гаряча випічка, яку
// з'їдаєш одразу — енергія й бафи кухні (game/cooking.ts). Вітрина
// обмежена: кожного виробу кілька штук на ігровий день.
// ─────────────────────────────────────────────────────────────

interface Pastry {
  id: string;
  icon: string;
  name: string;
  blurb: string;
  price: number;
  energy: number;
  buffs: Array<[BuffId, number]>;
  /** скільки штук на вітрині щодня */
  daily: number;
}

const PASTRIES = (): Pastry[] => [
  {
    id: 'bun', icon: '🥐', price: 14, energy: 12, daily: 4, buffs: [['warm', 300]],
    name: L('Булочка з корицею', `Cinnamon bun`),
    blurb: L('Ще тепла, липка від цукру. Гріє руки на вітрі.', `Still warm and sticky with sugar. Warms your hands in the wind.`),
  },
  {
    id: 'pie', icon: '🥟', price: 22, energy: 25, daily: 4, buffs: [['hearty', 300]],
    name: L('Пиріжок з рибою', `Fish pie`),
    blurb: L('Пухке тісто, всередині — копчена пікша з цибулькою.', `Fluffy dough with smoked haddock and onion inside.`),
  },
  {
    id: 'pretzel', icon: '🥨', price: 35, energy: 10, daily: 2, buffs: [['luck', 240]],
    name: L('Морський крендель', `Sailor's pretzel`),
    blurb: L('Марта кладе один у кишеню кожному, хто йде в море «на щастя».', `Marta tucks one into the pocket of everyone heading out — for luck.`),
  },
  {
    id: 'skipper', icon: '🥧', price: 60, energy: 35, daily: 1, buffs: [['strength', 360], ['hearty', 240]],
    name: L('Капітанський пиріг', `Skipper's pie`),
    blurb: L('Великий, з тріскою й картоплею. Один на день — і той до обіду.', `A big one with cod and potato. One a day — and it's gone by noon.`),
  },
];

/** продано сьогодні (на сесію; новий ігровий день — повна вітрина) */
const sold = new Map<string, number>();
let soldDay = -1;

function left(g: GameState, p: Pastry): number {
  if (soldDay !== g.today) {
    sold.clear();
    soldDay = g.today;
  }
  return p.daily - (sold.get(p.id) ?? 0);
}

const buffText = (p: Pastry) => p.buffs.map(([b, s]) => `${BUFF_INFO[b].icon} ${L(BUFF_INFO[b].name[0], BUFF_INFO[b].name[1])} · ${Math.round(s / 60)} ${L('хв', 'min')}`).join(' + ');

export function bakeryHtml(g: GameState, note = ''): string {
  const cards = PASTRIES().map((p) => {
    const n = left(g, p);
    const can = n > 0 && g.money >= p.price;
    return `<div class="cg-card" style="--cg:#c98a45">
      <div class="cg-goods"><span class="cg-icon">${p.icon}</span><span>${p.name}</span></div>
      <div class="cg-meta">${p.blurb}</div>
      <div class="cg-tags"><span class="cg-tag far">${buffText(p)}</span><span class="cg-tag">⚡ +${p.energy}</span></div>
      <div class="cg-foot"><span class="cg-pay">${formatMoney(p.price)}</span>
        <button class="btn primary" data-pastry="${p.id}" ${can ? '' : 'disabled'}>${n > 0 ? L(`З'їсти (${n} лишилось)`, `Eat (${n} left)`) : L('Розібрали', 'Sold out')}</button></div>
    </div>`;
  }).join('');
  return `
    <div class="cg-head">
      <div>
        <h1>🥐 ${L('Пекарня «Тепла скоринка»', `“Warm Crust” bakery`)}</h1>
        <p class="sub">${L('Марта пече з досвітку. Випічку їдять тут-таки, гарячою: сили й бафи на вахту. Вітрина щодня нова.', `Marta has been baking since before dawn. Pastries are eaten right here, hot: energy and buffs for your watch. The window is restocked every day.`)}</p>
      </div>
      <div class="money-chip">${formatMoney(g.money)}</div>
    </div>
    <div class="cg-body">
      <div class="cg-list">${cards}</div>
      ${note ? `<div class="cg-note">${note}</div>` : ''}
      <div class="cg-hint">${L('Бафи не складаються, а подовжуються до більшого. Свої страви можна готувати на камбузі яхти.', `Buffs don't stack — they extend to the longer one. You can cook your own dishes in the yacht's galley.`)}</div>
    </div>
    <div class="btn-row"><button class="btn" data-close>${L('Закрити (Esc)', `Close (Esc)`)}</button></div>`;
}

/** купити й з'їсти; повертає текст для тосту або null */
export function eatPastry(g: GameState, id: string): string | null {
  const p = PASTRIES().find((x) => x.id === id);
  if (!p || left(g, p) <= 0 || g.money < p.price) return null;
  g.spend(p.price, 'kitchen');
  sold.set(p.id, (sold.get(p.id) ?? 0) + 1);
  g.addEnergy(p.energy);
  for (const [b, s] of p.buffs) g.kitchen.addBuff(b, s);
  return `${p.icon} ${p.name} — ${L('смакота!', 'delicious!')} ${buffText(p)}`;
}

// ── дід Остап на лавці біля хати: прикмети й поради ──

const OSTAP = (): string[] => [
  L('«Барометр падає швидко — значить, і шторм прийде швидко. Не чекай, доки хвилі білі».', `“When the glass drops fast, the storm comes fast. Don't wait for whitecaps.”`),
  L('«Чайки сідають на воду — на тиху погоду. Летять до берега — і тобі туди ж».', `“Gulls sitting on the water — calm weather. Gulls flying ashore — so should you.”`),
  L('«Над стаєю птахи кружляють. Бачиш ґвалт над водою — там і риба».', `“Birds circle over a school. See a racket over the water — that's where the fish are.”`),
  L('«Великий улов — далеко від берега. Але й шторми там злі. Знай, куди тікати».', `“The big catch is far from shore. So are the mean storms. Know where to run.”`),
  L('«Проти вітру прямо не підеш — галсами, синку, галсами, як усі».', `“You can't sail straight into the wind — tack, son, tack like everyone else.”`),
  L('«Риба в трюмі довго не лежить. Що далі везеш — то свіжішу бери».', `“Fish doesn't keep long in the hold. The farther you sail, the fresher it should be.”`),
  L('«Вночі ходові вогні вмикай. Без них тебе ніхто не бачить, навіть чайки».', `“Switch your running lights on at night. Without them nobody sees you — not even the gulls.”`),
  L('«Марта пече крендель на щастя. Я з ним сорок років рибалив — і ось, живий».', `“Marta bakes a pretzel for luck. Forty years I fished with one in my pocket — and here I am.”`),
  L('«На Півночі туман, як молоко. Тримай компас ближче, ніж гаманець».', `“Up north the fog is thick as milk. Keep your compass closer than your wallet.”`),
  L('«Кажуть, біля Тунцевої банки трофеї самі на гачок лізуть. Кажуть… а я там двічі тонув».', `“They say trophies jump on the hook at the Tuna Bank. They say… I nearly drowned there twice.”`),
];

let ostapI = Math.floor(Math.random() * 10);
export function ostapLine(): string {
  const all = OSTAP();
  ostapI = (ostapI + 1) % all.length;
  return `👴 ${all[ostapI]}`;
}

/** погладити кота: раз на день — трохи тепла на душі */
let catDay = -1;
export function petCat(g: GameState): string {
  if (catDay !== g.today) {
    catDay = g.today;
    g.kitchen.addBuff('warm', 180);
    return L('🐈 Сухарик муркоче й треться об чоботи. На душі тепло (☕ 3 хв).', `🐈 Rusk purrs and rubs against your boots. Warm inside (☕ 3 min).`);
  }
  return L('🐈 Сухарик примружується й ліниво махає хвостом.', `🐈 Rusk squints and lazily flicks his tail.`);
}
