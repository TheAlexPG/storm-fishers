import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { RIG, DECK_Y, sheerY } from './yachtLayout';

// ─────────────────────────────────────────────────────────────
// Вітрила: грот на гіку + стаксель на штагу (ролик-рифінг).
// Фізика: вимпельний вітер (справжній − хід човна), поляра тяги за курсовим
// кутом (мертвий кут < 28°), бокова сила → крен і дрейф. Автотрим: гік стає
// під оптимальним кутом на підвітряний борт. Без палива — але в шторм повні
// паруси рвуться: треба брати риф або спускати.
// ─────────────────────────────────────────────────────────────

/** 0 — спущені, 1 — риф (≈60 %), 2 — повні */
export type SailMode = 0 | 1 | 2;
const AREA: Record<SailMode, number> = { 0: 0, 1: 0.6, 2: 1 };
const K_SAIL = 72;          // Н / (м/с)² на одиницю площі
const HEEL_LEVER = 0.55;    // плече бокової сили (м) → момент крену
const OVERPOWER_Q = 150;    // площа·aws² понад це — парус перевантажений
const NO_GO = 28;           // мертвий кут (°)

/** справжній вітер у м/с з погоди 0..1 */
export function trueWindSpeed(wind01: number): number {
  return 1.5 + wind01 * 15;
}

/** поляра тяги за курсовим кутом (градуси, 0 = в ніс) */
function driveCoef(awa: number): number {
  if (awa < NO_GO) return 0;
  if (awa < 50) return ((awa - NO_GO) / (50 - NO_GO)) * 0.85;
  if (awa < 100) return 0.85 + ((awa - 50) / 50) * 0.15;
  if (awa < 150) return 1.0 - ((awa - 100) / 50) * 0.15;
  return 0.85 - ((awa - 150) / 30) * 0.2;
}
function sideCoef(awa: number): number {
  if (awa < NO_GO) return 0.15;
  return clamp(1.15 - (awa - 40) / 110, 0.08, 1);
}

function clothTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(0, 0, 256, 256);
  // горизонтальні полотнища зі швами
  for (let i = 1; i < 8; i++) {
    ctx.fillStyle = 'rgba(120,110,90,0.25)';
    ctx.fillRect(0, i * 32 - 1, 256, 2);
  }
  // легка фактура
  for (let k = 0; k < 1800; k++) {
    ctx.fillStyle = `rgba(140,130,110,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** сітка вітрила NU×NV (u — по хорді, v — по висоті) з UV та індексами */
function sailGrid(nu: number, nv: number): THREE.BufferGeometry {
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) uv.push(i / nu, j / nv);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export interface SailForce {
  fx: number;
  fz: number;
  torqueRoll: number;
}

export class SailRig {
  mode: SailMode = 0;
  /** поточна піднятість 0..1 (анімація лебідки) */
  hoist = 0;
  /** телеметрія для HUD / панелі */
  awa = 0;           // курсовий кут вимпельного вітру, °
  aws = 0;           // вимпельний вітер, м/с
  tws = 0;           // справжній вітер, м/с
  drive = 0;         // тяга, Н
  windFromStarboard = true;
  luffing = false;
  overload = 0;      // 0..1+ — наскільки перевантажено
  /** події: попередження/розрив */
  onEvent: ((msg: string, kind: 'warn' | 'bad' | 'good') => void) | null = null;
  /** кооп-клієнт: режим приходить від капітана — без розривів/попереджень тут */
  passive = false;

  private boomAngle = 0;
  private side = 1; // +1 — гік на +X
  private boomPivot = new THREE.Group();
  private main: THREE.Mesh;
  private jib: THREE.Mesh;
  private furled: THREE.Object3D[] = [];
  private bag: THREE.Mesh;
  private windex = new THREE.Group();
  private warnT = 0;
  private stressT = 0;
  private readonly NU = 10;
  private readonly NV = 14;
  private tack = new THREE.Vector3(0, sheerY(4.6) + 0.1, 4.62);
  private head = new THREE.Vector3();
  private _a = new THREE.Vector3();
  private _b = new THREE.Vector3();
  private _c = new THREE.Vector3();

  constructor(parent: THREE.Group, furledJib: THREE.Object3D[]) {
    const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, map: clothTexture(), roughness: 0.92, side: THREE.DoubleSide });
    const alu = new THREE.MeshStandardMaterial({ color: 0xd7dade, roughness: 0.35, metalness: 0.7 });
    const navy = new THREE.MeshStandardMaterial({ color: 0x24375a, roughness: 0.9 });

    // гік + лейзі-бег на шарнірі біля щогли
    this.boomPivot.position.set(0, RIG.boomY, RIG.mastZ - 0.08);
    parent.add(this.boomPivot);
    const boomLen = RIG.mastZ - 0.08 - RIG.boomZ1;
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, boomLen, 8), alu);
    boom.rotation.x = Math.PI / 2;
    boom.position.z = -boomLen / 2;
    boom.castShadow = true;
    this.boomPivot.add(boom);
    this.bag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, boomLen - 0.35), navy);
    this.bag.position.set(0, 0.2, -boomLen / 2 - 0.1);
    this.bag.castShadow = true;
    this.boomPivot.add(this.bag);
    // гроташкот: блок на кінці гіка
    const sheet = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, RIG.boomY - (DECK_Y + 2.12) - 0.05, 4), navy);
    sheet.position.set(0, -(RIG.boomY - (DECK_Y + 2.12)) / 2, -boomLen + 0.5);
    this.boomPivot.add(sheet);

    this.main = new THREE.Mesh(sailGrid(this.NU, this.NV), cloth);
    this.main.castShadow = true;
    this.main.frustumCulled = false;
    this.boomPivot.add(this.main);

    this.jib = new THREE.Mesh(sailGrid(this.NU, this.NV), cloth);
    this.jib.castShadow = true;
    this.jib.frustumCulled = false;
    parent.add(this.jib);
    this.furled = furledJib;
    this.head.set(0, RIG.top - 0.25, RIG.mastZ + 0.05);
    this.head.lerp(this.tack, 0.14);

    // флюгер (windex) на топі: стрілка дивиться туди, звідки дме вимпельний вітер
    this.windex.position.set(0, RIG.top + 0.05, RIG.mastZ);
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.4).translate(0, 0, -0.12), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 8).rotateX(Math.PI / 2).translate(0, 0, 0.12), new THREE.MeshStandardMaterial({ color: 0xd0342c, roughness: 0.5 }));
    this.windex.add(vane, tip);
    parent.add(this.windex);

    this.updateMeshes(0, 0);
  }

  /** наступний режим: спущені → повні → риф → спущені */
  cycle(): SailMode {
    this.mode = this.mode === 0 ? 2 : this.mode === 2 ? 1 : 0;
    return this.mode;
  }

  label(): string {
    return this.mode === 0 ? 'спущені' : this.mode === 1 ? 'риф' : 'повні';
  }

  /**
   * Сили від вітрил. heading — курс (0 → нос на +Z), vel — швидкість човна (світ).
   * windDir — куди дме вітер (погода: вектор (sin, −cos)), wind01 — сила 0..1.
   */
  compute(dt: number, heading: number, vel: THREE.Vector3, windDir: number, wind01: number): SailForce {
    const target = AREA[this.mode];
    this.hoist = damp(this.hoist, target, 1.2, dt);
    if (Math.abs(this.hoist - target) < 0.002) this.hoist = target;

    this.tws = trueWindSpeed(wind01);
    // вимпельний вітер (куди дме) у світі
    const awx = Math.sin(windDir) * this.tws - vel.x;
    const awz = -Math.cos(windDir) * this.tws - vel.z;
    this.aws = Math.hypot(awx, awz);
    // у локаль човна: +Z — нос; +X — ЛІВИЙ борт (обличчям до носа в +Z праворуч −X)
    const ch = Math.cos(heading), sh = Math.sin(heading);
    const lz = awx * sh + awz * ch;
    const lx = awx * ch - awz * sh;
    // звідки дме: −(lx, lz)
    this.awa = (Math.atan2(Math.abs(lx), -lz) * 180) / Math.PI;
    // дме в +X (на лівий борт) — отже приходить з правого
    this.windFromStarboard = lx > 0;
    this.luffing = this.hoist > 0.05 && this.awa < NO_GO;

    const q = this.hoist * this.aws * this.aws;
    const drive = K_SAIL * q * driveCoef(this.awa);
    const sideF = K_SAIL * q * sideCoef(this.awa) * Math.sign(lx || 1); // на підвітряний борт (локальний x)
    this.drive = drive;

    // автотрим гіка: кут ≈ (awa − 20°)/2 на підвітряний борт
    const want = clamp(((this.awa - 20) / 2) * (Math.PI / 180), 0.08, 1.45);
    const newSide = lx >= 0 ? -1 : 1; // вітер дме в +X → гік іде на +X (θ < 0)
    if (newSide !== this.side && this.hoist > 0.3 && this.awa > 150 && !this.passive) {
      this.onEvent?.('Поворот фордевінд — гік перекинувся!', 'warn');
    }
    this.side = newSide;
    this.boomAngle = damp(this.boomAngle, this.side * want, this.hoist > 0.05 ? 2.2 : 0.6, dt);

    // перевантаження: шторм з повними парусами → розрив
    // (рахуємо й від справжнього вітру: шквали б'ють і на швидкому ходу)
    this.overload = (this.hoist * (0.5 * this.aws * this.aws + 0.5 * this.tws * this.tws)) / OVERPOWER_Q;
    this.warnT -= dt;
    if (this.passive) return { fx: 0, fz: 0, torqueRoll: 0 };
    if (this.overload > 0.85 && this.warnT <= 0 && this.mode !== 0) {
      this.warnT = 12;
      this.onEvent?.(this.mode === 2 ? 'Паруси перевантажені — йди до щогли, бери риф!' : 'Навіть риф не тримає — спускай паруси!', 'warn');
    }
    if (this.overload > 1) {
      this.stressT += dt * (0.15 + (this.overload - 1) * 4);
      if (this.stressT > 4) {
        this.stressT = 0;
        this.mode = 0;
        this.onEvent?.('💥 Шквал порвав парус! Паруси спущено.', 'bad');
      }
    } else {
      this.stressT = Math.max(0, this.stressT - dt * (this.overload < 0.8 ? 0.6 : 0.12));
    }

    // у світ: тяга вздовж курсу + 12 % бокової сили як дрейф (кіль тримає решту)
    const fx = drive * sh + sideF * 0.12 * ch;
    const fz = drive * ch - sideF * 0.12 * sh;
    // крен: бокова сила в +X кладе човен на правий борт (roll < 0)
    const torqueRoll = -sideF * HEEL_LEVER;
    return { fx, fz, torqueRoll };
  }

  /** геометрія: грот (у рамці гіка), стаксель (між штагом і шкотовим кутом) */
  updateMeshes(dt: number, t: number) {
    void dt;
    this.boomPivot.rotation.y = this.boomAngle;
    const h = this.hoist;
    const fill = this.luffing ? 0.15 : clamp(0.25 + this.aws / 30, 0.25, 0.6);
    const flap = this.luffing ? 1 : clamp(0.2 - this.aws / 60, 0, 0.2);
    // вітер наповнює парус з навітряного боку → пузо на підвітряний (−side у рамці гіка)
    const belly = -Math.sign(this.boomAngle || 1);

    // ── грот ──
    {
      this.main.visible = h > 0.02;
      this.bag.scale.y = 1 - h * 0.45;
      const H = (RIG.top - 0.35 - RIG.boomY) * clamp(h / 1, 0, 1);
      const L = RIG.mastZ - 0.08 - RIG.boomZ1 - 0.1;
      const pos = this.main.geometry.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j <= this.NV; j++) {
        const v = j / this.NV;
        const chord = L * (1 - v) * (1 + 0.12 * Math.sin(Math.PI * v)); // ро́ч
        for (let i = 0; i <= this.NU; i++) {
          const u = i / this.NU;
          const k = j * (this.NU + 1) + i;
          const camber = Math.sin(Math.PI * u) * chord * 0.12 * fill * (1 - 0.4 * v);
          const wob = Math.sin(t * 18 + u * 9 + v * 5) * 0.06 * flap * u;
          pos.setXYZ(k, belly * camber + wob, 0.25 + v * H, -u * chord);
        }
      }
      pos.needsUpdate = true;
      this.main.geometry.computeVertexNormals();
      this.main.geometry.computeBoundingSphere();
    }

    // ── стаксель ──
    {
      const unfurl = clamp(h, 0, 1);
      this.jib.visible = unfurl > 0.02;
      for (const f of this.furled) f.scale.set(1 - unfurl * 0.85, 1, 1 - unfurl * 0.85);
      // шкотовий кут: на підвітряному борту, з кутом гіка
      const s = Math.sin(Math.abs(this.boomAngle));
      const clew = this._c.set(-Math.sign(this.boomAngle || 1) * clamp(0.35 + s * 1.1, 0.35, 1.4), DECK_Y + 0.75, 1.25 + s * 0.4);
      const pos = this.jib.geometry.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j <= this.NV; j++) {
        const v = j / this.NV;
        const luff = this._a.copy(this.tack).lerp(this.head, v);
        const leech = this._b.copy(clew).lerp(this.head, v);
        const chord = luff.distanceTo(leech);
        for (let i = 0; i <= this.NU; i++) {
          const u = (i / this.NU) * unfurl;
          const k = j * (this.NU + 1) + i;
          const camber = Math.sin(Math.PI * (i / this.NU)) * chord * 0.11 * fill * unfurl;
          const wob = Math.sin(t * 20 + u * 10 + v * 6) * 0.05 * flap * u;
          pos.setXYZ(
            k,
            luff.x + (leech.x - luff.x) * u + belly * camber + wob,
            luff.y + (leech.y - luff.y) * u,
            luff.z + (leech.z - luff.z) * u,
          );
        }
      }
      pos.needsUpdate = true;
      this.jib.geometry.computeVertexNormals();
      this.jib.geometry.computeBoundingSphere();
    }
  }

  /** флюгер: курс вимпельного вітру в локалі човна */
  updateWindex(heading: number, vel: THREE.Vector3, windDir: number) {
    const awx = Math.sin(windDir) * this.tws - vel.x;
    const awz = -Math.cos(windDir) * this.tws - vel.z;
    const ch = Math.cos(heading), sh = Math.sin(heading);
    const lz = awx * sh + awz * ch;
    const lx = awx * ch - awz * sh;
    // стрілка на джерело вітру: −(lx, lz)
    this.windex.rotation.y = Math.atan2(-lx, -lz);
  }

  reset() {
    this.mode = 0;
    this.hoist = 0;
    this.boomAngle = 0;
    this.stressT = 0;
  }

  /** телеметрія для HUD */
  hudText(): string {
    const side = this.windFromStarboard ? 'ПрБ' : 'ЛБ';
    const state = this.mode === 0 ? 'спущені' : this.luffing ? 'полощуть (мертвий кут)' : this.label();
    return `⛵ ${state} · вітер ${this.tws.toFixed(0)} м/с, ${Math.round(this.awa)}° ${side}`;
  }
}
