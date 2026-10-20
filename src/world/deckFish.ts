import * as THREE from 'three';
import type { FishItem } from '../core/types';
import type { Boat } from './boat';
import { fishMesh } from './fishJump';
import { deckLimitX, DECK_Y } from './yachtLayout';
import { FISH_BY_ID } from '../game/fish';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Риба фізична: після улову лежить на палубі й б'ється; E — взяти в руки,
// E біля рибного ящика на баку — покласти. Поки лежить на палубі — псується
// вдвічі швидше, а в шторм хвиля, що заливає палубу, може змити її за борт.
// У ящику видно вже покладену рибу.
// ─────────────────────────────────────────────────────────────

/** рибний ящик на баку (локаль яхти) і станція біля нього */
export const FISH_BOX = { x: 0.62, z: 3.0 };

interface Loose {
  fish: FishItem;
  mesh: THREE.Group;
  x: number;
  z: number;
  yaw: number;
  /** до появи (поки риба летить дугою з води) */
  delay: number;
  age: number;
}

function fishLen(f: FishItem): number {
  const sp = FISH_BY_ID[f.speciesId];
  void sp;
  return THREE.MathUtils.clamp(0.24 * Math.cbrt(f.kg) + 0.2, 0.3, 1.1);
}

export class DeckFish {
  private loose: Loose[] = [];
  carried: { fish: FishItem; mesh: THREE.Group } | null = null;
  /** риба в руках: група за камерою (ставить main) */
  readonly carryGroup = new THREE.Group();
  private box = new THREE.Group();
  private lid = new THREE.Group();
  private lidA = 0;
  private boxFish: THREE.Group[] = [];
  private boxShown = '';
  onWashed: ((f: FishItem) => void) | null = null;

