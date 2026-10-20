import * as THREE from 'three';
import { localIntensity, regionGlsl, seaMul } from './region';
import { CLOUD_COLORS, CLOUD_COMMON, cloudUniforms } from '../world/clouds';
import { wrapAngle } from './math';

// ─────────────────────────────────────────────────────────────
// Океан на хвилях Герстнера.
// Одинаковий набір хвиль використовується і для візуалу (GLSL),
// і для фізики човна (JS heightAt/normalAt) — тому поведінка
// завжди узгоджена з картинкою.
// ─────────────────────────────────────────────────────────────

export interface WaveDef {
  dir: [number, number]; // напрямок (2D, нормалізований)
  amp: number;           // одинична амплітуда (м); реальна = amp × gain(локальна сила)
  swell: boolean;        // довгий штормовий вал (росте лише в шторм)
  len: number;           // довжина хвилі (м)
  q: number;             // крутість (steepness) 0..~0.2
  /**
   * зсув фази (рад): коли вітер повертає хвилі, фаза біля камери лишається
   * неперервною. Без нього поворот напрямку навколо (0,0) світу далеко від
   * порту «проганяв» хвилі в десятки разів швидше (k·|p|·dθ/dt).
   */
  shift: number;
}

const G = 9.81;
// радіальна сітка навколо камери: густа біля човна (~0.4 м), рідшає з відстанню
const OCEAN_RADIUS = 3200;
const RING_A = 12;      // r_j = A·(e^{B·j} − 1)
const RING_B = 0.0314;  // ≈ крок по колу (2π/200): квадратні клітинки на будь-якій відстані
const ANG_SEGS = 200;
/** крок сітки на відстані r від центру (дзеркало в шейдері) */
function gridStep(r: number): number {
  return RING_B * (r + RING_A);
}
/** мілина: на глибині < SHORE_DEEP м хвилі гаснуть до SHORE_MIN */
const SHORE_DEEP = 8;
const SHORE_MIN = 0.15;
/** горизонтальне зміщення Герстнера (загострює гребені): Hx = q·CHOP·A */
const CHOP = 4;
/** вага хвилі довжини len там, де крок сітки step: < 3 вершин на хвилю — не малюється */
function waveLod(len: number, step: number): number {
  const n = len / step;
  return Math.min(1, Math.max(0, (n - 3) / 3));
}

// Параметри 5 хвиль: [кут від вітру, базова амплітуда, довжина, крутість]
// 9 хвиль: довгий брижовий вал + дедалі коротші під різними кутами — профіль
// не «лоуполі», а з дрібнішими горбами на великих
// + 2 довгі штормові вали (120 і 175 м, період 9–11 с): у шторм ростуть саме
// вони — великі хвилі довгі й повільні, як у справжньому морі, а не «прискорені»
const WAVE_TABLE: Array<[number, number, number, number, boolean?]> = [
  [0.15, 1.0, 120, 0.05, true],
  [-0.35, 0.8, 175, 0.04, true],
  [0.0, 1.0, 58, 0.09],
  [0.45, 0.62, 33, 0.1],
  [-0.6, 0.42, 21, 0.11],
  [1.1, 0.26, 13, 0.12],
  [-1.35, 0.2, 9.5, 0.13],
  [0.2, 0.14, 6.2, 0.14],
  [2.4, 0.09, 4.1, 0.15],
  [-2.1, 0.06, 2.6, 0.16],
  [0.9, 0.04, 1.7, 0.17],
];
export const WAVE_COUNT = WAVE_TABLE.length;

/**
 * Висота хвиль від сили погоди: нелінійно — бриз дає ~0.5 м, шторм ~2 м,
 * сильний шторм у відкритому морі (сила ~1.5) — вали до 3.5 м амплітуди
 * (7 м від підошви до гребеня). Дзеркало gain() у шейдері.
 */
export function waveGain(s: number): number {
  return 0.15 + 0.85 * s + 0.15 * s * s;
}
/** штормовий вал: з'являється від «вітру» й росте до ~3 м амплітуди в 11 балів */
export function swellGain(s: number): number {
  const x = Math.max(0, s - 0.35);
  return 1.8 * Math.pow(x, 1.6);
}
/** у шторм гребені гострішають (більше горизонтального зсуву Герстнера) */
function stormChop(s: number): number {
  const t = Math.min(1, Math.max(0, (s - 0.6) / 0.8));
  return 1 + 0.8 * t * t * (3 - 2 * t);
}
function gainOf(w: WaveDef, s: number): number {
  return w.swell ? swellGain(s) : waveGain(s);
}

/**
 * Групи хвиль: амплітуда коротших (не штормових) хвиль повільно «дихає» в просторі —
 * то гурт вищих хвиль, то затишніша смуга, а не однорідне желе. Фіксовані світові
 * напрямки (не від вітру — інакше поворот вітру «мете» візерунок далеко від порту),
 * фаза рухається з часом (≈5 м/с). Дзеркало groupMod() у шейдері.
 */
const GROUP_K1 = 0.0105, GROUP_K2 = 0.0071;
const GROUP_D1: [number, number] = [0.8, 0.6];
const GROUP_D2: [number, number] = [-0.6, 0.8];
export function groupPhases(t: number): [number, number] {
  const TAU = Math.PI * 2;
  return [(t * 0.05) % TAU, (t * 0.031) % TAU];
}
function groupMod(x: number, z: number, ph: [number, number]): number {
  const a = Math.sin((GROUP_D1[0] * x + GROUP_D1[1] * z) * GROUP_K1 + ph[0]);
  const b = Math.sin((GROUP_D2[0] * x + GROUP_D2[1] * z) * GROUP_K2 + ph[1] + 0.6 * a);
  return 1 + 0.3 * a * (0.6 + 0.4 * b);
}

/** Оновлює набір хвиль на місці (без alloc). */
export function updateWaveSet(defs: WaveDef[], intensity: number, windDir: number): void {
  const s = intensity;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const w = defs[i];
    const [off, baseAmp, len, q, swell] = WAVE_TABLE[i];
    const a = windDir + off;
    w.dir[0] = Math.sin(a);
    w.dir[1] = -Math.cos(a);
    // одинична амплітуда; сила погоди — у точці (gainOf), бо у відкритому морі вона більша
    w.amp = baseAmp;
    w.swell = !!swell;
    void s;
    w.len = len;
    w.q = q;
  }
}

