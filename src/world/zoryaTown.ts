import * as THREE from 'three';
import { L } from '../core/i18n';
import { Batch, T, boxGeo, cylGeo } from './portKit';
import { siteToWorld, type PortSite } from './portSites';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCharacter, HAIRS, SKINS, type CharacterLook, type CharacterRig } from './character';

const mergeGeos = (g: THREE.BufferGeometry[]) => mergeGeometries(g, false)!;

/**
 * мешканець: ~12 скінованих мешів (по одному на шорсткість) → 2 (тканина й метал),
 * той самий скелет і та сама анімація; шорсткість — від найбільшої частини
 */
function compactRig(rig: CharacterRig) {
  const all: THREE.SkinnedMesh[] = [];
  rig.root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) all.push(o as THREE.SkinnedMesh);
  });
  for (const metal of [false, true]) {
    const list = all.filter((m) => ((m.material as THREE.MeshStandardMaterial).metalness > 0.3) === metal);
    if (list.length < 2) continue;
    const skel = list[0].skeleton;
    if (list.some((m) => m.skeleton !== skel || m.parent !== list[0].parent)) continue;
    const merged = mergeGeometries(list.map((m) => m.geometry), false);
    if (!merged) continue;
    const base = [...list].sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count)[0];
    const nm = new THREE.SkinnedMesh(merged, base.material);
    nm.castShadow = true;
    list[0].parent!.add(nm);
    nm.bind(skel, base.bindMatrix);
    merged.computeBoundingSphere();
    const bs = merged.boundingSphere!.clone();
    bs.radius *= 1.6;
    nm.boundingSphere = bs;
    for (const m of list) {
      m.removeFromParent();
      m.geometry.dispose();
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Гавань Зорі — містечко на скелястому мисі (характер поверх загальної
// забудови ports.ts): сходи серпантином угору мисом до каплиці з дзвіницею
// (дзвін уранці й увечері), ринкова площа з фонтаном і ятками, кав'ярня
// «Світанок» з тентом і гірляндою, сигнальна щогла з прапорцями, мешканці
// й рудий кіт. Статика — у Batch гавані (злиття), живе — окрема група,
// що анімується лише поблизу.
// ─────────────────────────────────────────────────────────────

export const ZORYA_ID = 'port-zorya';

type Mat = THREE.Material;

/** контекст збірки, який дає ports.ts (його приватні помічники — замиканнями) */
export interface TownCtx {
  p: PortSite;
  g: THREE.Group;
  batch: Batch;
  M: Record<string, Mat>;
  ry: number;
  rng: () => number;
  H: (x: number, z: number) => number;
  house: (o: { x: number; z: number; y0: number; ry: number; w: number; d: number; h: number; rh: number; wall: Mat; roof: Mat; door?: number; sign?: string }) => void;
  lampPost: (x: number, z: number, y0: number) => void;
  glow: (x: number, y: number, z: number, size: number) => void;
  solidBox: (x: number, z: number, w: number, d: number) => void;
  solidCircle: (x: number, z: number, r: number) => void;
}

interface Pt { a: number; b: number }

export interface ZoryaPlan {
  /** каплиця: центр (a, b), низ і верх рельєфу під нею */
  chapel: { a: number; b: number; lo: number; hi: number };
  /** сходинки серпантину (a, b, висота рельєфу) */
  steps: Array<{ a: number; b: number; h: number; da: number; db: number }>;
  /** будиночки-тераси вздовж сходів */
  terraces: Array<{ a: number; b: number; lo: number; hi: number }>;
  /** зайняті місця для загальної забудови ports.ts: (a, b, r) */
  reserved: Array<[number, number, number]>;
  /** світова точка дзвона (заповнює buildZoryaStatic) */
  bell?: THREE.Vector3;
}

// розкладка на плато (локальні a — у море, b — уздовж набережної)
const CAFE = { a: -11, b: 9.5, w: 5, d: 3.6 };
const SQUARE = { a: -22, b: -1 };
const STALLS: Pt[] = [{ a: -26.5, b: -5 }, { a: -26.5, b: 3.2 }, { a: -16.4, b: 3 }];
const MAST = { a: -4, b: -25.5 };
const CH_W = 5.2, CH_D = 7;

/** план (чиста математика: лише рельєф) — до загальної забудови, щоб та не стала на сходи */
export function zoryaPlan(p: PortSite, H: (x: number, z: number) => number): ZoryaPlan {
  const at = (a: number, b: number) => {
    const [x, z] = siteToWorld(p, a, b);
    return H(x, z);
  };
  const span = (a: number, b: number, d: number, w: number) => {
    let lo = 1e9, hi = -1e9;
    for (const da of [-d / 2, 0, d / 2]) for (const db of [-w / 2, 0, w / 2]) {
      const h = at(a + da, b + db);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return [lo, hi];
  };
  // каплиця — на рівній вершині мису за містечком (видно з моря над дахами)
  const [l0, h0] = span(-51, 0, CH_D, CH_W);
  let chapel = { a: -51, b: 0, lo: l0, hi: h0 };
  let best = -1e9;
  for (let a = -58; a <= -48; a += 1) {
    for (let b = -10; b <= 10; b += 2) {
      const [lo, hi] = span(a, b, CH_D, CH_W);
      if (lo < 10 || hi - lo > 4.5) continue;
      // вище, рівніше, ближче до осі й до краю мису (до моря)
      const score = hi - (hi - lo) * 1.8 - Math.abs(b) * 0.25 + a * 0.15;
      if (score > best) {
        best = score;
        chapel = { a, b, lo, hi };
      }
    }
  }
  // серпантин: від тилу плато чотирма маршами навскіс по схилу, далі гребенем до дверей (двері — до моря, +a)
  const way: Pt[] = [{ a: -30.4, b: 6 }, { a: -35.5, b: -12 }, { a: -40.5, b: 9 }, { a: -45, b: -9 }, { a: chapel.a + CH_D / 2 + 1.4, b: chapel.b }];
  const steps: ZoryaPlan['steps'] = [];
  for (let i = 0; i < way.length - 1; i++) {
    const A = way[i], B = way[i + 1];
    const len = Math.hypot(B.a - A.a, B.b - A.b);
    const n = Math.max(2, Math.round(len / 0.85));
    const da = (B.a - A.a) / len, db = (B.b - A.b) / len;
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const a = A.a + ((B.a - A.a) * k) / n, b = A.b + ((B.b - A.b) * k) / n;
      steps.push({ a, b, h: at(a, b), da, db });
    }
  }
  // будиночки-тераси обабіч сходів: на схилі, але не на самих сходах і не на каплиці
  const terraces: ZoryaPlan['terraces'] = [];
  for (const c of [{ a: -33, b: 14 }, { a: -37.5, b: -18 }, { a: -38, b: 16 }, { a: -43.5, b: -16 }, { a: -42.5, b: 15 }, { a: -36.5, b: -3 }]) {
    if (steps.some((s) => Math.hypot(s.a - c.a, s.b - c.b) < 4.4)) continue;
    if (terraces.some((t) => Math.hypot(t.a - c.a, t.b - c.b) < 6)) continue;
    if (Math.hypot(c.a - chapel.a, c.b - chapel.b) < 9) continue;
    const [lo, hi] = span(c.a, c.b, 4.5, 5);
    if (lo < 1.2 || hi - lo > 7.5) continue;
    terraces.push({ ...c, lo, hi });
    if (terraces.length >= 4) break;
  }
  const reserved: ZoryaPlan['reserved'] = [
    [CAFE.a, CAFE.b, 4],
    [SQUARE.a, SQUARE.b, 6.5],
    ...STALLS.map((s): [number, number, number] => [s.a, s.b, 2.2]),
    [chapel.a, chapel.b, 8],
    ...terraces.map((t): [number, number, number] => [t.a, t.b, 4]),
    // підхід від площі до першої сходинки — вільний
    [-27.5, 4, 3.4],
  ];
  for (let i = 0; i < steps.length; i += 2) reserved.push([steps[i].a, steps[i].b, 2.4]);
  return { chapel, steps, terraces, reserved };
}

/** статика містечка — у Batch гавані (зіллється з рештою) */
export function buildZoryaStatic(c: TownCtx, plan: ZoryaPlan) {
  const { p, batch, M, ry } = c;
  const W = (a: number, b: number) => siteToWorld(p, a, b);
  const Y = p.plY;
  const ext = zoryaMats();
  // напрям у локальних (da, db) → кут повороту меша (+Z уздовж напряму)
  const head = (da: number, db: number) => {
    const wx = p.ox * da - p.oz * db, wz = p.oz * da + p.ox * db;
    return Math.atan2(wx, wz);
  };

  // ── сходи серпантином: камінь, бортики, ліхтарі ──
  plan.steps.forEach((s, i) => {
    const [x, z] = W(s.a, s.b);
    const r = head(s.da, s.db);
    batch.add(boxGeo(1.8, 1.1, 0.95, 1.2), M.stone, T(x, s.h - 0.48, z, r));
    for (const side of [-1, 1]) {
      const [wx, wz] = W(s.a - s.db * side * 1.05, s.b + s.da * side * 1.05);
      batch.add(boxGeo(0.26, 0.42, 0.95), M.stoneDark, T(wx, s.h + 0.12, wz, r));
    }
    if (i % 16 === 8) {
      const [lx, lz] = W(s.a - s.db * 1.6, s.b + s.da * 1.6);
      c.lampPost(lx, lz, c.H(lx, lz));
      c.solidCircle(lx, lz, 0.25);
    }
  });

  // ── будиночки-тераси на схилі: кам'яний цоколь від низу схилу ──
  for (const t of plan.terraces) {
    const [x, z] = W(t.a, t.b);
    const plinth = t.hi - t.lo + 0.7;
    batch.add(boxGeo(5.6, plinth, 5.0, 1.5), M.stoneDark, T(x, t.lo - 0.4 + plinth / 2, z, ry));
    c.house({ x, z, y0: t.hi + 0.25, ry, w: 5, d: 4.5, h: c.rng() < 0.5 ? 3.4 : 5, rh: 1.4, wall: [M.plWhite, M.plOchre, M.plBlue, M.plCream][Math.floor(c.rng() * 4)], roof: c.rng() < 0.6 ? M.roofRed : M.roofBrown, door: 0 });
    c.solidBox(x, z, p.ox ? 5.0 : 5.6, p.ox ? 5.6 : 5.0);
  }

  // ── каплиця з дзвіницею ──
  {
    const ch = plan.chapel;
    const [x, z] = W(ch.a, ch.b);
    // підлога — трохи вище за нижній край схилу; тил ховається в пагорб
    const y0 = ch.lo + 0.4;
    const plinth = y0 - ch.lo + 1.0;
    batch.add(boxGeo(CH_W + 1.6, plinth, CH_D + 1.6, 1.5), M.stoneDark, T(x, ch.lo - 1.0 + plinth / 2, z, ry));
    // ганок: три сходинки від стежки до дверей
    const front = c.H(...W(ch.a + CH_D / 2 + 1.6, ch.b));
    for (let k = 0; k < 3; k++) {
      const top = front + ((y0 - front) * (k + 1)) / 3;
      const [sx, sz] = W(ch.a + CH_D / 2 + 1.25 - k * 0.42, ch.b);
      batch.add(boxGeo(2.4, Math.max(0.3, top - front + 0.5), 0.5, 1.2), M.stone, T(sx, top - Math.max(0.3, top - front + 0.5) / 2, sz, ry));
    }
    c.house({ x, z, y0, ry, w: CH_W, d: CH_D, h: 4.4, rh: 2.1, wall: M.plWhite, roof: M.roofRed, door: 0 });
    c.solidBox(x, z, p.ox ? CH_D + 0.4 : CH_W + 0.4, p.ox ? CH_W + 0.4 : CH_D + 0.4);
    // кругле вікно-«троянда» над дверима
    const [rx, rz] = W(ch.a + CH_D / 2 + 0.09, ch.b);
    batch.add(cylGeo(0.55, 0.55, 0.1, 16), M.trim, T(rx, y0 + 0.3 + 3.5, rz, ry, Math.PI / 2));
    batch.add(cylGeo(0.42, 0.42, 0.12, 16), M.glassLit, T(rx, y0 + 0.3 + 3.5, rz, ry, Math.PI / 2), false);
    // дзвіниця біля фасаду: стовбур, аркова звонниця, шатро, хрест
    const tb = ch.b - (CH_W / 2 + 1.4);
    const [tx, tz] = W(ch.a + CH_D / 2 - 1.4, tb);
    const tH = 7.2;
    batch.add(boxGeo(2.6, tH, 2.6, 1.5), M.plWhite, T(tx, y0 + tH / 2 - 0.4, tz, ry));
    batch.add(boxGeo(2.9, 0.25, 2.9), M.trim, T(tx, y0 + tH - 0.3, tz, ry));
    const by = y0 + tH - 0.2;
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const [px, pz] = W(ch.a + CH_D / 2 - 1.4 + v * 1.05, tb + u * 1.05);
      batch.add(boxGeo(0.5, 2.3, 0.5), M.plWhite, T(px, by + 1.15, pz, ry));
    }
    batch.add(boxGeo(2.9, 0.3, 2.9), M.trim, T(tx, by + 2.45, tz, ry));
    batch.add(new THREE.ConeGeometry(2.15, 2.8, 4), M.roofRed, T(tx, by + 4.0, tz, ry + Math.PI / 4));
    batch.add(boxGeo(0.1, 1.1, 0.1), M.iron, T(tx, by + 5.9, tz, ry));
    batch.add(boxGeo(0.1, 0.1, 0.6), M.iron, T(tx, by + 6.1, tz, ry + Math.PI / 2));
    c.solidBox(tx, tz, 2.8, 2.8);
    plan.bell = new THREE.Vector3(tx, by + 1.75, tz);
  }

  // ── кав'ярня «Світанок»: будочка, смугастий тент, столики з парасолями, гірлянда ──
  {
    const [x, z] = W(CAFE.a, CAFE.b);
    c.house({ x, z, y0: Y, ry, w: CAFE.w, d: CAFE.d, h: 3.0, rh: 1.1, wall: M.plCream, roof: M.roofRed, door: 0, sign: L('☕ Кав\'ярня «Світанок»', `☕ “Daybreak” Café`) });
    c.solidBox(x, z, p.ox ? CAFE.d + 0.3 : CAFE.w + 0.3, p.ox ? CAFE.w + 0.3 : CAFE.d + 0.3);
    // тент: смуги від фасаду до двох стійок
    const front = CAFE.a + CAFE.d / 2;
    for (let k = 0; k < 5; k++) {
      const b = CAFE.b - 2.0 + k;
      const [sx, sz] = W(front + 1.15, b);
      batch.add(boxGeo(1.0, 0.04, 2.5), k % 2 ? M.canvasB : M.canvasA, T(sx, Y + 2.62, sz, ry, 0.3));
    }
    for (const b of [CAFE.b - 2.3, CAFE.b + 2.3]) {
      const [px, pz] = W(front + 2.3, b);
      batch.add(cylGeo(0.05, 0.05, 2.3, 6), M.iron, T(px, Y + 1.15, pz));
      c.solidCircle(px, pz, 0.15);
    }
    // столики
    const tables: Array<[number, number, boolean]> = [[-4.3, 6.6, true], [-4.6, 10.6, false], [-6.9, 8.6, true]];
    tables.forEach(([a, b, umb], i) => {
      const [tx, tz] = W(a, b);
      batch.add(cylGeo(0.48, 0.48, 0.05, 14), M.whitePaint, T(tx, Y + 0.76, tz));
      batch.add(cylGeo(0.04, 0.04, 0.74, 6), M.iron, T(tx, Y + 0.38, tz));
      batch.add(cylGeo(0.26, 0.26, 0.03, 10), M.iron, T(tx, Y + 0.02, tz));
      for (const s of [-1, 1]) {
        const [cx, cz] = W(a, b + s * 0.82);
        const r = ry + (s > 0 ? Math.PI / 2 : -Math.PI / 2);
        batch.add(boxGeo(0.44, 0.05, 0.44), M.woodDark, T(cx, Y + 0.46, cz, r));
        for (const [u, v] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) batch.add(boxGeo(0.04, 0.46, 0.04), M.iron, T(cx, Y + 0.23, cz, r).multiply(T(u, 0, v)));
        batch.add(boxGeo(0.44, 0.45, 0.05), M.woodDark, T(cx, Y + 0.7, cz, r).multiply(T(0, 0, -0.2)));
      }
      // чашки
      batch.add(cylGeo(0.05, 0.04, 0.08, 8), M.whitePaint, T(tx + 0.12, Y + 0.82, tz));
      if (umb) {
        batch.add(cylGeo(0.03, 0.03, 2.3, 6), M.trim, T(tx, Y + 1.15, tz));
        batch.add(new THREE.ConeGeometry(1.25, 0.45, 8, 1, true), i ? M.canvasC : M.canvasA, T(tx, Y + 2.25, tz));
      }
      c.solidCircle(tx, tz, 0.55);
    });
    // гірлянда: від стійок тенту до двох жердин біля води (лампочки світять уночі)
    const poles: Pt[] = [{ a: -3.0, b: 5.0 }, { a: -3.0, b: 12.4 }];
    for (const q of poles) {
      const [px, pz] = W(q.a, q.b);
      batch.add(cylGeo(0.05, 0.06, 2.9, 6), M.woodDark, T(px, Y + 1.45, pz));
      c.solidCircle(px, pz, 0.12);
    }
    const string = (A: Pt, ya: number, B: Pt, yb: number) => {
      const n = 9;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const a = A.a + (B.a - A.a) * f, b = A.b + (B.b - A.b) * f;
        const y = ya + (yb - ya) * f - Math.sin(f * Math.PI) * 0.35;
        const [bx, bz] = W(a, b);
        pts.push(new THREE.Vector3(bx, y, bz));
        if (k > 0 && k < n) batch.add(new THREE.SphereGeometry(0.045, 6, 4), M.lamp, T(bx, y - 0.06, bz), false);
      }
      // дріт між лампочками
      const wire = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.008, 3, false);
      batch.add(wire, M.iron, undefined, false);
    };
    string({ a: front + 2.3, b: CAFE.b - 2.3 }, Y + 2.35, poles[0], Y + 2.8);
    string({ a: front + 2.3, b: CAFE.b + 2.3 }, Y + 2.35, poles[1], Y + 2.8);
    string(poles[0], Y + 2.8, poles[1], Y + 2.8);
    const [g1x, g1z] = W(-3.0, 8.7);
    c.glow(g1x, Y + 2.5, g1z, 2.2);
    const [g2x, g2z] = W(front + 1.6, CAFE.b);
    c.glow(g2x, Y + 2.3, g2z, 1.8);
  }

  // ── ринкова площа: фонтан, ятки з тентами, лавки ──
  {
    const [fx, fz] = W(SQUARE.a, SQUARE.b);
    batch.add(cylGeo(2.3, 2.45, 0.6, 20, 1.5), M.stone, T(fx, Y + 0.3, fz));
    batch.add(tinted(cylGeo(2.05, 2.05, 0.06, 20), 0x5aa8bf), ext.tint, T(fx, Y + 0.5, fz), false);
    batch.add(cylGeo(0.32, 0.4, 1.5, 10), M.stone, T(fx, Y + 1.2, fz));
    batch.add(cylGeo(0.85, 0.45, 0.28, 14), M.stone, T(fx, Y + 2.0, fz));
    batch.add(tinted(cylGeo(0.7, 0.7, 0.04, 14), 0x5aa8bf), ext.tint, T(fx, Y + 2.12, fz), false);
    batch.add(new THREE.SphereGeometry(0.22, 10, 8), M.stone, T(fx, Y + 2.35, fz));
    c.solidCircle(fx, fz, 2.5);
    // лавки по боках фонтану
    for (const s of [-1, 1]) {
      const [bx, bz] = W(SQUARE.a, SQUARE.b + s * 4.4);
      const r = ry + Math.PI / 2;
      batch.add(boxGeo(1.9, 0.07, 0.5), M.woodDark, T(bx, Y + 0.46, bz, r));
      batch.add(boxGeo(1.9, 0.45, 0.06), M.woodDark, T(bx, Y + 0.75, bz, r).multiply(T(0, 0, s * 0.22)));
      for (const u of [-0.8, 0.8]) batch.add(boxGeo(0.07, 0.46, 0.45), M.iron, T(bx, Y + 0.23, bz, r).multiply(T(u, 0, 0)));
      c.solidBox(bx, bz, p.ox ? 0.6 : 2, p.ox ? 2 : 0.6);
    }
    // ятки: прилавок, стовпчики, смугастий дах, ящики з товаром
    const goods = [0xe88a2c, 0xc8402c, 0xb9c6ce, 0x4f8a3c, 0xead25a];
    STALLS.forEach((s, i) => {
      const [sx, sz] = W(s.a, s.b);
      batch.add(boxGeo(2.6, 0.9, 1.1, 1.2), M.woodGrey, T(sx, Y + 0.45, sz, ry));
      for (const [u, v] of [[-1.25, -0.5], [1.25, -0.5], [-1.25, 0.5], [1.25, 0.5]]) {
        const [px, pz] = W(s.a + v, s.b + u);
        batch.add(boxGeo(0.08, 2.3, 0.08), M.woodDark, T(px, Y + 1.15, pz));
      }
      for (let k = 0; k < 3; k++) {
        const [rx, rz] = W(s.a, s.b - 0.9 + k * 0.9);
        batch.add(boxGeo(0.9, 0.04, 1.6), k % 2 ? M.canvasB : i === 1 ? M.canvasC : M.canvasA, T(rx, Y + 2.35, rz, ry, 0.22));
      }
      for (let k = 0; k < 3; k++) {
        const [gx, gz] = W(s.a + 0.15, s.b - 0.85 + k * 0.85);
        batch.add(boxGeo(0.62, 0.18, 0.5), M.woodDark, T(gx, Y + 0.99, gz, ry));
        batch.add(tinted(boxGeo(0.54, 0.1, 0.42), goods[(i + k) % goods.length]), ext.tint, T(gx, Y + 1.12, gz, ry));
      }
      c.solidBox(sx, sz, p.ox ? 1.3 : 2.8, p.ox ? 2.8 : 1.3);
    });
  }

  // ── сигнальна щогла з реєю (прапорці — живі, у ZoryaLife) ──
  {
    const [mx, mz] = W(MAST.a, MAST.b);
    batch.add(cylGeo(0.4, 0.5, 0.5, 10), M.stone, T(mx, Y + 0.25, mz));
    batch.add(cylGeo(0.07, 0.12, 9.5, 8), M.whitePaint, T(mx, Y + 4.75, mz));
    batch.add(boxGeo(0.07, 0.07, 3.4), M.whitePaint, T(mx, Y + 7.6, mz, ry + Math.PI / 2));
    batch.add(new THREE.SphereGeometry(0.14, 8, 6), M.redPaint, T(mx, Y + 9.6, mz));
    c.solidCircle(mx, mz, 0.5);
  }

  // ── квіти у вазонах уздовж набережної (кольорові плями біля стін) ──
  for (let k = 0; k < 6; k++) {
    const b = -20 + k * 7.6;
    if (Math.abs(b) < 3.5) continue;
    const [vx, vz] = W(-6.6, b);
    batch.add(cylGeo(0.32, 0.26, 0.4, 8), M.roofBrown, T(vx, Y + 0.2, vz));
    batch.add(tinted(new THREE.IcosahedronGeometry(0.34, 0), k % 2 ? 0xe0566e : 0xf2c84a), ext.tint, T(vx, Y + 0.55, vz, k, 0, 0, 1, 0.7, 1));
    c.solidCircle(vx, vz, 0.35);
  }
}

