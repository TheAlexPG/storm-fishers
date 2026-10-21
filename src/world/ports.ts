import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { Batch, T, boxGeo, cylGeo, gableBodyGeo, roofSlabGeo, fbm, noise2, smoothstep } from './portKit';
import { cobbleTex, corrugatedTex, glowTex, groundDetailTex, planksTex, plasterTex, roofTilesTex, sidingTex, stoneTex, windowGlowTex, windowTex } from './textures';
import { PORT_SITES, siteGround as siteHeight, siteRect, siteToWorld, worldToSite, siteBerths, siteServices, pierRect, type PortSite } from './portSites';
import type { Platform, Solid } from './port';
import { mergeStatic } from './staticMerge';
import { buildKutVillage, type VillageLife } from './kutVillage';
import { ZORYA_ID, ZoryaLife, buildZoryaStatic, zoryaPlan, type TownCtx } from './zoryaTown';
import { KRAY_ID, KrayLife, buildKrayStatic, type KrayCtx, type KrayPlan } from './krayStation';

// ─────────────────────────────────────────────────────────────
// Інші гавані світу (дані — portSites.ts): суходіл, кам'яна набережна,
// дерев'яний причал на палях, будиночки послуг із вивісками, маяк і
// реквізит за характером місця (село, містечко, курорт, китобійня).
// Кожна гавань — свій Batch (злиття за матеріалом) → кілька draw calls і
// відсічення камерою; далеко — ховаємо зовсім.
// ─────────────────────────────────────────────────────────────

type Mats = ReturnType<typeof makeMats>;

function makeMats() {
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...p });
  const planks = planksTex(), stone = stoneTex(), plaster = plasterTex(), siding = sidingTex(), tiles = roofTilesTex(), corr = corrugatedTex();
  return {
    ground: std({ vertexColors: true, map: groundDetailTex(), roughness: 0.95 }),
    deck: std({ map: planks, color: 0xb08d63 }),
    woodDark: std({ map: planks, color: 0x6a4f35, roughness: 0.95 }),
    woodGrey: std({ map: planks, color: 0xa59c8e }),
    stone: std({ map: stone, color: 0xd2cabb }),
    stoneDark: std({ map: stone, color: 0x9a9284 }),
    cobble: std({ map: cobbleTex(), color: 0xcabda6, roughness: 0.92 }),
    plWhite: std({ map: plaster, color: 0xf6f2ea }),
    plCream: std({ map: plaster, color: 0xf2e3c2 }),
    plOchre: std({ map: plaster, color: 0xe9c27e }),
    plPink: std({ map: plaster, color: 0xe8b7a4 }),
    plBlue: std({ map: plaster, color: 0xa9c6dc }),
    plMint: std({ map: plaster, color: 0xb9dcc4 }),
    sdRed: std({ map: siding, color: 0xa9442f }),
    sdYellow: std({ map: siding, color: 0xe0b14e }),
    sdBlue: std({ map: siding, color: 0x4f80a8 }),
    sdGreen: std({ map: siding, color: 0x6b9273 }),
    sdGrey: std({ map: siding, color: 0x8d8f8a }),
    sdTar: std({ map: siding, color: 0x3b3a36 }),
    roofRed: std({ map: tiles, color: 0xc9694a, roughness: 0.85 }),
    roofDark: std({ map: tiles, color: 0x5d6670, roughness: 0.8 }),
    roofBrown: std({ map: tiles, color: 0x8e5240, roughness: 0.85 }),
    roofTeal: std({ map: tiles, color: 0x4f8f8c, roughness: 0.85 }),
    metalRust: std({ map: corr, color: 0xb0583c, roughness: 0.7, metalness: 0.25 }),
    metalGrey: std({ map: corr, color: 0xaab4ba, roughness: 0.6, metalness: 0.35 }),
    trim: std({ color: 0xf4f1e8, roughness: 0.8 }),
    iron: std({ color: 0x24292d, roughness: 0.45, metalness: 0.7 }),
    rope: std({ color: 0xcdb27a, roughness: 1 }),
    redPaint: std({ color: 0xc23a2c, roughness: 0.6 }),
    whitePaint: std({ color: 0xf2f1ec, roughness: 0.55 }),
    bone: std({ color: 0xe8e0cc, roughness: 0.7 }),
    leaf: std({ color: 0x4f8a3c, roughness: 0.75, flatShading: true }),
    cypress: std({ color: 0x2f4f2c, roughness: 0.85, flatShading: true }),
    olive: std({ color: 0x8a9a68, roughness: 0.9, flatShading: true }),
    vine: std({ color: 0x5f8a3a, roughness: 0.85, flatShading: true }),
    domeBlue: std({ color: 0x2f6fb5, roughness: 0.5 }),
    pine: std({ color: 0x2f5a35, roughness: 0.9, flatShading: true }),
    trunk: std({ color: 0x6a4a32, roughness: 0.9, flatShading: true }),
    canvasA: std({ color: 0xe2674a, roughness: 0.8, side: THREE.DoubleSide }),
    canvasB: std({ color: 0xf2efe6, roughness: 0.8, side: THREE.DoubleSide }),
    canvasC: std({ color: 0x24878c, roughness: 0.8, side: THREE.DoubleSide }),
    glassDark: std({ map: windowTex(), roughness: 0.25, metalness: 0.1 }),
    glassLit: std({ map: windowTex(), emissiveMap: windowGlowTex(), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.25, metalness: 0.1 }),
    lamp: std({ color: 0xfff1c8, emissive: 0xffc977, emissiveIntensity: 0.05, roughness: 0.2 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe39a, emissiveIntensity: 0.3, roughness: 0.1, transparent: true, opacity: 0.85 }),
  };
}

