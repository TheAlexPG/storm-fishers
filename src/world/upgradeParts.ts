import * as THREE from 'three';
import type { UpgradeId } from '../core/types';
import { HALF_LEN, DECK_Y, WATERLINE_Y, HOUSE, COCKPIT, sheerY, hullBottomY, hullHalfWidth, hullXAt } from './yachtLayout';

// ─────────────────────────────────────────────────────────────
// Фізичні речі апгрейдів: та сама модель стоїть на полиці крамниці
// й прикручується до човна. model() — річ біля початку координат
// (основа на y = 0), mounts — де вона кріпиться на човні (локальні
// координати яхти: +Z — нос, +X — лівий борт), або onBoat() —
// окрема збірка, що повторює обводи корпусу (бруси, пояси).
// ─────────────────────────────────────────────────────────────

export interface PartKit {
  mat(color: number, rough?: number, metal?: number): THREE.Material;
}

interface Mount {
  p: [number, number, number];
  r?: [number, number, number];
  /** дзеркально по x (для пари по бортах) */
  mirror?: boolean;
}

export interface PartSpec {
  model: (k: PartKit) => THREE.Object3D;
  mounts?: Mount[];
  onBoat?: (k: PartKit) => THREE.Object3D;
  /** кріпиться до групи вудки (вона рухається під час закиду) */
  parent?: 'rod';
  /** з цього рівня ховається (замінено більшою річчю) */
  until?: number;
  /** ліхтар: скло світиться вночі; light — ще й справжнє світло */
  lamp?: 'glow' | 'light';
  /** прожектор на даху */
  spot?: boolean;
  /** кут огляду на вітрині (рад, за замовчуванням −0.6) */
  view?: number;
}

// ── матеріали ──
const STEEL = 0xc9ced3;
const DARK = 0x30343a;
const RUBBER = 0x1c2024;
const BRASS = 0xc9a227;

// ── дрібні помічники ──
function box(g: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  g.add(o);
  return o;
}
function cyl(g: THREE.Object3D, m: THREE.Material, rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 14): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  o.position.set(x, y, z);
  g.add(o);
  return o;
}
/** циліндр уздовж осі z */
function cylZ(g: THREE.Object3D, m: THREE.Material, r: number, h: number, x: number, y: number, z: number, seg = 14): THREE.Mesh {
  const o = cyl(g, m, r, r, h, x, y, z, seg);
  o.rotation.x = Math.PI / 2;
  return o;
}
/** циліндр уздовж осі x */
function cylX(g: THREE.Object3D, m: THREE.Material, r: number, h: number, x: number, y: number, z: number, seg = 14): THREE.Mesh {
  const o = cyl(g, m, r, r, h, x, y, z, seg);
  o.rotation.z = Math.PI / 2;
  return o;
}
function tube(g: THREE.Object3D, m: THREE.Material, pts: THREE.Vector3[], r: number, seg = 40, radial = 8): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, radial), m);
  g.add(o);
  return o;
}
/** стрічка-плита, що лягає на корпус: u — уздовж z, v — по висоті */
function hullPlate(m: THREE.Material, z0: number, z1: number, yAt: (z: number, v: number) => number, out: number, side: number): THREE.Mesh {
  const NU = 14, NV = 4;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= NU; i++) {
    const z = z0 + ((z1 - z0) * i) / NU;
    for (let j = 0; j <= NV; j++) {
      const y = yAt(z, j / NV);
      pos.push(side * (hullXAt(y, z) + out), y, z);
    }
  }
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j, b = a + NV + 1;
      if (side > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
      else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, m);
}
/** трубка вздовж обводу борту (bar на висоті sheer + dy) */
function sheerBar(m: THREE.Material, dy: number, out: number, r: number, z0 = -HALF_LEN + 0.1, z1 = HALF_LEN - 0.4): THREE.Group {
  const grp = new THREE.Group();
  for (const s of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 30; i++) {
      const z = z0 + (i / 30) * (z1 - z0);
      const y = sheerY(z) + dy;
      pts.push(new THREE.Vector3(s * (hullXAt(y, z) + out), y, z));
    }
    tube(grp, m, pts, r, 60, 7);
  }
  return grp;
}

// ── моделі ──

