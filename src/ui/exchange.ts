import { formatMoney } from '../core/math';
import { FISH, FISH_BY_ID, ZONE_NAMES } from '../game/fish';
import { avgKg, glutUnits, stockFactor, FACTOR_MAX, FACTOR_MIN, MARKET_SAMPLE_H } from '../game/market';
import type { GameState } from '../game/state';
import type { FishItem } from '../core/types';

// ─────────────────────────────────────────────────────────────
// Рибна біржа: табло котирувань (картки з мініграфіками), великий графік
// вибраного виду на «міліметрівці», попит і насичення, біжучий рядок подій,
// трюм із прогнозом виторгу. Ціни — за типову свіжу рибину виду (₴/шт), бо
// продаєш ти рибинами (game.quoteTypical — те саме, що радіо й продаж);
// історія — точка кожні 3 ігрові години. Ринок живий: запас за видами
// (місто їсть, рибалки й боти підвозять) — game/market.ts.
// ─────────────────────────────────────────────────────────────

const INK = '#22303b';
const SEA = '#24878c';
const RED = '#d0573f';
const GOLD = '#b8701a';

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** шкала «ціна від запасу» 0..100 % (ліво — надлишок, право — дефіцит) */
const meter = (d: number) => `${Math.round(((d - FACTOR_MIN) / (FACTOR_MAX - FACTOR_MIN)) * 100)}%`;
/** запас словами: дефіцит / норма / надлишок */
function stockWord(d: number): { cls: string; text: string } {
  if (d > 1.03) return { cls: 'sea', text: `дефіцит +${Math.round((d - 1) * 100)}%` };
  if (d < 0.97) return { cls: 'red', text: `надлишок −${Math.round((1 - d) * 100)}%` };
  return { cls: '', text: 'норма' };
}

/** ціна типової рибини виду зараз і історія (₴/шт) */
export function priceSeries(game: GameState, id: string, m = game.venueMarket): number[] {
  const a = avgKg(id);
  const now = m.perKg(id, game.priceMult) * a;
  return [...(m.hist[id] ?? []).map((v) => v * a), now];
}

function trend(series: number[]): number {
  // зміна за останню добу (8 точок по 3 год)
  const n = series.length;
  if (n < 2) return 0;
  const back = series[Math.max(0, n - 1 - Math.round(24 / MARKET_SAMPLE_H))];
  return back > 0 ? series[n - 1] / back - 1 : 0;
}

function arrow(tr: number): string {
  if (tr > 0.03) return `<span class="ex-tr up">▲ ${Math.round(tr * 100)}%</span>`;
  if (tr < -0.03) return `<span class="ex-tr down">▼ ${Math.round(-tr * 100)}%</span>`;
  return '<span class="ex-tr flat">● 0%</span>';
}

function hours(h: number): string {
  if (h < 1) return 'менше години';
  const r = Math.ceil(h);
  return `${r} год`;
}

/** що в трюмі за видами */
function holdGroups(game: GameState): Map<string, FishItem[]> {
  const groups = new Map<string, FishItem[]>();
  for (const f of game.sellOrder(game.hold)) {
    const arr = groups.get(f.speciesId) ?? [];
    arr.push(f);
    groups.set(f.speciesId, arr);
  }
  return groups;
}

/** найкраща пропозиція дня: події з плюсом або найбільший ріст серед відомих видів */
function bestHint(game: GameState): string {
  const m = game.venueMarket;
  const boosts = m.events.filter((e) => e.mult > 1);
  if (boosts.length) {
    const e = boosts[0];
    return `💡 Сьогодні вигідно: <b>${esc(FISH_BY_ID[e.speciesId]?.name ?? e.speciesId)}</b> — ${esc(e.text)}`;
  }
  let best = '';
  let bt = 0.04;
  for (const sp of FISH) {
    if (!game.discovered.includes(sp.id)) continue;
    const t = trend(priceSeries(game, sp.id)) * m.demand(sp.id);
    if (t > bt) {
      bt = t;
      best = sp.id;
    }
  }
  if (best) return `💡 Росте в ціні: <b>${esc(FISH_BY_ID[best].name)}</b> (+${Math.round(bt * 100)}% за добу) — ${esc(ZONE_NAMES[FISH_BY_ID[best].zones[0]].toLowerCase())}`;
  // дефіцит (після шторму рибалки сиділи в порту) — найголодніший вид
  let hungry = '';
  let hd = 1.1;
  for (const sp of FISH) {
    if (!game.discovered.includes(sp.id)) continue;
    const d = m.demand(sp.id);
    if (d > hd) {
      hd = d;
      hungry = sp.id;
    }
  }
  if (hungry) return `💡 Дефіцит: <b>${esc(FISH_BY_ID[hungry].name)}</b> — риби на ринку мало, ціна +${Math.round((hd - 1) * 100)}%`;
  return '💡 Ринок рівний — місто з’їдає те, що везуть. Велика партія одного виду збиває ціну, різна риба — ні';
}

