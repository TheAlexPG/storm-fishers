import * as THREE from 'three';
import type { Boat } from './boat';
import type { Ocean } from '../core/ocean';

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
  private body = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private head = new THREE.Group();
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

  constructor(scene: THREE.Scene, public nick: string, color: number) {
    const std = (c: number, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    const skin = std(0xe0b48f, 0.7);
    const jacket = std(color, 0.55);
    const pants = std(0x2b3340);
    const boots = std(0x2a2522, 0.6);
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    this.root.add(this.body);
    for (const [leg, sx] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(sx * 0.11, 0.9, 0);
      this.body.add(leg);
      add(leg, new THREE.CapsuleGeometry(0.075, 0.62, 3, 8), pants, 0, -0.42, 0);
      add(leg, new THREE.BoxGeometry(0.13, 0.1, 0.26), boots, 0, -0.85, 0.04);
    }
    const torso = new THREE.Group();
    torso.position.y = 0.9;
    this.body.add(torso);
    add(torso, new THREE.CapsuleGeometry(0.2, 0.4, 4, 10), jacket, 0, 0.32, 0).scale.set(1, 1, 0.78);
    // світловідбивна смуга на куртці
    add(torso, new THREE.CylinderGeometry(0.205, 0.205, 0.05, 14, 1, true), std(0xe8e8e0, 0.3), 0, 0.12, 0).scale.set(1, 1, 0.78);
    for (const [arm, sx] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(sx * 0.26, 0.66, 0);
      torso.add(arm);
      add(arm, new THREE.CapsuleGeometry(0.062, 0.5, 3, 8), jacket, 0, -0.3, 0);
      add(arm, new THREE.SphereGeometry(0.06, 8, 6), skin, 0, -0.62, 0);
    }
    this.head.position.y = 0.86;
    torso.add(this.head);
    add(this.head, new THREE.SphereGeometry(0.13, 12, 10), skin, 0, 0.1, 0);
    add(this.head, new THREE.SphereGeometry(0.018, 6, 4), std(0x1a1a1a, 0.4), -0.045, 0.13, 0.12);
    add(this.head, new THREE.SphereGeometry(0.018, 6, 4), std(0x1a1a1a, 0.4), 0.045, 0.13, 0.12);
    // зюйдвестка кольору куртки
    add(this.head, new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(color, 0.5), 0, 0.14, 0);
    add(this.head, new THREE.CylinderGeometry(0.24, 0.26, 0.02, 14), std(color, 0.5), 0, 0.14, -0.03);

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
    this.rod.position.set(0, -0.6, 0);
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
    this.label.position.y = 2.15;
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
    this.body.position.y = s.m === 2 ? -1.15 : 0;

    // анімація: хода / штурвал / плавання
    this.phase += dt * (s.mv ? 7.5 : 1.2);
    const sw = s.mv ? Math.sin(this.phase) * 0.55 : 0;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    const f = s.f;
    this.fishing = !!f && s.m === 0;
    this.rod.visible = this.fishing;
    if (this.fishing) {
      // тримає вудку перед собою; у боротьбі — тягне на себе
      const pull = f![0] === 3 ? Math.sin(this.phase * 3) * 0.12 + 0.25 : 0;
      this.armR.rotation.set(-0.75 + pull, 0, -0.12);
      this.armL.rotation.set(-0.9 + pull, 0.3, 0.25);
    } else if (s.wh) {
      // руки на колесі
      this.armL.rotation.set(-1.15, 0, 0.18);
      this.armR.rotation.set(-1.15, 0, -0.18);
    } else if (s.m === 2) {
      const st = Math.sin(this.phase * 1.4) * 0.9;
      this.armL.rotation.set(-1.6 + st, 0, 0.4);
      this.armR.rotation.set(-1.6 - st, 0, -0.4);
    } else {
      this.armL.rotation.set(-sw * 0.7, 0, -0.08);
      this.armR.rotation.set(sw * 0.7, 0, 0.08);
    }
    this.head.rotation.x = -s.pitch * 0.6;
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
