import * as THREE from 'three';
import { L } from '../core/i18n';
import { Batch, T, boxGeo, cylGeo } from './portKit';
import { buildCharacter, HAIRS, SKINS, type CharacterLook, type CharacterRig } from './character';
import { siteRect, siteToWorld, siteGround, type PortSite } from './portSites';
import type { Platform, Solid } from './port';
import type { RockObstacle } from './boat';
import { glowTex } from './textures';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─────────────────────────────────────────────────────────────
// Сонячна Марина — курорт: пляж із шезлонгами під парасольками, понтон
// із яхтами-сусідами, гірлянди над набережною (вночі світять — матеріал
// ліхтарів порту), літнє кафе, кіоск «Морозиво й сувеніри» з візком і
// відпочивальники. Нерухоме — у Batch гавані (зливається з рештою),
// люди й гітарист — окрема група, оживає лише поблизу.
// ─────────────────────────────────────────────────────────────

/** кіоск морозива (послуга 'gelato' у portSites): місце біля дверей */
export const GELATO_AT: [number, number] = [-5, -17.5];
/** понтон із яхтами-сусідами (локальне b) */
const PONTOON_B = 18;

export interface ResortCtx {
  p: PortSite;
  batch: Batch;
  g: THREE.Group;
  M: Record<string, THREE.Material>;
  ry: number;
  rng: () => number;
  platforms: Platform[];
  solids: Solid[];
  rocks?: RockObstacle[];
  /** вільна точка суходолу заданої висоти (поза містечком) */
  landSpot: (minH: number, maxH: number, avoidTown?: boolean) => [number, number] | null;
  palm: (x: number, z: number, y: number, s: number) => void;
}

interface Person {
  rig: CharacterRig;
  pose: 'stand' | 'sit' | 'lie' | 'walk' | 'play';
  phase: number;
  path?: { ax: number; az: number; bx: number; bz: number; t: number; dir: number; speed: number };
  y: number;
  shown?: boolean;
}

