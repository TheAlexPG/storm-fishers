import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Підсвітка того, з чим зараз можна взаємодіяти (E): меші цілі отримують
// власні копії матеріалів із теплим пульсуючим світінням; при зміні цілі —
// повертаємо оригінальні матеріали. Ціль задається списком об'єктів або
// «фокусом» у локальних координатах човна (меші поруч, не завеликі).
// ─────────────────────────────────────────────────────────────

const GLOW = new THREE.Color(0xffc867);

interface Swapped {
  mesh: THREE.Mesh;
  orig: THREE.Material | THREE.Material[];
  clones: THREE.MeshStandardMaterial[];
}

export class Highlighter {
  private key = '';
  private swapped: Swapped[] = [];
  private cache = new Map<string, THREE.Mesh[]>();
  private _box = new THREE.Box3();
  private _c = new THREE.Vector3();
  private _inv = new THREE.Matrix4();

  /** меші групи root, чий центр ближче r до точки focus (локаль root) і розмір ≤ maxSize */
  near(key: string, root: THREE.Object3D, focus: THREE.Vector3, r: number, maxSize: number, exclude?: (o: THREE.Object3D) => boolean): THREE.Mesh[] {
    const hit = this.cache.get(key);
    if (hit) return hit;
    root.updateMatrixWorld(true);
    this._inv.copy(root.matrixWorld).invert();
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible || exclude?.(m)) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      this._box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld).applyMatrix4(this._inv);
      const size = this._box.getSize(this._c).length();
      if (size > maxSize) return;
      this._box.getCenter(this._c);
      if (this._c.distanceTo(focus) < r) out.push(m);
    });
    this.cache.set(key, out);
    return out;
  }

  /** скинути кеш (змінились апгрейди/модель) */
  invalidate() {
    this.cache.clear();
  }

  set(key: string, objs: THREE.Object3D[] | null) {
    if (key === this.key) return;
    this.restore();
    this.key = key;
    if (!objs) return;
    const seen = new Set<THREE.Mesh>();
    for (const root of objs) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || seen.has(m)) return;
        seen.add(m);
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        if (!mats.every((x) => (x as THREE.MeshStandardMaterial).isMeshStandardMaterial)) return;
        const clones = mats.map((x) => {
          const c = (x as THREE.MeshStandardMaterial).clone();
          // екрани/лампи, що вже світяться, не чіпаємо
          if (c.emissiveIntensity * Math.max(c.emissive.r, c.emissive.g, c.emissive.b) < 0.3) c.emissive.copy(GLOW);
          return c;
        });
        this.swapped.push({ mesh: m, orig: m.material, clones });
        m.material = Array.isArray(m.material) ? clones : clones[0];
      });
    }
  }

  private restore() {
    for (const s of this.swapped) {
      s.mesh.material = s.orig;
      for (const c of s.clones) c.dispose();
    }
    this.swapped.length = 0;
  }

  update(t: number) {
    const k = 0.38 + 0.2 * Math.sin(t * 4.5);
    for (const s of this.swapped) for (const c of s.clones) if (c.emissive.equals(GLOW)) c.emissiveIntensity = k;
  }
}
