import { formatMoney } from '../core/math';
import { FISH_BY_ID } from '../game/fish';
import {
  BUYER_BY_ID,
  BUYERS,
  contractNeed,
  contractTitle,
  fitsContract,
  fmtDeadline,
  FishTrade,
  hermitWish,
  isTrophy,
  MAX_CONTRACTS,
  nextRep,
  REP_LEVELS,
  repLevel,
  shortName,
  type BuyerId,
  type Contract,
} from '../game/buyers';
import type { GameState } from '../game/state';
import type { FishItem } from '../core/types';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Вікно скупника: що з твого улову він бере і почому, крейдяна дошка
// акцій, замовлення на поставку (взяти / здати), репутація. А ще —
// журнал замовлень (меню паузи) і компактна плашка в HUD.
// ─────────────────────────────────────────────────────────────

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const kg = (v: number) => (v < 1 ? v.toFixed(2) : v.toFixed(1)).replace('.', L(',', '.'));

function progress(c: Contract): string {
  const need = contractNeed(c);
  const got = Math.min(need, c.got);
  const txt = c.kg ? L(`${kg(got)} / ${kg(need)} кг`, `${kg(got)} / ${kg(need)} kg`) : `${got} / ${need}`;
  return `<div class="by-prog"><i style="width:${Math.round((got / need) * 100)}%"></i><span>${txt}</span></div>`;
}

function repHtml(rep: number): string {
  const l = repLevel(rep);
  const n = nextRep(rep);
  const pct = n ? Math.round(((rep - l.at) / (n.at - l.at)) * 100) : 100;
  return L(`<div class="by-rep" title="Репутація: краща ціна й більші замовлення">
      <div class="by-rep-top"><span>Репутація</span><b>${esc(l.name)}</b></div>
      <div class="by-rep-bar"><i style="width:${pct}%"></i></div>
      <div class="by-rep-sub">${l.bonus ? L(`+${Math.round(l.bonus * 100)} % до ціни · `, `+${Math.round(l.bonus * 100)} % to price · `) : ''}${n ? L(`ще ${Math.ceil(n.at - rep)} до «${esc(n.name)}»`, `${Math.ceil(n.at - rep)} more to “${esc(n.name)}”`) : L('найвища', `top level`)}</div>
    </div>`, `<div class="by-rep" title="Reputation: better prices and bigger orders">
      <div class="by-rep-top"><span>Reputation</span><b>${esc(l.name)}</b></div>
      <div class="by-rep-bar"><i style="width:${pct}%"></i></div>
      <div class="by-rep-sub">${l.bonus ? L(`+${Math.round(l.bonus * 100)} % до ціни · `, `+${Math.round(l.bonus * 100)} % to price · `) : ''}${n ? L(`ще ${Math.ceil(n.at - rep)} до «${esc(n.name)}»`, `${Math.ceil(n.at - rep)} more to “${esc(n.name)}”`) : L('найвища', `top level`)}</div>
    </div>`);
}

