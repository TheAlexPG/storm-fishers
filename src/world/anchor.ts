import * as THREE from 'three';
import { WS } from '../core/region';
import { terrainHeight } from './portTerrain';
import { ISLANDS } from './islandShape';
import { sheerY } from './yachtLayout';
import type { AudioEngine } from '../core/audio';

// ─────────────────────────────────────────────────────────────
// Якір із ланцюгом і брашпилем на баку. E біля брашпиля — віддати / вибрати.
// Якір падає з носового ролика, ланцюг травиться до «скоупу» ~4× глибини,
// далі яхта стоїть на ланцюгу: пружний ланцюговий провис тягне ніс до якоря,
// тож яхта сама стає носом до вітру й ходить по колу. Утримання обмежене:
// у шторм або з повним газом якір повзе по дну («дрейфує»).
// Глибина: біля берегів/островів — з рельєфу, у морі дно глибшає з
// відстанню від порту — далі ~45 м якір не дістає.
// ─────────────────────────────────────────────────────────────

/** найбільша глибина, де можна стати на якір, м */
export const ANCHOR_MAX_DEPTH = 45;
/** довжина ланцюга, м */
export const CHAIN_MAX = 90;
/** точка ролика на носі (локаль яхти) */
const BOW_LOCAL = new THREE.Vector3(0, sheerY(4.86) + 0.02, 4.9);
/** утримання якоря (Н) при доброму скоупі — трохи більше за повний газ базового двигуна */
const HOLD = 12000;
/** тяга брашпиля, коли вибираєш ланцюг (Н) */
const WINDLASS_PULL = 5000;
const DROP_RATE = 4.0; // м/с — якір летить у воду
const PAY_RATE = 2.6; // м/с — ланцюг травиться до скоупу
const HAUL_RATE = 1.5; // м/с — брашпиль вибирає
const SEGS = 150;

/** глибина дна (м, додатна) у світовій точці */
export function seabedDepth(x: number, z: number): number {
  const th = terrainHeight(x, z);
  // рельєф порту тримає смугу −4.5 м перед набережною аж до краю мапи — це не мілина
  const strip = Math.abs(x) <= 60 && z > -40;
  if (th > -6.9 && !strip) return Math.max(0, -th);
  // відкрите море глибшає від порту; біля островів — мілина
  const r = Math.hypot(x, z);
  const t = Math.min(1, Math.max(0, (r - 120 * WS) / (580 * WS)));
  let deep = 7 + t * t * (3 - 2 * t) * 75;
  for (const isl of ISLANDS) {
    const d = Math.hypot(x - isl.x, z - isl.z);
    const k = Math.min(1, Math.max(0, (isl.r * 4 - d) / (isl.r * 2.8)));
    if (k > 0) deep = deep + (7 - deep) * k * k * (3 - 2 * k);
  }
  return strip ? Math.max(4.5, deep) : deep;
}

/** мінімальний інтерфейс яхти, потрібний якорю */
interface BoatLike {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  group: THREE.Group;
  localToWorld(lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3;
}

export type AnchorResult = 'drop' | 'raise' | 'deep' | 'shallow' | 'busy';

export class Anchor {
  /** 0 — на ролику, 1 — висить на ланцюгу (падає / вибираємо), 2 — лежить на дні */
  state: 0 | 1 | 2 = 0;
  /** точка якоря на дні (світ) */
  ax = 0;
  az = 0;
  /** глибина під якорем */
  depth = 0;
  /** витравлено ланцюга, м */
  chain = 0;
  /** куди травити (скоуп) */
  target = 0;
  /** брашпиль: +1 травить, −1 вибирає, 0 стоїть */
  winch: -1 | 0 | 1 = 0;
  /** якір повзе по дну (0..1 — наскільки) */
  drag = 0;
  /** натяг ланцюга, Н (для HUD / звуку) */
  tension = 0;
  /** кооп-картинка: фізики немає, лише візуал за станом власника */
  remote = false;

  private anchorMesh: THREE.Group;
  private links: THREE.InstancedMesh;
  private _b = new THREE.Vector3();
  private _a = new THREE.Vector3();
  private _p = new THREE.Vector3();
  private _q = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _quat = new THREE.Quaternion();
  private _s = new THREE.Vector3();
  private _up = new THREE.Vector3(0, 1, 0);
  private _dir = new THREE.Vector3();
  private clankAcc = 0;
  private stowLocal = new THREE.Matrix4();
  /** куди «дивиться» якір на дні (рад) */
  private yaw = 0;
  /** точки кривої ланцюга */
  private pts: THREE.Vector3[] = [];

