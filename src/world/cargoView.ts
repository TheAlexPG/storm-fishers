import * as THREE from 'three';
import { DECK_Y, SOLE_Y } from './yachtLayout';
import { GOODS, GOODS_BY_ID, DOCK_BY_ID, type CargoBook, type GoodsDef } from '../game/cargo';
import { terrainHeight } from './portTerrain';

// ─────────────────────────────────────────────────────────────
// Вантаж на вигляд: дерев'яні ящики з трафаретом (VINO, FURS, POST…),
// бочки з обручами й біло-сині ящики з льодом. На яхті — фіксовані
// акуратні слоти: на лавках кокпіту біля коамінгів (притягнуті ременями,
// прохід до штурвала й лебідок вільний) і в носовій каюті на V-койці.
// На причалі — стос біля складу; ящик у руках — перед камерою.
// ─────────────────────────────────────────────────────────────

/** слоти (локальні координати яхти): 0..5 — лави кокпіту, 6..8 — носова каюта */
const SEAT_Y = DECK_Y + 0.4625;
const BERTH_Y = SOLE_Y + 0.72;
export const CARGO_SLOTS: Array<{ x: number; y: number; z: number; deck: boolean; ry: number }> = [
  { x: 0.8, y: SEAT_Y, z: -2.12, deck: true, ry: 0 },
  { x: -0.8, y: SEAT_Y, z: -2.12, deck: true, ry: 0 },
  { x: 0.8, y: SEAT_Y, z: -1.08, deck: true, ry: 0 },
  { x: -0.8, y: SEAT_Y, z: -1.08, deck: true, ry: 0 },
  { x: 0.8, y: SEAT_Y, z: -1.6, deck: true, ry: 0 },
  { x: -0.8, y: SEAT_Y, z: -1.6, deck: true, ry: 0 },
  { x: -0.32, y: BERTH_Y, z: 2.98, deck: false, ry: 0.12 },
  { x: 0.32, y: BERTH_Y, z: 2.98, deck: false, ry: -0.12 },
  { x: 0, y: BERTH_Y, z: 3.32, deck: false, ry: 0 },
];

/** розміри ящика (ширина по x, висота, глибина по z) */
const CW = 0.36, CH = 0.3, CD = 0.44;

