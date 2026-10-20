import * as THREE from 'three';
import { rockGeo } from './portTerrain';
import { terrainHeight } from './portTerrain';
import { makeGullTexture } from './sky';
import type { RockObstacle } from './boat';
import type { Ocean } from '../core/ocean';
import { LANDMARK_BY_ID } from './landmarks';
import { HOTSPOTS } from '../game/fish';
import { mulberry32 } from '../core/math';

// ─────────────────────────────────────────────────────────────
// Далекі місця біля континентів і посеред Великого океану — декор у морі:
// затонула галера з амфорами, маяк на гранітному зубі, траулер із рубкою над
// водою, метеобуй, риф зі щоглами, водоспад у фіорді, тюленяча бухта,
// птахи над тунцем. Кожне місце — окрема група, яку далеко не малюємо.
// ─────────────────────────────────────────────────────────────

interface Spot {
  x: number;
  z: number;
  g: THREE.Group;
}

const HOT = (id: string) => HOTSPOTS.find((h) => h.id === id)!;

export class FarPlaces {
  readonly group = new THREE.Group();
  private spots: Spot[] = [];
  private buoy = new THREE.Group();
  private buoyLamp!: THREE.MeshStandardMaterial;
  private buoyCups = new THREE.Group();
  private lightLamp!: THREE.MeshStandardMaterial;
  private beam = new THREE.Group();
  private gulls: Array<{ s: THREE.Sprite; cx: number; cz: number; r: number; h: number; a: number; sp: number }> = [];
  private seals: THREE.Object3D[] = [];
  private fallTex: THREE.CanvasTexture | null = null;
  /** вершина водоспаду (для кадрів і налагодження) */
  fallAt: { x: number; y: number; z: number } | null = null;
  private splashes: Array<{ m: THREE.Mesh; x: number; z: number; t: number }> = [];
  private _n = new THREE.Vector3();

