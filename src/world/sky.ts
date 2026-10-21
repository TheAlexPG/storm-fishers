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
uniform float uGolden;
uniform float uCoverK;
uniform float uVeil;
uniform sampler2D uCloudBN;
uniform highp sampler3D uCloudN3;
//CLOUDS//
varying vec3 vDir;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// у циклі з break неявні похідні (вибір mip) невизначені — рівень деталізації явно з відстані
float shapeLod(vec2 uv, float lod) {
  return textureLod(uCloudNoise, uv, lod).r * 0.62 + textureLod(uCloudNoise, mat2(0.866, 0.5, -0.5, 0.866) * uv * 2.7 + vec2(0.37, 0.11) + uCloudLayer.w * vec2(0.0011, 0.0007), lod + 1.4).a * 0.38;
}

// слід пікселя на поточному кроці (м): з нього — mip кожної текстури за її масштабом
// (дрібні «кульбаби» без фільтрації давали «цукрове» зерно на кромках)
float gFoot = 1.0;
float lodFor(float metersPerTile) {
  return clamp(log2(max(gFoot / (metersPerTile / 256.0), 1.0)), 0.0, 7.5);
}

// густина хмари в точці: e — «надлишок» форми над покривом, профіль за висотою
// в одиницях висоти вежі (кубічний — боки крутіші, верх заокруглений «капустою»)
float cloudDens(vec3 p, vec4 cv, float base, float lod, bool fine, out float hr) {
  vec2 uv0 = cloudUV(p.xz);
  float Ht = towerH(cv.a);
  hr = (p.y - base) / Ht;
  // під штормовою стелею — рвані низькі шматки (scud) на 150–450 м нижче бази
  if (hr < 0.0) {
    float below = base - p.y;
    if (cv.g < 0.35 || below > 280.0 || p.y < 60.0) return -1.0;
    float band = smoothstep(70.0, 130.0, below) * (1.0 - smoothstep(200.0, 270.0, below));
    // форма — з 3D-шуму (2D-Ворлі знизу під кутом показував комірки — «квадрати»)
    vec3 qs = vec3(p.x + uCloudOff.x * 1.3, p.y * 1.6, p.z + uCloudOff.y * 1.3) / 900.0;
    float ls = clamp(log2(max(gFoot / 14.0, 1.0)), 0.0, 5.0);
    float sc = textureLod(uCloudN3, qs, ls).r;
    return (sc - 0.78 + 0.2 * cv.g) * band * 0.9 - 0.01;
  }
  // вежа нахиляється за вітром і на різних висотах має свої «кульбаби» — не видавлена 2D-пляма
  vec2 uv = uv0 + vec2(0.045, 0.02) * hr;
  // високі вежі й стіна фронту: форма «пливе» з висотою (3D-шум у uv), інакше 2D-пляма,
  // видавлена на кілометри, дає вертикальні смуги, коли дивишся вгору вздовж стіни
  float tw = smoothstep(0.35, 0.9, cv.a) * clamp(hr + 0.15, 0.0, 1.2);
  // лише на основному промені (семпли світла беруть ту саму форму без зсуву — різниця в тіні непомітна,
  // а дві зайві 3D-вибірки на кожному семплі світла коштували ~10 % на ретіні); одна вибірка — кут зсуву
  if (fine && tw > 0.01) {
    // частота за висотою — в одиницях висоти вежі: у 10-км стіні форма міняється ~кожні 2.5 км
    vec3 wq = vec3(uv0 * 0.9, hr * (1.5 + 2.5 * smoothstep(0.5, 1.0, cv.a)) + 0.17);
    float wl = clamp(log2(max(gFoot / 60.0, 1.0)), 1.0, 4.0);
    float wa = textureLod(uCloudN3, wq, wl).r * 12.566;
    uv += vec2(cos(wa), sin(wa)) * (0.09 + 0.07 * smoothstep(0.6, 1.0, cv.a)) * tw;
  }
  // високі вежі — з крупнішої плями: інакше дрібний візерунок, видавлений на кілометри, дає «стовпи»
  // (змішуємо два сталі масштаби: масштабувати uv на змінний множник не можна — великі uv
  //  тоді «стрибають» між клітинками карти покриву й дають квадратні блоки)
  float kf = smoothstep(0.2, 0.95, cv.a);
  float sh0 = kf < 0.99 ? shapeLod(uv, max(lod, lodFor(uCloudLayer.z))) : 0.0;
  float sh1 = kf > 0.01 ? shapeLod(uv * 0.3 + vec2(0.29, 0.53), max(lod - 1.7, lodFor(uCloudLayer.z / 0.3))) : 0.0;
  float e = mix(sh0, sh1, kf) - (1.0 - cv.r);
  float prof = 0.1 * hr + 0.58 * hr * hr * hr;
  // явно поза хмарою (і не ковадло) — далі не рахуємо
  if (e - prof < -0.3 && cv.a < 0.75) return e - prof;
  // насичення: у суцільному фронті «надлишок» величезний — без цього висота вежі
  // повторює 2D-пляму (силует «міста»); так верхи однорідні, форму дають кульбаби
  e = e > 0.0 ? 0.5 * (1.0 - exp(-e * 2.0)) : e;
  // округлий низ (пласка база, але не вертикальні «завіси» збоку)
  float d = e - prof - (1.0 - smoothstep(0.0, 0.22, hr)) * 0.16;
  // клуби: 3D-шум (боки веж бугристі, а не вертикальні смуги); вдалині гасне — там без mip мерехтів би
  if (fine && d > -0.3) {
    vec3 q3 = vec3(p.x + uCloudOff.x, p.y * 1.25, p.z + uCloudOff.y) / 1500.0;
    // mip зі сліду пікселя (вокс 1500/64 ≈ 23 м)
    float l3 = clamp(log2(max(gFoot / 23.0, 1.0)), 0.0, 5.0);
    float b3 = textureLod(uCloudN3, q3, l3).r * 0.7 + textureLod(uCloudN3, q3 * 2.3 + 0.31, l3 + 1.2).r * 0.3;
    d += (b3 - 0.5) * 0.34 * smoothstep(0.04, 0.3, hr);
  }
  // ковадло купчасто-дощових: угорі вежа розтікається пласким дахом
  float cb = smoothstep(0.75, 0.95, cv.a);
  if (cb > 0.0 && hr > 0.7) {
    float slab = smoothstep(0.72, 0.8, hr) * (1.0 - smoothstep(0.9, 0.98, hr));
    float an = shapeLod(uv * 0.45 + 0.21, max(lod - 1.0, lodFor(uCloudLayer.z / 0.45))) - (1.0 - cv.r) + 0.12;
    d = max(d, an * slab * cb);
  }
  return hr > 1.05 ? min(d, -0.01) : d;
}

