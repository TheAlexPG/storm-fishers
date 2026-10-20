import * as THREE from 'three';
import { rockGeo, ROCK_TOP } from './portTerrain';
import { makeGullTexture } from './sky';
import type { RockObstacle } from './boat';
import type { Ocean } from '../core/ocean';
import { ISLANDS } from './islandShape';

// ─────────────────────────────────────────────────────────────
// Пам'ятки в морі — те, заради чого варто відійти від берега:
// затонула шхуна, тюленячі скелі, старий маяк, пташиний стовп,
// кам'яна арка, дзвоновий буй. Підпливи ближче — місце «відкрито»
// (напис, позначка на лоції, лічильник у паузі).
// ─────────────────────────────────────────────────────────────

export interface Landmark {
  id: string;
  name: string;
  /** підпис під назвою, коли відкрили */
  sub: string;
  x: number;
  z: number;
  /** радіус «відкриття», м */
  r: number;
}

export const LANDMARKS: Landmark[] = [
  { id: 'wreck', name: 'Затонула шхуна', sub: 'щогла досі тримається', x: -300, z: 650, r: 55 },
  { id: 'seals', name: 'Тюленячі скелі', sub: 'не буди їх', x: 395, z: 312, r: 50 },
  { id: 'oldlight', name: 'Старий маяк', sub: 'світив до шторму 1953-го', x: -440, z: 500, r: 55 },
  { id: 'stack', name: 'Пташиний стовп', sub: 'тут гніздяться мартини', x: 545, z: 175, r: 60 },
  { id: 'arch', name: 'Кам\'яна арка', sub: 'пропливи крізь неї', x: 150, z: 660, r: 50 },
  { id: 'bell', name: 'Дзвоновий буй', sub: 'слухай його в тумані', x: -650, z: 250, r: 45 },
  // острови (islandShape.ts) — на них можна зійти
  ...ISLANDS.map((d) => ({ id: d.id, name: d.name, sub: d.sub, x: d.x, z: d.z, r: d.r * Math.sqrt(d.elong) + 45 })),
];

export const LANDMARK_BY_ID: Record<string, Landmark> = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));

export class Landmarks {
  readonly group = new THREE.Group();
  private bell = new THREE.Group();
  private bellClapper = new THREE.Object3D();
  private gulls: THREE.Sprite[] = [];
  private seals: THREE.Object3D[] = [];
  private _n = new THREE.Vector3();