/** будує декор у batch і повертає «життя» (люди, гітарист) */
export function buildResort(c: ResortCtx): ResortLife {
  const { p, M, ry, rng } = c;
  // один ключ злиття на матеріал: тінь кидає все, крім лампочок (як ліхтарі порту) — без зайвих мешів
  const batch = { add: (geo: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4, _cast?: boolean) => c.batch.add(geo, mat, m, mat !== M.lamp && mat !== M.lens) };
  const W = (a: number, b: number) => siteToWorld(p, a, b);
  const H = (x: number, z: number) => siteGround(p, x, z);
  const hw = p.plW / 2;
  const solidCircle = (x: number, z: number, r: number) => c.solids.push({ x, z, r });
  const solidBox = (x: number, z: number, w: number, d: number) => c.solids.push({ x, z, hw: w / 2, hd: d / 2, ry: 0 });
  const along = ry + Math.PI / 2;
  const canvases = [M.canvasA, M.canvasB, M.canvasC];
  const life = new ResortLife(p);

  // ── пляж: парасольки, під кожною два шезлонги й рушник ──
  const lounger = (x: number, y: number, z: number, r: number, col: THREE.Material) => {
    const m = T(x, y, z, r);
    const at = (lx: number, ly: number, lz: number, rx = 0) => m.clone().multiply(T(lx, ly, lz, 0, rx));
    // рама на ніжках і похила спинка
    for (const sx of [-0.28, 0.28]) for (const sz of [-0.8, 0.55]) batch.add(boxGeo(0.05, 0.28, 0.05), M.trim, at(sx, 0.14, sz), false);
    batch.add(boxGeo(0.62, 0.06, 1.45), M.trim, at(0, 0.3, -0.15));
    batch.add(boxGeo(0.58, 0.05, 1.35), col, at(0, 0.345, -0.15), false);
    batch.add(boxGeo(0.62, 0.06, 0.7), M.trim, at(0, 0.52, 0.75, -0.6));
    batch.add(boxGeo(0.58, 0.05, 0.62), col, at(0, 0.55, 0.73, -0.6), false);
  };
  const beachSpots: Array<[number, number, number]> = [];
  for (let i = 0; i < 9; i++) {
    const s = c.landSpot(0.35, 1.3, true);
    if (!s) continue;
    if (beachSpots.some(([x, z]) => Math.hypot(x - s[0], z - s[1]) < 7)) continue;
    const y = H(s[0], s[1]);
    const col = canvases[i % 3];
    batch.add(cylGeo(0.04, 0.04, 2.3, 6), M.iron, T(s[0], y + 1.15, s[1]));
    batch.add(new THREE.ConeGeometry(1.45, 0.55, 10, 1, true), col, T(s[0], y + 2.35, s[1]));
    batch.add(new THREE.SphereGeometry(0.07, 6, 4), M.trim, T(s[0], y + 2.66, s[1]), false);
    const r = rng() * Math.PI * 2;
    const ox = Math.cos(r), oz = -Math.sin(r);
    for (const k of [-1, 1]) {
      const lx = s[0] + ox * 0.55 * k, lz = s[1] + oz * 0.55 * k;
      lounger(lx, H(lx, lz), lz, r, k < 0 ? M.canvasB : col);
    }
    // рушник поруч
    const tx = s[0] - Math.sin(r) * 1.9, tz = s[1] - Math.cos(r) * 1.9;
    batch.add(boxGeo(0.8, 0.02, 1.7), i % 2 ? M.canvasC : M.canvasA, T(tx, H(tx, tz) + 0.02, tz, r), false);
    solidCircle(s[0], s[1], 1.1);
    beachSpots.push([s[0], s[1], r]);
  }

  // ── понтон з яхтами-сусідами ──
  {
    const b = PONTOON_B;
    let a1 = 4;
    for (let a = 4; a <= 26; a += 2) {
      const [x, z] = W(a, b);
      if (H(x, z) > -1.6) break;
      a1 = a;
    }
    if (a1 >= 14) {
      const len = a1 - 1.5;
      const [mx, mz] = W(1.5 + len / 2, b);
      const deckY = 0.62;
      batch.add(boxGeo(2.2, 0.16, len, 1, 4), M.deck, T(mx, deckY, mz, ry));
      // поплавці
      for (let a = 2.5; a < 1.5 + len; a += 3) {
        const [fx, fz] = W(a, b);
        batch.add(boxGeo(1.9, 0.35, 1.2), M.woodGrey, T(fx, deckY - 0.24, fz, ry), false);
      }
      // трап з набережної на понтон
      const [gx, gz] = W(0.6, b);
      const rampLen = 2.6;
      batch.add(boxGeo(1.1, 0.08, rampLen), M.deck, T(gx, (p.plY + deckY) / 2 + 0.05, gz, ry, Math.atan2(p.plY - deckY, rampLen)));
      for (const s of [-1, 1]) {
        const [rx, rz] = W(0.6, b + s * 0.55);
        batch.add(boxGeo(0.04, 0.04, rampLen), M.iron, T(rx, (p.plY + deckY) / 2 + 0.75, rz, ry, Math.atan2(p.plY - deckY, rampLen)), false);
      }
      c.platforms.push(siteRect(p, -0.2, 1.6, b - 0.55, b + 0.55, (p.plY + deckY) / 2 + 0.1));
      c.platforms.push(siteRect(p, 1.5, 1.5 + len, b - 1.1, b + 1.1, deckY + 0.08));
      // качки-тумби й колізія для човнів (на лоції не малюються)
      for (let a = 4; a < 1.5 + len; a += 4) {
        const [kx, kz] = W(a, b + 1.0);
        batch.add(cylGeo(0.08, 0.1, 0.25, 6), M.iron, T(kx, deckY + 0.2, kz), false);
        const [cx, cz] = W(a, b);
        c.rocks?.push({ x: cx, z: cz, r: 1.5, kind: 'pier' });
      }
      // яхти-сусіди з зовнішнього боку понтона
      const hulls = [M.whitePaint, M.sdBlue, M.whitePaint, M.redPaint];
      const covers = [M.canvasC, M.canvasA, M.canvasC, M.canvasB];
      let k = 0;
      for (let a = 5.5; a + 3.5 < 1.5 + len; a += 7.5, k++) {
        const [yx, yz] = W(a, b + 3.4);
        neighbourYacht(batch, M, yx, yz, ry, 6.2 + (k % 2) * 1.2, hulls[k % hulls.length], covers[k % covers.length]);
        c.rocks?.push({ x: yx, z: yz, r: 2.6, kind: 'pier' });
        life.bobbers.push([yx, yz]);
      }
      // табличка «Гостьові місця» на корені понтона
      const [sx, sz] = W(-0.4, b + 1.4);
      batch.add(boxGeo(0.08, 1.4, 0.08), M.woodDark, T(sx, p.plY + 0.7, sz));
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.45), new THREE.MeshStandardMaterial({ map: plaqueTex(L('ПОНТОН · ГОСТЬОВІ ЯХТИ', 'PONTOON · GUEST YACHTS')), roughness: 0.8 }));
      sign.applyMatrix4(T(sx, p.plY + 1.45, sz, ry));
      c.g.add(sign);
    }
  }

  // ── гірлянди між ліхтарями набережної (вночі світять разом із ліхтарями) ──
  {
    const posts: number[] = [];
    for (let b = -hw + 4; b <= hw - 4; b += 12) if (Math.abs(b) >= p.pierW / 2 + 2) posts.push(b);
    const bulbCols = [M.lamp, M.lamp, M.canvasA, M.canvasC];
    const cableTop = p.plY + 3.35;
    for (let i = 0; i + 1 < posts.length; i++) {
      const b0 = posts[i], b1 = posts[i + 1];
      if (b1 - b0 > 14) continue;
      const pts: THREE.Vector3[] = [];
      const n = 16;
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const [x, z] = W(-1.8, b0 + (b1 - b0) * f);
        pts.push(new THREE.Vector3(x, cableTop - Math.sin(f * Math.PI) * 0.9, z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      batch.add(new THREE.TubeGeometry(curve, 18, 0.012, 3, false), M.iron, undefined, false);
      for (let k = 1; k < 14; k++) {
        const q = curve.getPoint(k / 14);
        batch.add(new THREE.SphereGeometry(0.06, 6, 4), k % 3 === 0 ? bulbCols[(i + k) % 4] : M.lamp, T(q.x, q.y - 0.07, q.z), false);
      }
    }
  }

  // ── зигзаг гірлянд над терасою кафе на тонких стовпчиках ──
  {
    const zz: Array<[number, number]> = [[-1.8, 11.8], [-6.0, 14.2], [-1.8, 16.6], [-6.0, 19.0], [-1.8, 22.4]];
    const top = p.plY + 2.95;
    for (const [a, b] of zz) {
      const [x, z] = W(a, b);
      batch.add(cylGeo(0.035, 0.045, 3.0, 6), M.iron, T(x, p.plY + 1.5, z));
      solidCircle(x, z, 0.12);
    }
    for (let i = 0; i + 1 < zz.length; i++) {
      const [a0, b0] = zz[i], [a1, b1] = zz[i + 1];
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 10; k++) {
        const f = k / 10;
        const [x, z] = W(a0 + (a1 - a0) * f, b0 + (b1 - b0) * f);
        pts.push(new THREE.Vector3(x, top - Math.sin(f * Math.PI) * 0.45, z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      batch.add(new THREE.TubeGeometry(curve, 12, 0.01, 3, false), M.iron, undefined, false);
      for (let k = 1; k < 9; k++) {
        const q = curve.getPoint(k / 9);
        batch.add(new THREE.SphereGeometry(0.055, 6, 4), M.lamp, T(q.x, q.y - 0.06, q.z), false);
      }
    }
  }

  // ── літнє кафе з музикантом: столики під парасольками біля набережної ──
  const cafe: Array<[number, number]> = [[-3.6, 13.6], [-3.6, 17.2], [-3.6, 20.8]];
  for (const [i, [a, b]] of cafe.entries()) {
    const [x, z] = W(a, b);
    const y = p.plY;
    batch.add(cylGeo(0.42, 0.42, 0.05, 12), M.trim, T(x, y + 0.74, z));
    batch.add(cylGeo(0.04, 0.05, 0.72, 6), M.iron, T(x, y + 0.37, z));
    batch.add(cylGeo(0.035, 0.035, 2.3, 6), M.trim, T(x, y + 1.15, z), false);
    batch.add(new THREE.ConeGeometry(1.25, 0.45, 8, 1, true), i % 2 ? M.canvasB : M.canvasA, T(x, y + 2.35, z));
    for (const s of [-1, 1]) {
      const [cx, cz] = W(a, b + s * 0.75);
      const cr = along + (s > 0 ? Math.PI : 0);
      batch.add(boxGeo(0.42, 0.05, 0.42), M.woodDark, T(cx, y + 0.45, cz, cr), false);
      batch.add(boxGeo(0.42, 0.45, 0.05), M.woodDark, T(cx, y + 0.68, cz, cr).multiply(T(0, 0, -0.2)), false);
      for (const lx of [-0.17, 0.17]) for (const lz of [-0.17, 0.17]) batch.add(boxGeo(0.035, 0.45, 0.035), M.iron, T(cx, y + 0.22, cz, cr).multiply(T(lx, 0, lz)), false);
    }
    solidCircle(x, z, 0.9);
    // склянка лимонаду на столі
    batch.add(cylGeo(0.035, 0.03, 0.12, 6), M.lens, T(x + 0.12, y + 0.83, z), false);
  }

  // ── місце гітариста: ящик-сидіння й відкритий футляр для монет ──
  {
    const [x, z] = W(-6.8, 17);
    batch.add(boxGeo(0.5, 0.42, 0.5), M.woodDark, T(x, p.plY + 0.21, z, ry));
    const [cx, cz] = W(-5.7, 17);
    batch.add(boxGeo(0.35, 0.08, 0.9), M.redPaint, T(cx, p.plY + 0.05, cz, along));
    batch.add(boxGeo(0.29, 0.03, 0.82), M.canvasB, T(cx, p.plY + 0.1, cz, along));
    solidCircle(x, z, 0.5);
  }

  // ── кіоск морозива: смугастий навіс над дверима, візок, меню-дошка ──
  {
    const [ga, gb] = GELATO_AT;
    // будиночок послуги стоїть центром у (a − 1.2 − d/2), фасад — на a − 1.2
    const fa = ga - 1.2 + 0.05;
    for (let k = 0; k < 6; k++) {
      const [x, z] = W(fa + 0.65, gb - 1.5 + k * 0.6 + 0.3);
      batch.add(boxGeo(0.6, 0.05, 1.3), k % 2 ? M.canvasB : M.canvasC, T(x, p.plY + 2.75, z, along, 0, -0.35));
    }
    // візок на колесах з парасолькою
    const [vx, vz] = W(ga + 2.4, gb + 1.8);
    batch.add(boxGeo(1.5, 0.75, 0.75), M.canvasB, T(vx, p.plY + 0.75, vz, along));
    batch.add(boxGeo(1.56, 0.12, 0.81), M.canvasC, T(vx, p.plY + 1.18, vz, along));
    for (const k of [-1, 1]) {
      const [wx, wz] = W(ga + 2.4 + 0.42, gb + 1.8 + k * 0.62);
      batch.add(cylGeo(0.28, 0.28, 0.06, 12), M.iron, T(wx, p.plY + 0.3, wz, along, 0, Math.PI / 2), false);
    }
    for (let f = 0; f < 4; f++) {
      const [bx, bz] = W(ga + 2.4, gb + 1.8 - 0.45 + f * 0.3);
      batch.add(new THREE.SphereGeometry(0.1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), [M.canvasA, M.trim, M.canvasC, M.plOchre][f], T(bx, p.plY + 1.24, bz), false);
    }
    batch.add(cylGeo(0.03, 0.03, 2.1, 6), M.iron, T(vx, p.plY + 1.6, vz), false);
    batch.add(new THREE.ConeGeometry(1.05, 0.4, 8, 1, true), M.canvasA, T(vx, p.plY + 2.6, vz));
    solidBox(vx, vz, 1.9, 1.9);
    // меню-дошка
    const [mx, mz] = W(ga + 1.2, gb - 2.4);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), new THREE.MeshStandardMaterial({ map: menuTex(), roughness: 0.85, side: THREE.DoubleSide }));
    board.applyMatrix4(T(mx, p.plY + 0.75, mz, ry + 0.35, -0.12));
    c.g.add(board);
    life.vendorAt = [ga + 2.4, gb + 1.8];
  }

  // ── ще кілька пальм у кадках біля кафе ──
  for (const b of [11.5, 23]) {
    const [x, z] = W(-6.2, b);
    c.palm(x, z, p.plY, 0.55 + rng() * 0.15);
    batch.add(cylGeo(0.42, 0.34, 0.55, 10), M.plOchre, T(x, p.plY + 0.27, z));
    solidCircle(x, z, 0.45);
  }

  life.build(beachSpots, cafe, rng, c.g);
  return life;
}

// ───────────────────────── яхта-сусід ─────────────────────────

function neighbourYacht(batch: { add: (geo: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4, cast?: boolean) => void }, M: Record<string, THREE.Material>, x: number, z: number, ry: number, len: number, hullMat: THREE.Material, cover: THREE.Material) {
  const base = T(x, 0, z, ry + Math.PI / 2);
  const at = (lx: number, ly: number, lz: number, r = 0, rx = 0, rz = 0) => base.clone().multiply(T(lx, ly, lz, r, rx, rz));
  const bw = len * 0.3;
  // корпус: коробка + загострений ніс
  batch.add(boxGeo(bw, 0.9, len * 0.72), hullMat, at(0, 0.45, -len * 0.08));
  const bow = new THREE.CylinderGeometry(0.01, bw / 2, len * 0.3, 4, 1);
  bow.rotateX(Math.PI / 2);
  bow.rotateZ(Math.PI / 4);
  bow.scale(1, 0.9 / (bw * 0.707), 1);
  batch.add(bow, hullMat, at(0, 0.45, len * 0.43));
  batch.add(boxGeo(bw + 0.04, 0.12, len * 0.72), M.redPaint, at(0, 0.05, -len * 0.08), false);
  // палуба й рубка
  batch.add(boxGeo(bw - 0.1, 0.06, len * 0.86), M.deck, at(0, 0.92, 0), false);
  batch.add(boxGeo(bw * 0.62, 0.42, len * 0.3), M.whitePaint, at(0, 1.15, 0.1));
  batch.add(boxGeo(bw * 0.64, 0.1, 0.3), M.glassDark, at(0, 1.2, 0.26 + len * 0.15), false);
  // щогла, гік і чохол на гроті
  const mastH = len * 1.45;
  batch.add(cylGeo(0.05, 0.06, mastH, 6), M.whitePaint, at(0, 0.92 + mastH / 2, len * 0.12));
  batch.add(cylGeo(0.045, 0.045, len * 0.42, 6), M.whitePaint, at(0, 1.75, -len * 0.09, 0, Math.PI / 2), false);
  batch.add(boxGeo(0.28, 0.32, len * 0.4), cover, at(0, 1.95, -len * 0.09), false);
  // вант до топа (тонка лінія-циліндр)
  for (const s of [-1, 1]) {
    const top = new THREE.Vector3(0, 0.92 + mastH, len * 0.12), foot = new THREE.Vector3(s * bw * 0.48, 0.95, len * 0.06);
    const d = top.clone().sub(foot);
    const g = cylGeo(0.008, 0.008, d.length(), 3);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    const m = new THREE.Matrix4().compose(foot.clone().add(top).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    batch.add(g, M.iron, base.clone().multiply(m), false);
  }
}

// ───────────────────────── текстури ─────────────────────────

function plaqueTex(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 154;
  const x = c.getContext('2d')!;
  x.fillStyle = '#24878c';
  x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#f6efe2';
  x.lineWidth = 7;
  x.strokeRect(10, 10, c.width - 20, c.height - 20);
  x.fillStyle = '#f6efe2';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  let s = 44;
  do {
    x.font = `800 ${s}px Manrope, -apple-system, "Segoe UI", sans-serif`;
    s -= 2;
  } while (x.measureText(text).width > c.width - 50 && s > 18);
  x.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function menuTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 400;
  const x = c.getContext('2d')!;
  x.fillStyle = '#2b2f2c';
  x.fillRect(0, 0, 300, 400);
  x.strokeStyle = '#c9a46a';
  x.lineWidth = 10;
  x.strokeRect(5, 5, 290, 390);
  x.textAlign = 'center';
  x.fillStyle = '#f4e9d3';
  x.font = '800 34px Manrope, -apple-system, sans-serif';
  x.fillText(L('МОРОЗИВО', 'GELATO'), 150, 60);
  x.font = '600 24px Manrope, -apple-system, sans-serif';
  const rows: Array<[string, string]> = [
    [L('🍋 лимон', '🍋 lemon'), '#f2d75a'],
    [L('🥜 фісташка', '🥜 pistachio'), '#a7c98a'],
    [L('🧂 солона карамель', '🧂 sea-salt caramel'), '#e0a865'],
    [L('🍓 полуниця', '🍓 strawberry'), '#ef8f9b'],
  ];
  rows.forEach(([t, col], i) => {
    x.fillStyle = col;
    x.beginPath();
    x.arc(42, 122 + i * 62, 13, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#f4e9d3';
    x.textAlign = 'left';
    x.fillText(t, 66, 131 + i * 62);
  });
  x.textAlign = 'center';
  x.fillStyle = '#c9a46a';
  x.font = '700 22px Manrope, -apple-system, sans-serif';
  x.fillText(L('і панамки!', 'and sun hats!'), 150, 380);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ───────────────────────── запікання пози ─────────────────────────

/** запечені люди: колір у вершинах, одна шорсткість на всіх — один виклик малювання */
const BAKED_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();

/** скінований персонаж у поточній позі → звичайні меші в into (жорстка прив'язка: одна кістка на вершину) */
function bakePose(root: THREE.Object3D, into: THREE.Group, out: Map<THREE.Material, THREE.BufferGeometry[]>) {
  root.updateMatrixWorld(true);
  into.updateMatrixWorld(true);
  const toInto = new THREE.Matrix4().copy(into.matrixWorld).invert();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry;
    const geo = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'color']) if (src.attributes[name]) geo.setAttribute(name, src.attributes[name].clone());
    if (src.index) geo.setIndex(src.index.clone());
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
    const sk = mesh as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) {
      const si = src.attributes.skinIndex as THREE.BufferAttribute;
      const bones = sk.skeleton.bones;
      const mats = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(toInto, sk.matrixWorld).multiply(sk.bindMatrixInverse).multiply(b.matrixWorld).multiply(sk.skeleton.boneInverses[i]).multiply(sk.bindMatrix));
      const nmats = mats.map((m) => new THREE.Matrix3().getNormalMatrix(m));
      for (let i = 0; i < pos.count; i++) {
        const b = si.getX(i);
        _v.fromBufferAttribute(pos, i).applyMatrix4(mats[b]);
        pos.setXYZ(i, _v.x, _v.y, _v.z);
        if (nor) {
          _v.fromBufferAttribute(nor, i).applyMatrix3(nmats[b]).normalize();
          nor.setXYZ(i, _v.x, _v.y, _v.z);
        }
      }
    } else {
      _m.multiplyMatrices(toInto, mesh.matrixWorld);
      geo.applyMatrix4(_m);
      void _nm;
    }
    const geo2 = geo.index ? geo.toNonIndexed() : geo;
    if (!geo2.attributes.uv) geo2.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo2.attributes.position.count * 2), 2));
    // колір — у вершини (у персонажів він уже там, у гітари — з матеріалу), матеріал — один спільний
    const sm = mesh.material as THREE.MeshStandardMaterial;
    if (!geo2.attributes.color || !sm.vertexColors) {
      const n = geo2.attributes.position.count;
      const col = new Float32Array(n * 3);
      const cc = sm.color ?? new THREE.Color(1, 1, 1);
      for (let i = 0; i < n; i++) { col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
      geo2.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    let list = out.get(BAKED_MAT);
    if (!list) out.set(BAKED_MAT, (list = []));
    list.push(geo2);
  });
}

