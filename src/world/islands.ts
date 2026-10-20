import * as THREE from 'three';
import { fbm, noise2, smoothstep } from './portKit';
import { rockGeo } from './portTerrain';
import { groundDetailTex } from './textures';
import { makeGullTexture } from './sky';
import { mulberry32 } from '../core/math';
import { buildHatModel } from './character';
import { HAT_BY_ID } from '../game/hats';
import { terrainHeight } from './portTerrain';
import { ISLANDS, ISLAND_SOLIDS, islandHeight, islandHeightOf, type IslandDef } from './islandShape';
import type { Boat } from './boat';
import type { GameState } from '../game/state';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Острови в морі: рельєф (пляж, пагорб), реквізит за характером острова
// (сосни й руїни хатини, пальми, піратський прапор, мушлі), знахідки —
// капелюхи, пляшки із записками, скриня. Яхта сідає на мілину біля берега;
// гравець сходить на берег (E біля борту) і ходить пішки (режим «port»).
// ─────────────────────────────────────────────────────────────

export interface FindDef {
  id: string;
  island: string;
  /** зсув від центру острова, м (світові осі) */
  dx: number;
  dz: number;
  kind: 'hat' | 'bottle' | 'chest';
  hat?: string;
  money?: number;
  note?: string;
}

export const FINDS: FindDef[] = [
  { id: 'hat:ushanka', island: 'isl-gull', dx: 4, dz: -3, kind: 'hat', hat: 'ushanka' },
  { id: 'hat:sou', island: 'isl-pine', dx: -9, dz: 6, kind: 'hat', hat: 'sou' },
  { id: 'hat:straw', island: 'isl-palm', dx: 14, dz: 2, kind: 'hat', hat: 'straw' },
  { id: 'hat:tricorn', island: 'isl-pirate', dx: -6, dz: 10, kind: 'hat', hat: 'tricorn' },
  { id: 'hat:crown', island: 'isl-shell', dx: 3, dz: 5, kind: 'hat', hat: 'crown' },
  { id: 'bottle:palm', island: 'isl-palm', dx: -16, dz: -6, kind: 'bottle', money: 250, note: L('«Хто знайде — пригостіть кока рибною юшкою. Я так і не повернувся по свою капелюшину…»', `“Whoever finds this — treat the cook to a bowl of fish soup. I never made it back for my hat…”`) },
  { id: 'bottle:shell', island: 'isl-shell', dx: -12, dz: -4, kind: 'bottle', money: 300, note: L('«Мапа брехала: скриня не під пальмою, а на Піратській бухті, біля прапора»', `“The map lied: the chest isn't under the palm, it's at Pirate Cove, by the flag”`) },
  { id: 'chest:pirate', island: 'isl-pirate', dx: 9, dz: -5, kind: 'chest', money: 900 },
];

const ISLAND_BY_ID: Record<string, IslandDef> = Object.fromEntries(ISLANDS.map((d) => [d.id, d]));

/** колір рельєфу за характером острова */
const GRASS: Record<IslandDef['kind'], [number, number]> = {
  gull: [0x7d9a52, 0x6a8a46],
  pine: [0x557a37, 0x3f6430],
  palm: [0x8fa95a, 0x7e9c4c],
  pirate: [0x9a9a5a, 0x7f8048],
  shell: [0xa3a062, 0x8f9a5c],
};

interface Pickup {
  def: FindDef;
  obj: THREE.Group;
  glow: THREE.Sprite;
  x: number;
  y: number;
  z: number;
}

