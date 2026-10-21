import * as THREE from 'three';
import { clamp, hash2 } from '../core/math';
import { localIntensity, seaMul } from '../core/region';

// ─────────────────────────────────────────────────────────────
// Хмари в дусі Sea of Thieves: «ватні» купчасті, що їх видно об'ємними,
// високі пір'ясті смуги й низька штормова стеля, плюс тіні від хмар на воді,
// суші й палубі.
//
// Як це влаштовано (дешево й стабільно у вебі, без пост-обробки):
//  • Тайлова текстура шуму 256² (генерується тут, детерміновано): форма хмар,
//    «кульбабки» (інвертований Ворлі), дрібна ерозія, пір'ясті смуги.
//  • Карта покриву навколо камери 128² (~32 км): скільки хмар у кожній точці —
//    з глобальної погоди × регіону моря (region.ts), плюс стіна фронту з
//    навітряного боку, коли радіо вже попереджає (frontEta). Рахується на CPU
//    раз на ~0.4 с тими самими функціями, що й погода, — у коопі збігається.
//  • Небо (sky.ts) марширує промінь крізь шар 16 кроками в повній роздільності
//    (дизеринг від смуг, без апскейлу — нема «драбинки»), світло — один семпл
//    до сонця: світлий верх, тепла кромка, темний низ, срібляста облямівка.
//  • Тінь: стовпчик густини над точкою вздовж сонця — однакова функція в
//    океані й у всіх освітлених матеріалах (патч lights_fragment_begin).
// ─────────────────────────────────────────────────────────────

const NOISE = 256;
const COVER = 128;
/** розмір карти покриву, м (камера в центрі) */
const COVER_SIZE = 36000;
/** метрів на тайл текстури шуму (розмір купчастих хмар ~0.4–1.5 км) */
const NOISE_SCALE = 5200;

// ── тайлові шуми ──
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i: number, p: number) => ((i % p) + p) % p;

function value(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const h = (a: number, b: number) => hash2(wrap(a, px) + seed * 131, wrap(b, py) - seed * 71);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** тайловий градієнтний шум (Перлін): ізолінії круглі, без «квадратів» value-шуму */
function perlin(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const g = (a: number, b: number, dx: number, dy: number) => {
    const ang = hash2(wrap(a, px) + seed * 57, wrap(b, py) - seed * 13) * Math.PI * 2;
    return Math.cos(ang) * dx + Math.sin(ang) * dy;
  };
  const u = fade(fx), v = fade(fy);
  const n00 = g(ix, iy, fx, fy), n10 = g(ix + 1, iy, fx - 1, fy);
  const n01 = g(ix, iy + 1, fx, fy - 1), n11 = g(ix + 1, iy + 1, fx - 1, fy - 1);
  const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
  return a + (b - a) * v;
}

function worley(x: number, y: number, p: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const wx = wrap(cx, p), wy = wrap(cy, p);
      const ox = hash2(wx + seed * 17, wy + 911), oy = hash2(wx - 503, wy + seed * 29);
      const dx = cx + ox - x, dy = cy + oy - y;
      best = Math.min(best, dx * dx + dy * dy);
    }
  return Math.sqrt(best);
}

function normalize(a: Float32Array) {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) / (hi - lo || 1);
}

