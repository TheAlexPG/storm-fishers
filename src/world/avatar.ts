import * as THREE from 'three';
import type { Boat } from './boat';
import type { Ocean } from '../core/ocean';
import { buildCharacter, hashStr, playerLook } from './character';

// ─────────────────────────────────────────────────────────────
// Аватар іншого гравця (кооп): рибалка в зюйдвестці + нік над головою.
// Стан приходить ~15 разів/с; між пакетами — плавне доганяння.
// На яхті позиція в локальних координатах корпусу — аватар їде разом
// з човном без жодного відставання.
// ─────────────────────────────────────────────────────────────

/** мережевий стан гравця (компактний) */
export interface NetPlayer {
  /** 0 — на яхті (x/z локальні, y — підлога), 1 — порт, 2 — вода (світові) */
  m: 0 | 1 | 2;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** за штурвалом */
  wh: 0 | 1;
  /** йде */
  mv: 0 | 1;
  /** риболовля: [1 чекає / 2 клює / 3 боротьба, x, z, натяг] */
  f?: [number, number, number, number];
}

const JACKETS = [0xf2c12e, 0xe0522f, 0x2f7fd0, 0x3fae5a, 0xa04bc0, 0xf08a24, 0x1fb3b0, 0xd23c6e];

export function colorForId(id: number): number {
  return JACKETS[(id * 7 + 3) % JACKETS.length];
}

export class Avatar {
  readonly root = new THREE.Group();
  state: NetPlayer | null = null;
  private body: THREE.Group;
  private torso: THREE.Group;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private kneeL: THREE.Group;
  private kneeR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private head: THREE.Group;
  // жива поза: озирання, помах рукою, коли довго стоїть
  private idleT = 0;
  private waveT = -1;
  private look = 0;
  private lookTarget = 0;
  private lookTimer = 0;
  private walkK = 0;
  private label: THREE.Sprite;
  private labelCanvas: HTMLCanvasElement;
  private phase = Math.random() * 10;
  // згладжені величини
  private sx = 0;
  private sy = 0;
  private sz = 0;
  private syaw = 0;
  private smode = -1;
  private _v = new THREE.Vector3();
  // риболовля
  private rod = new THREE.Group();
  private rodTip = new THREE.Object3D();
  private bobber: THREE.Mesh;
  private line: THREE.Line;
  private bx = 0;
  private bz = 0;
  private fishing = false;

