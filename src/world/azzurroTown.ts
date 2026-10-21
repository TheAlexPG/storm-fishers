import * as THREE from 'three';
import { L } from '../core/i18n';
import { T, boxGeo, cylGeo } from './portKit';
import { siteToWorld } from './portSites';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCharacter, HAIRS, SKINS, type CharacterLook, type CharacterRig } from './character';
import type { TownCtx } from './zoryaTown';

// ─────────────────────────────────────────────────────────────
// Порто-Аццурро — середземноморське містечко (характер поверх загальної
// забудови ports.ts): піаца з фонтаном і кампанілою, тратторія «Да Ніно»
// з тентом і столиками, вузька вуличка з білизною на мотузках і нонною на
// балконі, бугенвілії на стінах, терасований лимонний гай на схилі,
// кольорові човни-гоцо біля набережної (гойдаються на воді), гірлянди
// лампочок, віспа біля кафе, мандолініст на фонтані (тихо грає поблизу),
// кіт. Статика — у Batch гавані (злиття), живе — окрема група, що
// анімується лише поблизу.
// ─────────────────────────────────────────────────────────────

export const AZZURRO_ID = 'port-azzurro';

// розкладка на плато (локальні a — у море, b — уздовж набережної)
const PIAZZA = { a: -18, b: -21, r: 6.5 };
const CAMPANILE = { a: -27, b: -29.5, s: 3.4, h: 16 };
const TRAT = { a: -14.5, b: 20, w: 6, d: 4.5 };
const TABLES = [{ a: -10.3, b: 18.3 }, { a: -10.3, b: 21.7 }];
const VESPA = { a: -7.4, b: 16.2 };
const VICOLO = [{ b: -14.2, wall: 'plWhite' }, { b: -7.2, wall: 'plPink' }];
const VIC = { a: -30, w: 4.4, d: 5, h: 7.2 };
const GROVE = { a0: -43, a1: -57, b0: 19, b1: 37 };
/** човни-гоцо: (a, b, колір корпусу) — кормою до моря, носом до набережної */
const GOZZI: Array<[number, number, number]> = [[3.3, -26.5, 0x2f6fb5], [3.1, -20.5, 0xc23a2c], [3.4, -14.5, 0x2f8f6a], [3.2, 15.5, 0xe8b33a], [3.3, 22, 0x24878c]];

export interface AzzurroPlan {
  /** зайняті місця для загальної забудови ports.ts: (a, b, r) */
  reserved: Array<[number, number, number]>;
}

/** план — до загальної забудови, щоб будинки не стали на піацу, тратторію чи гай */
export function azzurroPlan(): AzzurroPlan {
  return {
    reserved: [
      [PIAZZA.a, PIAZZA.b, PIAZZA.r + 1.5],
      [CAMPANILE.a, CAMPANILE.b, 3.2],
      [TRAT.a, TRAT.b, 4.6],
      [TABLES[0].a, (TABLES[0].b + TABLES[1].b) / 2, 3],
      ...VICOLO.map((v): [number, number, number] => [VIC.a, v.b, 3.6]),
      [(GROVE.a0 + GROVE.a1) / 2, (GROVE.b0 + GROVE.b1) / 2, 11],
    ],
  };
}

// ── спільні матеріали (один на все містечко; колір — у вершинах) ──
let _mats: ReturnType<typeof makeMats> | null = null;
function azMats() {
  return (_mats ??= makeMats());
}
function makeMats() {
  return {
    /** дрібний кольоровий реквізит: квіти, лимони, віспа, скатертини, вода фонтану, білизна й тенти (двобічний — один матеріал на все) */
    tint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }),
  };
}

/** геометрія одного кольору (атрибут color) — для злиття під tint */
function tinted(g0: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = g0.index ? g0.toNonIndexed() : g0;
  const col = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}

