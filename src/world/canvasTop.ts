import * as THREE from 'three';
import { DECK_Y, HOUSE, COCKPIT, TENT } from './yachtLayout';
import type { PartKit } from './upgradeParts';

// ─────────────────────────────────────────────────────────────
// Тент кокпіту (апгрейд «Тент»): м'яка парусина замість жорсткого даху.
//   1 — козирок над трапом (sprayhood): обручі, віконця з прозорого вінілу;
//   2 — біміні над штурвалом: від кормової дуги до переднього обруча,
//       з «вітрильним» віконцем — грот видно й з-під тенту;
//   3 — штори: бічні полотна скручені під краєм біміні, у негоду опускаються
//       (E на завісі), разом зі з'єднувальною вставкою між біміні й козирком;
//   4 — затишний кокпіт: подушки на лавах, тепла гірлянда під біміні;
//   5 — штормовий тент: важка «дубова» парусина з подвійним швом.
// Тканина — сітки з невеликою кількістю вершин; провис і тріпотіння від вітру
// рахуються на CPU лише для видимих полотен.
// ─────────────────────────────────────────────────────────────

const NAVY = 0x24375a;
const TAN = 0x8a3f2c;
const BIND = 0xe9dcc0;

type SurfFn = (u: number, v: number, out: THREE.Vector3) => void;

interface Cloth {
  mesh: THREE.Mesh;
  win: THREE.Mesh;
  base: Float32Array;
  nrm: Float32Array;
  /** вага тріпотіння у вершині: 0 біля обручів, 1 посередині полотна */
  w: Float32Array;
  amp: number;
  phase: number;
}

