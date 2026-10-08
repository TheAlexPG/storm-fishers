import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import type { RockObstacle } from './boat';

// ─────────────────────────────────────────────────────────────
// Порт: причал, земля, будинки, маяк, скелі та острови.
// ─────────────────────────────────────────────────────────────

export interface Platform {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
}

export interface PortPoint {
  id: 'shop' | 'fuel' | 'repair' | 'house';
  x: number;
  z: number;
  label: string;
}

export const PORT_POINTS: PortPoint[] = [
  { id: 'shop', x: -10, z: -44.5, label: 'Магазин' },
  { id: 'fuel', x: 8.5, z: -43, label: 'Заправка' },
  { id: 'repair', x: 14, z: -49.5, label: 'Ремонт' },
  { id: 'house', x: -2, z: -58.5, label: 'Хата (сон)' },
];

export class Port {
  group = new THREE.Group();
  platforms: Platform[] = [
    { x0: -24, z0: -40, x1: 24, z1: -18, y: 1.1 }, // причал
    { x0: -60, z0: -130, x1: 60, z1: -40, y: 1.6 }, // земля
  ];
  rocks: RockObstacle[] = [];
  private lighthouseLight!: THREE.SpotLight;
  private lampLights: THREE.PointLight[] = [];
  private beaconPhase = 0;

  constructor(private scene: THREE.Scene) {
    this.build();
    this.scene.add(this.group);
  }