export function buildAzzurroStatic(c: TownCtx) {
  const { p, batch, M, ry, rng } = c;
  const W = (a: number, b: number) => siteToWorld(p, a, b);
  const Y = p.plY;
  const X = azMats();
  // напрям у локальних (da, db) → кут повороту меша (+Z уздовж напряму)
  const head = (da: number, db: number) => Math.atan2(p.ox * da - p.oz * db, p.oz * da + p.ox * db);
  const tint = (g: THREE.BufferGeometry, hex: number, m: THREE.Matrix4) => batch.add(tinted(g, hex), X.tint, m);
  const cloth = (g: THREE.BufferGeometry, hex: number, m: THREE.Matrix4) => batch.add(tinted(g, hex), X.tint, m);
  /** world-розміри коробки, витягнутої вздовж a (d) і b (w) */
  const solidAB = (a: number, b: number, d: number, w: number) => {
    const [x, z] = W(a, b);
    c.solidBox(x, z, p.ox ? d : w, p.ox ? w : d);
  };

  // бугенвілія: кілька пурпурних кульок квіту на зеленому листі, що «стікають» стіною
  const PINKS = [0xd23c8f, 0xe25aa5, 0xb8317a, 0xf07ab9];
  const bougain = (a: number, b: number, y: number, s = 1) => {
    const [x, z] = W(a, b);
    tint(new THREE.IcosahedronGeometry(0.55 * s, 0), 0x3f7a35, T(x, y, z, rng() * 6, 0, 0, 1.2, 0.8, 1.1));
    for (let k = 0; k < 5; k++) {
      const [dx, dz] = [(rng() - 0.5) * 1.1 * s, (rng() - 0.5) * 1.1 * s];
      tint(new THREE.IcosahedronGeometry((0.22 + rng() * 0.14) * s, 0), PINKS[k % PINKS.length], T(x + dx, y + (rng() - 0.6) * 0.9 * s, z + dz));
    }
  };
  // вазон з геранню
  const pot = (a: number, b: number, y = Y) => {
    const [x, z] = W(a, b);
    batch.add(cylGeo(0.26, 0.2, 0.42, 8), M.roofRed, T(x, y + 0.21, z));
    tint(new THREE.IcosahedronGeometry(0.3, 0), 0x3f7a35, T(x, y + 0.58, z, 0, 0, 0, 1, 0.75, 1));
    for (let k = 0; k < 3; k++) tint(new THREE.IcosahedronGeometry(0.1, 0), k % 2 ? 0xe2333f : 0xf06b6b, T(x + (rng() - 0.5) * 0.35, y + 0.75, z + (rng() - 0.5) * 0.35));
    c.solidCircle(x, z, 0.3);
  };
  // лавка
  const bench = (a: number, b: number, r: number) => {
    const [x, z] = W(a, b);
    batch.add(boxGeo(1.7, 0.08, 0.45), M.woodDark, T(x, Y + 0.45, z, r));
    for (const s of [-0.7, 0.7]) {
      const [lx, lz] = [x + Math.cos(r) * s, z - Math.sin(r) * s];
      batch.add(boxGeo(0.12, 0.42, 0.42), M.stone, T(lx, Y + 0.21, lz, r));
    }
    c.solidCircle(x, z, 0.6);
  };

  // ── піаца: бруківка колом, фонтан, лавки, вазони ──
  {
    const [px, pz] = W(PIAZZA.a, PIAZZA.b);
    const disc = new THREE.CircleGeometry(PIAZZA.r, 28);
    disc.rotateX(-Math.PI / 2);
    const uv = disc.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * PIAZZA.r * 0.7, uv.getY(i) * PIAZZA.r * 0.7);
    batch.add(disc, M.cobble, T(px, Y + 0.03, pz), false);
    // бордюр — кільце з каменю
    batch.add(new THREE.TorusGeometry(PIAZZA.r, 0.12, 4, 32).rotateX(Math.PI / 2), M.stoneDark, T(px, Y + 0.03, pz), false);
    // фонтан: чаша, вода, колона, верхня чаша
    batch.add(cylGeo(2.2, 2.35, 0.62, 22, 1.2), M.stone, T(px, Y + 0.31, pz));
    tint(new THREE.CircleGeometry(1.98, 22).rotateX(-Math.PI / 2), 0x5fb8c9, T(px, Y + 0.5, pz));
    batch.add(cylGeo(0.24, 0.34, 1.8, 10), M.stone, T(px, Y + 1.1, pz));
    batch.add(cylGeo(0.95, 0.45, 0.32, 14), M.stone, T(px, Y + 1.95, pz));
    tint(new THREE.CircleGeometry(0.85, 14).rotateX(-Math.PI / 2), 0x6cc3d2, T(px, Y + 2.1, pz));
    batch.add(new THREE.SphereGeometry(0.2, 8, 6), M.stone, T(px, Y + 2.35, pz));
    // струмінці — тонкі напівпрозорі «дуги» з чотирьох боків (статичні)
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2 + 0.4;
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 2.05, 0), new THREE.Vector3(Math.cos(ang) * 0.9, 2.15, Math.sin(ang) * 0.9), new THREE.Vector3(Math.cos(ang) * 1.45, 0.52, Math.sin(ang) * 1.45));
      tint(new THREE.TubeGeometry(curve, 8, 0.035, 4, false), 0xbfe8f0, T(px, Y, pz));
    }
    c.solidCircle(px, pz, 2.45);
    // лавки довкола (обличчям до фонтану) і вазони
    for (const [da, db] of [[4.6, 0], [0, 4.8], [-4.4, -2]] as const) {
      bench(PIAZZA.a + da, PIAZZA.b + db, head(-da, -db) + Math.PI / 2);
    }
    for (const [da, db] of [[5.6, 3.6], [5.6, -3.6], [-5.2, 3.8], [3.2, -5.6]] as const) pot(PIAZZA.a + da, PIAZZA.b + db);
    // ліхтарі піаци (уночі — ореоли)
    for (const [da, db] of [[-6.2, 0], [0, -6.4]] as const) {
      const [lx, lz] = W(PIAZZA.a + da, PIAZZA.b + db);
      c.lampPost(lx, lz, Y);
      c.solidCircle(lx, lz, 0.25);
    }
  }

  // ── кампаніла на розі піаци: вежа, карниз, дзвіниця з арками, годинник, черепичний шпиль ──
  {
    const { a, b, s, h } = CAMPANILE;
    const [x, z] = W(a, b);
    const y0 = Math.min(c.H(x, z), Y) - 0.3;
    batch.add(boxGeo(s + 0.5, 1.2, s + 0.5, 1.5), M.stoneDark, T(x, y0 + 0.6, z, ry));
    batch.add(boxGeo(s, h - 4, s, 2), M.plCream, T(x, y0 + 1.2 + (h - 4) / 2, z, ry));
    for (const yy of [y0 + h * 0.42, y0 + h - 2.8]) batch.add(boxGeo(s + 0.35, 0.28, s + 0.35), M.stone, T(x, yy, z, ry));
    // дзвіниця: чотири стовпи, проріз-арки темні
    const by = y0 + h - 2.8;
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const [cx, cz] = W(a + u * (s / 2 - 0.3), b + v * (s / 2 - 0.3));
      batch.add(boxGeo(0.6, 2.6, 0.6), M.plCream, T(cx, by + 1.3, cz, ry));
    }
    batch.add(boxGeo(s - 0.4, 0.5, s - 0.4), M.plCream, T(x, by + 2.75, z, ry));
    // дзвін усередині
    batch.add(new THREE.LatheGeometry([[0, -0.6], [0.42, -0.6], [0.36, -0.3], [0.26, 0], [0, 0.04]].map(([u, v]) => new THREE.Vector2(u, v)), 12), M.iron, T(x, by + 1.9, z));
    // черепичний шпиль
    batch.add(new THREE.ConeGeometry(s * 0.78, 3.2, 4), M.roofRed, T(x, by + 4.6, z, ry + Math.PI / 4));
    batch.add(cylGeo(0.04, 0.04, 1.2, 4), M.iron, T(x, by + 6.6, z));
    // годинник на боці до моря
    const [fx, fz] = W(a + s / 2 + 0.02, b);
    const fr = head(1, 0);
    batch.add(cylGeo(0.85, 0.85, 0.06, 20).rotateX(Math.PI / 2), M.whitePaint, T(fx, y0 + h * 0.62, fz, fr));
    batch.add(boxGeo(0.07, 0.6, 0.04), M.iron, T(fx, y0 + h * 0.62 + 0.22, fz, fr, 0, 0.3).multiply(T(0, 0, 0.04)));
    batch.add(boxGeo(0.07, 0.42, 0.04), M.iron, T(fx, y0 + h * 0.62, fz, fr, 0, -1.9).multiply(T(0, 0.17, 0.04)));
    solidAB(a, b, s + 0.5, s + 0.5);
  }

  // ── джелатерія (будинок — послуга порту): смугастий тент і два столики біля дверей ──
  {
    const ga = -11, gb = -29;
    for (let k = 0; k < 6; k++) {
      const [x, z] = W(ga + 0.2, gb - 1.9 + k * 0.64);
      cloth(new THREE.PlaneGeometry(0.64, 1.9).rotateX(-Math.PI / 2 + 0.38), k % 2 ? 0xf2efe6 : 0x8fd3c1, T(x, Y + 2.75, z, ry));
    }
    for (const db of [-2.2, 2.2]) {
      const [x, z] = W(ga + 1.1, gb + db);
      batch.add(cylGeo(0.4, 0.4, 0.05, 12), M.whitePaint, T(x, Y + 0.74, z));
      batch.add(cylGeo(0.04, 0.05, 0.72, 6), M.iron, T(x, Y + 0.37, z));
      c.solidCircle(x, z, 0.5);
    }
    bougain(ga - 1.4, gb - 2.7, Y + 1.7, 0.8);

  }

  // ── тратторія «Да Ніно»: будинок, смугастий тент, столики зі скатертинами, віспа ──
  {
    const [x, z] = W(TRAT.a, TRAT.b);
    c.house({ x, z, y0: Y, ry, w: TRAT.w, d: TRAT.d, h: 3.4, rh: 1.2, wall: M.plOchre, roof: M.roofRed, door: -1.6, sign: L('🍝 Тратторія «Да Ніно»', `🍝 Trattoria “Da Nino”`) });
    solidAB(TRAT.a, TRAT.b, TRAT.d + 0.3, TRAT.w + 0.3);
    // тент: смужки червоно-білі, від стіни вниз до моря
    const front = TRAT.a + TRAT.d / 2;
    for (let k = 0; k < 9; k++) {
      const [sx, sz] = W(front + 1.35, TRAT.b - 2.88 + k * 0.72);
      cloth(new THREE.PlaneGeometry(0.72, 2.8).rotateX(-Math.PI / 2 + 0.32), k % 2 ? 0xf2efe6 : 0xc8323a, T(sx, Y + 2.55, sz, ry));
    }
    // ліхтарик під тентом над столиками
    {
      const [lx, lz] = W(front + 1.6, TRAT.b);
      batch.add(cylGeo(0.01, 0.01, 0.35, 3), M.iron, T(lx, Y + 2.38, lz), false);
      batch.add(boxGeo(0.22, 0.3, 0.22), M.lamp, T(lx, Y + 2.05, lz, Math.PI / 4), false);
    }
    for (const db of [-2.9, 2.9]) {
      const [px, pz] = W(front + 2.65, TRAT.b + db);
      batch.add(cylGeo(0.04, 0.04, 2.15, 6), M.iron, T(px, Y + 1.08, pz));
      c.solidCircle(px, pz, 0.15);
    }
    // столики: біла стільниця, червона скатертина в клітинку (смужки), два стільці, пляшка й свічка
    for (const tb of TABLES) {
      const [tx, tz] = W(tb.a, tb.b);
      batch.add(cylGeo(0.05, 0.06, 0.72, 6), M.iron, T(tx, Y + 0.36, tz));
      batch.add(cylGeo(0.52, 0.52, 0.04, 14), M.whitePaint, T(tx, Y + 0.74, tz));
      tint(boxGeo(0.95, 0.02, 0.95), 0xc8323a, T(tx, Y + 0.77, tz, ry + Math.PI / 4));
      tint(boxGeo(0.62, 0.025, 0.62), 0xf2efe6, T(tx, Y + 0.775, tz, ry + Math.PI / 4));
      tint(cylGeo(0.045, 0.05, 0.3, 6), 0x2f5a35, T(tx + 0.12, Y + 0.93, tz));
      tint(cylGeo(0.035, 0.04, 0.16, 6), 0xf2e8c8, T(tx - 0.14, Y + 0.86, tz + 0.08));
      for (const db of [-0.75, 0.75]) {
        const [cx, cz] = W(tb.a, tb.b + db);
        batch.add(boxGeo(0.42, 0.06, 0.42), M.woodDark, T(cx, Y + 0.45, cz, ry));
        batch.add(boxGeo(0.42, 0.5, 0.06), M.woodDark, T(cx, Y + 0.7, cz, head(0, -Math.sign(db))));
        for (const [u, v] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
          const [lx, lz] = W(tb.a + u, tb.b + db + v);
          batch.add(boxGeo(0.04, 0.45, 0.04), M.woodDark, T(lx, Y + 0.22, lz));
        }
      }
      c.solidCircle(tx, tz, 0.95);
    }
    bougain(front - 0.3, TRAT.b + TRAT.w / 2 - 0.2, Y + 2.0);
    bougain(front - 0.3, TRAT.b - TRAT.w / 2 + 0.2, Y + 1.6, 0.8);
    pot(front + 0.4, TRAT.b - 0.8);
    // віспа: м'ятний корпус, щит, сидіння, кермо, колеса — уздовж набережної
    {
      const [vx, vz] = W(VESPA.a, VESPA.b);
      const vr = head(0, 1);
      const m = (lx: number, ly: number, lz: number) => T(vx, Y, vz, vr).multiply(T(lx, ly, lz));
      const mint = 0x8fd3c1;
      tint(new THREE.SphereGeometry(0.38, 10, 7).scale(0.75, 0.7, 1.45), mint, m(0, 0.5, -0.25));
      tint(boxGeo(0.34, 0.06, 0.62), 0x2b2724, m(0, 0.8, -0.2));
      tint(boxGeo(0.4, 0.75, 0.1), mint, m(0, 0.62, 0.48));
      tint(cylGeo(0.03, 0.03, 0.36, 5), 0x3a3a3a, m(0, 1.05, 0.5));
      tint(boxGeo(0.62, 0.05, 0.05), 0xd8d8d8, m(0, 1.22, 0.5));
      tint(new THREE.SphereGeometry(0.08, 8, 6), 0xfff3c0, m(0, 1.0, 0.56));
      for (const lz of [-0.62, 0.62]) tint(cylGeo(0.22, 0.22, 0.12, 12).rotateZ(Math.PI / 2), 0x232323, m(0, 0.22, lz));
      c.solidCircle(vx, vz, 0.8);
    }
  }

  // ── вуличка-вікол: два вузькі триповерхові будинки, білизна на мотузках, балкон нонни ──
  {
    for (const v of VICOLO) {
      const [x, z] = W(VIC.a, v.b);
      c.house({ x, z, y0: Y, ry, w: VIC.w, d: VIC.d, h: VIC.h, rh: 1.1, wall: M[v.wall] ?? M.plWhite, roof: M.roofRed, door: 0.6 });
      solidAB(VIC.a, v.b, VIC.d + 0.3, VIC.w + 0.3);
      bougain(VIC.a + VIC.d / 2 + 0.2, v.b + (v.b < -10 ? 1.6 : -1.6), Y + 3.4, 1.1);
    }
    // балкон на другому поверсі (будинок ближче до набережної): плита, поручні, вазони
    const bb = VICOLO[1].b, fa = VIC.a + VIC.d / 2;
    {
      const [x, z] = W(fa + 0.45, bb);
      batch.add(boxGeo(0.9, 0.14, 2.4).rotateY(Math.PI / 2), M.stone, T(x, Y + 3.45, z, ry + Math.PI / 2));
      const [rx, rz] = W(fa + 0.88, bb);
      batch.add(boxGeo(2.4, 0.05, 0.05), M.iron, T(rx, Y + 4.4, rz, ry));
      for (let k = -4; k <= 4; k++) {
        const [px, pz] = W(fa + 0.88, bb + k * 0.28);
        batch.add(boxGeo(0.03, 0.9, 0.03), M.iron, T(px, Y + 3.95, pz));
      }
      for (const db of [-0.9, 0.9]) {
        const [px, pz] = W(fa + 0.6, bb + db);
        batch.add(cylGeo(0.16, 0.12, 0.26, 7), M.roofRed, T(px, Y + 3.65, pz));
        tint(new THREE.IcosahedronGeometry(0.2, 0), 0xd23c8f, T(px, Y + 3.9, pz));
      }
    }
    // білизна на двох мотузках через вуличку
    const lane0 = VICOLO[0].b + VIC.w / 2, lane1 = VICOLO[1].b - VIC.w / 2;
    const COLS = [0xf2efe6, 0x8fb8de, 0xe8b33a, 0xf07ab9, 0xffffff, 0x9fcf8a, 0xc8323a];
    let k = 0;
    for (const [la, ly] of [[VIC.a + 0.9, Y + 4.4], [VIC.a - 1.0, Y + 5.6]] as const) {
      const [x0, z0] = W(la, lane0), [x1, z1] = W(la, lane1);
      const len = Math.hypot(x1 - x0, z1 - z0);
      batch.add(cylGeo(0.012, 0.012, len, 3).rotateX(Math.PI / 2), M.rope, T((x0 + x1) / 2, ly, (z0 + z1) / 2, head(0, 1)), false);
      for (let t = 0.12; t < 0.92; t += 0.19) {
        const [cx, cz] = W(la, lane0 + (lane1 - lane0) * t);
        const w = 0.34 + rng() * 0.22, hh = 0.45 + rng() * 0.35;
        cloth(new THREE.PlaneGeometry(w, hh), COLS[k++ % COLS.length], T(cx, ly - hh / 2 - 0.02, cz, ry, 0, (rng() - 0.5) * 0.12));
      }
    }
  }

  // ── набережна: кнехти для гоцо, сітки, ящики з рибою, вазони, амфори ──
  for (const [ga, gb] of GOZZI) {
    const [x, z] = W(-0.45, gb);
    batch.add(cylGeo(0.11, 0.14, 0.38, 8), M.iron, T(x, Y + 0.19, z));
    c.solidCircle(x, z, 0.2);
    void ga;
  }
  {
    // ящик, на якому сидить старий рибалка
    {
      const [cx, cz] = W(-2.0, -16.4);
      batch.add(boxGeo(0.6, 0.44, 0.5), M.woodGrey, T(cx, Y + 0.22, cz, ry));
    }
    // купа сітки з поплавцями й ящики біля старого рибалки
    const [nx, nz] = W(-2.2, -17.6);
    tint(new THREE.IcosahedronGeometry(0.75, 1).scale(1, 0.35, 1.3), 0x7a6a4a, T(nx, Y + 0.18, nz));
    for (let i = 0; i < 6; i++) tint(new THREE.SphereGeometry(0.09, 6, 4), i % 2 ? 0xe0522f : 0xf2c84a, T(nx + (rng() - 0.5) * 1.1, Y + 0.32, nz + (rng() - 0.5) * 1.6));
    c.solidCircle(nx, nz, 0.8);
    for (let i = 0; i < 3; i++) {
      const [cx, cz] = W(-3.2 - (i % 2) * 0.7, -13 + i * 0.4);
      batch.add(boxGeo(0.7, 0.32, 0.5), M.woodGrey, T(cx, Y + 0.16 + Math.floor(i / 2) * 0.33, cz, ry + (rng() - 0.5) * 0.3));
      c.solidCircle(cx, cz, 0.45);
    }
    // теракотові амфори з оливами вздовж набережної
    for (const b of [-33, 9, 31]) {
      const [x, z] = W(-6.3, b);
      batch.add(new THREE.SphereGeometry(0.42, 10, 8).scale(1, 1.25, 1), M.roofRed, T(x, Y + 0.5, z));
      batch.add(cylGeo(0.2, 0.26, 0.24, 10), M.roofRed, T(x, Y + 1.0, z));
      batch.add(new THREE.IcosahedronGeometry(0.55, 0), M.olive, T(x, Y + 1.5, z, rng() * 6, 0, 0, 1, 0.8, 1));
      c.solidCircle(x, z, 0.45);
    }
  }

  // ── гірлянди лампочок між ліхтарями набережної (провід провисає; лампочки — матеріал ліхтарів) ──
  {
    const hw = p.plW / 2;
    const posts: number[] = [];
    for (let b = -hw + 4; b <= hw - 4; b += 12) if (Math.abs(b) >= p.pierW / 2 + 2) posts.push(b);
    const bulb = new THREE.SphereGeometry(0.07, 6, 4);
    for (let i = 0; i + 1 < posts.length; i++) {
      const b0 = posts[i], b1 = posts[i + 1];
      if (b1 - b0 > 13) continue; // через причал — не тягнемо
      const N = 12;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const sag = Math.sin(t * Math.PI) * 0.55;
        const [x, z] = W(-1.8, b0 + (b1 - b0) * t);
        const y = Y + 3.42 - sag;
        if (k > 0 && k < N) batch.add(bulb, M.lamp, T(x, y - 0.1, z), false);
        if (k < N) {
          const [x1, z1] = W(-1.8, b0 + (b1 - b0) * (k + 1) / N);
          const y1 = Y + 3.42 - Math.sin(((k + 1) / N) * Math.PI) * 0.55;
          const len = Math.hypot(x1 - x, z1 - z, y1 - y);
          const mid = new THREE.Vector3((x + x1) / 2, (y + y1) / 2, (z + z1) / 2);
          const seg = cylGeo(0.012, 0.012, len, 3);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x, y1 - y, z1 - z).normalize());
          batch.add(seg, M.iron, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), false);
        }
      }
    }
  }

  // ── терасований лимонний гай на схилі за містечком: підпірні стінки й рядки дерев ──
  {
    let trees = 0;
    for (let a = GROVE.a0; a >= GROVE.a1; a -= 3.5) {
      // підпірна стінка вздовж рядка (сегменти по 2 м за рельєфом)
      for (let b = GROVE.b0; b <= GROVE.b1; b += 2) {
        const [x, z] = W(a + 0.9, b);
        const h = c.H(x, z);
        if (h < 2.6) continue;
        // сегмент уздовж b (локальний x меша — уздовж набережної), низ — у схилі
        batch.add(boxGeo(2.05, 0.95, 0.45, 1.2), M.stone, T(x, h - 0.15, z, ry));
      }
      for (let b = GROVE.b0 + 1.2 + (rng() - 0.5); b <= GROVE.b1 - 1; b += 3.1 + rng() * 0.8) {
        const [x, z] = W(a - 0.6 + (rng() - 0.5) * 0.6, b);
        const h = c.H(x, z);
        if (h < 3 || h > 22) continue;
        const k = 0.8 + rng() * 0.35;
        batch.add(cylGeo(0.09, 0.13, 1.1 * k, 5), M.trunk, T(x, h + 0.5 * k, z));
        tint(new THREE.IcosahedronGeometry(0.95 * k, 1), 0x4f8f3a, T(x, h + 1.5 * k, z, rng() * 6, 0, 0, 1.1, 0.8, 1.1));
        for (let q = 0; q < 11; q++) {
          const ang = rng() * Math.PI * 2, el = (rng() - 0.35) * 0.9;
          tint(new THREE.IcosahedronGeometry(0.13, 0).scale(1, 1.25, 1), 0xf7d42a, T(x + Math.cos(ang) * 0.98 * k, h + (1.5 + el * 0.65) * k, z + Math.sin(ang) * 0.98 * k));
        }
        c.solidCircle(x, z, 0.4);
        trees++;
      }
    }
    void trees;
  }
}

