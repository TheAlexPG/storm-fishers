import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { L } from '../core/i18n';
import { Batch, T, boxGeo, cylGeo, gableBodyGeo, roofSlabGeo } from './portKit';
import { buildCharacter, HAIRS, SKINS, type CharacterRig } from './character';
import { siteToWorld, siteRect, type PortSite } from './portSites';
import type { Platform, Solid } from './port';

// ─────────────────────────────────────────────────────────────
// Рибальський Кут: село на палях. На пологому пляжі збоку від гавані —
// хатки на палях над мілиною, дощаний місток уздовж берега й коротка
// пристань, сушарки риби, сітки, плоскодонки. Мешканці (бабуся з кошиком,
// дід з вудкою, рибалка, що латає сітку) і собака оживають лише поблизу;
// підійдеш — скажуть щось своє. Уночі — вогники у вікнах і ліхтарі.
// Статика йде в спільний Batch гавані (злиття за матеріалом), рухоме —
// в окрему групу з userData.noMerge.
// ─────────────────────────────────────────────────────────────

type Mat = THREE.Material;

export interface VillageCtx {
  p: PortSite;
  g: THREE.Group;
  batch: Batch;
  M: { [k: string]: Mat };
  /** висота суходолу гавані */
  H: (x: number, z: number) => number;
  platforms: Platform[];
  solids: Solid[];
  lampPost: (x: number, z: number, y0: number) => void;
  glow: (x: number, y: number, z: number, size: number) => void;
  rng: () => number;
}

export interface VillageLife {
  update(dt: number, t: number, cam: THREE.Vector3, night: number): void;
}

/** рівень містка й підлог хаток (набережна 1.5 — заходиш без сходинки) */
const DECK = 1.45;
/** трап від набережної до містка (вісь a) */
const RAMP_A = -2.2;
/** сидячий: таз скелета на 0.9 над root, сидіння ~0.1 нижче за таз */
const SEAT = 0.8;