/** текстура парусини: плетіння, шви, окантовка; вікна — альфа 0 (вирізає alphaTest) */
function canvasTex(color: number, windows: Array<[number, number, number, number]>, seams: number[], invert = false): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  // нейтральна (світла) основа — колір дає матеріал (синій / «дубовий» штормовий)
  void color;
  const col = new THREE.Color(0xf2f2f2);
  const css = (k: number, a = 1) => `rgba(${Math.round(col.r * 255 * k)},${Math.round(col.g * 255 * k)},${Math.round(col.b * 255 * k)},${a})`;
  if (!invert) {
    g.fillStyle = css(1);
    g.fillRect(0, 0, S, S);
    // плетіння: дрібні світлі й темні риски
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      g.fillStyle = Math.random() < 0.5 ? css(1.18, 0.35) : css(0.8, 0.35);
      g.fillRect(x, y, Math.random() < 0.5 ? 3 : 1, Math.random() < 0.5 ? 1 : 3);
    }
    // шви між полотнищами (по v) — подвійна строчка
    g.strokeStyle = css(0.7, 0.9);
    g.lineWidth = 2;
    for (const sv of seams) {
      g.beginPath();
      g.moveTo(0, sv * S);
      g.lineTo(S, sv * S);
      g.stroke();
    }
    g.setLineDash([4, 4]);
    g.strokeStyle = `rgba(255,248,230,0.9)`;
    g.lineWidth = 1;
    for (const sv of seams) for (const d of [-4, 4]) {
      g.beginPath();
      g.moveTo(0, sv * S + d);
      g.lineTo(S, sv * S + d);
      g.stroke();
    }
    g.setLineDash([]);
    // окантовка по краю
    g.strokeStyle = `rgba(255,250,236,1)`;
    g.lineWidth = 7;
    g.strokeRect(0, 0, S, S);
  } else g.clearRect(0, 0, S, S);
  // вікна з прозорого вінілу: у тканині — дірка, в «вінілі» — легкий блиск
  for (const [u0, v0, u1, v1] of windows) {
    const x = u0 * S, y = v0 * S, w = (u1 - u0) * S, h = (v1 - v0) * S;
    if (!invert) {
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      g.beginPath();
      g.roundRect(x, y, w, h, 10);
      g.fill();
      g.restore();
      // рамка-кант навколо вікна
      g.strokeStyle = `rgba(255,250,236,1)`;
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(x - 2, y - 2, w + 4, h + 4, 11);
      g.stroke();
    } else {
      const gr = g.createLinearGradient(x, y, x + w, y + h);
      gr.addColorStop(0, 'rgba(210,235,245,0.2)');
      gr.addColorStop(0.45, 'rgba(255,255,255,0.06)');
      gr.addColorStop(0.55, 'rgba(255,255,255,0.18)');
      gr.addColorStop(1, 'rgba(200,225,240,0.12)');
      g.fillStyle = gr;
      g.beginPath();
      g.roundRect(x, y, w, h, 10);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** сітка nu×nv за параметричною функцією */
function surface(nu: number, nv: number, fn: SurfFn): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      fn(u, v, p);
      pos.push(p.x, p.y, p.z);
      uv.push(u, 1 - v);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** нержавіюча трубка вздовж ламаної */
function tube(parent: THREE.Object3D, pts: THREE.Vector3[], r: number, m: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(6, pts.length * 6), r, 6, false), m);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// ── форми полотен (локаль яхти) ──
/** козирок: u — поперек, v — від кормового обруча до даху рубки */
const sprayFn: SurfFn = (u, v, o) => {
  const s = u * 2 - 1;
  const w = TENT.sx - 0.05 * v;
  const dome = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(s), 3)));
  const H = TENT.sh * (1 - Math.pow(v, 1.6)) * (1 - 0.06 * v);
  o.set(s * w, HOUSE.top + 0.02 + H * dome, TENT.sz0 + v * (TENT.sz1 - TENT.sz0) - 0.06 * (1 - v) * (1 - dome));
};
/** біміні: u — поперек, v — від кормової дуги до переднього обруча; провис між дугами */
function bimY(s: number, v: number): number {
  const top = TENT.by0 + (TENT.by1 - TENT.by0) * v;
  return top - 0.13 * s * s - 0.035 * Math.pow(Math.sin(Math.PI * v * 2), 2) * (1 - s * s);
}
const biminiFn: SurfFn = (u, v, o) => {
  const s = u * 2 - 1;
  o.set(s * TENT.bx, bimY(s, v), TENT.bz0 + v * (TENT.bz1 - TENT.bz0));
};
/** верхня точка краю тенту над коамінгом при z (біміні або вставка) — для штор */
const CONN_X1 = TENT.sx - 0.1;
const CONN_Y1 = HOUSE.top + 0.02 + TENT.sh * 0.78;
function connEdge(z: number, out: THREE.Vector3) {
  // вставка: від переднього обруча біміні (z = bz1) до кормового обруча козирка (sz0)
  const t = (z - TENT.bz1) / (TENT.sz0 - TENT.bz1);
  out.set(TENT.bx + (CONN_X1 - TENT.bx) * t, bimY(1, 1) + (CONN_Y1 - bimY(1, 1)) * t, z);
}
const connFn: SurfFn = (u, v, o) => {
  const s = u * 2 - 1;
  const z = TENT.bz1 + v * (TENT.sz0 - TENT.bz1);
  const half = TENT.bx + (CONN_X1 - TENT.bx) * v;
  const yc = bimY(0, 1) + (HOUSE.top + 0.02 + TENT.sh - bimY(0, 1)) * v;
  const ys = bimY(1, 1) + (CONN_Y1 - bimY(1, 1)) * v;
  o.set(s * half, yc + (ys - yc) * s * s - 0.03 * Math.sin(Math.PI * v) * (1 - s * s), z);
};

