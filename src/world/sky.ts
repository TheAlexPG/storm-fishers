import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { CLOUD_COLORS, CLOUD_COMMON, cloudUniforms } from './clouds';

// ─────────────────────────────────────────────────────────────
// Небо: купол-градієнт, сонце, місяць, зорі, хмари, дощ, чайки.
// ─────────────────────────────────────────────────────────────

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // завжди на дальньому плану
}
`;

const DOME_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform float uSunStrength;
uniform float uFlash;
uniform float uCloudiness;
uniform vec3 uCamPos;
uniform float uStars;
uniform float uMoon;
uniform float uCirrus;
uniform float uSteps;
//CLOUDS//
varying vec3 vDir;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// у циклі з break неявні похідні (вибір mip) невизначені — рівень деталізації явно з відстані
float shapeLod(vec2 uv, float lod) {
  return textureLod(uCloudNoise, uv, lod).r * 0.62 + textureLod(uCloudNoise, uv * 2.7 + vec2(0.37, 0.11) + uCloudLayer.w * vec2(0.0011, 0.0007), lod + 1.4).a * 0.38;
}

// купчастий шар: 16 кроків крізь шар (без апскейлу), світло — один семпл до сонця
vec4 cumulus(vec3 ro, vec3 rd, vec3 L, out float tHit) {
  float base = uCloudLayer.x, top = uCloudLayer.y;
  tHit = 0.0;
  if (rd.y < 0.01) return vec4(0.0);
  const float MAXD = 17000.0;
  float t0 = (base - ro.y) / rd.y;
  if (t0 > MAXD) return vec4(0.0);
  // шлях у шарі обмежений: на пологих променях кроки не розтягуються на кілометри (без «смуг»)
  float t1 = min(min((top - ro.y) / rd.y, t0 + 2200.0), MAXD + 3000.0);
  tHit = t0;
  int N = int(uSteps);
  float dt = (t1 - t0) / uSteps;
  // низькорозбіжна послідовність R2 (не IGN — у тонких пасмах та дає штриховку; білий шум — зерно)
  float t = t0 + dt * fract(dot(gl_FragCoord.xy, vec2(0.7548776662, 0.5698402910)));
  float th = top - base;
  // слід пікселя на шарі (м) → mip: ~0.0019 рад/піксель, на пологих променях слід витягнутий
  float lod = clamp(log2(max(t0 * 0.0019 / max(rd.y, 0.04), 1.0) / (uCloudLayer.z / 256.0)), 0.0, 6.0);
  // срібляста облямівка проти сонця (Хеньї–Грінстейн, вперед)
  float mu = dot(rd, L);
  float g = 0.6;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.08;
  vec3 acc = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < 24; i++) {
    if (i >= N) break;
    vec3 p = ro + rd * t;
    float h = clamp((p.y - base) / th, 0.0, 1.0);
    vec3 cv = textureLod(uCloudCover, (p.xz - uCloudRect.xy) * uCloudRect.zw, 0.0).rgb * vec3(1.25, 1.0, 1.0);
    vec2 uv = cloudUV(p.xz);
    // купол: вгорі вужче (заокруглені верхівки), знизу пласке дно
    // переріз хмари звужується з висотою — круглі «кульбабки», а не стовпи з прямовисними стінами
    // (стіни в перспективі й давали радіальні смуги)
    float d = shapeLod(uv, lod) - (1.0 - cv.r) - (h * 0.25 + h * h * 0.45) - (1.0 - smoothstep(0.0, 0.1, h)) * 0.08;
    if (d > 0.0) {
      d -= textureLod(uCloudNoise, uv * 9.0 + uCloudLayer.w * vec2(0.004, -0.002), lod + 3.2).g * 0.11 * (1.0 - 0.5 * cv.g);
    }
    if (d > 0.0) {
      vec3 pl = p + L * th * 0.45;
      float hl = clamp((pl.y - base) / th, 0.0, 1.0);
      float dl = shapeLod(cloudUV(pl.xz), lod + 1.0) - (1.0 - cv.r) - (hl * 0.25 + hl * hl * 0.45);
      // низьке сонце світить крізь бік хмари — м'якше загасання (рожеві/золоті хмари на заході)
      float lt = exp(-max(dl, 0.0) * mix(2.2, 7.0, smoothstep(0.04, 0.4, L.y)) - d * 1.5);
      lt *= 1.0 - 0.65 * cv.g;
      float powder = 1.0 - exp(-d * 10.0);
      vec3 sh = mix(uCShade, uCStorm, cv.g);
      vec3 li = mix(uCLit, uCLit * 0.5 + uCStorm, cv.g * 0.7);
      vec3 c = mix(sh, li, lt * (0.6 + 0.4 * powder));
      // низьке сонце підсвічує хмари знизу (золота година, сутінки)
      float low = 1.0 - smoothstep(0.03, 0.3, L.y);
      c = mix(c, li * (0.8 + 0.4 * lt), low * (1.0 - h) * 0.45 * (1.0 - cv.g));
      // штормова стеля не пласка: темні вали й світліші розриви
      float sv = smoothstep(0.3, 0.72, shapeLod(uv * 0.55 + 0.13, max(lod - 0.8, 0.0)));
      c *= mix(1.0, mix(0.5, 1.35, sv), cv.g * (1.0 - 0.5 * h));
      c += uCAmb * (0.08 + 0.22 * h) * (1.0 - 0.6 * cv.g);
      c += li * hg * lt * (1.0 - cv.g);
      c += vec3(0.75, 0.8, 1.0) * uFlash * (1.3 - h) * (0.6 + cv.g);
      float a = 1.0 - exp(-d * dt * (0.024 + 0.03 * cv.g));
      acc += T * a * c;
      T *= 1.0 - a;
      if (T < 0.015) break;
    }
    t += dt;
  }
  float alpha = 1.0 - T;
  if (alpha <= 0.0) return vec4(0.0);
  vec3 col = acc / alpha;
  // повітряна перспектива: далекі хмари тонуть у серпанку обрію
  float far = smoothstep(2500.0, 15000.0, t0);
  col = mix(col, uHorizon * (0.7 + 0.3 * (1.0 - uCloudiness)), far * 0.7);
  alpha *= 1.0 - smoothstep(MAXD * 0.6, MAXD, t0);
  return vec4(col, alpha);
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
  // смуга серпанку біля обрію — далекі острови тонуть у ньому, а не світяться плямою
  col = mix(col, uHorizon, exp(-h * 22.0));
  vec3 sunD = normalize(uSunDir);
  // зорі (вночі): процедурні, за хмарами
  if (uStars > 0.0 && d.y > 0.0) {
    vec2 sp = vec2(atan(d.z, d.x), asin(d.y)) * 150.0;
    vec2 id = floor(sp);
    vec2 f = fract(sp) - 0.5;
    float r = hsh(id);
    if (r > 0.972) {
      vec2 o = vec2(hsh(id + 7.1), hsh(id + 3.3)) - 0.5;
      float s = 1.0 - smoothstep(0.06, 0.22, length(f - o * 0.6));
      col += vec3(0.85, 0.9, 1.0) * s * uStars * (0.4 + 0.6 * hsh(id + 1.7)) * smoothstep(0.0, 0.15, d.y);
    }
  }
  // сонце + ореол
  float sd = max(dot(d, sunD), 0.0);
  col += vec3(1.0, 0.9, 0.7) * (pow(sd, 350.0) * 2.0 + smoothstep(0.99955, 0.9998, sd) * 1.6) * uSunStrength;
  col += vec3(1.0, 0.75, 0.5) * pow(sd, 18.0) * 0.22 * uSunStrength;
  col += vec3(1.0, 0.85, 0.6) * pow(sd, 5.0) * 0.10 * uSunStrength;
  // місяць (навпроти сонця, як moonLight у main.ts)
  vec3 md = normalize(vec3(-sunD.x, max(-sunD.y, 0.2), -sunD.z));
  float mdd = dot(d, md);
  col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99935, 0.99965, mdd) * 0.9 + pow(max(mdd, 0.0), 80.0) * 0.12) * uMoon;
  // хмарність: небо сіріє (у шторм небо майже ховається за стелею хмар)
  float cl = clamp(uCloudiness, 0.0, 1.0);
  vec3 greyHor = vec3(0.30, 0.33, 0.38);
  vec3 greyTop = vec3(0.20, 0.22, 0.27);
  vec3 grey = mix(greyHor, greyTop, pow(h, 0.55)) * (0.25 + 0.75 * uSunStrength);
  col = mix(col, grey, clamp(cl * 0.55, 0.0, 1.0));

  vec3 L = uCloudSun;
  // пір'ясті смуги високо (~7 км), за купчастими
  if (uCirrus > 0.0 && d.y > 0.02) {
    vec2 q = uCamPos.xz + d.xz / d.y * 7000.0;
    vec2 uv = (q + uCloudOff * 1.6) / 46000.0;
    float c = texture2D(uCloudNoise, uv, 1.0).b;
    float c2 = texture2D(uCloudNoise, uv * 2.3 + vec2(0.31, 0.7), 1.0).r;
    // латками, а не суцільною штриховкою
    float patchM = smoothstep(0.42, 0.72, texture2D(uCloudNoise, uv * 0.37 + vec2(0.61, 0.23), 1.0).r);
    float a = smoothstep(0.5, 0.9, c * 0.75 + c2 * 0.25) * patchM * uCirrus * smoothstep(0.03, 0.25, d.y);
    vec3 cc = uCLit * 0.9 + uCAmb * 0.2;
    col = mix(col, cc, a * 0.32);
  }
  // стовпи дощу під хмарами вдалині
  if (d.y < 0.12 && d.y > -0.02) {
    vec2 hz = normalize(d.xz + 1e-5);
    float veil = 0.0;
    for (int k = 0; k < 2; k++) {
      float D = k == 0 ? 3800.0 : 8000.0;
      float y = uCamPos.y + d.y * D;
      if (y < uCloudLayer.x) {
        vec3 cv = cloudCoverAt(uCamPos.xz + hz * D);
        float ang = atan(hz.y, hz.x);
        // широкі м'які завіси (не «паркан»): плавний шум по азимуту
        float streak = texture2D(uCloudNoise, vec2(ang * (k == 0 ? 0.32 : 0.55) + 0.2 * float(k), 0.37 + uCloudLayer.w * 0.0003), 2.0).r;
        veil = max(veil, cv.b * smoothstep(0.35, 0.7, streak + 0.2 * cv.b) * (1.0 - y / uCloudLayer.x * 0.6));
      }
    }
    col = mix(col, mix(uCStorm * 1.5, uHorizon, 0.25), clamp(veil, 0.0, 1.0) * 0.5 * smoothstep(-0.02, 0.01, d.y));
  }
  // купчасті
  float tHit;
  vec4 cu = cumulus(uCamPos, d, L, tHit);
  col = mix(col, cu.rgb, cu.a);

  // блискавка
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.3 + 0.7 * (1.0 - h)) * 0.6;
  // дизеринг проти смуг
  col += (ign(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function makeGullTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(20,24,30,0.9)';
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(8, 30);
  g.quadraticCurveTo(22, 16, 32, 28);
  g.quadraticCurveTo(42, 16, 56, 30);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const RAIN_BOX = 44;
const RAIN_H = 28;

export class Sky {
  group = new THREE.Group();
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  /** дощ — похилі риски (LineSegments): 2 вершини на краплю */
  private rain: THREE.LineSegments;
  private rainMat: THREE.LineBasicMaterial;
  private rainVel: Float32Array;
  private rainDrop: Float32Array;
  private gulls: THREE.Sprite[] = [];
  private gullState: Array<{ cx: number; cz: number; r: number; a: number; speed: number; y: number }> = [];

  private flash = 0;
  private lastCam = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // купол
    const domeGeo = new THREE.SphereGeometry(1900, 32, 16);
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG.replace('//CLOUDS//', CLOUD_COMMON + CLOUD_COLORS),
      uniforms: {
        ...cloudUniforms,
        uCamPos: { value: new THREE.Vector3() },
        uStars: { value: 0 },
        uMoon: { value: 0 },
        uCirrus: { value: 0.5 },
        uSteps: { value: 24 },
        uZenith: { value: new THREE.Color(0x4a90d0) },
        uHorizon: { value: new THREE.Color(0xbcd8e6) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunStrength: { value: 1 },
        uFlash: { value: 0 },
        uCloudiness: { value: 0.3 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(domeGeo, this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    // дощ: риски навколо камери (локальні координати групи = відносно камери)
    const rainCount = 1600;
    this.rainDrop = new Float32Array(rainCount * 3);
    this.rainVel = new Float32Array(rainCount);
    for (let i = 0; i < rainCount; i++) {
      this.rainDrop[i * 3] = (Math.random() - 0.5) * RAIN_BOX;
      this.rainDrop[i * 3 + 1] = (Math.random() - 0.5) * RAIN_H;
      this.rainDrop[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX;
      this.rainVel[i] = 18 + Math.random() * 8;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rainCount * 6), 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xd6e4ee, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.rain = new THREE.LineSegments(rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.group.add(this.rain);

    // чайки
    const gullTex = makeGullTexture();
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.SpriteMaterial({ map: gullTex, transparent: true, opacity: 0.75, depthWrite: false, fog: true });
      const s = new THREE.Sprite(mat);
      const cx = (Math.random() - 0.5) * 600;
      const cz = (Math.random() - 0.5) * 600;
      const r = 40 + Math.random() * 90;
      this.gullState.push({ cx, cz, r, a: Math.random() * 6.28, speed: 0.15 + Math.random() * 0.2, y: 60 + Math.random() * 40 });
      s.scale.setScalar(6 + Math.random() * 3);
      this.gulls.push(s);
      this.group.add(s);
    }

    scene.add(this.group);
  }

  setFlash(v: number) {
    this.flash = Math.max(this.flash, v);
  }

  /**
   * @param camPos позиція камери
   * @param sunDir напрямок до сонця
   * @param daylight 0..1
   * @param cloudiness 0..1
   * @param rain 0..1
   */
  update(dt: number, camPos: THREE.Vector3, sunDir: THREE.Vector3, zenith: THREE.Color, horizon: THREE.Color, daylight: number, cloudiness: number, rain: number, windDir: number, timeH: number, indoor = false) {
    const u = this.domeMat.uniforms;
    (u.uZenith.value as THREE.Color).copy(zenith);
    (u.uHorizon.value as THREE.Color).copy(horizon);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    u.uSunStrength.value = daylight;
    this.flash = Math.max(0, this.flash - dt * 2.0);
    u.uFlash.value = this.flash;
    u.uCloudiness.value = clamp(cloudiness, 0, 1);

    // купол слідує камері; сонце, місяць, зорі й хмари — у шейдері купола (хмари їх ховають)
    this.group.position.copy(camPos);
    (u.uCamPos.value as THREE.Vector3).copy(camPos);
    u.uStars.value = clamp((-sunDir.y - 0.1) * 3.5, 0, 0.9);
    u.uMoon.value = clamp(-sunDir.y * 3, 0, 0.9);
    // пір'ясті — у ясну й вітряну погоду; під штормовою стелею їх не видно
    u.uCirrus.value = 0.75 * (1 - clamp((cloudiness - 0.55) * 2.5, 0, 1));
    // дощ: риски, нахилені вітром; камера — центр коробки (group уже в camPos)
    const rainO = clamp(rain * 0.9, 0, 0.55);
    this.rainMat.opacity = damp(this.rainMat.opacity, rainO, 1.2, dt);
    this.rain.visible = this.rainMat.opacity > 0.01 && !indoor;
    // зсув камери за кадр — краплі лишаються у світі, а не їдуть разом з човном
    const mvx = camPos.x - this.lastCam.x, mvy = camPos.y - this.lastCam.y, mvz = camPos.z - this.lastCam.z;
    this.lastCam.copy(camPos);
    if (this.rain.visible) {
      const gust = 0.35 + cloudiness * 0.5;
      const sx = Math.sin(windDir) * gust, sz = -Math.cos(windDir) * gust;
      const d = this.rainDrop;
      const arr = (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const big = Math.abs(mvx) + Math.abs(mvz) > RAIN_BOX * 0.5;
      const hb = RAIN_BOX / 2, hh = RAIN_H / 2;
      for (let i = 0; i < this.rainVel.length; i++) {
        const v = this.rainVel[i];
        let x = d[i * 3] + sx * v * dt - (big ? 0 : mvx);
        let y = d[i * 3 + 1] - v * dt - mvy;
        let z = d[i * 3 + 2] + sz * v * dt - (big ? 0 : mvz);
        if (y < -hh) y += RAIN_H;
        else if (y > hh) y -= RAIN_H;
        if (x < -hb) x += RAIN_BOX;
        else if (x > hb) x -= RAIN_BOX;
        if (z < -hb) z += RAIN_BOX;
        else if (z > hb) z -= RAIN_BOX;
        d[i * 3] = x;
        d[i * 3 + 1] = y;
        d[i * 3 + 2] = z;
        const len = 0.028 * v;
        arr[i * 6] = x;
        arr[i * 6 + 1] = y;
        arr[i * 6 + 2] = z;
        arr[i * 6 + 3] = x - sx * len;
        arr[i * 6 + 4] = y + len;
        arr[i * 6 + 5] = z - sz * len;
      }
      this.rain.geometry.getAttribute('position').needsUpdate = true;
      this.rainMat.color.setRGB(0.75 + daylight * 0.12, 0.82 + daylight * 0.08, 0.9);
    }

    // чайки: коло + приховуємо вночі/штормі
    const gullO = clamp(daylight * 1.5, 0, 1) * (1 - clamp(rain * 1.5, 0, 1));
    for (let i = 0; i < this.gulls.length; i++) {
      const gs = this.gullState[i];
      gs.a += gs.speed * dt * (0.6 + 0.4 * Math.sin(timeH + i));
      const s = this.gulls[i];
      s.position.set(camPos.x + gs.cx + Math.cos(gs.a) * gs.r, gs.y + Math.sin(gs.a * 2.3) * 4, camPos.z + gs.cz + Math.sin(gs.a) * gs.r);
      s.material.opacity = damp(s.material.opacity, gullO * 0.8, 0.5, dt);
      s.visible = s.material.opacity > 0.02;
    }
  }
}
