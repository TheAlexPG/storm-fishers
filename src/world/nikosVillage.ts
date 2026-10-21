import * as THREE from 'three';
import { L } from '../core/i18n';
import { mulberry32 } from '../core/math';
import { Batch, T, boxGeo, cylGeo } from './portKit';
import { buildCharacter, HAIRS, SKINS, type CharacterLook, type CharacterRig } from './character';
import { siteToWorld, siteGround, type PortSite } from './portSites';
import type { Solid } from './port';
import type { RockObstacle } from './boat';
import { BAKED_MAT, bakePose } from './marinaResort';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─────────────────────────────────────────────────────────────
// Айос-Нікос — грецьке рибальське село: білі будиночки-кубики з
// блакитними дверима й віконницями, церква з блакитним куполом і
// дзвіницею, біленькі сходи вгору схилом, бугенвілії, вітряки на
// пагорбі, тераса «Мезе тітки Деспіни» під виноградом (уночі —
// гірлянда), восьминоги сушаться на мотузці, кольорові каїки біля
// набережної, віслюк Сократ і кіт на сходах. Нерухоме — у Batch
// гавані (злиття), люди — запечені в позі (майже без викликів),
// рухаються лише крила вітряків, голова віслюка й хвіст кота — і
// лише поблизу.
// ─────────────────────────────────────────────────────────────

export const NIKOS_ID = 'port-nikos';
/** «Мезе тітки Деспіни» (послуга 'meze' у portSites): точка біля дверей */
export const MEZE_AT: [number, number] = [-4, 6];

/** один матеріал на все кольорове (колір у вершинах) — один виклик малювання */
const VC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });

function tint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** кольорові частини → один меш (VC) */
function vcMesh(parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4?]>): THREE.Mesh {
  const geos = parts.map(([g, hex, m]) => {
    const t = tint(g.clone(), hex);
    if (m) t.applyMatrix4(m);
    for (const k of Object.keys(t.attributes)) if (!['position', 'normal', 'color'].includes(k)) t.deleteAttribute(k);
    return t;
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos, false)!, VC);
  mesh.castShadow = true;
  return mesh;
}

export interface NikosPlan {
  church: [number, number];
  mills: Array<[number, number]>;
  stairsB: number;
  eleni: [number, number];
  donkey: [number, number];
  /** зайняті місця (a, b, r) — до загальної забудови */
  reserved: Array<[number, number, number]>;
}

/** план села (до загальної забудови): церква на пагорбі, вітряки на гребені, сходи, віслюк */
export function nikosPlan(p: PortSite): NikosPlan {
  const G = (a: number, b: number) => {
    const [x, z] = siteToWorld(p, a, b);
    return siteGround(p, x, z);
  };
  const flat = (a: number, b: number, r: number) => {
    const hs = [G(a - r, b - r), G(a + r, b - r), G(a - r, b + r), G(a + r, b + r), G(a, b)];
    return Math.max(...hs) - Math.min(...hs);
  };
  // церква: на схилі над селом, видно з моря
  let church: [number, number] = [-34, -20];
  let best = Infinity;
  for (let a = -28; a >= -70; a -= 2) {
    for (let b = -40; b <= 40; b += 3) {
      const h = G(a, b);
      if (h < 1.6 || h > 26) continue;
      const f = flat(a, b, 5);
      if (f > 2.4) continue;
      // ближче до села й вище (видно з моря)
      const s = Math.abs(a + 36) + Math.abs(b + 16) * 0.6 + f * 4 - h * 2;
      if (s < best) { best = s; church = [a, b]; }
    }
  }
  // вітряки: на найвищих місцях гребеня позаду села
  const cands: Array<[number, number, number]> = [];
  for (let a = -56; a >= -170; a -= 4) {
    for (let b = -70; b <= 70; b += 5) {
      const h = G(a, b);
      if (h < 3 || flat(a, b, 2.5) > 2.2) continue;
      // гребінь: вище — краще, але не надто далеко від села
      cands.push([a, b, h + a * 0.06]);
    }
  }
  cands.sort((x, y) => y[2] - x[2]);
  const mills: Array<[number, number]> = [];
  for (const [a, b] of cands) {
    if (mills.length >= 3) break;
    if (mills.some(([ma, mb]) => Math.hypot(a - ma, b - mb) < 16 || Math.hypot(a - ma, b - mb) > 70)) continue;
    if (Math.hypot(a - church[0], b - church[1]) < 16) continue;
    mills.push([a, b]);
  }
  const stairsB = -1.5;
  const reserved: Array<[number, number, number]> = [[church[0], church[1], 9], [-12, -1, 3.2], [-20.5, 1.6, 2.4]];
  for (let a = -20; a >= -36; a -= 3) reserved.push([a, stairsB, 2.2]);
  for (const [a, b] of mills) reserved.push([a, b, 5]);
  return { church, mills, stairsB, eleni: [-20.5, 1.6], donkey: [-12, -1], reserved };
}