export class CanvasTop {
  readonly group = new THREE.Group();
  level = 0;
  /** 0 — штори скручені, 1 — опущені */
  private k = 0;
  /** 0 — тент розкладено, 1 — складено (біміні — до дуги, козирок — на дах рубки) */
  private f = 0;
  private cloths: Cloth[] = [];
  private spray = new THREE.Group();
  private bimini = new THREE.Group();
  private curtains = new THREE.Group();
  private conn = new THREE.Group();
  private cozy = new THREE.Group();
  /** гірлянда під біміні — складається разом із ним */
  private bulbs = new THREE.Group();
  /** бічні штори: геометрія перебудовується під час скручування */
  private sides: Array<{ mesh: THREE.Mesh; win: THREE.Mesh; roll: THREE.Mesh; s: number }> = [];
  private fabric: THREE.MeshStandardMaterial[] = [];
  private lampMat: THREE.MeshStandardMaterial;
  private t = Math.random() * 10;
  private _v = new THREE.Vector3();
  private _w = new THREE.Vector3();

  constructor(parent: THREE.Object3D, private visual = false) {
    parent.add(this.group);
    const steel = new THREE.MeshStandardMaterial({ color: 0xd9dee3, roughness: 0.25, metalness: 0.9 });
    const bind = new THREE.MeshStandardMaterial({ color: BIND, roughness: 0.8 });

    // ── 1: козирок ──
    {
      const tex = canvasTex(NAVY, [[0.12, 0.5, 0.46, 0.9], [0.54, 0.5, 0.88, 0.9]], [0.42]);
      this.addCloth(this.spray, surface(14, 8, sprayFn), tex, [[0.12, 0.5, 0.46, 0.9], [0.54, 0.5, 0.88, 0.9]], (u, v) => {
        const s = Math.abs(u * 2 - 1);
        return Math.sin(Math.PI * Math.min(1, v * 2.2)) * (1 - s * s) * 0.6;
      }, 0.012);
      // обручі: кормовий (край отвору) і середній
      for (const v of [0, 0.42]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 12; i++) {
          const p = new THREE.Vector3();
          sprayFn(i / 12, v, p);
          p.y += 0.012;
          pts.push(p);
        }
        tube(this.spray, pts, v === 0 ? 0.016 : 0.012, v === 0 ? bind : steel);
      }
      // поручень-ручка на козирку
      const hp: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const p = new THREE.Vector3();
        sprayFn(0.3 + (i / 6) * 0.4, 0.2, p);
        p.y += 0.06;
        hp.push(p);
      }
      tube(this.spray, hp, 0.012, new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.6 }));
    }

    // ── 2: біміні ──
    {
      // «вітрильне» вікно: над головою стерновика й уперед — грот видно з-під тенту
      const win: Array<[number, number, number, number]> = [[0.2, 0.1, 0.8, 0.88]];
      const tex = canvasTex(NAVY, win, [0.5]);
      this.addCloth(this.bimini, surface(14, 10, biminiFn), tex, win, (u, v) => {
        const s = Math.abs(u * 2 - 1);
        return Math.sin(Math.PI * v) * (0.35 + 0.65 * s) * (v > 0.5 ? 1 : 0.6);
      }, 0.02);
      // передній обруч (дуга над кокпітом) і середній — ноги на коамінгах
      for (const v of [1, 0.5]) {
        const top: THREE.Vector3[] = [];
        const foot = (s: number) => new THREE.Vector3(s * (COCKPIT.x + 0.02), DECK_Y + 0.44, TENT.bz1 + 0.3);
        top.push(foot(-1));
        for (let i = 0; i <= 10; i++) {
          const p = new THREE.Vector3();
          biminiFn(i / 10, v, p);
          p.y += 0.015;
          top.push(p);
        }
        top.push(foot(1));
        tube(this.bimini, top, 0.016, steel);
      }
    }

    // ── 3: штори й з'єднувальна вставка ──
    {
      const win: Array<[number, number, number, number]> = [[0.2, 0.12, 0.8, 0.88]];
      const tex = canvasTex(NAVY, win, [0.5]);
      this.addCloth(this.conn, surface(12, 8, connFn), tex, win, (u, v) => Math.sin(Math.PI * v) * (1 - Math.abs(u * 2 - 1) * 0.5), 0.015);
      // бокові полотна вставки (від її краю донизу до коамінга)
      for (const s of [-1, 1]) {
        const fn: SurfFn = (u, v, o) => {
          const z = TENT.bz1 + u * (TENT.sz0 + 0.02 - TENT.bz1);
          connEdge(z, this._v);
          o.set(s * this._v.x, this._v.y + (DECK_Y + 0.44 - this._v.y) * v, z);
          o.x += s * (COCKPIT.x + 0.02 - this._v.x) * v;
        };
        const sw: Array<[number, number, number, number]> = [[0.08, 0.1, 0.92, 0.6]];
        this.addCloth(this.conn, surface(10, 6, fn), canvasTex(NAVY, sw, []), sw, (u, v) => Math.sin(Math.PI * u) * v, 0.02);
      }
      this.conn.position.z = 0;
      this.curtains.add(this.conn);
      // бічні штори під біміні: скручуються вгору (рулон під краєм тенту)
      for (const s of [-1, 1]) {
        const sw: Array<[number, number, number, number]> = [[0.08, 0.1, 0.92, 0.62]];
        const tex = canvasTex(NAVY, sw, []);
        const mat = this.fabricMat(tex);
        const wm = new THREE.MeshStandardMaterial({ map: canvasTex(NAVY, sw, [], true), transparent: true, depthWrite: false, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide });
        const geo = surface(10, 6, (u, v, o) => o.set(0, 0, 0));
        const mesh = new THREE.Mesh(geo, mat);
        const win = new THREE.Mesh(geo, wm);
        const roll = new THREE.Mesh(new THREE.BufferGeometry(), this.fabricMat(canvasTex(NAVY, [], [])));
        this.curtains.add(mesh, win, roll);
        this.sides.push({ mesh, win, roll, s });
      }
    }

    // ── 4: затишок — подушки на лавах і гірлянда під біміні ──
    {
      const cushion = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.95 });
      for (const s of [-1, 1]) {
        for (const z of [-2.0, -1.2]) {
          const c = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.76), cushion);
          c.position.set(s * (COCKPIT.x - 0.22), DECK_Y + 0.5, z);
          c.scale.set(1, 1, 1);
          this.cozy.add(c);
        }
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 1.55), cushion);
        back.position.set(s * (COCKPIT.x - 0.06), DECK_Y + 0.62, -1.6);
        back.rotation.z = s * 0.12;
        this.cozy.add(back);
      }
      this.lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffc070, emissiveIntensity: 0.15 });
      const bulb = new THREE.SphereGeometry(0.022, 8, 6);
      for (let i = 0; i < 14; i++) {
        const v = 0.08 + (i / 13) * 0.86;
        const s = i % 2 ? 0.86 : -0.86;
        const p = new THREE.Vector3();
        biminiFn((s + 1) / 2, v, p);
        const b = new THREE.Mesh(bulb, this.lampMat);
        b.position.set(p.x * 0.97, p.y - 0.06, p.z);
        this.bulbs.add(b);
      }
    }

    this.bimini.add(this.curtains, this.bulbs);
    this.group.add(this.spray, this.bimini, this.cozy);
    if (this.visual) this.group.traverse((o) => ((o as THREE.Mesh).castShadow = false));
    this.setLevel(0);
    this.layoutSides(0);
  }

  private fabricMat(map: THREE.Texture): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ map, color: NAVY, roughness: 0.92, side: THREE.DoubleSide, alphaTest: 0.5 });
    this.fabric.push(m);
    return m;
  }

  private addCloth(parent: THREE.Object3D, geo: THREE.BufferGeometry, tex: THREE.Texture, windows: Array<[number, number, number, number]>, weight: (u: number, v: number) => number, amp: number) {
    const mesh = new THREE.Mesh(geo, this.fabricMat(tex));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const win = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: canvasTex(NAVY, windows, [], true), transparent: true, depthWrite: false, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide }));
    win.renderOrder = 2;
    parent.add(mesh, win);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const w = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) w[i] = weight(uv.getX(i), 1 - uv.getY(i));
    this.cloths.push({ mesh, win, base: Float32Array.from(pos.array as Float32Array), nrm: Float32Array.from(geo.attributes.normal.array as Float32Array), w, amp, phase: Math.random() * 6 });
  }

  /** бічні штори при ступені k (0 — скручені вгору, 1 — опущені) */
  private layoutSides(k: number) {
    const NU = 10, NV = 6;
    for (const sd of this.sides) {
      const s = sd.s;
      const geo = sd.mesh.geometry;
      let pos = geo.attributes.position as THREE.BufferAttribute;
      if (!pos || pos.count !== (NU + 1) * (NV + 1)) {
        sd.mesh.geometry = surface(NU, NV, (u, v, o) => o.set(0, 0, 0));
        sd.win.geometry = sd.mesh.geometry;
        pos = sd.mesh.geometry.attributes.position as THREE.BufferAttribute;
      }
      const rollPts: THREE.Vector3[] = [];
      for (let j = 0; j <= NV; j++) {
        for (let i = 0; i <= NU; i++) {
          const u = i / NU, v = (j / NV) * k;
          const z = TENT.bz0 + u * (TENT.bz1 - TENT.bz0);
          // верх — край біміні; низ — коамінг (на кормі — палуба біля дуги)
          const topY = bimY(1, u) - 0.01;
          const botY = DECK_Y + (z < COCKPIT.z0 + 0.1 ? 0.06 : 0.44);
          const x = s * (TENT.bx + (COCKPIT.x + 0.03 - TENT.bx) * v);
          pos.setXYZ(j * (NU + 1) + i, x, topY + (botY - topY) * v, z);
          if (j === NV) rollPts.push(new THREE.Vector3(x + s * 0.02, topY + (botY - topY) * v - 0.02, z));
        }
      }
      pos.needsUpdate = true;
      sd.mesh.geometry.computeVertexNormals();
      sd.mesh.geometry.computeBoundingSphere();
      sd.roll.geometry.dispose();
      sd.roll.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rollPts), 16, 0.035 + 0.025 * (1 - k), 6, false);
      sd.mesh.visible = sd.win.visible = k > 0.03;
    }
    // вставка «застібається» від переднього обруча біміні до козирка
    this.conn.visible = k > 0.03;
    this.conn.scale.z = Math.max(0.001, k);
    this.conn.position.z = TENT.bz1 * (1 - k);
  }

  setLevel(l: number) {
    this.level = l;
    this.spray.visible = l >= 1;
    this.bimini.visible = l >= 2;
    this.curtains.visible = l >= 3;
    this.cozy.visible = l >= 4;
    this.bulbs.visible = l >= 4;
    for (const m of this.fabric) m.color.setHex(l >= 5 ? TAN : NAVY);
  }

  /** складання: біміні стискається до кормової дуги, козирок лягає на дах рубки */
  private applyFold() {
    const f = this.f;
    // масштаб навколо опорної точки P: position = P − P·scale
    const bz = 1 - 0.86 * f, by = 1 - 0.08 * f;
    this.bimini.scale.set(1, by, bz);
    this.bimini.position.set(0, TENT.by0 * (1 - by), TENT.bz0 * (1 - bz));
    const sz = 1 - 0.72 * f, sy = 1 - 0.78 * f;
    const py = HOUSE.top + 0.02;
    this.spray.scale.set(1, sy, sz);
    this.spray.position.set(0, py * (1 - sy), TENT.sz1 * (1 - sz));
  }

  /** тент складено (або складається) — укриття немає */
  get folded(): boolean {
    return this.f > 0.5;
  }

  /** об'єкти для підсвітки станції «скласти тент» */
  get foldObjects(): THREE.Object3D[] {
    return this.level >= 2 ? [this.bimini] : [this.spray];
  }

  /** об'єкти для підсвітки станції «штори» */
  get curtainObjects(): THREE.Object3D[] {
    return this.sides.map((s) => s.roll);
  }

  /**
   * closed — штори опущені; wind — 0..1 сила вітру; night — 0..1 (гірлянда)
   * Повертає ступінь опущених штор (для укриття / води).
   */
  update(dt: number, closed: boolean, folded: boolean, wind: number, night: number): number {
    this.t += dt;
    const ft = folded && this.level >= 1 ? 1 : 0;
    // спершу скрутити штори, тоді складати
    if (Math.abs(ft - this.f) > 1e-3 && (ft === 0 || this.k < 0.02)) {
      this.f += Math.sign(ft - this.f) * Math.min(Math.abs(ft - this.f), dt / 1.6);
      this.applyFold();
    }
    const target = closed && this.level >= 3 && !folded && this.f < 0.02 ? 1 : 0;
    if (Math.abs(target - this.k) > 1e-3) {
      this.k += Math.sign(target - this.k) * Math.min(Math.abs(target - this.k), dt / 1.4);
      if (this.level >= 3) this.layoutSides(this.k);
    }
    if (this.level >= 4) this.lampMat.emissiveIntensity = 0.15 + 1.6 * night;
    if (this.level <= 0 || this.f > 0.98) return this.k;
    // тріпотіння: синусоїди вздовж полотна, сильніше у вітер; штори опущені — тугіше
    const a = 0.25 + Math.min(1.2, wind * 1.6);
    for (const c of this.cloths) {
      if (!c.mesh.parent?.visible || !c.mesh.parent.parent?.visible) continue;
      const pos = c.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const t = this.t * (3.5 + wind * 7) + c.phase;
      for (let i = 0; i < c.w.length; i++) {
        const o = i * 3;
        const f = (Math.sin(t + arr.length * 0 + c.base[o + 2] * 6.0 + c.base[o] * 2.5) * 0.7 + Math.sin(t * 1.7 + c.base[o] * 5) * 0.3) * c.amp * a * c.w[i];
        arr[o] = c.base[o] + c.nrm[o] * f;
        arr[o + 1] = c.base[o + 1] + c.nrm[o + 1] * f;
        arr[o + 2] = c.base[o + 2] + c.nrm[o + 2] * f;
      }
      pos.needsUpdate = true;
    }
    return this.k;
  }
}

