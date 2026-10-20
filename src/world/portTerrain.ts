import * as THREE from 'three';
import { Batch, T, fbm, noise2, smoothstep } from './portKit';
import { groundDetailTex } from './textures';
import { islandHeight } from './islandShape';

// ─────────────────────────────────────────────────────────────
// Рельєф узбережжя: рівне плато містечка (x −60..60, z −130..−40, y 1.6),
// кам'яна набережна спереду, піщані пляжі по боках, пагорби й гори позаду,
// ліси (інстансинг), скелі в морі та далекі острови.
// ─────────────────────────────────────────────────────────────

export const GROUND_Y = 1.6;
export const PLATEAU = { x0: -60, x1: 60, z0: -130, z1: -40 };

const EXT_X = 470;
const EXT_Z0 = -20;
const EXT_Z1 = -740;

/** лінія берега за межами набережної — плавно відступає вглиб (бухта) */
export function coastZ(x: number): number {
  const a = Math.max(0, Math.abs(x) - 60);
  return -40 - 0.12 * a - 0.0016 * a * a;
}

/** висота землі (світові координати) */
export function terrainHeight(x: number, z: number): number {
  const ax = Math.abs(x);
  // заглиблення під сходи з причалу на набережну
  if (ax <= 25 && z <= PLATEAU.z1 && z >= -41.55) return 1.1;
  if (ax <= PLATEAU.x1 && z >= PLATEAU.z0 && z <= PLATEAU.z1) return GROUND_Y;
  // дно перед набережною (гавань); далі в морі — глибшає, і там можуть бути
  // острови та суходоли інших портів (раніше смуга до краю мапи їх «стирала»)
  if (ax <= PLATEAU.x1 && z > PLATEAU.z1) {
    const h = -4.5 - 2.5 * smoothstep(PLATEAU.z1 + 120, PLATEAU.z1 + 260, z);
    return z < PLATEAU.z1 + 120 ? h : Math.max(h, islandHeight(x, z));
  }
  const dx = Math.max(0, ax - PLATEAU.x1);
  const dz = Math.max(0, PLATEAU.z0 - z, z - PLATEAU.z1);
  const d = Math.hypot(dx, dz);
  // пагорби довкола плато + гірський хребет далі вглиб
  const n = fbm(x * 0.006 + 3.3, z * 0.006 - 5.1, 4);
  const ridge = fbm(x * 0.0032 - 7, z * 0.0032 + 2, 3);
  const H =
    GROUND_Y +
    smoothstep(3, 70, d) * (5 + 34 * n) +
    smoothstep(40, 330, -z + PLATEAU.z0) * (22 + 55 * ridge);
  // берег: пологий пляж, далі — крутіший схил
  const s = coastZ(x) - z;
  const shore = -3.2 + s * 0.3 + Math.max(0, s - 14) * 0.55 + (fbm(x * 0.05, z * 0.05, 2) - 0.5) * 1.0;
  let h = Math.min(H, shore);
  // краї мапи тонуть у морі (острів, а не обрізаний край); далі — глибоке море
  // (−12 м: не «мілина» для прибою й хвиль, коли мапа дна покриває весь світ)
  const e = smoothstep(EXT_X, EXT_X - 170, ax) * smoothstep(EXT_Z1, EXT_Z1 + 160, z);
  h = -12 + (h + 12) * e;
  // острови в морі (islandShape.ts)
  return Math.max(h, islandHeight(x, z));
}

const C = (hex: number) => new THREE.Color(hex);
const COL = {
  sand: C(0xdcc9a0),
  wetSand: C(0xa39274),
  seabed: C(0x5d6655),
  grassA: C(0x6f9447),
  grassB: C(0x557a37),
  dry: C(0xa3a062),
  dirt: C(0x8b7657),
  rock: C(0x84817a),
  rockDark: C(0x5f5d58),
  snowy: C(0xb7b8ad),
};

