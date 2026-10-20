import * as THREE from 'three';
import { DECK_Y, HOUSE, RIG, ARCH as STERN_ARCH, hullHalfWidth, sheerY } from './yachtLayout';
import { terrainHeight } from './portTerrain';
import { instrHas } from '../game/upgrades';
import type { PartKit } from './upgradeParts';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Прилади штурвала (апгрейд «Прилади», 0–5): від латунного компаса
// до радара й автопілота. Усе фізично стоїть на тумбі/даху кокпіту:
//  0 — великий компас у бінаклі з розміткою, лаг і стрілочний вітромір на ногах
//      поручня тумби, чашковий анемометр із флюгером на щоглі, вимпели на вантах;
//  1 — пульт: тахометр, паливо (стрілки yachtModel), лаг переїжджає на пульт + барометр;
//  2 — багатофункціональний дисплей (вітер, цифри) + глибина з сигналом мілини;
//  3 — арка над пультом і GPS-картплотер (карта, маршрут), грибок антени на даху;
//  4 — екран ехолота-рибошукача (дно, «дуги» риби);
//  5 — радар (обтічник на даху, екран з ехом берега й суден, AIS) + автопілот.
// Екрани — CanvasTexture, перемальовуються 3–8 разів на секунду.
// ─────────────────────────────────────────────────────────────

export interface InstrFrame {
  x: number;
  z: number;
  heading: number;
  /** м/с над ґрунтом */
  speed: number;
  /** вимпельний вітер: кут від носа (°), з правого борту, сила м/с */
  awa: number;
  aws: number;
  fromStarboard: boolean;
  /** тиск, гПа, і чи падає (шторм іде) */
  hpa: number;
  falling: boolean;
  route: Array<{ x: number; z: number }>;
  boats: Array<{ x: number; z: number; h: number; name: string }>;
  rocks: Array<{ x: number; z: number; r: number; kind?: string }>;
  /** густота риби під кілем 0..1 і найближча зграя */
  fish: number;
  school: { x: number; z: number; name: string } | null;
  autopilot: boolean;
  night: boolean;
}

/** = yachtModel.HELM_DZ (без імпорту: yachtModel → upgradeParts → сюди) */
const HELM_DZ = -0.45;
const POD = new THREE.Vector3(0, DECK_Y + 1.1, -2.98);
const TILT = 0.55;
/** «вгору по схилу» пульта й нормаль його верхньої грані */
const U = new THREE.Vector3(0, Math.sin(TILT), Math.cos(TILT));
const N = new THREE.Vector3(0, Math.cos(TILT), -Math.sin(TILT));
const FACE_Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), U.clone(), N.clone()));
/** арка з екранами над пультом */
const ARCH = { y: DECK_Y + 1.29, z: -2.55, w: 1.3 };
const SCREEN_TILT = 0.2;
const SCREEN_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(SCREEN_TILT, Math.PI, 0));

const FONT = '-apple-system, "Segoe UI", sans-serif';
const P8 = [L('П', `N`), L('ПнСх', `NE`), L('Сх', `E`), L('ПдСх', `SE`), L('Пд', `S`), L('ПдЗх', `SW`), L('Зх', `W`), L('ПнЗх', `NW`)];

export function compass8(deg: number): string {
  return P8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
/** азимут 0 = північ (−Z), за годинниковою */
export function bearingDeg(fx: number, fz: number, tx: number, tz: number): number {
  const b = (Math.atan2(tx - fx, -(tz - fz)) * 180) / Math.PI;
  return b < 0 ? b + 360 : b;
}
function fmtDist(d: number): string {
  return d >= 1000 ? (d / 1000).toFixed(1).replace('.', L(',', '.')) + L(' км', ` km`) : Math.round(d) + L(' м', ` m`);
}
/**
 * висота дна для приладів: як terrainHeight, але перед набережною рельєф —
 * плоска «ванна» −4,5 м аж до краю мапи; там ехолот показує природний схил
 */
export function seabed(x: number, z: number): number {
  const h = terrainHeight(x, z);
  if (h === -4.5 && Math.abs(x) <= 60 && z > -40) return -Math.max(4.5, 4.5 + (z - 10) * 0.3);
  return h;
}
/** глибина під точкою (м, ≥ 0) */
export function depthAt(x: number, z: number): number {
  return Math.max(0, -seabed(x, z));
}

class Screen {
  readonly mesh: THREE.Mesh;
  readonly ctx: CanvasRenderingContext2D;
  readonly cv: HTMLCanvasElement;
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshBasicMaterial;
  t = 0;
  /** куплено (інакше не малюємо) */
  on = false;

  constructor(readonly w: number, readonly h: number, sizeX: number, sizeY: number) {
    this.cv = document.createElement('canvas');
    this.cv.width = w;
    this.cv.height = h;
    this.ctx = this.cv.getContext('2d')!;
    this.ctx.fillStyle = '#050b10';
    this.ctx.fillRect(0, 0, w, h);
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeY), this.mat);
  }

  due(dt: number, period: number): boolean {
    this.t -= dt;
    if (this.t > 0 || !this.on) return false;
    this.t = period;
    return true;
  }

  done(night: boolean) {
    this.tex.needsUpdate = true;
    // уночі екрани приглушені (щоб не сліпили)
    this.mat.color.setScalar(night ? 0.72 : 1);
  }
}

/** латунна оправа / корпус екрана навколо площини */
function bezel(k: PartKit, w: number, h: number, d = 0.035): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, d), k.mat(0x15191d, 0.45, 0.35));
  return m;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ── циферблати ──

function compassCardTex(): THREE.CanvasTexture {
  return canvasTex(512, 512, (g) => {
    const C = 256;
    g.fillStyle = '#f3ead2';
    g.beginPath(); g.arc(C, C, 252, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2a2a2a';
    // розмітка: кожні 5°, довші — 15° і 45°
    for (let d = 0; d < 360; d += 5) {
      const a = (d * Math.PI) / 180;
      const L = d % 45 === 0 ? 40 : d % 15 === 0 ? 26 : 14;
      g.lineWidth = d % 45 === 0 ? 5 : d % 15 === 0 ? 3 : 2;
      g.beginPath();
      g.moveTo(C + Math.sin(a) * (244 - L), C - Math.cos(a) * (244 - L));
      g.lineTo(C + Math.sin(a) * 244, C - Math.cos(a) * 244);
      g.stroke();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // числа градусів кожні 30° (окрім сторін світу)
    g.font = `800 26px ${FONT}`;
    g.fillStyle = '#2a3a46';
    for (let d = 30; d < 360; d += 30) {
      if (d % 90 === 0) continue;
      const a = (d * Math.PI) / 180;
      g.save();
      g.translate(C + Math.sin(a) * 182, C - Math.cos(a) * 182);
      g.rotate(a);
      g.fillText(String(d), 0, 0);
      g.restore();
    }
    // роза
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const L = i % 2 === 0 ? 140 : 84;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(C, C);
        g.lineTo(C + Math.sin(a) * L, C - Math.cos(a) * L);
        g.lineTo(C + Math.sin(a + s * 0.22) * 30, C - Math.cos(a + s * 0.22) * 30);
        g.closePath();
        g.fillStyle = i === 0 ? (s < 0 ? '#c0392b' : '#e2674a') : s < 0 ? '#2a3a46' : '#8b97a0';
        g.fill();
      }
    }
    // сторони світу — великі, «П» червона
    const big = (t: string, d: number, col: string) => {
      const a = (d * Math.PI) / 180;
      g.save();
      g.translate(C + Math.sin(a) * 182, C - Math.cos(a) * 182);
      g.rotate(a);
      g.font = `900 52px ${FONT}`;
      g.fillStyle = col;
      g.fillText(t, 0, 0);
      g.restore();
    };
    big(L('П', 'N'), 0, '#c0392b');
    big(L('Сх', 'E'), 90, '#2a3a46');
    big(L('Пд', 'S'), 180, '#2a3a46');
    big(L('Зх', 'W'), 270, '#2a3a46');
  });
}

