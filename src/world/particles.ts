import * as THREE from 'three';
import { rand } from '../core/math';

// ─────────────────────────────────────────────────────────────
// Пул частин (без garbage): бризки, сплески, дим вихлопу.
// ─────────────────────────────────────────────────────────────

interface Particle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  drag: number;
  gravity: number;
  color: THREE.Color;
  alpha: number;
}

function makeSoftDot(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export class ParticlePool {
  private points: THREE.Points;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private parts: Particle[] = [];
  private readonly count: number;
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, count = 900) {
    this.count = count;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] = -1000; // приховано
      this.parts.push({
        active: false,
        pos: new THREE.Vector3(0, -1000, 0),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        drag: 0,
        gravity: 0,
        color: new THREE.Color(1, 1, 1),
        alpha: 1,
      });
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.colAttr = new THREE.BufferAttribute(col, 3);
    this.sizeAttr = new THREE.BufferAttribute(size, 1);
    this.alphaAttr = new THREE.BufferAttribute(alpha, 1);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float a = smoothstep(0.5, 0.05, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  private cursor = 0;

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number,
    color: THREE.Color, alpha = 1,
    gravity = -4, drag = 1.2,
  ) {
    // шукаємо вільне місце по колу
    for (let i = 0; i < this.count; i++) {
      this.cursor = (this.cursor + 1) % this.count;
      const p = this.parts[this.cursor];
      if (!p.active) {
        p.active = true;
        p.pos.set(x, y, z);
        p.vel.set(vx, vy, vz);
        p.life = life;
        p.maxLife = life;
        p.size = size;
        p.color.copy(color);
        p.alpha = alpha;
        p.gravity = gravity;
        p.drag = drag;
        return;
      }
    }
  }

  /** бризки від носа човна */
  spray(pos: THREE.Vector3, fwd: THREE.Vector3, speed: number, dt: number) {
    if (speed < 2) return;
    const n = Math.min(28, Math.floor(speed * dt * 6));
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? 1 : -1;
      this.spawn(
        pos.x + fwd.x * rand(0.5, 1.4) + side * rand(0.3, 0.9),
        pos.y + rand(0, 0.3),
        pos.z + fwd.z * rand(0.5, 1.4) + side * rand(0.3, 0.9),
        fwd.x * speed * 0.35 + rand(-1.5, 1.5),
        rand(1.5, 4.5) * (0.5 + speed / 10),
        fwd.z * speed * 0.35 + rand(-1.5, 1.5),
        rand(0.4, 0.9), rand(0.25, 0.6),
        WHITE, 0.8, -9, 1.5,
      );
    }
  }

  /** сплеск у точці (закидання, вхід у воду) */
  splash(x: number, y: number, z: number, power = 1) {
    const n = Math.floor(10 + power * 14);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0.4, 2.2) * power;
      this.spawn(
        x + Math.cos(a) * 0.2, y, z + Math.sin(a) * 0.2,
        Math.cos(a) * r, rand(1.5, 5) * power, Math.sin(a) * r,
        rand(0.4, 0.8), rand(0.3, 0.7), WHITE, 0.85, -9, 1.5,
      );
    }
  }

  /** дим з вихлопу */
  exhaust(pos: THREE.Vector3, power: number, dt: number) {
    if (power < 0.05) return;
    const n = Math.random() < power * dt * 14 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      this.spawn(
        pos.x + rand(-0.08, 0.08), pos.y + rand(0, 0.1), pos.z + rand(-0.08, 0.08),
        rand(-0.2, 0.2), rand(0.4, 0.9), rand(-0.2, 0.2),
        rand(0.8, 1.6), rand(0.5, 0.9),
        SMOKE, 0.5 * (0.4 + power * 0.6), 0.3, 0.6,
      );
    }
  }

  /** іскри/блиск при лові */
  sparkle(x: number, y: number, z: number) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(
        x, y, z,
        Math.cos(a) * rand(0.5, 2), rand(1, 3.5), Math.sin(a) * rand(0.5, 2),
        rand(0.4, 0.7), rand(0.2, 0.45),
        GOLD, 0.9, -3, 1,
      );
    }
  }

  update(dt: number) {
    const pos = this.posAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;
    const alpha = this.alphaAttr.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const p = this.parts[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        pos[i * 3 + 1] = -1000;
        continue;
      }
      const d = 1 / (1 + p.drag * dt);
      p.vel.x *= d;
      p.vel.y = p.vel.y * d + p.gravity * dt;
      p.vel.z *= d;
      p.pos.addScaledVector(p.vel, dt);
      const t = p.life / p.maxLife;
      pos[i * 3] = p.pos.x;
      pos[i * 3 + 1] = p.pos.y;
      pos[i * 3 + 2] = p.pos.z;
      col[i * 3] = p.color.r;
      col[i * 3 + 1] = p.color.g;
      col[i * 3 + 2] = p.color.b;
      size[i] = p.size * (0.6 + 0.4 * t);
      alpha[i] = p.alpha * Math.min(1, t * 2.5);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }
}

const WHITE = new THREE.Color(0.85, 0.93, 1.0);
const SMOKE = new THREE.Color(0.35, 0.38, 0.42);
const GOLD = new THREE.Color(1.0, 0.82, 0.35);
