import * as THREE from 'three';
import { T, boxGeo, cylGeo, type Batch } from './portKit';
import { siteToWorld, type PortSite } from './portSites';

// ─────────────────────────────────────────────────────────────
// Маленькі бухти континентів (portSites COVE): характер місця дешевою
// статикою на матеріалах гавані — все йде в спільний Batch (злиття за
// матеріалом), нових викликів малювання майже немає.
// Лазурове: каїки на піску, амфори, сітки; каплиця на скелі (Кала-дель-Соле),
// восьминоги на мотузці (Кала-Луче). Північ: сушарки з рибою, коптильня,
// стоси пасток, перекинутий човен; хижа на палях (Лососева хижа).
// ─────────────────────────────────────────────────────────────

type Mat = THREE.Material;

export interface CoveCtx {
  p: PortSite;
  batch: Batch;
  M: { [k: string]: Mat };
  /** висота суходолу гавані */
  H: (x: number, z: number) => number;
  rng: () => number;
}

export function isCove(p: PortSite): boolean {
  return p.id.startsWith('cove-');
}

export function buildCoveDecor(c: CoveCtx) {
  const { p, batch, M, H, rng } = c;
  const W = (a: number, b: number) => siteToWorld(p, a, b);
  const ryA = Math.atan2(p.ox, p.oz); // уздовж причалу (у море)
  const hw = p.plW / 2;
  /** точка на суші біля води збоку від плато (±b): пісок/камінь, не вода */
  const beach = (side: number, a: number, off: number): [number, number, number] | null => {
    for (let b = hw + off; b < hw + off + 24; b += 1) {
      const [x, z] = W(a, side * b);
      const y = H(x, z);
      if (y > 0.25 && y < 4) return [x, y, z];
    }
    return null;
  };

  if (p.style === 'med') {
    // каїки на піску: два-три кольорові човники, дном догори або на боці
    const hulls = [M.sdBlue, M.sdYellow, M.sdRed, M.sdGreen];
    for (let i = 0; i < 3; i++) {
      const at = beach(i % 2 ? 1 : -1, -2 - i * 2.4, 1 + i);
      if (!at) continue;
      const [x, y, z] = at;
      const r = ryA + (rng() - 0.5) * 0.8;
      batch.add(boxGeo(1.2, 0.45, 3.6), hulls[i % hulls.length], T(x, y + 0.22, z, r));
      batch.add(boxGeo(1.3, 0.08, 3.7), M.whitePaint, T(x, y + 0.48, z, r));
      batch.add(boxGeo(0.3, 0.5, 0.3), hulls[(i + 1) % hulls.length], T(x + Math.sin(r) * 1.7, y + 0.45, z + Math.cos(r) * 1.7, r));
    }
    // амфори й глечики біля скупки
    for (let i = 0; i < 4; i++) {
      const [x, z] = W(-6 - (i % 2) * 0.7, -hw + 2 + i * 0.75);
      const y = H(x, z);
      batch.add(cylGeo(0.18, 0.12, 0.7, 7), M.plOchre, T(x, y + 0.35, z));
      batch.add(cylGeo(0.07, 0.12, 0.18, 6), M.plOchre, T(x, y + 0.79, z));
    }
    // сітка на кілках
    {
      const [x, z] = W(-9, hw - 2);
      const y = H(x, z);
      for (const d of [-1.3, 1.3]) {
        const [px, pz] = W(-9 + d, hw - 2);
        batch.add(boxGeo(0.08, 1.6, 0.08), M.woodDark, T(px, H(px, pz) + 0.8, pz));
      }
      batch.add(boxGeo(2.6, 1.1, 0.03), M.rope, T(x, y + 1.0, z, ryA + Math.PI / 2));
    }
    if (p.id === 'cove-sole') {
      // каплиця на скелі над бухтою: біла коробочка, блакитний купол, дзвіничка
      const at = beach(1, -14, 6) ?? beach(-1, -14, 6);
      if (at) {
        const [x, y0, z] = at;
        const y = y0 + 1.6;
        batch.add(cylGeo(2.6, 3.4, 2.2, 8), M.stone, T(x, y0 + 0.5, z));
        batch.add(boxGeo(3.2, 2.8, 4.2), M.plWhite, T(x, y + 1.4, z, ryA));
        batch.add(new THREE.SphereGeometry(1.35, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.domeBlue, T(x, y + 2.8, z));
        batch.add(boxGeo(0.12, 0.9, 0.12), M.iron, T(x, y + 4.5, z));
        batch.add(boxGeo(0.55, 0.12, 0.12), M.iron, T(x, y + 4.7, z, ryA));
        const [dx, dz] = [Math.sin(ryA) * 2.15, Math.cos(ryA) * 2.15];
        batch.add(boxGeo(0.9, 1.6, 0.06), M.domeBlue, T(x + dx, y + 0.8, z + dz, ryA));
      }
    }
    if (p.id === 'cove-luce') {
      // восьминоги сушаться на мотузці між двома кілками
      const at = beach(-1, -3, 2);
      if (at) {
        const [x, y, z] = at;
        const rr = ryA + Math.PI / 2;
        const [ex, ez] = [Math.sin(rr) * 1.8, Math.cos(rr) * 1.8];
        batch.add(boxGeo(0.08, 1.9, 0.08), M.woodDark, T(x - ex, y + 0.95, z - ez));
        batch.add(boxGeo(0.08, 1.9, 0.08), M.woodDark, T(x + ex, y + 0.95, z + ez));
        batch.add(boxGeo(0.03, 0.03, 3.6), M.rope, T(x, y + 1.8, z, rr));
        for (let i = 0; i < 4; i++) {
          const k = -1.2 + i * 0.8;
          batch.add(cylGeo(0.18, 0.04, 0.6, 6), M.redPaint, T(x + Math.sin(rr) * k, y + 1.45, z + Math.cos(rr) * k));
        }
      }
    }
    return;
  }

  // ── Північ ──
  // сушарки з рибою
  for (let i = 0; i < 2; i++) {
    const at = beach(i ? 1 : -1, -4 - i * 3, 1);
    if (!at) continue;
    const [x, y, z] = at;
    const rr = ryA + Math.PI / 2;
    for (const d of [-1.4, 1.4]) batch.add(boxGeo(0.12, 1.9, 0.12), M.woodDark, T(x + Math.sin(rr) * d, y + 0.95, z + Math.cos(rr) * d));
    batch.add(boxGeo(0.08, 0.08, 3.0), M.woodGrey, T(x, y + 1.85, z, rr));
    for (let k = -1.1; k <= 1.1; k += 0.45) batch.add(boxGeo(0.05, 0.6, 0.18), M.bone, T(x + Math.sin(rr) * k, y + 1.5, z + Math.cos(rr) * k, rr));
  }
  // перекинутий човен і стос пасток
  {
    const at = beach(-1, -9, 3);
    if (at) {
      const [x, y, z] = at;
      batch.add(boxGeo(1.3, 0.5, 3.8), M.sdRed, T(x, y + 0.25, z, ryA + 0.4));
      batch.add(boxGeo(1.36, 0.08, 3.86), M.sdTar, T(x, y + 0.02, z, ryA + 0.4));
    }
    const [tx, tz] = W(-7, hw - 2.5);
    const ty = H(tx, tz);
    for (let i = 0; i < 5; i++) batch.add(boxGeo(0.9, 0.5, 0.65), M.rope, T(tx + (i % 3) * 0.2, ty + 0.25 + Math.floor(i / 3) * 0.5, tz + (i % 2) * 0.3, ryA + i * 0.2));
  }
  if (p.id === 'cove-smoke' || p.id === 'cove-fjord') {
    // коптильня: темна будка з кам'яним комином
    const [x, z] = W(-11, -hw - 3);
    const y = H(x, z);
    batch.add(boxGeo(2.6, 2.2, 2.2), M.sdTar, T(x, y + 1.1, z, ryA));
    batch.add(boxGeo(2.9, 0.18, 2.5), M.roofDark, T(x, y + 2.3, z, ryA));
    batch.add(boxGeo(0.6, 1.6, 0.6), M.stoneDark, T(x + 0.7, y + 2.8, z, ryA));
  }
  if (p.id === 'cove-salmon') {
    // хижа на палях над водою збоку від причалу
    const [x, z] = W(6, -hw - 6);
    const floor = 2.2;
    for (const da of [-1.6, 1.6]) for (const db of [-1.4, 1.4]) {
      const [px, pz] = W(6 + da, -hw - 6 + db);
      batch.add(cylGeo(0.13, 0.16, floor + 6, 6), M.woodDark, T(px, floor - (floor + 6) / 2, pz));
    }
    batch.add(boxGeo(4, 0.2, 3.6), M.deck, T(x, floor, z, ryA));
    batch.add(boxGeo(3.4, 2.3, 3.0), M.sdGrey, T(x, floor + 1.25, z, ryA));
    batch.add(boxGeo(3.8, 0.18, 3.5), M.roofDark, T(x, floor + 2.5, z, ryA));
    batch.add(boxGeo(0.9, 1.6, 0.06), M.sdRed, T(x - Math.sin(ryA + Math.PI / 2) * 1.52, floor + 0.9, z - Math.cos(ryA + Math.PI / 2) * 1.52, ryA + Math.PI / 2));
  }
}
