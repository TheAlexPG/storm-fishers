import * as THREE from 'three';
import { Ocean } from '../core/ocean';
import { clamp, rand } from '../core/math';
import { eff } from '../game/upgrades';
import type { GameState } from '../game/state';
import type { Weather } from '../core/weather';
import type { ParticlePool } from './particles';
import type { AudioEngine } from '../core/audio';

// ─────────────────────────────────────────────────────────────
// Човен «Шторм»: mesh + фізика (буївність 5×3, двигун, рильє,
// вітер, затоплення палуби, міцність). +Z — нос, origin — вода.
// ─────────────────────────────────────────────────────────────

export const BOAT = {
  length: 9.4,
  beam: 3.0,
  deckY: 1.05,
  hullBottom: -1.05,
};

// точка швартування в порту: у воді, біля кромки причалу (причал закінчується з=-18)
export const MOOR = { x: 0, z: -15.9 };
// курс при шварті: човен паралельно причалу, нос на +X
export const MOOR_HEADING = Math.PI / 2;

// станції (локальні координати палуби, y = deckY)
export const STATION_POS: Record<string, { x: number; z: number }> = {
  wheel: { x: 0, z: 3.15 },
  rod: { x: 0, z: -4.25 },
  engine: { x: 1.12, z: 1.7 },
  pump: { x: -1.12, z: 1.7 },
  // каюта (локальні межі: x -0.65..0.85, z -2.8..-0.8)
  kitchen: { x: -0.375, z: -2.35 },
  radio: { x: 0.575, z: -1.15 },
  bed: { x: 0.525, z: -2.1 },
};

export interface RockObstacle {
  x: number;
  z: number;
  r: number;
}

export class Boat {
  group = new THREE.Group();
  // фізика
  pos = new THREE.Vector3(MOOR.x, 0, MOOR.z);
  vel = new THREE.Vector3();
  heading = MOOR_HEADING; // 0 → нос на +Z; старт — швартувальний курс
  pitch = 0;
  roll = 0;
  angVel = new THREE.Vector3();
  throttle = 0;
  rudder = 0;
  engineOn = true;
  engineLoad = 0;
  deckWater = 0;
  sinking = false;
  sinkTimer = 0;

  // події для світу
  onHullHit: ((power: number, pos: THREE.Vector3) => void) | null = null;
  onEngineStall: (() => void) | null = null;
  onSunk: (() => void) | null = null;

  private mass = 3500;
  private inertiaPitch = 3100;
  private inertiaRoll = 2900;
  private inertiaYaw = 27500;
  private readonly buoyK = 5300;
  private readonly buoyDamp = 1500;
  private readonly wavePushK = 2400;

  private gridLocal: THREE.Vector3[] = [];
  private _v = new THREE.Vector3();
  private _fwd = new THREE.Vector3();
  private _n = new THREE.Vector3();
  private _f = new THREE.Vector3();
  private _r = new THREE.Vector3();
  private _t = new THREE.Vector3();

  // візуали апгрейдів
  private upg: Record<string, THREE.Object3D[]> = {};
  private hullMats: THREE.MeshStandardMaterial[] = [];
  private interiorLight!: THREE.PointLight;
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private lights: Array<{ light: THREE.PointLight; lamp: THREE.Mesh }> = [];
  private spotlight: THREE.SpotLight | null = null;
  private exhaustTip = new THREE.Vector3(1.2, 0.9, 0.9);
  private rodTip = new THREE.Vector3(0, 2.2, -4.6);
  private bowPoint = new THREE.Vector3(0, 0.6, 4.4);

