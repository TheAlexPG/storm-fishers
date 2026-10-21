import { formatMoney } from '../core/math';
import { L } from '../core/i18n';
import type { GameState } from '../game/state';
import { HOTSPOTS } from '../game/fish';
import { LANDMARKS } from '../world/landmarks';
import { ISLANDS } from '../world/islandShape';
import { PORT_SITE_BY_ID } from '../world/portSites';

// ─────────────────────────────────────────────────────────────
// Картограф Гавані Зорі: продає точні лоції місць, яких ти ще не відкрив —
// рибних місць («чутки» стають позначкою з назвою й колом) та островів і
// уламків. Куплене одразу з'являється на лоції (як відкрите місце);
// можна ще й проложити туди курс.
// ─────────────────────────────────────────────────────────────

export interface ChartOffer {
  id: string;
  name: string;
  sub: string;
  x: number;
  z: number;
  price: number;
  /** 'hot' — рибне місце (ризик 1..3), 'isle' — острів, 'mark' — пам'ятка */
  kind: 'hot' | 'isle' | 'mark';
  risk?: number;
  dist: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** що картограф може продати: невідкриті місця, найближчі першими (рибні — завжди на початку) */
export function chartOffers(game: GameState, fromX: number, fromZ: number): ChartOffer[] {
  const hot = new Set(HOTSPOTS.map((h) => h.id));
  const isle = new Set(ISLANDS.map((d) => d.id));
  const out: ChartOffer[] = [];
  for (const l of LANDMARKS) {
    if (game.places.includes(l.id)) continue;
    // гавані й континенти не продаються — їх видно й так
    if (PORT_SITE_BY_ID[l.id] || l.id.startsWith('cont-') || l.r > 600) continue;
    const dist = Math.hypot(l.x - fromX, l.z - fromZ);
    if (hot.has(l.id)) {
      const h = HOTSPOTS.find((q) => q.id === l.id)!;
      out.push({ id: l.id, name: h.name, sub: h.sub, x: h.x, z: h.z, kind: 'hot', risk: h.risk, dist, price: [0, 320, 560, 820][h.risk] + Math.round(dist * 0.04) });
    } else {
      out.push({ id: l.id, name: l.name, sub: l.sub, x: l.x, z: l.z, kind: isle.has(l.id) ? 'isle' : 'mark', dist, price: 140 + Math.round(dist * 0.05 / 10) * 10 });
    }
  }
  out.sort((a, b) => (a.kind === 'hot' ? 0 : 1) - (b.kind === 'hot' ? 0 : 1) || a.dist - b.dist);
  const hots = out.filter((o) => o.kind === 'hot').slice(0, 3);
  const rest = out.filter((o) => o.kind !== 'hot').slice(0, 4);
  return [...hots, ...rest];
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', L(',', '.'))} ${L('км', 'km')}` : `${Math.round(m / 10) * 10} ${L('м', 'm')}`);

export function chartmakerHtml(game: GameState, offers: ChartOffer[]): string {
  const icon = (o: ChartOffer) => (o.kind === 'hot' ? '🎣' : o.kind === 'isle' ? '🏝' : '⚓');
  const rows = offers.length
    ? `<div class="cg-list">${offers
        .map(
          (o) => `
      <div class="cg-card" style="--cg:${o.kind === 'hot' ? '#24878c' : o.kind === 'isle' ? '#6b9273' : '#8a5a32'}">
        <div class="cg-goods"><span class="cg-icon">${icon(o)}</span><span>${esc(o.name)}</span></div>
        <div class="cg-tags">${o.risk ? `<span class="cg-tag ${o.risk >= 3 ? 'late' : o.risk === 2 ? 'urgent' : 'far'}">${L('ризик', 'risk')} ${'⚠'.repeat(o.risk)}</span>` : `<span class="cg-tag">${o.kind === 'isle' ? L('острів', 'island') : L('пам\'ятка', 'landmark')}</span>`}<span class="cg-tag">${km(o.dist)}</span></div>
        <div class="cg-meta">${esc(o.sub)}</div>
        <div class="cg-foot">
          <button class="btn primary" data-chart="${esc(o.id)}" ${game.money >= o.price ? '' : 'disabled'}>${L('Купити', `Buy`)} ${formatMoney(o.price)}</button>
          <button class="btn" data-chartroute="${esc(o.id)}" ${game.money >= o.price ? '' : 'disabled'} title="${L('купити й додати точку маршруту', `buy and add a route waypoint`)}">${L('+ курс', `+ course`)}</button>
        </div>
      </div>`,
        )
        .join('')}</div>`
    : `<p class="cg-meta">${L('Ти вже знаєш усі місця, які знаю я. Повертайся, коли море подарує нові чутки.', `You already know every place I know. Come back when the sea brings new rumours.`)}</p>`;
  return `
    <div class="cg-head"><div>
      <h1>🗺 ${L('Картограф', `Chartmaker`)}</h1>
      <p class="sub">${L('Гавань Зорі · «Чутки моряків — у точні лоції»', `Dawn Harbour · “Sailors' rumours, made into true charts”`)}</p>
    </div><div class="money-chip">${formatMoney(game.money)}</div></div>
    <div class="cg-body">
      <p class="cg-meta">${L('Куплене місце одразу з\'явиться на твоїй лоції з назвою. Рибні місця — найдорожчі: там риба вдвічі важча, але й море лютіше.', `A charted place appears on your chart right away, with its name. Fishing grounds cost the most: the fish are twice the weight, but the sea is fiercer.`)}</p>
      ${rows}
    </div>
    <div class="btn-row"><button class="btn" data-close>${L('Закрити (Esc)', `Close (Esc)`)}</button></div>`;
}

/** кнопки вікна картографа; onBuy — після купівлі (зберегти, тост, оновити вікно) */
export function bindChartmaker(panel: HTMLElement, game: GameState, offers: ChartOffer[], onBuy: (o: ChartOffer, route: boolean) => void) {
  const buy = (id: string | null | undefined, route: boolean) => {
    const o = offers.find((q) => q.id === id);
    if (!o || game.money < o.price || game.places.includes(o.id)) return;
    game.spend(o.price, 'other');
    game.places.push(o.id);
    if (route) game.addRoutePoint(o.x, o.z);
    onBuy(o, route);
  };
  panel.querySelectorAll<HTMLElement>('[data-chart]').forEach((b) => b.addEventListener('click', () => buy(b.dataset.chart, false)));
  panel.querySelectorAll<HTMLElement>('[data-chartroute]').forEach((b) => b.addEventListener('click', () => buy(b.dataset.chartroute, true)));
}