function contractCard(game: GameState, c: Contract, mode: 'offer' | 'active', here: boolean, open: boolean): string {
  const b = BUYER_BY_ID[c.buyer];
  const nowH = game.clockH;
  const fit = mode === 'active' ? game.contractFish(c) : game.hold.filter((f) => fitsContract(c, f));
  const urgent = c.deadline - nowH < 4;
  const full = game.trade.active.length >= MAX_CONTRACTS;
  let action = '';
  if (mode === 'offer') action = L(`<button class="btn small primary" data-accept="${esc(c.id)}" ${full ? L('disabled title="Не більше трьох замовлень одночасно"', `disabled title="No more than three orders at a time"`) : ''}>Взяти</button>`, `<button class="btn small primary" data-accept="${esc(c.id)}" ${full ? L('disabled title="Не більше трьох замовлень одночасно"', `disabled title="No more than three orders at a time"`) : ''}>Accept</button>`);
  else if (here) action = `<button class="btn small primary" data-deliver="${esc(c.id)}" ${fit.length && open ? '' : 'disabled'}>${fit.length ? L(`Здати (${fit.length})`, `Deliver (${fit.length})`) : L('Нема що здати', `Nothing to deliver`)}</button>`;
  else action = `<span class="by-where">${b.icon} ${esc(shortName(c.buyer))}</span>`;
  return `<div class="by-ct ${mode}${urgent ? ' urgent' : ''}">
      <div class="by-ct-top"><b>${esc(contractTitle(c))}</b><span class="by-ct-pay">${formatMoney(c.reward)}</span></div>
      <div class="by-ct-meta"><span>⏱ ${esc(fmtDeadline(c.deadline, nowH))}</span><span>★ +${c.rep}</span>${mode === 'offer' && fit.length ? L(`<span class="ok">у трюмі: ${fit.length}</span>`, `<span class="ok">in the hold: ${fit.length}</span>`) : ''}</div>
      ${mode === 'active' ? progress(c) : ''}
      <div class="by-ct-act">${action}</div>
    </div>`;
}

/** групи риби в трюмі: беремо / не беремо (з причиною) */
function groups(game: GameState, id: BuyerId) {
  const b = BUYER_BY_ID[id];
  const yes = new Map<string, FishItem[]>();
  const no = new Map<string, { items: FishItem[]; why: string }>();
  for (const f of game.hold) {
    const why = game.trade.reject(b, f, game.clockH);
    if (why) {
      const k = f.speciesId + '|' + why;
      const g = no.get(k) ?? { items: [], why };
      g.items.push(f);
      no.set(k, g);
    } else {
      const g = yes.get(f.speciesId) ?? [];
      g.push(f);
      yes.set(f.speciesId, g);
    }
  }
  return { yes, no };
}

