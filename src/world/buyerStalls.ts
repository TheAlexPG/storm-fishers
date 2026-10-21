import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { GROUND_Y } from './portTerrain';
import { corrugatedTex } from './textures';
import { Batch, T, boxGeo, cylGeo } from './portKit';
import { buildCharacter, HAIRS, SKINS, type CharacterLook, type CharacterRig } from './character';
import { ISLANDS, ISLAND_SOLIDS, islandHeight, islandInside } from './islandShape';
import { BUYER_BY_ID, FishTrade, MAX_CONTRACTS, type BuyerId } from '../game/buyers';
import type { Port } from './port';
import { L } from '../core/i18n';
import { mergeStatic } from './staticMerge';

// ─────────────────────────────────────────────────────────────
// Прилавки скупників: таверна, коптильня, ресторан, консервний завод
// у порту й хижа Остапа на Сосновому острові. Кожен — відкритий кіоск
// із прилавком, вивіскою, крейдяною дошкою акцій і продавцем за прилавком.
// Геометрія кожного кіоску зливається за матеріалом (portKit.Batch).
// ─────────────────────────────────────────────────────────────

interface StallDef {
  id: BuyerId;
  x: number;
  z: number;
  /** поворот: фасад (прилавок) дивиться в +Z, повернутий на ry */
  ry: number;
  w: number;
  d: number;
  h: number;
  wall: number;
  roof: number;
  awning: [string, string];
  npc: CharacterLook;
}

/** місця в порту (фасад — до набережної, +Z) */
export const STALL_SPOTS: Record<Exclude<BuyerId, 'hermit'>, { x: number; z: number }> = {
  tavern: { x: -21, z: -47.2 },
  smoke: { x: 24.4, z: -47.2 },
  chef: { x: 29.6, z: -53.4 },
  cannery: { x: 55.2, z: -47.2 },
};

const NPCS: Record<BuyerId, CharacterLook> = {
  tavern: { jacket: 0xb8452f, jacketKind: 'knit', pants: 0x3a3230, hat: 'none', hair: 'bun', hairColor: HAIRS[7], skin: SKINS[1], apron: 0xf2ead8, brow: 0.2, scarf: 0xf2c12e, width: 1.08 },
  smoke: { jacket: 0x4f3f33, jacketKind: 'coat', pants: 0x2d2a27, hat: 'cap', hatColor: 0x2e2a26, beard: 'full', hairColor: HAIRS[6], skin: SKINS[2], apron: 0x6d5a45, gloves: 0x2a2826, belly: true, brow: -0.1 },
  chef: { jacket: 0xf4f1ea, jacketKind: 'knit', pants: 0x22303b, hat: 'none', hair: 'short', hairColor: HAIRS[4], skin: SKINS[0], beard: 'mustache', apron: 0xffffff, scarf: 0x1f3b57, brow: 0.05 },
  cannery: { jacket: 0x2f5c8a, pants: 0x30343a, bib: 0x3b4a5c, hat: 'beanie', hatColor: 0xe07b2e, hairColor: HAIRS[1], skin: SKINS[3], gloves: 0xe8dcc0, boots: 0xf2c12e, vest: true, stripes: true },
  hermit: { jacket: 0x55613f, jacketKind: 'coat', pants: 0x3d3a33, hat: 'sou', hatColor: 0xd9a514, beard: 'full', hairColor: HAIRS[6], skin: SKINS[2], scarf: 0x8a3a2a, glasses: true, brow: 0.25 },
};

function std(color: number, rough = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
}

function canvasTex(w: number, h: number): [HTMLCanvasElement, THREE.CanvasTexture] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return [c, t];
}

/** смугастий тент */
function awningTex(a: string, b: string): THREE.CanvasTexture {
  const [c, t] = canvasTex(256, 64);
  const x = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? b : a;
    x.fillRect(i * 32, 0, 32, 64);
  }
  // фестони внизу
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 8; i++) {
    x.beginPath();
    x.arc(i * 32 + 16, 70, 14, 0, Math.PI * 2);
    x.fill();
  }
  return t;
}