export interface NikosCtx {
  p: PortSite;
  g: THREE.Group;
  batch: Batch;
  M: Record<string, THREE.Material>;
  ry: number;
  solids: Solid[];
  rocks?: RockObstacle[];
  /** вільне місце на схилі (a, b, r) і бронювання */
  free: (a: number, b: number, r: number) => boolean;
  reserve: (a: number, b: number, r: number) => void;
  lampPost: (x: number, z: number, y0: number) => void;
  glow: (x: number, y: number, z: number, size: number) => void;
}

interface Talker {
  x: number;
  z: number;
  y: number;
  lines: string[];
  i: number;
  cd: number;
}

/** будує село в batch гавані; повертає «життя» (вітряки, віслюк, кіт, репліки) */
export function buildNikos(c: NikosCtx, plan: NikosPlan): NikosLife {
  const { p, M, ry } = c;
  const rng = mulberry32(p.seed * 977 + 31);
  const W = (a: number, b: number) => siteToWorld(p, a, b);
  const G = (x: number, z: number) => siteGround(p, x, z);
  const life = new NikosLife(p);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, cast = true) => c.batch.add(geo, mat, m, cast);
  const vc = (geo: THREE.BufferGeometry, hex: number, m: THREE.Matrix4, cast = true) => c.batch.add(tint(geo.clone(), hex), VC, m, cast);
  const solidCircle = (x: number, z: number, r: number) => c.solids.push({ x, z, r });
  const solidBox = (x: number, z: number, w: number, d: number) => c.solids.push({ x, z, hw: w / 2, hd: d / 2, ry: 0 });
  const white = M.plWhite, blue = M.domeBlue;
  const BOUG = [0xc2187a, 0xd8317f, 0xe0479b];
  const plY = p.plY;

  // бугенвілія: рожево-малиновий кущ на стіні
  const bougainvillea = (m: THREE.Matrix4, s = 1) => {
    for (let k = 0; k < 4; k++) {
      const o = T((rng() - 0.5) * 1.2 * s, (rng() - 0.3) * 0.9 * s, rng() * 0.25, rng() * 6, 0, 0, s * (0.45 + rng() * 0.3));
      vc(new THREE.IcosahedronGeometry(1, 0), k === 3 ? 0x3f7a35 : BOUG[k % 3], m.clone().multiply(o), false);
    }
  };

  // ── білий будиночок-кубик: пласкодах із бортиком, сині двері й віконниці ──
  const cube = (x: number, z: number, w: number, d: number, h: number, r: number, opts: { dome?: boolean; boug?: boolean; roofStair?: boolean } = {}) => {
    const hs = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([u, v]) => G(x + Math.cos(r) * u + Math.sin(r) * v, z - Math.sin(r) * u + Math.cos(r) * v));
    const lo = Math.min(...hs), hi = Math.max(...hs);
    const base = T(x, hi, z, r);
    const at = (lx: number, ly: number, lz: number, rr = 0) => base.clone().multiply(T(lx, ly, lz, rr));
    // цоколь до землі (на схилі)
    add(boxGeo(w + 0.3, hi - lo + 0.7, d + 0.3, 1.5), M.stoneDark, T(x, (lo + hi) / 2 - 0.3, z, r));
    add(boxGeo(w, h, d, 2), white, at(0, h / 2, 0));
    add(boxGeo(w + 0.3, 0.2, d + 0.3), white, at(0, h + 0.1, 0));
    for (const [u, v, ww, dd] of [[0, d / 2 + 0.1, w + 0.3, 0.12], [0, -d / 2 - 0.1, w + 0.3, 0.12], [w / 2 + 0.1, 0, 0.12, d + 0.3], [-w / 2 - 0.1, 0, 0.12, d + 0.3]] as const) add(boxGeo(ww, 0.35, dd), white, at(u, h + 0.35, v));
    // двері й вікна з віконницями
    const door = (rng() - 0.5) * (w - 2.2);
    add(boxGeo(1.05, 2.05, 0.08), blue, at(door, 1.02, d / 2 + 0.02));
    const nW = Math.max(1, Math.floor((w - 1.4) / 2.1));
    for (let i = 0; i < nW; i++) {
      const lx = -w / 2 + (w / (nW + 1)) * (i + 1);
      if (Math.abs(lx - door) < 1.1) continue;
      const wy = h > 4.6 ? h - 1.3 : h * 0.55;
      const m = at(lx, wy, d / 2);
      add(boxGeo(0.8, 1.0, 0.06), M.trim, m);
      add(new THREE.PlaneGeometry(0.66, 0.86), rng() < 0.55 ? M.glassLit : M.glassDark, m.clone().multiply(T(0, 0, 0.04)), false);
      for (const s of [-1, 1]) add(boxGeo(0.36, 1.0, 0.05), blue, m.clone().multiply(T(s * 0.6, 0, 0.05, 0)), false);
    }
    if (opts.dome) {
      add(cylGeo(1.0, 1.0, 0.55, 14), white, at(w / 4, h + 0.45, 0));
      add(new THREE.SphereGeometry(1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), blue, at(w / 4, h + 0.72, 0));
    }
    if (opts.roofStair) {
      // зовнішні сходи на дах уздовж бокової стіни
      for (let k = 0; k < 7; k++) add(boxGeo(0.8, 0.22 + k * (h / 7), 0.45), white, at(w / 2 + 0.45, (0.22 + k * (h / 7)) / 2, -d / 2 + 0.4 + k * 0.48));
    }
    if (opts.boug) bougainvillea(at(-w / 2 + 0.2, h * 0.7, d / 2 + 0.15), 1);
    solidBox(x, z, Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * d + 0.3, Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * d + 0.3);
    return hi;
  };

  // ── будиночки на схилі над селом ──
  let placed = 0;
  for (let t = 0; t < 500 && placed < 13; t++) {
    const a = -24 - rng() * 52, b = (rng() * 2 - 1) * 46;
    const w = 4.2 + rng() * 2.4, d = 3.8 + rng() * 1.8, r0 = Math.max(w, d) / 2 + 0.9;
    if (!c.free(a, b, r0)) continue;
    const [x, z] = W(a, b);
    const hs = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([u, v]) => {
      const [hx, hz] = W(a + v, b + u);
      return G(hx, hz);
    });
    const lo = Math.min(...hs), hi = Math.max(...hs);
    if (lo < 1.4 || hi - lo > 2.6 || hi > 34) continue;
    c.reserve(a, b, r0);
    const two = rng() < 0.3;
    cube(x, z, w, d, two ? 5.4 : 3.1 + rng() * 0.8, ry + (rng() - 0.5) * 0.12, { dome: placed % 5 === 2, boug: rng() < 0.55, roofStair: !two && rng() < 0.35 });
    placed++;
  }

  // ── біленькі сходи вгору схилом від площі ──
  {
    // суцільні сходинки від підніжжя (не «драбина» над схилом): кожна — блок до землі
    let prev = plY;
    for (let a = -p.plD + 0.3; a >= -p.plD - 16; a -= 0.5) {
      const [x, z] = W(a, plan.stairsB);
      const gnd = G(x, z);
      const y = Math.max(prev, Math.min(gnd + 0.12, prev + 0.32));
      if (gnd - y > 0.5) break;
      const lo = Math.min(gnd, prev) - 0.4;
      add(boxGeo(1.7, y - lo, 0.52), white, T(x, (y + lo) / 2, z, ry));
      for (const s of [-1, 1]) {
        const [wx, wz] = W(a, plan.stairsB + s * 1.0);
        add(boxGeo(0.24, y - lo + 0.42, 0.54), white, T(wx, (y + lo) / 2 + 0.21, wz, ry));
      }
      prev = y;
    }
  }

  // ── церква з блакитним куполом і дзвіницею ──
  {
    const [ca, cb] = plan.church;
    const [x, z] = W(ca, cb);
    const hi = Math.max(G(x, z), ...[[-4, -3], [4, -3], [-4, 3], [4, 3]].map(([u, v]) => { const [qx, qz] = W(ca + v, cb + u); return G(qx, qz); }));
    const base = T(x, hi, z, ry);
    const at = (lx: number, ly: number, lz: number) => base.clone().multiply(T(lx, ly, lz));
    add(boxGeo(8.6, 1.4, 6.6, 2), M.stoneDark, at(0, -0.55, 0));
    add(boxGeo(8, 4.6, 6, 2), white, at(0, 2.3, 0));
    add(boxGeo(8.3, 0.25, 6.3), white, at(0, 4.7, 0));
    add(cylGeo(2.2, 2.2, 1.8, 18), white, at(0, 5.6, 0));
    add(new THREE.SphereGeometry(2.35, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), blue, at(0, 6.45, 0));
    add(cylGeo(0.05, 0.05, 1.3, 6), M.iron, at(0, 9.3, 0));
    add(boxGeo(0.7, 0.07, 0.07), M.iron, at(0, 9.55, 0));
    // двері й аркове вікно на фасаді (до моря)
    add(boxGeo(1.4, 2.4, 0.1), blue, at(0, 1.2, 3.02));
    add(new THREE.CircleGeometry(0.55, 16), M.glassLit, at(0, 3.5, 3.03), false);
    // дзвіниця збоку
    const bx = 4.9;
    add(boxGeo(2.2, 8.2, 2.2, 1.5), white, at(bx, 4.1, 1.6));
    add(boxGeo(1.3, 1.5, 2.3), M.glassDark, at(bx, 6.6, 1.6), false);
    vc(new THREE.CylinderGeometry(0.28, 0.42, 0.6, 10), 0xb98a3c, at(bx, 6.55, 1.6));
    add(cylGeo(1.0, 1.0, 0.4, 12), white, at(bx, 8.4, 1.6));
    add(new THREE.SphereGeometry(1.05, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), blue, at(bx, 8.6, 1.6));
    add(cylGeo(0.04, 0.04, 0.9, 6), M.iron, at(bx, 10.0, 1.6));
    bougainvillea(at(-3.6, 1.6, 3.1), 1.1);
    solidBox(x, z, 9, 9);
    // кипариси обабіч
    for (const s of [-1, 1]) {
      const [tx, tz] = W(ca + 4.6, cb + s * 5.6);
      const ty = G(tx, tz);
      add(cylGeo(0.12, 0.16, 1.2, 5), M.trunk, T(tx, ty + 0.5, tz));
      add(new THREE.ConeGeometry(0.75, 6.2, 7), M.cypress, T(tx, ty + 3.9, tz));
      solidCircle(tx, tz, 0.45);
    }
  }

  // ── вітряки на гребені (крила — окремо, крутяться поблизу) ──
  for (const [ma, mb] of plan.mills) {
    const [x, z] = W(ma, mb);
    const y = G(x, z) - 0.4;
    add(cylGeo(1.75, 1.95, 6.4, 16, 2), white, T(x, y + 3.2, z));
    add(boxGeo(0.9, 1.7, 0.1), blue, T(x, y + 0.85, z, ry).multiply(T(0, 0, 1.92)));
    vc(new THREE.ConeGeometry(2.0, 1.9, 16), 0xa7834e, T(x, y + 7.35, z));
    solidCircle(x, z, 2.1);
    // крила: маточина, 8 жердин, трикутні вітрила (колір у вершинах)
    const parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4?]> = [[new THREE.CylinderGeometry(0.22, 0.22, 0.6, 8).rotateX(Math.PI / 2), 0x5a3a24]];
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const rot = new THREE.Matrix4().makeRotationZ(ang);
      parts.push([new THREE.BoxGeometry(0.09, 4.2, 0.09).translate(0, 2.1, 0), 0x5a3a24, rot]);
      const sail = new THREE.BufferGeometry();
      sail.setAttribute('position', new THREE.Float32BufferAttribute([0.05, 0.6, 0.02, 0.05, 4.1, 0.02, 1.15, 3.6, 0.02, 0.05, 0.6, -0.02, 1.15, 3.6, -0.02, 0.05, 4.1, -0.02], 3));
      sail.computeVertexNormals();
      parts.push([sail, 0xf1ebdc, rot]);
    }
    const sails = vcMesh(parts);
    const hub = new THREE.Group();
    hub.position.set(x + p.ox * 2.15, y + 5.8, z + p.oz * 2.15);
    hub.rotation.y = ry;
    hub.add(sails);
    life.addMill(sails, hub);
  }

  // ── тераса «Мезе тітки Деспіни»: сині столики під виноградом, гірлянда ──
  {
    const [a0, a1, b0, b1] = [-2.4, -5.1, 2.6, 9.4];
    for (const [a, b] of [[a0, b0], [a0, b1], [a1, b0], [a1, b1]]) {
      const [x, z] = W(a, b);
      add(boxGeo(0.14, 2.75, 0.14), M.woodDark, T(x, plY + 1.37, z));
      solidCircle(x, z, 0.2);
    }
    for (const a of [a0, a1]) {
      const [x, z] = W(a, (b0 + b1) / 2);
      add(boxGeo(0.12, 0.12, b1 - b0 + 0.2), M.woodDark, T(x, plY + 2.78, z, ry + Math.PI / 2));
    }
    const [vx, vz] = W((a0 + a1) / 2, (b0 + b1) / 2);
    add(boxGeo(b1 - b0 + 0.4, 0.22, a0 - a1 + 0.5), M.vine, T(vx, plY + 2.92, vz, ry), false);
    for (let k = 0; k < 14; k++) {
      const [gx, gz] = W(a1 + rng() * (a0 - a1), b0 + rng() * (b1 - b0));
      vc(new THREE.IcosahedronGeometry(0.11 + rng() * 0.06, 0), k % 2 ? 0x5f8a3a : 0x6a3b6e, T(gx, plY + 2.68, gz, rng() * 6, 0, 0, 1, 1.5, 1), false);
    }
    {
      const [bx, bz] = W(a0, b0 - 0.25);
      bougainvillea(T(bx, plY + 1.9, bz, ry), 0.9);
    }
    // столики й стільці
    const chair = (x: number, z: number, r: number) => {
      const m = T(x, plY, z, r);
      vc(new THREE.BoxGeometry(0.42, 0.06, 0.42), 0x2f6fb5, m.clone().multiply(T(0, 0.45, 0)));
      vc(new THREE.BoxGeometry(0.42, 0.5, 0.05), 0x2f6fb5, m.clone().multiply(T(0, 0.72, -0.2)));
      for (const [u, v] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) vc(new THREE.BoxGeometry(0.04, 0.45, 0.04), 0x2f6fb5, m.clone().multiply(T(u, 0.22, v)), false);
    };
    const tables: Array<[number, number]> = [[-3.4, 4.0], [-3.4, 7.9]];
    for (const [a, b] of tables) {
      const [x, z] = W(a, b);
      vc(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 16), 0x2f6fb5, T(x, plY + 0.76, z));
      vc(new THREE.CylinderGeometry(0.52, 0.52, 0.02, 16), 0xf2efe6, T(x, plY + 0.795, z), false);
      add(cylGeo(0.04, 0.05, 0.74, 6), M.iron, T(x, plY + 0.37, z));
      for (const s of [-1, 1]) {
        const [cx, cz] = W(a, b + s * 0.85);
        chair(cx, cz, ry + Math.PI / 2 + (s > 0 ? Math.PI : 0));
      }
      // на столі: глечик і тарілка з оливками
      vc(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 8), 0xd97a3a, T(x + 0.12, plY + 0.92, z), false);
      vc(new THREE.CylinderGeometry(0.15, 0.12, 0.03, 10), 0xf2efe6, T(x - 0.15, plY + 0.82, z + 0.1), false);
      solidCircle(x, z, 0.75);
    }
    // гірлянда вздовж краю тераси: лампочки + ореоли (уночі)
    for (let k = 0; k <= 8; k++) {
      const b = b0 + ((b1 - b0) * k) / 8;
      const sag = Math.sin((k / 8) * Math.PI) * 0.3;
      const [x, z] = W(a0 - 0.02, b);
      add(new THREE.SphereGeometry(0.07, 6, 4), M.lamp, T(x, plY + 2.6 - sag, z), false);
    }
    for (const k of [0.2, 0.5, 0.8]) {
      const [x, z] = W(a0, b0 + (b1 - b0) * k);
      c.glow(x, plY + 2.45, z, 2.2);
    }
  }

  // ── восьминоги сушаться на мотузці ──
  {
    const [ta, tb0, tb1] = [-2.7, -14.2, -17.4];
    for (const b of [tb0, tb1]) {
      const [x, z] = W(ta, b);
      add(boxGeo(0.1, 2.0, 0.1), M.woodDark, T(x, plY + 1.0, z));
      solidCircle(x, z, 0.15);
    }
    const [mx, mz] = W(ta, (tb0 + tb1) / 2);
    add(cylGeo(0.015, 0.015, Math.abs(tb1 - tb0), 4), M.rope, T(mx, plY + 1.92, mz, ry + Math.PI / 2, Math.PI / 2), false);
    for (let k = 0; k < 5; k++) {
      const [x, z] = W(ta, tb0 - 0.5 - k * 0.6);
      const m = T(x, plY + 1.72, z, rng() * 6, 0, 0, 0.7);
      vc(new THREE.SphereGeometry(0.13, 8, 6).scale(1, 1.25, 1), 0xb4566c, m.clone().multiply(T(0, 0.12, 0)), false);
      for (let q = 0; q < 6; q++) {
        const ang = (q / 6) * Math.PI * 2;
        vc(new THREE.ConeGeometry(0.035, 0.42, 4).rotateX(Math.PI), 0xc8707f, m.clone().multiply(T(Math.cos(ang) * 0.08, -0.15, Math.sin(ang) * 0.08, 0, Math.sin(ang) * 0.2, Math.cos(ang) * 0.2)), false);
      }
    }
    // сітка в купі та ящик-сидіння рибалки
    const [nx, nz] = W(-3.0, -11.6);
    vc(new THREE.SphereGeometry(0.55, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), 0xc9a466, T(nx, plY, nz), false);
    const [bx, bz] = W(-3.3, -12.6);
    add(boxGeo(0.6, 0.42, 0.45), M.woodDark, T(bx, plY + 0.21, bz, ry));
    solidCircle(bx, bz, 0.4);
  }

  // ── каїки: кольорові човники біля набережної ──
  {
    const HULL = [[0xf2efe6, 0x2f6fb5, 0xd9b03a], [0x2f6fb5, 0xf2efe6, 0xc23a2c], [0xe8c34a, 0x2f8f6c, 0xf2efe6], [0xf2efe6, 0xc23a2c, 0x2f6fb5]];
    const shape = new THREE.Shape();
    shape.moveTo(0, -2.6);
    shape.quadraticCurveTo(1.0, -1.2, 0.95, 0.6);
    shape.quadraticCurveTo(0.85, 2.0, 0, 2.7);
    shape.quadraticCurveTo(-0.85, 2.0, -0.95, 0.6);
    shape.quadraticCurveTo(-1.0, -1.2, 0, -2.6);
    const lower = new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: false, curveSegments: 6 }).rotateX(Math.PI / 2);
    const upper = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false, curveSegments: 6 }).rotateX(Math.PI / 2).scale(1.03, 1, 1.03);
    const spots: Array<[number, number]> = [[2.3, -9.5], [2.3, -16.5], [2.3, 13.5], [2.3, 19.5]];
    for (const [i, [a, b]] of spots.entries()) {
      const [x, z] = W(a, b);
      const r = ry + Math.PI / 2 + (rng() - 0.5) * 0.1;
      const m = T(x, 0, z, r);
      const [c1, c2, c3] = HULL[i % HULL.length];
      vc(lower, c1, m.clone().multiply(T(0, 0.12, 0)));
      vc(upper, c2, m.clone().multiply(T(0, 0.26, 0)));
      vc(new THREE.BoxGeometry(1.5, 0.05, 3.4), 0x8a6a48, m.clone().multiply(T(0, 0.2, 0)), false);
      vc(new THREE.BoxGeometry(0.08, 0.5, 0.08), c3, m.clone().multiply(T(0, 0.45, 2.4)), false);
      if (i % 2 === 0) {
        // будочка й щогла
        vc(new THREE.BoxGeometry(0.9, 0.7, 0.9), 0xf2efe6, m.clone().multiply(T(0, 0.6, -0.9)));
        vc(new THREE.BoxGeometry(1.0, 0.07, 1.0), c3, m.clone().multiply(T(0, 0.97, -0.9)), false);
        vc(new THREE.CylinderGeometry(0.04, 0.05, 2.6, 5), 0x8a6a48, m.clone().multiply(T(0, 1.4, 0.6)), false);
      }
      c.rocks?.push({ x, z, r: 1.3, kind: 'pier' });
      for (const s of [-1, 1]) {
        const [ex, ez] = W(a, b + s * 1.6);
        c.rocks?.push({ x: ex, z: ez, r: 1.0, kind: 'pier' });
      }
    }
  }

  // ── кіт на сходах і віслюк Сократ (голова й хвіст — окремо, рухаються поблизу) ──
  {
    const [cx, cz] = W(-p.plD - 0.6, plan.stairsB + 0.35);
    const cy = Math.max(plY, G(cx, cz)) + 0.03;
    const cat = new THREE.Group();
    cat.position.set(cx, cy, cz);
    cat.rotation.y = ry + 0.6;
    cat.add(vcMesh([
      [new THREE.BoxGeometry(0.2, 0.18, 0.36), 0xf2efe6, T(0, 0.12, 0)],
      [new THREE.BoxGeometry(0.16, 0.15, 0.15), 0x2b2b2b, T(0, 0.27, 0.17)],
      [new THREE.ConeGeometry(0.035, 0.07, 4), 0x2b2b2b, T(-0.05, 0.38, 0.17)],
      [new THREE.ConeGeometry(0.035, 0.07, 4), 0x2b2b2b, T(0.05, 0.38, 0.17)],
      [new THREE.BoxGeometry(0.2, 0.09, 0.2), 0x2b2b2b, T(0, 0.05, -0.08)],
    ]));
    const tail = new THREE.Group();
    tail.position.set(0, 0.16, -0.18);
    tail.add(vcMesh([[new THREE.CylinderGeometry(0.02, 0.025, 0.3, 5).translate(0, 0.15, 0), 0x2b2b2b, T(0, 0, 0, 0, -0.7)]]));
    cat.add(tail);
    life.setCat(cat, tail);
    life.talk(cx, cy, cz, [L('🐈 Мррр… кіт треться об твої чоботи.', `🐈 Mrrr… the cat rubs against your boots.`), L('🐈 Кіт мружиться на сонці й не збирається поступатись сходинкою.', `🐈 The cat squints at the sun and won't give up its step.`)]);

    const [dx, dz] = W(plan.donkey[0], plan.donkey[1]);
    const dy = plY;
    const donkey = new THREE.Group();
    donkey.position.set(dx, dy, dz);
    donkey.rotation.y = ry + Math.PI / 2;
    const grey = 0x8b8178, dark = 0x4a423c, belly = 0xd8d0c4;
    const body: Array<[THREE.BufferGeometry, number, THREE.Matrix4?]> = [
      [new THREE.BoxGeometry(0.55, 0.55, 1.15), grey, T(0, 0.95, 0)],
      [new THREE.BoxGeometry(0.5, 0.12, 1.0), belly, T(0, 0.7, 0)],
      [new THREE.CylinderGeometry(0.03, 0.05, 0.5, 5), dark, T(0, 0.95, -0.72, 0, -0.5)],
    ];
    for (const [u, v] of [[-0.18, -0.42], [0.18, -0.42], [-0.18, 0.42], [0.18, 0.42]]) body.push([new THREE.BoxGeometry(0.12, 0.7, 0.12), grey, T(u, 0.35, v)], [new THREE.BoxGeometry(0.13, 0.08, 0.14), dark, T(u, 0.04, v)]);
    // в'ючні кошики обабіч
    for (const s of [-1, 1]) body.push([new THREE.CylinderGeometry(0.2, 0.17, 0.4, 8), 0xb08a52, T(s * 0.42, 0.95, 0.05)]);
    body.push([new THREE.BoxGeometry(0.62, 0.06, 0.5), 0xc23a2c, T(0, 1.24, 0.05)]);
    donkey.add(vcMesh(body));
    const head = new THREE.Group();
    head.position.set(0, 1.15, 0.55);
    head.add(vcMesh([
      [new THREE.BoxGeometry(0.22, 0.45, 0.22), grey, T(0, 0.18, 0.06, 0, 0.5)],
      [new THREE.BoxGeometry(0.24, 0.24, 0.48), grey, T(0, 0.38, 0.32)],
      [new THREE.BoxGeometry(0.2, 0.18, 0.12), belly, T(0, 0.33, 0.58)],
      [new THREE.ConeGeometry(0.05, 0.32, 4), dark, T(-0.08, 0.62, 0.18, 0, -0.2, -0.15)],
      [new THREE.ConeGeometry(0.05, 0.32, 4), dark, T(0.08, 0.62, 0.18, 0, -0.2, 0.15)],
    ]));
    donkey.add(head);
    life.setDonkey(donkey, head);
    solidCircle(dx, dz, 0.9);
    life.talk(dx, dy, dz, [L('🫏 «І-а!» — віслюк Сократ дивиться на тебе мудро й жує.', `🫏 “Hee-haw!” — Socrates the donkey gives you a wise look and keeps chewing.`), L('🫏 Сократ возить оливки вгору на пагорб. Ти — ні. Він це пам\'ятає.', `🫏 Socrates carries olives up the hill. You don't. He remembers.`)]);
  }

  // ── мешканці (запечені в позі: майже без викликів малювання) ──
  {
    const into = c.g;
    const baked = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const tmp = new THREE.Group();
    into.add(tmp);
    const person = (look: CharacterLook, x: number, y: number, z: number, r: number, pose: (rig: CharacterRig) => void) => {
      const rig = buildCharacter(look, { coarse: true });
      rig.root.position.set(x, y, z);
      rig.root.rotation.y = r;
      pose(rig);
      tmp.add(rig.root);
      rig.root.updateMatrixWorld(true);
      bakePose(rig.root, into, baked);
      rig.root.removeFromParent();
    };
    const sit = (r: CharacterRig, lean = 0) => {
      r.legL.rotation.set(-Math.PI / 2 + 0.2, -0.1, 0);
      r.legR.rotation.set(-Math.PI / 2 + 0.2, 0.1, 0);
      r.kneeL.rotation.x = r.kneeR.rotation.x = Math.PI / 2 - 0.2 - lean;
      r.torso.rotation.x = -lean;
    };
    // Яніс латає сітку на ящику біля восьминогів
    {
      const [x, z] = W(-3.3, -12.6);
      person({ jacket: 0x2d4d6f, jacketKind: 'knit', pants: 0x3b3a36, hat: 'captain', hatColor: 0x1f2a3a, hatAccent: 0xf2efe6, hair: 'short', hairColor: HAIRS[6], skin: SKINS[3], beard: 'full', brow: 0.2, belly: true }, x, plY + 0.06, z, ry, (r) => {
        sit(r, 0.15);
        r.armL.rotation.set(-1.1, 0.3, 0);
        r.armR.rotation.set(-1.0, -0.3, 0);
        r.head.rotation.x = 0.35;
      });
      vc(new THREE.PlaneGeometry(0.9, 0.6), 0xc9a466, T(x + p.ox * 0.5, plY + 0.62, z + p.oz * 0.5, ry, -1.1), false);
      life.talk(x, plY, z, [L('🧔 «Каліспера! Сітку латаю з п\'ятої ранку — восьминоги й ті вже висохли».', `🧔 “Kalispera! I've been mending this net since five — even the octopus are dry already.”`), L('🧔 «Кальмари вночі йдуть на світло. Візьми ліхтар — і буде вечеря».', `🧔 “Squid come to the light at night. Bring a lamp and you've got dinner.”`), L('🧔 «Мельтемі дме з півночі все літо. Зранку тихо — тоді й виходь».', `🧔 “The meltemi blows from the north all summer. Mornings are calm — that's when you go out.”`)]);
    }
    // тітка Деспіна біля тераси
    {
      const [x, z] = W(-4.7, 9.0);
      person({ jacket: 0x2a2826, pants: 0x2a2826, apron: 0xf2efe6, hair: 'bun', hairColor: HAIRS[5], skin: SKINS[2], brow: 0.3, width: 1.05, belly: true }, x, plY, z, ry - 0.4, (r) => {
        r.armL.rotation.set(-0.3, 0, 0.2);
        r.armR.rotation.set(-1.3, 0, -0.2);
      });
      life.talk(x, plY, z, [L('👵 «Сідай, сідай! Мезе — як у мами, тільки ще краще. Сили на цілу вахту».', `👵 “Sit, sit! My meze is just like mama's — only better. Strength for a whole watch.”`), L('👵 «Восьминога спершу б\'ють об камінь сорок разів. Тоді він ніжний, як хмаринка».', `👵 “You beat the octopus on a rock forty times first. Then it's tender as a cloud.”`)]);
    }
    // гість за столиком з узо й оливками
    {
      const [x, z] = W(-3.4, 4.0 + 0.85);
      person({ jacket: 0xf2efe6, jacketKind: 'knit', pants: 0xe8d9b5, hat: 'boater', hatColor: 0xe8d39a, hatAccent: 0x2f6fb5, hair: 'short', hairColor: HAIRS[1], skin: SKINS[1], beard: 'mustache', brow: 0.15 }, x, plY - 0.36, z, ry + Math.PI / 2 + Math.PI, (r) => {
        sit(r);
        r.armR.rotation.set(-1.1, 0, 0);
        r.armL.rotation.set(-0.6, 0, 0);
      });
      life.talk(x, plY, z, [L('🙂 «Тарілка оливок, шматок фети й захід сонця. Більше нічого не треба».', `🙂 “A plate of olives, a slice of feta and the sunset. Nothing else needed.”`)]);
    }
    // бабуся Елені в чорному на стільці біля сходів
    {
      const [x, z] = W(plan.eleni[0], plan.eleni[1]);
      const y = Math.max(plY, G(x, z));
      const [chx, chz] = [x - p.ox * 0.1, z - p.oz * 0.1];
      vc(new THREE.BoxGeometry(0.44, 0.06, 0.44), 0x8a6a48, T(chx, y + 0.45, chz, ry));
      vc(new THREE.BoxGeometry(0.44, 0.55, 0.05), 0x8a6a48, T(chx - p.ox * 0.2, y + 0.75, chz - p.oz * 0.2, ry));
      for (const [u, v] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
        const [lx, lz] = [chx + Math.cos(ry) * u + Math.sin(ry) * v, chz - Math.sin(ry) * u + Math.cos(ry) * v];
        vc(new THREE.BoxGeometry(0.04, 0.45, 0.04), 0x5a3a24, T(lx, y + 0.22, lz), false);
      }
      person({ jacket: 0x1d1c1b, jacketKind: 'coat', pants: 0x1d1c1b, scarf: 0x1d1c1b, hair: 'bun', hairColor: HAIRS[6], skin: SKINS[2], brow: 0.25, width: 0.95 }, x, y - 0.36, z, ry, (r) => {
        sit(r);
        r.armL.rotation.set(-0.7, 0.4, 0);
        r.armR.rotation.set(-0.7, -0.4, 0);
        r.head.rotation.x = 0.1;
      });
      solidCircle(x, z, 0.5);
      life.talk(x, y, z, [L('👵 «Ти з далекої країни, синку? Тут море добре, але гордих не любить».', `👵 “From a faraway land, my boy? The sea is kind here, but it doesn't like the proud.”`), L('👵 «Як дзвін задзвонить у бурю — значить, рибалки ще в морі. Молимось за них».', `👵 “When the bell rings in a storm, the fishermen are still at sea. We pray for them.”`), L('👵 «Візьми в Деспіни лукумадес. Мед — для серця, а серце — для моря».', `👵 “Get some loukoumades from Despina. Honey's for the heart, and the heart's for the sea.”`)]);
    }
    tmp.removeFromParent();
    for (const [mat, geos] of baked) {
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!geo) continue;
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = m.receiveShadow = true;
      m.userData.noMerge = true;
      into.add(m);
    }
  }

  // ліхтар біля сходів на площі
  {
    const [lx, lz] = W(-p.plD + 1.6, plan.stairsB + 2.2);
    c.lampPost(lx, lz, plY);
    solidCircle(lx, lz, 0.25);
  }
  c.g.add(life.group);
  return life;
}