/** R — форма (fbm), G — ерозія (дрібний Ворлі), B — пір'ясті смуги, A — «кульбабки» */
function makeNoiseTexture(): THREE.DataTexture {
  const N = NOISE;
  const r = new Float32Array(N * N), g = new Float32Array(N * N), b = new Float32Array(N * N), a = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      let f = 0, amp = 0.5;
      // форма — Перлін з легким викривленням (domain warp): округлі, неправильні плями
      const wx = perlin(u * 3, v * 3, 3, 3, 77) * 0.06, wy = perlin(u * 3 + 0.5, v * 3, 3, 3, 78) * 0.06;
      for (let o = 0, P = 4; o < 5; o++, P *= 2, amp *= 0.5) f += amp * perlin((u + wx) * P, (v + wy) * P, P, P, 1 + o);
      const k = y * N + x;
      r[k] = f;
      a[k] = 1 - (worley(u * 5, v * 5, 5, 3) * 0.6 + worley(u * 10, v * 10, 10, 4) * 0.28 + worley(u * 20, v * 20, 20, 5) * 0.12);
      g[k] = (1 - worley(u * 16, v * 16, 16, 7)) * 0.65 + value(u * 32, v * 32, 32, 32, 9) * 0.35;
      let c = 0;
      amp = 0.5;
      for (let o = 0, P = 3; o < 4; o++, P *= 2, amp *= 0.5) c += amp * value(u * P + Math.sin(v * 6.2832 * 2) * 0.35 * P / 3, v * P * 4, P, P * 4, 20 + o);
      b[k] = c;
    }
  normalize(r);
  normalize(g);
  normalize(b);
  normalize(a);
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(r[i] * 255);
    data[i * 4 + 1] = Math.round(g[i] * 255);
    data[i * 4 + 2] = Math.round(b[i] * 255);
    data[i * 4 + 3] = Math.round(a[i] * 255);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Синій шум 64² (ранжування «найбільша порожнеча» на торі): зсув кроку променя.
 * Регулярна R2 давала видиму діагональну штриховку, білий шум — зерно;
 * синій шум розкидає похибку рівномірно без візерунка.
 */
function makeBlueNoise(): THREE.DataTexture {
  const N = 64, NN = N * N;
  const sigma2 = 2 * 1.6 * 1.6;
  const kern = new Float32Array(NN);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = Math.min(x, N - x), dy = Math.min(y, N - y);
      kern[y * N + x] = Math.exp(-(dx * dx + dy * dy) / sigma2);
    }
  const energy = new Float32Array(NN);
  const taken = new Uint8Array(NN);
  const rank = new Float32Array(NN);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let pick = Math.floor(rnd() * NN);
  for (let r = 0; r < NN; r++) {
    if (r > 0) {
      let best = Infinity;
      for (let i = 0; i < NN; i++) if (!taken[i] && energy[i] < best) { best = energy[i]; pick = i; }
    }
    taken[pick] = 1;
    rank[pick] = (r + 0.5) / NN;
    const px = pick % N, py = (pick / N) | 0;
    for (let y = 0; y < N; y++) {
      const ky = ((y - py + N) % N) * N;
      const ry = y * N;
      for (let x = 0; x < N; x++) energy[ry + x] += kern[ky + ((x - px + N) % N)];
    }
  }
  const data = new Uint8Array(NN * 4);
  for (let i = 0; i < NN; i++) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = data[i * 4 + 3] = Math.round(rank[i] * 255);
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 3D-шум 64³ (тайловий інвертований Ворлі, дві октави): «клуби» на боках веж.
 * Без нього хмара — видавлена 2D-пляма, і збоку вежі видно вертикальні смуги.
 */
function makeNoise3D(): THREE.Data3DTexture {
  const N = 64;
  const data = new Uint8Array(N * N * N);
  const h3 = (x: number, y: number, z: number, s: number) => hash2(x * 7.13 + z * 3.71 + s * 13.1, y * 5.37 - z * 1.93 + s * 0.71);
  const oct = (u: number, v: number, w: number, P: number, seed: number) => {
    const x = u * P, y = v * P, z = w * P;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let best = 9;
    for (let k = -1; k <= 1; k++)
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const cx = ix + i, cy = iy + j, cz = iz + k;
          const wx = wrap(cx, P), wy = wrap(cy, P), wz = wrap(cz, P);
          const dx = cx + h3(wx, wy, wz, seed) - x, dy = cy + h3(wy, wz, wx, seed + 1) - y, dz = cz + h3(wz, wx, wy, seed + 2) - z;
          best = Math.min(best, dx * dx + dy * dy + dz * dz);
        }
    return 1 - Math.min(1, Math.sqrt(best));
  };
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const u = x / N, v = y / N, w = z / N;
        const f = oct(u, v, w, 4, 11) * 0.65 + oct(u, v, w, 8, 23) * 0.35;
        data[(z * N + y) * N + x] = Math.round(Math.min(1, Math.max(0, f)) * 255);
      }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RedFormat;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** спільні uniform-и: ті самі об'єкти в небі, океані й освітлених матеріалах */