function exhaust(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const st = k.mat(STEEL, 0.2, 0.95);
  cylZ(g, st, 0.11, 0.03, 0, 0, -0.015);
  cylZ(g, st, 0.07, 0.16, 0, 0, -0.1);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 16), st);
  lip.position.z = -0.18;
  g.add(lip);
  cylZ(g, k.mat(0x111111, 0.9), 0.06, 0.01, 0, 0, -0.18);
  return g;
}

function cowlVent(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const w = k.mat(0xf2efe8, 0.4, 0.1);
  cyl(g, k.mat(STEEL, 0.25, 0.9), 0.1, 0.11, 0.03, 0, 0.015, 0);
  cyl(g, w, 0.055, 0.06, 0.24, 0, 0.15, 0);
  const elbow = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.06, 10, 14, Math.PI / 2), w);
  elbow.rotation.y = -Math.PI / 2;
  elbow.position.set(0, 0.27, 0.08);
  g.add(elbow);
  const mouth = cyl(g, w, 0.09, 0.07, 0.07, 0, 0.35, 0.1);
  mouth.rotation.x = Math.PI / 2;
  const inner = cyl(g, k.mat(0xc8431c, 0.7), 0.075, 0.075, 0.01, 0, 0.35, 0.135);
  inner.rotation.x = Math.PI / 2;
  return g;
}

function louvredHood(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  box(g, k.mat(0x3a3f45, 0.5, 0.5), 0.8, 0.04, 0.46, 0, 0.02, 0);
  const slat = k.mat(STEEL, 0.3, 0.85);
  for (let i = 0; i < 6; i++) {
    const s = box(g, slat, 0.66, 0.012, 0.05, 0, 0.05, -0.17 + i * 0.068);
    s.rotation.x = -0.5;
  }
  for (const x of [-0.37, 0.37]) box(g, slat, 0.02, 0.03, 0.4, x, 0.05, 0);
  return g;
}

function turboStack(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const chrome = k.mat(0xdfe3e8, 0.15, 1);
  const H = 2.2;
  // равлик турбіни біля основи
  const snail = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.055, 10, 18, Math.PI * 1.6), k.mat(0x6d7178, 0.35, 0.85));
  snail.position.set(0, 0.2, 0);
  g.add(snail);
  cyl(g, k.mat(DARK, 0.5, 0.6), 0.07, 0.07, 0.12, 0, 0.2, 0);
  cyl(g, chrome, 0.11, 0.13, 0.05, 0, 0.025, 0);
  cyl(g, chrome, 0.055, 0.055, H, 0, H / 2 + 0.05, 0);
  // верхній зріз з «кришкою» від дощу
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 14), chrome);
  cap.position.set(0, H + 0.08, -0.03);
  cap.rotation.x = -0.6;
  g.add(cap);
  for (const y of [0.9, 1.6]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.01, 6, 14), k.mat(DARK, 0.5, 0.6));
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    g.add(band);
  }
  return g;
}

function rubrailSample(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 1.5;
    pts.push(new THREE.Vector3(Math.cos(a) * 0.35, 0.05 + i * 0.012, Math.sin(a) * 0.35));
  }
  tube(g, k.mat(RUBBER, 0.85), pts, 0.045, 40, 8);
  return g;
}

function stemCurve(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 14; i++) {
    const z = 3.0 + (i / 14) * (HALF_LEN - 0.02 - 3.0);
    pts.push(new THREE.Vector3(0, hullBottomY(z) + 0.02, z + 0.02));
  }
  pts.push(new THREE.Vector3(0, sheerY(HALF_LEN) - 0.02, HALF_LEN + 0.02));
  return pts.filter((p) => p.y > WATERLINE_Y - 0.4);
}

function stemBand(k: PartKit, centered: boolean): THREE.Object3D {
  const g = new THREE.Group();
  let pts = stemCurve();
  if (centered) {
    const c = pts[0].clone();
    pts = pts.map((p) => p.clone().sub(c));
  }
  tube(g, k.mat(0xdfe3e8, 0.15, 1), pts, 0.035, 30, 6);
  return g;
}

