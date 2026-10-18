import * as THREE from 'three';
import { wrapAngle } from './math';

// ─────────────────────────────────────────────────────────────
// Океан на хвилях Герстнера.
// Одинаковий набір хвиль використовується і для візуалу (GLSL),
// і для фізики човна (JS heightAt/normalAt) — тому поведінка
// завжди узгоджена з картинкою.
// ─────────────────────────────────────────────────────────────

export interface WaveDef {
  dir: [number, number]; // напрямок (2D, нормалізований)
  amp: number;           // амплітуда (м)
  len: number;           // довжина хвилі (м)
  q: number;             // крутість (steepness) 0..~0.2
}

const G = 9.81;
const OCEAN_HALF = 1800;
const OCEAN_SEGS = 220;
const OCEAN_STEP = (OCEAN_HALF * 2) / OCEAN_SEGS;

// Параметри 5 хвиль: [кут від вітру, базова амплітуда, довжина, крутість]
const WAVE_TABLE: Array<[number, number, number, number]> = [
  [0.0, 1.15, 52, 0.1],
  [0.55, 0.75, 30, 0.11],
  [-0.75, 0.45, 15, 0.13],
  [2.4, 0.22, 6.5, 0.15],
  [-2.1, 0.11, 2.6, 0.17],
];

/** Оновлює набір хвиль на місці (без alloc). */
export function updateWaveSet(defs: WaveDef[], intensity: number, windDir: number): void {
  const s = intensity;
  for (let i = 0; i < 5; i++) {
    const w = defs[i];
    const [off, baseAmp, len, q] = WAVE_TABLE[i];
    const a = windDir + off;
    w.dir[0] = Math.sin(a);
    w.dir[1] = -Math.cos(a);
    // підлог 0.09: у тиші хвилі справді дрібні (~0.15 м), а шторм
    // зберігає амплітуди завдяки множнику 1.15·s
    w.amp = baseAmp * (0.09 + 1.15 * s);
    w.len = len;
    w.q = q;
  }
}

export function waveSet(intensity: number, windDir = 0): WaveDef[] {
  // intensity ~0 (тиша) .. 1+ (шторм).
  // Конвенція: напрямок кута a → (sin a, −cos a); a=0 — хвиля іде на −Z («північ»).
  const defs: WaveDef[] = [
    { dir: norm2(0, 0), amp: 0, len: 1, q: 0 },
    { dir: norm2(0, 0), amp: 0, len: 1, q: 0 },
    { dir: norm2(0, 0), amp: 0, len: 1, q: 0 },
    { dir: norm2(0, 0), amp: 0, len: 1, q: 0 },
    { dir: norm2(0, 0), amp: 0, len: 1, q: 0 },
  ];
  updateWaveSet(defs, intensity, windDir);
  return defs;
}

function norm2(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

// Аналітична висота хвиль (сума A*sin(phase)) — для фізики.
export function waveHeight(x: number, z: number, t: number, waves: WaveDef[]): number {
  let h = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const k = (Math.PI * 2) / w.len;
    const omega = Math.sqrt(G * k);
    const phase = k * (w.dir[0] * x + w.dir[1] * z) - omega * t;
    h += w.amp * Math.sin(phase);
  }
  return h;
}

// Аналітична нормаль (приблизна, достатня для плавучості).
export function waveNormal(x: number, z: number, t: number, waves: WaveDef[], out: THREE.Vector3): THREE.Vector3 {
  let dx = 0, dz = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const k = (Math.PI * 2) / w.len;
    const omega = Math.sqrt(G * k);
    const phase = k * (w.dir[0] * x + w.dir[1] * z) - omega * t;
    const c = w.amp * k * Math.cos(phase);
    dx += c * w.dir[0];
    dz += c * w.dir[1];
  }
  out.set(-dx, 1, -dz).normalize();
  return out;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform vec2  uWaveDir[5];
uniform float uWaveAmp[5];
uniform float uWaveK[5];
uniform float uWaveOmega[5];
uniform float uWaveQ[5];
varying vec3 vWorldPos;
varying vec3 vNormalW;

