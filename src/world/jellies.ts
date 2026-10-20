import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { UNDERWATER_LAYER, type Ocean } from '../core/ocean';
import { hash2, mulberry32 } from '../core/math';
import type { TimeCycle } from '../core/time';
import { islandNear } from './islandShape';
import { terrainHeight } from './portTerrain';

// ─────────────────────────────────────────────────────────────
// Нічне цвітіння медуз: зграї світних медуз під самою поверхнею у
// відкритій воді. Вночі розгоряються, пульсують і повільно дрейфують.
// Зграї детерміновані: море поділене на клітинки, і що в кожній цвіте
// цієї ночі, вирішує сід (клітинка + номер ночі), а дрейф — спільний
// simTime. Тож усі гравці кімнати бачать ті самі зграї там само, без
// жодного мережевого повідомлення.
// Один InstancedMesh (один draw call), адитивне світіння.
// ─────────────────────────────────────────────────────────────

/** скільки найближчих зграй малюємо одночасно */
const SWARMS = 10;
const PER = 36;
/** сітка моря: у клітинці щонайбільше одна зграя */
const CELL = 70;
const DENSITY = 0.5;
/** далі — не видно; останні FADE метрів зграя плавно гасне */
const DROP = 150;
const FADE = 40;
/** радіус повільного блукання зграї довкола свого місця */
const WANDER = 12;
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
  x0: number;
  z0: number;
  ph1: number;
  ph2: number;
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
  /** зграї клітинок цієї ночі (null — порожня клітинка) */
  private cells = new Map<number, Swarm | null>();
  private nightId = NaN;
  private near: { sw: Swarm; x: number; z: number; d: number }[] = [];
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
  }

  /** зграя клітинки цієї ночі — лише у відкритій глибокій воді; той самий сід — та сама зграя в усіх */
  private cell(ix: number, iz: number): Swarm | null {
    const key = ix * 65536 + iz;
    let sw = this.cells.get(key);
    if (sw !== undefined) return sw;
    const r = mulberry32(Math.floor(hash2(ix, iz) * 4294967296) ^ Math.imul(this.nightId, 0x9e3779b1));
    sw = null;
    if (r() < DENSITY) {
      const x = (ix + 0.15 + r() * 0.7) * CELL;
      const z = (iz + 0.15 + r() * 0.7) * CELL;
      if (Math.hypot(x, z) >= 160 && terrainHeight(x, z) <= -3 && !islandNear(x, z, 20)) {
        const hue = HUES[Math.floor(r() * HUES.length)];
        const jellies: Jelly[] = [];
        for (let j = 0; j < PER; j++) {
          // щільніше до центру зграї
          const rr = 9 * Math.sqrt(r()) * r();
          const a = r() * Math.PI * 2;
          jellies.push({ dx: Math.cos(a) * rr, dz: Math.sin(a) * rr, depth: 0.45 + r() * 1.8, size: 0.16 + r() * 0.26, phase: r() * Math.PI * 2, color: new THREE.Color(hue).offsetHSL((r() - 0.5) * 0.06, 0, 0) });
        }
        sw = { x0: x, z0: z, ph1: r() * Math.PI * 2, ph2: r() * Math.PI * 2, jellies };
      }
    }
    this.cells.set(key, sw);
    return sw;
  }

  /** t — спільний simTime кімнати */
  update(t: number, ocean: Ocean, cam: THREE.Vector3, time: TimeCycle) {
    const glow = THREE.MathUtils.smoothstep(1 - time.daylight, 0.55, 0.95);
    this.mesh.visible = glow > 0.01;
    if (!this.mesh.visible) return;
    // ніч рахуємо від полудня: вечір і ранок — одна ніч, наступної цвіте деінде
    const nightId = time.hours >= 12 ? time.dayCount : time.dayCount - 1;
    if (nightId !== this.nightId || this.cells.size > 4000) {
      this.nightId = nightId;
      this.cells.clear();
    }
    const near = this.near;
    near.length = 0;
    const cx = Math.floor(cam.x / CELL);
    const cz = Math.floor(cam.z / CELL);
    const R = Math.ceil(DROP / CELL);
    for (let ix = cx - R; ix <= cx + R; ix++)
      for (let iz = cz - R; iz <= cz + R; iz++) {
        const sw = this.cell(ix, iz);
        if (!sw) continue;
        const x = sw.x0 + Math.sin(t * 0.011 + sw.ph1) * WANDER;
        const z = sw.z0 + Math.cos(t * 0.009 + sw.ph2) * WANDER;
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d < DROP) near.push({ sw, x, z, d });
      }
    near.sort((a, b) => a.d - b.d);
    let i = 0;
    for (let s = 0; s < SWARMS; s++) {
      const n = near[s];
      const k = n ? glow * (1 - THREE.MathUtils.smoothstep(n.d, DROP - FADE, DROP)) : 0;
      for (let jj = 0; jj < PER; jj++, i++) {
        if (k <= 0) {
          this.mesh.setMatrixAt(i, this._m.makeScale(0, 0, 0));
          continue;
        }
        const j = n.sw.jellies[jj];
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + j.phase);
        const x = n.x + j.dx + Math.sin(t * 0.2 + j.phase) * 0.6;
        const z = n.z + j.dz + Math.cos(t * 0.17 + j.phase) * 0.6;
        // поштовх дзвоном: скорочення — і медуза трохи спливає
        const y = ocean.heightAt(x, z, t) - j.depth + pulse * 0.12;
        this._p.set(x, y, z);
        this._s.set(j.size * (1.08 - 0.16 * pulse), j.size * (0.85 + 0.25 * pulse), j.size * (1.08 - 0.16 * pulse));
        this.mesh.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
        this.mesh.setColorAt(i, this._c.copy(j.color).multiplyScalar(k * (0.5 + pulse)));
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