  // маркери станцій
  stationMarkers: THREE.Group = new THREE.Group();

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 3; j++) {
        const x = (j - 1) * 0.95;
        const z = -3.4 + (i / 4) * 6.8;
        this.gridLocal.push(new THREE.Vector3(x, -0.4, z));
      }
    }
    this.buildMesh();
    this.scene.add(this.group);
    this.syncTransform();
  }

  // ── Mesh ──

  private mat(color: number, rough = 0.85, metal = 0.05): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true });
  }

  private addBox(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: number, rough = 0.85, metal = 0.05): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(color, rough, metal));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  private buildMesh() {
    const g = this.group;
    const RED = 0x8a3033;
    const RED_DARK = 0x6d2629;
    const WOOD = 0x9a7a52;
    const WHITE = 0xe8e4d8;

    // корпус: модифікований box (нос клин, дно округле)
    const hullGeo = new THREE.BoxGeometry(BOAT.beam, 1.15, BOAT.length, 2, 1, 14);
    const hp = hullGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i);
      const y = hp.getY(i);
      const z = hp.getZ(i);
      const t = z / (BOAT.length / 2); // -1..1
      let sx = 1;
      if (t > 0.25) sx *= 1 - Math.pow((t - 0.25) / 0.75, 1.7) * 0.8;
      if (t < -0.55) sx *= 1 - Math.pow((-t - 0.55) / 0.45, 1.5) * 0.3;
      if (y < 0) sx *= 1 - Math.pow(-y / 0.575, 2) * 0.4;
      hp.setX(i, x * sx);
      // легкий киль: дно внизу по центру опускається
      if (y < -0.2 && Math.abs(x) < 0.5) hp.setY(i, y - 0.12 * (1 - Math.abs(x) / 0.5));
    }
    hullGeo.computeVertexNormals();
    const hullMat = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.7, metalness: 0.1, flatShading: true });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 0.15;
    hull.castShadow = true;
    hull.receiveShadow = true;
    g.add(hull);
    this.hullMats.push(hullMat);

    // палуба
    const deck = this.addBox(g, BOAT.beam * 0.94, 0.14, BOAT.length * 0.96, 0, BOAT.deckY - 0.02, 0, WOOD, 0.9);
    // штрихи дощок на палубі (тонкі смуги)
    for (let i = 0; i < 12; i++) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(BOAT.beam * 0.9, 0.012, 0.03),
        new THREE.MeshStandardMaterial({ color: 0x7a5f3f, roughness: 0.95 }),
      );
      plank.position.set(0, BOAT.deckY + 0.05, -4.1 + i * 0.72);
      g.add(plank);
    }

    // борта (релинг)
    for (const s of [-1, 1]) {
      const rail = this.addBox(g, 0.09, 0.22, BOAT.length * 0.92, s * (BOAT.beam / 2 - 0.02), BOAT.deckY + 0.16, 0, RED_DARK, 0.8);
      rail.rotation.x = 0;
    }

    // ── каюта: справжня кімната (стіни, дах, двері з корми, інтер'єр) ──
    // межі: x -0.9..1.1, z -3.05..-0.55; дверний отвір у кормі x -0.2..0.7
    const cabin = new THREE.Group();
    cabin.position.set(0, BOAT.deckY, 0);
    g.add(cabin);
    const CW = 0.25; // товщина стін
    const CH = 2.0;  // висота кімнати
    this.addBox(cabin, 2.0, CH, CW, 0.1, CH / 2, -0.675, WHITE, 0.85);   // носова стіна
    this.addBox(cabin, CW, CH, 2.5, -0.775, CH / 2, -1.8, WHITE, 0.85);  // лівий борт
    this.addBox(cabin, CW, CH, 2.5, 0.975, CH / 2, -1.8, WHITE, 0.85);   // правий борт
    this.addBox(cabin, 0.7, CH, CW, -0.55, CH / 2, -2.925, WHITE, 0.85); // корма (ліворуч дверей)
    this.addBox(cabin, 0.4, CH, CW, 0.9, CH / 2, -2.925, WHITE, 0.85);   // корма (праворуч дверей)
    this.addBox(cabin, 0.9, 0.15, CW, 0.25, CH - 0.075, -2.925, WHITE, 0.85); // перемичка над дверима
    for (const dx of [-0.2, 0.7]) this.addBox(cabin, 0.07, CH, 0.07, dx, CH / 2, -2.925, 0x6d5438, 0.9); // дверна рама
    this.addBox(cabin, 2.3, 0.12, 2.8, 0.1, CH + 0.06, -1.8, RED_DARK, 0.8); // дах з навісом
    // ілюмінатори (зсередини; вночі світяться теплом інтер'єру)
    const glowMats: THREE.MeshStandardMaterial[] = [];
    for (const x of [-0.64, 0.84]) {
      const m = new THREE.MeshStandardMaterial({ color: 0x223244, emissive: 0xffd9a0, emissiveIntensity: 0.15, roughness: 0.25, metalness: 0.4 });
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.6), m);
      w.position.set(x, 1.15, -1.35);
      cabin.add(w);
      glowMats.push(m);
    }
    // інтер'єр: койка (правий борт, корма)
    this.addBox(cabin, 0.6, 0.28, 1.3, 0.525, 0.14, -2.1, 0x6d5438, 0.9);
    this.addBox(cabin, 0.56, 0.09, 1.24, 0.525, 0.325, -2.1, WHITE, 0.9);
    this.addBox(cabin, 0.16, 0.1, 0.32, 0.525, 0.42, -1.62, 0xcfd8dc, 0.95);
    // кухня (лівий борт): шафа, стільниця, казанок
    this.addBox(cabin, 0.5, 0.85, 0.75, -0.375, 0.425, -2.35, 0x8a6d48, 0.9);
    this.addBox(cabin, 0.52, 0.05, 0.77, -0.375, 0.875, -2.35, 0x555a60, 0.5, 0.4);
    {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.13, 10), this.mat(0x3a3d42, 0.4, 0.6));
      pot.position.set(-0.375, 0.98, -2.3);
      pot.castShadow = true;
      cabin.add(pot);
    }
    // приладка (правий борт, біля носа): консоль з екраном
    this.addBox(cabin, 0.45, 1.05, 0.65, 0.575, 0.525, -1.095, 0x3d4046, 0.6, 0.3);
    {
      const scr = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0x0a1a14, emissive: 0x2fae7a, emissiveIntensity: 0.7, roughness: 0.4 }));
      scr.position.set(0.345, 0.66, -1.095);
      cabin.add(scr);
    }
    // плафон на стелі
    {
      const lm = new THREE.MeshStandardMaterial({ color: 0xfff4e0, emissive: 0xffd9a0, emissiveIntensity: 0.5, roughness: 0.5 });
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.26), lm);
      lamp.position.set(0.1, 1.92, -1.8);
      cabin.add(lamp);
      glowMats.push(lm);
    }
    // тепле світло всередині (вмикається вночі/у шторм)
    this.interiorLight = new THREE.PointLight(0xffd9a0, 0.5, 6, 1.7);
    this.interiorLight.position.set(0.1, 1.75, -1.8);
    cabin.add(this.interiorLight);
    this.glowMats = glowMats;

    // штурвал
    const wheel = new THREE.Group();
    wheel.position.set(0, BOAT.deckY + 0.5, 3.15);
    g.add(wheel);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.55, 8), this.mat(0x444444, 0.5, 0.6));
    post.position.y = -0.1;
    wheel.add(post);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 8, 18), this.mat(0x2a2a2a, 0.6, 0.3));
    rim.rotation.x = Math.PI / 2.4;
    rim.position.y = 0.28;
    wheel.add(rim);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.44, 0.03), this.mat(0x2a2a2a, 0.6, 0.3));
      spoke.position.y = 0.28;
      spoke.rotation.x = (i / 3) * Math.PI;
      spoke.rotation.x += Math.PI / 2.4 - Math.PI / 2;
      spoke.position.z = 0.05;
      wheel.add(spoke);
    }
    // пульт газу
    this.addBox(g, 0.5, 0.22, 0.3, 0.45, BOAT.deckY + 0.12, 3.15, 0x3a3a3a, 0.7);

    // вудка (основа)
    const rod = new THREE.Group();
    rod.position.set(0, BOAT.deckY, -4.15);
    g.add(rod);
    const rodMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 1.5, 6), this.mat(0x333333, 0.4, 0.5));
    rodMesh.rotation.x = Math.PI / 2.6;
    rodMesh.position.set(0, 0.6, -0.25);
    rod.add(rodMesh);
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), this.mat(0x999999, 0.3, 0.8));
    reel.rotation.z = Math.PI / 2;
    reel.position.set(0.08, 0.25, 0.1);
    rod.add(reel);
    this.upg.rod = [rod];

    // двигун: вихлоп праворуч + глушник
    const eng = new THREE.Group();
    eng.position.set(1.18, BOAT.deckY + 0.1, 0.9);
    g.add(eng);
    this.addBox(eng, 0.5, 0.42, 0.7, 0, 0.15, 0, 0x3d4046, 0.5, 0.5);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.55, 8), this.mat(0x555a60, 0.35, 0.85));
    pipe.position.set(0.1, 0.5, -0.1);
    pipe.rotation.z = -0.15;
    eng.add(pipe);
    this.upg.engine = [eng];
    this.exhaustTip.set(1.28, BOAT.deckY + 0.62, 0.8);

    // маркери станцій (м'які кільця)
    const markerGeo = new THREE.RingGeometry(0.28, 0.38, 24);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x37c6b5, transparent: true, opacity: 0.0, side: THREE.DoubleSide });
    for (const [id, p] of Object.entries(STATION_POS)) {
      if (id === 'clean') continue;
      const m = new THREE.Mesh(markerGeo, markerMat.clone());
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, BOAT.deckY + 0.075, p.z);
      m.userData.station = id;
      this.stationMarkers.add(m);
    }
    g.add(this.stationMarkers);

    // ── візуали апгрейдів (приховані, вмикаються по рівнях) ──
    this.buildUpgradeVisuals();
  }

  private buildUpgradeVisuals() {
    const g = this.group;
    /** зареєструвати об'єкт візуалу: o видимий, поки lvl <= рівень дерева */
    const list = (id: string, o: THREE.Object3D, lvl: number) => {
      o.userData.lvl = lvl;
      (this.upg[id] ||= []).push(o);
      o.visible = false;
      g.add(o);
    };

    // Двигун: 1 — глушник, 2 — додаткова труба, 3 — великий блок, 4 — подвійний вихлоп, 5 — резервуар
    {
      const m = this.addBox(g, 0.3, 0.16, 0.4, 1.2, BOAT.deckY + 0.42, 0.9, 0x555a60, 0.35, 0.85);
      list('engine', m, 1);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.4, 8), this.mat(0x666c73, 0.3, 0.9));
      pipe.position.set(1.05, BOAT.deckY + 0.55, 1.1);
      list('engine', pipe, 2);
      const muff = this.addBox(g, 0.62, 0.5, 0.8, 1.18, BOAT.deckY + 0.25, 0.9, 0x33373c, 0.4, 0.6);
      list('engine', muff, 3);
      const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8), this.mat(0x777d85, 0.3, 0.9));
      p2.position.set(1.32, BOAT.deckY + 0.62, 0.62);
      list('engine', p2, 4);
      const p3 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8), this.mat(0x777d85, 0.3, 0.9));
      p3.position.set(1.32, BOAT.deckY + 0.62, 1.18);
      list('engine', p3, 4);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.7, 10), this.mat(0x2f3338, 0.4, 0.7));
      tank.position.set(-1.1, BOAT.deckY + 0.3, 2.6);
      list('engine', tank, 5);
    }

    // Корпус: 2 — бортові канти, 3 — броньовані плити, 5 — повна броня + кіл
    for (const s of [-1, 1]) {
      const trim = this.addBox(g, 0.06, 0.18, BOAT.length * 0.95, s * (BOAT.beam / 2 + 0.02), 0.12, 0, 0x4a4f55, 0.4, 0.7);
      list('hull', trim, 2);
      const plate = this.addBox(g, 0.05, 0.5, BOAT.length * 0.9, s * (BOAT.beam / 2 + 0.03), -0.25, 0, 0x3c4147, 0.5, 0.6);
      list('hull', plate, 3);
      const armor = this.addBox(g, 0.07, 0.9, BOAT.length * 0.96, s * (BOAT.beam / 2 + 0.04), 0, 0, 0x2c3036, 0.35, 0.8);
      list('hull', armor, 5);
    }
    {
      const keel = this.addBox(g, 0.16, 0.4, BOAT.length * 0.8, 0, -1.05, 0, 0x2c3036, 0.35, 0.8);
      list('hull', keel, 5);
    }

    // Трюм: ящики (1–3), контейнери (4), + мережа (5) — на кормовій палубі, поза каютою
    {
      const c0 = this.addBox(g, 0.55, 0.45, 0.55, -0.85, BOAT.deckY + 0.22, -3.5, 0x8a6d48, 0.95);
      list('hold', c0, 1);
      const c1 = this.addBox(g, 0.55, 0.45, 0.55, -0.75, BOAT.deckY + 0.22, -4.2, 0x8a6d48, 0.95);
      list('hold', c1, 2);
      const c2 = this.addBox(g, 0.55, 0.45, 0.55, -0.85, BOAT.deckY + 0.22 + 0.45, -3.5, 0x7a5f3f, 0.95);
      list('hold', c2, 3);
    }
    {
      const b1 = this.addBox(g, 0.7, 0.7, 0.7, -0.6, BOAT.deckY + 0.35, 1.2, 0x4a6b8a, 0.7);
      list('hold', b1, 4);
      const b2 = this.addBox(g, 0.7, 0.7, 0.7, 0.75, BOAT.deckY + 0.35, -4.1, 0x4a6b8a, 0.7);
      list('hold', b2, 4);
    }
    {
      const net = this.addBox(g, 1.2, 0.5, 0.3, 0.6, BOAT.deckY + 0.25, -3.5, 0x5a7d6a, 0.9);
      list('hold', net, 5);
    }

    // Вудка: 1–3 — більша бобіна, 4 — друга вудка (карбон), 5 — третя
    {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12), this.mat(0x888888, 0.3, 0.8));
      r.rotation.z = Math.PI / 2;
      r.position.set(0.1, BOAT.deckY + 0.32, -4.0);
      list('rod', r, 1);
      const r2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 12), this.mat(0x99a0a8, 0.25, 0.85));
      r2.rotation.z = Math.PI / 2;
      r2.position.set(-0.12, BOAT.deckY + 0.34, -4.05);
      list('rod', r2, 3);
      const rod2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.025, 1.7, 6), this.mat(0x222831, 0.3, 0.6));
      rod2.rotation.x = Math.PI / 2.7;
      rod2.position.set(-0.35, BOAT.deckY + 0.7, -4.3);
      list('rod', rod2, 4);
      const rod3 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.025, 1.8, 6), this.mat(0x222831, 0.3, 0.6));
      rod3.rotation.x = Math.PI / 2.7;
      rod3.rotation.z = 0.25;
      rod3.position.set(0.35, BOAT.deckY + 0.7, -4.35);
      list('rod', rod3, 5);
    }

    // Паливний бак: 2 циліндри на рівень (1–4), 5 — великий резервуар
    for (let i = 0; i < 8; i++) {
      const lvl = i < 4 ? i + 1 : i - 2;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 10), this.mat(0xb5651d, 0.6, 0.3));
      t.rotation.z = Math.PI / 2;
      t.position.set(-1.05 + (i % 2) * 0.42, BOAT.deckY + 0.25, 2.0 + Math.floor(i / 2) * 0.45);
      t.castShadow = true;
      list('fuel', t, lvl);
    }
    {
      const big = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 12), this.mat(0xa05a18, 0.55, 0.35));
      big.position.set(-1.0, BOAT.deckY + 0.35, 2.6);
      big.castShadow = true;
      list('fuel', big, 5);
    }

    // Світло: 1–4 ліхтарі + прожектор (5)
    const lampGeo = new THREE.BoxGeometry(0.14, 0.12, 0.14);
    const lampPositions: Array<[number, number]> = [
      [0, 4.2],
      [-1.2, 0.5],
      [1.2, 0.5],
      [0, -3.8],
    ];
    for (let i = 0; i < 4; i++) {
      const [lx, lz] = lampPositions[i];
      const lamp = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: 0x333, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4 }));
      lamp.position.set(lx, BOAT.deckY + 0.55, lz);
      const postM = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.5, 6), this.mat(0x3a3a3a));
      postM.position.set(lx, BOAT.deckY + 0.28, lz);
      const grp = new THREE.Group();
      grp.add(lamp);
      grp.add(postM);
      list('lights', grp, i + 1);
      if (i === 0) {
        const light = new THREE.PointLight(0xffd9a0, 0, eff.lightRadius(1), 1.6);
        light.position.set(lx, BOAT.deckY + 0.65, lz);
        grp.add(light);
        this.lights.push({ light, lamp });
      }
    }
    {
      const spot = new THREE.SpotLight(0xfff2d0, 0, 40, 0.5, 0.5, 1.2);
      spot.position.set(0, BOAT.deckY + 1.6, 4.0);
      const tgt = new THREE.Object3D();
      tgt.position.set(0, 0, 12);
      g.add(tgt);
      spot.target = tgt;
      list('lights', spot, 5);
      this.spotlight = spot;
    }

    // Стабілізатор: крила по бортах (зростають по рівнях)
    for (const s of [-1, 1]) {
      for (let lvl = 1; lvl <= 5; lvl++) {
        const w = 0.35 + lvl * 0.18;
        const grp = new THREE.Group();
        const foil = this.addBox(grp, 0.06, w, 0.9, s * (BOAT.beam / 2 + 0.25), -0.45, 0.6, 0x7c8894, 0.35, 0.75);
        const strut = this.addBox(grp, 0.1, 0.5, 0.1, s * (BOAT.beam / 2 + 0.15), -0.25, 0.6, 0x5a636d, 0.5, 0.5);
        list('stab', grp, lvl);
      }
    }
  }

  /** застосувати рівні апгрейдів до mesh */
  applyUpgrades(levels: Record<string, number>, timeDaylight: number) {
    for (const [id, arr] of Object.entries(this.upg)) {
      const lvl = levels[id] ?? 0;
      for (const o of arr) {
        const need = (o.userData.lvl ?? 0) as number;
        o.visible = need > 0 && need <= lvl;
      }
    }
    // колір корпусу по рівню
    const hullLvl = levels.hull ?? 0;
    const base = new THREE.Color(0x8a3033);
    const dark = new THREE.Color(0x4a2a2e);
    for (const m of this.hullMats) m.color.copy(base.lerp(dark, hullLvl * 0.16));

    // світло
    const lightsLvl = levels.lights ?? 0;
    const night = 1 - timeDaylight;
    for (const l of this.lights) {
      l.light.intensity = lightsLvl > 0 ? night * (1.2 + lightsLvl * 0.5) : 0;
      (l.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = lightsLvl > 0 ? night * 1.6 : 0;
    }
    if (this.spotlight && lightsLvl >= 5) this.spotlight.intensity = night * 26;
  }

  /** каютне світло: тепле сяйво вночі та у шторм, ілюмінатори світлять разом */
  setInteriorLight(daylight: number, storm: number) {
    const night = 1 - daylight;
    const i = Math.max(0.2, night * 1.7 + storm * 0.9);
    this.interiorLight.intensity = i;
    for (const m of this.glowMats) m.emissiveIntensity = 0.15 + i * 0.55;
  }

  /** підсвітити маркер станції (1 — активна/близька) */
  setStationGlow(id: string, glow: number) {
    const m = this.stationMarkers.children.find((c) => c.userData.station === id) as THREE.Mesh | undefined;
    if (m) (m.material as THREE.MeshBasicMaterial).opacity = glow * 0.85;
  }

  // ── Трансформ ──

  syncTransform() {
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
  }

  localToWorld(lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(lx, ly, lz);
    return this.group.localToWorld(out);
  }

  worldToLocal(wx: number, wy: number, wz: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(wx, wy, wz);
    return this.group.worldToLocal(out);
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  // ── Фізика ──

  update(dt: number, t: number, ocean: Ocean, weather: Weather, game: GameState, particles: ParticlePool, audio: AudioEngine, rocks: RockObstacle[]) {
    if (this.sinking) {
      this.sinkTimer += dt;
      this.pos.y -= 0.55 * dt;
      this.roll += 0.3 * dt;
      this.pitch += 0.15 * dt;
      this.syncTransform();
      if (this.sinkTimer > 4.5 && this.onSunk) {
        this.sinking = false;
        this.onSunk();
      }
      return;
    }

    // керування (штурвал)
    const enginePower = eff.enginePower(game.upgrades.engine);
    const wetPenalty = 1 - 0.22 * (this.deckWater / 100);
    const maxThrust = 16500 * enginePower * wetPenalty;
    const speed = this.vel.length();
    const fwd = this.forward(this._fwd); // окремий вектор: _v перезаписується в сітці буївності

    // двигун може заглушити хвиля в шторм
    if (this.engineOn && weather.intensity > 0.82 && this.throttle > 0.05 && Math.random() < dt * 0.02 * (weather.intensity - 0.75) * 10) {
      this.engineOn = false;
      this.onEngineStall?.();
    }

    const thrust = this.engineOn ? this.throttle * maxThrust : 0;

    // ── сили ──
    this._f.set(0, -this.mass * 9.81, 0);
    this._t.set(0, 0, 0);

    const buoyEff = 1 - 0.25 * (this.deckWater / 100);
    for (const lp of this.gridLocal) {
      this.localToWorld(lp.x, lp.y, lp.z, this._v);
      const h = ocean.heightAt(this._v.x, this._v.z, t);
      const depth = h - this._v.y;
      if (depth > 0) {
        // вертикальна буївність + демпфування по вертикалі
        const Fb = this.buoyK * buoyEff * depth;
        const relVy = this.vel.y + this.angVel.z * (this._v.x - this.pos.x) - this.angVel.x * (this._v.z - this.pos.z);
        const Fd = -this.buoyDamp * relVy;
        this._f.y += Fb + Fd;
        // хвиля штовхає по схилу (напрямок нормалі)
        ocean.normalAt(this._v.x, this._v.z, t, this._n);
        const push = this.wavePushK * Math.min(depth, 0.6);
        this._f.x += this._n.x * push;
        this._f.z += this._n.z * push;
        // момент від розподілу сил → крен/тангаж (τ = r × F, F — вгору)
        this._r.set(this._v.x - this.pos.x, 0, this._v.z - this.pos.z);
        this._t.x += -this._r.z * (Fb + Fd);
        this._t.z += this._r.x * (Fb + Fd);
      }
    }

    // водний опір (квадратичний → топову швидкість)
    const dragC = 190;
    this._f.x -= dragC * this.vel.x * Math.max(1, speed) + 4 * this.vel.x;
    this._f.y -= 20 * this.vel.y;
    this._f.z -= dragC * this.vel.z * Math.max(1, speed) + 4 * this.vel.z;

    // вітер
    const wind = weather.wind;
    const wvx = Math.sin(weather.windDir) * wind;
    const wvz = -Math.cos(weather.windDir) * wind;
    this._f.x += wvx * 620;
    this._f.z += wvz * 620;

    // швартування: біля причалу без газу — м'яка пружина до точки шварту.
    // тримає човен на місці від вітру/хвиль, але не заважає відійти з повним газом.
    const dMx = this.pos.x - MOOR.x;
    const dMz = this.pos.z - MOOR.z;
    const dMoor = Math.hypot(dMx, dMz);
    if (dMoor < 10 && Math.abs(this.throttle) < 0.15) {
      let fxm = -dMx * 2100 - this.vel.x * 2500;
      let fzm = -dMz * 2100 - this.vel.z * 2500;
      const fl = Math.hypot(fxm, fzm);
      if (fl > 12000) { fxm *= 12000 / fl; fzm *= 12000 / fl; }
      this._f.x += fxm;
      this._f.z += fzm;
    }

    // тяга (у кормі)
    if (thrust !== 0) {
      const stern = this.localToWorld(0, -0.3, -4.2, this._v);
      this._f.x += fwd.x * thrust;
      this._f.z += fwd.z * thrust;
      this._t.y += (stern.z - this.pos.z) * fwd.x * thrust - (stern.x - this.pos.x) * fwd.z * thrust;
      this.engineLoad = clamp(speed / 10, 0, 1) * Math.abs(this.throttle);
    }

    // рильє: момент залежить від швидкості (без ходу — не крутиться)
    const rudderTorque = this.rudder * clamp(speed, 0, 10) * 800;
    this._t.y += rudderTorque;

    // ── інтегрування (підкроки для стабільності) ──
    const rollDamp = 1 + (game.upgrades.stab ?? 0) * 0.3;
    const sub = 2;
    const sdt = dt / sub;
    for (let s = 0; s < sub; s++) {
      this.vel.x += (this._f.x / this.mass) * sdt;
      this.vel.y += (this._f.y / this.mass) * sdt;
      this.vel.z += (this._f.z / this.mass) * sdt;
      this.angVel.x += (this._t.x / this.inertiaPitch) * sdt;
      this.angVel.y += (this._t.y / this.inertiaYaw) * sdt;
      this.angVel.z += (this._t.z / this.inertiaRoll) * sdt;
      // стабілізація: м'яка пружність до рівня + демпфування кутів
      this.angVel.x += -this.pitch * 2.0 * sdt;
      this.angVel.z += -this.roll * 2.0 * rollDamp * sdt;
      this.angVel.x *= 1 - 2.2 * sdt;
      this.angVel.z *= 1 - 2.4 * rollDamp * sdt;
      this.angVel.y *= 1 - 0.8 * sdt;
      this.pos.addScaledVector(this.vel, sdt);
      this.heading += this.angVel.y * sdt;
      this.pitch = clamp(this.pitch + this.angVel.x * sdt, -0.45, 0.45);
      this.roll = clamp(this.roll + this.angVel.z * sdt, -0.55, 0.55);
    }

    // страховка: жодна числова нестабільність не повинна розірвати гру
    const vlen = this.vel.length();
    if (vlen > 25) this.vel.multiplyScalar(25 / vlen);
    const alen = this.angVel.length();
    if (alen > 6) this.angVel.multiplyScalar(6 / alen);

    // палуба затоплюється великими хвилями
    const deckWorld = this.pos.y + BOAT.deckY;
    const crest = ocean.heightAt(this.pos.x, this.pos.z, t) + 0.5 * weather.intensity;
    if (crest > deckWorld - 0.12 && weather.intensity > 0.45) {
      this.deckWater = clamp(this.deckWater + (crest - deckWorld + 0.12) * 16 * dt, 0, 100);
      if (Math.random() < dt * 2) particles.splash(this.pos.x + rand(-1.5, 1.5), deckWorld, this.pos.z + rand(-1.5, 1.5), 0.7);
    } else {
      this.deckWater = Math.max(0, this.deckWater - 2.5 * dt);
    }

    // бризки від носа
    this.localToWorld(0, 0.7, 4.3, this.bowPoint);
    particles.spray(this.bowPoint, fwd, speed * Math.abs(this.throttle) + speed * 0.4, dt);
    // дим (вихлоп у локальних координатах → світ)
    if (this.engineOn && this.throttle > 0.05) {
      this.localToWorld(this.exhaustTip.x, this.exhaustTip.y, this.exhaustTip.z, this._t);
      particles.exhaust(this._t, Math.abs(this.throttle), dt);
    }

    // зіткнення з скелями
    for (const rock of rocks) {
      const dx = this.pos.x - rock.x;
      const dz = this.pos.z - rock.z;
      const d = Math.hypot(dx, dz);
      const minD = rock.r + 1.6;
      if (d < minD && d > 0.01) {
        const nx = dx / d;
        const nz = dz / d;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) {
          const impact = -vn;
          this.vel.x += nx * impact * 1.4;
          this.vel.z += nz * impact * 1.4;
          if (impact > 2) {
            const dmg = (impact - 1.5) * 6;
            game.damage(dmg);
            const hitPos = new THREE.Vector3(this.pos.x - nx * 1.4, 0.5, this.pos.z - nz * 1.4);
            this.onHullHit?.(impact, hitPos);
            particles.splash(hitPos.x, 0.4, hitPos.z, 1.2);
          }
        }
        // витісняємо
        this.pos.x = rock.x + nx * minD;
        this.pos.z = rock.z + nz * minD;
      }
    }

    // шторм + мокра палуба → просочення корпусу
    if (this.deckWater > 85 && weather.intensity > 0.85) {
      game.damage(1.6 * dt);
    }

    if (game.hull <= 0 && !this.sinking) {
      this.sinking = true;
      this.sinkTimer = 0;
    }

    // звук
    audio.setEngine(Math.abs(this.throttle), this.engineOn, this.engineLoad);

    this.syncTransform();
  }

  /** осушення палуби помпою */
  dryDeck(dt: number) {
    this.deckWater = Math.max(0, this.deckWater - 34 * dt);
  }

  /** перезапустити двигун */
  restartEngine() {
    this.engineOn = true;
  }

  /** повне відновлення (затоплення) */
  reset(x: number, z: number, heading: number) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.heading = heading;
    this.pitch = 0;
    this.roll = 0;
    this.throttle = 0;
    this.rudder = 0;
    this.sinking = false;
    this.sinkTimer = 0;
    this.engineOn = true;
    this.deckWater = 0;
    this.syncTransform();
  }
}
