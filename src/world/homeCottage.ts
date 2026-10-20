import * as THREE from 'three';
import { boxGeo, gableBodyGeo, roofSlabGeo } from './portKit';
import { GROUND_Y } from './portTerrain';
import { planksTex, plasterTex, roofTilesTex, stoneTex, windowGlowTex, windowTex } from './textures';
import { COTTAGE, COTTAGE_BED, COTTAGE_BOARD } from './cottageLayout';

// ─────────────────────────────────────────────────────────────
// Хата рибалки, у яку можна зайти: кремові стіни, червона черепиця,
// сині віконниці; всередині — ліжко з ковдрою, чавунна пічка, стіл
// із чайником, килим, полиця, лампа під стелею й стенд «журнал
// капітана» (canvas від ui/statsBoard.ts). Окрема група з власними
// мешами — стіни справжні (з дверним прорізом), видно з обох боків.
// ─────────────────────────────────────────────────────────────

const C = COTTAGE;
const B = C.floorY; // рівень підлоги
const G = GROUND_Y;

export interface CottageSolid {
  x: number;
  z: number;
  w: number;
  d: number;
}

export class HomeCottage {
  readonly group = new THREE.Group();
  /** верх комина (світові координати) — для диму */
  readonly chimneyTop = new THREE.Vector3();
  /** стіни й меблі — тверді для гравця (світові координати, без повороту) */
  readonly solids: CottageSolid[] = [];
  /** площина стенда, на яку кладемо canvas-текстуру */
  readonly boardMesh: THREE.Mesh;
  private winMats: THREE.MeshStandardMaterial[] = [];
  private lampMat: THREE.MeshStandardMaterial;
  private fireMat: THREE.MeshStandardMaterial;
  private lamp: THREE.PointLight;
  private t = 0;