const STYLE_WALLS: Record<PortSite['style'], Array<keyof Mats>> = {
  village: ['sdRed', 'sdBlue', 'sdYellow', 'woodGrey'],
  town: ['plWhite', 'plCream', 'plOchre', 'plBlue', 'sdGreen'],
  resort: ['plPink', 'plMint', 'plBlue', 'plWhite', 'plOchre'],
  whaling: ['sdTar', 'sdGrey', 'sdRed'],
  med: ['plWhite', 'plWhite', 'plCream', 'plOchre', 'plWhite'],
  north: ['sdRed', 'sdGrey', 'sdTar', 'sdYellow', 'woodGrey'],
};
const STYLE_ROOFS: Record<PortSite['style'], Array<keyof Mats>> = {
  village: ['roofBrown', 'roofDark'],
  town: ['roofRed', 'roofBrown', 'roofDark'],
  resort: ['roofTeal', 'roofRed'],
  whaling: ['metalRust', 'metalGrey', 'roofDark'],
  med: ['roofRed', 'roofRed', 'roofBrown'],
  north: ['roofDark', 'roofDark', 'metalGrey'],
};

interface Built {
  site: PortSite;
  group: THREE.Group;
  lantern: THREE.Sprite;
  lanternPos: THREE.Vector3;
  phase: number;
  /** життя гавані (люди, тварини, дим) — лише поблизу */
  life?: VillageLife;
  /** живе містечко (Гавань Зорі): мешканці, дзвін, прапорці */
  zorya?: ZoryaLife;
  /** китобійня «Край світу»: мешканці, хаскі, вимпел, дим */
  kray?: KrayLife;
}

export class Ports {
  readonly group = new THREE.Group();
  private built: Built[] = [];
  private M: Mats;
  private glowMat: THREE.SpriteMaterial;
  private lampGlows: THREE.Sprite[] = [];
  private night = 0;
  /** удар дзвона каплиці (гучність 0..1) і репліка мешканця — ставить main */
  onBell: ((vol: number) => void) | null = null;
  onSay: ((text: string) => void) | null = null;

