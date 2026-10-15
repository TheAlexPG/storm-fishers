import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─────────────────────────────────────────────────────────────
// Набір інструментів для статичної «декорації» світу:
//  • Batch — збирає геометрію за матеріалом і зливає в кілька мешів
//    (сотні дрібних деталей → десятки draw call-ів);
//  • примітиви з UV у метрах (текстура не розтягується на великих гранях);
//  • будиночок із двосхилим дахом;
//  • простий value-noise / fbm для рельєфу.
// ─────────────────────────────────────────────────────────────

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** матриця трансформації: позиція, оберти (YXZ-порядок не потрібен — XYZ), масштаб */
export function T(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/** злиття геометрії за матеріалом (і окремо — тінь/без тіні) */
export class Batch {
  private parts = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();

  /** геометрія копіюється, тож один і той самий шаблон можна додавати багато разів */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4, cast = true): void {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    // лишаємо тільки спільні атрибути, інакше mergeGeometries відмовиться
    const keep = new Set(['position', 'normal', 'uv', 'color']);
    for (const name of Object.keys(g.attributes)) if (!keep.has(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    }
    const wantColor = (mat as THREE.MeshStandardMaterial).vertexColors === true;
    if (wantColor && !g.attributes.color) {
      const n = g.attributes.position.count;
      const c = new Float32Array(n * 3).fill(1);
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    } else if (!wantColor && g.attributes.color) {
      g.deleteAttribute('color');
    }
    g.clearGroups();
    const key = mat.uuid + (cast ? '|c' : '|n');
    let p = this.parts.get(key);
    if (!p) {
      p = { mat, cast, geos: [] };
      this.parts.set(key, p);
    }
    p.geos.push(g);
  }

  /** зливає все в меші й додає до групи */
  build(parent: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const p of this.parts.values()) {
      if (!p.geos.length) continue;
      const merged = mergeGeometries(p.geos, false);
      for (const g of p.geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, p.mat);
      mesh.castShadow = p.cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

/**
 * Box з UV у метрах: tileU/tileV — скільки метрів займає один тайл текстури.
 * Грані ±X: u←z, v←y; ±Y: u←x, v←z; ±Z: u←x, v←y.
 */
export function boxGeo(w: number, h: number, d: number, tileU = 1, tileV = tileU): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: Array<[number, number]> = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * du) / tileU, (uv.getY(i) * dv) / tileV);
    }
  }
  return g;
}

/** схил даху: як boxGeo, але на верхній/нижній грані V іде вздовж схилу (рядки черепиці — вздовж гребеня) */
export function roofSlabGeo(len: number, thick: number, depth: number, tile = 2): THREE.BufferGeometry {
  const g = boxGeo(len, thick, depth, tile, tile);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 8; i < 16; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, v, u);
  }
  return g;
}

/** циліндр з UV у метрах */
export function cylGeo(rTop: number, rBot: number, h: number, seg = 10, tile = 1, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const circ = Math.PI * 2 * Math.max(rTop, rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * h) / tile);
  return g;
}

/** UV-генератор для видавленого профілю: стіни — u уздовж довжини, v — висота */
const wallUV = {
  generateTopUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number): THREE.Vector2[] {
    return [a, b, c].map((i) => new THREE.Vector2(v[i * 3], v[i * 3 + 1]));
  },
  generateSideWallUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number, d: number): THREE.Vector2[] {
    return [a, b, c, d].map((i) => new THREE.Vector2(v[i * 3 + 2], v[i * 3 + 1]));
  },
};

/**
 * Корпус будинку з фронтонами: ширина w уздовж локальної X (гребінь уздовж X),
 * глибина d уздовж Z, стіни висотою h, гребінь на h+rh. Низ — y=0. UV у метрах/tile.
 */
export function gableBodyGeo(w: number, d: number, h: number, rh: number, tile = 2): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0);
  s.lineTo(d / 2, 0);
  s.lineTo(d / 2, h);
  s.lineTo(0, h + rh);
  s.lineTo(-d / 2, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false, UVGenerator: wallUV as unknown as THREE.UVGenerator });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  return g;
}

// ── шум ──

function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** value noise 0..1 */
export function noise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** фрактальний шум 0..1 */
export function fbm(x: number, z: number, oct = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += noise2(x, z) * amp;
    norm += amp;
    x = x * 2.03 + 17.1;
    z = z * 2.03 - 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