vec3 gerstner(vec2 p, out vec3 nrm) {
  vec3 disp = vec3(0.0);
  nrm = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    vec2 D = uWaveDir[i];
    float A = uWaveAmp[i];
    float k = uWaveK[i];
    float w = uWaveOmega[i];
    float Q = uWaveQ[i];
    float ph = k * (D.x * p.x + D.y * p.y) - w * uTime;
    float c = cos(ph);
    float s = sin(ph);
    disp += vec3(Q * A * D.x * c, A * s, Q * A * D.y * c);
    // аналітична нормаль Герстнера
    nrm += vec3(-A * k * D.x * c,
                  1.0,
                  -A * k * D.y * c);
  }
  nrm = normalize(nrm);
  return disp;
}

void main() {
  vec3 base = position; // плоскість у XZ (після rotateX)
  vec3 nrm;
  vec3 d = gerstner(base.xz, nrm);
  vec3 world = base + d;
  vWorldPos = world;
  vNormalW = normalize(nrm);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3  uSunDir;
uniform vec3  uCamPos;
uniform vec3  uDeepColor;
uniform vec3  uShallowColor;
uniform vec3  uSkyColor;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uSunStrength;
uniform float uFlash;
uniform mat4  uHullInv;
uniform float uBoatSpeed;
varying vec3 vWorldPos;
varying vec3 vNormalW;

// обрис корпусу яхти (дзеркало hullHalfWidth у yachtLayout.ts)
float hullHalfW(float z) {
  float t = z / 4.7;
  if (t < 0.0) return 1.8 - 0.25 * t * t;
  return 1.8 * pow(max(0.0, 1.0 - pow(t, 2.2)), 0.75);
}
// smoothstep без обмеження edge0 < edge1 (дзеркало smooth у yachtLayout.ts)
float smoothAny(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
// кіль-лінія (дзеркало hullBottomY у yachtLayout.ts)
float hullBotY(float z) {
  float t = z / 4.7;
  if (t >= 0.0) return -0.85 + 1.9 * pow(smoothAny(0.55, 1.0, t), 1.8);
  return -0.85 + 1.45 * smoothAny(-0.35, -1.0, t);
}
// напівширина корпусу на висоті y (дзеркало hullXAt у yachtModel.ts)
float hullXAtY(float y, float z) {
  float bot = hullBotY(z);
  if (y <= bot) return 0.0;
  float r = clamp((1.05 - y) / (1.05 - bot), 0.0, 1.0);
  float th = asin(pow(r, 1.0 / 1.6));
  return hullHalfW(z) * sqrt(cos(th));
}

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++){
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  // вода не заходить у корпус (салон нижче ватерлінії, кокпіт, трап)
  vec3 hl = (uHullInv * vec4(vWorldPos, 1.0)).xyz;
  if (abs(hl.z) < 4.68 && hl.y < 1.05 && abs(hl.x) < hullXAtY(hl.y, hl.z) - 0.02) discard;

  vec3 N = normalize(vNormalW);
  vec3 V = normalize(uCamPos - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;

  // Френель: під різким кутом вода відбиває небо
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  fres = mix(fres, 1.0, 0.12);

  // База: змішання глибокої та мілкої води за висотою хвилі + Френель
  float h = vWorldPos.y;
  vec3 water = mix(uDeepColor, uShallowColor, smoothstep(-1.6, 1.4, h) * 0.65);
  // власний колір води теж освітлений: вдень — бірюза, вночі — чорнило; трохи кольору неба
  water *= 0.3 + 0.7 * uSunStrength;
  water = mix(water, uSkyColor * 0.55, 0.18);
  vec3 col = mix(water, uSkyColor, fres * 0.85);

  // Сонячний блиск (specular) — «жирний» ефект
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 220.0) * uSunStrength;
  col += vec3(1.0, 0.96, 0.86) * spec;
  float spec2 = pow(max(dot(N, H), 0.0), 36.0) * uSunStrength * 0.25;
  col += vec3(1.0, 0.9, 0.7) * spec2;

  // місячна доріжка (місяць — навпроти сонця, як moonLight у main.ts)
  vec3 Lm = normalize(vec3(-L.x, max(-L.y, 0.2), -L.z));
  float moonI = clamp(1.0 - uSunStrength * 3.0, 0.0, 1.0);
  float mspec = pow(max(dot(N, normalize(Lm + V)), 0.0), 140.0);
  col += vec3(0.75, 0.85, 1.0) * mspec * moonI * 0.9;
  col += vec3(0.5, 0.6, 0.85) * pow(max(dot(N, normalize(Lm + V)), 0.0), 20.0) * moonI * 0.06;

  // Підводне світіння (subsurface) — коли дивимось назустріч сонцю
  float sss = pow(max(dot(V, -L), 0.0), 3.0) * smoothstep(-1.0, 1.5, h);
  col += uShallowColor * sss * 0.5 * uSunStrength;

  // Піна на гребенях + шум
  float crest = smoothstep(0.35, 1.3, h);
  float foamN = fbm(vWorldPos.xz * 0.55 + uTime * 0.35);
  float foam = crest * (0.5 + 0.7 * foamN);
  foam = smoothstep(0.35, 0.9, foam);
  col = mix(col, vec3(0.95, 0.97, 1.0), foam * 0.8);

  // Піна біля корпусу (носова хвиля) і кільватер за кормою
  {
    float spd = clamp(uBoatSpeed / 7.0, 0.0, 1.0);
    float n = fbm(vWorldPos.xz * 1.7 + uTime * 0.9);
    float edge = 0.0;
    if (abs(hl.z) < 4.9) {
      float d = abs(hl.x) - hullHalfW(clamp(hl.z, -4.7, 4.7));
      float bow = 0.35 + 0.65 * smoothstep(-2.0, 4.2, hl.z);
      edge = smoothstep(0.25 + 0.9 * spd * bow, 0.0, d) * (0.25 + 0.75 * spd) * bow;
    }
    float wake = 0.0;
    float s = -4.7 - hl.z; // відстань за транцем
    if (s > -0.2 && spd > 0.02) {
      float sc = max(s, 0.0);
      // коротко: далі слід малює FoamTrail (він іде за поворотами)
      float fade = exp(-sc / (3.5 + 7.0 * spd));
      // турбулентна смуга від гвинта / транця
      float core = smoothstep(1.0 + sc * 0.045, 0.15, abs(hl.x));
      // «вуса» Кельвіна під ~19.5°
      float arm = smoothstep(0.55, 0.0, abs(abs(hl.x) - (1.5 + sc * 0.36)));
      wake = (core * 0.7 + arm * 0.22) * fade * spd;
    }
    float f = clamp(edge + wake, 0.0, 1.0) * smoothstep(0.3, 0.75, n + 0.12);
    // уночі піна не світиться — бере освітлення неба
    vec3 foamCol = vec3(0.93, 0.96, 0.98) * clamp(0.12 + 0.88 * uSunStrength, 0.0, 1.0) + uSkyColor * 0.15;
    col = mix(col, foamCol, f * 0.8);
  }

  // Блискавка підсвічує воду
  col += vec3(0.7, 0.8, 1.0) * uFlash * (0.25 + 0.5 * fres);

  // Димка відстані
  float dist = length(uCamPos - vWorldPos);
  float fogF = 1.0 - exp(-dist * dist * uFogDensity * uFogDensity);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Ocean {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  private waves: WaveDef[] = waveSet(0.5);
  private intensity = 0.5;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(OCEAN_HALF * 2, OCEAN_HALF * 2, OCEAN_SEGS, OCEAN_SEGS);
    geo.rotateX(-Math.PI / 2);

    const dirs: THREE.Vector2[] = [];
    const amps: number[] = [];
    const ks: number[] = [];
    const omegas: number[] = [];
    const qs: number[] = [];
    const init = waveSet(0.3);
    for (let i = 0; i < 5; i++) {
      dirs.push(new THREE.Vector2(init[i].dir[0], init[i].dir[1]));
      amps.push(init[i].amp);
      const k = (Math.PI * 2) / init[i].len;
      ks.push(k);
      omegas.push(Math.sqrt(G * k));
      qs.push(init[i].q);
    }
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uWaveDir: { value: dirs },
        uWaveAmp: { value: amps },
        uWaveK: { value: ks },
        uWaveOmega: { value: omegas },
        uWaveQ: { value: qs },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uCamPos: { value: new THREE.Vector3() },
        uDeepColor: { value: new THREE.Color(0x0b4660) },
        uShallowColor: { value: new THREE.Color(0x1d9196) },
        uSkyColor: { value: new THREE.Color(0xbcd8e6) },
        uFogColor: { value: new THREE.Color(0xbcd8e6) },
        uFogDensity: { value: 0.0016 },
        uSunStrength: { value: 1.0 },
        uFlash: { value: 0 },
        uHullInv: { value: new THREE.Matrix4() },
        uBoatSpeed: { value: 0 },
      },
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** матриця корпусу човна (світ → локаль), щоб не малювати воду всередині */
  setHull(group: THREE.Object3D, speed = 0) {
    this.material.uniforms.uBoatSpeed.value = speed;
    group.updateMatrixWorld();
    (this.material.uniforms.uHullInv.value as THREE.Matrix4).copy(group.matrixWorld).invert();
  }

  /** плавні цільові умови (Weather вже демпфує, тут — м'яке доганяння) */
  setConditions(intensity: number, windDir: number) {
    this.targetIntensity = intensity;
    this.targetWindDir = windDir;
  }

  private targetIntensity = 0.3;
  private targetWindDir = 0;
  private windDir = 0;

  update(dt: number, t: number, cam: THREE.Vector3, sunDir: THREE.Vector3, skyColor: THREE.Color, fogColor: THREE.Color, fogDensity: number, sunStrength: number, flash: number) {
    // м'яко доганяємо цільові умови (без дрифу, без alloc)
    this.intensity += (this.targetIntensity - this.intensity) * (1 - Math.exp(-0.8 * dt));
    this.windDir += wrapAngle(this.targetWindDir - this.windDir) * (1 - Math.exp(-0.6 * dt));
    updateWaveSet(this.waves, this.intensity, this.windDir);

    const u = this.material.uniforms;
    u.uTime.value = t;
    (u.uCamPos.value as THREE.Vector3).copy(cam);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir).normalize();
    (u.uSkyColor.value as THREE.Color).copy(skyColor);
    (u.uFogColor.value as THREE.Color).copy(fogColor);
    u.uFogDensity.value = fogDensity;
    u.uSunStrength.value = sunStrength;
    u.uFlash.value = flash;

    const dirs = u.uWaveDir.value as THREE.Vector2[];
    const amps = u.uWaveAmp.value as number[];
    const ks = u.uWaveK.value as number[];
    const omegas = u.uWaveOmega.value as number[];
    const qs = u.uWaveQ.value as number[];
    for (let i = 0; i < 5; i++) {
      const w = this.waves[i];
      dirs[i].set(w.dir[0], w.dir[1]);
      amps[i] = w.amp;
      const k = (Math.PI * 2) / w.len;
      ks[i] = k;
      omegas[i] = Math.sqrt(G * k);
      qs[i] = w.q;
    }
  }

  // Для фізики: поточний набір хвиль
  currentWaves(): WaveDef[] {
    return this.waves;
  }

  /**
   * Висота так, як її МАЛЮЄ сітка (крок 16 м: короткі хвилі між вершинами не видно) —
   * для того, що лежить на воді (слід піни), щоб не тонуло й не висіло.
   */
  renderedHeightAt(x: number, z: number, t: number): number {
    const fx = (x + OCEAN_HALF) / OCEAN_STEP, fz = (z + OCEAN_HALF) / OCEAN_STEP;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const x0 = ix * OCEAN_STEP - OCEAN_HALF, z0 = iz * OCEAN_STEP - OCEAN_HALF;
    const w = this.waves;
    const h00 = waveHeight(x0, z0, t, w), h10 = waveHeight(x0 + OCEAN_STEP, z0, t, w);
    const h01 = waveHeight(x0, z0 + OCEAN_STEP, t, w), h11 = waveHeight(x0 + OCEAN_STEP, z0 + OCEAN_STEP, t, w);
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
  }

  heightAt(x: number, z: number, t: number): number {
    return waveHeight(x, z, t, this.waves);
  }
  normalAt(x: number, z: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    return waveNormal(x, z, t, this.waves, out);
  }
}
