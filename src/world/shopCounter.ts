import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { UpgradeId, UpgradeLevels } from '../core/types';
import { UPGRADES, UPGRADE_BY_ID, MAX_LEVEL, upgradeCost, upgradeLock } from '../game/upgrades';
import { buildPartModel, partViewYaw, type PartKit } from './upgradeParts';
import { GROUND_Y } from './portTerrain';
import { formatMoney } from '../core/math';
import type { Solid } from './port';

// ─────────────────────────────────────────────────────────────
// Фізична крамниця: прилавок під тентом магазину й стелаж біля вітрини.
// На полицях стоять справжні моделі НАСТУПНОГО рівня кожного апгрейду
// (ті самі, що прикрутяться до човна) з ціниками. Дивишся на річ — вона
// світиться, підказка каже що це й скільки коштує; E — купити.
// На прилавку каса — каталог крамниці (усі речі з описами). Рибу тут не
// приймають (це на біржі), страховку оформлюють у конторі порту.
// ─────────────────────────────────────────────────────────────

const G = GROUND_Y;
/** стелаж уздовж фасаду магазину (фасад z = −48.5) */
const SHELF = { x0: -13.3, x1: -9.3, z: -48.27, d: 0.42 };
/** прилавок перед стелажем; покупець стоїть на z ≈ −46 */
const COUNTER = { x0: -13.0, x1: -9.6, z: -47.2, d: 0.62, h: 1.0 };
const TIERS = [G + 1.22, G + 1.82];
const ITEM = 0.42; // найбільший розмір речі на полиці

export type CounterTarget = `up:${UpgradeId}` | 'register' | 'insurance';

interface Slot {
  id: UpgradeId;
  x: number;
  y: number;
  holder: THREE.Group;
  tagCtx: CanvasRenderingContext2D;
  tagTex: THREE.CanvasTexture;
  shownLvl: number;
  tagKey: string;
}

