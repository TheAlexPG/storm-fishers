import * as THREE from 'three';
import { clamp, damp } from '../core/math';

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
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
  // сонце + ореол
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += vec3(1.0, 0.9, 0.7) * pow(sd, 350.0) * 2.0 * uSunStrength;
  col += vec3(1.0, 0.75, 0.5) * pow(sd, 18.0) * 0.22 * uSunStrength;
  col += vec3(1.0, 0.85, 0.6) * pow(sd, 5.0) * 0.10 * uSunStrength;
  // хмарність: небо сіріє і темніє (штормове покривало).
  // Фіксоване темне сіре (немов хмарна штора), трохи світліше біля горизонту,
  // інакше яскравий денний горизонт залишався блакитним навіть у шторм.
  float cl = clamp(uCloudiness, 0.0, 1.0);
  vec3 greyHor = vec3(0.30, 0.33, 0.38);
  vec3 greyTop = vec3(0.20, 0.22, 0.27);
  vec3 grey = mix(greyHor, greyTop, pow(h, 0.55));
  col = mix(col, grey, clamp(cl * 0.85, 0.0, 1.0));
  // блискавка
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.3 + 0.7 * (1.0 - h));
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeGlowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 128);
  // кілька м'яких кіл
  for (let i = 0; i < 26; i++) {
    const x = 30 + Math.random() * 196;
    const y = 44 + Math.random() * 40;
    const r = 12 + Math.random() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGullTexture(): THREE.CanvasTexture {
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

export class Sky {
  group = new THREE.Group();
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private sunSprite: THREE.Sprite;
  private moonSprite: THREE.Sprite;
  private stars: THREE.Points;
  private starsMat: THREE.PointsMaterial;
  private clouds: THREE.Sprite[] = [];
  private cloudMats: THREE.SpriteMaterial[] = [];
  private rain: THREE.Points;
  private rainMat: THREE.PointsMaterial;
  private rainVel: Float32Array;
  private gulls: THREE.Sprite[] = [];
  private gullState: Array<{ cx: number; cz: number; r: number; a: number; speed: number; y: number }> = [];

  private flash = 0;
  private cloudTarget = 0.3;

  constructor(scene: THREE.Scene) {
    // купол
    const domeGeo = new THREE.SphereGeometry(1900, 32, 16);
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      uniforms: {
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

    // сонце
    const sunTex = makeGlowTexture('rgba(255,250,235,1)', 'rgba(255,220,150,0.55)');
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, transparent: true }));
    this.sunSprite.scale.setScalar(180);
    this.group.add(this.sunSprite);

    // місяць
    const moonTex = makeGlowTexture('rgba(235,240,255,0.95)', 'rgba(180,200,255,0.25)');
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false, transparent: true, opacity: 0 }));
    this.moonSprite.scale.setScalar(90);
    this.group.add(this.moonSprite);

    // зорі
    const starCount = 700;
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      // випадковий напрямок у верхній півсфері
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.98); // до зеніта
      const r = 1750;
      pos[i * 3] = r * Math.sin(v) * Math.cos(u);
      pos[i * 3 + 1] = r * Math.cos(v) * 0.9 + 60;
      pos[i * 3 + 2] = r * Math.sin(v) * Math.sin(u);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starsMat = new THREE.PointsMaterial({ color: 0xdde8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(starGeo, this.starsMat);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // хмари (спрайти)
    const cloudTex = makeCloudTexture();
    for (let i = 0; i < 34; i++) {
      const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.4, depthWrite: false, fog: false });
      const s = new THREE.Sprite(mat);
      const ang = Math.random() * Math.PI * 2;
      const dist = 300 + Math.random() * 1200;
      s.position.set(Math.cos(ang) * dist, 170 + Math.random() * 160, Math.sin(ang) * dist);
      const w = 180 + Math.random() * 260;
      s.scale.set(w, w * 0.42, 1);
      s.userData = { speed: 1.5 + Math.random() * 2.5, baseO: 0.25 + Math.random() * 0.35 };
      this.clouds.push(s);
      this.cloudMats.push(mat);
      this.group.add(s);
    }

    // дощ
    const rainCount = 1400;
    const rpos = new Float32Array(rainCount * 3);
    this.rainVel = new Float32Array(rainCount);
    for (let i = 0; i < rainCount; i++) {
      rpos[i * 3] = (Math.random() - 0.5) * 70;
      rpos[i * 3 + 1] = Math.random() * 34;
      rpos[i * 3 + 2] = (Math.random() - 0.5) * 70;
      this.rainVel[i] = 26 + Math.random() * 10;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
    this.rainMat = new THREE.PointsMaterial({ color: 0xcfe2f0, size: 0.16, transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.Points(rainGeo, this.rainMat);
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

    // купол і світила слідують камері
    this.group.position.copy(camPos);
    const sd = sunDir.clone().multiplyScalar(1750);
    this.sunSprite.position.set(sd.x, Math.max(sd.y, -80), sd.z);
    // за щільним хмарним покривалом сонце гасне
    this.sunSprite.material.opacity = clamp(sunDir.y * 4 + 0.3, 0, 1) * (1 - cloudiness * 0.85);
    const md = sunDir.clone().multiplyScalar(-1750);
    this.moonSprite.position.set(md.x, Math.max(md.y, 100), md.z);
    this.moonSprite.material.opacity = clamp(-sunDir.y * 3, 0, 0.9) * (1 - cloudiness * 0.6);
    this.starsMat.opacity = clamp(-sunDir.y * 2.5, 0, 0.9) * (1 - cloudiness * 0.7);

    // хмари: дрейф + щільність
    this.cloudTarget = 0.12 + cloudiness * 0.88;
    const wvx = Math.sin(windDir) * (4 + cloudiness * 10);
    const wvz = -Math.cos(windDir) * (4 + cloudiness * 10);
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      const o = c.userData.baseO as number;
      c.position.x += (wvx * 0.35 + c.userData.speed) * dt * 0.4;
      c.position.z += wvz * 0.35 * dt * 0.4;
      // тримаємо коло навколо камери
      const dx = c.position.x - camPos.x;
      const dz = c.position.z - camPos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1500) {
        c.position.x = camPos.x + (dx / d) * 300;
        c.position.z = camPos.z + (dz / d) * 300;
      }
      const targetO = o * this.cloudTarget;
      c.material.opacity = damp(c.material.opacity, targetO, 0.4, dt);
      // в шторм — темніші
      const t = clamp((cloudiness - 0.5) * 2, 0, 1);
      c.material.color.setRGB(1 - t * 0.55, 1 - t * 0.55, 1 - t * 0.5);
    }

    // дощ
    const rainO = clamp(rain * 1.2, 0, 0.75);
    this.rainMat.opacity = damp(this.rainMat.opacity, rainO, 1.2, dt);
    this.rain.visible = this.rainMat.opacity > 0.01 && !indoor;
    if (this.rain.visible) {
      this.rain.position.set(camPos.x, 0, camPos.z);
      const attr = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < arr.length / 3; i++) {
        arr[i * 3 + 1] -= this.rainVel[i] * dt;
        if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = 34;
      }
      attr.needsUpdate = true;
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