export function buildTerrain(parent: THREE.Object3D): THREE.Mesh {
  // нерівномірна сітка: додаткові ряди біля набережної, щоб стіна була вертикальною
  const xs: number[] = [];
  for (let x = -EXT_X; x <= EXT_X + 0.01; x += 5) xs.push(x);
  xs.push(-60.1, 60.1, -25.1, 25.1);
  xs.sort((a, b) => a - b);
  const zs: number[] = [];
  for (let z = EXT_Z0; z >= EXT_Z1 - 0.01; z -= 5) zs.push(z);
  zs.push(-39.9, -41.5, -41.6);
  zs.sort((a, b) => b - a);

  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const tmp = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const z = zs[j];
      const h = terrainHeight(x, z);
      const k = j * nx + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      uv[k * 2] = x / 6;
      uv[k * 2 + 1] = z / 6;
      // колір
      const hx = terrainHeight(x + 2, z) - terrainHeight(x - 2, z);
      const hz = terrainHeight(x, z + 2) - terrainHeight(x, z - 2);
      const slope = Math.hypot(hx, hz) / 4;
      const onPlateau = Math.abs(x) <= 60.05 && z >= -130 && z <= -40;
      const nGrass = fbm(x * 0.02, z * 0.02, 3);
      tmp.copy(COL.grassA).lerp(COL.grassB, smoothstep(0.35, 0.7, nGrass));
      tmp.lerp(COL.dry, smoothstep(0.62, 0.8, fbm(x * 0.013 + 9, z * 0.013, 2)) * 0.7);
      if (onPlateau) {
        // витоптані плями біля будинків
        tmp.lerp(COL.dirt, smoothstep(0.6, 0.78, fbm(x * 0.05 + 2, z * 0.05 - 1, 2)) * 0.55);
      } else {
        const s = coastZ(x) - z;
        // пісок біля води
        const sandy = smoothstep(2.6, 1.3, h) * smoothstep(40, 18, s);
        tmp.lerp(COL.sand, sandy);
        if (h < 0.35) tmp.copy(COL.wetSand).lerp(COL.seabed, smoothstep(0.2, -2.5, h));
        // скелі на крутих схилах і високо в горах
        const rocky = Math.max(smoothstep(0.45, 0.85, slope), smoothstep(45, 75, h) * 0.8);
        tmp.lerp(noise2(x * 0.1, z * 0.1) > 0.5 ? COL.rock : COL.rockDark, rocky);
        tmp.lerp(COL.snowy, smoothstep(70, 95, h) * 0.6);
      }
      col[k * 3] = tmp.r;
      col[k * 3 + 1] = tmp.g;
      col[k * 3 + 2] = tmp.b;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // повністю підводні квадрати не потрібні
      const minH = Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1], pos[d * 3 + 1]);
      if (minH < -4) continue;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: groundDetailTex(),
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  parent.add(mesh);
  return mesh;
}

// ── дерева (InstancedMesh) ──

function colorize(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = ng.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return ng;
}

function pineGeo(): THREE.BufferGeometry {
  const parts = [
    colorize(new THREE.CylinderGeometry(0.16, 0.24, 2.0, 6).translate(0, 1.0, 0), 0x5a4030),
    colorize(new THREE.ConeGeometry(2.0, 3.4, 7).translate(0, 2.9, 0), 0x2f5a35),
    colorize(new THREE.ConeGeometry(1.6, 3.0, 7).translate(0, 4.5, 0), 0x356540),
    colorize(new THREE.ConeGeometry(1.1, 2.6, 7).translate(0, 6.0, 0), 0x3b6e46),
  ];
  return mergeSimple(parts);
}

function leafyGeo(): THREE.BufferGeometry {
  const crown = new THREE.IcosahedronGeometry(1.9, 1);
  // трохи «пом'ятої» крони
  const p = crown.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.85 + noise2(x * 1.3 + 5, z * 1.3 + y) * 0.3;
    p.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  const parts = [
    colorize(new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6).translate(0, 1.2, 0), 0x5e4532),
    colorize(crown.translate(0, 3.6, 0), 0x5f8a3c),
    colorize(new THREE.IcosahedronGeometry(1.2, 1).translate(0.9, 4.4, 0.3), 0x6c9845),
  ];
  return mergeSimple(parts);
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const b = new THREE.BufferGeometry();
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    p.computeVertexNormals();
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  b.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  b.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  b.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return b;
}

export interface TreeSpot {
  x: number;
  z: number;
  s: number;
  leafy: boolean;
}