/** вітромір: силует яхти, кут вимпельного вітру (червона стрілка) і сила (мала шкала) */
function windFaceTex(): THREE.CanvasTexture {
  return canvasTex(256, 256, (g) => {
    const C = 128;
    g.fillStyle = '#10171d';
    g.beginPath(); g.arc(C, C, 126, 0, Math.PI * 2); g.fill();
    // лівий борт — червоний сектор, правий — зелений (верх — ніс; правий борт — праворуч)
    for (const [s, col] of [[-1, 'rgba(208,52,44,0.9)'], [1, 'rgba(46,170,96,0.9)']] as const) {
      g.strokeStyle = col;
      g.lineWidth = 10;
      g.beginPath();
      const a0 = -Math.PI / 2 + s * 0.35, a1 = -Math.PI / 2 + s * (Math.PI / 3);
      g.arc(C, C, 112, Math.min(a0, a1), Math.max(a0, a1));
      g.stroke();
    }
    g.strokeStyle = '#e8eef2';
    for (let d = 0; d < 360; d += 10) {
      const a = (d * Math.PI) / 180;
      const major = d % 30 === 0;
      g.lineWidth = major ? 3 : 1.4;
      g.beginPath();
      g.moveTo(C + Math.sin(a) * (major ? 96 : 104), C - Math.cos(a) * (major ? 96 : 104));
      g.lineTo(C + Math.sin(a) * 116, C - Math.cos(a) * 116);
      g.stroke();
    }
    g.font = `700 15px ${FONT}`;
    g.fillStyle = '#e8eef2';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const d of [30, 60, 90, 120, 150]) {
      for (const s of [-1, 1]) {
        const a = (s * d * Math.PI) / 180;
        g.fillText(String(d), C + Math.sin(a) * 80, C - Math.cos(a) * 80);
      }
    }
    // силует яхти (ніс угору)
    g.fillStyle = '#5f7686';
    g.beginPath();
    g.moveTo(C, C - 46);
    g.quadraticCurveTo(C + 22, C - 10, C + 16, C + 30);
    g.lineTo(C - 16, C + 30);
    g.quadraticCurveTo(C - 22, C - 10, C, C - 46);
    g.fill();
    // мала шкала сили вітру 0..25 м/с унизу
    g.strokeStyle = '#ffd36b';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(C, C + 62, 30, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
    g.font = `700 11px ${FONT}`;
    g.fillStyle = '#e8eef2';
    g.fillText('0', C - 34, C + 60);
    g.fillText('25', C + 36, C + 60);
    g.font = `800 12px ${FONT}`;
    g.fillStyle = '#ffd36b';
    g.fillText(L('ВІТЕР · м/с', `WIND · m/s`), C, C + 90);
  });
}

function baroFaceTex(): THREE.CanvasTexture {
  return canvasTex(256, 256, (g) => {
    const C = 128;
    g.fillStyle = '#f4ecd8';
    g.beginPath(); g.arc(C, C, 126, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a2f22';
    // шкала 960..1050 на 270° (зліва — шторм, справа — суш)
    const ang = (hpa: number) => ((135 + ((hpa - 960) / 90) * 270) * Math.PI) / 180;
    for (let p = 960; p <= 1050; p += 2) {
      const a = ang(p);
      const major = p % 10 === 0;
      g.lineWidth = major ? 2.5 : 1;
      g.beginPath();
      g.moveTo(C + Math.cos(a) * (major ? 96 : 104), C + Math.sin(a) * (major ? 96 : 104));
      g.lineTo(C + Math.cos(a) * 114, C + Math.sin(a) * 114);
      g.stroke();
      if (major && p % 20 === 0) {
        g.font = `700 15px ${FONT}`;
        g.fillStyle = '#3a2f22';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(p), C + Math.cos(a) * 80, C + Math.sin(a) * 80);
      }
    }
    const word = (hpa: number, t: string, col: string) => {
      const a = ang(hpa);
      g.save();
      g.translate(C + Math.cos(a) * 56, C + Math.sin(a) * 56);
      g.rotate(a + Math.PI / 2);
      g.font = `800 14px ${FONT}`;
      g.fillStyle = col;
      g.textAlign = 'center';
      g.fillText(t, 0, 0);
      g.restore();
    };
    word(972, L('ШТОРМ', `STORM`), '#b23a2e');
    word(992, L('ДОЩ', `RAIN`), '#5a6b78');
    word(1012, L('ЗМІННО', `CHANGE`), '#3a2f22');
    word(1036, L('ЯСНО', `FAIR`), '#a07a1c');
    g.font = `600 12px ${FONT}`;
    g.fillStyle = '#6b5d48';
    g.textAlign = 'center';
    g.fillText(L('гПа', `hPa`), C, C + 52);
  });
}

function needle(color: number, len: number, w = 0.008): THREE.Group {
  const n = new THREE.Group();
  n.add(new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.004).translate(0, len * 0.4, 0), new THREE.MeshBasicMaterial({ color })));
  return n;
}

export class HelmInstruments {
  readonly group = new THREE.Group();
  /** кнопка автопілота (для підсвітки) */
  readonly apButton = new THREE.Group();
  /** точка, куди дивитись, щоб натиснути автопілот (локаль яхти) */
  static readonly AP_LOOK = new THREE.Vector3(-0.22, DECK_Y + 0.9, -3.12 + HELM_DZ);

