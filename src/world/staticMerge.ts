import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─────────────────────────────────────────────────────────────
// Злиття нерухомої геометрії: сотні дрібних мешів (палі, дошки, стіни,
// бочки…) з ТИМ САМИМ матеріалом стають одним мешем на клітинку сітки.
// Вигляд не змінюється: той самий матеріал (анімований емісив, канвас-текстури
// працюють як були), ті самі тіні й шар підводного проходу — просто в рази
// менше викликів малювання (основний прохід, тіні, переломлення).
//
// Як користуватись (портові агенти — сюди):
//   mergeStatic(group, { skip: [рухоме, анімоване, те, що ховаємо/показуємо] });
// Викликати ПІСЛЯ побудови групи й ДО першого кадру (markUnderwater у main
// розмічає підводний шар на першому рендері). Не зливається автоматично:
// приховані меші, прозорі матеріали, масиви матеріалів, InstancedMesh,
// SkinnedMesh, морфи, дзеркальні (det < 0) матриці, меші з власним
// onBeforeRender, матеріали з власним onBeforeCompile (вершинна анімація),
// динамічні буфери (DynamicDrawUsage) і все під userData.noMerge.
// Посилання на злиті меші ставати недійсними — тож усе, що код потім рухає,
// ховає чи raycast-ить, передай у skip (або постав userData.noMerge = true).
// ─────────────────────────────────────────────────────────────

export interface MergeOptions {
  /** розмір клітинки сітки, м — злиті шматки не більші, щоб працювало відсікання за кадром і тінями */
  cell?: number;
  /** піддерева, яких не чіпати */
  skip?: Iterable<THREE.Object3D | null | undefined>;
  /** мінімум мешів у ключі, щоб варто було зливати */
  min?: number;
}

export interface MergeStats {
  /** мешів до */
  before: number;
  /** мешів злито */
  merged: number;
  /** нових мешів */
  out: number;
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const _box = new THREE.Box3();
const _c = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();

function attrSig(g: THREE.BufferGeometry): string {
  const a = Object.keys(g.attributes)
    .sort()
    .map((k) => {
      const at = g.attributes[k] as THREE.BufferAttribute;
      return `${k}:${at.itemSize}:${at.normalized ? 1 : 0}:${(at.array as ArrayLike<number> & { constructor: { name: string } }).constructor.name}`;
    })
    .join(',');
  return (g.index ? 'i' : 'n') + a;
}

/** чому меш не зливається (налагодження: window.__debug.explainMerge(group)) */
export function mergeBlocker(m: THREE.Mesh): string {
  if (!m.isMesh) return 'not-mesh';
  if ((m as THREE.InstancedMesh).isInstancedMesh) return 'instanced';
  if ((m as THREE.SkinnedMesh).isSkinnedMesh) return 'skinned';
  if (Array.isArray(m.material) || !m.material) return 'material-array';
  const mat = m.material as THREE.Material;
  if (mat.transparent) return 'transparent';
  if (own(mat, 'onBeforeCompile')) return 'own-onBeforeCompile';
  if (mat.userData.noMerge) return 'noMerge';
  if (own(m, 'onBeforeRender')) return 'own-onBeforeRender';
  const g = m.geometry;
  if (!g || !g.attributes.position || g.attributes.position.count === 0) return 'empty';
  if (Object.keys(g.morphAttributes).length) return 'morph';
  for (const k of Object.keys(g.attributes)) {
    const at = g.attributes[k] as THREE.BufferAttribute & { isInterleavedBufferAttribute?: boolean };
    if (at.isInterleavedBufferAttribute) return 'interleaved';
    if (at.usage === THREE.DynamicDrawUsage) return 'dynamic';
  }
  if (m.matrixWorld.determinant() < 0) return 'mirrored';
  return mergeable(m) ? 'ok' : 'drawRange';
}

export function explainMerge(root: THREE.Object3D): Record<string, number> {
  root.updateMatrixWorld(true);
  const out: Record<string, number> = {};
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const r = o.userData.merged ? 'merged' : mergeBlocker(o as THREE.Mesh);
    out[r] = (out[r] || 0) + 1;
  });
  return out;
}

function mergeable(m: THREE.Mesh): boolean {
  if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return false;
  if (Array.isArray(m.material) || !m.material) return false;
  const mat = m.material as THREE.Material;
  // власний хук (вершинна анімація тощо) — не чіпаємо; спільний з прототипу (тіні хмар) — ок
  if (mat.transparent || own(mat, 'onBeforeCompile') || mat.userData.noMerge) return false;
  if (own(m, 'onBeforeRender')) return false;
  const g = m.geometry;
  if (!g || !g.attributes.position || g.attributes.position.count === 0) return false;
  if (Object.keys(g.morphAttributes).length) return false;
  if (g.drawRange.start !== 0 || (g.drawRange.count !== Infinity && g.drawRange.count < (g.index ? g.index.count : g.attributes.position.count))) return false;
  for (const k of Object.keys(g.attributes)) {
    const at = g.attributes[k] as THREE.BufferAttribute & { isInterleavedBufferAttribute?: boolean };
    if (at.isInterleavedBufferAttribute || at.usage === THREE.DynamicDrawUsage) return false;
  }
  if (m.matrixWorld.determinant() < 0) return false;
  return true;
}

/**
 * Злити нерухомі меші групи (за тим самим екземпляром матеріалу й клітинкою сітки).
 * Повертає статистику; група лишається на місці (злиті меші — її прямі діти).
 */
