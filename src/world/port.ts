import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import type { RockObstacle } from './boat';
import { Batch, T, boxGeo, cylGeo, gableBodyGeo, roofSlabGeo } from './portKit';
import { GROUND_Y, addIslands, addSeaRocks, buildTerrain, buildTrees, terrainHeight, type TreeSpot } from './portTerrain';
import {
  beamTex,
  cobbleTex,
  corrugatedTex,
  glowTex,
  planksTex,
  plasterTex,
  roofTilesTex,
  sidingTex,
  stoneTex,
  windowGlowTex,
  windowTex,
} from './textures';

// ─────────────────────────────────────────────────────────────
// Порт: рибальське містечко. Дерев'яний причал на палях, кам'яна
// набережна з бруківкою, кольорові будиночки, маяк, сараї для сіток,
// пірс із пришвартованими човнами, буї, ліхтарі. Довкола — пагорби
// з лісом, пляжі, скелі в морі й далекі острови.
// Статична геометрія зливається за матеріалом (див. portKit.Batch).
// ─────────────────────────────────────────────────────────────

export interface Platform {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
}

export interface PortPoint {
  id: 'shop' | 'fuel' | 'repair' | 'house';
  x: number;
  z: number;
  label: string;
}

export const PORT_POINTS: PortPoint[] = [
  { id: 'shop', x: -10, z: -44.5, label: 'Магазин' },
  { id: 'fuel', x: 8.5, z: -43, label: 'Заправка' },
  { id: 'repair', x: 14, z: -49.5, label: 'Ремонт' },
  { id: 'house', x: -2, z: -58.5, label: 'Хата (сон)' },
];

const DECK_Y = 1.1;
const G = GROUND_Y;

interface HouseOpts {
  x: number;
  z: number;
  ry?: number;
  /** рівень підлоги (низ стін мінус цоколь) */
  y0?: number;
  /** наскільки цоколь іде вниз (на схилі) */
  sink?: number;
  w: number;
  d: number;
  h: number;
  rh: number;
  wall: THREE.Material;
  wallTile?: number;
  roof: THREE.Material;
  trim?: boolean;
  door?: number | null;
  doorMat?: THREE.Material;
  front?: number[];
  /** вікна фасаду на першому поверсі (якщо відрізняються від front) */
  front1?: number[];
  back?: number[];
  sideWin?: boolean;
  chimney?: [number, number] | null;
  shutter?: THREE.Material | null;
  lit?: number;
  doorLamp?: boolean;
}

interface Bobber {
  obj: THREE.Object3D;
  baseY: number;
  phase: number;
  amp: number;
  tilt: number;
}

export class Port {
  group = new THREE.Group();
  platforms: Platform[] = [
    { x0: -24, z0: -40, x1: 24, z1: -18, y: DECK_Y }, // причал
    { x0: -60, z0: -130, x1: 60, z1: -40, y: G }, // земля
    { x0: -34.5, z0: -40, x1: -31.5, z1: -24, y: DECK_Y }, // пірс для човнів (захід)
  ];
  rocks: RockObstacle[] = [];

  private lighthouseLight!: THREE.SpotLight;
  private lampLights: THREE.PointLight[] = [];
  private beaconPhase = 0;
  private night = 0;

  private batch = new Batch();
  private rng = mulberry32(4242);
  private M!: ReturnType<Port['makeMaterials']>;

  // нічні ефекти
  private glowMats: THREE.SpriteMaterial[] = [];
  private poolMat!: THREE.MeshBasicMaterial;
  private signMats: THREE.MeshStandardMaterial[] = [];
  private beamMat!: THREE.MeshBasicMaterial;
  private beamPivot!: THREE.Object3D;
  private buoyLights: Array<{ mat: THREE.MeshStandardMaterial; period: number; offset: number }> = [];

