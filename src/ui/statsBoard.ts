import * as THREE from 'three';
import './stats.css';
import { L, fmtNum, plural } from '../core/i18n';
import { formatMoney } from '../core/math';
import { WORLD } from '../core/region';
import { FISH } from '../game/fish';
import { UPGRADES, MAX_LEVEL } from '../game/upgrades';
import type { EarnKind, SpendKind } from '../game/ledger';
import type { GameState } from '../game/state';

// ─────────────────────────────────────────────────────────────
// «Журнал капітана»: пробкова дошка на стіні хати (canvas-текстура)
// і детальна панель (E біля дошки): заробіток і витрати по днях,
// пройдений шлях і мапа треків, колекція риби, знахідки, апгрейди.
// ─────────────────────────────────────────────────────────────

export interface StatsExtra {
  day: number;
  playTime: number;
  places: { found: number; total: number };
  ports: { found: number; total: number };
  hats: { found: number; total: number };
  treasures: number;
  /** паперова лоція з пройденим шляхом (MapView.drawChart) */
  chart?: HTMLCanvasElement;
}

const EARN_NAMES: Record<EarnKind, string> = {
  exchange: L('Біржа', `Exchange`),
  buyers: L('Скупники', `Buyers`),
  contracts: L('Замовлення', `Orders`),
  kitchen: L('Камбуз', `Galley`),
  finds: L('Знахідки', `Finds`),
  insurance: L('Страхові виплати', `Insurance payouts`),
  cargo: L('Доставки вантажів', `Cargo deliveries`),
  other: L('Інше', `Other`),
};
const SPEND_NAMES: Record<SpendKind, string> = {
  fuel: L('Пальне', `Fuel`),
  repair: L('Ремонт корпусу', `Hull repairs`),
  upgrades: L('Апгрейди', `Upgrades`),
  insurance: L('Страховка', `Insurance`),
  nets: L('Ремонт сіток', `Net mending`),
  kitchen: L('Комора й рецепти', `Pantry & recipes`),
  tow: L('Буксир', `Towing`),
  fees: L('Збори', `Fees`),
  base: L('Дім на континенті', `Continental home`),
  other: L('Інше', `Other`),
};

const km = (m: number) => (m < 1000 ? `${Math.round(m)} ${L('м', 'm')}` : `${fmtNum(m / 1000, m < 10000 ? 1 : 0)} ${L('км', 'km')}`);
const nm = (m: number) => `${fmtNum(m / 1852, 1)} ${L('милі', 'nm')}`;
const hm = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? L(`${h} год ${m} хв`, `${h} h ${m} min`) : L(`${m} хв`, `${m} min`);
};
const kgs = (v: number) => `${fmtNum(v, v < 10 ? 1 : 0)} ${L('кг', 'kg')}`;
const money = (v: number) => formatMoney(v);
function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ── дошка на стіні ──

const BW = 1024;
const BH = 650;

export class StatsBoard {
  readonly canvas = document.createElement('canvas');
  readonly tex: THREE.CanvasTexture;
  private t = 0;

  constructor() {
    this.canvas.width = BW;
    this.canvas.height = BH;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
  }

  /** перемальовувати раз на кілька секунд, коли гравець поруч */
  due(dt: number, near: boolean): boolean {
    this.t -= dt;
    if (this.t > 0 || !near) return false;
    this.t = 2;
    return true;
  }