export class Islands {
  readonly group = new THREE.Group();
  private pickups: Pickup[] = [];
  private gulls: THREE.Sprite[] = [];
  private flags: THREE.Mesh[] = [];
  private _p = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const rng = mulberry32(777);
    const ground = new THREE.MeshStandardMaterial({ vertexColors: true, map: groundDetailTex(), roughness: 0.95 });
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    for (const d of ISLANDS) {
      this.group.add(this.terrain(d, ground));
      this.props(d, rng, rockMat);
    }
    const glowTex = sparkleTex();
    for (const f of FINDS) {
      const d = ISLAND_BY_ID[f.island];
      let x = d.x + f.dx, z = d.z + f.dz;
      // знахідка — лише на суші: підтягуємо до центру, поки під ногами не стане сухо
      for (let i = 0; i < 20 && islandHeightOf(d, x, z) < 0.5; i++) {
        x += (d.x - x) * 0.15;
        z += (d.z - z) * 0.15;
      }
      const y = islandHeightOf(d, x, z);
      const obj = this.findModel(f);
      obj.position.set(x, y + 0.75, z);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe2a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
      glow.scale.setScalar(2.2);
      glow.position.set(x, y + 0.85, z);
      this.group.add(obj, glow);
      this.pickups.push({ def: f, obj, glow, x, y, z });
    }
    scene.add(this.group);
  }

  // ── рельєф ──
  private terrain(d: IslandDef, mat: THREE.Material): THREE.Mesh {
    const R = d.r * Math.sqrt(d.elong) * 1.3 + 10;
    const step = 2;
    const n = Math.ceil((R * 2) / step) + 1;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const hs = new Float32Array(n * n);
    const [g0, g1] = GRASS[d.kind];
    const cA = new THREE.Color(g0), cB = new THREE.Color(g1);
    const sand = new THREE.Color(d.kind === 'shell' ? 0xe8cfb4 : 0xdcc9a0);
    const wet = new THREE.Color(0xa39274), bed = new THREE.Color(0x5d6655);
    const rock = new THREE.Color(0x84817a), rockD = new THREE.Color(0x5f5d58);
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = d.x - R + i * step, z = d.z - R + j * step;
        const h = islandHeightOf(d, x, z);
        const k = j * n + i;
        hs[k] = h;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / 6;
        uv[k * 2 + 1] = z / 6;
        const sl = Math.hypot(islandHeightOf(d, x + 1.5, z) - islandHeightOf(d, x - 1.5, z), islandHeightOf(d, x, z + 1.5) - islandHeightOf(d, x, z - 1.5)) / 3;
        c.copy(cA).lerp(cB, smoothstep(0.35, 0.7, fbm(x * 0.03 + d.seed, z * 0.03, 3)));
        // пісок: широкий на косі й Мушлевому, вузький — на скелястих
        const sandTop = d.kind === 'palm' ? 3.0 : d.kind === 'shell' ? 1.9 : 1.25;
        c.lerp(sand, smoothstep(sandTop + 0.4, sandTop - 0.3, h));
        if (h < 0.3) c.copy(wet).lerp(bed, smoothstep(0.1, -2.5, h));
        c.lerp(noise2(x * 0.1, z * 0.1) > 0.5 ? rock : rockD, Math.max(smoothstep(0.8, 1.2, sl) * 0.85, d.kind === 'pirate' ? smoothstep(7, 11, h) * 0.7 : 0));
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, cc = a + n, dd = cc + 1;
        if (Math.max(hs[a], hs[b], hs[cc], hs[dd]) < -5) continue;
        idx.push(a, cc, b, b, cc, dd);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = true;
    return m;
  }

  // ── реквізит ──
  private props(d: IslandDef, rng: () => number, rockMat: THREE.Material) {
    const flat = (color: number, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true });
    const g = this.group;
    const at = (x: number, z: number) => islandHeightOf(d, x, z);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const solid = (x: number, z: number, r: number) => ISLAND_SOLIDS.push({ x, z, r });
    /** випадкова суха точка на острові, від minH до maxH */
    const spot = (minH: number, maxH = 99): [number, number] | null => {
      for (let i = 0; i < 60; i++) {
        const a = rng() * Math.PI * 2, r = rng() * d.r * Math.sqrt(d.elong) * 1.1;
        const x = d.x + Math.cos(a) * r, z = d.z + Math.sin(a) * r;
        const h = at(x, z);
        // не на знахідках
        if (h >= minH && h <= maxH && !FINDS.some((f) => f.island === d.id && Math.hypot(d.x + f.dx - x, d.z + f.dz - z) < 4)) return [x, z];
      }
      return null;
    };
    const boulder = (x: number, z: number, r: number) => {
      const m = add(rockGeo(r, 0.7 + rng() * 0.4, rng() * 100, 1), rockMat, x, at(x, z) - r * 0.2, z);
      m.rotation.y = rng() * 6;
      solid(x, z, r * 0.85);
    };
    const pine = (x: number, z: number, s: number) => {
      const t = new THREE.Group();
      t.position.set(x, at(x, z) - 0.15, z);
      t.scale.setScalar(s);
      add(new THREE.CylinderGeometry(0.16, 0.24, 2.0, 6), flat(0x5a4030), 0, 1, 0, t);
      add(new THREE.ConeGeometry(2.0, 3.4, 7), flat(0x2f5a35), 0, 2.9, 0, t);
      add(new THREE.ConeGeometry(1.6, 3.0, 7), flat(0x356540), 0, 4.5, 0, t);
      add(new THREE.ConeGeometry(1.1, 2.6, 7), flat(0x3b6e46), 0, 6.0, 0, t);
      t.rotation.y = rng() * 6;
      g.add(t);
      solid(x, z, 0.45 * s);
    };
    const palm = (x: number, z: number, s: number) => {
      const t = new THREE.Group();
      t.position.set(x, at(x, z) - 0.1, z);
      t.rotation.y = rng() * 6;
      t.scale.setScalar(s);
      const trunk = flat(0x8a6a48);
      // вигнутий стовбур: труба вздовж кривої, що хилиться від вітру
      const lean = 0.25 + rng() * 0.2;
      const H = 5.6;
      const px = lean * H, py = H;
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, H * 0.55, 0), new THREE.Vector3(px, py, 0));
      add(new THREE.TubeGeometry(curve, 10, 0.17, 7, false), trunk, 0, 0, 0, t);
      // кільця кори
      for (let i = 1; i < 9; i++) {
        const q = curve.getPoint(i / 9);
        add(new THREE.TorusGeometry(0.175, 0.025, 4, 8), flat(0x73563a), q.x, q.y, q.z, t).rotation.x = Math.PI / 2;
      }
      const leaf = flat(0x4f8a3c, 0.7);
      for (let k = 0; k < 7; k++) {
        const fr = new THREE.Group();
        fr.position.set(px, py + 0.1, 0);
        fr.rotation.y = (k / 7) * Math.PI * 2;
        const l = add(new THREE.BoxGeometry(0.5, 0.04, 2.3), leaf, 0, -0.3, 1.05, fr);
        l.rotation.x = 0.45;
        t.add(fr);
      }
      for (let k = 0; k < 3; k++) add(new THREE.SphereGeometry(0.16, 6, 5), flat(0x6b4a2a), px + Math.cos(k * 2) * 0.2, py - 0.1, Math.sin(k * 2) * 0.2, t);
      g.add(t);
      solid(x, z, 0.35 * s);
    };

    if (d.kind === 'gull') {
      for (let i = 0; i < 4; i++) {
        const p = spot(0.6);
        if (p) boulder(p[0], p[1], 0.8 + rng() * 1.2);
      }
      // лавка й табличка для туристів
      const bx = d.x - 5, bz = d.z + 2;
      const wood = flat(0x7a5a3c);
      const bench = new THREE.Group();
      bench.position.set(bx, at(bx, bz), bz);
      bench.rotation.y = 0.8;
      add(new THREE.BoxGeometry(1.6, 0.08, 0.42), wood, 0, 0.45, 0, bench);
      for (const sx of [-0.65, 0.65]) add(new THREE.BoxGeometry(0.08, 0.45, 0.38), wood, sx, 0.22, 0, bench);
      g.add(bench);
      solid(bx, bz, 0.7);
      const tex = makeGullTexture();
      for (let i = 0; i < 6; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }));
        s.scale.setScalar(1.4 + rng() * 0.6);
        s.userData = { cx: d.x, cz: d.z, r: 8 + rng() * 10, h: 9 + rng() * 8, a: rng() * 6.28, sp: (0.25 + rng() * 0.3) * (i % 2 ? 1 : -1) };
        this.gulls.push(s);
        g.add(s);
      }
    } else if (d.kind === 'pine') {
      for (let i = 0; i < 26; i++) {
        const p = spot(2.2);
        if (p && Math.hypot(p[0] - (d.x - 9), p[1] - (d.z + 6)) > 7) pine(p[0], p[1], 0.7 + rng() * 0.6);
      }
      for (let i = 0; i < 6; i++) {
        const p = spot(0.4, 3);
        if (p) boulder(p[0], p[1], 0.7 + rng() * 1.0);
      }
      // руїни хатини доглядача: три стіни з каменю без даху, в одній — проріз
      const hx = d.x - 9, hz = d.z + 6;
      const hy = at(hx, hz);
      const stone = flat(0x8d8a82, 0.95);
      const hut = new THREE.Group();
      hut.position.set(hx, hy - 0.1, hz);
      hut.rotation.y = 0.3;
      const W = 4.2, D = 3.4;
      // стіни з фундаментом у схил (низ на 1.6 м під землею — без щілин на схилі)
      const wall = (w: number, h: number, d: number, x: number, z: number, m = stone) =>
        add(new THREE.BoxGeometry(w, h + 1.6, d), m, x, (h - 1.6) / 2, z, hut);
      const stoneTop = flat(0xa29d92, 0.95);
      wall(W, 1.9, 0.35, 0, -D / 2);
      wall(0.35, 1.5, D, -W / 2, 0);
      wall(0.35, 1.0, D * 0.6, W / 2, -D * 0.2);
      wall(1.3, 0.9, 0.35, -W / 2 + 0.65, D / 2);
      // світліший верхній ряд каменю
      add(new THREE.BoxGeometry(W + 0.06, 0.16, 0.4), stoneTop, 0, 1.9, -D / 2, hut);
      add(new THREE.BoxGeometry(0.4, 0.16, D + 0.06), stoneTop, -W / 2, 1.5, 0, hut);
      // кам'яна долівка (вирівнює підлогу на схилі)
      add(new THREE.BoxGeometry(W, 1.6, D), flat(0x77736b, 0.95), 0, -0.78, 0, hut);
      // обвалена балка й старий стіл
      const beam = add(new THREE.BoxGeometry(0.2, 0.2, 4.6), flat(0x5a4030), 0.5, 0.6, 0.2, hut);
      beam.rotation.set(0.25, 0.4, 0.1);
      add(new THREE.BoxGeometry(1.1, 0.08, 0.7), flat(0x6e5036), 1.0, 0.75, -0.9, hut);
      g.add(hut);
      // стіни як тверді кола (у світі)
      const wl = (lx: number, lz: number, r: number) => {
        const c = Math.cos(0.3), s = Math.sin(0.3);
        solid(hx + lx * c + lz * s, hz - lx * s + lz * c, r);
      };
      for (let k = -2; k <= 2; k++) wl(k, -D / 2, 0.45);
      for (let k = -1; k <= 1; k++) wl(-W / 2, k * 1.1, 0.45);
      wl(W / 2, -0.6, 0.45);
      wl(-W / 2 + 0.65, D / 2, 0.55);
      // кострище
      const fx = d.x + 3, fz = d.z + 9;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        add(new THREE.DodecahedronGeometry(0.18, 0), stone, fx + Math.cos(a) * 0.6, at(fx, fz) + 0.05, fz + Math.sin(a) * 0.6);
      }
      for (let k = 0; k < 3; k++) {
        const l = add(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5), flat(0x3a2a1e), fx, at(fx, fz) + 0.1, fz);
        l.rotation.set(Math.PI / 2, k, 0);
      }
    } else if (d.kind === 'palm') {
      for (let i = 0; i < 11; i++) {
        const p = spot(0.8);
        if (p) palm(p[0], p[1], 0.9 + rng() * 0.45);
      }
      // пляжна парасолька й рушник
      const ux = d.x + 4, uz = d.z - 3;
      const uy = at(ux, uz);
      add(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 5), flat(0xf4efe4), ux, uy + 1.15, uz);
      for (let k = 0; k < 8; k++) {
        const cone = add(new THREE.ConeGeometry(1.4, 0.5, 8, 1, true, (k / 8) * Math.PI * 2, Math.PI / 4), flat(k % 2 ? 0xe2674a : 0xfbf6ec, 0.7), ux, uy + 2.35, uz);
        cone.material.side = THREE.DoubleSide;
      }
      solid(ux, uz, 0.25);
      const towel = add(new THREE.BoxGeometry(0.9, 0.02, 1.8), flat(0x2f7fd0, 0.9), ux + 1.4, uy + 0.03, uz + 0.4);
      towel.rotation.y = 0.4;
    } else if (d.kind === 'pirate') {
      for (let i = 0; i < 9; i++) {
        const p = spot(0.6);
        if (p) boulder(p[0], p[1], 0.9 + rng() * 1.8);
      }
      for (let i = 0; i < 5; i++) {
        const p = spot(1.5, 8);
        if (p) palm(p[0], p[1], 0.8 + rng() * 0.3);
      }
      // піратський прапор на щоглі
      const fx = d.x + 12, fz = d.z - 8;
      const fy = at(fx, fz);
      add(new THREE.CylinderGeometry(0.07, 0.09, 6, 6), flat(0x4a3424), fx, fy + 3, fz);
      const flagTex = jollyRogerTex();
      const flag = add(new THREE.PlaneGeometry(1.8, 1.2, 8, 1), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.9 }), fx + 0.95, fy + 5.2, fz);
      flag.castShadow = false;
      this.flags.push(flag);
      solid(fx, fz, 0.3);
      // лопата біля скрині й перевернута шлюпка
      const sx = d.x + 10.5, sz = d.z - 4;
      const sh = add(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 5), flat(0x6e5036), sx, at(sx, sz) + 0.5, sz);
      sh.rotation.z = 0.5;
      const bx = d.x - 12, bz = d.z - 2;
      const dinghy = add(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6d4a30, roughness: 0.85, flatShading: true, side: THREE.DoubleSide }), bx, at(bx, bz) - 0.05, bz);
      dinghy.scale.set(0.9, 0.45, 2.1);
      dinghy.rotation.y = 0.7;
      solid(bx, bz, 1.4);
    } else if (d.kind === 'shell') {
      // великі мушлі, плавник-корч і кам'яна пірамідка
      const shellMat = [flat(0xf3d9c4, 0.5), flat(0xe98b8b, 0.5), flat(0xfaf1e4, 0.5)];
      for (let i = 0; i < 14; i++) {
        const p = spot(0.3, 2.5);
        if (!p) continue;
        const s = 0.25 + rng() * 0.45;
        const m = add(new THREE.ConeGeometry(s, s * 1.4, 7), shellMat[i % 3], p[0], at(p[0], p[1]) + s * 0.2, p[1]);
        m.rotation.set(Math.PI / 2 - 0.3, rng() * 6, 0);
        m.scale.z = 0.5;
      }
      for (let i = 0; i < 4; i++) {
        const p = spot(0.4, 2);
        if (!p) continue;
        const l = add(new THREE.CylinderGeometry(0.1, 0.16, 2.4 + rng() * 1.5, 6), flat(0xb3a08a, 0.95), p[0], at(p[0], p[1]) + 0.12, p[1]);
        l.rotation.set(Math.PI / 2, rng() * 6, 0.2);
      }
      const cx = d.x - 3, cz = d.z - 2;
      for (let k = 0; k < 5; k++) add(new THREE.DodecahedronGeometry(0.42 - k * 0.07, 0), flat(0x9b958a, 0.95), cx, at(cx, cz) + 0.25 + k * 0.5, cz);
      solid(cx, cz, 0.5);
      for (let i = 0; i < 4; i++) {
        const p = spot(2);
        if (p) pine(p[0], p[1], 0.55 + rng() * 0.3);
      }
    }
  }

  private findModel(f: FindDef): THREE.Group {
    if (f.kind === 'hat') {
      const h = HAT_BY_ID[f.hat!];
      return buildHatModel(h.kind, h.color, h.accent);
    }
    const g = new THREE.Group();
    if (f.kind === 'bottle') {
      const glass = new THREE.MeshStandardMaterial({ color: 0x5fa88a, roughness: 0.15, transparent: true, opacity: 0.75 });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.38, 10), glass);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.16, 8), glass);
      neck.position.y = 0.26;
      const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 6), new THREE.MeshStandardMaterial({ color: 0xb08850 }));
      cork.position.y = 0.36;
      const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 6), new THREE.MeshStandardMaterial({ color: 0xf2e6c8 }));
      g.add(b, neck, cork, paper);
      g.rotation.z = 1.2;
    } else {
      const wood = new THREE.MeshStandardMaterial({ color: 0x7a4f2c, roughness: 0.8 });
      const iron = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.8 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), wood);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10, 1, false, 0, Math.PI), wood);
      lid.rotation.z = Math.PI / 2;
      lid.position.y = 0.25;
      g.add(box, lid);
      for (const x of [-0.3, 0.3]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.62), iron);
        band.position.x = x;
        g.add(band);
      }
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.04), iron);
      lock.position.set(0, 0.15, 0.31);
      g.add(lock);
      g.position.y = -0.45;
    }
    g.traverse((o) => (o.castShadow = true));
    return g;
  }

  /** кожен кадр: знахідки крутяться й мерехтять, мартини кружляють, прапор майорить */
  update(dt: number, t: number, found: readonly string[]) {
    for (const p of this.pickups) {
      const vis = !found.includes(p.def.id);
      p.obj.visible = vis;
      p.glow.visible = vis;
      if (!vis) continue;
      if (p.def.kind !== 'chest') {
        p.obj.rotation.y = t * 0.9;
        p.obj.position.y = p.y + 0.75 + Math.sin(t * 2 + p.x) * 0.08;
      } else p.obj.position.y = p.y + 0.3;
      const k = 0.55 + 0.3 * Math.sin(t * 3.1 + p.z);
      (p.glow.material as THREE.SpriteMaterial).opacity = k;
      p.glow.scale.setScalar(1.8 + k * 0.8);
    }
    for (const s of this.gulls) {
      const u = s.userData as { cx: number; cz: number; r: number; h: number; a: number; sp: number };
      u.a += u.sp * dt;
      s.position.set(u.cx + Math.cos(u.a) * u.r, u.h + Math.sin(u.a * 2.1) * 1.2, u.cz + Math.sin(u.a) * u.r);
    }
    for (const f of this.flags) {
      const pos = f.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(t * 4 + x * 2.5) * 0.12 * (x + 0.9));
      }
      pos.needsUpdate = true;
    }
  }

  /** знахідка під рукою (гравець на острові) */
  pick(x: number, z: number, found: readonly string[]): { id: string; label: string } | null {
    let best: Pickup | null = null;
    let bd = 2.4;
    for (const p of this.pickups) {
      if (found.includes(p.def.id)) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return null;
    const f = best.def;
    const label = f.kind === 'hat' ? L(`Підняти: ${HAT_BY_ID[f.hat!].name.toLowerCase()}`, `Pick up: ${HAT_BY_ID[f.hat!].name.toLowerCase()}`) : f.kind === 'bottle' ? L('Підняти пляшку із запискою', `Pick up the bottle with a note`) : L('Відкрити стару скриню', `Open the old chest`);
    return { id: 'find:' + f.id, label };
  }

  /** найближча суха точка до (x, z) у радіусі maxR (зійти з яхти на берег) */
  static landingSpot(x: number, z: number, maxR: number): [number, number] | null {
    if (islandHeight(x, z) > 0.25) return [x, z];
    for (let r = 0.75; r <= maxR; r += 0.75) {
      let best: [number, number] | null = null, bh = 0.25;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const h = islandHeight(px, pz);
        if (h > bh && h < 2.5) {
          bh = h;
          best = [px, pz];
        }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * яхта й мілина: корпус (нос, корма, борти) не заходить туди, де дно вище
   * кіля; удар на ходу — пошкодження, як об скелю
   */
  collideBoat(boat: Boat, game: GameState) {
    const KEEL = -1.3;
    const ch = Math.cos(boat.heading), sh = Math.sin(boat.heading);
    const pts: Array<[number, number]> = [[0, 4.2], [0, -4.0], [1.3, 0], [-1.3, 0], [1.0, 2.6], [-1.0, 2.6], [1.1, -2.6], [-1.1, -2.6]];
    let hit = 0;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const [lx, lz] of pts) {
        const px = boat.pos.x + lx * ch + lz * sh;
        const pz = boat.pos.z - lx * sh + lz * ch;
        // увесь рельєф: острови, суходоли портів і берег домашньої бухти
        const h = terrainHeight(px, pz);
        if (h <= KEEL) continue;
        // нормаль — униз схилом
        const e = 1;
        let nx = terrainHeight(px - e, pz) - terrainHeight(px + e, pz);
        let nz = terrainHeight(px, pz - e) - terrainHeight(px, pz + e);
        const l = Math.hypot(nx, nz) || 1;
        nx /= l;
        nz /= l;
        const pen = Math.min(1.5, (h - KEEL) / 0.5 + 0.05);
        boat.pos.x += nx * pen;
        boat.pos.z += nz * pen;
        const vn = boat.vel.x * nx + boat.vel.z * nz;
        if (vn < 0) {
          hit = Math.max(hit, -vn);
          boat.vel.x -= nx * vn * 1.3;
          boat.vel.z -= nz * vn * 1.3;
        }
        moved = true;
      }
      if (!moved) break;
    }
    if (hit > 2.2) {
      game.damage((hit - 1.5) * 5);
      this._p.set(boat.pos.x, 0.5, boat.pos.z);
      boat.onHullHit?.(hit, this._p);
    }
  }
}

function sparkleTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.25, 'rgba(255,220,140,0.55)');
  grd.addColorStop(1, 'rgba(255,200,100,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function jollyRogerTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1b1d';
  g.fillRect(0, 0, 192, 128);
  g.fillStyle = '#f2ead8';
  g.beginPath();
  g.arc(96, 52, 24, 0, Math.PI * 2);
  g.fill();
  g.fillRect(84, 66, 24, 14);
  g.fillStyle = '#1b1b1d';
  g.beginPath();
  g.arc(87, 50, 6, 0, Math.PI * 2);
  g.arc(105, 50, 6, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#f2ead8';
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(58, 86); g.lineTo(134, 116);
  g.moveTo(134, 86); g.lineTo(58, 116);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