  /** platforms/solids — спільні з домашнім Port (ходьба й зіткнення гравця) */
  constructor(scene: THREE.Scene, platforms: Platform[], solids: Solid[]) {
    this.M = makeMats();
    this.glowMat = new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc677, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const site of PORT_SITES) this.built.push(this.build(site, platforms, solids));
    // старт — день (night 0): ореоли сховані, поки не стемніє (setNight)
    for (const g of this.lampGlows) {
      g.userData.hide = true;
      g.visible = false;
    }
    scene.add(this.group);
  }

  // ───────────────────────── збірка однієї гавані ─────────────────────────

  private build(p: PortSite, platforms: Platform[], solids: Solid[]): Built {
    const M = this.M;
    const rng = mulberry32(p.seed * 131 + 7);
    const g = new THREE.Group();
    const batch = new Batch();
    const ry = Math.atan2(p.ox, p.oz); // локальний +Z будинку → у море
    const W = (a: number, b: number) => siteToWorld(p, a, b);
    const H = (x: number, z: number) => siteHeight(p, x, z);
    const pick = <K extends keyof Mats>(arr: K[]) => M[arr[Math.floor(rng() * arr.length)]];
    const solidBox = (x: number, z: number, w: number, d: number, r: number) => solids.push({ x, z, hw: w / 2, hd: d / 2, ry: r });
    const solidCircle = (x: number, z: number, r: number) => solids.push({ x, z, r });

    // ── рельєф ──
    g.add(this.terrain(p));

    // ── набережна: кам'яна стінка вздовж краю плато + бруківка ──
    const hw = p.plW / 2;
    {
      const [qx, qz] = W(-0.6, 0);
      batch.add(boxGeo(p.plW, p.plY + 3.2, 1.2, 2), M.stone, T(qx, (p.plY - 3.2) / 2, qz, ry));
      const [cx, cz] = W(-0.55, 0);
      batch.add(boxGeo(p.plW + 0.2, 0.18, 1.4, 2), M.stone, T(cx, p.plY + 0.06, cz, ry));
      // бруківка смугою вздовж набережної
      const [bx, bz] = W(-4.5, 0);
      const cob = new THREE.PlaneGeometry(p.plW - 0.6, 7);
      cob.rotateX(-Math.PI / 2);
      const uv = cob.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (p.plW / 3), uv.getY(i) * 2.3);
      batch.add(cob, M.cobble, T(bx, p.plY + 0.025, bz, ry), false);
    }

    // ── причал на палях ──
    {
      const pr = pierRect(p);
      // дві сходинки біля кореня причалу на набережну (уступ ~0.5 м інакше не переступити);
      // у списку — раніше за сам причал, щоб платформа сходинки мала пріоритет
      for (let k = 2; k >= 1; k--) {
        const y = 1.1 + ((p.plY - 1.1) * k) / 3;
        const a0 = 0.7 * (2 - k);
        platforms.push(siteRect(p, a0, a0 + 0.7, -p.pierW / 2, p.pierW / 2, y));
        const [cx, cz] = W(a0 + 0.35, 0);
        batch.add(boxGeo(p.ox ? 0.7 : p.pierW, y - 0.9, p.ox ? p.pierW : 0.7), M.deck, T(cx, (y + 0.9) / 2, cz));
      }
      platforms.push({ x0: pr.x0, z0: pr.z0, x1: pr.x1, z1: pr.z1, y: pr.y });
      const [mx, mz] = W(p.pierL / 2, 0);
      batch.add(boxGeo(p.pierW, 0.22, p.pierL, 1, 2), M.deck, T(mx, 1.0, mz, ry));
      // балки по краях
      for (const s of [-1, 1]) {
        const [ex, ez] = W(p.pierL / 2, s * (p.pierW / 2 - 0.1));
        batch.add(boxGeo(0.22, 0.3, p.pierL), M.woodDark, T(ex, 0.78, ez, ry));
      }
      // палі
      for (let a = 1.5; a <= p.pierL; a += 4) {
        for (const s of [-1, 1]) {
          const [px, pz] = W(a, s * (p.pierW / 2 - 0.15));
          batch.add(cylGeo(0.17, 0.2, 5.2, 7), M.woodDark, T(px, -1.6, pz));
        }
      }
      // кнехти й кранці біля місць швартування
      for (const bt of siteBerths(p)) {
        const [ba, bb] = worldToSite(p, bt.x, bt.z);
        for (const da of [-3.5, 3.5]) {
          const [kx, kz] = W(ba + da, Math.sign(bb) * (p.pierW / 2 - 0.3));
          batch.add(cylGeo(0.13, 0.16, 0.42, 8), M.iron, T(kx, 1.32, kz));
          batch.add(cylGeo(0.2, 0.2, 0.06, 8), M.iron, T(kx, 1.55, kz));
        }
      }
      // ліхтар на краю причалу
      const [lx, lz] = W(p.pierL - 1, p.pierW / 2 - 0.4);
      this.lampPost(batch, g, lx, lz, 1.1);
    }

    // ── вивіска з назвою біля кореня причалу ──
    {
      const [sx, sz] = W(-1.6, -p.pierW / 2 - 2.2);
      for (const d of [-1.3, 1.3]) {
        const [px, pz] = [sx + -p.oz * d, sz + p.ox * d];
        batch.add(boxGeo(0.14, 2.6, 0.14), M.woodDark, T(px, p.plY + 1.3, pz));
      }
      const board = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 0.9), new THREE.MeshStandardMaterial({ map: signTex(p.name, '⚓'), roughness: 0.8, side: THREE.DoubleSide }));
      board.position.set(sx, p.plY + 2.2, sz);
      board.rotation.y = ry;
      g.add(board);
    }

    // ── будиночки послуг ──
    const used: Array<[number, number, number]> = []; // (a, b, r) — зайняті місця на плато
    for (const s of p.svc) {
      const big = s.kind === 'sleep' || s.kind === 'yard' || s.kind === 'office';
      const w = s.kind === 'fuel' ? 3.2 : big ? 7 : 6;
      const d = s.kind === 'fuel' ? 2.6 : big ? 5.5 : 4.6;
      const ca = s.a - 1.2 - d / 2;
      const [hx, hz] = W(ca, s.b);
      const y0 = Math.min(H(hx, hz), p.plY);
      used.push([ca, s.b, Math.max(w, d) / 2 + 1.5]);
      if (s.kind === 'fuel') {
        // кіоск: будочка + колонка + бочки
        this.house(batch, g, { x: hx, z: hz, y0, ry, w, d, h: 2.6, rh: 0.6, wall: pick(STYLE_WALLS[p.style]), roof: M.roofDark, door: 0, sign: `${s.icon} ${s.name}` }, rng);
        const [cx, cz] = W(s.a - 0.2, s.b + 2.2);
        batch.add(boxGeo(0.6, 1.5, 0.45), M.redPaint, T(cx, y0 + 0.75, cz, ry));
        batch.add(boxGeo(0.5, 0.35, 0.05), M.whitePaint, T(cx + p.ox * 0.24, y0 + 1.15, cz + p.oz * 0.24, ry));
        for (let i = 0; i < 3; i++) {
          const [bx, bz] = W(s.a - 0.8 - i * 0.8, s.b - 2.4);
          batch.add(cylGeo(0.32, 0.32, 0.9, 10), i % 2 ? M.redPaint : M.metalRust, T(bx, y0 + 0.45, bz));
        }
      } else {
        this.house(batch, g, { x: hx, z: hz, y0, ry, w, d, h: big ? 4.8 : 3.2, rh: big ? 1.8 : 1.4, wall: pick(STYLE_WALLS[p.style]), roof: pick(STYLE_ROOFS[p.style]), door: 0, sign: `${s.icon} ${s.name}` }, rng);
      }
      solidBox(hx, hz, (p.ox ? d : w) + 0.3, (p.ox ? w : d) + 0.3, 0);
    }

    // ── план містечка (Гавань Зорі): сходи, каплиця, площа — до загальної забудови ──
    const zPlan = p.id === ZORYA_ID ? zoryaPlan(p, H) : null;
    if (zPlan) used.push(...zPlan.reserved);
    const town: TownCtx = {
      p, g, batch, M: M as unknown as TownCtx['M'], ry, rng, H,
      house: (o) => this.house(batch, g, o, rng),
      lampPost: (x, z, y0) => this.lampPost(batch, g, x, z, y0),
      glow: (x, y, z, size) => this.glow(g, x, y, z, size),
      solidBox: (x, z, w, d) => solidBox(x, z, w, d, 0),
      solidCircle,
    };

    // ── забудова за характером: будинки вглиб плато й на схилах ──
    const free = (a: number, b: number, r: number) => used.every(([ua, ub, ur]) => Math.hypot(a - ua, b - ub) > r + ur);
    const filler = p.size === 'tiny' ? 4 : p.size === 'outpost' ? 3 : p.size === 'medium' ? 8 : 10;
    for (let i = 0, tries = 0; i < filler && tries < 400; tries++) {
      const w = 4.5 + rng() * 3, d = 4 + rng() * 2;
      const r = Math.max(w, d) / 2 + 0.8;
      // вглиб плато або на пологому схилі поруч (село — на березі)
      const a = -p.plD - 18 + rng() * (p.plD + 12), b = (rng() * 2 - 1) * (hw + 16);
      if (a > -7 - r && Math.abs(b) < hw + r) continue; // набережна вільна
      if (!free(a, b, r)) continue;
      const [hx, hz] = W(a, b);
      const cs = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([u, v]) => {
        const [x, z] = W(a + v, b + u);
        return H(x, z);
      });
      const lo = Math.min(...cs), hi = Math.max(...cs);
      if (lo < 0.8 || hi - lo > 1.4 || hi > 14) continue;
      used.push([a, b, r]);
      const tall = p.size !== 'tiny' && rng() < 0.4;
      this.house(batch, g, { x: hx, z: hz, y0: lo, ry, w, d, h: tall ? 5.2 : 3.2, rh: 1.3 + rng() * 0.6, wall: pick(STYLE_WALLS[p.style]), roof: pick(STYLE_ROOFS[p.style]), door: (rng() - 0.5) * (w - 2) }, rng);
      solidBox(hx, hz, (p.ox ? d : w) + 0.3, (p.ox ? w : d) + 0.3, 0);
      i++;
    }

    // ── вуличні ліхтарі вздовж набережної ──
    for (let b = -hw + 4; b <= hw - 4; b += p.size === 'tiny' ? 14 : 12) {
      if (Math.abs(b) < p.pierW / 2 + 2) continue;
      const [lx, lz] = W(-1.8, b);
      this.lampPost(batch, g, lx, lz, p.plY);
      solidCircle(lx, lz, 0.25);
    }

    // ── маяк на мисі ──
    const lp = this.lighthouseSpot(p);
    const lanternPos = this.lighthouse(batch, lp[0], lp[1], H(lp[0], lp[1]), p.style === 'whaling' || p.style === 'north' ? 13 : p.size === 'tiny' ? 7 : 10, p.style === 'resort' ? M.plMint : M.whitePaint, p.style === 'whaling' ? M.iron : p.style === 'med' ? M.domeBlue : M.redPaint);
    solidCircle(lp[0], lp[1], 2.2);
    const lantern = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    lantern.position.copy(lanternPos);
    lantern.scale.setScalar(9);
    g.add(lantern);

    // ── характер ──
    const landSpot = (minH: number, maxH: number, avoidTown = true): [number, number] | null => {
      for (let i = 0; i < 40; i++) {
        const a = -p.R * 1.4 + rng() * p.R * 1.9, b = (rng() * 2 - 1) * p.R * 1.3;
        if (avoidTown && a > -p.plD - 4 && Math.abs(b) < hw + 4) continue;
        const [x, z] = W(a, b);
        const h = H(x, z);
        if (h >= minH && h <= maxH) return [x, z];
      }
      return null;
    };
    if (p.style === 'resort') {
      // пальми, парасольки на пляжі
      for (let i = 0; i < 16; i++) {
        const s = landSpot(0.5, 6);
        if (s) { this.palm(batch, s[0], s[1], H(s[0], s[1]), 0.8 + rng() * 0.5, rng); solidCircle(s[0], s[1], 0.35); }
      }
      for (let i = 0; i < 6; i++) {
        const s = landSpot(0.3, 1.4, true);
        if (!s) continue;
        const y = H(s[0], s[1]);
        batch.add(cylGeo(0.04, 0.04, 2.2, 6), M.iron, T(s[0], y + 1.1, s[1]));
        batch.add(new THREE.ConeGeometry(1.3, 0.5, 8, 1, true), i % 3 === 0 ? M.canvasA : i % 3 === 1 ? M.canvasB : M.canvasC, T(s[0], y + 2.3, s[1]));
      }
      // у містечку — кадки з пальмами вздовж набережної
      for (let b = -hw + 8; b < hw - 6; b += 16) {
        if (Math.abs(b) < p.pierW / 2 + 3) continue;
        const [x, z] = W(-6.5, b + 4);
        this.palm(batch, x, z, p.plY, 0.65, rng);
        solidCircle(x, z, 0.4);
      }
    } else if (p.style === 'med') {
      // Середземномор'я: кипариси, оливи, блакитні куполи над білими будиночками, виноградна пергола на набережній
      for (let i = 0; i < 22; i++) {
        const s = landSpot(2.2, 60);
        if (!s) continue;
        const y = H(s[0], s[1]), k = 0.8 + rng() * 0.6;
        if (rng() < 0.55) {
          batch.add(cylGeo(0.12, 0.16, 1.2 * k, 5), M.trunk, T(s[0], y + 0.5 * k, s[1]));
          batch.add(new THREE.ConeGeometry(0.8 * k, 7 * k, 7), M.cypress, T(s[0], y + 4.2 * k, s[1]));
        } else {
          batch.add(cylGeo(0.15, 0.22, 1.4 * k, 5), M.trunk, T(s[0], y + 0.6 * k, s[1]));
          batch.add(new THREE.IcosahedronGeometry(1.4 * k, 0), M.olive, T(s[0], y + 1.9 * k, s[1], rng() * 6, 0, 0, 1.25, 0.75, 1.15));
        }
        solidCircle(s[0], s[1], 0.45);
      }
      // куполи: на кількох «службових» будинках (над дахом — синя напівсфера на барабані)
      for (const [i, s] of p.svc.entries()) {
        if (i % 2) continue;
        const d = s.kind === 'fuel' ? 2.6 : 5;
        const [x, z] = W(s.a - 1.2 - d / 2, s.b);
        const y = Math.min(H(x, z), p.plY) + 5.6;
        batch.add(cylGeo(1.1, 1.1, 0.7, 14), M.plWhite, T(x, y, z));
        batch.add(new THREE.SphereGeometry(1.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.domeBlue, T(x, y + 0.35, z));
      }
      // пергола з виноградом уздовж набережної
      for (let b = -hw + 6; b < hw - 6; b += 9) {
        if (Math.abs(b) < p.pierW / 2 + 3) continue;
        const [x, z] = W(-7.5, b);
        for (const d of [-1.6, 1.6]) {
          const [px, pz] = W(-7.5, b + d);
          batch.add(boxGeo(0.14, 2.5, 0.14), M.woodDark, T(px, p.plY + 1.25, pz));
          solidCircle(px, pz, 0.2);
        }
        batch.add(boxGeo(1.6, 0.25, 3.8), M.vine, T(x, p.plY + 2.6, z, ry));
      }
    } else if (p.style === 'north') {
      // Північ: густі ялиці, гранітні брили, штабелі колод і сніг на дахах складів
      for (let i = 0; i < 34; i++) {
        const s = landSpot(2.4, 60);
        if (s) { this.pineTree(batch, s[0], s[1], H(s[0], s[1]), 0.8 + rng() * 0.8); solidCircle(s[0], s[1], 0.5); }
      }
      for (let i = 0; i < 4; i++) {
        const [x, z] = W(-9 - (i % 2) * 2.2, -hw + 5 + Math.floor(i / 2) * 3);
        for (let r = 0; r < 3; r++) batch.add(cylGeo(0.28, 0.28, 4.2, 8), M.trunk, T(x, p.plY + 0.3 + r * 0.5, z + (r % 2) * 0.25, ry, 0, Math.PI / 2));
        solidCircle(x, z, 1.4);
      }
    } else {
      const n = p.size === 'tiny' ? 14 : p.style === 'whaling' ? 10 : 26;
      for (let i = 0; i < n; i++) {
        const s = landSpot(2.2, 40);
        if (s) { this.pineTree(batch, s[0], s[1], H(s[0], s[1]), 0.7 + rng() * 0.7); solidCircle(s[0], s[1], 0.5); }
      }
    }
    if (p.style === 'whaling') {
      // китова арка з ребер і великий сарай-салотопня з трубою
      const [ax, az] = W(-6, -hw + 5);
      for (const s of [-1, 1]) {
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(s * 1.9, 0, 0), new THREE.Vector3(s * 2.3, 3.5, 0), new THREE.Vector3(s * 0.2, 5.4, 0));
        batch.add(new THREE.TubeGeometry(curve, 10, 0.2, 6, false), M.bone, T(ax, p.plY, az, ry + Math.PI / 2));
      }
      const [sx, sz] = W(-p.plD + 7, hw - 9);
      this.house(batch, g, { x: sx, z: sz, y0: p.plY, ry, w: 10, d: 7, h: 5, rh: 1.6, wall: M.sdTar, roof: M.metalRust, door: -2 }, rng);
      solidBox(sx, sz, (p.ox ? 7 : 10) + 0.3, (p.ox ? 10 : 7) + 0.3, 0);
      const [cx, cz] = W(-p.plD + 5, hw - 5);
      batch.add(cylGeo(0.55, 0.7, 12, 10), M.stoneDark, T(cx, p.plY + 6, cz));
      solidCircle(cx, cz, 0.9);
    }
    if (p.style === 'village') {
      // сушарки сіток і перекинутий човен
      for (let i = 0; i < 3; i++) {
        const [x, z] = W(-9 - i * 1.5, -hw + 4 + i * 3);
        batch.add(boxGeo(0.1, 1.6, 0.1), M.woodDark, T(x, p.plY + 0.8, z));
        batch.add(boxGeo(2.4, 1.2, 0.04), M.rope, T(x, p.plY + 1.0, z, ry + Math.PI / 2));
      }
      const [bx, bz] = W(-5.5, hw - 4);
      batch.add(boxGeo(1.4, 0.5, 4.2), M.sdBlue, T(bx, p.plY + 0.25, bz, ry));
    }

    // ── Рибальський Кут: хатки на палях, місток, сушарки, мешканці (kutVillage.ts) ──
    let life: VillageLife | undefined;
    if (p.id === 'port-kut') {
      life = buildKutVillage({ p, g, batch, M, H, platforms, solids, rng, lampPost: (x, z, y0) => this.lampPost(batch, g, x, z, y0), glow: (x, y, z, s) => this.glow(g, x, y, z, s) });
    }
    if (zPlan) buildZoryaStatic(town, zPlan);
    // ── Китобійня «Край світу»: сліп, котли, бочки, гарпуни, ребра кита (krayStation.ts) ──
    const kCtx: KrayCtx | null = p.id === KRAY_ID
      ? { p, g, batch, M: M as unknown as KrayCtx['M'], rng, H, platforms, solids, lampPost: (x, z, y0) => this.lampPost(batch, g, x, z, y0), glow: (x, y, z, s) => this.glow(g, x, y, z, s) }
      : null;
    const kPlan: KrayPlan | null = kCtx ? buildKrayStatic(kCtx) : null;

    // ── злити ──
    batch.build(g);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.receiveShadow = true;
    });
    // решту окремих мешів (вивіски, ліхтарі, дрібниці з власними матеріалами) — теж докупи
    mergeStatic(g, { skip: [lantern] });
    // живе — після злиття (рухається), окремою групою
    let zorya: ZoryaLife | undefined;
    if (zPlan) {
      zorya = new ZoryaLife(town, zPlan);
      zorya.onBell = (v) => this.onBell?.(v);
      zorya.onSay = (s) => this.onSay?.(s);
      g.add(zorya.group);
    }
    let kray: KrayLife | undefined;
    if (kCtx && kPlan) {
      kray = new KrayLife(kCtx, kPlan);
      kray.onSay = (s) => this.onSay?.(s);
      g.add(kray.group);
    }
    this.group.add(g);
    return { site: p, group: g, lantern, lanternPos, phase: rng() * 6, life, zorya, kray };
  }

  /** точка для маяка: на краю суходолу поруч із гаванню, на сухому */
  private lighthouseSpot(p: PortSite): [number, number] {
    let best: [number, number] = siteToWorld(p, -4, -p.plW / 2 - 6);
    let bestScore = -1e9;
    for (let i = 0; i < 48; i++) {
      const s = i % 2 ? 1 : -1;
      const a = -2 - (i >> 1) * 1.2;
      const b = s * (p.plW / 2 + 6 + (i % 5) * 2);
      const [x, z] = siteToWorld(p, a, b);
      const h = siteHeight(p, x, z);
      if (h < 1.2) continue;
      // ближче до води (a ↑) і не надто високо
      const score = a * 0.6 - Math.abs(h - 4) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = [x, z];
      }
    }
    return best;
  }

  // ───────────────────────── рельєф ─────────────────────────

  private terrain(p: PortSite): THREE.Mesh {
    const R = p.R * Math.sqrt(p.elong) * 1.7 + 24;
    const step = 2.5;
    const n = Math.ceil((R * 2) / step) + 1;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const hs = new Float32Array(n * n);
    const grassA = new THREE.Color(p.style === 'whaling' ? 0x7e8a5e : p.style === 'resort' ? 0x8fae5a : p.style === 'med' ? 0xa8a463 : p.style === 'north' ? 0x4d6b3e : 0x6f9447);
    const grassB = new THREE.Color(p.style === 'whaling' ? 0x66704c : p.style === 'med' ? 0x8e9450 : p.style === 'north' ? 0x3a5533 : 0x557a37);
    const sand = new THREE.Color(p.style === 'resort' || p.style === 'med' ? 0xeedcb0 : p.style === 'north' ? 0xa8a49a : 0xdcc9a0);
    const wet = new THREE.Color(0xa39274), bed = new THREE.Color(0x5d6655);
    const rock = new THREE.Color(0x8a867d), rockD = new THREE.Color(0x66625c), town = new THREE.Color(0xb9ad95);
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = p.x - R + i * step, z = p.z - R + j * step;
        const h = siteHeight(p, x, z);
        const k = j * n + i;
        hs[k] = h;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / 6;
        uv[k * 2 + 1] = z / 6;
        const sl = Math.hypot(siteHeight(p, x + 1.5, z) - siteHeight(p, x - 1.5, z), siteHeight(p, x, z + 1.5) - siteHeight(p, x, z - 1.5)) / 3;
        c.copy(grassA).lerp(grassB, smoothstep(0.35, 0.7, fbm(x * 0.03 + p.seed, z * 0.03, 3)));
        c.lerp(sand, smoothstep(1.9, 1.0, h));
        if (Math.abs(h - p.plY) < 0.02 && sl < 0.05) c.copy(town);
        if (h < 0.3) c.copy(wet).lerp(bed, smoothstep(0.1, -2.5, h));
        c.lerp(noise2(x * 0.1, z * 0.1) > 0.5 ? rock : rockD, smoothstep(0.75, 1.15, sl) * 0.85 + (p.style === 'whaling' ? smoothstep(8, 16, h) * 0.6 : 0));
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, cc = a + n, dd = cc + 1;
        if (Math.max(hs[a], hs[b], hs[cc], hs[dd]) < -5) continue;
        idx.push(a, cc, b, b, cc, dd);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.M.ground);
    m.receiveShadow = true;
    return m;
  }

  // ───────────────────────── будинок ─────────────────────────

  private house(batch: Batch, g: THREE.Group, o: { x: number; z: number; y0: number; ry: number; w: number; d: number; h: number; rh: number; wall: THREE.Material; roof: THREE.Material; door?: number; sign?: string }, rng: () => number) {
    const M = this.M;
    const base = T(o.x, o.y0, o.z, o.ry);
    const at = (x: number, y: number, z: number, ry = 0, rx = 0) => base.clone().multiply(T(x, y, z, ry, rx));
    const { w, d, h, rh } = o;
    const B = 0.3;
    batch.add(boxGeo(w + 0.3, 0.9, d + 0.3, 1.5), M.stoneDark, at(0, B - 0.45, 0));
    batch.add(gableBodyGeo(w, d, h, rh, 2), o.wall, at(0, B, 0));
    const a = Math.atan2(rh, d / 2);
    const ov = 0.4, t = 0.16, Wd = w + 0.6;
    const L = Math.hypot(d / 2, rh) + ov;
    const slab = roofSlabGeo(L, t, Wd, 2).rotateY(-Math.PI / 2);
    const ridgeY = B + h + rh;
    for (const s of [1, -1]) {
      const cz = s * Math.cos(a) * (L / 2) + s * Math.sin(a) * (t / 2);
      const cy = ridgeY - Math.sin(a) * (L / 2) + Math.cos(a) * (t / 2);
      batch.add(slab, o.roof, at(0, cy, cz, 0, s * a));
    }
    batch.add(boxGeo(Wd + 0.04, 0.16, 0.3), o.roof, at(0, ridgeY + 0.1, 0));
    // вікна фасаду й заду
    const rows = h >= 4.6 ? [B + 1.4, B + h - 1.2] : [B + h * 0.55 + 0.05];
    const win = (lx: number, ly: number, lz: number, r: number) => {
      const m = at(lx, ly, lz, r);
      batch.add(boxGeo(0.95, 1.25, 0.08), M.trim, m);
      batch.add(new THREE.PlaneGeometry(0.78, 1.08), rng() < 0.6 ? M.glassLit : M.glassDark, m.clone().multiply(T(0, 0, 0.045)), false);
    };
    const nW = Math.max(1, Math.floor((w - 1.2) / 2.2));
    for (const ly of rows) {
      for (let i = 0; i < nW; i++) {
        const lx = -w / 2 + (w / (nW + 1)) * (i + 1);
        if (o.door != null && ly < B + 2.5 && Math.abs(lx - o.door) < 1.2) continue;
        win(lx, ly, d / 2, 0);
        if (rng() < 0.6) win(lx, ly, -d / 2, Math.PI);
      }
    }
    if (o.door != null) {
      batch.add(boxGeo(1.25, 2.2, 0.07), M.trim, at(o.door, B + 1.07, d / 2));
      batch.add(boxGeo(1.0, 2.0, 0.1), M.woodDark, at(o.door, B + 1.0, d / 2 + 0.02));
      const lpm = at(o.door + 0.85, B + 2.1, d / 2 + 0.15);
      batch.add(boxGeo(0.15, 0.22, 0.15), M.lamp, lpm, false);
      const wp = new THREE.Vector3().setFromMatrixPosition(lpm);
      this.glow(g, wp.x, wp.y, wp.z, 1.3);
    }
    if (o.sign) {
      const sw = Math.min(w - 0.4, 3.4);
      const mat = new THREE.MeshStandardMaterial({ map: signTex(o.sign), roughness: 0.8 });
      const sgn = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.27), mat);
      sgn.applyMatrix4(at(o.door ?? 0, B + Math.min(h - 0.4, 2.75), d / 2 + 0.09));
      g.add(sgn);
    }
  }

  private lampPost(batch: Batch, g: THREE.Group, x: number, z: number, y0: number) {
    const M = this.M;
    batch.add(cylGeo(0.07, 0.1, 3.4, 8), M.iron, T(x, y0 + 1.7, z));
    batch.add(boxGeo(0.28, 0.38, 0.28), M.lamp, T(x, y0 + 3.6, z, Math.PI / 4), false);
    batch.add(new THREE.ConeGeometry(0.3, 0.24, 4), M.iron, T(x, y0 + 3.92, z));
    this.glow(g, x, y0 + 3.6, z, 2.6);
  }

  private glow(g: THREE.Group, x: number, y: number, z: number, size: number) {
    const s = new THREE.Sprite(this.glowMat);
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    g.add(s);
    this.lampGlows.push(s);
  }

  /** маяк; повертає позицію ліхтаря */
  private lighthouse(batch: Batch, x: number, z: number, y0: number, hgt: number, band: THREE.Material, band2: THREE.Material): THREE.Vector3 {
    const M = this.M;
    batch.add(cylGeo(2.0, 2.3, 1.2, 14, 1.5), M.stoneDark, T(x, y0 + 0.3, z));
    const n = 4;
    for (let i = 0; i < n; i++) {
      const hh = hgt / n;
      const r0 = 1.45 - (0.35 * i) / n, r1 = 1.45 - (0.35 * (i + 1)) / n;
      batch.add(cylGeo(r1, r0, hh, 14, 1.5), i % 2 ? band2 : band, T(x, y0 + 0.9 + hh * (i + 0.5), z));
    }
    const top = y0 + 0.9 + hgt;
    batch.add(cylGeo(1.5, 1.5, 0.16, 14), M.iron, T(x, top + 0.08, z));
    batch.add(cylGeo(0.75, 0.75, 1.3, 10), M.lens, T(x, top + 0.8, z), false);
    batch.add(new THREE.ConeGeometry(1.0, 0.9, 10), M.redPaint, T(x, top + 1.9, z));
    return new THREE.Vector3(x, top + 0.8, z);
  }

  private pineTree(batch: Batch, x: number, z: number, y: number, s: number) {
    const M = this.M;
    batch.add(cylGeo(0.16 * s, 0.24 * s, 2 * s, 6), M.trunk, T(x, y + s, z));
    batch.add(new THREE.ConeGeometry(2.0 * s, 3.4 * s, 7), M.pine, T(x, y + 2.9 * s, z));
    batch.add(new THREE.ConeGeometry(1.5 * s, 3.0 * s, 7), M.pine, T(x, y + 4.5 * s, z));
    batch.add(new THREE.ConeGeometry(1.0 * s, 2.5 * s, 7), M.pine, T(x, y + 6.0 * s, z));
  }

  private palm(batch: Batch, x: number, z: number, y: number, s: number, rng: () => number) {
    const M = this.M;
    const ry = rng() * 6.28;
    const lean = 0.25 + rng() * 0.2;
    const H = 5.4 * s;
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, H * 0.55, 0), new THREE.Vector3(lean * H, H, 0));
    batch.add(new THREE.TubeGeometry(curve, 8, 0.16 * s, 6, false), M.trunk, T(x, y, z, ry));
    const top = curve.getPoint(1);
    for (let k = 0; k < 7; k++) {
      const m = T(x, y, z, ry).multiply(T(top.x, top.y + 0.05, 0, (k / 7) * Math.PI * 2)).multiply(T(0, -0.3 * s, 1.05 * s, 0, 0.45));
      batch.add(boxGeo(0.5 * s, 0.04, 2.3 * s), M.leaf, m);
    }
  }

  // ───────────────────────── кадр ─────────────────────────

  setNight(night: number) {
    if (Math.abs(night - this.night) < 0.01) return;
    this.night = night;
    this.M.glassLit.emissiveIntensity = night * 1.1;
    this.M.lamp.emissiveIntensity = 0.05 + night * 1.6;
    this.M.lens.emissiveIntensity = 0.3 + night * 1.8;
    this.glowMat.opacity = night * 0.85;
    // удень ореоли ліхтарів невидимі (opacity 0) — не витрачаємо на них виклики малювання
    for (const g of this.lampGlows) {
      g.userData.hide = night <= 0.02;
      g.visible = !g.userData.hide;
    }
  }

  private lastT = -1;

  update(t: number, cam: THREE.Vector3, hours = 12) {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    for (const b of this.built) {
      b.life?.update(dt, t, cam, this.night);
      b.kray?.update(dt, t, cam, this.night);
      const d = Math.hypot(cam.x - b.site.x, cam.z - b.site.z);
      // далеко за туманом — не малюємо (вогник маяка лишається видно)
      b.group.visible = d < 1500;
      const blink = 0.5 + 0.5 * Math.sin(t * 1.6 + b.phase);
      b.lantern.material.opacity = this.night * (0.35 + 0.65 * blink * blink);
      b.lantern.visible = this.night > 0.05;
      if (!b.group.visible && b.lantern.visible) {
        // маяк видно здалеку й без самої гавані
        b.group.visible = true;
        b.group.children.forEach((c) => (c.visible = c === b.lantern));
        b.lantern.scale.setScalar(Math.min(60, 9 + d * 0.02));
      } else {
        // userData.hide — дитина сама ховається; ореоли ліхтарів — лише вночі (удень прозорі, а виклик малювання коштують)
        const glowOn = this.night > 0.02;
        b.group.children.forEach((c) => (c.visible = !c.userData.hide && ((c as THREE.Sprite).isSprite && c !== b.lantern ? glowOn : true)));
        b.lantern.scale.setScalar(Math.min(40, 9 + d * 0.015));
      }
      // містечко живе (і дзвонить) лише поки гавань видно
      if (b.zorya && b.group.visible && d < 1500) b.zorya.update(t, cam, hours, this.night);
    }
  }

  /** послуги всіх гаваней (для гравця й карти) */
  static services() {
    return PORT_SITES.flatMap((p) => siteServices(p).map((s) => ({ ...s, site: p })));
  }
}

/** вивіска: темна дошка, світлий напис */
function signTex(text: string, icon = ''): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 140;
  const x = c.getContext('2d')!;
  x.fillStyle = '#3b2a1d';
  x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#d8b878';
  x.lineWidth = 8;
  x.strokeRect(8, 8, c.width - 16, c.height - 16);
  x.fillStyle = '#f6ecd6';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  let size = 58;
  const label = icon ? `${icon} ${text}` : text;
  do {
    x.font = `800 ${size}px Manrope, -apple-system, "Segoe UI", sans-serif`;
    size -= 2;
  } while (x.measureText(label).width > c.width - 50 && size > 20);
  x.fillText(label, c.width / 2, c.height / 2 + 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