  private mat(color: number, rough = 0.9, metal = 0.05): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true });
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, rough = 0.9, metal = 0.05): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(color, rough, metal));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private build() {
    const WOOD = 0x8a6d48;
    const WOOD_D = 0x6d5438;
    const WHITE = 0xdfe8ec;
    const BLUE = 0x3a6ea5;

    // земля
    this.box(120, 4, 90, 0, -0.4, -85, 0x5a7a4a, 0.98);
    // пляж
    this.box(120, 2.5, 6, 0, 0.2, -43, 0xd8c49a, 0.98);
    // причал
    this.box(48, 0.5, 22, 0, 0.85, -29, WOOD, 0.95);
    // дошки причалу
    for (let i = 0; i < 10; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 22), this.mat(0x5f4a30, 0.98));
      p.position.set(-22 + i * 4.8, 1.11, -29);
      this.group.add(p);
    }
    // сваї
    for (let i = 0; i < 7; i++) {
      for (const s of [-1, 1]) {
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3.2, 8), this.mat(WOOD_D, 0.95));
        pil.position.set(-21 + i * 7, -0.4, s < 0 ? -39.5 : -18.5);
        this.group.add(pil);
      }
    }
    // тумбери
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8), this.mat(0x333, 0.5, 0.6));
      b.position.set(-16 + i * 8, 1.45, -19.2);
      b.castShadow = true;
      this.group.add(b);
    }

    // ── магазин (синьо-білий) ──
    const shop = this.box(9, 4.2, 7, -10, 3.7, -52, WHITE);
    shop.receiveShadow = true;
    this.box(9.6, 0.7, 7.6, -10, 6.0, -52, BLUE);
    // дах
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 2.2, 4), this.mat(0x7a4a3a, 0.85));
    roof.position.set(-10, 7.3, -52);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    this.group.add(roof);
    // вітрина
    this.box(5.5, 2.2, 0.15, -10, 3.4, -48.4, 0x9fc4d8, 0.25, 0.3);
    // двері
    this.box(1.1, 2.2, 0.12, -5.6, 3.4, -48.4, 0x6d5438);
    // табличка
    this.sign('МАГАЗИН', -10, 5.2, -48.35, 4.6);

    // ── заправка ──
    this.box(5, 2.8, 4, 6, 3.0, -48, 0xc44, 0.8);
    this.box(5.4, 0.5, 4.4, 6, 4.55, -48, 0x8a2020);
    const pump = this.box(0.9, 1.5, 0.7, 8.5, 1.9, -44, 0xd0d0d0, 0.4, 0.4);
    pump.castShadow = true;
    this.sign('ГАЗ', 8.5, 3.1, -44, 2.2);

    // ── ремонт ──
    this.box(6.5, 3.6, 6, 14, 3.4, -54, 0x8a8f96, 0.85, 0.2);
    this.box(7, 0.5, 6.5, 14, 5.35, -54, 0x5a5f66);
    this.box(2.4, 2.4, 0.12, 14, 3.1, -50.95, 0x2c2f33);
    this.sign('РЕМОНТ', 14, 4.6, -50.9, 4.2);

    // ── хата ──
    this.box(5, 3.2, 5, -2, 3.2, -62, 0xb59a72, 0.9);
    const hroof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 2, 4), this.mat(0x6d4a3a, 0.85));
    hroof.position.set(-2, 5.8, -62);
    hroof.rotation.y = Math.PI / 4;
    hroof.castShadow = true;
    this.group.add(hroof);
    this.box(1, 2, 0.12, -2, 3.0, -59.45, 0x6d5438);
    this.box(1.1, 1.1, 0.12, 0.6, 3.6, -59.45, 0x9fc4d8, 0.3, 0.3);
    this.sign('ХАТА', -2, 4.6, -59.42, 2.6);

    // ── маяк ──
    const lh = new THREE.Group();
    lh.position.set(-32, 1.6, -52);
    this.group.add(lh);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 11, 10), this.mat(0xe8e4d8, 0.85));
    tower.position.y = 5.5;
    tower.castShadow = true;
    lh.add(tower);
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.75 - i * 0.18, 1.8 - i * 0.18, 1.2, 10), this.mat(0xc0392b, 0.8));
      band.position.y = 2.5 + i * 3.4;
      lh.add(band);
    }
    const lampHouse = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 1.6, 8), this.mat(0x333, 0.5, 0.5));
    lampHouse.position.y = 11.8;
    lh.add(lampHouse);
    const lampTop = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.0, 8), this.mat(0xc0392b, 0.8));
    lampTop.position.y = 13.1;
    lh.add(lampTop);
    const beaconBulb = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffe9a0, emissive: 0xffe9a0, emissiveIntensity: 0.4 }));
    beaconBulb.position.y = 11.8;
    lh.add(beaconBulb);
    this.lighthouseLight = new THREE.SpotLight(0xffe9a0, 0, 250, 0.28, 0.4, 1.1);
    this.lighthouseLight.position.y = 11.8;
    lh.add(this.lighthouseLight);
    const beaconTgt = new THREE.Object3D();
    beaconTgt.position.set(0, 0, 60);
    lh.add(beaconTgt);
    this.lighthouseLight.target = beaconTgt;

    // ліхтарі на причалі
    for (const lx of [-18, 0, 18]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 6), this.mat(0x3a3a3a));
      pole.position.set(lx, 2.4, -19.5);
      this.group.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd980, emissiveIntensity: 0 }));
      bulb.position.set(lx, 3.75, -19.5);
      this.group.add(bulb);
      const pl = new THREE.PointLight(0xffd980, 0, 18, 1.6);
      pl.position.set(lx, 3.7, -19.5);
      this.group.add(pl);
      this.lampLights.push(pl);
    }

    // ящики і бочки на причалі (декор)
    this.box(0.9, 0.9, 0.9, 17, 1.55, -22, 0x8a6d48);
    this.box(0.8, 0.8, 0.8, 17.8, 1.5, -22.9, 0x7a5f3f);
    for (let i = 0; i < 3; i++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 10), this.mat(0x7a4a2a, 0.85));
      barrel.position.set(-19 + i * 0.85, 1.5, -24);
      barrel.castShadow = true;
      this.group.add(barrel);
    }

    // ── скелі (мелюшки) у середній зоні ──
    const rng = mulberry32(4242);
    const rockSpots: Array<[number, number, number]> = [
      [140, 180, 3.2], [-170, 240, 4.0], [260, -80, 2.6], [-90, 420, 3.4],
      [380, 300, 4.5], [-320, 150, 2.8], [120, 620, 3.8], [-420, 480, 4.2],
      [520, 150, 3.0], [300, 560, 3.6],
    ];
    for (const [rx, rz, r] of rockSpots) {
      const rock = new THREE.Mesh(new THREE.ConeGeometry(r, r * 1.5, 7), this.mat(0x6a7076, 0.95));
      rock.position.set(rx, r * 0.45, rz);
      rock.rotation.y = rng() * Math.PI;
      rock.castShadow = true;
      this.group.add(rock);
      // каміння біля основи
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.DodecahedronGeometry(r * (0.25 + rng() * 0.2)), this.mat(0x5f656b, 0.95));
        c.position.set(rx + (rng() - 0.5) * r * 2.4, 0.2, rz + (rng() - 0.5) * r * 2.4);
        c.castShadow = true;
        this.group.add(c);
      }
      this.rocks.push({ x: rx, z: rz, r: r * 1.15 });
    }

    // ── далекі острови (горизонт) ──
    const islands: Array<[number, number, number, number]> = [
      [1400, 900, 160, 60],
      [-1600, 500, 220, 80],
      [600, -1800, 180, 70],
      [-900, -1500, 140, 50],
    ];
    for (const [ix, iz, ir, ih] of islands) {
      const isl = new THREE.Mesh(new THREE.ConeGeometry(ir, ih, 9), this.mat(0x4a6a4a, 0.98));
      isl.position.set(ix, ih * 0.18, iz);
      isl.rotation.y = rng() * Math.PI;
      this.group.add(isl);
      const islTop = new THREE.Mesh(new THREE.ConeGeometry(ir * 0.5, ih * 0.5, 8), this.mat(0x5a7a5a, 0.98));
      islTop.position.set(ix + 30, ih * 0.42, iz + 20);
      this.group.add(islTop);
    }
  }

  /** текст-табличка */
  private sign(text: string, x: number, y: number, z: number, w: number) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(30, 36, 44, 0.92)';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#eaf6f8';
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * 0.25),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
    );
    m.position.set(x, y, z);
    this.group.add(m);
  }

  /** нічні вогні */
  setNight(night: number) {
    for (const pl of this.lampLights) pl.intensity = night * 2.2;
    this.lighthouseLight.intensity = night * 40;
  }

  /** прожектор маяка обертається */
  update(dt: number, t: number) {
    this.beaconPhase += dt * 0.7;
    this.lighthouseLight.target.position.set(Math.cos(this.beaconPhase) * 60, 0, Math.sin(this.beaconPhase) * 60);
    void t;
  }
}
