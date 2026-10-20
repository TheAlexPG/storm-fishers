import type { RockObstacle } from '../world/boat';
import { PORT_POINTS } from '../world/port';
import { terrainHeight } from '../world/portTerrain';
import { ISLANDS, islandHeight } from '../world/islandShape';
import { PORT_SITES, pierRect, siteBox, siteServices } from '../world/portSites';
import { L } from '../core/i18n';
import { CALM, ROUGH, WORLD, WS, havens, seaDist } from '../core/region';
import { CONT_BOXES } from '../world/continents';
import { LANDMARKS } from '../world/landmarks';
import { HOTSPOTS, SCHOOL_ANCHORS, SCHOOL_R, ZONE_NAMES, fishingSpot, hotspotAt, zoneFromDist } from '../game/fish';
import type { ZoneId } from '../core/types';
import { DOCK_BY_ID } from '../game/cargo';

/** континенти — плитками по 512 м (рахуються ліниво, лише ті, що поруч) */
const CONT_TILES: Array<[number, number, number, number]> = CONT_BOXES.flatMap(([x0, z0, x1, z1]) => {
  const out: Array<[number, number, number, number]> = [];
  for (let z = z0; z < z1; z += 512) for (let x = x0; x < x1; x += 512) out.push([x, z, Math.min(x1, x + 512), Math.min(z1, z + 512)]);
  return out;
});

/** суходоли поза підкладкою домашнього берега: гавані, острови й континенти (bbox x0,z0,x1,z1) */
const LANDS: Array<[number, number, number, number]> = [
  ...CONT_TILES,
  ...PORT_SITES.map((p) => siteBox(p)),
  ...ISLANDS.map((d): [number, number, number, number] => {
    const r = d.r * Math.sqrt(d.elong) * 1.35 + 6;
    return [d.x - r, d.z - r, d.x + r, d.z + r];
  }),
];
const SITE_PIERS = PORT_SITES.map((p) => pierRect(p));
const SITE_SVC = PORT_SITES.flatMap((p) => siteServices(p));

// підкладка домашнього берега: x −520..520, z −780..80, 2 м на піксель
const LX0 = -520, LZ0 = -780, LM = 2, LW = 520, LH = 430;
// оглядова підкладка всього світу (для дальніх масштабів і поки дрібні плитки не пораховані)
const OM = 12;
const OW = Math.ceil((WORLD.W1 - WORLD.W0) / OM), OH = Math.ceil((WORLD.H1 - WORLD.H0) / OM);

/** масштаби мінімапи, px/м: близько · середньо · далеко (N — перемкнути) */
const ZOOMS = [0.45, 0.2, 0.075];
const ZOOM_KEY = 'storm-minimap-zoom';

const PORTS = LANDMARKS.filter((l) => l.id.startsWith('port-'));
const CONTS = LANDMARKS.filter((l) => l.id.startsWith('cont-'));
const REFUGES = ISLANDS.filter((d) => d.kind === 'refuge');
/** пам'ятки в морі (не гавані, континенти, рибні місця чи острови) */
const SIGHTS = LANDMARKS.filter((l) => !/^(port-|cont-|hot-|isl-)/.test(l.id));
const HOME = { x: 0, z: -30, name: L('«Шторм»', `Storm Harbour`) };

const FONT = 'Manrope, system-ui, sans-serif';
const INK = '#2a3a46';

/** колір суші за висотою (той самий, що й на лоції) */
function landCol(h: number, coast: boolean): [number, number, number] {
  if (coast) return [42, 58, 70];
  return h < 2.2 ? [230, 211, 168] : h < 14 ? [169, 192, 138] : h < 60 ? [158, 174, 120] : h < 175 ? [196, 188, 168] : [244, 246, 248];
}

// ─────────────────────────────────────────────────────────────
// Мінімапа-радар: кругла, ~240px, центр = човен, північ угорі.
// Світ (суша, зони, гавані, рибні місця) малюється у шар раз на ~0.25 с,
// кожен кадр — лише зсув шару за човном, стрілка човна, вітер і північ.
// Без GPS («Прилади» < 3) — «карта в голові»: берег, гавані, райони й вітер.
// ─────────────────────────────────────────────────────────────