/** геометрія з кольором у вершинах (для спільного матеріалу tint) */
function tinted(g0: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = g0.index ? g0.toNonIndexed() : g0;
  const col = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}

let _mats: ReturnType<typeof makeZoryaMats> | null = null;
function zoryaMats() {
  return (_mats ??= makeZoryaMats());
}
function makeZoryaMats() {
  const std = (color: number, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness });
  return {
    /** дрібний кольоровий реквізит (товар на ятках, квіти, вода фонтану) — один матеріал, колір у вершинах */
    tint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.35, metalness: 0.85 }),
  };
}

// ───────────────────────── життя містечка ─────────────────────────

type Pose = 'stand' | 'sit' | 'fish' | 'circle';

interface Person {
  rig: CharacterRig;
  pose: Pose;
  phase: number;
  /** коло (діти біля фонтану): центр, радіус, швидкість, напрям */
  cx?: number;
  cz?: number;
  cr?: number;
  speed?: number;
  y: number;
  /** репліка, коли гравець підходить */
  line?: () => string;
  /** кидає тінь зараз */
  shadow?: boolean;
}

/** вогні, дзвін і мешканці (анімуються лише поблизу) */
export class ZoryaLife {
  readonly group = new THREE.Group();
  /** колбеки (ставить Ports): удар дзвона (гучність 0..1), репліка мешканця */
  onBell: ((vol: number) => void) | null = null;
  onSay: ((text: string) => void) | null = null;
  private people: Person[] = [];
  private bellPivot = new THREE.Group();
  private bellPos = new THREE.Vector3();
  private flags: THREE.Mesh;
  private flagBase: Float32Array;
  private cat = new THREE.Group();
  private catTail = new THREE.Group();
  private catHead = new THREE.Group();
  private lastT = -1;
  private lastH = -1;
  private strikes: number[] = [];
  private swing = 0;
  private swingT = 0;
  private sayCd = 0;
  private said = new Map<Person, number>();
  private cx: number;
  private cz: number;
  private peopleOn = true;
  private shadowTick = 0;

