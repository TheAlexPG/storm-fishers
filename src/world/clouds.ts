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
      for (let o = 0, P = 4; o < 5; o++, P *= 2, amp *= 0.5) f += amp * value(u * P, v * P, P, P, 1 + o);
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

/** спільні uniform-и: ті самі об'єкти в небі, океані й освітлених матеріалах */
export const cloudUniforms = {
  uCloudNoise: { value: null as THREE.Texture | null },
  uCloudCover: { value: null as THREE.Texture | null },
  /** x0, z0, 1/розмір, 1/розмір — карта покриву */
  uCloudRect: { value: new THREE.Vector4(0, 0, 1 / COVER_SIZE, 1 / COVER_SIZE) },
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
};

/** спільний GLSL: покрив, стовпчик густини, тінь (без власних uniform-ів кольору) */
export const CLOUD_COMMON = /* glsl */ `
uniform sampler2D uCloudNoise;
uniform sampler2D uCloudCover;
uniform vec4 uCloudRect;
uniform vec4 uCloudLayer;
uniform vec2 uCloudOff;
uniform vec3 uCloudSun;
uniform float uCloudShK;
// покрив (r), штормовість (g), дощ (b) у точці світу
vec3 cloudCoverAt(vec2 xz) {
  return texture2D(uCloudCover, (xz - uCloudRect.xy) * uCloudRect.zw).rgb * vec3(1.25, 1.0, 1.0);
}
vec2 cloudUV(vec2 xz) { return (xz + uCloudOff) / uCloudLayer.z; }
// форма: велика fbm + «кульбабки»; друга шкала повільно повзе — хмари живуть
float cloudShapeUV(vec2 uv) {
  return texture2D(uCloudNoise, uv).r * 0.62 + texture2D(uCloudNoise, uv * 2.7 + vec2(0.37, 0.11) + uCloudLayer.w * vec2(0.0011, 0.0007)).a * 0.38;
}
// непрозорість стовпчика над точкою 0..1
float cloudColumn(vec2 xz) {
  return smoothstep(0.02, 0.2, cloudShapeUV(cloudUV(xz)) - (1.0 - cloudCoverAt(xz).r));
}
// 1 — сонце, менше — у тіні хмари
float cloudShadow(vec3 wp) {
  vec3 L = uCloudSun;
  if (uCloudShK <= 0.0 || L.y < 0.05) return 1.0;
  float mid = mix(uCloudLayer.x, uCloudLayer.y, 0.3);
  vec2 q = wp.xz + L.xz / L.y * (mid - wp.y);
  return 1.0 - uCloudShK * cloudColumn(q);
}
`;

export const CLOUD_COLORS = /* glsl */ `
uniform vec3 uCLit;
uniform vec3 uCShade;
uniform vec3 uCStorm;
uniform vec3 uCAmb;
`;

const LIT_KEYS = ['uCloudNoise', 'uCloudCover', 'uCloudRect', 'uCloudLayer', 'uCloudOff', 'uCloudSun', 'uCloudShK'] as const;

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

  constructor() {
    cloudUniforms.uCloudNoise.value = makeNoiseTexture();
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
    return 0.3 + 0.6 * smooth(0.2, 0.75, cl) + 0.12 * smooth(0.75, 1.0, cl);
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
    for (let j = 0; j < COVER; j++) {
      const z = z0 + (j + 0.5) * cell;
      for (let i = 0; i < COVER; i++) {
        const x = x0 + (i + 0.5) * cell;
        const li = localIntensity(inp.base, seaMul(x, z));
        const cl = clamp(0.15 + li * 0.85, 0, 1);
        let cov = Clouds.coverFrom(cl);
        let dark = smooth(0.55, 0.95, cl);
        let rain = smooth(0.78, 1.0, cl);
        if (frontOn > 0) {
          const s = (x - inp.camPos.x) * ux + (z - inp.camPos.z) * uz;
          const wall = smooth(F - 900, F + 2200, s) * frontOn;
          cov = Math.max(cov, cov + (1.12 - cov) * wall);
          dark = Math.max(dark, wall * 0.85);
          rain = Math.max(rain, wall * smooth(F + 600, F + 3500, s) * 0.8);
        }
        const k = (j * COVER + i) * 4;
        d[k] = Math.round(clamp(cov / 1.25, 0, 1) * 255);
        d[k + 1] = Math.round(dark * 255);
        d[k + 2] = Math.round(rain * 255);
        d[k + 3] = 255;
      }
    }
    this.cover.needsUpdate = true;
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
    const base = 950 - this.darkCam * 420;
    const top = base + 520 + this.darkCam * 700;
    (u.uCloudLayer.value as THREE.Vector4).set(base, top, NOISE_SCALE, this.t);

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
  }
  private _warm = new THREE.Color();
  private _night = new THREE.Color();
  private _tmp = new THREE.Color();
}