function bowPlateY(z: number, v: number) {
  return 0.62 + v * 0.36 + (z - 2.6) * 0.04;
}
function bowPlate(k: PartKit, side: number): THREE.Group {
  const g = new THREE.Group();
  const m = k.mat(0x59626b, 0.4, 0.75);
  (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  g.add(hullPlate(m, 2.5, 4.15, bowPlateY, 0.012, side));
  // заклепки
  const rivet = k.mat(0x8a939c, 0.3, 0.9);
  for (let i = 0; i <= 6; i++) {
    const z = 2.6 + i * 0.24;
    for (const v of [0.12, 0.88]) {
      const y = bowPlateY(z, v);
      const r = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), rivet);
      r.position.set(side * (hullXAt(y, z) + 0.016), y, z);
      g.add(r);
    }
  }
  return g;
}

function bulwark(k: PartKit, sides: number[]): THREE.Group {
  const g = new THREE.Group();
  const m = k.mat(0x1d2b45, 0.45, 0.5);
  (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  const cap = k.mat(STEEL, 0.25, 0.9);
  for (const s of sides) {
    const pos: number[] = [];
    const idx: number[] = [];
    const N = 18;
    const top: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const z = 1.4 + (i / N) * (HALF_LEN - 0.35 - 1.4);
      const x = s * (hullHalfWidth(z) + 0.005);
      const y0 = sheerY(z) - 0.02;
      const h = 0.14 + 0.06 * (i / N);
      pos.push(x, y0, z, x, y0 + h, z);
      top.push(new THREE.Vector3(x, y0 + h, z));
      if (i < N) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, m));
    tube(g, cap, top, 0.018, 30, 5);
  }
  return g;
}

function crate(k: PartKit, color: number, lid: number): THREE.Object3D {
  const g = new THREE.Group();
  box(g, k.mat(color, 0.85), 0.42, 0.28, 0.42, 0, 0.14, 0);
  box(g, k.mat(lid, 0.8), 0.44, 0.04, 0.44, 0, 0.3, 0);
  const slot = k.mat(0x1a2a3a, 0.9);
  for (const x of [-0.212, 0.212]) box(g, slot, 0.005, 0.04, 0.14, x, 0.2, 0);
  return g;
}

function cooler(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  box(g, k.mat(0xf4f2ec, 0.5), 0.46, 0.26, 0.34, 0, 0.13, 0);
  box(g, k.mat(0x2f6fb0, 0.6), 0.48, 0.06, 0.36, 0, 0.29, 0);
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 6, 16, Math.PI), k.mat(DARK, 0.5));
  h.position.set(0, 0.32, 0);
  g.add(h);
  return g;
}

function roofBox(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const m = k.mat(0x4a6b8a, 0.55, 0.1);
  box(g, m, 0.9, 0.26, 0.66, 0, 0.13, 0);
  const top = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m);
  top.scale.set(0.46, 0.12, 0.34);
  top.position.y = 0.26;
  g.add(top);
  for (const x of [-0.3, 0.3]) box(g, k.mat(DARK, 0.6), 0.05, 0.03, 0.8, x, 0.015, 0);
  return g;
}

function netBag(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), k.mat(0x4f7a5c, 0.95));
  body.scale.set(0.38, 0.16, 0.5);
  body.position.y = 0.14;
  g.add(body);
  const net = new THREE.Mesh(new THREE.SphereGeometry(1.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0x24392b, wireframe: true }));
  net.scale.copy(body.scale);
  net.position.copy(body.position);
  g.add(net);
  // поплавки по краю
  const fl = k.mat(0xe9792f, 0.6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), fl);
    f.position.set(Math.cos(a) * 0.38, 0.06, Math.sin(a) * 0.5);
    g.add(f);
  }
  return g;
}

/** котушка: вісь по x, «лапка» кріплення вгору (до бланка) */
function reel(k: PartKit, r: number, body: number, spool: number): THREE.Group {
  const g = new THREE.Group();
  cylX(g, k.mat(body, 0.3, 0.85), r, r * 1.1, 0, 0, 0);
  cylX(g, k.mat(spool, 0.4, 0.5), r * 0.8, r * 1.14, 0, 0, 0);
  for (const s of [-1, 1]) cylX(g, k.mat(body, 0.3, 0.85), r * 1.06, r * 0.12, s * r * 0.6, 0, 0);
  box(g, k.mat(DARK, 0.4, 0.6), r * 0.3, r * 0.9, r * 0.3, 0, r * 1.2, 0);
  const handle = box(g, k.mat(DARK, 0.4, 0.6), 0.012, r * 1.2, 0.012, r * 0.75, -r * 0.3, 0);
  handle.rotation.x = 0.4;
  cylX(g, k.mat(0x2a2a2a, 0.7), r * 0.18, r * 0.35, r * 0.85, -r * 0.85, r * 0.25);
  return g;
}