export const cloudUniforms = {
  uCloudNoise: { value: null as THREE.Texture | null },
  /** синій шум 64² для зсуву кроку (лише небо) */
  uCloudBN: { value: null as THREE.Texture | null },
  /** 3D-шум клубів (лише небо) */
  uCloudN3: { value: null as THREE.Texture | null },
  uCloudCover: { value: null as THREE.Texture | null },
  /** x0, z0, 1/розмір, 1/розмір — карта покриву */
  uCloudRect: { value: new THREE.Vector4(0, 0, 1 / COVER_SIZE, 1 / COVER_SIZE) },
  /** номінальна база купчастих, м (низ шару — нижче, під нерівну базу й шматки) */
  uCloudBase0: { value: 950 },
  /** низ шару, верх шару, м на тайл шуму, час */
  uCloudLayer: { value: new THREE.Vector4(900, 1400, NOISE_SCALE, 0) },
  /** дрейф за вітром, м */
  uCloudOff: { value: new THREE.Vector2() },
  /** напрямок світла (сонце, вночі — місяць) */
  uCloudSun: { value: new THREE.Vector3(0, 1, 0) },
  /** сила тіні 0..1 (0 — вимкнено) */
  uCloudShK: { value: 0 },
  uCLit: { value: new THREE.Color(1, 1, 1) },
  uCShade: { value: new THREE.Color(0.4, 0.45, 0.55) },
  uCStorm: { value: new THREE.Color(0.12, 0.13, 0.15) },
  uCAmb: { value: new THREE.Color(0.5, 0.6, 0.8) },
  /** повітря в тіні хмар (під стелею, під фронтом): темне сіро-синє */
  uCAir: { value: new THREE.Color(0.2, 0.22, 0.26) },
};

/**
 * Висота хмари над базою, м, з «вертикального розвитку» a (канал A карти покриву):
 * штиль — пухкі ~1 км (окремі вежі до ~2.5 км), вітер — вежі (cumulus congestus) до ~4 км,
 * фронт/шторм — купчасто-дощові (cumulonimbus) до ~10 км з ковадлом.
 * Та сама формула — у GLSL (towerH).
 */
export function towerH(a: number): number {
  return 1000 + 3000 * smooth(0, 0.7, a) + 6000 * smooth(0.7, 1, a);
}

