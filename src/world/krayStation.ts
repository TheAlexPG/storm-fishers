import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { L } from '../core/i18n';
import { Batch, T, boxGeo, cylGeo } from './portKit';
import { PORT_SITES, siteRect, siteToWorld, type PortSite } from './portSites';
import type { Platform, Solid } from './port';
import { buildCharacter, HAIRS, SKINS, type CharacterLook, type CharacterRig } from './character';

// ─────────────────────────────────────────────────────────────
// Китобійня «Край світу» — суворий форпост перед відкритим океаном
// (характер поверх загальної забудови ports.ts): порожній сліп із
// лебідкою, де колись витягали туші; салотопні котли на кам'яному
// вогнищі; штабелі бочок; стійка гарпунів; облуплена фарба складу;
// дощаний місток до «Останньої крамниці»; ребра кита, напівзасипані
// піском на західному пляжі; вимпел на щоглі, що рветься на вітрі.
// Мешканці: старий гарпунер з байками, бондар, кок і хаскі.
// Статика — у Batch гавані (злиття); живе — окрема група, лише поблизу.
// ─────────────────────────────────────────────────────────────

export const KRAY_ID = 'port-kray';

type Mat = THREE.Material;

/** контекст збірки, який дає ports.ts */
export interface KrayCtx {
  p: PortSite;
  g: THREE.Group;
  batch: Batch;
  M: { [k: string]: Mat };
  rng: () => number;
  H: (x: number, z: number) => number;
  platforms: Platform[];
  solids: Solid[];
  lampPost: (x: number, z: number, y0: number) => void;
  glow: (x: number, y: number, z: number, size: number) => void;
}

/** сліп: вісь уздовж a (у море), центр по b */
const SLIP = { b: 25.5, a0: -2.6, a1: 10, y1: -1.5, w: 4 };
/** салотопні котли перед складом */
const POTS = { a: -6.7, b: 5.2 };
/** вимпел на щоглі (захід) */
const MAST = { a: -2.6, b: -21 };
/** бондарня біля крамниці */
const COOPER = { a: -4.4, b: 16.2 };

export interface KrayPlan {
  /** верх щогли вимпела (світ) */
  mastTop: THREE.Vector3;
  /** звідки йде пара з котлів (світ) */
  steam: THREE.Vector3[];
  /** дим із труби салотопні (світ) */
  chimney: THREE.Vector3;
}

/** кілька частин одним мешем: колір — у вершинах (один матеріал, один виклик) */
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