  level = 0;
  private card = new THREE.Group();
  private binnacle = new THREE.Group();
  private binTop = new THREE.Vector3();
  private cardMat!: THREE.MeshBasicMaterial;
  private binLampMat!: THREE.MeshBasicMaterial;
  /** 0: лаг і вітромір — на ногах поручня тумби (пульта ще немає) */
  private speedHome: { p: THREE.Vector3; q: THREE.Quaternion } | null = null;
  private postBases = new THREE.Group();
  private windDial = new THREE.Group();
  private windNeedle = new THREE.Group();
  private windSpeedNeedle = new THREE.Group();
  /** чашковий анемометр і флюгер на кронштейні щогли — видно з-за штурвала */
  private anemo = new THREE.Group();
  private anemoCups = new THREE.Group();
  private anemoVane = new THREE.Group();
  private windAwa = 0;
  private windAws = 0;
  private baro = new THREE.Group();
  private baroNeedle = new THREE.Group();
  private baroSet = new THREE.Group();
  private baroHpa = 1013;
  private baroRef = 1013;
  private arch = new THREE.Group();
  private gpsAnt = new THREE.Group();
  private radome = new THREE.Group();
  private radomeBar = new THREE.Object3D();
  private apHead = new THREE.Group();
  private apLampMat: THREE.MeshStandardMaterial;
  private telltales: Array<{ pivot: THREE.Group; ribbon: THREE.Mesh; phase: number }> = [];
  private plotter: Screen;
  private sonar: Screen;
  private radar: Screen;
  private radarEcho: HTMLCanvasElement;
  private radarAng = 0;
  private landKey = '';
  private land: HTMLCanvasElement;
  private landCx = 1e9;
  private landCz = 1e9;
  private sonarRange = 30;
  private t = 0;
  private alarmT = 0;
  /** колбек: мілина (глибина під кілем) — пискнути */
  onShallow: ((depth: number) => void) | null = null;
  private parts: Record<string, THREE.Object3D[]> = {};

