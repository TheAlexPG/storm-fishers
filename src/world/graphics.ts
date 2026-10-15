import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Графіка: відбиття неба (IBL з градієнтного неба → PMREM) — гелькоут,
// нержавійка, скло й лак отримують живі відблиски, що змінюються з часом доби.
// (Пост-обробку свідомо не вмикаємо: океан/небо — кастомні шейдери, що пишуть
// display-кольори напряму; ACES у OutputPass змінив би їхній вигляд.)
// ─────────────────────────────────────────────────────────────

const ENV_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const ENV_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSea;
uniform vec3 uSunDir;
uniform float uSun;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  vec3 sea = mix(uHorizon * 0.55, uSea, clamp(-h * 4.0, 0.0, 1.0));
  vec3 col = h >= 0.0 ? sky : sea;
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += vec3(1.0, 0.92, 0.78) * (pow(s, 60.0) * 6.0 + pow(s, 6.0) * 0.35) * uSun;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** небо для відбиттів: оновлюється раз на ~1.5 с (PMREM недешевий) */
export class SkyEnvironment {
  private envScene = new THREE.Scene();
  private mat: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private rt: THREE.WebGLRenderTarget | null = null;
  private timer = 0;

  constructor(private renderer: THREE.WebGLRenderer, private target: THREE.Scene) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: ENV_VERT,
      fragmentShader: ENV_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSea: { value: new THREE.Color(0x06283a) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSun: { value: 1 },
      },
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.mat));
  }

  update(dt: number, zenith: THREE.Color, horizon: THREE.Color, sunDir: THREE.Vector3, sunStrength: number, force = false) {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 1.5;
    const u = this.mat.uniforms;
    (u.uZenith.value as THREE.Color).copy(zenith);
    (u.uHorizon.value as THREE.Color).copy(horizon);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    u.uSun.value = sunStrength;
    const next = this.pmrem.fromScene(this.envScene, 0, 0.1, 50);
    this.target.environment = next.texture;
    this.rt?.dispose();
    this.rt = next;
  }
}
