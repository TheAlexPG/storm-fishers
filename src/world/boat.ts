import * as THREE from 'three';
import { Ocean } from '../core/ocean';
import { clamp, rand, compassDeg, wrapAngle } from '../core/math';
import { eff } from '../game/upgrades';
import type { GameState } from '../game/state';
import type { Weather } from '../core/weather';
import type { ParticlePool } from './particles';
import type { AudioEngine } from '../core/audio';
import type { Platform } from './port';
import { YachtBuilder, FLAG_NU, FLAG_NV } from './yachtModel';
import { trueWindSpeed } from './sails';
import { SailRig } from './sails';
import type { HelmDisplay } from './helmDisplay';
import { ZONE_NAMES, zoneFromDist } from '../game/fish';
import { DECK_Y, SOLE_Y, RIG, HOUSE, deckLimitX } from './yachtLayout';
import { HOLDER_MOUNTS } from './upgradeParts';
import { FISH_BOX } from './deckFish';
import { holderCount } from '../game/upgrades';
import { Anchor } from './anchor';
import { depthAt } from './helmInstruments';

// ─────────────────────────────────────────────────────────────
// Вітрильна яхта «Шторм» (меш — yachtModel.ts, компонування — yachtLayout.ts):
// кокпіт під hardtop, рубка з трапом у салон у корпусі, щогла з парусами.
// Фізика: буївність 3 шари × 5×3, двигун, кермо, вітер, затоплення палуби.
// +Z — нос, origin — вода.
// ─────────────────────────────────────────────────────────────

export const BOAT = {
  length: 9.4,
  beam: 3.6,
  deckY: DECK_Y,
  hullBottom: -1.1,
};

// точка швартування в порту: у воді, біля кромки причалу (причал закінчується з=-18)
export const MOOR = { x: 0, z: -15.9 };
// курс при шварті: човен паралельно причалу, нос на +X
export const MOOR_HEADING = Math.PI / 2;
/** радіус, у якому пружина шварту підхоплює човен (без газу) */
export const MOOR_CAPTURE = 16;

// станції (локальні координати палуби, y = deckY)
export const STATION_POS: Record<string, { x: number; z: number; y?: number }> = {
  wheel: { x: 0, z: -4.2 },
  engine: { x: 0.62, z: -4.05 },
  pump: { x: -0.62, z: -4.05 },
  rod: { x: 0, z: 3.9 },
  // фали й риф-шкентелі — біля щогли на даху рубки (підходити з бічної палуби)
  sails: { x: 0, z: RIG.mastZ - 0.25, y: HOUSE.top },
  // салон у корпусі (y = підлога салону)
  kitchen: { x: -0.4, z: 1.15, y: SOLE_Y },
  radio: { x: 0.4, z: 0.95, y: SOLE_Y },
  chart: { x: 0.42, z: 0.75, y: SOLE_Y },
  bed: { x: 0, z: 2.45, y: SOLE_Y },
  // рибальські стійки (апгрейд «Стійки для вудок») — біля тримачів
  // рибний ящик на баку — сюди кладуть рибу з рук
  fishbox: { x: FISH_BOX.x + 0.3, z: FISH_BOX.z - 0.15 },
  // двері каюти — у прорізі трапа; доступні і з кокпіту, і з салону
  door: { x: 0, z: HOUSE.z0 - 0.05 },
  holder0: { x: HOLDER_MOUNTS[0].stand[0], z: HOLDER_MOUNTS[0].stand[1] },
  holder1: { x: HOLDER_MOUNTS[1].stand[0], z: HOLDER_MOUNTS[1].stand[1] },
  holder2: { x: HOLDER_MOUNTS[2].stand[0], z: HOLDER_MOUNTS[2].stand[1] },
  // сітковий ящик/барабан на кормовій платформі (апгрейд «Сітки»)
  nets: { x: 0.55, z: -4.3 },
  // брашпиль на баку — віддати / вибрати якір
  anchor: { x: 0, z: 4.25 },
  // пульт автопілота на штурвальній тумбі (апгрейд «Прилади» 5)
  autopilot: { x: -0.25, z: -4.1 },
};

export interface RockObstacle {
  x: number;
  z: number;
  r: number;
  /** не скеля (пірс, пришвартовані човни) — колізія є, на карті не малюється */
  kind?: 'pier' | 'mark';
}

// ── гідродинаміка (налаштовано стендом: розгін, поляра, циркуляція) ──
const THRUST = 11000;      // Н на повному газі (рів. 0)
const DRAG_Q = 150;        // уздовж: квадратичний
const DRAG_L = 380;        // уздовж: лінійний (човен зупиняється, а не повзе вічно)
const KEEL_Q = 2600;       // впоперек: кіль
const KEEL_L = 2200;
const KEEL_CARVE = 1.6;    // рад/с — як швидко хід підтягується до курсу
const ADDED_MASS = 1.8;    // приєднана маса по горизонталі
const RUDDER_K = 2200;
const PROP_WASH = 4;       // «еквівалентна швидкість» струменя гвинта на кермі, м/с
const YAW_DAMP_V = 0.22;   // демпфування рисканням, що росте з ходом

export class Boat {
  group = new THREE.Group();
  // фізика
  pos = new THREE.Vector3(MOOR.x, 0, MOOR.z);
  vel = new THREE.Vector3();
  heading = MOOR_HEADING; // 0 → нос на +Z; старт — швартувальний курс
  pitch = 0;
  roll = 0;
  private remRoll = 0;
  private remHead = 0;
  angVel = new THREE.Vector3();
  /** зараз тримається на шварті (для HUD) */
  mooredNow = false;
  /** сходня на причал: борт (−1/1), 0 — прибрана; z — де на палубі */
  gangSide: -1 | 0 | 1 = 0;
  static readonly GANG_Z = -2.9;
  /** довжина сходні до причалу (м) */
  gangLen = 1.2;
  private gang: THREE.Group | null = null;
  private gangA = 0;
  private gangTilt = 0;
  /** своє місце біля причалу (у коопі в кожної яхти — своє) */
  moor = { x: MOOR.x, z: MOOR.z };
  /** курс при шварті на цьому місці (пружина приймає й протилежний) */
  moorHeading = MOOR_HEADING;
  throttle = 0;
  rudder = 0;
  engineOn = true;
  engineLoad = 0;
  deckWater = 0;
  /** люк трюму відкрито — вода з палуби тече всередину */
  /** рівень апгрейду «Сітки» (0 — немає станції біля барабана) */
  netLevel = 0;
  hatchOpen = false;
  /** двері каюти (компаньйон) відчинені — у шторм вода з палуби ллється в салон */
  doorOpen = true;
  /** вода в трюмі 0..100 (100 — човен тоне) */
  bilge = 0;
  sinking = false;
  sinkTimer = 0;

