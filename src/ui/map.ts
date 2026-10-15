import { PORT_POINTS } from '../world/port';
import type { RockObstacle } from '../world/boat';
import type { GameState } from '../game/state';
import type { ZoneId } from '../core/types';

// ─────────────────────────────────────────────────────────────
// Карта (M): повноекранна штурвальна схема акваторії.
// Фіксований світ: x -950..950, z -520..780. Північ (-Z) — вгору.
// Клік — waypoint; ПКМ — прибрати waypoint.
// ─────────────────────────────────────────────────────────────

const W0 = -950;
const W1 = 950;
const H0 = -520;
const H1 = 780;
const WW = W1 - W0;
const HH = H1 - H0;

// якорі стай для радіо-звітів (за зонами)
const SCHOOL_ANCHORS: Record<ZoneId, [number, number]> = {
  shore: [80, 40],
  mid: [-150, 300],
  open: [300, 650],
};

export class MapView {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** колбек: ліва клік → точка у світових координатах */
  onWaypoint: ((x: number, z: number) => void) | null = null;
  /** колбек: права клік → прибрати точку */
  onClear: (() => void) | null = null;
  /** колбек: кнопка ✕ / M → закрити карту */
  onClose: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'mapview';
    this.el.innerHTML = `
      <div class="map-head">
        <span class="map-title">🗺️ Карта · Північне море</span>
        <span class="map-hint">ЛКМ — поставити точку · ПКМ — прибрати · <kbd>M</kbd> закрити</span>
        <button class="map-close">✕</button>
      </div>
      <canvas></canvas>
      <div class="map-legend">
        <span><i class="lg-water"></i>вода</span>
        <span><i class="lg-land"></i>суша / причал</span>
        <span><i class="lg-ring"></i>зони: берег &lt;400 м, середина &lt;900 м</span>
        <span><i class="lg-rock"></i>скелі</span>
        <span>🐟 стая (за звітом)</span>
        <span><i class="lg-wp"></i>твоя точка</span>
      </div>
    `;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;