export class Minimap {
  canvas: HTMLCanvasElement;
  /** плашка під мінімапою: чи ти зараз на рибному місці / стаї / в якій зоні */
  readonly badge: HTMLDivElement;
  private badgeKey = '';
  private ctx: CanvasRenderingContext2D;
  visible = true;
  private size = 240;
  /** кооп: друзі (світові координати) */
  friends: Array<{ x: number; z: number; color: string; onBoat: boolean }> = [];
  /** сітки (буї): кінці ліній */
  buoys: Array<{ x0: number; z0: number; x1: number; z1: number }> = [];
  /** човни місцевих рибалок */
  bots: Array<{ x: number; z: number; h: number; name?: string }> = [];
  /** маршрут (з GPS-картплотером, «Прилади» 3+) */
  route: Array<{ x: number; z: number }> = [];
  /** кооп: маршрути інших гравців свого борту (колір гравця) */
  crew: Array<{ color: string; captain: boolean; pts: Array<{ x: number; z: number }> }> = [];
  /** AIS (радар, «Прилади» 5): судна з іменами на всю мінікарту; без нього — лише ті, що видно оком */
  ais = true;
  /** GPS-картплотер («Прилади» 3+): рибні місця, стаї, доставки */
  gps = false;
  /** відкриті місця, радіозвіти про стаї й активні доставки (GameState) */
  places: readonly string[] = [];
  reports: ReadonlyArray<{ zone: ZoneId; speciesId: string; boost: number }> = [];
  orders: ReadonlyArray<{ to: string; crates: number }> = [];
  speciesName: (id: string) => string = (id) => id;
  /** вітер: куди дме (weather.windDir) і сила, м/с */
  windDir = 0;
  windMs = 0;

  private zoomIdx = 1;
  private land: HTMLCanvasElement | null = null;
  private extra: HTMLCanvasElement[] = [];
  private over: HTMLCanvasElement;
  private overRow = 0;
  private overImg: ImageData;
  /** шар світу і де був човен, коли його малювали */
  private layer: HTMLCanvasElement;
  private lx = 0;
  private lz = 0;
  private layerT = 0;
  private layerKey = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    this.layer = document.createElement('canvas');
    this.over = document.createElement('canvas');
    this.over.width = OW;
    this.over.height = OH;
    this.overImg = this.over.getContext('2d')!.createImageData(OW, OH);
    try {
      const z = Number(localStorage.getItem(ZOOM_KEY));
      if (z >= 0 && z < ZOOMS.length && Number.isInteger(z)) this.zoomIdx = z;
    } catch { /* без сховища — масштаб за замовчуванням */ }
    this.resize();
    // у правий верхній блок HUD (над трюмом); без нього canvas падав під
    // повноекранний рендер і мінімапи не було видно взагалі
    const slot = document.querySelector('#hud .hud-tr');
    this.badge = document.createElement('div');
    this.badge.className = 'mm-badge';
    if (slot) {
      slot.prepend(this.badge);
      slot.prepend(this.canvas);
    } else document.body.append(this.canvas, this.badge);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** розмір під екран: великий на десктопі, менший на низьких/вузьких вікнах */
  private wantSize(): number {
    const w = window.innerWidth, h = window.innerHeight;
    if (w < 760 || h < 560) return 170;
    if (h >= 1000 && w >= 1600) return 260;
    return 230;
  }

  private resize() {
    const s = this.wantSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (s === this.size && this.canvas.width === Math.round(s * dpr)) return;
    this.size = s;
    for (const cv of [this.canvas, this.layer]) {
      cv.width = Math.round(s * dpr);
      cv.height = Math.round(s * dpr);
    }
    this.canvas.style.width = s + 'px';
    this.canvas.style.height = s + 'px';
    this.layerT = 0;
  }

  /** N — наступний масштаб (близько → середньо → далеко) */
  cycleZoom(): string {
    this.zoomIdx = (this.zoomIdx + 1) % ZOOMS.length;
    try { localStorage.setItem(ZOOM_KEY, String(this.zoomIdx)); } catch { /* не критично */ }
    this.layerT = 0;
    return this.rangeText();
  }

  private get scale() {
    return ZOOMS[this.zoomIdx];
  }

  /** радіус огляду підписом: «≈600 м» / «≈1,5 км» */
  private rangeText(): string {
    const m = this.size / 2 / this.scale;
    return m < 1000 ? `${Math.round(m / 50) * 50} ${L('м', 'm')}` : `${(m / 1000).toFixed(1).replace('.', L(',', '.'))} ${L('км', 'km')}`;
  }

  setMuted(m: boolean) {
    this.canvas.style.opacity = m ? '0.25' : '1';
  }