export function waveSet(intensity: number, windDir = 0): WaveDef[] {
  // intensity ~0 (тиша) .. 1+ (шторм).
  // Конвенція: напрямок кута a → (sin a, −cos a); a=0 — хвиля іде на −Z («північ»).
  const defs: WaveDef[] = Array.from({ length: WAVE_COUNT }, () => ({ dir: norm2(0, 0), amp: 0, len: 1, q: 0, swell: false, shift: 0 }));
  updateWaveSet(defs, intensity, windDir);
  return defs;
}

function norm2(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

// Висота поверхні у світовій точці (x, z) — та сама, що малює шейдер:
// Герстнер зсуває вершини по горизонталі, тож шукаємо базову точку p,
// що після зсуву потрапляє в (x, z) (дві ітерації вистачає), і беремо її висоту.
// lodStep(x, z) — крок сітки там (для «як намальовано»), null — усі хвилі.
function surfaceHeight(x: number, z: number, t: number, waves: WaveDef[], lodStep: number | null, damp = 1, li = 0.5): number {
  let px = x, pz = z;
  const gph = groupPhases(t);
  for (let it = 0; it < 2; it++) {
    let dx = 0, dz = 0;
    const gm = groupMod(px, pz, gph);
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      const lod = lodStep == null ? 1 : waveLod(w.len, lodStep);
      if (lod <= 0) continue;
      const k = (Math.PI * 2) / w.len;
      const ph = k * (w.dir[0] * px + w.dir[1] * pz) - Math.sqrt(G * k) * t + w.shift;
      const hx = w.q * CHOP * (w.swell ? 1 : stormChop(li)) * w.amp * gainOf(w, li) * (w.swell ? 1 : gm) * lod * damp * Math.cos(ph);
      dx += hx * w.dir[0];
      dz += hx * w.dir[1];
    }
    px = x - dx;
    pz = z - dz;
  }
  let h = 0;
  const gm = groupMod(px, pz, gph);
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const lod = lodStep == null ? 1 : waveLod(w.len, lodStep);
    if (lod <= 0) continue;
    const k = (Math.PI * 2) / w.len;
    h += w.amp * gainOf(w, li) * (w.swell ? 1 : gm) * lod * damp * Math.sin(k * (w.dir[0] * px + w.dir[1] * pz) - Math.sqrt(G * k) * t + w.shift);
  }
  return h;
}

export function waveHeight(x: number, z: number, t: number, waves: WaveDef[], li = 0.5): number {
  return surfaceHeight(x, z, t, waves, null, 1, li);
}

// Аналітична нормаль (приблизна, достатня для плавучості).
export function waveNormal(x: number, z: number, t: number, waves: WaveDef[], out: THREE.Vector3, li = 0.5): THREE.Vector3 {
  let dx = 0, dz = 0;
  const gm = groupMod(x, z, groupPhases(t));
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const k = (Math.PI * 2) / w.len;
    const omega = Math.sqrt(G * k);
    const phase = k * (w.dir[0] * x + w.dir[1] * z) - omega * t + w.shift;
    const c = w.amp * gainOf(w, li) * (w.swell ? 1 : gm) * k * Math.cos(phase);
    dx += c * w.dir[0];
    dz += c * w.dir[1];
  }
  out.set(-dx, 1, -dz).normalize();
  return out;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform vec2  uWaveDir[NW];
uniform float uWaveAmp[NW];
uniform float uWaveK[NW];
uniform float uWavePh[NW];
uniform float uWaveQ[NW];
uniform float uWaveLen[NW];
uniform float uWaveSwell[NW];
uniform sampler2D uShore;
uniform vec4 uShoreRect;
uniform float uIntensity;
uniform vec2 uGroupPh;
varying vec3 vWorldPos;
varying vec2 vBase;
varying float vLocalI;
varying float vDamp;

float groupMod(vec2 p) {
  float a = sin(dot(p, vec2(0.8, 0.6)) * ${GROUP_K1.toFixed(4)} + uGroupPh.x);
  float b = sin(dot(p, vec2(-0.6, 0.8)) * ${GROUP_K2.toFixed(4)} + uGroupPh.y + 0.6 * a);
  return 1.0 + 0.3 * a * (0.6 + 0.4 * b);
}

float gain(float s) { return 0.15 + 0.85 * s + 0.15 * s * s; }
float swellGain(float s) { return 1.8 * pow(max(0.0, s - 0.35), 1.6); }
// seaMul/localIntensity — region.ts (вставляється в конструкторі, коли всі гавані вже відомі)
//REGION//

void main() {
  // радіальна сітка їде за камерою; крок росте з відстанню від центру
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;
  float step = ${RING_B.toFixed(4)} * (length(position.xz) + ${RING_A.toFixed(1)});
  vec3 disp = vec3(0.0);
  // на мілині хвилі слабшають (дзеркало Ocean.shoreDamp)
  float damp = 1.0;
  vec2 suv = (p - uShoreRect.xy) * uShoreRect.zw;
  if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
    float bed = texture2D(uShore, suv).r * 20.0 - 10.0;
    damp = ${SHORE_MIN.toFixed(2)} + ${(1 - SHORE_MIN).toFixed(2)} * (1.0 - smoothstep(-${SHORE_DEEP.toFixed(1)}, -0.6, bed));
  }
  // відкрите море: погода сильніша — хвилі вищі (набір хвиль рахується для загальної сили)
  float li = localIntensity(uIntensity, seaMul(p));
  vLocalI = li;
  float gChop = gain(li), gSwell = swellGain(li);
  float gm = groupMod(p);
  for (int i = 0; i < NW; i++) {
    // хвиля, коротша за 3 кроки сітки, не малюється геометрією (лише нормалями)
    float lod = clamp((uWaveLen[i] / step - 3.0) / 3.0, 0.0, 1.0);
    vec2 D = uWaveDir[i];
    float sw = uWaveSwell[i];
    float A = uWaveAmp[i] * (sw > 0.5 ? gSwell : gChop * gm) * lod * damp;
    float ph = uWaveK[i] * dot(D, p) + uWavePh[i];
    float c = cos(ph), s = sin(ph);
    float hq = uWaveQ[i] * ${CHOP.toFixed(1)} * (sw > 0.5 ? 1.0 : 1.0 + 0.8 * smoothstep(0.6, 1.4, li)) * A;
    float hx = hq * c;
    disp += vec3(hx * D.x, A * s, hx * D.y);
  }
  vDamp = damp;
  vBase = p;
  vec3 world = vec3(p.x, wp.y, p.y) + disp;
  vWorldPos = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3  uSunDir;
