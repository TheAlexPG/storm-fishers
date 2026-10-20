import './cargo.css';
import { formatMoney } from '../core/math';
import { L } from '../core/i18n';
import { CargoBook, DOCK_BY_ID, GOODS_BY_ID, cargoSlots, dockName, iceFresh, routeDist, type CargoOrder } from '../game/cargo';
import type { GameState } from '../game/state';
import { PORT_SITE_BY_ID } from '../world/portSites';
import { CONTINENT_BY_ID } from '../world/continents';

// ─────────────────────────────────────────────────────────────
// Вікно складу: «твої вантажі» (здати, відмовитись) і накладні складу
// (узяти). Ящики самі не літають: після «Взяти» вони чекають на причалі
// біля складу — їх переносять руками на яхту.
// ─────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function hoursText(h: number): string {
  const v = Math.max(0, Math.round(h));
  if (v >= 24) {
    const d = Math.floor(v / 24), r = v % 24;
    return L(`${d} д ${r} год`, `${d} d ${r} h`);
  }
  return L(`${v} год`, `${v} h`);
}

/** континент або «архіпелаг» гавані — для бирки маршруту */
function regionTag(id: string): string {
  const p = PORT_SITE_BY_ID[id];
  if (p?.cont) return CONTINENT_BY_ID[p.cont].name;
  return L('Стартовий архіпелаг', `Home archipelago`);
}

function cardHtml(o: CargoOrder, mine: boolean, game: GameState, here: string, boatNear: boolean, full: boolean): string {
  const g = GOODS_BY_ID[o.goods];
  const from = DOCK_BY_ID[o.from], to = DOCK_BY_ID[o.to];
  const km = (routeDist(from, to) / 1000).toFixed(1).replace('.', L(',', '.'));
  const crossing = regionTag(o.from) !== regionTag(o.to);
  const tags = [
    g.fragile ? `<span class="cg-tag fragile">${L('крихке', `fragile`)}</span>` : '',
    g.perish ? `<span class="cg-tag perish">${L('псується', `perishable`)}</span>` : '',
    o.urgent ? `<span class="cg-tag urgent">${L('терміново', `urgent`)}</span>` : '',
    crossing ? `<span class="cg-tag far">${L('через океан', `across the ocean`)}</span>` : '',
  ];
  let meta = '', foot = '';
  if (mine) {
    const q = game.cargo.quote(o, game.clockH);
    const left = o.dueH - game.clockH;
    if (q.late) tags.push(`<span class="cg-tag late">${L('прострочено', `overdue`)}</span>`);
    const crates = o.items.map((it) => `<span class="cg-crate ${it.where}" title="${it.where}"></span>`).join('');
    const onPier = o.items.filter((it) => it.where === 'pier').length;
    const aboard = o.items.filter((it) => it.where === 'boat').length;
    const where = onPier ? L(`${onPier} на причалі в «${dockName(o.from)}» · ${aboard} на яхті`, `${onPier} on the pier at ${dockName(o.from)} · ${aboard} aboard`) : L(`усі ${aboard} на яхті`, `all ${aboard} aboard`);
    const bars = [
      g.fragile ? `<div class="cg-meta">${L('цілість', `condition`)} ${Math.round(q.cond * 100)}%</div><div class="cg-bar ${q.cond < 0.6 ? 'bad' : ''}"><i style="width:${Math.round(q.cond * 100)}%"></i></div>` : '',
      g.perish ? `<div class="cg-meta">${L('свіжість', `freshness`)} ${Math.round(iceFresh(o, game.clockH) * 100)}%</div><div class="cg-bar ${q.fresh < 0.6 ? 'bad' : ''}"><i style="width:${Math.round(q.fresh * 100)}%"></i></div>` : '',
    ].join('');
    meta = `<div class="cg-meta">${where}<br>${q.late ? L('термін минув — заплатять менше', `deadline passed — reduced pay`) : L(`термін: ще ${hoursText(left)}`, `due in ${hoursText(left)}`)}</div>${bars}<div class="cg-crates">${crates}</div>`;
    const canDeliver = o.to === here && o.items.every((it) => it.where === 'boat');
    const deliverBtn = o.to === here
      ? `<button class="btn primary" data-cdeliver="${esc(o.id)}" ${canDeliver && boatNear ? '' : 'disabled'} title="${canDeliver ? (boatNear ? '' : L('пришвартуй яхту тут', `moor the yacht here`)) : L('не всі ящики на яхті', `not all crates are aboard`)}">${L('Здати', `Deliver`)} ${formatMoney(q.pay)}</button>`
      : '';
    foot = `<div class="cg-foot"><span class="cg-pay">${formatMoney(q.pay)}</span><span>${deliverBtn}<button class="btn danger" data-ccancel="${esc(o.id)}">${L('Відмовитись', `Cancel`)}</button></span></div>`;
  } else {
    meta = `<div class="cg-meta">${L(`${o.crates} ${o.crates === 1 ? 'ящик' : o.crates < 5 ? 'ящики' : 'ящиків'} · ${km} км · термін ${hoursText(o.dueH)}`, `${o.crates} crate${o.crates === 1 ? '' : 's'} · ${km} km · due in ${hoursText(o.dueH)}`)}</div>`;
    foot = `<div class="cg-foot"><span class="cg-pay">${formatMoney(o.pay)}</span><button class="btn primary" data-ctake="${esc(o.id)}" ${full ? 'disabled' : ''}>${L('Взяти', `Take`)}</button></div>`;
  }
  return `<div class="cg-card ${mine ? 'mine' : ''}" style="--cg:${g.color}">
    <div class="cg-goods"><span class="cg-icon">${g.icon}</span><span>${esc(g.name)}<br><span class="cg-stencil">${g.stencil}</span></span></div>
    <div class="cg-route">${esc(dockName(o.from))}<span class="arrow">→</span>${esc(dockName(o.to))}</div>
    <div class="cg-tags">${tags.join('')}</div>
    ${meta}
    ${foot}
  </div>`;
}

