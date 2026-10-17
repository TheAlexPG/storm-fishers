import type { RockObstacle } from '../world/boat';
import { PORT_POINTS } from '../world/port';

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
  private readonly scale = 1.45; // м/px → ~55 м радіус

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    this.canvas.width = this.size;
    this.canvas.height = this.size;
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
    c.clearRect(0, 0, s, s);

    // коло
    c.save();
    c.beginPath();
    c.arc(cx, cx, R - 1, 0, Math.PI * 2);
    c.clip();

    // вода
    const g = c.createRadialGradient(cx, cx, 10, cx, cx, R);
    if (night) {
      g.addColorStop(0, '#0a1c2c');
      g.addColorStop(1, '#05101c');
    } else {
      g.addColorStop(0, '#14425c');
      g.addColorStop(1, '#0c2c40');
    }
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);

    const toMap = (wx: number, wz: number): [number, number] => {
      // світ: +X право, +Z "вниз" на карті (південь). Човен у центрі.
      return [cx + (wx - boatX) * this.scale, cx + (wz - boatZ) * this.scale];
    };

    // кільця зон (400 м, 900 м)
    c.strokeStyle = 'rgba(120, 200, 210, 0.16)';
    c.lineWidth = 1;
    for (const r of [400, 900]) {
      c.beginPath();
      c.arc(cx, cx, r * this.scale, 0, Math.PI * 2);
      c.stroke();
    }

    // порт (прямокутники)
    const dock = toMap(0, -29);
    const land = toMap(0, -85);
    c.fillStyle = night ? 'rgba(90, 120, 100, 0.5)' : 'rgba(110, 150, 110, 0.6)';
    c.fillRect(land[0] - 60 * this.scale, land[1] - 45 * this.scale, 120 * this.scale, 90 * this.scale);
    c.fillStyle = night ? 'rgba(140, 110, 70, 0.7)' : 'rgba(160, 125, 80, 0.8)';
    c.fillRect(dock[0] - 24 * this.scale, dock[1] - 11 * this.scale, 48 * this.scale, 22 * this.scale);
    // точки сервісу
    c.fillStyle = '#ffb454';
    for (const p of PORT_POINTS) {
      const [px, pz] = toMap(p.x, p.z);
      c.beginPath();
      c.arc(px, pz, 2.4, 0, Math.PI * 2);
      c.fill();
    }

    // скелі
    c.fillStyle = '#8a949c';
    for (const r of rocks) {
      if (r.kind) continue;
      const [px, pz] = toMap(r.x, r.z);
      c.beginPath();
      c.arc(px, pz, 2.2, 0, Math.PI * 2);
      c.fill();
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
    c.fillStyle = '#37c6b5';
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(4.5, 6);
    c.lineTo(0, 3);
    c.lineTo(-4.5, 6);
    c.closePath();
    c.fill();
    c.restore();

    // N (північ = −Z = вгору на карті)
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.font = 'bold 11px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('N', cx, 12);

    c.restore();
    // рамка
    c.strokeStyle = 'rgba(120, 200, 210, 0.35)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cx, R - 1, 0, Math.PI * 2);
    c.stroke();
  }
}