  constructor(private scene: THREE.Scene) {
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.35, metalness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x8a9299, roughness: 0.45, metalness: 0.75 });
    // плуговий (Delta) якір: веретено, лапа-лемех, рим
    const g = new THREE.Group();
    const shank = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.62), steel);
    shank.position.set(0, 0.06, 0.12);
    shank.rotation.x = -0.18;
    g.add(shank);
    const plow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 4, 1), steel);
    plow.rotation.set(-Math.PI / 2, Math.PI / 4, 0);
    plow.scale.set(1.25, 1, 0.42);
    plow.position.set(0, 0, -0.2);
    g.add(plow);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 6, 12), dark);
    ring.position.set(0, 0.12, 0.44);
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
    for (const m of [shank, plow, ring]) m.castShadow = true;
    this.anchorMesh = g;
    scene.add(g);
    // стоїть у ролику: лемех звисає перед форштевнем, веретено — на баку
    this.stowLocal.compose(new THREE.Vector3(0, BOW_LOCAL.y - 0.06, BOW_LOCAL.z - 0.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, Math.PI, 0)), new THREE.Vector3(1, 1, 1));

    // ланка: плаский овал (тор), сусідні повернуті на 90° — читається як ланцюг
    const link = new THREE.TorusGeometry(0.075, 0.022, 4, 8);
    link.scale(1, 1.4, 1);
    this.links = new THREE.InstancedMesh(link, dark, SEGS);
    this.links.frustumCulled = false;
    this.links.count = 0;
    this.links.visible = false;
    scene.add(this.links);
    for (let i = 0; i <= SEGS; i++) this.pts.push(new THREE.Vector3());
  }

  get down() {
    return this.state !== 0;
  }

  /** E біля брашпиля: віддати / вибрати (результат — для підказки) */
  toggle(boat: BoatLike): AnchorResult {
    if (this.state === 0 || this.winch < 0) {
      const b = boat.localToWorld(BOW_LOCAL.x, BOW_LOCAL.y, BOW_LOCAL.z, this._b);
      const d = seabedDepth(b.x, b.z);
      if (this.state === 0) {
        if (d > ANCHOR_MAX_DEPTH) return 'deep';
        if (d < 1.2) return 'shallow';
        this.state = 1;
        this.chain = 0.3;
        this.depth = d;
      }
      this.target = Math.min(CHAIN_MAX, Math.max(this.depth * 4, this.depth + 10));
      this.winch = 1;
      return 'drop';
    }
    this.winch = -1;
    return 'raise';
  }

  /** точно виставити (сейв): якір лежить у точці з витравленим ланцюгом */
  setDown(x: number, z: number, chain: number) {
    this.state = 2;
    this.ax = x;
    this.az = z;
    this.depth = seabedDepth(x, z);
    this.chain = Math.min(CHAIN_MAX, Math.max(chain, this.depth + 2));
    this.target = this.chain;
    this.winch = 0;
    this.drag = 0;
  }

  reset() {
    this.state = 0;
    this.chain = 0;
    this.winch = 0;
    this.drag = 0;
    this.tension = 0;
  }

  /** горизонтальна досяжність натягнутого ланцюга */
  get reach(): number {
    return Math.sqrt(Math.max(0, this.chain * this.chain - this.depth * this.depth));
  }

  /**
   * Сила ланцюга на ніс (Н) — у out.x/out.z; повертає плече (rx, rz) від центру
   * яхти до ролика, або null, якщо ланцюг не тягне.
   */
  force(dt: number, boat: BoatLike, wind: number, windDir: number, out: { fx: number; fz: number; rx: number; rz: number; wx: number; wz: number }): boolean {
    this.tension = 0;
    if (this.state !== 2 || this.remote) return false;
    // парусність корпусу й щогли: на якорі вітер відносить яхту й ставить носом до вітру
    const wdx = Math.sin(windDir), wdz = -Math.cos(windDir);
    const windage = 2200 * wind * wind;
    out.wx = wdx * windage;
    out.wz = wdz * windage;
    // шторм: хвилі смикають ланцюг — якір виривається й повзе за вітром
    const storm = Math.max(0, wind - 0.58);
    if (storm > 0) {
      const v = Math.min(0.5, storm * 1.2);
      this.ax += wdx * v * dt;
      this.az += wdz * v * dt;
      this.depth = seabedDepth(this.ax, this.az);
      this.drag = Math.min(1, this.drag + dt * 0.8);
    }
    const b = boat.localToWorld(BOW_LOCAL.x, BOW_LOCAL.y, BOW_LOCAL.z, this._b);
    const dx = b.x - this.ax, dz = b.z - this.az;
    const d = Math.hypot(dx, dz) || 1e-3;
    const L = this.reach;
    // провис: ланцюг лежить на дні й піднімається плавно — пружний «буфер»
    const L0 = L * 0.78;
    const ext = d - L0;
    const scope = this.chain / Math.max(1, this.depth);
    const hold = HOLD * Math.min(1, Math.max(0.35, (scope - 1) / 3));
    const cap = this.winch < 0 ? Math.min(hold, WINDLASS_PULL) : hold;
    if (ext <= 0) {
      if (!storm) this.drag = Math.max(0, this.drag - dt * 0.5);
      out.fx = out.fz = out.rx = out.rz = 0;
      return true;
    }
    const ux = dx / d, uz = dz / d;
    const k = hold / Math.max(1.5, L * 0.22);
    const vr = boat.vel.x * ux + boat.vel.z * uz;
    // статичний натяг (провис) обмежений утриманням якоря; ривок (швидкість
    // від якоря) гасить ланцюг-амортизатор — ще до ~0.8 утримання зверху
    const Ts = k * ext;
    const Td = Math.max(-cap * 0.5, Math.min(cap * 0.8, 5200 * vr));
    let T = Math.min(Ts, cap) + Td;
    if (T <= 0) {
      out.fx = out.fz = out.rx = out.rz = 0;
      return true;
    }
    if (Ts > cap) {
      // перевантаження: якір повзе по дну за яхтою
      if (this.winch >= 0) {
        const v = Math.min(1.2, 0.4 * (Ts / cap - 1));
        this.ax += ux * v * dt;
        this.az += uz * v * dt;
        this.drag = Math.min(1, this.drag + dt * (v > 0.06 ? 1.2 : -0.4));
        this.depth = seabedDepth(this.ax, this.az);
      }
      // ланцюг не розтягується: яхта, що тягне сильніше за утримання, волочить якір
      const over = d - L * 1.02;
      if (over > 0 && this.winch >= 0) {
        this.ax += ux * over;
        this.az += uz * over;
        this.drag = 1;
      }
    } else if (!storm) {
      this.drag = Math.max(0, this.drag - dt * 0.5);
    }
    // дно пішло з-під якоря (сповз у глибину) — ланцюг висить
    if (this.depth > this.chain - 0.5) {
      this.state = 1;
      return false;
    }
    this.tension = T;
    out.fx = -ux * T;
    out.fz = -uz * T;
    out.rx = b.x - boat.pos.x;
    out.rz = b.z - boat.pos.z;
    return true;
  }

  /** брашпиль, падіння/підйом і картинка ланцюга; звук — лише якщо audio */
  update(dt: number, boat: BoatLike, audio: AudioEngine | null) {
    const b = boat.localToWorld(BOW_LOCAL.x, BOW_LOCAL.y, BOW_LOCAL.z, this._b);
    if (!this.remote) this.simulate(dt, b, audio);
    else if (audio && this.winch !== 0 && this.state !== 0) this.clank(dt, audio, this.winch > 0 ? PAY_RATE : HAUL_RATE);
    this.draw(boat, b);
  }

  private simulate(dt: number, b: THREE.Vector3, audio: AudioEngine | null) {
    if (this.state === 0) return;
    const prev = this.chain;
    if (this.state === 1) {
      // висить під ролком
      const here = seabedDepth(b.x, b.z);
      if (this.winch > 0) {
        this.chain += DROP_RATE * dt;
        if (b.y - this.chain <= -here) {
          // ліг на дно
          this.state = 2;
          this.ax = b.x;
          this.az = b.z;
          this.depth = here;
          this.chain = b.y + here;
          this.target = Math.min(CHAIN_MAX, Math.max(this.depth * 4, this.depth + 10));
          audio?.thump(0.5);
        } else if (this.chain >= CHAIN_MAX) {
          this.chain = CHAIN_MAX;
          this.winch = 0;
        }
      } else if (this.winch < 0) {
        this.chain -= HAUL_RATE * dt;
        if (this.chain <= 0.3) {
          this.reset();
          audio?.thump(0.7);
          return;
        }
      }
    } else {
      if (this.winch > 0) {
        this.chain = Math.min(this.target, this.chain + PAY_RATE * dt);
        if (this.chain >= this.target) this.winch = 0;
      } else if (this.winch < 0) {
        // вибираємо: ланцюг коротшає не швидше, ніж яхта підходить до якоря
        const straight = Math.hypot(b.x - this.ax, b.y + this.depth, b.z - this.az);
        this.chain = Math.max(this.chain - HAUL_RATE * dt, Math.min(this.chain, straight * 0.98));
        if (this.chain <= this.depth + b.y + 0.6 || straight < this.depth + b.y + 1.2) {
          // якір вирвано з ґрунту — висить
          this.state = 1;
          this.chain = Math.max(0.5, b.y + this.depth - 0.2);
          audio?.thump(0.4);
        }
      }
    }
    if (audio && Math.abs(this.chain - prev) > 1e-4) this.clank(dt, audio, Math.abs(this.chain - prev) / dt);
  }

  private clank(dt: number, audio: AudioEngine, rate: number) {
    this.clankAcc += rate * dt;
    if (this.clankAcc > 0.3) {
      this.clankAcc = 0;
      audio.chain(Math.min(1, rate / 3));
    }
  }

  /** ланцюг і якір у світі */
  private draw(boat: BoatLike, b: THREE.Vector3) {
    const am = this.anchorMesh;
    if (this.state === 0) {
      boat.group.updateMatrixWorld();
      this._m.multiplyMatrices(boat.group.matrixWorld, this.stowLocal);
      this._m.decompose(am.position, am.quaternion, am.scale);
      this.links.visible = false;
      return;
    }
    const pts = this.pts;
    let n: number;
    if (this.state === 1) {
      // прямо вниз з ролика
      const a = this._a.set(b.x, b.y - this.chain, b.z);
      n = Math.max(2, Math.min(SEGS, Math.ceil(this.chain / 0.2)));
      for (let i = 0; i <= n; i++) pts[i].lerpVectors(b, a, i / n);
      am.position.copy(a);
      am.position.y -= 0.12;
      this.yaw += 0.6 * (1 / 60);
      am.rotation.set(-Math.PI / 2 + 0.2, this.yaw, 0, 'YXZ');
    } else {
      const sea = -this.depth;
      const a = this._a.set(this.ax, sea, this.az);
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      const ux = dx / d, uz = dz / d;
      // скільки ланцюга лежить на дні: надлишок над прямою від ролика
      const straight = Math.hypot(d, b.y - sea);
      const lying = Math.min(d * 0.92, Math.max(0, this.chain - straight) * 1.15);
      const td = this._p.set(a.x + ux * lying, sea, a.z + uz * lying);
      // висяча частина — квадратична Безьє з горизонтальним дотиком до дна
      const ctrl = this._q.set(td.x + (b.x - td.x) * 0.55, sea + (b.y - sea) * 0.05, td.z + (b.z - td.z) * 0.55);
      const hang = Math.hypot(b.x - td.x, b.y - sea, b.z - td.z);
      const total = hang + lying;
      n = Math.max(4, Math.min(SEGS, Math.ceil(total / 0.22)));
      const nh = Math.max(2, Math.round((n * hang) / Math.max(0.01, total)));
      for (let i = 0; i <= nh; i++) {
        const t = i / nh, it = 1 - t;
        pts[i].set(
          it * it * b.x + 2 * it * t * ctrl.x + t * t * td.x,
          it * it * b.y + 2 * it * t * ctrl.y + t * t * td.y,
          it * it * b.z + 2 * it * t * ctrl.z + t * t * td.z,
        );
      }
      const nl = n - nh;
      for (let i = 1; i <= nl; i++) pts[nh + i].lerpVectors(td, a, i / nl);
      this.yaw = Math.atan2(-ux, -uz);
      am.position.set(a.x, sea + 0.06, a.z);
      am.rotation.set(0.12, this.yaw + Math.PI, 0, 'YXZ');
    }
    // ланки вздовж кривої
    for (let i = 0; i < n; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      this._dir.subVectors(p1, p0);
      const len = this._dir.length();
      if (len < 1e-4) this._dir.set(0, -1, 0);
      else this._dir.multiplyScalar(1 / len);
      this._quat.setFromUnitVectors(this._up, this._dir);
      // кожна друга ланка — повернута на 90° навколо своєї осі
      if (i & 1) this._quat.multiply(Q90);
      this._s.set(1, Math.max(0.6, len / 0.2), 1);
      this._m.compose(this._p.addVectors(p0, p1).multiplyScalar(0.5), this._quat, this._s);
      this.links.setMatrixAt(i, this._m);
    }
    this.links.count = n;
    this.links.instanceMatrix.needsUpdate = true;
    this.links.visible = true;
  }

  dispose() {
    this.scene.remove(this.anchorMesh, this.links);
    this.links.dispose();
  }

  // ── кооп ──
  netState(): number[] {
    const r = (v: number) => Math.round(v * 100) / 100;
    return [this.state, r(this.ax), r(this.az), r(this.chain), r(this.depth), this.winch, r(this.drag)];
  }

  applyNet(a: number[], o: number) {
    if (a.length < o + 7) return;
    this.state = a[o] as 0 | 1 | 2;
    this.ax = a[o + 1];
    this.az = a[o + 2];
    this.chain = a[o + 3];
    this.depth = a[o + 4];
    this.winch = Math.sign(a[o + 5]) as -1 | 0 | 1;
    this.drag = a[o + 6];
  }
}

const Q90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