// ── полиця крамниці: що лежить для кожного рівня ──
export function tentShelfModel(l: number, k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const navy = k.mat(l >= 5 ? TAN : NAVY, 0.9);
  const sand = k.mat(BIND, 0.8);
  const steel = k.mat(0xd9dee3, 0.25, 0.9);
  // згорнута парусина з ременями
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 14), navy);
  roll.rotation.z = Math.PI / 2;
  roll.position.y = 0.075;
  g.add(roll);
  for (const x of [-0.12, 0.12]) {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.008, 4, 16), sand);
    strap.rotation.y = Math.PI / 2;
    strap.position.set(x, 0.075, 0);
    g.add(strap);
  }
  if (l === 1 || l === 2) {
    // дуги-обручі поряд
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.008, 6, 20, Math.PI), steel);
    arc.position.set(0, 0.02, -0.12);
    g.add(arc);
  }
  if (l === 3) {
    // скручена штора з прозорим віконцем
    const win = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12), k.mat(0xcfe6ef, 0.1, 0.1));
    win.rotation.z = Math.PI / 2;
    win.position.set(0, 0.05, 0.13);
    g.add(win);
  }
  if (l === 4) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.2), k.mat(0xc9b48a, 0.95));
    c.position.set(0, 0.18, 0);
    g.add(c);
  }
  return g;
}