  // анімація
  private bobbers: Bobber[] = [];
  private flag!: { geo: THREE.BufferGeometry; base: Float32Array };
  private smoke: Array<{ s: THREE.Sprite; mat: THREE.SpriteMaterial; k: number }> = [];
  private smokeOrigin = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    this.M = this.makeMaterials();
    this.build();
    this.scene.add(this.group);
  }

  // ───────────────────────── матеріали ─────────────────────────

  private makeMaterials() {
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...p });
    const planks = planksTex();
    const stone = stoneTex();
    const plaster = plasterTex();
    const siding = sidingTex();
    const tiles = roofTilesTex();
    const corr = corrugatedTex();
    return {
      deck: std({ map: planks, color: 0xb08d63 }),
      woodDark: std({ map: planks, color: 0x6a4f35, roughness: 0.95 }),
      woodGrey: std({ map: planks, color: 0xa59c8e }),
      crate: std({ map: planks, color: 0xc9a36d }),
      stone: std({ map: stone, color: 0xd2cabb }),
      stoneDark: std({ map: stone, color: 0x9a9284 }),
      coping: std({ map: stone, color: 0xe2dccf, roughness: 0.85 }),
      cobble: std({ map: cobbleTex(), color: 0xb9b0a1, roughness: 0.92 }),
      plasterWhite: std({ map: plaster, color: 0xf6f2ea }),
      plasterCream: std({ map: plaster, color: 0xf2e3c2 }),
      plasterOchre: std({ map: plaster, color: 0xe9c27e }),
      plasterPink: std({ map: plaster, color: 0xe8b7a4 }),
      plasterBlue: std({ map: plaster, color: 0xa9c6dc }),
      sidingRed: std({ map: siding, color: 0xa9442f }),
      sidingYellow: std({ map: siding, color: 0xe0b14e }),
      sidingBlue: std({ map: siding, color: 0x4f80a8 }),
      sidingGreen: std({ map: siding, color: 0x6b9273 }),
      sidingWhite: std({ map: siding, color: 0xf0ede4 }),
      roofRed: std({ map: tiles, color: 0xc9694a, roughness: 0.85 }),
      roofDark: std({ map: tiles, color: 0x5d6670, roughness: 0.8 }),
      roofBrown: std({ map: tiles, color: 0x8e5240, roughness: 0.85 }),
      metalGrey: std({ map: corr, color: 0xaab4ba, roughness: 0.6, metalness: 0.35 }),
      metalRust: std({ map: corr, color: 0xb0583c, roughness: 0.7, metalness: 0.25 }),
      metalWhite: std({ map: corr, color: 0xe8e8e2, roughness: 0.6, metalness: 0.2 }),
      trim: std({ color: 0xf4f1e8, roughness: 0.8 }),
      iron: std({ color: 0x24292d, roughness: 0.45, metalness: 0.7 }),
      ironGreen: std({ color: 0x23392f, roughness: 0.5, metalness: 0.6 }),
      rubber: std({ color: 0x1c1e20, roughness: 0.95 }),
      rope: std({ color: 0xcdb27a, roughness: 1 }),
      netGreen: std({ color: 0x3e6a5c, roughness: 1, flatShading: true }),
      redPaint: std({ color: 0xc23a2c, roughness: 0.6 }),
      whitePaint: std({ color: 0xf2f1ec, roughness: 0.55 }),
      bluePaint: std({ color: 0x2f5f8f, roughness: 0.6 }),
      greenPaint: std({ color: 0x2f7d4a, roughness: 0.6 }),
      yellowPaint: std({ color: 0xe8b52c, roughness: 0.6 }),
      shutterBlue: std({ color: 0x3d6f9c, roughness: 0.75 }),
      shutterGreen: std({ color: 0x3f7258, roughness: 0.75 }),
      shutterRed: std({ color: 0x9a3a2c, roughness: 0.75 }),
      doorWood: std({ map: planks, color: 0x7a5434 }),
      plasticBlue: std({ color: 0x2f6fb0, roughness: 0.5 }),
      plasticRed: std({ color: 0xc8432e, roughness: 0.5 }),
      fish: std({ color: 0xb9c6cc, roughness: 0.3, metalness: 0.5 }),
      concrete: std({ color: 0xb4b2ab, roughness: 0.95 }),
      leaf: std({ color: 0x5d8a3e, roughness: 0.9, flatShading: true }),
      flowerA: std({ color: 0xd9475a, roughness: 0.8 }),
      flowerB: std({ color: 0xf2c94c, roughness: 0.8 }),
      flowerC: std({ color: 0xb06fd0, roughness: 0.8 }),
      rock: std({ vertexColors: true, roughness: 0.95, flatShading: true }),
      island: std({ vertexColors: true, roughness: 0.98, flatShading: true }),
      glassDark: std({ map: windowTex(), roughness: 0.25, metalness: 0.1 }),
      glassLit: std({ map: windowTex(), emissiveMap: windowGlowTex(), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.25, metalness: 0.1 }),
      lampGlass: std({ color: 0xfff1c8, emissive: 0xffc977, emissiveIntensity: 0.05, roughness: 0.2 }),
      lensGlass: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe39a, emissiveIntensity: 0.3, roughness: 0.1, transparent: true, opacity: 0.85 }),
      canopyLight: std({ color: 0xf6f3ea, emissive: 0xfff0d0, emissiveIntensity: 0 }),
    };
  }

  // ───────────────────────── дрібні хелпери ─────────────────────────

  private add(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, cast = true) {
    this.batch.add(geo, mat, m, cast);
  }

  /** box з центром (x,y,z) */
  private bx(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, tu = 1, tv = tu, cast = true) {
    this.add(boxGeo(w, h, d, tu, tv), mat, T(x, y, z, ry), cast);
  }

  private cy(mat: THREE.Material, rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 10, tile = 1) {
    this.add(cylGeo(rt, rb, h, seg, tile), mat, T(x, y, z));
  }

  /** м'який ореол навколо джерела світла (видно лише вночі) */
  private glow(x: number, y: number, z: number, size: number, color = 0xffc677): THREE.Sprite {
    let mat = this.glowMats.find((m) => m.color.getHex() === color);
    if (!mat) {
      mat = new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      this.glowMats.push(mat);
    }
    const s = new THREE.Sprite(mat);
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    this.group.add(s);
    return s;
  }

  /** тепла «калюжа» світла на землі під ліхтарем */
  private pool(x: number, y: number, z: number, r: number) {
    const g = new THREE.PlaneGeometry(r * 2, r * 2);
    g.rotateX(-Math.PI / 2);
    this.add(g, this.poolMat, T(x, y + 0.04, z), false);
  }

  /** вуличний ліхтар-ліхтарня на стовпі; повертає позицію лампи */
  private lamp(x: number, z: number, y0: number, poolR = 3.6): THREE.Vector3 {
    const M = this.M;
    this.cy(M.ironGreen, 0.2, 0.24, 0.45, x, y0 + 0.22, z, 8);
    this.cy(M.ironGreen, 0.06, 0.09, 3.5, x, y0 + 1.9, z, 8);
    this.cy(M.ironGreen, 0.13, 0.08, 0.16, x, y0 + 3.62, z, 8);
    // ліхтар: скло + каркас + дашок
    const ly = y0 + 3.95;
    this.add(boxGeo(0.3, 0.42, 0.3), M.lampGlass, T(x, ly, z, Math.PI / 4), false);
    for (const [dx, dz] of [[0.16, 0], [-0.16, 0], [0, 0.16], [0, -0.16]]) {
      this.bx(M.ironGreen, 0.035, 0.46, 0.035, x + dx, ly, z + dz);
    }
    this.add(new THREE.ConeGeometry(0.32, 0.26, 4), M.ironGreen, T(x, ly + 0.34, z));
    this.add(new THREE.SphereGeometry(0.05, 6, 4), M.ironGreen, T(x, ly + 0.52, z));
    this.glow(x, ly, z, 2.6);
    if (poolR > 0) this.pool(x, y0, z, poolR);
    return new THREE.Vector3(x, ly, z);
  }

  /** справжнє точкове світло (лише кілька на всю сцену) */
  private realLight(p: THREE.Vector3) {
    const pl = new THREE.PointLight(0xffd08a, 0, 22, 1.5);
    pl.position.copy(p);
    pl.position.y -= 0.15;
    this.group.add(pl);
    this.lampLights.push(pl);
  }

  // ───────────────────────── будинок ─────────────────────────

  /** будинок із двосхилим дахом; фасад (двері) дивиться в локальний +Z */
  private house(o: HouseOpts): { M: THREE.Matrix4; chimney: THREE.Vector3 | null } {
    const M = this.M;
    const rng = this.rng;
    const base = T(o.x, o.y0 ?? G, o.z, o.ry ?? 0);
    const at = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => base.clone().multiply(T(x, y, z, ry, rx, rz));
    const { w, d, h, rh } = o;
    const B = 0.35;
    const sink = o.sink ?? 0;

    // цоколь
    const ph = 0.45 + sink;
    this.add(boxGeo(w + 0.3, ph, d + 0.3, 1.5), M.stoneDark, at(0, B - ph / 2, 0));
    // стіни з фронтонами
    this.add(gableBodyGeo(w, d, h, rh, o.wallTile ?? 2), o.wall, at(0, B, 0));
    // кутові дошки
    if (o.trim) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        this.add(boxGeo(0.16, h, 0.16), M.trim, at(sx * (w / 2), B + h / 2, sz * (d / 2)));
      }
    }
    // дах
    const a = Math.atan2(rh, d / 2);
    const ov = 0.45;
    const L = Math.hypot(d / 2, rh) + ov;
    const t = 0.16;
    const W = w + 0.7;
    const slab = roofSlabGeo(L, t, W, 2).rotateY(-Math.PI / 2);
    const ridgeY = B + h + rh;
    for (const s of [1, -1]) {
      const cz = s * Math.cos(a) * (L / 2) + s * Math.sin(a) * (t / 2);
      const cyy = ridgeY - Math.sin(a) * (L / 2) + Math.cos(a) * (t / 2);
      this.add(slab, o.roof, at(0, cyy, cz, 0, s * a));
    }
    this.add(boxGeo(W + 0.04, 0.18, 0.32), o.roof, at(0, ridgeY + 0.12, 0));
    // карнизні дошки під схилами (фронтони)
    for (const sx of [-1, 1]) {
      for (const s of [1, -1]) {
        const len = Math.hypot(d / 2, rh) + ov * 0.6;
        const cz = s * Math.cos(a) * (len / 2);
        const cyy = ridgeY - Math.sin(a) * (len / 2) - 0.02;
        this.add(boxGeo(0.08, 0.2, len), M.trim, at(sx * (W / 2 - 0.02), cyy, cz, 0, s * a));
      }
    }

    // вікна
    const rows = h >= 4.6 ? [B + 1.45, B + h - 1.25] : [B + h * 0.55 + 0.1];
    const lit = o.lit ?? 0.65;
    const win = (lx: number, ly: number, lz: number, ry: number) => {
      const m = at(lx, ly, lz, ry);
      const mm = (x: number, y: number, z: number) => m.clone().multiply(T(x, y, z));
      this.add(boxGeo(0.98, 1.32, 0.08), M.trim, mm(0, 0, 0.0));
      this.add(new THREE.PlaneGeometry(0.8, 1.14), rng() < lit ? M.glassLit : M.glassDark, mm(0, 0, 0.045), false);
      this.add(boxGeo(1.12, 0.07, 0.2), M.trim, mm(0, -0.68, 0.06));
      if (o.shutter) {
        this.add(boxGeo(0.44, 1.24, 0.05), o.shutter, mm(-0.74, 0, 0.04));
        this.add(boxGeo(0.44, 1.24, 0.05), o.shutter, mm(0.74, 0, 0.04));
      }
    };
    const dx = o.door;
    for (const ly of rows) {
      const fr = ly === rows[0] && rows.length > 1 && o.front1 ? o.front1 : o.front ?? [];
      for (const lx of fr) {
        if (dx != null && ly < B + 2.5 && Math.abs(lx - dx) < 1.3) continue;
        win(lx, ly, d / 2, 0);
      }
      for (const lx of o.back ?? []) win(lx, ly, -d / 2, Math.PI);
    }
    if (o.sideWin) {
      const gy = rows.length > 1 ? rows[1] : rows[0];
      win(w / 2, gy, 0, Math.PI / 2);
      win(-w / 2, gy, 0, -Math.PI / 2);
    }
    // двері
    if (dx != null) {
      this.add(boxGeo(1.32, 2.32, 0.07), M.trim, at(dx, B + 1.12, d / 2));
      this.add(boxGeo(1.06, 2.1, 0.1), o.doorMat ?? M.doorWood, at(dx, B + 1.05, d / 2 + 0.02));
      this.add(boxGeo(1.7, 0.3, 0.8), M.stone, at(dx, B - 0.17, d / 2 + 0.45));
      // дашок над дверима
      this.add(boxGeo(1.6, 0.08, 0.7), o.roof, at(dx, B + 2.45, d / 2 + 0.3, 0, 0.25));
      if (o.doorLamp !== false) {
        const lp = at(dx + 0.9, B + 2.2, d / 2 + 0.16);
        this.add(boxGeo(0.16, 0.24, 0.16), M.lampGlass, lp, false);
        this.add(boxGeo(0.22, 0.05, 0.22), M.iron, lp.clone().multiply(T(0, 0.14, 0)));
        const wp = new THREE.Vector3().setFromMatrixPosition(lp);
        this.glow(wp.x, wp.y, wp.z, 1.4);
      }
    }
    // комин
    let chimney: THREE.Vector3 | null = null;
    if (o.chimney) {
      const [cx, cz] = o.chimney;
      const roofAt = ridgeY - (Math.abs(cz) / (d / 2)) * rh;
      const top = roofAt + 1.0;
      const hh = top - (B + h - 0.3);
      this.add(boxGeo(0.62, hh, 0.62, 1.2), M.stoneDark, at(cx, top - hh / 2, cz));
      this.add(boxGeo(0.8, 0.12, 0.8), M.stone, at(cx, top + 0.06, cz));
      chimney = new THREE.Vector3().setFromMatrixPosition(at(cx, top + 0.2, cz));
    }
    return { M: base, chimney };
  }

  // ───────────────────────── побудова ─────────────────────────

  private build() {
    this.poolMat = new THREE.MeshBasicMaterial({
      map: glowTex(), color: 0xffb860, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });

    buildTerrain(this.group);
    this.buildQuay();
    this.buildDock();
    this.buildJetty();
    this.buildServiceBuildings();
    this.buildLighthouse();
    this.buildVillage();
    this.buildBuoys();
    this.buildSeaRocksAndIslands();

    // все статичне — у кілька мешів
    this.batch.build(this.group);
  }

  /** кам'яна набережна, бруківка, вулички, межові мури */
  private buildQuay() {
    const M = this.M;
    // фронтальна стіна (під причалом теж — видно між палями)
    const wallH = 5.0;
    const wallY = 1.45 - wallH / 2;
    for (const [x0, x1] of [[-60.6, -24], [-24, 24], [24, 60.6]]) {
      const w = x1 - x0;
      this.bx(M.stone, w, wallH, 0.9, (x0 + x1) / 2, wallY, -40.25, 0, 3, 3);
      if (x0 === -24) continue;
      this.bx(M.coping, w, 0.2, 1.1, (x0 + x1) / 2, 1.56, -40.15, 0, 2.2, 2.2);
    }
    // дві широкі сходинки з причалу (1.1) на набережну (1.6)
    this.bx(M.coping, 50, 0.9, 0.8, 0, 1.36 - 0.45, -40.4, 0, 2.2, 2.2);
    this.bx(M.coping, 50, 1.13, 0.8, 0, 1.63 - 0.565, -41.2, 0, 2.2, 2.2);
    // бічні стіни (за ними — пляжі)
    for (const s of [-1, 1]) {
      this.bx(M.stone, 0.9, wallH, 16, s * 60.25, wallY, -48, 0, 3, 3);
      this.bx(M.coping, 1.1, 0.2, 16.2, s * 60.15, 1.56, -48.1, 0, 2.2, 2.2);
    }
    // гранітні тумби на набережній
    for (const x of [-54, -44, -27.5, 28, 44, 54]) {
      this.cy(M.iron, 0.16, 0.2, 0.55, x, G + 0.3, -40.3, 10);
      this.cy(M.iron, 0.25, 0.25, 0.1, x, G + 0.6, -40.3, 10);
    }

    // бруківка: променад уздовж води
    for (const sx of [-1, 1]) this.bx(M.cobble, 35.5, 0.06, 6.2, sx * 42.75, G + 0.02, -43.3, 0, 2.5, 2.5, false);
    this.bx(M.cobble, 50, 0.06, 4.8, 0, G + 0.02, -44.0, 0, 2.5, 2.5, false);
    // доріжки
    this.bx(M.cobble, 2.6, 0.06, 13.6, -2, G + 0.02, -53.1, 0, 2.5, 2.5, false); // до хати
    this.bx(M.cobble, 2.6, 0.06, 4.2, -2, G + 0.02, -66.3, 0, 2.5, 2.5, false); // від хати до вулиці
    this.bx(M.cobble, 118, 0.06, 4.6, 0, G + 0.02, -70.3, 0, 2.5, 2.5, false); // вулиця
    this.bx(M.cobble, 2.4, 0.06, 3.6, -32, G + 0.02, -48.2, 0, 2.5, 2.5, false); // до маяка
    this.bx(M.cobble, 3, 0.06, 36.4, 25.6, G + 0.02, -90.8, 0, 2.5, 2.5, false); // до каплички

    // низький кам'яний мур по межі плато (позаду й з боків)
    this.bx(M.stoneDark, 120, 0.8, 0.6, 0, G + 0.3, -130.2, 0, 2, 2);
    for (const s of [-1, 1]) this.bx(M.stoneDark, 0.6, 0.8, 74, s * 60.2, G + 0.3, -93.2, 0, 2, 2);
  }

  /** головний причал на палях */
  private buildDock() {
    const M = this.M;
    const top = DECK_Y;
    // настил: дошки йдуть уздовж Z
    this.bx(M.deck, 48, 0.32, 22, 0, top - 0.16, -29, 0, 1.0, 4.0);
    // обрамлення країв (фасції) + низький колесовідбій
    this.bx(M.woodDark, 48.4, 0.5, 0.22, 0, top - 0.18, -17.9, 0, 1, 4);
    for (const s of [-1, 1]) this.bx(M.woodDark, 0.22, 0.5, 22, s * 24.1, top - 0.18, -29, 0, 1, 4);
    for (const [x0, x1] of [[-24, -6.5], [6.5, 24]]) {
      this.bx(M.woodDark, x1 - x0, 0.14, 0.24, (x0 + x1) / 2, top + 0.07, -18.15, 0, 1, 4);
    }
    // палі
    const pile = cylGeo(0.22, 0.24, 4.6, 8, 1);
    const algae = cylGeo(0.255, 0.265, 1.1, 8, 1);
    const algaeMat = this.algaeMat();
    const addPile = (x: number, z: number, topY = top - 0.2) => {
      const h = 4.6;
      this.add(pile, M.woodDark, T(x, topY - h / 2, z));
      this.add(algae, algaeMat, T(x, -0.35, z), false);
    };
    for (let x = -22.5; x <= 22.6; x += 3) addPile(x, -18.3);
    for (const s of [-1, 1]) for (let z = -21; z >= -39; z -= 3) addPile(s * 23.8, z);
    for (let x = -18; x <= 18; x += 6) for (const z of [-24, -30, -36]) addPile(x, z);
    // кутові палі виступають над настилом
    for (const [x, z] of [[-23.8, -18.3], [23.8, -18.3]]) {
      this.cy(M.woodDark, 0.24, 0.24, 0.8, x, top + 0.3, z, 8);
      this.cy(M.iron, 0.26, 0.26, 0.06, x, top + 0.72, z, 8);
    }
    // діагональні в'язі між палями фронту
    for (let i = 0; i < 15; i++) {
      const x = -21 + i * 3;
      const dir = i % 2 ? 1 : -1;
      this.add(boxGeo(3.4, 0.22, 0.1, 1, 1), M.woodDark, T(x, 0.35, -18.55, 0, 0, dir * 0.38));
    }
    // поздовжній брус під настилом
    this.bx(M.woodDark, 48, 0.3, 0.25, 0, top - 0.48, -18.55, 0, 1, 4);

    // тумби (кнехти)
    for (let i = 0; i < 5; i++) this.bollard(-16 + i * 8, -19.2, top);
    // кранці-шини (поза місцем швартування яхти)
    const tyre = new THREE.TorusGeometry(0.36, 0.13, 6, 12);
    for (const x of [-21, -16, -9, 9, 16, 21]) {
      this.add(tyre, M.rubber, T(x, 0.45, -17.72));
      this.bx(M.rope, 0.04, 0.5, 0.04, x, 0.95, -17.75);
    }
    // драбини у воду
    for (const x of [-12, 12]) this.ladder(x, -17.78, top);
    // рятувальні кола
    this.lifeRing(-12.9, -18.6, top, 0);
    this.lifeRing(12.9, -18.6, top, 0);

    // ліхтарі причалу (центральний — справжнє світло біля яхти)
    const lp = [-18, 0, 18].map((x) => this.lamp(x, -19.5, top, 4.2));
    this.realLight(lp[1]);

    // вантаж: ящики, бочки, ящики з рибою, сітки, бухти канату
    this.crateStack(17, -22.4, top, 0.2);
    this.crate(21.3, top, -23.6, 0.9, 0.5);
    this.crate(21.3, top + 0.9, -23.6, 0.75, 0.2);
    this.crate(22.3, top, -25.1, 0.8, -0.3);
    for (let i = 0; i < 3; i++) this.barrel(-19 + i * 0.85, top, -24, i * 0.7);
    this.barrel(-18.6, top, -24.85, 2);
    this.fishBoxes(19.2, top, -30.5, 0.1);
    this.fishBoxes(-16.5, top, -37.2, -0.2);
    this.netPile(20.4, top, -35.2, 0.3);
    this.netPile(-20.2, top, -32.8, 1.1);
    this.ropeCoil(-21.4, top, -21.2);
    this.ropeCoil(-20.6, top, -20.4);
    this.ropeCoil(6.8, top, -19.2);
    this.bench(-9.5, top, -38.9, 0);
    this.bench(9.5, top, -38.9, 0);
    this.davit(22.6, -19.4, top);
  }

  private algaeMatCache: THREE.MeshStandardMaterial | null = null;
  private algaeMat() {
    if (!this.algaeMatCache) this.algaeMatCache = new THREE.MeshStandardMaterial({ color: 0x2e3a24, roughness: 1 });
    return this.algaeMatCache;
  }

  private bollard(x: number, z: number, y: number) {
    const M = this.M;
    this.cy(M.iron, 0.24, 0.28, 0.12, x, y + 0.06, z, 12);
    this.cy(M.iron, 0.16, 0.2, 0.5, x, y + 0.36, z, 12);
    this.cy(M.iron, 0.28, 0.24, 0.12, x, y + 0.66, z, 12);
  }

  private ladder(x: number, z: number, top: number) {
    const M = this.M;
    for (const s of [-0.24, 0.24]) {
      this.bx(M.iron, 0.05, 3.0, 0.05, x + s, top - 1.2, z);
      this.add(new THREE.TorusGeometry(0.22, 0.025, 4, 8, Math.PI), M.iron, T(x + s, top + 0.3, z - 0.22, Math.PI / 2));
    }
    for (let i = 0; i < 7; i++) this.bx(M.iron, 0.5, 0.04, 0.04, x, top - 2.4 + i * 0.4, z);
  }

  private lifeRing(x: number, z: number, top: number, ry: number) {
    const M = this.M;
    this.bx(M.woodDark, 0.12, 1.5, 0.12, x, top + 0.75, z);
    const base = T(x, top + 1.05, z + 0.1, ry);
    for (let k = 0; k < 4; k++) {
      const arc = new THREE.TorusGeometry(0.3, 0.075, 6, 6, Math.PI / 2);
      this.add(arc, k % 2 ? M.whitePaint : M.redPaint, base.clone().multiply(T(0, 0, 0, 0, 0, (k * Math.PI) / 2)));
    }
  }

  private crate(x: number, y: number, z: number, s: number, ry: number) {
    this.add(boxGeo(s, s, s, 0.6, 1.2), this.M.crate, T(x, y + s / 2, z, ry));
  }

  private crateStack(x: number, z: number, y: number, ry: number) {
    this.crate(x, y, z, 0.9, ry);
    this.crate(x + 0.95, y, z - 0.2, 0.85, ry + 0.2);
    this.crate(x + 0.45, y + 0.88, z - 0.1, 0.8, ry - 0.3);
    this.crate(x + 0.2, y, z - 1.0, 0.8, ry + 0.5);
  }

  private barrel(x: number, y: number, z: number, ry: number) {
    const M = this.M;
    const g = new THREE.CylinderGeometry(0.36, 0.33, 0.9, 12);
    this.add(g, M.woodDark, T(x, y + 0.45, z, ry));
    for (const hy of [0.18, 0.72]) this.cy(M.iron, 0.365, 0.365, 0.05, x, y + hy, z, 12);
  }

  private fishBoxes(x: number, y: number, z: number, ry: number) {
    const M = this.M;
    const base = T(x, y, z, ry);
    const put = (dx: number, dy: number, dz: number, mat: THREE.Material, full: boolean) => {
      this.add(boxGeo(0.8, 0.28, 0.55), mat, base.clone().multiply(T(dx, dy + 0.14, dz)));
      if (full) this.add(boxGeo(0.7, 0.04, 0.45), M.fish, base.clone().multiply(T(dx, dy + 0.27, dz)), false);
    };
    put(0, 0, 0, M.plasticBlue, false);
    put(0, 0.28, 0, M.plasticRed, false);
    put(0, 0.56, 0, M.plasticBlue, true);
    put(0.9, 0, 0.1, M.plasticRed, true);
    put(0.9, 0.28, 0.1, M.plasticBlue, true);
  }

  private netPile(x: number, y: number, z: number, ry: number) {
    const M = this.M;
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 0.85 + Math.sin(p.getX(i) * 5 + p.getZ(i) * 3) * 0.12;
      p.setXYZ(i, p.getX(i) * k, Math.max(p.getY(i), -0.3) * k, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    this.add(g, M.netGreen, T(x, y + 0.12, z, ry, 0, 0, 1.0, 0.38, 0.75));
    // поплавки на сітці
    const f = new THREE.SphereGeometry(0.09, 6, 4);
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + ry;
      this.add(f, M.yellowPaint, T(x + Math.cos(a) * 0.75, y + 0.28 + (i % 3) * 0.05, z + Math.sin(a) * 0.5));
    }
  }

  private ropeCoil(x: number, y: number, z: number) {
    const g = new THREE.TorusGeometry(0.3, 0.06, 6, 16);
    this.add(g, this.M.rope, T(x, y + 0.06, z, 0, Math.PI / 2));
    this.add(g, this.M.rope, T(x, y + 0.17, z, 0, Math.PI / 2, 0, 0.82));
  }

  private bench(x: number, y: number, z: number, ry: number) {
    const M = this.M;
    const b = T(x, y, z, ry);
    const at = (dx: number, dy: number, dz: number) => b.clone().multiply(T(dx, dy, dz));
    this.add(boxGeo(1.8, 0.07, 0.45, 0.6, 1.8), M.deck, at(0, 0.45, 0));
    this.add(boxGeo(1.8, 0.35, 0.06, 0.6, 1.8), M.deck, at(0, 0.75, -0.24));
    for (const s of [-0.75, 0.75]) {
      this.add(boxGeo(0.07, 0.45, 0.4), M.iron, at(s, 0.22, 0));
      this.add(boxGeo(0.07, 0.6, 0.06), M.iron, at(s, 0.7, -0.26));
    }
  }

  /** маленький вантажний кран-стріла на краю причалу */
  private davit(x: number, z: number, top: number) {
    const M = this.M;
    this.cy(M.yellowPaint, 0.14, 0.18, 3.4, x, top + 1.7, z, 10);
    this.add(boxGeo(0.14, 0.14, 2.6), M.yellowPaint, T(x, top + 3.25, z + 1.0, 0, -0.25));
    this.cy(M.iron, 0.012, 0.012, 1.8, x, top + 2.6, z + 2.2, 4);
    this.add(new THREE.TorusGeometry(0.1, 0.025, 4, 8, Math.PI * 1.4), M.iron, T(x, top + 1.65, z + 2.2));
    this.add(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 10), M.iron, T(x, top + 1.2, z, 0, 0, Math.PI / 2));
  }

  /** вузький пірс на заході з пришвартованими рибальськими човнами */
  private buildJetty() {
    const M = this.M;
    const top = DECK_Y;
    this.bx(M.woodGrey, 3, 0.28, 16, -33, top - 0.14, -32, 0, 0.9, 3.5);
    for (let z = -25; z >= -39; z -= 3.5) {
      for (const s of [-1, 1]) {
        this.add(cylGeo(0.18, 0.2, 4.7, 8), M.woodDark, T(-33 + s * 1.4, top + 0.4 - 2.35, z));
        this.add(cylGeo(0.215, 0.225, 1.1, 8), this.algaeMat(), T(-33 + s * 1.4, -0.35, z), false);
        // палі виступають — до них швартуються
        this.cy(M.iron, 0.2, 0.2, 0.04, -33 + s * 1.4, top + 0.42, z, 8);
      }
    }
    for (const s of [-1, 1]) this.bx(M.woodDark, 0.18, 0.4, 16, -33 + s * 1.55, top - 0.2, -32, 0, 1, 4);
    this.lamp(-33.9, -24.6, top, 3);
    this.lifeRing(-31.8, -25.2, top, -Math.PI / 2);
    this.ropeCoil(-32.4, top, -36);

    // човни: декор, що похитується; колізія — через rocks
    this.mooredBoat(-37.2, -29.2, 0.05, 6.4, 0x2f6f9f, 0);
    this.mooredBoat(-37.0, -36.0, -0.04, 5.2, 0xb8432e, 1);
    this.rocks.push(
      { x: -33, z: -26, r: 1.6 },
      { x: -33, z: -31, r: 1.6 },
      { x: -33, z: -36, r: 1.6 },
      { x: -37.2, z: -29.2, r: 2.3 },
      { x: -37.0, z: -36.0, r: 2.0 },
    );
  }

  /** простий рибальський човен (стилізований): корпус-видавлення + рубка */
  private mooredBoat(x: number, z: number, ry: number, len: number, hullColor: number, variant: number) {
    const g = new THREE.Group();
    const half = len / 2;
    const bw = len * 0.19;
    const shape = new THREE.Shape();
    shape.moveTo(-bw * 0.85, -half);
    shape.lineTo(bw * 0.85, -half);
    shape.quadraticCurveTo(bw * 1.05, -half * 0.2, bw, half * 0.25);
    shape.quadraticCurveTo(bw * 0.8, half * 0.8, 0, half);
    shape.quadraticCurveTo(-bw * 0.8, half * 0.8, -bw, half * 0.25);
    shape.quadraticCurveTo(-bw * 1.05, -half * 0.2, -bw * 0.85, -half);
    const hullH = 1.15;
    const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: hullH, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2, curveSegments: 8 });
    hullGeo.rotateX(Math.PI / 2); // видавлення вниз
    hullGeo.translate(0, hullH, 0);
    const hullMat = new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.55 });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = -0.6;
    hull.castShadow = true;
    g.add(hull);
    // смуга по ватерлінії
    const stripe = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: 0x1f2326, roughness: 0.7 }));
    stripe.scale.set(1.01, 0.22, 1.01);
    stripe.position.y = -0.62;
    g.add(stripe);
    // планшир
    const rail = new THREE.Mesh(hullGeo, this.M.whitePaint);
    rail.scale.set(1.03, 0.08, 1.02);
    rail.position.y = 0.6;
    g.add(rail);
    // палуба
    const deckShape = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), this.M.deck);
    deckShape.rotation.x = -Math.PI / 2;
    deckShape.scale.set(0.92, 0.94, 1);
    deckShape.position.y = 0.42;
    deckShape.receiveShadow = true;
    g.add(deckShape);
    // рубка
    const cab = new THREE.Mesh(boxGeo(bw * 1.3, 1.25, 1.5), this.M.whitePaint);
    cab.position.set(0, 1.05, -half * 0.35);
    cab.castShadow = true;
    g.add(cab);
    const cabWin = new THREE.Mesh(boxGeo(bw * 1.32, 0.38, 1.3), this.M.glassDark);
    cabWin.position.set(0, 1.35, -half * 0.35);
    g.add(cabWin);
    const cabRoof = new THREE.Mesh(boxGeo(bw * 1.45, 0.08, 1.75), variant ? this.M.redPaint : this.M.bluePaint);
    cabRoof.position.set(0, 1.71, -half * 0.35);
    cabRoof.castShadow = true;
    g.add(cabRoof);
    // щогла + стріла
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.4, 6), this.M.whitePaint);
    mast.position.set(0, 2.1, half * 0.15);
    mast.castShadow = true;
    g.add(mast);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), this.M.whitePaint);
    boom.position.set(0, 1.4, half * 0.15 - 0.9);
    boom.rotation.x = Math.PI / 2 - 0.35;
    g.add(boom);
    // ящики/сітка на кормі
    const box1 = new THREE.Mesh(boxGeo(0.7, 0.3, 0.5), this.M.plasticBlue);
    box1.position.set(0.25, 0.58, -half * 0.75);
    g.add(box1);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), this.M.lampGlass);
    lamp.position.set(0, 3.85, half * 0.15);
    g.add(lamp);
    if (variant === 0) {
      const net = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), this.M.netGreen);
      net.scale.set(1, 0.4, 1.2);
      net.position.set(-0.2, 0.55, half * 0.55);
      g.add(net);
    }
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.group.add(g);
    this.bobbers.push({ obj: g, baseY: 0, phase: x * 0.37 + z, amp: 0.06, tilt: 0.025 });
  }

  /** магазин, заправка, майстерня, хата */
  private buildServiceBuildings() {
    const M = this.M;

    // ── магазин: біла штукатурка, сині віконниці, черепиця ──
    const shop = this.house({
      x: -10, z: -52, w: 9, d: 7, h: 4.8, rh: 2.4,
      wall: M.plasterWhite, wallTile: 3, roof: M.roofRed, door: 2.9, doorMat: M.bluePaint,
      front: [-3.2, 3.0], front1: [], back: [-2.6, 0, 2.6], sideWin: true, shutter: M.shutterBlue, chimney: [-3, -1.6], lit: 0.9,
    });
    {
      const at = (x: number, y: number, z: number, rx = 0) => shop.M.clone().multiply(T(x, y, z, 0, rx));
      // вітрина
      this.add(boxGeo(4.0, 2.2, 0.1), M.bluePaint, at(-1.6, 0.35 + 1.3, 3.5));
      this.add(new THREE.PlaneGeometry(3.7, 1.9), M.glassLit, at(-1.6, 0.35 + 1.3, 3.57), false);
      this.add(boxGeo(0.08, 1.9, 0.06), M.bluePaint, at(-1.6, 0.35 + 1.3, 3.6));
      // смугастий тент
      for (let i = 0; i < 9; i++) {
        this.add(boxGeo(0.5, 0.05, 1.5), i % 2 ? M.whitePaint : M.bluePaint, at(-3.6 + i * 0.5, 2.95, 4.2, 0.38));
        this.add(boxGeo(0.5, 0.28, 0.04), i % 2 ? M.whitePaint : M.bluePaint, at(-3.6 + i * 0.5, 2.55, 4.9));
      }
      // пояс між поверхами
      this.add(boxGeo(9.06, 0.18, 7.06), M.bluePaint, at(0, 3.2, 0));
      // ящики з товаром біля входу
      this.crate(-4.9, G, -47.6, 0.7, 0.2);
      this.barrel(-14.3, G, -47.9, 0.3);
      this.bench(-12.6, G, -48.0, 0);
      this.planter(-6.2, -48.0);
      this.planter(-13.7, -48.2);
    }
    this.sign('МАГАЗИН', -10.1, G + 3.95, -48.42, 3.0, '#1f4f7c');

    // ── заправка: червоний кіоск + навіс з колонками ──
    this.house({
      x: 6, z: -48, w: 5, d: 4, h: 3.3, rh: 0.9,
      wall: M.sidingRed, wallTile: 2, roof: M.metalGrey, trim: true, door: 1.3, doorMat: M.whitePaint,
      front: [-1.0], back: [0], shutter: null, lit: 1,
    });
    this.sign('ПАЛЬНЕ', 5.4, G + 3.15, -45.92, 2.2, '#8a2020');
    // навіс
    for (const [px, pz] of [[7.2, -42.6], [11.2, -42.6], [7.2, -45.4], [11.2, -45.4]]) {
      this.cy(M.whitePaint, 0.1, 0.1, 3.4, px, G + 1.7, pz, 8);
    }
    this.bx(M.whitePaint, 5.2, 0.35, 3.8, 9.2, G + 3.55, -44);
    this.bx(M.redPaint, 5.3, 0.22, 3.9, 9.2, G + 3.5, -44);
    this.add(boxGeo(4.6, 0.04, 3.2), M.canopyLight, T(9.2, G + 3.37, -44), false);
    this.glow(9.2, G + 3.1, -44, 5, 0xfff0d0);
    this.pool(9.2, G, -44, 4.5);
    // острівець і колонки
    this.bx(M.concrete, 3.6, 0.2, 1.3, 9.2, G + 0.1, -44);
    for (const px of [8.5, 10.0]) {
      this.bx(M.whitePaint, 0.7, 1.5, 0.5, px, G + 0.95, -44);
      this.bx(M.redPaint, 0.72, 0.3, 0.52, px, G + 1.6, -44);
      this.add(new THREE.PlaneGeometry(0.42, 0.26), M.glassDark, T(px, G + 1.2, -43.74), false);
      this.add(new THREE.TorusGeometry(0.28, 0.025, 4, 10, Math.PI), M.rubber, T(px + 0.36, G + 0.9, -44, Math.PI / 2, 0, -Math.PI / 2));
    }
    // цистерна за кіоском
    this.add(cylGeo(0.85, 0.85, 3.4, 14), M.whitePaint, T(6, G + 1.3, -51.4, 0, 0, Math.PI / 2));
    for (const sx of [-1, 1]) this.bx(M.concrete, 0.3, 0.6, 1.2, 6 + sx * 1.1, G + 0.3, -51.4);

    // ── майстерня: профнастил, великі ворота ──
    this.house({
      x: 14, z: -54, w: 6.5, d: 6, h: 3.9, rh: 1.6,
      wall: M.metalGrey, wallTile: 1, roof: M.metalRust, door: null, back: [0], sideWin: true, lit: 0.5,
    });
    this.bx(M.trim, 3.6, 3.3, 0.08, 14, G + 0.35 + 1.6, -50.96);
    this.bx(M.iron, 3.2, 3.0, 0.1, 14, G + 0.35 + 1.5, -50.92, 0, 1, 1);
    for (let i = 0; i < 10; i++) this.bx(M.metalGrey, 3.15, 0.04, 0.03, 14, G + 0.55 + i * 0.3, -50.86, 0, 1, 1);
    this.sign('РЕМОНТ', 14, G + 0.35 + 3.45, -50.88, 3.6, '#3a4048');
    {
      const lp = new THREE.Vector3(16.6, G + 3.4, -50.6);
      this.bx(M.iron, 0.5, 0.08, 0.4, lp.x, lp.y + 0.08, lp.z);
      this.bx(M.lampGlass, 0.36, 0.08, 0.26, lp.x, lp.y, lp.z, 0, 1, 1, false);
      this.glow(lp.x, lp.y - 0.1, lp.z + 0.1, 2.4);
      this.pool(15.6, G, -49.2, 3);
    }
    // реквізит майстерні
    this.barrel(18.0, G, -51.6, 0);
    this.barrel(18.7, G, -52.2, 1);
    this.tyreStack(10.4, -50.6);
    this.anchor(18.6, -54.5);
    this.upturnedHull(21.5, -56.5, 0.25);
    this.bx(M.woodDark, 2.2, 0.08, 0.8, 17.9, G + 0.9, -56.5); // верстак
    for (const sx of [-1, 1]) this.bx(M.woodDark, 0.08, 0.9, 0.7, 17.9 + sx * 1.0, G + 0.45, -56.5);

    // ── хата: кремова, сині віконниці, садочок ──
    const hut = this.house({
      x: -2, z: -62, w: 5.6, d: 5, h: 3.1, rh: 2.2,
      wall: M.plasterCream, wallTile: 3, roof: M.roofRed, door: 0, doorMat: M.shutterGreen,
      front: [-1.75, 1.75], back: [0], sideWin: true, shutter: M.shutterBlue, chimney: [1.6, -1.0], lit: 1,
    });
    if (hut.chimney) this.smokeOrigin.copy(hut.chimney);
    this.sign('ХАТА', -2, G + 0.35 + 2.75, -59.32, 1.6, '#3f5e3a');
    // паркан-штахетник із хвірткою
    this.picketFence(-5.8, -56.6, -2.9, -56.6);
    this.picketFence(-1.1, -56.6, 1.8, -56.6);
    this.picketFence(-5.8, -56.6, -5.8, -59.4);
    this.picketFence(1.8, -56.6, 1.8, -59.4);
    // клумби
    this.flowerBed(-4.4, -57.2, 2.0);
    this.flowerBed(0.6, -57.2, 1.6);
    this.bench(-4.3, G, -58.95, 0);
    this.tree(-7.5, -63.5, 1.1, true);
  }

  private planter(x: number, z: number) {
    const M = this.M;
    this.bx(M.woodDark, 0.9, 0.45, 0.45, x, G + 0.23, z);
    const f = new THREE.IcosahedronGeometry(0.22, 0);
    for (let i = 0; i < 5; i++) {
      this.add(f, M.leaf, T(x - 0.32 + i * 0.16, G + 0.55, z + (i % 2 ? 0.06 : -0.06)));
      this.add(new THREE.SphereGeometry(0.06, 5, 3), i % 2 ? M.flowerA : M.flowerB, T(x - 0.32 + i * 0.16, G + 0.72, z));
    }
  }

  private flowerBed(x: number, z: number, w: number) {
    const M = this.M;
    const rng = this.rng;
    const g = new THREE.SphereGeometry(0.07, 5, 3);
    const lg = new THREE.IcosahedronGeometry(0.16, 0);
    for (let i = 0; i < w * 7; i++) {
      const fx = x - w / 2 + rng() * w;
      const fz = z + (rng() - 0.5) * 0.7;
      this.add(lg, M.leaf, T(fx, G + 0.12, fz, rng() * 3), false);
      const mats = [M.flowerA, M.flowerB, M.flowerC];
      this.add(g, mats[Math.floor(rng() * 3)], T(fx, G + 0.28, fz), false);
    }
  }

  private picketFence(x0: number, z0: number, x1: number, z1: number) {
    const M = this.M;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.3) return;
    const ry = Math.atan2(x1 - x0, z1 - z0);
    const n = Math.floor(len / 0.18);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.add(boxGeo(0.07, 0.85, 0.035), M.whitePaint, T(x0 + (x1 - x0) * t, G + 0.42, z0 + (z1 - z0) * t, ry));
    }
    for (const y of [0.25, 0.65]) this.add(boxGeo(0.04, 0.06, len), M.whitePaint, T((x0 + x1) / 2, G + y, (z0 + z1) / 2, ry));
  }

  private tyreStack(x: number, z: number) {
    const t = new THREE.TorusGeometry(0.34, 0.14, 6, 12);
    for (let i = 0; i < 3; i++) this.add(t, this.M.rubber, T(x + (i % 2) * 0.05, G + 0.14 + i * 0.27, z, 0, Math.PI / 2));
  }

  private anchor(x: number, z: number) {
    const M = this.M;
    this.bx(M.iron, 0.12, 1.4, 0.12, x, G + 0.85, z, 0.3);
    this.add(new THREE.TorusGeometry(0.55, 0.06, 4, 10, Math.PI), M.iron, T(x, G + 0.65, z, 0.3, 0, Math.PI));
    this.add(new THREE.TorusGeometry(0.14, 0.04, 4, 8), M.iron, T(x, G + 1.6, z, 0.3));
    this.bx(M.iron, 0.7, 0.08, 0.08, x, G + 1.3, z, 0.3);
  }

  /** перевернутий човен на козлах біля майстерні */
  private upturnedHull(x: number, z: number, ry: number) {
    const M = this.M;
    const g = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.add(g, M.whitePaint, T(x, G + 0.85, z, ry, 0, 0, 0.95, 0.6, 2.7));
    this.add(g, M.bluePaint, T(x, G + 0.83, z, ry, 0, 0, 0.97, 0.12, 2.72));
    for (const dz of [-1.5, 1.5]) {
      const ox = Math.sin(ry) * dz;
      const oz = Math.cos(ry) * dz;
      this.bx(M.woodDark, 1.6, 0.12, 0.12, x + ox, G + 0.78, z + oz, ry);
      for (const s of [-0.65, 0.65]) this.bx(M.woodDark, 0.1, 0.8, 0.1, x + ox + Math.cos(ry) * s, G + 0.4, z + oz - Math.sin(ry) * s, ry);
    }
  }

  /** окреме дерево (листяне або ялина) — додається в загальну інстанс-систему */
  private extraTrees: TreeSpot[] = [];
  private tree(x: number, z: number, s: number, leafy: boolean) {
    this.extraTrees.push({ x, z, s, leafy });
  }

  /** маяк біля набережної: смугаста вежа, галерея, лінза, будиночок доглядача */
  private buildLighthouse() {
    const M = this.M;
    const X = -32, Z = -52;
    const lh = new THREE.Group();
    lh.position.set(X, G, Z);
    this.group.add(lh);
    const at = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) => T(X + x, G + y, Z + z, ry, rx, rz, sx, sy, sz);

    // восьмикутний цоколь
    this.add(cylGeo(3.0, 3.3, 1.2, 8, 2), M.stone, at(0, 0.5, 0));
    this.add(cylGeo(2.7, 3.05, 0.15, 8, 2), M.coping, at(0, 1.17, 0));
    // смугаста вежа
    const H = 13.5;
    const seg = 6;
    const r0 = 2.2, r1 = 1.45;
    for (let i = 0; i < seg; i++) {
      const y0 = 1.2 + (i * H) / seg;
      const ra = r0 + ((r1 - r0) * i) / seg;
      const rb = r0 + ((r1 - r0) * (i + 1)) / seg;
      this.add(cylGeo(rb, ra, H / seg, 20, 2), i % 2 ? M.redPaint : M.whitePaint, at(0, y0 + H / seg / 2, 0));
    }
    // двері та віконця
    this.add(boxGeo(1.0, 2.0, 0.3), M.doorWood, at(0, 2.2, 2.08));
    this.add(boxGeo(1.25, 0.2, 0.45), M.coping, at(0, 3.3, 2.08));
    for (let i = 0; i < 3; i++) {
      const a = 0.6 + i * 2.2;
      const y = 5.5 + i * 3.1;
      const r = r0 + ((r1 - r0) * (y - 1.2)) / H;
      this.add(new THREE.PlaneGeometry(0.42, 0.75), M.glassLit, at(Math.sin(a) * (r + 0.02), y, Math.cos(a) * (r + 0.02), a), false);
      this.add(boxGeo(0.56, 0.9, 0.06), M.whitePaint, at(Math.sin(a) * r, y, Math.cos(a) * r, a));
    }
    // галерея з поруччям
    const gy = 1.2 + H;
    this.add(cylGeo(2.35, 1.6, 0.6, 20, 2), M.whitePaint, at(0, gy + 0.05, 0));
    this.add(cylGeo(2.4, 2.4, 0.14, 20, 2), M.iron, at(0, gy + 0.4, 0));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.add(boxGeo(0.05, 0.9, 0.05), M.iron, at(Math.cos(a) * 2.3, gy + 0.9, Math.sin(a) * 2.3));
    }
    this.add(new THREE.TorusGeometry(2.3, 0.04, 4, 32), M.iron, at(0, gy + 1.35, 0, 0, Math.PI / 2));
    this.add(new THREE.TorusGeometry(2.3, 0.025, 4, 32), M.iron, at(0, gy + 0.9, 0, 0, Math.PI / 2));
    // ліхтарня: скло, каркас, купол
    this.add(cylGeo(1.15, 1.15, 0.5, 12), M.redPaint, at(0, gy + 0.72, 0));
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.7, 12, 1, true), M.lensGlass);
    lens.position.y = gy + 1.82;
    lh.add(lens);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), M.lampGlass);
    bulb.position.y = gy + 1.8;
    lh.add(bulb);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.add(boxGeo(0.07, 1.75, 0.07), M.iron, at(Math.cos(a) * 1.07, gy + 1.82, Math.sin(a) * 1.07));
    }
    const dome = new THREE.SphereGeometry(1.3, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    this.add(dome, M.redPaint, at(0, gy + 2.68, 0, 0, 0, 0, 1, 0.75, 1));
    this.add(new THREE.SphereGeometry(0.22, 8, 6), M.iron, at(0, gy + 3.75, 0));
    this.add(cylGeo(0.025, 0.025, 1.1, 4), M.iron, at(0, gy + 4.3, 0));

    // прожектор (обертається в update)
    const beamY = gy + 1.8;
    this.lighthouseLight = new THREE.SpotLight(0xffe9a0, 0, 260, 0.26, 0.45, 1.1);
    this.lighthouseLight.position.y = beamY;
    lh.add(this.lighthouseLight);
    const beaconTgt = new THREE.Object3D();
    beaconTgt.position.set(0, 0, 60);
    lh.add(beaconTgt);
    this.lighthouseLight.target = beaconTgt;
    // видимий промінь — два протилежні конуси (як у справжній лінзи)
    this.beamPivot = new THREE.Object3D();
    this.beamPivot.position.y = beamY;
    lh.add(this.beamPivot);
    this.beamMat = new THREE.MeshBasicMaterial({
      map: beamTex(), color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beamLen = 70;
    const beamGeo = new THREE.CylinderGeometry(0.5, 7, beamLen, 16, 1, true);
    beamGeo.translate(0, -beamLen / 2, 0); // вершина в 0, розширення вздовж −Y
    beamGeo.rotateX(-Math.PI / 2 + 0.05); // промінь уздовж +Z, трохи донизу
    for (const ry of [0, Math.PI]) {
      const b = new THREE.Mesh(beamGeo, this.beamMat);
      b.rotation.y = ry;
      b.renderOrder = 5;
      this.beamPivot.add(b);
    }

    // будиночок доглядача
    this.house({
      x: -37.6, z: -51.2, w: 4.6, d: 4.2, h: 2.8, rh: 1.7,
      wall: M.plasterWhite, wallTile: 3, roof: M.roofRed, door: 0.8, doorMat: M.redPaint,
      front: [-1.1], back: [0], shutter: M.shutterRed, chimney: [-1.2, -0.8], lit: 1,
    });
  }

  /** містечко: сараї для сіток, рибний ринок, контора, ряди будинків, капличка, хутори на пагорбах */
  private buildVillage() {
    const M = this.M;
    const rng = this.rng;

    // сараї для сіток (червона вагонка) — ворота до моря
    for (const [x, w] of [[-46, 6.4], [-54.2, 5.4]] as Array<[number, number]>) {
      this.house({
        x, z: -50.5, w, d: 5.2, h: 3.0, rh: 1.9, wall: M.sidingRed, wallTile: 2, roof: M.roofDark,
        trim: true, door: null, back: [], sideWin: false, lit: 0,
      });
      this.bx(M.trim, 2.7, 2.5, 0.08, x, G + 0.35 + 1.25, -47.86);
      this.bx(M.woodDark, 2.4, 2.3, 0.1, x, G + 0.35 + 1.15, -47.82, 0, 1, 2);
      this.bx(M.trim, 0.1, 2.3, 0.12, x, G + 0.35 + 1.15, -47.78);
      this.add(new THREE.PlaneGeometry(0.7, 0.5), M.glassDark, T(x, G + 0.35 + 3.7, -47.88), false);
    }
    this.netPile(-50.2, G, -46.5, 0.4);
    this.crateStack(-41.5, -47, G, -0.3);
    this.barrel(-57.8, G, -46.8, 0);
    // сітки сохнуть на рамі
    for (const x of [-58, -55.5, -53]) this.bx(M.woodDark, 0.12, 2.2, 0.12, x, G + 1.1, -44.4);
    this.bx(M.woodDark, 5.3, 0.1, 0.1, -55.5, G + 2.15, -44.4);
    {
      const g = new THREE.PlaneGeometry(4.8, 1.7, 8, 3);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 1.3) * 0.12);
      const netMat = new THREE.MeshStandardMaterial({ color: 0x3e6a5c, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
      this.add(g, netMat, T(-55.5, G + 1.25, -44.4), false);
    }

    // рибний ринок — відкритий навіс на стовпах
    {
      const X = 34, Z = -48.5;
      for (const sx of [-3.6, 0, 3.6]) for (const sz of [-2.1, 2.1]) this.cy(M.woodDark, 0.12, 0.14, 3.3, X + sx, G + 1.65, Z + sz, 8);
      const a = Math.atan2(1.4, 2.5);
      const L = Math.hypot(2.5, 1.4) + 0.5;
      const slab = roofSlabGeo(L, 0.14, 8.6, 2).rotateY(-Math.PI / 2);
      for (const s of [1, -1]) {
        this.add(slab, M.roofRed, T(X, G + 3.3 + 1.4 - Math.sin(a) * L / 2 + 0.1, Z + s * Math.cos(a) * L / 2, 0, s * a));
      }
      this.bx(M.roofRed, 8.6, 0.16, 0.3, X, G + 4.78, Z);
      this.bx(M.woodDark, 7.6, 0.2, 0.2, X, G + 3.3, Z + 2.1);
      this.bx(M.woodDark, 7.6, 0.2, 0.2, X, G + 3.3, Z - 2.1);
      for (const sx of [-2.2, 0.6, 3.0]) {
        this.bx(M.woodGrey, 2.0, 0.08, 1.0, X + sx - 0.5, G + 0.9, Z + 0.6, 0, 1, 2);
        for (const dx of [-0.85, 0.85]) this.bx(M.woodDark, 0.08, 0.9, 0.9, X + sx - 0.5 + dx, G + 0.45, Z + 0.6);
        this.fishBoxes(X + sx - 0.9, G + 0.94, Z + 0.6, 0);
      }
      this.sign('РИБА', X, G + 3.0, Z + 2.25, 2.0, '#2a5a6e');
      const lp = new THREE.Vector3(X, G + 3.1, Z);
      this.bx(M.lampGlass, 0.3, 0.3, 0.3, lp.x, lp.y, lp.z, 0, 1, 1, false);
      this.glow(lp.x, lp.y, lp.z, 2.4);
      this.pool(X, G, Z, 4);
    }

    // контора порту з прапором
    this.house({
      x: 47, z: -52, w: 7, d: 6, h: 5.2, rh: 2.2, wall: M.sidingBlue, wallTile: 2, roof: M.roofDark,
      trim: true, door: 0, doorMat: M.whitePaint, front: [-2.2, 0, 2.2], back: [-2, 2], sideWin: true, chimney: [2.2, -1.4],
    });
    this.sign('ПОРТ', 47, G + 0.35 + 3.0, -48.92, 2.0, '#1f3f5c');
    this.flagpole(24.5, -45.3);

    // ліхтарі набережної і вулиць
    for (const x of [-52, -40, -27.5, 27.5, 40, 54]) this.lamp(x, -41.2, G);
    const promLamp = this.lamp(-18.5, -46.9, G);
    this.realLight(promLamp);
    this.lamp(0.6, -46.9, G);
    this.lamp(16.8, -46.9, G);
    for (const x of [-46, -22, 2, 26, 50]) this.lamp(x, -72.9, G);

    // ряд будинків за вулицею (фасадом до вулиці, z≈-72)
    const walls = [M.sidingYellow, M.sidingRed, M.sidingBlue, M.sidingGreen, M.sidingWhite, M.plasterOchre, M.plasterPink, M.plasterBlue, M.plasterWhite];
    const roofs = [M.roofRed, M.roofDark, M.roofBrown];
    const shutters = [M.shutterBlue, M.shutterGreen, M.shutterRed, null];
    const pick = <V>(arr: V[]) => arr[Math.floor(rng() * arr.length)];
    const row1 = [-52, -40.5, -29, -17.5, -5, 7.5, 19.5, 31.5, 43, 53.5];
    for (const x of row1) {
      const w = 6 + rng() * 2.6;
      const d = 5 + rng() * 1.2;
      const two = rng() < 0.45;
      const h = two ? 5.0 : 3.2 + rng() * 0.4;
      const wall = pick(walls);
      const isSiding = wall.map === M.sidingRed.map;
      this.house({
        x, z: -74.5 - d / 2, w: Math.min(w, 10.6), d, h, rh: 1.7 + rng() * 1.0, ry: (rng() - 0.5) * 0.06,
        wall, wallTile: isSiding ? 2 : 3, roof: pick(roofs), trim: isSiding,
        door: (rng() - 0.5) * 2, doorMat: pick([M.doorWood, M.shutterGreen, M.bluePaint, M.redPaint]),
        front: [-w / 2 + 1.3, w / 2 - 1.3], back: [0], sideWin: rng() < 0.6,
        shutter: isSiding ? null : pick(shutters), chimney: rng() < 0.7 ? [(rng() - 0.5) * w * 0.6, -d * 0.2] : null,
      });
      if (rng() < 0.6) this.tree(x + (rng() < 0.5 ? -1 : 1) * (w / 2 + 1.6), -76 - rng() * 4, 0.8 + rng() * 0.4, true);
    }
    // другий ряд, вільніше
    const row2: Array<[number, number]> = [[-50, -98], [-36, -104], [-22, -96], [-6, -108], [4, -95], [44, -100], [52, -116], [-48, -118], [-24, -120], [0, -122]];
    for (const [x, z] of row2) {
      const w = 5.6 + rng() * 2.2;
      const d = 4.8 + rng() * 1.2;
      const wall = pick(walls);
      const isSiding = wall.map === M.sidingRed.map;
      this.house({
        x, z, w, d, h: rng() < 0.3 ? 4.8 : 3.1 + rng() * 0.5, rh: 1.8 + rng() * 0.9, ry: (rng() - 0.5) * 0.5,
        wall, wallTile: isSiding ? 2 : 3, roof: pick(roofs), trim: isSiding,
        door: 0, doorMat: pick([M.doorWood, M.shutterGreen, M.bluePaint]), front: [-w / 2 + 1.2, w / 2 - 1.2], back: [0],
        shutter: isSiding ? null : pick(shutters), chimney: rng() < 0.6 ? [w * 0.25, -d * 0.2] : null, lit: 0.5,
      });
      this.tree(x + w / 2 + 2.5, z - 2 + rng() * 4, 0.8 + rng() * 0.5, rng() < 0.7);
    }
    // дерева в містечку
    for (const [x, z] of [[-26, -60], [24, -61], [-45, -62], [40, -62], [-56, -64], [56, -64], [12, -112], [-14, -88], [30, -90], [-38, -88], [57, -88]]) {
      this.tree(x, z, 0.9 + rng() * 0.35, true);
    }

    // капличка з дзвіницею (гребінь уздовж X, дзвіниця — на східному фронтоні)
    {
      const X = 19.7, Z = -112;
      this.house({
        x: X, z: Z, w: 9, d: 6, h: 4.2, rh: 3.0, wall: M.plasterWhite, wallTile: 3, roof: M.roofDark,
        door: null, front: [], back: [], sideWin: false, lit: 0.8,
      });
      const tx = X + 4.5 + 1.4;
      this.bx(M.plasterWhite, 2.8, 9.5, 2.8, tx, G + 4.75, Z, 0, 3, 3);
      this.bx(M.coping, 3.0, 0.2, 3.0, tx, G + 9.6, Z);
      this.bx(M.iron, 1.0, 1.5, 2.86, tx, G + 8.2, Z);
      this.bx(M.iron, 2.86, 1.5, 1.0, tx, G + 8.2, Z);
      this.add(new THREE.ConeGeometry(2.1, 5, 4), M.roofDark, T(tx, G + 12.2, Z, Math.PI / 4));
      this.bx(M.yellowPaint, 0.1, 1.2, 0.1, tx, G + 15.2, Z);
      this.bx(M.yellowPaint, 0.6, 0.1, 0.1, tx, G + 15.4, Z);
      this.add(boxGeo(1.2, 2.3, 0.1), M.doorWood, T(tx, G + 1.5, Z + 1.42));
      this.bx(M.stone, 1.8, 0.3, 0.8, tx, G + 0.15, Z + 1.8);
      this.add(new THREE.CircleGeometry(0.45, 12), M.glassLit, T(tx, G + 6.4, Z + 1.42), false);
      for (const sx of [-2.6, 0, 2.6]) {
        for (const sz of [-1, 1]) {
          this.add(new THREE.PlaneGeometry(0.6, 1.5), M.glassLit, T(X + sx, G + 2.6, Z + sz * 3.03, sz > 0 ? 0 : Math.PI), false);
        }
      }
    }

    // хутори на пагорбах
    let placed = 0;
    let tries = 0;
    const hill: Array<[number, number]> = [];
    while (placed < 16 && tries < 600) {
      tries++;
      const side = rng();
      const x = side < 0.35 ? -70 - rng() * 110 : side < 0.7 ? 70 + rng() * 110 : (rng() - 0.5) * 140;
      const z = side < 0.7 ? -55 - rng() * 120 : -138 - rng() * 60;
      const w = 5 + rng() * 2;
      const d = 4.5 + rng();
      const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([cx, cz]) => terrainHeight(x + cx, z + cz));
      const hMin = Math.min(...corners);
      const hMax = Math.max(...corners);
      if (hMin < 2.6 || hMax - hMin > 2.2) continue;
      if (hill.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < 14)) continue;
      hill.push([x, z]);
      placed++;
      const wall = pick(walls);
      const isSiding = wall.map === M.sidingRed.map;
      // фасадом — до моря (+Z) з легким розворотом
      this.house({
        x, z, y0: hMax, sink: hMax - hMin + 0.3, ry: (rng() - 0.5) * 0.7, w, d, h: 3.1 + rng() * 0.4, rh: 1.8 + rng() * 0.8,
        wall, wallTile: isSiding ? 2 : 3, roof: pick(roofs), trim: isSiding,
        door: (rng() - 0.5) * 1.5, front: [-w / 2 + 1.2, w / 2 - 1.2], back: [0], sideWin: rng() < 0.5,
        shutter: isSiding ? null : pick(shutters), chimney: [w * 0.25, -d * 0.2], lit: 0.55, doorLamp: rng() < 0.5,
      });
    }

    // човник-дінгі на пляжі
    this.beachDinghy(76, -54, 0.6);
    this.beachDinghy(-82, -57, -0.4);

    buildTrees(this.group, rng, this.extraTrees, (x, z) => hill.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < 8));
  }

  private beachDinghy(x: number, z: number, ry: number) {
    const M = this.M;
    const y = Math.max(terrainHeight(x, z), 0.2);
    const g = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    this.add(g, M.whitePaint, T(x, y + 0.45, z, ry, 0.06, 0.12, 0.75, 0.5, 1.9));
    this.add(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), M.woodGrey, T(x, y + 0.42, z, ry, 0.06, 0.12, 0.7, 1, 1.82));
    this.add(boxGeo(1.3, 0.06, 0.3), M.woodDark, T(x, y + 0.5, z, ry, 0.06, 0.12));
  }

  private flagpole(x: number, z: number) {
    const M = this.M;
    this.cy(M.concrete, 0.4, 0.45, 0.3, x, G + 0.15, z, 10);
    this.cy(M.whitePaint, 0.05, 0.08, 9, x, G + 4.6, z, 8);
    this.add(new THREE.SphereGeometry(0.1, 8, 6), M.yellowPaint, T(x, G + 9.15, z));
    // прапор: синьо-жовтий, хвилюється
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g2 = c.getContext('2d')!;
    g2.fillStyle = '#1f5bb5';
    g2.fillRect(0, 0, 64, 32);
    g2.fillStyle = '#f5cc2a';
    g2.fillRect(0, 32, 64, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(2.4, 1.6, 12, 2);
    geo.translate(1.2, 0, 0);
    const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(x + 0.06, G + 8.2, z);
    flag.rotation.y = -0.6;
    flag.castShadow = true;
    this.group.add(flag);
    this.flag = { geo, base: Float32Array.from(geo.attributes.position.array as Float32Array) };
  }

  /** буї: вхідна пара (червоний / зелений), швартовні, поплавки пасток */
  private buildBuoys() {
    const M = this.M;
    const mk = (x: number, z: number, kind: 'red' | 'green' | 'yellow' | 'float') => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, s = 1) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.y = y;
        m.scale.setScalar(s);
        m.castShadow = true;
        g.add(m);
        return m;
      };
      if (kind === 'float') {
        add(new THREE.SphereGeometry(0.22, 8, 6), M.plasticRed, 0.05);
        add(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 4), M.iron, 0.55);
        const fl = add(new THREE.PlaneGeometry(0.3, 0.2), M.yellowPaint, 0.95);
        fl.position.x = 0.15;
        (fl.material as THREE.Material).side = THREE.DoubleSide;
        this.bobbers.push({ obj: g, baseY: 0, phase: x + z, amp: 0.12, tilt: 0.15 });
      } else if (kind === 'yellow') {
        add(new THREE.SphereGeometry(0.55, 12, 8), M.yellowPaint, 0.1);
        add(new THREE.TorusGeometry(0.12, 0.03, 4, 8), M.iron, 0.72);
        this.bobbers.push({ obj: g, baseY: 0, phase: x * 0.3 + z, amp: 0.12, tilt: 0.08 });
      } else {
        const paint = kind === 'red' ? M.redPaint : M.greenPaint;
        add(new THREE.CylinderGeometry(0.75, 0.85, 0.6, 12), paint, 0.05);
        add(new THREE.CylinderGeometry(0.06, 0.08, 1.8, 6), M.iron, 1.2);
        if (kind === 'red') add(new THREE.CylinderGeometry(0.35, 0.35, 0.6, 10), paint, 1.6);
        else add(new THREE.ConeGeometry(0.4, 0.7, 10), paint, 1.6);
        const lm = new THREE.MeshStandardMaterial({
          color: kind === 'red' ? 0xff6050 : 0x60ff90, emissive: kind === 'red' ? 0xff3020 : 0x20ff60, emissiveIntensity: 0,
        });
        add(new THREE.SphereGeometry(0.11, 8, 6), lm, 2.1);
        add(new THREE.CylinderGeometry(0.8, 0.8, 0.12, 12), M.whitePaint, 0.37);
        this.buoyLights.push({ mat: lm, period: kind === 'red' ? 4 : 3, offset: x * 0.1 });
        this.bobbers.push({ obj: g, baseY: -0.05, phase: x * 0.2 + z * 0.1, amp: 0.16, tilt: 0.1 });
      }
      this.group.add(g);
    };
    // вхід у гавань: зелений — праворуч з моря, червоний — ліворуч (система IALA A)
    mk(-17, 26, 'green');
    mk(17, 26, 'red');
    mk(-30, 52, 'green');
    mk(30, 52, 'red');
    mk(-46, -8, 'yellow');
    mk(40, -12, 'yellow');
    for (const [x, z] of [[-60, 10], [-66, 14], [58, 18], [64, 8], [72, -20], [-74, -18]]) mk(x, z, 'float');
  }

  private buildSeaRocksAndIslands() {
    const rng = mulberry32(4242);
    const rockSpots: Array<[number, number, number]> = [
      [140, 180, 3.2], [-170, 240, 4.0], [260, -80, 2.6], [-90, 420, 3.4],
      [380, 300, 4.5], [-320, 150, 2.8], [120, 620, 3.8], [-420, 480, 4.2],
      [520, 150, 3.0], [300, 560, 3.6],
    ];
    addSeaRocks(this.batch, this.M.rock, rockSpots, rng);
    for (const [rx, rz, r] of rockSpots) this.rocks.push({ x: rx, z: rz, r: r * 1.15 });

    const islands: Array<[number, number, number, number]> = [
      [1400, 900, 160, 60],
      [-1600, 500, 220, 80],
      [600, -1800, 180, 70],
      [-900, -1500, 140, 50],
    ];
    addIslands(this.batch, this.M.island, islands, rng);
  }

  /** дерев'яна вивіска з рамкою */
  private sign(text: string, x: number, y: number, z: number, w: number, bg = '#2a3440') {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#5a4128';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = bg;
    g.fillRect(10, 10, 492, 108);
    g.strokeStyle = 'rgba(255,240,210,0.85)';
    g.lineWidth = 4;
    g.strokeRect(20, 20, 472, 88);
    g.fillStyle = '#f6ecd2';
    g.font = 'bold 64px Georgia, "Times New Roman", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.8 });
    this.signMats.push(mat);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.25, 0.06), [
      this.M.woodDark, this.M.woodDark, this.M.woodDark, this.M.woodDark, mat, this.M.woodDark,
    ]);
    m.position.set(x, y, z);
    m.castShadow = true;
    this.group.add(m);
  }

  // ───────────────────────── нічні вогні / анімація ─────────────────────────

  /** нічні вогні: 0 — день, 1 — ніч */
  setNight(night: number) {
    this.night = night;
    for (const pl of this.lampLights) pl.intensity = night * 6;
    this.lighthouseLight.intensity = night * 40;
    const M = this.M;
    M.glassLit.emissiveIntensity = night * 1.5;
    M.lampGlass.emissiveIntensity = 0.05 + night * 3.2;
    M.lensGlass.emissiveIntensity = 0.3 + night * 3;
    M.canopyLight.emissiveIntensity = night * 1.6;
    for (const m of this.glowMats) m.opacity = night * 0.85;
    this.poolMat.opacity = night * 0.45;
    for (const m of this.signMats) m.emissiveIntensity = night * 0.22;
    this.beamMat.opacity = night * 0.32;
  }

  update(dt: number, t: number) {
    // прожектор маяка обертається
    this.beaconPhase += dt * 0.7;
    this.lighthouseLight.target.position.set(Math.cos(this.beaconPhase) * 60, 0, Math.sin(this.beaconPhase) * 60);
    // промінь дивиться туди ж, куди й прожектор (локальний +Z → (cos, sin))
    this.beamPivot.rotation.y = Math.atan2(Math.cos(this.beaconPhase), Math.sin(this.beaconPhase));
    this.beamPivot.visible = this.night > 0.02;

    // буї та човни погойдуються
    for (const b of this.bobbers) {
      const p = t * 1.25 + b.phase;
      b.obj.position.y = b.baseY + Math.sin(p) * b.amp;
      b.obj.rotation.x = Math.sin(p * 0.83 + 1.1) * b.tilt;
      b.obj.rotation.z = Math.sin(p * 0.67 + 2.3) * b.tilt;
    }
    // проблискові вогні буїв
    for (const l of this.buoyLights) {
      const ph = ((t + l.offset) % l.period) / l.period;
      l.mat.emissiveIntensity = ph < 0.12 ? 0.4 + this.night * 3 : 0;
    }

    // прапор
    if (this.flag) {
      const pos = this.flag.geo.attributes.position as THREE.BufferAttribute;
      const b = this.flag.base;
      for (let i = 0; i < pos.count; i++) {
        const x = b[i * 3];
        const k = x / 2.4;
        pos.setZ(i, Math.sin(x * 2.2 - t * 6.5) * 0.18 * k + Math.sin(x * 4.1 - t * 9) * 0.05 * k);
        pos.setY(i, b[i * 3 + 1] - k * k * 0.12);
      }
      pos.needsUpdate = true;
      this.flag.geo.computeVertexNormals();
    }

    // дим із комина хати
    if (!this.smoke.length && this.smokeOrigin.lengthSq() > 0) this.initSmoke();
    for (const s of this.smoke) {
      const a = (t * 0.12 + s.k) % 1;
      s.s.position.set(this.smokeOrigin.x + a * 2.2 + Math.sin(a * 6 + s.k * 9) * 0.25, this.smokeOrigin.y + a * 5.5, this.smokeOrigin.z - a * 0.8);
      s.s.scale.setScalar(0.5 + a * 2.6);
      s.mat.opacity = Math.sin(a * Math.PI) * (0.28 - this.night * 0.12);
    }
  }

  private initSmoke() {
    for (let i = 0; i < 7; i++) {
      const mat = new THREE.SpriteMaterial({ map: glowTex(), color: 0xd8d8d4, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(mat);
      this.group.add(s);
      this.smoke.push({ s, mat, k: i / 7 });
    }
  }
}