  draw(game: GameState, ex: StatsExtra) {
    const x = this.canvas.getContext('2d')!;
    const lg = game.ledger;
    // пробка
    x.fillStyle = '#b98d5c';
    x.fillRect(0, 0, BW, BH);
    for (let i = 0; i < 2600; i++) {
      const r = ((i * 9301 + 49297) % 233280) / 233280;
      const r2 = ((i * 4649 + 7919) % 104729) / 104729;
      x.fillStyle = i % 3 ? 'rgba(120,80,40,0.18)' : 'rgba(240,210,160,0.2)';
      x.fillRect(r * BW, r2 * BH, 2 + (i % 4), 2);
    }
    const pin = (px: number, py: number, c = '#c23a2c') => {
      x.fillStyle = 'rgba(0,0,0,0.25)';
      x.beginPath(); x.arc(px + 3, py + 4, 9, 0, Math.PI * 2); x.fill();
      x.fillStyle = c;
      x.beginPath(); x.arc(px, py, 9, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.55)';
      x.beginPath(); x.arc(px - 3, py - 3, 3, 0, Math.PI * 2); x.fill();
    };
    const paper = (px: number, py: number, w: number, h: number, rot: number, bg = '#f7efdc') => {
      x.save();
      x.translate(px + w / 2, py + h / 2);
      x.rotate(rot);
      x.fillStyle = 'rgba(40,25,10,0.28)';
      x.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
      x.fillStyle = bg;
      x.fillRect(-w / 2, -h / 2, w, h);
      x.restore();
    };
    const SERIF = 'Georgia, "Times New Roman", serif';
    const SANS = 'Manrope, -apple-system, "Segoe UI", sans-serif';

    // заголовок
    paper(250, 22, 524, 86, -0.01, '#2a3440');
    x.fillStyle = '#f6ecd2';
    x.font = `bold 46px ${SERIF}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(L('ЖУРНАЛ КАПІТАНА', `CAPTAIN'S LOG`), 512, 58);
    x.font = `600 20px ${SANS}`;
    x.fillStyle = 'rgba(246,236,210,0.75)';
    x.fillText(L(`день ${ex.day}`, `day ${ex.day}`), 512, 92);
    pin(270, 36);
    pin(754, 36);

    // картки
    const card = (px: number, py: number, rot: number, label: string, value: string, sub: string, accent: string) => {
      paper(px, py, 228, 150, rot);
      x.save();
      x.translate(px + 114, py + 75);
      x.rotate(rot);
      x.textAlign = 'center';
      x.fillStyle = accent;
      x.fillRect(-114, -75, 228, 8);
      x.fillStyle = '#6b5d48';
      x.font = `700 19px ${SANS}`;
      x.fillText(label.toUpperCase(), 0, -40);
      x.fillStyle = '#22303b';
      x.font = `bold 40px ${SERIF}`;
      let fs = 40;
      while (fs > 22 && x.measureText(value).width > 200) {
        fs -= 2;
        x.font = `bold ${fs}px ${SERIF}`;
      }
      x.fillText(value, 0, 6);
      x.fillStyle = '#6b5d48';
      x.font = `600 17px ${SANS}`;
      x.fillText(sub, 0, 46);
      x.restore();
      pin(px + 114, py + 10, accent);
    };
    const todayRow = lg.lastDays(ex.day, 1)[0];
    card(36, 140, -0.03, L('Зароблено', 'Earned'), money(lg.totalEarned), L(`сьогодні +${money(todayRow?.in ?? 0)}`, `today +${money(todayRow?.in ?? 0)}`), '#2f7d4a');
    card(284, 150, 0.02, L('Пройдено', 'Sailed'), km(lg.distM), L(`у морі ${hm(lg.seaSec)}`, `at sea ${hm(lg.seaSec)}`), '#2f5f8f');
    card(532, 138, -0.015, L('Улов', 'Catch'), kgs(lg.kg), `${game.stats.totalCaught} ${plural(game.stats.totalCaught, ['риба', 'риби', 'риб'], ['fish', 'fish'])} · 🏆 ${lg.trophies}`, '#c9694a');
    card(780, 150, 0.025, L('Місця', 'Places'), `${ex.places.found}/${ex.places.total}`, L(`видів риби ${game.discovered.length}/${FISH.length}`, `species ${game.discovered.length}/${FISH.length}`), '#e39a2d');

    // графік заробітку за 7 днів
    paper(40, 330, 560, 280, 0.008);
    x.save();
    x.translate(40, 330);
    x.fillStyle = '#22303b';
    x.textAlign = 'left';
    x.font = `bold 24px ${SERIF}`;
    x.fillText(L('Заробіток за тиждень', 'Earnings this week'), 26, 34);
    const days = lg.lastDays(ex.day, 7);
    const maxV = Math.max(50, ...days.map((d) => Math.max(d.in, d.out)));
    const cx0 = 40, cy0 = 240, ch = 160, cw = 490;
    x.strokeStyle = 'rgba(34,48,59,0.15)';
    x.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      x.beginPath();
      x.moveTo(cx0, cy0 - (ch * i) / 4);
      x.lineTo(cx0 + cw, cy0 - (ch * i) / 4);
      x.stroke();
    }
    const slot = cw / 7;
    days.forEach((d, i) => {
      const bx = cx0 + slot * (i + (7 - days.length)) + 10;
      const hIn = (d.in / maxV) * ch;
      const hOut = (d.out / maxV) * ch;
      x.fillStyle = '#2f7d4a';
      x.fillRect(bx, cy0 - hIn, slot * 0.38, hIn);
      x.fillStyle = '#c9694a';
      x.fillRect(bx + slot * 0.42, cy0 - hOut, slot * 0.28, hOut);
      x.fillStyle = '#6b5d48';
      x.font = `600 15px ${SANS}`;
      x.textAlign = 'center';
      x.fillText(d.d === ex.day ? L('сьог.', 'today') : `${L('д', 'd')}${d.d}`, bx + slot * 0.35, cy0 + 20);
    });
    x.textAlign = 'left';
    x.font = `600 15px ${SANS}`;
    x.fillStyle = '#2f7d4a';
    x.fillRect(330, 22, 14, 14);
    x.fillStyle = '#6b5d48';
    x.fillText(L('дохід', 'income'), 350, 34);
    x.fillStyle = '#c9694a';
    x.fillRect(420, 22, 14, 14);
    x.fillStyle = '#6b5d48';
    x.fillText(L('витрати', 'spent'), 440, 34);
    x.restore();
    pin(320, 340);

