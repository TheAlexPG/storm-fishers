import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math';

// ─────────────────────────────────────────────────────────────
// Спільний будівник персонажів (гравці + мешканці порту).
// Кремезні рибалки: округлий тулуб-дощовик, великі руки-рукавиці,
// гумові чоботи з відворотами, обличчя з носом-картоплинкою, бровами,
// рум'янцем; варіанти бороди, вусів, окулярів, зачісок і шапок.
//
// Скелет (лице — у +Z, ноги на y=0 кореня):
//   root → body → legL/legR (стегно, y=0.9) → kneeL/kneeR (y=−0.45)
//               → torso (y=0.9) → armL/armR (плече, y=0.62; кисть на −0.6)
//                               → head (шия, y=0.7)
// Частини одного матеріалу в межах однієї кістки зливаються в один меш —
// ~20 викликів малювання на персонажа.
// ─────────────────────────────────────────────────────────────

export type HatKind = 'sou' | 'cap' | 'beanie' | 'captain' | 'bucket' | 'ushanka' | 'straw' | 'tricorn' | 'crown' | 'none';
export type HairKind = 'short' | 'bun' | 'bald' | 'long' | 'buzz';
export type BeardKind = 'none' | 'full' | 'mustache' | 'goatee';
export type JacketKind = 'rain' | 'knit' | 'coat';

export interface CharacterLook {
  jacket: number;
  pants: number;
  jacketKind?: JacketKind;
  hat?: HatKind;
  hatColor?: number;
  /** другий колір шапки (помпон, кокарда, стрічка) */
  hatAccent?: number;
  skin?: number;
  hair?: HairKind;
  hairColor?: number;
  beard?: BeardKind;
  glasses?: boolean;
  /** брови: + добрі (зовнішні кінці вниз), − суворі */
  brow?: number;
  apron?: number;
  /** комбінезон-напівкомбінезон (колір) — замість штанів */
  bib?: number;
  vest?: boolean;
  scarf?: number;
  backpack?: number;
  gloves?: number;
  boots?: number;
  bootCuff?: number;
  /** світловідбивні смуги на дощовику */
  stripes?: boolean;
  /** ширина тулуба 0.9…1.15 */
  width?: number;
  belly?: boolean;
}

export interface CharacterRig {
  root: THREE.Group;
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** трикутників у моделі (для контролю бюджету) */
  tris: number;
}

export const SKINS = [0xf3cfb0, 0xe8b994, 0xd9a07a, 0xbf845d, 0x9a6444, 0x74482f];
export const HAIRS = [0x2b1d14, 0x4a3022, 0x7a5232, 0xb98a4e, 0xd9c6a0, 0x8e8a86, 0xe9e5dd, 0xa8452a];
const BOOTS = [0x2a2826, 0x2f4a33, 0xf2c12e, 0x283b5c, 0xb8362c];

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

type Xf = { rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number; s?: number };

class Parts {
  private buckets = new Map<THREE.Object3D, Map<THREE.Material, THREE.BufferGeometry[]>>();
  private mats = new Map<string, THREE.MeshStandardMaterial>();

  mat(color: number, rough = 0.8, metal = 0): THREE.MeshStandardMaterial {
    const k = `${color}|${rough}|${metal}`;
    let m = this.mats.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
      this.mats.set(k, m);
    }
    return m;
  }

  add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, xf: Xf = {}) {
    tmpE.set(xf.rx ?? 0, xf.ry ?? 0, xf.rz ?? 0);
    tmpQ.setFromEuler(tmpE);
    const s = xf.s ?? 1;
    tmpS.set((xf.sx ?? 1) * s, (xf.sy ?? 1) * s, (xf.sz ?? 1) * s);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS);
    geo.applyMatrix4(tmpM);
    let b = this.buckets.get(parent);
    if (!b) this.buckets.set(parent, (b = new Map()));
    let list = b.get(mat);
    if (!list) b.set(mat, (list = []));
    list.push(geo);
  }

  finish(): number {
    let tris = 0;
    for (const [parent, b] of this.buckets) {
      for (const [mat, list] of b) {
        const anyNon = list.some((g) => !g.index);
        const src = anyNon ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list;
        for (const g of src) {
          // однаковий набір атрибутів для злиття
          for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
          if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
        }
        const merged = src.length === 1 ? src[0] : mergeGeometries(src, false)!;
        if (src.length > 1) for (const g of src) g.dispose();
        merged.computeBoundingSphere();
        tris += merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3;
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = true;
        parent.add(mesh);
      }
    }
    return tris;
  }
}

