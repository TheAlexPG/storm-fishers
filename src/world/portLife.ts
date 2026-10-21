import { insideCottage } from './cottageLayout';
import * as THREE from 'three';
import { addCloudUniforms } from './clouds';
import { mulberry32 } from '../core/math';
import { GROUND_Y, terrainHeight } from './portTerrain';
import { buildCharacter, HAIRS, SKINS, type CharacterLook } from './character';

// ─────────────────────────────────────────────────────────────
// Життя порту: трава (instanced, гойдається на вітрі), польові квіти,
// мешканці (стоять, сидять, гуляють), чайки на кнехтах і палях.
// ─────────────────────────────────────────────────────────────

const G = GROUND_Y;

/** бруковані доріжки (дзеркало buildQuay у port.ts) — трава на них не росте */
const PATHS: Array<[number, number, number, number]> = [
  // x0, x1, z0, z1
  [-60.6, -25, -46.4, -40.2],
  [25, 60.6, -46.4, -40.2],
  [-25, 25, -46.4, -41.6],
  [-3.3, -0.7, -59.9, -46.3],
  [-3.3, -0.7, -68.4, -64.2],
  [-59, 59, -72.6, -68.0],
  [-33.2, -30.8, -50, -46.4],
  [24.1, 27.1, -109, -72.6],
];

function onPath(x: number, z: number, pad: number): boolean {
  for (const [x0, x1, z0, z1] of PATHS) {
    if (x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad) return true;
  }
  return false;
}

export interface LifeHost {
  resolveSolids(x: number, z: number, r: number): [number, number];
  solids: Array<{ x: number; z: number; r?: number }>;
}

// ── трава ──