  constructor(scene: THREE.Scene, rocks: RockObstacle[]) {
    const flat = (color: number, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.group) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const obstacle = (x: number, z: number, r: number) => rocks.push({ x, z, r, kind: 'mark' });

    // ── затонула шхуна: корпус на боці, залишки палуби, зламана щогла ──
    {
      const L = LANDMARK_BY_ID.wreck;
      const w = new THREE.Group();
      w.position.set(L.x, 0.5, L.z);
      w.rotation.set(-0.12, 0.7, 0.55);
      const wood = flat(0x5b4331);
      const woodDark = flat(0x3e2e22);
      // корпус — нижня півсфера, витягнута в «чашу» човна, відкрита зверху
      const hullGeo = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      const hull = add(hullGeo, new THREE.MeshStandardMaterial({ color: 0x5b4331, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }), 0, 0, 0, w);
      hull.scale.set(2.6, 2.0, 8);
      // планшир і залишки палуби
      const rim = add(new THREE.TorusGeometry(1, 0.06, 4, 16), woodDark, 0, 0, 0, w);
      rim.rotation.x = Math.PI / 2;
      rim.scale.set(2.6, 8, 1);
      for (const z of [-4.5, -2.5, 3]) add(new THREE.BoxGeometry(4.6, 0.12, 0.9), wood, 0, -0.15, z, w);
      add(new THREE.BoxGeometry(2.2, 1.2, 2.4), woodDark, 0, 0.4, -2.2, w);
      const mast = add(new THREE.CylinderGeometry(0.16, 0.22, 11, 6), woodDark, 0.2, 4.6, 1.5, w);
      mast.rotation.set(-0.35, 0, 0.5);
      const yard = add(new THREE.CylinderGeometry(0.08, 0.08, 4.5, 5), woodDark, 2.2, 8, 0.2, w);
      yard.rotation.set(0, 0, 1.2);
      this.group.add(w);
      obstacle(L.x, L.z, 7.5);
    }

    // ── тюленячі скелі: плоска полиця й тюлені, що ліниво повертають голови ──
    {
      const L = LANDMARK_BY_ID.seals;
      const shelf = add(rockGeo(6, 0.32, 17, 3), rockMat, L.x, -0.55, L.z);
      shelf.updateMatrixWorld();
      const ray = new THREE.Raycaster();
      const topAt = (x: number, z: number) => {
        ray.set(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
        return ray.intersectObject(shelf)[0]?.point.y ?? 0.8;
      };
      add(rockGeo(3.2, 0.5, 23, 2), rockMat, L.x + 7, -0.5, L.z - 3);
      const fur = flat(0x6f7378, 0.7);
      const furLight = flat(0x9a9b98, 0.7);
      const spots: Array<[number, number, number]> = [[-1.6, 0.8, 0.3], [1.2, -1.5, 1.9], [2.4, 1.6, -0.7], [-0.4, -0.2, 2.8]];
      spots.forEach(([dx, dz, ry], i) => {
        const seal = new THREE.Group();
        seal.position.set(L.x + dx, topAt(L.x + dx, L.z + dz) + 0.3, L.z + dz);
        seal.rotation.y = ry;
        const body = add(new THREE.CapsuleGeometry(0.42, 1.1, 3, 8), i % 2 ? furLight : fur, 0, 0, 0, seal);
        body.rotation.x = Math.PI / 2;
        body.scale.set(1, 1, 0.8);
        const head = new THREE.Group();
        head.position.set(0, 0.25, 0.85);
        add(new THREE.SphereGeometry(0.3, 8, 6), i % 2 ? furLight : fur, 0, 0.1, 0.1, head);
        add(new THREE.SphereGeometry(0.05, 5, 4), flat(0x111111, 0.3), -0.12, 0.2, 0.36, head);
        add(new THREE.SphereGeometry(0.05, 5, 4), flat(0x111111, 0.3), 0.12, 0.2, 0.36, head);
        seal.add(head);
        head.userData.phase = i * 1.7;
        this.seals.push(head);
        this.group.add(seal);
      });
      obstacle(L.x, L.z, 6);
      obstacle(L.x + 7, L.z - 3, 3.5);
    }

    // ── старий маяк: смугаста вежа без ліхтаря на скелі ──
    {
      const L = LANDMARK_BY_ID.oldlight;
      add(rockGeo(7, 0.55, 31, 3), rockMat, L.x, -1.1, L.z);
      const white = flat(0xe8e2d4, 0.8);
      const red = flat(0xb6493a, 0.8);
      const base = 2.2;
      const segs = 5;
      for (let i = 0; i < segs; i++) {
        const r0 = 1.7 - i * 0.12, r1 = 1.7 - (i + 1) * 0.12;
        add(new THREE.CylinderGeometry(r1, r0, 1.8, 10), i % 2 ? red : white, L.x, base + 0.9 + i * 1.8, L.z);
      }
      // обламаний верх: нерівні зубці
      const top = base + segs * 1.8;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const h = 0.3 + ((k * 37) % 5) * 0.18;
        const b = add(new THREE.BoxGeometry(0.5, h, 0.3), white, L.x + Math.cos(a) * 1.0, top + h / 2, L.z + Math.sin(a) * 1.0);
        b.rotation.y = -a;
      }
      add(new THREE.BoxGeometry(0.5, 0.9, 0.12), flat(0x2a2a2a), L.x, base + 1.2, L.z + 1.62); // двері
      obstacle(L.x, L.z, 7.5);
    }

    // ── пташиний стовп: висока скеля з білою «шапкою» і мартинами ──
    {
      const L = LANDMARK_BY_ID.stack;
      // стовп із трьох «барабанів» різної товщини — не гладкий конус
      add(rockGeo(6, 1.1, 41, 3), rockMat, L.x, -2.2, L.z);
      add(rockGeo(4.4, 1.6, 42, 3), rockMat, L.x + 0.6, 3.2, L.z - 0.4);
      add(rockGeo(3.6, 1.5, 44, 3, new THREE.Color(0xeeeae0)), rockMat, L.x - 0.3, 9.6, L.z + 0.3);
      add(rockGeo(2.4, 2.2, 43, 2), rockMat, L.x + 7, -1.2, L.z + 3);
      const tex = makeGullTexture();
      for (let i = 0; i < 7; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }));
        s.scale.setScalar(1.6 + Math.random() * 0.8);
        s.userData = { r: 7 + Math.random() * 9, h: 12 + Math.random() * 10, a: Math.random() * 6.28, sp: (0.25 + Math.random() * 0.3) * (i % 2 ? 1 : -1) };
        this.gulls.push(s);
        this.group.add(s);
      }
      obstacle(L.x, L.z, 5.5);
      obstacle(L.x + 5, L.z + 2, 3);
    }

    // ── кам'яна арка: дві опори й склепіння (можна пропливти під нею) ──
    {
      const L = LANDMARK_BY_ID.arch;
      const arch = new THREE.Group();
      arch.position.set(L.x, 0, L.z);
      arch.rotation.y = 0.5;
      const pillarL = add(rockGeo(3.2, 2.6, 51, 2), rockMat, -8, -1.5, 0, arch);
      const pillarR = add(rockGeo(3.4, 2.4, 53, 2), rockMat, 8, -1.5, 0, arch);
      void pillarL;
      void pillarR;
      // склепіння: тор, «погризений» шумом, щоб виглядав як камінь
      const tg = new THREE.TorusGeometry(8, 2.4, 6, 16, Math.PI);
      const tp = tg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < tp.count; i++) {
        const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
        const n = Math.sin(x * 1.3 + z * 2.1) * Math.cos(y * 1.7 - x * 0.6) * 0.75 + Math.sin(i * 12.9898) * 0.25;
        tp.setXYZ(i, x * (1 + n * 0.05), y + n * 0.6, z * (1 + n * 0.25));
      }
      tg.computeVertexNormals();
      const span = add(tg, flat(ROCK_TOP.getHex(), 0.95), 0, 2.5, 0, arch);
      span.scale.set(1, 1.1, 0.9);
      this.group.add(arch);
      // опори в світових координатах
      for (const sx of [-8, 8]) {
        const wx = L.x + Math.cos(0.5) * sx, wz = L.z - Math.sin(0.5) * sx;
        obstacle(wx, wz, 3.6);
      }
    }

    // ── дзвоновий буй: червона решітчаста вежа на поплавку, дзвін хитається на хвилі ──
    {
      const L = LANDMARK_BY_ID.bell;
      this.bell.position.set(L.x, 0, L.z);
      const red = flat(0xc23b2f, 0.6);
      add(new THREE.CylinderGeometry(1.5, 1.7, 1.0, 12), red, 0, 0.1, 0, this.bell);
      add(new THREE.CylinderGeometry(1.75, 1.75, 0.18, 12), flat(0xe8e2d4), 0, 0.55, 0, this.bell);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        const leg = add(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 5), red, Math.cos(a) * 0.75, 2.2, Math.sin(a) * 0.75, this.bell);
        leg.rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2);
      }
      add(new THREE.CylinderGeometry(0.85, 0.85, 0.12, 10), red, 0, 3.8, 0, this.bell);
      const brass = new THREE.MeshStandardMaterial({ color: 0xc89b45, roughness: 0.35, metalness: 0.8 });
      add(new THREE.CylinderGeometry(0.28, 0.5, 0.7, 12, 1, true), brass, 0, 2.7, 0, this.bell);
      this.bellClapper.position.set(0, 2.6, 0);
      add(new THREE.SphereGeometry(0.12, 8, 6), flat(0x2a2a2a), 0, -0.35, 0, this.bellClapper);
      this.bell.add(this.bellClapper);
      add(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffaa30, emissiveIntensity: 0.6 }), 0, 4.1, 0, this.bell);
      this.group.add(this.bell);
      obstacle(L.x, L.z, 2.2);
    }

    scene.add(this.group);
  }

  /** кожен кадр: буй на хвилі, мартини, тюлені. Повертає силу удару дзвона (0 — тихо) */
  update(dt: number, t: number, ocean: Ocean): number {
    const L = LANDMARK_BY_ID.bell;
    const h = ocean.heightAt(L.x, L.z, t);
    ocean.normalAt(L.x, L.z, t, this._n);
    this.bell.position.y = h - 0.15;
    this.bell.rotation.set(this._n.z * 0.9, 0, -this._n.x * 0.9);
    // язик дзвона відстає — б'є, коли буй різко хитнувся
    const sway = Math.sin(t * 0.9) * 0.08 + (this._n.x + this._n.z) * 2.2;
    const prev = this.bellClapper.rotation.z;
    this.bellClapper.rotation.z += (sway - prev) * (1 - Math.exp(-3 * dt));
    const ring = Math.abs(this.bellClapper.rotation.z - prev) / Math.max(dt, 1e-3);

    const S = LANDMARK_BY_ID.stack;
    for (const g of this.gulls) {
      const u = g.userData as { r: number; h: number; a: number; sp: number };
      u.a += u.sp * dt;
      g.position.set(S.x + Math.cos(u.a) * u.r, u.h + Math.sin(u.a * 2.1) * 1.2, S.z + Math.sin(u.a) * u.r);
    }
    for (const head of this.seals) {
      const ph = head.userData.phase as number;
      head.rotation.y = Math.sin(t * 0.3 + ph) * 0.6;
      head.rotation.x = Math.max(0, Math.sin(t * 0.17 + ph * 2)) * -0.5;
    }
    return ring;
  }
}