  // події для світу
  onHullHit: ((power: number, pos: THREE.Vector3) => void) | null = null;
  /** удар хвилі: bow — ніс плеснув об хвилю (слемінг), beam — гребінь накрив борт */
  onSlam: ((dmg: number, kind: 'bow' | 'beam', power: number) => void) | null = null;
  private bowOut = false;
  private slamCd = 0;
  private beamCd = 0;
  private _sv = new THREE.Vector3();
  private _sv2 = new THREE.Vector3();
  onEngineStall: (() => void) | null = null;
  onSunk: (() => void) | null = null;

  private mass = 4000;
  private inertiaPitch = 3100;
  private inertiaRoll = 2900;
  private inertiaYaw = 27500;
  // на точку сітки (45 точок: 3 шари × 5 × 3) — м'якіше, човен сідає глибше
  private readonly buoyK = 933;
  private readonly buoyDamp = 500;
  private readonly wavePushK = 800;

  private gridLocal: THREE.Vector3[] = [];
  private _v = new THREE.Vector3();
  private _fwd = new THREE.Vector3();
  private _side = new THREE.Vector3();
  private _n = new THREE.Vector3();
  private _f = new THREE.Vector3();
  private _t = new THREE.Vector3();
  // фізична поза БЕЗ візуального триму: group тримає візуальну позу (ніс
  // припіднятий на ході), а буївність і тяга рахуються від чистої фізичної —
  // тож трим носа не додає жодної сили/моменту й не чіпає стабільність
  private physGroup = new THREE.Object3D();
  /** поточний візуальний трим носа, рад (0 у спокої) */
  bowLift = 0;

  // візуали апгрейдів
  private upg: Record<string, THREE.Object3D[]> = {};
  private hullMats: THREE.MeshStandardMaterial[] = [];
  private interiorLight!: THREE.PointLight;
  private cockpitLight!: THREE.PointLight;
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private lights: Array<{ light: THREE.PointLight | null; lamp: THREE.Mesh }> = [];
  private spotlight: THREE.SpotLight | null = null;
  private exhaustTip = new THREE.Vector3();
  private bowPoint = new THREE.Vector3(0, 0.6, 4.4);

  // приборна панель: стрілки (RPM/паливо/швидкість) + компасна шкала + лампа ON
  private needleRpm = new THREE.Group();
  private needleFuel = new THREE.Group();
  private needleSpeed = new THREE.Group();
  private compassCard = new THREE.Group();
  private onLampMat: THREE.MeshStandardMaterial | null = null;
  private helmDisplay: HelmDisplay | null = null;
  private rodGroup = new THREE.Group();
  private rodLen = 2.4;
  private rodBaseRot = 0;
  /** кінчик основної вудки у світі (з урахуванням вигину) */
  rodTipWorld(out: THREE.Vector3): THREE.Vector3 {
    this.rodGroup.updateMatrixWorld();
    return this.rodGroup.localToWorld(out.set(0, this.rodLen, 0));
  }
  /** вигин вудки 0..1 (натяг волосіні) */
  /** основна вудка як окремий об'єкт (нею керує Fishing: стійка/руки) — знімаємо з човна */
  takeMainRod(): { group: THREE.Group; len: number } {
    const g = this.rodGroup;
    g.parent?.remove(g);
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    return { group: g, len: this.rodLen };
  }

  setRodBend(f: number) {
    this.rodGroup.rotation.x = this.rodBaseRot + clamp(f, 0, 1) * 0.55;
  }
  /** ніч (притлумлений дисплей) — виставляє main */
  night = false;
  private flag: THREE.Mesh | null = null;

  // маркери станцій
  stationMarkers: THREE.Group = new THREE.Group();
  /** вітрила (грот + стаксель), сили — у applySails */
  sails!: SailRig;

  /** visual — чужа яхта в коопі: лише картинка, без власних ламп-джерел світла */
  /** якір із ланцюгом (брашпиль на баку) */
  readonly anchor: Anchor;
  private _af = { fx: 0, fz: 0, rx: 0, rz: 0, wx: 0, wz: 0 };

  constructor(private scene: THREE.Scene, visual = false) {
    this.anchor = new Anchor(scene);
    this.anchor.remote = visual;
    // 3-шарова сітка (об'єм корпусу): глибокі шари лишаються у воді
    // навіть при тангажі, тож буївність змінюється плавно, без різких
    // «вкл/викл», які раніше розганяли крен/тангаж наспіх
    for (const y of [-0.1, -0.5, -0.8]) {
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 3; j++) {
          // фізична ширина буївності НЕ масштабується з корпусом:
          // ±1.2 — налаштоване значення (баланс крен/тангаж, комміт 70d29ae);
          // ширший візуальний корпус не змінює фізику
          const x = (j - 1) * 1.2;
          const z = -3.4 + (i / 4) * 6.8;
          this.gridLocal.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    this.buildMesh();
    this.scene.add(this.group);
    if (visual) {
      // зайві джерела світла перекомпілювали б усі шейдери й важчали б кадр
      const lights: THREE.Object3D[] = [];
      this.group.traverse((o) => {
        if ((o as THREE.Light).isLight) lights.push(o);
      });
      for (const l of lights) l.parent?.remove(l);
      this.stationMarkers.visible = false;
    }
    this.syncTransform();
  }

  // ── Mesh ──

  private buildMesh() {
    const r = new YachtBuilder(this.group).build();
    this.hullMats = r.hullMats;
    this.interiorLight = r.interiorLight;
    this.cockpitLight = r.cockpitLight;
    this.glowMats = r.glowMats;
    this.needleRpm = r.needleRpm;
    this.needleFuel = r.needleFuel;
    this.needleSpeed = r.needleSpeed;
    this.compassCard = r.compassCard;
    this.onLampMat = r.onLampMat;
    this.helmDisplay = r.helmDisplay;
    this.panelParts = r.panelParts;
    this.rodGroup = r.rod;
    this.rodLen = r.rodLen;
    this.rodBaseRot = r.rod.rotation.x;
    this.flag = r.flag;
    this.exhaustTip.copy(r.exhaustTip);
    this.upg = r.upg;
    this.lights = r.lights;
    this.spotlight = r.spotlight;
    this.sails = new SailRig(this.group, r.furledJib);
    this.fenders = r.fenders;

    // маркери станцій (м'які кільця)
    const markerGeo = new THREE.RingGeometry(0.28, 0.38, 24);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x37c6b5, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
    for (const [id, p] of Object.entries(STATION_POS)) {
      const m = new THREE.Mesh(markerGeo, markerMat.clone());
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, (p.y ?? BOAT.deckY) + 0.03, p.z);
      m.userData.station = id;
      this.stationMarkers.add(m);
    }
    this.group.add(this.stationMarkers);
  }

