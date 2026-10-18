import * as THREE from 'three';
import { trueWindSpeed } from './sails';

// ─────────────────────────────────────────────────────────────
// Вітрові смуги: тонкі білі завитки, що пролітають за вітром.
// Красиво й корисно — видно, звідки дме, коли ставиш паруси.
// Один LineSegments на всі смуги; хвіст — історія позицій голови.
// ─────────────────────────────────────────────────────────────

const COUNT = 26;
const TRAIL = 14;

interface Streak {
  x: number;
  y: number;
  z: number;
  life: number;
  max: number;
  phase: number;
  curl: number;
  hist: Float32Array;
  head: number;
  filled: number;
}

const VERT = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
}
`;

export class WindLines {
  private lines: THREE.LineSegments;
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private alpha: Float32Array;
  private streaks: Streak[] = [];
  private amount = 0;

  constructor(scene: THREE.Scene) {
    const segs = COUNT * (TRAIL - 1);
    this.pos = new Float32Array(segs * 2 * 3);
    this.alpha = new Float32Array(segs * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    scene.add(this.lines);
    for (let i = 0; i < COUNT; i++) {
      this.streaks.push({ x: 0, y: 0, z: 0, life: 0, max: 0, phase: 0, curl: 0, hist: new Float32Array(TRAIL * 3), head: 0, filled: 0 });
    }
    // рознести старти, щоб не з'являлись усі разом
    for (const s of this.streaks) s.life = -Math.random() * 4;
  }

  /**
   * @param windDir куди дме вітер (вектор (sin, −cos)), wind01 — сила
   * @param daylight 0..1 — уночі смуги ледь видно
   */
  update(dt: number, t: number, cam: THREE.Vector3, windDir: number, wind01: number, daylight: number, waterAt: (x: number, z: number) => number, hidden: boolean) {
    // помітні з помірного вітру; у тиші — зникають
    const target = hidden ? 0 : THREE.MathUtils.smoothstep(wind01, 0.18, 0.5);
    this.amount += (target - this.amount) * (1 - Math.exp(-1.5 * dt));
    this.mat.uniforms.uOpacity.value = this.amount * (0.35 + 0.45 * daylight);
    this.lines.visible = this.amount > 0.01;
    if (!this.lines.visible) return;

    const spd = Math.max(4, trueWindSpeed(wind01) * 0.9);
    const wx = Math.sin(windDir), wz = -Math.cos(windDir);
    // перпендикуляр для завитків
    const px = -wz, pz = wx;
    let v = 0;
    for (let i = 0; i < COUNT; i++) {
      const s = this.streaks[i];
      s.life += dt;
      if (s.life < 0) {
        v = this.hide(i, v);
        continue;
      }
      if (s.life > s.max || s.max === 0) {
        // новий завиток проти вітру від камери, щоб пролітав повз
        const ang = Math.random() * Math.PI * 2;
        const r = 6 + Math.random() * 34;
        s.x = cam.x + Math.cos(ang) * r - wx * 12;
        s.z = cam.z + Math.sin(ang) * r - wz * 12;
        s.y = waterAt(s.x, s.z) + 1.2 + Math.random() * 7;
        s.life = 0;
        s.max = 2.2 + Math.random() * 2.2;
        s.phase = Math.random() * 10;
        s.curl = Math.random() < 0.35 ? 2.2 + Math.random() * 1.5 : 0; // деякі — з петлею
        s.filled = 0;
        s.head = 0;
      }
      // голова: за вітром + хвилястість (+ інколи петля)
      const u = s.life / s.max;
      const wob = Math.sin(t * 3.1 + s.phase) * 0.9;
      let dx = wx * spd, dz = wz * spd, dy = Math.cos(t * 2.3 + s.phase) * 0.35;
      if (s.curl > 0 && u > 0.35 && u < 0.65) {
        // коротка петля в площині вітер/вгору
        const a = ((u - 0.35) / 0.3) * Math.PI * 2;
        dx = wx * spd * Math.cos(a);
        dz = wz * spd * Math.cos(a);
        dy = spd * 0.8 * Math.sin(a);
      }
      s.x += (dx + px * wob) * dt;
      s.z += (dz + pz * wob) * dt;
      s.y += dy * dt;
      // історія (кільце)
      s.head = (s.head + 1) % TRAIL;
      s.hist[s.head * 3] = s.x;
      s.hist[s.head * 3 + 1] = s.y;
      s.hist[s.head * 3 + 2] = s.z;
      s.filled = Math.min(TRAIL, s.filled + 1);
      const env = Math.min(1, u * 4) * Math.min(1, (1 - u) * 3);
      for (let k = 0; k < TRAIL - 1; k++) {
        if (k + 1 >= s.filled) {
          v = this.seg(v, 0, 0, 0, 0, 0, 0, 0, 0);
          continue;
        }
        const a = (s.head - k + TRAIL) % TRAIL;
        const b = (a - 1 + TRAIL) % TRAIL;
        const fa = 1 - k / (TRAIL - 1), fb = 1 - (k + 1) / (TRAIL - 1);
        v = this.seg(v, s.hist[a * 3], s.hist[a * 3 + 1], s.hist[a * 3 + 2], s.hist[b * 3], s.hist[b * 3 + 1], s.hist[b * 3 + 2], env * fa, env * fb);
      }
    }
    const g = this.lines.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aAlpha').needsUpdate = true;
  }

  private hide(i: number, v: number): number {
    void i;
    for (let k = 0; k < TRAIL - 1; k++) v = this.seg(v, 0, 0, 0, 0, 0, 0, 0, 0);
    return v;
  }

  private seg(v: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, aa: number, ab: number): number {
    const p = this.pos, al = this.alpha;
    p[v * 3] = ax;
    p[v * 3 + 1] = ay;
    p[v * 3 + 2] = az;
    al[v] = aa;
    p[v * 3 + 3] = bx;
    p[v * 3 + 4] = by;
    p[v * 3 + 5] = bz;
    al[v + 1] = ab;
    return v + 2;
  }
}
