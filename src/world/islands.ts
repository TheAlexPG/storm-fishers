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
  kind: 'hat' | 'bottle' | 'chest' | 'relic';
  hat?: string;
  money?: number;
  note?: string;
  /** заголовок картки знахідки (скриня/реліквія) */
  title?: string;
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
  // ── біля континентів ──
  { id: 'hat:laurel', island: 'isl-temple', dx: 2, dz: 1, kind: 'hat', hat: 'laurel' },
  { id: 'hat:boater', island: 'isl-olive', dx: -8, dz: 6, kind: 'hat', hat: 'boater' },
  { id: 'bottle:grotto', island: 'isl-grotto', dx: -6, dz: 9, kind: 'bottle', money: 350, note: L('«Сирени не співають — це вітер в арці. Але вино з Айос-Нікоса справжнє: шукай ящик на складі»', `“The sirens don't sing — it's the wind in the arch. But the wine from Agios Nikos is real: look for a crate at the warehouse”`) },
  { id: 'bottle:keeper', island: 'isl-keeper', dx: 7, dz: -4, kind: 'bottle', money: 400, note: L('«Доглядачу Санта-Луче: дорада ходить у лагуні на сході, кальмари — у Гольфо вночі. Дякую за чай. — К.»', `“To the keeper of Santa Luce: sea bream run in the eastern lagoon, squid in the Golfo at night. Thanks for the tea. — K.”`) },
  { id: 'relic:amphora', island: 'isl-sandbar', dx: 5, dz: -2, kind: 'relic', money: 650, title: L('Ціла амфора!', `An intact amphora!`), note: L('з затонулої галери · колекціонер у Порто-Аццурро платить', `from the sunken galley · a collector in Porto Azzurro pays well`) },
  { id: 'chest:whaling', island: 'isl-whaling', dx: -5, dz: 6, kind: 'chest', money: 1100, title: L('Скриня китобоя', `The whaler's chest`), note: L('старі монети й гарпунна мідь', `old coins and harpoon brass`) },
  { id: 'hat:coonskin', island: 'isl-trapper', dx: 5, dz: 4, kind: 'hat', hat: 'coonskin' },
  { id: 'bottle:totem', island: 'isl-totem', dx: 4, dz: -6, kind: 'bottle', money: 300, note: L('«Ворон бачить фронт раніше за барометр. Коли тотем у тумані — повертай до Бухти Гризлі»', `“The raven sees a front before the barometer does. When the totem is in fog — turn back to Grizzly Bay”`) },
  { id: 'hat:viking', island: 'isl-granite', dx: 6, dz: -5, kind: 'hat', hat: 'viking' },
];

const ISLAND_BY_ID: Record<string, IslandDef> = Object.fromEntries(ISLANDS.map((d) => [d.id, d]));