  constructor(scene: THREE.Scene, rocks: RockObstacle[]) {
    const rng = mulberry32(4242);
    const flat = (color: number, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const spot = (x: number, z: number): THREE.Group => {
      const g = new THREE.Group();
      this.group.add(g);
      this.spots.push({ x, z, g });
      return g;
    };
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const obstacle = (x: number, z: number, r: number) => rocks.push({ x, z, r, kind: 'mark' });
    const gullTex = makeGullTexture();
    const flock = (parent: THREE.Object3D, cx: number, cz: number, n: number, r0: number, r1: number, h0: number, h1: number) => {
      for (let i = 0; i < n; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gullTex, transparent: true, opacity: 0.85, depthWrite: false }));
        s.scale.setScalar(1.5 + rng() * 0.8);
        parent.add(s);
        this.gulls.push({ s, cx, cz, r: r0 + rng() * (r1 - r0), h: h0 + rng() * (h1 - h0), a: rng() * 6.28, sp: (0.22 + rng() * 0.3) * (i % 2 ? 1 : -1) });
      }
    };

    // ── затонула галера: корпус на мілині, весла віялом, щогла, амфори на піску ──
    {
      const L = LANDMARK_BY_ID['med-galley'];
      const g = spot(L.x, L.z);
      const w = new THREE.Group();
      w.position.set(L.x, -1.0, L.z);
      w.rotation.set(-0.16, 1.1, -0.32);
      const hull = add(w, new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }), 0, 0, 0);
      hull.scale.set(2.8, 2.4, 11);
      const rim = add(w, new THREE.TorusGeometry(1, 0.08, 4, 18), flat(0x4a3220), 0, 0, 0);
      rim.rotation.x = Math.PI / 2;
      rim.scale.set(2.8, 11, 1);
      // таран на носі й корма-«хвіст»
      add(w, new THREE.ConeGeometry(0.45, 2.6, 6), flat(0x8a6a3a, 0.4, 0.6), 0, -0.6, 12).rotation.x = Math.PI / 2;
      const tail = add(w, new THREE.TorusGeometry(1.6, 0.25, 5, 10, Math.PI * 0.7), flat(0x4a3220), 0, 0.6, -10.5);
      tail.rotation.y = Math.PI / 2;
      for (let k = -4; k <= 4; k++) {
        for (const s of [-1, 1]) {
          const o = add(w, new THREE.CylinderGeometry(0.07, 0.07, 5, 5), flat(0x7a5a3a), s * 3.4, 0.3, k * 2.1);
          o.rotation.set(0, 0, s * (1.15 + Math.sin(k * 2.1) * 0.15));
        }
      }
      const mast = add(w, new THREE.CylinderGeometry(0.2, 0.26, 10, 6), flat(0x4a3220), 0, 4.5, 1.5);
      mast.rotation.set(0.5, 0, 0.25);
      g.add(w);
      // амфори на піску біля корпусу (видно крізь мілку воду)
      const clay = flat(0xb5643a, 0.9);
      for (let i = 0; i < 9; i++) {
        const a = rng() * Math.PI * 2, r = 6 + rng() * 9;
        const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
        const am = add(g, new THREE.LatheGeometry([new THREE.Vector2(0.02, -0.4), new THREE.Vector2(0.18, -0.28), new THREE.Vector2(0.28, 0), new THREE.Vector2(0.22, 0.25), new THREE.Vector2(0.09, 0.42), new THREE.Vector2(0.08, 0.65)], 10), clay, x, Math.max(-6, terrainHeight(x, z)) + 0.25, z);
        am.rotation.set(Math.PI / 2 - 0.3 + rng() * 0.6, rng() * 6, 0);
      }
      obstacle(L.x, L.z, 9);
    }

    // ── маяк Гранітного Зуба: скеля-зуб, біла вежа з червоним верхом, світло вночі ──
    {
      const L = LANDMARK_BY_ID['north-light'];
      const g = spot(L.x, L.z);
      add(g, rockGeo(9, 0.5, 71, 3), rockMat, L.x, -2.0, L.z);
      add(g, rockGeo(5.5, 1.4, 72, 3), rockMat, L.x + 1.2, 1.5, L.z - 0.8);
      add(g, rockGeo(3, 1.0, 73, 2), rockMat, L.x + 9, -1.4, L.z + 4);
      const y0 = 6.2;
      const white = flat(0xf2f1ec, 0.6), red = flat(0xc23a2c, 0.6);
      add(g, new THREE.CylinderGeometry(1.35, 1.7, 9, 14), white, L.x, y0 + 4.5, L.z);
      add(g, new THREE.CylinderGeometry(1.4, 1.4, 1.6, 14), red, L.x, y0 + 9.8, L.z);
      add(g, new THREE.CylinderGeometry(1.7, 1.7, 0.2, 14), flat(0x24292d, 0.5), L.x, y0 + 10.7, L.z);
      this.lightLamp = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe39a, emissiveIntensity: 1.2, roughness: 0.1 });
      add(g, new THREE.CylinderGeometry(0.9, 0.9, 1.3, 10), this.lightLamp, L.x, y0 + 11.45, L.z);
      add(g, new THREE.ConeGeometry(1.25, 1.4, 10), red, L.x, y0 + 12.8, L.z);
      // промінь — два тонкі напівпрозорі конуси, що повільно обертаються
      this.beam.position.set(L.x, y0 + 11.45, L.z);
      const bm = new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      for (const s of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(3.2, 60, 10, 1, true), bm);
        c.rotation.z = (s * Math.PI) / 2;
        c.position.x = s * 30;
        this.beam.add(c);
      }
      g.add(this.beam);
      // хатинка наглядача
      add(g, new THREE.BoxGeometry(3.4, 2.4, 2.8), flat(0xe8e2d2, 0.85), L.x + 3.4, y0 - 0.4, L.z + 1.8);
      add(g, new THREE.BoxGeometry(3.7, 0.2, 3.1), red, L.x + 3.4, y0 + 0.9, L.z + 1.8);
      obstacle(L.x, L.z, 9.5);
      obstacle(L.x + 9, L.z + 4, 3.5);
    }

    // ── затонулий траулер: корпус під кутом, рубка й щогла над водою ──
    {
      const L = LANDMARK_BY_ID['north-trawler'];
      const g = spot(L.x, L.z);
      const t = new THREE.Group();
      t.position.set(L.x, -1.8, L.z);
      t.rotation.set(0.12, -0.6, 0.38);
      const rust = flat(0x7a4a2a, 0.7), hullC = flat(0x2f4a5a, 0.7), white = flat(0xd9d4c8, 0.75);
      add(t, new THREE.BoxGeometry(5, 3.4, 16), hullC, 0, -0.6, 0);
      add(t, new THREE.ConeGeometry(2.5, 4, 4), hullC, 0, -0.6, 9.8).rotation.set(Math.PI / 2, Math.PI / 4, 0);
      add(t, new THREE.BoxGeometry(5.05, 0.4, 16.1), rust, 0, 1.0, 0);
      add(t, new THREE.BoxGeometry(3.4, 2.6, 3.6), white, 0, 2.5, -2.5);
      add(t, new THREE.BoxGeometry(3.5, 0.6, 3.7), rust, 0, 3.9, -2.5);
      for (const sx of [-1.71, 1.71]) add(t, new THREE.BoxGeometry(0.06, 0.8, 2.6), flat(0x1c2a33, 0.2), sx, 2.9, -2.5);
      add(t, new THREE.CylinderGeometry(0.14, 0.18, 7, 6), rust, 0, 5.2, 2.5);
      const boom = add(t, new THREE.CylinderGeometry(0.1, 0.1, 6, 5), rust, 1.6, 4.6, 4.4);
      boom.rotation.set(0.9, 0, -0.5);
      add(t, new THREE.TorusGeometry(1.2, 0.15, 5, 12), flat(0xb8362c, 0.7), 2.5, 1.6, 5.5).rotation.y = 1.2;
      g.add(t);
      obstacle(L.x, L.z, 9);
    }

    // ── метеобуй «Дельта»: жовтий поплавок, щогла, анемометр, сонячна панель, мигалка ──
    {
      const L = LANDMARK_BY_ID['ocean-buoy'];
      const g = spot(L.x, L.z);
      this.buoy.position.set(L.x, 0, L.z);
      const yellow = flat(0xf2c12e, 0.5), dark = flat(0x2a2f33, 0.5);
      add(this.buoy, new THREE.CylinderGeometry(2.4, 2.0, 1.4, 14), yellow, 0, 0, 0);
      add(this.buoy, new THREE.CylinderGeometry(2.45, 2.45, 0.2, 14), dark, 0, 0.75, 0);
      add(this.buoy, new THREE.CylinderGeometry(0.5, 0.7, 2.2, 8), yellow, 0, 1.9, 0);
      add(this.buoy, new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6), dark, 0, 4.4, 0);
      const panel = add(this.buoy, new THREE.BoxGeometry(1.2, 0.06, 0.8), new THREE.MeshStandardMaterial({ color: 0x1c2f52, roughness: 0.25, metalness: 0.4 }), 0.6, 3.4, 0);
      panel.rotation.z = -0.5;
      add(this.buoy, new THREE.BoxGeometry(0.35, 1.2, 0.35), flat(0xf4efe4, 0.6), 0, 3.6, 0);
      this.buoyCups.position.set(0, 6.05, 0);
      add(this.buoyCups, new THREE.CylinderGeometry(0.03, 0.03, 0.2, 5), dark, 0, 0, 0);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const arm = add(this.buoyCups, new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), dark, Math.cos(a) * 0.25, 0.08, Math.sin(a) * 0.25);
        arm.rotation.set(0, -a, Math.PI / 2);
        add(this.buoyCups, new THREE.SphereGeometry(0.08, 6, 4, 0, Math.PI), flat(0xf4efe4, 0.5), Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5).rotation.y = -a;
      }
      this.buoy.add(this.buoyCups);
      this.buoyLamp = new THREE.MeshStandardMaterial({ color: 0xffe9a0, emissive: 0xffc23a, emissiveIntensity: 0.2 });
      add(this.buoy, new THREE.SphereGeometry(0.18, 8, 6), this.buoyLamp, 0, 5.75, 0);
      add(this.buoy, new THREE.BoxGeometry(1.4, 0.5, 0.06), flat(0x2a2f33, 0.6), 0, 1.9, 0.72);
      g.add(this.buoy);
      obstacle(L.x, L.z, 2.8);
    }

    // ── риф Розбитих Щогл: пасмо скель і похилені щогли старих кораблів ──
    {
      const L = LANDMARK_BY_ID['ocean-reef'];
      const g = spot(L.x, L.z);
      for (let i = 0; i < 7; i++) {
        const a = -0.4 + i * 0.13, r = -18 + i * 6;
        const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r * 0.6 + (rng() - 0.5) * 6;
        const s = 2 + rng() * 2.6;
        add(g, rockGeo(s, 0.5 + rng() * 0.4, 90 + i, 2), rockMat, x, -1.2 + rng() * 0.6, z);
        obstacle(x, z, s * 0.9);
      }
      const wood = flat(0x4a3a2c);
      for (const [dx, dz, h, rx, rz] of [[-8, 2, 9, 0.35, 0.2], [3, -3, 12, -0.25, 0.4], [11, 4, 7, 0.5, -0.3]] as const) {
        const m = add(g, new THREE.CylinderGeometry(0.16, 0.24, h, 6), wood, L.x + dx, h / 2 - 1.5, L.z + dz);
        m.rotation.set(rx, 0, rz);
        const yard = add(g, new THREE.CylinderGeometry(0.07, 0.07, h * 0.4, 5), wood, L.x + dx + rz * h * 0.4, h * 0.75 - 1.5, L.z + dz - rx * h * 0.4);
        yard.rotation.set(0, 0.7, Math.PI / 2 - rz);
      }
      // уламок корпусу на скелі
      const hull = add(g, new THREE.SphereGeometry(1, 10, 5, 0, Math.PI, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5b4331, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }), L.x - 2, 0.2, L.z + 3);
      hull.scale.set(2.2, 1.6, 6);
      hull.rotation.set(0.3, 0.9, 0.6);
    }

    // ── водоспад у фіорді: гранітна круча на березі, вода падає з неї просто у фіорд ──
    {
      const H = HOT('hot-fjord');
      // найближчий берег від центру рибного місця (вода → суша)
      let shore: { x: number; z: number; ux: number; uz: number; d: number } | null = null;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const ux = Math.cos(a), uz = Math.sin(a);
        for (let r = 6; r < 160; r += 2) {
          const x = H.x + ux * r, z = H.z + uz * r;
          if (terrainHeight(x, z) > 0.4) {
            if (!shore || r < shore.d) shore = { x, z, ux, uz, d: r };
            break;
          }
        }
      }
      if (shore) {
        const g = spot(shore.x, shore.z);
        // круча — трохи вглиб суші; лице дивиться на воду (−u)
        const cx = shore.x + shore.ux * 7, cz = shore.z + shore.uz * 7;
        const cliff = add(g, rockGeo(10, 2.3, 131, 2), rockMat, cx, -3, cz);
        cliff.scale.set(1.1, 1, 0.8);
        cliff.rotation.y = Math.atan2(shore.ux, shore.uz);
        add(g, rockGeo(6, 1.6, 132, 2), rockMat, cx + shore.uz * 9, -2.5, cz - shore.ux * 9);
        add(g, rockGeo(5, 1.5, 133, 2), rockMat, cx - shore.uz * 9, -2.5, cz + shore.ux * 9);
        obstacle(cx, cz, 10);
        const top = 17;
        const c = document.createElement('canvas');
        c.width = 32;
        c.height = 128;
        const cg = c.getContext('2d')!;
        cg.fillStyle = 'rgba(214,236,244,0.7)';
        cg.fillRect(0, 0, 32, 128);
        for (let i = 0; i < 30; i++) {
          cg.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.55})`;
          cg.fillRect(Math.random() * 30, Math.random() * 128, 1 + Math.random() * 3, 10 + Math.random() * 30);
        }
        this.fallTex = new THREE.CanvasTexture(c);
        this.fallTex.wrapS = this.fallTex.wrapT = THREE.RepeatWrapping;
        this.fallTex.repeat.set(1.5, 2.2);
        this.fallTex.colorSpace = THREE.SRGBColorSpace;
        // струмінь: від гребеня кручі до води, трохи відхилений від лиця
        const fx = cx - shore.ux * 7.6, fz = cz - shore.uz * 7.6;
        const fall = new THREE.Mesh(new THREE.PlaneGeometry(4.5, top + 0.5, 1, 6), new THREE.MeshBasicMaterial({ map: this.fallTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        const fp = fall.geometry.attributes.position as THREE.BufferAttribute;
        // нижня частина відходить від скелі (дуга струменя)
        for (let i = 0; i < fp.count; i++) {
          const t = 0.5 - fp.getY(i) / (top + 0.5);
          fp.setZ(i, t * t * 2.2);
        }
        fall.geometry.computeVertexNormals();
        fall.position.set(fx, top / 2, fz);
        fall.rotation.y = Math.atan2(-shore.ux, -shore.uz);
        g.add(fall);
        const foam = new THREE.Mesh(new THREE.CircleGeometry(6, 16), new THREE.MeshBasicMaterial({ color: 0xf4f8f8, transparent: true, opacity: 0.6, depthWrite: false }));
        foam.rotation.x = -Math.PI / 2;
        foam.position.set(fx - shore.ux * 2.6, 0.15, fz - shore.uz * 2.6);
        g.add(foam);
        this.fallAt = { x: fx, y: top, z: fz };
      }
    }

    // ── тюленяча бухта: плоскі скелі з тюленями ──
    {
      const H = HOT('hot-seals');
      const g = spot(H.x, H.z);
      const fur = flat(0x6f7378, 0.7), furL = flat(0x9a9b98, 0.7), eye = flat(0x111111, 0.3);
      for (const [dx, dz, rr] of [[0, 0, 6], [14, -8, 4.5], [-12, 9, 4]] as const) {
        const x = H.x + dx, z = H.z + dz;
        const shelf = add(g, rockGeo(rr, 0.3, 120 + dx, 3), rockMat, x, -0.6, z);
        void shelf;
        obstacle(x, z, rr);
        const n = Math.round(rr / 1.8);
        for (let i = 0; i < n; i++) {
          const a = rng() * 6.28, r = rng() * rr * 0.55;
          const seal = new THREE.Group();
          seal.position.set(x + Math.cos(a) * r, 0.55 + rr * 0.1, z + Math.sin(a) * r);
          seal.rotation.y = rng() * 6;
          const body = add(seal, new THREE.CapsuleGeometry(0.42, 1.1, 3, 8), i % 2 ? furL : fur, 0, 0, 0);
          body.rotation.x = Math.PI / 2;
          body.scale.set(1, 1, 0.8);
          const head = new THREE.Group();
          head.position.set(0, 0.25, 0.85);
          add(head, new THREE.SphereGeometry(0.3, 8, 6), i % 2 ? furL : fur, 0, 0.1, 0.1);
          add(head, new THREE.SphereGeometry(0.05, 5, 4), eye, -0.12, 0.2, 0.36);
          add(head, new THREE.SphereGeometry(0.05, 5, 4), eye, 0.12, 0.2, 0.36);
          head.userData.phase = rng() * 6;
          seal.add(head);
          this.seals.push(head);
          g.add(seal);
        }
      }
    }

    // ── пташиний котел: зграя над водою й сплески тунця ──
    {
      const H = HOT('hot-birds');
      const g = spot(H.x, H.z);
      flock(g, H.x, H.z, 14, 6, 34, 5, 16);
      const sm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 8, 1, true), sm.clone());
        g.add(m);
        this.splashes.push({ m, x: H.x, z: H.z, t: rng() * 3 });
      }
    }

    // ── трохи птахів над галерою й рифом ──
    {
      const G = LANDMARK_BY_ID['med-galley'];
      flock(this.spots[0].g, G.x, G.z, 4, 8, 16, 7, 12);
      const R = LANDMARK_BY_ID['ocean-reef'];
      const rs = this.spots.find((s) => s.x === R.x && s.z === R.z);
      if (rs) flock(rs.g, R.x, R.z, 5, 8, 20, 8, 14);
    }

    scene.add(this.group);
  }

  /** кожен кадр: далекі місця ховаємо, буй хитається, птахи кружляють, маяк світить */
  update(dt: number, t: number, ocean: Ocean, cam: THREE.Vector3, night: number) {
    for (const s of this.spots) {
      const vis = Math.hypot(cam.x - s.x, cam.z - s.z) < 1900;
      if (s.g.visible !== vis) s.g.visible = vis;
    }
    if (this.buoy.parent?.visible) {
      const bx = this.buoy.position.x, bz = this.buoy.position.z;
      this.buoy.position.y = ocean.heightAt(bx, bz, t) - 0.2;
      ocean.normalAt(bx, bz, t, this._n);
      this.buoy.rotation.set(this._n.z * 0.8, 0, -this._n.x * 0.8);
      this.buoyCups.rotation.y -= dt * 5;
      this.buoyLamp.emissiveIntensity = (t % 4) < 0.35 ? 2.2 : 0.15;
    }
    this.lightLamp.emissiveIntensity = 0.6 + night * 1.6;
    this.beam.visible = night > 0.35 && !!this.beam.parent?.visible;
    this.beam.rotation.y = t * 0.6;
    for (const gl of this.gulls) {
      if (!gl.s.parent?.visible) continue;
      gl.a += gl.sp * dt;
      gl.s.position.set(gl.cx + Math.cos(gl.a) * gl.r, gl.h + Math.sin(gl.a * 2.1) * 1.2, gl.cz + Math.sin(gl.a) * gl.r);
    }
    for (const head of this.seals) {
      const ph = head.userData.phase as number;
      head.rotation.y = Math.sin(t * 0.3 + ph) * 0.6;
      head.rotation.x = Math.max(0, Math.sin(t * 0.17 + ph * 2)) * -0.5;
    }
    if (this.fallTex) this.fallTex.offset.y = (t * 0.9) % 1;
    for (const sp of this.splashes) {
      sp.t -= dt;
      if (sp.t <= 0) {
        sp.t = 1.2 + Math.random() * 2.5;
        const a = Math.random() * 6.28, r = Math.random() * 40;
        sp.m.userData.x = sp.x + Math.cos(a) * r;
        sp.m.userData.z = sp.z + Math.sin(a) * r;
        sp.m.userData.age = 0;
      }
      const age = (sp.m.userData.age ?? 9) as number;
      sp.m.userData.age = age + dt;
      const k = Math.min(1, age / 0.7);
      const mat = sp.m.material as THREE.MeshBasicMaterial;
      mat.opacity = age < 0.7 ? 0.75 * (1 - k) : 0;
      if (age < 0.7) {
        const x = sp.m.userData.x as number, z = sp.m.userData.z as number;
        sp.m.position.set(x, ocean.heightAt(x, z, t) + k * 1.2, z);
        sp.m.scale.set(0.6 + k * 0.8, 0.5 + k, 0.6 + k * 0.8);
      }
    }
  }
}
