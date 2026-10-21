import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { Batch, T, boxGeo, cylGeo, fbm, noise2, smoothstep } from './portKit';
import { CONTINENTS, CONT_BOXES, CONT_PORTS, continentHeight, contInside, type ContinentDef } from './continents';
import { PORT_SITES } from './portSites';
import { ISLAND_SOLIDS } from './islandShape';
import { glowTex } from './textures';
import { addCloudUniforms } from './clouds';

// ─────────────────────────────────────────────────────────────
// Вигляд континентів: рельєф одним мешем (крок 10 м, дрібніше — гавані
// ports.ts), ліси інстансингом тайлами по 500 м (далекі тайли ховаємо),
// містечка (злиття Batch) і маяки на мисах. Матеріали з «далеким туманом»:
// звичайний FogExp2 ховає все за ~1 км, а гори континенту мають бути видно
// з океану силуетом — туман тут має стелю (повітряна перспектива).
// ─────────────────────────────────────────────────────────────

/** туман зі стелею: зблизька — як у решти сцени, здалеку — силует у серпанку */
export function farFog<M extends THREE.Material>(mat: M): M {
  mat.onBeforeCompile = (sh) => {
    // тіні хмар: глобальний патч освітлення читає ці uniform-и
    addCloudUniforms(sh.uniforms);
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fdd = vFogDepth * fogDensity;
    float fogF = 1.0 - exp(-fdd * fdd);
  #else
    float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  fogF = min(fogF, 0.8 + 0.15 * (1.0 - exp(-vFogDepth / 4000.0)));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogF);
#endif`,
    );
  };
  mat.customProgramCacheKey = () => 'farfog';
  return mat;
}

const STEP = 10;
const TILE = 500;
/** призма даху: вісь — x, вершина трикутника вгору (y −0.5..1), ширина 1.732 */
const ROOF_PRISM = new THREE.CylinderGeometry(1, 1, 1, 3, 1, false, Math.PI / 2).rotateZ(Math.PI / 2);

interface TreeTile {
  meshes: THREE.InstancedMesh[];
  /** ті самі дерева без стовбура (далеко — стовбур під кроною менший за піксель) */
  far: THREE.InstancedMesh[];
  cx: number;
  cz: number;
  isFar: boolean;
}