function braidSpool(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const s = cylX(g, k.mat(0xff7a1f, 0.6), 0.075, 0.1, 0, 0.09, 0, 18);
  s.castShadow = true;
  for (const x of [-0.055, 0.055]) cylX(g, k.mat(0x22282e, 0.5), 0.09, 0.012, x, 0.09, 0, 18);
  box(g, k.mat(0x22282e, 0.5), 0.14, 0.02, 0.1, 0, 0.005, 0);
  return g;
}

function rodRack(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const st = k.mat(STEEL, 0.25, 0.9);
  cylX(g, st, 0.025, 1.0, 0, 0.12, 0);
  for (const x of [-0.45, 0.45]) cyl(g, st, 0.022, 0.022, 0.12, x, 0.06, 0, 8);
  for (const x of [-0.3, 0, 0.3]) {
    const t = cyl(g, st, 0.032, 0.03, 0.3, x, 0.22, -0.06, 10);
    t.rotation.x = -0.45;
  }
  return g;
}

/** вудка в тримачі: росте з (0,0,0) під нахилом назад */
function rackRod(k: PartKit, len: number, thick: number, reelBody: number): THREE.Object3D {
  const g = new THREE.Group();
  const blank = new THREE.Mesh(new THREE.CylinderGeometry(0.007 * thick, 0.02 * thick, len, 7).translate(0, len / 2, 0), k.mat(0x1d232a, 0.35, 0.4));
  g.add(blank);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026 * thick, 0.026 * thick, 0.32, 8).translate(0, 0.16, 0), k.mat(0x3a2a1c, 0.9));
  g.add(grip);
  const rl = reel(k, 0.045 * thick, reelBody, 0xff7a1f);
  rl.rotation.x = Math.PI / 2;
  rl.position.set(0, 0.42, -0.06 * thick);
  g.add(rl);
  const steel = k.mat(STEEL, 0.25, 0.9);
  for (const f of [0.4, 0.62, 0.84]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016 - f * 0.007, 0.003, 4, 10), steel);
    ring.position.set(0, len * f, -0.02);
    g.add(ring);
  }
  g.rotation.x = -0.45;
  return g;
}

function jerrycan(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const red = k.mat(0xc8431c, 0.55, 0.1);
  box(g, red, 0.18, 0.34, 0.28, 0, 0.17, 0);
  // рельєфні «ребра» з боків
  for (const z of [-0.06, 0.06]) box(g, k.mat(0xa8361a, 0.6, 0.1), 0.19, 0.24, 0.025, 0, 0.17, z);
  // три ручки
  for (const z of [-0.08, 0, 0.08]) box(g, red, 0.04, 0.05, 0.03, 0, 0.36, z);
  box(g, red, 0.04, 0.02, 0.22, 0, 0.39, 0);
  const sp = cyl(g, k.mat(0xdcc04a, 0.5), 0.025, 0.025, 0.06, 0, 0.37, 0.11, 10);
  sp.rotation.x = 0.4;
  return g;
}

function canRack(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const st = k.mat(STEEL, 0.25, 0.9);
  // дві поздовжні планки (рейки стелажа) уздовж каністр
  for (const y of [0.1, 0.3]) for (const x of [-0.11, 0.11]) cylZ(g, st, 0.012, 1.28, x, y, 0, 8);
  for (const z of [-0.62, 0, 0.62]) for (const x of [-0.11, 0.11]) cyl(g, st, 0.012, 0.012, 0.32, x, 0.16, z, 8);
  return g;
}

