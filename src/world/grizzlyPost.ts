import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { L } from '../core/i18n';
import { T, boxGeo, cylGeo } from './portKit';
import { buildCharacter, HAIRS, SKINS, type CharacterRig } from './character';
import { siteToWorld, siteRect } from './portSites';
import type { VillageCtx, VillageLife } from './kutVillage';
import { UNDERWATER_LAYER } from '../core/ocean';

// ─────────────────────────────────────────────────────────────
// Бухта Гризлі: далека факторія під снігами. За плато — частокіл зі
// сторожовою вежею, на плато — будки хаскі й сани, рами з хутром,
// іглу-льодовня, тотем, вогнище з казаном (біля нього бабця Нуна з
// люлькою), лавка траппера Сайласа. Навколо — ялини в снігу й кучугури,
// на косі бурий ведмідь ловить рибу. Уночі над бухтою — північне сяйво
// (кілька адитивних стрічок високо над суходолом — лише біля гавані,
// небо й хмари не чіпає). Статика — у Batch гавані; рухоме — окремо (noMerge).
// ─────────────────────────────────────────────────────────────

export const GRIZZLY_ID = 'port-grizzly';

/** координати гавані (a — до моря, b — уздовж набережної) */
const FIRE = { a: -15, b: -2.5 };
const IGLOO = { a: -20.5, b: 16 };
const TOWER = { a: -25.5, b: -33 };
const BEAR = { a: 0.5, b: -64 };
const TOTEM = { a: -4.2, b: -19.4 };
const KENNELS: Array<[number, number]> = [[-12.2, -18.4], [-9.6, -18.4]];
const RACKS: Array<[number, number]> = [[-19.6, -19], [-22.6, -16.5]];
const PALI = { a: -24.5, b0: -31, b1: 11 };

/** зони (a, b, r), де загальна забудова й ялиці гавані не ставляться */
export const GRIZZLY_ZONES: Array<[number, number, number]> = [
  [FIRE.a, FIRE.b, 3.6],
  [IGLOO.a, IGLOO.b, 3.2],
  [TOWER.a, TOWER.b, 3.4],
  [BEAR.a, BEAR.b, 4],
  [TOTEM.a, TOTEM.b, 1.5],
  ...KENNELS.map(([a, b]): [number, number, number] => [a, b, 1.6]),
  ...RACKS.map(([a, b]): [number, number, number] => [a, b, 2]),
  // частокіл — смуга точок
  ...Array.from({ length: 9 }, (_, i): [number, number, number] => [PALI.a, PALI.b0 + i * ((PALI.b1 - PALI.b0) / 8), 3]),
];

interface Npc {
  root: THREE.Object3D;
  lines: string[];
  line: number;
  bubble: THREE.Sprite;
  bubbleMat: THREE.SpriteMaterial;
  shown: number;
  near: boolean;
  headY: number;
}

/** кілька частин одним мешем: колір — у вершинах (один матеріал, один виклик малювання) */
function painted(parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4]>): THREE.BufferGeometry {
  const geos = parts.map(([geo, col, m]) => {
    const gg = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
    for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal') gg.deleteAttribute(k);
    const n = gg.attributes.position.count;
    const cc = new THREE.Color(col).convertSRGBToLinear();
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([cc.r, cc.g, cc.b], i * 3);
    gg.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
    return gg;
  });
  return mergeGeometries(geos)!;
}

function bubbleCanvas(text: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 640;
  cv.height = 120;
  const x = cv.getContext('2d')!;
  x.font = '700 34px Manrope, -apple-system, "Segoe UI", sans-serif';
  const tw = Math.min(600, x.measureText(text).width + 48);
  const x0 = (cv.width - tw) / 2;
  x.fillStyle = 'rgba(255,250,240,0.94)';
  x.strokeStyle = 'rgba(60,44,30,0.35)';
  x.lineWidth = 3;
  x.beginPath();
  x.roundRect(x0, 8, tw, 82, 26);
  x.fill();
  x.stroke();
  x.beginPath();
  x.moveTo(cv.width / 2 - 14, 88);
  x.lineTo(cv.width / 2, 112);
  x.lineTo(cv.width / 2 + 14, 88);
  x.fill();
  x.fillStyle = '#3b2a1d';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, cv.width / 2, 50, 580);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** сяйво: зелена завіса з вертикальними «променями», вгорі фіолетове, краї тануть */