export function buyerHtml(game: GameState, id: BuyerId): string {
  const b = BUYER_BY_ID[id];
  const t = game.trade;
  const nowH = game.clockH;
  const open = t.isOpen(b, nowH);
  const { yes, no } = groups(game, id);

  // ── улов ──
  const all = [...yes.values()].flat();
  const qAll = game.buyerQuote(id, all);
  const rows = [...yes.entries()]
    .map(([sp, items]) => {
      const q = game.buyerQuote(id, items);
      const one = Math.max(...q.prices.values());
      const ex = game.quote(items).total;
      const diff = ex > 0 ? q.total / ex - 1 : 0;
      const tags = [
        items.some(isTrophy) ? L('<span class="by-tag gold">трофей</span>', `<span class="by-tag gold">trophy</span>`) : '',
        items.some((f) => !f.cooked && f.freshness >= 80) ? L('<span class="by-tag sea">свіжа</span>', `<span class="by-tag sea">fresh</span>`) : '',
        t.promoMult(b, items[0], nowH) > 1.001 ? L('<span class="by-tag hot">акція</span>', `<span class="by-tag hot">offer</span>`) : '',
      ].join('');
      return L(`<div class="by-row">
          <div class="by-row-name"><b>${esc(FISH_BY_ID[sp]?.name ?? sp)}</b> <small>× ${items.length}</small>${tags}</div>
          <div class="by-row-price"><b>${formatMoney(q.total)}</b><small class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(diff * 100))}% до біржі</small></div>
          <div class="by-row-btns">
            <button class="btn small" data-bsell1="${sp}" ${open ? '' : 'disabled'} title="Найдорожча — ${formatMoney(one)}">1</button>
            <button class="btn small primary" data-bsellsp="${sp}" ${open ? '' : 'disabled'}>Усі</button>
          </div>
        </div>`, `<div class="by-row">
          <div class="by-row-name"><b>${esc(FISH_BY_ID[sp]?.name ?? sp)}</b> <small>× ${items.length}</small>${tags}</div>
          <div class="by-row-price"><b>${formatMoney(q.total)}</b><small class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(diff * 100))}% vs exchange</small></div>
          <div class="by-row-btns">
            <button class="btn small" data-bsell1="${sp}" ${open ? '' : 'disabled'} title="The priciest one — ${formatMoney(one)}">1</button>
            <button class="btn small primary" data-bsellsp="${sp}" ${open ? '' : 'disabled'}>All</button>
          </div>
        </div>`);
    })
    .join('');
  const rej = [...no.values()]
    .map((g) => `<div class="by-row no"><div class="by-row-name"><b>${esc(FISH_BY_ID[g.items[0].speciesId]?.name ?? '')}</b> <small>× ${g.items.length}</small></div><div class="by-why">${esc(g.why)}</div></div>`)
    .join('');
  const sellAll = all.length
    ? L(`<button class="btn primary by-sellall" data-bsellall ${open ? '' : 'disabled'}>Продати все, що бере · ${all.length} шт · ${formatMoney(qAll.total)}${qAll.bulk > 1.001 ? L(` <small>(опт +${Math.round((qAll.bulk - 1) * 100)}%)</small>`, ` <small>(bulk +${Math.round((qAll.bulk - 1) * 100)}%)</small>`) : ''}</button>`, `<button class="btn primary by-sellall" data-bsellall ${open ? '' : 'disabled'}>Sell everything they take · ${all.length} pcs · ${formatMoney(qAll.total)}${qAll.bulk > 1.001 ? L(` <small>(опт +${Math.round((qAll.bulk - 1) * 100)}%)</small>`, ` <small>(bulk +${Math.round((qAll.bulk - 1) * 100)}%)</small>`) : ''}</button>`)
    : '';

  // ── акції ──
  const promos = t.promos(nowH, id);
  const later = t.upcoming(nowH, id);
  const wish = id === 'hermit' ? hermitWish(FishTrade.day(nowH)) : null;
  const promoHtml = [
    ...promos.map((p) => `<li>✦ ${esc(p.text)}</li>`),
    ...later.map((p) => L(`<li class="later">◌ згодом: ${esc(p.text)}</li>`, `<li class="later">◌ later: ${esc(p.text)}</li>`)),
    wish ? L(`<li>✦ риба дня: <b>${esc(FISH_BY_ID[wish].name.toLowerCase())}</b> — ×1,9</li>`, `<li>✦ fish of the day: <b>${esc(FISH_BY_ID[wish].name.toLowerCase())}</b> — ×1.9</li>`) : '',
  ].join('') || L('<li class="later">сьогодні без акцій — ціни звичайні</li>', `<li class="later">no offers today — usual prices</li>`);

  // ── замовлення ──
  const offers = t.offers(b, nowH, game.discovered);
  const mineHere = t.active.filter((c) => c.buyer === id);
  const elsewhere = t.active.filter((c) => c.buyer !== id);
  const hours = b.open ? `${b.open[0]}:00–${b.open[1]}:00` : L('цілодобово', `open 24/7`);

  return L(`
    <div class="shop-head by-head" style="--by:${b.color};--by-a:${b.accent}">
      <div class="by-sign"><span class="by-ico">${b.icon}</span><div><h1>${esc(b.name)}</h1><p class="sub">${esc(b.who)} · ${hours} · ${open ? L('<span class="by-open">відчинено</span>', `<span class="by-open">open</span>`) : L('<span class="by-closed">зачинено</span>', `<span class="by-closed">closed</span>`)}</p></div></div>
      <div class="shop-head-right">${repHtml(t.rep[id])}<div class="money-chip">${formatMoney(game.money)}</div></div>
    </div>
    <p class="by-blurb">${esc(b.blurb)}</p>
    <div class="by-grid">
      <section class="by-col by-catch">
        <h3>Твій улов тут</h3>
        <div class="by-rows">${rows || L('<div class="by-empty">Нічого з того, що тут беруть. ', `<div class="by-empty">You have nothing they buy here. `) + esc(b.wants) + '.</div>'}${rej}</div>
        ${sellAll}
      </section>
      <section class="by-col by-chalk">
        <h3>Акції</h3>
        <ul>${promoHtml}</ul>
        <div class="by-tiers"><small>Репутація: надбавка до ціни · з «Постачальника» — 3 замовлення</small>${REP_LEVELS.map((l) => `<div class="${repLevel(t.rep[id]).name === l.name ? 'on' : t.rep[id] >= l.at ? 'got' : ''}"><span>${esc(l.name)}</span><i>${l.at ? L(`від ${l.at}`, `from ${l.at}`) : L('старт', `start`)}</i><b>${l.bonus ? `+${Math.round(l.bonus * 100)} %` : '—'}</b></div>`).join('')}</div>
        <div class="by-wants"><small>Що беруть</small>${esc(b.wants)}</div>
      </section>
      <section class="by-col by-orders">
        <h3>Замовлення <small>${t.active.length}/${MAX_CONTRACTS} взято</small></h3>
        ${mineHere.map((c) => contractCard(game, c, 'active', true, open)).join('')}
        ${offers.length ? offers.map((c) => contractCard(game, c, 'offer', true, open)).join('') : mineHere.length ? '' : L('<div class="by-empty">На сьогодні замовлень більше нема — заходь завтра.</div>', `<div class="by-empty">No more orders today — come back tomorrow.</div>`)}
        ${elsewhere.length ? L(`<h4>Інші замовлення</h4>${elsewhere.map((c) => contractCard(game, c, 'active', false, open)).join('')}`, `<h4>Other orders</h4>${elsewhere.map((c) => contractCard(game, c, 'active', false, open)).join('')}`) : ''}
      </section>
    </div>
    <p class="by-foot">Інші скупники: ${BUYERS.filter((x) => x.id !== id).map((x) => `${x.icon} ${esc(shortName(x.id))}`).join(' · ')} · 🐟 Біржа бере все за ринковою ціною</p>`, `
    <div class="shop-head by-head" style="--by:${b.color};--by-a:${b.accent}">
      <div class="by-sign"><span class="by-ico">${b.icon}</span><div><h1>${esc(b.name)}</h1><p class="sub">${esc(b.who)} · ${hours} · ${open ? L('<span class="by-open">відчинено</span>', `<span class="by-open">open</span>`) : L('<span class="by-closed">зачинено</span>', `<span class="by-closed">closed</span>`)}</p></div></div>
      <div class="shop-head-right">${repHtml(t.rep[id])}<div class="money-chip">${formatMoney(game.money)}</div></div>
    </div>
    <p class="by-blurb">${esc(b.blurb)}</p>
    <div class="by-grid">
      <section class="by-col by-catch">
        <h3>Your catch here</h3>
        <div class="by-rows">${rows || L('<div class="by-empty">Нічого з того, що тут беруть. ', `<div class="by-empty">You have nothing they buy here. `) + esc(b.wants) + '.</div>'}${rej}</div>
        ${sellAll}
      </section>
      <section class="by-col by-chalk">
        <h3>Offers</h3>
        <ul>${promoHtml}</ul>
        <div class="by-tiers"><small>Reputation: price bonus · from “Supplier” — 3 orders</small>${REP_LEVELS.map((l) => `<div class="${repLevel(t.rep[id]).name === l.name ? 'on' : t.rep[id] >= l.at ? 'got' : ''}"><span>${esc(l.name)}</span><i>${l.at ? L(`від ${l.at}`, `from ${l.at}`) : L('старт', `start`)}</i><b>${l.bonus ? `+${Math.round(l.bonus * 100)} %` : '—'}</b></div>`).join('')}</div>
        <div class="by-wants"><small>What they buy</small>${esc(b.wants)}</div>
      </section>
      <section class="by-col by-orders">
        <h3>Orders <small>${t.active.length}/${MAX_CONTRACTS} taken</small></h3>
        ${mineHere.map((c) => contractCard(game, c, 'active', true, open)).join('')}
        ${offers.length ? offers.map((c) => contractCard(game, c, 'offer', true, open)).join('') : mineHere.length ? '' : L('<div class="by-empty">На сьогодні замовлень більше нема — заходь завтра.</div>', `<div class="by-empty">No more orders today — come back tomorrow.</div>`)}
        ${elsewhere.length ? L(`<h4>Інші замовлення</h4>${elsewhere.map((c) => contractCard(game, c, 'active', false, open)).join('')}`, `<h4>Other orders</h4>${elsewhere.map((c) => contractCard(game, c, 'active', false, open)).join('')}`) : ''}
      </section>
    </div>
    <p class="by-foot">Other buyers: ${BUYERS.filter((x) => x.id !== id).map((x) => `${x.icon} ${esc(shortName(x.id))}`).join(' · ')} · 🐟 The exchange takes everything at market price</p>`);
}