  constructor(parent: THREE.Object3D, boardTex: THREE.Texture) {
    const g = this.group;
    g.position.set(C.x, 0, C.z);
    parent.add(g);

    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...p });
    const planks = planksTex();
    const plaster = plasterTex();
    const M = {
      wall: std({ map: plaster, color: 0xf2e3c2 }),
      inner: std({ map: plaster, color: 0xf6ead2 }),
      wainscot: std({ map: planks, color: 0x9a6b44 }),
      floor: std({ map: planks, color: 0xa77a4f }),
      roof: std({ map: roofTilesTex(), color: 0xc9694a, roughness: 0.85 }),
      beam: std({ map: planks, color: 0x6a4f35, roughness: 0.95 }),
      stone: std({ map: stoneTex(), color: 0x9a9284 }),
      trim: std({ color: 0xf4f1e8, roughness: 0.8 }),
      shutter: std({ color: 0x3d6f9c, roughness: 0.75 }),
      door: std({ map: planks, color: 0x3f7258 }),
      iron: std({ color: 0x24292d, roughness: 0.5, metalness: 0.6 }),
      wood: std({ map: planks, color: 0x8a6240 }),
      woodDark: std({ map: planks, color: 0x5a412b }),
      linen: std({ color: 0xf3ecdc, roughness: 0.95 }),
      quilt: std({ map: quiltTex(), roughness: 0.95 }),
      rug: std({ map: rugTex(), roughness: 1 }),
      brass: std({ color: 0xc9a227, roughness: 0.35, metalness: 0.8 }),
      teapot: std({ color: 0x2f6f8f, roughness: 0.4 }),
      coat: std({ color: 0xf2c12e, roughness: 0.7 }),
      book: [0x9a3a2c, 0x2f5f8f, 0x3f7258, 0xc9a227, 0x6b4a32].map((c) => std({ color: c, roughness: 0.8 })),
    };
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = cast;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const box = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, tile = 1, cast = true) =>
      mesh(boxGeo(w, h, d, tile), mat, x, y, z, ry, cast);
    const solid = (x: number, z: number, w: number, d: number) => this.solids.push({ x: C.x + x, z: C.z + z, w, d });

    const hw = C.w / 2, hd = C.d / 2, t = C.t;
    const wallH = C.h;
    const yMid = B + wallH / 2;
    const base = G - 0.15; // стіни йдуть трохи в землю
    const fullH = B + wallH - base;
    const fullMid = base + fullH / 2;

    // ── підлога, цоколь, поріг ──
    box(M.stone, C.w + 0.3, B - base, C.d + 0.3, 0, (B + base) / 2, 0, 0, 1.5);
    box(M.floor, C.w - t * 2, 0.04, C.d - t * 2, 0, B + 0.02, 0, 0, 1.2, false);
    box(M.stone, 1.7, 0.16, 0.8, 0, G + 0.08, hd + 0.45, 0, 1.2);

    // ── стіни: задня, бічні з фронтонами, фасад із прорізом ──
    box(M.wall, C.w, fullH, t, 0, fullMid, -hd + t / 2, 0, 2);
    solid(0, -hd + t / 2, C.w, t + 0.1);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(gableBodyGeo(t, C.d, wallH + (B - base), C.rh, 2), M.wall);
      side.position.set(sx * (hw - t / 2), base, 0);
      side.castShadow = true;
      side.receiveShadow = true;
      g.add(side);
      solid(sx * (hw - t / 2), 0, t + 0.1, C.d);
    }
    const dw = C.doorW;
    const segW = (C.w - dw) / 2;
    for (const sx of [-1, 1]) {
      box(M.wall, segW, fullH, t, sx * (dw / 2 + segW / 2), fullMid, hd - t / 2, 0, 2);
      solid(sx * (dw / 2 + segW / 2), hd - t / 2, segW, t + 0.1);
    }
    const lintelH = B + wallH - (B + C.doorH);
    box(M.wall, dw, lintelH, t, 0, B + C.doorH + lintelH / 2, hd - t / 2, 0, 2);

    // внутрішнє оздоблення: дерев'яна панель знизу, світлий тиньк над нею
    const panel = (w: number, x: number, z: number, ry: number) => {
      box(M.wainscot, w, 1.0, 0.03, x, B + 0.5, z, ry, 1, false);
      box(M.inner, w, wallH - 1.0, 0.02, x, B + 1.0 + (wallH - 1.0) / 2, z, ry, 2, false);
      box(M.woodDark, w, 0.06, 0.06, x, B + 1.02, z, ry, 1, false);
    };
    panel(C.w - t * 2, 0, -hd + t + 0.016, 0);
    for (const sx of [-1, 1]) panel(C.d - t * 2, sx * (hw - t - 0.016), 0, Math.PI / 2);
    for (const sx of [-1, 1]) panel(segW - t, sx * (dw / 2 + (segW - t) / 2), hd - t - 0.016, 0);

    // ── дах (схили до фасаду й до задньої стіни), гребінь, балки ──
    const a = Math.atan2(C.rh, hd);
    const ov = 0.45;
    const L = Math.hypot(hd, C.rh) + ov;
    const rt = 0.16;
    const W = C.w + 0.7;
    const ridgeY = B + wallH + C.rh;
    for (const s of [1, -1]) {
      const slab = new THREE.Mesh(roofSlabGeo(L, rt, W, 2).rotateY(-Math.PI / 2), M.roof);
      const cz = s * Math.cos(a) * (L / 2) + s * Math.sin(a) * (rt / 2);
      const cy = ridgeY - Math.sin(a) * (L / 2) + Math.cos(a) * (rt / 2);
      slab.position.set(0, cy, cz);
      slab.rotation.x = s * a;
      slab.castShadow = true;
      slab.receiveShadow = true;
      g.add(slab);
      // підшивка — дерев'яна стеля між кроквами
      const under = new THREE.Mesh(boxGeo(W - 0.75, 0.03, L - ov - 0.1, 1.2), M.beam);
      under.rotation.order = 'YXZ';
      under.position.set(0, cy - Math.cos(a) * 0.12, cz - s * Math.sin(a) * 0.12 - s * 0.18);
      under.rotation.x = s * a;
      g.add(under);
    }
    box(M.roof, W + 0.04, 0.18, 0.32, 0, ridgeY + 0.12, 0);
    box(M.beam, C.w - t * 2, 0.14, 0.14, 0, ridgeY - 0.12, 0, 0, 1, false);
    for (const x of [-1.6, 0, 1.6]) box(M.beam, 0.14, 0.14, C.d - t * 2, x, B + wallH - 0.08, 0, 0, 1, false);

    // ── комин над пічкою ──
    const chx = 1.55, chz = -1.55;
    const roofAt = ridgeY - (Math.abs(chz) / hd) * C.rh;
    const chTop = roofAt + 1.0;
    const chH = chTop - (B + wallH - 0.3);
    box(M.stone, 0.62, chH, 0.62, chx, chTop - chH / 2, chz, 0, 1.2);
    box(M.stone, 0.8, 0.12, 0.8, chx, chTop + 0.06, chz);
    this.chimneyTop.set(C.x + chx, chTop + 0.2, C.z + chz);

    // ── вікна (з обох боків стіни: скло, рама, віконниці зовні) ──
    const winY = B + 1.75;
    const win = (x: number, z: number, ry: number) => {
      const out = new THREE.Group();
      out.position.set(x, winY, z);
      out.rotation.y = ry;
      g.add(out);
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, py, pz);
        m.receiveShadow = true;
        out.add(m);
      };
      const glass = std({ map: windowTex(), emissiveMap: windowGlowTex(), emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.25, metalness: 0.1 });
      this.winMats.push(glass);
      // зовні
      add(boxGeo(0.98, 1.32, 0.08), M.trim, 0, 0, t / 2 + 0.02);
      add(new THREE.PlaneGeometry(0.8, 1.14), glass, 0, 0, t / 2 + 0.065);
      add(boxGeo(1.12, 0.07, 0.2), M.trim, 0, -0.68, t / 2 + 0.08);
      add(boxGeo(0.44, 1.24, 0.05), M.shutter, -0.74, 0, t / 2 + 0.06);
      add(boxGeo(0.44, 1.24, 0.05), M.shutter, 0.74, 0, t / 2 + 0.06);
      // всередині: денне світло з вікна, рама й підвіконня
      const inGlass = std({ color: 0xdfeefa, emissive: 0xcfe6f7, emissiveIntensity: 0.55, roughness: 0.3 });
      this.inWinMats.push(inGlass);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.14), inGlass);
      p.position.set(0, 0, -t / 2 - 0.035);
      p.rotation.y = Math.PI;
      out.add(p);
      for (const sy of [-1, 1]) add(boxGeo(0.98, 0.09, 0.05), M.woodDark, 0, sy * 0.615, -t / 2 - 0.025);
      for (const sx2 of [-1, 1]) add(boxGeo(0.09, 1.32, 0.05), M.woodDark, sx2 * 0.445, 0, -t / 2 - 0.025);
      add(boxGeo(0.06, 1.14, 0.05), M.woodDark, 0, 0, -t / 2 - 0.05);
      add(boxGeo(0.8, 0.06, 0.05), M.woodDark, 0, 0.1, -t / 2 - 0.05);
      add(boxGeo(1.1, 0.06, 0.22), M.wood, 0, -0.68, -t / 2 - 0.1);
    };
    win(-1.75, hd - t / 2, 0);
    win(1.75, hd - t / 2, 0);
    win(-0.55, -hd + t / 2, Math.PI);
    win(-hw + t / 2, 1.0, -Math.PI / 2);

    // ── двері: прочинені всередину, дашок і ліхтар над входом ──
    box(M.trim, 0.12, C.doorH + 0.1, t + 0.06, -dw / 2 - 0.06, B + C.doorH / 2, hd - t / 2);
    box(M.trim, 0.12, C.doorH + 0.1, t + 0.06, dw / 2 + 0.06, B + C.doorH / 2, hd - t / 2);
    box(M.trim, dw + 0.24, 0.12, t + 0.06, 0, B + C.doorH + 0.06, hd - t / 2);
    const leaf = new THREE.Group();
    // завіси праворуч: двері відчинені всередину й лежать уздовж стіни
    leaf.position.set(dw / 2 - 0.02, B, hd - t - 0.05);
    leaf.rotation.y = 0.22;
    g.add(leaf);
    const dl = new THREE.Mesh(boxGeo(dw - 0.04, C.doorH - 0.04, 0.06), M.door);
    dl.position.set((dw - 0.04) / 2, (C.doorH - 0.04) / 2, 0);
    dl.castShadow = true;
    leaf.add(dl);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M.brass);
    knob.position.set(dw - 0.14, 1.0, 0.05);
    leaf.add(knob);
    box(M.roof, 1.6, 0.08, 0.7, 0, B + C.doorH + 0.32, hd + 0.3, 0);
    this.lampMat = std({ color: 0xfff1c8, emissive: 0xffc977, emissiveIntensity: 0.1, roughness: 0.2 });
    box(this.lampMat, 0.16, 0.24, 0.16, dw / 2 + 0.38, B + C.doorH + 0.05, hd + 0.08, 0, 1, false);
    box(M.iron, 0.22, 0.05, 0.22, dw / 2 + 0.38, B + C.doorH + 0.19, hd + 0.08);

    // ── інтер'єр ──
    const lx = (wx: number) => wx - C.x;
    const lz = (wz: number) => wz - C.z;
    // ліжко
    {
      const bx = lx(COTTAGE_BED.x), bz = lz(COTTAGE_BED.z), bw = COTTAGE_BED.w, bl = COTTAGE_BED.len;
      box(M.woodDark, bw, 0.32, bl, bx, B + 0.24, bz);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(M.woodDark, 0.08, 0.2, 0.08, bx + sx * (bw / 2 - 0.05), B + 0.1, bz + sz * (bl / 2 - 0.05));
      box(M.woodDark, bw + 0.06, 1.0, 0.08, bx, B + 0.5, bz - bl / 2 - 0.02);
      box(M.woodDark, bw + 0.06, 0.6, 0.08, bx, B + 0.3, bz + bl / 2 + 0.02);
      box(M.linen, bw - 0.08, 0.18, bl - 0.08, bx, B + 0.48, bz);
      box(M.quilt, bw - 0.02, 0.07, bl * 0.62, bx, B + 0.6, bz + bl * 0.17);
      box(M.linen, 0.7, 0.14, 0.38, bx, B + 0.64, bz - bl / 2 + 0.3);
      solid(bx, bz, bw + 0.1, bl + 0.1);
      // тумбочка зі свічкою
      const nx = bx + bw / 2 + 0.3, nz = bz - bl / 2 + 0.25;
      box(M.wood, 0.42, 0.55, 0.42, nx, B + 0.275, nz);
      box(M.linen, 0.07, 0.14, 0.07, nx, B + 0.62, nz, 0, 1, false);
      this.candle = box(std({ color: 0xffe2a0, emissive: 0xffb050, emissiveIntensity: 1.2 }), 0.03, 0.05, 0.03, nx, B + 0.72, nz, 0, 1, false);
      solid(nx, nz, 0.45, 0.45);
      // трофейна риба над ліжком
      box(M.woodDark, 0.9, 0.36, 0.04, bx, B + 2.1, -hd + t + 0.05);
      const fish = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 8), std({ color: 0x8fa9b3, roughness: 0.35, metalness: 0.4 }));
      fish.scale.set(1.25, 0.42, 0.18);
      fish.position.set(bx - 0.05, B + 2.1, -hd + t + 0.1);
      g.add(fish);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.24, 4), fish.material);
      tail.rotation.z = Math.PI / 2;
      tail.scale.set(1, 1, 0.25);
      tail.position.set(bx + 0.4, B + 2.1, -hd + t + 0.1);
      g.add(tail);
    }
    // пічка в задньому правому куті, труба — до комина
    {
      const sx = chx, sz = -hd + t + 0.45;
      box(M.stone, 1.0, 0.08, 0.9, sx, B + 0.04, sz + 0.05);
      box(M.iron, 0.66, 0.72, 0.56, sx, B + 0.44, sz);
      box(M.iron, 0.72, 0.05, 0.62, sx, B + 0.82, sz);
      this.fireMat = std({ color: 0x3a1a0a, emissive: 0xff7a2a, emissiveIntensity: 1.4, roughness: 0.6 });
      box(this.fireMat, 0.34, 0.22, 0.02, sx, B + 0.4, sz + 0.285, 0, 1, false);
      const pipeTop = roofAt - 0.2;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, pipeTop - (B + 0.85), 10), M.iron);
      pipe.position.set(sx, (pipeTop + B + 0.85) / 2, sz);
      g.add(pipe);
      // чайник на плиті
      const pot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), M.teapot);
      pot.scale.y = 0.8;
      pot.position.set(sx - 0.12, B + 0.93, sz);
      g.add(pot);
      // дрова
      for (let i = 0; i < 4; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 7), M.wood);
        log.rotation.z = Math.PI / 2;
        log.position.set(sx - 0.75, B + 0.07 + Math.floor(i / 2) * 0.11, sz - 0.08 + (i % 2) * 0.13 + Math.floor(i / 2) * 0.06);
        g.add(log);
      }
      solid(sx, sz, 0.9, 0.8);
      solid(sx - 0.75, sz, 0.55, 0.4);
    }
    // стіл і два стільці біля фасадного вікна (ліворуч від дверей)
    {
      const tx = -1.75, tz = hd - t - 0.82;
      box(M.wood, 1.2, 0.06, 0.78, tx, B + 0.76, tz);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(M.woodDark, 0.07, 0.73, 0.07, tx + sx * 0.52, B + 0.365, tz + sz * 0.32);
      const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 10), M.trim);
      mug.position.set(tx + 0.25, B + 0.84, tz - 0.1);
      g.add(mug);
      const pot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), M.teapot);
      pot.scale.y = 0.85;
      pot.position.set(tx - 0.2, B + 0.86, tz);
      g.add(pot);
      // розгорнута карта на столі
      box(std({ color: 0xefe6d4, roughness: 0.95 }), 0.5, 0.005, 0.34, tx + 0.05, B + 0.795, tz + 0.15, 0.2, 1, false);
      for (const sz of [-1, 1]) {
        const cx = tx + sz * 0.12, cz = tz + sz * 0.6;
        box(M.wood, 0.42, 0.05, 0.42, cx, B + 0.46, cz);
        box(M.wood, 0.42, 0.5, 0.05, cx, B + 0.72, cz + sz * 0.19);
        for (const a2 of [-1, 1]) for (const b2 of [-1, 1]) box(M.woodDark, 0.04, 0.44, 0.04, cx + a2 * 0.17, B + 0.22, cz + b2 * 0.17);
      }
      solid(tx, tz, 1.3, 1.6);
    }
    // килим посередині
    {
      const rug = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), M.rug);
      rug.rotation.x = -Math.PI / 2;
      rug.scale.set(1.3, 1, 1);
      rug.position.set(0.1, B + 0.045, -0.15);
      rug.receiveShadow = true;
      g.add(rug);
    }
    // полиця з книжками на лівій стіні над ліжком
    {
      const px = -hw + t + 0.14, pz = -0.75;
      box(M.woodDark, 0.24, 0.04, 1.2, px, B + 1.7, pz, 0, 1, false);
      let z = pz - 0.5;
      for (let i = 0; i < 8; i++) {
        const h = 0.22 + ((i * 37) % 9) * 0.012;
        const w = 0.05 + ((i * 13) % 3) * 0.012;
        box(M.book[i % M.book.length], 0.18, h, w, px, B + 1.72 + h / 2, z, 0, 1, false);
        z += w + 0.01;
      }
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.24, 10), std({ color: 0x5c8f6a, roughness: 0.15, transparent: true, opacity: 0.75 }));
      bottle.position.set(px, B + 1.84, pz + 0.42);
      g.add(bottle);
    }
    // вішак біля дверей: жовтий дощовик
    {
      const hx = hw - t - 0.05, hz = 1.75;
      box(M.woodDark, 0.04, 0.06, 0.6, hx, B + 1.8, hz, 0, 1, false);
      // дощовик на гачку: сплющений «конус» і капюшон
      const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.27, 0.95, 12), M.coat);
      coat.scale.set(0.42, 1, 1);
      coat.position.set(hx - 0.1, B + 1.3, hz);
      coat.castShadow = true;
      g.add(coat);
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), M.coat);
      hood.scale.set(0.7, 0.9, 1);
      hood.position.set(hx - 0.1, B + 1.82, hz);
      g.add(hood);
    }
    // лампа під стелею
    {
      const ly = B + wallH - 0.75;
      box(M.iron, 0.012, 0.66, 0.012, 0, ly + 0.43, -0.2, 0, 1, false);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 18, 1, true), std({ color: 0x2f5f4a, roughness: 0.6, side: THREE.DoubleSide }));
      shade.position.set(0, ly + 0.08, -0.2);
      g.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), this.lampMat);
      bulb.position.set(0, ly - 0.02, -0.2);
      g.add(bulb);
      this.lamp = new THREE.PointLight(0xffc98a, 0, 9, 1.6);
      this.lamp.position.set(0, ly - 0.15, -0.2);
      g.add(this.lamp);
    }
    // стенд прогресу: дерев'яна рамка, пробкова дошка з canvas
    {
      const bx = lx(COTTAGE_BOARD.x), bz = lz(COTTAGE_BOARD.z);
      box(M.woodDark, 0.05, COTTAGE_BOARD.h + 0.14, COTTAGE_BOARD.w + 0.14, bx + 0.01, COTTAGE_BOARD.y, bz, 0, 1, false);
      this.boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(COTTAGE_BOARD.w, COTTAGE_BOARD.h), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.85, emissive: 0xffffff, emissiveMap: boardTex, emissiveIntensity: 0.12 }));
      this.boardMesh.rotation.y = -Math.PI / 2;
      this.boardMesh.position.set(bx - 0.02, COTTAGE_BOARD.y, bz);
      g.add(this.boardMesh);
      // латунна табличка під стендом
      box(M.brass, 0.02, 0.07, 0.5, bx - 0.02, COTTAGE_BOARD.y - COTTAGE_BOARD.h / 2 - 0.13, bz, 0, 1, false);
    }

    g.updateMatrixWorld(true);
  }

  private inWinMats: THREE.MeshStandardMaterial[] = [];
  private candle!: THREE.Mesh;

  /** день/ніч: вікна світяться вночі, всередині — лампа; удень у вікнах — небо */
  update(dt: number, night: number, playerInside: boolean, playerNear: boolean) {
    this.t += dt;
    for (const m of this.winMats) m.emissiveIntensity = night * 0.9;
    // зсередини: удень — світле небо у вікні, вночі — темна синява
    for (const m of this.inWinMats) {
      const d = 1 - night;
      m.color.setRGB(0.08 + d * 0.79, 0.1 + d * 0.83, 0.18 + d * 0.8);
      m.emissive.setRGB(0.1 + d * 0.7, 0.14 + d * 0.76, 0.28 + d * 0.69);
      m.emissiveIntensity = 0.25 + d * 0.4;
    }
    this.lampMat.emissiveIntensity = 0.15 + night * 1.6;
    const flick = 0.92 + Math.sin(this.t * 9.1) * 0.04 + Math.sin(this.t * 23.7) * 0.03;
    this.fireMat.emissiveIntensity = 1.2 * flick;
    // справжнє світло — лише коли гравець поруч (у хаті вдень теж затишно)
    const want = playerInside ? 5 + night * 7 : playerNear ? night * 6 : 0;
    this.lamp.intensity += (want - this.lamp.intensity) * Math.min(1, dt * 4);
  }
}

/** ковдра в клітинку */
function quiltTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#b8402f';
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = 'rgba(245,232,205,0.55)';
  for (let i = 0; i < 128; i += 32) {
    x.fillRect(i + 12, 0, 8, 128);
    x.fillRect(0, i + 12, 128, 8);
  }
  x.fillStyle = 'rgba(60,20,15,0.25)';
  for (let i = 0; i < 128; i += 32) x.fillRect(i + 26, 0, 2, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 3);
  return t;
}

/** плетений килим: кільця теплих кольорів */
function rugTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  const cols = ['#c9694a', '#e8c27e', '#3f7258', '#f2e3c2', '#9a3a2c', '#e39a2d', '#2f5f8f', '#f2e3c2'];
  for (let i = 0; i < 16; i++) {
    x.beginPath();
    x.arc(128, 128, 128 - i * 8, 0, Math.PI * 2);
    x.fillStyle = cols[i % cols.length];
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