uniform vec3  uCamPos;
uniform vec3  uDeepColor;
uniform vec3  uShallowColor;
uniform vec3  uSkyColor;
uniform vec3  uZenithColor;
uniform float uIntensity;
uniform vec2  uWindDir;
uniform vec2  uWaveDir[NW];
uniform float uWaveAmp[NW];
uniform float uWaveK[NW];
uniform float uWavePh[NW];
uniform float uWaveQ[NW];
uniform float uWaveLen[NW];
uniform float uWaveSwell[NW];
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uSunStrength;
uniform float uFlash;
uniform mat4  uHullInv;
uniform float uBoatSpeed;
// глибина біля берега (мапа висот суші): x/z → uv, значення = висота дна/суші
uniform sampler2D uShore;
uniform vec4 uShoreRect; // x0, z0, 1/w, 1/h
// брижі: тайлова карта нормалей (мипмапи самі гасять дрібне вдалині)
uniform sampler2D uRipple;
// переломлення: підводна частина сцени (колір + глибина) з окремого проходу
uniform sampler2D uRefr;
uniform sampler2D uRefrDepth;
uniform vec2  uScreen;
uniform float uNear;
uniform float uFar;
uniform float uRefrOn;
uniform float uRefrScale;
uniform vec2 uGroupPh;
varying vec3 vWorldPos;
//CLOUDS//
varying vec2 vBase;
varying float vLocalI;
varying float vDamp;

float groupModF(vec2 p) {
  float a = sin(dot(p, vec2(0.8, 0.6)) * ${GROUP_K1.toFixed(4)} + uGroupPh.x);
  float b = sin(dot(p, vec2(-0.6, 0.8)) * ${GROUP_K2.toFixed(4)} + uGroupPh.y + 0.6 * a);
  return 1.0 + 0.3 * a * (0.6 + 0.4 * b);
}

float chopGainF(float s) { return 0.15 + 0.85 * s + 0.15 * s * s; }
float swellGainF(float s) { return 1.8 * pow(max(0.0, s - 0.35), 1.6); }