function tuftGeometry(rng: () => number): THREE.BufferGeometry {
  // кожна травинка — два трикутники (лице й зворот) з нормаллю вгору:
  // FrontSide без перевертання нормалі → без чорних «спинок»
  const pos: number[] = [];
  const col: number[] = [];
  const base = new THREE.Color(0x4f7a33);
  const tip = new THREE.Color(0xb5cf6e);
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rng() * 0.6;
    const r = 0.03 + rng() * 0.07;
    const h = 0.12 + rng() * 0.14;
    const w = 0.022;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    const lean = 0.04 + rng() * 0.07;
    const A = [cx - px, 0, cz - pz];
    const B = [cx + px, 0, cz + pz];
    const C = [cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean];
    pos.push(...A, ...B, ...C, ...B, ...A, ...C);
    for (let k = 0; k < 2; k++) col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nor = new Float32Array(pos.length);
  for (let i = 0; i < nor.length; i += 3) nor[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** вітер для трави/квітів: зсув верхівок за часом і позицією інстансу */
function windMaterial(mat: THREE.Material, uTime: { value: number }) {
  mat.onBeforeCompile = (sh) => {
    addCloudUniforms(sh.uniforms);
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
      #else
        vec2 ip = vec2(0.0);
      #endif
      float k = clamp(position.y * 3.0, 0.0, 1.0);
      float sw = sin(uTime * 1.6 + ip.x * 0.31 + ip.y * 0.23) * 0.6 + sin(uTime * 3.1 + ip.x * 0.9) * 0.25;
      transformed.x += sw * 0.07 * k;
      transformed.z += sw * 0.04 * k;`,
    );
  };
}

// ── люди ──

type Pose = 'stand' | 'sit' | 'walk' | 'fish';

interface Person {
  root: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  head: THREE.Object3D;
  torso: THREE.Object3D;
  body: THREE.Object3D;
  kneeL: THREE.Object3D;
  kneeR: THREE.Object3D;
  pose: Pose;
  phase: number;
  path?: { ax: number; az: number; bx: number; bz: number; speed: number; t: number; dir: 1 | -1 };
}

interface Gull {
  root: THREE.Group;
  head: THREE.Object3D;
  phase: number;
  look: number;
  target: number;
  timer: number;
}

export class PortLife {
  group = new THREE.Group();
  private uTime = { value: 0 };
  private people: Person[] = [];
  private gulls: Gull[] = [];
  private rng = mulberry32(777);
  private night = 0;

  constructor(parent: THREE.Object3D, private host: LifeHost) {
    parent.add(this.group);
    this.buildGrass();
    this.buildPeople();
    this.buildGulls();
  }

  // ───────────── трава й квіти ─────────────

  private canGrow(x: number, z: number): boolean {
    // хата рибалки — окрема модель із підлогою (world/homeCottage.ts)
    if (insideCottage(x, z, 0.45)) return false;
    const onPlateau = Math.abs(x) <= 59.4 && z >= -129.4 && z <= -42.2;
    if (onPlateau) {
      if (onPath(x, z, 0.25)) return false;
      const [rx, rz] = this.host.resolveSolids(x, z, 0.3);
      return rx === x && rz === z;
    }
    // схили довкола: не на пляжі, не на скелях
    const h = terrainHeight(x, z);
    if (h < 2.6 || h > 40) return false;
    const s = Math.abs(terrainHeight(x + 1, z) - terrainHeight(x - 1, z)) + Math.abs(terrainHeight(x, z + 1) - terrainHeight(x, z - 1));
    return s < 1.4;
  }

  private buildGrass() {
    const rng = this.rng;
    const geo = tuftGeometry(rng);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    windMaterial(mat, this.uTime);
    const N = 26000;
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const tint = new THREE.Color();
    let n = 0;
    let tries = 0;
    while (n < N && tries < N * 4) {
      tries++;
      // 70 % — на плато, решта — на найближчих схилах
      const onPlateau = rng() < 0.7;
      const x = onPlateau ? -59 + rng() * 118 : -120 + rng() * 240;
      const z = onPlateau ? -129 + rng() * 87 : -175 + rng() * 135;
      if (!this.canGrow(x, z)) continue;
      // купки: густіше там, де шум високий
      if (Math.sin(x * 0.37 + Math.cos(z * 0.29) * 2) + Math.sin(z * 0.41) * 0.6 < -0.7 && rng() < 0.7) continue;
      const y = Math.abs(x) <= 60 && z >= -130 && z <= -40 ? G : terrainHeight(x, z);
      p.set(x, y - 0.01, z);
      e.set(0, rng() * Math.PI * 2, 0);
      q.setFromEuler(e);
      const s = 0.7 + rng() * 0.8;
      sc.set(s, s * (0.8 + rng() * 0.5), s);
      m.compose(p, q, sc);
      mesh.setMatrixAt(n, m);
      tint.setHSL(0.2 + rng() * 0.07, 0.3 + rng() * 0.2, 0.75 + rng() * 0.2);
      mesh.setColorAt(n, tint);
      n++;
    }
    mesh.count = n;
    this.addTiles(mesh, 300, 450);

    // польові квіти
    const fGeo = new THREE.IcosahedronGeometry(0.045, 0);
    fGeo.translate(0, 0.3, 0);
    const stem = new THREE.CylinderGeometry(0.006, 0.006, 0.3, 3).translate(0, 0.15, 0);
    const flowerGeo = mergeSimple([fGeo, stem]);
    const fMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    windMaterial(fMat, this.uTime);
    const F = 1400;
    const flowers = new THREE.InstancedMesh(flowerGeo, fMat, F);
    const palette = [0xf4e04d, 0xffffff, 0xd94f6b, 0x9a7cd9, 0xf29b38, 0x6fa0e8];
    let k = 0;
    tries = 0;
    while (k < F && tries < F * 8) {
      tries++;
      // квіти — кущиками
      const cx = -58 + rng() * 116;
      const cz = -128 + rng() * 85;
      const color = palette[Math.floor(rng() * palette.length)];
      for (let j = 0; j < 6 && k < F; j++) {
        const x = cx + (rng() - 0.5) * 1.6;
        const z = cz + (rng() - 0.5) * 1.6;
        if (!this.canGrow(x, z)) continue;
        p.set(x, G, z);
        e.set(0, rng() * 6.28, 0);
        q.setFromEuler(e);
        const s = 0.7 + rng() * 0.6;
        sc.set(s, s, s);
        m.compose(p, q, sc);
        flowers.setMatrixAt(k, m);
        flowers.setColorAt(k, tint.set(color));
        k++;
      }
    }
    flowers.count = k;
    this.addTiles(flowers, 220, 330);
  }

  /**
   * Розкласти інстанси по клітинках 40×40 м: кожна клітинка — окремий InstancedMesh
   * (та сама геометрія й матеріал, ті самі матриці й кольори), тож за кадром її не
   * малюємо (раніше одна межа на весь порт — трава малювалась завжди, навіть позаду).
   * Далеко клітинка плавно рідшає (near…far м): пучок там менший за пів пікселя й у тумані.
   * Порядок інстансів випадковий, тож перші k — рівномірна вибірка.
   */
  private addTiles(src: THREE.InstancedMesh, near: number, far: number) {
    const CELL = 40;
    const buckets = new Map<string, number[]>();
    const m = new THREE.Matrix4();
    for (let i = 0; i < src.count; i++) {
      src.getMatrixAt(i, m);
      const key = `${Math.floor(m.elements[12] / CELL)},${Math.floor(m.elements[14] / CELL)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(i);
    }
    const c = new THREE.Color();
    for (const ids of buckets.values()) {
      const t = new THREE.InstancedMesh(src.geometry, src.material, ids.length);
      t.receiveShadow = src.receiveShadow;
      t.castShadow = src.castShadow;
      ids.forEach((id, k) => {
        src.getMatrixAt(id, m);
        t.setMatrixAt(k, m);
        if (src.instanceColor) {
          src.getColorAt(id, c);
          t.setColorAt(k, c);
        }
      });
      t.instanceMatrix.needsUpdate = true;
      if (t.instanceColor) t.instanceColor.needsUpdate = true;
      t.computeBoundingSphere();
      t.computeBoundingBox();
      this.group.add(t);
      const s = t.boundingSphere!;
      this.tiles.push({ mesh: t, full: ids.length, x: s.center.x, z: s.center.z, r: s.radius, near, far });
    }
    src.dispose();
  }

  private tiles: Array<{ mesh: THREE.InstancedMesh; full: number; x: number; z: number; r: number; near: number; far: number }> = [];

  /** далекі клітинки трави й квітів рідшають, за far — не малюються */
  private thin(cam: THREE.Vector3) {
    for (const t of this.tiles) {
      const d = Math.max(0, Math.hypot(cam.x - t.x, cam.z - t.z) - t.r);
      const f = d <= t.near ? 1 : d >= t.far ? 0 : 1 - (d - t.near) / (t.far - t.near);
      const n = Math.round(t.full * f);
      t.mesh.count = n;
      t.mesh.visible = n > 0;
    }
  }

  // ───────────── мешканці ─────────────

  private person(opts: CharacterLook & { scale?: number }): Person {
    const rig = buildCharacter(opts);
    rig.body.scale.setScalar(opts.scale ?? 1);
    this.group.add(rig.root);
    const { root, legL, legR, kneeL, kneeR, armL, armR, head, torso, body } = rig;
    return { root, body, legL, legR, kneeL, kneeR, armL, armR, head, torso, pose: 'stand', phase: this.rng() * 10 };
  }

  private place(p: Person, x: number, y: number, z: number, ry: number, pose: Pose, solid = true) {
    p.root.position.set(x, y, z);
    p.root.rotation.y = ry;
    p.pose = pose;
    if (pose === 'sit') {
      // стегна вперед, гомілки звисають до землі
      p.legL.rotation.set(-Math.PI / 2 + 0.2, -0.1, 0);
      p.legR.rotation.set(-Math.PI / 2 + 0.2, 0.1, 0);
      p.kneeL.rotation.x = p.kneeR.rotation.x = Math.PI / 2 - 0.2;
      p.root.position.y = y - 0.33;
      p.armL.rotation.x = p.armR.rotation.x = -0.6;
    }
    if (pose === 'fish') {
      p.armL.rotation.x = p.armR.rotation.x = -0.9;
      // вудка в руках
      // вудка з кисті вперед-угору над водою (~35°), волосінь до поплавка
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.018, 2.6, 5), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4 }));
      rod.rotation.x = 1.86;
      rod.position.set(0, -0.58 - 0.288 * 1.1, 0.956 * 1.1);
      rod.castShadow = true;
      p.armR.add(rod);
      const tip = new THREE.Object3D();
      tip.position.y = 1.3;
      rod.add(tip);
      p.root.updateMatrixWorld(true);
      const tp = tip.getWorldPosition(new THREE.Vector3());
      const wl = 0.05;
      const lg = new THREE.BufferGeometry().setFromPoints([tp, new THREE.Vector3(tp.x, wl + 0.08, tp.z)]);
      this.group.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xdde8ee, transparent: true, opacity: 0.6 })));
      const bob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe0522f, roughness: 0.4 }));
      bob.position.set(tp.x, wl, tp.z);
      this.group.add(bob);
    }
    if (solid) this.host.solids.push({ x, z, r: 0.35 });
    this.people.push(p);
  }

  private buildPeople() {
    const Y = G;
    // продавчиня біля магазину: пучок, окуляри, фартух поверх светра
    this.place(this.person({ jacket: 0x2f5c8a, jacketKind: 'knit', pants: 0x3a3a44, hat: 'none', hair: 'bun', hairColor: HAIRS[2], skin: SKINS[0], glasses: true, apron: 0xf2efe6, brow: 0.2, boots: 0x6b4a33 }), -5.6, Y, -47.4, 0.4, 'stand');
    // заправник: кепка, вуса, комбінезон, рукавиці
    this.place(this.person({ jacket: 0xc23b2f, jacketKind: 'knit', pants: 0x2b2f38, bib: 0x2c4a6e, hat: 'cap', hatColor: 0xc23b2f, beard: 'mustache', hairColor: HAIRS[0], skin: SKINS[3], gloves: 0xe8dcc0, belly: true, width: 1.1 }), 11.4, Y, -42.3, -0.6, 'stand');
    // рибалка на краю причалу (спиною до порту): зюйдвестка, борода, рятувальний жилет
    this.place(this.person({ jacket: 0xf2c12e, pants: 0x2f3b30, bib: 0x3d5a40, hat: 'sou', hatColor: 0xf2c12e, beard: 'full', hairColor: HAIRS[3], skin: SKINS[1], boots: 0x2f4a33, vest: true }), 20.5, 1.1, -18.9, 0, 'fish');
    // дід на лавці біля хати: кашкет, сива борода, окуляри, шарф, бушлат
    this.place(this.person({ jacket: 0x5b4636, jacketKind: 'coat', pants: 0x3a3632, hat: 'cap', hatColor: 0x3d3d3d, skin: 0xd9a988, hair: 'bald', hairColor: HAIRS[6], beard: 'full', glasses: true, scarf: 0xb8362c, brow: 0.25, belly: true }), -4.3, Y, -58.98, 0, 'sit', false);
    // торговці на рибному ринку
    this.place(this.person({ jacket: 0x456b4a, jacketKind: 'knit', pants: 0x2b2b2b, bib: 0x3b3f44, hat: 'beanie', hatColor: 0x7a2f2f, hatAccent: 0xf2ead8, apron: 0xd7d3c8, beard: 'goatee', hairColor: HAIRS[0], skin: SKINS[4], gloves: 0x3f86c9, boots: 0xf2c12e, width: 1.12 }), 32.5, Y, -47.6, 0, 'stand');
    this.place(this.person({ jacket: 0x8a5a3a, pants: 0x333a44, hat: 'beanie', hatColor: 0x2a3f66, hatAccent: 0xe0b44a, hair: 'long', hairColor: HAIRS[7], skin: SKINS[1], scarf: 0xe0b44a, brow: 0.15, stripes: false }), 36.3, Y, -46.2, 2.6, 'stand');
    // перехожі
    const walker = (ax: number, az: number, bx: number, bz: number, opts: Parameters<PortLife['person']>[0]) => {
      const p = this.person(opts);
      p.pose = 'walk';
      p.path = { ax, az, bx, bz, speed: 1.1 + this.rng() * 0.3, t: this.rng(), dir: 1 };
      this.people.push(p);
    };
    walker(-52, -43.6, -28, -43.6, { jacket: 0x6d7f8c, jacketKind: 'coat', pants: 0x2d2d33, hat: 'beanie', hatColor: 0x2b4b6f, hatAccent: 0xf2ead8, beard: 'full', hairColor: HAIRS[5], skin: SKINS[2], brow: -0.1 });
    walker(-40, -70.3, 35, -70.3, { jacket: 0xa8423a, jacketKind: 'knit', pants: 0x3c3f46, hat: 'bucket', hatColor: 0xd9c9a0, hatAccent: 0x6b4a33, hair: 'long', hairColor: HAIRS[4], skin: SKINS[0], backpack: 0x4f6b8a, glasses: true });
    walker(30, -43.4, 54, -43.4, { jacket: 0x3d5a40, pants: 0x2a2a2a, hat: 'sou', hatColor: 0xf2c12e, beard: 'mustache', hairColor: HAIRS[1], skin: SKINS[5], boots: 0xf2c12e });
    // дитина в жовтому дощовику з червоними чобітьми
    walker(25.6, -105, 25.6, -74, { jacket: 0xf2c12e, pants: 0x2b4b6f, hat: 'beanie', hatColor: 0xd23c6e, hatAccent: 0xffffff, hair: 'short', hairColor: HAIRS[3], skin: SKINS[1], boots: 0xb8362c, brow: 0.25, width: 0.95, scale: 0.68 });
  }

  // ───────────── чайки ─────────────

  private buildGulls() {
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.8 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x8c949c, roughness: 0.8 });
    const beak = new THREE.MeshStandardMaterial({ color: 0xf0b62e, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
    const mk = (x: number, y: number, z: number, ry: number) => {
      const root = new THREE.Group();
      root.position.set(x, y, z);
      root.rotation.y = ry;
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), white);
      body.scale.set(0.8, 0.85, 1.5);
      body.position.y = 0.14;
      body.castShadow = true;
      root.add(body);
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), grey);
        w.scale.set(0.3, 0.6, 1.6);
        w.position.set(s * 0.075, 0.17, -0.03);
        root.add(w);
      }
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), dark);
      tail.rotation.x = -Math.PI / 2 - 0.3;
      tail.position.set(0, 0.16, -0.2);
      root.add(tail);
      const head = new THREE.Group();
      head.position.set(0, 0.26, 0.11);
      root.add(head);
      head.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), white));
      const b = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.08, 6), beak);
      b.rotation.x = Math.PI / 2;
      b.position.set(0, -0.01, 0.08);
      head.add(b);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 5, 4), dark);
        eye.position.set(s * 0.04, 0.015, 0.035);
        head.add(eye);
      }
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 3), beak);
        leg.position.set(s * 0.03, 0.04, 0);
        root.add(leg);
      }
      this.group.add(root);
      this.gulls.push({ root, head, phase: this.rng() * 10, look: 0, target: 0, timer: this.rng() * 3 });
    };
    // на кнехтах причалу (верх 1.1 + 0.72) і на палях пірсу
    mk(-16, 1.82, -19.2, 0.4);
    mk(0, 1.82, -19.2, -2.2);
    mk(16, 1.82, -19.2, 1.2);
    mk(-31.6, 1.56, -25, 2.8);
    mk(-34.4, 1.56, -32, -0.5);
  }

  // ───────────── кадр ─────────────

  setNight(night: number) {
    this.night = night;
  }

  update(dt: number, t: number, cam?: THREE.Vector3) {
    this.uTime.value = t;
    if (cam) this.thin(cam);
    for (const p of this.people) {
      const br = Math.sin(t * 1.4 + p.phase);
      p.torso.scale.y = 1 + br * 0.008;
      if (p.pose === 'walk' && p.path) {
        const P = p.path;
        const len = Math.hypot(P.bx - P.ax, P.bz - P.az);
        P.t += (P.dir * P.speed * dt) / len;
        if (P.t > 1) { P.t = 1; P.dir = -1; }
        if (P.t < 0) { P.t = 0; P.dir = 1; }
        const x = P.ax + (P.bx - P.ax) * P.t;
        const z = P.az + (P.bz - P.az) * P.t;
        p.root.position.set(x, G, z);
        const dx = (P.bx - P.ax) * P.dir;
        const dz = (P.bz - P.az) * P.dir;
        const want = Math.atan2(dx, dz);
        let d = want - p.root.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        p.root.rotation.y += d * Math.min(1, dt * 4);
        const step = t * P.speed * 5.2 + p.phase;
        const sw = Math.sin(step) * 0.55;
        p.legL.rotation.x = sw;
        p.legR.rotation.x = -sw;
        p.kneeL.rotation.x = 0.05 + Math.max(0, sw) * 0.75;
        p.kneeR.rotation.x = 0.05 + Math.max(0, -sw) * 0.75;
        p.armL.rotation.set(-sw * 0.8, 0, -0.1);
        p.armR.rotation.set(sw * 0.8, 0, 0.1);
        p.torso.rotation.set(0.06, sw * 0.18, 0);
        p.head.rotation.y = -sw * 0.12;
        p.root.position.y = G + Math.abs(Math.cos(step)) * 0.04;
        // уночі гуляють лише двоє
        p.root.visible = this.night < 0.6 || p.phase > 5;
      } else if (p.pose === 'stand') {
        // озирається, переносить вагу з ноги на ногу, зрідка жестикулює
        const shift = Math.sin(t * 0.4 + p.phase * 1.7);
        p.body.position.x = shift * 0.018;
        p.body.rotation.z = shift * 0.025;
        p.legL.rotation.z = p.legR.rotation.z = -shift * 0.025;
        p.kneeL.rotation.x = 0.04 + Math.max(0, shift) * 0.08;
        p.kneeR.rotation.x = 0.04 + Math.max(0, -shift) * 0.08;
        p.head.rotation.y = Math.sin(t * 0.35 + p.phase) * 0.5;
        p.head.rotation.z = -shift * 0.04;
        const gest = Math.max(0, Math.sin(t * 0.21 + p.phase * 3) - 0.75) * 4;
        p.armL.rotation.set(-0.08, 0, -0.12 + br * 0.03);
        p.armR.rotation.set(-0.08 - gest * 0.9, 0, 0.12 - br * 0.03 + gest * 0.25);
      } else if (p.pose === 'fish') {
        p.armR.rotation.x = -0.9 + Math.sin(t * 0.8 + p.phase) * 0.05;
        p.head.rotation.x = 0.15;
      } else {
        p.head.rotation.y = Math.sin(t * 0.25 + p.phase) * 0.35;
      }
    }
    for (const gl of this.gulls) {
      gl.timer -= dt;
      if (gl.timer <= 0) {
        gl.timer = 0.8 + this.rng() * 3;
        gl.target = (this.rng() - 0.5) * 2.4;
      }
      gl.look += (gl.target - gl.look) * Math.min(1, dt * 10);
      gl.head.rotation.y = gl.look;
      gl.head.position.y = 0.26 + Math.max(0, Math.sin(t * 2 + gl.phase)) * 0.01;
    }
  }
}

/** злиття простих геометрій (позиції + нормалі, без UV) */
function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.computeVertexNormals();
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
