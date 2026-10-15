import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { GROUND_Y, terrainHeight } from './portTerrain';

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
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);

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
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    flowers.computeBoundingSphere();
    this.group.add(flowers);
  }

  // ───────────── мешканці ─────────────

  private person(opts: { jacket: number; pants: number; hat: 'sou' | 'cap' | 'beanie' | 'none'; hatColor?: number; skin?: number; apron?: number; scale?: number }): Person {
    const std = (c: number, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.scale.setScalar(opts.scale ?? 1);
    root.add(body);
    const skin = std(opts.skin ?? 0xe0b48f, 0.7);
    const jacket = std(opts.jacket);
    const pants = std(opts.pants);
    const boots = std(0x2a2522, 0.6);
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const mm = new THREE.Mesh(geo, mat);
      mm.position.set(x, y, z);
      mm.castShadow = true;
      parent.add(mm);
      return mm;
    };
    // ноги (півот у стегні)
    const mkLeg = (sx: number) => {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.11, 0.9, 0);
      body.add(leg);
      add(leg, new THREE.CapsuleGeometry(0.075, 0.62, 3, 8), pants, 0, -0.42, 0);
      add(leg, new THREE.BoxGeometry(0.13, 0.1, 0.26), boots, 0, -0.85, 0.04);
      return leg;
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);
    // тулуб
    const torso = new THREE.Group();
    torso.position.y = 0.9;
    body.add(torso);
    add(torso, new THREE.CapsuleGeometry(0.19, 0.4, 4, 10), jacket, 0, 0.32, 0).scale.set(1, 1, 0.75);
    if (opts.apron != null) add(torso, new THREE.BoxGeometry(0.3, 0.55, 0.02), std(opts.apron), 0, 0.15, 0.15);
    // руки (півот у плечі)
    const mkArm = (sx: number) => {
      const arm = new THREE.Group();
      arm.position.set(sx * 0.25, 0.66, 0);
      torso.add(arm);
      add(arm, new THREE.CapsuleGeometry(0.06, 0.5, 3, 8), jacket, 0, -0.3, 0);
      add(arm, new THREE.SphereGeometry(0.06, 8, 6), skin, 0, -0.62, 0);
      return arm;
    };
    const armL = mkArm(-1);
    const armR = mkArm(1);
    // голова
    const head = new THREE.Group();
    head.position.y = 0.86;
    torso.add(head);
    add(head, new THREE.SphereGeometry(0.13, 12, 10), skin, 0, 0.1, 0);
    add(head, new THREE.SphereGeometry(0.018, 6, 4), std(0x1a1a1a, 0.4), -0.045, 0.13, 0.12);
    add(head, new THREE.SphereGeometry(0.018, 6, 4), std(0x1a1a1a, 0.4), 0.045, 0.13, 0.12);
    const hc = opts.hatColor ?? 0x333333;
    if (opts.hat === 'sou') {
      // рибальська зюйдвестка
      add(head, new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(hc, 0.5), 0, 0.14, 0);
      add(head, new THREE.CylinderGeometry(0.24, 0.26, 0.02, 14), std(hc, 0.5), 0, 0.14, -0.03);
    } else if (opts.hat === 'cap') {
      add(head, new THREE.CylinderGeometry(0.14, 0.14, 0.08, 12), std(hc), 0, 0.22, 0);
      add(head, new THREE.BoxGeometry(0.2, 0.02, 0.12), std(hc), 0, 0.19, 0.12);
    } else if (opts.hat === 'beanie') {
      add(head, new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.9), std(hc, 0.95), 0, 0.13, 0);
    } else {
      add(head, new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), std(0x4a3524, 0.9), 0, 0.12, -0.01);
    }
    this.group.add(root);
    return { root, legL, legR, armL, armR, head, torso, pose: 'stand', phase: this.rng() * 10 };
  }

  private place(p: Person, x: number, y: number, z: number, ry: number, pose: Pose, solid = true) {
    p.root.position.set(x, y, z);
    p.root.rotation.y = ry;
    p.pose = pose;
    if (pose === 'sit') {
      p.legL.rotation.x = p.legR.rotation.x = -Math.PI / 2;
      p.root.position.y = y - 0.45;
      p.armL.rotation.x = p.armR.rotation.x = -0.6;
    }
    if (pose === 'fish') {
      p.armL.rotation.x = p.armR.rotation.x = -0.9;
      // вудка в руках
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.015, 2.6, 5), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4 }));
      rod.position.set(0, -0.58, 1.1);
      rod.rotation.x = Math.PI / 2 - 0.5;
      p.armR.add(rod);
    }
    if (solid) this.host.solids.push({ x, z, r: 0.35 });
    this.people.push(p);
  }

  private buildPeople() {
    const Y = G;
    // продавчиня біля магазину
    this.place(this.person({ jacket: 0x2f5c8a, pants: 0x3a3a44, hat: 'none', apron: 0xf2efe6 }), -5.6, Y, -47.4, 0.4, 'stand');
    // заправник
    this.place(this.person({ jacket: 0xc23b2f, pants: 0x2b2f38, hat: 'cap', hatColor: 0xc23b2f }), 11.4, Y, -42.3, -0.6, 'stand');
    // рибалка на краю причалу (спиною до порту)
    this.place(this.person({ jacket: 0xf2c12e, pants: 0x2f3b30, hat: 'sou', hatColor: 0xf2c12e }), 20.5, 1.1, -18.9, 0, 'fish');
    // дід на лавці біля хати
    this.place(this.person({ jacket: 0x5b4636, pants: 0x3a3632, hat: 'cap', hatColor: 0x3d3d3d, skin: 0xd9a988 }), -4.3, Y, -58.85, Math.PI, 'sit', false);
    // торговці на рибному ринку
    this.place(this.person({ jacket: 0x456b4a, pants: 0x2b2b2b, hat: 'beanie', hatColor: 0x7a2f2f, apron: 0xd7d3c8 }), 32.5, Y, -47.6, 0, 'stand');
    this.place(this.person({ jacket: 0x8a5a3a, pants: 0x333a44, hat: 'beanie', hatColor: 0x2a3f66 }), 36.3, Y, -46.2, 2.6, 'stand');
    // перехожі
    const walker = (ax: number, az: number, bx: number, bz: number, opts: Parameters<PortLife['person']>[0]) => {
      const p = this.person(opts);
      p.pose = 'walk';
      p.path = { ax, az, bx, bz, speed: 1.1 + this.rng() * 0.3, t: this.rng(), dir: 1 };
      this.people.push(p);
    };
    walker(-52, -43.6, -28, -43.6, { jacket: 0x6d7f8c, pants: 0x2d2d33, hat: 'beanie', hatColor: 0x2b4b6f });
    walker(-40, -70.3, 35, -70.3, { jacket: 0xa8423a, pants: 0x3c3f46, hat: 'none' });
    walker(30, -43.4, 54, -43.4, { jacket: 0x3d5a40, pants: 0x2a2a2a, hat: 'sou', hatColor: 0xf2c12e });
    walker(25.6, -105, 25.6, -74, { jacket: 0x9a8a72, pants: 0x3a3632, hat: 'none', scale: 0.72 });
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

  update(dt: number, t: number) {
    this.uTime.value = t;
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
        p.armL.rotation.x = -sw * 0.7;
        p.armR.rotation.x = sw * 0.7;
        p.root.position.y = G + Math.abs(Math.cos(step)) * 0.04;
        // уночі гуляють лише двоє
        p.root.visible = this.night < 0.6 || p.phase > 5;
      } else if (p.pose === 'stand') {
        p.head.rotation.y = Math.sin(t * 0.35 + p.phase) * 0.5;
        p.armL.rotation.z = -0.08 + br * 0.03;
        p.armR.rotation.z = 0.08 - br * 0.03;
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
