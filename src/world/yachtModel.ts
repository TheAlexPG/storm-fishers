import * as THREE from 'three';
import { eff } from '../game/upgrades';
import type { UpgradeId } from '../core/types';
import { PART_SPECS, buildPartOnBoat } from './upgradeParts';
import { HelmDisplay } from './helmDisplay';
import {
  HALF_LEN, HULL_LEN, DECK_Y, SOLE_Y, WATERLINE_Y, HOUSE, RIG, COCKPIT, STAIR,
  hullHalfWidth, hullBottomY, sheerY, hullXAt,
} from './yachtLayout';

// ─────────────────────────────────────────────────────────────
// Меш вітрильної яхти: лофтований корпус (білий гелькоут, ватерлінійна смуга,
// антифоулінг), тиковий настил, рубка з компаньйоном і трапом у салон,
// кокпіт під hardtop зі склом, рангоут (щогла 12 м, гік, згорнуті паруси,
// ванти), салон усередині корпусу: камбуз, штурманський стіл, дивани, V-койка.
// ─────────────────────────────────────────────────────────────

export interface YachtRefs {
  hullMats: THREE.MeshStandardMaterial[];
  interiorLight: THREE.PointLight;
  cockpitLight: THREE.PointLight;
  glowMats: THREE.MeshStandardMaterial[];
  needleRpm: THREE.Group;
  needleFuel: THREE.Group;
  needleSpeed: THREE.Group;
  compassCard: THREE.Group;
  onLampMat: THREE.MeshStandardMaterial;
  flag: THREE.Mesh;
  exhaustTip: THREE.Vector3;
  upg: Record<string, THREE.Object3D[]>;
  lights: Array<{ light: THREE.PointLight | null; lamp: THREE.Mesh }>;
  spotlight: THREE.SpotLight | null;
  /** згорнутий на штагу стаксель (ховається, коли парус розгорнуто) */
  furledJib: THREE.Object3D[];
  helmDisplay: HelmDisplay | null;
  /** основна вудка: шарнір у тримачі, вудлище вздовж локальної +Y */
  rod: THREE.Group;
  rodLen: number;
  /** кранці (ховаються, коли яхта в морі) */
  fenders: THREE.Object3D[];
}

// ── палітра ──
const GELCOAT = 0xf2efe8;
const NAVY = 0x1d2b45;
const ANTIFOUL = 0x6b1f24;
const TEAK = 0xb08355;
const TEAK_DARK = 0x7a5534;
const STEEL = 0xc9ced3;
const CUSHION = 0x2a3f66;
const HEADLINER = 0xece6d9;