/** спільний GLSL: покрив, стовпчик густини, тінь (без власних uniform-ів кольору) */
export const CLOUD_COMMON = /* glsl */ `
uniform sampler2D uCloudNoise;
uniform sampler2D uCloudCover;
uniform vec4 uCloudRect;
uniform vec4 uCloudLayer;
uniform float uCloudBase0;
uniform vec2 uCloudOff;
uniform vec3 uCloudSun;
uniform float uCloudShK;
// покрив (r), штормовість (g), дощ (b) у точці світу
vec3 cloudCoverAt(vec2 xz) {
  return texture2D(uCloudCover, (xz - uCloudRect.xy) * uCloudRect.zw).rgb * vec3(1.25, 1.0, 1.0);
}
// те саме + вертикальний розвиток (a) — висота веж
vec4 cloudCover4(vec2 xz) {
  return texture2D(uCloudCover, (xz - uCloudRect.xy) * uCloudRect.zw) * vec4(1.25, 1.0, 1.0, 1.0);
}
float towerH(float a) {
  return 1000.0 + 3000.0 * smoothstep(0.0, 0.7, a) + 6000.0 * smoothstep(0.7, 1.0, a);
}
// база хмари не пласка: окремі хмари сидять на різній висоті (±175 м),
// під штормом — провислі «грудки» стелі (ще ±200 м)
float cloudBaseAt(vec2 uv, float storm) {
  // mip 0: грубий mip — білінійні «фасетки» сітки текселів видно на освітленні як прямокутники
  float b = uCloudBase0 + (textureLod(uCloudNoise, uv * 0.13 + vec2(0.71, 0.33), 0.0).r - 0.5) * 350.0;
  if (storm > 0.4) b += (textureLod(uCloudNoise, uv * 0.3 + vec2(0.27, 0.81), 0.0).r - 0.5) * 400.0 * smoothstep(0.4, 0.8, storm);
  return b;
}
// частка неба над точкою, закрита хмарою (з самого покриву — дешево й плавно) × товщина
float coverOcc(vec3 cv) {
  // рідкі купчасті повітря майже не затіняють; суцільна й грозова стеля — так
  return smoothstep(0.75, 1.05, cv.r) * (0.12 + 0.88 * cv.g);
}
// «тінь у повітрі»: наскільки повітря вздовж горизонтального напрямку dir (від o до maxD)
// сидить під хмарами — розсіяне світло там гасне (під фронтом і стелею темно, а не світла смуга)
float airOcc(vec2 o, vec2 dir, float maxD) {
  // серпанок із пропусканням: ближнє ясне повітря дає трохи світла, решта — темна тінь
  float acc = 0.0, T = 1.0, last = 0.0;
  float a = 1.0 - exp(-maxD / 5.0 / 9000.0);
  for (int k = 0; k < 5; k++) {
    float D = maxD * (float(k) + 0.5) / 5.0;
    last = coverOcc(cloudCoverAt(o + dir * D));
    acc += T * a * last;
    T *= 1.0 - a;
  }
  return smoothstep(0.0, 0.7, acc + T * last);
}
vec2 cloudUV(vec2 xz) { return (xz + uCloudOff) / uCloudLayer.z; }
// форма: велика fbm + «кульбабки»; друга шкала повільно повзе — хмари живуть
float cloudShapeUV(vec2 uv) {
  return texture2D(uCloudNoise, uv).r * 0.62 + texture2D(uCloudNoise, mat2(0.866, 0.5, -0.5, 0.866) * uv * 2.7 + vec2(0.37, 0.11) + uCloudLayer.w * vec2(0.0011, 0.0007)).a * 0.38;
}
// непрозорість стовпчика над точкою 0..1
float cloudColumn(vec2 xz) {
  return smoothstep(0.02, 0.2, cloudShapeUV(cloudUV(xz)) - (1.0 - cloudCoverAt(xz).r));
}
// 1 — сонце, менше — у тіні хмари; дві висоти: низ хмар і середина веж
// (високі вежі на заході кидають довшу тінь)
float cloudShadow(vec3 wp) {
  vec3 L = uCloudSun;
  if (uCloudShK <= 0.0 || L.y < 0.05) return 1.0;
  float lo = uCloudBase0 + 250.0;
  float hi = mix(lo, uCloudLayer.y, 0.35);
  vec2 q1 = wp.xz + L.xz / L.y * (lo - wp.y);
  vec2 q2 = wp.xz + L.xz / L.y * (hi - wp.y);
  float c = cloudColumn(q1);
  if (hi > lo + 300.0) c = max(c, cloudColumn(q2) * smoothstep(0.15, 0.6, texture2D(uCloudCover, (q2 - uCloudRect.xy) * uCloudRect.zw).a));
  return 1.0 - uCloudShK * c;
}
`;

export const CLOUD_COLORS = /* glsl */ `
uniform vec3 uCLit;
uniform vec3 uCShade;
uniform vec3 uCStorm;
uniform vec3 uCAmb;
uniform vec3 uCAir;
`;

const LIT_KEYS = ['uCloudNoise', 'uCloudCover', 'uCloudRect', 'uCloudLayer', 'uCloudBase0', 'uCloudOff', 'uCloudSun', 'uCloudShK'] as const;

/** додати спільні uniform-и тіні в шейдер (для матеріалів із власним onBeforeCompile) */
export function addCloudUniforms(uniforms: Record<string, THREE.IUniform>) {
  for (const k of LIT_KEYS) uniforms[k] = cloudUniforms[k];
}

/** рендер без хмарних тіней (вітрина крамниці: свій окремий рендерер і світло) */
export function withoutCloudShadow(fn: () => void) {
  const k = cloudUniforms.uCloudShK.value;
  cloudUniforms.uCloudShK.value = 0;
  try {
    fn();
  } finally {
    cloudUniforms.uCloudShK.value = k;
  }
}