function auroraTex(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const x = cv.getContext('2d')!;
  for (let i = 0; i < 512; i++) {
    const k = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(i * 0.05) * Math.sin(i * 0.013 + 1.7), 1.5) * (0.6 + 0.4 * Math.random());
    const gr = x.createLinearGradient(0, 128, 0, 0);
    gr.addColorStop(0, `rgba(80,255,170,0)`);
    gr.addColorStop(0.08, `rgba(90,255,170,${0.9 * k})`);
    gr.addColorStop(0.45, `rgba(60,230,150,${0.45 * k})`);
    gr.addColorStop(0.8, `rgba(150,90,220,${0.25 * k})`);
    gr.addColorStop(1, 'rgba(150,90,220,0)');
    x.fillStyle = gr;
    x.fillRect(i, 0, 1, 128);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildGrizzlyPost(c: VillageCtx): VillageLife {
  const { p, g, batch, M, H, solids, rng } = c;
  const W = (a: number, b: number) => siteToWorld(p, a, b);
  const ground = (a: number, b: number) => {
    const [x, z] = W(a, b);
    return H(x, z);
  };
  const ryA = Math.atan2(p.ox, p.oz); // локальний +Z → у море (+a), локальний +X → −b
  const at = (a: number, b: number, y: number, ry = ryA, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) => {
    const [x, z] = W(a, b);
    return T(x, y, z, ry, rx, rz, sx, sy, sz);
  };
  const solidCircle = (a: number, b: number, r: number) => {
    const [x, z] = W(a, b);
    solids.push({ x, z, r });
  };
  const solidAA = (a0: number, a1: number, b0: number, b1: number) => {
    const r = siteRect(p, a0, a1, b0, b1, 0);
    solids.push({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, hw: (r.x1 - r.x0) / 2, hd: (r.z1 - r.z0) / 2, ry: 0 });
  };
  const snow = M.whitePaint;
  const vcol = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, shadow = true) => batch.add(geo, vcol, m, shadow);

  const live = new THREE.Group();
  live.userData.noMerge = true;
  g.add(live);
  const smokeAt: THREE.Vector3[] = [];

  // ── частокіл із загострених колод (за плато) і сторожова вежа на розі ──
  {
    // колоди — тими самими матеріалами, що й ялини/дерево гавані (зливаються з їхніми викликами малювання)
    const logGeo = cylGeo(0.17, 0.19, 1, 7).translate(0, 0.5, 0);
    const tipGeo = new THREE.ConeGeometry(0.17, 0.42, 7).translate(0, 0.21, 0);
    const pale = (a: number, b: number, h: number) => {
      const y = ground(a, b) - 0.3;
      batch.add(logGeo, M.trunk, at(a, b, y, 0, 0, 0, 1, h, 1));
      batch.add(tipGeo, M.woodDark, at(a, b, y + h));
    };
    for (let b = PALI.b0; b <= PALI.b1; b += 0.4) pale(PALI.a, b, 2.8 + Math.sin(b * 2.3) * 0.2 + rng() * 0.25);
    // поперечина зсередини й шапка снігу на загостренням
    for (let b = PALI.b0; b < PALI.b1; b += 6) {
      const y = (ground(PALI.a + 0.3, b) + ground(PALI.a + 0.3, b + 6)) / 2;
      batch.add(boxGeo(0.14, 0.18, 6.2), M.woodDark, at(PALI.a + 0.28, b + 3, y + 1.6));
    }
    // поворот частоколу до моря на західному краю
    for (let a = PALI.a + 0.4; a <= PALI.a + 5; a += 0.4) pale(a, PALI.b0, 2.7 + rng() * 0.3);
    solidAA(PALI.a - 0.3, PALI.a + 0.3, PALI.b0, PALI.b1);
    solidAA(PALI.a, PALI.a + 5.2, PALI.b0 - 0.3, PALI.b0 + 0.3);

    // вежа: чотири стовпи, поміст, поручні, дах-піраміда зі снігом
    const y0 = Math.min(ground(TOWER.a - 1.3, TOWER.b - 1.3), ground(TOWER.a + 1.3, TOWER.b + 1.3), ground(TOWER.a, TOWER.b));
    const parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4]> = [];
    for (const [u, v] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) parts.push([boxGeo(0.24, 7.6, 0.24), 0x5e4630, T(u, 3.8, v)]);
    parts.push([boxGeo(3.4, 0.2, 3.4), 0x7a5a3c, T(0, 5.2, 0)]);
    for (const s of [-1, 1]) {
      parts.push([boxGeo(3.3, 0.9, 0.1), 0x6b4f36, T(0, 5.75, s * 1.6)]);
      parts.push([boxGeo(0.1, 0.9, 3.3), 0x6b4f36, T(s * 1.6, 5.75, 0)]);
    }
    // драбина
    parts.push([boxGeo(0.07, 5.3, 0.07), 0x5e4630, T(-0.35, 2.65, 1.75)], [boxGeo(0.07, 5.3, 0.07), 0x5e4630, T(0.35, 2.65, 1.75)]);
    for (let i = 0; i < 9; i++) parts.push([boxGeo(0.7, 0.06, 0.06), 0x7a5a3c, T(0, 0.4 + i * 0.58, 1.75)]);
    parts.push([new THREE.ConeGeometry(2.7, 1.8, 4), 0x3a3634, T(0, 8.5, 0, Math.PI / 4)]);
    parts.push([new THREE.ConeGeometry(2.0, 1.35, 4), 0xf2f4f6, T(0, 8.86, 0, Math.PI / 4)]);
    add(painted(parts), at(TOWER.a, TOWER.b, y0));
    solidCircle(TOWER.a, TOWER.b, 2);
    c.glow(...((): [number, number, number, number] => { const [x, z] = W(TOWER.a, TOWER.b); return [x, y0 + 6.6, z, 2.4]; })());
  }

  // ── будки хаскі й сани ──
  const kennelGeo = painted([
    [boxGeo(1.1, 0.8, 1.0), 0x8a6a46, T(0, 0.4, 0)],
    [boxGeo(0.46, 0.5, 0.05), 0x1d1611, T(0, 0.33, 0.51)],
    [boxGeo(1.3, 0.07, 0.68), 0x4a3a2c, T(0, 1.02, 0.24, 0, 0.55)],
    [boxGeo(1.3, 0.07, 0.68), 0x4a3a2c, T(0, 1.02, -0.24, 0, -0.55)],
    [boxGeo(1.25, 0.06, 0.5), 0xf2f4f6, T(0, 1.08, 0.2, 0, 0.55)],
    [boxGeo(1.25, 0.06, 0.5), 0xf2f4f6, T(0, 1.08, -0.2, 0, -0.55)],
  ]);
  for (const [a, b] of KENNELS) {
    add(kennelGeo, at(a, b, ground(a, b)));
    solidCircle(a, b, 0.75);
  }
  {
    // сани з полозами, ременями й тюком хутра
    const sled = painted([
      ...[-0.4, 0.4].map((u): [THREE.BufferGeometry, number, THREE.Matrix4] => [boxGeo(0.06, 0.06, 2.6), 0x6b4f36, T(u, 0.06, 0)]),
      ...[-0.4, 0.4].map((u): [THREE.BufferGeometry, number, THREE.Matrix4] => [new THREE.TorusGeometry(0.22, 0.03, 4, 8, Math.PI / 2), 0x6b4f36, T(u, 0.28, 1.3, Math.PI / 2, 0, 0)]),
      ...[-0.9, -0.3, 0.3, 0.9].map((v): [THREE.BufferGeometry, number, THREE.Matrix4] => [boxGeo(0.06, 0.32, 0.06), 0x5a412c, T(0, 0.22, v)]),
      [boxGeo(0.95, 0.06, 2.2), 0x9a7a52, T(0, 0.38, 0)],
      [boxGeo(0.06, 0.6, 0.06), 0x5a412c, T(-0.38, 0.7, -1.05)], [boxGeo(0.06, 0.6, 0.06), 0x5a412c, T(0.38, 0.7, -1.05)],
      [boxGeo(0.84, 0.06, 0.06), 0x5a412c, T(0, 1.0, -1.05)],
      [boxGeo(0.8, 0.42, 1.2), 0x7d5a3a, T(0, 0.62, 0.15)],
      [boxGeo(0.86, 0.05, 0.08), 0x2a2420, T(0, 0.84, -0.2)], [boxGeo(0.86, 0.05, 0.08), 0x2a2420, T(0, 0.84, 0.5)],
    ]);
    add(sled, at(-4.6, -15.6, p.plY, ryA + Math.PI / 2));
    solidCircle(-4.6, -15.6, 1.2);
  }

  // ── рами з хутром ──
  for (const [i, [a, b]] of RACKS.entries()) {
    const y = ground(a, b);
    const hide = (col: number, u: number, s: number): [THREE.BufferGeometry, number, THREE.Matrix4] => [new THREE.CircleGeometry(0.62, 9), col, T(u, 1.45, 0.04, 0, 0, 0.2 * s, 0.85, 1.25, 1)];
    add(painted([
      [boxGeo(0.12, 2.5, 0.12), 0x5e4630, T(-1.25, 1.25, 0)], [boxGeo(0.12, 2.5, 0.12), 0x5e4630, T(1.25, 1.25, 0)],
      [boxGeo(2.7, 0.1, 0.1), 0x5e4630, T(0, 2.35, 0)], [boxGeo(2.7, 0.08, 0.08), 0x5e4630, T(0, 0.55, 0)],
      hide(i ? 0x8a5a32 : 0x6a4a30, -0.62, 1), hide(i ? 0xb08a5a : 0x9a6a3a, 0.62, -1),
      [boxGeo(2.6, 0.05, 0.12), 0xf2f4f6, T(0, 2.43, 0)],
    ]), at(a, b, y, ryA + (i ? 0.5 : -0.2)));
    solidCircle(a, b, 1.3);
  }

  // ── іглу-льодовня ──
  {
    const y = ground(IGLOO.a, IGLOO.b) - 0.15;
    const parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4]> = [
      [new THREE.SphereGeometry(1.9, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), 0xeef2f6, T(0, 0, 0)],
      [new THREE.CylinderGeometry(0.75, 0.75, 1.4, 10, 1, false, 0, Math.PI), 0xe6ecf2, T(0, 0, 2.0, 0, Math.PI / 2, Math.PI / 2)],
      [new THREE.CircleGeometry(0.55, 10, 0, Math.PI), 0x1c2430, T(0, 0.02, 2.71)],
    ];
    // шви блоків: тонкі кільця
    for (let k = 1; k <= 3; k++) {
      const ang = (k / 4) * (Math.PI / 2);
      parts.push([new THREE.TorusGeometry(1.9 * Math.cos(ang) + 0.01, 0.025, 3, 18), 0xc9d4de, T(0, 1.9 * Math.sin(ang), 0, 0, Math.PI / 2)]);
    }
    add(painted(parts), at(IGLOO.a, IGLOO.b, y, ryA));
    solidCircle(IGLOO.a, IGLOO.b, 2);
  }

  // ── тотем ──
  {
    const y = p.plY;
    const parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4]> = [];
    const cols = [0x8a3a2a, 0x2f5a6a, 0xc9a24a, 0x3b5a3a];
    for (let i = 0; i < 4; i++) {
      const yy = 0.55 + i * 0.95;
      parts.push([cylGeo(0.36, 0.38, 0.95, 8), [0x7a5a3c, 0x6b4f36][i % 2], T(0, yy, 0)]);
      parts.push([boxGeo(0.42, 0.18, 0.1), cols[i], T(0, yy + 0.18, 0.34)]);
      parts.push([boxGeo(0.12, 0.12, 0.08), 0xf2efe6, T(-0.13, yy + 0.2, 0.39)], [boxGeo(0.12, 0.12, 0.08), 0xf2efe6, T(0.13, yy + 0.2, 0.39)]);
      parts.push([boxGeo(0.3, 0.08, 0.1), 0x1d1611, T(0, yy - 0.16, 0.36)]);
    }
    // крила-птах угорі
    parts.push([boxGeo(2.2, 0.16, 0.34), 0x2f5a6a, T(0, 4.05, 0)], [new THREE.ConeGeometry(0.16, 0.42, 6), 0xc9a24a, T(0, 4.3, 0.36, 0, Math.PI / 2)]);
    add(painted(parts), at(TOTEM.a, TOTEM.b, y - 0.1, ryA));
    solidCircle(TOTEM.a, TOTEM.b, 0.5);
  }

  // ── вогнище з казаном і колодами-лавами ──
  const fireY = ground(FIRE.a, FIRE.b);
  {
    const parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4]> = [];
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 2;
      parts.push([new THREE.DodecahedronGeometry(0.2, 0), 0x6f6c66, T(Math.cos(ang) * 0.75, 0.1, Math.sin(ang) * 0.75, ang)]);
    }
    for (let i = 0; i < 4; i++) parts.push([cylGeo(0.07, 0.07, 0.9, 6), 0x3a2a1e, T(0, 0.12, 0, (i / 4) * Math.PI, 0, Math.PI / 2 - 0.25)]);
    // тринога з казаном
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      parts.push([cylGeo(0.035, 0.035, 2.0, 5), 0x4a3a2c, T(Math.cos(ang) * 0.55, 0.9, Math.sin(ang) * 0.55, 0, 0, 0).multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang)), 0.32))]);
    }
    parts.push([new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x1f1f22, T(0, 0.92, 0)]);
    parts.push([new THREE.TorusGeometry(0.33, 0.03, 4, 12), 0x1f1f22, T(0, 0.92, 0, 0, Math.PI / 2)]);
    // колоди-лави
    parts.push([cylGeo(0.2, 0.2, 1.8, 7), 0x6b4f36, T(0, 0.2, -1.75, Math.PI / 2, 0, Math.PI / 2)]);
    parts.push([cylGeo(0.2, 0.2, 1.8, 7), 0x6b4f36, T(1.75, 0.2, 0, 0, 0, Math.PI / 2)]);
    add(painted(parts), at(FIRE.a, FIRE.b, fireY));
    solidCircle(FIRE.a, FIRE.b, 1.0);
    const [fx, fz] = W(FIRE.a, FIRE.b);
    c.glow(fx, fireY + 0.6, fz, 3.2);
    smokeAt.push(new THREE.Vector3(fx, fireY + 1.3, fz));
  }
  // полум'я — живе (мерехтить), без власних джерел світла
  const flame = new THREE.Mesh(painted([
    [new THREE.ConeGeometry(0.28, 0.75, 6), 0xff8a2a, T(0, 0.4, 0)],
    [new THREE.ConeGeometry(0.16, 0.55, 6), 0xffd060, T(0.1, 0.35, 0.05)],
    [new THREE.ConeGeometry(0.14, 0.5, 6), 0xffb040, T(-0.1, 0.3, -0.05)],
  ]), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false, blending: THREE.AdditiveBlending }));
  {
    const [fx, fz] = W(FIRE.a, FIRE.b);
    flame.position.set(fx, fireY + 0.08, fz);
    flame.castShadow = false;
    live.add(flame);
  }

  // ── ялини в снігу й кучугури навколо факторії ──
  {
    // ялина в снігу — матеріали гавані (стовбур, хвоя, білий сніг): зливається з ялинами порту
    const firTrunk = cylGeo(0.18, 0.26, 2, 6).translate(0, 1, 0);
    const firNeedles = mergeGeometries([
      new THREE.ConeGeometry(2.0, 3.2, 7).translate(0, 2.9, 0),
      new THREE.ConeGeometry(1.5, 2.8, 7).translate(0, 4.5, 0),
      new THREE.ConeGeometry(1.0, 2.4, 7).translate(0, 5.95, 0),
    ])!;
    const firSnow = mergeGeometries([
      new THREE.ConeGeometry(1.25, 0.9, 7).translate(0, 3.85, 0),
      new THREE.ConeGeometry(0.95, 0.8, 7).translate(0, 5.35, 0),
      new THREE.ConeGeometry(0.55, 0.9, 7).translate(0, 6.85, 0),
    ])!;
    const driftGeo = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const clear = (a: number, b: number, r: number) => {
      if (a > -27 && Math.abs(b) < 26) return false; // плато й містечко
      return GRIZZLY_ZONES.every(([za, zb, zr]) => Math.hypot(a - za, b - zb) > zr + r);
    };
    let firs = 0, drifts = 0;
    for (let i = 0; i < 260 && (firs < 22 || drifts < 18); i++) {
      const a = -80 + rng() * 84, b = (rng() * 2 - 1) * 80;
      const [x, z] = W(a, b);
      const h = H(x, z);
      if (firs < 22 && h > 3 && h < 40 && clear(a, b, 1.5)) {
        const k = 0.75 + rng() * 0.6;
        const m = T(x, h - 0.1, z, rng() * 6.28, 0, 0, k);
        batch.add(firTrunk, M.trunk, m);
        batch.add(firNeedles, M.pine, m);
        batch.add(firSnow, snow, m);
        solids.push({ x, z, r: 0.5 * k });
        firs++;
      } else if (drifts < 18 && h > 0.9 && h < 30 && clear(a, b, 1)) {
        // кучугура: низька й м'яка, трохи втоплена в схил
        batch.add(driftGeo, snow, T(x, h - 0.28, z, rng() * 6.28, 0, 0, 1.1 + rng() * 1.4, 0.22 + rng() * 0.16, 0.9 + rng() * 1.0), false);
        drifts++;
      }
    }
    // кучугури вздовж краю плато (сніг, згорнутий з набережної)
    for (const [a, b] of [[-21, -6], [-21, 6], [-20.5, 23], [-7, 22.5], [-7, -22.5], [-22, -24]] as Array<[number, number]>) {
      const [x, z] = W(a, b);
      batch.add(driftGeo, snow, T(x, H(x, z) - 0.2, z, rng() * 6.28, 0, 0, 1.1 + rng() * 0.6, 0.26, 0.8 + rng() * 0.5), false);
    }
  }

  // ── бурий ведмідь на косі ловить рибу ──
  const bear = new THREE.Group();
  const bearHead = new THREE.Group();
  {
    const fur = 0x9a6438, dark = 0x6a4428;
    const body = new THREE.Mesh(painted([
      [new THREE.SphereGeometry(1, 10, 7), fur, T(0, 1.05, -0.2, 0, 0, 0, 0.75, 0.68, 1.15)],
      [new THREE.SphereGeometry(1, 9, 6), fur, T(0, 1.35, 0.35, 0, 0, 0, 0.62, 0.58, 0.55)],
      ...[[-0.42, 0.55], [0.42, 0.55], [-0.42, -0.85], [0.42, -0.85]].map(([u, v]): [THREE.BufferGeometry, number, THREE.Matrix4] => [cylGeo(0.2, 0.17, 0.9, 7), dark, T(u, 0.45, v)]),
    ]), vcol);
    bear.add(body);
    const head = new THREE.Mesh(painted([
      [new THREE.SphereGeometry(0.36, 9, 6), fur, T(0, 0, 0.1)],
      [new THREE.SphereGeometry(0.18, 7, 5), 0xb08a62, T(0, -0.07, 0.42, 0, 0, 0, 1, 0.8, 1.2)],
      [new THREE.SphereGeometry(0.06, 5, 4), 0x111111, T(0, -0.02, 0.62)],
      [new THREE.SphereGeometry(0.11, 6, 4), dark, T(-0.24, 0.27, 0)], [new THREE.SphereGeometry(0.11, 6, 4), dark, T(0.24, 0.27, 0)],
    ]), vcol);
    bearHead.add(head);
    bearHead.position.set(0, 1.55, 0.85);
    bear.add(bearHead);
    const [x, z] = W(BEAR.a, BEAR.b);
    bear.position.set(x, H(x, z) - 0.05, z);
    bear.rotation.y = ryA + 0.4;
    bear.traverse((o) => (o.castShadow = false));
    live.add(bear);
    solidCircle(BEAR.a, BEAR.b, 1.4);
  }

  // ── хаскі біля будок (махають хвостами) ──
  const tails: THREE.Object3D[] = [];
  const tailBases: THREE.Matrix4[] = [];
  let tailMesh!: THREE.InstancedMesh;
  const _tm = new THREE.Matrix4();
  {
    const coat = 0x8b8f94, belly = 0xeef0f2;
    const dogGeo = painted([
      [new THREE.SphereGeometry(1, 8, 6), coat, T(0, 0.42, -0.08, 0, 0, 0, 0.2, 0.26, 0.32)],
      [new THREE.SphereGeometry(1, 8, 6), belly, T(0, 0.38, 0.06, 0, 0, 0, 0.15, 0.2, 0.2)],
      [new THREE.SphereGeometry(0.15, 8, 6), coat, T(0, 0.74, 0.12)],
      [new THREE.SphereGeometry(0.08, 7, 5), belly, T(0, 0.7, 0.26, 0, 0, 0, 1, 0.8, 1.3)],
      [new THREE.SphereGeometry(0.03, 4, 3), 0x111111, T(0, 0.71, 0.35)],
      [new THREE.ConeGeometry(0.05, 0.12, 4), coat, T(-0.08, 0.89, 0.1)], [new THREE.ConeGeometry(0.05, 0.12, 4), coat, T(0.08, 0.89, 0.1)],
      [cylGeo(0.04, 0.04, 0.3, 5), belly, T(-0.07, 0.15, 0.15)], [cylGeo(0.04, 0.04, 0.3, 5), belly, T(0.07, 0.15, 0.15)],
    ]);
    const tailGeo = painted([[new THREE.TorusGeometry(0.1, 0.045, 5, 8, Math.PI * 1.3), coat, T(0, 0.08, 0, 0, Math.PI / 2)]]);
    // тіла — у статику гавані; хвости — одним InstancedMesh (один виклик на обох)
    tailMesh = new THREE.InstancedMesh(tailGeo, vcol, KENNELS.length);
    tailMesh.castShadow = false;
    live.add(tailMesh);
    for (const [i, [a, b]] of KENNELS.entries()) {
      const [x, z] = W(a + 1.0, b + (i ? 0.6 : -0.5));
      const ry = ryA + (i ? -0.5 : 0.4);
      const base = T(x, ground(a + 1, b), z, ry);
      add(dogGeo, base, false);
      const tail = new THREE.Object3D();
      tail.position.set(0, 0.42, -0.38);
      tailBases.push(base);
      tails.push(tail);
    }
  }

  // ── дим: вогнище й комин лавки ──
  for (const s of p.svc) {
    if (s.kind !== 'trapper') continue;
    const [x, z] = W(s.a - 1.2 - 2.3 - 1, s.b + 1.5);
    smokeAt.push(new THREE.Vector3(x, Math.min(H(x, z), p.plY) + 5.2, z));
  }
  const smokeTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const x = cv.getContext('2d')!;
    const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(235,235,235,0.9)');
    gr.addColorStop(1, 'rgba(235,235,235,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const PUFFS = 4;
  const nP = smokeAt.length * PUFFS;
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(nP * 3), 3));
  smokeGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(nP * 4).fill(0.92), 4));
  const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ map: smokeTex, size: 1.7, sizeAttenuation: true, transparent: true, depthWrite: false, vertexColors: true }));
  smoke.frustumCulled = false;
  live.add(smoke);

  // ── мешканці: траппер біля лавки, бабця з люлькою біля вогнища ──
  const npcs: Npc[] = [];
  const addNpc = (root: THREE.Object3D, lines: string[], headY: number) => {
    const bubbleMat = new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    const bubble = new THREE.Sprite(bubbleMat);
    bubble.scale.set(2.6, 0.49, 1);
    bubble.visible = false;
    bubble.renderOrder = 10;
    live.add(bubble);
    npcs.push({ root, lines, line: Math.floor(rng() * lines.length), bubble, bubbleMat, shown: 0, near: false, headY });
  };
  const folk = new THREE.Group();
  folk.visible = false;
  live.add(folk);
  const sitPose = (r: CharacterRig) => {
    r.legL.rotation.set(-Math.PI / 2 + 0.2, -0.1, 0);
    r.legR.rotation.set(-Math.PI / 2 + 0.2, 0.1, 0);
    r.kneeL.rotation.x = r.kneeR.rotation.x = Math.PI / 2 - 0.2;
  };
  const anims: Array<(dt: number, t: number) => void> = [];
  // траппер Сайлас — біля дверей своєї лавки, в шапці з хутра
  {
    const s = p.svc.find((v) => v.kind === 'trapper');
    const a = (s?.a ?? -6) + 0.8, b = (s?.b ?? 19) + 2.4;
    const r = buildCharacter({ jacket: 0x7a5636, jacketKind: 'coat', pants: 0x3b3a34, hat: 'coonskin', hatColor: 0x6b4a2a, hatAccent: 0xb8a284, hair: 'short', hairColor: HAIRS[1], beard: 'full', skin: SKINS[2], brow: 0.2, boots: 0x2a2420, gloves: 0x8a6a42, scarf: 0x8a3a2c }, { coarse: true });
    const bundle = new THREE.Mesh(painted([[boxGeo(0.5, 0.36, 0.3), 0x8a5a32, T(0, 0, 0)], [boxGeo(0.52, 0.05, 0.32), 0x2a2420, T(0, 0.06, 0)]]), vcol);
    bundle.position.set(0.05, -0.62, 0.18);
    r.armR.add(bundle);
    r.armR.rotation.x = -0.35;
    const [x, z] = W(a, b);
    r.root.position.set(x, Math.max(ground(a, b), p.plY - 0.1), z);
    r.root.rotation.y = ryA + 0.6;
    folk.add(r.root);
    addNpc(r.root, [
      L('Хутро, жир, риба — все міняю. Монету теж беру.', `Furs, oil, fish — I trade anything. I take coin too.`),
      L('Ведмідь на косі — не чіпай, він тут старожил.', `The bear on the spit — leave him be, he's been here longer than us.`),
      L('Перед штормом собаки виють за годину. Слухай собак.', `The dogs howl an hour before a storm. Listen to the dogs.`),
      L('У рукавицях з лисиці вудка з рук не вислизає.', `In fox-fur mittens the rod never slips.`),
    ], 1.9);
    anims.push((_dt, t) => {
      r.root.rotation.y = ryA + 0.6 + Math.sin(t * 0.4) * 0.25;
      r.head.rotation.y = Math.sin(t * 0.7) * 0.35;
    });
  }
  // бабця Нуна з люлькою на колоді біля вогнища
  const pipeTip = new THREE.Object3D();
  {
    const r = buildCharacter({ jacket: 0x3f4a5a, jacketKind: 'coat', pants: 0x2f2a28, hat: 'none', hair: 'bun', hairColor: HAIRS[6], skin: SKINS[1], brow: 0.4, boots: 0x3a2a20, scarf: 0xc9a24a }, { coarse: true });
    sitPose(r);
    const pipe = new THREE.Mesh(painted([[cylGeo(0.015, 0.015, 0.22, 5), 0x2a1e16, T(0, 0, 0.11, Math.PI / 2, 0, Math.PI / 2)], [cylGeo(0.04, 0.035, 0.07, 6), 0x3a2618, T(0, 0.03, 0.22)]]), vcol);
    pipe.position.set(0, -0.06, 0.12);
    r.head.add(pipe);
    pipeTip.position.set(0, 0.0, 0.34);
    r.head.add(pipeTip);
    r.armR.rotation.x = -1.2;
    r.armL.rotation.x = -0.5;
    const [x, z] = W(FIRE.a, FIRE.b - 1.75);
    r.root.position.set(x, fireY - 0.5, z);
    r.root.rotation.y = ryA + Math.PI / 2;
    folk.add(r.root);
    addNpc(r.root, [
      L('Коли небо зеленіє — духи танцюють. Сідай, погрійся.', `When the sky turns green the spirits dance. Sit, warm yourself.`),
      L('Сорок зим палю цю люльку. Сорок зим дивлюся на море.', `Forty winters I've smoked this pipe. Forty winters I've watched the sea.`),
      L('На Півночі риба більша, бо злюща від холоду.', `Up north the fish are bigger — the cold makes them mean.`),
      L('Юшка ще не готова. А чай у Сайласа — завжди.', `The chowder isn't ready yet. Silas always has tea, though.`),
    ], 1.3);
    anims.push((_dt, t) => {
      r.head.rotation.x = Math.sin(t * 0.5) * 0.08 - 0.05;
      r.armR.rotation.x = -1.2 + Math.sin(t * 0.3) * 0.1;
    });
  }
  folk.traverse((o) => (o.castShadow = false));
  const folkC = (() => { const [x, z] = W(-11, 6); return { x, z }; })();
  const pipeW = new THREE.Vector3();
  const pipeI = smokeAt.length;
  smokeAt.push(new THREE.Vector3()); // дим люльки (позиція — щокадру)

  // ── північне сяйво: три стрічки високо над хребтом за факторією (~0.7–0.9 км, 430–570 м) ──
  // одна геометрія й один матеріал (один виклик малювання); двобічність — в один прохід
  let auroraMat!: THREE.MeshBasicMaterial;
  let aurora!: THREE.Mesh;
  {
    const geos: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const wdt = 1150 - k * 200;
      const geo = new THREE.PlaneGeometry(wdt, 240 - k * 45, 64, 1);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      const halfW = wdt / 2;
      const fade = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i);
        pos.setZ(i, Math.sin(u * 0.006 + k * 1.9) * 140 + Math.sin(u * 0.016 + k) * 40);
        // краї стрічки тануть (адитивне змішування: темніше = прозоріше); кожна стрічка трохи тьмяніша
        const e = Math.min(1, (halfW - Math.abs(u)) / (halfW * 0.35));
        const f = e * e * (3 - 2 * e) * (1 - k * 0.18);
        fade.set([f, f, f], i * 3);
        // різний «малюнок» променів на кожній стрічці
        uv.setX(i, uv.getX(i) * (1.4 + k * 0.4) + k * 0.37);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(fade, 3));
      const [x, z] = W(-700 - k * 110, k * 140 - 140);
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, 430 + k * 70, z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ryA + Math.PI / 2 + (k - 1) * 0.25), new THREE.Vector3(1, 1, 1)));
      geo.deleteAttribute('normal');
      geos.push(geo);
    }
    auroraMat = new THREE.MeshBasicMaterial({ map: auroraTex(), vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true, fog: false, toneMapped: false });
    aurora = new THREE.Mesh(mergeGeometries(geos)!, auroraMat);
    aurora.renderOrder = -1;
    aurora.frustumCulled = false;
    aurora.visible = false;
    aurora.userData.noMerge = true;
    g.add(aurora);
  }

  // ── кадр: лише поблизу ──
  const center = new THREE.Vector3(...((): [number, number, number] => { const [x, z] = W(-14, -10); return [x, 0, z]; })());
  let wasNear = true;
  let unmarked = false;
  const _v = new THREE.Vector3();
  return {
    update(dt, t, cam, night) {
      if (!unmarked && t > 0.5) {
        unmarked = true;
        live.traverse((o) => o.layers.disable(UNDERWATER_LAYER));
        aurora.layers.disable(UNDERWATER_LAYER);
      }
      const d = Math.hypot(cam.x - center.x, cam.z - center.z);
      // сяйво: лише вночі, видно здалеку (гавань сама ховається далі ~1.5 км)
      const aur = Math.max(0, (night - 0.35) / 0.65);
      aurora.visible = aur > 0.01;
      // ports.update щокадру вмикає дітей гавані — поважає лише userData.hide
      aurora.userData.hide = !aurora.visible;
      if (aurora.visible) {
        auroraMat.opacity = aur * 0.62 * (0.75 + 0.25 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1.3));
        if (auroraMat.map) auroraMat.map.offset.x = t * 0.005;
      }
      const near = d < 260;
      if (near !== wasNear) {
        live.userData.hide = !near;
        live.visible = near;
        wasNear = near;
      }
      if (!near) return;
      // вогонь мерехтить
      flame.scale.set(1 + Math.sin(t * 11) * 0.08, 0.85 + Math.sin(t * 7.3) * 0.12 + Math.sin(t * 17) * 0.06, 1 + Math.cos(t * 9) * 0.08);
      flame.rotation.y = t * 0.6;
      // ведмідь: опускає голову до води — і різко підводить
      {
        const cyc = (t * 0.22) % 1;
        const dip = cyc < 0.6 ? Math.sin((cyc / 0.6) * Math.PI) * 0.75 : 0;
        bearHead.rotation.x = 0.15 + dip;
        bear.rotation.y = ryA + 0.4 + Math.sin(t * 0.13) * 0.35;
      }
      for (const [i, tl] of tails.entries()) {
        tl.rotation.y = Math.sin(t * (7 + i * 2)) * 0.5;
        tl.updateMatrix();
        tailMesh.setMatrixAt(i, _tm.multiplyMatrices(tailBases[i], tl.matrix));
      }
      tailMesh.instanceMatrix.needsUpdate = true;
      // люди: видно ближче ~70 м (з гістерезисом)
      const df = Math.hypot(cam.x - folkC.x, cam.z - folkC.z);
      folk.visible = folk.visible ? df < 72 : df < 62;
      if (folk.visible) for (const a of anims) a(dt, t);
      // дим (люлька — лише коли бабцю видно)
      pipeTip.getWorldPosition(pipeW);
      smokeAt[pipeI].copy(pipeW);
      {
        const pa = smokeGeo.attributes.position as THREE.BufferAttribute;
        const ca = smokeGeo.attributes.color as THREE.BufferAttribute;
        for (let i = 0; i < nP; i++) {
          const si = Math.floor(i / PUFFS), o = smokeAt[si], ph = (i % PUFFS) / PUFFS;
          const pipeOne = si === pipeI;
          const k = (t * (pipeOne ? 0.22 : 0.11) + ph) % 1;
          const rise = pipeOne ? 0.9 : 3.6;
          pa.setXYZ(i, o.x + k * (pipeOne ? 0.3 : 1.4) + Math.sin(t + ph * 6) * 0.12, o.y + k * rise, o.z + k * 0.6);
          const alpha = pipeOne ? (folk.visible ? 0.35 : 0) : 0.42 - night * 0.2;
          ca.setW(i, Math.sin(k * Math.PI) * alpha);
        }
        pa.needsUpdate = true;
        ca.needsUpdate = true;
      }
      // репліки
      for (const n of npcs) {
        if (!folk.visible) {
          n.bubble.visible = false;
          n.near = false;
          n.shown = 0;
          continue;
        }
        const rp = n.root.getWorldPosition(_v);
        const dn = Math.hypot(cam.x - rp.x, cam.z - rp.z);
        const close = dn < 5.5 && Math.abs(cam.y - rp.y) < 3.5;
        if (close && !n.near) {
          n.line = (n.line + 1) % n.lines.length;
          n.bubbleMat.map?.dispose();
          n.bubbleMat.map = bubbleCanvas(n.lines[n.line]);
          n.bubbleMat.needsUpdate = true;
          n.shown = 0;
        }
        n.near = close;
        n.shown = close ? Math.min(1, n.shown + dt * 3) : Math.max(0, n.shown - dt * 2);
        n.bubble.visible = n.shown > 0.01;
        if (n.bubble.visible) {
          n.bubble.position.set(rp.x, rp.y + n.headY + 0.6, rp.z);
          n.bubbleMat.opacity = n.shown;
        }
      }
    },
  };
}