// ── процедурні текстури ──
function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** вертикальні смуги корпусу за висотою (v = (y + 1.5) / 3.2) */
function hullTexture(): THREE.CanvasTexture {
  const tex = canvasTex(4, 512, (ctx) => {
    const yToRow = (y: number) => 512 - ((y + 1.5) / 3.2) * 512;
    ctx.fillStyle = '#f2efe8';
    ctx.fillRect(0, 0, 4, 512);
    // антифоулінг нижче ватерлінії
    ctx.fillStyle = '#6b1f24';
    ctx.fillRect(0, yToRow(WATERLINE_Y - 0.06), 4, 512);
    // ватерлінійна смуга (boot stripe)
    ctx.fillStyle = '#1d2b45';
    ctx.fillRect(0, yToRow(WATERLINE_Y + 0.1), 4, yToRow(WATERLINE_Y - 0.06) - yToRow(WATERLINE_Y + 0.1));
    // декоративна смуга під палубою (cove stripe)
    ctx.fillRect(0, yToRow(DECK_Y - 0.12), 4, yToRow(DECK_Y - 0.22) - yToRow(DECK_Y - 0.12));
    ctx.fillStyle = '#b7894a';
    ctx.fillRect(0, yToRow(DECK_Y - 0.25), 4, 2);
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** тикові дошки з чорним швом (пробки) — 8 дощок × 0.12 м, 2 м довжини */
function teakTexture(): THREE.CanvasTexture {
  const tex = canvasTex(256, 512, (ctx) => {
    const pw = 256 / 8;
    for (let i = 0; i < 8; i++) {
      const l = 52 + ((i * 37) % 11) - 5;
      ctx.fillStyle = `hsl(30, 38%, ${l}%)`;
      ctx.fillRect(i * pw, 0, pw, 512);
      // волокна
      for (let k = 0; k < 26; k++) {
        ctx.fillStyle = `rgba(70,40,15,${0.05 + Math.random() * 0.08})`;
        ctx.fillRect(i * pw + Math.random() * pw, 0, 1, 512);
      }
      // стик дощок
      const j = ((i * 173) % 512);
      ctx.fillStyle = '#1b130c';
      ctx.fillRect(i * pw, j, pw, 3);
    }
    ctx.fillStyle = '#16100a';
    for (let i = 0; i <= 8; i++) ctx.fillRect(i * pw - 2, 0, 4, 512);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 0.96, 1 / 2.0);
  return tex;
}

/** дерев'яна обшивка салону (тепле горіхове дерево, горизонтальні рейки) */
function veneerTexture(): THREE.CanvasTexture {
  const tex = canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = '#9a6a3e';
    ctx.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 90; k++) {
      ctx.strokeStyle = `rgba(60,30,10,${0.05 + Math.random() * 0.1})`;
      ctx.beginPath();
      const y = Math.random() * 256;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(80, y + Math.random() * 8 - 4, 170, y + Math.random() * 8 - 4, 256, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,20,8,0.5)';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, i * 64, 256, 2);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ── циферблати приборної панелі (canvas 128×128) ──
// Дзеркальне малювання: логічне "вправо" = права рука гравця за штурвалом
// (локальний -X човна), тож поділки і текст читаються правильно з-за керма.
// Виняток — компас: малюється звичайно (П зверху, Сх праворуч), бо орієнтація
// сторін на шкалі має збігатись зі світовим курсом.
function dialTexture(kind: 'rpm' | 'fuel' | 'speed' | 'compass'): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const C = S / 2;
  const R = C - 8;
  ctx.translate(C, C);
  const label = (tx: number, ty: number, str: string, size: number, color: string) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `700 ${size}px -apple-system, 'Segoe UI', sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, C + tx, C + ty);
    ctx.restore();
  };
  ctx.beginPath();
  ctx.arc(0, 0, C - 1, 0, Math.PI * 2);
  ctx.fillStyle = '#10141a';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#3a4046';
  ctx.stroke();
  if (kind === 'compass') {
    for (let deg = 0; deg < 360; deg += 15) {
      const major = deg % 45 === 0;
      const a = (deg * Math.PI) / 180;
      const r1 = R - (major ? 10 : 6);
      ctx.beginPath();
      ctx.moveTo(r1 * Math.sin(a), -r1 * Math.cos(a));
      ctx.lineTo(R * Math.sin(a), -R * Math.cos(a));
      ctx.lineWidth = major ? 2.5 : 1;
      ctx.strokeStyle = major ? '#e8f4f6' : '#6d7a84';
      ctx.stroke();
    }
    label(0, -32, 'N', 15, '#ff6b5e');
    label(32, 0, 'E', 12, '#cfe8ea');
    label(0, 32, 'S', 12, '#cfe8ea');
    label(-32, 0, 'W', 12, '#cfe8ea');
    label(0, 44, 'курс', 9, '#7a8a94');
  } else {
    const tick = (f: number, major: boolean) => {
      const a = ((135 + f * 270) * Math.PI) / 180;
      const r1 = R - (major ? 10 : 6);
      ctx.beginPath();
      ctx.moveTo(r1 * Math.cos(a), r1 * Math.sin(a));
      ctx.lineTo(R * Math.cos(a), R * Math.sin(a));
      ctx.lineWidth = major ? 2.5 : 1;
      ctx.strokeStyle = major ? '#e8f4f6' : '#6d7a84';
      ctx.stroke();
    };
    for (let i = 0; i <= 10; i++) tick(i / 10, i % 2 === 0);
    const num = (f: number, str: string) => {
      const a = ((135 + f * 270) * Math.PI) / 180;
      label((R - 22) * Math.cos(a), (R - 22) * Math.sin(a), str, 11, '#cfe8ea');
    };
    if (kind === 'rpm') {
      [0, 6, 12, 18, 24, 30].forEach((v, i) => num(i / 5, String(v)));
      label(0, 40, 'об/хв ×100', 9, '#7a8a94');
    } else if (kind === 'fuel') {
      [0, 20, 40, 60, 80, 100].forEach((v, i) => num(i / 5, String(v)));
      label(0, 40, 'літрів', 9, '#7a8a94');
    } else {
      [0, 3, 6, 9, 12].forEach((v, i) => num(i / 4, String(v)));
      label(0, 40, 'вузли', 9, '#7a8a94');
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── корпус ──

export { hullXAt };
/** зсув штурвальної тумби до корми (м) */
export const HELM_DZ = -0.45;
export const FLAG_NU = 14;
export const FLAG_NV = 7;

/**
 * Лофт корпусу: 56 секцій × 33 точки (лівий борт → кіль → правий борт).
 * inset > 0 — внутрішня обшивка (зсунута всередину), maxTop — обрізати зверху.
 */
function hullGeometry(inset: number, maxTop: number, withTransom: boolean): THREE.BufferGeometry {
  const NS = 56;
  const NP = 16;
  const ring = NP * 2 + 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= NS; i++) {
    const z = -HALF_LEN + (i / NS) * HULL_LEN * (1 - inset * 0.25) + inset * 0.15;
    const W = Math.max(0, hullHalfWidth(z) - inset);
    const top = Math.min(sheerY(z), maxTop);
    const bot = hullBottomY(z) + inset;
    for (let j = -NP; j <= NP; j++) {
      const th = (1 - Math.abs(j) / NP) * (Math.PI / 2); // |j|=NP — борт біля палуби, j=0 — кіль
      const x = Math.sign(j) * W * Math.sqrt(Math.max(0, Math.cos(th)));
      const y = top - (top - bot) * Math.pow(Math.sin(th), 1.6);
      pos.push(x, y, z);
      uv.push(z / HULL_LEN, (y + 1.5) / 3.2);
    }
  }
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < ring - 1; j++) {
      const a = i * ring + j;
      const b = a + 1;
      const c = a + ring;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (withTransom) {
    // транець: віяло з центру першої секції (нормаль у -Z)
    const base = pos.length / 3;
    let cy = 0;
    for (let j = 0; j < ring; j++) cy += pos[j * 3 + 1];
    pos.push(0, cy / ring, pos[2]);
    uv.push(0, (cy / ring + 1.5) / 3.2);
    for (let j = 0; j < ring - 1; j++) idx.push(base, j + 1, j);
    // кришка зверху транця між бортами (щоб не було щілини)
    idx.push(base, 0, ring - 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** обрис палуби (shape у площині x, -z) з відступом від борту */
function deckOutline(inset: number): THREE.Shape {
  const s = new THREE.Shape();
  const N = 40;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const z = -HALF_LEN + 0.03 + (i / N) * (HULL_LEN - 0.08);
    pts.push([Math.max(0.01, hullHalfWidth(z) - inset), z]);
  }
  s.moveTo(pts[0][0], -pts[0][1]);
  for (const [x, z] of pts) s.lineTo(x, -z);
  for (let i = pts.length - 1; i >= 0; i--) s.lineTo(-pts[i][0], -pts[i][1]);
  s.closePath();
  return s;
}

function rectPath(x0: number, x1: number, z0: number, z1: number): THREE.Path {
  const p = new THREE.Path();
  p.moveTo(x0, -z0);
  p.lineTo(x0, -z1);
  p.lineTo(x1, -z1);
  p.lineTo(x1, -z0);
  p.closePath();
  return p;
}

// ─────────────────────────────────────────────────────────────

export class YachtBuilder {
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  refs: YachtRefs;
  private teakTex = teakTexture();
  private veneerTex = veneerTexture();

  constructor(private g: THREE.Group) {
    this.refs = {
      hullMats: [],
      interiorLight: new THREE.PointLight(0xffd9a0, 0.5, 7, 1.6),
      cockpitLight: new THREE.PointLight(0xffd9a0, 6, 6, 1.8),
      glowMats: [],
      needleRpm: new THREE.Group(),
      needleFuel: new THREE.Group(),
      needleSpeed: new THREE.Group(),
      compassCard: new THREE.Group(),
      onLampMat: new THREE.MeshStandardMaterial(),
      flag: new THREE.Mesh(),
      exhaustTip: new THREE.Vector3(0.75, WATERLINE_Y + 0.45, -HALF_LEN - 0.2),
      upg: {},
      lights: [],
      spotlight: null,
      furledJib: [],
      fenders: [],
      helmDisplay: null,
      rod: new THREE.Group(),
      rodLen: 2.4,
    };
  }

  /** у салоні відбиття неба (IBL) притлумлені — там світло тепле, від плафонів */
  private interior = false;

  mat(color: number, rough = 0.8, metal = 0.05): THREE.MeshStandardMaterial {
    const key = `${color}|${rough}|${metal}|${this.interior ? 'in' : 'out'}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
      if (this.interior) m.envMapIntensity = 0.25;
      this.mats.set(key, m);
    }
    return m;
  }

  box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material | number, shadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof m === 'number' ? this.mat(m) : m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  cyl(parent: THREE.Object3D, rt: number, rb: number, h: number, x: number, y: number, z: number, m: THREE.Material | number, seg = 10): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof m === 'number' ? this.mat(m) : m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** труба/трос між двома точками */
  rod(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material | number, seg = 6): THREE.Mesh {
    const len = a.distanceTo(b);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), typeof m === 'number' ? this.mat(m) : m);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  build(): YachtRefs {
    this.buildHull();
    this.buildDeck();
    this.buildHouse();
    this.buildCockpit();
    this.buildHelm();
    this.buildRig();
    this.buildDeckGear();
    this.buildRod();
    this.interior = true;
    this.buildInterior();
    this.interior = false;
    this.buildUpgradeVisuals();
    return this.refs;
  }

  // ── основна вудка в тримачі на правому борту носа ──
  private buildRod() {
    const g = this.g;
    const steel = this.mat(STEEL, 0.25, 0.9);
    const butt = new THREE.Vector3(0.42, DECK_Y + 0.32, 3.75);
    // тримач-трубка на стійці леєра
    this.rod(g, new THREE.Vector3(0.42, DECK_Y, 3.7), new THREE.Vector3(0.42, DECK_Y + 0.42, 3.82), 0.03, steel);
    const rod = this.refs.rod;
    rod.position.copy(butt);
    rod.rotation.set(0.82, 0, -0.18); // нахил уперед і трохи за борт
    g.add(rod);
    const L = this.refs.rodLen;
    const blank = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.02, L, 6).translate(0, L / 2, 0), this.mat(0x1d232a, 0.35, 0.4));
    blank.castShadow = true;
    rod.add(blank);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.38, 8).translate(0, 0.1, 0), this.mat(0x3a2a1c, 0.9));
    rod.add(grip);
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), this.mat(0xc9a227, 0.35, 0.7));
    reel.rotation.z = Math.PI / 2;
    reel.position.set(0, 0.36, -0.06);
    rod.add(reel);
    // базова котушка — до першого апгрейду вудки (далі замінює «Шторм»)
    reel.userData.lvl = 0;
    reel.userData.until = 1;
    (this.refs.upg.rod ||= []).push(reel);
    for (const f of [0.35, 0.6, 0.85]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018 - f * 0.008, 0.003, 4, 10), steel);
      ring.position.set(0, L * f, -0.02);
      rod.add(ring);
    }
  }

  // ── корпус + кіль + перо керма ──
  private buildHull() {
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: hullTexture(),
      roughness: 0.32,
      metalness: 0.05,
      side: THREE.DoubleSide, // фальшборт видно і зсередини (з палуби)
    });
    const hull = new THREE.Mesh(hullGeometry(0, 99, true), hullMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.g.add(hull);
    this.refs.hullMats.push(hullMat);

    // внутрішня обшивка (видно лише зсередини салону)
    const lining = new THREE.Mesh(
      hullGeometry(0.06, DECK_Y - 0.05, false),
      new THREE.MeshStandardMaterial({ color: 0xd9c8a6, map: this.veneerTex, roughness: 0.75, side: THREE.BackSide, envMapIntensity: 0.2 }),
    );
    lining.receiveShadow = true;
    this.g.add(lining);

    // фін-кіль з бульбою
    const keelShape = new THREE.Shape();
    keelShape.moveTo(-0.55, 0);
    keelShape.lineTo(0.65, 0);
    keelShape.lineTo(0.35, -1.25);
    keelShape.lineTo(-0.45, -1.25);
    keelShape.closePath();
    const keelGeo = new THREE.ExtrudeGeometry(keelShape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
    keelGeo.translate(0, 0, -0.07);
    keelGeo.rotateY(-Math.PI / 2);
    const keelMat = this.mat(0x2b2e33, 0.5, 0.4);
    const keel = new THREE.Mesh(keelGeo, keelMat);
    keel.position.set(0, -0.78, 0.2);
    keel.castShadow = true;
    this.g.add(keel);
    const bulb = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.1, 4, 10), keelMat);
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(0, -2.05, 0.15);
    this.g.add(bulb);
    // перо керма
    const rudder = this.box(this.g, 0.07, 0.95, 0.42, 0, -0.55, -3.6, ANTIFOUL);
    rudder.rotation.x = 0.12;

    // ілюмінатори в борту салону (світяться зсередини вночі)
    for (const s of [-1, 1]) {
      for (const z of [1.1, 1.9, 3.0]) {
        const y = 0.8;
        const x = hullXAt(y, z) + 0.004;
        const m = new THREE.MeshStandardMaterial({ color: 0x1a2430, emissive: 0xffd9a0, emissiveIntensity: 0.1, roughness: 0.15, metalness: 0.6 });
        const port = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.24, 3, 10), m);
        port.rotation.x = Math.PI / 2;
        port.scale.set(1, 1, 0.25);
        port.position.set(s * x, y, z);
        port.rotation.z = 0;
        port.lookAt(port.position.x * 3, y, z);
        port.rotateX(Math.PI / 2);
        this.g.add(port);
        this.refs.glowMats.push(m);
      }
    }
  }

  // ── тиковий настил з прорізом під рубку ──
  private buildDeck() {
    const outline = deckOutline(0.04);
    outline.holes.push(rectPath(-HOUSE.x + 0.04, HOUSE.x - 0.04, HOUSE.z0 + 0.02, HOUSE.z1 - 0.02));
    const geo = new THREE.ExtrudeGeometry(outline, { depth: 0.12, bevelEnabled: false, curveSegments: 4 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, DECK_Y - 0.12, 0);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.teakTex, roughness: 0.85 });
    const deck = new THREE.Mesh(geo, [deckMat, this.mat(TEAK_DARK, 0.9)]);
    deck.receiveShadow = true;
    deck.castShadow = true;
    this.g.add(deck);

    // стеля салону під бічними палубами (білий headliner)
    this.interior = true;
    // обрис по корпусу (прямокутні плити в носі вилазили назовні білими
    // квадратами над водою), отвір — під рубкою
    {
      const hy = DECK_Y - 0.15;
      const za = HOUSE.z0 - 0.25, zb = HOUSE.z1 + 1.4;
      const N = 24;
      const edge = (z: number) => Math.max(0.05, hullXAt(hy, z) - 0.06);
      // П-подібний контур (без отвору: отвір, що торкався краю, ламав
      // триангуляцію — під рубкою лишалась суцільна біла площина)
      const hz1 = HOUSE.z1 + 0.7, hx = 0.9;
      const shape = new THREE.Shape();
      shape.moveTo(hx, -za);
      for (let i = 0; i <= N; i++) {
        const z = za + ((zb - za) * i) / N;
        shape.lineTo(edge(z), -z);
      }
      for (let i = N; i >= 0; i--) {
        const z = za + ((zb - za) * i) / N;
        shape.lineTo(-edge(z), -z);
      }
      shape.lineTo(-hx, -za);
      shape.lineTo(-hx, -hz1);
      shape.lineTo(hx, -hz1);
      shape.lineTo(hx, -za);
      const hg = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 1 });
      hg.rotateX(-Math.PI / 2);
      hg.translate(0, hy, 0);
      const hl = new THREE.Mesh(hg, this.mat(HEADLINER));
      hl.receiveShadow = true;
      this.g.add(hl);
    }
    this.box(this.g, 2.6, 0.03, 1.0, 0, DECK_Y - 0.135, HOUSE.z0 - 0.5, HEADLINER, false);
    this.interior = false;

    // тиковий планшир (toerail) по обрису
    const rail: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const z = -HALF_LEN + 0.05 + (i / 40) * (HULL_LEN - 0.1);
      rail.push(new THREE.Vector3(hullHalfWidth(z) - 0.02, sheerY(z) + 0.02, z));
    }
    for (const s of [-1, 1]) {
      const pts = rail.map((p) => new THREE.Vector3(p.x * s, p.y, p.z));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.035, 6), this.mat(TEAK, 0.7));
      tube.castShadow = true;
      this.g.add(tube);
    }

    // релінги: стійки + два леєри, носовий пульпіт і кормовий
    const steel = this.mat(STEEL, 0.25, 0.9);
    const posts: number[] = [-4.1, -2.7, -1.3, 0.1, 1.5, 2.9];
    for (const s of [-1, 1]) {
      const tops: THREE.Vector3[] = [];
      for (const z of posts) {
        const x = s * (hullHalfWidth(z) - 0.1);
        const y0 = sheerY(z);
        this.rod(this.g, new THREE.Vector3(x, y0, z), new THREE.Vector3(x, y0 + 0.62, z), 0.014, steel);
        tops.push(new THREE.Vector3(x, y0 + 0.62, z));
      }
      // пульпіт на носі
      const bz = 3.9;
      const bx = s * (hullHalfWidth(bz) - 0.08);
      tops.push(new THREE.Vector3(bx, sheerY(bz) + 0.62, bz));
      this.rod(this.g, new THREE.Vector3(bx, sheerY(bz), bz), tops[tops.length - 1], 0.016, steel);
      for (const dy of [0, -0.3]) {
        for (let i = 0; i < tops.length - 1; i++) {
          const a = tops[i].clone();
          const b = tops[i + 1].clone();
          a.y += dy;
          b.y += dy;
          this.rod(this.g, a, b, dy === 0 ? 0.012 : 0.006, steel, 4);
        }
      }
    }
    // дуга пульпіта через ніс
    {
      const bz = 3.9;
      const bx = hullHalfWidth(bz) - 0.08;
      const y = sheerY(bz) + 0.62;
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-bx, y, bz), new THREE.Vector3(0, y, 4.75), new THREE.Vector3(bx, y, bz));
      this.g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.016, 6), steel));
      this.rod(this.g, new THREE.Vector3(0, sheerY(4.55), 4.55), new THREE.Vector3(0, y, 4.52), 0.016, steel);
    }
    // кормовий пульпіт (дуга через транець)
    {
      const z = -HALF_LEN + 0.12;
      const bx = hullHalfWidth(z) - 0.1;
      const y = sheerY(z) + 0.62;
      for (const s of [-1, 1]) this.rod(this.g, new THREE.Vector3(s * bx, sheerY(z), z), new THREE.Vector3(s * bx, y, z), 0.016, steel);
      this.rod(this.g, new THREE.Vector3(-bx, y, z), new THREE.Vector3(-0.45, y, z), 0.016, steel);
      this.rod(this.g, new THREE.Vector3(0.45, y, z), new THREE.Vector3(bx, y, z), 0.016, steel);
      this.rod(this.g, new THREE.Vector3(-0.45, y, z), new THREE.Vector3(-0.45, sheerY(z), z), 0.016, steel);
      this.rod(this.g, new THREE.Vector3(0.45, y, z), new THREE.Vector3(0.45, sheerY(z), z), 0.016, steel);
    }
    // купальна платформа на транці + трап
    this.box(this.g, 2.6, 0.08, 0.55, 0, WATERLINE_Y + 0.22, -HALF_LEN - 0.22, this.mat(TEAK, 0.85));
    for (let i = 0; i < 3; i++) this.box(this.g, 0.36, 0.025, 0.05, -0.9, WATERLINE_Y + 0.1 - i * 0.25, -HALF_LEN - 0.47, steel, false);
  }

  // ── рубка (deckhouse) над салоном ──
  private buildHouse() {
    const g = this.g;
    const white = this.mat(GELCOAT, 0.35, 0.05);
    const H = HOUSE.top - DECK_Y;
    const len = HOUSE.z1 - HOUSE.z0;
    const zc = (HOUSE.z0 + HOUSE.z1) / 2;
    // бічні стінки з нахилом всередину
    for (const s of [-1, 1]) {
      const wall = this.box(g, 0.07, H + 0.04, len, s * (HOUSE.x - 0.05), DECK_Y + H / 2 - 0.02, zc, white);
      wall.rotation.z = s * 0.1;
      // довгі тоновані вікна (вночі — тепле світло салону)
      const wm = new THREE.MeshStandardMaterial({ color: 0x141c26, emissive: 0xffd9a0, emissiveIntensity: 0.1, roughness: 0.1, metalness: 0.7 });
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.26, len * 0.72), wm);
      win.position.set(s * (HOUSE.x - 0.005), DECK_Y + H * 0.58, zc + 0.15);
      win.rotation.z = s * 0.1;
      g.add(win);
      this.refs.glowMats.push(wm);
    }
    // носова стінка (похила)
    const front = this.box(g, HOUSE.x * 2 - 0.1, H + 0.1, 0.07, 0, DECK_Y + H / 2, HOUSE.z1 - 0.08, white);
    front.rotation.x = -0.35;
    // кормова стінка з прорізом компаньйона
    const sideW = HOUSE.x - STAIR.x;
    for (const s of [-1, 1]) this.box(g, sideW, H, 0.07, s * (STAIR.x + sideW / 2 - 0.04), DECK_Y + H / 2, HOUSE.z0 + 0.035, white);
    // дах з камбером: дві смуги обабіч люка + суцільна носова частина
    const roofZ1 = HOUSE.z1 - 0.15;
    const hatchEnd = 0.45;
    for (const s of [-1, 1]) {
      this.box(g, sideW + 0.05, 0.06, hatchEnd - HOUSE.z0, s * (STAIR.x + sideW / 2 - 0.02), HOUSE.top, (HOUSE.z0 + hatchEnd) / 2, white);
    }
    this.box(g, HOUSE.x * 2 - 0.02, 0.06, roofZ1 - hatchEnd, 0, HOUSE.top + 0.01, (hatchEnd + roofZ1) / 2, white);
    // антиковзке покриття даху (світло-сіре)
    this.box(g, HOUSE.x * 2 - 0.4, 0.008, roofZ1 - hatchEnd - 0.3, 0, HOUSE.top + 0.045, (hatchEnd + roofZ1) / 2, this.mat(0xd9d6cc, 0.95), false);
    // зсувний люк компаньйона (відкритий, у «гаражі»)
    this.box(g, STAIR.x * 2 + 0.12, 0.07, 0.9, 0, HOUSE.top + 0.09, hatchEnd + 0.35, this.mat(0xcfd8de, 0.15, 0.1));
    for (const s of [-1, 1]) this.box(g, 0.05, 0.1, hatchEnd - HOUSE.z0 + 0.9, s * (STAIR.x + 0.05), HOUSE.top + 0.05, (HOUSE.z0 + hatchEnd + 0.9) / 2, this.mat(TEAK, 0.7));
    // носовий світловий люк + поручні на даху
    this.box(g, 0.6, 0.06, 0.6, 0, HOUSE.top + 0.06, 1.9, this.mat(0x223040, 0.1, 0.6));
    for (const s of [-1, 1]) {
      const hr = this.box(g, 0.04, 0.06, 2.0, s * (HOUSE.x - 0.18), HOUSE.top + 0.09, 1.3, this.mat(TEAK, 0.7));
      hr.castShadow = false;
    }
    // ступінь компаньйона в кокпіті + накладки трапа
    this.box(g, STAIR.x * 2, 0.04, 0.06, 0, DECK_Y + 0.02, HOUSE.z0 - 0.02, this.mat(TEAK_DARK, 0.8));
  }

  // ── кокпіт: коамінги, лави, hardtop, лобове й бічне скло ──
  private buildCockpit() {
    const g = this.g;
    const white = this.mat(GELCOAT, 0.35, 0.05);
    const teak = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.teakTex, roughness: 0.85 });
    const cx = COCKPIT.x;
    const len = COCKPIT.z1 - COCKPIT.z0;
    const zc = (COCKPIT.z0 + COCKPIT.z1) / 2;
    // коамінги
    for (const s of [-1, 1]) {
      this.box(g, 0.08, 0.38, len, s * cx, DECK_Y + 0.19, zc, white);
      this.box(g, 0.16, 0.04, len, s * cx, DECK_Y + 0.4, zc, this.mat(TEAK, 0.7));
      // лави (тик) уздовж коамінгів
      this.box(g, 0.36, 0.42, 1.65, s * (cx - 0.22), DECK_Y + 0.21, -1.6, white);
      this.box(g, 0.38, 0.04, 1.65, s * (cx - 0.22), DECK_Y + 0.44, -1.6, teak);
    }
    // hardtop: біла панель з темною стелею, кріплення — лобова рама та кормова дуга
    const roofLen = 0.45 - COCKPIT.z0 + 0.1;
    const roofZ = (COCKPIT.z0 - 0.1 + 0.45) / 2;
    const roof = this.box(g, cx * 2 + 0.5, 0.08, roofLen, 0, COCKPIT.roofY, roofZ, white);
    roof.castShadow = true;
    this.box(g, cx * 2 + 0.46, 0.02, roofLen - 0.04, 0, COCKPIT.roofY - 0.05, roofZ, this.mat(0x3a3f47, 0.9), false);
    // сонячні панелі на даху
    for (const dz of [-0.9, 0.4]) this.box(g, 1.1, 0.03, 1.15, -0.62, COCKPIT.roofY + 0.055, roofZ + dz, this.mat(0x16233a, 0.2, 0.5), false);
    for (const dz of [-0.9, 0.4]) this.box(g, 1.1, 0.03, 1.15, 0.62, COCKPIT.roofY + 0.055, roofZ + dz, this.mat(0x16233a, 0.2, 0.5), false);
    // кормова дуга (нержавійка)
    const steel = this.mat(STEEL, 0.25, 0.9);
    for (const s of [-1, 1]) {
      this.rod(g, new THREE.Vector3(s * (cx + 0.05), DECK_Y + 0.4, COCKPIT.z0 + 0.15), new THREE.Vector3(s * (cx + 0.2), COCKPIT.roofY - 0.04, COCKPIT.z0 + 0.05), 0.035, steel, 8);
      this.rod(g, new THREE.Vector3(s * (cx + 0.05), DECK_Y + 0.4, -2.5), new THREE.Vector3(s * (cx + 0.2), COCKPIT.roofY - 0.04, -2.45), 0.03, steel, 8);
    }
    // лобове скло: над рубкою від даху рубки до hardtop, нахил назад
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd3ea, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const frameMat = this.mat(0x2a2f36, 0.5, 0.4);
    {
      const hgt = COCKPIT.roofY - HOUSE.top;
      const glass = new THREE.Mesh(new THREE.BoxGeometry(HOUSE.x * 2 - 0.12, hgt, 0.03), glassMat);
      glass.position.set(0, HOUSE.top + hgt / 2, 0.42);
      glass.rotation.x = -0.18;
      g.add(glass);
      this.box(g, HOUSE.x * 2 - 0.06, 0.06, 0.08, 0, HOUSE.top + 0.05, 0.55, frameMat);
      for (const x of [-HOUSE.x + 0.04, -0.3, 0.3, HOUSE.x - 0.04]) {
        const m = this.box(g, 0.05, hgt, 0.05, x, HOUSE.top + hgt / 2, 0.42, frameMat);
        m.rotation.x = -0.18;
      }
    }
    // бічні щитки: скло від коамінга до даху (z -2.4..-0.6), над рубкою — до даху
    for (const s of [-1, 1]) {
      const h1 = COCKPIT.roofY - (DECK_Y + 0.42);
      const g1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, h1, 1.8), glassMat);
      g1.position.set(s * cx, DECK_Y + 0.42 + h1 / 2, -1.5);
      g.add(g1);
      const h2 = COCKPIT.roofY - HOUSE.top;
      const g2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, h2, 1.05), glassMat);
      g2.position.set(s * (HOUSE.x - 0.02), HOUSE.top + h2 / 2, -0.1);
      g.add(g2);
      for (const z of [-2.4, -0.6]) this.box(g, 0.05, h1, 0.05, s * cx, DECK_Y + 0.42 + h1 / 2, z, frameMat);
      this.box(g, 0.05, 0.05, 1.8, s * cx, DECK_Y + 0.44, -1.5, frameMat, false);
    }
    // тепле світло під hardtop
    this.refs.cockpitLight.position.set(0, COCKPIT.roofY - 0.7, -2.2);
    g.add(this.refs.cockpitLight);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff4e0, emissive: 0xffd9a0, emissiveIntensity: 0.4 });
    for (const z of [-3.3, -1.3]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), lampMat);
      l.position.set(0, COCKPIT.roofY - 0.065, z);
      g.add(l);
    }
    this.refs.glowMats.push(lampMat);
  }

  // ── штурвальна тумба: колесо, бінакль, приборна панель, газ ──
  private buildHelm() {
    // уся штурвальна тумба — на HELM_DZ ближче до корми (ширший прохід повз скло кокпіту)
    const g = new THREE.Group();
    g.position.z = HELM_DZ;
    this.g.add(g);
    const steel = this.mat(STEEL, 0.25, 0.9);
    const dark = this.mat(0x1f2328, 0.5, 0.4);
    // тумба
    this.cyl(g, 0.09, 0.12, 1.02, 0, DECK_Y + 0.51, -3.0, dark, 12);
    // колесо Ø0.9: нержавійка з шкіряним ободом, обличчям до корми
    const wheel = new THREE.Group();
    wheel.position.set(0, DECK_Y + 0.72, -3.38);
    g.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.025, 8, 36), this.mat(0x2b211a, 0.7));
    wheel.add(rim);
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.88, 6), steel);
      sp.rotation.z = (i / 6) * Math.PI;
      wheel.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12), steel);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    this.rod(g, new THREE.Vector3(0, DECK_Y + 0.72, -3.38), new THREE.Vector3(0, DECK_Y + 0.72, -3.1), 0.03, steel);
    // поручень навколо тумби
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 6, 20, Math.PI), steel);
    guard.position.set(0, DECK_Y + 0.92, -2.95);
    guard.rotation.x = -Math.PI / 2;
    guard.rotation.z = Math.PI;
    g.add(guard);
    // пульт приборів на тумбі (нахилений до стерновика)
    const pod = this.box(g, 1.36, 0.12, 0.4, 0, DECK_Y + 1.1, -2.98, dark);
    pod.rotation.x = -0.55; // верхня грань — до стерновика
    // орієнтація приладів: обличчям до стерновика (нормаль угору й до корми),
    // «верх» шкали — від стерновика вперед; правий край — праворуч від нього (−X)
    const faceQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, Math.sin(0.55), Math.cos(0.55)),
      new THREE.Vector3(0, Math.cos(0.55), -Math.sin(0.55)),
    ));
    const dials: Array<[number, 'rpm' | 'fuel' | 'speed' | 'compass']> = [
      // зліва від стерновика (+X) — двигун і паливо, справа — швидкість і компас
      [0.55, 'rpm'],
      [0.32, 'fuel'],
      [-0.32, 'speed'],
      [-0.55, 'compass'],
    ];
    const n = new THREE.Vector3(0, Math.cos(0.55), -Math.sin(0.55)); // нормаль пульта
    // багатофункціональний дисплей по центру пульта
    const mfd = new HelmDisplay(0.4, 0.262);
    mfd.mesh.position.set(0, DECK_Y + 1.1, -2.98).addScaledVector(n, 0.072);
    mfd.mesh.quaternion.copy(faceQ);
    g.add(mfd.mesh);
    const frame = this.box(g, 0.44, 0.02, 0.3, 0, DECK_Y + 1.1, -2.98, this.mat(0x0b0e11, 0.4, 0.3), false);
    frame.position.addScaledVector(n, 0.06);
    frame.rotation.x = -0.55;
    this.refs.helmDisplay = mfd;
    for (const [dx, kind] of dials) {
      const dial = new THREE.Group();
      dial.position.set(dx, DECK_Y + 1.1, -2.98).addScaledVector(n, 0.065);
      dial.quaternion.copy(faceQ);
      g.add(dial);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 6, 24), steel);
      dial.add(bezel);
      if (kind === 'compass') {
        const card = new THREE.Group();
        card.position.z = 0.006;
        dial.add(card);
        card.add(new THREE.Mesh(new THREE.CircleGeometry(0.1, 32), new THREE.MeshBasicMaterial({ map: dialTexture('compass') })));
        this.refs.compassCard = card;
        const lub = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.035, 0.004), new THREE.MeshBasicMaterial({ color: 0xff6b5e }));
        lub.position.set(0, 0.09, 0.01);
        dial.add(lub);
      } else {
        const face = new THREE.Mesh(new THREE.CircleGeometry(0.1, 32), new THREE.MeshBasicMaterial({ map: dialTexture(kind) }));
        face.position.z = 0.002;
        dial.add(face);
        const needle = new THREE.Group();
        needle.position.z = 0.006;
        dial.add(needle);
        needle.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.15, 0.006).translate(0, 0.06, 0), new THREE.MeshBasicMaterial({ color: 0xe74c3c })));
        if (kind === 'rpm') this.refs.needleRpm = needle;
        else if (kind === 'fuel') this.refs.needleFuel = needle;
        else this.refs.needleSpeed = needle;
      }
      const cap = new THREE.Mesh(new THREE.CircleGeometry(0.012, 12), new THREE.MeshBasicMaterial({ color: 0x111417 }));
      cap.position.z = 0.01;
      dial.add(cap);
    }
    // лампа двигуна (зелена ON)
    this.refs.onLampMat = new THREE.MeshStandardMaterial({ color: 0x1d3326, emissive: 0x27e07a, emissiveIntensity: 0.9, roughness: 0.4 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.05), this.refs.onLampMat);
    lamp.position.set(0.435, DECK_Y + 1.1, -2.98).addScaledVector(n, 0.07).addScaledVector(new THREE.Vector3(0, Math.sin(0.55), Math.cos(0.55)), 0.14);
    g.add(lamp);
    // ручка газу (праворуч на тумбі)
    this.box(g, 0.1, 0.16, 0.12, 0.17, DECK_Y + 0.75, -3.08, dark);
    const lever = this.box(g, 0.025, 0.2, 0.025, 0.24, DECK_Y + 0.85, -3.08, steel);
    lever.rotation.x = -0.4;
    // кришки моторного й трюмного люків у підлозі кокпіту
    this.box(g, 0.6, 0.015, 0.5, 0.62, DECK_Y + 0.008, -4.05, this.mat(TEAK_DARK, 0.85), false);
    this.box(g, 0.6, 0.015, 0.5, -0.62, DECK_Y + 0.008, -4.05, this.mat(TEAK_DARK, 0.85), false);
    // ручна трюмна помпа (рукоять у коамінгу)
    this.cyl(g, 0.05, 0.05, 0.12, -0.62, DECK_Y + 0.07, -4.05, this.mat(0x4a6b8a, 0.5, 0.4));
    const pumpH = this.rod(g, new THREE.Vector3(-0.62, DECK_Y + 0.12, -4.05), new THREE.Vector3(-0.45, DECK_Y + 0.45, -4.0), 0.018, steel);
    pumpH.castShadow = false;
    // кормовий прапор на флагштоку: вертикальне древко з наконечником, полотнище —
    // сітка з кольорами вершин (синій верх, жовтий низ); форму щокадру задає
    // Boat.updateFlag за вимпельним вітром
    const fx = 0.95, fz = -4.62, fy0 = sheerY(-4.5);
    const staff = this.rod(g, new THREE.Vector3(fx, fy0 - 0.05, fz), new THREE.Vector3(fx, fy0 + 1.45, fz), 0.022, this.mat(TEAK, 0.6));
    staff.castShadow = true;
    this.cyl(g, 0.035, 0.035, 0.05, fx, fy0 + 1.47, fz, this.mat(0xc9a227, 0.35, 0.8), 10);
    this.cyl(g, 0.028, 0.032, 0.08, fx, fy0 + 0.02, fz, this.mat(STEEL, 0.25, 0.9), 10);
    const geo = new THREE.PlaneGeometry(1, 1, FLAG_NU, FLAG_NV);
    // дві смуги текстурою — межа різка (кольори вершин розмазували б її на рядок сітки)
    const tex = canvasTex(4, 2, (ctx) => {
      ctx.fillStyle = '#1f5fbf';
      ctx.fillRect(0, 0, 4, 1);
      ctx.fillStyle = '#f2c218';
      ctx.fillRect(0, 1, 4, 1);
    });
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85 }));
    flag.position.set(fx, fy0 + 1.4, fz); // верхній кут полотнища — біля наконечника
    flag.castShadow = true;
    flag.frustumCulled = false;
    g.add(flag);
    this.refs.flag = flag;
  }

  // ── рангоут і такелаж ──
  private buildRig() {
    const g = this.g;
    const alu = this.mat(0xd7dade, 0.35, 0.7);
    const wire = this.mat(0x9aa3ab, 0.3, 0.9);
    const MZ = RIG.mastZ; // щогла на даху рубки
    const base = RIG.base;
    const top = RIG.top;
    // щогла (еліптичний профіль)
    const mast = this.cyl(g, 0.065, 0.085, top - base, 0, (base + top) / 2, MZ, alu, 10);
    mast.scale.set(1, 1, 1.4);
    // краспиці
    for (const [h, w] of [[base + 4.2, 0.95], [base + 7.9, 0.62]] as const) {
      for (const s of [-1, 1]) this.rod(g, new THREE.Vector3(0, h, MZ), new THREE.Vector3(s * w, h + 0.12, MZ - 0.1), 0.022, alu);
    }
    // ванти: від ланцюгів через кінці краспиць до топу
    const chain = (s: number) => new THREE.Vector3(s * (hullHalfWidth(MZ) - 0.12), sheerY(MZ), MZ - 0.1);
    for (const s of [-1, 1]) {
      const c = chain(s);
      const s1 = new THREE.Vector3(s * 0.95, base + 4.32, MZ - 0.1);
      const s2 = new THREE.Vector3(s * 0.62, base + 8.02, MZ - 0.1);
      this.rod(g, c, s1, 0.008, wire, 4);
      this.rod(g, s1, s2, 0.008, wire, 4);
      this.rod(g, s2, new THREE.Vector3(0, top - 0.3, MZ), 0.008, wire, 4);
      this.rod(g, c, new THREE.Vector3(0, base + 4.2, MZ), 0.007, wire, 4); // нижня ванта
    }
    // фордун (бакштаг) з топу на транець — розщеплений
    for (const s of [-1, 1]) {
      this.rod(g, new THREE.Vector3(0, top - 0.1, MZ - 0.05), new THREE.Vector3(s * 0.7, sheerY(-4.6) + 0.1, -4.6), 0.008, wire, 4);
    }
    // штаг з топу на форштевень + згорнутий стаксель (ролик-рифінг)
    const stemTop = new THREE.Vector3(0, sheerY(4.6) + 0.1, 4.62);
    const forestayTop = new THREE.Vector3(0, top - 0.25, MZ + 0.05);
    this.rod(g, stemTop, forestayTop, 0.009, wire, 4);
    {
      const a = stemTop.clone().lerp(forestayTop, 0.05);
      const b = stemTop.clone().lerp(forestayTop, 0.9);
      const jib = this.rod(g, a, b, 0.07, this.mat(0xe8e2d2, 0.95), 8);
      // захисна смуга (UV-strip) на згорнутому стакселі
      const strip = this.rod(g, a, b, 0.075, this.mat(NAVY, 0.9), 8);
      strip.scale.set(0.6, 1, 1.05);
      this.refs.furledJib.push(jib, strip);
      // барабан ролика
      this.cyl(g, 0.1, 0.1, 0.12, 0, stemTop.y + 0.05, 4.6, alu, 12);
    }
    // гік, лейзі-бег і паруси — у SailRig (sails.ts), бо рухаються з вітром
    // ліфт гіка
    this.rod(g, new THREE.Vector3(0, RIG.boomY + 0.05, MZ - 0.6), new THREE.Vector3(0, top - 0.4, MZ - 0.05), 0.005, wire, 4);
    // топ: антена (флюгер — у SailRig)
    this.rod(g, new THREE.Vector3(0.08, top, MZ), new THREE.Vector3(0.08, top + 0.9, MZ), 0.008, this.mat(0x222222, 0.6), 4);
    // ходовий вогонь на щоглі
    this.box(g, 0.08, 0.06, 0.06, 0, base + 4.0, MZ + 0.12, this.mat(0xe8e8e8, 0.4, 0.3), false);
  }

  // ── палубне обладнання: вудка, лебідки, якір, кнехти ──
  private buildDeckGear() {
    const g = this.g;
    const steel = this.mat(STEEL, 0.25, 0.9);
    // якір у носовому ролику + брашпиль
    this.box(g, 0.14, 0.12, 0.5, 0, sheerY(4.55) - 0.02, 4.6, steel);
    this.cyl(g, 0.12, 0.14, 0.18, 0, DECK_Y + 0.09, 4.1, this.mat(0x30343a, 0.4, 0.6), 12);
    // лебідки на коамінгах і на даху рубки
    for (const s of [-1, 1]) {
      this.cyl(g, 0.08, 0.1, 0.18, s * COCKPIT.x, DECK_Y + 0.5, -2.2, steel, 14);
      this.cyl(g, 0.065, 0.08, 0.14, s * (STAIR.x + 0.25), HOUSE.top + 0.1, -0.35, steel, 14);
      // кнехти
      for (const z of [-4.2, 4.0]) this.box(g, 0.24, 0.07, 0.07, s * (hullHalfWidth(z) - 0.25), DECK_Y + 0.04, z, steel);
      // кранці на бортах (білі «сосиски»)
      for (const z of [-1.8, 0.8]) {
        const fx = s * (hullHalfWidth(z) + 0.12);
        const f = this.cyl(g, 0.11, 0.11, 0.5, fx, 0.82, z, this.mat(0xf3f3f0, 0.6), 10);
        f.castShadow = true;
        this.refs.fenders.push(f);
      }
    }
    // dorade-вентилятори
    for (const s of [-1, 1]) {
      this.cyl(g, 0.05, 0.05, 0.22, s * 0.5, DECK_Y + 0.11, 3.2, this.mat(GELCOAT, 0.4), 10);
      const cowl = this.cyl(g, 0.09, 0.07, 0.14, s * 0.5, DECK_Y + 0.25, 3.25, this.mat(0xc23b2f, 0.5), 10);
      cowl.rotation.x = Math.PI / 2;
    }
  }

  // ── салон у корпусі ──
  private buildInterior() {
    const g = this.g;
    const wood = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.veneerTex, roughness: 0.6, envMapIntensity: 0.25 });
    const woodDark = this.mat(0x6a4426, 0.7);
    const counter = this.mat(0xe9e4da, 0.3, 0.05);
    const cushion = this.mat(CUSHION, 0.95);
    const S = SOLE_Y;
    // підлога: тик-голлі
    const soleTex = this.teakTex.clone();
    soleTex.repeat.set(1 / 0.6, 1 / 1.4);
    soleTex.needsUpdate = true;
    this.box(g, 1.9, 0.06, 3.3, 0, S - 0.03, 1.15, new THREE.MeshStandardMaterial({ color: 0xffe6c8, map: soleTex, roughness: 0.55, envMapIntensity: 0.25 }), false);
    // трап компаньйона: 5 сходинок + тятиви + поручні
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const f = (i + 1) / (steps + 1);
      const z = STAIR.zTop + (STAIR.zBot - STAIR.zTop) * f;
      const y = DECK_Y + (S - DECK_Y) * f;
      this.box(g, STAIR.x * 2 - 0.1, 0.05, 0.26, 0, y - 0.025, z, wood);
    }
    for (const s of [-1, 1]) {
      const st = this.rod(g, new THREE.Vector3(s * (STAIR.x - 0.04), DECK_Y, STAIR.zTop), new THREE.Vector3(s * (STAIR.x - 0.04), S, STAIR.zBot), 0.035, woodDark, 4);
      st.scale.set(1, 1, 2.2);
      this.rod(g, new THREE.Vector3(s * (STAIR.x - 0.02), DECK_Y + 0.7, STAIR.zTop + 0.05), new THREE.Vector3(s * (STAIR.x - 0.02), S + 0.9, STAIR.zBot), 0.02, this.mat(STEEL, 0.25, 0.9));
    }
    // кормова переборка (за трапом — моторний відсік)
    this.box(g, 2.6, DECK_Y - S, 0.05, 0, (DECK_Y + S) / 2, STAIR.zTop - 0.05, wood);
    // бічні стінки компаньйона (обабіч сходів, до кінця трапа)
    for (const s of [-1, 1]) this.box(g, 0.04, 0.9, STAIR.zBot - STAIR.zTop, s * (STAIR.x + 0.02), S + 0.45, (STAIR.zTop + STAIR.zBot) / 2 - 0.05, wood);

    // ── камбуз (лівий борт) ──
    const gz0 = -0.55;
    const gz1 = 1.55;
    const gzc = (gz0 + gz1) / 2;
    this.box(g, 0.6, 0.88, gz1 - gz0, -0.85, S + 0.44, gzc, wood);
    this.box(g, 0.64, 0.04, gz1 - gz0 + 0.02, -0.84, S + 0.9, gzc, counter);
    // плита з двома конфорками + казанок
    this.box(g, 0.42, 0.03, 0.5, -0.82, S + 0.935, 1.2, this.mat(0x2a2c30, 0.4, 0.6));
    for (const dz of [-0.12, 0.12]) this.cyl(g, 0.07, 0.07, 0.01, -0.82, S + 0.955, 1.2 + dz, this.mat(0x111111, 0.6, 0.3), 14);
    this.cyl(g, 0.09, 0.1, 0.14, -0.82, S + 1.03, 1.08, this.mat(0x3a3d42, 0.35, 0.7), 12);
    // мийка + кран
    this.box(g, 0.32, 0.02, 0.36, -0.82, S + 0.925, 0.55, this.mat(0xb8bec4, 0.2, 0.9), false);
    this.rod(g, new THREE.Vector3(-1.0, S + 0.92, 0.55), new THREE.Vector3(-0.92, S + 1.12, 0.55), 0.012, this.mat(STEEL, 0.2, 0.9));
    // шафки над камбузом
    this.box(g, 0.35, 0.4, 1.5, -1.0, DECK_Y - 0.4, 0.75, wood);
    // ── штурманський стіл + радіо (правий борт) ──
    this.box(g, 0.62, 0.74, 1.1, 0.86, S + 0.37, 0.95, wood);
    this.box(g, 0.66, 0.04, 1.14, 0.84, S + 0.76, 0.95, this.mat(0x5a3a20, 0.45));
    // панель приладів/радіо на борту над столом
    this.box(g, 0.06, 0.5, 0.95, 1.12, S + 1.1, 0.95, this.mat(0x2b2f35, 0.5, 0.3));
    {
      const scr = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.34), new THREE.MeshStandardMaterial({ color: 0x0a1a14, emissive: 0x2fae7a, emissiveIntensity: 0.8, roughness: 0.4 }));
      scr.position.set(1.085, S + 1.15, 0.78);
      g.add(scr);
      const vhf = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.28), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffa040, emissiveIntensity: 0.5, roughness: 0.5 }));
      vhf.position.set(1.08, S + 1.0, 1.18);
      g.add(vhf);
      this.box(g, 0.05, 0.06, 0.1, 1.07, S + 1.13, 1.33, this.mat(0x111111, 0.6), false); // мікрофон
    }
    // карта на столі
    this.box(g, 0.4, 0.004, 0.55, 0.82, S + 0.785, 0.95, this.mat(0xe8dcbc, 0.95), false);

    // ── салон: дивани з подушками, стіл, полиці ──
    const sz0 = 1.62;
    const sz1 = 2.62;
    const szc = (sz0 + sz1) / 2;
    for (const s of [-1, 1]) {
      this.box(g, 0.62, 0.38, sz1 - sz0, s * 0.88, S + 0.19, szc, wood);
      this.box(g, 0.6, 0.1, sz1 - sz0 - 0.04, s * 0.86, S + 0.43, szc, cushion);
      const back = this.box(g, 0.12, 0.45, sz1 - sz0 - 0.04, s * 1.12, S + 0.72, szc, cushion);
      back.rotation.z = s * 0.15;
      // полиці над диванами
      this.box(g, 0.3, 0.3, sz1 - sz0, s * 1.05, DECK_Y - 0.33, szc, wood);
    }
    // відкидний стіл біля лівого дивана
    this.cyl(g, 0.035, 0.05, 0.7, -0.38, S + 0.35, szc, woodDark, 8);
    this.box(g, 0.34, 0.04, 0.85, -0.42, S + 0.72, szc, wood);
    // кружка на столі
    this.cyl(g, 0.035, 0.03, 0.08, -0.4, S + 0.78, szc + 0.2, this.mat(0xd2483c, 0.6), 10);
    // ── носова переборка з дверним прорізом + V-койка ──
    const bz = 2.66;
    const doorX = 0.42;
    const bh = DECK_Y - 0.14 - S;
    for (const s of [-1, 1]) this.box(g, 1.0, bh, 0.05, s * (doorX + 0.5), S + bh / 2, bz, wood);
    this.box(g, doorX * 2, 0.22, 0.05, 0, DECK_Y - 0.25, bz, wood);
    for (const s of [-1, 1]) this.box(g, 0.05, bh, 0.07, s * doorX, S + bh / 2, bz, woodDark);
    // V-койка: трапецієвидна платформа з матрацом
    const vShape = new THREE.Shape();
    vShape.moveTo(-0.85, 0);
    vShape.lineTo(0.85, 0);
    vShape.lineTo(0.22, -1.2);
    vShape.lineTo(-0.22, -1.2);
    vShape.closePath();
    const mkV = (h: number, inset: number) => {
      const geo = new THREE.ExtrudeGeometry(vShape, { depth: h, bevelEnabled: true, bevelThickness: inset, bevelSize: inset, bevelSegments: 2 });
      geo.rotateX(-Math.PI / 2);
      return geo;
    };
    const vBase = new THREE.Mesh(mkV(0.55, 0.0), wood);
    vBase.position.set(0, S, bz + 0.05);
    g.add(vBase);
    const mattress = new THREE.Mesh(mkV(0.1, 0.03), this.mat(0xe7e1d4, 0.95));
    mattress.scale.set(0.95, 1, 0.95);
    mattress.position.set(0, S + 0.58, bz + 0.1);
    g.add(mattress);
    const pillow = this.box(g, 0.5, 0.1, 0.28, 0, S + 0.73, bz + 0.95, this.mat(0xf3efe6, 0.95));
    pillow.rotation.x = -0.15;
    const blanket = this.box(g, 1.1, 0.04, 0.55, 0, S + 0.71, bz + 0.4, cushion);
    blanket.rotation.z = 0.03;

    // плафони + тепле світло
    const lm = new THREE.MeshStandardMaterial({ color: 0xfff4e0, emissive: 0xffd9a0, emissiveIntensity: 0.5, roughness: 0.5 });
    for (const z of [0.9, 2.1]) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.03, 14), lm);
      lamp.position.set(0, HOUSE.top - 0.05, z);
      g.add(lamp);
    }
    this.refs.glowMats.push(lm);
    this.refs.interiorLight.position.set(0, HOUSE.top - 0.3, 1.5);
    g.add(this.refs.interiorLight);
    // обшивка рубки зсередини: дерево нижче й вище вікон (вікна лишаються видні)
    {
      const H = HOUSE.top - DECK_Y;
      const winC = DECK_Y + H * 0.58;
      const len = HOUSE.z1 - HOUSE.z0 - 0.25;
      const zc = (HOUSE.z0 + HOUSE.z1) / 2 + 0.05;
      for (const s of [-1, 1]) {
        const lo0 = DECK_Y - 0.14;
        const lo1 = winC - 0.15;
        const low = this.box(g, 0.03, lo1 - lo0, len, s * (HOUSE.x - 0.12), (lo0 + lo1) / 2, zc, wood, false);
        low.rotation.z = s * 0.1;
        const hi0 = winC + 0.15;
        const hi1 = HOUSE.top - 0.05;
        const high = this.box(g, 0.03, hi1 - hi0, len, s * (HOUSE.x - 0.15), (hi0 + hi1) / 2, zc, wood, false);
        high.rotation.z = s * 0.1;
        // стики вікон (рамки)
        this.box(g, 0.05, 0.03, len, s * (HOUSE.x - 0.13), lo1, zc, woodDark, false);
      }
      // носова стінка рубки зсередини
      this.box(g, HOUSE.x * 2 - 0.3, H + 0.1, 0.03, 0, DECK_Y + H / 2 - 0.05, HOUSE.z1 - 0.2, wood, false);
      // кормова — обабіч компаньйона
      const sideW = HOUSE.x - STAIR.x - 0.1;
      for (const s of [-1, 1]) this.box(g, sideW, H + 0.1, 0.03, s * (STAIR.x + sideW / 2 + 0.02), DECK_Y + H / 2 - 0.05, HOUSE.z0 + 0.09, wood, false);
    }
    // стеля рубки зсередини (headliner)
    this.box(g, HOUSE.x * 2 - 0.16, 0.02, HOUSE.z1 - 0.45 - 0.2, 0, HOUSE.top - 0.04, (0.45 + HOUSE.z1) / 2 - 0.1, HEADLINER, false);
  }

  // ── візуали апгрейдів: кожен рівень — фізична річ (upgradeParts.ts) ──
  private buildUpgradeVisuals() {
    const g = this.g;
    const upg = this.refs.upg;
    const kit = { mat: (c: number, r?: number, m?: number) => this.mat(c, r, m) };
    for (const id of Object.keys(PART_SPECS) as UpgradeId[]) {
      PART_SPECS[id].forEach((spec, i) => {
        const lvl = i + 1;
        const o = buildPartOnBoat(id, lvl, kit);
        o.userData.lvl = lvl;
        if (spec.until) o.userData.until = spec.until;
        o.visible = false;
        o.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
        (spec.parent === 'rod' ? this.refs.rod : g).add(o);
        (upg[id] ||= []).push(o);
        // ліхтарі: скло світиться, деякі ще й світять
        if (spec.lamp || spec.spot) {
          o.traverse((c) => {
            if (c.name !== 'glass') return;
            const lamp = c as THREE.Mesh;
            lamp.castShadow = false;
            let light: THREE.PointLight | null = null;
            if (spec.lamp === 'light') {
              light = new THREE.PointLight(0xffd9a0, 0, eff.lightRadius(1), 1.6);
              light.position.y = 0.1;
              lamp.add(light);
            }
            this.refs.lights.push({ light, lamp });
          });
        }
        if (spec.spot) {
          const mount = o.children[0];
          const spot = new THREE.SpotLight(0xfff2d0, 0, 40, 0.5, 0.5, 1.2);
          spot.position.set(0, 0.2, 0.12);
          const tgt = new THREE.Object3D();
          tgt.position.set(0, -2.5, 14);
          mount.add(spot, tgt);
          spot.target = tgt;
          this.refs.spotlight = spot;
        }
      });
    }
  }
}
