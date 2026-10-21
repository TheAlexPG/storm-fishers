import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { L } from '../core/i18n';
import { T, boxGeo, cylGeo, roofSlabGeo } from './portKit';
import { buildCharacter, HAIRS, SKINS, type CharacterRig } from './character';
import { siteToWorld, siteRect, pierRect, type PortSite } from './portSites';
import type { VillageCtx, VillageLife } from './kutVillage';
import { UNDERWATER_LAYER } from '../core/ocean';

// ─────────────────────────────────────────────────────────────
// Сідар-Гарбор: північне портове містечко (Нова Англія / Канада).
// Праворуч від плато, на пологому схилі до пляжу — лісопилка з
// водяним колесом на струмку, склад деревини, штабелі колод; на
// узліссі пасеться лось. На набережній — стоси пасток для лобстерів із
// буями, на плато — генеральна крамниця «Кленова лавка» з ґанком і
// кріслом-гойдалкою (там сидить старий Ерл). Сніг на дахах, дим із
// коминів, ворони на гребенях. Лісоруби в червоних сорочках, рибалка в
// жовтому дощовику на краю причалу — оживають лише поблизу.
// Статика — у спільний Batch гавані; рухоме — окремою групою (noMerge).
// ─────────────────────────────────────────────────────────────

export const CEDAR_ID = 'port-cedar';

type Mat = THREE.Material;

/** координати гавані (a — до моря, b — уздовж набережної) */
const MILL = { a: -13, b: -53, lenA: 6, lenB: 8 };
const SHED = { a: -24, b: -53 };
const WHEEL = { a: -12.4, b: -59.7, r: 1.6 };
const STREAM_B = -60;
const STORE = { a: -20, b: 22 };
const MOOSE = { a: -46, b: -67 };

/** зони (a, b, r), де загальна забудова й ялиці гавані не ставляться */
export const CEDAR_ZONES: Array<[number, number, number]> = [
  [MILL.a, MILL.b, 8],
  [SHED.a, SHED.b, 7.5],
  [WHEEL.a, WHEEL.b, 3.5],
  [-30, STREAM_B, 3],
  [-38, STREAM_B, 3],
  [-46, STREAM_B, 3],
  [MOOSE.a, MOOSE.b, 4],
  [STORE.a + 0.5, STORE.b, 3.8],
];

export interface CedarCtx extends VillageCtx {
  /** будинок з ports.ts (стіни/дах/вікна/двері/ліхтар) */
  house: (o: { x: number; z: number; y0: number; ry: number; w: number; d: number; h: number; rh: number; wall: Mat; roof: Mat; door?: number; snow?: boolean }) => void;
}