/** статика китобійні — у Batch гавані; повертає точки для «живого» */
export function buildKrayStatic(c: KrayCtx): KrayPlan {
  const { p, batch, M, H, rng } = c;
  const W = (a: number, b: number) => siteToWorld(p, a, b);
  const Y = p.plY;
  const ry = Math.atan2(p.ox, p.oz); // локальний +Z → у море (+a)
  const rySide = ry - Math.PI / 2; // локальний +X → у море (+a)
  const solidC = (x: number, z: number, r: number) => c.solids.push({ x, z, r });
  const solidB = (a: number, b: number, da: number, db: number) => {
    const [x, z] = W(a, b);
    c.solids.push({ x, z, hw: (p.ox ? da : db) / 2, hd: (p.ox ? db : da) / 2, ry: 0 });
  };

  // ── сліп: похилий дощаний настил у воду, рейки, шпали, палі, лебідка й порожні санчата ──
  {
    const { a0, a1, y1, w } = SLIP;
    const len = a1 - a0, drop = Y - y1;
    const rx = Math.atan2(drop, len);
    const L2 = Math.hypot(len, drop);
    const [mx, mz] = W((a0 + a1) / 2, SLIP.b);
    const slope = T(mx, (Y + y1) / 2 - 0.12, mz, ry, rx);
    batch.add(boxGeo(w, 0.24, L2, 2, 6), M.deck, slope);
    // рейки й шпали — у локальних осях настилу
    for (const s of [-1, 1]) batch.add(boxGeo(0.14, 0.12, L2), M.iron, slope.clone().multiply(T(s * 0.95, 0.18, 0)));
    for (let k = -L2 / 2 + 0.6; k < L2 / 2; k += 1.25) batch.add(boxGeo(w + 0.3, 0.1, 0.22), M.woodDark, slope.clone().multiply(T(0, 0.15, k)));
    // палі під морською частиною
    for (let a = 1.5; a <= a1; a += 2.6) {
      const y = Y - ((a - a0) / len) * drop;
      for (const s of [-1, 1]) {
        const [px, pz] = W(a, SLIP.b + s * (w / 2 - 0.2));
        batch.add(cylGeo(0.16, 0.2, y + 3.5, 7), M.woodDark, T(px, (y - 3.5) / 2 - 0.1, pz));
      }
    }
    // лебідка на верху сліпу: дві стійки, барабан, ручка
    const [wx, wz] = W(a0 - 1.7, SLIP.b);
    for (const s of [-1, 1]) {
      const [sx, sz] = W(a0 - 1.7, SLIP.b + s * 0.9);
      batch.add(boxGeo(0.22, 1.3, 0.22), M.woodDark, T(sx, Y + 0.65, sz));
    }
    batch.add(cylGeo(0.32, 0.32, 1.5, 12), M.iron, T(wx, Y + 1.05, wz, 0, 0, Math.PI / 2));
    batch.add(cylGeo(0.34, 0.34, 1.0, 12, 1, true), M.rope, T(wx, Y + 1.05, wz, 0, 0, Math.PI / 2));
    batch.add(boxGeo(0.06, 0.6, 0.06), M.iron, T(wx + 0.85, Y + 1.25, wz));
    solidC(wx, wz, 1.1);
    // трос від барабана до санчат
    const ca = 1.2, cy = Y - ((ca - a0) / len) * drop + 0.4;
    const [cx, cz] = W(ca, SLIP.b);
    const dx = cx - wx, dz = cz - wz, dy = cy - (Y + 1.05);
    const cl = Math.hypot(dx, dy, dz);
    const cable = new THREE.Matrix4().lookAt(new THREE.Vector3(wx, Y + 1.05, wz), new THREE.Vector3(cx, cy, cz), new THREE.Vector3(0, 1, 0));
    cable.setPosition((wx + cx) / 2, (Y + 1.05 + cy) / 2, (wz + cz) / 2);
    batch.add(boxGeo(0.05, 0.05, cl), M.rope, cable);
    void dx; void dz; void dy;
    // порожні санчата (люлька для туші) — дерев'яні полози й поперечки
    for (const s of [-1, 1]) batch.add(boxGeo(0.25, 0.3, 3.4), M.deck, slope.clone().multiply(T(s * 1.2, 0.34, (ca - (a0 + a1) / 2) * (L2 / len))));
    for (const k of [-1.2, 0, 1.2]) batch.add(boxGeo(2.7, 0.18, 0.22), M.deck, slope.clone().multiply(T(0, 0.55, (ca - (a0 + a1) / 2) * (L2 / len) + k)));
    // штормовий ліхтар на голові сліпу
    const [lx, lz] = W(a0 - 0.4, SLIP.b + w / 2 + 0.6);
    c.lampPost(lx, lz, Y);
    solidC(lx, lz, 0.25);
  }

  // ── дощаний місток від краю набережної до крамниці й сліпу ──
  {
    const b0 = p.plW / 2 - 0.4, b1 = SLIP.b - SLIP.w / 2 - 0.2;
    const [mx, mz] = W(-2.4, (b0 + b1) / 2);
    batch.add(boxGeo(2.8, 0.14, b1 - b0, 2, 3), M.deck, T(mx, Y + 0.08, mz, rySide));
    for (let b = b0 + 0.6; b < b1; b += 1.6) {
      const [px, pz] = W(-1.05, b);
      batch.add(boxGeo(0.12, 0.6, 0.12), M.woodDark, T(px, Y + 0.38, pz));
    }
    const [rx, rz] = W(-1.05, (b0 + b1) / 2);
    batch.add(boxGeo(0.08, 0.08, b1 - b0), M.woodDark, T(rx, Y + 0.68, rz, rySide));
    c.platforms.push(siteRect(p, -3.8, -1.0, b0, b1, Y + 0.15));
    // поруччя не пускає з містка у воду
    const [qx, qz] = W(-0.95, (b0 + b1) / 2);
    c.solids.push({ x: qx, z: qz, hw: p.ox ? 0.12 : (b1 - b0) / 2, hd: p.ox ? (b1 - b0) / 2 : 0.12, ry: 0 });
  }

  // ── салотопні котли: кам'яне вогнище з двома чавунними казанами ──
  const steam: THREE.Vector3[] = [];
  {
    const [hx, hz] = W(POTS.a, POTS.b);
    batch.add(boxGeo(1.7, 1.0, 4.4, 1.5), M.stoneDark, T(hx, Y + 0.5, hz, rySide));
    batch.add(boxGeo(1.9, 0.14, 4.6, 1.5), M.stone, T(hx, Y + 1.05, hz, rySide));
    // топки (чорні отвори) з боку моря
    for (const db of [-1.1, 1.1]) {
      const [fx, fz] = W(POTS.a + 0.86, POTS.b + db);
      batch.add(boxGeo(0.7, 0.45, 0.04), M.iron, T(fx, Y + 0.38, fz, ry));
    }
    const bowl = new THREE.LatheGeometry([[0, -0.5], [0.42, -0.46], [0.62, -0.2], [0.68, 0.12], [0.72, 0.16], [0.7, 0.2], [0.62, 0.12], [0, 0.0]].map(([x, y]) => new THREE.Vector2(x, y)), 18);
    for (const db of [-1.1, 1.1]) {
      const [kx, kz] = W(POTS.a, POTS.b + db);
      batch.add(bowl, M.iron, T(kx, Y + 1.2, kz));
      steam.push(new THREE.Vector3(kx, Y + 1.45, kz));
    }
    // поруч — дрова й черпак
    for (let i = 0; i < 4; i++) {
      const [fx, fz] = W(POTS.a + 0.3 - (i % 2) * 0.35, POTS.b + 2.9 + 0.1 * i);
      batch.add(cylGeo(0.11, 0.11, 1.1, 6), M.trunk ?? M.woodDark, T(fx, Y + 0.12 + Math.floor(i / 2) * 0.2, fz, ry, 0, Math.PI / 2));
    }
    solidB(POTS.a, POTS.b, 1.9, 4.6);
  }

  // ── бочки: піраміда біля кореня причалу й ряд біля складу ──
  const barrel = (x: number, y: number, z: number, lying = false) => {
    const r = lying ? T(x, y + 0.36, z, ry + Math.PI / 2, 0, Math.PI / 2) : T(x, y + 0.47, z);
    batch.add(cylGeo(0.36, 0.36, 0.94, 10), M.woodDark, r);
    for (const hy of [-0.3, 0.3]) batch.add(cylGeo(0.375, 0.375, 0.07, 10, 1, true), M.iron, r.clone().multiply(T(0, hy, 0)));
    batch.add(cylGeo(0.33, 0.33, 0.02, 10), M.deck, r.clone().multiply(T(0, 0.47, 0)));
  };
  {
    // піраміда 3+2+1 лежачих
    const base = { a: -6.6, b: -2.8 };
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 3 - row; i++) {
        const [x, z] = W(base.a, base.b - 0.76 * (2 - row) / 2 + 0.76 * i - 0.76);
        barrel(x, Y + row * 0.64, z, true);
      }
    }
    solidB(base.a, base.b - 0.76, 1.2, 2.6);
    // стоячі бочки біля скупки
    for (const [a, b] of [[-4.6, -12.2], [-4.6, -11.4], [-3.9, -11.8], [-5.3, -11.8]] as const) {
      const [x, z] = W(a, b);
      barrel(x, Y, z);
      solidC(x, z, 0.38);
    }
  }

  // ── стійка гарпунів на краю набережної ──
  {
    const [rx, rz] = W(-2.3, 6.8);
    for (const db of [-0.95, 0.95]) {
      const [px, pz] = W(-2.3, 6.8 + db);
      batch.add(boxGeo(0.14, 1.9, 0.14), M.woodDark, T(px, Y + 0.95, pz));
    }
    batch.add(boxGeo(0.12, 0.12, 2.1), M.woodDark, T(rx, Y + 1.75, rz, rySide));
    batch.add(boxGeo(0.12, 0.12, 2.1), M.woodDark, T(rx, Y + 0.35, rz, rySide));
    for (let i = 0; i < 4; i++) {
      const [hx, hz] = W(-2.45, 6.05 + i * 0.5);
      const lean = -0.12;
      const m = T(hx, Y + 1.3, hz, ry, lean);
      batch.add(cylGeo(0.03, 0.03, 2.6, 6), M.woodDark, m);
      batch.add(new THREE.ConeGeometry(0.07, 0.42, 4), M.iron, m.clone().multiply(T(0, 1.5, 0)));
      batch.add(boxGeo(0.2, 0.05, 0.03), M.iron, m.clone().multiply(T(0, 1.32, 0)));
    }
    solidB(-2.3, 6.8, 0.5, 2.2);
  }

  // ── облуплена фарба на фасаді салотопні (лати світлого дерева й ґрунтовки) ──
  {
    const fa = -p.plD + 7 + 3.5 + 0.03; // фасад до моря
    const cb = p.plW / 2 - 9;
    for (let i = 0; i < 10; i++) {
      const b = cb - 4.4 + rng() * 8.8, y = Y + 0.8 + rng() * 3.4;
      if (Math.abs(b - (cb + 2)) < 1.0 && y < Y + 2.6) continue; // двері
      const [x, z] = W(fa, b);
      batch.add(boxGeo(0.3 + rng() * 0.9, 0.12 + rng() * 0.35, 0.02), i % 3 ? M.deck : M.bone, T(x, y, z, ry, 0, (rng() - 0.5) * 0.3));
    }
  }

  // ── бондарня: колода-пень, недороблена бочка, клепки, обручі ──
  {
    const [x, z] = W(COOPER.a - 0.9, COOPER.b + 0.6);
    batch.add(cylGeo(0.4, 0.45, 0.55, 9), M.woodDark, T(x, Y + 0.27, z));
    // остов бочки з клепок на пні
    for (let i = 0; i < 12; i++) {
      const an = (i / 12) * Math.PI * 2;
      batch.add(boxGeo(0.12, 0.85, 0.035), M.deck, T(x + Math.cos(an) * 0.3, Y + 0.97, z + Math.sin(an) * 0.3, -an + Math.PI / 2, 0, Math.cos(an) * 0.08));
    }
    batch.add(cylGeo(0.36, 0.36, 0.06, 12, 1, true), M.iron, T(x, Y + 0.72, z));
    // клепки, приперті до стіни, і готові бочки
    for (let i = 0; i < 6; i++) {
      const [sx, sz] = W(COOPER.a - 2.2, COOPER.b - 1.2 + i * 0.22);
      batch.add(boxGeo(0.12, 1.0, 0.035), M.deck, T(sx, Y + 0.03 + (i % 2) * 0.04, sz, ry, Math.PI / 2));
    }
    for (const [da, db] of [[-0.2, 1.8], [-0.95, 2.2]] as const) {
      const [bx, bz] = W(COOPER.a + da, COOPER.b + db);
      barrel(bx, Y, bz);
      solidC(bx, bz, 0.38);
    }
    for (let i = 0; i < 3; i++) {
      const [ox, oz] = W(COOPER.a - 2.25, COOPER.b + 1.0 + i * 0.12);
      batch.add(new THREE.TorusGeometry(0.36, 0.025, 4, 14), M.iron, T(ox, Y + 0.4, oz, ry, 0, 0));
    }
    solidC(x, z, 0.5);
  }

  // ── вимпел-щогла на заході набережної (сам вимпел — живий) ──
  const [mx, mz] = W(MAST.a, MAST.b);
  const mY = Math.max(H(mx, mz), Y - 0.3);
  batch.add(cylGeo(0.09, 0.14, 9.5, 8), M.whitePaint, T(mx, mY + 4.75, mz));
  batch.add(cylGeo(0.05, 0.05, 2.4, 6), M.whitePaint, T(mx, mY + 7.6, mz, 0, 0, Math.PI / 2));
  batch.add(cylGeo(0.4, 0.5, 0.4, 8), M.stoneDark, T(mx, mY + 0.2, mz));
  solidC(mx, mz, 0.5);
  const mastTop = new THREE.Vector3(mx, mY + 9.3, mz);

  // ── ребра кита на західному пляжі: напівзасипаний скелет (видно з моря) ──
  {
    const ca = 0.5, cb0 = -31.5;
    for (let i = 0; i < 6; i++) {
      const b = cb0 - i * 1.05;
      const [x, z] = W(ca, b);
      const y = H(x, z) - 0.25;
      const s = 1 - Math.abs(i - 2) * 0.12;
      for (const sd of [-1, 1]) {
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(sd * 1.7 * s, 0, 0), new THREE.Vector3(sd * 2.0 * s, 2.3 * s, 0), new THREE.Vector3(sd * 0.25, 3.2 * s, 0));
        batch.add(new THREE.TubeGeometry(curve, 8, 0.13, 5, false), M.bone, T(x, y, z, rySide, 0, sd * 0.1));
      }
      // хребці вздовж хребта
      batch.add(cylGeo(0.26, 0.26, 0.42, 7), M.bone, T(x, y + 0.05, z, rySide, 0, Math.PI / 2));
      solidC(x, z, 0.6);
    }
    // щелепа, що лежить на піску
    const [jx, jz] = W(-1.6, cb0 + 3.4);
    const jaw = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-2.2, 0, 0), new THREE.Vector3(0, 0.5, 0.9), new THREE.Vector3(2.2, 0, 0));
    batch.add(new THREE.TubeGeometry(jaw, 10, 0.16, 5, false), M.bone, T(jx, H(jx, jz) + 0.05, jz, ry + 0.4));
  }

  // ── дрібниці: якір під стіною, бухти тросу, ящики, будка хаскі ──
  {
    const [ax, az] = W(-6.4, 9.2);
    const am = T(ax, Y + 0.85, az, ry, -0.35);
    batch.add(boxGeo(0.14, 1.7, 0.14), M.iron, am);
    batch.add(new THREE.TorusGeometry(0.62, 0.08, 5, 12, Math.PI), M.iron, am.clone().multiply(T(0, -0.55, 0, 0, 0, Math.PI)));
    batch.add(boxGeo(1.2, 0.1, 0.1), M.iron, am.clone().multiply(T(0, 0.7, 0)));
    for (const [a, b] of [[-3.4, -6.2], [-3.2, 11.2], [-4.4, 17.4]] as const) {
      const [rx, rz] = W(a, b);
      batch.add(new THREE.TorusGeometry(0.34, 0.11, 6, 14), M.rope, T(rx, Y + 0.1, rz, 0, Math.PI / 2));
      batch.add(new THREE.TorusGeometry(0.24, 0.1, 6, 12), M.rope, T(rx, Y + 0.26, rz, 0, Math.PI / 2));
    }
    for (const [a, b, s, up] of [[-6.9, -1.95, 0.8, 0], [-7.7, -2.0, 0.78, 0], [-6.9, -1.95, 0.55, 0.56]] as const) {
      const [bx, bz] = W(a, b);
      batch.add(boxGeo(0.8 * s, 0.7 * s, 0.8 * s), M.deck, T(bx, Y + 0.35 * s + up, bz, rng() * 0.4));
    }
    solidB(-7.3, -2.0, 1.8, 0.9);
    // будка хаскі біля кухні
    const [kx, kz] = W(-7.8, 2.4);
    batch.add(boxGeo(1.1, 0.8, 1.2), M.woodDark, T(kx, Y + 0.4, kz, ry));
    batch.add(new THREE.ConeGeometry(0.95, 0.5, 4), M.metalRust, T(kx, Y + 1.05, kz, ry + Math.PI / 4, 0, 0, 1, 1, 1));
    batch.add(boxGeo(0.45, 0.5, 0.04), M.iron, T(kx, Y + 0.3, kz + p.oz * 0.61, ry));
    solidC(kx, kz, 0.75);
  }

  // ── тьмяні ліхтарі на стінах складів (уночі) ──
  for (const [a, b] of [[-7.45, 12.2], [-6.15, -9.4]] as const) {
    const [x, z] = W(a, b);
    batch.add(boxGeo(0.18, 0.26, 0.18), M.lamp, T(x, Y + 2.7, z), false);
    c.glow(x, Y + 2.7, z, 1.6);
  }

  const [chx, chz] = W(-p.plD + 5, p.plW / 2 - 5);
  return { mastTop, steam, chimney: new THREE.Vector3(chx, Y + 12.2, chz) };
}