export interface CargoUIOpts {
  game: GameState;
  /** гавань, де склад */
  here: string;
  /** яхта пришвартована тут (можна здавати) */
  boatNear: boolean;
  note: string;
  onTake: (o: CargoOrder) => void;
  onDeliver: (id: string) => void;
  onCancel: (id: string) => void;
}

export function cargoHtml(o: CargoUIOpts): string {
  const g = o.game;
  const mine = g.cargo.orders;
  const offers = g.cargo.offers(o.here, g.today);
  const slots = cargoSlots(g.upgrades.hold ?? 0);
  const used = g.cargo.usedSlots().size;
  const full = mine.length >= CargoBook.MAX_ACTIVE;
  return `
    <div class="cg-head">
      <div>
        <h1>📦 ${L('Склад', `Cargo office`)} · ${esc(dockName(o.here))}</h1>
        <p class="sub">${L(`Накладні на доставку. Місць для ящиків на яхті: ${used}/${slots} (лави кокпіту, з трюмом — ще й носова каюта). Узятих замовлень: ${mine.length}/${CargoBook.MAX_ACTIVE}.`, `Delivery waybills. Crate spots aboard: ${used}/${slots} (cockpit benches; with a bigger hold — the forepeak too). Orders taken: ${mine.length}/${CargoBook.MAX_ACTIVE}.`)}</p>
      </div>
      <div class="money-chip">${formatMoney(g.money)}</div>
    </div>
    <div class="cg-body">
      <h2>${L('Твої вантажі', `Your cargo`)}</h2>
      ${mine.length ? `<div class="cg-list">${mine.map((x) => cardHtml(x, true, g, o.here, o.boatNear, full)).join('')}</div>` : `<div class="cg-empty">${L('Поки нічого не везеш.', `You're not carrying anything yet.`)}</div>`}
      <h2>${L('Замовлення складу', `Waybills on offer`)}</h2>
      ${offers.length ? `<div class="cg-list">${offers.map((x) => cardHtml(x, false, g, o.here, o.boatNear, full)).join('')}</div>` : `<div class="cg-empty">${L('Сьогодні все розібрали — заходь завтра.', `All taken for today — come back tomorrow.`)}</div>`}
      ${o.note ? `<div class="cg-note">${o.note}</div>` : ''}
      <div class="cg-hint">${L('Узяті ящики чекають на причалі біля складу: підійди й візьми (E), віднеси на яхту й постав (E) — на лаву кокпіту чи в носову каюту. Крихке на лавах б\'ється від ударів хвиль, риба в льоду псується в дорозі, прострочка — половина ціни. Рейси через океан платять найбільше.', `Taken crates wait on the pier by the cargo office: walk up and pick one up (E), carry it aboard and set it down (E) — on a cockpit bench or in the forepeak. Fragile goods on the benches crack when waves slam, iced fish spoils on the way, late delivery pays half. Runs across the ocean pay the most.`)}</div>
    </div>
    <div class="btn-row"><button class="btn" data-close>${L('Закрити (Esc)', `Close (Esc)`)}</button></div>`;
}

export function bindCargo(panel: HTMLElement, o: CargoUIOpts) {
  const offers = o.game.cargo.offers(o.here, o.game.today);
  panel.querySelectorAll('[data-ctake]').forEach((b) => b.addEventListener('click', () => {
    const x = offers.find((q) => q.id === (b as HTMLElement).dataset.ctake);
    if (x) o.onTake(x);
  }));
  panel.querySelectorAll('[data-cdeliver]').forEach((b) => b.addEventListener('click', () => o.onDeliver((b as HTMLElement).dataset.cdeliver!)));
  panel.querySelectorAll('[data-ccancel]').forEach((b) => b.addEventListener('click', () => o.onCancel((b as HTMLElement).dataset.ccancel!)));
}

/** дім-база на континенті: купити або (якщо вже твій) — поспати */
export function baseHtml(game: GameState, siteId: string, price: number): string {
  const p = PORT_SITE_BY_ID[siteId];
  const owned = game.bases.includes(siteId);
  const svc = p.svc.find((s) => s.kind === 'base');
  return `
    <div class="cg-head"><div>
      <h1>🏡 ${esc(svc?.name ?? '')}</h1>
      <p class="sub">${esc(p.name)} · ${esc(p.cont ? CONTINENT_BY_ID[p.cont].name : '')}</p>
    </div><div class="money-chip">${formatMoney(game.money)}</div></div>
    <div class="cg-base">
      <div><b>${owned ? L('Це твій дім на цьому континенті', `This is your home on this continent`) : L('Оселитися тут', `Settle here`)}</b><br>
      <span class="cg-meta">${L('Тут можна спати й зберігати гру, а після аварії рятувальники відбуксирують сюди, якщо це найближче. Стартова хата в «Шторму» лишається твоєю.', `Sleep and save here; after a wreck the rescuers tow you here if it's the closest. Your first cottage at Storm Harbour stays yours.`)}</span></div>
      ${owned ? `<button class="btn primary" data-bsleep>${L('Поспати до ранку', `Sleep until morning`)}</button>` : `<button class="btn primary" data-bbuy ${game.money < price ? 'disabled' : ''}>${L('Купити', `Buy`)} ${formatMoney(price)}</button>`}
    </div>
    <div class="btn-row"><button class="btn" data-close>${L('Закрити (Esc)', `Close (Esc)`)}</button></div>`;
}