export class ContinentScenery {
  readonly group = new THREE.Group();
  private tiles: TreeTile[] = [];
  private lanterns: Array<{ s: THREE.Sprite; phase: number; pos: THREE.Vector3 }> = [];
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private night = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < CONTINENTS.length; i++) this.build(CONTINENTS[i], i);
    scene.add(this.group);
  }

  private build(c: ContinentDef, i: number) {
    const rng = mulberry32(Math.floor(c.seed * 1000));
    const g = new THREE.Group();
    g.add(this.terrain(c, i));
    const towns = this.towns(c, rng, g);
    this.forests(c, i, rng, towns);
    this.group.add(g);
  }

  // ───────────────────────── рельєф ─────────────────────────

  private terrain(c: ContinentDef, i: number): THREE.Mesh {
    const [x0, z0, x1, z1] = CONT_BOXES[i];
    const nx = Math.ceil((x1 - x0) / STEP) + 1, nz = Math.ceil((z1 - z0) / STEP) + 1;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const hs = new Float32Array(nx * nz);
    const med = c.style === 'med';
    const C = (h: number) => new THREE.Color(h);
    const P = med
      ? { sand: C(0xf0dcb0), grassA: C(0xc4ab62), grassB: C(0x9c9a52), maquis: C(0x6a7a3e), terrace: C(0xa88f4e), rock: C(0xc9b38a), rockD: C(0xa8916c), high: C(0xddd3c2), snow: C(0xddd3c2), bed: C(0xc7d9c0), wet: C(0xd8c9a0) }
      : { sand: C(0x9c9a92), grassA: C(0x4d6b3e), grassB: C(0x3a5533), maquis: C(0x2f4a2c), terrace: C(0x3f5a35), rock: C(0x7f8384), rockD: C(0x5f6366), high: C(0x8e9294), snow: C(0xf1f4f7), bed: C(0x5d6655), wet: C(0x6f6d66) };
    // гавані континенту: тут рельєф малює ports.ts (дрібніше) — не дублюємо
    const holes = PORT_SITES.filter((p) => p.cont === c.id).map((p) => {
      const R = p.R * Math.sqrt(p.elong) * 1.7 + 24 - STEP;
      return [p.x - R, p.z - R, p.x + R, p.z + R];
    });
    const col3 = new THREE.Color();
    for (let j = 0; j < nz; j++) {
      for (let k = 0; k < nx; k++) {
        const x = x0 + k * STEP, z = z0 + j * STEP;
        const h = continentHeight(x, z);
        const o = j * nx + k;
        hs[o] = h;
        pos[o * 3] = x;
        pos[o * 3 + 1] = h;
        pos[o * 3 + 2] = z;
      }
    }
    const H = (k: number, j: number) => hs[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, k))];
    for (let j = 0; j < nz; j++) {
      for (let k = 0; k < nx; k++) {
        const o = j * nx + k;
        const x = x0 + k * STEP, z = z0 + j * STEP;
        const h = hs[o];
        const sl = Math.hypot(H(k + 1, j) - H(k - 1, j), H(k, j + 1) - H(k, j - 1)) / (2 * STEP);
        const n = fbm(x * 0.01 + c.seed, z * 0.01, 3);
        const cc = col3.copy(P.grassA).lerp(P.grassB, smoothstep(0.35, 0.7, n));
        // плями чагарників / підлісок
        cc.lerp(P.maquis, smoothstep(0.55, 0.75, fbm(x * 0.006 - c.seed, z * 0.006 + 3, 3)) * 0.7);
        if (med && h > 8 && h < 80 && sl > 0.1 && sl < 0.6) {
          // тераси на схилах: смуги кожні ~3 м висоти
          if (Math.floor(h / 3) % 2 === 0) cc.lerp(P.terrace, 0.45);
        }
        // пісок біля води
        cc.lerp(P.sand, smoothstep(med ? 2.4 : 1.6, med ? 1.1 : 0.6, h));
        // скелі на кручах і на висоті
        const rockK = Math.max(smoothstep(0.5, 0.9, sl), smoothstep(med ? 90 : 110, med ? 140 : 170, h) * 0.8);
        cc.lerp(noise2(x * 0.05, z * 0.05) > 0.5 ? P.rock : P.rockD, rockK);
        // високогір'я: Середземномор'я — світлий вапняк, Північ — сніг
        if (!med) {
          const snowLine = 200 + (fbm(x * 0.004, z * 0.004 + 9, 3) - 0.5) * 60;
          cc.lerp(P.snow, smoothstep(snowLine, snowLine + 25, h) * (1 - smoothstep(0.9, 1.3, sl) * 0.5));
        } else cc.lerp(P.high, smoothstep(120, 150, h) * 0.6);
        if (h < 0.4) cc.copy(P.wet).lerp(P.bed, smoothstep(0.2, -4, h));
        col[o * 3] = cc.r;
        col[o * 3 + 1] = cc.g;
        col[o * 3 + 2] = cc.b;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let k = 0; k < nx - 1; k++) {
        const a = j * nx + k, b = a + 1, cc = a + nx, dd = cc + 1;
        if (Math.max(hs[a], hs[b], hs[cc], hs[dd]) < -12) continue;
        const cx = x0 + (k + 0.5) * STEP, cz = z0 + (j + 0.5) * STEP;
        if (holes.some((r) => cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3])) continue;
        idx.push(a, cc, b, b, cc, dd);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, farFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })));
    m.receiveShadow = true;
    return m;
  }

  // ───────────────────────── містечка ─────────────────────────

  /** скупчення будиночків на схилах біля берега; повертає зайняті кола (без лісу) */
  private towns(c: ContinentDef, rng: () => number, g: THREE.Group): Array<[number, number, number]> {
    const med = c.style === 'med';
    const batch = new Batch();
    const std = (color: number, rough = 0.85) => farFog(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }));
    const walls = med ? [std(0xf6f3ec), std(0xf6f3ec), std(0xf1e6cc), std(0xeccf9a), std(0xf0ddd0)] : [std(0xa9442f), std(0x8d8f8a), std(0x5e4a3a), std(0xd2a548), std(0xb7b0a2)];
    const roofs = med ? [std(0xc9694a), std(0xb85c3e)] : [std(0x3e454c), std(0x4a4f55), std(0x5d6670)];
    const flatRoof = std(0xe9e4d8);
    const blue = std(0x2f6fb5, 0.5);
    const doorM = med ? blue : std(0x3a2a1e);
    const stoneM = std(med ? 0xc9b38a : 0x7f8384, 0.95);
    const used: Array<[number, number, number]> = [];
    const ports = PORT_SITES.filter((p) => p.cont === c.id);
    const nearPort = (x: number, z: number, r: number) => ports.some((p) => Math.hypot(x - p.x, z - p.z) < p.R * 1.6 + r);
    const m = c.m;
    // кандидати: точки біля берега (у межах 80–420 м углиб), не круто
    const centers: Array<[number, number]> = [];
    for (let t = 0; t < 900 && centers.length < (med ? 9 : 7); t++) {
      const a = rng() * Math.PI * 2;
      const x = m.x + Math.cos(a) * m.rx * (0.55 + rng() * 0.6), z = m.z + Math.sin(a) * m.rz * (0.55 + rng() * 0.6);
      const s = contInside(c, x, z);
      if (s < 60 || s > 420) continue;
      const h = continentHeight(x, z);
      if (h < 4 || h > 70) continue;
      if (nearPort(x, z, 140) || centers.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 420)) continue;
      centers.push([x, z]);
    }
    for (const [cx, cz] of centers) {
      const n = 10 + Math.floor(rng() * 14);
      let placed = 0;
      for (let t = 0; t < n * 6 && placed < n; t++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 70;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const w = 4 + rng() * 3.5, d = 4 + rng() * 2.5, R = Math.max(w, d) * 0.6 + 1;
        if (used.some(([ux, uz, ur]) => Math.hypot(x - ux, z - uz) < R + ur)) continue;
        const hs = [continentHeight(x - w / 2, z - d / 2), continentHeight(x + w / 2, z - d / 2), continentHeight(x - w / 2, z + d / 2), continentHeight(x + w / 2, z + d / 2)];
        const lo = Math.min(...hs), hi = Math.max(...hs);
        if (lo < 1.2 || hi - lo > 3.2) continue;
        used.push([x, z, R]);
        placed++;
        // обличчям — до моря (від центру континенту)
        const ry = Math.atan2(x - m.x, z - m.z) + (rng() - 0.5) * 0.5;
        const hh = 3 + rng() * (med ? 3 : 2.2);
        const wall = walls[Math.floor(rng() * walls.length)];
        batch.add(boxGeo(w + 0.3, hi - lo + 0.9, d + 0.3, 1.5), stoneM, T(x, (lo + hi) / 2 - 0.4, z, ry));
        batch.add(boxGeo(w, hh, d, 2), wall, T(x, hi + hh / 2, z, ry));
        const fx = Math.sin(ry) * (d / 2 + 0.03), fz = Math.cos(ry) * (d / 2 + 0.03);
        batch.add(boxGeo(0.9, 1.9, 0.06), doorM, T(x + fx, hi + 0.95, z + fz, ry));
        if (med && rng() < 0.6) {
          // грецький пласкодах із бортиком; інколи — блакитний купол
          batch.add(boxGeo(w + 0.2, 0.25, d + 0.2), flatRoof, T(x, hi + hh + 0.12, z, ry));
          if (rng() < 0.18) {
            batch.add(cylGeo(1.0, 1.0, 0.6, 12), walls[0], T(x, hi + hh + 0.5, z));
            batch.add(new THREE.SphereGeometry(1.05, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), blue, T(x, hi + hh + 0.8, z));
          }
        } else {
          // двосхилий дах (Італія — теракота; Північ — темний, крутий)
          const rh = med ? 1.1 : 2.0;
          // трикутна призма: гребінь уздовж x (довжина будинку), вершина вгору
          const sy = rh / 1.5;
          batch.add(ROOF_PRISM, roofs[Math.floor(rng() * roofs.length)], T(x, hi + hh + 0.5 * sy, z, ry, 0, 0, w + 0.6, sy, (d + 0.8) / 1.732));
          if (!med && rng() < 0.35) batch.add(boxGeo(0.6, 2.2, 0.6), stoneM, T(x + Math.cos(ry) * w * 0.3, hi + hh + 0.8, z - Math.sin(ry) * w * 0.3));
        }
        ISLAND_SOLIDS.push({ x, z, r: Math.min(w, d) * 0.55 });
      }
      used.push([cx, cz, 85]);
    }
    // маяки на двох найдальших мисах (видно здалеку, уночі — вогник)
    const capes: Array<[number, number, number]> = [];
    for (let t = 0; t < 360; t++) {
      const a = (t / 360) * Math.PI * 2;
      let x = m.x + Math.cos(a) * m.rx * 0.6, z = m.z + Math.sin(a) * m.rz * 0.6;
      for (let k = 0; k < 400 && contInside(c, x, z) > 6; k++) {
        x += Math.cos(a) * 4;
        z += Math.sin(a) * 4;
      }
      const s = Math.hypot((x - m.x) / m.rx, (z - m.z) / m.rz);
      capes.push([x, z, s]);
    }
    capes.sort((a, b) => b[2] - a[2]);
    const lights: Array<[number, number]> = [];
    for (const [x, z] of capes) {
      if (lights.length >= 2) break;
      if (lights.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 900) || nearPort(x, z, 200)) continue;
      // крок углиб — на суху скелю
      const k = Math.atan2(z - m.z, x - m.x);
      const px = x - Math.cos(k) * 10, pz = z - Math.sin(k) * 10;
      lights.push([px, pz]);
      const y0 = continentHeight(px, pz) - 0.3;
      const band = med ? blue : std(0xc23a2c, 0.6);
      const white = std(0xf2f1ec, 0.6);
      for (let q = 0; q < 6; q++) batch.add(cylGeo(1.4 - q * 0.12, 1.52 - q * 0.12, 2.4, 14), q % 2 ? band : white, T(px, y0 + 1.2 + q * 2.4, pz));
      const lensM = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe39a, emissiveIntensity: 0.4, roughness: 0.1 });
      this.glowMats.push(lensM);
      batch.add(cylGeo(0.8, 0.8, 1.3, 10), lensM, T(px, y0 + 15.2, pz));
      batch.add(new THREE.ConeGeometry(1.05, 1.2, 10), std(0x24292d, 0.5), T(px, y0 + 16.4, pz));
      ISLAND_SOLIDS.push({ x: px, z: pz, r: 1.8 });
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      const pos = new THREE.Vector3(px, y0 + 15.2, pz);
      s.position.copy(pos);
      s.scale.setScalar(12);
      g.add(s);
      this.lanterns.push({ s, phase: rng() * 6, pos });
    }
    batch.build(g);
    return used;
  }

  // ───────────────────────── ліси ─────────────────────────

  private forests(c: ContinentDef, i: number, rng: () => number, towns: Array<[number, number, number]>) {
    const med = c.style === 'med';
    const [x0, z0, x1, z1] = CONT_BOXES[i];
    const ports = CONT_PORTS.filter((p) => p.cont === c.id);
    // шаблони: Північ — ялиця; Середземномор'я — кипарис і олива (вершинні кольори)
    const kinds = med ? [cypressGeo(), oliveGeo()] : [firGeo(), firGeo(0.75)];
    const farKinds = med ? [cypressGeo(false), oliveGeo(false)] : [firGeo(1, false), firGeo(0.75, false)];
    const mat = farFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
    const nTx = Math.ceil((x1 - x0) / TILE), nTz = Math.ceil((z1 - z0) / TILE);
    const buckets: Array<Array<Array<THREE.Matrix4>>> = [];
    for (let t = 0; t < nTx * nTz; t++) buckets.push(kinds.map(() => []));
    const gap = med ? 15 : 11;
    const q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    for (let z = z0; z < z1; z += gap) {
      for (let x = x0; x < x1; x += gap) {
        const px = x + (rng() - 0.5) * gap * 0.9, pz = z + (rng() - 0.5) * gap * 0.9;
        const h = continentHeight(px, pz);
        if (h < (med ? 3.5 : 2.6)) continue;
        if (med ? h > 125 : h > 175 + (fbm(px * 0.004, pz * 0.004 + 9, 3) - 0.5) * 50) continue;
        const sl = Math.hypot(continentHeight(px + 3, pz) - continentHeight(px - 3, pz), continentHeight(px, pz + 3) - continentHeight(px, pz - 3)) / 6;
        if (sl > (med ? 0.55 : 0.75)) continue;
        const mask = fbm(px * 0.005 + c.seed * 3, pz * 0.005 - c.seed, 3);
        if (mask < (med ? 0.52 : 0.4)) continue;
        if (towns.some(([tx, tz, tr]) => Math.hypot(px - tx, pz - tz) < tr)) continue;
        if (ports.some((p) => Math.hypot(px - p.x, pz - p.z) < 120)) continue;
        const kind = med ? (rng() < 0.4 ? 0 : 1) : rng() < 0.7 ? 0 : 1;
        const s = (med ? 0.8 : 0.85) + rng() * 0.6;
        e.set(0, rng() * Math.PI * 2, 0);
        q.setFromEuler(e);
        sv.set(s, s * (0.9 + rng() * 0.25), s);
        pv.set(px, h - 0.3, pz);
        const ti = Math.min(nTz - 1, Math.floor((pz - z0) / TILE)) * nTx + Math.min(nTx - 1, Math.floor((px - x0) / TILE));
        buckets[ti][kind].push(new THREE.Matrix4().compose(pv, q, sv));
      }
    }
    const tint = new THREE.Color();
    for (let t = 0; t < buckets.length; t++) {
      const meshes: THREE.InstancedMesh[] = [];
      const far: THREE.InstancedMesh[] = [];
      buckets[t].forEach((list, k) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(kinds[k], mat, list.length);
        list.forEach((mm, n) => {
          im.setMatrixAt(n, mm);
          tint.setHSL(0, 0, 0.85 + rng() * 0.3);
          im.setColorAt(n, tint);
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.receiveShadow = true;
        this.group.add(im);
        meshes.push(im);
        // далекий варіант — ті самі матриці й кольори (спільні буфери)
        const fm = new THREE.InstancedMesh(farKinds[k], mat, list.length);
        fm.instanceMatrix = im.instanceMatrix;
        fm.instanceColor = im.instanceColor;
        fm.boundingSphere = im.boundingSphere;
        fm.receiveShadow = true;
        fm.visible = false;
        this.group.add(fm);
        far.push(fm);
      });
      if (meshes.length) this.tiles.push({ meshes, far, cx: x0 + ((t % nTx) + 0.5) * TILE, cz: z0 + (Math.floor(t / nTx) + 0.5) * TILE, isFar: false });
    }
  }

  setNight(night: number) {
    if (Math.abs(night - this.night) < 0.01) return;
    this.night = night;
    for (const m of this.glowMats) m.emissiveIntensity = 0.4 + night * 2;
  }

  /** далекі тайли лісу не малюємо (за ~1,6 км дрібні дерева однаково зливаються в серпанку); вогники маяків блимають */
  update(t: number, cam: THREE.Vector3) {
    for (const tl of this.tiles) {
      const d = Math.hypot(cam.x - tl.cx, cam.z - tl.cz);
      const vis = d < 1600;
      // за ~600 м (з гістерезисом) — дерева без стовбура: стовбур під кроною там менший за піксель
      tl.isFar = tl.isFar ? d > 560 : d > 620;
      for (const m of tl.meshes) m.visible = vis && !tl.isFar;
      for (const m of tl.far) m.visible = vis && tl.isFar;
    }
    for (const l of this.lanterns) {
      const d = Math.hypot(cam.x - l.pos.x, cam.z - l.pos.z);
      const blink = 0.5 + 0.5 * Math.sin(t * 1.3 + l.phase);
      l.s.material.opacity = this.night * (0.35 + 0.65 * blink * blink);
      l.s.visible = this.night > 0.05;
      l.s.scale.setScalar(Math.min(90, 12 + d * 0.02));
    }
  }
}

