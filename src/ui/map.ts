import { PORT_POINTS } from '../world/port';
import { terrainHeight } from '../world/portTerrain';
import { LANDMARKS } from '../world/landmarks';
import type { RockObstacle } from '../world/boat';
import type { GameState } from '../game/state';
import type { ZoneId } from '../core/types';

// ─────────────────────────────────────────────────────────────
// Карта (M): повноекранна штурвальна схема акваторії.
// Світ: x -950..950, z -560..780. Північ (-Z) — вгору.
// Коліщатко — зум до курсора, перетягування — рух карти; ЛКМ — точка в кінець
// маршруту (Shift — вставити в найближчий відрізок), тягни точку — пересунути,
// ПКМ по точці — прибрати. Той самий рендер малює паперову карту на столі.
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

const ZOOM_MAX = 10;
const ROUTE = '#24878c';
const ROUTE_D = '#1d6f73';

/** що показує карта: зум (1 — увесь світ) і центр у світових координатах */
export class MapViewState {
  zoom = 1;
  cx = (W0 + W1) / 2;
  cz = (H0 + H1) / 2;

  /** перетворення світ → екран для полотна w×h (логічні пікселі) */
  xf(w: number, h: number) {
    const fit = Math.min(w / WW, h / HH);
    const s = fit * this.zoom;
    this.clamp(w, h, s);
    return { s, fit, ox: w / 2 - (this.cx - W0) * s, oy: h / 2 - (this.cz - H0) * s };
  }

  /** не відпускати карту за край світу */
  private clamp(w: number, h: number, s: number) {
    const hw = w / 2 / s, hh = h / 2 / s;
    this.cx = hw * 2 >= WW ? (W0 + W1) / 2 : Math.max(W0 + hw, Math.min(W1 - hw, this.cx));
    this.cz = hh * 2 >= HH ? (H0 + H1) / 2 : Math.max(H0 + hh, Math.min(H1 - hh, this.cz));
  }

  /** зум у k разів, точка (px, py) на екрані лишається під курсором */
  zoomAt(k: number, px: number, py: number, w: number, h: number) {
    const a = this.xf(w, h);
    const wx = (px - a.ox) / a.s + W0, wz = (py - a.oy) / a.s + H0;
    this.zoom = Math.max(1, Math.min(ZOOM_MAX, this.zoom * k));
    const s = a.fit * this.zoom;
    this.cx = wx - (px - w / 2) / s;
    this.cz = wz - (py - h / 2) / s;
    this.xf(w, h);
  }

  pan(dxPx: number, dyPx: number, w: number, h: number) {
    const a = this.xf(w, h);
    this.cx -= dxPx / a.s;
    this.cz -= dyPx / a.s;
    this.xf(w, h);
  }

  center(x: number, z: number) {
    this.cx = x;
    this.cz = z;
  }

  key(w: number, h: number) {
    const a = this.xf(w, h);
    return `${w}x${h}|${a.s.toFixed(4)}|${a.ox.toFixed(1)}|${a.oy.toFixed(1)}`;
  }
}

/** підкладка рельєфу: увесь світ (швидко масштабується) + чітка під поточний вид */
interface BaseCache {
  full: HTMLCanvasElement | null;
  fullKey: string;
  sharp: HTMLCanvasElement | null;
  sharpKey: string;
  timer: number;
  pending: string;
}
const newCache = (): BaseCache => ({ full: null, fullKey: '', sharp: null, sharpKey: '', timer: 0, pending: '' });

type Pt = { x: number; z: number };