// ───────────────────────── живе ─────────────────────────

type Pose = 'sit' | 'cooper' | 'stir';
interface Person {
  rig: CharacterRig;
  pose: Pose;
  phase: number;
  lines: string[];
  line: number;
  shadow: boolean;
}

export class KrayLife {
  readonly group = new THREE.Group();
  onSay: ((text: string) => void) | null = null;
  private people: Person[] = [];
  private pennant: THREE.Mesh;
  private penBase: Float32Array;
  private smokeGeo: THREE.BufferGeometry;
  private smokeSrc: Array<{ o: THREE.Vector3; big: boolean }> = [];
  private dog = new THREE.Group();
  private dogLegs: THREE.Bone[] = [];
  private dogTail!: THREE.Bone;
  private dogPath: THREE.Vector3[] = [];
  private dogK = 0;
  private dogSit = 0;
  private dogCur = new THREE.Vector3();
  private cx: number;
  private cz: number;
  private near = true;
  private peopleOn = true;
  private sayCd = 0;
  private dogSayCd = 0;
  private said = new Map<Person, number>();
  private shadowTick = 0;

  constructor(private c: KrayCtx, plan: KrayPlan) {
    const { p, rng } = c;
    const W = (a: number, b: number) => siteToWorld(p, a, b);
    const Y = p.plY;
    const ry = Math.atan2(p.ox, p.oz);
    [this.cx, this.cz] = W(-6, 2);

    // ── вимпел: довгий червоний трикутник, рветься на вітрі (один меш) ──
    {
      const seg = 8, len = 3.2;
      const pos: number[] = [];
      const top = plan.mastTop;
      for (let i = 0; i <= seg; i++) {
        const f = i / seg;
        const hh = 0.55 * (1 - f) + 0.02;
        pos.push(top.x + f * len, top.y, top.z, top.x + f * len, top.y - hh, top.z);
      }
      const idx: number[] = [];
      for (let i = 0; i < seg; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      this.penBase = new Float32Array(pos);
      this.pennant = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.8, side: THREE.DoubleSide }));
      this.pennant.frustumCulled = false;
      this.group.add(this.pennant);
    }

    // ── пара над котлами й дим із труби салотопні: одним Points ──
    {
      for (const s of plan.steam) this.smokeSrc.push({ o: s, big: false });
      this.smokeSrc.push({ o: plan.chimney, big: true });
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const x = cv.getContext('2d')!;
      const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, 'rgba(230,230,228,0.9)');
      gr.addColorStop(1, 'rgba(230,230,228,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, 64, 64);
      const n = this.smokeSrc.length * 4;
      this.smokeGeo = new THREE.BufferGeometry();
      this.smokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      this.smokeGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.9), 4));
      const pts = new THREE.Points(this.smokeGeo, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(cv), size: 2.0, sizeAttenuation: true, transparent: true, depthWrite: false, vertexColors: true }));
      pts.frustumCulled = false;
      this.group.add(pts);
    }

    // ── мешканці ──
    const person = (look: CharacterLook): CharacterRig => {
      const r = buildCharacter(look, { coarse: true });
      this.group.add(r.root);
      return r;
    };
    const add = (rig: CharacterRig, a: number, b: number, face: number, pose: Pose, lines: string[]) => {
      const [x, z] = W(a, b);
      rig.root.position.set(x, Y, z);
      rig.root.rotation.y = face;
      if (pose === 'sit') {
        rig.legL.rotation.set(-Math.PI / 2 + 0.25, -0.12, 0);
        rig.legR.rotation.set(-Math.PI / 2 + 0.25, 0.12, 0);
        rig.kneeL.rotation.x = rig.kneeR.rotation.x = Math.PI / 2 - 0.15;
        rig.root.position.y = Y + 0.95 - 0.9 + 0.02;
      }
      c.solids.push({ x, z, r: 0.35 });
      this.people.push({ rig, pose, phase: rng() * 10, lines, line: Math.floor(rng() * lines.length), shadow: true });
    };
    const sea = ry;
    // старий гарпунер сидить на бочці біля котлів, обличчям до моря
    {
      const [bx, bz] = W(-5.2, 2.6);
      const seat = new THREE.Mesh(painted([[cylGeo(0.36, 0.36, 0.94, 10), 0x5a4330, T(0, 0.47, 0)], [cylGeo(0.375, 0.375, 0.07, 10, 1, true), 0x24292d, T(0, 0.17, 0)], [cylGeo(0.375, 0.375, 0.07, 10, 1, true), 0x24292d, T(0, 0.77, 0)]]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
      seat.position.set(bx, Y, bz);
      this.group.add(seat);
      const r = person({ jacket: 0x2f3a46, jacketKind: 'coat', pants: 0x3a3a44, hat: 'beanie', hatColor: 0x6b2a24, skin: SKINS[1], hair: 'short', hairColor: HAIRS[6], beard: 'full', brow: -0.25, boots: 0x2b2b2b, scarf: 0x9a8a6a, width: 1.08 });
      add(r, -5.2, 2.6, sea, 'sit', [
        L('Я — Сава, останній гарпунер «Краю світу». Сорок зим ходив за китом, тепер кит ходить мені уві сні — і я вже не гонюся.', `I'm Sava, the last harpooner of World's End. Forty winters I chased whales; now they visit my dreams — and I don't give chase any more.`),
        L('За тим обрієм — тільки вода. Тиждень ходу, і жодного вогника. Бери провізії більше, ніж здається.', `Past that horizon there's only water. A week's sailing without a single light. Take more provisions than you think.`),
        L('Бачив раз хвилю вищу за маяк. Вона пройшла під нами, як кит під човном. Носом до неї тримай, синку.', `Once I saw a wave taller than the lighthouse. It rolled under us like a whale under a dinghy. Keep your bow to it, lad.`),
        L('Китів тут більше не б\'ють — і слава Богу. А котли лишились: тепер у них Марія юшку варить.', `Nobody hunts whales here any more — thank God. The pots stayed, though: now Maria cooks chowder in them.`),
        L('Коли вимпел на щоглі стоїть рівно, як дошка, — сиди в гавані. Таке море не пробачає.', `When the pennant on the mast stands out stiff as a plank — stay in harbour. That sea doesn't forgive.`),
      ]);
    }
    // бондар з молотком біля недоробленої бочки
    add(person({ jacket: 0x7a5232, jacketKind: 'knit', pants: 0x2f3038, hat: 'cap', hatColor: 0x3a3a44, skin: SKINS[2], hair: 'short', hairColor: HAIRS[2], beard: 'mustache', apron: 0x5a4330, gloves: 0x4a3a2a, boots: 0x3a2a20 }), COOPER.a, COOPER.b + 0.6, ry + Math.PI / 2 + 0.3, 'cooper', [
      L('Бочка — як корабель: одна погана клепка, і все тече.', `A barrel's like a ship: one bad stave and the whole thing leaks.`),
      L('Обручі набиваю з досвітку. Китобоїв нема, а бочки потрібні — рибу солити, воду возити.', `I've been driving hoops since dawn. The whalers are gone, but barrels are still needed — for salting fish, for water.`),
      L('В «Останній крамниці» провізія в моїх бочках. Не протече до самого кінця світу.', `The Last Store keeps its provisions in my barrels. They won't leak all the way to the world's end.`),
    ]);
    // кок мішає юшку в казані
    add(person({ jacket: 0xe8e2d6, jacketKind: 'knit', pants: 0x3a3a44, hat: 'beanie', hatColor: 0x2f5f8a, skin: SKINS[0], hair: 'bun', hairColor: HAIRS[3], apron: 0xf2efe6, brow: 0.35, boots: 0x3a3a44, width: 1.05 }), POTS.a + 1.35, POTS.b + 1.1, ry + Math.PI, 'stir', [
      L('Юшка з тріски на салотопному котлі — найгарячіша на всьому узбережжі!', `Cod chowder from a try-pot — the hottest on the whole coast!`),
      L('Перед океаном поїж гарячого. Там, у шторм, не до кухні буде.', `Eat something hot before the ocean. Out there, in a storm, you won't be cooking.`),
      L('Хаскі звати Ведмідь. Не бійся — він лиже, а не кусає.', `The husky's name is Bear. Don't worry — he licks, he doesn't bite.`),
    ]);
    // весло в казані в руках кока
    {
      const ladle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5), c.M.woodDark as THREE.Material);
      ladle.position.set(0, -0.55, 0.35);
      ladle.rotation.x = 0.9;
      this.people[this.people.length - 1].rig.armR.add(ladle);
    }
    // дрібні фігурки — без тіні далеко (вмикаємо поблизу)

    // ── хаскі Ведмідь: один SkinnedMesh (тулуб+голова, 4 лапи, хвіст бубликом) ──
    {
      const FUR = 0x8e959c, WHITE = 0xeeeae2, DARK = 0x2e3236;
      const hd = (x: number, y: number, z: number, rz = 0) => T(x, y + 0.62, z + 0.38, 0, 0, rz);
      const LEG = [[-0.1, 0.24], [0.1, 0.24], [-0.1, -0.24], [0.1, -0.24]] as const;
      const parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4, number]> = [
        [boxGeo(0.3, 0.28, 0.68), FUR, T(0, 0.45, 0), 0],
        [boxGeo(0.26, 0.12, 0.6), WHITE, T(0, 0.33, 0.02), 0],
        [boxGeo(0.26, 0.24, 0.27), FUR, hd(0, 0, 0.03), 0],
        [boxGeo(0.14, 0.1, 0.17), WHITE, hd(0, -0.05, 0.22), 0],
        [boxGeo(0.05, 0.05, 0.04), DARK, hd(0, -0.02, 0.31), 0],
        [new THREE.ConeGeometry(0.06, 0.16, 4), FUR, hd(-0.08, 0.17, -0.03), 0],
        [new THREE.ConeGeometry(0.06, 0.16, 4), FUR, hd(0.08, 0.17, -0.03), 0],
        ...LEG.map(([lx, lz], i): [THREE.BufferGeometry, number, THREE.Matrix4, number] => [boxGeo(0.08, 0.34, 0.08), i < 2 ? WHITE : FUR, T(lx, 0.17, lz), 1 + i]),
        [new THREE.TorusGeometry(0.11, 0.05, 5, 8, Math.PI * 1.4), FUR, T(0, 0.68, -0.38, Math.PI / 2, 0, 0.3), 5],
      ];
      const geo = painted(parts.map(([g0, c0, m]) => [g0, c0, m]));
      const n = geo.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      let v = 0;
      for (const [g0, , , bone] of parts) {
        const cnt = g0.index ? g0.index.count : g0.attributes.position.count;
        for (let i = 0; i < cnt; i++, v++) { si[v * 4] = bone; sw[v * 4] = 1; }
      }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      const rootBone = new THREE.Bone();
      this.dogLegs = LEG.map(([lx, lz]) => {
        const b = new THREE.Bone();
        b.position.set(lx, 0.34, lz);
        rootBone.add(b);
        return b;
      });
      this.dogTail = new THREE.Bone();
      this.dogTail.position.set(0, 0.6, -0.34);
      rootBone.add(this.dogTail);
      const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
      mesh.add(rootBone);
      mesh.bind(new THREE.Skeleton([rootBone, ...this.dogLegs, this.dogTail]));
      mesh.frustumCulled = false;
      this.dog.add(mesh);
      this.group.add(this.dog);
      for (const [a, b] of [[-3.6, -9], [-3.2, 3.5], [-3.0, 9.6], [-3.4, 15], [-2.6, 21], [-3.0, 9.6], [-3.6, 3], [-4.0, -14]] as const) {
        const [x, z] = W(a, b);
        this.dogPath.push(new THREE.Vector3(x, Y + (b > p.plW / 2 ? 0.15 : 0), z));
      }
      this.dogCur.copy(this.dogPath[0]);
      this.dog.position.copy(this.dogCur);
    }

    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.receiveShadow = true;
        o.castShadow = false;
      }
    });
    for (const pp of this.people) pp.shadow = false;
  }

  /** кожен кадр, поки гавань видно (ports.ts) */
  update(dt: number, t: number, cam: THREE.Vector3, night: number) {
    const d = Math.hypot(cam.x - this.cx, cam.z - this.cz);
    // далі ~250 м — нічого живого не видно (ports.ts поважає userData.hide)
    const near = this.near ? d < 260 : d < 240;
    if (near !== this.near) {
      this.near = near;
      this.group.userData.hide = !near;
      this.group.visible = near;
    }
    if (!near) return;

    // ── вимпел: що сильніше хвилюється, то далі від щогли ──
    {
      const pos = this.pennant.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array, b0 = this.penBase;
      const n = a.length / 6;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const w = Math.sin(t * 7 - f * 5) * 0.35 * f + Math.sin(t * 11.3 - f * 9) * 0.08 * f;
        for (const k of [0, 3]) {
          const o = i * 6 + k;
          a[o] = b0[o];
          a[o + 1] = b0[o + 1] + Math.sin(t * 5 - f * 4) * 0.06 * f;
          a[o + 2] = b0[o + 2] + w;
        }
      }
      pos.needsUpdate = true;
      this.pennant.geometry.computeVertexNormals();
    }

    // ── пара й дим ──
    {
      const pa = this.smokeGeo.attributes.position as THREE.BufferAttribute;
      const ca = this.smokeGeo.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const s = this.smokeSrc[Math.floor(i / 4)], ph = (i % 4) / 4;
        const k = (t * (s.big ? 0.09 : 0.16) + ph) % 1;
        const rise = s.big ? 5 : 1.6;
        pa.setXYZ(i, s.o.x + k * (s.big ? 2.4 : 0.4) + Math.sin(t + ph * 6) * 0.15, s.o.y + k * rise, s.o.z - k * (s.big ? 1.2 : 0.2));
        ca.setW(i, Math.sin(k * Math.PI) * ((s.big ? 0.45 : 0.3) - night * 0.15));
      }
      pa.needsUpdate = true;
      ca.needsUpdate = true;
    }

    // люди й пес — лише зблизька (з гістерезисом)
    const show = this.peopleOn ? d < 75 : d < 65;
    if (show !== this.peopleOn) {
      this.peopleOn = show;
      for (const pp of this.people) pp.rig.root.visible = show;
      this.dog.visible = show;
    }
    if (!show) return;
    // тінь — лише тим, хто поруч з камерою
    if ((this.shadowTick -= dt) <= 0) {
      this.shadowTick = 0.5;
      for (const pp of this.people) {
        const q = pp.rig.root.position;
        const want = Math.hypot(cam.x - q.x, cam.z - q.z) < 18;
        if (want === pp.shadow) continue;
        pp.shadow = want;
        pp.rig.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = want; });
      }
    }

    for (const pp of this.people) {
      const r = pp.rig;
      const br = Math.sin(t * 1.3 + pp.phase);
      r.torso.scale.y = 1 + br * 0.008;
      if (pp.pose === 'sit') {
        // розповідає: голова повільно водить, рука жестикулює
        r.head.rotation.y = Math.sin(t * 0.3 + pp.phase) * 0.45;
        const gest = Math.max(0, Math.sin(t * 0.35 + pp.phase) - 0.5) * 2;
        r.armL.rotation.set(-0.55, 0, -0.1);
        r.armR.rotation.set(-0.55 - gest * 0.7, 0, 0.1 + gest * 0.3);
      } else if (pp.pose === 'cooper') {
        // б'є молотком по обручу: різкий удар, повільний замах
        const k = (t * 1.25 + pp.phase) % 1;
        const swing = k < 0.75 ? -1.9 * (k / 0.75) : -1.9 + 1.9 * ((k - 0.75) / 0.25);
        r.armR.rotation.set(swing, 0, 0.15);
        r.armL.rotation.set(-0.7, 0, -0.2);
        r.head.rotation.x = 0.35;
        r.body.rotation.x = 0.12;
      } else {
        // мішає в казані колом
        const ang = t * 1.6 + pp.phase;
        r.armR.rotation.set(-0.9 + Math.sin(ang) * 0.18, Math.cos(ang) * 0.2, 0.1);
        r.armL.rotation.set(-0.8 + Math.sin(ang) * 0.12, 0, -0.1);
        r.head.rotation.x = 0.3;
      }
    }

    // ── хаскі: біжить уздовж набережної, сідає, хвіст бубликом ходить ──
    this.dogTail.rotation.z = Math.sin(t * 8) * 0.35;
    if (this.dogSit > 0) {
      this.dogSit -= dt;
      for (const l of this.dogLegs) l.rotation.x = 0;
      this.dog.rotation.x = -0.25;
      this.dog.position.y = this.dogCur.y - 0.06;
    } else {
      this.dog.rotation.x = 0;
      const tgt = this.dogPath[this.dogK];
      const dx = tgt.x - this.dogCur.x, dz = tgt.z - this.dogCur.z;
      const dd = Math.hypot(dx, dz);
      if (dd < 0.3) {
        this.dogK = (this.dogK + 1) % this.dogPath.length;
        if (Math.random() < 0.55) this.dogSit = 2 + Math.random() * 5;
      } else {
        const sp = 1.7 * dt;
        this.dogCur.x += (dx / dd) * Math.min(sp, dd);
        this.dogCur.z += (dz / dd) * Math.min(sp, dd);
        this.dogCur.y += (tgt.y - this.dogCur.y) * Math.min(1, dt * 4);
        this.dog.position.copy(this.dogCur);
        this.dog.rotation.y = Math.atan2(dx, dz);
        const sw = Math.sin(t * 12);
        this.dogLegs[0].rotation.x = this.dogLegs[3].rotation.x = sw * 0.6;
        this.dogLegs[1].rotation.x = this.dogLegs[2].rotation.x = -sw * 0.6;
      }
    }

    // ── репліки: підійшов — мешканець заговорить (не частіше раз на 6 с, кожен — раз на хвилину) ──
    this.sayCd -= dt;
    this.dogSayCd -= dt;
    const dp = this.dog.position;
    if (this.dogSayCd <= 0 && Math.hypot(cam.x - dp.x, cam.z - dp.z) < 1.6) {
      this.dogSayCd = 45;
      this.onSay?.(L('🐕 Ведмідь виляє хвостом-бубликом і тицяється носом у долоню.', `🐕 Bear wags his curly tail and nudges your hand with his nose.`));
    }
    if (this.sayCd > 0 || d > 60) return;
    for (const pp of this.people) {
      const pr = pp.rig.root.position;
      if (Math.hypot(cam.x - pr.x, cam.z - pr.z) > 2.6 || Math.abs(cam.y - pr.y - 1.5) > 2) continue;
      if (t - (this.said.get(pp) ?? -1e9) < 60) continue;
      this.said.set(pp, t);
      this.sayCd = 6;
      pp.line = (pp.line + 1) % pp.lines.length;
      this.onSay?.(`💬 ${pp.lines[pp.line]}`);
      break;
    }
  }
}

/** туман біля «Краю світу»: 1 — у гавані … 0 — далі ~650 м (main.fogDensity) */
const KRAY = PORT_SITES.find((s) => s.id === KRAY_ID)!;
export function krayFog(x: number, z: number): number {
  const d = Math.hypot(x - KRAY.x, z - KRAY.z);
  return d < 260 ? 1 : d > 650 ? 0 : 1 - (d - 260) / 390;
}