  update(boatX: number, boatZ: number, heading: number, rocks: RockObstacle[], night: boolean, dt = 1 / 60) {
    if (!this.visible) {
      if (this.canvas.style.display !== 'none') this.canvas.style.display = this.badge.style.display = 'none';
      return;
    }
    if (this.canvas.style.display === 'none') this.canvas.style.display = this.badge.style.display = '';
    this.resize();
    this.buildOverview(2.5);

    // шар світу — раз на ~0.25 с (або коли змінився масштаб/ніч/GPS)
    const key = `${this.zoomIdx}|${night ? 1 : 0}|${this.gps ? 1 : 0}|${this.size}`;
    this.layerT -= dt;
    if (this.layerT <= 0 || key !== this.layerKey) {
      this.layerT = 0.25;
      this.layerKey = key;
      this.lx = boatX;
      this.lz = boatZ;
      this.drawLayer(boatX, boatZ, rocks, night);
      this.updateBadge(boatX, boatZ);
    }

    const c = this.ctx;
    const s = this.size;
    const cx = s / 2;
    const R = s / 2;
    const dpr = this.canvas.width / s;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, s, s);
    c.save();
    c.beginPath();
    c.arc(cx, cx, R - 1, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#b8d7d5';
    c.fillRect(0, 0, s, s);
    // шар зсувається за човном між перемальовуваннями — рух плавний
    c.drawImage(this.layer, (this.lx - boatX) * this.scale, (this.lz - boatZ) * this.scale, s, s);

    // човен (стрілка в центрі, обертання по heading; 0 → нос на +Z, вниз на карті)
    c.save();
    c.translate(cx, cx);
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

    // вітер: стрілка біля краю з того боку, звідки дме (вимпел у центр)
    if (this.windMs > 0.5) {
      const vx = Math.sin(this.windDir), vz = -Math.cos(this.windDir); // куди дме
      const r = R - 13;
      const px = cx - vx * r, pz = cx - vz * r;
      c.save();
      c.translate(px, pz);
      c.rotate(Math.atan2(vz, vx));
      c.fillStyle = 'rgba(29,111,115,0.9)';
      c.strokeStyle = 'rgba(255,250,240,0.9)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(8, 0);
      c.lineTo(-5, -5);
      c.lineTo(-2, 0);
      c.lineTo(-5, 5);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
      c.font = `800 9px ${FONT}`;
      c.textAlign = 'center';
      c.fillStyle = 'rgba(29,111,115,0.95)';
      c.fillText(`${Math.round(this.windMs)}`, px - vx * -14, pz - vz * -14 + 3);
    }

    // N (північ = −Z = вгору на карті)
    c.fillStyle = '#e2674a';
    c.font = `800 11px ${FONT}`;
    c.textAlign = 'center';
    c.fillText(L('П', `N`), cx, 13);
    c.restore();
  }

  /** шар світу (без човна): суша, зони, гавані, рибні місця, маршрути, судна, друзі */
  private drawLayer(boatX: number, boatZ: number, rocks: RockObstacle[], night: boolean) {
    const c = this.layer.getContext('2d')!;
    const s = this.size;
    const cx = s / 2;
    const R = s / 2;
    const sc = this.scale;
    const dpr = this.layer.width / s;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, s, s);
    const far = this.zoomIdx === 2;
    const near = this.zoomIdx === 0;
    /** радіус огляду, м (із запасом на зсув шару) */
    const view = R / sc + 40;
    const toMap = (wx: number, wz: number): [number, number] => [cx + (wx - boatX) * sc, cx + (wz - boatZ) * sc];
    const inView = (x: number, z: number, pad = 0) => Math.hypot(x - boatX, z - boatZ) < view + pad;
    // підписи без накладань (порядок викликів = пріоритет)
    // центр (яхта) і плашка масштабу — без підписів поверх
    const boxes: Array<[number, number, number, number]> = [[cx - 10, cx - 10, cx + 10, cx + 10], [cx - R * 0.5 - 34, cx + R * 0.74 - 8, cx - R * 0.5 + 34, cx + R * 0.74 + 7]];
    const label = (txt: string, x: number, y: number, font: string, color: string, pill = false) => {
      c.font = font;
      const w = c.measureText(txt).width + (pill ? 8 : 2);
      const h = 11;
      const b: [number, number, number, number] = [x - w / 2, y - h + 2, x + w / 2, y + 3];
      // увесь підпис — усередині кола
      for (const [qx, qy] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) if (Math.hypot(qx - cx, qy - cx) > R - 3) return false;
      for (const o of boxes) if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false;
      boxes.push(b);
      if (pill) {
        c.fillStyle = 'rgba(255,250,240,0.82)';
        c.beginPath();
        c.roundRect(b[0], b[1] - 1, w, h + 2, 6);
        c.fill();
      }
      c.textAlign = 'center';
      c.fillStyle = color;
      c.fillText(txt, x, y);
      return true;
    };

