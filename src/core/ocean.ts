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
const CHOP = 5;
/** вага хвилі довжини len там, де крок сітки step: < 3 вершин на хвилю — не малюється */
function waveLod(len: number, step: number): number {
  const n = len / step;
  return Math.min(1, Math.max(0, (n - 3) / 3));
}

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

// Висота поверхні у світовій точці (x, z) — та сама, що малює шейдер:
// Герстнер зсуває вершини по горизонталі, тож шукаємо базову точку p,
// що після зсуву потрапляє в (x, z) (дві ітерації вистачає), і беремо її висоту.
// lodStep(x, z) — крок сітки там (для «як намальовано»), null — усі хвилі.
function surfaceHeight(x: number, z: number, t: number, waves: WaveDef[], lodStep: number | null, damp = 1): number {
  let px = x, pz = z;
  for (let it = 0; it < 2; it++) {
    let dx = 0, dz = 0;
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      const lod = lodStep == null ? 1 : waveLod(w.len, lodStep);
      if (lod <= 0) continue;
      const k = (Math.PI * 2) / w.len;
      const ph = k * (w.dir[0] * px + w.dir[1] * pz) - Math.sqrt(G * k) * t;
      const hx = w.q * CHOP * w.amp * lod * damp * Math.cos(ph);
      dx += hx * w.dir[0];
      dz += hx * w.dir[1];
    }
    px = x - dx;
    pz = z - dz;
  }
  let h = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const lod = lodStep == null ? 1 : waveLod(w.len, lodStep);
    if (lod <= 0) continue;
    const k = (Math.PI * 2) / w.len;
    h += w.amp * lod * damp * Math.sin(k * (w.dir[0] * px + w.dir[1] * pz) - Math.sqrt(G * k) * t);
  }
  return h;
}