    // мапа шляху
    paper(632, 336, 352, 274, -0.012, '#e9dcbc');
    x.save();
    x.translate(632, 336);
    x.fillStyle = '#22303b';
    x.font = `bold 22px ${SERIF}`;
    x.textAlign = 'left';
    x.fillText(L('Мої шляхи', 'Where I sailed'), 20, 32);
    if (ex.chart) {
      const cw = ex.chart.width, chh = ex.chart.height;
      const s = Math.min(316 / cw, 206 / chh);
      x.drawImage(ex.chart, 18 + (316 - cw * s) / 2, 48 + (206 - chh * s) / 2, cw * s, chh * s);
    } else drawTrack(x, game, 18, 48, 316, 206, '#2f5f8f');
    x.restore();
    pin(808, 346, '#2f5f8f');

    // підказка
    x.fillStyle = 'rgba(42,52,64,0.85)';
    x.fillRect(BW / 2 - 150, BH - 34, 300, 30);
    x.fillStyle = '#f6ecd2';
    x.font = `700 17px ${SANS}`;
    x.textAlign = 'center';
    x.fillText(L('E — відкрити журнал', 'E — open the log'), BW / 2, BH - 18);
    this.tex.needsUpdate = true;
  }
}

/** трек яхти в межах світу, вписаний у прямокутник */
function drawTrack(x: CanvasRenderingContext2D, game: GameState, px: number, py: number, w: number, h: number, color: string) {
  const W = WORLD.W1 - WORLD.W0, H = WORLD.H1 - WORLD.H0;
  const s = Math.min(w / W, h / H);
  const ox = px + (w - W * s) / 2, oy = py + (h - H * s) / 2;
  const P = (wx: number, wz: number): [number, number] => [ox + (wx - WORLD.W0) * s, oy + (wz - WORLD.H0) * s];
  x.fillStyle = 'rgba(47,95,143,0.12)';
  x.fillRect(ox, oy, W * s, H * s);
  x.strokeStyle = 'rgba(47,95,143,0.35)';
  x.strokeRect(ox, oy, W * s, H * s);
  const tr = game.track;
  if (tr.length >= 4) {
    x.strokeStyle = color;
    x.lineWidth = 2.5;
    x.lineJoin = 'round';
    x.setLineDash([6, 4]);
    x.beginPath();
    for (let i = 0; i < tr.length; i += 2) {
      const [a, b] = P(tr[i], tr[i + 1]);
      if (i === 0) x.moveTo(a, b);
      else x.lineTo(a, b);
    }
    x.stroke();
    x.setLineDash([]);
  }
  // дім
  const [hx, hy] = P(0, -20);
  x.fillStyle = '#c23a2c';
  x.beginPath();
  x.arc(hx, hy, 5, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#22303b';
  x.font = `700 13px Manrope, sans-serif`;
  x.textAlign = 'left';
  x.fillText(L('дім', 'home'), hx + 8, hy + 4);
}

// ── детальна панель ──

/** мапа пройдених шляхів для панелі (лоція, якщо є; інакше — лише трек) */
function trackSvg(game: GameState, chart?: HTMLCanvasElement): string {
  if (chart) return `<img class="st-track" src="${chart.toDataURL('image/jpeg', 0.86)}" alt="${esc(L('Лоція з пройденими шляхами', 'Chart with the tracks sailed'))}">`;
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 494;
  const x = c.getContext('2d')!;
  x.fillStyle = '#efe4c8';
  x.fillRect(0, 0, 640, 494);
  drawTrack(x, game, 10, 10, 620, 474, '#2f5f8f');
  return `<img class="st-track" src="${c.toDataURL('image/png')}" alt="${esc(L('Мапа пройдених шляхів', 'Map of sailed tracks'))}">`;
}

function bars<K extends string>(rec: Record<K, number>, names: Record<K, string>, cls: string): string {
  const rows = (Object.keys(rec) as K[]).filter((k) => rec[k] > 0).sort((a, b) => rec[b] - rec[a]);
  if (!rows.length) return `<p class="st-empty">${L('Поки порожньо', 'Nothing yet')}</p>`;
  const max = Math.max(...rows.map((k) => rec[k]));
  return `<div class="st-bars">${rows
    .map((k) => `<div class="st-bar"><span class="st-bar-name">${esc(names[k])}</span><span class="st-bar-track"><i class="${cls}" style="width:${Math.max(3, (rec[k] / max) * 100)}%"></i></span><b>${money(rec[k])}</b></div>`)
    .join('')}</div>`;
}

export function statsHtml(game: GameState, ex: StatsExtra): string {
  const lg = game.ledger;
  const net = lg.totalEarned - lg.totalSpent;
  const today = lg.lastDays(ex.day, 1)[0] ?? { d: ex.day, in: 0, out: 0 };
  const best = lg.bestDay;
  const days = lg.lastDays(ex.day, 14);
  const maxV = Math.max(50, ...days.map((d) => Math.max(d.in, d.out)));
  const chart = `<div class="st-chart" style="grid-template-columns: repeat(${Math.max(7, days.length)}, minmax(0, 1fr))">${days
    .map((d) => `<div class="st-col${d.d === ex.day ? ' today' : ''}" title="${esc(L(`День ${d.d}: +${money(d.in)} / −${money(d.out)}`, `Day ${d.d}: +${money(d.in)} / −${money(d.out)}`))}">
      <div class="st-col-bars"><i class="in" style="height:${(d.in / maxV) * 100}%"></i><i class="out" style="height:${(d.out / maxV) * 100}%"></i></div>
      <span>${d.d === ex.day ? L('сьог.', 'today') : d.d}</span></div>`)
    .join('')}</div>`;
  const tile = (label: string, value: string, sub = '', cls = '') => `<div class="st-tile ${cls}"><span class="st-l">${label}</span><b>${value}</b>${sub ? `<span class="st-s">${sub}</span>` : ''}</div>`;
  const ph = Math.floor(ex.playTime / 3600), pm = Math.floor((ex.playTime % 3600) / 60);

  const species = FISH.map((f) => {
    const got = game.discovered.includes(f.id);
    const rec = game.records[f.id];
    return `<div class="st-fish${got ? ' got' : ''}"><b>${got ? esc(f.name) : '???'}</b><span>${got && rec ? L(`рекорд ${kgs(rec)}`, `record ${kgs(rec)}`) : got ? L('піймано', 'caught') : L('ще не ловив', 'not caught yet')}</span></div>`;
  }).join('');

  const ups = UPGRADES.map((u) => {
    const lvl = game.upgrades[u.id] ?? 0;
    const dots = Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    return `<div class="st-up"><span>${esc(u.name)}</span><span class="st-dots">${dots}</span></div>`;
  }).join('');

  return `
    <div class="st-head">
      <div><h1>📒 ${L('Журнал капітана', `Captain's log`)}</h1>
      <p class="sub">${L(`День ${ex.day} · у грі ${ph} год ${pm} хв · ${game.stats.tripsOut} ${plural(game.stats.tripsOut, ['вихід', 'виходи', 'виходів'], ['trip', 'trips'])} у море · штормів пережито: ${game.stats.stormsSurvived}`, `Day ${ex.day} · played ${ph} h ${pm} min · ${game.stats.tripsOut} ${plural(game.stats.tripsOut, ['вихід', 'виходи', 'виходів'], ['trip', 'trips'])} out to sea · storms weathered: ${game.stats.stormsSurvived}`)}</p></div>
      <button class="btn" data-close>${L('Закрити', 'Close')} (Esc)</button>
    </div>
    <div class="st-grid">
      <section class="st-card st-wide">
        <h2>💰 ${L('Заробіток', 'Earnings')}</h2>
        <div class="st-tiles">
          ${tile(L('Зароблено всього', 'Total earned'), money(lg.totalEarned), '', 'good')}
          ${tile(L('Витрачено', 'Total spent'), money(lg.totalSpent), '', 'bad')}
          ${tile(L('Чистий прибуток', 'Net profit'), (net >= 0 ? '+' : '−') + money(Math.abs(net)), L(`у гаманці ${money(game.money)}`, `in your purse ${money(game.money)}`), net >= 0 ? 'good' : 'bad')}
          ${tile(L('Сьогодні', 'Today'), '+' + money(today.in), L(`витрати ${money(today.out)}`, `spent ${money(today.out)}`))}
          ${tile(L('Найкращий день', 'Best day'), best ? '+' + money(best.in) : '—', best ? L(`день ${best.d}`, `day ${best.d}`) : '')}
        </div>
        <div class="st-chart-wrap">
          <div class="st-legend"><span><i class="in"></i>${L('дохід', 'income')}</span><span><i class="out"></i>${L('витрати', 'spent')}</span><em>${L('останні 14 днів', 'last 14 days')}</em></div>
          ${chart}
        </div>
        <div class="st-two">
          <div><h3>${L('Звідки гроші', 'Where the money came from')}</h3>${bars(lg.earned, EARN_NAMES, 'in')}</div>
          <div><h3>${L('Куди пішли', 'Where it went')}</h3>${bars(lg.spent, SPEND_NAMES, 'out')}</div>
        </div>
      </section>
      <section class="st-card">
        <h2>🧭 ${L('Шлях', 'Voyages')}</h2>
        <div class="st-tiles">
          ${tile(L('Пройдено', 'Sailed'), km(lg.distM), nm(lg.distM))}
          ${tile(L('Час у морі', 'Time at sea'), hm(lg.seaSec))}
          ${tile(L('Найдалі від дому', 'Farthest from home'), km(lg.maxFar))}
          ${tile(L('Місця', 'Places'), `${ex.places.found}/${ex.places.total}`, L(`порти ${ex.ports.found}/${ex.ports.total}`, `ports ${ex.ports.found}/${ex.ports.total}`))}
        </div>
        ${trackSvg(game, ex.chart)}
      </section>
      <section class="st-card">
        <h2>🎣 ${L('Улов', 'Catch')}</h2>
        <div class="st-tiles">
          ${tile(L('Риб піймано', 'Fish caught'), String(game.stats.totalCaught), kgs(lg.kg))}
          ${tile(L('Трофеї', 'Trophies'), `🏆 ${lg.trophies}`)}
          ${tile(L('Замовлень виконано', 'Orders done'), String(game.trade.done))}
          ${tile(L('Знахідки', 'Finds'), `🎩 ${ex.hats.found}/${ex.hats.total}`, L(`скарбів і пляшок: ${ex.treasures}`, `treasure & bottles: ${ex.treasures}`))}
        </div>
        <h3>${L(`Колекція · ${game.discovered.length}/${FISH.length}`, `Collection · ${game.discovered.length}/${FISH.length}`)}</h3>
        <div class="st-fishes">${species}</div>
      </section>
      <section class="st-card st-wide">
        <h2>⛵ ${L('Яхта', 'Yacht')}</h2>
        <div class="st-ups">${ups}</div>
      </section>
    </div>`;
}