// купчастий шар: адаптивний крок (дрібний поблизу, крупний удалині), без апскейлу;
// світло — два семпли до сонця (близький — складки, далекий — тінь від сусідньої вежі)
vec4 cumulus(vec3 ro, vec3 rd, vec3 L, out float tHit) {
  float base = uCloudLayer.x, top = uCloudLayer.y;
  tHit = 0.0;
  if (rd.y < 0.01) return vec4(0.0);
  const float MAXD = 19000.0;
  // у шторм низ шару (рвані шматки) може бути нижче камери — стартуємо від камери, не позаду неї
  float t0 = max((base - ro.y) / rd.y, 0.0);
  if (t0 > MAXD) return vec4(0.0);
  float t1 = min(min((top - ro.y) / rd.y, MAXD + 4000.0), t0 + 9000.0);
  tHit = t0;
  int N = int(uSteps);
  // синій шум: ні штриховки R2/IGN, ні зерна білого шуму
  float jit = texture2D(uCloudBN, gl_FragCoord.xy / 64.0).r;
  float lod = clamp(log2(max(t0 * 0.0019 / max(rd.y, 0.04), 1.0) / (uCloudLayer.z / 256.0)), 0.0, 6.0);
  float mu = dot(rd, L);
  float g = 0.6;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.08;
  // крок: ~2.5 % відстані, але не грубіший за п'яту частину висоти хмари в цьому місці
  vec4 cv0 = textureLod(uCloudCover, (ro.xz + rd.xz * t0 - uCloudRect.xy) * uCloudRect.zw, 0.0);
  float t = t0 + clamp(t0 * 0.02, 22.0, clamp(towerH(cv0.a) * 0.15, 50.0, 240.0)) * jit;
  vec3 acc = vec3(0.0);
  float T = 1.0;
  float low = 1.0 - smoothstep(0.03, 0.3, L.y);
  float lk = mix(2.0, 6.0, smoothstep(0.04, 0.4, L.y));
  for (int i = 0; i < 64; i++) {
    if (i >= N || t > t1) break;
    vec3 p = ro + rd * t;
    vec4 cv = textureLod(uCloudCover, (p.xz - uCloudRect.xy) * uCloudRect.zw, 0.0) * vec4(uCoverK, 1.0, 1.0, 1.0);
    float dt = clamp(t * 0.02, 22.0, clamp(towerH(cv.a) * 0.15, 50.0, 240.0));
    // лише слід пікселя: грубший mip після порогу густини дає квадратні плями розміром у тексель
    gFoot = t * 0.0019;
    float hr;
    // база — раз на крок (семпли світла беруть ту саму)
    float cbase = cloudBaseAt(cloudUV(p.xz), cv.g);
    float d = cloudDens(p, cv, cbase, lod, true, hr);
    vec2 uv = cloudUV(p.xz);
    if (d > 0.0 && d < 0.3) {
      // ерозія кромки (лише біля поверхні — всередині її не видно): дрібні «кульбаби»; угорі сильніше — капустяний верх
      float er = textureLod(uCloudNoise, uv * 4.6 + uCloudLayer.w * vec2(0.003, -0.0015), lodFor(uCloudLayer.z / 4.6) + 1.4).g;
      d -= er * (0.055 + 0.06 * clamp(hr, 0.0, 1.0)) * (1.0 - 0.5 * cv.g);
    }
    if (d > 0.0) {
      float h = clamp(hr, 0.0, 1.0);
      float hr1, hr2;
      float f0 = gFoot;
      gFoot = f0 * 2.0;
      float dl1 = cloudDens(p + L * 140.0, cv, cbase, lod + 0.6, false, hr1);
      float od = max(dl1, 0.0) * lk + d * 1.2;
      // далекий семпл — завжди (поріг за od давав розрив яскравості → «квадрати»);
      // у штормовій товщі плавно замінюємо оцінкою з ближнього — там він майже не видно
      float sk = smoothstep(0.4, 0.6, cv.g);
      float far2 = max(dl1, 0.0) * lk * 0.8;
      if (sk < 1.0) {
        gFoot = f0 * 5.0;
        float dl2 = cloudDens(p + L * 520.0, cv, cbase, lod + 1.2, false, hr2);
        far2 = mix(max(dl2, 0.0) * lk * 0.8, far2, sk);
      }
      od += far2;
      gFoot = f0;
      float lt = exp(-od);
      lt *= 1.0 - 0.65 * cv.g;
      // рвані шматки під стелею — у її тіні: темно-сірі, не білі цятки
      if (hr < 0.0) lt *= 0.15;
      float powder = 1.0 - exp(-d * 10.0);
      vec3 sh = mix(uCShade, uCStorm, cv.g);
      // глибокі тіні в складках — нижче темніше
      sh *= 0.75 + 0.35 * h;
      vec3 li = mix(uCLit, uCLit * 0.5 + uCStorm, cv.g * 0.7);
      vec3 c = mix(sh, li, lt * (0.55 + 0.45 * powder));
      // низьке сонце підсвічує хмари знизу (золота година, сутінки)
      c = mix(c, li * (1.0 + 0.45 * lt) + vec3(0.08, 0.02, 0.06) * uGolden, low * (1.0 - h * 0.7) * (0.5 + 0.4 * uGolden) * (1.0 - cv.g));
      // кромки проти сонця — світлі «вали» (замість радіальних променів, яких без пост-процесу немає)
      c += li * pow(max(mu, 0.0), 6.0) * (1.0 - lt) * 0.35 * (1.0 - cv.g) * (0.4 + uGolden);
      // штормова стеля не пласка: темні вали й світліші розриви
      if (cv.g > 0.05) {
        float sv = smoothstep(0.3, 0.72, shapeLod(uv * 0.55 + 0.13, max(lod - 0.8, 0.0)));
        c *= mix(1.0, mix(0.5, 1.35, sv), cv.g * (1.0 - 0.5 * h));
      }
      // небо зверху, відсвіт води знизу
      c += uCAmb * (0.06 + 0.24 * h) * (1.0 - 0.6 * cv.g);
      c += vec3(0.05, 0.08, 0.11) * (1.0 - h) * (0.4 + 0.6 * uSunStrength) * (1.0 - cv.g);
      c += li * hg * lt * (1.0 - cv.g);
      c += vec3(0.75, 0.8, 1.0) * uFlash * (1.3 - h) * (0.6 + cv.g);
      // м'яка кромка: на межі густина плавно сходить до нуля — менше «зерна» від зсуву кроку
      float de = d * smoothstep(0.0, 0.05, d);
      float a = 1.0 - exp(-de * dt * (0.04 + 0.036 * cv.g));
      acc += T * a * c;
      T *= 1.0 - a;
      if (T < 0.04) break;
    }
    // порожнеча — крок удвічі (синій шум зсуву ховає грубіший крок)
    t += d < -0.2 ? dt * (1.0 + min(-d * 4.0, 1.0)) : dt;
  }
  float alpha = 1.0 - T;
  if (alpha <= 0.0) return vec4(0.0);
  if (T < 0.04) alpha = 1.0;
  vec3 col = acc / alpha;
  // повітряна перспектива: далекі хмари тонуть у серпанку — у тіні фронту він темний
  float far = smoothstep(2500.0, 16000.0, t0);
  float occ = airOcc(ro.xz, normalize(rd.xz + 1e-5), min(t0, 18000.0));
  vec3 haze = mix(uHorizon * (0.7 + 0.3 * (1.0 - uCloudiness)), uCAir, occ * occ);
  col = mix(col, haze, far * 0.7);
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
    if (r > 0.955) {
      vec2 o = vec2(hsh(id + 7.1), hsh(id + 3.3)) - 0.5;
      float s = 1.0 - smoothstep(0.06, 0.22, length(f - o * 0.6));
      col += vec3(0.85, 0.9, 1.0) * s * uStars * (0.4 + 0.6 * hsh(id + 1.7)) * smoothstep(0.0, 0.15, d.y);
    }
  }
  // Чумацький Шлях: широка смуга по нахиленому великому колу з «хмарками» шуму
  if (uStars > 0.0 && d.y > 0.0) {
    vec3 mwN = normalize(vec3(0.35, 0.45, 0.82));
    float mw = exp(-pow(dot(d, mwN) / 0.16, 2.0));
    float mn = texture2D(uCloudNoise, vec2(atan(d.z, d.x) * 0.9, d.y * 1.7) * 1.3, 1.0).r;
    col += vec3(0.42, 0.42, 0.62) * mw * (0.35 + 0.9 * mn) * 0.16 * uStars * smoothstep(0.0, 0.2, d.y);
  }
  // сонце + ореол
  float sd = max(dot(d, sunD), 0.0);
  col += vec3(1.0, 0.9, 0.7) * (pow(sd, 350.0) * 2.0 + smoothstep(0.99955, 0.9998, sd) * 1.6) * uSunStrength * (1.0 - 0.6 * uVeil);
  col += vec3(1.0, 0.75, 0.5) * pow(sd, 18.0) * 0.3 * uSunStrength;
  col += vec3(1.0, 0.82, 0.55) * pow(sd, 5.0) * 0.16 * uSunStrength;
  // золота година: обрій з боку сонця розжарений, протилежний — рожево-фіолетовий
  if (uGolden > 0.0) {
    vec2 sh2 = normalize(sunD.xz + 1e-5);
    float side = dot(normalize(d.xz + 1e-5), sh2) * 0.5 + 0.5;
    float band = exp(-h * 5.0);
    col += vec3(1.0, 0.45, 0.18) * pow(side, 3.0) * band * 0.45 * uGolden;
    col = mix(col, col * vec3(0.95, 0.75, 1.1) + vec3(0.06, 0.02, 0.08), (1.0 - side) * band * 0.5 * uGolden);
  }
  // пелена перистих перед фронтом: небо молочнішає, сонце тьмяніє в ореолі (а не стіна одразу)
  if (uVeil > 0.0) {
    float vh = smoothstep(-0.02, 0.35, d.y);
    vec3 milk = mix(uHorizon, vec3(0.72, 0.76, 0.8) * (0.25 + 0.75 * uSunStrength), 0.55);
    col = mix(col, milk, uVeil * 0.5 * vh);
    col += vec3(1.0, 0.95, 0.85) * pow(sd, 40.0) * 0.25 * uVeil * uSunStrength;
  }
  // місяць (навпроти сонця, як moonLight у main.ts)
  vec3 md = normalize(vec3(-sunD.x, max(-sunD.y, 0.2), -sunD.z));
  float mdd = dot(d, md);
  col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99935, 0.99965, mdd) * 1.1 + pow(max(mdd, 0.0), 80.0) * 0.16 + pow(max(mdd, 0.0), 12.0) * 0.06) * uMoon;
  // хмарність: небо сіріє (у шторм небо майже ховається за стелею хмар)
  float cl = clamp(uCloudiness, 0.0, 1.0);
  // шторм — холодний зеленувато-сірий (як у SoT)
  vec3 greyHor = vec3(0.27, 0.33, 0.33);
  vec3 greyTop = vec3(0.17, 0.21, 0.22);
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
  // «тінь у повітрі»: під стелею й під фронтом нижнє небо — темне повітря, а не світлий градієнт
  if (d.y < 0.35) {
    vec2 hz = normalize(d.xz + 1e-5);
    float occ = airOcc(uCamPos.xz, hz, 18000.0);
    float wEl = 1.0 - smoothstep(0.0, 0.35, d.y);
    col = mix(col, uCAir, clamp(occ * wEl * 0.95, 0.0, 1.0));
    // завіси дощу: від бази до води, м'які смуги
    if (d.y < 0.16 && d.y > -0.03) {
      float veil = 0.0;
      for (int k = 0; k < 3; k++) {
        float D = k == 0 ? 2200.0 : (k == 1 ? 4800.0 : 9500.0);
        float y = uCamPos.y + d.y * D;
        float cb0 = uCloudBase0;
        if (y < cb0) {
          vec3 cv = cloudCoverAt(uCamPos.xz + hz * D);
          float ang = atan(hz.y, hz.x);
          float yn = y / cb0;
          float sx = ang * (k == 0 ? 2.2 : (k == 1 ? 3.4 : 5.0)) + yn * 0.25 + 0.17 * float(k);
          float streak = texture2D(uCloudNoise, vec2(sx * 0.15, 0.37 + uCloudLayer.w * 0.0004), 1.5).r;
          float fine = texture2D(uCloudNoise, vec2(sx * 0.9, 0.61 + yn * 0.08 + uCloudLayer.w * 0.002), 1.0).g;
          float sh = smoothstep(0.3, 0.65, streak + 0.25 * cv.b) * (0.75 + 0.25 * fine);
          // до бази дощ густішає, біля води розсіюється в серпанок
          veil = max(veil, cv.b * sh * (0.55 + 0.45 * yn));
        }
      }
      vec3 rainC = uCAir * 0.85 + vec3(0.01, 0.015, 0.025);
      col = mix(col, rainC, clamp(veil, 0.0, 1.0) * 0.8 * smoothstep(-0.03, 0.005, d.y));
    }
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
        uSteps: { value: 64 },
        uGolden: { value: 0 },
        uCoverK: { value: 1.25 },
        uVeil: { value: 0 },
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

  /** пелена високих хмар перед фронтом 0..1 (від Clouds) */
  setVeil(v: number) {
    this.domeMat.uniforms.uVeil.value = v;
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
    // золота година й сутінки: тепле сяйво обрію; покрив трохи рідший — більше розривів,
    // нижні шари не зливаються в суцільну стелю
    const sy = sunDir.y;
    const golden = clamp((0.4 - sy) / 0.35, 0, 1) * clamp((sy + 0.25) / 0.25, 0, 1);
    u.uGolden.value = golden;
    u.uCoverK.value = 1.25 - 0.22 * golden * (1 - clamp((cloudiness - 0.5) * 2, 0, 1));
    // пір'ясті — у ясну й вітряну погоду; під штормовою стелею їх не видно
    u.uCirrus.value = Math.min(1.2, 0.75 * (1 - clamp((cloudiness - 0.55) * 2.5, 0, 1)) + u.uVeil.value * 0.6);
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