function bigTank(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const t = cylX(g, k.mat(0xa05a18, 0.5, 0.35), 0.2, 0.9, 0, 0.24, 0, 16);
  t.castShadow = true;
  for (const x of [-0.46, 0.46]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI), t.material);
    cap.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
    cap.position.set(x * 0.98, 0.24, 0);
    cap.scale.z = 0.4;
    g.add(cap);
  }
  const st = k.mat(STEEL, 0.25, 0.9);
  for (const x of [-0.28, 0.28]) {
    box(g, k.mat(DARK, 0.6), 0.06, 0.06, 0.34, x, 0.03, 0);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.008, 4, 20, Math.PI), st);
    strap.rotation.y = Math.PI / 2;
    strap.position.set(x, 0.24, 0);
    g.add(strap);
  }
  cyl(g, k.mat(0xdcc04a, 0.5), 0.04, 0.04, 0.06, 0.2, 0.46, 0, 10);
  return g;
}

function lantern(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const brass = k.mat(BRASS, 0.35, 0.8);
  cyl(g, brass, 0.05, 0.055, 0.03, 0, 0.015, 0);
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.042, 0.042, 0.1, 12),
    new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 0.15, roughness: 0.2, transparent: true, opacity: 0.9 }),
  );
  glass.name = 'glass';
  glass.position.y = 0.08;
  g.add(glass);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    cyl(g, brass, 0.006, 0.006, 0.1, Math.cos(a) * 0.045, 0.08, Math.sin(a) * 0.045, 4);
  }
  cyl(g, brass, 0.015, 0.065, 0.04, 0, 0.15, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 4, 10), brass);
  ring.position.y = 0.185;
  g.add(ring);
  return g;
}

function searchlight(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const dark = k.mat(0x2a2f36, 0.4, 0.6);
  cyl(g, dark, 0.07, 0.09, 0.06, 0, 0.03, 0);
  for (const x of [-0.11, 0.11]) box(g, dark, 0.02, 0.18, 0.04, x, 0.14, 0);
  const barrel = cylZ(g, k.mat(0xdfe3e8, 0.2, 0.95), 0.1, 0.22, 0, 0.2, 0);
  barrel.scale.set(1, 1, 1);
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.088, 18),
    new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff2d0, emissiveIntensity: 0.2, roughness: 0.1 }),
  );
  lens.name = 'glass';
  lens.position.set(0, 0.2, 0.111);
  g.add(lens);
  cylZ(g, dark, 0.085, 0.04, 0, 0.2, -0.12);
  return g;
}

function gyroDome(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  box(g, k.mat(0x3a3f45, 0.5, 0.5), 0.42, 0.06, 0.42, 0, 0.03, 0);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), k.mat(0xf2efe8, 0.3, 0.1));
  dome.position.y = 0.06;
  dome.scale.y = 0.85;
  g.add(dome);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.012, 6, 24), k.mat(0x24878c, 0.4, 0.3));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.08;
  g.add(band);
  cyl(g, k.mat(0x24878c, 0.4, 0.3), 0.025, 0.025, 0.02, 0, 0.23, 0, 10);
  return g;
}

/** плавник: площина назовні від борту (x > 0), трохи донизу */
function fin(k: PartKit, size: number): THREE.Object3D {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  const L = 0.62 * size, W = 0.42 * size;
  shape.moveTo(-L / 2, 0);
  shape.lineTo(L / 2, 0);
  shape.lineTo(L * 0.3, W);
  shape.lineTo(-L * 0.35, W * 0.92);
  shape.lineTo(-L / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 });
  geo.translate(0, 0, -0.0175);
  // площина shape (xy) → горизонтальна: x уздовж борту (z), y — назовні (x)
  geo.applyMatrix4(new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  const m = new THREE.Mesh(geo, k.mat(0x2b3036, 0.4, 0.6));
  const pivot = new THREE.Group();
  pivot.add(m);
  pivot.rotation.z = -0.25; // кінчик трохи донизу
  g.add(pivot);
  cyl(g, k.mat(0x5a636d, 0.5, 0.5), 0.05, 0.05, 0.08, 0, 0, 0, 10).rotation.z = Math.PI / 2;
  return g;
}

function servoHousing(k: PartKit): THREE.Object3D {
  const g = new THREE.Group();
  const m = k.mat(0x5d6670, 0.4, 0.5);
  box(g, m, 0.22, 0.12, 0.36, 0, 0.06, 0);
  const top = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), m);
  top.scale.set(0.11, 0.06, 0.18);
  top.position.y = 0.12;
  g.add(top);
  box(g, k.mat(0x24878c, 0.4), 0.225, 0.02, 0.365, 0, 0.08, 0);
  return g;
}