// ───────────────────────── «життя»: люди й гітарист ─────────────────────────

const LOOKS: CharacterLook[] = [
  { jacket: 0xf2efe6, jacketKind: 'knit', pants: 0x3f6f9a, hat: 'straw', hatColor: 0xe3c77a, hatAccent: 0x24878c, hair: 'long', hairColor: HAIRS[3], skin: SKINS[1], glasses: true, brow: 0.2 },
  { jacket: 0xe2674a, pants: 0xe8d9b5, hat: 'bucket', hatColor: 0xf6f2ea, hatAccent: 0x24878c, hair: 'short', hairColor: HAIRS[1], skin: SKINS[3], beard: 'mustache', brow: 0.15 },
  { jacket: 0x24878c, pants: 0xf2efe6, hair: 'bun', hairColor: HAIRS[0], skin: SKINS[4], glasses: true, brow: 0.25, width: 0.95 },
  { jacket: 0xf4d35e, jacketKind: 'knit', pants: 0x2d4d6f, hat: 'cap', hatColor: 0xe2674a, hatAccent: 0xffffff, hair: 'short', hairColor: HAIRS[4], skin: SKINS[0], brow: 0.3, width: 0.95 },
  { jacket: 0xb9dcc4, pants: 0x6b4a32, hat: 'boater', hatColor: 0xe8d39a, hatAccent: 0x1f3b6b, hair: 'buzz', hairColor: HAIRS[5], skin: SKINS[2], beard: 'goatee', belly: true },
  { jacket: 0xe8b7a4, pants: 0xf6f2ea, hair: 'long', hairColor: HAIRS[7], skin: SKINS[1], brow: 0.2 },
];