// ───────────────────────── життя містечка ─────────────────────────

type Pose = 'stand' | 'sit' | 'mend' | 'mandolin';

interface Person {
  rig: CharacterRig;
  pose: Pose;
  phase: number;
  y: number;
  line?: () => string;
  /** репліка без перевірки висоти (нонна на балконі) */
  high?: boolean;
  shadow?: boolean;
}

/** мелодія мандоліни (півтони від ре): проста тарантела з тремоло */
const TUNE = [0, 5, 9, 12, 9, 5, 7, 4, 0, 4, 7, 10, 9, 7, 5, 2, 5, 9, 12, 14, 12, 9, 7, 9, 5, 4, 2, 4, 0, -3, 0, -12];

/** люди, кіт, човни-гоцо, мандоліна (анімуються лише поблизу) */
export class AzzurroLife {
  readonly group = new THREE.Group();
  /** репліка мешканця й нота мандоліни (гучність 0..1, частота Гц) — ставить Ports */
  onSay: ((text: string) => void) | null = null;
  onMandolin: ((vol: number, hz: number) => void) | null = null;
  private people: Person[] = [];
  private boats: THREE.InstancedMesh[] = [];
  private boatBase: Array<{ x: number; z: number; r: number; ph: number }> = [];
  private dummy = new THREE.Object3D();
  private cat = new THREE.Group();
  private player: Person | null = null;
  private lastT = -1;
  private sayCd = 0;
  private said = new Map<Person, number>();
  private noteT = 0;
  private noteI = 0;
  private cx: number;
  private cz: number;
  private peopleOn = true;
  private shadowTick = 0;