  constructor(boatGroup: THREE.Group, panelParts: Record<string, THREE.Object3D[]>, k: PartKit) {
    this.parts = panelParts;
    const helm = new THREE.Group();
    helm.position.z = HELM_DZ;
    boatGroup.add(this.group);
    this.group.add(helm);

    // ── 0: компас у бінаклі на верхній крайці пульта ──
    this.binTop.copy(POD).addScaledVector(U, 0.2).addScaledVector(N, 0.06);
    const bin = this.binnacle;
    bin.position.copy(this.binTop);
    helm.add(bin);
    const brass = k.mat(0xc9a227, 0.3, 0.85);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.05, 20), k.mat(0x1f2328, 0.5, 0.4));
    plinth.position.y = 0.0;
    bin.add(plinth);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.07, 0.05, 24), brass);
    bowl.position.y = 0.05;
    bin.add(bowl);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.008, 6, 28), brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.075;
    bin.add(ring);
    // над кришкою чаші (верх циліндра — 0.075), інакше латунь закривала картку
    this.card.position.y = 0.079;
    this.cardMat = new THREE.MeshBasicMaterial({ map: compassCardTex() });
    const cardMesh = new THREE.Mesh(new THREE.CircleGeometry(0.084, 48), this.cardMat);
    cardMesh.rotation.x = -Math.PI / 2;
    // «П» картки (верх текстури) — на локальну −Z картки
    this.card.add(cardMesh);
    bin.add(this.card);
    // курсова риска (лабберлінія) — по носу
    const lub = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.03, 0.012), new THREE.MeshBasicMaterial({ color: 0xff3b2f }));
    lub.position.set(0, 0.09, 0.083);
    bin.add(lub);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.092, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xdff1ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.22 }),
    );
    dome.position.y = 0.075;
    bin.add(dome);
    // лампа бінакля: уночі картку підсвічує м'яке червоне світло
    this.binLampMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0 });
    const binLamp = new THREE.Mesh(new THREE.TorusGeometry(0.086, 0.006, 6, 28), this.binLampMat);
    binLamp.rotation.x = Math.PI / 2;
    binLamp.position.y = 0.08;
    bin.add(binLamp);

    // ── 0: лаг (праворуч) і стрілочний вітромір (ліворуч) на ногах поручня тумби ──
    helm.add(this.postBases);
    for (const sx of [-1, 1]) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.03, 0.07, 18), k.mat(0x1f2328, 0.5, 0.4));
      base.position.set(sx * 0.3, DECK_Y + 0.955, -2.95);
      this.postBases.add(base);
    }
    this.windDial.position.set(0.3, DECK_Y + 1.0, -2.95);
    this.windDial.quaternion.copy(FACE_Q);
    helm.add(this.windDial);
    this.windDial.add(new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 6, 24), k.mat(0xc9ced3, 0.25, 0.9)));
    const wf = new THREE.Mesh(new THREE.CircleGeometry(0.1, 36), new THREE.MeshBasicMaterial({ map: windFaceTex() }));
    wf.position.z = 0.002;
    this.windDial.add(wf);
    this.windSpeedNeedle = needle(0xffd36b, 0.03, 0.005);
    this.windSpeedNeedle.position.set(0, -0.0484, 0.006);
    this.windDial.add(this.windSpeedNeedle);
    this.windNeedle = needle(0xff4a3a, 0.095, 0.009);
    this.windNeedle.position.z = 0.008;
    this.windDial.add(this.windNeedle);
    const wcap = new THREE.Mesh(new THREE.CircleGeometry(0.012, 12), new THREE.MeshBasicMaterial({ color: 0x111417 }));
    wcap.position.z = 0.012;
    this.windDial.add(wcap);

    // вимпели на нижніх вантах (видно з-за штурвала напрям вимпельного вітру)
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      const MZ = RIG.mastZ;
      const c = new THREE.Vector3(sx * (hullHalfWidth(MZ) - 0.12), sheerY(MZ), MZ - 0.1);
      pivot.position.copy(c).lerp(new THREE.Vector3(sx * 0.95, HOUSE.top + 4.32, MZ - 0.1), 0.3);
      this.group.add(pivot);
      const ribbon = new THREE.Mesh(
        new THREE.PlaneGeometry(0.035, 0.34).translate(0, -0.17, 0),
        new THREE.MeshStandardMaterial({ color: sx > 0 ? 0xd0342c : 0x2e8b57, side: THREE.DoubleSide, roughness: 0.8 }),
      );
      pivot.add(ribbon);
      this.telltales.push({ pivot, ribbon, phase: sx * 1.7 });
    }

    // чашковий анемометр + флюгер на кронштейні щогли (над гіком): крутиться з вітром
    {
      const steelA = k.mat(0xc9ced3, 0.25, 0.9);
      const blackA = k.mat(0x1c2126, 0.5, 0.3);
      // над гіком (≈1.3 м), збоку щогли — від штурвала видно, як крутяться чашки
      this.anemo.position.set(0.66, HOUSE.top + 2.95, RIG.mastZ + 0.1);
      this.group.add(this.anemo);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42), steelA);
      arm.rotation.z = Math.PI / 2;
      arm.position.x = -0.21;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32), steelA);
      post.position.y = 0.16;
      this.anemo.add(arm, post);
      // чашки — на хрестовині, що крутиться
      this.anemoCups.position.y = 0.2;
      this.anemo.add(this.anemoCups);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.15), steelA);
        spoke.rotation.set(0, -a, Math.PI / 2);
        spoke.position.set(Math.cos(a) * 0.075, 0, Math.sin(a) * 0.075);
        // відкритий бік чашки — по дотичній (ловить вітер з одного боку)
        const cupWrap = new THREE.Group();
        cupWrap.position.set(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15);
        cupWrap.rotation.y = -a;
        const cm = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), blackA);
        cm.rotation.x = Math.PI / 2;
        cupWrap.add(cm);
        this.anemoCups.add(spoke, cupWrap);
      }
      this.anemoCups.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 10), steelA));
      // флюгер вище: стрілка дивиться туди, звідки дме вимпельний вітер
      this.anemoVane.position.y = 0.32;
      this.anemo.add(this.anemoVane);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.36), steelA);
      shaft.rotation.x = Math.PI / 2;
      const tipV = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 8), k.mat(0xd0342c, 0.5, 0.1));
      tipV.rotation.x = Math.PI / 2;
      tipV.position.z = 0.2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.09, 0.12), k.mat(0xf2c12e, 0.5, 0.1));
      fin.position.z = -0.17;
      this.anemoVane.add(shaft, tipV, fin, new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 8), steelA));
      this.anemo.scale.setScalar(1.6);
    }

    // ── 1: латунний барометр у крайньому правому гнізді пульта ──
    this.baro.position.copy(POD).set(-0.55, POD.y, POD.z).addScaledVector(N, 0.065);
    this.baro.quaternion.copy(FACE_Q);
    helm.add(this.baro);
    const bz = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.014, 8, 28), brass);
    this.baro.add(bz);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.1, 36), new THREE.MeshBasicMaterial({ map: baroFaceTex() }));
    face.position.z = 0.002;
    this.baro.add(face);
    this.baroSet = needle(0xc9a227, 0.085, 0.006);
    this.baroSet.position.z = 0.005;
    this.baro.add(this.baroSet);
    this.baroNeedle = needle(0x1d1d1d, 0.09, 0.009);
    this.baroNeedle.position.z = 0.008;
    this.baro.add(this.baroNeedle);

    // ── 3–5: арка над пультом з екранами ──
    helm.add(this.arch);
    const steel = k.mat(0xc9ced3, 0.25, 0.9);
    const dark = k.mat(0x1c2126, 0.5, 0.4);
    // стійки арки — від підлоги кокпіту
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, ARCH.y - DECK_Y), steel);
      post.position.set(sx * (ARCH.w / 2), (ARCH.y + DECK_Y) / 2, ARCH.z + 0.02);
      this.arch.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, ARCH.w + 0.04, 10), steel);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, ARCH.y, ARCH.z + 0.02);
    this.arch.add(bar);
    const mountScreen = (s: Screen, x: number, w: number, h: number) => {
      const holder = new THREE.Group();
      holder.position.set(x, ARCH.y + h / 2 + 0.03, ARCH.z);
      holder.quaternion.copy(SCREEN_Q);
      const b = bezel(k, w, h);
      b.position.z = -0.019;
      holder.add(b);
      s.mesh.position.z = 0.0;
      holder.add(s.mesh);
      // кронштейн до труби
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), dark);
      br.position.set(0, -h / 2 - 0.015, -0.03);
      holder.add(br);
      this.arch.add(holder);
      return holder;
    };
    // зліва від стерновика (+X) — ехолот, по центру — плотер, праворуч — радар
    this.plotter = new Screen(512, 340, 0.36, 0.239);
    this.sonar = new Screen(320, 256, 0.25, 0.2);
    this.radar = new Screen(320, 320, 0.22, 0.22);
    mountScreen(this.plotter, 0, 0.36, 0.239).userData.lvl = 3;
    mountScreen(this.sonar, 0.4, 0.25, 0.2).userData.lvl = 4;
    mountScreen(this.radar, -0.39, 0.22, 0.22).userData.lvl = 5;
    this.radarEcho = document.createElement('canvas');
    this.radarEcho.width = this.radarEcho.height = 320;
    this.land = document.createElement('canvas');
    this.land.width = 128;
    this.land.height = 85;

    // GPS-антена-грибок на кормовій дузі й обтічник радара на щоглі (на кронштейні)
    const white = k.mat(0xf3f1ea, 0.45, 0.05);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 16), white);
    ant.position.y = 0.035;
    const antTop = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), white);
    antTop.position.y = 0.07;
    const antPole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12), steel);
    antPole.position.y = -0.04;
    this.gpsAnt.add(ant, antTop, antPole);
    this.gpsAnt.position.set(-(STERN_ARCH.x - 0.12), STERN_ARCH.y + 0.12, STERN_ARCH.z1 + 0.02);
    this.group.add(this.gpsAnt);
    const rd = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 28), white);
    rd.position.y = 0.16;
    const rdTop = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.03, 28), white);
    rdTop.position.y = 0.255;
    const rdBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.08, 14), dark);
    rdBase.position.y = 0.04;
    this.radome.add(rd, rdTop, rdBase);
    // тонка смужка-«промінь» під кришкою — обертається (видно здалеку)
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.03), new THREE.MeshBasicMaterial({ color: 0x9fb4c0 }));
    beam.position.y = 0.16;
    this.radomeBar = beam;
    this.radome.add(beam);
    // кронштейн на передній стінці щогли (висота ~3.6 м над рубкою — над гіком і краспицями нижче)
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.42), steel);
    bracket.position.set(0, -0.015, -0.12);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42), steel);
    strut.position.set(0, -0.2, -0.24);
    strut.rotation.x = 0.85;
    this.radome.add(bracket, strut);
    this.radome.position.set(0, HOUSE.top + 3.55, RIG.mastZ + 0.3);
    this.group.add(this.radome);

    // ── 5: пульт автопілота на тумбі (ліворуч від газу, для правої руки) ──
    this.apHead.position.set(-0.22, DECK_Y + 0.9, -3.08);
    helm.add(this.apHead);
    const apBox = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.11, 0.05), dark);
    this.apHead.add(apBox);
    const apScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.11, 0.035),
      new THREE.MeshBasicMaterial({ map: canvasTex(128, 40, (g) => {
        g.fillStyle = '#0a1a14';
        g.fillRect(0, 0, 128, 40);
        g.fillStyle = '#7dffb0';
        g.font = `800 22px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(L('АВТОПІЛОТ', `AUTOPILOT`), 64, 21);
      }), toneMapped: false }),
    );
    apScreen.position.set(0, 0.025, -0.026);
    apScreen.rotation.y = Math.PI;
    this.apHead.add(apScreen);
    this.apLampMat = new THREE.MeshStandardMaterial({ color: 0x3a1010, emissive: 0xff3b2f, emissiveIntensity: 0.6, roughness: 0.4 });
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16), this.apLampMat);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(0, -0.022, -0.03);
    this.apButton.add(btn, apBox);
    this.apHead.add(this.apButton);

    this.setLevel(0);
  }

  setLevel(l: number) {
    this.level = l;
    const f = instrHas(l);
    const show = (key: string, on: boolean) => {
      for (const o of this.parts[key] ?? []) o.visible = on;
    };
    // стара цифрова «компасна» шкала — замінена бінаклем і барометром
    show('compass', false);
    // 0: пульта ще немає — великий компас стоїть просто на тумбі,
    //    лаг і вітромір — на ногах поручня
    show('pod', f.gauges);
    if (f.gauges) {
      this.binnacle.position.copy(this.binTop);
      this.binnacle.scale.setScalar(1);
    } else {
      this.binnacle.position.set(0, DECK_Y + 1.02, -3.0);
      this.binnacle.scale.setScalar(1.45);
    }
    show('rpm', f.gauges);
    show('fuel', f.gauges);
    show('speed', true);
    const sd = this.parts.speed?.[0];
    if (sd) {
      this.speedHome ??= { p: sd.position.clone(), q: sd.quaternion.clone() };
      if (f.gauges) {
        sd.position.copy(this.speedHome.p);
        sd.quaternion.copy(this.speedHome.q);
      } else {
        sd.position.set(-0.3, DECK_Y + 1.0, -2.95);
        sd.quaternion.copy(FACE_Q);
      }
    }
    this.postBases.visible = !f.gauges;
    this.windDial.visible = !f.gauges;
    show('mfd', f.depth);
    this.baro.visible = f.gauges;
    this.arch.visible = f.gps;
    for (const c of this.arch.children) if (c.userData.lvl) c.visible = l >= c.userData.lvl;
    this.gpsAnt.visible = f.gps;
    this.radome.visible = f.radar;
    this.apHead.visible = f.radar;
    this.plotter.on = f.gps;
    this.sonar.on = f.sonar;
    this.radar.on = f.radar;
  }

  update(dt: number, f: InstrFrame) {
    this.t += dt;
    // картка компаса тримає північ (відносно човна — проти курсу)
    this.card.rotation.y = -f.heading;
    // вимпели: тягнуться за вимпельним вітром, слабкий — обвисають
    const a = (f.awa * Math.PI) / 180;
    const vx = f.fromStarboard ? Math.sin(a) : -Math.sin(a);
    const vz = -Math.cos(a);
    const k = Math.min(1, f.aws / 7);
    for (const tt of this.telltales) {
      tt.pivot.rotation.set(0, 0, 0);
      tt.pivot.rotation.y = Math.atan2(vx, vz);
      const flap = Math.sin(this.t * (6 + f.aws) + tt.phase) * 0.15 * k;
      tt.pivot.rotation.x = 0;
      // нахил від вертикалі до горизонталі вздовж вітру
      tt.ribbon.rotation.x = -(0.15 + k * 1.3) + flap;
    }
    // вітромір (0) і анемометр із флюгером (завжди): згладжений вимпельний вітер
    const awaSigned = (f.fromStarboard ? 1 : -1) * f.awa;
    this.windAwa += (awaSigned - this.windAwa) * Math.min(1, dt * 3);
    this.windAws += (f.aws - this.windAws) * Math.min(1, dt * 2);
    if (this.windDial.visible) {
      // верх шкали — ніс; правий борт — праворуч від стерновика (локальний +x)
      this.windNeedle.rotation.z = -(this.windAwa * Math.PI) / 180;
      this.windSpeedNeedle.rotation.z = Math.PI * 0.4 - Math.min(1, this.windAws / 25) * Math.PI * 0.8;
    }
    this.anemoCups.rotation.y -= dt * (0.4 + this.windAws * 1.5);
    {
      // звідки дме: ніс — +Z, правий борт — −X
      const ar = (this.windAwa * Math.PI) / 180;
      this.anemoVane.rotation.y = Math.atan2(-Math.sin(ar), Math.cos(ar));
    }
    // уночі — червона лампа бінакля
    this.binLampMat.opacity = f.night ? 0.9 : 0;
    this.cardMat.color.setRGB(1, f.night ? 0.62 : 1, f.night ? 0.55 : 1);
    // барометр: стрілка — тиск; латунна «встановлювана» — повільно доганяє (видно тренд)
    this.baroHpa += (f.hpa - this.baroHpa) * Math.min(1, dt * 0.5);
    this.baroRef += (this.baroHpa - this.baroRef) * Math.min(1, dt / 50);
    // стрілка дивиться на «12 годин»; кут шкали θ — від «3 годин» за годинниковою
    const rot = (hpa: number) => -((135 + ((Math.max(960, Math.min(1050, hpa)) - 960) / 90) * 270 + 90) * Math.PI) / 180;
    this.baroNeedle.rotation.z = rot(this.baroHpa);
    this.baroSet.rotation.z = rot(this.baroRef);
    // обтічник радара — промінь крутиться
    if (this.radome.visible) this.radomeBar.rotation.y -= dt * 2.6;
    this.apLampMat.color.set(f.autopilot ? 0x103a1a : 0x3a1010);
    this.apLampMat.emissive.set(f.autopilot ? 0x37ff7a : 0xff3b2f);
    this.apLampMat.emissiveIntensity = f.autopilot ? 1.4 : 0.35 + 0.15 * Math.sin(this.t * 2);

    // мілина: глибина під кілем
    if (instrHas(this.level).depth) {
      this.alarmT -= dt;
      const d = depthAt(f.x, f.z);
      if (d < 4.5 && f.speed > 0.6 && this.alarmT <= 0) {
        this.alarmT = 1.2;
        this.onShallow?.(d);
      }
    }
    if (this.plotter.due(dt, 0.33)) this.drawPlotter(f);
    if (this.sonar.due(dt, 0.2)) this.drawSonar(f);
    if (this.radar.due(dt, 0.1)) this.drawRadar(f, 0.1);
  }

  // ── картплотер: північ угорі, 600 м по ширині ──
  private drawPlotter(f: InstrFrame) {
    const s = this.plotter;
    const g = s.ctx;
    const W = s.w, H = s.h;
    const span = 640; // м по ширині
    const k = W / span;
    // суша/глибини — грубою сіткою, перемалювати коли яхта відпливла
    if (Math.hypot(f.x - this.landCx, f.z - this.landCz) > 60) {
      this.landCx = f.x;
      this.landCz = f.z;
      const lg = this.land.getContext('2d')!;
      const img = lg.createImageData(this.land.width, this.land.height);
      const LW = this.land.width, LH = this.land.height;
      for (let j = 0; j < LH; j++) {
        for (let i = 0; i < LW; i++) {
          const wx = this.landCx + ((i + 0.5) / LW - 0.5) * span * 1.6;
          const wz = this.landCz + ((j + 0.5) / LH - 0.5) * (span * 1.6 * LH) / LW;
          const h = seabed(wx, wz);
          const o = (j * LW + i) * 4;
          let c: number[];
          if (h > 0.05) c = h > 12 ? [196, 170, 104] : [226, 202, 132];
          else if (h > -5) c = [148, 212, 236];
          else if (h > -20) c = [82, 160, 214];
          else if (h > -60) c = [38, 104, 170];
          else c = [22, 64, 122];
          img.data[o] = c[0];
          img.data[o + 1] = c[1];
          img.data[o + 2] = c[2];
          img.data[o + 3] = 255;
        }
      }
      lg.putImageData(img, 0, 0);
    }
    const mx = (wx: number) => W / 2 + (wx - f.x) * k;
    const my = (wz: number) => H / 2 + (wz - f.z) * k;
    g.imageSmoothingEnabled = true;
    const LWm = span * 1.6;
    const LHm = (LWm * this.land.height) / this.land.width;
    g.drawImage(this.land, mx(this.landCx - LWm / 2), my(this.landCz - LHm / 2), LWm * k, LHm * k);
    // кільця дальності
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    for (const r of [100, 200, 300]) {
      g.beginPath();
      g.arc(W / 2, H / 2, r * k, 0, Math.PI * 2);
      g.stroke();
    }
    // скелі
    g.fillStyle = '#1b2530';
    for (const r of f.rocks) {
      if (r.kind) continue;
      const px = mx(r.x), py = my(r.z);
      if (px < -10 || py < -10 || px > W + 10 || py > H + 10) continue;
      g.beginPath();
      g.arc(px, py, Math.max(2.5, r.r * k), 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#ff4d6d';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(px - 3, py); g.lineTo(px + 3, py); g.moveTo(px, py - 3); g.lineTo(px, py + 3);
      g.stroke();
    }
    // маршрут — пурпурний, як на справжніх плотерах
    const r = f.route;
    if (r.length) {
      g.strokeStyle = '#ff3fd8';
      g.lineWidth = 3;
      g.setLineDash([]);
      g.beginPath();
      g.moveTo(W / 2, H / 2);
      for (const p of r) g.lineTo(mx(p.x), my(p.z));
      g.stroke();
      r.forEach((p, i) => {
        const px = mx(p.x), py = my(p.z);
        g.beginPath();
        g.arc(px, py, 7, 0, Math.PI * 2);
        g.fillStyle = i === 0 ? '#ff3fd8' : '#1a0d1a';
        g.fill();
        g.strokeStyle = '#ff3fd8';
        g.lineWidth = 2;
        g.stroke();
        g.fillStyle = i === 0 ? '#1a0d1a' : '#ffd6f6';
        g.font = `800 10px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(i + 1), px, py + 0.5);
      });
    }
    // інші човни (AIS — з радаром)
    if (instrHas(this.level).radar) {
      for (const b of f.boats) {
        const px = mx(b.x), py = my(b.z);
        if (px < 0 || py < 0 || px > W || py > H) continue;
        g.save();
        g.translate(px, py);
        g.rotate(Math.PI - b.h);
        g.beginPath();
        g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(-5, 6); g.closePath();
        g.fillStyle = '#48e07a';
        g.fill();
        g.restore();
        g.font = `700 11px ${FONT}`;
        g.fillStyle = '#d8ffe4';
        g.textAlign = 'left';
        g.fillText(b.name, px + 8, py - 6);
      }
    }
    // яхта: стрілка й лінія курсу
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(Math.PI - f.heading);
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -Math.max(40, f.speed * 60 * k)); g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath();
    g.fillStyle = '#ff8a3d';
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();
    // плашки
    const kn = f.speed * 1.944;
    const cog = bearingDeg(0, 0, Math.sin(f.heading), Math.cos(f.heading));
    g.fillStyle = 'rgba(6,14,22,0.82)';
    g.fillRect(0, 0, W, 34);
    g.fillRect(0, H - 34, W, 34);
    g.font = `800 20px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillStyle = '#e9f6ff';
    g.textAlign = 'left';
    g.fillText(L(`SOG ${kn.toFixed(1)} вуз`, `SOG ${kn.toFixed(1)} kn`), 10, 18);
    g.textAlign = 'right';
    g.fillText(`COG ${String(Math.round(cog) % 360).padStart(3, '0')}°`, W - 10, 18);
    g.textAlign = 'left';
    g.font = `700 17px ${FONT}`;
    if (r.length) {
      const d = Math.hypot(r[0].x - f.x, r[0].z - f.z);
      const b = bearingDeg(f.x, f.z, r[0].x, r[0].z);
      const eta = f.speed > 0.4 ? Math.round(d / f.speed / 60) : null;
      g.fillStyle = '#ff9eea';
      g.fillText(`→ №1 ${String(Math.round(b) % 360).padStart(3, '0')}° · ${fmtDist(d)}${eta != null ? L(` · ${eta < 1 ? '<1' : eta} хв`, ` · ${eta < 1 ? '<1' : eta} min`) : ''}`, 10, H - 17);
    } else {
      g.fillStyle = '#8fb0c4';
      g.fillText(L('маршруту немає — постав точки на карті (M)', `no route — set waypoints on the chart (M)`), 10, H - 17);
    }
    if (f.autopilot) {
      g.textAlign = 'right';
      g.fillStyle = '#48e07a';
      g.fillText(L('АВТО', `AUTO`), W - 10, H - 17);
    }
    // рамка-світіння
    g.strokeStyle = '#0e1e2a';
    g.lineWidth = 4;
    g.strokeRect(2, 2, W - 4, H - 4);
    s.done(f.night);
  }

  // ── ехолот: дно й риба, стрічка біжить ліворуч ──
  private drawSonar(f: InstrFrame) {
    const s = this.sonar;
    const g = s.ctx;
    const W = s.w, H = s.h;
    const top = 40;
    const step = 4;
    // зсув стрічки
    g.drawImage(s.cv, step, top, W - step - 0, H - top, 0, top, W - step, H - top);
    const d = depthAt(f.x, f.z);
    // діапазон шкали — ступенями
    const want = [10, 20, 40, 80, 150, 250].find((v) => v >= d * 1.25) ?? 250;
    if (want !== this.sonarRange) {
      this.sonarRange = want;
      g.fillStyle = '#071a33';
      g.fillRect(0, top, W, H - top);
    }
    const pxPerM = (H - top) / this.sonarRange;
    const x0 = W - step;
    // вода
    const grad = g.createLinearGradient(0, top, 0, H);
    grad.addColorStop(0, '#0b2a52');
    grad.addColorStop(1, '#050f22');
    g.fillStyle = grad;
    g.fillRect(x0, top, step, H - top);
    // поверхневий шум
    g.fillStyle = 'rgba(120,200,255,0.35)';
    g.fillRect(x0, top, step, 3 + Math.random() * 3);
    // дно: жовто-червона смуга й коричневий ґрунт
    const by = top + Math.min(H - top - 2, d * pxPerM);
    if (d < this.sonarRange) {
      g.fillStyle = '#ff5a2a';
      g.fillRect(x0, by, step, 3);
      g.fillStyle = '#ffcc33';
      g.fillRect(x0, by + 3, step, 4);
      g.fillStyle = '#6b3a1c';
      g.fillRect(x0, by + 7, step, H - by - 7);
    }
    // риба: «дуги» з імовірністю за густотою
    const n = Math.random() < f.fish * 0.9 ? 1 + (Math.random() < f.fish * 0.6 ? 1 : 0) : 0;
    for (let i = 0; i < n; i++) {
      const fy = top + 8 + Math.random() * Math.max(10, by - top - 18);
      const big = Math.random() < 0.25;
      g.strokeStyle = big ? '#ff3b2f' : '#ffe14d';
      g.lineWidth = big ? 3 : 2;
      g.beginPath();
      g.arc(x0 - (big ? 6 : 4), fy + (big ? 6 : 4), big ? 7 : 5, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
    }
    // шапка
    g.fillStyle = '#04101e';
    g.fillRect(0, 0, W, top);
    g.font = `800 26px ${FONT}`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = d < 4.5 ? '#ff5a4a' : '#eaf6ff';
    g.fillText(d > 240 ? L('>250 м', `>250 m`) : L(`${d.toFixed(d < 10 ? 1 : 0).replace('.', L(',', '.'))} м`, `${d.toFixed(d < 10 ? 1 : 0).replace('.', L(',', '.'))} m`), 8, 21);
    g.font = `700 14px ${FONT}`;
    g.textAlign = 'right';
    const lvl = f.fish > 0.62 ? [L('густо', `dense`), '#48e07a'] : f.fish > 0.32 ? [L('помірно', `moderate`), '#ffd34d'] : [L('рідко', `sparse`), '#8fb0c4'];
    g.fillStyle = lvl[1];
    g.fillText(L(`риба: ${lvl[0]}`, `fish: ${lvl[0]}`), W - 8, 13);
    g.fillStyle = '#8fb0c4';
    if (f.school) {
      const sd = Math.hypot(f.school.x - f.x, f.school.z - f.z);
      g.fillText(sd < 60 ? L(`зграя: тут!`, `school: right here!`) : L(`зграя ${compass8(bearingDeg(f.x, f.z, f.school.x, f.school.z))} · ${fmtDist(sd)}`, `school ${compass8(bearingDeg(f.x, f.z, f.school.x, f.school.z))} · ${fmtDist(sd)}`), W - 8, 30);
    } else g.fillText(L('зграй поблизу немає', `no schools nearby`), W - 8, 30);
    // шкала глибин
    g.fillStyle = 'rgba(234,246,255,0.55)';
    g.font = `600 11px ${FONT}`;
    g.textAlign = 'right';
    for (let i = 1; i <= 4; i++) {
      const v = (this.sonarRange * i) / 4;
      g.fillText(`${Math.round(v)}`, W - 4, top + (H - top) * (i / 4) - 4);
    }
    s.done(f.night);
  }

  // ── радар: курс угору, 400 м, промінь із післясвітінням ──
  private drawRadar(f: InstrFrame, dt: number) {
    const s = this.radar;
    const g = s.ctx;
    const W = s.w;
    const C = W / 2;
    const R = C - 10;
    const range = 400;
    const k = R / range;
    const e = this.radarEcho.getContext('2d')!;
    // згасання ехо
    e.globalCompositeOperation = 'destination-out';
    e.fillStyle = 'rgba(0,0,0,0.09)';
    e.fillRect(0, 0, W, W);
    e.globalCompositeOperation = 'source-over';
    const a0 = this.radarAng;
    const a1 = a0 + dt * ((Math.PI * 2) / 2.4);
    this.radarAng = a1 % (Math.PI * 2);
    // сектор променя у світових координатах: кут на екрані (від носа за годинниковою) → світ
    const toWorld = (screenAng: number, dist: number): [number, number] => {
      // екран «угору» — нос; праворуч — правий борт (−X човна)
      const fwdX = Math.sin(f.heading), fwdZ = Math.cos(f.heading);
      const rgtX = -Math.cos(f.heading), rgtZ = Math.sin(f.heading);
      return [f.x + (fwdX * Math.cos(screenAng) + rgtX * Math.sin(screenAng)) * dist, f.z + (fwdZ * Math.cos(screenAng) + rgtZ * Math.sin(screenAng)) * dist];
    };
    e.fillStyle = '#7dff9a';
    for (let a = a0; a < a1; a += 0.035) {
      for (let dist = 14; dist < range; dist += 9) {
        const [wx, wz] = toWorld(a, dist);
        if (terrainHeight(wx, wz) > -0.6) {
          const px = C + Math.sin(a) * dist * k, py = C - Math.cos(a) * dist * k;
          e.globalAlpha = 0.85;
          e.fillRect(px - 1.6, py - 1.6, 3.2, 3.2);
        }
      }
    }
    e.globalAlpha = 1;
    // точкові цілі: скелі й судна, коли промінь їх проходить
    const local = (wx: number, wz: number): [number, number, number] => {
      const dx = wx - f.x, dz = wz - f.z;
      const fwd = dx * Math.sin(f.heading) + dz * Math.cos(f.heading);
      const rgt = -dx * Math.cos(f.heading) + dz * Math.sin(f.heading);
      const d = Math.hypot(fwd, rgt);
      let a = Math.atan2(rgt, fwd);
      if (a < 0) a += Math.PI * 2;
      return [a, d, 0];
    };
    const inSweep = (a: number) => {
      const lo = a0 % (Math.PI * 2), hi = a1 % (Math.PI * 2);
      return lo <= hi ? a >= lo && a < hi : a >= lo || a < hi;
    };
    for (const r of f.rocks) {
      if (r.kind === 'mark') continue;
      const [a, d] = local(r.x, r.z);
      if (d > range || d < 6 || !inSweep(a)) continue;
      e.fillStyle = '#9dffb0';
      e.beginPath();
      e.arc(C + Math.sin(a) * d * k, C - Math.cos(a) * d * k, Math.max(2.5, r.r * k), 0, Math.PI * 2);
      e.fill();
    }
    for (const b of f.boats) {
      const [a, d] = local(b.x, b.z);
      if (d > range || d < 4 || !inSweep(a)) continue;
      e.fillStyle = '#ffe14d';
      e.beginPath();
      e.arc(C + Math.sin(a) * d * k, C - Math.cos(a) * d * k, 4, 0, Math.PI * 2);
      e.fill();
    }
    // екран
    g.fillStyle = '#031208';
    g.fillRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(C, C, R, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#05200f';
    g.fillRect(0, 0, W, W);
    g.drawImage(this.radarEcho, 0, 0);
    // промінь
    const sweep = g.createLinearGradient(C, C, C + Math.sin(this.radarAng) * R, C - Math.cos(this.radarAng) * R);
    sweep.addColorStop(0, 'rgba(125,255,154,0.05)');
    sweep.addColorStop(1, 'rgba(125,255,154,0.6)');
    g.strokeStyle = sweep;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(C, C);
    g.lineTo(C + Math.sin(this.radarAng) * R, C - Math.cos(this.radarAng) * R);
    g.stroke();
    // кільця
    g.strokeStyle = 'rgba(125,255,154,0.28)';
    g.lineWidth = 1;
    for (const rr of [100, 200, 300, 400]) {
      g.beginPath();
      g.arc(C, C, rr * k, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(C, C); g.lineTo(C, C - R);
    g.stroke();
    // AIS-імена суден
    g.font = `700 12px ${FONT}`;
    g.textAlign = 'left';
    g.fillStyle = '#ffe9a0';
    for (const b of f.boats) {
      const [a, d] = local(b.x, b.z);
      if (d > range) continue;
      g.fillText(b.name, C + Math.sin(a) * d * k + 6, C - Math.cos(a) * d * k - 6);
    }
    g.restore();
    // власна позиція
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(C, C - 7); g.lineTo(C + 5, C + 5); g.lineTo(C - 5, C + 5); g.closePath();
    g.fill();
    g.font = `700 12px ${FONT}`;
    g.fillStyle = '#7dff9a';
    g.textAlign = 'left';
    g.fillText(L('400 м', `400 m`), 6, 14);
    g.textAlign = 'right';
    g.fillText(L('курс ↑', `heading ↑`), W - 6, 14);
    s.done(f.night);
  }
}

// ── речі для полиці крамниці (рівні 1..5) ──

function staticScreen(w: number, h: number, sx: number, sy: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Mesh {
  return new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), new THREE.MeshBasicMaterial({ map: canvasTex(w, h, draw), toneMapped: false }));
}

export function instrShelfModel(lvl: number, k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const brass = k.mat(0xc9a227, 0.3, 0.85);
  const dark = k.mat(0x1c2126, 0.5, 0.4);
  if (lvl === 1) {
    // три латунні прилади на дощечці
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.03), k.mat(0x7a5534, 0.8));
    board.position.y = 0.1;
    board.rotation.x = -0.25;
    g.add(board);
    const faces = [baroFaceTex(), compassCardTex(), baroFaceTex()];
    [-0.12, 0, 0.12].forEach((x, i) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 20), brass);
      r.position.set(x, 0.1, 0.02);
      r.rotation.x = -0.25;
      g.add(r);
      const f = new THREE.Mesh(new THREE.CircleGeometry(0.048, 24), new THREE.MeshBasicMaterial({ map: faces[i] }));
      f.position.set(x, 0.1, 0.021);
      f.rotation.x = -0.25;
      g.add(f);
    });
    return g;
  }
  const box = (w: number, h: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.05), dark);
    b.position.y = h / 2 + 0.03;
    g.add(b);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.08), dark);
    foot.position.y = 0.015;
    g.add(foot);
    return h / 2 + 0.03;
  };
  if (lvl === 2) {
    const y = box(0.26, 0.17);
    const s = staticScreen(256, 168, 0.26, 0.17, (c) => {
      c.fillStyle = '#081016';
      c.fillRect(0, 0, 256, 168);
      c.fillStyle = '#7a94a0';
      c.font = `600 16px ${FONT}`;
      c.fillText(L('ГЛИБИНА', `DEPTH`), 14, 30);
      c.fillStyle = '#e8f4f6';
      c.font = `800 54px ${FONT}`;
      c.fillText('12,4', 14, 92);
      c.fillStyle = '#37c6b5';
      c.font = `700 20px ${FONT}`;
      c.fillText(L('м   вітер 7,2 м/с', `m   wind 7.2 m/s`), 14, 140);
    });
    s.position.set(0, y, 0.026);
    g.add(s);
    return g;
  }
  if (lvl === 3) {
    const y = box(0.3, 0.2);
    const s = staticScreen(300, 200, 0.3, 0.2, (c) => {
      c.fillStyle = '#1f5f9e';
      c.fillRect(0, 0, 300, 200);
      c.fillStyle = '#e2ca84';
      c.beginPath(); c.ellipse(70, 40, 110, 60, 0.3, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#94d4ec';
      c.beginPath(); c.ellipse(220, 150, 40, 24, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#ff3fd8';
      c.lineWidth = 4;
      c.beginPath(); c.moveTo(150, 110); c.lineTo(220, 70); c.lineTo(260, 160); c.stroke();
      c.fillStyle = '#ff8a3d';
      c.beginPath(); c.moveTo(150, 98); c.lineTo(158, 118); c.lineTo(142, 118); c.fill();
    });
    s.position.set(0, y, 0.026);
    g.add(s);
    // грибок антени
    const ant = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), k.mat(0xf3f1ea, 0.45));
    ant.position.set(0.2, 0.0, 0.05);
    g.add(ant);
    return g;
  }
  if (lvl === 4) {
    const y = box(0.24, 0.19);
    const s = staticScreen(240, 190, 0.24, 0.19, (c) => {
      const gr = c.createLinearGradient(0, 0, 0, 190);
      gr.addColorStop(0, '#0b2a52');
      gr.addColorStop(1, '#050f22');
      c.fillStyle = gr;
      c.fillRect(0, 0, 240, 190);
      c.fillStyle = '#6b3a1c';
      c.beginPath();
      c.moveTo(0, 150);
      for (let x = 0; x <= 240; x += 10) c.lineTo(x, 140 + Math.sin(x * 0.05) * 14);
      c.lineTo(240, 190); c.lineTo(0, 190); c.fill();
      c.strokeStyle = '#ffcc33';
      c.lineWidth = 3;
      c.beginPath();
      for (let x = 0; x <= 240; x += 10) c.lineTo(x, 138 + Math.sin(x * 0.05) * 14);
      c.stroke();
      for (const [x, y, r, col] of [[60, 70, 7, '#ffe14d'], [120, 95, 9, '#ff3b2f'], [180, 60, 6, '#ffe14d'], [90, 110, 5, '#ffe14d']] as const) {
        c.strokeStyle = col;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(x, y, r, Math.PI * 1.15, Math.PI * 1.85);
        c.stroke();
      }
    });
    s.position.set(0, y, 0.026);
    g.add(s);
    return g;
  }
  // 5: обтічник радара й пульт автопілота
  const white = k.mat(0xf3f1ea, 0.45);
  const rd = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.09, 24), white);
  rd.position.set(-0.06, 0.08, 0);
  const rdBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.04, 12), dark);
  rdBase.position.set(-0.06, 0.02, 0);
  g.add(rd, rdBase);
  const ap = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.04), dark);
  ap.position.set(0.14, 0.05, 0.04);
  g.add(ap);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.015, 14), new THREE.MeshStandardMaterial({ color: 0x103a1a, emissive: 0x37ff7a, emissiveIntensity: 1 }));
  btn.rotation.x = Math.PI / 2;
  btn.position.set(0.14, 0.04, 0.065);
  g.add(btn);
  return g;
}