// ── розкладка на яхті ──
const AFT = -HALF_LEN; // транець
const ROOF = COCKPIT.roofY;
const finY = WATERLINE_Y + 0.03;
const finZ = 0.4;
const finX = (y: number) => hullXAt(y, finZ);
const canZ = [-3.9, -3.58, -3.26, -2.94];
const RACK: [number, number, number] = [0, ROOF + 0.02, COCKPIT.z0 + 0.12];

export const PART_SPECS: Record<UpgradeId, PartSpec[]> = {
  engine: [
    { model: exhaust, view: 2.1, mounts: [{ p: [0.75, WATERLINE_Y + 0.45, AFT + 0.02] }] },
    { model: cowlVent, mounts: [{ p: [1.3, DECK_Y, -4.5], r: [0, Math.PI, 0] }, { p: [-1.3, DECK_Y, -4.5], r: [0, Math.PI, 0], mirror: true }] },
    { model: louvredHood, mounts: [{ p: [0, DECK_Y, -4.05] }] },
    { model: exhaust, view: 2.1, mounts: [{ p: [-0.75, WATERLINE_Y + 0.45, AFT + 0.02] }] },
    { model: turboStack, mounts: [{ p: [1.28, DECK_Y, -4.22] }] },
  ],
  hull: [
    { model: rubrailSample, onBoat: (k) => sheerBar(k.mat(RUBBER, 0.85), -0.07, 0.03, 0.045) },
    { model: (k) => stemBand(k, true), onBoat: (k) => stemBand(k, false) },
    {
      model: (k) => {
        const g = new THREE.Group();
        const pts = [-0.4, -0.2, 0, 0.2, 0.4].map((z) => new THREE.Vector3(Math.sin(z * 2) * 0.08, 0.06, z));
        tube(g, k.mat(0x4a4f55, 0.4, 0.7), pts, 0.055, 20, 8);
        return g;
      },
      onBoat: (k) => sheerBar(k.mat(0x4a4f55, 0.4, 0.7), -0.4, 0.02, 0.055, -HALF_LEN + 0.3, HALF_LEN - 1.0),
    },
    {
      view: -1.9,
      model: (k) => {
        const g = bowPlate(k, 1);
        g.position.set(-hullXAt(0.8, 3.3), -0.6, -3.3);
        const w = new THREE.Group();
        w.add(g);
        return w;
      },
      onBoat: (k) => {
        const g = new THREE.Group();
        g.add(bowPlate(k, 1), bowPlate(k, -1));
        return g;
      },
    },
    {
      view: -1.9,
      model: (k) => {
        const g = bulwark(k, [1]);
        g.position.set(-1.2, -sheerY(3), -3);
        const w = new THREE.Group();
        w.add(g);
        return w;
      },
      onBoat: (k) => bulwark(k, [-1, 1]),
    },
  ],
  hold: [
    { model: (k) => crate(k, 0x3c6e9a, 0x5a8bb5), mounts: [{ p: [0.72, DECK_Y, -4.0] }] },
    { model: (k) => crate(k, 0x3c6e9a, 0x5a8bb5), mounts: [{ p: [-0.72, DECK_Y, -4.0] }] },
    { model: cooler, mounts: [{ p: [0.72, DECK_Y + 0.32, -4.0] }] },
    { model: roofBox, mounts: [{ p: [0, ROOF + 0.02, -3.45] }] },
    { model: netBag, mounts: [{ p: [-0.45, DECK_Y, 3.25], r: [0, 0.25, 0] }] },
  ],
  rod: [
    { model: (k) => reel(k, 0.06, 0xdfe3e8, 0x22282e), parent: 'rod', mounts: [{ p: [0, 0.36, -0.08], r: [Math.PI / 2, 0, 0] }] },
    { model: braidSpool, mounts: [{ p: [0.15, DECK_Y, 3.45], r: [0, 0.4, 0] }] },
    { model: rodRack, mounts: [{ p: RACK }] },
    { model: (k) => rackRod(k, 1.9, 1, 0xdfe3e8), mounts: [{ p: [RACK[0] - 0.3, RACK[1] + 0.1, RACK[2] - 0.06] }] },
    { model: (k) => rackRod(k, 2.0, 1.45, BRASS), mounts: [{ p: [RACK[0] + 0.3, RACK[1] + 0.1, RACK[2] - 0.06] }] },
  ],
  fuel: [
    { model: jerrycan, mounts: [{ p: [1.35, DECK_Y, canZ[0]] }, { p: [-1.35, DECK_Y, canZ[0]], mirror: true }] },
    { model: jerrycan, mounts: [{ p: [1.35, DECK_Y, canZ[1]] }, { p: [-1.35, DECK_Y, canZ[1]], mirror: true }] },
    {
      model: (k) => {
        const g = new THREE.Group();
        g.add(canRack(k));
        g.add(jerrycan(k));
        return g;
      },
      onBoat: (k) => {
        const g = new THREE.Group();
        for (const s of [-1, 1]) {
          const r = canRack(k);
          r.position.set(s * 1.35, DECK_Y, (canZ[0] + canZ[3]) / 2);
          g.add(r);
          const c = jerrycan(k);
          c.position.set(s * 1.35, DECK_Y, canZ[2]);
          g.add(c);
        }
        return g;
      },
    },
    { model: jerrycan, mounts: [{ p: [1.35, DECK_Y, canZ[3]] }, { p: [-1.35, DECK_Y, canZ[3]], mirror: true }] },
    { model: bigTank, mounts: [{ p: [-0.52, HOUSE.top, 0.75], r: [0, Math.PI / 2, 0] }] },
  ],
  lights: [
    { model: lantern, lamp: 'light', mounts: [{ p: [0, sheerY(4.5) + 0.7, 4.5] }] },
    { model: lantern, lamp: 'glow', mounts: [{ p: [0.78, HOUSE.top, 0.2] }] },
    { model: lantern, lamp: 'glow', mounts: [{ p: [-0.78, HOUSE.top, 0.2] }] },
    { model: lantern, lamp: 'light', mounts: [{ p: [-0.8, ROOF + 0.02, COCKPIT.z0 + 0.12] }] },
    { model: searchlight, spot: true, mounts: [{ p: [0, ROOF + 0.02, COCKPIT.z1 - 0.3] }] },
  ],
  stab: [
    { model: gyroDome, mounts: [{ p: [0.45, DECK_Y, -4.5] }] },
    { model: (k) => fin(k, 0.75), until: 4, mounts: [{ p: [finX(finY), finY, finZ] }, { p: [-finX(finY), finY, finZ], mirror: true }] },
    {
      model: servoHousing,
      mounts: [
        { p: [hullHalfWidth(finZ) - 0.2, DECK_Y, finZ] },
        { p: [-(hullHalfWidth(finZ) - 0.2), DECK_Y, finZ], mirror: true },
      ],
    },
    { model: (k) => fin(k, 1.1), mounts: [{ p: [finX(finY), finY, finZ] }, { p: [-finX(finY), finY, finZ], mirror: true }] },
    { model: gyroDome, mounts: [{ p: [-0.45, DECK_Y, -4.5] }] },
  ],
};

/** зібрати річ рівня lvl (1..5) для човна: група в локальних координатах яхти */
export function buildPartOnBoat(id: UpgradeId, lvl: number, k: PartKit): THREE.Object3D {
  const spec = PART_SPECS[id][lvl - 1];
  if (spec.onBoat) return spec.onBoat(k);
  const g = new THREE.Group();
  for (const m of spec.mounts ?? [{ p: [0, 0, 0] as [number, number, number] }]) {
    const o = spec.model(k);
    o.position.set(...m.p);
    if (m.r) o.rotation.set(...m.r);
    if (m.mirror) o.scale.x *= -1;
    g.add(o);
  }
  return g;
}

/** річ для полиці / вітрини: одна штука (центрує вже PartPreview) */
export function buildPartModel(id: UpgradeId, lvl: number, k: PartKit): THREE.Object3D {
  return PART_SPECS[id][lvl - 1].model(k);
}

export function partViewYaw(id: UpgradeId, lvl: number): number {
  return PART_SPECS[id][lvl - 1].view ?? -0.6;
}