/** розкидає дерева по пагорбах + додає явно задані (у містечку) */
export function buildTrees(parent: THREE.Object3D, rng: () => number, extra: TreeSpot[], avoid: (x: number, z: number) => boolean): void {
  const spots: TreeSpot[] = [...extra];
  let tries = 0;
  while (spots.length < 1300 && tries < 20000) {
    tries++;
    const x = (rng() * 2 - 1) * (EXT_X - 60);
    const z = PLATEAU.z1 - 10 - rng() * (PLATEAU.z1 - EXT_Z1 - 110);
    if (Math.abs(x) < 66 && z > PLATEAU.z0 - 6) continue;
    const h = terrainHeight(x, z);
    if (h < 3.2 || h > 80) continue;
    const slope = Math.hypot(terrainHeight(x + 2, z) - terrainHeight(x - 2, z), terrainHeight(x, z + 2) - terrainHeight(x, z - 2)) / 4;
    if (slope > 0.7) continue;
    // ліс плямами
    const dens = fbm(x * 0.012 + 40, z * 0.012 - 13, 3);
    if (dens < 0.47 + rng() * 0.12) continue;
    if (avoid(x, z)) continue;
    spots.push({ x, z, s: 0.8 + rng() * 0.7, leafy: h < 25 ? rng() < 0.45 : rng() < 0.12 });
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
  const make = (geo: THREE.BufferGeometry, list: TreeSpot[]) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    list.forEach((t, i) => {
      const y = terrainHeight(t.x, t.z) - 0.2;
      m.copy(T(t.x, y, t.z, rng() * Math.PI * 2, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08, t.s, t.s * (0.9 + rng() * 0.25), t.s));
      im.setMatrixAt(i, m);
      const v = 0.82 + rng() * 0.3;
      c.setRGB(v, v * (0.95 + rng() * 0.1), v * 0.95);
      im.setColorAt(i, c);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    parent.add(im);
  };
  make(pineGeo(), spots.filter((s) => !s.leafy));
  make(leafyGeo(), spots.filter((s) => s.leafy));
}

// ── скелі в морі та острови ──

export const ROCK_TOP = new THREE.Color(0x77726a);
const ROCK_MID = new THREE.Color(0x56585a);
const ROCK_WET = new THREE.Color(0x2c302f);
const ALGAE = new THREE.Color(0x3f4a2e);
const GUANO = new THREE.Color(0xe6e4dc);

/** скеля: деформований ікосаедр із вертикальним градієнтом кольору (мокрий низ, світлий верх) */
export function rockGeo(r: number, hScale: number, seed: number, detail = 2, cap?: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = p.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.72 + fbm(x * 1.6 + seed, z * 1.6 + y * 1.3 - seed, 3) * 0.6;
    let yy = y * k;
    if (yy < -0.2) yy = -0.2 + (yy + 0.2) * 0.4; // плаский низ
    p.setXYZ(i, x * k * r, yy * r * hScale, z * k * r);
  }
  // кольори за висотою відносно води (y ≈ −0.35·r·hScale з урахуванням зсуву при розміщенні)
  for (let i = 0; i < n; i++) {
    const t = (p.getY(i) / (r * hScale) + 0.35) / 1.35; // 0 — вода, 1 — верх
    c.copy(ROCK_WET).lerp(ALGAE, smoothstep(0.0, 0.1, t) * 0.5);
    c.lerp(ROCK_MID, smoothstep(0.08, 0.35, t));
    c.lerp(ROCK_TOP, smoothstep(0.4, 0.9, t));
    if (cap) c.lerp(cap, smoothstep(0.55, 0.95, t) * 0.85);
    else if (t > 0.75 && noise2(p.getX(i) * 0.8 + seed, p.getZ(i) * 0.8) > 0.6) c.lerp(GUANO, 0.7);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function addSeaRocks(batch: Batch, mat: THREE.Material, spots: Array<[number, number, number]>, rng: () => number): void {
  for (const [rx, rz, r] of spots) {
    const hs = 1.25 + rng() * 0.6;
    batch.add(rockGeo(r, hs, rng() * 100), mat, T(rx, -r * hs * 0.35, rz, rng() * Math.PI));
    // супутні камені
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const dd = r * (0.75 + rng() * 0.35);
      const rr = r * (0.22 + rng() * 0.25);
      batch.add(rockGeo(rr, 0.8 + rng() * 0.5, rng() * 100, 1), mat, T(rx + Math.cos(a) * dd, -rr * 0.3, rz + Math.sin(a) * dd, rng() * 6));
    }
  }
}

const ISLE_GREEN = new THREE.Color(0x4d6e45);

export function addIslands(batch: Batch, mat: THREE.Material, islands: Array<[number, number, number, number]>, rng: () => number): void {
  for (const [ix, iz, ir, ih] of islands) {
    batch.add(rockGeo(ir, ih / ir, rng() * 100, 4, ISLE_GREEN), mat, T(ix, -ih * 0.3, iz, rng() * Math.PI), false);
    batch.add(rockGeo(ir * 0.55, (ih * 0.8) / (ir * 0.55), rng() * 100, 3, ISLE_GREEN), mat, T(ix + ir * 0.45, -ih * 0.2, iz + ir * 0.2, rng() * Math.PI), false);
  }
}
