import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Багатофункціональний дисплей на штурвальній тумбі: курс, швидкість,
// вітер (вимпельний кут), паруси/перевантаження, паливо й запас ходу,
// хвиля, зона. Живе в сцені (CanvasTexture), не в діалозі.
// ─────────────────────────────────────────────────────────────

export interface HelmData {
  headingDeg: number;
  knots: number;
  throttle: number;      // -1..1
  engineOn: boolean;
  rpm: number;
  fuel: number;
  fuelMax: number;
  rangeKm: number | null;
  awa: number;           // курсовий кут вимпельного вітру, °
  aws: number;           // м/с
  tws: number;           // м/с
  windFromStarboard: boolean;
  sailLabel: string;
  sailMode: number;
  overload: number;      // 0..1+
  luffing: boolean;
  wave: number;          // м
  zone: string;
  hull: number;
  hullMax: number;
  night: boolean;
}

const W = 512;
const H = 336;
const P8 = ['П', 'ПСх', 'Сх', 'ПдСх', 'Пд', 'ПдЗх', 'Зх', 'ПнЗх'];

export class HelmDisplay {
  readonly mesh: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private t = 0;

  constructor(width: number, height: number) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    // MeshBasic — екран світиться сам (видно й уночі)
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }),
    );
  }

  /** перемалювати не частіше ніж ~6 разів на секунду */
  update(dt: number, d: HelmData) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.16;
    this.draw(d);
    this.tex.needsUpdate = true;
  }

  private draw(d: HelmData) {
    const g = this.ctx;
    const dim = d.night ? 0.7 : 1;
    const fg = `rgba(232,244,246,${dim})`;
    const mute = `rgba(122,148,160,${dim})`;
    const accent = d.night ? '#c24a3a' : '#37c6b5';
    g.fillStyle = '#081016';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1d2a33';
    g.lineWidth = 2;
    g.strokeRect(4, 4, W - 8, H - 8);
    g.beginPath();
    g.moveTo(W / 2, 14); g.lineTo(W / 2, 232);
    g.moveTo(14, 232); g.lineTo(W - 14, 232);
    g.stroke();

    const label = (s: string, x: number, y: number, align: CanvasTextAlign = 'left') => {
      g.font = '600 17px -apple-system, "Segoe UI", sans-serif';
      g.fillStyle = mute;
      g.textAlign = align;
      g.fillText(s, x, y);
    };
    const big = (s: string, x: number, y: number, size = 46, color = fg, align: CanvasTextAlign = 'left') => {
      g.font = `700 ${size}px -apple-system, "Segoe UI", sans-serif`;
      g.fillStyle = color;
      g.textAlign = align;
      g.fillText(s, x, y);
    };

    // ── ліва половина: курс / швидкість / газ ──
    const deg = ((Math.round(d.headingDeg) % 360) + 360) % 360;
    label('КУРС', 20, 36);
    big(`${String(deg).padStart(3, '0')}°`, 20, 84);
    big(P8[Math.round(deg / 45) % 8], 162, 84, 26, mute);
    label('ШВИДКІСТЬ', 20, 124);
    big(d.knots.toFixed(1), 20, 170);
    label('вуз', 112, 170);
    // газ і двигун
    label(d.engineOn ? `ДВИГУН ${Math.round(d.rpm)} об/хв` : 'ДВИГУН ЗУПИНЕНО', 20, 204);
    if (!d.engineOn) {
      g.fillStyle = '#e74c3c';
      g.fillRect(20, 212, 220, 10);
    } else {
      g.fillStyle = '#1d2a33';
      g.fillRect(20, 212, 220, 10);
      g.fillStyle = d.throttle >= 0 ? accent : '#e0a040';
      const f = Math.min(1, Math.abs(d.throttle));
      g.fillRect(20, 212, 220 * f, 10);
    }

    // ── права половина: роза вітру ──
    const cx = W * 0.75 - 30;
    const cy = 122;
    const R = 78;
    g.strokeStyle = '#2a3a44';
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    // мертва зона (< 28° до вітру)
    g.strokeStyle = 'rgba(231,76,60,0.55)';
    g.lineWidth = 8;
    g.beginPath(); g.arc(cx, cy, R - 4, -Math.PI / 2 - 0.49, -Math.PI / 2 + 0.49); g.stroke();
    // силует яхти
    g.fillStyle = '#4a5b66';
    g.beginPath();
    g.moveTo(cx, cy - 36);
    g.quadraticCurveTo(cx + 18, cy - 4, cx + 13, cy + 30);
    g.lineTo(cx - 13, cy + 30);
    g.quadraticCurveTo(cx - 18, cy - 4, cx, cy - 36);
    g.fill();
    // стрілка вимпельного вітру (звідки дме → до центру)
    const a = ((d.windFromStarboard ? 1 : -1) * d.awa * Math.PI) / 180;
    const ax = cx + Math.sin(a) * (R - 4);
    const ay = cy - Math.cos(a) * (R - 4);
    const bx = cx + Math.sin(a) * 34;
    const by = cy - Math.cos(a) * 34;
    g.strokeStyle = d.luffing ? '#e74c3c' : '#ffd166';
    g.fillStyle = g.strokeStyle;
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    const hx = Math.sin(a), hy = -Math.cos(a);
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + hx * 16 + hy * 9, by + hy * 16 - hx * 9);
    g.lineTo(bx + hx * 16 - hy * 9, by + hy * 16 + hx * 9);
    g.fill();
    // цифри вітру
    const rx = W - 22;
    label('ВІТЕР', rx, 36, 'right');
    big(d.aws.toFixed(1), rx, 76, 34, fg, 'right');
    label('м/с вимп.', rx, 98, 'right');
    big(`${Math.round(d.awa)}°`, rx, 150, 30, fg, 'right');
    label(d.windFromStarboard ? 'ПрБ' : 'ЛБ', rx, 172, 'right');
    label(`істин. ${d.tws.toFixed(1)}`, rx, 214, 'right');

    // ── низ: паруси / паливо / хвиля ──
    label('ПАРУСИ', 20, 260);
    const sailCol = d.sailMode === 0 ? mute : d.overload > 0.85 ? '#e74c3c' : d.luffing ? '#e0a040' : accent;
    big(d.sailLabel, 20, 292, 26, sailCol);
    // смужка навантаження
    g.fillStyle = '#1d2a33';
    g.fillRect(20, 304, 150, 9);
    const ol = Math.min(1.2, d.overload) / 1.2;
    g.fillStyle = d.overload > 0.85 ? '#e74c3c' : d.overload > 0.6 ? '#e0a040' : accent;
    g.fillRect(20, 304, 150 * ol, 9);
    if (d.luffing) label('у лоб вітру', 20, 330);

    label('ПАЛИВО', 196, 260);
    const fuelCol = d.fuel / Math.max(1, d.fuelMax) < 0.2 ? '#e74c3c' : fg;
    big(`${Math.round(d.fuel)}/${d.fuelMax} л`, 196, 292, 26, fuelCol);
    label(d.rangeKm == null ? 'запас: —' : `запас ≈ ${d.rangeKm.toFixed(1)} км`, 196, 322);

    label('ХВИЛЯ', W - 22, 260, 'right');
    big(`${d.wave.toFixed(1)} м`, W - 22, 292, 26, fg, 'right');
    label(d.zone, W - 22, 322, 'right');

    // корпус — лише коли пошкоджено
    if (d.hull < d.hullMax * 0.6) {
      g.fillStyle = '#e74c3c';
      g.font = '700 18px -apple-system, "Segoe UI", sans-serif';
      g.textAlign = 'left';
      g.fillText(`КОРПУС ${Math.round(d.hull)}%`, 92, 36);
    }
  }
}