interface Stall {
  id: BuyerId;
  group: THREE.Group;
  npc: CharacterRig;
  board: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string };
  smoke: THREE.Sprite[];
  fire: THREE.Mesh | null;
  lights: THREE.MeshStandardMaterial | null;
  phase: number;
}

export class BuyerStalls {
  readonly group = new THREE.Group();
  private stalls: Stall[] = [];
  /** хижа Остапа: місце для взаємодії (світ) */
  hermit = { x: 0, z: 0, y: 0 };
  private t = 0;
  private boardT = 0;
  private smokeTex: THREE.CanvasTexture;

  constructor(scene: THREE.Scene, port: Port) {
    scene.add(this.group);
    // м'яка «хмарка» для диму коптильні
    const [sc, st] = canvasTex(64, 64);
    const g = sc.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(235,230,222,0.9)');
    grd.addColorStop(1, 'rgba(235,230,222,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this.smokeTex = st;

    const defs: StallDef[] = [
      { id: 'tavern', ...STALL_SPOTS.tavern, ry: 0, w: 4.4, d: 3, h: 2.7, wall: 0xb5523a, roof: 0x5a3324, awning: ['#a8452a', '#f3e2bd'], npc: NPCS.tavern },
      { id: 'smoke', ...STALL_SPOTS.smoke, ry: 0, w: 3.8, d: 3, h: 2.6, wall: 0x5e4634, roof: 0x2f2a26, awning: ['#3d3129', '#e2a64e'], npc: NPCS.smoke },
      { id: 'chef', ...STALL_SPOTS.chef, ry: 0, w: 4.2, d: 3, h: 2.8, wall: 0xf1ede4, roof: 0x1f3b57, awning: ['#1f3b57', '#f4f1ea'], npc: NPCS.chef },
      { id: 'cannery', ...STALL_SPOTS.cannery, ry: 0, w: 4.8, d: 3.6, h: 3.1, wall: 0x7d8a92, roof: 0x4b545b, awning: ['#56626b', '#e8edf0'], npc: NPCS.cannery },
    ];
    for (const d of defs) {
      const s = this.build(d, GROUND_Y);
      port.solids.push({ x: d.x, z: d.z - d.d / 2 - 0.1, hw: d.w / 2 + 0.05, hd: d.d / 2 + 0.25, ry: 0 });
      this.extras(s, d, port);
    }
    this.buildHermit();
    // нерухомі кіоски — у кілька мешів; продавці, вогонь коптильні й дим лишаються живими
    mergeStatic(this.group, { skip: this.stalls.flatMap((st) => [st.npc.root, st.fire]) });
  }

  // ───────────── кіоск ─────────────

  private build(d: StallDef, y0: number): Stall {
    const root = new THREE.Group();
    root.position.set(d.x, y0, d.z);
    root.rotation.y = d.ry;
    this.group.add(root);
    const b = new Batch();
    // завод — гофрований метал, решта — фарбовані дошки
    const wall = d.id === 'cannery' ? new THREE.MeshStandardMaterial({ map: corrugatedTex(), color: 0xb7c2c8, roughness: 0.55, metalness: 0.25 }) : std(d.wall, 0.85);
    const dark = std(0x4a3426, 0.8);
    const wood = std(0x8a6242, 0.75);
    const roof = std(d.roof, 0.7);
    const { w: W, d: D, h: H } = d;
    // настил
    b.add(boxGeo(W + 0.4, 0.14, D + 0.5), dark, T(0, 0.07, -D / 2 + 0.1));
    // задня й бічні стіни
    b.add(boxGeo(W, H, 0.12), wall, T(0, H / 2, -D + 0.06));
    for (const sx of [-1, 1]) b.add(boxGeo(0.12, H, D), wall, T(sx * (W / 2 - 0.06), H / 2, -D / 2));
    // прилавок із дошкою зверху
    b.add(boxGeo(W - 0.24, 1.0, 0.45), wall, T(0, 0.5, -0.3));
    b.add(boxGeo(W - 0.1, 0.07, 0.62), wood, T(0, 1.04, -0.26));
    // стійки й балка над прилавком
    for (const sx of [-1, 1]) b.add(boxGeo(0.14, H, 0.14), dark, T(sx * (W / 2 - 0.07), H / 2, -0.07));
    b.add(boxGeo(W, 0.2, 0.16), dark, T(0, H - 0.1, -0.08));
    // полиці на задній стіні
    for (const yy of [1.35, 1.85]) b.add(boxGeo(W - 0.4, 0.05, 0.3), wood, T(0, yy, -D + 0.25));
    // дах-односхил (нахил до фасаду)
    const slope = 0.22;
    b.add(boxGeo(W + 0.5, 0.1, D + 0.6), roof, T(0, H + 0.12, -D / 2 + 0.05, 0, -slope));
    // стійки вивіски
    for (const sx of [-0.36, 0.36]) b.add(boxGeo(0.07, 0.75, 0.07), dark, T(sx * W, H + 0.25, 0.38));
    b.build(root);

    // тент над прилавком
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.2, 1.05), new THREE.MeshStandardMaterial({ map: awningTex(d.awning[0], d.awning[1]), roughness: 0.9, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 }));
    aw.position.set(0, H - 0.32, 0.42);
    aw.rotation.x = -Math.PI / 2 + 0.75;
    aw.castShadow = true;
    root.add(aw);