  constructor(private c: TownCtx) {
    const { p, ry } = c;
    const W = (a: number, b: number) => siteToWorld(p, a, b);
    const Y = p.plY;
    const X = azMats();
    [this.cx, this.cz] = W(-14, 0);
    const head = (da: number, db: number) => Math.atan2(p.ox * da - p.oz * db, p.oz * da + p.ox * db);

    // ── човни-гоцо: два інстансовані меші (корпус у кольорі човна + білі/дерев'яні деталі) ──
    {
      const hull = gozzoHull();
      const det = gozzoDetails();
      const hm = new THREE.InstancedMesh(hull, X.tint, GOZZI.length);
      const dm = new THREE.InstancedMesh(det, X.tint, GOZZI.length);
      GOZZI.forEach(([a, b, col], i) => {
        const [x, z] = W(a, b);
        this.boatBase.push({ x, z, r: head(-1, 0), ph: c.rng() * 6 });
        hm.setColorAt(i, new THREE.Color(col));
        dm.setColorAt(i, new THREE.Color(0xffffff));
      });
      // тіні на воді не видно — не кидаємо (менше викликів у проході тіней)
      for (const m of [hm, dm]) {
        m.castShadow = false;
        m.receiveShadow = true;
        m.frustumCulled = false;
        this.boats.push(m);
        this.group.add(m);
      }
      this.updateBoats(0);
    }

    // ── мешканці ──
    const person = (look: CharacterLook, scale = 1): CharacterRig => {
      const r = buildCharacter(look, { coarse: true });
      r.body.scale.setScalar(scale);
      this.group.add(r.root);
      return r;
    };
    const add = (rig: CharacterRig, a: number, b: number, face: number, pose: Pose, line?: () => string, y = Y): Person => {
      const [x, z] = W(a, b);
      rig.root.position.set(x, y, z);
      rig.root.rotation.y = face;
      const pp: Person = { rig, pose, phase: c.rng() * 10, y, line, shadow: true };
      if (pose !== 'stand') {
        rig.legL.rotation.set(-Math.PI / 2 + 0.2, -0.1, 0);
        rig.legR.rotation.set(-Math.PI / 2 + 0.2, 0.1, 0);
        rig.kneeL.rotation.x = rig.kneeR.rotation.x = Math.PI / 2 - 0.2;
        rig.root.position.y = y - 0.33;
        rig.armL.rotation.x = rig.armR.rotation.x = -0.6;
      }
      c.solidCircle(x, z, 0.35);
      this.people.push(pp);
      return pp;
    };
    const sea = ry;

    // старий рибалка латає сітку на ящику біля гоцо
    {
      const r = person({ jacket: 0x2f4f6b, jacketKind: 'knit', pants: 0x3a3a44, hat: 'cap', hatColor: 0x2b2b2b, skin: SKINS[3], hair: 'short', hairColor: HAIRS[6], beard: 'mustache', brow: 0.2, boots: 0x2b2b2b });
      add(r, -2.0, -16.4, head(0, -1), 'mend', () => L('Мій гоцо — «Санта Лючія» — старший за мене. Фарбую щовесни, і море його любить.', `My gozzo — the “Santa Lucia” — is older than me. I paint her every spring, and the sea loves her.`));
    }
    // нонна на балконі
    {
      const fa = VIC.a + VIC.d / 2;
      const pp = add(person({ jacket: 0x2b2b33, jacketKind: 'coat', pants: 0x2b2b33, hat: 'none', hair: 'bun', hairColor: HAIRS[6], skin: SKINS[1], apron: 0xf2efe6, brow: 0.4, belly: true, width: 1.08 }), fa + 0.38, VICOLO[1].b + 0.4, sea, 'stand', () => L('Капітане! Ти голодний, я ж бачу. Іди до Ніно — скажи, що від нонни Розалії.', `Captain! You're hungry, I can tell. Go to Nino's — say Nonna Rosalia sent you.`), Y + 3.52);
      pp.high = true;
    }
    // офіціант біля тратторії
    add(person({ jacket: 0xf2efe6, jacketKind: 'knit', pants: 0x1f1f24, hat: 'none', hair: 'short', hairColor: HAIRS[0], skin: SKINS[2], apron: 0x1f1f24, beard: 'mustache', brow: 0.3, boots: 0x2b2724 }), TRAT.a + TRAT.d / 2 + 0.7, TRAT.b + 2.4, sea, 'stand', () => L('Спагеті алле вонголе, капітане! Молюски — з тієї самої бухти, де ти щойно ставав на якір.', `Spaghetti alle vongole, captain! The clams come from the very bay you just anchored in.`));
    // гостя за столиком
    add(person({ jacket: 0xe8b33a, jacketKind: 'knit', pants: 0x2f3a4a, hat: 'straw', hatColor: 0xe6cf8a, hatAccent: 0xc8323a, skin: SKINS[0], hair: 'long', hairColor: HAIRS[3], brow: 0.4 }), TABLES[1].a, TABLES[1].b + 0.62, head(0, -1), 'sit', () => L('Кажуть, на півночі риба дорожча, а вина немає зовсім. Візьми ящик кераміки на складі — там добре платять.', `They say up north the fish is pricier and there's no wine at all. Take a crate of pottery from the warehouse — they pay well there.`));
    // продавець джелато
    add(person({ jacket: 0xf2efe6, jacketKind: 'knit', pants: 0x3a3a44, hat: 'cap', hatColor: 0x8fd3c1, skin: SKINS[1], hair: 'short', hairColor: HAIRS[1], apron: 0x8fd3c1, brow: 0.5, belly: true }), -10.4, -30.6, sea, 'stand', () => L('Лимонне — з нашого гаю на пагорбі! Спробуй — і в шторм усміхатимешся.', `Lemon — from our grove up on the hill! Try it and you'll be smiling even in a storm.`));
    // мандолініст на краю фонтану (обличчям від фонтану — до набережної)
    {
      const r = person({ jacket: 0x6b2f3a, jacketKind: 'coat', pants: 0x2b2b33, hat: 'boater', hatColor: 0xe6cf8a, hatAccent: 0x2b2b33, skin: SKINS[2], hair: 'short', hairColor: HAIRS[0], beard: 'goatee', brow: 0.2, scarf: 0xc8323a });
      const pp = add(r, PIAZZA.a + 2.5, PIAZZA.b, head(1, 0), 'mandolin', () => L('Для капітана — серенада! Монетку не треба, просто привези мені колись північного сонця.', `A serenade for the captain! No coins needed — just bring me some northern sunshine one day.`), Y + 0.17);
      // мандоліна: грушоподібний корпус і гриф (один меш), на колінах
      const bodyG = tinted(new THREE.SphereGeometry(0.17, 10, 8).scale(1, 0.55, 1.25), 0x8a4a22);
      const neckG = tinted(boxGeo(0.05, 0.03, 0.42).translate(0, 0.02, 0.36), 0x3a2416);
      bodyG.deleteAttribute('uv');
      neckG.deleteAttribute('uv');
      const inst = new THREE.Mesh(mergeGeometries([bodyG, neckG], false)!, X.tint);
      inst.castShadow = true;
      inst.position.set(0.05, 0.92, 0.28);
      inst.rotation.set(0.15, -0.9, 0.5);
      r.root.add(inst);
      this.player = pp;
    }

    // ── кіт: дрімає на лавці піаци (3 меші, колір у вершинах) ──
    {
      const mat = X.tint;
      const grey = new THREE.Color(0x9a9690), white = new THREE.Color(0xf1ece2);
      const part = (boxes: Array<[THREE.BufferGeometry, THREE.Color, number, number, number]>) => {
        const geos = boxes.map(([g0, col, x, y, z]) => {
          const g1 = tinted(g0.translate(x, y, z), col.getHex());
          g1.deleteAttribute('uv');
          return g1;
        });
        const m = new THREE.Mesh(mergeGeometries(geos, false)!, mat);
        m.castShadow = true;
        return m;
      };
      // кіт спить клубком: один меш (тулуб, голова на лапах, вуха, хвіст навколо) — дихає
      this.cat.add(part([
        [new THREE.BoxGeometry(0.22, 0.17, 0.4), grey, 0, 0.085, 0],
        [new THREE.BoxGeometry(0.16, 0.06, 0.16), white, 0, 0.03, 0.14],
        [new THREE.BoxGeometry(0.17, 0.13, 0.15), grey, 0.04, 0.1, 0.24],
        [new THREE.BoxGeometry(0.09, 0.05, 0.05), white, 0.05, 0.07, 0.32],
        [new THREE.ConeGeometry(0.035, 0.07, 4), grey, -0.01, 0.2, 0.24],
        [new THREE.ConeGeometry(0.035, 0.07, 4), grey, 0.09, 0.2, 0.24],
        [new THREE.BoxGeometry(0.05, 0.05, 0.36), grey, -0.13, 0.04, 0.02],
      ]));
      const [kx, kz] = W(PIAZZA.a, PIAZZA.b + 4.8);
      this.cat.position.set(kx + 0.35, Y + 0.49, kz);
      this.cat.rotation.y = head(0, 1);
      this.group.add(this.cat);
    }

    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
    });
  }

  private updateBoats(t: number) {
    const d = this.dummy;
    this.boatBase.forEach((b, i) => {
      d.position.set(b.x, 0.16 + Math.sin(t * 1.1 + b.ph) * 0.05, b.z);
      d.rotation.set(Math.sin(t * 0.9 + b.ph) * 0.025, b.r + Math.sin(t * 0.3 + b.ph) * 0.03, Math.sin(t * 1.2 + b.ph * 1.7) * 0.045, 'YXZ');
      d.updateMatrix();
      for (const m of this.boats) m.setMatrixAt(i, d.matrix);
    });
    for (const m of this.boats) m.instanceMatrix.needsUpdate = true;
  }

  /** кожен кадр, поки гавань видно */
  update(t: number, cam: THREE.Vector3, _hours: number, night: number) {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const d = Math.hypot(cam.x - this.cx, cam.z - this.cz);
    this.group.visible = d < 420;
    if (!this.group.visible) return;

    // мешканці й кіт — лише зблизька; тіні — ще ближче
    const near = d < 75;
    if (near !== this.peopleOn) {
      this.peopleOn = near;
      for (const pp of this.people) pp.rig.root.visible = near;
      this.cat.visible = near;
      this.shadowTick = 0;
    }
    if ((this.shadowTick -= dt) <= 0 && near) {
      this.shadowTick = 0.5;
      for (const pp of this.people) {
        const q = pp.rig.root.position;
        const dc = Math.hypot(cam.x - q.x, cam.z - q.z);
        // кожен — лише ближче 50 м від камери (з набережної піаци й так не розгледиш)
        pp.rig.root.visible = dc < 50;
        const want = dc < 20;
        if (want === pp.shadow) continue;
        pp.shadow = want;
        pp.rig.root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = want;
        });
      }
    }
    // гоцо гойдаються, поки близько (далі хвиль на них і не розгледиш)
    if (d < 220) this.updateBoats(t);
    if (!near) return;

    // ── кіт: дихає уві сні ──
    this.cat.scale.y = 1 + Math.sin(t * 1.3) * 0.03;

    // ── мешканці ──
    for (const pp of this.people) {
      const r = pp.rig;
      const br = Math.sin(t * 1.4 + pp.phase);
      r.torso.scale.y = 1 + br * 0.008;
      if (pp.pose === 'stand') {
        const shift = Math.sin(t * 0.4 + pp.phase * 1.7);
        r.body.position.x = shift * 0.018;
        r.body.rotation.z = shift * 0.025;
        r.head.rotation.y = Math.sin(t * 0.35 + pp.phase) * 0.5;
        const gest = Math.max(0, Math.sin(t * 0.25 + pp.phase * 3) - 0.7) * 3.5;
        r.armL.rotation.set(-0.08, 0, -0.12 + br * 0.03);
        r.armR.rotation.set(-0.08 - gest * 0.9, 0, 0.12 - br * 0.03 + gest * 0.25);
      } else if (pp.pose === 'mend') {
        // руки латають сітку на колінах
        r.armL.rotation.set(-0.95 + Math.sin(t * 2.2 + pp.phase) * 0.12, 0, -0.15);
        r.armR.rotation.set(-0.85 + Math.sin(t * 2.2 + pp.phase + 1.6) * 0.15, 0, 0.15);
        r.head.rotation.x = 0.35;
      } else if (pp.pose === 'mandolin') {
        // ліва рука на грифі, права бренчить тремоло
        r.armL.rotation.set(-1.0, 0, -0.45);
        r.armR.rotation.set(-0.7 + Math.sin(t * 26) * 0.07, 0, 0.35);
        r.head.rotation.z = Math.sin(t * 2.1) * 0.08;
        r.head.rotation.x = 0.12;
      } else {
        r.head.rotation.y = Math.sin(t * 0.25 + pp.phase) * 0.35;
      }
    }

    // ── мандоліна: ноти тарантели, тихо й лише поблизу (уночі — серенада, теж грає) ──
    if (this.player && this.onMandolin) {
      const q = this.player.rig.root.position;
      const dm = Math.hypot(cam.x - q.x, cam.z - q.z);
      if (dm < 30) {
        this.noteT -= dt;
        if (this.noteT <= 0) {
          this.noteT += 0.34;
          const semi = TUNE[this.noteI++ % TUNE.length];
          const vol = Math.pow(1 - dm / 30, 1.5) * (night > 0.5 ? 0.85 : 0.6);
          this.onMandolin(vol, 293.66 * Math.pow(2, semi / 12));
        }
      } else this.noteT = 0;
    }

    // ── репліки: підійшов — заговорить (не частіше раз на 6 с, кожен — раз на хвилину) ──
    this.sayCd -= dt;
    if (this.sayCd <= 0) {
      for (const pp of this.people) {
        if (!pp.line || !pp.rig.root.visible) continue;
        const pr = pp.rig.root.position;
        const reach = pp.high ? 4.5 : 2.6;
        if (Math.hypot(cam.x - pr.x, cam.z - pr.z) > reach) continue;
        if (!pp.high && Math.abs(cam.y - pr.y - 1.5) > 2) continue;
        if (t - (this.said.get(pp) ?? -1e9) < 60) continue;
        this.said.set(pp, t);
        this.sayCd = 6;
        this.onSay?.(`💬 ${pp.line()}`);
        break;
      }
    }
  }
}