  private fenders: THREE.Object3D[] = [];

  /** кранці за бортом лише біля причалу — у морі їх прибирають */
  setFenders(out: boolean) {
    if (this.fenders[0]?.visible === out) return;
    for (const f of this.fenders) f.visible = out;
  }

  /** застосувати рівні апгрейдів до mesh */
  /** скільки стійок для вудок встановлено */
  holderSlots = 0;
  /** рівень «Приладів» (пульт автопілота — з 5-го) */
  instrLevel = 0;
  /** автопілот увімкнено (симулює власник яхти, екіпаж бачить зі знімка) */
  autopilot = false;
  /** прилади пульта (yachtModel) — їх показує HelmInstruments за рівнем */
  panelParts: Record<string, THREE.Object3D[]> = {};
  /** станція доступна (стійки — лише куплені) */
  stationOn(id: string): boolean {
    if (id.startsWith('holder')) return Number(id.slice(6)) < this.holderSlots;
    if (id === 'nets') return this.netLevel > 0;
    if (id === 'autopilot') return this.instrLevel >= 5;
    return true;
  }

  applyUpgrades(levels: Record<string, number>, timeDaylight: number) {
    this.holderSlots = holderCount(levels.holders ?? 0);
    this.sails.setLevel(levels.sails ?? 0);
    this.netLevel = levels.nets ?? 0;
    this.instrLevel = levels.instr ?? 0;
    for (const m of this.stationMarkers.children) m.visible = this.stationOn(m.userData.station as string);
    for (const [id, arr] of Object.entries(this.upg)) {
      const lvl = levels[id] ?? 0;
      for (const o of arr) {
        const need = (o.userData.lvl ?? 0) as number;
        const until = o.userData.until as number | undefined;
        o.visible = need <= lvl && (until === undefined || lvl < until);
      }
    }
    // колір корпусу по рівню
    const hullLvl = levels.hull ?? 0;
    // білий гелькоут → «бронзово-сталевий» відтінок з рівнем корпусу
    const base = new THREE.Color(0xffffff);
    const dark = new THREE.Color(0x8d96a0);
    for (const m of this.hullMats) m.color.copy(base.lerp(dark, hullLvl * 0.04));

    // світло
    const lightsLvl = levels.lights ?? 0;
    const night = 1 - timeDaylight;
    for (const l of this.lights) {
      if (l.light) {
        l.light.intensity = lightsLvl > 0 ? night * (1.2 + lightsLvl * 0.5) : 0;
        l.light.distance = eff.lightRadius(lightsLvl);
      }
      (l.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + night * 1.8;
    }
    if (this.spotlight && lightsLvl >= 5) this.spotlight.intensity = night * 26;
  }

  /** каютне світло: тепле сяйво вночі та у шторм, ілюмінатори світлять разом */
  setInteriorLight(daylight: number, storm: number) {
    const night = 1 - daylight;
    const i = Math.max(0.2, night * 1.7 + storm * 0.9);
    this.interiorLight.intensity = i;
    // кокпіт: дах завжди читається як темне дерево, вночі/штормі — тепле укриття
    this.cockpitLight.intensity = 2.5 + i * 3;
    // скло вікон світиться лише вночі/у шторм (вдень — прозоре, без «бежевих» плям)
    for (const m of this.glowMats) m.emissiveIntensity = m.userData.nightGlow ? Math.max(0, i - 0.25) * 0.8 : 0.15 + i * 0.55;
  }

  /** підсвітити маркер станції (1 — активна/близька) */
  setStationGlow(id: string, glow: number) {
    const m = this.stationMarkers.children.find((c) => c.userData.station === id) as THREE.Mesh | undefined;
    if (m) (m.material as THREE.MeshBasicMaterial).opacity = glow * 0.85;
  }

  // ── Трансформ ──

  syncTransform() {
    // фізична поза (без триму) — для буївності та точки застосування тяги
    this.physGroup.position.copy(this.pos);
    this.physGroup.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
    this.physGroup.updateMatrixWorld();
    // візуальна поза: динамічний трим — на прямому ході ніс припіднімається
    // (displacement hull: тиск води під носом росте з швидкістю, корма сідає).
    // Тільки візуал: фізичні сили рахуються від physGroup, тож жодного впливу
    // на стабільність. Квадрат відношення швидкості: у спокої й на малому
    // ході — точно нуль; на задньому ході (fwd < 0) — теж нуль.
    const fwdSpeed = Math.max(
      0,
      this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading),
    );
    const ratio = Math.min(fwdSpeed / 9, 1);
    this.bowLift = 0.08 * ratio * ratio;
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch - this.bowLift, this.heading, this.roll, 'YXZ');
    // одразу оновити матрицю: localToWorld (гравець, вудка, частинки) мусить
    // бачити позу цього кадру, а не минулого рендера
    this.group.updateMatrixWorld();
  }

  /** локаль фізичної пози (без триму) → світ: буївність, точка тяги */
  private physicsToLocal(lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(lx, ly, lz);
    return this.physGroup.localToWorld(out);
  }

  /** локаль візуальної пози (з тримом носа) → світ: гравець, риболовля, частинки */
  localToWorld(lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(lx, ly, lz);
    return this.group.localToWorld(out);
  }

  worldToLocal(wx: number, wy: number, wz: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(wx, wy, wz);
    return this.group.worldToLocal(out);
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  // ── Фізика ──

  update(dt: number, t: number, ocean: Ocean, weather: Weather, game: GameState, particles: ParticlePool, audio: AudioEngine, rocks: RockObstacle[], dock?: Platform) {
    if (this.sinking) {
      this.sinkTimer += dt;
      this.pos.y -= 0.55 * dt;
      this.roll += 0.3 * dt;
      this.pitch += 0.15 * dt;
      this.syncTransform();
      if (this.sinkTimer > 4.5 && this.onSunk) {
        this.sinking = false;
        this.onSunk();
      }
      return;
    }

    // керування (штурвал)
    const enginePower = eff.enginePower(game.upgrades.engine);
    const wetPenalty = 1 - 0.22 * (this.deckWater / 100);
    const maxThrust = THRUST * enginePower * wetPenalty;
    const speed = this.vel.length();
    const fwd = this.forward(this._fwd); // окремий вектор: _v перезаписується в сітці буївності

    // двигун може заглушити хвиля в шторм
    if (this.engineOn && weather.intensity > 0.82 && this.throttle > 0.05 && Math.random() < dt * 0.02 * (weather.intensity - 0.75) * 10) {
      this.engineOn = false;
      this.onEngineStall?.();
    }

    const thrust = this.engineOn ? this.throttle * maxThrust : 0;

    // ── сили ──
    this._f.set(0, -this.mass * 9.81, 0);
    this._t.set(0, 0, 0);

    const buoyEff = (1 - 0.25 * (this.deckWater / 100)) * (1 - 0.45 * (this.bilge / 100));
    // плечі сил — в осях КОРПУСУ (крен навколо поздовжньої осі, тангаж — поперечної).
    // Раніше бралися світові x/z: на курсі 90° тангаж змішувався з креном,
    // на 180° крен міняв знак — човен сам розгойдувався до ±37° навіть у штиль
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    for (const lp of this.gridLocal) {
      this.physicsToLocal(lp.x, lp.y, lp.z, this._v);
      const h = ocean.heightAt(this._v.x, this._v.z, t);
      const depth = h - this._v.y;
      if (depth > 0) {
        // вертикальна буївність + демпфування по вертикалі
        const Fb = this.buoyK * buoyEff * depth;
        const wx = this._v.x - this.pos.x;
        const wz = this._v.z - this.pos.z;
        const armX = wx * ch - wz * sh; // локальне x (правий борт +)
        const armZ = wx * sh + wz * ch; // локальне z (ніс +)
        const relVy = this.vel.y + this.angVel.z * armX - this.angVel.x * armZ;
        const Fd = -this.buoyDamp * relVy;
        this._f.y += Fb + Fd;
        // хвиля штовхає по схилу (напрямок нормалі)
        ocean.normalAt(this._v.x, this._v.z, t, this._n);
        const push = this.wavePushK * Math.min(depth, 0.6);
        this._f.x += this._n.x * push;
        this._f.z += this._n.z * push;
        // момент від розподілу сил → крен/тангаж (τ = r × F, F — вгору)
        this._t.x += -armZ * (Fb + Fd);
        this._t.z += armX * (Fb + Fd);
      }
    }

    // водний опір в осях корпусу: уздовж — хвилеутворення (квадратичний →
    // топова швидкість), впоперек — кіль. Без кіля опір був однаковий в усі
    // боки: на гострих курсах човен їхав боком, у поворотах — заносило
    const side = this._side.set(fwd.z, 0, -fwd.x);
    const u = this.vel.x * fwd.x + this.vel.z * fwd.z;
    const v = this.vel.x * side.x + this.vel.z * side.z;
    const Fu = -(DRAG_Q * u * Math.max(1, Math.abs(u)) + DRAG_L * u);
    const Fv = -(KEEL_Q * v * Math.abs(v) + KEEL_L * v);
    this._f.x += fwd.x * Fu + side.x * Fv;
    this._f.y -= 30 * this.vel.y;
    this._f.z += fwd.z * Fu + side.z * Fv;

    // вітер
    const wind = weather.wind;
    const wvx = Math.sin(weather.windDir) * wind;
    const wvz = -Math.cos(weather.windDir) * wind;
    this._f.x += wvx * 620;
    this._f.z += wvz * 620;

    // швартування: біля причалу без газу — м'яка пружина до точки шварту.
    // тримає човен на місці від вітру/хвиль, але не заважає відійти з повним газом.
    const dMx = this.pos.x - this.moor.x;
    const dMz = this.pos.z - this.moor.z;
    const dMoor = Math.hypot(dMx, dMz);
    this.mooredNow = dMoor < MOOR_CAPTURE && Math.abs(this.throttle) < 0.15 && speed < 3;
    if (this.mooredNow) {
      let fxm = -dMx * 3200 - this.vel.x * 5200;
      let fzm = -dMz * 3200 - this.vel.z * 5200;
      const fl = Math.hypot(fxm, fzm);
      if (fl > 16000) { fxm *= 16000 / fl; fzm *= 16000 / fl; }
      this._f.x += fxm;
      this._f.z += fzm;
      // і розвертаємо бортом до причалу (нос уздовж причалу — куди ближче)
      const e1 = wrapAngle(this.heading - this.moorHeading), e2 = wrapAngle(this.heading - this.moorHeading - Math.PI);
      const e = Math.abs(e1) < Math.abs(e2) ? e1 : e2;
      const w = clamp(1 - dMoor / MOOR_CAPTURE, 0.2, 1);
      this._t.y += (-e * 24000 - this.angVel.y * 46000) * w;
    }

    // тяга (у кормі)
    if (thrust !== 0) {
      const stern = this.physicsToLocal(0, -0.3, -4.2, this._v);
      this._f.x += fwd.x * thrust;
      this._f.z += fwd.z * thrust;
      this._t.y += (stern.z - this.pos.z) * fwd.x * thrust - (stern.x - this.pos.x) * fwd.z * thrust;
      this.engineLoad = clamp(speed / 10, 0, 1) * Math.abs(this.throttle);
    }

    // вітрила: тяга від вітру (безкоштовно) + крен
    this.applySails(dt, weather);

    // якірний ланцюг тягне ніс до якоря (яхта стає носом до вітру)
    if (this.anchor.force(dt, this, weather.wind, weather.windDir, this._af)) {
      this._f.x += this._af.fx + this._af.wx;
      this._f.z += this._af.fz + this._af.wz;
      this._t.y += this._af.rz * this._af.fx - this._af.rx * this._af.fz;
    }

    // кермо: обтікання від ходу + струмінь гвинта (з газом можна розвернутись
    // майже на місці — як при швартуванні справжньої яхти)
    const wash = this.engineOn ? Math.abs(this.throttle) * PROP_WASH : 0;
    const rudderTorque = this.rudder * (clamp(Math.abs(u), 0, 10) + wash) * RUDDER_K;
    this._t.y += rudderTorque;

    // ── інтегрування (підкроки для стабільності) ──
    const rollDamp = 1 + (game.upgrades.stab ?? 0) * 0.3;
    const sub = 2;
    const sdt = dt / sub;
    // приєднана маса води: по горизонталі човен «важчий» — розгін і гальмування
    // плавні, а не як у катера-іграшки
    const mH = this.mass * ADDED_MASS;
    const yawDamp = 0.8 + YAW_DAMP_V * Math.min(10, Math.abs(u));
    for (let s = 0; s < sub; s++) {
      this.vel.x += (this._f.x / mH) * sdt;
      this.vel.y += (this._f.y / this.mass) * sdt;
      this.vel.z += (this._f.z / mH) * sdt;
      // кіль як крило: на ходу вперед вектор швидкості «підтягується» до курсу
      // (човен ріже воду в повороті, а не ковзає боком; модуль не росте)
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const uu = this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading);
      if (hs > 0.3 && uu > 0) {
        const va = Math.atan2(this.vel.x, this.vel.z);
        const d = wrapAngle(this.heading - va);
        const rot = clamp(d, -1, 1) * KEEL_CARVE * Math.min(1, uu / 3) * sdt;
        const c = Math.cos(rot), sn = Math.sin(rot);
        const nx = this.vel.x * c + this.vel.z * sn;
        const nz = -this.vel.x * sn + this.vel.z * c;
        this.vel.x = nx;
        this.vel.z = nz;
      }
      this.angVel.x += (this._t.x / this.inertiaPitch) * sdt;
      this.angVel.y += (this._t.y / this.inertiaYaw) * sdt;
      this.angVel.z += (this._t.z / this.inertiaRoll) * sdt;
      // стабілізація: пружність до рівня + сильне демпфування кутів.
      // Човен — квазістатичний «слідч за схилом хвилі»: сильне демпфування
      // вбиває зв'язний резонанс тангаж↔крен, який раніше розганяв човен
      // до жорстких клампів навіть у тиші
      this.angVel.x += -this.pitch * 2.0 * sdt;
      this.angVel.z += -this.roll * 2.0 * rollDamp * sdt;
      this.angVel.x *= 1 - 9.0 * sdt;
      this.angVel.z *= 1 - 11.0 * rollDamp * sdt;
      this.angVel.y *= 1 - yawDamp * sdt;
      this.pos.addScaledVector(this.vel, sdt);
      this.heading += this.angVel.y * sdt;
      this.pitch = clamp(this.pitch + this.angVel.x * sdt, -0.45, 0.45);
      // крен до 0.65 рад (~37°) — у штормі швартований човен має право
      // сильно кренитись, без жорсткого «прилипання» до клампу
      this.roll = clamp(this.roll + this.angVel.z * sdt, -0.65, 0.65);
    }

    // страховка: жодна числова нестабільність не повинна розірвати гру
    const vlen = this.vel.length();
    if (vlen > 25) this.vel.multiplyScalar(25 / vlen);
    const alen = this.angVel.length();
    if (alen > 6) this.angVel.multiplyScalar(6 / alen);

    // палуба затоплюється великими хвилями
    const deckWorld = this.pos.y + BOAT.deckY;
    const crest = ocean.heightAt(this.pos.x, this.pos.z, t) + 0.5 * weather.intensity;
    if (crest > deckWorld - 0.12 && weather.intensity > 0.45) {
      this.deckWater = clamp(this.deckWater + (crest - deckWorld + 0.12) * 16 * dt, 0, 100);
      if (Math.random() < dt * 2) particles.splash(this.pos.x + rand(-1.5, 1.5), deckWorld, this.pos.z + rand(-1.5, 1.5), 0.7);
    } else {
      this.deckWater = Math.max(0, this.deckWater - 2.5 * dt);
    }

    this.updateSlam(dt, t, ocean, game, particles, fwd);

    // бризки від носа
    this.localToWorld(0, 0.7, 4.3, this.bowPoint);
    particles.spray(this.bowPoint, fwd, speed * Math.abs(this.throttle) + speed * 0.4, dt);
    // дим (вихлоп у локальних координатах → світ)
    if (this.engineOn && this.throttle > 0.05) {
      this.localToWorld(this.exhaustTip.x, this.exhaustTip.y, this.exhaustTip.z, this._t);
      particles.exhaust(this._t, Math.abs(this.throttle), dt);
    }

    // зіткнення з скелями
    for (const rock of rocks) {
      const dx = this.pos.x - rock.x;
      const dz = this.pos.z - rock.z;
      const d = Math.hypot(dx, dz);
      const minD = rock.r + 1.6;
      if (d < minD && d > 0.01) {
        const nx = dx / d;
        const nz = dz / d;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) {
          const impact = -vn;
          this.vel.x += nx * impact * 1.4;
          this.vel.z += nz * impact * 1.4;
          if (impact > 2) {
            const dmg = (impact - 1.5) * 6;
            game.damage(dmg);
            const hitPos = new THREE.Vector3(this.pos.x - nx * 1.4, 0.5, this.pos.z - nz * 1.4);
            this.onHullHit?.(impact, hitPos);
            particles.splash(hitPos.x, 0.4, hitPos.z, 1.2);
          }
        }
        // витісняємо
        this.pos.x = rock.x + nx * minD;
        this.pos.z = rock.z + nz * minD;
      }
    }

    // причал: корпус (корма→центр→нос) не заїжджає під платформу.
    // Точки рахуємо напряму з поточного pos (а не через group-матрицю попереднього
    // кадру), щоб послідовні виштовхування не накладалося.
    if (dock) {
      const R = 1.7;
      const x0 = dock.x0 - R, x1 = dock.x1 + R;
      const z0 = dock.z0 - R, z1 = dock.z1 + R;
      const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
      for (const oz of [-4.2, 0, 4.2]) {
        const px = this.pos.x + oz * sh;
        const pz = this.pos.z + oz * ch;
        if (px > x0 && px < x1 && pz > z0 && pz < z1) {
          const pL = px - x0, pR = x1 - px, pB = pz - z0, pT = z1 - pz;
          const m = Math.min(pL, pR, pB, pT);
          if (m === pL) { this.pos.x -= pL; this.vel.x = Math.min(0, this.vel.x); }
          else if (m === pR) { this.pos.x += pR; this.vel.x = Math.max(0, this.vel.x); }
          else if (m === pB) { this.pos.z -= pB; this.vel.z = Math.min(0, this.vel.z); }
          else { this.pos.z += pT; this.vel.z = Math.max(0, this.vel.z); }
        }
      }
    }

    // відкритий люк: вода з палуби тече в трюм; повний трюм — човен іде на дно
    if (this.hatchOpen && this.deckWater > 8) this.bilge = Math.min(100, this.bilge + this.deckWater * 0.05 * dt);
    if (this.hatchOpen && weather.rain > 0.4) this.bilge = Math.min(100, this.bilge + weather.rain * 0.25 * dt);
    // відчинені двері каюти: хвиля, що заливає кокпіт, тече по трапу вниз
    if (this.doorOpen && this.deckWater > 15) this.bilge = Math.min(100, this.bilge + this.deckWater * 0.035 * dt);
    if (this.bilge >= 100) game.damage(12 * dt);

    // шторм + мокра палуба → просочення корпусу
    if (this.deckWater > 85 && weather.intensity > 0.95) {
      game.damage(1.6 * dt);
    }

    if (game.hull <= 0 && !this.sinking) {
      this.sinking = true;
      this.sinkTimer = 0;
    }

    // приборна панель + прапор на мачті
    this.updatePanel(dt, game, weather, this.night);
    this.updateFlag(dt, t, weather);

    // звук
    audio.setEngine(Math.abs(this.throttle), this.engineOn, this.engineLoad);

    this.syncTransform();
    this.anchor.update(dt, this, audio);
  }

  /**
   * Кооп-клієнт: поза приходить від капітана (applyNet), тут — лише візуал:
   * паруси, бризки, вихлоп, прилади, звук. Фізики й пошкоджень немає.
   */
  /**
   * Швартовна сходня: коли яхта стоїть біля причалу, з борту, що до нього,
   * опускається дошка з поручнями — по ній ходять на причал і назад без
   * перелазіння через леєри.
   */
  updateGangway(dt: number, dock: Platform) {
    let side: -1 | 0 | 1 = 0;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < 1.2 && Math.hypot(this.pos.x - this.moor.x, this.pos.z - this.moor.z) < 6) {
      for (const s of [-1, 1] as const) {
        const edge = deckLimitX(Boat.GANG_Z, 0) + 0.15;
        const p = this.localToWorld(s * (edge + 0.7), DECK_Y, Boat.GANG_Z, this._v);
        if (p.x > dock.x0 - 0.2 && p.x < dock.x1 + 0.2 && p.z > dock.z0 - 0.2 && p.z < dock.z1 + 0.2) {
          side = s;
          break;
        }
      }
    }
    if (side) {
      // довжина — до краю причалу (по світу), з запасом на ліжко дошки
      const edge = deckLimitX(Boat.GANG_Z, 0) + 0.15;
      const a = this.localToWorld(side * edge, DECK_Y, Boat.GANG_Z, this._v);
      const dz = a.z > dock.z1 ? a.z - dock.z1 : a.z < dock.z0 ? dock.z0 - a.z : 0;
      const dx = a.x > dock.x1 ? a.x - dock.x1 : a.x < dock.x0 ? dock.x0 - a.x : 0;
      const reach = Math.hypot(dx, dz);
      this.gangLen = clamp(reach + 0.6, 0.8, 2.4);
      // причал вищий за палубу (човен сидить у воді) — дошка йде вгору
      this.gangTilt = Math.atan2(dock.y - a.y, Math.max(0.3, reach + 0.4));
      this.gangSide = side;
    }
    const want = side ? 1 : 0;
    this.gangA += (want - this.gangA) * (1 - Math.exp(-dt * 4));
    if (!side && this.gangA < 0.05) this.gangSide = 0;
    if (!this.gang) {
      if (!this.gangSide) return;
      this.gang = this.buildGangway();
    }
    const g = this.gang;
    g.visible = this.gangA > 0.03;
    if (!g.visible) return;
    const s = this.gangSide || 1;
    const edge = deckLimitX(Boat.GANG_Z, 0) + 0.15;
    g.position.set(s * edge, DECK_Y + 0.02, Boat.GANG_Z);
    g.rotation.set(0, s > 0 ? 0 : Math.PI, 0);
    // розкладається з борту: від вертикалі (прибрана) до майже горизонталі
    const plank = g.children[0] as THREE.Object3D;
    plank.scale.set(this.gangLen, 1, 1);
    // прибрана — стоїть вертикально біля леєрів, опущена — лягає на причал
    plank.rotation.z = (1 - this.gangA) * 1.35 + this.gangA * this.gangTilt;
  }

  private buildGangway(): THREE.Group {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.75 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8cdd2, roughness: 0.3, metalness: 0.85 });
    // дошка (довжина 1 м по +x, масштабується) з поперечними планками
    const plank = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 0.5), wood);
    board.position.x = 0.5;
    board.castShadow = true;
    board.receiveShadow = true;
    plank.add(board);
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.48), wood);
      c.position.set(0.1 + i * 0.2, 0.03, 0);
      plank.add(c);
    }
    for (const z of [-0.24, 0.24]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 0.02), steel);
      rail.position.set(0.5, 0.55, z);
      plank.add(rail);
      for (const x of [0.05, 0.95]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 6), steel);
        post.position.set(x, 0.28, z);
        plank.add(post);
      }
    }
    g.add(plank);
    this.group.add(g);
    return g;
  }

  /** прибрати зі сцени (чужа яхта покинула кімнату) */
  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.anchor.dispose();
  }

  updateRemote(dt: number, t: number, ocean: Ocean, weather: Weather, game: GameState, particles: ParticlePool, audio: AudioEngine | null) {
    // у чужої/екіпажної яхти кутових швидкостей немає — беремо з різниці кадрів
    if (dt > 0) {
      const rr = (this.roll - this.remRoll) / dt, yr = Math.atan2(Math.sin(this.heading - this.remHead), Math.cos(this.heading - this.remHead)) / dt;
      this.sails.setHullMotion(this.roll, Math.max(-3, Math.min(3, rr)), Math.max(-2, Math.min(2, yr)));
    }
    this.remRoll = this.roll;
    this.remHead = this.heading;
    this.sails.compute(dt, this.heading, this.vel, weather.windDir, weather.wind);
    this.sails.updateMeshes(dt, performance.now() / 1000);
    this.sails.updateWindex(this.heading, this.vel, weather.windDir);
    const deckWorld = this.pos.y + BOAT.deckY;
    const crest = ocean.heightAt(this.pos.x, this.pos.z, t) + 0.5 * weather.intensity;
    if (crest > deckWorld - 0.12 && weather.intensity > 0.45 && Math.random() < dt * 2) {
      particles.splash(this.pos.x + rand(-1.5, 1.5), deckWorld, this.pos.z + rand(-1.5, 1.5), 0.7);
    }
    this.syncTransform();
    const speed = this.vel.length();
    const fwd = this.forward(this._fwd);
    this.localToWorld(0, 0.7, 4.3, this.bowPoint);
    particles.spray(this.bowPoint, fwd, speed * Math.abs(this.throttle) + speed * 0.4, dt);
    if (this.engineOn && this.throttle > 0.05) {
      this.localToWorld(this.exhaustTip.x, this.exhaustTip.y, this.exhaustTip.z, this._t);
      particles.exhaust(this._t, Math.abs(this.throttle), dt);
    }
    this.engineLoad = clamp(speed / 10, 0, 1) * Math.abs(this.throttle);
    this.updateFlag(dt, t, weather);
    this.anchor.update(dt, this, audio);
    if (!audio) return;
    this.updatePanel(dt, game, weather, this.night);
    audio.setEngine(Math.abs(this.throttle), this.engineOn, this.engineLoad);
  }

  /**
   * Удари хвиль, як у реальності:
   *  • слемінг — ніс вилітає з хвилі й плескається днищем; сила росте з
   *    вертикальною швидкістю носа відносно води й ходом у схил хвилі
   *    (на повному газі проти крутої хвилі — тріщить корпус);
   *  • удар у борт — крутий гребінь шторму, що йде впоперек, накриває борт:
   *    кидає в крен, заливає палубу (найнебезпечніше — стояти лагом до хвилі).
   * Порада гравцю: скинути газ і брати хвилю носом під кутом 20–40°.
   */
  private updateSlam(dt: number, t: number, ocean: Ocean, game: GameState, particles: ParticlePool, fwd: THREE.Vector3) {
    this.slamCd -= dt;
    this.beamCd -= dt;
    const hullLvl = game.upgrades.hull ?? 0;
    const armor = 1 - 0.1 * hullLvl;
    const u = this.vel.x * fwd.x + this.vel.z * fwd.z;
    const DT = 0.05;

    // ── ніс ──
    const BZ = 3.6;
    const p = this.physicsToLocal(0, 0.25, BZ, this._sv);
    const h = ocean.heightAt(p.x, p.z, t);
    const depth = h - p.y;
    if (depth < -0.08) this.bowOut = true;
    else if (depth > 0 && this.bowOut) {
      this.bowOut = false;
      const waterVy = (h - ocean.heightAt(p.x, p.z, t - DT)) / DT;
      const ptVy = this.vel.y - this.angVel.x * BZ;
      // схил хвилі попереду: хід у висхідний схил додає швидкості удару
      const ahead = ocean.heightAt(p.x + fwd.x * 0.6, p.z + fwd.z * 0.6, t);
      const slope = Math.max(0, (ahead - h) / 0.6);
      const vImp = Math.max(0, waterVy - ptVy) + 1.4 * Math.max(0, u) * slope;
      if (vImp > 2.4 && this.slamCd <= 0) {
        this.slamCd = 0.7;
        // найсильніший удар — до 14 міцності (корпус не ламається за один раз)
        const dmg = Math.min(14, 2.2 * Math.pow(vImp - 2.4, 1.5)) * armor;
        game.damage(dmg);
        // удар гасить хід і підкидає ніс
        if (u > 0) {
          const k = Math.min(0.35, 0.06 * vImp);
          this.vel.x -= fwd.x * u * k;
          this.vel.z -= fwd.z * u * k;
        }
        this.angVel.x -= Math.min(0.5, vImp * 0.06);
        particles.splash(p.x, h + 0.2, p.z, Math.min(2.5, 0.6 + vImp * 0.25));
        particles.splash(p.x + fwd.z * 1.0, h + 0.2, p.z - fwd.x * 1.0, 1.0);
        particles.splash(p.x - fwd.z * 1.0, h + 0.2, p.z + fwd.x * 1.0, 1.0);
        this.onSlam?.(dmg, 'bow', vImp);
      }
    }

    // ── борт: крутий гребінь, що набігає збоку ──
    if (this.beamCd <= 0) {
      for (const s of [-1, 1]) {
        const q = this.physicsToLocal(s * 1.55, 0.55, 0.3, this._sv2);
        const hb = ocean.heightAt(q.x, q.z, t);
        const db = hb - q.y;
        if (db < 0.35) continue;
        const wVy = (hb - ocean.heightAt(q.x, q.z, t - DT)) / DT;
        const ptVy = this.vel.y + this.angVel.z * s * 1.55;
        const vImp = wVy - ptVy;
        if (vImp > 2.6) {
          this.beamCd = 2.0;
          const dmg = Math.min(10, 1.8 * Math.pow(vImp - 2.6, 1.5)) * armor;
          game.damage(dmg);
          // гребінь штовхає борт угору й убік — крен від хвилі
          this.angVel.z += s * Math.min(0.9, vImp * 0.12);
          this.vel.x -= fwd.z * s * Math.min(1.5, vImp * 0.25);
          this.vel.z += fwd.x * s * Math.min(1.5, vImp * 0.25);
          this.deckWater = clamp(this.deckWater + vImp * 7, 0, 100);
          particles.splash(q.x, hb + 0.3, q.z, Math.min(2.5, 0.8 + vImp * 0.3));
          this.onSlam?.(dmg, 'beam', vImp);
          break;
        }
      }
    }
  }

  /** кооп: компактна поза для мережі */
  netState(): number[] {
    const r = (v: number, k = 1000) => Math.round(v * k) / k;
    return [
      r(this.pos.x), r(this.pos.y), r(this.pos.z), r(this.heading, 1e4), r(this.pitch, 1e4), r(this.roll, 1e4),
      r(this.vel.x, 100), r(this.vel.y, 100), r(this.vel.z, 100), r(this.throttle, 100), r(this.rudder, 100),
      this.engineOn ? 1 : 0, r(this.deckWater, 10), this.sails.mode, this.sinking ? 1 : 0,
      this.hatchOpen ? 1 : 0, r(this.bilge, 10), this.doorOpen ? 1 : 0,
      ...this.anchor.netState(),
    ];
  }

  /** кооп-клієнт: виставити позу (вже інтерпольовану) */
  applyNet(b: number[]) {
    this.pos.set(b[0], b[1], b[2]);
    this.heading = b[3];
    this.pitch = b[4];
    this.roll = b[5];
    this.vel.set(b[6], b[7], b[8]);
    this.throttle = b[9];
    this.rudder = b[10];
    this.engineOn = b[11] === 1;
    this.deckWater = b[12];
    this.sails.mode = b[13] as 0 | 1 | 2;
    this.sinking = b[14] === 1;
    if (b.length > 16) {
      this.hatchOpen = b[15] >= 0.5;
      this.bilge = b[16];
    }
    if (b.length > 17) this.doorOpen = b[17] >= 0.5;
    if (b.length > 18) this.anchor.applyNet(b, 18);
  }

  /** сили вітрил → загальні сили/моменти кадру; анімація парусів */
  private applySails(dt: number, weather: Weather) {
    this.sails.setHullMotion(this.roll, this.angVel.z, this.angVel.y);
    const sf = this.sails.compute(dt, this.heading, this.vel, weather.windDir, weather.wind);
    this._f.x += sf.fx;
    this._f.z += sf.fz;
    this._t.z += sf.torqueRoll;
    this.sails.updateMeshes(dt, performance.now() / 1000);
    this.sails.updateWindex(this.heading, this.vel, weather.windDir);
  }

  /** приборна панель: стрілки RPM/паливо/швидкість, компасна шкала, лампа ON, дисплей */
  updatePanel(dt: number, game: GameState, weather: Weather, night: boolean) {
    const kn = this.vel.length() * 1.944; // вузли
    const rpm = this.engineOn ? 700 + Math.abs(this.throttle) * 2100 + this.engineLoad * 400 : 0;
    const fuelMax = eff.maxFuel(game.upgrades.fuel);
    const sweep = (n: THREE.Group, f: number) => {
      n.rotation.z = Math.PI * 0.75 - clamp(f, 0, 1) * Math.PI * 1.5; // за годинниковою
    };
    sweep(this.needleRpm, rpm / 3000);
    sweep(this.needleFuel, fuelMax > 0 ? game.fuel / fuelMax : 0);
    sweep(this.needleSpeed, kn / 12);
    // картка: під курсовою рискою — компасний курс (π − heading)
    this.compassCard.rotation.z = Math.PI - this.heading;
    if (this.onLampMat) this.onLampMat.emissiveIntensity = this.engineOn ? 0.9 : 0.05;
    if (this.helmDisplay && this.helmDisplay.mesh.visible) {
      const thr = Math.abs(this.throttle);
      // витрата як у main: |газ|^1.4 · 0.07 л/с
      const lps = Math.pow(thr, 1.4) * 0.07;
      const spd = this.vel.length();
      const rangeKm = this.engineOn && thr > 0.05 && spd > 0.3 ? (game.fuel / lps) * spd / 1000 : null;
      const s = this.sails;
      this.helmDisplay.update(dt, {
        headingDeg: compassDeg(this.heading),
        knots: kn,
        throttle: this.throttle,
        engineOn: this.engineOn,
        rpm,
        fuel: game.fuel,
        fuelMax,
        rangeKm,
        awa: s.awa,
        aws: s.aws,
        tws: s.tws,
        windFromStarboard: s.windFromStarboard,
        sailLabel: s.label(),
        sailMode: s.mode,
        overload: s.overload,
        luffing: s.luffing,
        wave: 0.1 + weather.intensity * 2.5,
        zone: ZONE_NAMES[zoneFromDist(Math.hypot(this.pos.x, this.pos.z))],
        hull: game.hull,
        hullMax: game.maxHull,
        night,
        depth: depthAt(this.pos.x, this.pos.z),
      });
    }
  }

  // ── прапор: полотнище за вимпельним вітром ──
  private flagYaw = Math.PI; // куди «летить» прапор (у локалі човна, 0 = до носа)
  private flagWind = 0;      // згладжена сила вимпельного вітру, м/с
  private flagPhase = 0;

  private updateFlag(dt: number, t: number, weather: Weather) {
    const flag = this.flag;
    if (!flag) return;
    // вимпельний вітер у локалі човна (+Z — нос, +X — лівий борт)
    const tws = trueWindSpeed(weather.wind);
    const awx = Math.sin(weather.windDir) * tws - this.vel.x;
    const awz = -Math.cos(weather.windDir) * tws - this.vel.z;
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const lx = awx * ch - awz * sh;
    const lz = awx * sh + awz * ch;
    const aws = Math.hypot(lx, lz);
    const k = 1 - Math.exp(-dt * 1.2);
    if (aws > 0.2) this.flagYaw += wrapAngle(Math.atan2(lx, lz) - this.flagYaw) * k;
    this.flagWind += (aws - this.flagWind) * k;
    const w = this.flagWind;
    // слабкий вітер — полотнище обвисає вздовж древка; сильний — летить рівно й тріпоче
    const droop = (1 - clamp((w - 0.8) / 5, 0, 1)) * 1.25;
    const amp = 0.035 + 0.05 * clamp(w / 6, 0, 1) - 0.03 * clamp((w - 10) / 8, 0, 1);
    // фаза хвилі накопичується (зміна сили вітру не «стрибає» фазою — раніше t·om смикав полотнище)
    const om = 3.2 + Math.min(w, 14) * 0.32;
    this.flagPhase += om * dt;
    const ph = this.flagPhase;
    const L = 0.62, H = 0.41;
    const dx = Math.sin(this.flagYaw), dz = Math.cos(this.flagYaw);
    const pos = (flag.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
    let idx = 0;
    for (let j = 0; j <= FLAG_NV; j++) {
      const v = 1 - j / FLAG_NV; // 1 — верхній край (синій), 0 — нижній
      for (let i = 0; i <= FLAG_NU; i++) {
        const u = i / FLAG_NU;   // 0 — біля древка
        // кут провисання росте до вільного краю
        const a = droop * (0.55 + 0.45 * u);
        const ca = Math.cos(a), sa = Math.sin(a);
        // хорда: горизонтально за вітром → донизу при провисанні
        const cx = dx * ca, cy = -sa, cz = dz * ca;
        // «вгору» полотнища — перпендикуляр до хорди у вертикальній площині
        const ux = -dx * sa, uy = ca, uz = -dz * sa;
        const wave = Math.sin(u * 6.5 - ph + v * 0.5) * amp * (0.25 + u) + Math.sin(u * 11 - ph * 1.6) * amp * 0.12 * u;
        const y = (v - 1) * H; // верхній край — біля наконечника
        pos.setXYZ(idx++,
          cx * u * L + ux * y + dz * wave,
          cy * u * L + uy * y,
          cz * u * L + uz * y - dx * wave);
      }
    }
    pos.needsUpdate = true;
    (flag.geometry as THREE.BufferGeometry).computeVertexNormals();
  }

  /** осушення палуби помпою */
  dryDeck(dt: number) {
    this.bilge = Math.max(0, this.bilge - 16 * dt);
    this.deckWater = Math.max(0, this.deckWater - 34 * dt);
  }

  /** перезапустити двигун */
  restartEngine() {
    this.engineOn = true;
  }

  /** повне відновлення (затоплення) */
  reset(x: number, z: number, heading: number) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.heading = heading;
    this.pitch = 0;
    this.roll = 0;
    this.throttle = 0;
    this.rudder = 0;
    this.sinking = false;
    this.sinkTimer = 0;
    this.engineOn = true;
    this.deckWater = 0;
    this.bilge = 0;
    this.hatchOpen = false;
    this.doorOpen = true;
    // щойно поставлений на воду човен «сідає» — це не удар хвилі
    this.slamCd = 2;
    this.beamCd = 2;
    this.bowOut = false;
    this.anchor.reset();
    this.sails.reset();
    this.syncTransform();
  }
}