export function exchangeHtml(game: GameState, sel: string): string {
  const m = game.venueMarket;
  const groups = holdGroups(game);
  const holdCount = (id: string) => groups.get(id)?.length ?? 0;

  // ── біжучий рядок ──
  const tick = FISH.filter((sp) => game.discovered.includes(sp.id)).map((sp) => {
    const s = priceSeries(game, sp.id);
    const tr = trend(s);
    return `<span class="tk"><b>${esc(sp.name.toUpperCase())}</b> ${Math.round(s[s.length - 1])} ₴ <i class="${tr > 0.03 ? 'up' : tr < -0.03 ? 'down' : ''}">${tr > 0.03 ? '▲' : tr < -0.03 ? '▼' : '●'}${Math.abs(Math.round(tr * 100))}%</i></span>`;
  });
  const evs = m.events.map((e) => `<span class="tk ev ${e.mult > 1 ? 'up' : 'down'}">${e.mult > 1 ? '📈' : '📉'} ${esc(e.text)}</span>`);
  // акції скупників (таверна, коптильня…) — щоб було видно, куди ще везти
  const promos = game.trade.tickerTexts(game.clockH).map((t) => `<span class="tk ev up">${esc(t)}</span>`);
  // підвіз: хто з рибалок що здав (боти «Шторму»)
  const news = [...game.market.news].reverse().slice(0, 3).map((n) => `<span class="tk ev">🚢 «${esc(n.who)}» ${esc(n.text)}</span>`);
  const items = [...evs, ...news, ...promos, ...tick];
  if (!items.length) items.push('<span class="tk">Біржа відкрита · спіймай першу рибу — з’явиться в котируваннях</span>');
  const strip = items.join('<span class="tk-sep">✦</span>');
  const ticker = `<div class="ex-ticker"><div class="ex-tk-run">${strip}<span class="tk-sep">✦</span>${strip}<span class="tk-sep">✦</span></div></div>`;

  // ── табло котирувань ──
  const cards = FISH.map((sp) => {
    const id = sp.id;
    const known = game.discovered.includes(id);
    const s = priceSeries(game, id);
    const now = s[s.length - 1];
    const tr = trend(s);
    const d = m.demand(id);
    const ev = m.eventFor(id);
    const hc = holdCount(id);
    const cls = ['ex-card', id === sel ? 'sel' : '', known ? '' : 'unk', ev ? (ev.mult > 1 ? 'hot' : 'cold') : d < 0.85 ? 'cold' : d > 1.15 ? 'hot' : ''].join(' ');
    return `<button class="${cls}" data-sp="${id}">
        <span class="ex-c-top"><b>${known ? esc(sp.name) : '???'}</b>${ev ? `<span class="ex-flag ${ev.mult > 1 ? 'up' : 'down'}" title="${esc(ev.text)}">${ev.mult > 1 ? '+' : '−'}${Math.round(Math.abs(ev.mult - 1) * 100)}%</span>` : ''}${hc ? `<span class="ex-hc" title="у трюмі">${hc}</span>` : ''}</span>
        <span class="ex-c-mid"><span class="ex-c-p">${known ? `${Math.round(now)}<small> ₴</small>` : '—'}</span>${known ? arrow(tr) : ''}</span>
        <canvas class="ex-spark" data-spark="${id}" width="120" height="30"></canvas>
        <span class="ex-dem" title="Запас на ринку: ${stockWord(d).text}"><i style="width:${meter(d)}"></i></span>
      </button>`;
  }).join('');

  // ── вибраний вид: великий графік + цифри ──
  const sp = FISH_BY_ID[sel];
  const known = game.discovered.includes(sel);
  const s = priceSeries(game, sel);
  const now = s[s.length - 1];
  const lo = Math.min(...s), hi = Math.max(...s);
  const tr = trend(s);
  const d = m.demand(sel);
  const ev = m.eventFor(sel);
  const rec = m.recoverHours(sel);
  const mine = groups.get(sel) ?? [];
  let detail = '';
  if (mine.length) {
    const q = game.quote(mine);
    const full = mine.reduce((a, f) => a + game.sellPrice(f), 0);
    let gAfter = m.stockOf(sel);
    for (const f of mine) gAfter += glutUnits(f);
    const dAfter = stockFactor(gAfter, m.target(sel));
    detail = `<div class="ex-mine">
        <div class="ex-mine-h"><b>У трюмі: ${mine.length} шт</b> · ${mine.reduce((a, f) => a + f.kg, 0).toFixed(1).replace('.', ',')} кг</div>
        <div class="ex-mine-row"><span>Продати всіх зараз</span><b class="gold">${formatMoney(q.total)}</b></div>
        ${q.total < full - 1 ? `<div class="ex-mine-row dim"><span>насичення з’їсть</span><span class="red">−${formatMoney(full - q.total)}</span></div>` : ''}
        <div class="ex-mine-row dim"><span>ціна від запасу після продажу</span><span>${pct(d)} → ${pct(dAfter)}</span></div>
        <div class="ex-mine-btns">
          <button class="btn" data-sell1="${sel}">Одну — ${formatMoney(q.prices[0] ?? 0)}</button>
          <button class="btn primary" data-sellgroup="${sel}">Усіх ${mine.length} — ${formatMoney(q.total)}</button>
        </div>
      </div>`;
  } else {
    detail = `<div class="ex-mine empty">${known ? `У трюмі немає. Ловиться: ${sp.zones.map((z) => ZONE_NAMES[z].toLowerCase()).join(', ')} · ${sp.day && sp.night ? 'вдень і вночі' : sp.day ? 'вдень' : 'вночі'}` : 'Цей вид ще ніхто з твого екіпажу не ловив'}</div>`;
  }
  const focus = `<div class="ex-focus">
      <div class="ex-f-head">
        <div>
          <div class="ex-f-cat">${known ? esc(sp.zones.map((z) => ZONE_NAMES[z]).join(' · ')) : 'невідомий вид'}</div>
          <h3>${known ? esc(sp.name) : '???'}</h3>
        </div>
        <div class="ex-f-price">
          <span class="big">${Math.round(now)} ₴</span>
          <small>за рибину ~${avgKg(sel).toFixed(avgKg(sel) < 1 ? 2 : 1).replace('.', ',')} кг</small>
          ${arrow(tr)}
        </div>
      </div>
      <div class="ex-chart-wrap"><canvas class="ex-chart" data-chart="${sel}"></canvas></div>
      <div class="ex-stats">
        <div><small>мін. за 6 діб</small><b>${Math.round(lo)} ₴</b></div>
        <div><small>макс. за 6 діб</small><b>${Math.round(hi)} ₴</b></div>
        <div><small>запас на ринку</small><b class="${stockWord(d).cls}">${d > 1.03 ? `+${Math.round((d - 1) * 100)}%` : d < 0.97 ? `−${Math.round((1 - d) * 100)}%` : 'норма'}</b><em>${d > 1.03 ? 'дефіцит · ' : d < 0.97 ? 'надлишок · ' : ''}${rec > 0.5 ? `норма за ~${hours(rec)}` : 'їдять стільки, скільки везуть'}</em></div>
        <div><small>новина</small><b class="${ev ? (ev.mult > 1 ? 'sea' : 'red') : ''}">${ev ? `${ev.mult > 1 ? '+' : '−'}${Math.round(Math.abs(ev.mult - 1) * 100)}%` : '—'}</b>${ev ? `<em>${esc(ev.text.replace(/:.*$/, ''))}</em>` : '<em>без подій</em>'}</div>
      </div>
      ${detail}
    </div>`;

  // ── трюм: прогноз виторгу ──
  const total = game.quote(game.hold).total;
  const fullAll = game.hold.reduce((a, f) => a + game.sellPrice(f), 0);
  const rows = [...groups.entries()]
    .sort((a, b) => game.quote(b[1]).total - game.quote(a[1]).total)
    .map(([id, arr]) => {
      const q = game.quote(arr);
      return `<button class="ex-h-row${id === sel ? ' sel' : ''}" data-sp="${id}"><span>${esc(FISH_BY_ID[id]?.name ?? id)} <i>×${arr.length}</i></span><b>${formatMoney(q.total)}</b></button>`;
    }).join('');
  const hold = `<div class="ex-hold">
      <div class="ex-h-head"><b>Трюм</b><span>${game.hold.length}/${game.holdCap}</span></div>
      ${game.hold.length ? `<div class="ex-h-list">${rows}</div>
        <div class="ex-h-total"><span>Разом</span><b>${formatMoney(total)}</b></div>
        ${fullAll - total > 1 ? `<div class="ex-h-loss">насичення: −${formatMoney(fullAll - total)} · різна риба — дорожча</div>` : '<div class="ex-h-loss ok">ринок бере все за повну ціну</div>'}
        <button class="btn primary ex-sellall" data-sellall>Продати весь улов</button>`
        : '<p class="ex-h-empty">Порожньо. Подивись на табло — що зараз у ціні — і в море!</p>'}
    </div>`;

  return `${ticker}
    <div class="ex-hint">${bestHint(game)}</div>
    <div class="ex-grid">
      <div class="ex-board">${cards}</div>
      ${focus}
      ${hold}
    </div>
    <p class="ex-foot">Ціна — за рибину середньої ваги; свіжість, варення і штормовий улов (+25%) рахуються при продажу. Ринок живий: місто щогодини їсть рибу, рибалки підвозять (у шторм — ніхто, і ціни ростуть). Твій продаж додає рибу в запас — партія одного виду збиває ціну, а за добу-дві місто її доїдає.</p>`;
}