function shade(c: number, k: number): number {
  const col = new THREE.Color(c);
  col.multiplyScalar(k);
  col.r = Math.min(1, col.r);
  col.g = Math.min(1, col.g);
  col.b = Math.min(1, col.b);
  return col.getHex();
}

function mix(a: number, b: number, t: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

const V = (x: number, y: number) => new THREE.Vector2(x, y);

/** профіль тулуба-дощовика (обертання навколо Y) */
function jacketProfile(kind: JacketKind): THREE.Vector2[] {
  const hem = kind === 'coat' ? -0.22 : kind === 'rain' ? -0.12 : -0.04;
  const flare = kind === 'coat' ? 0.245 : 0.222;
  return [
    V(0, hem + 0.04),
    V(flare - 0.012, hem),
    V(flare, hem + 0.02),
    V(0.226, 0.06),
    V(0.234, 0.24),
    V(0.23, 0.42),
    V(0.21, 0.54),
    V(0.15, 0.62),
    V(0.075, 0.66),
    V(0, 0.665),
  ];
}

export function buildCharacter(look: CharacterLook): CharacterRig {
  const P = new Parts();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const W = look.width ?? 1;
  const kind = look.jacketKind ?? 'rain';
  const skinC = look.skin ?? SKINS[1];
  const hairC = look.hairColor ?? HAIRS[1];
  const jRough = kind === 'rain' ? 0.42 : kind === 'knit' ? 0.95 : 0.8;
  const jacket = P.mat(look.jacket, jRough);
  const jacketDark = P.mat(shade(look.jacket, 0.78), jRough);
  const pantsC = look.bib ?? look.pants;
  const pants = P.mat(pantsC, 0.85);
  const skin = P.mat(skinC, 0.62);
  const hair = P.mat(hairC, 0.9);
  const bootC = look.boots ?? BOOTS[0];
  const boot = P.mat(bootC, 0.38);
  const bootCuff = P.mat(look.bootCuff ?? shade(bootC, 1.35), 0.6);
  const sole = P.mat(0x1d1b1a, 0.7);
  const handM = look.gloves != null ? P.mat(look.gloves, 0.6) : skin;
  const dark = P.mat(0x231f1d, 0.35);
  const white = P.mat(0xffffff, 0.3);
  const refl = P.mat(0xe9ecdf, 0.25, 0.1);

  // ── ноги ──
  const mkLeg = (sx: number) => {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.105, 0.9, 0);
    body.add(leg);
    P.add(leg, new THREE.CapsuleGeometry(0.092, 0.3, 2, 8), pants, 0, -0.2, 0);
    const knee = new THREE.Group();
    knee.position.y = -0.45;
    leg.add(knee);
    P.add(knee, new THREE.CapsuleGeometry(0.08, 0.16, 1, 6), pants, 0, -0.08, 0);
    // гумовий чобіт: халява, відворот, носок, підошва
    P.add(knee, new THREE.CylinderGeometry(0.1, 0.092, 0.3, 10, 1, true), boot, 0, -0.27, 0.005);
    P.add(knee, new THREE.CylinderGeometry(0.118, 0.112, 0.07, 10, 1, true), bootCuff, 0, -0.13, 0.005);
    P.add(knee, new THREE.CylinderGeometry(0.118, 0.1, 0.012, 10, 1, true), bootCuff, 0, -0.095, 0.005);
    P.add(knee, new THREE.SphereGeometry(0.1, 8, 4), boot, 0, -0.395, 0.06, { sx: 1, sy: 0.55, sz: 1.65 });
    P.add(knee, new THREE.BoxGeometry(0.2, 0.035, 0.33), sole, 0, -0.432, 0.06);
    return { leg, knee };
  };
  const L = mkLeg(-1);
  const R = mkLeg(1);

  // ── тулуб ──
  const torso = new THREE.Group();
  torso.position.y = 0.9;
  body.add(torso);
  P.add(torso, new THREE.SphereGeometry(0.205, 8, 4), pants, 0, 0.02, 0, { sx: W, sy: 0.55, sz: 0.8 });
  P.add(torso, new THREE.LatheGeometry(jacketProfile(kind), 13), jacket, 0, 0, 0, { sx: W, sz: 0.8 });
  const fz = (r: number) => r * 0.8; // передня поверхня на радіусі профілю
  if (look.belly) P.add(torso, new THREE.SphereGeometry(0.2, 11, 8), jacket, 0, 0.16, 0.06, { sx: W * 0.95, sy: 0.9, sz: 0.62 });
  const front = fz(0.232) + (look.belly ? 0.045 : 0);

  if (kind === 'rain') {
    // каптур на спині, комір-стійка, блискавка, кишені з клапанами
    P.add(torso, new THREE.SphereGeometry(0.13, 8, 5), jacketDark, 0, 0.58, -0.12, { sx: 1.15 * W, sy: 0.72, sz: 0.75 });
    P.add(torso, new THREE.CylinderGeometry(0.105, 0.12, 0.09, 12, 1, true), jacket, 0, 0.665, 0.005, { sz: 0.92 });
    if (!look.belly) {
      P.add(torso, new THREE.BoxGeometry(0.016, 0.5, 0.012), dark, 0, 0.17, front - 0.002);
      for (const s of [-1, 1]) {
        P.add(torso, new THREE.BoxGeometry(0.11, 0.085, 0.022), jacketDark, s * 0.105 * W, 0.04, front - 0.022, { ry: s * 0.42 });
        P.add(torso, new THREE.BoxGeometry(0.12, 0.03, 0.03), jacket, s * 0.105 * W, 0.09, front - 0.018, { ry: s * 0.42 });
      }
    }
    if (look.stripes !== false) {
      P.add(torso, new THREE.CylinderGeometry(0.238, 0.236, 0.045, 14, 1, true), refl, 0, 0.13, 0, { sx: W, sz: 0.8 });
    }
  } else if (kind === 'knit') {
    // светр: рубчастий комір-горло й манжет на поясі
    P.add(torso, new THREE.TorusGeometry(0.085, 0.04, 6, 12), jacketDark, 0, 0.665, 0, { rx: Math.PI / 2 });
    P.add(torso, new THREE.CylinderGeometry(0.228, 0.226, 0.07, 14, 1, true), jacketDark, 0, -0.01, 0, { sx: W, sz: 0.8 });
    // смуга-візерунок на грудях
    P.add(torso, new THREE.CylinderGeometry(0.236, 0.236, 0.05, 14, 1, true), P.mat(mix(look.jacket, 0xf2ead8, 0.65), 0.95), 0, 0.36, 0, { sx: W, sz: 0.8 });
  } else {
    // пальто/бушлат: відкладний комір, два ряди ґудзиків
    for (const s of [-1, 1]) {
      P.add(torso, new THREE.BoxGeometry(0.075, 0.13, 0.016), jacketDark, s * 0.065, 0.5, fz(0.226) - 0.004, { rx: -0.3, rz: s * 0.4 });
      for (let i = 0; i < 3; i++) P.add(torso, new THREE.SphereGeometry(0.014, 6, 4), P.mat(0xc9a24a, 0.35, 0.6), s * 0.055, 0.42 - i * 0.13, front, { sz: 0.6 });
    }
    P.add(torso, new THREE.CylinderGeometry(0.236, 0.232, 0.05, 14, 1, true), jacketDark, 0, 0.02, 0, { sx: W, sz: 0.8 });
    P.add(torso, new THREE.CylinderGeometry(0.1, 0.125, 0.08, 12, 1, true), jacketDark, 0, 0.66, 0, { sz: 0.92 });
  }

  if (look.bib != null) {
    // напівкомбінезон: нагрудник, лямки з ґудзиками
    const bibM = P.mat(look.bib, 0.85);
    P.add(torso, new THREE.LatheGeometry([V(0.244, -0.14), V(0.246, 0.1), V(0.243, 0.3)], 8, -0.62, 1.24), bibM, 0, 0, 0, { sx: W, sz: 0.82 });
    P.add(torso, new THREE.BoxGeometry(0.1, 0.06, 0.02), P.mat(shade(look.bib, 0.8), 0.85), 0, 0.2, fz(0.246) + 0.01);
    for (const s of [-1, 1]) {
      P.add(torso, new THREE.BoxGeometry(0.045, 0.34, 0.025), bibM, s * 0.085, 0.45, fz(0.226) + 0.004, { rx: -0.22 });
      P.add(torso, new THREE.SphereGeometry(0.016, 6, 4), P.mat(0xc9a24a, 0.35, 0.6), s * 0.085, 0.31, fz(0.246) + 0.012);
    }
  }
  if (look.apron != null) {
    const ap = P.mat(look.apron, 0.9);
    P.add(torso, new THREE.LatheGeometry([V(0.25, -0.42), V(0.248, -0.1), V(0.244, 0.15), V(0.236, 0.4)], 8, -0.75, 1.5), ap, 0, 0, 0, { sx: W, sz: 0.84 });
    P.add(torso, new THREE.BoxGeometry(0.03, 0.3, 0.02), ap, 0, 0.53, fz(0.2) + 0.01, { rx: -0.35 });
    P.add(torso, new THREE.BoxGeometry(0.14, 0.09, 0.015), P.mat(shade(look.apron, 0.85), 0.9), 0.06, -0.08, fz(0.25) + 0.012);
  }
  if (look.vest) {
    // рятувальний жилет: дутий помаранчевий з чорними пряжками
    const or = P.mat(0xf0661c, 0.5);
    P.add(torso, new THREE.LatheGeometry([V(0.215, -0.02), V(0.258, 0.02), V(0.262, 0.24), V(0.25, 0.44), V(0.2, 0.52)], 14), or, 0, 0, 0, { sx: W, sz: 0.82 });
    for (const y of [0.1, 0.28]) P.add(torso, new THREE.BoxGeometry(0.07, 0.035, 0.03), dark, 0, y, fz(0.262) + 0.012);
    P.add(torso, new THREE.CylinderGeometry(0.265, 0.265, 0.03, 14, 1, true), refl, 0, 0.36, 0, { sx: W, sz: 0.83 });
  }
  if (look.scarf != null) {
    const sc = P.mat(look.scarf, 0.95);
    P.add(torso, new THREE.TorusGeometry(0.1, 0.05, 6, 12), sc, 0, 0.64, 0.005, { rx: Math.PI / 2 - 0.15 });
    P.add(torso, new THREE.BoxGeometry(0.075, 0.24, 0.035), sc, 0.07, 0.5, fz(0.22) + 0.02, { rx: -0.12, rz: 0.12 });
    P.add(torso, new THREE.BoxGeometry(0.077, 0.025, 0.037), P.mat(shade(look.scarf, 0.7), 0.95), 0.083, 0.4, fz(0.23) + 0.03, { rx: -0.12, rz: 0.12 });
  }
  if (look.backpack != null) {
    const bp = P.mat(look.backpack, 0.85);
    P.add(torso, new THREE.BoxGeometry(0.3, 0.36, 0.13), bp, 0, 0.3, -0.25);
    P.add(torso, new THREE.BoxGeometry(0.31, 0.12, 0.14), P.mat(shade(look.backpack, 0.78), 0.85), 0, 0.43, -0.25);
    P.add(torso, new THREE.CylinderGeometry(0.07, 0.07, 0.34, 8), P.mat(0x3d5a40, 0.9), 0, 0.53, -0.25, { rz: Math.PI / 2 });
    for (const s of [-1, 1]) P.add(torso, new THREE.BoxGeometry(0.04, 0.4, 0.02), dark, s * 0.11, 0.4, fz(0.2) + 0.01, { rx: 0.1 });
  }
  // шия
  P.add(torso, new THREE.CylinderGeometry(0.062, 0.07, 0.12, 9), skin, 0, 0.68, 0.005);

  // ── руки ──
  const sleeve = kind === 'knit' ? P.mat(look.jacket, 0.95) : jacket;
  const mkArm = (sx: number) => {
    const arm = new THREE.Group();
    arm.position.set(sx * (0.25 * W + 0.035), 0.54, 0);
    torso.add(arm);
    P.add(arm, new THREE.SphereGeometry(0.082, 7, 5), sleeve, -sx * 0.025, -0.03, 0);
    P.add(arm, new THREE.CapsuleGeometry(0.075, 0.34, 2, 7), sleeve, 0, -0.24, 0);
    P.add(arm, new THREE.CylinderGeometry(0.083, 0.08, 0.06, 8), kind === 'rain' ? jacketDark : P.mat(shade(look.jacket, 0.8), jRough), 0, -0.46, 0);
    if (kind === 'rain' && look.stripes !== false) P.add(arm, new THREE.CylinderGeometry(0.079, 0.079, 0.035, 8, 1, true), refl, 0, -0.31, 0);
    // кисть-рукавиця з великим пальцем
    P.add(arm, new THREE.SphereGeometry(0.072, 7, 5), handM, 0, -0.58, 0.005, { sx: 0.82, sy: 1.08, sz: 0.95 });
    P.add(arm, new THREE.SphereGeometry(0.032, 5, 4), handM, -sx * 0.035, -0.54, 0.05, { sy: 1.3 });
    return arm;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  // ── голова ──
  const head = new THREE.Group();
  head.position.y = 0.68;
  // трохи завелика голова — «іграшкові» пропорції, читається здалеку
  head.scale.setScalar(1.1);
  torso.add(head);
  const C = 0.17; // центр черепа над шиєю
  P.add(head, new THREE.SphereGeometry(0.15, 13, 9), skin, 0, C, 0, { sx: 1, sy: 1.04, sz: 0.96 });
  // вуха
  for (const s of [-1, 1]) P.add(head, new THREE.SphereGeometry(0.036, 6, 4), skin, s * 0.147, C - 0.005, -0.005, { sx: 0.5, sy: 1, sz: 0.75 });
  // ніс-картоплинка
  P.add(head, new THREE.SphereGeometry(0.035, 7, 5), P.mat(mix(skinC, 0xd06a5a, 0.18), 0.6), 0, C - 0.018, 0.148, { sy: 0.88 });
  // очі: чорні намистинки з відблиском
  for (const s of [-1, 1]) {
    P.add(head, new THREE.SphereGeometry(0.021, 6, 4), dark, s * 0.055, C + 0.02, 0.131, { sy: 1.2, sz: 0.55 });
    P.add(head, new THREE.SphereGeometry(0.0065, 4, 3), white, s * 0.055 + 0.007, C + 0.028, 0.142);
  }
  // брови
  const brow = look.brow ?? 0.1;
  for (const s of [-1, 1]) P.add(head, new THREE.BoxGeometry(0.052, 0.014, 0.018), hair, s * 0.057, C + 0.062, 0.121, { rz: -s * brow, rx: -0.2 });
  // рум'янець
  const blush = P.mat(mix(skinC, 0xe86a6a, 0.35), 0.7);
  for (const s of [-1, 1]) P.add(head, new THREE.SphereGeometry(0.027, 5, 3), blush, s * 0.086, C - 0.032, 0.112, { sy: 0.7, sz: 0.4, ry: s * 0.6 });
  const beard = look.beard ?? 'none';
  if (beard !== 'full') {
    // усмішка
    P.add(head, new THREE.TorusGeometry(0.022, 0.0055, 3, 7, Math.PI), P.mat(0x5a2a22, 0.6), 0, C - 0.05, 0.134, { rz: Math.PI, rx: -0.25 });
  }
  if (beard === 'full') {
    P.add(head, new THREE.SphereGeometry(0.142, 11, 6, 0, Math.PI * 2, Math.PI * 0.47, Math.PI * 0.53), hair, 0, C - 0.02, 0.022, { sx: 1.03, sy: 1.15, sz: 0.97 });
    // підборіддя трохи гостріше — борода «лопатою»
    P.add(head, new THREE.SphereGeometry(0.07, 7, 5), hair, 0, C - 0.135, 0.07, { sx: 1.3, sy: 1, sz: 0.9 });
  }
  if (beard === 'goatee') P.add(head, new THREE.SphereGeometry(0.04, 8, 6), hair, 0, C - 0.1, 0.11, { sx: 1.1, sy: 1.2, sz: 0.8 });
  if (beard === 'full' || beard === 'mustache') {
    for (const s of [-1, 1]) P.add(head, new THREE.CapsuleGeometry(0.014, 0.036, 2, 6), hair, s * 0.026, C - 0.045, 0.146, { rz: s * (Math.PI / 2 - 0.35) });
  }
  if (look.glasses) {
    const fr = P.mat(0x2a2320, 0.4);
    for (const s of [-1, 1]) {
      P.add(head, new THREE.TorusGeometry(0.032, 0.006, 4, 12), fr, s * 0.056, C + 0.02, 0.146);
      P.add(head, new THREE.BoxGeometry(0.008, 0.007, 0.12), fr, s * 0.091, C + 0.025, 0.088, { ry: s * 0.18 });
    }
    P.add(head, new THREE.BoxGeometry(0.03, 0.007, 0.007), fr, 0, C + 0.028, 0.152);
  }

  // волосся
  const hatK = look.hat ?? 'none';
  const hairK = look.hair ?? 'short';
  if (hairK === 'bald') {
    P.add(head, new THREE.SphereGeometry(0.156, 14, 4, Math.PI, Math.PI, Math.PI * 0.36, Math.PI * 0.26), hair, 0, C, 0, { sz: 0.98 });
  } else {
    const tilt = hairK === 'buzz' ? -0.62 : -0.72;
    P.add(head, new THREE.SphereGeometry(hairK === 'buzz' ? 0.154 : 0.16, 11, 6, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, 0, C + 0.004, -0.004, { rx: tilt, sz: 0.98 });
    if (hairK !== 'buzz' && hatK === 'none') {
      // чубчик набік
      P.add(head, new THREE.SphereGeometry(0.07, 7, 5), hair, 0.045, C + 0.115, 0.075, { sx: 1.5, sy: 0.55, sz: 0.9, rz: -0.25 });
      for (const s of [-1, 1]) P.add(head, new THREE.BoxGeometry(0.02, 0.06, 0.04), hair, s * 0.143, C + 0.02, 0.035);
    }
    if (hairK === 'bun') P.add(head, new THREE.SphereGeometry(0.062, 8, 6), hair, 0, C + 0.11, -0.13);
    if (hairK === 'long') P.add(head, new THREE.CapsuleGeometry(0.12, 0.1, 3, 9), hair, 0, C - 0.1, -0.055, { sx: 1.18, sz: 0.62 });
  }

  addHat(P, head, hatK, look.hatColor ?? 0x333333, look.hatAccent ?? 0xf4efe4, C);

  const tris = P.finish();
  return { root, body, torso, head, legL: L.leg, legR: R.leg, kneeL: L.knee, kneeR: R.knee, armL, armR, tris };
}

/** капелюх на голові (C — центр черепа над шиєю) */
function addHat(P: Parts, head: THREE.Object3D, hatK: HatKind, hc: number, acc: number, C: number) {
  if (hatK === 'sou') {
    const m = P.mat(hc, 0.38);
    P.add(head, new THREE.SphereGeometry(0.168, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, C + 0.03, -0.006, { sy: 0.98 });
    P.add(head, new THREE.LatheGeometry([V(0.155, 0.012), V(0.285, -0.065), V(0.282, -0.08), V(0.155, -0.008)], 18), m, 0, C + 0.03, -0.035, { rx: -0.2, sz: 1.08 });
    P.add(head, new THREE.CylinderGeometry(0.17, 0.17, 0.02, 14, 1, true), P.mat(shade(hc, 0.75), 0.45), 0, C + 0.04, -0.006);
  } else if (hatK === 'beanie') {
    const m = P.mat(hc, 0.97);
    P.add(head, new THREE.SphereGeometry(0.166, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), m, 0, C + 0.02, -0.004, { sy: 1.12 });
    P.add(head, new THREE.CylinderGeometry(0.171, 0.174, 0.065, 14), P.mat(shade(hc, 0.82), 0.97), 0, C + 0.012, -0.004);
    P.add(head, new THREE.IcosahedronGeometry(0.058, 1), P.mat(acc, 0.98), 0, C + 0.225, -0.01);
  } else if (hatK === 'captain') {
    // капітанський кашкет: білий верх, темний околиш, чорний лакований козирок, золота кокарда
    P.add(head, new THREE.CylinderGeometry(0.195, 0.16, 0.075, 14), P.mat(0xf6f3ea, 0.6), 0, C + 0.165, -0.012, { rx: -0.08 });
    P.add(head, new THREE.CylinderGeometry(0.163, 0.158, 0.055, 14), P.mat(hc, 0.7), 0, C + 0.105, -0.006);
    P.add(head, new THREE.CylinderGeometry(0.16, 0.16, 0.014, 10, 1, false, -Math.PI / 2, Math.PI), P.mat(0x141414, 0.25), 0, C + 0.085, 0.07, { sz: 0.72, rx: 0.32 });
    P.add(head, new THREE.SphereGeometry(0.026, 7, 5), P.mat(0xe0b44a, 0.3, 0.8), 0, C + 0.118, 0.158, { sx: 1.4, sz: 0.4 });
    P.add(head, new THREE.CylinderGeometry(0.005, 0.005, 0.25, 4), P.mat(0xe0b44a, 0.3, 0.8), 0, C + 0.093, 0.158, { rz: Math.PI / 2 });
  } else if (hatK === 'cap') {
    const m = P.mat(hc, 0.9);
    P.add(head, new THREE.SphereGeometry(0.17, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, C + 0.055, -0.005, { sx: 1.04, sy: 0.55, sz: 1.12 });
    P.add(head, new THREE.CylinderGeometry(0.15, 0.15, 0.016, 12, 1, false, -Math.PI / 2, Math.PI), m, 0, C + 0.06, 0.09, { sz: 0.6, rx: 0.22 });
  } else if (hatK === 'ushanka') {
    // хутряна вушанка: верх, підвернутий козирок-хутро, вуха на зав'язках
    const fur = P.mat(hc, 0.98);
    const top = P.mat(acc, 0.85);
    P.add(head, new THREE.SphereGeometry(0.17, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), top, 0, C + 0.035, -0.006, { sy: 0.92 });
    P.add(head, new THREE.CylinderGeometry(0.185, 0.188, 0.07, 14), fur, 0, C + 0.05, -0.006);
    P.add(head, new THREE.BoxGeometry(0.2, 0.09, 0.05), fur, 0, C + 0.105, 0.16, { rx: -0.35 });
    for (const s of [-1, 1]) {
      P.add(head, new THREE.BoxGeometry(0.05, 0.16, 0.13), fur, s * 0.172, C - 0.02, -0.01, { rz: s * 0.08 });
      P.add(head, new THREE.CylinderGeometry(0.006, 0.006, 0.08, 4), top, s * 0.18, C - 0.13, 0.0);
    }
  } else if (hatK === 'straw') {
    // солом'яний бриль: широкі поля, низька тулія, червона стрічка
    const m = P.mat(hc, 0.95);
    P.add(head, new THREE.CylinderGeometry(0.145, 0.165, 0.11, 16), m, 0, C + 0.12, -0.005);
    P.add(head, new THREE.SphereGeometry(0.145, 14, 4, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, C + 0.175, -0.005, { sy: 0.3 });
    P.add(head, new THREE.LatheGeometry([V(0.16, 0.012), V(0.36, -0.01), V(0.37, -0.03), V(0.36, -0.024), V(0.16, -0.006)], 22), m, 0, C + 0.07, -0.005, { rx: -0.06 });
    P.add(head, new THREE.CylinderGeometry(0.158, 0.167, 0.035, 16, 1, true), P.mat(acc, 0.7), 0, C + 0.09, -0.005);
  } else if (hatK === 'tricorn') {
    // треуголка: три загнуті поля навколо тулії, золотий кант, перо
    const m = P.mat(hc, 0.75);
    const gold = P.mat(acc, 0.35, 0.7);
    P.add(head, new THREE.SphereGeometry(0.165, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, C + 0.05, -0.006, { sy: 0.9 });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const x = Math.sin(a) * 0.15, z = Math.cos(a) * 0.15;
      P.add(head, new THREE.BoxGeometry(0.3, 0.13, 0.025), m, x, C + 0.12, z, { ry: a, rx: -0.45 });
      P.add(head, new THREE.BoxGeometry(0.3, 0.012, 0.03), gold, x * 1.12, C + 0.185, z * 1.12, { ry: a, rx: -0.45 });
    }
    P.add(head, new THREE.SphereGeometry(0.035, 8, 6), P.mat(0xf4efe4, 0.9), 0.12, C + 0.2, -0.1, { sx: 0.5, sy: 2.6, rz: -0.6 });
  } else if (hatK === 'crown') {
    // корона з мушель: перламутровий обідок і мушлі-зубці, рожеві й кремові
    const band = P.mat(hc, 0.4, 0.15);
    P.add(head, new THREE.CylinderGeometry(0.165, 0.163, 0.05, 16, 1, true), band, 0, C + 0.1, -0.005);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const x = Math.sin(a) * 0.165, z = Math.cos(a) * 0.165;
      const shell = P.mat(k % 2 ? acc : 0xfaf1e4, 0.45, 0.1);
      P.add(head, new THREE.ConeGeometry(0.045, 0.1, 6), shell, x, C + 0.165, z, { ry: a, sz: 0.45 });
      P.add(head, new THREE.SphereGeometry(0.014, 6, 4), P.mat(0xffffff, 0.15, 0.3), x * 1.04, C + 0.12, z * 1.04);
    }
  } else if (hatK === 'bucket') {
    const m = P.mat(hc, 0.9);
    P.add(head, new THREE.CylinderGeometry(0.13, 0.165, 0.13, 14), m, 0, C + 0.11, -0.005);
    P.add(head, new THREE.SphereGeometry(0.13, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, C + 0.17, -0.005, { sy: 0.25 });
    P.add(head, new THREE.LatheGeometry([V(0.16, 0.01), V(0.25, -0.05), V(0.248, -0.063), V(0.16, -0.008)], 16), m, 0, C + 0.05, -0.005);
    P.add(head, new THREE.CylinderGeometry(0.152, 0.167, 0.025, 14, 1, true), P.mat(acc, 0.9), 0, C + 0.065, -0.005);
  }

}

/** окремий капелюх (знахідка на острові), низ тулії — на y=0 */
export function buildHatModel(kind: HatKind, color: number, accent?: number): THREE.Group {
  const P = new Parts();
  const g = new THREE.Group();
  addHat(P, g, kind, color, accent ?? 0xf4efe4, -0.08);
  P.finish();
  g.scale.setScalar(1.7);
  return g;
}

/** стабільний хеш рядка */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** образ гравця-капітана: дощовик його кольору, кашкет, решта — від seed */
export function playerLook(color: number, seed: number, hat?: { kind: HatKind; color: number; accent?: number }): CharacterLook {
  const r = mulberry32(seed * 9973 + 17);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length) % a.length];
  const beard = pick(['full', 'full', 'mustache', 'none', 'goatee'] as const);
  return {
    jacket: color,
    jacketKind: 'rain',
    pants: pick([0x2b3340, 0x343a2c, 0x3a3230]),
    bib: r() < 0.35 ? pick([0x2c4a6e, 0x3d4a3a]) : undefined,
    hat: hat?.kind ?? 'captain',
    hatColor: hat?.color ?? 0x1d2a44,
    hatAccent: hat?.accent,
    skin: pick(SKINS),
    hair: pick(['short', 'short', 'buzz', 'long'] as const),
    hairColor: pick(HAIRS),
    beard,
    glasses: r() < 0.2,
    brow: 0.05 + r() * 0.15,
    boots: pick([0x2a2826, 0x2f4a33, 0x283b5c]),
    bootCuff: color,
    gloves: r() < 0.4 ? pick([0x2a2826, 0xf2ead8]) : undefined,
    scarf: r() < 0.3 ? pick([0xb8362c, 0xf2ead8, 0x2a3f66]) : undefined,
    width: 1 + r() * 0.1,
  };
}