    // ── суша: оглядова підкладка світу, поверх — дрібні плитки (поблизу) ──
    c.imageSmoothingEnabled = true;
    {
      const [ox, oz] = toMap(WORLD.W0, WORLD.H0);
      c.drawImage(this.over, ox, oz, OW * OM * sc, OH * OM * sc);
    }
    {
      const [lx, lz] = toMap(LX0, LZ0);
      c.drawImage(this.landLayer(), lx, lz, LW * LM * sc, LH * LM * sc);
    }
    if (!far) {
      let built = 0;
      for (let k = 0; k < LANDS.length; k++) {
        const [x0, z0, x1, z1] = LANDS[k];
        if (x1 < boatX - view || x0 > boatX + view || z1 < boatZ - view || z0 > boatZ + view) continue;
        // нові плитки — не більше двох за раз (до того їх покриває оглядова підкладка)
        if (!this.extra[k]) {
          if (built >= 2) continue;
          built++;
        }
        const [ax, az] = toMap(x0, z0);
        c.drawImage(this.extraLand(k), ax, az, (x1 - x0) * sc, (z1 - z0) * sc);
      }
      if (built) this.layerT = Math.min(this.layerT, 0.05);
    }

    // ── райони: бурхливі (сірувато) і тихі (бірюза) ──
    for (const a of [...ROUGH, ...CALM]) {
      const calm = a.k < 0;
      const rect = a.hw != null && a.hh != null;
      const ext = rect ? Math.max(a.hw!, a.hh!) + a.r : a.r;
      if (!inView(a.x, a.z, ext)) continue;
      const [px, pz] = toMap(a.x, a.z);
      if (rect) {
        c.fillStyle = calm ? 'rgba(60,170,180,0.12)' : 'rgba(70,86,104,0.17)';
        c.beginPath();
        c.roundRect(px - (a.hw! + a.r * 0.5) * sc, pz - (a.hh! + a.r * 0.5) * sc, (a.hw! + a.r * 0.5) * 2 * sc, (a.hh! + a.r * 0.5) * 2 * sc, a.r * 0.5 * sc);
        c.fill();
      } else {
        const g = c.createRadialGradient(px, pz, a.r * 0.3 * sc, px, pz, a.r * sc);
        g.addColorStop(0, calm ? 'rgba(60,170,180,0.18)' : 'rgba(70,86,104,0.32)');
        g.addColorStop(1, 'rgba(70,86,104,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(px, pz, a.r * sc, 0, Math.PI * 2);
        c.fill();
      }
    }

    // ── зони риби навколо дому (fish.ts zoneFromDist) ──
    if (!near) {
      c.strokeStyle = 'rgba(42, 58, 70, 0.3)';
      c.setLineDash([2, 4]);
      c.lineWidth = 1;
      const [zx, zz] = toMap(0, 0);
      for (const r of [400 * WS, 900 * WS]) {
        c.beginPath();
        c.arc(zx, zz, r * sc, 0, Math.PI * 2);
        c.stroke();
      }
      c.setLineDash([]);
    }

    // ── затишки біля гаваней і притулків ──
    c.strokeStyle = 'rgba(46,139,87,0.45)';
    c.lineWidth = 1;
    c.setLineDash([1, 4]);
    for (const h of havens()) {
      if (!inView(h.x, h.z, h.r)) continue;
      const [px, pz] = toMap(h.x, h.z);
      c.beginPath();
      c.arc(px, pz, h.r * sc, 0, Math.PI * 2);
      c.stroke();
    }
    c.setLineDash([]);

    // ── причали й сервіси (лише поблизу — далеко це дрібниці) ──
    if (!far) {
      c.fillStyle = '#b08a5a';
      {
        const [px, pz] = toMap(-24, -40);
        c.fillRect(px, pz, 48 * sc, 22 * sc);
      }
      for (const pr of SITE_PIERS) {
        if (!inView(pr.x0, pr.z0)) continue;
        const [px, pz] = toMap(pr.x0, pr.z0);
        c.fillRect(px, pz, Math.max(1.5, (pr.x1 - pr.x0) * sc), Math.max(1.5, (pr.z1 - pr.z0) * sc));
      }
      if (near) {
        c.fillStyle = INK;
        for (const p of [...PORT_POINTS.filter((q) => !q.mapHide), ...SITE_SVC]) {
          if (!inView(p.x, p.z)) continue;
          const [px, pz] = toMap(p.x, p.z);
          c.beginPath();
          c.arc(px, pz, 1.6, 0, Math.PI * 2);
          c.fill();
        }
      }
      // скелі
      c.strokeStyle = INK;
      c.lineWidth = 1.2;
      for (const r of rocks) {
        if (r.kind || !inView(r.x, r.z)) continue;
        const [px, pz] = toMap(r.x, r.z);
        c.beginPath();
        c.moveTo(px - 2.5, pz); c.lineTo(px + 2.5, pz);
        c.moveTo(px, pz - 2.5); c.lineTo(px, pz + 2.5);
        c.stroke();
      }
    }

    // ── рибні місця (чутки моряків) і стаї (радіозвіти) — видно завжди, головне на мінімапі ──
    // коло = там, де клює краще (радіус, на якому дія місця ще відчутна)
    const fishIcon = (px: number, pz: number, icon: string) => {
      c.font = '11px -apple-system, "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.fillText(icon, px, pz + 4);
    };
    for (const hs of HOTSPOTS) {
      if (!inView(hs.x, hs.z, hs.r * 1.2)) continue;
      const found = this.places.includes(hs.id);
      const [px, pz] = toMap(hs.x, hs.z);
      const rr = Math.max(7, hs.r * 1.1 * sc);
      const g = c.createRadialGradient(px, pz, 0, px, pz, rr);
      g.addColorStop(0, 'rgba(226,103,74,0.38)');
      g.addColorStop(1, 'rgba(226,103,74,0.10)');
      c.beginPath();
      c.arc(px, pz, rr, 0, Math.PI * 2);
      c.fillStyle = g;
      c.fill();
      c.setLineDash(found ? [] : [4, 3]);
      c.lineWidth = 1.8;
      c.strokeStyle = 'rgba(200,80,52,0.9)';
      c.stroke();
      c.setLineDash([]);
      fishIcon(px, pz, '🎣');
    }
    for (const r of this.reports) {
      const [ax, az] = SCHOOL_ANCHORS[r.zone];
      if (!inView(ax, az, SCHOOL_R * 1.2)) continue;
      const [px, pz] = toMap(ax, az);
      const rr = Math.max(7, SCHOOL_R * 1.1 * sc);
      const g = c.createRadialGradient(px, pz, 0, px, pz, rr);
      g.addColorStop(0, 'rgba(36,135,140,0.34)');
      g.addColorStop(1, 'rgba(36,135,140,0.08)');
      c.beginPath();
      c.arc(px, pz, rr, 0, Math.PI * 2);
      c.fillStyle = g;
      c.fill();
      c.setLineDash([3, 3]);
      c.strokeStyle = 'rgba(29,111,115,0.9)';
      c.lineWidth = 1.8;
      c.stroke();
      c.setLineDash([]);
      fishIcon(px, pz, '🐟');
    }

    // ── буї сіток (за межею кола — притиснуті до краю, видно напрямок) ──
    for (const b of this.buoys) {
      for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z1]]) {
        const [px, pz] = toMap(x, z);
        const dx = px - cx, dz = pz - cx;
        const d = Math.hypot(dx, dz);
        const k = d > R - 6 ? (R - 6) / d : 1;
        c.beginPath();
        c.arc(cx + dx * k, cx + dz * k, 2.8, 0, Math.PI * 2);
        c.fillStyle = '#e9592f';
        c.fill();
      }
    }

    // ── маршрути екіпажу — тонко, кольором гравця (капітанський — від яхти) ──
    for (const cr of this.crew) {
      if (!cr.pts.length) continue;
      c.strokeStyle = cr.color;
      c.globalAlpha = 0.8;
      c.lineWidth = 1.5;
      c.setLineDash([2, 3]);
      c.beginPath();
      const [sx, sz] = cr.captain ? [cx, cx] : toMap(cr.pts[0].x, cr.pts[0].z);
      c.moveTo(sx, sz);
      for (const p of cr.pts) c.lineTo(...toMap(p.x, p.z));
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = cr.color;
      for (const p of cr.pts) {
        const [px, pz] = toMap(p.x, p.z);
        c.beginPath();
        c.arc(px, pz, 2.3, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }

    // ── маршрут (GPS): від яхти через точки, пурпурний як на плотері ──
    if (this.route.length) {
      c.strokeStyle = 'rgba(214,51,180,0.85)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx, cx);
      for (const p of this.route) c.lineTo(...toMap(p.x, p.z));
      c.stroke();
      c.fillStyle = '#d633b4';
      for (const p of this.route) {
        const [px, pz] = toMap(p.x, p.z);
        c.beginPath();
        c.arc(px, pz, 2.6, 0, Math.PI * 2);
        c.fill();
      }
    }

    // ── судна — сірі трикутнички (без AIS — лише ближні, видно оком) ──
    for (const b of this.bots) {
      const [px, pz] = toMap(b.x, b.z);
      if (Math.hypot(px - cx, pz - cx) > R - 4) continue;
      if (!this.ais && Math.hypot(b.x - boatX, b.z - boatZ) > 120) continue;
      c.fillStyle = 'rgba(42,58,70,0.6)';
      c.save();
      c.translate(px, pz);
      c.rotate(-b.h + Math.PI);
      c.beginPath();
      c.moveTo(0, -4.5);
      c.lineTo(3, 3.5);
      c.lineTo(-3, 3.5);
      c.closePath();
      c.fill();
      c.restore();
      if (this.ais && b.name && near) label(b.name, px + 4, pz - 6, `700 8.5px ${FONT}`, 'rgba(42,58,70,0.85)');
    }

    // ── друзі поза човном (на борту вони й так у центрі) ──
    for (const f of this.friends) {
      if (f.onBoat) continue;
      const [px, pz] = toMap(f.x, f.z);
      const dx = px - cx, dz = pz - cx;
      const d = Math.hypot(dx, dz);
      const k = d > R - 7 ? (R - 7) / d : 1;
      c.beginPath();
      c.arc(cx + dx * k, cx + dz * k, 3.6, 0, Math.PI * 2);
      c.fillStyle = f.color;
      c.fill();
      c.strokeStyle = 'rgba(255,250,240,0.85)';
      c.lineWidth = 1.2;
      c.stroke();
    }

    // ── значки: гавані, притулки, доставки, рибні місця ──
    const anchor = (px: number, pz: number, found: boolean) => {
      c.beginPath();
      c.arc(px, pz, 5.5, 0, Math.PI * 2);
      c.fillStyle = found ? INK : 'rgba(42,58,70,0.45)';
      c.fill();
      c.lineWidth = 1.2;
      c.strokeStyle = '#fffaf0';
      c.stroke();
      c.font = `8px -apple-system, "Segoe UI", sans-serif`;
      c.textAlign = 'center';
      c.fillStyle = '#fffaf0';
      c.fillText('⚓', px, pz + 3);
    };
    const destIds = new Set(this.gps ? this.orders.map((o) => o.to) : []);
    const ports = [{ id: 'home', x: HOME.x, z: HOME.z, name: HOME.name, found: true }, ...PORTS.map((p) => ({ id: p.id, x: p.x, z: p.z, name: p.name, found: this.places.includes(p.id) }))];
    for (const p of ports) {
      if (!inView(p.x, p.z)) continue;
      const [px, pz] = toMap(p.x, p.z);
      anchor(px, pz, p.found);
      if (destIds.has(p.id)) {
        c.font = '12px -apple-system, "Segoe UI", sans-serif';
        c.textAlign = 'center';
        c.fillText('📦', px + 9, pz - 4);
      }
    }
    for (const d of REFUGES) {
      if (!inView(d.x, d.z)) continue;
      const [px, pz] = toMap(d.x, d.z);
      c.fillStyle = '#f2c14e';
      c.strokeStyle = INK;
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 2.4 : 5.5;
        c[i ? 'lineTo' : 'moveTo'](px + Math.cos(a) * r, pz + Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
      c.stroke();
    }
    // пам'ятки в морі (шхуна, маяки, галера, буй…) — ромбик; відкриті — помаранчеві, ще ні — «?»
    for (const l of SIGHTS) {
      if (!inView(l.x, l.z)) continue;
      const [px, pz] = toMap(l.x, l.z);
      const found = this.places.includes(l.id);
      c.beginPath();
      c.moveTo(px, pz - 5); c.lineTo(px + 4.5, pz); c.lineTo(px, pz + 5); c.lineTo(px - 4.5, pz);
      c.closePath();
      c.fillStyle = found ? '#e2674a' : 'rgba(255,250,240,0.85)';
      c.fill();
      c.lineWidth = 1.1;
      c.strokeStyle = found ? '#fffaf0' : 'rgba(42,58,70,0.6)';
      c.stroke();
      if (!found) {
        c.font = `800 7px ${FONT}`;
        c.textAlign = 'center';
        c.fillStyle = 'rgba(42,58,70,0.8)';
        c.fillText('?', px, pz + 2.5);
      }
    }
    // підписи за пріоритетом: доставка → рибні місця → стаї → гавані → райони → континенти → притулки
    const pill = `800 9px ${FONT}`;
    for (const p of ports) {
      if (!destIds.has(p.id) || !inView(p.x, p.z)) continue;
      const [px, pz] = toMap(p.x, p.z);
      label(`📦 ${p.name}`, px, pz - 9, pill, '#a8620f', true);
    }
    for (const hs of HOTSPOTS) {
      if (!inView(hs.x, hs.z)) continue;
      const [px, pz] = toMap(hs.x, hs.z);
      const found = this.places.includes(hs.id);
      const rr = Math.max(7, hs.r * 1.1 * sc);
      const name = found ? hs.name : L('рибне місце', 'fishing ground');
      label(`${name} ${'⚠'.repeat(hs.risk)}`, px, pz + Math.min(rr, 30) + 10, `800 8.5px ${FONT}`, '#a8432c', true);
    }
    for (const r of this.reports) {
      const [ax, az] = SCHOOL_ANCHORS[r.zone];
      if (!inView(ax, az)) continue;
      const [px, pz] = toMap(ax, az);
      const rr = Math.max(7, SCHOOL_R * 1.1 * sc);
      label(`${L('стая', 'school')}: ${this.speciesName(r.speciesId)}`, px, pz + Math.min(rr, 30) + 10, `800 8.5px ${FONT}`, '#1d6f73', true);
    }
    for (const l of SIGHTS) {
      if (!inView(l.x, l.z) || !this.places.includes(l.id)) continue;
      const [px, pz] = toMap(l.x, l.z);
      label(l.name, px, pz - 9, `800 8.5px ${FONT}`, '#b5502f', true);
    }
    if (!near) {
      for (const p of ports) {
        if (destIds.has(p.id) || !inView(p.x, p.z)) continue;
        const [px, pz] = toMap(p.x, p.z);
        label(p.found ? p.name : `${p.name} ?`, px, pz - 9, pill, p.found ? INK : 'rgba(42,58,70,0.6)', true);
      }
    }
    for (const a of [...ROUGH, ...CALM]) {
      if (!inView(a.x, a.z)) continue;
      const [px, pz] = toMap(a.x, a.z);
      const calm = a.k < 0;
      label(`${calm ? '☀' : '⚠'} ${a.name}`, px, pz - 14, `700 8.5px ${FONT}`, calm ? 'rgba(29,111,115,0.9)' : 'rgba(70,86,104,0.95)');
    }
    for (const l of CONTS) {
      if (!inView(l.x, l.z, 400)) continue;
      const [px, pz] = toMap(l.x, l.z);
      label(l.name.toUpperCase(), px, pz + 4, `800 ${far ? 9.5 : 10.5}px ${FONT}`, 'rgba(42,58,70,0.75)');
    }
    for (const d of REFUGES) {
      if (!inView(d.x, d.z)) continue;
      const [px, pz] = toMap(d.x, d.z);
      label(d.name, px, pz + 15, `700 8.5px ${FONT}`, 'rgba(42,58,70,0.8)');
    }

    // ── поза кадром — значок на краю: куди везти вантаж і найближчі рибні місця ──
    const edge = (x: number, z: number, txt: string, color: string) => {
      const dx = x - boatX, dz = z - boatZ;
      const d = Math.hypot(dx, dz);
      if (d * sc < R - 12) return;
      const ux = dx / d, uz = dz / d;
      const ex = cx + ux * (R - 7), ez = cx + uz * (R - 7);
      c.save();
      c.translate(ex, ez);
      c.rotate(Math.atan2(uz, ux));
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(5, 0);
      c.lineTo(-3, -4);
      c.lineTo(-3, 4);
      c.closePath();
      c.fill();
      c.restore();
      const km = d >= 1000 ? `${(d / 1000).toFixed(1).replace('.', L(',', '.'))} ${L('км', 'km')}` : `${Math.round(d / 10) * 10} ${L('м', 'm')}`;
      const t = `${txt} ${km}`;
      c.font = `800 8.5px ${FONT}`;
      const w = c.measureText(t).width + 8;
      // відступ від краю так, щоб уся плашка вмістилась у коло
      const inset = 14 + Math.abs(ux) * w / 2 + Math.abs(uz) * 7;
      label(t, cx + ux * (R - inset), cx + uz * (R - inset) + 3, `800 8.5px ${FONT}`, color, true);
    };
    for (const o of this.gps ? this.orders : []) {
      const dk = DOCK_BY_ID[o.to];
      if (dk) edge(dk.x, dk.z, `📦 ${dk.name}`, '#a8620f');
    }
    // два найближчі рибні місця/стаї поза кадром (до 2,5 км) — куди плисти по рибу
    const grounds = [
      ...HOTSPOTS.map((h) => ({ x: h.x, z: h.z, t: '🎣', col: '#a8432c' })),
      ...this.reports.map((r) => ({ x: SCHOOL_ANCHORS[r.zone][0], z: SCHOOL_ANCHORS[r.zone][1], t: '🐟', col: '#1d6f73' })),
    ]
      .map((g) => ({ ...g, d: Math.hypot(g.x - boatX, g.z - boatZ) }))
      .filter((g) => g.d * sc > R - 12 && g.d < 2500)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const g of grounds) edge(g.x, g.z, g.t, g.col);

    // ── ніч — карта в тіні ──
    if (night) {
      c.fillStyle = 'rgba(14, 22, 40, 0.4)';
      c.fillRect(0, 0, s, s);
    }

    // ── масштаб: радіус огляду (N — перемкнути) ──
    {
      const t = `${this.rangeText()} · N`;
      c.font = `800 8.5px ${FONT}`;
      const w = c.measureText(t).width + 10;
      c.fillStyle = 'rgba(255,250,240,0.8)';
      c.beginPath();
      const x = cx - R * 0.5, y = cx + R * 0.74;
      c.roundRect(x - w / 2, y - 7, w, 13, 6.5);
      c.fill();
      c.textAlign = 'center';
      c.fillStyle = INK;
      c.fillText(t, x, y + 2.5);
    }
  }

  /** «тут клює краще чи ні»: рибне місце / стая / зона — плашка під мінімапою й колір рамки */
  private updateBadge(x: number, z: number) {
    const hs = hotspotAt(x, z);
    const spot = fishingSpot(x, z, this.reports);
    let kind = 'zone', text = '';
    if (hs.spot && hs.hot > 0.4) {
      kind = 'hot';
      const name = this.places.includes(hs.spot.id) ? hs.spot.name : L('Рибне місце', 'Fishing ground');
      text = `🎣 ${name} ${'⚠'.repeat(hs.spot.risk)} · ${L('риба', 'fish')} ×${spot.kgMul.toFixed(1).replace('.', L(',', '.'))}`;
    } else {
      let best = 0, sp = '';
      for (const r of this.reports) {
        const [ax, az] = SCHOOL_ANCHORS[r.zone];
        const q = Math.hypot(x - ax, z - az) / SCHOOL_R;
        const h = Math.exp(-q * q);
        if (h > best) { best = h; sp = r.speciesId; }
      }
      if (best > 0.45) {
        kind = 'school';
        text = `🐟 ${L('Стая', 'School')}: ${this.speciesName(sp)} · ${L('клює часто', 'quick bites')}`;
      } else {
        const zone = zoneFromDist(seaDist(x, z));
        const tip = zone === 'shore' ? L('клює швидко, риба дрібна', 'quick bites, small fish') : zone === 'mid' ? L('клює помірно', 'steady bites') : L('клює рідко, риба велика', 'slow bites, big fish');
        text = `${ZONE_NAMES[zone]} · ${tip}`;
      }
    }
    const key = kind + text;
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    this.badge.textContent = text;
    this.badge.className = `mm-badge ${kind}`;
    this.canvas.classList.toggle('mm-hot', kind === 'hot');
    this.canvas.classList.toggle('mm-school', kind === 'school');
  }

  /** оглядова підкладка світу (12 м/піксель) — рахується частинами, щоб не гальмувати кадр */
  private buildOverview(budgetMs: number) {
    if (this.overRow >= OH) return;
    const t0 = performance.now();
    const d = this.overImg.data;
    while (this.overRow < OH && performance.now() - t0 < budgetMs) {
      const j = this.overRow++;
      const z = WORLD.H0 + j * OM;
      for (let i = 0; i < OW; i++) {
        const h = terrainHeight(WORLD.W0 + i * OM, z);
        if (h <= 0.05) continue;
        const o = (j * OW + i) * 4;
        const col = landCol(h, false);
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = 255;
      }
    }
    // контур берега — коли готово все
    if (this.overRow >= OH) {
      const a = new Uint8ClampedArray(d);
      for (let j = 0; j < OH; j++) {
        for (let i = 0; i < OW; i++) {
          const o = (j * OW + i) * 4;
          if (!a[o + 3]) continue;
          const wet = (di: number, dj: number) => {
            const ii = i + di, jj = j + dj;
            return ii < 0 || jj < 0 || ii >= OW || jj >= OH ? false : !a[(jj * OW + ii) * 4 + 3];
          };
          if (wet(1, 0) || wet(-1, 0) || wet(0, 1) || wet(0, -1)) {
            d[o] = 42;
            d[o + 1] = 58;
            d[o + 2] = 70;
          }
        }
      }
      this.layerT = 0;
    }
    this.over.getContext('2d')!.putImageData(this.overImg, 0, 0);
  }

  /** підкладка одного суходолу (гавань / острів / плитка континенту) з islandHeight, 2 м на піксель */
  private extraLand(k: number): HTMLCanvasElement {
    if (this.extra[k]) return this.extra[k];
    const [x0, z0, x1, z1] = LANDS[k];
    const W = Math.ceil((x1 - x0) / LM), H = Math.ceil((z1 - z0) / LM);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(W, H);
    const d = img.data;
    const hs = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) hs[j * W + i] = islandHeight(x0 + i * LM, z0 + j * LM);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const h = hs[j * W + i];
        if (h <= 0.05) continue;
        const o = (j * W + i) * 4;
        const coast = (i > 0 && hs[j * W + i - 1] <= 0.05) || (j > 0 && hs[(j - 1) * W + i] <= 0.05) || (i < W - 1 && hs[j * W + i + 1] <= 0.05) || (j < H - 1 && hs[(j + 1) * W + i] <= 0.05);
        const col = landCol(h, coast);
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.extra[k] = cv;
    return cv;
  }

  /** суша домашнього берега (раз): пісок → трава → пагорби, берег чорнилом */
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