/** намалювати мініграфіки й великий графік після вставки HTML */
export function drawExchange(root: HTMLElement, game: GameState) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  root.querySelectorAll<HTMLCanvasElement>('canvas[data-spark]').forEach((cv) => {
    const id = cv.dataset.spark!;
    if (!game.discovered.includes(id)) return;
    const w = 120, h = 30;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = priceSeries(game, id).slice(-24); // остання доба-три
    const lo = Math.min(...s), hi = Math.max(...s);
    const span = hi - lo || 1;
    const X = (i: number) => 2 + (i / (s.length - 1)) * (w - 6);
    const Y = (v: number) => h - 4 - ((v - lo) / span) * (h - 8);
    const up = s[s.length - 1] >= s[0];
    const col = up ? SEA : RED;
    c.beginPath();
    s.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.lineTo(X(s.length - 1), h);
    c.lineTo(X(0), h);
    c.closePath();
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, up ? 'rgba(36,135,140,0.25)' : 'rgba(208,87,63,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fill();
    c.beginPath();
    s.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.strokeStyle = col;
    c.lineWidth = 1.6;
    c.lineJoin = 'round';
    c.stroke();
    c.beginPath();
    c.arc(X(s.length - 1), Y(s[s.length - 1]), 2.2, 0, Math.PI * 2);
    c.fillStyle = col;
    c.fill();
  });

  const cv = root.querySelector<HTMLCanvasElement>('canvas[data-chart]');
  if (!cv) return;
  const id = cv.dataset.chart!;
  const known = game.discovered.includes(id);
  const rect = cv.getBoundingClientRect();
  const w = Math.max(200, rect.width), h = Math.max(120, rect.height);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const c = cv.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const FONT = 'Manrope, -apple-system, "Segoe UI", sans-serif';
  // міліметрівка
  const L = 40, R = 12, T = 12, B = 24;
  const pw = w - L - R, ph = h - T - B;
  c.fillStyle = '#fbf7ee';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(36,135,140,0.08)';
  c.lineWidth = 1;
  for (let x = L; x <= L + pw; x += 8) { c.beginPath(); c.moveTo(x + 0.5, T); c.lineTo(x + 0.5, T + ph); c.stroke(); }
  for (let y = T; y <= T + ph; y += 8) { c.beginPath(); c.moveTo(L, y + 0.5); c.lineTo(L + pw, y + 0.5); c.stroke(); }
  if (!known) {
    c.fillStyle = 'rgba(34,48,59,0.45)';
    c.font = `700 13px ${FONT}`;
    c.textAlign = 'center';
    c.fillText('Спіймай цей вид — і біржа покаже його ціни', L + pw / 2, T + ph / 2);
    return;
  }
  const s = priceSeries(game, id);
  const sp = FISH_BY_ID[id];
  const base = sp.basePrice;
  let lo = Math.min(...s, base), hi = Math.max(...s, base);
  const pad = (hi - lo) * 0.18 || hi * 0.1;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const X = (i: number) => L + (i / (s.length - 1)) * pw;
  const Y = (v: number) => T + ph - ((v - lo) / (hi - lo)) * ph;
  // горизонтальні рівні з підписами
  c.font = `700 10.5px ${FONT}`;
  c.textAlign = 'right';
  const step = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const y = Math.round(Y(v)) + 0.5;
    c.strokeStyle = 'rgba(34,48,59,0.12)';
    c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke();
    c.fillStyle = 'rgba(34,48,59,0.55)';
    c.fillText(String(Math.round(v)), L - 6, y + 3.5);
  }
  // доби: вертикальні риски (8 точок = доба), підпис «−N д»
  const perDay = Math.round(24 / MARKET_SAMPLE_H);
  c.textAlign = 'center';
  for (let k = 0, i = s.length - 1; i >= 0; k++, i -= perDay) {
    const x = Math.round(X(i)) + 0.5;
    c.strokeStyle = 'rgba(34,48,59,0.18)';
    c.setLineDash([2, 3]);
    c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(34,48,59,0.55)';
    c.textAlign = k === 0 ? 'right' : 'center';
    c.fillText(k === 0 ? 'зараз' : `−${k} д`, k === 0 ? L + pw : x, h - 8);
  }
  // базова ціна — пунктир
  c.strokeStyle = 'rgba(184,112,26,0.55)';
  c.setLineDash([6, 4]);
  c.beginPath(); c.moveTo(L, Y(base)); c.lineTo(L + pw, Y(base)); c.stroke();
  c.setLineDash([]);
  c.fillStyle = GOLD;
  c.textAlign = 'left';
  c.fillText('звична ціна', L + 6, Y(base) - 5);
  // площа і лінія ціни
  const up = s[s.length - 1] >= s[Math.max(0, s.length - 1 - perDay)];
  const col = up ? SEA : RED;
  c.beginPath();
  s.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
  c.lineTo(X(s.length - 1), T + ph);
  c.lineTo(X(0), T + ph);
  c.closePath();
  const g = c.createLinearGradient(0, T, 0, T + ph);
  g.addColorStop(0, up ? 'rgba(36,135,140,0.28)' : 'rgba(208,87,63,0.24)');
  g.addColorStop(1, 'rgba(251,247,238,0)');
  c.fillStyle = g;
  c.fill();
  c.beginPath();
  s.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
  c.strokeStyle = col;
  c.lineWidth = 2.4;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.stroke();
  // мін/макс маркери
  const iMax = s.indexOf(Math.max(...s)), iMin = s.indexOf(Math.min(...s));
  for (const [i, lab] of [[iMax, '▲'], [iMin, '▼']] as const) {
    c.fillStyle = lab === '▲' ? SEA : RED;
    c.font = `800 9px ${FONT}`;
    c.textAlign = 'center';
    c.fillText(lab, X(i), Y(s[i]) + (lab === '▲' ? -7 : 13));
  }
  // поточна точка з плашкою
  const xn = X(s.length - 1), yn = Y(s[s.length - 1]);
  c.beginPath();
  c.arc(xn, yn, 4.5, 0, Math.PI * 2);
  c.fillStyle = '#fff';
  c.fill();
  c.lineWidth = 2.4;
  c.strokeStyle = col;
  c.stroke();
  const lab = `${Math.round(s[s.length - 1])} ₴`;
  c.font = `800 12px ${FONT}`;
  const tw = c.measureText(lab).width;
  const bx = Math.min(xn - tw - 18, L + pw - tw - 16);
  c.fillStyle = INK;
  c.beginPath();
  c.roundRect(bx, yn - 22, tw + 12, 18, 6);
  c.fill();
  c.fillStyle = '#fbf6ec';
  c.textAlign = 'left';
  c.fillText(lab, bx + 6, yn - 9);
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