float viewDist(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
// глибина «за водою» без пікселізації: текстура в половинній роздільності, тож на
// краях корпусу/пірсу один її піксель накриває і предмет над водою, і дно —
// беремо найдальшу з 4 вибірок (те, що справді під водою)
float behindDist(vec2 uv) {
  vec2 t = 1.0 / (uScreen * uRefrScale);
  float d = texture2D(uRefrDepth, uv + vec2(-0.5, -0.5) * t).r;
  d = max(d, texture2D(uRefrDepth, uv + vec2(0.5, -0.5) * t).r);
  d = max(d, texture2D(uRefrDepth, uv + vec2(-0.5, 0.5) * t).r);
  d = max(d, texture2D(uRefrDepth, uv + vec2(0.5, 0.5) * t).r);
  return viewDist(d);
}

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

// поріг зі згладжуванням на ширину пікселя: чіткий мальований край без «сходинок»
float aaStep(float e0, float e1, float x) {
  float w = fwidth(x) * 0.75;
  return smoothstep(e0 - w, e1 + w, x);
}

// комірки (Ворона): F2 − F1 → тонкі перетинки між «бульбашками» піни
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float cells(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash2(i + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}

void main() {
  // вода не заходить у корпус (салон нижче ватерлінії, кокпіт, трап)
  vec3 hl = (uHullInv * vec4(vWorldPos, 1.0)).xyz;
  if (abs(hl.z) < 4.68 && hl.y < 1.05 && abs(hl.x) < hullXAtY(hl.y, hl.z) - 0.02) discard;

  vec3 V = normalize(uCamPos - vWorldPos);
  float dist = length(uCamPos - vWorldPos);
  // розмір пікселя на воді (м): дрібніші деталі гасимо — без мерехтіння вдалині
  float fp = max(length(fwidth(vBase)), 1e-4);

  // ── нормаль у кожному пікселі: великі хвилі (Герстнер) + брижі ──
  vec2 slope = vec2(0.0);
  float kept = 0.0, total = 0.0;
  float gmF = groupModF(vBase);
  // гребінь, стиск Герстнера (барашки) і слід за гребенем — у кожному пікселі, а не
  // по вершинах: вдалині трикутники сітки великі, і межі піни йшли по їхніх ребрах
  float hnP = 0.0, a2P = 0.0, jacP = 0.0, trP = 0.0, trW = 0.0;
  float chopM = 1.0 + 0.8 * smoothstep(0.6, 1.4, vLocalI);
  for (int i = 0; i < NW; i++) {
    float w = clamp(uWaveLen[i] / (fp * 8.0) - 1.0, 0.0, 1.0);
    vec2 D = uWaveDir[i];
    float ph = uWaveK[i] * dot(D, vBase) + uWavePh[i];
    {
      float swv = uWaveSwell[i];
      float Aw = uWaveAmp[i] * (swv > 0.5 ? swellGainF(vLocalI) : chopGainF(vLocalI) * gmF) * vDamp;
      float sn = sin(ph);
      hnP += Aw * sn;
      a2P += Aw * Aw;
      float hq = uWaveQ[i] * ${CHOP.toFixed(1)} * (swv > 0.5 ? 1.0 : chopM) * Aw;
      jacP += hq * uWaveK[i] * sn * w;
      float st = Aw * uWaveK[i] * w;
      trP += st * sin(ph + 0.9);
      trW += st;
    }
    float sl = uWaveAmp[i] * (uWaveSwell[i] > 0.5 ? swellGainF(vLocalI) : chopGainF(vLocalI) * gmF) * uWaveK[i];
    slope += D * (sl * cos(ph) * w);
    kept += sl * sl * w;
    total += sl * sl;
  }
  float wind = clamp(vLocalI, 0.0, 1.4);
  // «велика» нормаль — лише хвилі: від неї відбиття неба й освітлення тіла (без «шовку»
  // від бриж на всю поверхню); брижі — лише для блиску сонця й переломлення
  vec2 slopeW = slope;
  // брижі: дві шкали тайлової карти нормалей, повернуті за вітром і зсунуті
  // в різні боки — живий дрібний візерунок без помітних повторів
  vec2 wd = normalize(uWindDir + 1e-4);
  mat2 rot = mat2(wd.y, -wd.x, wd.x, wd.y);
  vec2 qa = rot * vBase;
  // швидкість ~0.1–0.2 м/с: спокійне «дихання» поверхні (раніше брижі бігли
  // втричі швидше й разом з гострим відблиском мерехтіли, як шум)
  vec3 ra = texture2D(uRipple, qa / 9.0 + vec2(0.0, uTime * 0.012)).xyz * 2.0 - 1.0;
  vec3 rb = texture2D(uRipple, (qa * mat2(0.8, 0.6, -0.6, 0.8)) / 4.2 + vec2(uTime * 0.008, -uTime * 0.016)).xyz * 2.0 - 1.0;
  // брижі слабші, ніж були: дрібний «шовк» на всю поверхню й робив воду желе
  float ripA = 0.22 + 0.42 * wind;
  slope += (ra.xy / max(ra.z, 0.3) * 0.14 + rb.xy / max(rb.z, 0.3) * 0.07) * ripA;
  total += 0.02 * ripA * ripA;
  kept += 0.02 * ripA * ripA * (1.0 - smoothstep(0.03, 0.4, fp));
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  // загублені (відфільтровані) нахили → шорсткість: блиск ширшає, а не мерехтить
  // шторм: вода матова (дощ і брижі на брижах) — без «желейного» глянцю
  float stormF = smoothstep(0.45, 1.2, vLocalI);
  float rough = clamp(sqrt(max(total - kept, 0.0)) * 3.0 + stormF * 0.7, 0.0, 1.0);
  if (dot(N, V) < 0.0) N = -N;
  vec3 Nm = normalize(vec3(-slopeW.x, 1.0, -slopeW.y));
  if (dot(Nm, V) < 0.0) Nm = -Nm;
  Nm = normalize(mix(Nm, N, 0.12));

  float NdV = max(dot(Nm, V), 0.0);
  // Френель (Шлік, вода F0 = 0.02)
  // стилізований Френель: здебільшого від «рівної» води (плавний градієнт із відстанню),
  // хвилі лише трохи його модулюють — інакше під пологим кутом кожен схил дає біле
  // «шовкове» пасмо відбитого неба
  float fresFlat = 0.02 + 0.98 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
  float fresWave = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  float fres = mix(fresFlat, fresWave, 0.3) * (1.0 - 0.45 * stormF);

  // відбите небо: градієнт горизонт → зеніт за напрямком відбиття
  vec3 R = reflect(-V, Nm);
  float ry = clamp(R.y, 0.0, 1.0);
  vec3 refl = mix(uSkyColor, uZenithColor, pow(ry, 0.55));
  // шорстка вода відбиває небо розмито (без шовкових смуг)
  refl = mix(refl, mix(uSkyColor, uZenithColor, 0.45), rough * 0.75);
  // хмари у відбитті: стовпчик густини там, де відбитий промінь перетинає шар
  // (рівніша нормаль і розмитий шум: інакше кожна хвиля «мармурить» відбиття)
  vec3 Rc = reflect(-V, normalize(mix(vec3(0.0, 1.0, 0.0), Nm, 0.3)));
  if (Rc.y > 0.03) {
    float ch = mix(uCloudLayer.x, uCloudLayer.y, 0.3) - vWorldPos.y;
    vec2 cq = vWorldPos.xz + Rc.xz / Rc.y * ch;
    float cDist = ch / Rc.y;
    vec3 ccv = cloudCoverAt(cq);
    vec2 cuv = cloudUV(cq);
    float cs = texture2D(uCloudNoise, cuv, 2.5).r * 0.62 + texture2D(uCloudNoise, cuv * 2.7 + vec2(0.37, 0.11), 2.5).a * 0.38;
    float ca = smoothstep(-0.04, 0.22, cs - (1.0 - ccv.r)) * (1.0 - smoothstep(5000.0, 14000.0, cDist));
    vec3 ccol = mix(mix(uCShade, uCLit, 0.55 + 0.25 * Rc.y), uCStorm, ccv.g);
    ccol = mix(ccol, uSkyColor, smoothstep(2500.0, 14000.0, cDist) * 0.6);
    refl = mix(refl, ccol, ca * (1.0 - rough * 0.5) * 0.6);
  }

  // ── тіло води: стилізована палітра — темна синява в западинах, насичений синій
  // посередині, бірюза на гребенях; тонкі гребені просвічують (SSS) зеленкувато ──
  vec3 L = normalize(uSunDir);
  float sunI = 0.3 + 0.7 * uSunStrength;
  float crestP = clamp(hnP / max(sqrt(a2P * 0.5), 1e-3) * 0.5, -1.0, 1.0);
  float hr = clamp(crestP * 0.5 + 0.5, 0.0, 1.0);               // 0 западина … 1 гребінь
  float trailP = trP / max(trW, 1e-4);
  vec3 cTrough = vec3(0.015, 0.11, 0.24);
  vec3 cMid    = vec3(0.03, 0.26, 0.45);
  vec3 cCrest  = vec3(0.06, 0.46, 0.55);
  vec3 cSSS    = vec3(0.16, 0.78, 0.62);
  // шторм — темніше й холодніше (свинцева вода), штиль — світліше
  cTrough = mix(cTrough, vec3(0.015, 0.05, 0.08), stormF * 0.8);
  cMid = mix(cMid, vec3(0.04, 0.13, 0.17), stormF * 0.7);
  cCrest = mix(cCrest, vec3(0.08, 0.36, 0.38), stormF * 0.5);
  vec3 body = mix(cTrough, cMid, smoothstep(0.2, 0.7, hr));
  body = mix(body, cCrest, smoothstep(0.68, 0.98, hr) * (0.9 - 0.25 * stormF));
  // світло: схил до сонця світліший — форму хвилі видно (стилізовано, м'яко)
  float lam = 0.6 + 0.4 * max(dot(Nm, L), 0.0);
  // тінь від хмар: плями повзуть по воді
  float csh = cloudShadow(vWorldPos);
  body *= lam * sunI * (0.3 + 0.7 * csh);
  // підповерхневе світіння: гребінь між оком і сонцем + грань хвилі під кутом
  float back = pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 4.0);
  float face = clamp(1.0 - NdV, 0.0, 1.0);
  float thin = smoothstep(0.6, 1.0, hr);
  float sss = thin * (0.25 + 1.6 * back) * (0.45 + 0.55 * face) * uSunStrength * csh;
  body += cSSS * sss * (0.55 + 0.25 * stormF);
  // вода трохи бере колір неба (захід, ніч), але не сіріє
  body = mix(body, uSkyColor * 0.5, 0.12);
  // глибина вдалині: насичена синява горизонту
  body = mix(body, cMid * sunI * 0.9 + uSkyColor * 0.06, smoothstep(60.0, 420.0, dist) * 0.5);

  // ── прозорість: що під водою (дно, корпус, скелі, палі), зі зсувом від хвиль ──
  vec3 under = body;
  float thick = 1e4;
  if (uRefrOn > 0.5) {
    vec2 uv = gl_FragCoord.xy / uScreen;
    float wD = viewDist(gl_FragCoord.z);
    float sD = behindDist(uv);
    thick = max(sD - wD, 0.0);
    vec2 off = N.xz * min(0.05, 0.9 / max(wD, 1.0)) * smoothstep(0.0, 1.5, thick);
    vec2 uv2 = clamp(uv + off, vec2(0.001), vec2(0.999));
    // зсув «зачепив» щось над водою (корпус, пірс) — без зсуву; якщо й там
    // предмет над водою (край силуету) — не показуємо його крізь воду взагалі
    float above = 0.0;
    if (viewDist(texture2D(uRefrDepth, uv2).r) < wD + 0.05) {
      uv2 = uv;
      // м'яко, а не так/ні — інакше на кромці берега й корпусу драбинка пікселів
      above = 1.0 - smoothstep(wD - 0.25, wD + 0.12, viewDist(texture2D(uRefrDepth, uv).r));
    }
    vec3 refr = texture2D(uRefr, uv2).rgb;
    #ifdef TONE_MAPPING
      refr = toneMapping(refr);
    #endif
    refr = linearToOutputTexel(vec4(refr, 1.0)).rgb;
    // каламутність росте з хвилюванням (шторм збурює воду)
    float murk = 1.0 + 1.6 * wind;
    float vis = exp(-thick * 0.17 * murk);
    vec3 tint = exp(-thick * vec3(0.38, 0.1, 0.07) * murk);   // червоне гасне першим → бірюза
    // мілко (гавань, лагуна біля острова): світло відбивається від дна — бірюзова вода
    float lagoon = exp(-thick * 0.22) * (1.0 - above) * (1.0 - 0.5 * stormF);
    vec3 cLagoon = vec3(0.05, 0.46, 0.5) * sunI + cSSS * 0.08 * uSunStrength;
    vec3 bodyS = mix(body, cLagoon, lagoon * 0.75);
    under = mix(bodyS, refr * tint * (0.75 + 0.25 * sunI), vis * (1.0 - above));
  }
  // стилізовано: відбиття неба м'якше (вода лишається синьою, а не дзеркально-сірою)
  vec3 col = mix(under, refl * (0.88 - 0.3 * stormF), min(fres, 0.55) * (1.0 - 0.45 * stormF));

  // піна на дотику з предметами (скелі, палі, буї) — тонкий живий обідок
  if (thick < 0.4) {
    float en = fbm(vBase * 2.6 + uTime * 0.4);
    float edgeF = (1.0 - smoothstep(0.0, 0.4, thick)) * smoothstep(0.4, 0.75, en + 0.3 * (1.0 - thick / 0.4));
    edgeF *= 1.0 - smoothstep(25.0, 60.0, dist); // вдалині обідок — у кілька пікселів, гасимо
    vec3 ec = vec3(0.93, 0.96, 0.98) * clamp(0.15 + 0.85 * uSunStrength, 0.0, 1.0) + uSkyColor * 0.1;
    col = mix(col, ec, edgeF * 0.65);
  }

  // сонце: гострий блиск (звужується, де деталі збережені) + м'який ореол
  vec3 Hs = normalize(L + V);
  vec3 Ns = normalize(mix(Nm, N, 0.55));
  float NdH = max(dot(Ns, Hs), 0.0);
  float pw = mix(420.0, 60.0, rough);
  float spec = pow(NdH, pw) * (pw / 120.0) * uSunStrength * (0.3 + 0.7 * fres * 4.0);
  col += vec3(1.0, 0.95, 0.84) * min(spec, 6.0) * csh * csh;
  col += vec3(1.0, 0.88, 0.68) * pow(NdH, 24.0) * 0.08 * uSunStrength * (1.0 - stormF) * csh;

  // місячна доріжка (місяць — навпроти сонця, як moonLight у main.ts)
  vec3 Lm = normalize(vec3(-L.x, max(-L.y, 0.2), -L.z));
  float moonI = clamp(1.0 - uSunStrength * 3.0, 0.0, 1.0);
  float NdM = max(dot(N, normalize(Lm + V)), 0.0);
  col += vec3(0.75, 0.85, 1.0) * pow(NdM, mix(500.0, 60.0, rough)) * moonI * 1.2;
  col += vec3(0.5, 0.6, 0.85) * pow(NdM, 20.0) * moonI * 0.06;

  // ── піна (мальована): барашки там, де Герстнер стискає гребінь (якобіан),
  // смуги залишкової піни позаду гребенів, візерунок — комірки з перетинками ──
  float capOn = smoothstep(0.18, 0.7, vLocalI);
  if (capOn > 0.0) {
    vec2 wd = normalize(uWindDir + 1e-4);
    vec2 q = vec2(dot(vBase, wd), dot(vBase, vec2(-wd.y, wd.x)));
    // поріг стиску: у вітер — рідкі барашки, у шторм гребені біліють частіше (але не суцільно)
    float jT = 0.1 + 0.16 * (1.0 - capOn) - 0.02 * stormF;
    // гребені й великих, і дрібних хвиль (якобіан ловить обидва; висота — лише великі)
    float crestF = aaStep(jT, jT + 0.2, jacP) * smoothstep(0.42, 0.75, hr);
    float trailF = smoothstep(0.6, 0.95, trailP) * smoothstep(0.25, 0.7, hr) * (0.25 + 0.75 * stormF);
    float amount = max(crestF, trailF * 0.55) * capOn;
    if (amount > 0.01) {
      // бульбашки: комірки, витягнуті за вітром і повільно знесені
      vec2 fq = q * vec2(0.7, 1.4) - vec2(uTime * 0.6, 0.0);
      // викривлені комірки — бульбашки різного розміру; рвуть край піни, а не малюють сітку
      vec2 warp = vec2(fbm(fq * 0.7), fbm(fq * 0.7 + 3.7)) * 1.6;
      float web = cells((fq + warp) * 2.4);
      float n = fbm(q * vec2(0.8, 2.0) - vec2(uTime * 0.3, 0.0));
      float a = amount + (n - 0.5) * 0.5 + (web - 0.35) * 0.3;
      float solid = aaStep(0.5, 0.62, a) * (0.78 + 0.22 * smoothstep(0.1, 0.5, web));
      // тонкі мереживні нитки довкола плями
      float lace = (1.0 - aaStep(0.04, 0.12, web)) * aaStep(0.2, 0.45, a) * 0.8;
      float foam = clamp(max(solid, lace), 0.0, 1.0);
      foam = aaStep(0.35, 0.6, foam);                            // мальований чіткий край
      foam *= 1.0 - 0.55 * smoothstep(0.06, 0.3, fp);               // вдалині — м'якше, без мерехтіння
      // біла піна з ледь бірюзовою тінню в западинах бульбашок; у шторм не сіріє (своє світло)
      vec3 fcol = mix(vec3(0.78, 0.93, 0.95), vec3(1.0), smoothstep(0.15, 0.6, web) * 0.7 + 0.3) * clamp(0.12 + 0.88 * max(uSunStrength, dot(uSkyColor, vec3(0.3, 0.59, 0.11)) * 1.15), 0.0, 1.0) + uSkyColor * 0.06;
      col = mix(col, fcol, foam * 0.95);
    }
    // від 8 балів: довгі смуги піни вздовж вітру й плями залишкової піни
    if (stormF > 0.0) {
      float st = fbm(q * vec2(0.035, 0.55) + vec2(-uTime * 0.25, 0.0));
      float streak = smoothstep(0.62, 0.8, st) * (0.6 + 0.4 * fbm(q * vec2(0.3, 1.2)));
      float web2 = cells(q * vec2(0.18, 0.5) - vec2(uTime * 0.2, 0.0));
      float patches = smoothstep(0.6, 0.8, fbm(vBase * 0.09 + vec2(uTime * 0.03, 0.0))) * (1.0 - smoothstep(0.05, 0.25, web2));
      float sf = clamp(streak * 0.7 + patches * 0.6, 0.0, 1.0) * stormF;
      sf *= 1.0 - 0.5 * smoothstep(0.08, 0.4, fp);
      vec3 fc2 = vec3(0.82, 0.9, 0.93) * clamp(0.12 + 0.88 * uSunStrength, 0.0, 1.0) + uSkyColor * 0.1;
      col = mix(col, fc2, sf * 0.6);
    }
  }

  // Піна біля корпусу (носова хвиля) і кільватер за кормою
  {
    float spd = clamp(uBoatSpeed / 7.0, 0.0, 1.0);
    float n = fbm(vWorldPos.xz * 1.7 + uTime * 0.45);
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

  // Прибій: смуги піни біля берега, що набігають і тануть
  {
    vec2 suv = (vWorldPos.xz - uShoreRect.xy) * uShoreRect.zw;
    float bed = suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0 ? texture2D(uShore, suv).r * 20.0 - 10.0 : -10.0; // висота дна, м
    // глибока вода (майже весь світ) — без прибою й шуму: дешево
    if (bed > -4.6) {
      float shallow = smoothstep(-4.5, -0.4, bed);        // 0 глибоко … 1 біля самої кромки
      // мілину тепер дає справжня прозорість (дно крізь воду); фарбуємо лише без неї
      if (uRefrOn < 0.5) col = mix(col, uShallowColor * (0.6 + 0.7 * uSunStrength) + vec3(0.06, 0.1, 0.07), shallow * 0.5);
      float wave = sin(bed * 2.6 + uTime * 1.3) * 0.5 + 0.5;
      float n = fbm(vWorldPos.xz * 1.1 + uTime * 0.2);
      float near = smoothstep(-2.2, -0.3, bed);          // смуга прибою — лише біля самої кромки
      float surf = smoothstep(0.7, 0.95, wave * near + n * 0.3) * near * 0.8;
      surf = max(surf, smoothstep(-0.5, -0.05, bed) * smoothstep(0.35, 0.65, n)); // кромка
      vec3 foamCol = vec3(0.95, 0.97, 0.98) * clamp(0.15 + 0.85 * uSunStrength, 0.0, 1.0) + uSkyColor * 0.1;
      col = mix(col, foamCol, clamp(surf, 0.0, 1.0) * 0.72);
    }
  }

  // Блискавка підсвічує воду
  col += vec3(0.7, 0.8, 1.0) * uFlash * (0.25 + 0.5 * fres);

  // Димка відстані
  float fogF = 1.0 - exp(-dist * dist * uFogDensity * uFogDensity);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  // ледь помітний дизеринг: плавні градієнти глибини й неба без смуг (8 біт на канал)
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** кільця навколо (0,0): r_j = A·(e^{B·j} − 1) до OCEAN_RADIUS, ANG_SEGS по колу */
function radialGrid(): THREE.BufferGeometry {
  const rings = Math.ceil(Math.log(OCEAN_RADIUS / RING_A + 1) / RING_B);
  const pos = new Float32Array((rings + 1) * ANG_SEGS * 3);
  for (let j = 0; j <= rings; j++) {
    const r = RING_A * (Math.exp(RING_B * j) - 1);
    for (let i = 0; i < ANG_SEGS; i++) {
      const a = (i / ANG_SEGS) * Math.PI * 2;
      const o = (j * ANG_SEGS + i) * 3;
      pos[o] = Math.cos(a) * r;
      pos[o + 1] = 0;
      pos[o + 2] = Math.sin(a) * r;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < ANG_SEGS; i++) {
      const a = j * ANG_SEGS + i, b = j * ANG_SEGS + ((i + 1) % ANG_SEGS);
      const c = a + ANG_SEGS, d = b + ANG_SEGS;
      idx.push(a, b, c, b, d, c); // нормаль угору (видно згори)
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

/** шар об'єктів, що можуть бути під водою (корпус, дно, скелі, палі) — для переломлення */
export const UNDERWATER_LAYER = 3;

/**
 * Тайлова карта нормалей бриж: сума ~48 синусів з цілими частотами (шов не видно),
 * спектр ~1/k (більше дрібних хвиль), переважно поперек «вітру» (вісь y).
 */
function rippleTexture(size = 256): THREE.DataTexture {
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const waves: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 48; i++) {
    const f = 2 + Math.floor(Math.pow(rnd(), 1.6) * 22);
    const ang = (rnd() - 0.5) * Math.PI * 1.1; // ±~100° навколо вітру
    const m = Math.round(Math.sin(ang) * f), n = Math.round(Math.cos(ang) * f) || 1;
    waves.push([m, n, 1 / Math.pow(Math.hypot(m, n), 1.15), rnd() * Math.PI * 2]);
  }
  const data = new Uint8Array(size * size * 4);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const [m, n, a, ph] of waves) {
        const c = Math.cos(TAU * (m * x + n * y) / size + ph) * a * TAU;
        dx += c * m;
        dy += c * n;
      }
      // нахили → нормаль (масштаб підібрано так, щоб типовий нахил ~0.3)
      const sx = dx * 0.012, sy = dy * 0.012;
      const l = Math.hypot(sx, sy, 1);
      const o = (y * size + x) * 4;
      data[o] = Math.round((-sx / l * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((-sy / l * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export class Ocean {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  private waves: WaveDef[] = waveSet(0.5);
  private intensity = 0.5;

  constructor(scene: THREE.Scene) {
    const geo = radialGrid();

    const dirs: THREE.Vector2[] = [];
    const amps: number[] = [];
    const ks: number[] = [];
    const omegas: number[] = [];
    const qs: number[] = [];
    const lens: number[] = [];
    const init = waveSet(0.3);
    for (let i = 0; i < WAVE_COUNT; i++) {
      dirs.push(new THREE.Vector2(init[i].dir[0], init[i].dir[1]));
      amps.push(init[i].amp);
      const k = (Math.PI * 2) / init[i].len;
      ks.push(k);
      omegas.push(Math.sqrt(G * k));
      qs.push(init[i].q);
      lens.push(init[i].len);
    }
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT.replace('//REGION//', regionGlsl()),
      fragmentShader: FRAG.replace('//CLOUDS//', CLOUD_COMMON + CLOUD_COLORS),
      defines: { NW: WAVE_COUNT },
      uniforms: {
        ...cloudUniforms,
        uRipple: { value: rippleTexture() },
        uRefr: { value: null },
        uRefrDepth: { value: null },
        uScreen: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uRefrOn: { value: 0 },
        uRefrScale: { value: 0.5 },
        uTime: { value: 0 },
        uWaveDir: { value: dirs },
        uWaveAmp: { value: amps },
        uWaveK: { value: ks },
        uWavePh: { value: omegas.map(() => 0) },
        uWaveQ: { value: qs },
        uWaveLen: { value: lens },
        uWaveSwell: { value: init.map((w) => (w.swell ? 1 : 0)) },
        uZenithColor: { value: new THREE.Color(0x4a94d4) },
        uIntensity: { value: 0.3 },
        uWindDir: { value: new THREE.Vector2(0, -1) },
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
        uShore: { value: null },
        uShoreRect: { value: new THREE.Vector4(0, 0, 0, 0) },
        uGroupPh: { value: new THREE.Vector2() },
      },
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /**
   * Мапа висот біля берега для прибою: height(x,z) — висота суші/дна (м).
   * Прямокутник x0..x0+w, z0..z0+h, роздільність res м на піксель.
   */
  setShore(height: (x: number, z: number) => number, x0: number, z0: number, w: number, h: number, res = 2) {
    const nx = Math.ceil(w / res), nz = Math.ceil(h / res);
    const data = new Uint8Array(nx * nz * 4);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const v = Math.round(THREE.MathUtils.clamp((height(x0 + (i + 0.5) * res, z0 + (j + 0.5) * res) + 10) / 20, 0, 1) * 255);
        const o = (j * nx + i) * 4;
        data[o] = data[o + 1] = data[o + 2] = v;
        data[o + 3] = 255;
      }
    }
    this.shore = { data, nx, nz, x0, z0, w: nx * res, h: nz * res };
    const tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.material.uniforms.uShore.value = tex;
    (this.material.uniforms.uShoreRect.value as THREE.Vector4).set(x0, z0, 1 / (nx * res), 1 / (nz * res));
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

  private shore: { data: Uint8Array; nx: number; nz: number; x0: number; z0: number; w: number; h: number } | null = null;

  /** локальна сила погоди в точці (відкрите море — сильніша; дзеркало шейдера) */
  localI(x: number, z: number): number {
    return localIntensity(this.intensity, seaMul(x, z));
  }

  /** множник амплітуди хвиль на мілині (дзеркало вершинного шейдера; білінійно як LinearFilter) */
  shoreDamp(x: number, z: number): number {
    const S = this.shore;
    if (!S) return 1;
    const u = (x - S.x0) / S.w, v = (z - S.z0) / S.h;
    if (u <= 0 || u >= 1 || v <= 0 || v >= 1) return 1;
    const fx = u * S.nx - 0.5, fz = v * S.nz - 0.5;
    const ix = Math.max(0, Math.min(S.nx - 2, Math.floor(fx))), iz = Math.max(0, Math.min(S.nz - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - ix)), tz = Math.min(1, Math.max(0, fz - iz));
    const at = (i: number, j: number) => S.data[(j * S.nx + i) * 4] / 255;
    const val = (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz;
    const bed = val * 20 - 10;
    const k = Math.min(1, Math.max(0, (bed + SHORE_DEEP) / (SHORE_DEEP - 0.6)));
    return SHORE_MIN + (1 - SHORE_MIN) * (1 - k * k * (3 - 2 * k));
  }

  // ── переломлення: підводна частина сцени в половинній роздільності ──
  private refrRT: THREE.WebGLRenderTarget | null = null;
  private _size = new THREE.Vector2();
  private _clear = new THREE.Color();
  private refrScale = 0.5;
  /** відсікання: лишаємо y ≤ 0.12 (трохи вище середнього рівня води) */
  private clipBelow = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.4)];

  /**
   * Перед головним рендером: малює лише шар UNDERWATER_LAYER (без води й неба)
   * у текстуру кольору + глибини, яку вода показує крізь себе зі зсувом від хвиль.
   */
  renderRefraction(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    renderer.getDrawingBufferSize(this._size);
    // роздільність: повна до ~1600 px завширшки, далі пропорційно менша (прохід легкий —
    // лише підводні речі, — а половинна давала «сходинки» на краях паль і корпусу)
    // повна роздільність буфера (на ретині раніше — ледь не половина: «сходинки» біля
    // корпусу й берега); обмеження лише для дуже широких екранів
    const sc = Math.min(1, 2560 / Math.max(1, this._size.x));
    this.refrScale = sc;
    const w = Math.max(1, Math.floor(this._size.x * sc)), h = Math.max(1, Math.floor(this._size.y * sc));
    if (!this.refrRT) {
      const depth = new THREE.DepthTexture(w, h);
      depth.type = THREE.UnsignedIntType;
      this.refrRT = new THREE.WebGLRenderTarget(w, h, { depthTexture: depth, type: THREE.HalfFloatType });
      this.refrRT.texture.minFilter = this.refrRT.texture.magFilter = THREE.LinearFilter;
    } else if (this.refrRT.width !== w || this.refrRT.height !== h) {
      this.refrRT.setSize(w, h);
    }
    const mask = camera.layers.mask;
    const autoShadow = renderer.shadowMap.autoUpdate;
    const prevRT = renderer.getRenderTarget();
    renderer.getClearColor(this._clear);
    const alpha = renderer.getClearAlpha();
    camera.layers.set(UNDERWATER_LAYER);
    renderer.shadowMap.autoUpdate = false; // тіні — з головного проходу
    // лише те, що під водою: верх пірсу й борти над водою відрізаємо — тоді на
    // краях силуетів вода не «бачить» крізь себе сам предмет (білі облямівки)
    const clips = renderer.clippingPlanes;
    renderer.clippingPlanes = this.clipBelow;
    this.mesh.visible = false;
    renderer.setRenderTarget(this.refrRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevRT);
    renderer.clippingPlanes = clips;
    renderer.setClearColor(this._clear, alpha);
    this.mesh.visible = true;
    renderer.shadowMap.autoUpdate = autoShadow;
    camera.layers.mask = mask;
    const u = this.material.uniforms;
    u.uRefr.value = this.refrRT.texture;
    u.uRefrDepth.value = this.refrRT.depthTexture;
    (u.uScreen.value as THREE.Vector2).copy(this._size);
    u.uRefrScale.value = this.refrScale;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uRefrOn.value = 1;
  }

  /** центр сітки (камера) — для «як намальовано» */
  private center = new THREE.Vector2();
  private _oldDirs = new Float64Array(WAVE_COUNT * 2);
  /** кооп-гість: [windDir, shift×N] від капітана */
  net: number[] | null = null;

  /** кооп-капітан: стан хвиль для гостей */
  netState(): number[] {
    return [Math.round(this.windDir * 1e5) / 1e5, ...this.waves.map((w) => Math.round(w.shift * 1e4) / 1e4)];
  }

  update(dt: number, t: number, cam: THREE.Vector3, sunDir: THREE.Vector3, skyColor: THREE.Color, fogColor: THREE.Color, fogDensity: number, sunStrength: number, flash: number, zenith?: THREE.Color) {
    // сітка їде за камерою (лише по горизонталі)
    this.mesh.position.set(cam.x, 0, cam.z);
    this.center.set(cam.x, cam.z);
    // м'яко доганяємо цільові умови (без дрифу, без alloc)
    this.intensity += (this.targetIntensity - this.intensity) * (1 - Math.exp(-0.8 * dt));
    if (this.net) {
      // кооп-гість: напрямок і фази хвиль — точно як у капітана
      this.windDir = this.net[0];
      updateWaveSet(this.waves, this.intensity, this.windDir);
      for (let i = 0; i < WAVE_COUNT; i++) this.waves[i].shift = this.net[1 + i] ?? 0;
    } else {
      this.windDir += wrapAngle(this.targetWindDir - this.windDir) * (1 - Math.exp(-0.6 * dt));
      // поворот хвиль навколо камери, а не (0,0) світу: фаза тут не стрибає
      const old = this._oldDirs;
      for (let i = 0; i < WAVE_COUNT; i++) {
        old[i * 2] = this.waves[i].dir[0];
        old[i * 2 + 1] = this.waves[i].dir[1];
      }
      updateWaveSet(this.waves, this.intensity, this.windDir);
      for (let i = 0; i < WAVE_COUNT; i++) {
        const w = this.waves[i];
        const k = (Math.PI * 2) / w.len;
        const d = k * ((old[i * 2] - w.dir[0]) * cam.x + (old[i * 2 + 1] - w.dir[1]) * cam.z);
        w.shift = (w.shift + d) % (Math.PI * 2);
      }
    }

    const u = this.material.uniforms;
    u.uTime.value = t;
    const gph = groupPhases(t);
    (u.uGroupPh.value as THREE.Vector2).set(gph[0], gph[1]);
    (u.uCamPos.value as THREE.Vector3).copy(cam);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir).normalize();
    (u.uSkyColor.value as THREE.Color).copy(skyColor);
    (u.uFogColor.value as THREE.Color).copy(fogColor);
    u.uFogDensity.value = fogDensity;
    u.uSunStrength.value = sunStrength;
    u.uFlash.value = flash;
    u.uIntensity.value = this.intensity;
    (u.uWindDir.value as THREE.Vector2).set(Math.sin(this.windDir), -Math.cos(this.windDir));
    (u.uZenithColor.value as THREE.Color).copy(zenith ?? skyColor);

    const dirs = u.uWaveDir.value as THREE.Vector2[];
    const amps = u.uWaveAmp.value as number[];
    const ks = u.uWaveK.value as number[];
    const phs = u.uWavePh.value as number[];
    const qs = u.uWaveQ.value as number[];
    const lens = u.uWaveLen.value as number[];
    for (let i = 0; i < WAVE_COUNT; i++) {
      const w = this.waves[i];
      dirs[i].set(w.dir[0], w.dir[1]);
      amps[i] = w.amp;
      const k = (Math.PI * 2) / w.len;
      ks[i] = k;
      // фаза в подвійній точності, згорнута в 0..2π — без втрати точності float32 за години гри
      phs[i] = (w.shift - ((Math.sqrt(G * k) * t) % (Math.PI * 2))) % (Math.PI * 2);
      qs[i] = w.q;
      lens[i] = w.len;
    }
  }

  // Для фізики: поточний набір хвиль
  currentWaves(): WaveDef[] {
    return this.waves;
  }

  /**
   * Висота так, як її МАЛЮЄ сітка: вдалині від камери короткі хвилі згасають
   * (див. waveLod) — для того, що лежить на воді (слід піни), щоб не тонуло й не висіло.
   */
  renderedHeightAt(x: number, z: number, t: number): number {
    const r = Math.hypot(x - this.center.x, z - this.center.y);
    return surfaceHeight(x, z, t, this.waves, gridStep(r), this.shoreDamp(x, z), this.localI(x, z));
  }

  heightAt(x: number, z: number, t: number): number {
    return surfaceHeight(x, z, t, this.waves, null, this.shoreDamp(x, z), this.localI(x, z));
  }
  normalAt(x: number, z: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    waveNormal(x, z, t, this.waves, out, this.localI(x, z));
    const d = this.shoreDamp(x, z);
    if (d !== 1) out.set(out.x * d, out.y, out.z * d).normalize();
    return out;
  }
}
