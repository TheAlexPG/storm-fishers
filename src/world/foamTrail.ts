import * as THREE from 'three';
import type { Ocean } from '../core/ocean';

// ─────────────────────────────────────────────────────────────
// Слід піни за кормою: стрічка на воді, що повільно розпливається
// й тане (~30 с). Видно, де ти щойно пройшов — як колія за машиною.
// ─────────────────────────────────────────────────────────────

const MAX = 180;
const LIFE = 30;
const STEP = 1.6; // м між точками

interface Pt {
  x: number;
  z: number;
  /** перпендикуляр до курсу */
  px: number;
  pz: number;
  age: number;
  /** сила (швидкість у момент проходу) 0..1 */
  k: number;
}

const VERT = /* glsl */ `
attribute float aAlpha;
attribute vec2 aUv;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vAlpha = aAlpha;
  vUv = aUv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCam;
uniform float uTime;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vWorld;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  // м'які краї, розірвана піна всередині
  float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
  float n = noise(vWorld.xz * 0.9 + uTime * 0.15) * 0.65 + noise(vWorld.xz * 2.7 - uTime * 0.1) * 0.35;
  float lace = smoothstep(0.35 + (1.0 - vAlpha) * 0.4, 0.8, n);
  float a = edge * lace * vAlpha;
  // далеко — тане (туман і так з'їсть)
  a *= 1.0 - smoothstep(120.0, 260.0, length(vWorld - uCam));
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a * 0.75);
}
`;

export class FoamTrail {
  private pts: Pt[] = [];
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private alpha: Float32Array;
  private travelled = 0;
  private lastX = NaN;
  private lastZ = NaN;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(MAX * 2 * 3);
    this.alpha = new Float32Array(MAX * 2);
    const uv = new Float32Array(MAX * 2 * 2);
    for (let i = 0; i < MAX; i++) {
      uv[i * 4] = 0;
      uv[i * 4 + 1] = i;
      uv[i * 4 + 2] = 1;
      uv[i * 4 + 3] = i;
    }
    const idx: number[] = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uCam: { value: new THREE.Vector3() }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  /** скинути (телепорт човна, новий сейв) */
  clear() {
    this.pts.length = 0;
    this.lastX = NaN;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  /**
   * @param stern точка біля транця (світ), heading — курс, speed — м/с
   * @param light 0..1 — уночі піна сіра
   */
  update(dt: number, t: number, stern: THREE.Vector3, heading: number, speed: number, ocean: Ocean, cam: THREE.Vector3, light: number, storm: number) {
    // старіння
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && this.pts[0].age > LIFE) this.pts.shift();

    // нова точка кожні STEP метрів (і лише на ходу)
    if (Number.isNaN(this.lastX)) {
      this.lastX = stern.x;
      this.lastZ = stern.z;
    }
    const d = Math.hypot(stern.x - this.lastX, stern.z - this.lastZ);
    if (d > 30) {
      // стрибок (скидання човна) — новий слід
      this.clear();
      this.lastX = stern.x;
      this.lastZ = stern.z;
    }
    this.travelled += d;
    this.lastX = stern.x;
    this.lastZ = stern.z;
    const k = THREE.MathUtils.smoothstep(speed, 0.6, 5);
    if (this.travelled >= STEP) {
      this.travelled = 0;
      if (k > 0.02 || (this.pts.length && this.pts[this.pts.length - 1].k > 0.02)) {
        this.pts.push({ x: stern.x, z: stern.z, px: Math.cos(heading), pz: -Math.sin(heading), age: 0, k });
        if (this.pts.length > MAX) this.pts.shift();
      }
    }
    // голова стрічки «прилипає» до корми, щоб не було щілини
    const n = this.pts.length;
    if (n < 2) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const lift = 0.05 + storm * 0.25;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      const head = i === n - 1;
      const x = head ? stern.x : p.x;
      const z = head ? stern.z : p.z;
      // розпливається з віком
      const w = 0.9 + Math.min(4.5, p.age * 0.22) * (0.6 + p.k * 0.4);
      const fade = (1 - p.age / LIFE) * p.k * (head ? 0 : 1);
      for (const [j, s] of [[0, -1], [1, 1]] as const) {
        const vx = x + p.px * w * s, vz = z + p.pz * w * s;
        const o = (i * 2 + j) * 3;
        this.pos[o] = vx;
        this.pos[o + 1] = ocean.renderedHeightAt(vx, vz, t) + lift;
        this.pos[o + 2] = vz;
        this.alpha[i * 2 + j] = Math.max(0, fade);
      }
    }
    const g = this.mesh.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aAlpha').needsUpdate = true;
    g.setDrawRange(0, (n - 1) * 6);
    this.mat.uniforms.uCam.value.copy(cam);
    this.mat.uniforms.uTime.value = t;
    (this.mat.uniforms.uColor.value as THREE.Color).setScalar(0.25 + 0.7 * light);
  }
}