    this.canvas.addEventListener('click', (e) => {
      const [wx, wz] = this.toWorld(e.offsetX, e.offsetY);
      if (wx == null || wz == null) return;
      if (this.isOnLand(wx, wz)) return; // у воду — можна, на сушу — ні
      this.onWaypoint?.(wx, wz);
    });
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onClear?.();
    });
    this.el.querySelector('.map-close')!.addEventListener('click', () => {
      this.onClose?.();
    });
  }

  get isOpen() {
    return this.el.classList.contains('open');
  }

  show(boatX: number, boatZ: number, heading: number, rocks: RockObstacle[], game: GameState) {
    this.el.classList.add('open');
    this.resize();
    this.render(boatX, boatZ, heading, rocks, game);
  }

  hide() {
    this.el.classList.remove('open');
  }

  private resize() {
    // canvas у flex-колонці: фактичний розмір = екран мінус шапка/легенда
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  private render(boatX: number, boatZ: number, heading: number, rocks: RockObstacle[], game: GameState) {
    const c = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    // масштаб і зсув: вмістити весь світ
    const s = Math.min(w / WW, h / HH);
    const ox = (w - WW * s) / 2;
    const oy = (h - HH * s) / 2;
    const mx = (wx: number) => ox + (wx - W0) * s;
    const my = (wz: number) => oy + (wz - H0) * s; // +Z вниз = південь

    // ── вода ──
    const sea = c.createLinearGradient(0, 0, 0, h);
    sea.addColorStop(0, '#0e3346');
    sea.addColorStop(1, '#123f56');
    c.fillStyle = sea;
    c.fillRect(0, 0, w, h);

    // сітка 100 м
    c.strokeStyle = 'rgba(255,255,255,0.05)';
    c.lineWidth = 1;
    for (let gx = Math.ceil(W0 / 100) * 100; gx <= W1; gx += 100) {
      c.beginPath(); c.moveTo(mx(gx), oy); c.lineTo(mx(gx), oy + HH * s); c.stroke();
    }
    for (let gz = Math.ceil(H0 / 100) * 100; gz <= H1; gz += 100) {
      c.beginPath(); c.moveTo(ox, my(gz)); c.lineTo(ox + WW * s, my(gz)); c.stroke();
    }

    // ── зони (кільця від початку координат: берег <400, середина <900) ──
    const rings: Array<[number, string]> = [
      [900, 'rgba(255,255,255,0.16)'],
      [400, 'rgba(255,255,255,0.22)'],
    ];
    for (const [r, color] of rings) {
      c.beginPath();
      c.arc(mx(0), my(0), r * s, 0, Math.PI * 2);
      c.setLineDash([8, 8]);
      c.strokeStyle = color;
      c.lineWidth = 1.5;
      c.stroke();
      c.setLineDash([]);
    }
    c.font = '600 12px -apple-system, "Segoe UI", sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.textAlign = 'center';
    c.fillText('узбережжя', mx(0), my(0) + 200 * s);
    c.fillText('середина', mx(0) + 650 * s, my(0));
    c.textAlign = 'left';
    c.fillText('відкрите море', 40, 44);

    // ── суша + причал ──
    c.fillStyle = '#4a5d3f';
    c.fillRect(mx(-60), my(-130), 120 * s, 90 * s);
    c.fillStyle = '#6a6f76';
    c.fillRect(mx(-24), my(-40), 48 * s, 22 * s);
    c.font = '700 13px -apple-system, "Segoe UI", sans-serif';
    c.fillStyle = '#e8f4f6';
    c.textAlign = 'center';
    c.fillText('ПОРТ «ШТОРМ»', mx(0), my(-85));
    c.font = '600 11px -apple-system, "Segoe UI", sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fillText('причал', mx(0), my(-29));

    // точки порту (лише крапки: у масштабі карти підписи перекриваються)
    for (const pt of PORT_POINTS) {
      c.beginPath();
      c.arc(mx(pt.x), my(pt.z), 4.5, 0, Math.PI * 2);
      c.fillStyle = '#ffd980';
      c.fill();
    }

    // маяк
    {
      const px = mx(-32);
      const pz = my(-52);
      c.beginPath();
      c.moveTo(px, pz - 8);
      c.lineTo(px + 6, pz + 6);
      c.lineTo(px - 6, pz + 6);
      c.closePath();
      c.fillStyle = '#ff6b5e';
      c.fill();
      c.font = '600 11px -apple-system, "Segoe UI", sans-serif';
      c.fillStyle = '#e8f4f6';
      c.textAlign = 'center';
      c.fillText('маяк', px, pz + 18);
    }

    // ── скелі ──
    for (const r of rocks) {
      if (r.kind) continue;
      const px = mx(r.x);
      const pz = my(r.z);
      c.beginPath();
      c.arc(px, pz, Math.max(4, r.r * s), 0, Math.PI * 2);
      c.fillStyle = '#6a7076';
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.lineWidth = 1;
      c.stroke();
    }

    // ── сті (радіо-звіти) ──
    for (const r of game.reports) {
      const [ax, az] = SCHOOL_ANCHORS[r.zone];
      const px = mx(ax);
      const pz = my(az);
      c.font = '18px -apple-system, "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.fillText('🐟', px, pz + 6);
      c.font = '600 11px -apple-system, "Segoe UI", sans-serif';
      c.fillStyle = '#bfe8ff';
      c.fillText(`${game.speciesName(r.speciesId)} ×${r.boost.toFixed(1)}`, px, pz + 22);
    }

    // ── waypoint + лінія від човна ──
    const wp = game.waypoint;
    if (wp) {
      const bx = mx(boatX);
      const bz = my(boatZ);
      const wx = mx(wp.x);
      const wz = my(wp.z);
      c.beginPath();
      c.moveTo(bx, bz);
      c.lineTo(wx, wz);
      c.setLineDash([6, 6]);
      c.strokeStyle = 'rgba(120, 220, 255, 0.8)';
      c.lineWidth = 1.5;
      c.stroke();
      c.setLineDash([]);
      // прапор
      c.beginPath();
      c.moveTo(wx, wz);
      c.lineTo(wx, wz - 14);
      c.strokeStyle = '#78dcff';
      c.lineWidth = 2;
      c.stroke();
      c.beginPath();
      c.moveTo(wx, wz - 14);
      c.lineTo(wx + 11, wz - 10);
      c.lineTo(wx, wz - 6);
      c.closePath();
      c.fillStyle = '#78dcff';
      c.fill();
      // підпис: азимут + відстань
      const d = Math.hypot(wp.x - boatX, wp.z - boatZ);
      const brg = this.bearing(boatX, boatZ, wp.x, wp.z);
      c.font = '700 12px -apple-system, "Segoe UI", sans-serif';
      c.fillStyle = '#78dcff';
      c.textAlign = 'center';
      c.fillText(`${Math.round(brg).toString().padStart(3, '0')}° · ${this.fmtDist(d)}`, wx, wz + 16);
    }

    // ── човен (трикутник за курсом) ──
    {
      const bx = mx(boatX);
      const bz = my(boatZ);
      // курс: +Z човна = нос; на карті +Z вниз
      c.save();
      c.translate(bx, bz);
      c.rotate(-heading + Math.PI); // heading: 0 = нос у світ +X
      c.beginPath();
      c.moveTo(0, -9);
      c.lineTo(6, 7);
      c.lineTo(-6, 7);
      c.closePath();
      c.fillStyle = '#ffffff';
      c.fill();
      c.strokeStyle = '#d0342c';
      c.lineWidth = 2;
      c.stroke();
      c.restore();
      // промінь курсу
      c.beginPath();
      c.moveTo(bx, bz);
      const hx = Math.sin(heading);
      const hz = Math.cos(heading);
      c.lineTo(bx + hx * 40, bz + hz * 40);
      c.strokeStyle = 'rgba(255,255,255,0.5)';
      c.lineWidth = 1;
      c.stroke();
    }

    // ── компасна роза ──
    {
      const cx = w - 60;
      const cy = 70;
      c.beginPath();
      c.arc(cx, cy, 34, 0, Math.PI * 2);
      c.fillStyle = 'rgba(10, 20, 30, 0.65)';
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.3)';
      c.lineWidth = 1;
      c.stroke();
      for (let d = 0; d < 360; d += 45) {
        const a = (d * Math.PI) / 180;
        c.beginPath();
        c.moveTo(cx + Math.sin(a) * 28, cy - Math.cos(a) * 28);
        c.lineTo(cx + Math.sin(a) * 34, cy - Math.cos(a) * 34);
        c.strokeStyle = 'rgba(255,255,255,0.5)';
        c.lineWidth = 1.5;
        c.stroke();
      }
      c.font = '700 13px -apple-system, "Segoe UI", sans-serif';
      c.fillStyle = '#ff6b5e';
      c.textAlign = 'center';
      c.fillText('П', cx, cy - 18);
      c.fillStyle = '#cfe8ea';
      c.font = '600 11px -apple-system, "Segoe UI", sans-serif';
      c.fillText('Сх', cx + 22, cy + 4);
      c.fillText('Пд', cx, cy + 26);
      c.fillText('Зх', cx - 22, cy + 4);
    }

    // ── масштабна лінійка ──
    {
      const barPx = 200 * s; // 200 м
      const bx = 24;
      const by = h - 30;
      c.fillStyle = 'rgba(10, 20, 30, 0.65)';
      c.fillRect(bx - 8, by - 22, barPx + 16, 34);
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(bx + barPx, by);
      c.strokeStyle = '#e8f4f6';
      c.lineWidth = 2;
      c.stroke();
      for (const f of [0, 0.5, 1]) {
        c.beginPath();
        c.moveTo(bx + barPx * f, by - 4);
        c.lineTo(bx + barPx * f, by + 4);
        c.stroke();
      }
      c.font = '600 11px -apple-system, "Segoe UI", sans-serif';
      c.fillStyle = '#e8f4f6';
      c.textAlign = 'left';
      c.fillText('200 м', bx + barPx / 2 - 14, by - 8);
    }
  }

  /** азимут у градусах (0 = північ/-Z, за годинниковою) */
  bearing(fx: number, fz: number, tx: number, tz: number): number {
    const dx = tx - fx;
    const dz = tz - fz;
    let b = (Math.atan2(dx, -dz) * 180) / Math.PI;
    if (b < 0) b += 360;
    return b;
  }

  fmtDist(d: number): string {
    return d >= 1000 ? (d / 1000).toFixed(1).replace('.', ',') + ' км' : Math.round(d) + ' м';
  }

  /** координати кліку → світ; null, якщо поза межами карти */
  toWorld(px: number, py: number): [number | null, number | null] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const s = Math.min(w / WW, h / HH);
    const ox = (w - WW * s) / 2;
    const oy = (h - HH * s) / 2;
    const wx = (px - ox) / s + W0;
    const wz = (py - oy) / s + H0;
    if (wx < W0 || wx > W1 || wz < H0 || wz > H1) return [null, null];
    return [wx, wz];
  }

  /** чи точка на суші/причалі (there waypoint ставити не можна) */
  isOnLand(wx: number, wz: number): boolean {
    if (wx >= -60 && wx <= 60 && wz >= -130 && wz <= -40) return true; // земля
    if (wx >= -24 && wx <= 24 && wz >= -40 && wz <= -18) return true; // причал
    return false;
  }
}