function crateTex(g: GoodsDef): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 192;
  const x = c.getContext('2d')!;
  if (g.shape === 'icebox') {
    // термоящик: білий пластик, синя смуга, «ICE» і сніжинка
    x.fillStyle = '#eef3f6';
    x.fillRect(0, 0, 256, 192);
    x.fillStyle = g.color;
    x.fillRect(0, 118, 256, 30);
    x.fillStyle = '#ffffff';
    x.font = '800 30px Manrope, -apple-system, sans-serif';
    x.textAlign = 'center';
    x.fillText('❄ ICE · FRESH ❄', 128, 143);
    x.fillStyle = g.color;
    x.font = '900 64px Manrope, -apple-system, sans-serif';
    x.fillText('FISH', 128, 92);
  } else {
    // дошки
    const base = g.shape === 'barrel' ? '#9a6a3e' : '#c79a62';
    x.fillStyle = base;
    x.fillRect(0, 0, 256, 192);
    for (let i = 0; i < 6; i++) {
      x.fillStyle = i % 2 ? 'rgba(80,50,25,0.12)' : 'rgba(255,240,210,0.08)';
      x.fillRect(0, i * 32, 256, 32);
      x.fillStyle = 'rgba(60,35,15,0.35)';
      x.fillRect(0, i * 32 + 30, 256, 2);
    }
    for (let k = 0; k < 40; k++) {
      x.fillStyle = 'rgba(70,40,20,0.08)';
      x.fillRect(Math.random() * 256, Math.random() * 192, 18 + Math.random() * 30, 1);
    }
    // трафарет
    x.fillStyle = g.color;
    x.globalAlpha = 0.88;
    x.textAlign = 'center';
    x.font = `900 ${g.stencil.length > 5 ? 50 : 60}px "Courier New", ui-monospace, monospace`;
    x.fillText(g.stencil, 128, 110);
    x.font = '800 22px "Courier New", ui-monospace, monospace';
    x.fillText(g.fragile ? '▲ FRAGILE ▲' : g.perish ? 'KEEP COOL' : '— STORM CO —', 128, 150);
    x.globalAlpha = 1;
    // рамка-обв'язка
    x.strokeStyle = 'rgba(55,32,14,0.7)';
    x.lineWidth = 10;
    x.strokeRect(5, 5, 246, 182);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class CargoView {
  readonly group = new THREE.Group();
  /** на яхті (діти boat.group) */
  private onBoat = new THREE.Group();
  private hand = new THREE.Group();
  private meshes = new Map<string, THREE.Object3D>();
  private mats = new Map<string, THREE.Material>();
  private strapMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.7 });
  private hoopMat = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.45, metalness: 0.6 });
  private woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.85 });
  private key = '';

  constructor(scene: THREE.Scene, boatGroup: THREE.Group, camera: THREE.Camera) {
    scene.add(this.group);
    boatGroup.add(this.onBoat);
    camera.add(this.hand);
    this.hand.position.set(0.05, -0.42, -0.72);
    this.hand.rotation.set(0.25, -0.15, 0);
  }

  private mat(g: GoodsDef): THREE.Material {
    let m = this.mats.get(g.id);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: crateTex(g), roughness: g.shape === 'icebox' ? 0.45 : 0.85 });
      this.mats.set(g.id, m);
    }
    return m;
  }

  /** модель одного ящика/бочки; strap — ремені (на лаві кокпіту) */
  private model(g: GoodsDef, strap: boolean): THREE.Group {
    const o = new THREE.Group();
    const m = this.mat(g);
    if (g.shape === 'barrel') {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, CH + 0.08, 14, 1), m);
      b.position.y = (CH + 0.08) / 2;
      b.scale.set(1, 1, 1);
      o.add(b);
      for (const y of [0.06, (CH + 0.08) / 2, CH + 0.02]) {
        const h = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.012, 5, 18), this.hoopMat);
        h.rotation.x = Math.PI / 2;
        h.position.y = y;
        o.add(h);
      }
      const lid = new THREE.Mesh(new THREE.CircleGeometry(0.16, 14), this.woodMat);
      lid.rotation.x = -Math.PI / 2;
      lid.position.y = CH + 0.081;
      o.add(lid);
    } else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(CW, CH, CD), m);
      b.position.y = CH / 2;
      o.add(b);
      if (g.shape === 'crate') {
        // кутові планки
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const p = new THREE.Mesh(new THREE.BoxGeometry(0.035, CH + 0.01, 0.035), this.woodMat);
          p.position.set(sx * (CW / 2 - 0.012), CH / 2, sz * (CD / 2 - 0.012));
          o.add(p);
        }
      } else {
        // кришка термоящика
        const lid = new THREE.Mesh(new THREE.BoxGeometry(CW + 0.02, 0.04, CD + 0.02), new THREE.MeshStandardMaterial({ color: GOODS_BY_ID.icefish.color, roughness: 0.5 }));
        lid.position.y = CH + 0.015;
        o.add(lid);
      }
    }
    if (strap) {
      // ремені до лави — ящик не з'їде в качку
      for (const dz of [-0.11, 0.11]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(CW + 0.03, 0.025, 0.04), this.strapMat);
        s.position.set(0, CH + 0.03, dz);
        o.add(s);
        for (const sx of [-1, 1]) {
          const v = new THREE.Mesh(new THREE.BoxGeometry(0.02, CH + 0.04, 0.04), this.strapMat);
          v.position.set(sx * (CW / 2 + 0.012), CH / 2 + 0.01, dz);
          o.add(v);
        }
      }
    }
    o.traverse((c) => {
      const mm = c as THREE.Mesh;
      if (mm.isMesh) {
        mm.castShadow = true;
        mm.receiveShadow = true;
      }
    });
    return o;
  }

  /**
   * Синхронізувати з книгою вантажів. slotsCode — для кооп-екіпажу (вантаж
   * яхти власника); інакше — свій.
   */
  sync(book: CargoBook | null, crewCode: number | null) {
    const parts: string[] = [];
    const want: Array<{ k: string; g: GoodsDef; where: 'boat' | 'pier' | 'hand'; slot: number; dock?: string; n?: number }> = [];
    if (crewCode != null) {
      let c = Math.max(0, Math.round(crewCode));
      for (let s = 0; s < 9; s++) {
        const gi = c % 16;
        c = Math.floor(c / 16);
        if (gi > 0 && GOODS[gi - 1]) want.push({ k: `crew:${s}:${gi}`, g: GOODS[gi - 1], where: 'boat', slot: s });
      }
    } else if (book) {
      // стоси на причалах: кожна гавань — свій лічильник місця
      const pierN = new Map<string, number>();
      for (const o of book.orders) {
        const g = GOODS_BY_ID[o.goods];
        o.items.forEach((it, i) => {
          const k = `${o.id}:${i}`;
          if (it.where === 'pier') {
            const n = pierN.get(o.from) ?? 0;
            pierN.set(o.from, n + 1);
            want.push({ k, g, where: 'pier', slot: -1, dock: o.from, n });
          } else want.push({ k, g, where: it.where, slot: it.slot });
        });
      }
    }
    for (const w of want) parts.push(`${w.k}|${w.where}|${w.slot}|${w.n ?? ''}`);
    const key = parts.join(',');
    if (key === this.key) return;
    this.key = key;
    // перебудувати (ящиків одиниці — дешево)
    for (const m of this.meshes.values()) m.removeFromParent();
    this.meshes.clear();
    for (const w of want) {
      if (w.where === 'boat') {
        const s = CARGO_SLOTS[w.slot];
        if (!s) continue;
        const m = this.model(w.g, s.deck);
        m.position.set(s.x, s.y, s.z);
        m.rotation.y = s.ry;
        this.onBoat.add(m);
        this.meshes.set(w.k, m);
      } else if (w.where === 'hand') {
        const m = this.model(w.g, false);
        m.scale.setScalar(0.85);
        m.position.y = -0.1;
        this.hand.add(m);
        this.meshes.set(w.k, m);
      } else {
        const d = DOCK_BY_ID[w.dock!];
        if (!d) continue;
        const n = w.n ?? 0;
        // ряд уздовж набережної по 4, далі — другий ярус
        const col = n % 4, tier = Math.floor(n / 4) % 2, row = Math.floor(n / 8);
        const lx = -d.oz, lz = d.ox; // «праворуч» від напрямку в море
        const x = d.px + lx * (col * 0.52 - 0.78) - d.ox * row * 0.6;
        const z = d.pz + lz * (col * 0.52 - 0.78) - d.oz * row * 0.6;
        const y = Math.max(0.2, terrainHeight(x, z)) + tier * (CH + 0.02);
        const m = this.model(w.g, false);
        m.position.set(x, y, z);
        m.rotation.y = Math.atan2(d.ox, d.oz) + ((n * 37) % 7 - 3) * 0.03;
        this.group.add(m);
        this.meshes.set(w.k, m);
      }
    }
  }

  /** світова позиція ящика на причалі (для «взяти ящик») */
  pierCrates(): Array<{ key: string; x: number; y: number; z: number }> {
    const out: Array<{ key: string; x: number; y: number; z: number }> = [];
    for (const [k, m] of this.meshes) {
      if (m.parent === this.group) out.push({ key: k, x: m.position.x, y: m.position.y, z: m.position.z });
    }
    return out;
  }
}