/** колір рельєфу за характером острова */
const GRASS: Record<IslandDef['kind'], [number, number]> = {
  gull: [0x7d9a52, 0x6a8a46],
  pine: [0x557a37, 0x3f6430],
  palm: [0x8fa95a, 0x7e9c4c],
  pirate: [0x9a9a5a, 0x7f8048],
  shell: [0xa3a062, 0x8f9a5c],
  cypress: [0xa8a463, 0x8e9450],
  fir: [0x4d6b3e, 0x3a5533],
  refuge: [0x7f9655, 0x6b8648],
  temple: [0xb0a868, 0x9a9a58],
  grotto: [0xa8a463, 0x8e9450],
  keeper: [0x9fae66, 0x8a9e58],
  sandbar: [0xc9b98a, 0xbfae80],
  whaling: [0x5a6e48, 0x495c3c],
  trapper: [0x4d6b3e, 0x3a5533],
  totem: [0x56704a, 0x43593b],
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
  private chunks: Array<{ x: number; z: number; r: number; objs: THREE.Object3D[] }> = [];
  private _p = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const rng = mulberry32(777);
    const ground = new THREE.MeshStandardMaterial({ vertexColors: true, map: groundDetailTex(), roughness: 0.95 });
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    for (const d of ISLANDS) {
      const start = this.group.children.length;
      this.group.add(this.terrain(d, ground));
      this.props(d, rng, rockMat);
      // далекі острови не малюємо (сотні дрібних мешів реквізиту за серпанком)
      this.chunks.push({ x: d.x, z: d.z, r: d.r * Math.sqrt(d.elong) * 1.4, objs: this.group.children.slice(start) });
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
    const med = d.kind === 'cypress' || d.kind === 'temple' || d.kind === 'grotto' || d.kind === 'keeper' || d.kind === 'sandbar';
    const nord = d.kind === 'fir' || d.kind === 'whaling' || d.kind === 'trapper' || d.kind === 'totem';
    const sand = new THREE.Color(d.kind === 'shell' ? 0xe8cfb4 : med ? 0xeedfb8 : nord ? 0xa8a49a : 0xdcc9a0);
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
        const sandTop = d.kind === 'palm' ? 3.0 : d.kind === 'shell' || d.kind === 'sandbar' ? 1.9 : 1.25;
        c.lerp(sand, smoothstep(sandTop + 0.4, sandTop - 0.3, h));
        if (h < 0.3) c.copy(wet).lerp(bed, smoothstep(0.1, -2.5, h));
        c.lerp(noise2(x * 0.1, z * 0.1) > 0.5 ? rock : rockD, Math.max(smoothstep(0.8, 1.2, sl) * 0.85, d.kind === 'pirate' || d.kind === 'grotto' ? smoothstep(7, 11, h) * 0.7 : nord ? smoothstep(8, 14, h) * 0.75 : 0));
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
    } else if (d.kind === 'cypress') {
      // Середземномор'я: кипариси-свічки, кругленькі оливи й біла каплиця з блакитним куполом
      const cyp = flat(0x2f4f2c), olive = flat(0x8a9a68, 0.9), bark = flat(0x6a5a46);
      for (let i = 0; i < 9; i++) {
        const p = spot(1.6);
        if (!p) continue;
        const s = 0.8 + rng() * 0.5;
        add(new THREE.CylinderGeometry(0.12, 0.16, 1.2 * s, 5), bark, p[0], at(p[0], p[1]) + 0.5 * s, p[1]);
        add(new THREE.ConeGeometry(0.85 * s, 7.5 * s, 7), cyp, p[0], at(p[0], p[1]) + 4.4 * s, p[1]);
        solid(p[0], p[1], 0.4 * s);
      }
      for (let i = 0; i < 7; i++) {
        const p = spot(1.2, 9);
        if (!p) continue;
        const s = 0.8 + rng() * 0.6;
        add(new THREE.CylinderGeometry(0.15, 0.22, 1.4 * s, 5), bark, p[0], at(p[0], p[1]) + 0.6 * s, p[1]).rotation.z = (rng() - 0.5) * 0.4;
        const crown = add(new THREE.IcosahedronGeometry(1.5 * s, 0), olive, p[0], at(p[0], p[1]) + 2.0 * s, p[1]);
        crown.scale.set(1.25, 0.75, 1.15);
        solid(p[0], p[1], 0.45 * s);
      }
      // каплиця на найвищій точці
      let best: [number, number] = [d.x, d.z], bh = -9;
      for (let i = 0; i < 40; i++) {
        const p = spot(3);
        if (p && at(p[0], p[1]) > bh) { bh = at(p[0], p[1]); best = p; }
      }
      const [cx, cz] = best;
      const y0 = at(cx, cz) - 0.3;
      add(new THREE.BoxGeometry(3.6, 3.2, 4.4), flat(0xf6f3ec, 0.8), cx, y0 + 1.6, cz);
      add(new THREE.CylinderGeometry(1.25, 1.25, 0.6, 14), flat(0xf6f3ec, 0.8), cx, y0 + 3.5, cz);
      add(new THREE.SphereGeometry(1.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), flat(0x2f6fb5, 0.5), cx, y0 + 3.8, cz);
      add(new THREE.BoxGeometry(0.9, 1.7, 0.08), flat(0x2f6fb5, 0.6), cx, y0 + 0.85, cz + 2.22);
      add(new THREE.BoxGeometry(0.08, 0.7, 0.08), flat(0xd9d4c8), cx, y0 + 5.4, cz);
      add(new THREE.BoxGeometry(0.45, 0.08, 0.08), flat(0xd9d4c8), cx, y0 + 5.5, cz);
      solid(cx, cz, 2.8);
    } else if (d.kind === 'fir') {
      // Північ: темні ялиці, гранітні брили
      for (let i = 0; i < 16; i++) {
        const p = spot(1.6);
        if (p) pine(p[0], p[1], 0.8 + rng() * 0.7);
      }
      for (let i = 0; i < 7; i++) {
        const p = spot(0.3);
        if (p) boulder(p[0], p[1], 1.0 + rng() * 1.8);
      }
    } else if (d.kind === 'refuge') {
      // притулок: червоно-білий маяк і хатина доглядача
      let best: [number, number] = [d.x, d.z], bh = -9;
      for (let i = 0; i < 40; i++) {
        const p = spot(2);
        if (p && at(p[0], p[1]) > bh) { bh = at(p[0], p[1]); best = p; }
      }
      const [lx, lz] = best;
      const y0 = at(lx, lz) - 0.2;
      for (let k = 0; k < 5; k++) add(new THREE.CylinderGeometry(1.25 - k * 0.12, 1.37 - k * 0.12, 2.2, 14), flat(k % 2 ? 0xc23a2c : 0xf2f1ec, 0.6), lx, y0 + 1.1 + k * 2.2, lz);
      add(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 10), new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe39a, emissiveIntensity: 1.2, roughness: 0.1 }), lx, y0 + 11.6, lz);
      add(new THREE.ConeGeometry(0.95, 1.1, 10), flat(0x24292d, 0.5), lx, y0 + 12.8, lz);
      solid(lx, lz, 1.6);
      const hx = lx + 5, hz = lz + 3;
      add(new THREE.BoxGeometry(4, 2.6, 3.2), flat(0xe8e2d2, 0.85), hx, at(hx, hz) + 1.1, hz);
      const roof = add(new THREE.ConeGeometry(3.2, 1.6, 4), flat(0xa9442f, 0.8), hx, at(hx, hz) + 3.2, hz);
      roof.rotation.y = Math.PI / 4;
      solid(hx, hz, 2.4);
      for (let i = 0; i < 4; i++) {
        const p = spot(0.4);
        if (p) boulder(p[0], p[1], 0.7 + rng() * 1.0);
      }
    } else if (d.kind === 'temple') {
      // руїни храму: підіум, колони (частина впала), уламок архітрава, кипариси
      const marble = flat(0xeee8da, 0.8), marbleD = flat(0xd6cfbd, 0.85);
      let best: [number, number] = [d.x, d.z], bh = -9;
      for (let i = 0; i < 40; i++) {
        const p = spot(3);
        if (p && at(p[0], p[1]) > bh) { bh = at(p[0], p[1]); best = p; }
      }
      const [tx, tz] = best;
      const ty = at(tx, tz);
      const TR = 0.4;
      const temple = new THREE.Group();
      temple.position.set(tx, ty - 0.25, tz);
      temple.rotation.y = TR;
      // фундамент глибоко в пагорб — на вершині-горбі без щілин під подіумом
      add(new THREE.BoxGeometry(10, 5, 6.4), marbleD, 0, -1.9, 0, temple);
      add(new THREE.BoxGeometry(11.2, 4, 7.6), flat(0x9b9486, 0.95), 0, -3.4, 0, temple);
      add(new THREE.BoxGeometry(9.2, 0.35, 5.6), marble, 0, 0.75, 0, temple);
      const heights = [4.6, 4.6, 2.2, 4.6, 1.4, 4.6, 3.1, 4.6, 4.6, 0.9];
      let k = 0;
      for (const sz of [-2.2, 2.2]) {
        for (let i = 0; i < 5; i++) {
          const h = heights[k++];
          const cx = -3.6 + i * 1.8;
          add(new THREE.CylinderGeometry(0.32, 0.36, h, 10), marble, cx, 0.92 + h / 2, sz, temple);
          if (h > 4) add(new THREE.BoxGeometry(0.85, 0.22, 0.85), marbleD, cx, 0.92 + h + 0.11, sz, temple);
        }
      }
      // архітрав над трьома цілими колонами з одного боку
      add(new THREE.BoxGeometry(5.6, 0.55, 0.9), marble, 2.7, 0.92 + 4.6 + 0.5, 2.2, temple);
      // впалі барабани колон
      for (const [x, z, r] of [[-1.5, 4.6, 0.5], [2.8, 4.3, 1.1], [-4.3, -4.4, 2.2]] as const) {
        const c = add(new THREE.CylinderGeometry(0.34, 0.34, 1.6, 10), marble, x, 0.15, z, temple);
        c.rotation.set(Math.PI / 2, 0, r);
      }
      g.add(temple);
      const tw = (lx: number, lz: number, r: number) => {
        const c = Math.cos(TR), sn = Math.sin(TR);
        solid(tx + lx * c + lz * sn, tz - lx * sn + lz * c, r);
      };
      for (const sz of [-2.2, 2.2]) for (let i = 0; i < 5; i++) tw(-3.6 + i * 1.8, sz, 0.45);
      const cyp = flat(0x2f4f2c), bark = flat(0x6a5a46);
      for (let i = 0; i < 6; i++) {
        const p = spot(1.4, 11);
        if (!p || Math.hypot(p[0] - tx, p[1] - tz) < 8) continue;
        const sc = 0.7 + rng() * 0.5;
        add(new THREE.CylinderGeometry(0.12, 0.16, 1.2 * sc, 5), bark, p[0], at(p[0], p[1]) + 0.5 * sc, p[1]);
        add(new THREE.ConeGeometry(0.85 * sc, 7.5 * sc, 7), cyp, p[0], at(p[0], p[1]) + 4.4 * sc, p[1]);
        solid(p[0], p[1], 0.4 * sc);
      }
      for (let i = 0; i < 4; i++) {
        const p = spot(0.4, 3);
        if (p) boulder(p[0], p[1], 0.6 + rng() * 0.8);
      }
    } else if (d.kind === 'grotto') {
      // скеля з морською аркою (грот), човник на пляжі
      const cs = Math.cos(d.rot), sn = Math.sin(d.rot);
      // арка — на кінці довгої осі, наполовину в морі: під нею проходить вода
      let ax = d.x + cs * d.r * 0.9, az = d.z - sn * d.r * 0.9;
      for (let i = 0; i < 40 && at(ax, az) > -0.6; i++) { ax += cs * 1.2; az -= sn * 1.2; }
      // опори — уздовж берега, отвір дивиться в море
      const AR = d.rot + Math.PI / 2;
      const arch = new THREE.Group();
      arch.position.set(ax, 0, az);
      arch.rotation.y = AR;
      add(rockGeo(2.6, 1.9, d.seed + 1, 2), rockMat, -4.6, -1.6, 0, arch);
      add(rockGeo(2.9, 2.1, d.seed + 2, 2), rockMat, 4.6, -1.6, 0, arch);
      const tg = new THREE.TorusGeometry(4.6, 1.6, 6, 14, Math.PI);
      const tp = tg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < tp.count; i++) {
        const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
        const n = Math.sin(x * 1.3 + z * 2.1) * Math.cos(y * 1.7 - x * 0.6) * 0.7;
        tp.setXYZ(i, x * (1 + n * 0.05), y + n * 0.5, z * (1 + n * 0.25));
      }
      tg.computeVertexNormals();
      add(tg, flat(0xbfb4a0, 0.95), 0, 2.2, 0, arch).scale.set(1, 1.15, 0.9);
      g.add(arch);
      for (const sx of [-4.6, 4.6]) solid(ax + sx * Math.cos(AR), az - sx * Math.sin(AR), 2.8);
      for (let i = 0; i < 6; i++) {
        const p = spot(0.4, 3);
        if (p) boulder(p[0], p[1], 0.7 + rng() * 1.2);
      }
      const cyp = flat(0x2f4f2c);
      for (let i = 0; i < 3; i++) {
        const p = spot(4);
        if (!p) continue;
        add(new THREE.ConeGeometry(0.7, 6, 7), cyp, p[0], at(p[0], p[1]) + 3.2, p[1]);
        solid(p[0], p[1], 0.35);
      }
      let bx = d.x - cs * 6, bz = d.z + sn * 6;
      for (let i = 0; i < 40; i++) {
        const p = spot(0.4, 1.2);
        if (p) { bx = p[0]; bz = p[1]; break; }
      }
      const boat = add(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2f6fb5, roughness: 0.8, flatShading: true, side: THREE.DoubleSide }), bx, at(bx, bz) + 0.35, bz);
      boat.scale.set(0.8, -0.45, 1.9);
      boat.rotation.y = d.rot;
      solid(bx, bz, 1.2);
    } else if (d.kind === 'keeper') {
      // біло-блакитний маяк, хатинка доглядача з синіми віконницями, мотузка з білизною
      let best: [number, number] = [d.x, d.z], bh = -9;
      for (let i = 0; i < 40; i++) {
        const p = spot(2);
        if (p && at(p[0], p[1]) > bh) { bh = at(p[0], p[1]); best = p; }
      }
      const [lx, lz] = best;
      const y0 = at(lx, lz) - 0.2;
      for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(1.1 - k * 0.1, 1.2 - k * 0.1, 2.2, 14), flat(k % 2 ? 0x2f6fb5 : 0xf6f3ec, 0.6), lx, y0 + 1.1 + k * 2.2, lz);
      add(new THREE.CylinderGeometry(1.0, 1.0, 0.2, 14), flat(0x24292d, 0.5), lx, y0 + 8.9, lz);
      add(new THREE.CylinderGeometry(0.6, 0.6, 1.0, 10), new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe39a, emissiveIntensity: 1.1, roughness: 0.1 }), lx, y0 + 9.5, lz);
      add(new THREE.ConeGeometry(0.8, 0.9, 10), flat(0x2f6fb5, 0.5), lx, y0 + 10.45, lz);
      solid(lx, lz, 1.4);
      let hx = lx - 5, hz = lz + 2.5;
      for (let i = 0; i < 30 && at(hx, hz) < 0.9; i++) { hx += (lx - hx) * 0.15; hz += (lz - hz) * 0.15; }
      const hy = at(hx, hz);
      add(new THREE.BoxGeometry(4.2, 2.6, 3.2), flat(0xf6f3ec, 0.85), hx, hy + 1.1, hz);
      add(new THREE.BoxGeometry(4.5, 0.25, 3.5), flat(0xd9d4c8, 0.85), hx, hy + 2.5, hz);
      add(new THREE.BoxGeometry(0.9, 1.6, 0.08), flat(0x2f6fb5, 0.6), hx, hy + 0.6, hz + 1.62);
      for (const sx of [-1.3, 1.3]) add(new THREE.BoxGeometry(0.8, 0.7, 0.08), flat(0x2f6fb5, 0.6), hx + sx, hy + 1.4, hz + 1.62);
      solid(hx, hz, 2.4);
      // білизна на мотузці між двома жердинами
      const px0 = hx + 3.4, pz0 = hz + 2.6, px1 = hx + 6.6, pz1 = hz + 4.2;
      const yb = Math.min(at(px0, pz0), at(px1, pz1)) + 1.75;
      for (const [x, z] of [[px0, pz0], [px1, pz1]]) add(new THREE.CylinderGeometry(0.04, 0.05, 2.4, 5), flat(0x7a5a3c), x, at(x, z) + 1.0, z);
      const cols = [0xe2674a, 0xf6f3ec, 0x2f6fb5, 0xf2c12e];
      for (let k = 0; k < 4; k++) {
        const t = (k + 0.6) / 4.4;
        const cl = add(new THREE.PlaneGeometry(0.55, 0.7, 4, 1), new THREE.MeshStandardMaterial({ color: cols[k], side: THREE.DoubleSide, roughness: 0.9 }), px0 + (px1 - px0) * t, yb, pz0 + (pz1 - pz0) * t);
        cl.rotation.y = Math.atan2(pz1 - pz0, px1 - px0) * -1;
        cl.castShadow = false;
      }
      for (let i = 0; i < 5; i++) {
        const p = spot(0.4);
        if (p) boulder(p[0], p[1], 0.6 + rng() * 1.0);
      }
    } else if (d.kind === 'sandbar') {
      // піщана коса: черепки амфор, корч, дрібні камінці
      const clay = new THREE.MeshStandardMaterial({ color: 0xb5643a, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
      const clayD = new THREE.MeshStandardMaterial({ color: 0x8f4b2c, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
      for (let i = 0; i < 12; i++) {
        const p = spot(0.25, 2);
        if (!p) continue;
        const sc = 0.5 + rng() * 0.6;
        const a = add(new THREE.CylinderGeometry(0.18 * sc, 0.28 * sc, 0.7 * sc, 8, 1, true), i % 2 ? clay : clayD, p[0], at(p[0], p[1]) + 0.08, p[1]);
        a.rotation.set(Math.PI / 2 - 0.2, rng() * 6, rng() * 0.6);
      }
      for (let i = 0; i < 3; i++) {
        const p = spot(0.3, 2);
        if (!p) continue;
        const l = add(new THREE.CylinderGeometry(0.1, 0.16, 2.2 + rng() * 1.4, 6), flat(0xb3a08a, 0.95), p[0], at(p[0], p[1]) + 0.12, p[1]);
        l.rotation.set(Math.PI / 2, rng() * 6, 0.2);
      }
      for (let i = 0; i < 4; i++) {
        const p = spot(0.2, 2);
        if (p) boulder(p[0], p[1], 0.4 + rng() * 0.5);
      }
    } else if (d.kind === 'whaling') {
      // покинута китобійня: два червоні склади, іржавий котел, ребра кита, сліп у воду
      const red = flat(0x9a3b2c, 0.85), roofM = flat(0x3b3f44, 0.7), rust = flat(0x7a4a2a, 0.6), bone = flat(0xe9dfc8, 0.7);
      const cs = Math.cos(d.rot), sn = Math.sin(d.rot);
      const dry = (x: number, z: number): [number, number] => {
        for (let i = 0; i < 30 && at(x, z) < 1.2; i++) { x += (d.x - x) * 0.15; z += (d.z - z) * 0.15; }
        return [x, z];
      };
      const shed = (px: number, pz: number, ry: number, w: number, dd: number) => {
        const [x, z] = dry(px, pz);
        const sh = new THREE.Group();
        sh.position.set(x, at(x, z) - 0.3, z);
        sh.rotation.y = ry;
        add(new THREE.BoxGeometry(w, 3.0, dd), red, 0, 1.5, 0, sh);
        for (const s2 of [-1, 1]) {
          const r = add(new THREE.BoxGeometry(w + 0.4, 0.14, dd * 0.62), roofM, 0, 3.35, s2 * dd * 0.24, sh);
          r.rotation.x = s2 * 0.55;
        }
        add(new THREE.BoxGeometry(1.2, 2.0, 0.08), flat(0x3a2a1e), 0, 1.0, dd / 2 + 0.03, sh);
        g.add(sh);
        solid(x, z, Math.max(w, dd) * 0.55);
      };
      shed(d.x - 4 * cs, d.z + 4 * sn, d.rot, 6, 4);
      shed(d.x + 5 * cs - 4 * sn, d.z - 5 * sn - 4 * cs, d.rot + 0.2, 4.5, 3.4);
      const [bxx, bzz] = dry(d.x + 3 * sn, d.z + 3 * cs);
      const boiler = add(new THREE.CylinderGeometry(1.0, 1.0, 3.4, 12), rust, bxx, at(bxx, bzz) + 0.85, bzz);
      boiler.rotation.set(0, d.rot, Math.PI / 2);
      solid(bxx, bzz, 1.6);
      const [rx, rz] = dry(d.x - 9 * sn, d.z - 9 * cs);
      const ribs = new THREE.Group();
      ribs.position.set(rx, at(rx, rz) - 0.2, rz);
      ribs.rotation.y = d.rot;
      for (let k = 0; k < 5; k++) {
        const h = 2.4 - Math.abs(k - 2) * 0.35;
        add(new THREE.TorusGeometry(h, 0.1, 5, 10, Math.PI), bone, 0, 0, -2 + k * 1.0, ribs).scale.set(0.9, 1, 1);
      }
      add(new THREE.CylinderGeometry(0.16, 0.12, 5.4, 6), bone, 0, 0.15, 0, ribs).rotation.x = Math.PI / 2;
      g.add(ribs);
      solid(rx, rz, 2.6);
      // сліп: дощатий спуск до води
      let slx = d.x + 6 * cs, slz = d.z - 6 * sn;
      for (let i = 0; i < 30 && at(slx, slz) > 0.3; i++) { slx += cs * 1.5; slz -= sn * 1.5; }
      const slip = add(new THREE.BoxGeometry(2.2, 0.15, 9), flat(0x5a4636, 0.95), slx, 0.15, slz);
      slip.rotation.set(0, d.rot + Math.PI / 2, 0);
      for (let i = 0; i < 6; i++) {
        const p = spot(1.6);
        if (p) pine(p[0], p[1], 0.6 + rng() * 0.5);
      }
      for (let i = 0; i < 6; i++) {
        const p = spot(0.3);
        if (p) boulder(p[0], p[1], 0.8 + rng() * 1.4);
      }
    } else if (d.kind === 'trapper') {
      // зрубна хижка траппера, рама зі шкурами, каное на березі, дрова, густі ялиці
      const log = flat(0x6b4a2e, 0.9), logD = flat(0x553a24, 0.9);
      let cx = d.x + 3, cz = d.z - 2;
      for (let i = 0; i < 30 && at(cx, cz) < 2; i++) { cx += (d.x - cx) * 0.2; cz += (d.z - cz) * 0.2; }
      const cy = at(cx, cz);
      const cab = new THREE.Group();
      cab.position.set(cx, cy - 0.2, cz);
      cab.rotation.y = d.rot;
      const W = 4.6, D = 3.8;
      for (let i = 0; i < 6; i++) {
        const y = 0.2 + i * 0.42;
        for (const sz of [-D / 2, D / 2]) add(new THREE.CylinderGeometry(0.21, 0.21, W + 0.6, 6), i % 2 ? log : logD, 0, y, sz, cab).rotation.z = Math.PI / 2;
        for (const sx of [-W / 2, W / 2]) add(new THREE.CylinderGeometry(0.21, 0.21, D + 0.6, 6), i % 2 ? logD : log, sx, y + 0.21, 0, cab).rotation.x = Math.PI / 2;
      }
      add(new THREE.BoxGeometry(W - 0.2, 2.5, D - 0.2), logD, 0, 1.25, 0, cab);
      for (const s2 of [-1, 1]) {
        const r = add(new THREE.BoxGeometry(W + 1.0, 0.16, D * 0.68), flat(0x4a4f45, 0.8), 0, 3.25, s2 * D * 0.27, cab);
        r.rotation.x = s2 * 0.62;
      }
      add(new THREE.BoxGeometry(0.5, 1.6, 0.5), flat(0x7d776c, 0.95), W * 0.3, 3.6, -0.6, cab);
      add(new THREE.BoxGeometry(0.9, 1.7, 0.08), flat(0x3a2a1e), 0, 0.95, D / 2 + 0.25, cab);
      g.add(cab);
      solid(cx, cz, 3.0);
      // рама зі шкурами
      const fx = cx - 5 * Math.cos(d.rot), fz = cz + 5 * Math.sin(d.rot);
      const fy = at(fx, fz);
      for (const sx of [-1.1, 1.1]) add(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 5), log, fx + sx * Math.cos(d.rot), fy + 1.1, fz - sx * Math.sin(d.rot));
      add(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5), log, fx, fy + 2.1, fz).rotation.set(0, d.rot, Math.PI / 2);
      for (let k = 0; k < 3; k++) {
        const o = -0.65 + k * 0.65;
        const hide = add(new THREE.PlaneGeometry(0.55, 0.9), new THREE.MeshStandardMaterial({ color: [0x8a6a4a, 0x6b5442, 0xa08060][k], side: THREE.DoubleSide, roughness: 1 }), fx + o * Math.cos(d.rot), fy + 1.55, fz - o * Math.sin(d.rot));
        hide.rotation.y = d.rot;
      }
      solid(fx, fz, 1.2);
      // дрова
      const wx = cx + 3.4 * Math.sin(d.rot), wz = cz + 3.4 * Math.cos(d.rot);
      for (let k = 0; k < 9; k++) add(new THREE.CylinderGeometry(0.13, 0.13, 1.2, 6), k % 2 ? log : logD, wx + (k % 3) * 0.28 - 0.28, at(wx, wz) + 0.14 + Math.floor(k / 3) * 0.25, wz).rotation.x = Math.PI / 2;
      // червоне каное на пляжі
      let bx = d.x, bz = d.z;
      for (let i = 0; i < 40; i++) {
        const p = spot(0.4, 1.2);
        if (p) { bx = p[0]; bz = p[1]; break; }
      }
      const canoe = add(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8362c, roughness: 0.7, flatShading: true, side: THREE.DoubleSide }), bx, at(bx, bz) + 0.3, bz);
      canoe.scale.set(0.45, -0.35, 2.4);
      canoe.rotation.y = rng() * 6;
      solid(bx, bz, 1.2);
      for (let i = 0; i < 22; i++) {
        const p = spot(1.8);
        if (p && Math.hypot(p[0] - cx, p[1] - cz) > 6.5 && Math.hypot(p[0] - fx, p[1] - fz) > 3) pine(p[0], p[1], 0.75 + rng() * 0.6);
      }
    } else if (d.kind === 'totem') {
      // тотем на вершині: різьблені яруси, крила-дошки й дзьоб ворона; граніт і кілька ялиць
      let best: [number, number] = [d.x, d.z], bh = -9;
      for (let i = 0; i < 40; i++) {
        const p = spot(3);
        if (p && at(p[0], p[1]) > bh) { bh = at(p[0], p[1]); best = p; }
      }
      const [tx, tz] = best;
      const ty = at(tx, tz) - 0.3;
      const pole = new THREE.Group();
      pole.position.set(tx, ty, tz);
      pole.rotation.y = -Math.PI / 2 + 0.3;
      const cols = [0x2f6f6a, 0xb8362c, 0x1f1d1b, 0xe8dcc0, 0x2f6f6a, 0xb8362c];
      for (let k = 0; k < 6; k++) {
        add(new THREE.CylinderGeometry(0.62 - k * 0.03, 0.66 - k * 0.03, 1.15, 10), flat(cols[k], 0.75), 0, 0.6 + k * 1.15, 0, pole);
        for (const sx of [-0.22, 0.22]) add(new THREE.SphereGeometry(0.11, 6, 4), flat(k % 2 ? 0xf2ead8 : 0x1f1d1b, 0.5), sx, 0.75 + k * 1.15, 0.58 - k * 0.03, pole);
        add(new THREE.BoxGeometry(0.5, 0.1, 0.12), flat(k % 2 ? 0x1f1d1b : 0xf2ead8, 0.5), 0, 0.42 + k * 1.15, 0.6 - k * 0.03, pole);
      }
      const top = 0.6 + 6 * 1.15;
      add(new THREE.BoxGeometry(3.6, 0.5, 0.18), flat(0x1f1d1b, 0.7), 0, top - 0.6, 0.1, pole);
      add(new THREE.BoxGeometry(3.0, 0.3, 0.2), flat(0xb8362c, 0.7), 0, top - 0.25, 0.1, pole);
      add(new THREE.ConeGeometry(0.28, 1.2, 6), flat(0x1f1d1b, 0.6), 0, top - 0.1, 0.85, pole).rotation.x = Math.PI / 2;
      g.add(pole);
      solid(tx, tz, 0.9);
      for (let i = 0; i < 6; i++) {
        const p = spot(1.6);
        if (p && Math.hypot(p[0] - tx, p[1] - tz) > 5) pine(p[0], p[1], 0.6 + rng() * 0.5);
      }
      for (let i = 0; i < 8; i++) {
        const p = spot(0.3);
        if (p) boulder(p[0], p[1], 0.9 + rng() * 1.6);
      }
    }
    // Оливковий острів: стара кам'яна криниця біля гаю (там і канотьє)
    if (d.id === 'isl-olive') {
      let wx = d.x - 5, wz = d.z + 8;
      for (let i = 0; i < 30 && at(wx, wz) < 1.2; i++) { wx += (d.x - wx) * 0.2; wz += (d.z - wz) * 0.2; }
      const wy = at(wx, wz);
      const stone = new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
      add(new THREE.CylinderGeometry(0.95, 1.05, 0.9, 12, 1, true), stone, wx, wy + 0.35, wz);
      add(new THREE.TorusGeometry(1.0, 0.12, 5, 14), stone, wx, wy + 0.8, wz).rotation.x = Math.PI / 2;
      add(new THREE.CircleGeometry(0.92, 12), flat(0x1f3b4a, 0.2), wx, wy + 0.25, wz).rotation.x = -Math.PI / 2;
      for (const sx of [-0.9, 0.9]) add(new THREE.CylinderGeometry(0.06, 0.06, 1.9, 5), flat(0x6a5a46), wx + sx, wy + 1.3, wz);
      add(new THREE.CylinderGeometry(0.06, 0.06, 1.9, 5), flat(0x6a5a46), wx, wy + 2.2, wz).rotation.z = Math.PI / 2;
      const roof = add(new THREE.ConeGeometry(1.5, 0.7, 4), flat(0xa9442f, 0.8), wx, wy + 2.6, wz);
      roof.rotation.y = Math.PI / 4;
      add(new THREE.CylinderGeometry(0.16, 0.13, 0.25, 8), flat(0x6e5036), wx + 0.3, wy + 1.4, wz);
      solid(wx, wz, 1.2);
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
    } else if (f.kind === 'relic') {
      // амфора: пузате тіло, вузька шийка, дві ручки
      const clay = new THREE.MeshStandardMaterial({ color: 0xb5643a, roughness: 0.85 });
      const body = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.02, -0.3), new THREE.Vector2(0.12, -0.22), new THREE.Vector2(0.2, 0.0), new THREE.Vector2(0.17, 0.18), new THREE.Vector2(0.07, 0.3), new THREE.Vector2(0.06, 0.46), new THREE.Vector2(0.08, 0.5)], 14), clay);
      g.add(body);
      for (const sx of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 5, 8, Math.PI), clay);
        h.position.set(sx * 0.1, 0.36, 0);
        h.rotation.z = sx * -Math.PI / 2;
        g.add(h);
      }
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.04, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.8 }));
      band.position.y = 0.02;
      g.add(band);
      g.rotation.z = 0.3;
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
  update(dt: number, t: number, found: readonly string[], cam?: THREE.Vector3) {
    if (cam) {
      for (const c of this.chunks) {
        const vis = Math.hypot(cam.x - c.x, cam.z - c.z) < 1500 + c.r;
        if (c.objs[0].visible !== vis) for (const o of c.objs) o.visible = vis;
      }
    }
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
    const label = f.kind === 'hat' ? L(`Підняти: ${HAT_BY_ID[f.hat!].name.toLowerCase()}`, `Pick up: ${HAT_BY_ID[f.hat!].name.toLowerCase()}`) : f.kind === 'bottle' ? L('Підняти пляшку із запискою', `Pick up the bottle with a note`) : f.kind === 'relic' ? L('Підняти амфору', `Pick up the amphora`) : L('Відкрити стару скриню', `Open the old chest`);
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
