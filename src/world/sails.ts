import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { RIG, DECK_Y, HOUSE, sheerY } from './yachtLayout';

/** погон гіка-шкота на даху рубки (yachtModel.buildCockpit) */
const SHEET_Z = 0.6;
import { sailPerf, type SailPerf } from '../game/upgrades';
import { SPRIT } from './upgradeParts';

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
  return 1.5 + wind01 * 19;
}

/** поляра тяги за курсовим кутом (градуси, 0 = в ніс); noGo — мертвий кут (апгрейд парусів) */
function driveCoef(awa: number, noGo = NO_GO): number {
  if (awa < noGo) return 0;
  if (awa < 50) return ((awa - noGo) / (50 - noGo)) * 0.85;
  if (awa < 100) return 0.85 + ((awa - 50) / 50) * 0.15;
  if (awa < 150) return 1.0 - ((awa - 100) / 50) * 0.15;
  return 0.85 - ((awa - 150) / 30) * 0.2;
}
function sideCoef(awa: number, noGo = NO_GO): number {
  if (awa < noGo) return 0.15;
  return clamp(1.15 - (awa - 40) / 110, 0.08, 1);
}

/**
 * Тканина за рівнем апгрейду парусів:
 *  0 — старий кремовий дакрон; 1–2 — новий білий дакрон із синьою смугою по задній
 *  шкаторині; 3–4 — ламінат (срібно-золотий, волокна по лініях навантаження);
 *  5 — чорний карбон із червоною смугою.
 */