/** журнал замовлень для меню паузи */
export function ordersHtml(game: GameState): string {
  const t = game.trade;
  if (!t.active.length) return L(`<p class="sub">Немає взятих замовлень. Їх дають скупники в порту (таверна, коптильня, ресторан, завод) і Остап на Сосновому острові. Виконано: ${t.done}.</p>`, `<p class="sub">No orders taken. Buyers in port (tavern, smokehouse, restaurant, cannery) and Ostap on Pine Island hand them out. Completed: ${t.done}.</p>`);
  return L(`<div class="by-journal">${t.active.map((c) => contractCard(game, c, 'active', false, true)).join('')}</div><p class="sub">Виконано: ${t.done} · зірвано: ${t.failed}. Прострочене замовлення згорає й трохи псує репутацію.</p>`, `<div class="by-journal">${t.active.map((c) => contractCard(game, c, 'active', false, true)).join('')}</div><p class="sub">Completed: ${t.done} · failed: ${t.failed}. An overdue order expires and costs a little reputation.</p>`);
}

/** плашка в HUD: найближче замовлення */
export class OrdersChip {
  private el: HTMLElement;
  private key = '';

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'orders-chip';
    document.body.appendChild(this.el);
  }

  update(game: GameState, visible: boolean) {
    const t = game.trade;
    const c = t.nextDeadline();
    let html = '';
    if (visible && c) {
      const left = c.deadline - game.clockH;
      const need = contractNeed(c);
      const fit = game.contractFish(c).length;
      const got = c.kg ? L(`${kg(Math.min(c.got, need))}/${kg(need)} кг`, `${kg(Math.min(c.got, need))}/${kg(need)} kg`) : `${c.got}/${need}`;
      html = L(`<span class="oc-ico">📜</span><span class="oc-txt"><b>${esc(contractTitle(c))}</b><small>${BUYER_BY_ID[c.buyer].icon} ${esc(shortName(c.buyer))} · ${got}${fit ? L(` · у трюмі ${fit}`, ` · in the hold ${fit}`) : ''}</small></span><span class="oc-t${left < 4 ? ' hot' : ''}">⏱ ${left < 1 ? '<1' : Math.floor(left)} год</span>${t.active.length > 1 ? `<span class="oc-more">+${t.active.length - 1}</span>` : ''}`, `<span class="oc-ico">📜</span><span class="oc-txt"><b>${esc(contractTitle(c))}</b><small>${BUYER_BY_ID[c.buyer].icon} ${esc(shortName(c.buyer))} · ${got}${fit ? L(` · у трюмі ${fit}`, ` · in the hold ${fit}`) : ''}</small></span><span class="oc-t${left < 4 ? ' hot' : ''}">⏱ ${left < 1 ? '<1' : Math.floor(left)} h</span>${t.active.length > 1 ? `<span class="oc-more">+${t.active.length - 1}</span>` : ''}`);
    }
    if (html === this.key) return;
    this.key = html;
    this.el.innerHTML = html;
    this.el.classList.toggle('show', !!html);
  }
}