  constructor(private c: TownCtx, plan: ZoryaPlan) {
    const { p, ry } = c;
    const W = (a: number, b: number) => siteToWorld(p, a, b);
    const Y = p.plY;
    const ext = zoryaMats();
    [this.cx, this.cz] = W(-15, 0);

    // ── дзвін у звонниці ──
    const bell = plan.bell;
    if (bell) {
      this.bellPos.copy(bell);
      this.bellPivot.position.copy(bell).add(new THREE.Vector3(0, 0.55, 0));
      this.bellPivot.rotation.y = ry;
      const prof = [[0, -0.95], [0.5, -0.95], [0.55, -0.85], [0.42, -0.55], [0.32, -0.1], [0.3, 0], [0, 0.02]].map(([x, y]) => new THREE.Vector2(x, y));
      const b = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), ext.bronze);
      b.castShadow = true;
      this.bellPivot.add(b);
      const yoke = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.14), this.c.M.woodDark as THREE.Material);
      yoke.position.y = 0.08;
      this.bellPivot.add(yoke);
      this.group.add(this.bellPivot);
    }

    // ── прапорці на реї сигнальної щогли (один меш, тріпочуть поблизу) ──
    {
      const [mx, mz] = W(MAST.a, MAST.b);
      const cols = [0xd33b2c, 0xf2f1ec, 0x2f5fa8, 0xf2c84a, 0x2f8f5a, 0xd33b2c];
      const pos: number[] = [], col: number[] = [];
      const c3 = new THREE.Color();
      // гірлянда прапорців: від кінців реї донизу до щогли — дві похилі лінії
      const lat = [-p.oz, p.ox];
      const lines: Array<[number, number, number, number]> = [[1.6, 7.6, 0, 2.6], [-1.6, 7.6, 0, 2.6]];
      let k = 0;
      for (const [b0, y0, b1, y1] of lines) {
        for (let i = 0; i < 6; i++) {
          const f = (i + 0.5) / 6;
          const bb = b0 + (b1 - b0) * f, yy = y0 + (y1 - y0) * f;
          const x = mx + lat[0] * bb, z = mz + lat[1] * bb;
          c3.setHex(cols[k++ % cols.length]);
          // трикутний прапорець, що звисає (3 вершини), площина — уздовж реї
          const tri = [[0, 0, 0], [0, -0.55, 0], [0.42, -0.27, 0]];
          for (const [u, v] of tri) {
            pos.push(x + lat[0] * 0 + p.ox * u, Y + yy + v, z + p.oz * u);
            col.push(c3.r, c3.g, c3.b);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      this.flagBase = new Float32Array(pos);
      this.flags = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
      this.flags.frustumCulled = false;
      this.group.add(this.flags);
      // мотузки гірлянди
      const lpts: THREE.Vector3[] = [];
      for (const [b0, y0, b1, y1] of lines) {
        lpts.push(new THREE.Vector3(mx + lat[0] * b0, Y + y0, mz + lat[1] * b0), new THREE.Vector3(mx + lat[0] * b1, Y + y1, mz + lat[1] * b1));
      }
      this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lpts), new THREE.LineBasicMaterial({ color: 0x5a554c })));
    }

    // ── мешканці ──
    const person = (look: CharacterLook, scale = 1): CharacterRig => {
      const r = buildCharacter(look);
      compactRig(r);
      r.body.scale.setScalar(scale);
      this.group.add(r.root);
      return r;
    };
    const add = (rig: CharacterRig, a: number, b: number, face: number, pose: Pose, line?: () => string, y = Y): Person => {
      const [x, z] = W(a, b);
      rig.root.position.set(x, y, z);
      rig.root.rotation.y = face;
      const pp: Person = { rig, pose, phase: c.rng() * 10, y, line, shadow: true };
      if (pose === 'sit' || pose === 'fish') {
        rig.legL.rotation.set(-Math.PI / 2 + 0.2, -0.1, 0);
        rig.legR.rotation.set(-Math.PI / 2 + 0.2, 0.1, 0);
        rig.kneeL.rotation.x = rig.kneeR.rotation.x = Math.PI / 2 - 0.2;
        rig.root.position.y = y - 0.33;
        rig.armL.rotation.x = rig.armR.rotation.x = -0.6;
      }
      if (pose !== 'circle') c.solidCircle(x, z, 0.35);
      this.people.push(pp);
      return pp;
    };
    const sea = ry; // обличчям до моря
    const inland = ry + Math.PI;

    // рибалка сидить на краю набережної, ноги над водою, вудка в морі
    {
      const r = person({ jacket: 0x3d5a6b, jacketKind: 'coat', pants: 0x2d3038, hat: 'beanie', hatColor: 0x9a3b2c, skin: SKINS[2], hair: 'short', hairColor: HAIRS[5], beard: 'full', brow: -0.1, boots: 0x2b2b2b });
      const pp = add(r, -0.45, -14.5, sea, 'fish', () => L('Скумбрія підходить до мису на світанку. Звідси й назва — Гавань Зорі.', `Mackerel come round the cape at dawn. That's how Dawn Harbour got its name.`));
      r.armL.rotation.x = r.armR.rotation.x = -0.9;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.018, 2.6, 5), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4 }));
      rod.rotation.x = 1.86;
      rod.position.set(0, -0.58 - 0.288 * 1.1, 0.956 * 1.1);
      r.armR.add(rod);
      r.root.updateMatrixWorld(true);
      const tip = new THREE.Vector3(0, 1.3, 0);
      rod.localToWorld(tip);
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([tip, new THREE.Vector3(tip.x, 0.08, tip.z)]), new THREE.LineBasicMaterial({ color: 0xdde8ee, transparent: true, opacity: 0.6 })));
      const bob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe0522f, roughness: 0.4 }));
      bob.position.set(tip.x, 0.05, tip.z);
      this.group.add(bob);
      void pp;
    }
    // бариста біля дверей кав'ярні
    add(person({ jacket: 0xf2efe6, jacketKind: 'knit', pants: 0x3a3a44, hat: 'none', hair: 'bun', hairColor: HAIRS[1], skin: SKINS[1], apron: 0x6b4a33, brow: 0.3, boots: 0x6b4a33 }), CAFE.a + CAFE.d / 2 + 0.7, CAFE.b + 1.3, sea, 'stand', () => L('Кава з корицею — і жоден шторм не страшний. А коли б\'є дзвін на мисі — рибалки виходять у море.', `Coffee with cinnamon — and no storm can scare you. When the bell on the cape rings, the fishermen put to sea.`));
    // двоє гостей кав'ярні за столиками
    add(person({ jacket: 0xa94436, jacketKind: 'rain', pants: 0x2f3a4a, hat: 'sou', hatColor: 0xe6b93a, skin: SKINS[0], hair: 'short', hairColor: HAIRS[3], boots: 0x2b2b2b }), -4.3, 6.6 - 0.82, ry + Math.PI / 2 + Math.PI, 'sit', () => L('Кажуть, картограф знає, де стоїть тунець. Але бере дорого.', `They say the chartmaker knows where the tuna are. Charges a lot, though.`));
    // продавці на ринку (за прилавком, обличчям до площі)
    add(person({ jacket: 0x7a5232, jacketKind: 'coat', pants: 0x3a3a44, hat: 'cap', hatColor: 0x2f3a4a, skin: SKINS[2], hair: 'short', hairColor: HAIRS[0], beard: 'mustache', apron: 0xf2efe6, belly: true, width: 1.12 }), STALLS[0].a - 0.95, STALLS[0].b, sea, 'stand', () => L('Апельсини з Лазурового узбережжя! Свіжі — щойно з корабля.', `Oranges from the Azure Coast! Fresh off the boat.`));
    // дідусь на лавці біля фонтану
    add(person({ jacket: 0x4f5a66, jacketKind: 'coat', pants: 0x3a3a44, hat: 'captain', hatColor: 0x1d2633, hatAccent: 0xc9a227, skin: SKINS[1], hair: 'bald', beard: 'full', hairColor: HAIRS[6], brow: 0.3 }), SQUARE.a, SQUARE.b + 4.4, ry + Math.PI / 2 + Math.PI, 'sit', () => L('Шістдесят років тримав штурвал. Тепер тримаю лавку — вона хоч не хитається.', `Sixty years I held a wheel. Now I hold a bench — at least it doesn't roll.`));
    // діти бігають довкола фонтану
    for (const k of [0, 1]) {
      const r = person({ jacket: k ? 0xe2674a : 0x24878c, jacketKind: k ? 'rain' : 'knit', pants: 0x2f3a4a, hat: k ? 'none' : 'beanie', hatColor: 0xf2c84a, hair: k ? 'bun' : 'short', hairColor: HAIRS[k ? 3 : 2], skin: SKINS[k ? 0 : 2], brow: 0.5 }, 0.68);
      const [fx, fz] = W(SQUARE.a, SQUARE.b);
      const pp = add(r, SQUARE.a, SQUARE.b, 0, 'circle', k ? () => L('Ти справжній капітан? А покажеш яхту?', `Are you a real captain? Will you show us your yacht?`) : undefined);
      pp.cx = fx;
      pp.cz = fz;
      pp.cr = 3.3;
      pp.speed = 0.55;
      pp.phase = k * Math.PI;
    }
    void inland;

    // ── рудий кіт на парапеті набережної: 3 меші (тіло, голова, хвіст), колір — у вершинах ──
    {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
      const ginger = new THREE.Color(0xd9883a), white = new THREE.Color(0xf1ece2);
      const part = (boxes: Array<[THREE.BufferGeometry, THREE.Color, number, number, number]>) => {
        const geos = boxes.map(([g0, col, x, y, z]) => {
          const g1 = (g0.index ? g0.toNonIndexed() : g0).translate(x, y, z);
          const n = g1.attributes.position.count;
          const cc = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) cc.set([col.r, col.g, col.b], i * 3);
          g1.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
          g1.deleteAttribute('uv');
          return g1;
        });
        const m = new THREE.Mesh(mergeGeos(geos), mat);
        m.castShadow = true;
        return m;
      };
      this.cat.add(part([[new THREE.BoxGeometry(0.2, 0.22, 0.34), ginger, 0, 0.13, -0.02], [new THREE.BoxGeometry(0.16, 0.1, 0.14), white, 0, 0.07, 0.12]]));
      this.catHead.position.set(0, 0.3, 0.13);
      this.catHead.add(part([[new THREE.BoxGeometry(0.17, 0.15, 0.15), ginger, 0, 0, 0], [new THREE.BoxGeometry(0.09, 0.05, 0.05), white, 0, -0.04, 0.08], [new THREE.ConeGeometry(0.035, 0.07, 4), ginger, -0.05, 0.1, 0], [new THREE.ConeGeometry(0.035, 0.07, 4), ginger, 0.05, 0.1, 0]]));
      this.cat.add(this.catHead);
      this.catTail.position.set(0, 0.08, -0.18);
      const tail = part([[new THREE.BoxGeometry(0.04, 0.04, 0.3), ginger, 0, 0, -0.14]]);
      tail.rotation.x = -0.6;
      this.catTail.add(tail);
      this.cat.add(this.catTail);
      const [kx, kz] = W(-0.55, 4.6);
      this.cat.position.set(kx, Y + 0.15, kz);
      this.cat.rotation.y = ry + Math.PI / 2;
      this.group.add(this.cat);
    }

    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
    });
  }

  /** кожен кадр, поки гавань видно: t — секунди гри, hours — ігровий час доби */
  update(t: number, cam: THREE.Vector3, hours: number, night: number) {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const d = Math.hypot(cam.x - this.cx, cam.z - this.cz);
    this.group.visible = d < 380;

    // ── дзвін: о 7-й ранку — сім ударів (рибалки в море), о 19-й — три (додому) ──
    if (this.lastH >= 0) {
      const jumped = Math.abs(hours - this.lastH) > 2 && Math.abs(hours - this.lastH) < 22; // сон / перемотка — не дзвонимо
      const cross = (h: number) => (this.lastH < h && hours >= h) || (this.lastH > hours && (this.lastH < h || hours >= h) && this.lastH - hours > 20);
      if (!jumped) {
        if (cross(7)) for (let i = 0; i < 7; i++) this.strikes.push(t + i * 1.9);
        if (cross(19)) for (let i = 0; i < 3; i++) this.strikes.push(t + i * 2.4);
      }
    }
    this.lastH = hours;
    while (this.strikes.length && this.strikes[0] <= t) {
      this.strikes.shift();
      this.swing = 1;
      const db = Math.hypot(cam.x - this.bellPos.x, cam.z - this.bellPos.z);
      const vol = Math.max(0, 1 - db / 700);
      if (vol > 0.02) this.onBell?.(vol);
    }
    if (this.swing > 0.001) {
      this.swingT += dt;
      this.swing *= Math.exp(-dt * 0.45);
      this.bellPivot.rotation.x = Math.sin(this.swingT * 3.3) * 0.5 * this.swing;
    }

    // мешканці — лише зблизька (з моря їх і так не розгледіти); тіні — ще ближче
    const near = d < 70;
    if (near !== this.peopleOn) {
      this.peopleOn = near;
      for (const pp of this.people) pp.rig.root.visible = near;
      this.cat.visible = near;
    }
    // тінь кидає лише той, хто поруч з камерою (решта — без проходу тіней)
    if ((this.shadowTick -= dt) <= 0 && near) {
      this.shadowTick = 0.5;
      for (const pp of this.people) {
        const q = pp.rig.root.position;
        const want = Math.hypot(cam.x - q.x, cam.z - q.z) < 20;
        if (want === pp.shadow) continue;
        pp.shadow = want;
        pp.rig.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = want; });
      }
    }
    if (!this.group.visible || d > 170) return;

    // ── прапорці тріпочуть ──
    {
      const pos = this.flags.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array, b0 = this.flagBase;
      for (let i = 0; i < a.length; i += 9) {
        const ph = t * 4 + i * 0.37;
        // вершини 2 і 3 (кінчик і низ) гойдаються поперек
        for (const v of [1, 2]) {
          const o = i + v * 3;
          const amp = v === 2 ? 0.12 : 0.05;
          a[o] = b0[o] + Math.cos(ph) * amp * this.c.p.oz;
          a[o + 2] = b0[o + 2] + Math.sin(ph) * amp * (this.c.p.ox || 1);
          a[o + 1] = b0[o + 1] + Math.sin(ph * 1.3) * amp * 0.4;
        }
      }
      pos.needsUpdate = true;
    }

    // ── кіт: хвіст і голова ──
    this.catTail.rotation.y = Math.sin(t * 1.7) * 0.6;
    this.catTail.rotation.x = Math.sin(t * 0.9) * 0.15;
    this.catHead.rotation.y = Math.sin(t * 0.3) * 0.7 + Math.sin(t * 1.9) * 0.08;

    // ── мешканці ──
    const lateNight = night > 0.75;
    for (const pp of this.people) {
      const r = pp.rig;
      const br = Math.sin(t * 1.4 + pp.phase);
      r.torso.scale.y = 1 + br * 0.008;
      if (pp.pose === 'circle') {
        // діти вночі сплять
        r.root.visible = !lateNight && this.peopleOn;
        if (!r.root.visible) continue;
        const ang = t * (pp.speed ?? 0.5) + pp.phase;
        const x = (pp.cx ?? 0) + Math.cos(ang) * (pp.cr ?? 3), z = (pp.cz ?? 0) + Math.sin(ang) * (pp.cr ?? 3);
        r.root.position.set(x, pp.y, z);
        r.root.rotation.y = Math.atan2(-Math.sin(ang), Math.cos(ang));
        const step = t * 9 + pp.phase;
        const sw = Math.sin(step) * 0.7;
        r.legL.rotation.x = sw;
        r.legR.rotation.x = -sw;
        r.kneeL.rotation.x = 0.1 + Math.max(0, sw) * 0.9;
        r.kneeR.rotation.x = 0.1 + Math.max(0, -sw) * 0.9;
        r.armL.rotation.set(-sw * 1.1, 0, -0.2);
        r.armR.rotation.set(sw * 1.1, 0, 0.2);
        r.root.position.y = pp.y + Math.abs(Math.cos(step)) * 0.07;
      } else if (pp.pose === 'stand') {
        const shift = Math.sin(t * 0.4 + pp.phase * 1.7);
        r.body.position.x = shift * 0.018;
        r.body.rotation.z = shift * 0.025;
        r.head.rotation.y = Math.sin(t * 0.35 + pp.phase) * 0.5;
        const gest = Math.max(0, Math.sin(t * 0.25 + pp.phase * 3) - 0.7) * 3.5;
        r.armL.rotation.set(-0.08, 0, -0.12 + br * 0.03);
        r.armR.rotation.set(-0.08 - gest * 0.9, 0, 0.12 - br * 0.03 + gest * 0.25);
      } else if (pp.pose === 'fish') {
        r.armR.rotation.x = -0.9 + Math.sin(t * 0.8 + pp.phase) * 0.05;
        r.head.rotation.x = 0.15;
      } else {
        r.head.rotation.y = Math.sin(t * 0.25 + pp.phase) * 0.35;
      }
    }

    // ── репліки: підійшов до мешканця — він заговорить (не частіше раз на 6 с, кожен — раз на хвилину) ──
    this.sayCd -= dt;
    if (this.sayCd <= 0 && d < 60) {
      for (const pp of this.people) {
        if (!pp.line || !pp.rig.root.visible) continue;
        const pr = pp.rig.root.position;
        if (Math.hypot(cam.x - pr.x, cam.z - pr.z) > 2.6 || Math.abs(cam.y - pr.y - 1.5) > 2) continue;
        if (t - (this.said.get(pp) ?? -1e9) < 60) continue;
        this.said.set(pp, t);
        this.sayCd = 6;
        this.onSay?.(`💬 ${pp.line()}`);
        break;
      }
    }
  }
}
