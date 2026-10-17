import * as THREE from 'three';
import type { Boat } from './boat';

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

  update(dt: number, boat: Boat) {
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
    if (s.wh) {
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
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.root);
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