  constructor(scene: THREE.Scene, public nick: string, color: number, seed?: number) {
    const std = (c: number, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    const rig = buildCharacter(playerLook(color, seed ?? hashStr(nick) ^ color));
    this.body = rig.body;
    this.torso = rig.torso;
    this.legL = rig.legL;
    this.legR = rig.legR;
    this.kneeL = rig.kneeL;
    this.kneeR = rig.kneeR;
    this.armL = rig.armL;
    this.armR = rig.armR;
    this.head = rig.head;
    this.root.add(rig.body);

    // вудка в правій руці (видно лише під час риболовлі)
    const rodMat = std(0x2a2a2a, 0.4);
    const rodMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.024, 2.2, 6), rodMat);
    rodMesh.position.y = 1.1;
    this.rod.add(rodMesh);
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10), std(0x9aa4ac, 0.35));
    reel.rotation.z = Math.PI / 2;
    reel.position.set(0.04, 0.2, 0);
    this.rod.add(reel);
    this.rodTip.position.y = 2.2;
    this.rod.add(this.rodTip);
    this.rod.position.set(0, -0.58, 0.02);
    this.rod.rotation.x = 1.0; // від руки вперед і вгору
    this.rod.visible = false;
    this.armR.add(this.rod);
    // поплавок кольору куртки + біла верхівка (видно, чий)
    this.bobber = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), std(color, 0.4));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), std(0xffffff, 0.4));
    cap.position.y = 0.08;
    this.bobber.add(cap);
    this.bobber.visible = false;
    scene.add(this.bobber);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9 * 3), 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xdde8ee, transparent: true, opacity: 0.6 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);

    // нік
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 256;
    this.labelCanvas.height = 64;
    const tex = new THREE.CanvasTexture(this.labelCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false }));
    this.label.scale.set(0.9, 0.225, 1);
    this.label.position.y = 2.3;
    this.label.renderOrder = 10;
    this.root.add(this.label);
    this.setNick(nick);

    this.root.visible = false;
    scene.add(this.root);
  }

  setNick(nick: string) {
    this.nick = nick;
    const g = this.labelCanvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    g.font = '700 30px -apple-system, "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = Math.min(248, g.measureText(nick).width + 28);
    g.fillStyle = 'rgba(6,18,28,0.62)';
    g.beginPath();
    g.roundRect(128 - w / 2, 10, w, 44, 22);
    g.fill();
    g.fillStyle = '#fff';
    g.fillText(nick, 128, 33);
    (this.label.material.map as THREE.Texture).needsUpdate = true;
  }

  /** нік над головою (свій аватар — без ніка) */
  showLabel(v: boolean) {
    this.label.visible = v;
  }

  hide() {
    this.root.visible = false;
    this.bobber.visible = false;
    this.line.visible = false;
  }

  /** світова позиція (для мап) */
  get worldPos(): THREE.Vector3 {
    return this.root.position;
  }

  update(dt: number, boat: Boat, ocean: Ocean, t: number) {
    const s = this.state;
    if (!s) return;
    this.root.visible = true;
    // зміна режиму (зійшов на причал, впав у воду) — без «польоту» через світ
    const snap = this.smode !== s.m;
    this.smode = s.m;
    const k = snap ? 1 : 1 - Math.exp(-14 * dt);
    this.sx += (s.x - this.sx) * k;
    this.sy += (s.y - this.sy) * k;
    this.sz += (s.z - this.sz) * k;
    let dy = s.yaw - this.syaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.syaw += dy * (snap ? 1 : 1 - Math.exp(-12 * dt));

    if (s.m === 0) {
      boat.localToWorld(this.sx, this.sy, this.sz, this._v);
      this.root.position.copy(this._v);
    } else {
      this.root.position.set(this.sx, this.sy, this.sz);
    }
    // людина тримає вертикаль (крен корпусу гасить ногами); модель дивиться в +Z, камера при yaw=0 — у −Z
    this.root.rotation.set(0, this.syaw + Math.PI, 0);
    // у воді — по груди
    const swim = s.m === 2;
    // анімація: хода / штурвал / плавання / риболовля / спокій
    this.phase += dt * (s.mv ? 7.5 : 1.2);
    this.walkK += ((s.mv ? 1 : 0) - this.walkK) * (1 - Math.exp(-10 * dt));
    const wk = this.walkK;
    const sw = Math.sin(this.phase) * 0.55 * wk;
    const f = s.f;
    this.fishing = !!f && s.m === 0;
    this.rod.visible = this.fishing;
    const idle = !s.mv && !s.wh && !this.fishing && !swim;
    // дихання й перенесення ваги
    const br = Math.sin(t * 1.7 + this.phase * 0.1);
    this.torso.scale.set(1 + br * 0.006, 1 + br * 0.012, 1 + br * 0.01);
    const shift = Math.sin(t * 0.45 + this.syaw) * (1 - wk);
    this.body.position.set(shift * 0.018, (swim ? -1.15 : 0) + Math.abs(Math.cos(this.phase)) * 0.04 * wk, 0);
    this.body.rotation.z = shift * 0.025;
    this.torso.rotation.set(0.06 * wk + (this.fishing ? 0.08 : 0), sw * 0.18, -shift * 0.03);
    this.legL.rotation.set(sw, 0, -shift * 0.025);
    this.legR.rotation.set(-sw, 0, -shift * 0.025);
    this.kneeL.rotation.x = swim ? 0.5 + Math.sin(this.phase * 1.4) * 0.3 : 0.05 + Math.max(0, sw) * 0.75 * wk + (1 - wk) * Math.max(0, shift) * 0.06;
    this.kneeR.rotation.x = swim ? 0.5 - Math.sin(this.phase * 1.4) * 0.3 : 0.05 + Math.max(0, -sw) * 0.75 * wk + (1 - wk) * Math.max(0, -shift) * 0.06;

    // озирається, коли стоїть
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 1.5 + Math.random() * 3.5;
      this.lookTarget = idle ? (Math.random() - 0.5) * 1.3 : 0;
    }
    if (!idle) this.lookTarget = 0;
    this.look += (this.lookTarget - this.look) * (1 - Math.exp(-3 * dt));
    // давно стоїть — помахати рукою
    this.idleT = idle ? this.idleT + dt : 0;
    if (idle && this.waveT < 0 && this.idleT > 9) {
      this.waveT = 0;
      this.idleT = -Math.random() * 10;
    }
    if (!idle) this.waveT = -1;

    if (this.fishing) {
      // тримає вудку перед собою; у боротьбі — тягне на себе
      const pull = f![0] === 3 ? Math.sin(this.phase * 3) * 0.12 + 0.25 : 0;
      this.armR.rotation.set(-0.75 + pull, 0, -0.12);
      this.armL.rotation.set(-0.9 + pull, 0.3, 0.25);
    } else if (s.wh) {
      // руки на колесі, трохи підкермовує
      const steer = Math.sin(t * 0.7) * 0.06;
      this.armL.rotation.set(-0.88 + steer, 0, 0.16);
      this.armR.rotation.set(-0.88 - steer, 0, -0.16);
    } else if (swim) {
      const st = Math.sin(this.phase * 1.4) * 0.9;
      this.armL.rotation.set(-1.6 + st, 0, 0.4);
      this.armR.rotation.set(-1.6 - st, 0, -0.4);
    } else {
      this.armL.rotation.set(-sw * 0.8 - 0.08, 0, -0.12 - br * 0.02 * (1 - wk));
      this.armR.rotation.set(sw * 0.8 - 0.08, 0, 0.12 + br * 0.02 * (1 - wk));
      if (this.waveT >= 0) {
        this.waveT += dt;
        const u = this.waveT / 2.4;
        const up = Math.sin(Math.min(1, u) * Math.PI);
        const e = Math.min(1, up * 1.6);
        this.armR.rotation.set(-0.25 * e, 0, 0.1 + e * 2.55 + Math.sin(this.waveT * 11) * 0.28 * e);
        this.look = this.look * (1 - e) + 0.25 * e;
        if (u >= 1) this.waveT = -1;
      }
    }
    this.head.rotation.set(-s.pitch * 0.6 + (this.fishing ? 0.2 : 0), this.look, -shift * 0.04);
    this.updateBobber(dt, ocean, t);
  }

  private updateBobber(dt: number, ocean: Ocean, t: number) {
    const f = this.state?.f;
    if (!this.fishing || !f) {
      this.bobber.visible = false;
      this.line.visible = false;
      this.bx = this.bz = 0;
      return;
    }
    const [st, x, z, tension] = f;
    // перший кадр закиду — одразу на місце, далі плавно (риба тягне під час боротьби)
    if (!this.bobber.visible) {
      this.bx = x;
      this.bz = z;
    } else {
      const k = 1 - Math.exp(-8 * dt);
      this.bx += (x - this.bx) * k;
      this.bz += (z - this.bz) * k;
    }
    const h = ocean.heightAt(this.bx, this.bz, t);
    const y = st === 2 ? h - 0.12 + Math.sin(t * 22) * 0.07 : st === 3 ? h + 0.05 : h + 0.06 + Math.sin(t * 2.3 + this.phase) * 0.02;
    this.bobber.position.set(this.bx, y, this.bz);
    this.bobber.visible = true;
    // волосінь: кінчик вудки → поплавок, провисає (менше, коли натягнута)
    this.root.updateMatrixWorld(true);
    const tip = this.rodTip.getWorldPosition(this._v);
    const attr = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sag = st === 3 ? 0.6 * (1 - Math.min(1, tension / 90)) + 0.05 : 0.9;
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      attr.setXYZ(
        i,
        tip.x + (this.bx - tip.x) * u,
        tip.y + (y - tip.y) * u - Math.sin(u * Math.PI) * sag,
        tip.z + (this.bz - tip.z) * u,
      );
    }
    attr.needsUpdate = true;
    this.line.visible = true;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.root);
    scene.remove(this.bobber);
    scene.remove(this.line);
    for (const o of [this.bobber, this.line]) {
      (o.geometry as THREE.BufferGeometry).dispose();
      (o.material as THREE.Material).dispose();
    }
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as unknown as { material?: THREE.Material }).material;
      if (mat) {
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      }
    });
  }
}