  constructor(scene: THREE.Scene, private boat: Boat) {
    scene.add(this.carryGroup);
    // відкритий дерев'яний ящик з льодом
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6242, roughness: 0.85 });
    const W = 0.62, D = 0.44, H = 0.26;
    const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mm = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mm.position.set(x, y, z);
      mm.castShadow = true;
      mm.receiveShadow = true;
      this.box.add(mm);
    };
    add(W, 0.03, D, 0, 0.015, 0, wood);
    for (const s of [-1, 1]) {
      add(W, H, 0.03, 0, H / 2, (s * D) / 2, wood);
      add(0.03, H, D, (s * W) / 2, H / 2, 0, wood);
    }
    for (const s of [-1, 1]) add(0.03, 0.04, 0.16, (s * (W / 2 + 0.03)), H - 0.05, 0, new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }));
    add(W - 0.04, 0.05, D - 0.04, 0, 0.06, 0, new THREE.MeshStandardMaterial({ color: 0xdff0f4, roughness: 0.3, metalness: 0.05 }));
    // кришка люка на петлях (задня крайка)
    this.lid.position.set(0, H, -D / 2 - 0.01);
    const lidM = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.04, D + 0.04), new THREE.MeshStandardMaterial({ color: 0x6e4a2e, roughness: 0.8 }));
    lidM.position.set(0, 0.02, D / 2 + 0.01);
    lidM.castShadow = true;
    this.lid.add(lidM);
    // ручка-важіль на кришці (добре видно — за неї відкривають/закривають)
    const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.2, metalness: 0.9 });
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 16, Math.PI), steel);
    handle.position.set(0, 0.04, D - 0.02);
    handle.castShadow = true;
    this.lid.add(handle);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.035), new THREE.MeshStandardMaterial({ color: 0xd0342c, roughness: 0.5 }));
    lever.position.set(0, 0.055, D * 0.45);
    this.lid.add(lever);
    // табличка «ТРЮМ» на кришці
    {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 48;
      const x = c.getContext('2d')!;
      x.fillStyle = '#f2e6c4';
      x.fillRect(0, 0, 128, 48);
      x.strokeStyle = '#3a2a1c';
      x.lineWidth = 4;
      x.strokeRect(3, 3, 122, 42);
      x.fillStyle = '#3a2a1c';
      x.font = 'bold 28px sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(L('ТРЮМ', `HOLD`), 64, 26);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.075), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(0, 0.042, D * 0.2);
      this.lid.add(plate);
    }
    this.box.add(this.lid);
    this.box.position.set(FISH_BOX.x, DECK_Y, FISH_BOX.z);
    this.box.rotation.y = 0.15;
    boat.group.add(this.box);
  }

  /** нова риба летить з води й падає на палубу в точку world */
  drop(fish: FishItem, world: THREE.Vector3, delay = 1.0) {
    const l = this.boat.worldToLocal(world.x, world.y, world.z, new THREE.Vector3());
    const lim = deckLimitX(l.z, 0.25);
    const x = THREE.MathUtils.clamp(l.x, -lim, lim);
    const z = THREE.MathUtils.clamp(l.z, -4.3, 4.2);
    const mesh = fishMesh(fish.speciesId, fishLen(fish));
    mesh.visible = false;
    this.boat.group.add(mesh);
    this.loose.push({ fish, mesh, x, z, yaw: Math.random() * Math.PI * 2, delay, age: 0 });
  }

  /** найближча риба на палубі (локальні координати гравця) */
  nearest(px: number, pz: number, r = 1.4): FishItem | null {
    let best: Loose | null = null;
    let bd = r;
    for (const l of this.loose) {
      if (l.delay > 0) continue;
      const d = Math.hypot(l.x - px, l.z - pz);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    return best?.fish ?? null;
  }

  /** меш риби на палубі (для підсвітки) */
  meshOf(f: FishItem): THREE.Object3D | null {
    return this.loose.find((l) => l.fish === f)?.mesh ?? null;
  }
  /** люк трюму (для підсвітки) */
  get hatch(): THREE.Object3D {
    return this.box;
  }

  get count(): number {
    return this.loose.length;
  }

  /** узяти рибу з палуби в руки */
  pick(px: number, pz: number): FishItem | null {
    if (this.carried) return null;
    const f = this.nearest(px, pz);
    if (!f) return null;
    const i = this.loose.findIndex((l) => l.fish === f);
    const l = this.loose.splice(i, 1)[0];
    l.mesh.parent?.remove(l.mesh);
    this.carryGroup.add(l.mesh);
    l.mesh.position.set(-0.22, -0.3, -0.5);
    l.mesh.rotation.set(0.3, Math.PI / 2 + 0.3, 0.2);
    l.mesh.visible = true;
    this.carried = { fish: f, mesh: l.mesh };
    return f;
  }

  /** покласти рибу з рук (у ящик — true; false — ящик повний) */
  takeCarried(): FishItem | null {
    const c = this.carried;
    if (!c) return null;
    this.carried = null;
    c.mesh.parent?.remove(c.mesh);
    return c.fish;
  }

  /** повернути рибу з рук на палубу (ящик повний) */
  dropCarried(px: number, pz: number) {
    const c = this.carried;
    if (!c) return;
    this.carried = null;
    c.mesh.parent?.remove(c.mesh);
    this.boat.group.add(c.mesh);
    this.loose.push({ fish: c.fish, mesh: c.mesh, x: px + 0.4, z: pz, yaw: Math.random() * 6, delay: 0, age: 6 });
  }

  /** усе з палуби (і з рук) — геть (затоплення) */
  clear(): FishItem[] {
    const out = this.loose.map((l) => l.fish);
    for (const l of this.loose) l.mesh.parent?.remove(l.mesh);
    this.loose.length = 0;
    if (this.carried) {
      out.push(this.carried.fish);
      this.carried.mesh.parent?.remove(this.carried.mesh);
      this.carried = null;
    }
    return out;
  }

  /** dtHours — години гри (псування на палубі) */
  update(dt: number, t: number, dtHours: number, deckWater: number, hold: FishItem[], hatchOpen = false) {
    // кришка люка відкривається/закривається
    this.lidA += ((hatchOpen ? -1.9 : 0) - this.lidA) * (1 - Math.exp(-dt * 6));
    this.lid.rotation.x = this.lidA;
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const l = this.loose[i];
      if (l.delay > 0) {
        l.delay -= dt;
        if (l.delay > 0) continue;
        l.mesh.visible = true;
      }
      l.age += dt;
      // на палубі риба псується вдвічі швидше, ніж у ящику з льодом
      if (!l.fish.cooked) l.fish.freshness = Math.max(0, l.fish.freshness - (dtHours / 2) * 100);
      // перші секунди б'ється, підстрибує
      const flop = Math.max(0, 1 - l.age / 7);
      const hop = Math.abs(Math.sin(l.age * 9 + l.yaw)) * 0.12 * flop;
      l.mesh.position.set(l.x, DECK_Y + 0.07 + hop, l.z);
      l.mesh.rotation.set(0, l.yaw + Math.sin(l.age * 11) * 0.3 * flop, Math.PI / 2 + Math.sin(l.age * 13) * 0.4 * flop);
      const tail = l.mesh.getObjectByName('tail');
      if (tail) tail.rotation.y = Math.sin(t * 30 + l.yaw) * 0.6 * flop;
      // хвиля, що заливає палубу, може змити рибу за борт
      if (deckWater > 35 && Math.random() < dt * 0.06 * (deckWater / 100)) {
        l.mesh.parent?.remove(l.mesh);
        this.loose.splice(i, 1);
        this.onWashed?.(l.fish);
      }
    }
    if (this.carried) {
      const tail = this.carried.mesh.getObjectByName('tail');
      if (tail) tail.rotation.y = Math.sin(t * 18) * 0.4;
    }
    this.syncBox(hold);
  }

  /** верхні рибини в ящику (до 10) — видно, що вже наловлено */
  private syncBox(hold: FishItem[]) {
    const key = hold.slice(-10).map((f) => f.uid).join(',');
    if (key === this.boxShown) return;
    this.boxShown = key;
    for (const m of this.boxFish) m.parent?.remove(m);
    this.boxFish.length = 0;
    hold.slice(-10).forEach((f, i) => {
      const m = fishMesh(f.speciesId, Math.min(0.42, fishLen(f)));
      const row = i % 5, layer = Math.floor(i / 5);
      m.position.set(-0.2 + row * 0.1, 0.12 + layer * 0.06, (layer ? 0.05 : -0.05) + (row % 2) * 0.04);
      m.rotation.set(0, (i % 2 ? 0.2 : -0.2), Math.PI / 2);
      this.box.add(m);
      this.boxFish.push(m);
    });
  }
}