export function waveHeight(x: number, z: number, t: number, waves: WaveDef[]): number {
  return surfaceHeight(x, z, t, waves, null);
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
uniform float uWaveLen[5];
uniform sampler2D uShore;
uniform vec4 uShoreRect;
varying vec3 vWorldPos;
varying vec2 vBase;
varying float vCrest;

void main() {
  // радіальна сітка їде за камерою; крок росте з відстанню від центру
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;
  float step = ${RING_B.toFixed(4)} * (length(position.xz) + ${RING_A.toFixed(1)});
  vec3 disp = vec3(0.0);
  float hn = 0.0, ampSum = 0.0;
  // на мілині хвилі слабшають (дзеркало Ocean.shoreDamp)
  float damp = 1.0;
  vec2 suv = (p - uShoreRect.xy) * uShoreRect.zw;
  if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
    float bed = texture2D(uShore, suv).r * 20.0 - 10.0;
    damp = ${SHORE_MIN.toFixed(2)} + ${(1 - SHORE_MIN).toFixed(2)} * (1.0 - smoothstep(-${SHORE_DEEP.toFixed(1)}, -0.6, bed));
  }
  for (int i = 0; i < 5; i++) {
    // хвиля, коротша за 3 кроки сітки, не малюється геометрією (лише нормалями)
    float lod = clamp((uWaveLen[i] / step - 3.0) / 3.0, 0.0, 1.0);
    vec2 D = uWaveDir[i];
    float A = uWaveAmp[i] * lod * damp;
    float ph = uWaveK[i] * dot(D, p) - uWaveOmega[i] * uTime;
    float c = cos(ph), s = sin(ph);
    float hx = uWaveQ[i] * ${CHOP.toFixed(1)} * A * c;
    disp += vec3(hx * D.x, A * s, hx * D.y);
    hn += uWaveAmp[i] * damp * s;
    ampSum += uWaveAmp[i];
  }
  // гребінь: наскільки точка близька до максимуму суми хвиль (0..1)
  vCrest = hn / max(ampSum, 1e-3);
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
uniform vec2  uWaveDir[5];
uniform float uWaveAmp[5];
uniform float uWaveK[5];
uniform float uWaveOmega[5];
uniform float uWaveQ[5];
uniform float uWaveLen[5];
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
varying vec3 vWorldPos;
varying vec2 vBase;
varying float vCrest;

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

  vec3 V = normalize(uCamPos - vWorldPos);
  float dist = length(uCamPos - vWorldPos);
  // розмір пікселя на воді (м): дрібніші деталі гасимо — без мерехтіння вдалині
  float fp = max(length(fwidth(vBase)), 1e-4);

  // ── нормаль у кожному пікселі: великі хвилі (Герстнер) + брижі ──
  vec2 slope = vec2(0.0);
  float kept = 0.0, total = 0.0;
  for (int i = 0; i < 5; i++) {
    float w = clamp(uWaveLen[i] / (fp * 8.0) - 1.0, 0.0, 1.0);
    vec2 D = uWaveDir[i];
    float ph = uWaveK[i] * dot(D, vBase) - uWaveOmega[i] * uTime;
    float sl = uWaveAmp[i] * uWaveK[i];
    slope += D * (sl * cos(ph) * w);
    kept += sl * sl * w;
    total += sl * sl;
  }
  float wind = clamp(uIntensity, 0.0, 1.2);
  // брижі: градієнт шуму у двох октавах, що біжать за вітром (синуси давали
  // помітні згори рівні смуги); дрібне гаситься за розміром пікселя
  float ripA = 0.07 + 0.09 * wind;
  vec2 wd = normalize(uWindDir + 1e-4);
  for (int j = 0; j < 2; j++) {
    float sc = j == 0 ? 0.85 : 2.1;               // ~1.2 м і ~0.5 м
    float len = 1.0 / sc;
    float w = clamp(len / (fp * 6.0) - 1.0, 0.0, 1.0);
    if (w > 0.0) {
      vec2 q = vBase * sc - wd * uTime * (0.55 + 0.25 * float(j)) + float(j) * 17.3;
      float e = 0.2;
      vec2 g = vec2(noise(q + vec2(e, 0.0)) - noise(q - vec2(e, 0.0)), noise(q + vec2(0.0, e)) - noise(q - vec2(0.0, e))) / (2.0 * e);
      slope += g * ripA * (j == 0 ? 1.0 : 0.6) * w;
    }
    float a2 = ripA * (j == 0 ? 1.0 : 0.6) * 0.6;
    kept += a2 * a2 * w;
    total += a2 * a2;
  }
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  // загублені (відфільтровані) нахили → шорсткість: блиск ширшає, а не мерехтить
  float rough = clamp(sqrt(max(total - kept, 0.0)) * 3.0, 0.0, 1.0);
  if (dot(N, V) < 0.0) N = -N;

  float NdV = max(dot(N, V), 0.0);
  // Френель (Шлік, вода F0 = 0.02)
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

  // відбите небо: градієнт горизонт → зеніт за напрямком відбиття
  vec3 R = reflect(-V, N);
  float ry = clamp(R.y, 0.0, 1.0);
  vec3 refl = mix(uSkyColor, uZenithColor, pow(ry, 0.55));

  // тіло води: глибока синява, на гребенях і проти сонця — бірюзове світіння
  vec3 L = normalize(uSunDir);
  float h = vWorldPos.y;
  float sunI = 0.35 + 0.65 * uSunStrength;
  vec3 body = mix(uDeepColor, uShallowColor, 0.28) * sunI;
  float thin = smoothstep(-0.2, 0.9, vCrest);                       // тонкий гребінь просвічує
  float back = pow(max(dot(V, -L), 0.0), 4.0) * 0.7 + 0.3;          // проти сонця — сильніше
  body += uShallowColor * thin * back * 0.55 * uSunStrength;
  body += uShallowColor * 0.18 * (1.0 - NdV) * sunI;                // збоку вода світліша
  body = mix(body, uSkyColor * 0.55, 0.2); // вода завжди трохи бере колір неба (захід, ніч)
  vec3 col = mix(body, refl, fres);

  // сонце: гострий блиск (звужується, де деталі збережені) + м'який ореол
  vec3 Hs = normalize(L + V);
  float NdH = max(dot(N, Hs), 0.0);
  float pw = mix(900.0, 70.0, rough);
  float spec = pow(NdH, pw) * (pw / 120.0) * uSunStrength * (0.3 + 0.7 * fres * 4.0);
  col += vec3(1.0, 0.95, 0.84) * min(spec, 6.0);
  col += vec3(1.0, 0.88, 0.68) * pow(NdH, 24.0) * 0.12 * uSunStrength;

  // місячна доріжка (місяць — навпроти сонця, як moonLight у main.ts)
  vec3 Lm = normalize(vec3(-L.x, max(-L.y, 0.2), -L.z));
  float moonI = clamp(1.0 - uSunStrength * 3.0, 0.0, 1.0);
  float NdM = max(dot(N, normalize(Lm + V)), 0.0);
  col += vec3(0.75, 0.85, 1.0) * pow(NdM, mix(500.0, 60.0, rough)) * moonI * 1.2;
  col += vec3(0.5, 0.6, 0.85) * pow(NdM, 20.0) * moonI * 0.06;

  // барашки: найвищі гребені, лише коли дме; рвана піна, витягнута за вітром
  float capOn = smoothstep(0.22, 0.75, uIntensity);
  if (capOn > 0.0) {
    float cap = smoothstep(0.7 - 0.2 * capOn, 1.0, vCrest);
    if (cap > 0.0) {
      vec2 wd = normalize(uWindDir + 1e-4);
      vec2 q = vec2(dot(vBase, wd), dot(vBase, vec2(-wd.y, wd.x)));
      // мереживо: дрібний шум, витягнутий за вітром, і тонкі «жилки» між комірками
      float n = fbm(q * vec2(0.9, 2.4) - vec2(uTime * 0.7, 0.0));
      float lace = 1.0 - abs(n * 2.0 - 1.0);
      float m = cap * 0.7 + lace * 0.45 * cap + n * 0.25 * cap;
      float foam = smoothstep(0.6, 0.72, m) * 0.7 + smoothstep(0.48, 0.6, m) * 0.12; // м'який край, легкий серпанок довкола
      foam *= capOn;
      foam *= 1.0 - 0.6 * smoothstep(0.05, 0.25, fp); // вдалині (великий піксель) — м'якше, без мерехтіння
      vec3 fcol = vec3(0.93, 0.96, 0.98) * clamp(0.12 + 0.88 * uSunStrength, 0.0, 1.0) + uSkyColor * 0.12;
      col = mix(col, fcol, foam * 0.85);
    }
  }

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

  // Прибій: смуги піни біля берега, що набігають і тануть
  {
    vec2 suv = (vWorldPos.xz - uShoreRect.xy) * uShoreRect.zw;
    if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
      float bed = texture2D(uShore, suv).r * 20.0 - 10.0; // висота дна, м
      float shallow = smoothstep(-4.5, -0.4, bed);        // 0 глибоко … 1 біля самої кромки
      // мілина — світліша, бірюзова
      col = mix(col, uShallowColor * (0.6 + 0.7 * uSunStrength) + vec3(0.06, 0.1, 0.07), shallow * 0.5);
      float wave = sin(bed * 2.6 + uTime * 1.3) * 0.5 + 0.5;
      float n = fbm(vWorldPos.xz * 1.1 + uTime * 0.2);
      float surf = smoothstep(0.55, 0.95, wave * shallow + n * 0.35) * shallow;
      surf = max(surf, smoothstep(-1.4, -0.2, bed) * smoothstep(0.2, 0.55, n)); // кромка
      vec3 foamCol = vec3(0.95, 0.97, 0.98) * clamp(0.15 + 0.85 * uSunStrength, 0.0, 1.0) + uSkyColor * 0.1;
      col = mix(col, foamCol, clamp(surf, 0.0, 1.0) * 0.85);
    }
  }

  // Блискавка підсвічує воду
  col += vec3(0.7, 0.8, 1.0) * uFlash * (0.25 + 0.5 * fres);

  // Димка відстані
  float fogF = 1.0 - exp(-dist * dist * uFogDensity * uFogDensity);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

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
    for (let i = 0; i < 5; i++) {
      dirs.push(new THREE.Vector2(init[i].dir[0], init[i].dir[1]));
      amps.push(init[i].amp);
      const k = (Math.PI * 2) / init[i].len;
      ks.push(k);
      omegas.push(Math.sqrt(G * k));
      qs.push(init[i].q);
      lens.push(init[i].len);
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
        uWaveLen: { value: lens },
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

  /** центр сітки (камера) — для «як намальовано» */
  private center = new THREE.Vector2();

  update(dt: number, t: number, cam: THREE.Vector3, sunDir: THREE.Vector3, skyColor: THREE.Color, fogColor: THREE.Color, fogDensity: number, sunStrength: number, flash: number, zenith?: THREE.Color) {
    // сітка їде за камерою (лише по горизонталі)
    this.mesh.position.set(cam.x, 0, cam.z);
    this.center.set(cam.x, cam.z);
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
    u.uIntensity.value = this.intensity;
    (u.uWindDir.value as THREE.Vector2).set(Math.sin(this.windDir), -Math.cos(this.windDir));
    (u.uZenithColor.value as THREE.Color).copy(zenith ?? skyColor);

    const dirs = u.uWaveDir.value as THREE.Vector2[];
    const amps = u.uWaveAmp.value as number[];
    const ks = u.uWaveK.value as number[];
    const omegas = u.uWaveOmega.value as number[];
    const qs = u.uWaveQ.value as number[];
    const lens = u.uWaveLen.value as number[];
    for (let i = 0; i < 5; i++) {
      const w = this.waves[i];
      dirs[i].set(w.dir[0], w.dir[1]);
      amps[i] = w.amp;
      const k = (Math.PI * 2) / w.len;
      ks[i] = k;
      omegas[i] = Math.sqrt(G * k);
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
    return surfaceHeight(x, z, t, this.waves, gridStep(r), this.shoreDamp(x, z));
  }

  heightAt(x: number, z: number, t: number): number {
    return surfaceHeight(x, z, t, this.waves, null, this.shoreDamp(x, z));
  }
  normalAt(x: number, z: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    waveNormal(x, z, t, this.waves, out);
    const d = this.shoreDamp(x, z);
    if (d < 1) out.set(out.x * d, out.y, out.z * d).normalize();
    return out;
  }
}
