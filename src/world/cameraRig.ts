import * as THREE from 'three';
import { clamp } from '../core/math';

// ─────────────────────────────────────────────────────────────
// Камера: від першої особи, «з-за корми» (за штурвалом, V) і
// повільний обліт для заставки. Перемикання — плавним перельотом.
// ─────────────────────────────────────────────────────────────

export type CamMode = 'fp' | 'chase' | 'orbit';

export interface CamInput {
  /** голова гравця (від першої особи) */
  head: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  /** нахил від першої особи (premultiply у світовій рамці) */
  fpTilt: THREE.Quaternion | null;
  shake: THREE.Vector3;
  boatPos: THREE.Vector3;
  /** висота води під точкою (камера не пірнає) */
  waterAt: (x: number, z: number) => number;
  t: number;
}

const FOV_FP = 70;
const FOV_CHASE = 56;
const BLEND_S = 0.8;

export class CameraRig {
  mode: CamMode = 'orbit';
  /** відстань «з-за корми» (коліщатко) */
  dist = 15;

  private blend = 1;
  private fromPos = new THREE.Vector3();
  private fromQuat = new THREE.Quaternion();
  private fromFov = FOV_FP;
  private chasePos = new THREE.Vector3();
  private chaseInit = false;
  private _pos = new THREE.Vector3();
  private _target = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private _m = new THREE.Matrix4();
  private _up = new THREE.Vector3(0, 1, 0);

  constructor(private camera: THREE.PerspectiveCamera) {}

  setMode(m: CamMode) {
    if (m === this.mode) return;
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.blend = 0;
    if (m === 'chase') this.chaseInit = false;
    this.mode = m;
  }

  zoom(steps: number) {
    this.dist = clamp(this.dist * Math.pow(1.12, steps), 7, 34);
  }

  update(dt: number, c: CamInput) {
    const cam = this.camera;
    let fov = FOV_FP;
    if (this.mode === 'fp') {
      cam.position.copy(c.head).add(c.shake);
      cam.rotation.set(c.pitch, c.yaw, c.roll, 'YXZ');
      if (c.fpTilt) cam.quaternion.premultiply(c.fpTilt);
    } else {
      fov = FOV_CHASE;
      let yaw: number, elev: number, dist: number, lift: number;
      if (this.mode === 'orbit') {
        yaw = c.t * 0.035 + 2.2;
        elev = 0.2 + Math.sin(c.t * 0.05) * 0.06;
        dist = 24;
        lift = 3.2;
      } else {
        yaw = c.yaw;
        elev = clamp(0.2 - c.pitch * 0.9, 0.03, 1.2);
        dist = this.dist;
        lift = 2.8;
      }
      const tgt = this._target.copy(c.boatPos);
      tgt.y += lift;
      const p = this._pos.set(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev)).multiplyScalar(dist).add(tgt);
      // ліниве доганяння — човен «живе» в кадрі, а не прибитий до центру
      if (!this.chaseInit) {
        this.chasePos.copy(p);
        this.chaseInit = true;
      } else {
        const k = 1 - Math.exp(-(this.mode === 'orbit' ? 2 : 7) * dt);
        this.chasePos.lerp(p, k);
      }
      const minY = c.waterAt(this.chasePos.x, this.chasePos.z) + 0.9;
      if (this.chasePos.y < minY) this.chasePos.y = minY;
      cam.position.copy(this.chasePos).addScaledVector(c.shake, 0.6);
      this._m.lookAt(cam.position, tgt, this._up);
      cam.quaternion.setFromRotationMatrix(this._m);
    }

    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / BLEND_S);
      const e = this.blend * this.blend * (3 - 2 * this.blend);
      cam.position.lerpVectors(this.fromPos, cam.position, e);
      this._q.copy(this.fromQuat).slerp(cam.quaternion, e);
      cam.quaternion.copy(this._q);
      fov = this.fromFov + (fov - this.fromFov) * e;
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