let patched = false;
/**
 * Тінь хмар на всіх освітлених матеріалах (standard/physical/phong/lambert/toon):
 * сонячне (й місячне) пряме світло множиться на cloudShadow у точці фрагмента.
 * Uniform-и додає типовий onBeforeCompile; матеріали з власним хуком мають
 * викликати addCloudUniforms (без нього uCloudShK = 0 — тіні просто немає).
 */
export function patchLitMaterials() {
  if (patched) return;
  patched = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.lights_pars_begin = C.lights_pars_begin + '\n' + CLOUD_COMMON;
  const DIR = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
  const INFO = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (C.lights_fragment_begin.includes(DIR) && C.lights_fragment_begin.includes(INFO)) {
    C.lights_fragment_begin = C.lights_fragment_begin
      .replace(DIR, '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )\n\tfloat cloudSh = cloudShadow( transpose( mat3( viewMatrix ) ) * ( geometryPosition - viewMatrix[ 3 ].xyz ) );')
      .replace(INFO, INFO + '\n\t\tdirectLight.color *= cloudSh;');
  }
  // стилізовано: у тіні хмари трохи тьмяніє й розсіяне світло — пляма читається й на суші
  C.lights_fragment_end =
    '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( RE_IndirectDiffuse )\n\tirradiance *= mix( 1.0, cloudSh, 0.4 );\n\tiblIrradiance *= mix( 1.0, cloudSh, 0.4 );\n#endif\n' +
    C.lights_fragment_end;
  THREE.Material.prototype.onBeforeCompile = function (shader: { uniforms: Record<string, THREE.IUniform> }) {
    addCloudUniforms(shader.uniforms);
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface CloudInput {
  camPos: THREE.Vector3;
  /** глобальна сила погоди (weather.base) */
  base: number;
  /** локальна хмарність біля гравця 0..1 */
  cloudiness: number;
  windDir: number;
  /** 0..1 */
  wind: number;
  /** секунд до фронту (null — не очікується) */
  frontEta: number | null;
  sunDir: THREE.Vector3;
  sunStrength: number;
  daylight: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
}

export class Clouds {
  private cover: THREE.DataTexture;
  private coverData: Uint8Array<ArrayBuffer>;
  private coverT = 0;
  private t = 0;
  /** штормовість над камерою (для висоти шару) */
  private darkCam = 0;
  /** найвища вежа на карті покриву, м над базою */
  private maxTower = 600;
  /** «тінь у повітрі» навколо камери 0..1 (туман мешів темнішає під стелею) */
  airCam = 0;
  private airCamT = 0;
  /** колір затіненого повітря («сирі» числа, як fogRaw) */
  readonly airColor = new THREE.Color(0.2, 0.22, 0.26);

  constructor() {
    cloudUniforms.uCloudNoise.value = makeNoiseTexture();
    cloudUniforms.uCloudBN.value = makeBlueNoise();
    cloudUniforms.uCloudN3.value = makeNoise3D();
    this.coverData = new Uint8Array(COVER * COVER * 4);
    this.cover = new THREE.DataTexture(this.coverData, COVER, COVER, THREE.RGBAFormat);
    this.cover.magFilter = this.cover.minFilter = THREE.LinearFilter;
    this.cover.wrapS = this.cover.wrapT = THREE.ClampToEdgeWrapping;
    cloudUniforms.uCloudCover.value = this.cover;
    patchLitMaterials();
  }

  /** покрив з хмарності: штиль — рідкі купчасті, вітер — густіше, шторм — суцільна стеля */
  static coverFrom(cl: number): number {
    // шторм ≈ 1.0: суцільно, але з тоншими місцями — видно вали й розриви, а не пласку стелю
    // ясно — менше покриву: високі вежі й так закривають більше неба (між ними має бути блакить)
    return 0.27 + 0.63 * smooth(0.2, 0.75, cl) + 0.12 * smooth(0.75, 1.0, cl);
  }

  private rebuildCover(inp: CloudInput) {
    const cell = COVER_SIZE / COVER;
    // центр на сітці клітинок — карта не «пливе» під камерою
    const cx = Math.round(inp.camPos.x / cell) * cell, cz = Math.round(inp.camPos.z / cell) * cell;
    const x0 = cx - COVER_SIZE / 2, z0 = cz - COVER_SIZE / 2;
    (cloudUniforms.uCloudRect.value as THREE.Vector4).set(x0, z0, 1 / COVER_SIZE, 1 / COVER_SIZE);
    // фронт: стіна насувається з навітряного боку, ~22 м/с (за 7 хв — за 9 км, за обрієм)
    const eta = inp.frontEta;
    const frontOn = eta != null ? 1 - smooth(380, 420, eta) : 0;
    const F = (eta ?? 0) * 22;
    const ux = -Math.sin(inp.windDir), uz = Math.cos(inp.windDir);
    const d = this.coverData;
    let maxA = 0;
    let occ = 0, occW = 0;
    for (let j = 0; j < COVER; j++) {
      const z = z0 + (j + 0.5) * cell;
      for (let i = 0; i < COVER; i++) {
        const x = x0 + (i + 0.5) * cell;
        const li = localIntensity(inp.base, seaMul(x, z));
        const cl = clamp(0.15 + li * 0.85, 0, 1);
        let cov = Clouds.coverFrom(cl);
        let dark = smooth(0.55, 0.95, cl);
        let rain = smooth(0.78, 1.0, cl);
        // вертикальний розвиток: вітер — вежі, негода — купчасто-дощові; плюс різнорідність
        // у просторі (~6 км): поруч пухкі низькі й окремі високі вежі, а не однаковий пласт
        const twW = 0.65 * smooth(0.3, 0.75, cl) + 0.3 * smooth(0.6, 0.95, cl);
        const vv = value((x + 50000) / 6500, (z + 50000) / 6500, 1024, 1024, 41) * 0.65 + value((x + 50000) / 2300, (z + 50000) / 2300, 1024, 1024, 42) * 0.35;
        let tw = clamp(twW + (vv - 0.45) * (0.75 - 0.35 * twW), 0, 1);
        if (frontOn > 0) {
          const s = (x - inp.camPos.x) * ux + (z - inp.camPos.z) * uz;
          const wall = smooth(F - 900, F + 2200, s) * frontOn;
          cov = Math.max(cov, cov + (1.12 - cov) * wall);
          dark = Math.max(dark, wall * 0.85);
          rain = Math.max(rain, wall * smooth(F + 600, F + 3500, s) * 0.8);
          // передній край фронту — вежі купчасто-дощових з ковадлами
          tw = Math.max(tw, smooth(F - 1500, F + 800, s) * frontOn);
        }
        maxA = Math.max(maxA, tw);
        const k = (j * COVER + i) * 4;
        d[k] = Math.round(clamp(cov / 1.25, 0, 1) * 255);
        d[k + 1] = Math.round(dark * 255);
        d[k + 2] = Math.round(rain * 255);
        d[k + 3] = Math.round(clamp(tw, 0, 1) * 255);
        // повітря під хмарами біля камери (~4 км)
        const dx = x - inp.camPos.x, dz = z - inp.camPos.z;
        const r2 = dx * dx + dz * dz;
        if (r2 < 4000 * 4000) {
          const w = 1 - Math.sqrt(r2) / 4000;
          occ += w * smooth(0.75, 1.05, cov) * (0.12 + 0.88 * dark);
          occW += w;
        }
      }
    }
    this.cover.needsUpdate = true;
    this.maxTower = towerH(maxA) * 1.08;
    this.airCamT = occW > 0 ? occ / occW : 0;
  }

  update(dt: number, inp: CloudInput) {
    this.t += dt;
    const u = cloudUniforms;
    // дрейф за вітром (хмари йдуть швидше в негоду)
    const sp = 5 + inp.wind * 16;
    const off = u.uCloudOff.value as THREE.Vector2;
    off.x -= Math.sin(inp.windDir) * sp * dt;
    off.y += Math.cos(inp.windDir) * sp * dt;
    // тримаємо зсув малим (текстура тайлова — зсув на тайл непомітний)
    if (Math.abs(off.x) > NOISE_SCALE * 40) off.x %= NOISE_SCALE;
    if (Math.abs(off.y) > NOISE_SCALE * 40) off.y %= NOISE_SCALE;

    this.coverT -= dt;
    if (this.coverT <= 0) {
      this.coverT = 0.4;
      this.rebuildCover(inp);
    }

    // шар: у шторм — нижче й товщий
    const dark = smooth(0.55, 0.95, inp.cloudiness);
    this.darkCam += (dark - this.darkCam) * Math.min(1, dt * 0.5);
    // низ шару: з запасом під нерівну базу (−175 м) і рвані шматки під штормовою стелею
    const base0 = 950 - this.darkCam * 420;
    u.uCloudBase0.value = base0;
    const base = base0 - 180 - this.darkCam * 480;
    // верх шару — найвища вежа на карті (у штиль промінь не марнує кроки на порожнечу)
    const top = base + Math.max(520 + this.darkCam * 700, this.maxTower);
    (u.uCloudLayer.value as THREE.Vector4).set(base, top, NOISE_SCALE, this.t);
    this.airCam += (this.airCamT - this.airCam) * Math.min(1, dt * 0.8);

    // світло: сонце вдень, місяць уночі (як moonLight у main.ts)
    const s = inp.sunDir;
    const day = inp.daylight;
    // хмари ловлять світло сонця ще й після заходу (знизу) — рожеві сутінки
    const cday = smooth(-0.35, 0.02, s.y);
    const L = u.uCloudSun.value as THREE.Vector3;
    if (s.y > -0.12) L.set(s.x, Math.max(s.y, 0.03), s.z).normalize();
    else L.set(-s.x, Math.max(-s.y, 0.2), -s.z).normalize();
    // тінь: чітка в ясний день, слабка в сутінках і вночі, зникає під суцільною стелею
    const overcast = smooth(0.85, 1.0, inp.cloudiness);
    u.uCloudShK.value = (day * 0.5 * smooth(0.04, 0.2, s.y) + (1 - day) * 0.2) * (1 - overcast * 0.85);

    // кольори (ті самі «сирі» числа, що пишуть шейдери неба й океану)
    const golden = smooth(0.38, 0.06, s.y) * cday;
    const sunK = 0.45 + 0.7 * inp.sunStrength;
    const lit = u.uCLit.value as THREE.Color;
    lit.setRGB(1.0, 0.97, 0.93).lerp(this._warm.setRGB(1.0, 0.52, 0.32), golden).multiplyScalar(sunK);
    lit.lerp(this._night.setRGB(0.13, 0.15, 0.22), 1 - cday);
    const shade = u.uCShade.value as THREE.Color;
    shade.copy(inp.zenith).multiplyScalar(0.55).add(this._tmp.copy(inp.horizon).multiplyScalar(0.4));
    shade.lerp(this._tmp.setRGB(0.36, 0.42, 0.55), 0.35 * day);
    shade.lerp(this._tmp.setRGB(0.5, 0.28, 0.36), golden * 0.55);
    if (cday < 1) shade.lerp(this._tmp.setRGB(0.032, 0.042, 0.075), 1 - cday);
    (u.uCStorm.value as THREE.Color).setRGB(0.13, 0.145, 0.17).multiplyScalar(0.12 + 0.88 * day);
    (u.uCAmb.value as THREE.Color).copy(inp.zenith).lerp(inp.horizon, 0.45);
    // повітря в тіні хмар: розсіяне світло крізь товщу — темне сіро-синє (уночі майже чорне)
    const air = u.uCAir.value as THREE.Color;
    air.setRGB(0.17, 0.19, 0.225).multiplyScalar(0.1 + 0.9 * day).lerp(this._tmp.copy(inp.horizon).multiplyScalar(0.45), 0.18);
    if (golden > 0) air.lerp(this._tmp.setRGB(0.3, 0.2, 0.22), golden * 0.3 * day);
    this.airColor.copy(air);
  }
  private _warm = new THREE.Color();
  private _night = new THREE.Color();
  private _tmp = new THREE.Color();
}