export function mergeStatic(root: THREE.Object3D, opts: MergeOptions = {}): MergeStats {
  const cell = opts.cell ?? 40;
  const min = opts.min ?? 2;
  const skip = new Set<THREE.Object3D>();
  for (const o of opts.skip ?? []) if (o) skip.add(o);
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();

  const buckets = new Map<string, { mat: THREE.Material; meshes: THREE.Mesh[]; sample: THREE.Mesh }>();
  let before = 0;
  const walk = (o: THREE.Object3D) => {
    if (skip.has(o) || o.userData.noMerge || !o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      before++;
      if (mergeable(m)) {
        const g = m.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        _box.copy(g.boundingBox!).applyMatrix4(m.matrixWorld);
        _box.getCenter(_c);
        const low = _box.min.y < 0.8 ? 'L' : 'H';
        const key = [
          m.material && (m.material as THREE.Material).uuid,
          attrSig(g),
          m.castShadow ? 'c' : '-',
          m.receiveShadow ? 'r' : '-',
          m.layers.mask,
          m.renderOrder,
          m.frustumCulled ? 'f' : '-',
          low,
          Math.floor(_c.x / cell),
          Math.floor(_c.z / cell),
        ].join('|');
        let b = buckets.get(key);
        if (!b) {
          b = { mat: m.material as THREE.Material, meshes: [], sample: m };
          buckets.set(key, b);
        }
        b.meshes.push(m);
      }
    }
    for (const c of o.children) walk(c);
  };
  for (const c of root.children) walk(c);

  let merged = 0, out = 0;
  for (const b of buckets.values()) {
    if (b.meshes.length < min) continue;
    const geos: THREE.BufferGeometry[] = [];
    for (const m of b.meshes) {
      const g = m.geometry.clone();
      _rel.multiplyMatrices(_inv, m.matrixWorld);
      g.applyMatrix4(_rel);
      g.clearGroups();
      geos.push(g);
    }
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!geo) continue;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const s = b.sample;
    const mesh = new THREE.Mesh(geo, b.mat);
    mesh.castShadow = s.castShadow;
    mesh.receiveShadow = s.receiveShadow;
    mesh.layers.mask = s.layers.mask;
    mesh.renderOrder = s.renderOrder;
    mesh.frustumCulled = s.frustumCulled;
    mesh.matrixAutoUpdate = false;
    mesh.userData.merged = b.meshes.length;
    for (const m of b.meshes) m.removeFromParent();
    root.add(mesh);
    mesh.updateMatrixWorld(true);
    merged += b.meshes.length;
    out++;
  }
  // порожні групи після злиття — геть (крім тих, що в skip)
  const prune = (o: THREE.Object3D): boolean => {
    if (skip.has(o) || o.userData.noMerge) return false;
    for (const c of [...o.children]) if (prune(c)) c.removeFromParent();
    return o.type === 'Group' && o.children.length === 0;
  };
  for (const c of [...root.children]) if (prune(c)) c.removeFromParent();
  return { before, merged, out };
}

/**
 * Відсікання за дальністю з гістерезисом: групу ховаємо, коли камера далі за
 * far (або за суцільним туманом), показуємо — коли ближче за far·(1−hyst).
 * Для далеких груп, які на екрані — кілька пікселів або цілком у тумані.
 */
export class DistanceCuller {
  private items: Array<{ obj: THREE.Object3D; x: number; z: number; r: number; far: number; fog: boolean; on: boolean }> = [];
  private _p = new THREE.Vector3();

  /**
   * obj — група; центр і радіус — у світі (якщо не задано — з bounding sphere);
   * far — дальність (м) від краю групи; fog — ще й ховати за суцільним туманом.
   */
  add(obj: THREE.Object3D, far: number, opt: { x?: number; z?: number; r?: number; fog?: boolean } = {}) {
    let { x, z, r } = opt;
    if (x === undefined || z === undefined || r === undefined) {
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const s = box.getBoundingSphere(new THREE.Sphere());
      x ??= s.center.x;
      z ??= s.center.z;
      r ??= s.radius;
    }
    this.items.push({ obj, x, z, r, far, fog: opt.fog ?? true, on: obj.visible });
  }

  /**
   * fogDensity — FogExp2.density сцени: за відстанню d, де exp(−(ρd)²) < 0.002,
   * колір повністю туманний — малювати нема чого.
   */
  update(cam: THREE.Vector3, fogDensity: number) {
    const fogFar = fogDensity > 0 ? 2.5 / fogDensity : Infinity;
    for (const it of this.items) {
      const d = Math.max(0, Math.hypot(cam.x - it.x, cam.z - it.z) - it.r);
      const lim = it.fog ? Math.min(it.far, fogFar) : it.far;
      const on = it.on ? d < lim : d < lim * 0.92;
      if (on !== it.on) {
        it.on = on;
        it.obj.visible = on;
      }
    }
  }
}

/** лічильник для налагодження: виклики малювання й трикутники по групах сцени (window.__debug.perf()) */
export function perfReport(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Array<{ name: string; meshes: number; visible: boolean }> {
  const rows: Array<{ name: string; meshes: number; visible: boolean }> = [];
  for (const ch of scene.children) {
    let meshes = 0;
    ch.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    rows.push({ name: ch.name || ch.type, meshes, visible: ch.visible });
  }
  void renderer;
  return rows.sort((a, b) => b.meshes - a.meshes);
}