export class MapView {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** колбек: маршрут змінився (зберегти гру) */
  onRouteChange: (() => void) | null = null;
  /** колбек: кнопка ✕ / M → закрити карту */
  onClose: (() => void) | null = null;
  /** вид великої карти (M) і паперової карти на столі */
  readonly view = new MapViewState();
  readonly chartView = new MapViewState();
  private cache = newCache();
  private chartCache = newCache();
  private cur: BaseCache = this.cache;
  private curView: MapViewState = this.view;
  /** останній кадр (перемалювати після зуму/руху) */
  private last: { bx: number; bz: number; hd: number; rocks: RockObstacle[]; game: GameState } | null = null;
  private infoEl: HTMLElement;
  private noteEl: HTMLElement;
  private noteT = 0;
  /** наведена / перетягувана точка маршруту (для підсвітки) */
  private hot = -1;
  /** перетягування: точка маршруту або вся карта */
  private drag: { id: number; sx: number; sy: number; lx: number; ly: number; pt: number; moved: boolean } | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'mapview';
    this.el.innerHTML = `
      <div class="map-head">
        <span class="map-title">Лоція · Північне море</span>
        <span class="map-hint">ЛКМ — точка маршруту · тягни — рухати карту / точку · коліщатко — зум · ПКМ — прибрати точку · <kbd>M</kbd> закрити</span>
        <button class="map-close">✕</button>
      </div>
      <div class="map-body">
        <canvas></canvas>
        <div class="map-tools">
          <button data-z="in" title="Наблизити (+)">+</button>
          <button data-z="out" title="Віддалити (−)">−</button>
          <button data-z="boat" title="До яхти (Home)">⌖</button>
          <button data-z="all" title="Уся карта (0)">⤢</button>
        </div>
        <div class="map-route">
          <div class="map-route-info"></div>
          <div class="map-route-btns">
            <button data-r="undo" title="Прибрати останню точку (Backspace)">↶ Остання</button>
            <button data-r="clear" title="Стерти весь маршрут">Стерти маршрут</button>
          </div>
        </div>
        <div class="map-note"></div>
      </div>
      <div class="map-legend">
        <span><i class="lg lg-boat"></i>яхта</span>
        <span><i class="lg lg-rock"></i>скелі</span>
        <span><i class="lg lg-ring"></i>зони: берег до 400 м, середина до 900 м</span>
        <span>🐟 стая (за радіозвітом)</span>
        <span><i class="lg lg-wp"></i>маршрут (компас веде на першу точку)</span>
        <span><i class="lg lg-track"></i>пройдений шлях</span>
      </div>
    `;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.infoEl = this.el.querySelector('.map-route-info')!;
    this.noteEl = this.el.querySelector('.map-note')!;
    const cv = this.canvas;

    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.last) return;
      cv.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, sx: e.offsetX, sy: e.offsetY, lx: e.offsetX, ly: e.offsetY, pt: this.hitPoint(e.offsetX, e.offsetY), moved: false };
    });
    cv.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) {
        const h = this.hitPoint(e.offsetX, e.offsetY);
        if (h !== this.hot) {
          this.hot = h;
          this.redraw();
        }
        cv.style.cursor = h >= 0 ? 'grab' : 'crosshair';
        return;
      }
      if (!d.moved && Math.hypot(e.offsetX - d.sx, e.offsetY - d.sy) < 5) return;
      d.moved = true;
      if (d.pt >= 0 && this.last) {
        const [wx, wz] = this.toWorld(e.offsetX, e.offsetY);
        const p = this.last.game.route[d.pt];
        if (p && wx != null && wz != null && !this.isOnLand(wx, wz)) {
          p.x = wx;
          p.z = wz;
        }
        cv.style.cursor = 'grabbing';
      } else {
        this.view.pan(e.offsetX - d.lx, e.offsetY - d.ly, cv.clientWidth, cv.clientHeight);
        cv.style.cursor = 'move';
      }
      d.lx = e.offsetX;
      d.ly = e.offsetY;
      this.redraw();
    });
    const up = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      cv.style.cursor = 'crosshair';
      if (d.moved) {
        if (d.pt >= 0) this.changed();
        return;
      }
      if (d.pt >= 0) return; // клік по точці — нічого (тягни або ПКМ)
      this.clickAdd(e.offsetX, e.offsetY, e.shiftKey);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.last) return;
      const i = this.hitPoint(e.offsetX, e.offsetY);
      if (i >= 0) {
        this.last.game.removeRoutePoint(i);
        this.hot = -1;
        this.changed();
      }
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.pow(1.0018, -Math.max(-240, Math.min(240, e.deltaY * (e.deltaMode === 1 ? 40 : 1))));
      this.view.zoomAt(k, e.offsetX, e.offsetY, cv.clientWidth, cv.clientHeight);
      this.redraw();
    }, { passive: false });
    this.el.querySelector('.map-tools')!.addEventListener('click', (e) => {
      const z = (e.target as HTMLElement).closest('button')?.dataset.z;
      if (z) this.zoomCmd(z);
    });
    this.el.querySelector('.map-route-btns')!.addEventListener('click', (e) => {
      const r = (e.target as HTMLElement).closest('button')?.dataset.r;
      if (!r || !this.last) return;
      const g = this.last.game;
      if (r === 'undo') g.removeRoutePoint(g.route.length - 1);
      else g.clearWaypoint();
      this.changed();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.repeat && !e.code.startsWith('Arrow')) return;
      const w = cv.clientWidth, h = cv.clientHeight;
      const step = Math.min(w, h) * 0.2;
      const pan: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step], KeyA: [step, 0], KeyD: [-step, 0], KeyW: [0, step], KeyS: [0, -step] };
      if (pan[e.code]) {
        this.view.pan(pan[e.code][0], pan[e.code][1], w, h);
        this.redraw();
      } else if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.code === 'KeyE') this.zoomCmd('in');
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.code === 'KeyQ') this.zoomCmd('out');
      else if (e.code === 'Home' || e.code === 'KeyC') this.zoomCmd('boat');
      else if (e.code === 'Digit0') this.zoomCmd('all');
      else if ((e.code === 'Backspace' || e.code === 'Delete') && this.last?.game.route.length) {
        e.preventDefault();
        this.last.game.removeRoutePoint(this.last.game.route.length - 1);
        this.changed();
      } else return;
    });
    this.el.querySelector('.map-close')!.addEventListener('click', () => {
      this.onClose?.();
    });
  }

  private zoomCmd(z: string) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (z === 'in' || z === 'out') this.view.zoomAt(z === 'in' ? 1.6 : 1 / 1.6, w / 2, h / 2, w, h);
    else if (z === 'all') this.view.zoom = 1;
    else if (z === 'boat' && this.last) {
      this.view.zoom = Math.max(this.view.zoom, 3.5);
      this.view.center(this.last.bx, this.last.bz);
    }
    this.redraw();
  }

  /** ЛКМ по воді: точка в кінець маршруту (Shift — у найближчий відрізок) */
  private clickAdd(px: number, py: number, insert: boolean) {
    if (!this.last) return;
    const [wx, wz] = this.toWorld(px, py);
    if (wx == null || wz == null) return;
    if (this.isOnLand(wx, wz)) {
      this.note('Це суша — точку ставлять на воді');
      return;
    }
    const g = this.last.game;
    const idx = insert ? this.nearestLeg(g.route, this.last.bx, this.last.bz, wx, wz) : g.route.length;
    if (!g.addRoutePoint(wx, wz, idx)) {
      this.note(`Не більше ${g.route.length} точок у маршруті`);
      return;
    }
    this.changed();
  }

  /** індекс, куди вставити точку, щоб розірвати найближчий відрізок (яхта → 1 → 2 …) */
  private nearestLeg(route: Pt[], bx: number, bz: number, x: number, z: number): number {
    let best = route.length, bd = Infinity;
    let px = bx, pz = bz;
    for (let i = 0; i < route.length; i++) {
      const q = route[i];
      const dx = q.x - px, dz = q.z - pz;
      const L = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / L));
      const d = Math.hypot(px + dx * t - x, pz + dz * t - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
      px = q.x;
      pz = q.z;
    }
    // далеко від усіх відрізків — краще в кінець
    if (route.length && bd > Math.hypot(x - route[route.length - 1].x, z - route[route.length - 1].z)) best = route.length;
    return best;
  }

  /** точка маршруту під курсором (−1 — немає) */
  private hitPoint(px: number, py: number): number {
    if (!this.last) return -1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const a = this.view.xf(w, h);
    const r = this.last.game.route;
    let best = -1, bd = 13;
    for (let i = 0; i < r.length; i++) {
      const d = Math.hypot(a.ox + (r[i].x - W0) * a.s - px, a.oy + (r[i].z - H0) * a.s - py);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  private changed() {
    this.onRouteChange?.();
    this.redraw();
  }

  private note(t: string) {
    this.noteEl.textContent = t;
    this.noteEl.classList.add('on');
    clearTimeout(this.noteT);
    this.noteT = window.setTimeout(() => this.noteEl.classList.remove('on'), 1800);
  }

  private redraw() {
    if (this.isOpen && this.last) this.render(this.last.bx, this.last.bz, this.last.hd, this.last.rocks, this.last.game);
  }

  get isOpen() {
    return this.el.classList.contains('open');
  }

  /** кооп: друзі (світові координати) */
  friends: Array<{ x: number; z: number; nick: string; color: string; onBoat: boolean; fishing: boolean }> = [];
  /** поставлені сітки: лінія між двома буями, номер і скільки стоїть */
  buoys: Array<{ x0: number; z0: number; x1: number; z1: number; id: number; h: number }> = [];

  show(boatX: number, boatZ: number, heading: number, rocks: RockObstacle[], game: GameState) {
    const opening = !this.isOpen;
    this.el.classList.add('open');
    this.resize();
    if (opening && this.view.zoom > 1.01 && !this.inView(boatX, boatZ)) this.view.center(boatX, boatZ);
    this.render(boatX, boatZ, heading, rocks, game);
  }

  /** чи яхта на екрані (при відкритті карти зі зумом) */
  private inView(x: number, z: number) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const a = this.view.xf(w, h);
    const px = a.ox + (x - W0) * a.s, py = a.oy + (z - H0) * a.s;
    return px > 40 && py > 40 && px < w - 40 && py < h - 40;
  }

  /** перемалювати відкриту мапу (друзі рухаються) без зміни розміру */
  refresh(boatX: number, boatZ: number, heading: number, rocks: RockObstacle[], game: GameState) {
    if (this.isOpen && !this.drag?.moved) this.render(boatX, boatZ, heading, rocks, game);
  }

  hide() {
    this.el.classList.remove('open');
    this.drag = null;
  }

  private resize() {
    // canvas у flex-колонці: фактичний розмір = екран мінус шапка/легенда
    const dpr = this.dprOverride ?? Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  private render(boatX: number, boatZ: number, heading: number, rocks: RockObstacle[], game: GameState) {
    const c = this.ctx;
    const dpr = this.dprOverride ?? Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const main = this.cur === this.cache;
    if (main) this.last = { bx: boatX, bz: boatZ, hd: heading, rocks, game };

    // масштаб і зсув: вид (зум + центр)
    const view = this.curView;
    const { s, ox, oy } = view.xf(w, h);
    const mx = (wx: number) => ox + (wx - W0) * s;
    const my = (wz: number) => oy + (wz - H0) * s; // +Z вниз = південь
    // підписи й значки трохи більшають при зумі
    const zk = Math.min(1.35, 1 + (view.zoom - 1) * 0.06);

    // ── вода й суша: підкладка з рельєфу ──
    c.fillStyle = '#efe6d4';
    c.fillRect(0, 0, w, h);
    this.drawBase(c, w, h, view);

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
    c.fillText(spaced('відкрите море'), mx(0), my(0) + 1000 * s > h - 20 && view.zoom < 1.01 ? h - 24 : my(0) + 1000 * s);

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

    // ── пройдений маршрут: пунктир, старіші ділянки блідші ──
    {
      const tr = game.track;
      const n = tr.length / 2;
      if (n > 1) {
        c.lineWidth = 2;
        c.setLineDash([5, 5]);
        c.lineCap = 'round';
        for (let i = 1; i < n; i++) {
          const x0 = tr[(i - 1) * 2], z0 = tr[(i - 1) * 2 + 1], x1 = tr[i * 2], z1 = tr[i * 2 + 1];
          if (Math.hypot(x1 - x0, z1 - z0) > 80) continue; // стрибок (затоплення / новий сейв)
          c.strokeStyle = `rgba(226,103,74,${(0.15 + 0.6 * (i / n)).toFixed(2)})`;
          c.beginPath();
          c.moveTo(mx(x0), my(z0));
          c.lineTo(mx(x1), my(z1));
          c.stroke();
        }
        c.setLineDash([]);
        c.lineCap = 'butt';
      }
    }

    // ── пам'ятки: відкриті — з назвою, решта — «?» ──
    for (const l of LANDMARKS) {
      const px = mx(l.x), pz = my(l.z);
      const found = game.places.includes(l.id);
      c.beginPath();
      c.arc(px, pz, found ? 6 : 9, 0, Math.PI * 2);
      c.fillStyle = found ? '#e2674a' : 'rgba(42,58,70,0.08)';
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = found ? '#fffaf0' : 'rgba(42,58,70,0.45)';
      if (!found) c.setLineDash([3, 3]);
      c.stroke();
      c.setLineDash([]);
      c.textAlign = 'center';
      if (found) {
        c.font = `700 12px ${FONT_D}`;
        c.fillStyle = INK;
        c.fillText(l.name, px, pz - 12);
      } else {
        c.font = `800 12px ${FONT}`;
        c.fillStyle = INK_SOFT;
        c.fillText('?', px, pz + 4);
      }
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
      c.fillText(`${game.speciesName(r.speciesId)} ×${r.boost.toFixed(1).replace(".", ",")}`, px, pz + 38);
    }

    // ── маршрут: яхта → 1 → 2 …, перша точка — поточна ціль (прапор) ──
    {
      const r = game.route;
      if (r.length) {
        c.lineCap = 'round';
        let px = mx(boatX), pz = my(boatZ);
        for (let i = 0; i < r.length; i++) {
          const qx = mx(r[i].x), qz = my(r[i].z);
          c.beginPath();
          c.moveTo(px, pz);
          c.lineTo(qx, qz);
          c.setLineDash(i === 0 ? [7, 6] : []);
          c.strokeStyle = i === 0 ? 'rgba(36,135,140,0.9)' : 'rgba(36,135,140,0.7)';
          c.lineWidth = i === 0 ? 2 : 2.5;
          c.stroke();
          c.setLineDash([]);
          // стрілка напрямку посередині відрізка
          const L = Math.hypot(qx - px, qz - pz);
          if (L > 46) {
            const a = Math.atan2(qz - pz, qx - px);
            c.save();
            c.translate((px + qx) / 2, (pz + qz) / 2);
            c.rotate(a);
            c.beginPath();
            c.moveTo(5, 0);
            c.lineTo(-4, -4.5);
            c.lineTo(-4, 4.5);
            c.closePath();
            c.fillStyle = ROUTE;
            c.fill();
            c.restore();
          }
          px = qx;
          pz = qz;
        }
        c.lineCap = 'butt';
        // точки з номерами
        let total = Math.hypot(r[0].x - boatX, r[0].z - boatZ);
        for (let i = 0; i < r.length; i++) {
          if (i) total += Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z);
          const qx = mx(r[i].x), qz = my(r[i].z);
          const hot = main && i === this.hot;
          if (i === 0) {
            // прапор на поточній точці
            c.beginPath();
            c.moveTo(qx, qz - 8 * zk);
            c.lineTo(qx, qz - 24 * zk);
            c.strokeStyle = ROUTE;
            c.lineWidth = 2;
            c.stroke();
            c.beginPath();
            c.moveTo(qx, qz - 24 * zk);
            c.lineTo(qx + 12 * zk, qz - 20 * zk);
            c.lineTo(qx, qz - 16 * zk);
            c.closePath();
            c.fillStyle = ROUTE;
            c.fill();
          }
          c.beginPath();
          c.arc(qx, qz, (hot ? 10 : 8) * zk, 0, Math.PI * 2);
          c.fillStyle = hot ? '#e2674a' : i === 0 ? ROUTE : '#fffaf0';
          c.fill();
          c.lineWidth = 2;
          c.strokeStyle = hot ? '#fffaf0' : ROUTE;
          c.stroke();
          c.font = `800 ${Math.round(10 * zk)}px ${FONT}`;
          c.textAlign = 'center';
          c.fillStyle = hot || i === 0 ? '#fffaf0' : ROUTE_D;
          c.fillText(String(i + 1), qx, qz + 3.5 * zk);
          // підписи: перша — курс і відстань від яхти; остання — довжина всього маршруту
          const lab = i === 0
            ? `${Math.round(this.bearing(boatX, boatZ, r[0].x, r[0].z)).toString().padStart(3, '0')}° · ${this.fmtDist(Math.hypot(r[0].x - boatX, r[0].z - boatZ))}`
            : i === r.length - 1 ? `Σ ${this.fmtDist(total)}` : '';
          if (lab) {
            c.font = `800 ${Math.round(11.5 * zk)}px ${FONT}`;
            const tw = c.measureText(lab).width;
            const ly = qz + 22 * zk;
            c.fillStyle = 'rgba(255,250,240,0.88)';
            c.beginPath();
            c.roundRect(qx - tw / 2 - 6, ly - 12 * zk, tw + 12, 17 * zk, 8);
            c.fill();
            c.fillStyle = ROUTE_D;
            c.fillText(lab, qx, ly);
          }
        }
        if (main) this.infoEl.innerHTML = `<b>Маршрут</b> · ${r.length} ${plural(r.length, 'точка', 'точки', 'точок')} · ${this.fmtDist(total)}` + (r.length > 1 ? ` · далі: ${this.fmtDist(total - Math.hypot(r[0].x - boatX, r[0].z - boatZ))} після №1` : '');
      } else if (main) this.infoEl.innerHTML = '<b>Маршрут</b> · клікни по воді — перша точка';
      if (main) this.el.querySelector('.map-route')!.classList.toggle('empty', !r.length);
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

    // ── сітки: жовта поплавцева лінія, помаранчеві буї, «№ · год» ──
    for (const b of this.buoys) {
      const ax = mx(b.x0), az = my(b.z0), bx = mx(b.x1), bz = my(b.z1);
      c.strokeStyle = '#d9a514';
      c.lineWidth = 3;
      c.setLineDash([3, 3]);
      c.beginPath(); c.moveTo(ax, az); c.lineTo(bx, bz); c.stroke();
      c.setLineDash([]);
      for (const [px, pz] of [[ax, az], [bx, bz]]) {
        c.beginPath();
        c.arc(px, pz, 4.5, 0, Math.PI * 2);
        c.fillStyle = '#e9592f';
        c.fill();
        c.strokeStyle = '#fffaf0';
        c.lineWidth = 1.5;
        c.stroke();
      }
      const ready = b.h >= 3;
      const txt = `🛟${b.id} · ${b.h < 1 ? Math.round(b.h * 60) + ' хв' : Math.round(b.h) + ' год'}`;
      c.font = `800 11px ${FONT}`;
      c.textAlign = 'center';
      const tw = c.measureText(txt).width;
      const lx = (ax + bx) / 2, lz = (az + bz) / 2 - 12;
      c.fillStyle = ready ? 'rgba(46,139,87,0.92)' : 'rgba(255,250,240,0.92)';
      c.beginPath();
      c.roundRect(lx - tw / 2 - 6, lz - 9, tw + 12, 18, 9);
      c.fill();
      c.fillStyle = ready ? '#fff' : INK;
      c.fillText(txt, lx, lz + 4);
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
      // довжина лінійки — кругле число метрів, ~120–260 px
      const m = [50, 100, 200, 500, 1000].find((v) => v * s >= 110) ?? 1000;
      const barPx = m * s;
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
      c.fillText(this.fmtDist(m), bx + barPx + 6, by - 10);
    }
  }

  /** підкладка: чітка під цей вид, якщо готова; інакше — розтягнута «вся карта» і чітку доробимо згодом */
  private drawBase(c: CanvasRenderingContext2D, w: number, h: number, view: MapViewState) {
    const bc = this.cur;
    const fit = Math.min(w / WW, h / HH);
    const fullKey = `${w}x${h}|${this.dprOverride ?? 0}`;
    if (!bc.full || bc.fullKey !== fullKey) {
      bc.full = this.baseLayer(bc.full, w, h, fit, (w - WW * fit) / 2, (h - HH * fit) / 2);
      bc.fullKey = fullKey;
      bc.sharp = null;
      bc.sharpKey = '';
    }
    const { s, ox, oy } = view.xf(w, h);
    if (view.zoom <= 1.01) {
      c.drawImage(bc.full, 0, 0, w, h);
      return;
    }
    const key = fullKey + '|' + view.key(w, h);
    if (bc.sharp && bc.sharpKey === key) {
      c.drawImage(bc.sharp, 0, 0, w, h);
      return;
    }
    // «вся карта» в масштабі виду (розмито, зате миттєво)
    const k = s / fit;
    const ox1 = (w - WW * fit) / 2, oy1 = (h - HH * fit) / 2;
    c.save();
    c.imageSmoothingEnabled = true;
    c.translate(ox - ox1 * k, oy - oy1 * k);
    c.scale(k, k);
    c.drawImage(bc.full, 0, 0, w, h);
    c.restore();
    // чітку — коли користувач перестане крутити/тягнути
    if (bc.pending === key) return;
    bc.pending = key;
    clearTimeout(bc.timer);
    const dprO = this.dprOverride;
    const isMain = bc === this.cache;
    bc.timer = window.setTimeout(() => {
      bc.pending = '';
      if (bc.fullKey !== fullKey || (fullKey + '|' + view.key(w, h)) !== key) return;
      const keepD = this.dprOverride;
      this.dprOverride = dprO;
      const a = view.xf(w, h);
      bc.sharp = this.baseLayer(bc.sharp, w, h, a.s, a.ox, a.oy);
      this.dprOverride = keepD;
      bc.sharpKey = key;
      if (isMain) this.redraw();
    }, 140);
  }

  /** вода (тони за зонами + ізобати біля берега) і суша (рельєф) у заданому масштабі */
  private baseLayer(reuse: HTMLCanvasElement | null, w: number, h: number, s: number, ox: number, oy: number): HTMLCanvasElement {
    const dpr = this.dprOverride ?? Math.min(window.devicePixelRatio || 1, 2);
    const cv = reuse ?? document.createElement('canvas');
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

  private dprOverride: number | null = null;

  /** намалювати лоцію в чужий canvas (паперова карта на штурманському столі) */
  drawChart(cv: HTMLCanvasElement, boatX: number, boatZ: number, heading: number, rocks: RockObstacle[], game: GameState) {
    const keep = [this.canvas, this.ctx] as const;
    this.canvas = cv;
    this.ctx = cv.getContext('2d')!;
    this.cur = this.chartCache;
    this.curView = this.chartView;
    this.dprOverride = 1.7; // крупніші підписи на паперовій карті
    try {
      this.render(boatX, boatZ, heading, rocks, game);
    } finally {
      [this.canvas, this.ctx] = keep;
      this.cur = this.cache;
      this.curView = this.view;
      this.dprOverride = null;
    }
  }

  /** світ → (u, v) на паперовій карті */
  worldToUV(wx: number, wz: number, cw: number, ch: number): [number, number] {
    const [w, h] = [cw / 1.7, ch / 1.7];
    const a = this.chartView.xf(w, h);
    return [(a.ox + (wx - W0) * a.s) / w, (a.oy + (wz - H0) * a.s) / h];
  }

  /** точка на паперовій карті (u, v 0..1, v — згори) → світ; null — поза картою */
  uvToWorld(u: number, v: number, cw: number, ch: number): [number, number] | null {
    const [w, h] = [cw / 1.7, ch / 1.7];
    const a = this.chartView.xf(w, h);
    const wx = (u * w - a.ox) / a.s + W0;
    const wz = (v * h - a.oy) / a.s + H0;
    if (wx < W0 || wx > W1 || wz < H0 || wz > H1) return null;
    return [wx, wz];
  }

  /** паперова карта: відстань (у пікселях полотна) від (u,v) до найближчої точки маршруту */
  chartHit(u: number, v: number, cw: number, ch: number, route: Pt[]): number {
    let best = -1, bd = 16 * 1.7;
    for (let i = 0; i < route.length; i++) {
      const [pu, pv] = this.worldToUV(route[i].x, route[i].z, cw, ch);
      const d = Math.hypot((pu - u) * cw, (pv - v) * ch);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** паперова карта: зум коліщатком навколо олівця */
  chartZoom(steps: number, u: number, v: number, cw: number, ch: number) {
    const [w, h] = [cw / 1.7, ch / 1.7];
    this.chartView.zoomAt(Math.pow(1.35, -steps), u * w, v * h, w, h);
  }

  /** паперова карта: олівець біля краю — карта сама їде (px логічні за кадр) */
  chartPan(dx: number, dy: number, cw: number, ch: number) {
    this.chartView.pan(dx, dy, cw / 1.7, ch / 1.7);
  }

  /** координати кліку → світ; null, якщо поза межами карти */
  toWorld(px: number, py: number): [number | null, number | null] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const { s, ox, oy } = this.view.xf(w, h);
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

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