interface Npc {
  rig: { root: THREE.Object3D };
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

/** м'який водяний «потік»: смуги піни, що повзуть (зсув текстури) */
function streamTex(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 256;
  const x = cv.getContext('2d')!;
  x.fillStyle = '#4f7f95';
  x.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 46; i++) {
    const px = Math.random() * 64, py = Math.random() * 256, l = 10 + Math.random() * 30;
    x.strokeStyle = `rgba(226,240,244,${0.1 + Math.random() * 0.22})`;
    x.lineWidth = 1 + Math.random() * 2.2;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + (Math.random() - 0.5) * 6, py + l);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCedarTown(c: CedarCtx): VillageLife {
  const { p, g, batch, M, H, platforms, solids } = c;
  const W = (a: number, b: number) => siteToWorld(p, a, b);
  const ground = (a: number, b: number) => {
    const [x, z] = W(a, b);
    return H(x, z);
  };
  const ryA = Math.atan2(p.ox, p.oz); // локальний +Z → у море (+a), локальний +X → −b
  const ryB = Math.atan2(-p.oz, p.ox); // локальний +Z → +b
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
  // сніг — тим самим білим матеріалом гавані (зливається з її викликами малювання)
  const snowMat = M.whitePaint;
  const vcol = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

  const live = new THREE.Group();
  live.userData.noMerge = true;
  g.add(live);
  const smokeAt: THREE.Vector3[] = [];

  /** двосхилий дах над прямокутником (гребінь уздовж b) у кадрі base; сніг — шаром на верхніх 80% схилів */
  const gableRoof = (base: THREE.Matrix4, w: number, d: number, wallH: number, rh: number, roof: Mat, snow = true) => {
    const ang = Math.atan2(rh, d / 2);
    const ov = 0.4, t = 0.16, Wd = w + 0.6;
    const Ls = Math.hypot(d / 2, rh) + ov;
    const slab = roofSlabGeo(Ls, t, Wd, 2).rotateY(-Math.PI / 2);
    const ridgeY = wallH + rh;
    const Ls2 = Ls * 0.8;
    const snowSlab = roofSlabGeo(Ls2, 0.1, Wd - 0.2, 2).rotateY(-Math.PI / 2);
    for (const s of [1, -1]) {
      const cz = s * Math.cos(ang) * (Ls / 2) + s * Math.sin(ang) * (t / 2);
      const cy = ridgeY - Math.sin(ang) * (Ls / 2) + Math.cos(ang) * (t / 2);
      batch.add(slab, roof, base.clone().multiply(T(0, cy, cz, 0, s * ang)));
      if (snow) {
        const sz = s * Math.cos(ang) * (Ls2 / 2) + s * Math.sin(ang) * (t + 0.05);
        const sy = ridgeY - Math.sin(ang) * (Ls2 / 2) + Math.cos(ang) * (t + 0.05);
        batch.add(snowSlab, snowMat, base.clone().multiply(T(0, sy, sz, 0, s * ang)));
      }
    }
    batch.add(boxGeo(Wd + 0.04, 0.16, 0.3), snow ? snowMat : roof, base.clone().multiply(T(0, ridgeY + 0.12, 0)));
  };

  // ── струмок зі схилу до моря (під колесом) ──
  const streamMat = new THREE.MeshStandardMaterial({ map: streamTex(), color: 0x9ab4bf, roughness: 0.12, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  {
    const pts: THREE.Vector3[] = [];
    for (let a = -56; a <= -3; a += 1.5) {
      const bend = Math.sin(a * 0.21) * 0.9;
      const [x, z] = W(a, STREAM_B + bend);
      // до лінії прибою: далі — море
      if (a > -30 && H(x, z) < 0.02) break;
      // сітка рельєфу (крок 2.5 м) місцями вища за аналітичну висоту — беремо максимум з околу
      let gy = H(x, z);
      for (const [dx, dz] of [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]]) gy = Math.max(gy, H(x + dx, z + dz));
      pts.push(new THREE.Vector3(x, Math.max(0.1, gy + 0.12), z));
    }
    const half = (i: number) => 0.35 + 0.75 * Math.min(1, i / 6);
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const [lx, lz] = [-p.oz, p.ox];
    let run = 0;
    pts.forEach((v, i) => {
      if (i) run += v.distanceTo(pts[i - 1]);
      const hh = half(i);
      pos.push(v.x + lx * hh, v.y, v.z + lz * hh, v.x - lx * hh, v.y, v.z - lz * hh);
      uv.push(0, run / 6, 1, run / 6);
      if (i) {
        const k = i * 2;
        idx.push(k - 2, k, k - 1, k - 1, k, k + 1); // нормаль — угору
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const stream = new THREE.Mesh(geo, streamMat);
    stream.receiveShadow = true;
    stream.userData.noMerge = true;
    g.add(stream);
    // каміння по берегах струмка
    for (let a = -46; a <= -6; a += 3.2) {
      for (const s of [-1, 1]) {
        if (Math.abs(a - WHEEL.a) < 2.5) continue;
        const bb = STREAM_B + Math.sin(a * 0.21) * 0.9 + s * (1.35 + ((a * 7) % 3) * 0.12);
        const y = ground(a, bb);
        batch.add(new THREE.DodecahedronGeometry(0.28 + ((a * 13) % 5) * 0.05, 0), M.stoneDark, at(a, bb, y + 0.05, a * 1.7, 0.3, 0, 1, 0.6, 1));
      }
    }
  }

  // ── лісопилка: відкритий навіс на палях, пила й колода, конторка ──
  const FY = 1.75;
  {
    const { a, b, lenA, lenB } = MILL;
    const a0 = a - lenA / 2, a1 = a + lenA / 2, b0 = b - lenB / 2, b1 = b + lenB / 2;
    batch.add(boxGeo(lenB, 0.22, lenA, 3, 2), M.woodGrey, at(a, b, FY - 0.11));
    // палі під настилом і стовпи навісу
    for (const pa of [a0 + 0.2, a, a1 - 0.2]) {
      for (const pb of [b0 + 0.2, b, b1 - 0.2]) {
        const gy = Math.min(FY - 0.3, ground(pa, pb));
        batch.add(boxGeo(0.24, FY - gy, 0.24), M.woodDark, at(pa, pb, (FY + gy) / 2 - 0.05));
      }
    }
    const wallH = 3.0;
    for (const pa of [a0 + 0.15, a1 - 0.15]) {
      for (const pb of [b0 + 0.15, b, b1 - 0.15]) batch.add(boxGeo(0.22, wallH, 0.22), M.woodDark, at(pa, pb, FY + wallH / 2));
    }
    // задня (до суші) й бічна стіни — сіро-вилинялі дошки
    batch.add(boxGeo(lenB - 0.2, wallH, 0.14, 3, 1), M.woodGrey, at(a0 + 0.1, b, FY + wallH / 2));
    batch.add(boxGeo(0.14, wallH * 0.6, lenA - 0.3, 1, 2), M.woodGrey, at(a, b1 - 0.1, FY + wallH * 0.3));
    gableRoof(at(a, b, FY), lenB, lenA, wallH, 1.5, M.roofDark);
    // пиляльний стіл: колода на ньому, пила крутиться (див. live)
    batch.add(boxGeo(1.1, 0.85, 4.2), M.woodDark, at(a, b + 0.8, FY + 0.42));
    batch.add(cylGeo(0.36, 0.36, 3.2, 10), M.trunk, at(a - 0.6, b + 0.8, FY + 1.2, ryA, Math.PI / 2));
    // тирса
    batch.add(new THREE.ConeGeometry(0.9, 0.55, 9), M.woodGrey, at(a + 1.6, b + 2.3, FY + 0.27));
    batch.add(new THREE.ConeGeometry(1.4, 0.7, 9), M.woodGrey, at(a1 + 1.3, b0 + 1.2, ground(a1 + 1.3, b0 + 1.2) + 0.25));
    // залізна труба грубки на даху — дим
    batch.add(cylGeo(0.14, 0.14, 1.6, 8), M.iron, at(a - 1.4, b + 2.6, FY + wallH + 1.2));
    smokeAt.push(new THREE.Vector3(...((): [number, number, number] => { const [x, z] = W(a - 1.4, b + 2.6); return [x, FY + wallH + 2.1, z]; })()));
    // лампа під стріхою
    const [lx, lz] = W(a1 - 0.6, b);
    batch.add(boxGeo(0.2, 0.26, 0.2), M.lamp, T(lx, FY + wallH - 0.2, lz), false);
    c.glow(lx, FY + wallH - 0.25, lz, 1.6);
    // настил — платформа (заходиш зі схилу), стіни й стіл — тверді
    platforms.push(siteRect(p, a0, a1, b0, b1, FY));
    solidAA(a0 - 0.1, a0 + 0.3, b0, b1);
    solidAA(a - 0.6, a + 0.6, b + 0.8 - 2.1, b + 0.8 + 2.1);
    // ось колеса в стіні
    const [wx, wz] = W(WHEEL.a, WHEEL.b);
    const wy = Math.max(0.15, ground(WHEEL.a, WHEEL.b)) + WHEEL.r - 0.15;
    const axLen = Math.abs(b0 - WHEEL.b) + 0.4;
    const [mx, mz] = W(WHEEL.a, (b0 + WHEEL.b) / 2);
    batch.add(cylGeo(0.09, 0.09, axLen, 8), M.iron, T(mx, wy, mz, ryB, Math.PI / 2));
    // опора колеса з того боку струмка
    const [sx, sz] = W(WHEEL.a, WHEEL.b - 0.9);
    const sgy = ground(WHEEL.a, WHEEL.b - 0.9);
    batch.add(boxGeo(0.3, wy - sgy + 0.2, 0.3), M.woodDark, T(sx, (wy + sgy) / 2, sz));
    solidCircle(WHEEL.a, WHEEL.b, WHEEL.r + 0.2);
    void wx;
    void wz;
  }

  // ── колоди: штабелі біля лісопилки ──
  const logPile = (a: number, b: number, alongA: boolean, rows = 3, len = 4.2) => {
    const y0 = ground(a, b);
    for (let r = 0; r < rows; r++) {
      const n = rows - r;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 0.58;
        const [la, lb] = alongA ? [a, b + off] : [a + off, b];
        batch.add(cylGeo(0.29, 0.29, len, 9), M.trunk, at(la, lb, y0 + 0.29 + r * 0.5, alongA ? ryA : ryB, Math.PI / 2));
      }
    }
    if (alongA) solidAA(a - len / 2, a + len / 2, b - rows * 0.3, b + rows * 0.3);
    else solidAA(a - rows * 0.3, a + rows * 0.3, b - len / 2, b + len / 2);
  };
  logPile(-19.4, -49.2, true, 3);
  logPile(-7.4, -48.6, false, 3, 3.8);
  logPile(-18.6, -57.2, true, 2, 3.6);

  // ── склад деревини: червоний, на кам'яному цоколі (схил) ──
  {
    const w = 9, d = 7;
    const cs = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([u, v]) => ground(SHED.a + v, SHED.b - u));
    const lo = Math.min(...cs), hi = Math.max(...cs);
    const y0 = hi - 0.15;
    const [x, z] = W(SHED.a, SHED.b);
    if (y0 - lo > 0.3) batch.add(boxGeo(w + 0.3, y0 - lo + 0.6, d + 0.3, 2), M.stoneDark, T(x, (y0 + lo) / 2 - 0.3, z, ryA));
    c.house({ x, z, y0, ry: ryA, w, d, h: 4.4, rh: 1.9, wall: M.sdRed, roof: M.roofDark, door: -1.6, snow: true });
    solidAA(SHED.a - d / 2 - 0.2, SHED.a + d / 2 + 0.2, SHED.b - w / 2 - 0.2, SHED.b + w / 2 + 0.2);
  }

  // ── пастки для лобстерів і буї: стоси на набережній і біля лавки ──
  // пастка: зелена дротяна сітка в тонкому дерев'яному каркасі; буй — циліндр зі смугою.
  // Усі пастки й буї гавані — однією геометрією з кольором у вершинах (1 виклик малювання)
  const trapGeo = (() => {
    const F = 0xb08d63;
    const parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4]> = [[boxGeo(0.96, 0.46, 0.66), 0x5c8a55, T(0, 0.25, 0)]];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push([boxGeo(0.05, 0.5, 0.05), F, T(sx * 0.49, 0.25, sz * 0.34)]);
    for (const y of [0.02, 0.5]) {
      for (const sz of [-1, 1]) parts.push([boxGeo(1.02, 0.05, 0.05), F, T(0, y, sz * 0.34)]);
      for (const sx of [-1, 1]) parts.push([boxGeo(0.05, 0.05, 0.72), F, T(sx * 0.49, y, 0)]);
    }
    parts.push([boxGeo(0.03, 0.47, 0.67), 0xd8c9a6, T(0, 0.25, 0)]);
    return painted(parts);
  })();
  const buoyGeo = (c1: number, c2: number) => painted([
    [cylGeo(0.16, 0.16, 0.5, 9), c1, T(0, 0.25, 0)],
    [cylGeo(0.165, 0.165, 0.14, 9), c2, T(0, 0.3, 0)],
    [cylGeo(0.03, 0.03, 0.5, 5), 0x6b4a32, T(0, 0.7, 0)],
  ]);
  const buoys = [buoyGeo(0xd23b2a, 0xf2efe6), buoyGeo(0xf2c12e, 0x2a4f7a), buoyGeo(0x3f8f5a, 0xf2efe6)];
  const trapParts = (m: THREE.Matrix4) => batch.add(trapGeo, vcol, m, false);
  const buoyParts = (m: THREE.Matrix4, k: number) => batch.add(buoys[k % 3], vcol, m, false);
  const trapStack = (a: number, b: number, n: number, y?: number) => {
    const y0 = y ?? ground(a, b);
    let k = 0;
    for (let row = 0; row < 3 && k < n; row++) {
      for (let i = 0; i < 2 - (row > 1 ? 1 : 0) && k < n; i++, k++) {
        trapParts(at(a + (i - 0.5) * 0.76 + row * 0.18, b + (row % 2) * 0.12, y0 + row * 0.52, ryA + (k % 3) * 0.05));
      }
    }
    // буї, притулені до стосу
    for (let i = 0; i < 3; i++) buoyParts(at(a + 0.9, b - 0.5 + i * 0.4, y0, ryA, 0.22, 0), i + n);
    solidAA(a - 0.9, a + 1.1, b - 0.6, b + 0.6);
  };
  trapStack(-4.4, -20.5, 5, p.plY);
  trapStack(-4.4, 21.5, 4, p.plY);

  // ── «Кленова лавка»: ґанок з навісом, поручні, крісло-гойдалка, бочки сиропу ──
  const storeHouse = { a: STORE.a - 1.2 - 2.3, w: 6, d: 4.6, h: 3.2, rh: 1.4 };
  const porch = { a0: STORE.a - 1.2, a1: STORE.a + 1.3, b0: STORE.b - 3, b1: STORE.b + 3 };
  const PY = p.plY + 0.18;
  {
    const { a0, a1, b0, b1 } = porch;
    const am = (a0 + a1) / 2;
    batch.add(boxGeo(b1 - b0, 0.18, a1 - a0, 3, 1), M.woodGrey, at(am, STORE.b, PY - 0.09));
    platforms.push(siteRect(p, a0, a1, b0, b1, PY));
    for (const pb of [b0 + 0.15, b1 - 0.15]) {
      batch.add(boxGeo(0.16, 2.5, 0.16), M.whitePaint, at(a1 - 0.15, pb, PY + 1.25));
      solidCircle(a1 - 0.15, pb, 0.18);
      // поручень з боків
      batch.add(boxGeo(0.08, 0.08, a1 - a0 - 0.2), M.whitePaint, at(am, pb, PY + 0.85));
    }
    // навіс: похилий дах від стіни до стовпів, сніг зверху
    const roofLen = Math.hypot(a1 - a0 + 0.5, 0.6);
    const tilt = Math.atan2(0.6, a1 - a0 + 0.5);
    batch.add(boxGeo(b1 - b0 + 0.6, 0.12, roofLen), M.roofDark, at(am + 0.2, STORE.b, PY + 2.75, ryA, tilt));
    batch.add(boxGeo(b1 - b0 + 0.3, 0.09, roofLen * 0.85), snowMat, at(am + 0.1, STORE.b, PY + 2.86, ryA, tilt));
    // ліхтар на ґанку
    const [lx, lz] = W(a1 - 0.35, STORE.b - 1.6);
    batch.add(boxGeo(0.18, 0.24, 0.18), M.lamp, T(lx, PY + 2.3, lz), false);
    c.glow(lx, PY + 2.3, lz, 1.4);
    // бочки з сиропом і відра біля сходинки
    for (let i = 0; i < 3; i++) {
      const [bx, bz] = W(a1 + 0.6, b0 + 0.6 + i * 0.75);
      batch.add(cylGeo(0.3, 0.3, 0.8, 10), i === 1 ? M.redPaint : M.woodDark, T(bx, p.plY + 0.4, bz));
      batch.add(cylGeo(0.31, 0.31, 0.05, 10), M.iron, T(bx, p.plY + 0.65, bz));
    }
    solidAA(a1 + 0.25, a1 + 0.95, b0 + 0.25, b0 + 2.25);
    // комин на даху лавки — дим
    const ch = at(storeHouse.a - 0.6, STORE.b + 1.8, p.plY + 0.3 + storeHouse.h + storeHouse.rh - 0.2);
    batch.add(boxGeo(0.5, 1.5, 0.5), M.stoneDark, ch);
    const cp = new THREE.Vector3().setFromMatrixPosition(ch);
    smokeAt.push(new THREE.Vector3(cp.x, cp.y + 0.85, cp.z));
  }
  // комини й дим у хатині з колод і крамниці
  for (const s of p.svc) {
    if (s.kind !== 'base' && s.kind !== 'shop') continue;
    const d = 4.6, h = 3.2, rh = 1.4;
    const ca = s.a - 1.2 - d / 2;
    const m = at(ca - 0.7, s.b - 1.6, p.plY + 0.3 + h + rh - 0.25);
    batch.add(boxGeo(0.5, 1.4, 0.5), M.stoneDark, m);
    const cp = new THREE.Vector3().setFromMatrixPosition(m);
    smokeAt.push(new THREE.Vector3(cp.x, cp.y + 0.8, cp.z));
  }

  // ── рухоме: колесо, дим, ворони ──
  // водяне колесо: два обідки, лопаті, маточина — одним мешем
  const wheel = new THREE.Group();
  {
    const R = WHEEL.r, Wd = 0.85;
    const parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4]> = [];
    for (const s of [-1, 1]) parts.push([new THREE.TorusGeometry(R, 0.07, 5, 22), 0x5a4330, T(0, 0, s * Wd / 2)]);
    for (let i = 0; i < 10; i++) {
      const q = (i / 10) * Math.PI * 2;
      parts.push([boxGeo(0.07, R * 0.95, 0.05), 0x6a4f35, T(Math.cos(q) * R * 0.48, Math.sin(q) * R * 0.48, -Wd / 2, 0, 0, q - Math.PI / 2)]);
      parts.push([boxGeo(0.07, R * 0.95, 0.05), 0x6a4f35, T(Math.cos(q) * R * 0.48, Math.sin(q) * R * 0.48, Wd / 2, 0, 0, q - Math.PI / 2)]);
      parts.push([boxGeo(0.42, 0.06, Wd), 0x7a5a3c, T(Math.cos(q) * (R - 0.15), Math.sin(q) * (R - 0.15), 0, 0, 0, q)]);
    }
    parts.push([cylGeo(0.22, 0.22, Wd + 0.2, 10), 0x3a3530, T(0, 0, 0, 0, Math.PI / 2)]);
    const m = new THREE.Mesh(painted(parts), vcol);
    wheel.add(m);
    const [x, z] = W(WHEEL.a, WHEEL.b);
    wheel.position.set(x, Math.max(0.15, ground(WHEEL.a, WHEEL.b)) + WHEEL.r - 0.15, z);
    wheel.rotation.y = ryB;
    live.add(wheel);
  }
  // ворони: один InstancedMesh (1 виклик малювання) — сидять на гребенях і колодах, одна кружляє
  const crowGeo = painted([
    [boxGeo(0.16, 0.16, 0.34), 0x15171a, T(0, 0.12, 0)],
    [boxGeo(0.12, 0.12, 0.13), 0x15171a, T(0, 0.22, 0.2)],
    [boxGeo(0.04, 0.04, 0.1), 0x3a3d40, T(0, 0.21, 0.31)],
    [boxGeo(0.12, 0.03, 0.2), 0x15171a, T(0, 0.1, -0.24, 0, 0.3)],
    [boxGeo(0.34, 0.03, 0.18), 0x1d2024, T(0, 0.16, -0.02)],
  ]);
  const shedRidge = (() => { const cs = [[-4.5, -3.5], [4.5, -3.5], [-4.5, 3.5], [4.5, 3.5]].map(([u, v]) => ground(SHED.a + v, SHED.b - u)); return Math.max(...cs) - 0.15 + 0.3 + 4.4 + 1.9 + 0.2; })();
  const perches: Array<[number, number, number]> = [
    [SHED.a, SHED.b - 2.5, shedRidge],
    [SHED.a, SHED.b + 1.8, shedRidge],
    [-19.4, -49.2, ground(-19.4, -49.2) + 1.29],
    [MILL.a, MILL.b - 2, FY + 3 + 1.5 + 0.2],
  ];
  const crows = new THREE.InstancedMesh(crowGeo, vcol, perches.length + 1);
  crows.castShadow = false;
  crows.frustumCulled = false;
  live.add(crows);
  const crowM = new THREE.Matrix4();
  const crowP = new THREE.Vector3(), crowQ = new THREE.Quaternion(), crowS = new THREE.Vector3(1.2, 1.2, 1.2), crowE = new THREE.Euler();
  const crowState = perches.map((q, i) => ({ q, ry: i * 1.7, hop: 0, next: 2 + i * 1.3 }));

  // ── дим: усі клуби одним Points ──
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
  const PUFFS = 3;
  const nP = smokeAt.length * PUFFS;
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(nP * 3), 3));
  smokeGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(nP * 4).fill(0.92), 4));
  const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ map: smokeTex, size: 1.9, sizeAttenuation: true, transparent: true, depthWrite: false, vertexColors: true }));
  smoke.frustumCulled = false;
  live.add(smoke);

  // ── мешканці: три гурти (ґанок, лісопилка, причал) — кожен видно лише ближче ~70 м ──
  const npcs: Npc[] = [];
  const addNpc = (root: THREE.Object3D, lines: string[], headY: number) => {
    const bubbleMat = new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    const bubble = new THREE.Sprite(bubbleMat);
    bubble.scale.set(2.6, 0.49, 1);
    bubble.visible = false;
    bubble.renderOrder = 10;
    live.add(bubble);
    npcs.push({ rig: { root }, lines, line: Math.floor(Math.random() * lines.length), bubble, bubbleMat, shown: 0, near: false, headY });
  };
  const cluster = (a: number, b: number) => {
    const grp = new THREE.Group();
    grp.visible = false;
    live.add(grp);
    const [x, z] = W(a, b);
    return { grp, x, z, anims: [] as Array<(dt: number, t: number) => void> };
  };
  const porchC = cluster(STORE.a, STORE.b);
  const millC = cluster(MILL.a - 4, MILL.b);
  const pierC = cluster(p.pierL - 2, 0);
  const sitPose = (r: CharacterRig) => {
    r.legL.rotation.set(-Math.PI / 2 + 0.2, -0.1, 0);
    r.legR.rotation.set(-Math.PI / 2 + 0.2, 0.1, 0);
    r.kneeL.rotation.x = r.kneeR.rotation.x = Math.PI / 2 - 0.2;
  };

  // старий Ерл у кріслі-гойдалці на ґанку
  {
    const rocker = new THREE.Group();
    const chair = new THREE.Mesh(painted([
      [boxGeo(0.62, 0.07, 0.56), 0x7a4a2a, T(0, 0.45, 0)],
      [boxGeo(0.62, 0.8, 0.07), 0x7a4a2a, T(0, 0.85, -0.27, 0, -0.15)],
      ...[-1, 1].map((s): [THREE.BufferGeometry, number, THREE.Matrix4] => [new THREE.TorusGeometry(0.75, 0.035, 4, 14, Math.PI * 0.5), 0x5a3420, T(s * 0.3, 0.78, 0, Math.PI / 2, 0, Math.PI * 1.25)]),
      ...[-1, 1].map((s): [THREE.BufferGeometry, number, THREE.Matrix4] => [boxGeo(0.05, 0.05, 0.5), 0x5a3420, T(s * 0.33, 0.68, 0.02)]),
      ...[-1, 1].flatMap((s): Array<[THREE.BufferGeometry, number, THREE.Matrix4]> => [[boxGeo(0.04, 0.42, 0.04), 0x5a3420, T(s * 0.28, 0.24, 0.22)], [boxGeo(0.04, 0.42, 0.04), 0x5a3420, T(s * 0.28, 0.24, -0.22)]]),
    ]), vcol);
    rocker.add(chair);
    const r = buildCharacter({ jacket: 0x4f6b3a, jacketKind: 'knit', pants: 0x3b4252, hat: 'cap', hatColor: 0x8a3a2c, hair: 'short', hairColor: HAIRS[6], beard: 'full', skin: SKINS[1], brow: 0.35, boots: 0x3a2a20, belly: true, scarf: 0xb8453a }, { coarse: true });
    sitPose(r);
    r.root.position.set(0, -0.34, -0.02);
    r.armL.rotation.x = -0.6;
    r.armR.rotation.x = -0.75;
    rocker.add(r.root);
    const [x, z] = W(porch.a1 - 0.8, STORE.b + 1.6);
    rocker.position.set(x, PY, z);
    rocker.rotation.order = 'YXZ';
    rocker.rotation.y = ryA;
    porchC.grp.add(rocker);
    solidCircle(porch.a1 - 0.8, STORE.b + 1.6, 0.55);
    porchC.anims.push((_dt, t) => {
      rocker.rotation.x = Math.sin(t * 1.4) * 0.09;
      r.head.rotation.y = Math.sin(t * 0.3) * 0.35;
    });
    addNpc(rocker, [
      L('Сорок зим тримаю лавку — і жодної без кленового сиропу.', `Forty winters I've kept this store — not one without maple syrup.`),
      L('Туман тут густий, як млинцеве тісто. Тримай ріжок напоготові.', `Fog here's thick as pancake batter. Keep your horn handy.`),
      L('Тепло — найкращий капітан. Какао, синку?', `Warmth's the best skipper there is. Cocoa, son?`),
      L('Лось знову на узліссі? Значить, до обіду буде ясно.', `Moose by the treeline again? Means it'll stay clear till noon.`),
    ], 1.25);
  }

  // лісоруб Жак рубає дрова біля лісопилки
  {
    const [x, z] = W(-7.6, -52.4);
    const y = ground(-7.6, -52.4);
    batch.add(cylGeo(0.36, 0.4, 0.55, 10), M.trunk, T(x, y + 0.27, z));
    for (let i = 0; i < 5; i++) {
      const [fx, fz] = W(-6.4 + (i % 2) * 0.3, -51.2 + i * 0.32);
      batch.add(boxGeo(0.14, 0.14, 0.55), M.woodDark, T(fx, ground(-6.4, -51.2) + 0.08 + Math.floor(i / 2) * 0.13, fz, ryA + i * 0.4));
    }
    const r = buildCharacter({ jacket: 0xb23a2e, jacketKind: 'knit', pants: 0x2f4060, hat: 'beanie', hatColor: 0x1d1f22, hatAccent: 0xb23a2e, hair: 'short', hairColor: HAIRS[2], beard: 'full', skin: SKINS[2], brow: -0.1, bib: 0x2f4060, boots: 0x4a3322, gloves: 0x6b4a2a }, { coarse: true });
    const axe = new THREE.Mesh(painted([
      [boxGeo(0.05, 0.85, 0.05), 0x8a6a42, T(0, -0.45, 0)],
      [boxGeo(0.05, 0.16, 0.24), 0x6e7378, T(0, -0.85, 0.1)],
    ]), vcol);
    r.armR.add(axe);
    r.root.position.set(x - p.ox * 0.75, y, z - p.oz * 0.75);
    r.root.rotation.y = ryA;
    millC.grp.add(r.root);
    solidCircle(-8.35, -52.4, 0.45);
    millC.anims.push((_dt, t) => {
      const k = (t * 0.9) % 1;
      const sw = k < 0.6 ? -2.6 * (k / 0.6) : -2.6 + 3.0 * ((k - 0.6) / 0.4);
      r.armR.rotation.x = Math.min(0.4, sw);
      r.armL.rotation.x = Math.min(0.4, sw) * 0.9;
      r.torso.rotation.x = k > 0.6 ? 0.25 * ((k - 0.6) / 0.4) : 0;
    });
    addNpc(r.root, [
      L('Сосна — на щогли, кедр — на дахи, а ялиця — в грубку!', `Pine for masts, cedar for roofs, fir for the stove!`),
      L('Колесо крутить струмок, а пилку — я.', `The creek turns the wheel. I turn the saw.`),
      L('Зима довга — дров ніколи не забагато.', `Winters are long — there's no such thing as too much firewood.`),
    ], 1.9);
  }

  // лісоруб Гастон носить колоду від штабеля до пилки
  {
    const r = buildCharacter({ jacket: 0x9a2f2a, jacketKind: 'coat', pants: 0x3a3a2f, hat: 'cap', hatColor: 0x2d4a33, hair: 'short', hairColor: HAIRS[0], beard: 'mustache', skin: SKINS[3], boots: 0x2a2826, gloves: 0x6b4a2a }, { coarse: true });
    const log = new THREE.Mesh(cylGeo(0.17, 0.17, 2.6, 8), M.trunk);
    log.rotation.z = Math.PI / 2;
    log.position.set(0.05, 1.62, 0.05);
    r.root.add(log);
    r.armR.rotation.x = -2.6;
    r.armL.rotation.x = -0.3;
    millC.grp.add(r.root);
    const path: Array<[number, number]> = [[-17.6, -51.3], [-15.6, -51.3], [-15.6, -48.3], [-10.4, -48.3], [-15.6, -48.3], [-15.6, -51.3]];
    let k = 1, wait = 0;
    const cur = new THREE.Vector2(...W(path[0][0], path[0][1]));
    millC.anims.push((dt, t) => {
      if (wait > 0) {
        wait -= dt;
        r.legL.rotation.x = r.legR.rotation.x = 0;
        return;
      }
      const [tx, tz] = W(path[k][0], path[k][1]);
      const dx = tx - cur.x, dz = tz - cur.y;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        k = (k + 1) % path.length;
        if (k === 0 || k === 3) wait = 1.5;
        return;
      }
      const sp = 1.1 * dt;
      cur.x += (dx / d) * Math.min(sp, d);
      cur.y += (dz / d) * Math.min(sp, d);
      r.root.position.set(cur.x, onMill(cur.x, cur.y) ? FY : H(cur.x, cur.y), cur.y);
      r.root.rotation.y = Math.atan2(dx, dz);
      const sw = Math.sin(t * 7);
      r.legL.rotation.x = sw * 0.45;
      r.legR.rotation.x = -sw * 0.45;
    });
    addNpc(r.root, [
      L('Обережно, колода!', `Mind the log!`),
      L('Склад повний кедру — бери накладну, на Лазуровому за нього платять щедро.', `The shed's full of cedar — grab an order, the Azure Coast pays well for it.`),
      L('Ворони знову на даху. До снігу, кажуть.', `Crows on the roof again. Snow's coming, they say.`),
    ], 1.9);
  }
  function onMill(x: number, z: number) {
    const rr = siteRect(p, MILL.a - MILL.lenA / 2, MILL.a + MILL.lenA / 2, MILL.b - MILL.lenB / 2, MILL.b + MILL.lenB / 2, 0);
    return x >= rr.x0 && x <= rr.x1 && z >= rr.z0 && z <= rr.z1;
  }

  // рибалка Меґі в жовтому дощовику на краю причалу
  {
    const pr = pierRect(p);
    const r = buildCharacter({ jacket: 0xf2c12e, jacketKind: 'rain', pants: 0x2a3b55, hat: 'sou', hatColor: 0xf2c12e, hair: 'long', hairColor: HAIRS[7], skin: SKINS[0], brow: 0.25, boots: 0x283b5c, stripes: false, bib: 0xf2c12e }, { coarse: true });
    const rod = new THREE.Mesh(painted([
      [cylGeo(0.012, 0.022, 2.6, 5), 0x3a2a1d, T(0, 1.2, 0)],
      [cylGeo(0.035, 0.035, 0.08, 8), 0x9aa3aa, T(0, 0.25, 0.05, 0, Math.PI / 2)],
    ]), vcol);
    rod.position.set(0, -0.62, 0.08);
    rod.rotation.x = 1.0;
    r.armR.add(rod);
    r.armR.rotation.x = -0.9;
    r.armL.rotation.x = -0.7;
    const [x, z] = W(p.pierL - 1.0, -1.1);
    r.root.position.set(x, pr.y, z);
    r.root.rotation.y = ryA;
    pierC.grp.add(r.root);
    solidCircle(p.pierL - 1.0, -1.1, 0.4);
    pierC.anims.push((_dt, t) => {
      r.armR.rotation.x = -0.9 + Math.sin(t * 0.8) * 0.06 + (Math.sin(t * 0.37) > 0.97 ? -0.25 : 0);
      r.head.rotation.y = Math.sin(t * 0.25) * 0.3;
    });
    addNpc(r.root, [
      L('Тут люблять тунця — теплолюбна риба в нас рідкість, на біржі за неї б\'ються.', `Folks here love tuna — warm-water fish is rare up north, they fight over it at the exchange.`),
      L('Бачиш лося на узліссі? Щоранку приходить, як по годиннику.', `See the moose by the treeline? He comes every morning like clockwork.`),
      L('Вітер із фіорду кусючий. Какао в Ерла — і знову в море.', `The fjord wind bites. Cocoa at Earl's — then back to sea.`),
    ], 1.9);
  }

  // лось на узліссі: пасеться, підводить голову, озирається. Один SkinnedMesh (тулуб + голова-кістка) — 1 виклик малювання
  {
    const moose = new THREE.Group();
    const BR = 0x6e4c33, DK = 0x45301f, AN = 0xd4bd92;
    const PIV = T(0, 2.25, 1.15);
    const at0 = (m: THREE.Matrix4) => PIV.clone().multiply(m);
    const parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4, number]> = [
      [boxGeo(0.95, 1.05, 2.3), BR, T(0, 1.75, 0), 0],
      [boxGeo(0.9, 0.55, 0.9), BR, T(0, 2.3, 0.75), 0],
      ...[[-0.32, 0.8], [0.32, 0.8], [-0.32, -0.85], [0.32, -0.85]].map(([lx, lz]): [THREE.BufferGeometry, number, THREE.Matrix4, number] => [boxGeo(0.18, 1.35, 0.2), DK, T(lx, 0.68, lz), 0]),
      [boxGeo(0.12, 0.3, 0.12), DK, T(0, 1.95, -1.2, 0, 0.6), 0],
      [boxGeo(0.42, 0.42, 0.9), BR, at0(T(0, 0, 0.35, 0, 0.5)), 1],
      [boxGeo(0.38, 0.4, 0.55), BR, at0(T(0, -0.32, 0.85, 0, 0.15)), 1],
      [boxGeo(0.36, 0.22, 0.32), DK, at0(T(0, -0.38, 1.12)), 1],
      [boxGeo(0.12, 0.28, 0.08), DK, at0(T(0, -0.62, 0.62)), 1],
      ...[-1, 1].flatMap((sg): Array<[THREE.BufferGeometry, number, THREE.Matrix4, number]> => [
        [boxGeo(0.62, 0.06, 0.34), AN, at0(T(sg * 0.5, 0.42, 0.42, 0, 0, sg * 0.35)), 1],
        [boxGeo(0.1, 0.22, 0.06), AN, at0(T(sg * 0.72, 0.6, 0.5, 0, 0, sg * 0.2)), 1],
        [boxGeo(0.1, 0.22, 0.06), AN, at0(T(sg * 0.62, 0.6, 0.3, 0, 0, sg * 0.2)), 1],
        [boxGeo(0.12, 0.08, 0.2), BR, at0(T(sg * 0.26, 0.25, 0.22, 0, 0, sg * 0.6)), 1],
      ]),
    ];
    const geo = painted(parts.map(([g0, c0, m]) => [g0, c0, m]));
    {
      const n = geo.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      let v = 0;
      for (const [g0, , , bone] of parts) {
        const cnt = g0.index ? g0.index.count : g0.attributes.position.count;
        for (let k = 0; k < cnt; k++, v++) { si[v * 4] = bone; sw[v * 4] = 1; }
      }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    }
    const rootBone = new THREE.Bone();
    const head = new THREE.Bone();
    head.position.set(0, 2.25, 1.15);
    rootBone.add(head);
    const mesh = new THREE.SkinnedMesh(geo, vcol);
    mesh.add(rootBone);
    mesh.bind(new THREE.Skeleton([rootBone, head]));
    mesh.frustumCulled = false;
    moose.add(mesh);
    const [x, z] = W(MOOSE.a, MOOSE.b);
    moose.position.set(x, ground(MOOSE.a, MOOSE.b), z);
    moose.rotation.y = ryA + 2.3;
    millC.grp.add(moose);
    solidCircle(MOOSE.a, MOOSE.b, 1.4);
    let look = 0;
    millC.anims.push((dt, t) => {
      const graze = (Math.sin(t * 0.22) + 1) / 2; // 0 — пасеться, 1 — підвів голову
      head.rotation.x = 1.05 * (1 - graze) - 0.1;
      look += ((graze > 0.8 ? Math.sin(t * 0.5) * 0.6 : 0) - look) * Math.min(1, dt * 2);
      head.rotation.y = look;
    });
  }

  for (const cl of [porchC, millC, pierC]) cl.grp.traverse((o) => (o.castShadow = false));

  // ── кадр: лише поблизу ──
  const center = new THREE.Vector3(...((): [number, number, number] => { const [x, z] = W(-20, -15); return [x, 0, z]; })());
  let wasNear = true;
  let unmarked = false;
  return {
    update(dt, t, cam, night) {
      // рухоме й струмок з-під води не видно — прибираємо з проходу переломлення (main розмічає шар у першому кадрі)
      if (!unmarked && t > 0.5) {
        unmarked = true;
        live.traverse((o) => o.layers.disable(UNDERWATER_LAYER));
        for (const o of g.children) if ((o as THREE.Mesh).material === streamMat) o.layers.disable(UNDERWATER_LAYER);
      }
      const d = Math.hypot(cam.x - center.x, cam.z - center.z);
      const near = d < 240;
      if (near !== wasNear) {
        live.userData.hide = !near;
        live.visible = near;
        wasNear = near;
      }
      if (!near) return;
      // струмок тече, колесо крутиться
      if (streamMat.map) streamMat.map.offset.y = -t * 0.35;
      wheel.children[0].rotation.z = -t * 0.9;
      // дим
      {
        const pa = smokeGeo.attributes.position as THREE.BufferAttribute;
        const ca = smokeGeo.attributes.color as THREE.BufferAttribute;
        for (let i = 0; i < nP; i++) {
          const o = smokeAt[Math.floor(i / PUFFS)], ph = (i % PUFFS) / PUFFS;
          const k = (t * 0.11 + ph) % 1;
          pa.setXYZ(i, o.x + k * 1.4 + Math.sin(t + ph * 6) * 0.15, o.y + k * 3.4, o.z + k * 0.8);
          ca.setW(i, Math.sin(k * Math.PI) * (0.42 - night * 0.2));
        }
        pa.needsUpdate = true;
        ca.needsUpdate = true;
      }
      // ворони: інколи підстрибують і обертаються; п'ята кружляє над лісопилкою
      crowState.forEach((s, i) => {
        s.next -= dt;
        if (s.next <= 0) {
          s.next = 2.5 + ((i * 7.3 + t) % 4);
          s.hop = 0.35;
          s.ry += (Math.sin(t * 3 + i) > 0 ? 1 : -1) * 0.9;
        }
        s.hop = Math.max(0, s.hop - dt);
        const [x, z] = W(s.q[0], s.q[1]);
        const y = s.q[2] + Math.sin((s.hop / 0.35) * Math.PI) * 0.18;
        crowM.compose(crowP.set(x, y, z), crowQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.ry), crowS.setScalar(1.2));
        crows.setMatrixAt(i, crowM);
      });
      {
        const q = t * 0.35;
        const [x, z] = W(MILL.a - 8 + Math.cos(q) * 14, MILL.b + Math.sin(q) * 14);
        crowM.compose(crowP.set(x, 16 + Math.sin(t * 0.7) * 1.5, z), crowQ.setFromEuler(crowE.set(0, -q + Math.PI + ryA, 0.35)), crowS.setScalar(1.3));
        crows.setMatrixAt(perches.length, crowM);
      }
      crows.instanceMatrix.needsUpdate = true;
      // гурти мешканців: видно ближче ~70 м (з гістерезисом)
      for (const cl of [porchC, millC, pierC]) {
        const dc = Math.hypot(cam.x - cl.x, cam.z - cl.z);
        cl.grp.visible = cl.grp.visible ? dc < 72 : dc < 62;
        if (cl.grp.visible) for (const a of cl.anims) a(dt, t);
      }
      // репліки
      for (const n of npcs) {
        const root = n.rig.root;
        if (!root.parent?.visible) {
          n.bubble.visible = false;
          n.near = false;
          n.shown = 0;
          continue;
        }
        const rp = root.getWorldPosition(_v);
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

const _v = new THREE.Vector3();