// ───────────────────────── «життя» села ─────────────────────────

export class NikosLife {
  readonly group = new THREE.Group();
  /** репліка мешканця (тост) — ставить Ports */
  onSay: ((text: string) => void) | null = null;
  private mills: Array<{ sails: THREE.Mesh; hub: THREE.Group; phase: number }> = [];
  private cat: { root: THREE.Group; tail: THREE.Group } | null = null;
  private donkey: { root: THREE.Group; head: THREE.Group } | null = null;
  private talkers: Talker[] = [];
  private sayCd = 0;
  private t = 0;

  constructor(private p: PortSite) {
    this.group.userData.noMerge = true;
  }

  addMill(sails: THREE.Mesh, hub: THREE.Group) {
    this.group.add(hub);
    this.mills.push({ sails, hub, phase: this.mills.length * 1.3 });
  }

  setCat(root: THREE.Group, tail: THREE.Group) {
    this.group.add(root);
    this.cat = { root, tail };
  }

  setDonkey(root: THREE.Group, head: THREE.Group) {
    this.group.add(root);
    this.donkey = { root, head };
  }

  talk(x: number, y: number, z: number, lines: string[]) {
    this.talkers.push({ x, z, y, lines, i: Math.floor(Math.random() * lines.length), cd: 0 });
  }

