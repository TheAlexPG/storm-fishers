import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { UNDERWATER_LAYER, type Ocean } from '../core/ocean';
import { islandNear } from './islandShape';
import { terrainHeight } from './portTerrain';

// ─────────────────────────────────────────────────────────────
// Нічне цвітіння медуз: зграї світних медуз під самою поверхнею у
// відкритій воді. Вночі розгоряються, пульсують і повільно дрейфують;
// зграї, що лишились далеко позаду, з'являються знову попереду.
// Один InstancedMesh (один draw call), адитивне світіння.
// ─────────────────────────────────────────────────────────────

const SWARMS = 5;
const PER = 36;
const NEAR = 25;
const FAR = 110;
const DROP = 170;
const HUES = [0x5ff6ff, 0x48ffc8, 0xb68cff, 0xff7ad9];

interface Jelly {
  dx: number;
  dz: number;
  depth: number;
  size: number;
  phase: number;
  color: THREE.Color;
}

interface Swarm {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** секунд від появи (плавне розгоряння) */
  age: number;
  on: boolean;
  jellies: Jelly[];
}

function jellyGeometry(): THREE.BufferGeometry {
  const bell = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const core = new THREE.SphereGeometry(0.45, 8, 5).translate(0, 0.15, 0);
  const parts: THREE.BufferGeometry[] = [bell, core];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(new THREE.CylinderGeometry(0.035, 0.01, 1.5, 3, 1, true).translate(Math.cos(a) * 0.55, -0.75, Math.sin(a) * 0.55));
  }
  // різні набори атрибутів (uv у циліндра без кришок однакові) — лишаємо лише позицію
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (k !== 'position') p.deleteAttribute(k);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
}

export class Jellies {
  private mesh: THREE.InstancedMesh;
  private swarms: Swarm[] = [];
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3();
  private _c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    // depthWrite — вода за глибиною з переломлення рахує товщу над медузою; без запису
    // глибини вона «бачила» дно під нею і гасила світіння мутністю
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(jellyGeometry(), mat, SWARMS * PER);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // під водою їх видно лише крізь переломлення води
    this.mesh.layers.enable(UNDERWATER_LAYER);
    for (let i = 0; i < SWARMS * PER; i++) this.mesh.setColorAt(i, this._c.setRGB(0, 0, 0));
    scene.add(this.mesh);
    for (let s = 0; s < SWARMS; s++) {
      const jellies: Jelly[] = [];
      for (let j = 0; j < PER; j++) {
        // щільніше до центру зграї
        const r = 9 * Math.sqrt(Math.random()) * Math.random();
        const a = Math.random() * Math.PI * 2;
        jellies.push({ dx: Math.cos(a) * r, dz: Math.sin(a) * r, depth: 0.45 + Math.random() * 1.8, size: 0.16 + Math.random() * 0.26, phase: Math.random() * Math.PI * 2, color: new THREE.Color() });
      }
      this.swarms.push({ x: 0, z: 0, vx: 0, vz: 0, age: 0, on: false, jellies });
    }
  }

  /** нова зграя довкола гравця — лише у відкритій глибокій воді */
  private place(sw: Swarm, cx: number, cz: number) {
    sw.on = false;
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = NEAR + Math.random() * (FAR - NEAR);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (Math.hypot(x, z) < 160 || terrainHeight(x, z) > -3 || islandNear(x, z, 20)) continue;
      sw.x = x;
      sw.z = z;
      const da = Math.random() * Math.PI * 2;
      sw.vx = Math.cos(da) * 0.15;
      sw.vz = Math.sin(da) * 0.15;
      sw.age = 0;
      sw.on = true;
      const hue = HUES[Math.floor(Math.random() * HUES.length)];
      for (const j of sw.jellies) j.color.setHex(hue).offsetHSL((Math.random() - 0.5) * 0.06, 0, 0);
      return;
    }
  }

  /** night 0..1 (1 − daylight) */
  update(dt: number, t: number, ocean: Ocean, cam: THREE.Vector3, night: number) {
    const glow = THREE.MathUtils.smoothstep(night, 0.55, 0.95);
    this.mesh.visible = glow > 0.01;
    if (!this.mesh.visible) {
      // удень зграї розходяться — уночі розквітнуть деінде
      for (const sw of this.swarms) sw.on = false;
      return;
    }
    let i = 0;
    for (const sw of this.swarms) {
      if (!sw.on || Math.hypot(sw.x - cam.x, sw.z - cam.z) > DROP) this.place(sw, cam.x, cam.z);
      sw.age += dt;
      sw.x += sw.vx * dt;
      sw.z += sw.vz * dt;
      const k = sw.on ? glow * Math.min(1, sw.age / 4) : 0;
      for (const j of sw.jellies) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + j.phase);
        const x = sw.x + j.dx + Math.sin(t * 0.2 + j.phase) * 0.6;
        const z = sw.z + j.dz + Math.cos(t * 0.17 + j.phase) * 0.6;
        // поштовх дзвоном: скорочення — і медуза трохи спливає
        const y = ocean.heightAt(x, z, t) - j.depth + pulse * 0.12;
        this._p.set(x, y, z);
        this._s.set(j.size * (1.08 - 0.16 * pulse), j.size * (0.85 + 0.25 * pulse), j.size * (1.08 - 0.16 * pulse));
        this.mesh.setMatrixAt(i, this._m.compose(this._p, this._q, k > 0 ? this._s : this._s.setScalar(0)));
        this.mesh.setColorAt(i, this._c.copy(j.color).multiplyScalar(k * (0.5 + pulse)));
        i++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
