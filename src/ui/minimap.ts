import type { RockObstacle } from '../world/boat';
import { PORT_POINTS } from '../world/port';
import { terrainHeight } from '../world/portTerrain';

// підкладка суші (лоція): x −520..520, z −780..80, 2 м на піксель
const LX0 = -520, LZ0 = -780, LM = 2, LW = 520, LH = 430;

// ─────────────────────────────────────────────────────────────
// Мінімапа-радар: кругла, 160px, центр = човен.
// ─────────────────────────────────────────────────────────────

export class Minimap {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  visible = true;
  private readonly size = 160;
  /** кооп: друзі (світові координати) */
  friends: Array<{ x: number; z: number; color: string; onBoat: boolean }> = [];
  private readonly scale = 0.42; // px/м → радіус ~190 м
  private land: HTMLCanvasElement | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.size * dpr;
    this.canvas.height = this.size * dpr;
    this.canvas.style.width = this.size + 'px';
    this.canvas.style.height = this.size + 'px';
    // у правий верхній блок HUD (над трюмом); без нього canvas падав під
    // повноекранний рендер і мінімапи не було видно взагалі
    const slot = document.querySelector('#hud .hud-tr');
    if (slot) slot.prepend(this.canvas);
    else document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  setMuted(m: boolean) {
    this.canvas.style.opacity = m ? '0.25' : '1';
  }

  update(boatX: number, boatZ: number, heading: number, rocks: RockObstacle[], night: boolean) {
    if (!this.visible) {
      if (this.canvas.style.display !== 'none') this.canvas.style.display = 'none';
      return;
    }
    if (this.canvas.style.display === 'none') this.canvas.style.display = '';
    const c = this.ctx;
    const s = this.size;
    const cx = s / 2;
    const R = s / 2;
    const dpr = this.canvas.width / s;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, s, s);

    // коло
    c.save();
    c.beginPath();
    c.arc(cx, cx, R - 1, 0, Math.PI * 2);
    c.clip();

    // вода (тон лоції)
    c.fillStyle = '#b8d7d5';
    c.fillRect(0, 0, s, s);

    const toMap = (wx: number, wz: number): [number, number] => {
      // світ: +X право, +Z "вниз" на карті (південь). Човен у центрі.
      return [cx + (wx - boatX) * this.scale, cx + (wz - boatZ) * this.scale];
    };

    // суша з рельєфу
    const [lx, lz] = toMap(LX0, LZ0);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.landLayer(), lx, lz, LW * LM * this.scale, LH * LM * this.scale);

    // кільця зон (400 м, 900 м)
    c.strokeStyle = 'rgba(42, 58, 70, 0.3)';
    c.setLineDash([2, 4]);
    c.lineWidth = 1;
    for (const r of [400, 900]) {
      const [zx, zz] = toMap(0, 0);
      c.beginPath();
      c.arc(zx, zz, r * this.scale, 0, Math.PI * 2);
      c.stroke();
    }
    c.setLineDash([]);

    // причал
    {
      const [px, pz] = toMap(-24, -40);
      c.fillStyle = '#b08a5a';
      c.fillRect(px, pz, 48 * this.scale, 22 * this.scale);
    }
    // точки сервісу
    c.fillStyle = '#2a3a46';
    for (const p of PORT_POINTS) {
      const [px, pz] = toMap(p.x, p.z);
      c.beginPath();
      c.arc(px, pz, 1.6, 0, Math.PI * 2);
      c.fill();
    }

    // скелі
    c.strokeStyle = '#2a3a46';
    c.lineWidth = 1.2;
    for (const r of rocks) {
      if (r.kind) continue;
      const [px, pz] = toMap(r.x, r.z);
      c.beginPath();
      c.moveTo(px - 3, pz); c.lineTo(px + 3, pz);
      c.moveTo(px, pz - 3); c.lineTo(px, pz + 3);
      c.stroke();
    }

    // друзі поза човном (на борту вони й так у центрі)
    for (const f of this.friends) {
      if (f.onBoat) continue;
      const [px, pz] = toMap(f.x, f.z);
      const dx = px - cx, dz = pz - cx;
      const d = Math.hypot(dx, dz);
      // за межею кола — притиснути до краю (видно напрямок)
      const k = d > R - 7 ? (R - 7) / d : 1;
      c.beginPath();
      c.arc(cx + dx * k, cx + dz * k, 3.6, 0, Math.PI * 2);
      c.fillStyle = f.color;
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 1.2;
      c.stroke();
    }

    // човен (стрілка в центрі, обертання по heading)
    c.save();
    c.translate(cx, cx);
    // heading 0 → нос на +Z (вниз на карті)
    c.rotate(-heading + Math.PI);
    c.fillStyle = '#e2674a';
    c.strokeStyle = '#fffaf0';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -8);
    c.lineTo(5, 6);
    c.lineTo(0, 3);
    c.lineTo(-5, 6);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();

    // ніч — карта в тіні
    if (night) {
      c.fillStyle = 'rgba(14, 22, 40, 0.45)';
      c.fillRect(0, 0, s, s);
    }

    // N (північ = −Z = вгору на карті)
    c.fillStyle = '#e2674a';
    c.font = '800 11px Manrope, system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('П', cx, 13);

    c.restore();
  }

  /** суша (раз): пісок → трава → пагорби, берег чорнилом */
  private landLayer(): HTMLCanvasElement {
    if (this.land) return this.land;
    const cv = document.createElement('canvas');
    cv.width = LW;
    cv.height = LH;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(LW, LH);
    const d = img.data;
    const hs = new Float32Array(LW * LH);
    for (let j = 0; j < LH; j++) for (let i = 0; i < LW; i++) hs[j * LW + i] = terrainHeight(LX0 + i * LM, LZ0 + j * LM);
    for (let j = 0; j < LH; j++) {
      for (let i = 0; i < LW; i++) {
        const h = hs[j * LW + i];
        const o = (j * LW + i) * 4;
        if (h <= 0.05) continue; // вода — прозора
        const coast = (i > 0 && hs[j * LW + i - 1] <= 0.05) || (j > 0 && hs[(j - 1) * LW + i] <= 0.05) || (i < LW - 1 && hs[j * LW + i + 1] <= 0.05) || (j < LH - 1 && hs[(j + 1) * LW + i] <= 0.05);
        const col = coast ? [42, 58, 70] : h < 2.2 ? [230, 211, 168] : h < 14 ? [169, 192, 138] : h < 45 ? [158, 174, 120] : [196, 188, 168];
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.land = cv;
    return cv;
  }
}