// ── геометрія гоцо: +Z — ніс; корпус звужується до носа й корми, дно вужче за палубу ──

function taperedBox(w: number, h: number, l: number, segZ: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, l, 1, 1, segZ);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const t = z / (l / 2);
    const k = t > 0 ? Math.max(0.08, Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.4)))) : Math.max(0.55, 1 - Math.pow(-t, 3) * 0.45);
    x *= k;
    if (y < 0) x *= 0.55;
    if (y > 0) y += Math.max(0, t) ** 2 * 0.28;
    pos.setXYZ(i, x, y, z);
  }
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

function gozzoHull(): THREE.BufferGeometry {
  const g = tinted(taperedBox(1.55, 0.6, 4.4, 8), 0xffffff);
  g.deleteAttribute('uv');
  return g;
}

function gozzoDetails(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, hex: number, m: THREE.Matrix4) => {
    const t = tinted(g.applyMatrix4(m), hex);
    t.deleteAttribute('uv');
    parts.push(t);
  };
  // дерев'яна «палуба»-днище всередині (трохи нижче борту) і білий планшир
  add(taperedBox(1.3, 0.04, 4.1, 8), 0x9a7a52, T(0, 0.29, 0));
  add(taperedBox(1.62, 0.07, 4.46, 8), 0xf2efe6, T(0, 0.33, 0));
  // банки-сидіння й форштевень
  for (const z of [-0.8, 0.6]) add(boxGeo(1.25, 0.06, 0.22), 0x7a5a3a, T(0, 0.42, z));
  add(boxGeo(0.08, 0.5, 0.1), 0x7a5a3a, T(0, 0.75, 2.2));
  // весла вздовж борту
  for (const s of [-1, 1]) add(boxGeo(0.06, 0.05, 2.6), 0xc9a36a, T(s * 0.42, 0.5, -0.2));
  return mergeGeometries(parts, false)!;
}