type ClothStyle = 'old' | 'dacron' | 'laminate' | 'carbon' | 'genn';
function clothTexture(style: ClothStyle = 'old'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const base = { old: '#f4f1e8', dacron: '#fdfdfb', laminate: '#c9bd94', carbon: '#1d1f22', genn: '#2f5fb3' }[style];
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  if (style === 'genn') {
    // синьо-жовтий генакер: верх синій, низ жовтий (низ полотна — нижня половина канви)
    ctx.fillStyle = '#f2c12e';
    ctx.fillRect(0, 128, 256, 128);
  }
  if (style === 'laminate' || style === 'carbon') {
    // волокна віялом від кутів (лінії навантаження)
    ctx.strokeStyle = style === 'carbon' ? 'rgba(160,165,175,0.35)' : 'rgba(70,60,40,0.35)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 22; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(256, i * 14);
      ctx.moveTo(256, 256);
      ctx.lineTo(i * 14, 0);
      ctx.stroke();
    }
  }
  // полотнища зі швами
  for (let i = 1; i < 8; i++) {
    ctx.fillStyle = style === 'carbon' ? 'rgba(255,255,255,0.12)' : 'rgba(120,110,90,0.25)';
    ctx.fillRect(0, i * 32 - 1, 256, 2);
  }
  // смуга вздовж задньої шкаторини (u = 1 — правий край текстури)
  if (style === 'dacron') {
    ctx.fillStyle = '#24375a';
    ctx.fillRect(240, 0, 16, 256);
  } else if (style === 'carbon') {
    ctx.fillStyle = '#d0342c';
    ctx.fillRect(244, 0, 12, 256);
  }
  for (let k = 0; k < 1800; k++) {
    ctx.fillStyle = style === 'carbon' ? `rgba(255,255,255,${Math.random() * 0.04})` : `rgba(140,130,110,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function styleFor(l: number): ClothStyle {
  return l >= 5 ? 'carbon' : l >= 3 ? 'laminate' : l >= 1 ? 'dacron' : 'old';
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

  /** рівень апгрейду «Паруси» 0..5 */
  level = 0;
  private perf: SailPerf = sailPerf(0);
  private cloth!: THREE.MeshStandardMaterial;
  private boomMat!: THREE.MeshStandardMaterial;
  private styleShown: ClothStyle | null = null;
  /** генакер: 0..1 — наскільки розкритий (сам — на повних курсах) */
  gennaker = 0;
  private genn!: THREE.Mesh;
  private gennRoll!: THREE.Mesh;
  private gennTack = new THREE.Vector3(0, sheerY(4.6) + 0.12, SPRIT.z1 - 0.04);
  private gennHead = new THREE.Vector3(0, RIG.top - 0.7, RIG.mastZ + 0.08);

  private boomAngle = 0;
  /** кутова швидкість гіка (пружина шкота + інерція) */
  private boomVel = 0;
  /** рух корпусу для гойдання гіка: крен, швидкість крену й рискання */
  private hullRoll = 0;
  private hullRollRate = 0;
  private hullYawRate = 0;
  private gustT = Math.random() * 100;
  private side = 1; // +1 — гік на +X
  private boomPivot = new THREE.Group();
  private main: THREE.Mesh;
  private jib: THREE.Mesh;
  private furled: THREE.Object3D[] = [];
  private bag: THREE.Mesh;
  private windex = new THREE.Group();
  private warnT = 0;
  private gybeT = 0;
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
    this.cloth = cloth;
    const alu = new THREE.MeshStandardMaterial({ color: 0xd7dade, roughness: 0.35, metalness: 0.7 });
    this.boomMat = alu;
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
    // лейзі-бег: м'який заокруглений профіль замість гострого бруска
    const bagShape = new THREE.Shape();
    {
      const hw = 0.17, hh = 0.18, r = 0.11;
      bagShape.moveTo(-hw + 0.04, -hh);
      bagShape.lineTo(hw - 0.04, -hh);
      bagShape.quadraticCurveTo(hw, -hh, hw, -hh + 0.04);
      bagShape.lineTo(hw, hh - r);
      bagShape.quadraticCurveTo(hw, hh, hw - r, hh);
      bagShape.lineTo(-hw + r, hh);
      bagShape.quadraticCurveTo(-hw, hh, -hw, hh - r);
      bagShape.lineTo(-hw, -hh + 0.04);
      bagShape.quadraticCurveTo(-hw, -hh, -hw + 0.04, -hh);
    }
    const bagLen = boomLen - 0.35;
    const bagGeo = new THREE.ExtrudeGeometry(bagShape, { depth: bagLen - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.012, bevelSegments: 3, curveSegments: 6 });
    bagGeo.translate(0, 0, -(bagLen - 0.06) / 2);
    this.bag = new THREE.Mesh(bagGeo, navy);
    this.bag.position.set(0, 0.2, -boomLen / 2 - 0.1);
    this.bag.castShadow = true;
    this.boomPivot.add(this.bag);
    // гроташкот: із середини гіка на погон на даху рубки (перед козирком; кокпіт вільний)
    const sheetLen = RIG.boomY - (HOUSE.top + 0.1);
    for (const dx of [-0.025, 0.025]) {
      const sheet = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, sheetLen, 4), navy);
      sheet.position.set(dx, -sheetLen / 2, SHEET_Z - (RIG.mastZ - 0.08));
      this.boomPivot.add(sheet);
    }
    const blk = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), navy);
    blk.scale.set(0.8, 1.2, 0.8);
    blk.position.set(0, -0.08, SHEET_Z - (RIG.mastZ - 0.08));
    this.boomPivot.add(blk);

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

    // генакер (з рівня 4): вільний парус від бушприта до топу, видно на повних курсах
    this.genn = new THREE.Mesh(sailGrid(this.NU, this.NV), new THREE.MeshStandardMaterial({ color: 0xffffff, map: clothTexture('genn'), roughness: 0.85, side: THREE.DoubleSide }));
    this.genn.castShadow = true;
    this.genn.frustumCulled = false;
    this.genn.visible = false;
    parent.add(this.genn);
    // згорнутий генакер — «ковбаса» від бушприта до топу
    {
      const a = this.gennTack, b = this.gennHead;
      const len = a.distanceTo(b);
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, len * 0.92, 8), new THREE.MeshStandardMaterial({ color: 0x2f5fb3, roughness: 0.85 }));
      roll.position.copy(a).lerp(b, 0.5);
      roll.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      roll.visible = false;
      roll.castShadow = true;
      parent.add(roll);
      this.gennRoll = roll;
    }

    this.updateMeshes(0, 0);
  }

  /** рівень апгрейду «Паруси»: тканина, гік, генакер і фізика */
  setLevel(l: number) {
    if (l === this.level && this.styleShown) return;
    this.level = l;
    this.perf = sailPerf(l);
    const st = styleFor(l);
    if (st !== this.styleShown) {
      this.styleShown = st;
      this.cloth.map?.dispose();
      this.cloth.map = clothTexture(st);
      this.cloth.roughness = st === 'carbon' ? 0.55 : st === 'laminate' ? 0.6 : 0.92;
      this.cloth.metalness = st === 'laminate' ? 0.15 : 0;
      this.cloth.needsUpdate = true;
    }
    // карбоновий гік у гоночному пакеті
    this.boomMat.color.set(l >= 5 ? 0x1d1f22 : 0xd7dade);
    this.boomMat.roughness = l >= 5 ? 0.3 : 0.35;
    this.boomMat.metalness = l >= 5 ? 0.3 : 0.7;
    if (!this.perf.genn) this.gennaker = 0;
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
    const p = this.perf;
    const target = AREA[this.mode];
    this.hoist = damp(this.hoist, target, p.hoist, dt);
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
    this.luffing = this.hoist > 0.05 && this.awa < p.noGo;

    const q = this.hoist * this.aws * this.aws;
    let drive = K_SAIL * q * driveCoef(this.awa, p.noGo) * p.drive;
    let sideF = K_SAIL * q * sideCoef(this.awa, p.noGo) * Math.sign(lx || 1); // на підвітряний борт (локальний x)
    // генакер: сам розкривається на повних курсах при повних парусах, якщо не перевантажено
    const gennWant = p.genn && this.mode === 2 && this.hoist > 0.9 && this.awa > 100 && this.overload < 0.7 ? 1 : 0;
    this.gennaker = damp(this.gennaker, gennWant, gennWant ? 0.8 : 2.0, dt);
    if (this.gennaker > 0.01) {
      const gc = clamp((this.awa - 95) / 30, 0, 1) * (this.awa > 165 ? 0.8 : 1);
      const gq = 0.55 * this.gennaker * this.aws * this.aws;
      drive += K_SAIL * gq * gc;
      sideF += K_SAIL * gq * 0.25 * Math.sign(lx || 1);
    }
    this.drive = drive;

    // автотрим гіка: кут ≈ (awa − 20°)/2 на підвітряний борт
    const want = clamp(((this.awa - 20) / 2) * (Math.PI / 180), 0.08, 1.45);
    const newSide = lx >= 0 ? -1 : 1; // вітер дме в +X → гік іде на +X (θ < 0)
    // гістерезис: строго в корму (±6°) гік лишається, де був — інакше на
    // шварті чи фордевінді він смикався б туди-сюди щокадру
    this.gybeT -= dt;
    if (newSide !== this.side && this.awa < 174) {
      if (this.hoist > 0.3 && this.awa > 150 && !this.passive && this.gybeT <= 0) {
        this.onEvent?.('Поворот фордевінд — гік перекинувся!', 'warn');
        this.gybeT = 8;
      }
      this.side = newSide;
    }
    // пориви: шкот трохи «дихає» — у пориві гік відходить, у затишші підбирається
    this.gustT += dt;
    const gt = this.gustT;
    const gust = Math.sin(gt * 0.9) * Math.sin(gt * 0.37 + 1.3) + 0.35 * Math.sin(gt * 2.3 + 0.7);
    const load = clamp(this.hoist * (this.aws / 9), 0, 1); // наскільки вітер тисне в парус
    const boomTarget = this.side * clamp(want + gust * 0.07 * (0.4 + load), 0.06, 1.5);
    this.updateBoom(dt, boomTarget, load);

    // перевантаження: шторм з повними парусами → розрив
    // (рахуємо й від справжнього вітру: шквали б'ють і на швидкому ходу)
    this.overload = ((this.hoist + 0.4 * this.gennaker) * (0.5 * this.aws * this.aws + 0.5 * this.tws * this.tws)) / (OVERPOWER_Q * p.over);
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

    // у світ: тяга вздовж курсу + 35 % бокової сили (її тримає кіль у Boat — дрейф кілька градусів)
    const fx = drive * sh + sideF * 0.35 * ch;
    const fz = drive * ch - sideF * 0.35 * sh;
    // крен: бокова сила в +X кладе човен на правий борт (roll < 0)
    const torqueRoll = -sideF * HEEL_LEVER * p.heel;
    return { fx, fz, torqueRoll };
  }

  /** рух корпусу (крен, кутові швидкості) — гойдає гік на хвилі й у поворотах */
  setHullMotion(roll: number, rollRate: number, yawRate: number) {
    this.hullRoll = roll;
    this.hullRollRate = rollRate;
    this.hullYawRate = yawRate;
  }

  /**
   * Гік на пружині шкота: тягнеться до кута автотриму з легким перельотом;
   * хвиля, що валяє човен з борту на борт, і поворот корпусу розгойдують його —
   * сильніше, коли вітру в парусі мало (штиль, фордевінд, спущені паруси).
   * Шкот не пускає далі за свою довжину — гік «б'ється» об нього й відскакує.
   */
  private updateBoom(dt: number, target: number, load: number) {
    const up = this.hoist > 0.05;
    const k = up ? 7 + 9 * load : 2.5;
    const c = up ? 2.6 + 2 * load : 1.6;
    const free = 1 - 0.75 * load;
    // крен на борт — гік валиться на нижній борт; кутові швидкості — інерція
    const acc = k * (target - this.boomAngle) - c * this.boomVel
      + free * (-this.hullRoll * 3.2 - this.hullRollRate * 2.2)
      - this.hullYawRate * 1.6;
    const n = Math.max(1, Math.ceil(dt / 0.02));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.boomVel += acc * h;
      this.boomAngle += this.boomVel * h;
    }
    // шкот: далі за ціль (+ трохи слабини) гік не йде — відскок
    const slack = 0.06 + 0.12 * (1 - load);
    const lim = Math.abs(target) + slack;
    if (up && Math.sign(this.boomAngle) === Math.sign(target) && Math.abs(this.boomAngle) > lim) {
      this.boomAngle = Math.sign(this.boomAngle) * lim;
      if (this.boomVel * Math.sign(this.boomAngle) > 0) this.boomVel *= -0.35;
    }
    this.boomAngle = clamp(this.boomAngle, -1.55, 1.55);
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

    // ── генакер ──
    {
      const g = this.gennaker;
      this.gennRoll.visible = this.perf.genn && g < 0.15;
      this.genn.visible = this.perf.genn && g > 0.03;
      if (this.genn.visible) {
        // шкотовий кут — далеко на підвітряний борт, біля кокпіту
        const side = -Math.sign(this.boomAngle || 1);
        const clew = this._c.set(side * (0.6 + 2.2 * g), DECK_Y + 1.0, 0.2 + (1 - g) * 3.5);
        const pos = this.genn.geometry.attributes.position as THREE.BufferAttribute;
        for (let j = 0; j <= this.NV; j++) {
          const v = j / this.NV;
          const luff = this._a.copy(this.gennTack).lerp(this.gennHead, v);
          const leech = this._b.copy(clew).lerp(this.gennHead, v);
          const chord = luff.distanceTo(leech);
          for (let i = 0; i <= this.NU; i++) {
            const u = (i / this.NU) * g;
            const k = j * (this.NU + 1) + i;
            // пузатий асиметричний парус: велике черево вперед і на підвітряний борт
            const bell = Math.sin(Math.PI * (i / this.NU)) * Math.sin(Math.PI * Math.min(1, v * 1.15 + 0.05));
            const wob = Math.sin(t * 6 + u * 5 + v * 4) * 0.04 * g;
            pos.setXYZ(
              k,
              luff.x + (leech.x - luff.x) * u + side * bell * chord * 0.28 * g + wob,
              luff.y + (leech.y - luff.y) * u,
              luff.z + (leech.z - luff.z) * u + bell * chord * 0.22 * g,
            );
          }
        }
        pos.needsUpdate = true;
        this.genn.geometry.computeVertexNormals();
        this.genn.geometry.computeBoundingSphere();
      }
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
    this.boomVel = 0;
    this.stressT = 0;
    this.gennaker = 0;
  }

  /** телеметрія для HUD */
  hudText(): string {
    const side = this.windFromStarboard ? 'ПрБ' : 'ЛБ';
    const state = this.mode === 0 ? 'спущені' : this.luffing ? 'полощуть (мертвий кут)' : this.gennaker > 0.5 ? `${this.label()} + генакер` : this.label();
    return `⛵ ${state} · вітер ${this.tws.toFixed(0)} м/с, ${Math.round(this.awa)}° ${side}`;
  }
}