// ── шаблони дерев (вершинні кольори, один матеріал) ──
// стовбури — без кришок: нижня під землею (дерево посаджене на 0,3 м глибше), верхня
// всередині крони — їх ніколи не видно, а на ~20 тис. дерев це ~200 тис. трикутників

function paint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const gg = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = gg.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  gg.setAttribute('color', new THREE.BufferAttribute(a, 3));
  gg.deleteAttribute('uv');
  return gg;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function firGeo(k = 1, withTrunk = true): THREE.BufferGeometry {
  const trunk = paint(new THREE.CylinderGeometry(0.2, 0.3, 2.2, 5, 1, true).translate(0, 1.1, 0), 0x5a4030);
  const a = paint(new THREE.ConeGeometry(2.4 * k, 4.6, 6).translate(0, 3.6, 0), 0x2c4f33);
  const b = paint(new THREE.ConeGeometry(1.7 * k, 4.0, 6).translate(0, 6.2, 0), 0x325a3b);
  const c = paint(new THREE.ConeGeometry(1.0 * k, 3.2, 6).translate(0, 8.4, 0), 0x386243);
  return merge(withTrunk ? [trunk, a, b, c] : [a, b, c]);
}

function cypressGeo(withTrunk = true): THREE.BufferGeometry {
  const trunk = paint(new THREE.CylinderGeometry(0.14, 0.18, 1.3, 5, 1, true).translate(0, 0.6, 0), 0x6a5a46);
  const crown = paint(new THREE.ConeGeometry(0.95, 8.2, 7).translate(0, 5.0, 0), 0x2f4f2c);
  return merge(withTrunk ? [trunk, crown] : [crown]);
}

function oliveGeo(withTrunk = true): THREE.BufferGeometry {
  const trunk = paint(new THREE.CylinderGeometry(0.16, 0.26, 1.6, 5, 1, true).translate(0, 0.75, 0), 0x6a5a46);
  const crown = paint(new THREE.IcosahedronGeometry(1.7, 0).scale(1.3, 0.75, 1.2).translate(0, 2.3, 0), 0x8a9a68);
  return merge(withTrunk ? [trunk, crown] : [crown]);
}