  /** dt — секунди; рухається лише поблизу, репліки — коли камера впритул */
  update(dt: number, cam: THREE.Vector3, night: number, who: THREE.Vector3 = cam) {
    const d = Math.hypot(cam.x - this.p.x, cam.z - this.p.z);
    this.group.visible = d < 700;
    if (!this.group.visible) return;
    this.t += dt;
    const t = this.t;
    // крила вітряків — повільно (вночі ще повільніше)
    for (const m of this.mills) m.sails.rotation.z = -(t * (0.35 - night * 0.15) + m.phase);
    if (d < 120) {
      if (this.cat) this.cat.tail.rotation.z = Math.sin(t * 2.2) * 0.5;
      if (this.donkey) {
        const nod = Math.max(0, Math.sin(t * 0.4)) ** 4;
        this.donkey.head.rotation.x = 0.15 + nod * 0.6;
        this.donkey.head.rotation.y = Math.sin(t * 0.23) * 0.25;
      }
    }
    this.sayCd -= dt;
    for (const s of this.talkers) {
      s.cd -= dt;
      if (this.sayCd > 0 || s.cd > 0) continue;
      if (Math.hypot(who.x - s.x, who.z - s.z) < 2.6 && Math.abs(who.y - s.y) < 3) {
        s.i = (s.i + 1) % s.lines.length;
        this.onSay?.(s.lines[s.i]);
        s.cd = 14;
        this.sayCd = 4;
      }
    }
  }
}