    // вивіска над дахом
    const def = BUYER_BY_ID[d.id];
    const [sc, stx] = canvasTex(768, 160);
    this.drawSign(sc, def.name, def.wants, def.color, def.accent, def.icon);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.95, (W * 0.95 * 160) / 768), new THREE.MeshStandardMaterial({ map: stx, emissiveMap: stx, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.8 }));
    sign.position.set(0, H + 0.8, 0.46);
    root.add(sign);
    const signBack = new THREE.Mesh(new THREE.BoxGeometry(W * 0.95 + 0.1, (W * 0.95 * 160) / 768 + 0.1, 0.06), dark);
    signBack.position.set(0, H + 0.8, 0.41);
    root.add(signBack);

    // дошка акцій (А-рамка біля прилавка)
    const [bc, btx] = canvasTex(512, 384);
    const board = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.82), new THREE.MeshStandardMaterial({ map: btx, emissiveMap: btx, emissive: 0xffffff, emissiveIntensity: 0.14, roughness: 0.95 }));
    face.position.set(0, 0.62, 0.04);
    face.rotation.x = -0.18;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.92, 0.05), wood);
    frame.position.set(0, 0.62, 0);
    frame.rotation.x = -0.18;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.92, 0.05), wood);
    back.position.set(0, 0.62, -0.32);
    back.rotation.x = 0.18;
    board.add(frame, face, back);
    board.position.set(W / 2 + 0.75, 0, 0.55);
    board.rotation.y = -0.35;
    root.add(board);

    // продавець за прилавком
    const npc = buildCharacter(d.npc);
    npc.root.position.set(-0.3, 0.14, -0.95);
    root.add(npc.root);
    const st: Stall = { id: d.id, group: root, npc, board: { canvas: bc, tex: btx, key: '' }, smoke: [], fire: null, lights: null, phase: Math.random() * 10 };
    this.stalls.push(st);
    return st;
  }

  private drawSign(c: HTMLCanvasElement, name: string, sub: string, color: string, accent: string, icon: string) {
    const x = c.getContext('2d')!;
    const w = c.width, h = c.height;
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = accent;
    x.lineWidth = 6;
    x.strokeRect(10, 10, w - 20, h - 20);
    x.fillStyle = accent;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = 'bold 54px Georgia, "Times New Roman", serif';
    const title = `${icon} ${name.toUpperCase()}`;
    let fs = 54;
    while (x.measureText(title).width > w - 60 && fs > 26) {
      fs -= 2;
      x.font = `bold ${fs}px Georgia, "Times New Roman", serif`;
    }
    x.fillText(title, w / 2, 62);
    x.font = 'italic 28px Georgia, serif';
    x.globalAlpha = 0.85;
    let ss = 28;
    while (x.measureText(sub).width > w - 70 && ss > 16) {
      ss -= 1;
      x.font = `italic ${ss}px Georgia, serif`;
    }
    x.fillText(sub, w / 2, 118);
    x.globalAlpha = 1;
  }

  // ───────────── реквізит ─────────────

  private extras(s: Stall, d: StallDef, port: Port) {
    const root = s.group;
    const b = new Batch();
    const rng = mulberry32(d.id.length * 977 + d.id.charCodeAt(0));
    const wood = std(0x8a6242, 0.75);
    const dark = std(0x4a3426, 0.8);
    const solid = (lx: number, lz: number, r: number) => port.solids.push({ x: d.x + lx, z: d.z + lz, r });
    const barrel = (lx: number, lz: number) => {
      b.add(cylGeo(0.32, 0.28, 0.85, 12), std(0x7a5232, 0.8), T(lx, 0.43, lz));
      for (const yy of [0.15, 0.7]) b.add(cylGeo(0.335, 0.335, 0.05, 12), std(0x3b3b3b, 0.5, { metalness: 0.4 }), T(lx, yy, lz));
      solid(lx, lz, 0.4);
    };
    const table = (lx: number, lz: number, cloth?: number) => {
      b.add(cylGeo(0.05, 0.05, 0.75, 8), dark, T(lx, 0.38, lz));
      b.add(cylGeo(0.45, 0.45, 0.05, 14), cloth ? std(cloth, 0.95) : wood, T(lx, 0.76, lz));
      if (cloth) b.add(cylGeo(0.47, 0.5, 0.22, 14, 1, true), std(cloth, 0.95, { side: THREE.DoubleSide }), T(lx, 0.66, lz));
      for (const a of [0, Math.PI]) {
        const cx = lx + Math.cos(a) * 0.75, cz = lz + Math.sin(a) * 0.75;
        b.add(boxGeo(0.4, 0.05, 0.4), wood, T(cx, 0.45, cz));
        for (const ox of [-0.16, 0.16]) for (const oz of [-0.16, 0.16]) b.add(boxGeo(0.04, 0.45, 0.04), dark, T(cx + ox, 0.22, cz + oz));
      }
      solid(lx, lz, 0.55);
    };
    const crate = (lx: number, ly: number, lz: number, sz = 0.6) => {
      b.add(boxGeo(sz, sz * 0.8, sz), std(0xa9824e, 0.85), T(lx, ly + sz * 0.4, lz, rng() * 0.4 - 0.2));
    };
    const W = d.w;
    if (d.id === 'tavern') {
      barrel(-W / 2 - 0.55, -0.6);
      barrel(-W / 2 - 0.5, -1.5);
      table(-W / 2 - 2.2, 0.4);
      // ліхтар над прилавком
      const lamp = std(0xffc867, 0.4, { emissive: 0xffb347, emissiveIntensity: 1.2 });
      b.add(new THREE.SphereGeometry(0.12, 10, 8), lamp, T(W / 2 - 0.5, d.h - 0.45, 0.1));
      s.lights = lamp;
      // казан на полиці й риба на гачках
      b.add(cylGeo(0.22, 0.18, 0.3, 12), std(0x2b2b2b, 0.4, { metalness: 0.6 }), T(0.9, 1.5, -d.d + 0.3));
    } else if (d.id === 'smoke') {
      // цегляний димар коптильні + дим
      const brick = std(0x8c4a35, 0.9);
      b.add(boxGeo(0.8, d.h + 1.6, 0.8), brick, T(W / 2 - 0.45, (d.h + 1.6) / 2, -d.d + 0.45));
      b.add(boxGeo(0.95, 0.15, 0.95), std(0x5a3a2a, 0.9), T(W / 2 - 0.45, d.h + 1.6, -d.d + 0.45));
      // в'язка риби під тентом
      const fish = std(0xc58a3a, 0.55, { metalness: 0.15 });
      for (let i = 0; i < 7; i++) {
        const fx = -W / 2 + 0.5 + i * ((W - 1) / 6);
        b.add(new THREE.SphereGeometry(0.07, 8, 6), fish, T(fx, d.h - 0.55, 0.05, 0, 0, Math.PI / 2, 1, 2.6, 0.7));
      }
      b.add(boxGeo(W - 0.6, 0.03, 0.03), dark, T(0, d.h - 0.33, 0.05));
      // дрова
      for (let i = 0; i < 9; i++) {
        const row = Math.floor(i / 3), col = i % 3;
        b.add(cylGeo(0.09, 0.09, 1.0, 7), std(i % 2 ? 0x7a5636 : 0x8f6a45, 0.9), T(-W / 2 - 0.55, 0.1 + row * 0.17, -0.9 - col * 0.19, 0, Math.PI / 2));
      }
      solid(-W / 2 - 0.55, -1.1, 0.55);
      for (let i = 0; i < 7; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, opacity: 0.5 }));
        sp.userData = { k: i / 7 };
        root.add(sp);
        s.smoke.push(sp);
      }
      s.smoke.forEach((sp) => (sp.userData.base = new THREE.Vector3(W / 2 - 0.45, d.h + 1.75, -d.d + 0.45)));
    } else if (d.id === 'chef') {
      table(-W / 2 - 1.6, 0.2, 0xf6f3ec);
      table(W / 2 + 1.9, -1.3, 0xf6f3ec);
      // гірлянда вздовж тенту
      const bulb = std(0xfff1c4, 0.4, { emissive: 0xffd27a, emissiveIntensity: 1.1 });
      for (let i = 0; i < 9; i++) {
        const fx = -W / 2 + (i / 8) * W;
        b.add(new THREE.SphereGeometry(0.05, 8, 6), bulb, T(fx, d.h - 0.7 - Math.sin((i / 8) * Math.PI) * 0.12, 0.82));
      }
      s.lights = bulb;
      // вазони
      for (const sx of [-1, 1]) {
        b.add(cylGeo(0.25, 0.2, 0.45, 10), std(0xb5654a, 0.85), T(sx * (W / 2 + 0.35), 0.23, 0.35));
        b.add(new THREE.SphereGeometry(0.33, 10, 8), std(0x4f7d45, 0.9), T(sx * (W / 2 + 0.35), 0.72, 0.35));
        solid(sx * (W / 2 + 0.35), 0.35, 0.3);
      }
    } else if (d.id === 'cannery') {
      // ящики й піраміда консервів
      for (let i = 0; i < 3; i++) crate(-W / 2 - 0.6, 0, -0.6 - i * 0.7);
      crate(-W / 2 - 0.6, 0.48, -1.0, 0.55);
      solid(-W / 2 - 0.6, -1.3, 0.8);
      const can = std(0xc7ccd0, 0.35, { metalness: 0.7 });
      const label = std(0xd0573f, 0.7);
      let k = 0;
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 3 - row; i++) {
          const cx = -0.6 + i * 0.2 + row * 0.1;
          b.add(cylGeo(0.08, 0.08, 0.12, 10), k++ % 2 ? can : label, T(cx, 1.13 + row * 0.12, -0.25));
        }
      }
      // піддон із сітками-ящиками
      b.add(boxGeo(1.2, 0.12, 1.0), wood, T(W / 2 + 0.85, 0.06, -0.8));
      crate(W / 2 + 0.6, 0.12, -0.6, 0.5);
      crate(W / 2 + 1.1, 0.12, -1.0, 0.5);
      solid(W / 2 + 0.85, -0.8, 0.75);
    }
    b.build(root);
  }

  // ───────────── хижа Остапа ─────────────

  private buildHermit() {
    const isl = ISLANDS.find((d) => d.kind === 'pine') ?? ISLANDS[0];
    // місце: берег (6–8 м від води), бажано з боку порту, без дерев і скель поруч
    let best: [number, number, number] | null = null;
    let bestScore = Infinity;
    const toPort = Math.atan2(-isl.z, -isl.x);
    for (let k = 0; k < 48; k++) {
      const a = toPort + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 24;
      // знайти по променю точку з «глибиною суші» ≈ 7 м
      for (let r = isl.r * 1.6; r > 2; r -= 0.5) {
        const x = isl.x + Math.cos(a) * r, z = isl.z + Math.sin(a) * r;
        const s = islandInside(isl, x, z);
        if (s < 6.5) continue;
        const clear = ISLAND_SOLIDS.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + 4.2);
        if (!clear) break;
        const score = Math.abs(k) * 1 + Math.abs(islandHeight(x, z) - 1) * 2;
        if (score < bestScore) {
          bestScore = score;
          // фасад — до моря (від центру)
          best = [x, z, Math.atan2(x - isl.x, z - isl.z)];
        }
        break;
      }
      if (best && k > 8) break;
    }
    const [x, z, ry] = best ?? [isl.x + isl.r * 0.6, isl.z, Math.PI / 2];
    const y = islandHeight(x, z);
    const d: StallDef = { id: 'hermit', x, z, ry, w: 3.4, d: 2.8, h: 2.75, wall: 0x6f6a5c, roof: 0x4b5a3a, awning: ['#3f5a3a', '#e9dcae'], npc: NPCS.hermit };
    const s = this.build(d, y - 0.08);
    // підпірки в схил (щоб не висіла над землею)
    const b = new Batch();
    const drift = std(0x8b8478, 0.95);
    for (const sx of [-1, 1]) for (const sz of [0.1, -d.d + 0.1]) b.add(cylGeo(0.09, 0.11, 1.4, 7), drift, T(sx * (d.w / 2), -0.6, sz));
    // вогнище з казанком і пастки для крабів
    const stone = std(0x8d8a82, 0.95);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      b.add(new THREE.SphereGeometry(0.16, 7, 5), stone, T(-d.w / 2 - 1.4 + Math.cos(a) * 0.45, 0.06, 1.1 + Math.sin(a) * 0.45, 0, 0, 0, 1, 0.6, 1));
    }
    b.add(cylGeo(0.05, 0.05, 1.0, 6), std(0x3a2a1c, 0.9), T(-d.w / 2 - 1.4, 0.3, 1.1, 0, 0, 0.5));
    for (let i = 0; i < 2; i++) b.add(boxGeo(0.6, 0.4, 0.6, 0.3), std(0x9a7b4f, 0.9, { wireframe: false }), T(d.w / 2 + 0.7, 0.2 + i * 0.4, -0.5 - i * 0.1, 0.3 * i));
    b.build(s.group);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a1a, emissiveIntensity: 1.6, transparent: true, opacity: 0.9 }));
    fire.position.set(-d.w / 2 - 1.4, 0.28, 1.1);
    s.group.add(fire);
    s.fire = fire;
    // тверді перешкоди острова
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const w = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    for (const lx of [-1, 0, 1]) {
      const [px, pz] = w(lx * 1.1, -d.d / 2);
      ISLAND_SOLIDS.push({ x: px, z: pz, r: 1.25 });
    }
    {
      const [px, pz] = w(-d.w / 2 - 1.4, 1.1);
      ISLAND_SOLIDS.push({ x: px, z: pz, r: 0.6 });
    }
    const [hx, hz] = w(0, 0.9);
    this.hermit = { x: hx, z: hz, y };
  }

  /** гравець на острові біля хижі Остапа */
  pickHermit(px: number, pz: number): { id: string; label: string } | null {
    if (Math.hypot(px - this.hermit.x, pz - this.hermit.z) > 2.6) return null;
    return { id: 'buyer:hermit', label: L(`${BUYER_BY_ID.hermit.name} — продати улов, замовлення`, `${BUYER_BY_ID.hermit.name} — sell your catch, orders`) };
  }

  // ───────────── кадр ─────────────

  update(dt: number, trade: FishTrade, nowH: number, night: number, player?: THREE.Vector3) {
    this.t += dt;
    const t = this.t;
    for (const s of this.stalls) {
      // продавець дихає й дивиться на гравця, якщо той поруч
      const rig = s.npc;
      rig.torso.rotation.x = Math.sin(t * 1.3 + s.phase) * 0.03;
      rig.armR.rotation.x = -0.25 + Math.sin(t * 0.9 + s.phase) * 0.08;
      if (player) {
        const wp = s.npc.root.getWorldPosition(_v);
        const dx = player.x - wp.x, dz = player.z - wp.z;
        const near = dx * dx + dz * dz < 64;
        const want = near ? THREE.MathUtils.clamp(Math.atan2(dx, dz) - s.group.rotation.y, -0.9, 0.9) : Math.sin(t * 0.3 + s.phase) * 0.3;
        rig.head.rotation.y += (want - rig.head.rotation.y) * Math.min(1, dt * 3);
      }
      for (const sp of s.smoke) {
        const u = sp.userData as { k: number; base: THREE.Vector3 };
        const k = (u.k + t * 0.12) % 1;
        sp.position.set(u.base.x + Math.sin(k * 6 + s.phase) * 0.3 + k * 0.8, u.base.y + k * 3.2, u.base.z + k * 0.4);
        sp.scale.setScalar(0.5 + k * 1.8);
        (sp.material as THREE.SpriteMaterial).opacity = 0.45 * (1 - k) * Math.min(1, k * 6);
      }
      if (s.fire) {
        s.fire.scale.set(1 + Math.sin(t * 13) * 0.08, 1 + Math.sin(t * 9 + 1) * 0.18, 1);
        (s.fire.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4 + Math.sin(t * 17) * 0.3;
      }
      if (s.lights) s.lights.emissiveIntensity = 0.5 + night * 1.6;
    }
    this.boardT -= dt;
    if (this.boardT <= 0) {
      this.boardT = 2;
      for (const s of this.stalls) this.drawBoard(s, trade, nowH);
    }
  }

  private drawBoard(s: Stall, trade: FishTrade, nowH: number) {
    const b = BUYER_BY_ID[s.id];
    const open = trade.isOpen(b, nowH);
    const promos = trade.promos(nowH, s.id);
    const offers = trade.offers(b, nowH, []).length;
    const mine = trade.active.filter((c) => c.buyer === s.id).length;
    const key = JSON.stringify([open, promos.map((p) => p.id), offers, mine, trade.active.length >= MAX_CONTRACTS]);
    if (key === s.board.key) return;
    s.board.key = key;
    const c = s.board.canvas;
    const x = c.getContext('2d')!;
    const W = c.width, H = c.height;
    x.fillStyle = '#23372f';
    x.fillRect(0, 0, W, H);
    const r = mulberry32(s.id.length * 31);
    for (let i = 0; i < 30; i++) {
      x.fillStyle = `rgba(255,255,255,${(0.015 + r() * 0.02).toFixed(3)})`;
      x.beginPath();
      x.arc(r() * W, r() * H, 15 + r() * 50, 0, Math.PI * 2);
      x.fill();
    }
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#f4ead2';
    x.font = 'bold 40px Georgia, serif';
    x.fillText(open ? L('АКЦІЇ ДНЯ', `TODAY'S OFFERS`) : L('ЗАЧИНЕНО', `CLOSED`), W / 2, 40);
    x.strokeStyle = 'rgba(244,234,210,0.4)';
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(40, 70);
    x.lineTo(W - 40, 70);
    x.stroke();
    x.textAlign = 'left';
    let y = 104;
    const lines = !open && b.open ? [L(`працюємо ${b.open[0]}:00–${b.open[1] === 24 ? '24' : b.open[1]}:00`, `open ${b.open[0]}:00–${b.open[1] === 24 ? '24' : b.open[1]}:00`)] : promos.length ? promos.map((p) => p.text) : [L('сьогодні без акцій', `no offers today`), L('ціни — як завжди', `prices as usual`)];
    for (const ln of lines.slice(0, 3)) {
      x.font = '26px Georgia, serif';
      x.fillStyle = '#ffd28a';
      y = this.wrap(x, '✦ ' + ln, 34, y, W - 64, 32) + 12;
    }
    x.textAlign = 'center';
    x.font = 'italic 24px Georgia, serif';
    x.fillStyle = 'rgba(244,234,210,0.85)';
    x.fillText(offers ? L(`📜 замовлень на поставку: ${offers}`, `📜 delivery orders: ${offers}`) : L('📜 замовлень поки нема', `📜 no orders yet`), W / 2, H - 34);
    s.board.tex.needsUpdate = true;
  }

  private wrap(x: CanvasRenderingContext2D, text: string, x0: number, y: number, maxW: number, lh: number): number {
    const words = text.split(' ');
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (x.measureText(t).width > maxW && line) {
        x.fillText(line, x0, y);
        y += lh;
        line = w;
      } else line = t;
    }
    if (line) x.fillText(line, x0, y);
    return y + lh;
  }
}

const _v = new THREE.Vector3();