interface Npc {
  rig: CharacterRig;
  lines: string[];
  line: number;
  bubble: THREE.Sprite;
  bubbleMat: THREE.SpriteMaterial;
  shown: number;
  near: boolean;
  /** висота голови над root */
  headY: number;
  anim: (dt: number, t: number) => void;
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

export function buildKutVillage(c: VillageCtx): VillageLife {
  const { p, g, batch, M, H, platforms, solids, rng } = c;
  const W = (a: number, b: number) => siteToWorld(p, a, b);
  const ryA = Math.atan2(p.ox, p.oz); // обличчям у море (+a)
  const ryB = Math.atan2(-p.oz, p.ox); // обличчям уздовж +b (до бічного пляжу)
  // в'ялена риба: на вже наявних матеріалах гавані (не плодимо нових викликів малювання)
  const fish = M.bone, fishGold = M.rope;
  const floatRed = M.redPaint, floatWhite = M.whitePaint;
  const solidAA = (a0: number, a1: number, b0: number, b1: number) => {
    const r = siteRect(p, a0, a1, b0, b1, 0);
    solids.push({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, hw: (r.x1 - r.x0) / 2, hd: (r.z1 - r.z0) / 2, ry: 0 });
  };
  const live = new THREE.Group();
  live.userData.noMerge = true;
  g.add(live);

  // ── берегова лінія бічного пляжу (+b): перша точка, де дно нижче води ──
  const shoreB = (a: number) => {
    for (let b = 18; b < 60; b += 0.5) {
      const [x, z] = W(a, b);
      if (H(x, z) < 0) return b;
    }
    return 40;
  };

  // ── хатки на палях: на лінії прибою, задом до моря ──
  const smokeAt: THREE.Vector3[] = [];
  const hutAs = [-19, -11.5, -4];
  const walls = [M.sdBlue, M.sdRed, M.sdYellow];
  const roofs = [M.roofDark, M.roofBrown, M.roofDark];
  let walkB = 99; // ближня до суші межа хаток — по ній іде місток
  const huts: Array<{ a: number; b: number }> = [];
  for (const a of hutAs) {
    const b = shoreB(a) + 1.5;
    huts.push({ a, b });
    walkB = Math.min(walkB, b - 2.2);
  }
  // місток уздовж берега (по суші/мілині) — між хатками й пляжем
  const wb0 = walkB - 2.1, wb1 = walkB;
  const aStart = -23, aEnd = 2;
  for (const h of huts) hut(h.a, h.b, walls[huts.indexOf(h)], roofs[huts.indexOf(h)]);
  // місточки від містка до дверей кожної хатки (двері — на a + 0.7)
  for (const h of huts) {
    const b0 = wb1 - 0.05, b1 = h.b - 1.7 - 0.1;
    if (b1 - b0 < 0.3) continue;
    const a = h.a + 0.7;
    platforms.push(siteRect(p, a - 0.75, a + 0.75, b0, b1 + 0.3, DECK));
    const [mx, mz] = W(a, (b0 + b1) / 2);
    batch.add(boxGeo(p.ox ? 1.5 : b1 - b0, 0.14, p.ox ? b1 - b0 : 1.5, 1, 2), M.deck, T(mx, DECK - 0.07, mz));
    for (let b = b0 + 1.2; b < b1; b += 2.2) {
      for (const da of [-0.65, 0.65]) {
        const [x, z] = W(a + da, b);
        batch.add(cylGeo(0.1, 0.12, DECK + 2.4, 6), M.woodDark, T(x, (DECK - 2.4) / 2 - 0.1, z));
      }
      // мотузяний поручень
      const [rx1, rz1] = W(a + 0.72, b);
      batch.add(boxGeo(0.06, 0.8, 0.06), M.woodGrey, T(rx1, DECK + 0.4, rz1));
    }
    const [rx, rz] = W(a + 0.72, (b0 + b1) / 2);
    batch.add(boxGeo(p.ox ? 0.04 : b1 - b0, 0.04, p.ox ? b1 - b0 : 0.04), M.rope, T(rx, DECK + 0.78, rz));
  }

  // настил містка
  {
    const len = aEnd - aStart;
    const [mx, mz] = W((aStart + aEnd) / 2, (wb0 + wb1) / 2);
    batch.add(boxGeo(p.ox ? len : 2.1, 0.16, p.ox ? 2.1 : len, 2, 1), M.deck, T(mx, DECK - 0.08, mz, 0));
    for (let a = aStart + 0.6; a <= aEnd; a += 2.6) {
      for (const b of [wb0 + 0.15, wb1 - 0.15]) {
        const [x, z] = W(a, b);
        const gy = Math.min(H(x, z), DECK - 0.3);
        const bot = Math.min(gy, -1.2) - 0.3;
        batch.add(cylGeo(0.11, 0.13, DECK - 0.16 - bot, 6), M.woodDark, T(x, (DECK - 0.16 + bot) / 2, z));
      }
    }
    platforms.push(siteRect(p, aStart, aEnd, wb0, wb1, DECK));
    // з'єднання з плато набережної (плато до b = plW/2): дощаний трап по суші
    platforms.push(siteRect(p, RAMP_A - 1.2, RAMP_A + 1.2, p.plW / 2 - 0.5, wb0 + 0.05, DECK));
    const [rx, rz] = W(RAMP_A, (p.plW / 2 + wb0) / 2);
    const rl = wb0 - p.plW / 2 + 0.5;
    batch.add(boxGeo(p.ox ? 2.4 : rl, 0.14, p.ox ? rl : 2.4, 1, 2), M.woodGrey, T(rx, DECK - 0.07, rz));
  }

  // пристань: від кінця містка в море, з лавкою на краю
  const jA0 = aEnd, jA1 = aEnd + 7;
  {
    const [mx, mz] = W((jA0 + jA1) / 2, (wb0 + wb1) / 2);
    batch.add(boxGeo(p.ox ? jA1 - jA0 : 2.1, 0.16, p.ox ? 2.1 : jA1 - jA0, 2, 1), M.deck, T(mx, DECK - 0.08, mz));
    for (let a = jA0 + 1.2; a <= jA1; a += 2.2) {
      for (const b of [wb0 + 0.15, wb1 - 0.15]) {
        const [x, z] = W(a, b);
        batch.add(cylGeo(0.12, 0.14, DECK + 2.6, 6), M.woodDark, T(x, (DECK - 2.6) / 2 - 0.1, z));
      }
    }
    // поручні по боках
    for (const b of [wb0 + 0.05, wb1 - 0.05]) {
      const [x, z] = W((jA0 + jA1) / 2 + 0.5, b);
      batch.add(boxGeo(p.ox ? jA1 - jA0 - 1 : 0.07, 0.07, p.ox ? 0.07 : jA1 - jA0 - 1), M.woodGrey, T(x, DECK + 0.85, z));
      for (let a = jA0 + 1; a <= jA1; a += 2) {
        const [px, pz] = W(a, b);
        batch.add(boxGeo(0.08, 0.9, 0.08), M.woodGrey, T(px, DECK + 0.45, pz));
      }
    }
    platforms.push(siteRect(p, jA0, jA1, wb0, wb1, DECK));
    // поручні й торець пристані — тверді (у воду лише через край містка, як із причалу)
    solidAA(jA0 + 0.6, jA1 + 0.3, wb0 - 0.25, wb0 + 0.08);
    solidAA(jA0 + 0.6, jA1 + 0.3, wb1 - 0.08, wb1 + 0.25);
    solidAA(jA1 - 0.05, jA1 + 0.4, wb0, wb1);
    // ліхтар на початку й на краю пристані
    const [l1x, l1z] = W(jA1 - 0.4, wb1 - 0.25);
    c.lampPost(l1x, l1z, DECK);
    const [l2x, l2z] = W(aStart + 0.6, wb1 - 0.25);
    c.lampPost(l2x, l2z, DECK);
    solids.push({ x: l1x, z: l1z, r: 0.2 }, { x: l2x, z: l2z, r: 0.2 });
    // кнехт і прив'язана плоскодонка біля пристані
    const [kx, kz] = W(jA1 - 1.2, wb1 - 0.25);
    batch.add(cylGeo(0.1, 0.12, 0.35, 8), M.iron, T(kx, DECK + 0.17, kz));
  }

  // ── сушарки риби (на пляжі між набережною й містком) ──
  const fishGeo = new THREE.SphereGeometry(0.1, 6, 4).scale(0.5, 1.5, 0.16);
  const tailGeo = new THREE.ConeGeometry(0.065, 0.1, 4).scale(1, 1, 0.25).rotateZ(Math.PI);
  const rack = (a: number, b: number, along: boolean) => {
    const [x, z] = W(a, b);
    const y = Math.max(0.2, H(x, z));
    const ry = along ? ryA : ryB;
    const base = T(x, y, z, ry);
    const at = (lx: number, ly: number, lz: number, rx = 0, rz = 0) => base.clone().multiply(T(lx, ly, lz, 0, rx, rz));
    for (const s of [-1, 1]) {
      batch.add(boxGeo(0.1, 1.9, 0.1), M.woodDark, at(s * 1.3, 0.95, 0.35, 0.18));
      batch.add(boxGeo(0.1, 1.9, 0.1), M.woodDark, at(s * 1.3, 0.95, -0.35, -0.18));
    }
    for (const ly of [1.75, 1.25]) {
      batch.add(boxGeo(2.8, 0.06, 0.06), M.woodGrey, at(0, ly, 0));
      for (let i = 0; i < 9; i++) {
        const lx = -1.15 + i * 0.29;
        const swing = (rng() - 0.5) * 0.25;
        const fm = at(lx, ly - 0.17, 0, 0, swing);
        batch.add(fishGeo, (i + Math.round(ly)) % 4 === 0 ? fishGold : fish, fm, false);
        batch.add(tailGeo, (i + Math.round(ly)) % 4 === 0 ? fishGold : fish, fm.clone().multiply(T(0, 0.19, 0)), false);
      }
    }
    solidAA(a - 1.5, a + 1.5, b - 0.6, b + 0.6);
  };
  rack(-15, wb0 - 3.2, true);
  rack(-8.5, wb0 - 3.4, true);
  rack(-5.6, wb0 - 4.6, true);

  // ── сітки на кілках з поплавцями ──
  const net = (a: number, b: number) => {
    const [x, z] = W(a, b);
    const y = Math.max(0.2, H(x, z));
    for (const d of [-1.4, 1.4]) {
      const [px, pz] = W(a + d, b);
      batch.add(cylGeo(0.05, 0.06, 1.9, 5), M.woodDark, T(px, y + 0.95, pz));
    }
    batch.add(boxGeo(p.ox ? 2.7 : 0.03, 1.25, p.ox ? 0.03 : 2.7), M.rope, T(x, y + 1.15, z));
    for (let i = 0; i < 5; i++) {
      const [fx, fz] = W(a - 1.1 + i * 0.55, b + 0.05);
      batch.add(new THREE.SphereGeometry(0.08, 6, 4), i % 2 ? floatRed : floatWhite, T(fx, y + 1.78, fz), false);
    }
    solidAA(a - 1.5, a + 1.5, b - 0.3, b + 0.3);
  };
  net(-20, wb0 - 4.2);
  net(-12, p.plW / 2 + 2.2);

  // ── плоскодонки на піску (одна перекинута) ──
  const punt = (a: number, b: number, turn: number, flip: boolean, mat: Mat) => {
    const [x, z] = W(a, b);
    const y = Math.max(0.15, H(x, z)) + (flip ? 0.42 : 0.12);
    const base = T(x, y, z, turn, 0, flip ? Math.PI : 0);
    const at = (lx: number, ly: number, lz: number, rz = 0) => base.clone().multiply(T(lx, ly, lz, 0, 0, rz));
    batch.add(boxGeo(1.1, 0.08, 3.4), M.woodDark, at(0, 0, 0));
    for (const s of [-1, 1]) batch.add(boxGeo(0.06, 0.38, 3.5), mat, at(s * 0.6, 0.17, 0, s * 0.25));
    for (const e of [-1, 1]) batch.add(boxGeo(1.25, 0.36, 0.06), mat, at(0, 0.17, e * 1.72));
    batch.add(boxGeo(1.1, 0.05, 0.3), M.woodGrey, at(0, 0.22, 0.2));
    if (!flip) {
      // весла
      batch.add(boxGeo(0.05, 0.05, 2.4), M.woodGrey, at(0.25, 0.3, 0.1, 0));
      batch.add(boxGeo(0.05, 0.05, 2.4), M.woodGrey, at(-0.2, 0.3, -0.1, 0));
    }
    const r = siteRect(p, a - 1.8, a + 1.8, b - 1.8, b + 1.8, 0);
    solids.push({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, r: 1.2 });
  };
  punt(-17, wb0 - 1.2, ryA + 0.35, false, M.sdBlue);
  punt(-6, wb0 - 1.4, ryA - 0.5, true, M.sdBlue);

  // плоскодонка на воді біля пристані — гойдається
  const vcol = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const floatBoat = new THREE.Mesh(painted([
    [boxGeo(1.1, 0.08, 3.4), 0x5a4330, T(0, 0, 0)],
    ...[-1, 1].map((s): [THREE.BufferGeometry, number, THREE.Matrix4] => [boxGeo(0.06, 0.38, 3.5), 0xa9442f, T(s * 0.6, 0.17, 0, 0, 0, s * 0.25)]),
    ...[-1, 1].map((e): [THREE.BufferGeometry, number, THREE.Matrix4] => [boxGeo(1.25, 0.36, 0.06), 0xa9442f, T(0, 0.17, e * 1.72)]),
    [boxGeo(1.1, 0.05, 0.3), 0xa59c8e, T(0, 0.22, -0.3)],
  ]), vcol);
  {
    const [bx, bz] = W(jA1 - 2.2, wb1 + 1.5);
    floatBoat.position.set(bx, 0.05, bz);
    floatBoat.rotation.y = ryA;
    live.add(floatBoat);
  }

  // ── дрібниці: бочки, ящики, кошики для раків ──
  const crate = (a: number, b: number, y?: number) => {
    const [x, z] = W(a, b);
    const yy = y ?? Math.max(0.2, H(x, z));
    batch.add(boxGeo(0.7, 0.55, 0.55), M.woodGrey, T(x, yy + 0.27, z, rng() * 0.6));
  };
  const barrel = (a: number, b: number, y?: number) => {
    const [x, z] = W(a, b);
    const yy = y ?? Math.max(0.2, H(x, z));
    batch.add(cylGeo(0.3, 0.3, 0.85, 10), M.woodDark, T(x, yy + 0.42, z));
    batch.add(cylGeo(0.31, 0.31, 0.06, 10), M.iron, T(x, yy + 0.65, z));
    batch.add(cylGeo(0.31, 0.31, 0.06, 10), M.iron, T(x, yy + 0.2, z));
  };
  const pot = (a: number, b: number, y: number) => {
    const [x, z] = W(a, b);
    batch.add(cylGeo(0.32, 0.32, 0.5, 8, 1, true), M.rope, T(x, y + 0.25, z, 0, Math.PI / 2, 0));
  };
  for (const h of huts) {
    crate(h.a + 2.2, wb1 - 0.45, DECK);
    barrel(h.a - 2.1, wb1 - 0.45, DECK);
  }
  pot(jA1 - 3, wb0 + 0.4, DECK);
  pot(jA1 - 3.7, wb0 + 0.45, DECK);
  crate(-13, wb0 - 1.6);

  // ── мешканці й собака ──
  const npcs: Npc[] = [];
  const people = new THREE.Group();
  people.visible = false;
  live.add(people);
  const bubbleCanvas = (text: string): THREE.CanvasTexture => {
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
  };
  const addNpc = (rig: CharacterRig, lines: string[], headY: number, anim: Npc['anim']) => {
    const bubbleMat = new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    const bubble = new THREE.Sprite(bubbleMat);
    bubble.scale.set(2.6, 0.49, 1);
    bubble.visible = false;
    bubble.renderOrder = 10;
    live.add(bubble);
    people.add(rig.root);
    npcs.push({ rig, lines, line: Math.floor(rng() * lines.length), bubble, bubbleMat, shown: 0, near: false, headY, anim });
  };
  const sitPose = (r: CharacterRig) => {
    r.legL.rotation.set(-Math.PI / 2 + 0.2, -0.1, 0);
    r.legR.rotation.set(-Math.PI / 2 + 0.2, 0.1, 0);
    r.kneeL.rotation.x = r.kneeR.rotation.x = Math.PI / 2 - 0.2;
  };

  // бабуся Ганя з кошиком — ходить містком туди-сюди
  {
    const r = buildCharacter({ jacket: 0x7a3b4f, jacketKind: 'knit', pants: 0x3a3440, hat: 'none', hair: 'bun', hairColor: HAIRS[6], skin: SKINS[1], apron: 0xe9dfc8, scarf: 0xc9813a, brow: 0.3, boots: 0x3a2a20, width: 1.05, belly: true }, { coarse: true });
    r.body.scale.setScalar(0.94);
    const basket = new THREE.Mesh(painted([
      [new THREE.CylinderGeometry(0.2, 0.15, 0.24, 9, 1), 0xb8955a, T(0.05, -0.62, 0.12)],
      [new THREE.TorusGeometry(0.16, 0.015, 4, 12, Math.PI).rotateY(Math.PI / 2), 0x8a6a3c, T(0.05, -0.5, 0.12)],
      [fishGeo, 0xd9d2c0, T(0.05, -0.47, 0.12, 0, 0, 1.2)],
    ]), vcol);
    r.armR.add(basket);
    let pos = 0.2, dir = 1, pause = 0;
    const span = aEnd - aStart - 3;
    const bMid = (wb0 + wb1) / 2;
    addNpc(r, [
      L('Ой, синку, знову без риби? Бери в Орисі черв\'яків!', `Back without fish again, dear? Get some worms from Orysia!`),
      L('На світанку тут ставрида сама в кошик скаче.', `At dawn the mackerel practically jumps into the basket.`),
      L('Не топчи сітки — мій старий їх три дні латав.', `Mind the nets — my old man spent three days mending them.`),
    ], 1.75, (dt, t) => {
      if (pause > 0) {
        pause -= dt;
        r.legL.rotation.x = r.legR.rotation.x = 0;
      } else {
        pos += (dir * dt * 0.75) / span;
        if (pos > 1 || pos < 0) {
          pos = Math.min(1, Math.max(0, pos));
          dir = -dir;
          pause = 2.5 + rng() * 3;
        }
        const sw = Math.sin(t * 5.2);
        r.legL.rotation.x = sw * 0.45;
        r.legR.rotation.x = -sw * 0.45;
        r.armL.rotation.x = -sw * 0.3;
      }
      const a = aStart + 1.5 + pos * span;
      const [x, z] = W(a, bMid);
      r.root.position.set(x, DECK, z);
      r.root.rotation.y = dir > 0 ? ryA : ryA + Math.PI;
      r.armR.rotation.x = -0.25;
    });
  }

  // дід Петро з вудкою — сидить на краю пристані
  {
    const r = buildCharacter({ jacket: 0x3f5b45, jacketKind: 'coat', pants: 0x2e3540, hat: 'bucket', hatColor: 0x8a7a52, hair: 'short', hairColor: HAIRS[5], beard: 'full', skin: SKINS[2], brow: 0.2, boots: 0x2f4a33 }, { coarse: true });
    sitPose(r);
    r.armL.rotation.x = r.armR.rotation.x = -0.95;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.018, 2.6, 5), M.iron);
    rod.rotation.x = 1.86;
    rod.position.set(0, -0.9, 1.05);
    r.armR.add(rod);
    const [x, z] = W(jA1 - 0.25, (wb0 + wb1) / 2 - 0.4);
    r.root.position.set(x, DECK - SEAT, z); // сидить на краю, ноги звисають над водою
    r.root.rotation.y = ryA;
    // поплавець і волосінь (світові, оновлюються з кінчиком)
    const tip = new THREE.Object3D();
    tip.position.y = 1.3;
    rod.add(tip);
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), M.redPaint);
    people.add(bob);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xdde8ee, transparent: true, opacity: 0.6 }));
    line.frustumCulled = false;
    people.add(line);
    const tp = new THREE.Vector3();
    addNpc(r, [
      L('Тихіше… клює.', `Shh… it's biting.`),
      L('Шпрот тут дрібний, зате солодкий.', `The sprats are small here, but sweet.`),
      L('Як барометр падає — я вже вдома з чаєм.', `When the glass drops, I'm home with my tea.`),
    ], 1.4, (dt, t) => {
      const nib = Math.max(0, Math.sin(t * 0.7) - 0.92) * 6;
      r.armR.rotation.x = -0.95 - nib * 0.15 + Math.sin(t * 1.3) * 0.02;
      r.root.updateMatrixWorld(true);
      tip.getWorldPosition(tp);
      bob.position.set(tp.x + p.ox * 0.4, 0.06 + Math.sin(t * 2.1) * 0.03 - nib * 0.08, tp.z + p.oz * 0.4);
      const pa = lineGeo.attributes.position as THREE.BufferAttribute;
      pa.setXYZ(0, tp.x, tp.y, tp.z);
      pa.setXYZ(1, bob.position.x, bob.position.y + 0.05, bob.position.z);
      pa.needsUpdate = true;
    });
  }

  // рибалка Микола латає сітку біля сушарки
  {
    const r = buildCharacter({ jacket: 0xe0b13a, jacketKind: 'rain', pants: 0x2a3b55, hat: 'beanie', hatColor: 0x2f5c8a, hatAccent: 0xf2efe6, hair: 'short', hairColor: HAIRS[1], beard: 'mustache', skin: SKINS[3], bib: 0x2a3b55, boots: 0xf2c12e, stripes: false }, { coarse: true });
    sitPose(r);
    const [x, z] = W(-11.2, wb0 - 3.3);
    const gy = Math.max(0.2, H(x, z));
    batch.add(boxGeo(0.6, 0.45, 0.5), M.woodGrey, T(x, gy + 0.22, z, ryB));
    r.root.position.set(x, gy + 0.45 - SEAT, z);
    r.root.rotation.y = ryB + Math.PI;
    solids.push({ x, z, r: 0.45 });
    addNpc(r, [
      L('Кожна дірка в сітці — то історія.', `Every hole in a net is a story.`),
      L('Палтус учора порвав — от такий!', `A halibut tore it yesterday — this big!`),
      L('Пальне в бочках дороге: везуть аж зі «Шторму».', `Barrel fuel's pricey — it comes all the way from Storm Harbour.`),
    ], 1.4, (dt, t) => {
      r.armL.rotation.x = -0.9 + Math.sin(t * 2.4) * 0.25;
      r.armR.rotation.x = -0.9 + Math.sin(t * 2.4 + 1.6) * 0.25;
      r.head.rotation.x = 0.35 + Math.sin(t * 0.4) * 0.05;
    });
  }

  // пес Бублик — бігає набережною, сідає й виляє хвостом
  {
    // один SkinnedMesh: тулуб+голова, 4 лапи й хвіст — «кістки» з жорсткою прив'язкою (1 виклик малювання)
    const dog = new THREE.Group();
    const FUR = 0xb07a45, DARK = 0x3a2a20;
    const hd = (x: number, y: number, z: number, rz = 0) => T(x, y + 0.6, z + 0.36, 0, 0, rz);
    const LEG = [[-0.09, 0.22], [0.09, 0.22], [-0.09, -0.22], [0.09, -0.22]] as const;
    const parts: Array<[THREE.BufferGeometry, number, THREE.Matrix4, number]> = [
      [boxGeo(0.28, 0.26, 0.62), FUR, T(0, 0.42, 0), 0],
      [boxGeo(0.24, 0.22, 0.26), FUR, hd(0, 0, 0.04), 0],
      [boxGeo(0.13, 0.11, 0.16), FUR, hd(0, -0.04, 0.22), 0],
      [boxGeo(0.05, 0.05, 0.04), DARK, hd(0, -0.01, 0.31), 0],
      [boxGeo(0.06, 0.13, 0.08), DARK, hd(-0.1, 0.13, -0.02, -0.3), 0],
      [boxGeo(0.06, 0.13, 0.08), DARK, hd(0.1, 0.13, -0.02, 0.3), 0],
      ...LEG.map(([lx, lz], i): [THREE.BufferGeometry, number, THREE.Matrix4, number] => [boxGeo(0.07, 0.32, 0.07), FUR, T(lx, 0.16, lz), 1 + i]),
      [boxGeo(0.05, 0.05, 0.26), FUR, T(0, 0.56, -0.41, 0, -0.5), 5],
    ];
    const geo = painted(parts.map(([g0, c0, m]) => [g0, c0, m]));
    {
      const n = geo.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      let v = 0;
      for (const [g0, , , bone] of parts) {
        const cnt = (g0.index ? g0.index.count : g0.attributes.position.count);
        for (let i = 0; i < cnt; i++, v++) { si[v * 4] = bone; sw[v * 4] = 1; }
      }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    }
    const rootBone = new THREE.Bone();
    const legs: THREE.Bone[] = LEG.map(([lx, lz]) => {
      const b = new THREE.Bone();
      b.position.set(lx, 0.32, lz);
      rootBone.add(b);
      return b;
    });
    const tail = new THREE.Bone();
    tail.position.set(0, 0.5, -0.3);
    rootBone.add(tail);
    const dogMesh = new THREE.SkinnedMesh(geo, vcol);
    dogMesh.add(rootBone);
    dogMesh.bind(new THREE.Skeleton([rootBone, ...legs, tail]));
    dogMesh.frustumCulled = false;
    dog.add(dogMesh);
    people.add(dog);
    const pts = [[-3.2, -12], [-3.2, 4], [-5.2, 12.5], [-3.2, -4], [-5.2, -10]] as const;
    let k = 0, sit = 0;
    const cur = new THREE.Vector3(...((): [number, number, number] => { const [x, z] = W(pts[0][0], pts[0][1]); return [x, p.plY, z]; })());
    const bubbleMat = new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    const bubble = new THREE.Sprite(bubbleMat);
    bubble.scale.set(2.6, 0.49, 1);
    bubble.visible = false;
    live.add(bubble);
    npcs.push({
      rig: { root: dog } as CharacterRig, lines: [L('🐕 Гав! Гав!', `🐕 Woof! Woof!`), L('🐕 *виляє хвостом*', `🐕 *wags its tail*`)], line: 0, bubble, bubbleMat, shown: 0, near: false, headY: 0.95,
      anim: (dt, t) => {
        tail.rotation.y = Math.sin(t * (sit > 0 ? 9 : 14)) * 0.6;
        if (sit > 0) {
          sit -= dt;
          legs.forEach((l) => (l.rotation.x = 0));
          dog.rotation.x = -0.25;
          dog.position.y = cur.y - 0.06;
          return;
        }
        dog.rotation.x = 0;
        const [tx, tz] = W(pts[k][0], pts[k][1]);
        const dx = tx - cur.x, dz = tz - cur.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.3) {
          k = (k + 1) % pts.length;
          if (rng() < 0.5) sit = 2 + rng() * 4;
          return;
        }
        const sp = 1.6 * dt;
        cur.x += (dx / d) * Math.min(sp, d);
        cur.z += (dz / d) * Math.min(sp, d);
        dog.position.set(cur.x, cur.y, cur.z);
        dog.rotation.y = Math.atan2(dx, dz);
        const sw = Math.sin(t * 13);
        legs[0].rotation.x = legs[3].rotation.x = sw * 0.6;
        legs[1].rotation.x = legs[2].rotation.x = -sw * 0.6;
      },
    });
    dog.position.copy(cur);
  }

  // дрібні фігурки й пес — без тіньового проходу (тінь у кілька пікселів, а викликів удвічі більше)
  people.traverse((o) => (o.castShadow = false));

  // ── дим із коминів: кілька м'яких клубів, що повільно здіймаються ──
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
  // усі клуби — одним Points (колір з альфою у вершинах): 1 виклик малювання
  const PUFFS = 3;
  const nP = smokeAt.length * PUFFS;
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(nP * 3), 3));
  const smokeCol = new Float32Array(nP * 4).fill(0.92);
  smokeGeo.setAttribute('color', new THREE.Float32BufferAttribute(smokeCol, 4));
  const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ map: smokeTex, size: 1.7, sizeAttenuation: true, transparent: true, depthWrite: false, vertexColors: true }));
  smoke.frustumCulled = false;
  live.add(smoke);

  // ── кадр: лише поблизу (далі — завмирає) ──
  const center = new THREE.Vector3(p.x, 0, p.z);
  let wasNear = true;
  return {
    update(dt, t, cam, night) {
      const d = Math.hypot(cam.x - center.x, cam.z - center.z);
      const near = d < 220;
      if (near !== wasNear) {
        live.userData.hide = !near;
        live.visible = near;
        wasNear = near;
      }
      if (!near) return;
      // дим
      {
        const pa = smokeGeo.attributes.position as THREE.BufferAttribute;
        const ca = smokeGeo.attributes.color as THREE.BufferAttribute;
        for (let i = 0; i < nP; i++) {
          const o = smokeAt[Math.floor(i / PUFFS)], ph = (i % PUFFS) / PUFFS;
          const k = (t * 0.12 + ph) % 1;
          pa.setXYZ(i, o.x + k * 1.6 * p.oz + Math.sin(t + ph * 6) * 0.15, o.y + k * 3.2, o.z + k * 1.0);
          ca.setW(i, Math.sin(k * Math.PI) * (0.4 - night * 0.18));
        }
        pa.needsUpdate = true;
        ca.needsUpdate = true;
      }
      // плоскодонка гойдається
      floatBoat.position.y = 0.06 + Math.sin(t * 1.1) * 0.05;
      floatBoat.rotation.z = Math.sin(t * 0.9) * 0.05;
      floatBoat.rotation.x = Math.sin(t * 0.7 + 1) * 0.03;
      // люди й пес далі ~60 м — кілька пікселів: ховаємо (з гістерезисом)
      const showPeople = people.visible ? d < 65 : d < 55;
      people.visible = showPeople;
      if (!showPeople) {
        for (const n of npcs) n.bubble.visible = false;
        return;
      }
      // мешканці й репліки
      for (const n of npcs) {
        n.anim(dt, t);
        const rp = n.rig.root.position;
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

  // ── хатка на палях: дерев'яний каркас, двосхилий дах, вікна, комин ──
  function hut(a: number, b: number, wall: Mat, roof: Mat) {
    const w = 4.2, d = 3.4, hh = 2.4, rh = 1.15;
    const [x, z] = W(a, b);
    // фасадом (дверима) — до містка, тобто проти +b
    const ry = ryB + Math.PI;
    const base = T(x, DECK, z, ry);
    const at = (lx: number, ly: number, lz: number, lry = 0, lrx = 0) => base.clone().multiply(T(lx, ly, lz, lry, lrx));
    // підлога-настил (ширша за хатку — ґанок з боку моря)
    batch.add(boxGeo(w + 0.6, 0.18, d + 1.4), M.deck, at(0, -0.09, -0.5));
    // палі
    for (const lx of [-w / 2, 0, w / 2]) {
      for (const lz of [d / 2, -d / 2 - 1.1]) {
        const m = at(lx, 0, lz);
        const pp = new THREE.Vector3().setFromMatrixPosition(m);
        const bot = -2.6;
        batch.add(cylGeo(0.13, 0.15, DECK - bot, 6), M.woodDark, T(pp.x, (DECK + bot) / 2 - 0.15, pp.z));
      }
    }
    batch.add(gableBodyGeo(w, d, hh, rh, 2), wall, at(0, 0, 0));
    const ang = Math.atan2(rh, d / 2);
    const ov = 0.35, t = 0.14, Wd = w + 0.5;
    const Ls = Math.hypot(d / 2, rh) + ov;
    const slab = roofSlabGeo(Ls, t, Wd, 2).rotateY(-Math.PI / 2);
    const ridgeY = hh + rh;
    for (const s of [1, -1]) {
      const cz = s * Math.cos(ang) * (Ls / 2) + s * Math.sin(ang) * (t / 2);
      const cy = ridgeY - Math.sin(ang) * (Ls / 2) + Math.cos(ang) * (t / 2);
      batch.add(slab, roof, at(0, cy, cz, 0, s * ang));
    }
    batch.add(boxGeo(Wd + 0.04, 0.14, 0.26), roof, at(0, ridgeY + 0.08, 0));
    // двері й вікна
    batch.add(boxGeo(1.05, 1.95, 0.07), M.trim, at(-0.7, 0.98, d / 2));
    batch.add(boxGeo(0.85, 1.8, 0.1), M.woodDark, at(-0.7, 0.9, d / 2 + 0.02));
    const win = (lx: number, lz: number, r: number, lit: boolean) => {
      const m = at(lx, 1.45, lz, r);
      batch.add(boxGeo(0.85, 0.85, 0.08), M.trim, m);
      batch.add(new THREE.PlaneGeometry(0.68, 0.68), lit ? M.glassLit : M.glassDark, m.clone().multiply(T(0, 0, 0.045)), false);
    };
    win(1.05, d / 2, 0, true);
    win(0.6, -d / 2, Math.PI, rng() < 0.7);
    win(-w / 2, 0, -Math.PI / 2, true);
    // ліхтарик над дверима
    const lpm = at(0.05, 2.15, d / 2 + 0.12);
    batch.add(boxGeo(0.14, 0.2, 0.14), M.lamp, lpm, false);
    const lp = new THREE.Vector3().setFromMatrixPosition(lpm);
    c.glow(lp.x, lp.y, lp.z, 1.2);
    // комин і дим
    const chm = at(w / 2 - 0.7, ridgeY - 0.1, -0.5);
    batch.add(boxGeo(0.42, 1.3, 0.42), M.stoneDark, chm);
    const cp = new THREE.Vector3().setFromMatrixPosition(chm);
    smokeAt.push(new THREE.Vector3(cp.x, cp.y + 0.75, cp.z));
    // сітка, розвішана на стіні з боку моря
    batch.add(boxGeo(2.2, 1.0, 0.03), M.rope, at(0.4, 1.0, -d / 2 - 0.05));
    // тверде тіло хатки для ходьби (вісь-вирівняна оболонка)
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([lx, lz]) => new THREE.Vector3(lx, 0, lz).applyMatrix4(base));
    const xs = corners.map((v) => v.x), zs = corners.map((v) => v.z);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    solids.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2 + 0.1, hd: (z1 - z0) / 2 + 0.1, ry: 0 });
    // підлога хатки й ґанку — платформа (щоб не провалитися між палями)
    const pc = [[-w / 2 - 0.3, d / 2 + 0.2], [w / 2 + 0.3, -d / 2 - 1.2]].map(([lx, lz]) => new THREE.Vector3(lx, 0, lz).applyMatrix4(base));
    platforms.push({ x0: Math.min(pc[0].x, pc[1].x), x1: Math.max(pc[0].x, pc[1].x), z0: Math.min(pc[0].z, pc[1].z), z1: Math.max(pc[0].z, pc[1].z), y: DECK });
  }
}