export class ShopCounter {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private kit: PartKit = {
    mat: (c, r = 0.8, m = 0.05) => {
      const key = `${c}|${r}|${m}`;
      let mat = this.mats.get(key);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
        this.mats.set(key, mat);
      }
      return mat;
    },
  };
  private register = new THREE.Group();
  private folder = new THREE.Group();
  private _v = new THREE.Vector3();
  private _d = new THREE.Vector3();

  constructor(scene: THREE.Scene, solids: Solid[]) {
    scene.add(this.group);
    this.buildFurniture();
    // дерева апгрейдів: 2 полиці, у ряд скільки влізе (8 → по 4, 9–10 → по 5)
    const cols = Math.max(4, Math.ceil(UPGRADES.length / 2));
    UPGRADES.forEach((u, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = SHELF.x0 + (cols > 4 ? 0.4 : 0.5) + col * ((SHELF.x1 - SHELF.x0 - (cols > 4 ? 0.8 : 1.0)) / (cols - 1));
      const y = TIERS[1 - row];
      const holder = new THREE.Group();
      holder.position.set(x, y, SHELF.z + 0.02);
      this.group.add(holder);
      // цінник на крайці полиці
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 112;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.175), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
      tag.position.set(x, y - 0.11, SHELF.z + SHELF.d / 2 + 0.012);
      this.group.add(tag);
      this.slots.push({ id: u.id, x, y, holder, tagCtx: c.getContext('2d')!, tagTex: tex, shownLvl: -1, tagKey: '' });
    });
    // тверді: стелаж + прилавок (гравець не заходить за прилавок)
    const zf = COUNTER.z + COUNTER.d / 2, zb = SHELF.z - SHELF.d / 2;
    solids.push({ x: (SHELF.x0 + SHELF.x1) / 2, z: (zf + zb) / 2, hw: (SHELF.x1 - SHELF.x0) / 2 + 0.05, hd: (zf - zb) / 2 });
  }

  private buildFurniture() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.75 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 });
    const paint = new THREE.MeshStandardMaterial({ color: 0x1f4f7c, roughness: 0.6 });
    const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const box = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      const arr = parts.get(m) ?? [];
      arr.push(g);
      parts.set(m, arr);
    };
    // стелаж: боковини, задня стінка, дві полиці + верхня
    const sw = SHELF.x1 - SHELF.x0;
    const sx = (SHELF.x0 + SHELF.x1) / 2;
    const top = G + 2.42;
    for (const x of [SHELF.x0, SHELF.x1]) box(woodDark, 0.06, top - G, SHELF.d, x, (top + G) / 2, SHELF.z);
    box(woodDark, 0.06, (top - G) / 2 + 0.2, SHELF.d, sx, G + (top - G) * 0.62, SHELF.z); // середня стійка
    box(wood, sw, top - G, 0.03, sx, (top + G) / 2, SHELF.z - SHELF.d / 2);
    for (const y of [...TIERS, top]) box(wood, sw + 0.04, 0.04, SHELF.d + 0.02, sx, y - 0.02, SHELF.z);
    box(paint, sw + 0.1, 0.16, 0.05, sx, top + 0.06, SHELF.z + SHELF.d / 2); // карниз
    // прилавок: тумба, стільниця, синя фронтальна панель із рейками
    const cw = COUNTER.x1 - COUNTER.x0;
    const cx = (COUNTER.x0 + COUNTER.x1) / 2;
    box(paint, cw, COUNTER.h - 0.05, COUNTER.d - 0.06, cx, G + (COUNTER.h - 0.05) / 2, COUNTER.z);
    box(wood, cw + 0.1, 0.06, COUNTER.d + 0.06, cx, G + COUNTER.h - 0.03, COUNTER.z);
    for (let i = 0; i < 7; i++) box(woodDark, 0.04, COUNTER.h - 0.2, 0.02, COUNTER.x0 + 0.2 + i * ((cw - 0.4) / 6), G + COUNTER.h / 2 - 0.05, COUNTER.z + COUNTER.d / 2 - 0.02);
    for (const [m, geos] of parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      for (const g of geos) g.dispose();
    }
    // табличка над стелажем
    {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 72;
      const x = c.getContext('2d')!;
      x.fillStyle = '#1f4f7c';
      x.fillRect(0, 0, 512, 72);
      x.fillStyle = '#f2e6c4';
      x.font = 'bold 40px sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('ОБЛАДНАННЯ ДЛЯ ЯХТИ', 256, 38);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.36), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
      m.position.set(sx, top + 0.33, SHELF.z + SHELF.d / 2 - 0.04);
      this.group.add(m);
    }
    const ty = G + COUNTER.h;
    // каса з вагами для риби
    {
      const r = this.register;
      const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
        const o = new THREE.Mesh(geo, m);
        o.position.set(x, y, z);
        o.castShadow = true;
        r.add(o);
        return o;
      };
      const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.8 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.6 });
      add(new THREE.BoxGeometry(0.36, 0.16, 0.3), dark, 0, 0.08, 0);
      const keys = add(new THREE.BoxGeometry(0.32, 0.06, 0.16), brass, 0, 0.17, 0.05);
      keys.rotation.x = -0.35;
      add(new THREE.BoxGeometry(0.26, 0.12, 0.03), new THREE.MeshStandardMaterial({ color: 0x0b1a12, emissive: 0x6dffb0, emissiveIntensity: 0.35 }), 0, 0.26, -0.08);
      // ваги поруч: тарілка на стовпчику
      add(new THREE.CylinderGeometry(0.035, 0.05, 0.14, 10), brass, 0.36, 0.07, 0);
      add(new THREE.CylinderGeometry(0.17, 0.15, 0.025, 20), new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.25, metalness: 0.9 }), 0.36, 0.15, 0);
      r.position.set(COUNTER.x1 - 0.65, ty, COUNTER.z);
      this.group.add(r);
    }
    // папка-каталог + штамп (декор)
    {
      const f = this.folder;
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.4), new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.6 }));
      cover.position.y = 0.013;
      f.add(cover);
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 170;
      const x = c.getContext('2d')!;
      x.fillStyle = '#f7f1df';
      x.fillRect(0, 0, 128, 170);
      x.fillStyle = '#2f6b3a';
      x.font = 'bold 18px sans-serif';
      x.textAlign = 'center';
      x.fillText('КАТАЛОГ', 64, 30);
      x.fillStyle = '#7a6a50';
      for (let i = 0; i < 7; i++) x.fillRect(16, 50 + i * 15, 96 - (i % 3) * 18, 4);
      x.strokeStyle = '#c0392b';
      x.lineWidth = 4;
      x.beginPath();
      x.arc(92, 145, 18, 0, Math.PI * 2);
      x.stroke();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.35), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
      paper.rotation.x = -Math.PI / 2;
      paper.position.y = 0.027;
      f.add(paper);
      const stamp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.08, 10), new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.6 }));
      stamp.position.set(0.22, 0.04, 0.1);
      f.add(stamp);
      f.position.set(COUNTER.x0 + 0.55, ty, COUNTER.z + 0.04);
      f.rotation.y = 0.2;
      this.group.add(f);
    }
  }

  /** оновити полиці й цінники (дешево: перебудова лише при зміні) */
  refresh(up: UpgradeLevels, money: number) {
    for (const s of this.slots) {
      const lvl = up[s.id] ?? 0;
      const next = lvl < MAX_LEVEL ? lvl + 1 : 0;
      if (next !== s.shownLvl) {
        s.shownLvl = next;
        for (const o of s.holder.children) o.traverse((q) => (q as THREE.Mesh).geometry?.dispose());
        s.holder.clear();
        if (next) s.holder.add(this.placeModel(s.id, next));
      }
      const cost = next ? upgradeCost(s.id, lvl) ?? 0 : 0;
      const lock = next ? upgradeLock(s.id, up) : null;
      const ok = next > 0 && money >= cost && !lock;
      const key = `${next}|${ok}|${lock}`;
      if (key !== s.tagKey) {
        s.tagKey = key;
        this.drawTag(s, next, cost, ok, lock);
      }
    }
  }

  private placeModel(id: UpgradeId, lvl: number): THREE.Object3D {
    const obj = buildPartModel(id, lvl, this.kit);
    const wrap = new THREE.Group();
    wrap.add(obj);
    wrap.rotation.y = partViewYaw(id, lvl);
    const box = new THREE.Box3().setFromObject(wrap);
    const size = box.getSize(this._v);
    const k = Math.min(1.6, ITEM / Math.max(size.x, size.y * 0.8, size.z, 0.05));
    const out = new THREE.Group();
    out.add(wrap);
    out.scale.setScalar(k);
    const c = box.getCenter(this._d);
    wrap.position.set(-c.x, -box.min.y, -c.z);
    out.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    return out;
  }

  private drawTag(s: Slot, next: number, cost: number, ok: boolean, lock: string | null = null) {
    const x = s.tagCtx;
    const u = UPGRADE_BY_ID[s.id];
    x.fillStyle = '#f7f1df';
    x.fillRect(0, 0, 256, 112);
    x.strokeStyle = '#3a2a1c';
    x.lineWidth = 5;
    x.strokeRect(3, 3, 250, 106);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#3a2a1c';
    x.font = 'bold 24px sans-serif';
    x.fillText(next ? `${u.name} · рів. ${next}` : u.name, 128, 30, 236);
    if (next && lock) {
      x.fillStyle = '#7a6a50';
      x.font = 'bold 22px sans-serif';
      x.fillText(`🔒 ${lock}`, 128, 76, 236);
    } else if (next) {
      x.fillStyle = ok ? '#1e7a46' : '#b03a2e';
      x.font = 'bold 40px sans-serif';
      x.fillText(formatMoney(cost), 128, 76, 236);
    } else {
      x.fillStyle = '#7a6a50';
      x.font = 'bold 36px sans-serif';
      x.fillText('MAX ✓', 128, 76);
    }
    s.tagTex.needsUpdate = true;
  }

  /** ціль погляду: річ на полиці / каса / папка (або null) */
  pick(head: THREE.Vector3, yaw: number, pitch: number): CounterTarget | null {
    const cx = (COUNTER.x0 + COUNTER.x1) / 2;
    if (Math.hypot(head.x - cx, head.z - COUNTER.z) > 3.6) return null;
    const dir = this._d.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    let best: CounterTarget | null = null;
    let bestA = Infinity;
    const test = (t: CounterTarget, x: number, y: number, z: number, r: number) => {
      const v = this._v.set(x - head.x, y - head.y, z - head.z);
      const dist = v.length();
      const along = v.dot(dir);
      if (along <= 0 || dist > 3.6) return;
      const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
      if (perp > r) return;
      const a = perp / dist;
      if (a < bestA) {
        bestA = a;
        best = t;
      }
    };
    for (const s of this.slots) test(`up:${s.id}`, s.x, s.y + 0.18, SHELF.z, 0.3);
    const rp = this.register.position;
    test('register', rp.x + 0.15, rp.y + 0.15, rp.z, 0.32);
    return best;
  }

  /** що підсвічувати */
  objectOf(t: CounterTarget): THREE.Object3D | null {
    if (t === 'register') return this.register;
    if (t === 'insurance') return this.folder;
    return this.slots.find((s) => `up:${s.id}` === t)?.holder ?? null;
  }

  /** підказка для цілі */
  label(t: CounterTarget, up: UpgradeLevels, money: number): string {
    if (t === 'register') return 'Каса — каталог крамниці (усі речі з описами)';
    if (t === 'insurance') return 'Страхова агенція — поліс для човна';
    const id = t.slice(3) as UpgradeId;
    const u = UPGRADE_BY_ID[id];
    const lvl = up[id] ?? 0;
    if (lvl >= MAX_LEVEL) return `${u.name}: усе вже на човні (макс.)`;
    const part = u.parts[lvl];
    const cost = upgradeCost(id, lvl) ?? 0;
    // перша характеристика, що справді змінюється на цьому рівні
    const st = u.stats.find((s) => s.value(lvl) !== s.value(lvl + 1)) ?? u.stats[0];
    const stat = st ? ` · ${st.label.toLowerCase()} ${st.fmt(st.value(lvl))} → ${st.fmt(st.value(lvl + 1))}` : '';
    const lock = upgradeLock(id, up);
    if (lock) return `«${part.name}» — ${formatMoney(cost)} · 🔒 ${lock}`;
    const lack = money < cost ? ` (бракує ${formatMoney(cost - money)})` : '';
    return `Купити «${part.name}» — ${formatMoney(cost)}${lack}${stat}`;
  }
}