export class ResortLife {
  readonly group = new THREE.Group();
  /** точки яхт-сусідів (на майбутнє — гойдання/вогні) */
  bobbers: Array<[number, number]> = [];
  vendorAt: [number, number] = [0, 0];
  private people: Person[] = [];
  private guitar: THREE.Group | null = null;
  private musician: Person | null = null;
  /** світова точка музиканта (звук) */
  readonly busker = new THREE.Vector3();
  private night = 0;
  private t = 0;
  /** теплі ореоли над терасою кафе (вночі) */
  private glowMat = new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc677, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });

  constructor(private p: PortSite) {
    this.group.userData.noMerge = true;
  }

  /** into — група гавані: туди запікаються нерухомі люди (зливаються з рештою реквізиту) */
  build(beach: Array<[number, number, number]>, cafe: Array<[number, number]>, rng: () => number, into: THREE.Group) {
    const p = this.p;
    const W = (a: number, b: number) => siteToWorld(p, a, b);
    const ry = Math.atan2(p.ox, p.oz);
    const along = ry + Math.PI / 2;
    const add = (look: CharacterLook, pose: Person['pose'], scale = 1): Person => {
      const rig = buildCharacter(look);
      rig.body.scale.setScalar(scale);
      this.group.add(rig.root);
      const per: Person = { rig, pose, phase: rng() * 10, y: p.plY };
      this.people.push(per);
      return per;
    };
    const sit = (per: Person, lean = 0) => {
      const r = per.rig;
      r.legL.rotation.set(-Math.PI / 2 + 0.2, -0.1, 0);
      r.legR.rotation.set(-Math.PI / 2 + 0.2, 0.1, 0);
      r.kneeL.rotation.x = r.kneeR.rotation.x = Math.PI / 2 - 0.2 - lean;
      r.armL.rotation.x = r.armR.rotation.x = -0.5;
      r.torso.rotation.x = -lean;
    };
    // продавчиня морозива за візком
    {
      const v = add(LOOKS[2], 'stand');
      const [x, z] = W(this.vendorAt[0] + 0.9, this.vendorAt[1]);
      v.rig.root.position.set(x, p.plY, z);
      v.rig.root.rotation.y = ry + Math.PI;
      v.rig.armL.rotation.x = v.rig.armR.rotation.x = -0.35;
    }
    // гітарист на ящику біля кафе
    {
      const m = add({ jacket: 0x3b3a36, pants: 0x2d4d6f, hat: 'boater', hatColor: 0xe8d39a, hatAccent: 0xb8362c, hair: 'long', hairColor: HAIRS[0], skin: SKINS[2], beard: 'full', brow: 0.2, scarf: 0xe2674a }, 'play');
      const [x, z] = W(-6.8, 17);
      // корінь сидячого — на землі −0,33 (стегно саме стає на висоту ~0,45)
      m.y = p.plY - 0.36;
      m.rig.root.position.set(x, m.y, z);
      m.rig.root.rotation.y = ry;
      sit(m);
      const g = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ color: 0xb87a3d, roughness: 0.6 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8).scale(1, 1.25, 0.45), wood);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.03), new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.7 }));
      neck.position.y = 0.42;
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), new THREE.MeshBasicMaterial({ color: 0x1b120c }));
      hole.position.z = 0.092;
      g.add(body, neck, hole);
      g.rotation.set(0.15, 0, -1.15);
      g.position.set(0.05, 0.95, 0.24);
      m.rig.body.add(g);
      this.guitar = g;
      this.musician = m;
      // поза гри (запікається нерухомою — звук дає Busker)
      m.rig.armR.rotation.set(-0.9, 0.35, 0.2);
      m.rig.armL.rotation.set(-1.35, -0.45, -0.35);
      m.rig.head.rotation.x = 0.06;
      m.rig.root.updateMatrixWorld(true);
      this.busker.set(x, p.plY + 1, z);
    }
    // за столиками кафе
    for (const [i, [a, b]] of cafe.entries()) {
      if (i === 1) continue;
      const per = add(LOOKS[(i + 3) % LOOKS.length], 'sit');
      const s = i === 0 ? 1 : -1;
      const [x, z] = W(a, b + s * 0.75);
      per.y = p.plY - 0.35;
      per.rig.root.position.set(x, per.y, z);
      per.rig.root.rotation.y = along + (s > 0 ? Math.PI : 0);
      sit(per);
    }
    // на шезлонгах — засмагають
    for (const [i, [bx, bz, r]] of beach.entries()) {
      if (i > 1) break;
      const per = add(LOOKS[i % LOOKS.length], 'lie');
      const ox = Math.cos(r), oz = -Math.sin(r);
      const lx = bx + ox * 0.55, lz = bz + oz * 0.55;
      per.y = siteGround(p, lx, lz) + 0.36;
      per.rig.root.position.set(lx - Math.sin(r) * 0.55, per.y, lz - Math.cos(r) * 0.55);
      per.rig.root.rotation.set(-1.15, r, 0, 'YXZ');
      per.rig.armL.rotation.set(-0.2, 0, -0.5);
      per.rig.armR.rotation.set(-2.6, 0, 0.3);
      per.rig.legL.rotation.x = 0.05;
      per.rig.legR.rotation.x = -0.02;
    }
    // гуляють набережною з морозивом
    // доріжки: біля краю набережної (повз ліхтарі) і між ліхтарями й кафе (не через візок морозива)
    const lanes: Array<[number, number, number]> = [[-1.0, -p.plW / 2 + 6, p.plW / 2 - 7], [-2.55, -14, p.plW / 2 - 8], [-2.55, -12, p.plW / 2 - 10]];
    // анімований перехожий (скінований персонаж ≈ 10 викликів малювання) дорожчий за бюджет FPS порту — вимкнено
    for (let i = 0; i < 0; i++) {
      const per = add(LOOKS[(i * 2 + 1) % LOOKS.length], 'walk');
      const [a, b0, b1] = lanes[i];
      const [ax, az] = W(a, b0);
      const [bx, bz] = W(a, b1);
      per.path = { ax, az, bx, bz, t: rng(), dir: i % 2 ? 1 : -1, speed: 0.75 + rng() * 0.3 };
      // ріжок: вафля + кулька одним мешем (колір у вершинах)
      const wg = new THREE.ConeGeometry(0.045, 0.15, 8).rotateX(Math.PI).toNonIndexed();
      const sg = new THREE.SphereGeometry(0.055, 8, 6).translate(0, 0.09, 0).toNonIndexed();
      const tint = (g: THREE.BufferGeometry, hex: number) => {
        const cc = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) { a[k * 3] = cc.r; a[k * 3 + 1] = cc.g; a[k * 3 + 2] = cc.b; }
        g.setAttribute('color', new THREE.BufferAttribute(a, 3));
        return g;
      };
      const cone = new THREE.Mesh(mergeGeometries([tint(wg, 0xc8904e), tint(sg, [0xf2d75a, 0xa7c98a, 0xef8f9b][i])], false)!, BAKED_MAT);
      cone.position.set(0, -0.62, 0.08);
      per.rig.armR.add(cone);
    }
    // нерухомі (продавчиня, кафе, пляж) — запікаємо в позі в геометрію гавані: спільні
    // матеріали персонажів зливаються з рештою (mergeStatic) → майже без викликів малювання
    this.group.updateMatrixWorld(true);
    const baked = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const per of [...this.people]) {
      if (per.pose !== 'walk') {
        bakePose(per.rig.root, into, baked);
        per.rig.root.removeFromParent();
        this.people.splice(this.people.indexOf(per), 1);
      }
    }
    // усіх запечених — по одному мешу на матеріал (вони розкидані по різних клітинках mergeStatic)
    for (const [mat, geos] of baked) {
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!geo) continue;
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = m.receiveShadow = true;
      m.userData.noMerge = true;
      into.add(m);
    }
    // тінь кидають лише тіла людей (дрібниці — гітара, ріжки, футляр — без тіні)
    for (const per of this.people) per.rig.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = (o as THREE.SkinnedMesh).isSkinnedMesh === true;
    });
    {
      const [x, z] = W(-3.8, 17.2);
      const sp = new THREE.Sprite(this.glowMat);
      sp.position.set(x, p.plY + 2.35, z);
      sp.scale.set(11, 6.5, 1);
      this.group.add(sp);
    }
  }

  setNight(n: number) {
    this.night = n;
    this.glowMat.opacity = n * 0.7;
  }

  /** dt — лише коли видно; далеко — заморожено й сховано */
  update(dt: number, cam: THREE.Vector3) {
    // люди — лише зблизька: далі ~60 м вони кілька пікселів, а скіновані меші дорогі (CPU + тіні)
    const d = Math.hypot(cam.x - this.p.x, cam.z - this.p.z);
    this.group.visible = d < 90;
    if (!this.group.visible) return;
    this.t += dt;
    const t = this.t;
    for (const per of this.people) {
      const r = per.rig;
      // кожен — лише ближче ~45 м до камери (гістерезис, щоб не блимав на межі)
      const pd = Math.hypot(cam.x - r.root.position.x, cam.z - r.root.position.z);
      const lim = per.pose === 'play' ? 25 : 36;
      const near = pd < (per.shown ? lim + 4 : lim);
      per.shown = near;
      if (!near) {
        r.root.visible = false;
        if (per.pose !== 'walk') continue;
      } else r.root.visible = true;
      if (per.pose === 'walk' && per.path) {
        const P = per.path;
        // уночі гуляє лише один (і лише поблизу)
        r.root.visible = near && (this.night < 0.6 || per.phase > 4);
        const len = Math.hypot(P.bx - P.ax, P.bz - P.az);
        P.t += (P.dir * P.speed * dt) / len;
        if (P.t > 1) { P.t = 1; P.dir = -1; }
        if (P.t < 0) { P.t = 0; P.dir = 1; }
        r.root.position.set(P.ax + (P.bx - P.ax) * P.t, per.y, P.az + (P.bz - P.az) * P.t);
        const want = Math.atan2((P.bx - P.ax) * P.dir, (P.bz - P.az) * P.dir);
        let e = want - r.root.rotation.y;
        while (e > Math.PI) e -= Math.PI * 2;
        while (e < -Math.PI) e += Math.PI * 2;
        r.root.rotation.y += e * Math.min(1, dt * 4);
        const step = t * P.speed * 5.2 + per.phase;
        const sw = Math.sin(step) * 0.5;
        r.legL.rotation.x = sw;
        r.legR.rotation.x = -sw;
        r.kneeL.rotation.x = 0.05 + Math.max(0, sw) * 0.7;
        r.kneeR.rotation.x = 0.05 + Math.max(0, -sw) * 0.7;
        r.armL.rotation.set(-sw * 0.7, 0, -0.1);
        // права рука з морозивом — біля обличчя, зрідка «куштує»
        const lick = Math.max(0, Math.sin(t * 0.7 + per.phase)) ** 6;
        r.armR.rotation.set(-1.25 - lick * 0.45, 0, 0.25);
        r.torso.rotation.set(0.05, sw * 0.15, 0);
        r.root.position.y = per.y + Math.abs(Math.cos(step)) * 0.035;
      } else if (per.pose === 'play') {
        // перебирає струни, киває в такт
        const beat = t * 2.1 + per.phase;
        r.armR.rotation.set(-0.9 + Math.sin(beat * 2) * 0.12, 0.35, 0.2);
        r.armL.rotation.set(-1.35, -0.45, -0.35);
        r.head.rotation.x = Math.sin(beat) * 0.08;
        r.torso.rotation.z = Math.sin(beat * 0.5) * 0.04;
      } else if (per.pose === 'sit') {
        // сьорбає лимонад, крутить головою
        const sip = Math.max(0, Math.sin(t * 0.35 + per.phase)) ** 8;
        r.armR.rotation.x = -0.5 - sip * 1.0;
        r.head.rotation.y = Math.sin(t * 0.25 + per.phase) * 0.5;
      } else if (per.pose === 'stand') {
        r.torso.rotation.y = Math.sin(t * 0.5 + per.phase) * 0.12;
        r.head.rotation.y = Math.sin(t * 0.33 + per.phase) * 0.45;
      }
      // засмаглі вночі йдуть з пляжу
      if (per.pose === 'lie') r.root.visible = near && this.night < 0.5;
    }
  }
}
