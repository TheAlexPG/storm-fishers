import { PORT_POINTS } from '../world/port';
import { terrainHeight } from '../world/portTerrain';
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
const H0 = -560;
const H1 = 780;

// палітра «паперової лоції»
const INK = '#2a3a46';
const INK_SOFT = 'rgba(42,58,70,0.55)';
const FONT = 'Manrope, -apple-system, "Segoe UI", sans-serif';
const FONT_D = 'Unbounded, Manrope, -apple-system, sans-serif';
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
        <span class="map-title">Лоція · Північне море</span>
        <span class="map-hint">ЛКМ — поставити точку · ПКМ — прибрати · <kbd>M</kbd> закрити</span>
        <button class="map-close">✕</button>
      </div>
      <canvas></canvas>
      <div class="map-legend">
        <span><i class="lg lg-boat"></i>яхта</span>
        <span><i class="lg lg-rock"></i>скелі</span>
        <span><i class="lg lg-ring"></i>зони: берег до 400 м, середина до 900 м</span>
        <span>🐟 стая (за радіозвітом)</span>
        <span><i class="lg lg-wp"></i>твоя точка</span>
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

  /** кооп: друзі (світові координати) */
  friends: Array<{ x: number; z: number; nick: string; color: string; onBoat: boolean; fishing: boolean }> = [];

  show(boatX: number, boatZ: number, heading: number, rocks: RockObstacle[], game: GameState) {
    this.el.classList.add('open');
    this.resize();
    this.render(boatX, boatZ, heading, rocks, game);
  }

  /** перемалювати відкриту мапу (друзі рухаються) без зміни розміру */
  refresh(boatX: number, boatZ: number, heading: number, rocks: RockObstacle[], game: GameState) {
    if (this.isOpen) this.render(boatX, boatZ, heading, rocks, game);
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

    // ── вода й суша: підкладка з рельєфу (кешується під розмір) ──
    c.drawImage(this.baseLayer(w, h, s, ox, oy), 0, 0, w, h);

    // сітка 100 м — ледь помітна
    c.strokeStyle = 'rgba(42,58,70,0.06)';
    c.lineWidth = 1;
    for (let gx = Math.ceil(W0 / 100) * 100; gx <= W1; gx += 100) {
      c.beginPath(); c.moveTo(mx(gx), oy); c.lineTo(mx(gx), oy + HH * s); c.stroke();
    }
    for (let gz = Math.ceil(H0 / 100) * 100; gz <= H1; gz += 100) {
      c.beginPath(); c.moveTo(ox, my(gz)); c.lineTo(ox + WW * s, my(gz)); c.stroke();
    }

    // ── зони (кільця від порту: берег <400, середина <900) ──
    for (const r of [900, 400]) {
      c.beginPath();
      c.arc(mx(0), my(0), r * s, 0, Math.PI * 2);
      c.setLineDash([2, 7]);
      c.strokeStyle = 'rgba(42,58,70,0.35)';
      c.lineWidth = 1.5;
      c.stroke();
      c.setLineDash([]);
    }
    c.font = `600 11px ${FONT_D}`;
    c.fillStyle = INK_SOFT;
    c.textAlign = 'center';
    const spaced = (t: string) => t.toUpperCase().split('').join('\u2009');
    c.fillText(spaced('узбережжя'), mx(250), my(140));
    c.fillText(spaced('середина'), mx(0) + 650 * s, my(0) + 120 * s);
    c.fillText(spaced('відкрите море'), mx(0), my(0) + 1000 * s > h - 20 ? h - 24 : my(0) + 1000 * s);

    // ── порт ──
    c.font = `700 13px ${FONT_D}`;
    c.fillStyle = INK;
    c.fillText('Порт «Шторм»', mx(0), my(-150));
    // точки порту
    for (const pt of PORT_POINTS) {
      c.beginPath();
      c.arc(mx(pt.x), my(pt.z), 3, 0, Math.PI * 2);
      c.fillStyle = INK;
      c.fill();
    }
    // маяк
    {
      const px = mx(-32);
      const pz = my(-52);
      c.beginPath();
      c.moveTo(px, pz - 8);
      c.lineTo(px + 5, pz + 5);
      c.lineTo(px - 5, pz + 5);
      c.closePath();
      c.fillStyle = '#e2674a';
      c.fill();
    }

    // ── скелі: «зірочки» як на лоції ──
    for (const r of rocks) {
      if (r.kind) continue;
      const px = mx(r.x);
      const pz = my(r.z);
      c.beginPath();
      c.arc(px, pz, Math.max(6, r.r * s * 1.6), 0, Math.PI * 2);
      c.fillStyle = 'rgba(42,58,70,0.08)';
      c.fill();
      c.strokeStyle = INK;
      c.lineWidth = 1.5;
      c.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 4;
        c.moveTo(px - Math.cos(a) * 4, pz - Math.sin(a) * 4);
        c.lineTo(px + Math.cos(a) * 4, pz + Math.sin(a) * 4);
      }
      c.stroke();
    }

    // ── сті (радіо-звіти) ──
    for (const r of game.reports) {
      const [ax, az] = SCHOOL_ANCHORS[r.zone];
      const px = mx(ax);
      const pz = my(az);
      c.beginPath();
      c.arc(px, pz, 22, 0, Math.PI * 2);
      c.fillStyle = 'rgba(36,135,140,0.12)';
      c.fill();
      c.setLineDash([3, 4]);
      c.strokeStyle = 'rgba(36,135,140,0.6)';
      c.lineWidth = 1.5;
      c.stroke();
      c.setLineDash([]);
      c.font = '16px -apple-system, "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.fillText('🐟', px, pz + 6);
      c.font = `800 11.5px ${FONT}`;
      c.fillStyle = '#1d6f73';
      c.fillText(`${game.speciesName(r.speciesId)} ×${r.boost.toFixed(1)}`, px, pz + 38);
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
      c.strokeStyle = 'rgba(36,135,140,0.85)';
      c.lineWidth = 1.5;
      c.stroke();
      c.setLineDash([]);
      // прапор
      c.beginPath();
      c.moveTo(wx, wz);
      c.lineTo(wx, wz - 14);
      c.strokeStyle = '#24878c';
      c.lineWidth = 2;
      c.stroke();
      c.beginPath();
      c.moveTo(wx, wz - 14);
      c.lineTo(wx + 11, wz - 10);
      c.lineTo(wx, wz - 6);
      c.closePath();
      c.fillStyle = '#24878c';
      c.fill();
      // підпис: азимут + відстань
      const d = Math.hypot(wp.x - boatX, wp.z - boatZ);
      const brg = this.bearing(boatX, boatZ, wp.x, wp.z);
      c.font = `800 12px ${FONT}`;
      c.fillStyle = '#1d6f73';
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
      c.fillStyle = '#e2674a';
      c.fill();
      c.strokeStyle = '#fffaf0';
      c.lineWidth = 2;
      c.stroke();
      c.restore();
      // промінь курсу
      c.beginPath();
      c.moveTo(bx, bz);
      const hx = Math.sin(heading);
      const hz = Math.cos(heading);
      c.lineTo(bx + hx * 40, bz + hz * 40);
      c.strokeStyle = 'rgba(226,103,74,0.6)';
      c.lineWidth = 1.5;
      c.stroke();
    }

    // ── друзі (кооп) ──
    {
      const aboard: string[] = [];
      c.font = `800 12px ${FONT}`;
      c.textAlign = 'left';
      for (const f of this.friends) {
        if (f.onBoat) {
          aboard.push(f.nick);
          continue;
        }
        const px = mx(f.x);
        const pz = my(f.z);
        c.beginPath();
        c.arc(px, pz, 6, 0, Math.PI * 2);
        c.fillStyle = f.color;
        c.fill();
        c.strokeStyle = '#fffaf0';
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = 'rgba(255,250,240,0.9)';
        const tw = c.measureText(f.nick).width;
        c.beginPath();
        c.roundRect(px + 9, pz - 9, tw + 12, 18, 9);
        c.fill();
        c.fillStyle = INK;
        c.fillText(f.nick, px + 15, pz + 4);
      }
      if (aboard.length) {
        const txt = `на борту: ${aboard.join(', ')}`;
        c.font = `700 12px ${FONT}`;
        c.textAlign = 'center';
        const tw = c.measureText(txt).width;
        const bx = mx(boatX);
        const by = my(boatZ) + 24;
        c.fillStyle = 'rgba(255,250,240,0.9)';
        c.beginPath();
        c.roundRect(bx - tw / 2 - 8, by - 12, tw + 16, 18, 9);
        c.fill();
        c.fillStyle = INK;
        c.fillText(txt, bx, by + 1);
      }
    }

    // ── компасна роза (лоція) ──
    {
      const cx = w - 70;
      const cy = 80;
      c.strokeStyle = INK;
      c.fillStyle = INK;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(cx, cy, 40, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.arc(cx, cy, 34, 0, Math.PI * 2);
      c.strokeStyle = INK_SOFT;
      c.stroke();
      // зірка: 4 довгі промені + 4 короткі
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const L = k % 2 === 0 ? 34 : 18;
        const wdt = k % 2 === 0 ? 6 : 4;
        const tx = cx + Math.sin(a) * L, ty = cy - Math.cos(a) * L;
        const lx = cx + Math.sin(a - Math.PI / 2) * wdt, ly = cy - Math.cos(a - Math.PI / 2) * wdt;
        const rx = cx + Math.sin(a + Math.PI / 2) * wdt, ry = cy - Math.cos(a + Math.PI / 2) * wdt;
        c.beginPath();
        c.moveTo(tx, ty);
        c.lineTo(lx, ly);
        c.lineTo(cx, cy);
        c.closePath();
        c.fillStyle = k === 0 ? '#e2674a' : INK;
        c.fill();
        c.beginPath();
        c.moveTo(tx, ty);
        c.lineTo(rx, ry);
        c.lineTo(cx, cy);
        c.closePath();
        c.fillStyle = k === 0 ? '#f2a18a' : '#fbf6ec';
        c.fill();
        c.strokeStyle = INK;
        c.stroke();
      }
      c.font = `700 12px ${FONT_D}`;
      c.fillStyle = '#e2674a';
      c.textAlign = 'center';
      c.fillText('П', cx, cy - 46);
    }

    // ── масштабна лінійка ──
    {
      const barPx = 200 * s; // 200 м
      const bx = 28;
      const by = h - 26;
      c.strokeStyle = INK;
      c.lineWidth = 1;
      c.strokeRect(bx, by - 4, barPx, 6);
      c.fillStyle = INK;
      c.fillRect(bx, by - 4, barPx / 2, 6);
      c.font = `700 11px ${FONT}`;
      c.textAlign = 'left';
      c.fillText('0', bx - 3, by - 10);
      c.textAlign = 'right';
      c.fillText('200 м', bx + barPx + 6, by - 10);
    }
  }

  private base: HTMLCanvasElement | null = null;
  private baseKey = '';

  /** вода (тони за зонами + ізобати біля берега) і суша (рельєф) — малюється раз на розмір */
  private baseLayer(w: number, h: number, s: number, ox: number, oy: number): HTMLCanvasElement {
    const key = `${w}x${h}`;
    if (this.base && this.baseKey === key) return this.base;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = this.base ?? document.createElement('canvas');
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d')!;
    const img = g.createImageData(cv.width, cv.height);
    const d = img.data;
    const step = 2; // пікселі (dpr), далі — блоками
    const hex = (v: number): [number, number, number] => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    const PAPER = hex(0xefe6d4);
    const SEA_N = hex(0xc9e1dc), SEA_M = hex(0xb4d4d2), SEA_F = hex(0x9fc5c8);
    const SAND = hex(0xe6d3a8), GRASS = hex(0xa9c08a), GRASS2 = hex(0x8fae72), HILL = hex(0xb5ab8a), ROCK = hex(0xc9c2b2);
    const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const hs: number[] = [];
    const cols = Math.ceil(cv.width / step), rows = Math.ceil(cv.height / step);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const px = (i * step) / dpr, py = (j * step) / dpr;
        const wx = (px - ox) / s + W0, wz = (py - oy) / s + H0;
        let col: number[];
        let ht = -99;
        if (wx < W0 || wx > W1 || wz < H0 || wz > H1) col = PAPER;
        else {
          ht = terrainHeight(wx, wz);
          if (ht > 0.05) {
            col = ht < 2.2 ? SAND : ht < 14 ? mix(GRASS, GRASS2, (ht - 2.2) / 12) : ht < 45 ? mix(GRASS2, HILL, (ht - 14) / 31) : mix(HILL, ROCK, Math.min(1, (ht - 45) / 30));
            // горизонталі кожні 10 м
            if (ht > 3 && ht % 10 < 0.9) col = mix(col, [42, 58, 70], 0.18);
          } else {
            const r = Math.hypot(wx, wz);
            col = r < 400 ? SEA_N : r < 900 ? SEA_M : SEA_F;
            // мілина біля берега світліша
            if (ht > -6 && ht > -90) col = mix(col, [222, 236, 230], Math.max(0, Math.min(1, (ht + 6) / 6)) * 0.6);
          }
        }
        hs.push(ht);
        for (let y = 0; y < step; y++) {
          const yy = j * step + y;
          if (yy >= cv.height) break;
          for (let x = 0; x < step; x++) {
            const xx = i * step + x;
            if (xx >= cv.width) break;
            const o = (yy * cv.width + xx) * 4;
            d[o] = col[0];
            d[o + 1] = col[1];
            d[o + 2] = col[2];
            d[o + 3] = 255;
          }
        }
      }
    }
    g.putImageData(img, 0, 0);
    // берегова лінія — чорнилом (зміна знаку висоти між сусідами)
    g.fillStyle = 'rgba(42,58,70,0.85)';
    for (let j = 1; j < rows; j++) {
      for (let i = 1; i < cols; i++) {
        const a = hs[j * cols + i];
        if (a === -99) continue;
        const l = hs[j * cols + i - 1], u = hs[(j - 1) * cols + i];
        if ((a > 0.05) !== (l > 0.05) || (a > 0.05) !== (u > 0.05)) g.fillRect(i * step, j * step, step * 0.9, step * 0.9);
      }
    }
    this.base = cv;
    this.baseKey = key;
    return cv;
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
    if (wx >= -24 && wx <= 24 && wz >= -40 && wz <= -18) return true; // причал
    return terrainHeight(wx, wz) > 0;
  }
}
