import * as THREE from 'three';
import { GROUND_Y } from './portTerrain';
import { FISH } from '../game/fish';
import { priceSeries } from '../ui/exchange';
import type { GameState } from '../game/state';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Табло біржі під навісом «РИБНА БІРЖА»: крейдяна дошка в дерев'яній рамі
// з цінами за рибину й стрілками за добу. Видно з набережної — ще до того,
// як підійдеш і відкриєш біржу.
// ─────────────────────────────────────────────────────────────

const W = 1024;
const H = 512;

export class ExchangeBoard {
  readonly group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private key = '';
  private t = 0;

  constructor(scene: THREE.Scene, x = 35.8, z = -50.3) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const bw = 3.2, bh = 1.6;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(bw, bh),
      new THREE.MeshStandardMaterial({ map: this.tex, emissiveMap: this.tex, emissive: 0xffffff, emissiveIntensity: 0.18, roughness: 0.95 }),
    );
    face.position.z = 0.04;
    const wood = new THREE.MeshStandardMaterial({ color: 0x6e4a2e, roughness: 0.8 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.16, bh + 0.16, 0.07), wood);
    frame.castShadow = true;
    // ніжки до землі
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.6, 0.09), wood);
      leg.position.set(sx * (bw / 2 - 0.1), -1.35, -0.02);
      this.group.add(leg);
    }
    // поличка для крейди
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.05, 0.12), wood);
    ledge.position.set(0, -bh / 2 - 0.06, 0.07);
    this.group.add(frame, face, ledge);
    this.group.position.set(x, GROUND_Y + 2.5, z);
    scene.add(this.group);
  }

  /** раз на кілька секунд перемальовуємо, якщо ціни змінилися */
  update(dt: number, game: GameState) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 4;
    const rows = FISH.map((sp) => {
      const known = game.discovered.includes(sp.id);
      const s = priceSeries(game, sp.id, game.market);
      const now = s[s.length - 1];
      const back = s[Math.max(0, s.length - 9)];
      const tr = back > 0 ? now / back - 1 : 0;
      return { name: known ? sp.name : '· · ·', price: known ? Math.round(now) : null, tr, ev: game.market.eventFor(sp.id) };
    });
    const key = JSON.stringify(rows.map((r) => [r.name, r.price, Math.round(r.tr * 100), r.ev?.mult]));
    if (key === this.key) return;
    this.key = key;
    this.draw(rows);
  }

  private draw(rows: Array<{ name: string; price: number | null; tr: number; ev?: { mult: number } }>) {
    const c = this.canvas.getContext('2d')!;
    // крейдяна дошка: темно-зелена з плямами
    c.fillStyle = '#23372f';
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) {
      c.fillStyle = `rgba(255,255,255,${(0.012 + Math.random() * 0.02).toFixed(3)})`;
      c.beginPath();
      c.arc(Math.random() * W, Math.random() * H, 20 + Math.random() * 70, 0, Math.PI * 2);
      c.fill();
    }
    c.textBaseline = 'middle';
    c.fillStyle = '#f4ead2';
    c.font = 'bold 44px Georgia, "Times New Roman", serif';
    c.textAlign = 'center';
    c.fillText(L('ЦІНИ ДНЯ', `TODAY'S PRICES`), W / 2, 44);
    c.font = 'italic 22px Georgia, serif';
    c.fillStyle = 'rgba(244,234,210,0.7)';
    c.fillText(L('₴ за рибину · за добу', `₴ per fish · 24 h`), W / 2, 82);
    c.strokeStyle = 'rgba(244,234,210,0.4)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(60, 104); c.lineTo(W - 60, 104); c.stroke();
    c.beginPath(); c.moveTo(W / 2, 118); c.lineTo(W / 2, H - 22); c.stroke();
    const per = Math.ceil(rows.length / 2);
    const rh = (H - 140) / per;
    rows.forEach((r, i) => {
      const col = Math.floor(i / per);
      const y = 136 + (i % per) * rh + rh / 2 - 8;
      const x0 = col ? W / 2 + 34 : 40;
      const x1 = col ? W - 40 : W / 2 - 34;
      c.textAlign = 'left';
      c.font = '30px Georgia, serif';
      c.fillStyle = r.price == null ? 'rgba(244,234,210,0.35)' : '#f4ead2';
      c.fillText(r.name, x0, y);
      if (r.price == null) return;
      c.textAlign = 'right';
      const up = r.tr > 0.03, down = r.tr < -0.03;
      c.font = 'bold 26px Georgia, serif';
      c.fillStyle = up ? '#8be0c6' : down ? '#ff9f8a' : 'rgba(244,234,210,0.6)';
      c.fillText(up ? `▲${Math.round(r.tr * 100)}%` : down ? `▼${Math.round(-r.tr * 100)}%` : '—', x1, y);
      c.font = 'bold 32px Georgia, serif';
      c.fillStyle = r.ev ? (r.ev.mult > 1 ? '#ffd28a' : '#ff9f8a') : '#f4ead2';
      c.fillText(String(r.price), x1 - 96, y);
    });
    this.tex.needsUpdate = true;
  }
}
