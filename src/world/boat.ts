import * as THREE from 'three';
import { Ocean } from '../core/ocean';
import { clamp, rand } from '../core/math';
import { eff } from '../game/upgrades';
import type { GameState } from '../game/state';
import type { Weather } from '../core/weather';
import type { ParticlePool } from './particles';
import type { AudioEngine } from '../core/audio';
import type { Platform } from './port';
import { YachtBuilder } from './yachtModel';
import { SailRig } from './sails';
import { DECK_Y, SOLE_Y } from './yachtLayout';

// ─────────────────────────────────────────────────────────────
// Вітрильна яхта «Шторм» (меш — yachtModel.ts, компонування — yachtLayout.ts):
// кокпіт під hardtop, рубка з трапом у салон у корпусі, щогла з парусами.
// Фізика: буївність 3 шари × 5×3, двигун, рильє, вітер, затоплення палуби.
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

// станції (локальні координати палуби, y = deckY)
export const STATION_POS: Record<string, { x: number; z: number; y?: number }> = {
  wheel: { x: 0, z: -3.75 },
  panel: { x: 0, z: -2.95, y: DECK_Y + 0.6 },
  engine: { x: 0.62, z: -4.05 },
  pump: { x: -0.62, z: -4.05 },
  rod: { x: 0, z: 3.9 },
  sails: { x: -0.75, z: -2.75 },
  // салон у корпусі (y = підлога салону)
  kitchen: { x: -0.4, z: 1.15, y: SOLE_Y },
  radio: { x: 0.4, z: 0.95, y: SOLE_Y },
  bed: { x: 0, z: 2.45, y: SOLE_Y },
};

export interface RockObstacle {
  x: number;
  z: number;
  r: number;
}

export class Boat {
  group = new THREE.Group();
  // фізика
  pos = new THREE.Vector3(MOOR.x, 0, MOOR.z);
  vel = new THREE.Vector3();
  heading = MOOR_HEADING; // 0 → нос на +Z; старт — швартувальний курс
  pitch = 0;
  roll = 0;
  angVel = new THREE.Vector3();
  throttle = 0;
  rudder = 0;
  engineOn = true;
  engineLoad = 0;
  deckWater = 0;
  sinking = false;
  sinkTimer = 0;

  // події для світу
  onHullHit: ((power: number, pos: THREE.Vector3) => void) | null = null;
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
  private _n = new THREE.Vector3();
  private _f = new THREE.Vector3();
  private _r = new THREE.Vector3();
  private _t = new THREE.Vector3();

  // візуали апгрейдів
  private upg: Record<string, THREE.Object3D[]> = {};
  private hullMats: THREE.MeshStandardMaterial[] = [];
  private interiorLight!: THREE.PointLight;
  private cockpitLight!: THREE.PointLight;
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private lights: Array<{ light: THREE.PointLight; lamp: THREE.Mesh }> = [];
  private spotlight: THREE.SpotLight | null = null;
  private exhaustTip = new THREE.Vector3();
  private rodTip = new THREE.Vector3(0, 2.2, 4.45);
  private bowPoint = new THREE.Vector3(0, 0.6, 4.4);

  // приборна панель: стрілки (RPM/паливо/швидкість) + компасна шкала + лампа ON
  private needleRpm = new THREE.Group();
  private needleFuel = new THREE.Group();
  private needleSpeed = new THREE.Group();
  private compassCard = new THREE.Group();
  private onLampMat: THREE.MeshStandardMaterial | null = null;
  private flag: THREE.Mesh | null = null;

  // маркери станцій
  stationMarkers: THREE.Group = new THREE.Group();
  /** вітрила (грот + стаксель), сили — у applySails */
  sails!: SailRig;

  constructor(private scene: THREE.Scene) {
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
    this.flag = r.flag;
    this.exhaustTip.copy(r.exhaustTip);
    this.upg = r.upg;
    this.lights = r.lights;
    this.spotlight = r.spotlight;
    this.sails = new SailRig(this.group, r.furledJib);

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

  /** застосувати рівні апгрейдів до mesh */
  applyUpgrades(levels: Record<string, number>, timeDaylight: number) {
    for (const [id, arr] of Object.entries(this.upg)) {
      const lvl = levels[id] ?? 0;
      for (const o of arr) {
        const need = (o.userData.lvl ?? 0) as number;
        o.visible = need > 0 && need <= lvl;
      }
    }
    // колір корпусу по рівню
    const hullLvl = levels.hull ?? 0;
    // білий гелькоут → «бронзово-сталевий» відтінок з рівнем корпусу
    const base = new THREE.Color(0xffffff);
    const dark = new THREE.Color(0x8d96a0);
    for (const m of this.hullMats) m.color.copy(base.lerp(dark, hullLvl * 0.14));

    // світло
    const lightsLvl = levels.lights ?? 0;
    const night = 1 - timeDaylight;
    for (const l of this.lights) {
      l.light.intensity = lightsLvl > 0 ? night * (1.2 + lightsLvl * 0.5) : 0;
      (l.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = lightsLvl > 0 ? night * 1.6 : 0;
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
    for (const m of this.glowMats) m.emissiveIntensity = 0.15 + i * 0.55;
  }

  /** підсвітити маркер станції (1 — активна/близька) */
  setStationGlow(id: string, glow: number) {
    const m = this.stationMarkers.children.find((c) => c.userData.station === id) as THREE.Mesh | undefined;
    if (m) (m.material as THREE.MeshBasicMaterial).opacity = glow * 0.85;
  }

  // ── Трансформ ──

  syncTransform() {
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
  }

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
    const maxThrust = 16500 * enginePower * wetPenalty;
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

    const buoyEff = 1 - 0.25 * (this.deckWater / 100);
    for (const lp of this.gridLocal) {
      this.localToWorld(lp.x, lp.y, lp.z, this._v);
      const h = ocean.heightAt(this._v.x, this._v.z, t);
      const depth = h - this._v.y;
      if (depth > 0) {
        // вертикальна буївність + демпфування по вертикалі
        const Fb = this.buoyK * buoyEff * depth;
        const relVy = this.vel.y + this.angVel.z * (this._v.x - this.pos.x) - this.angVel.x * (this._v.z - this.pos.z);
        const Fd = -this.buoyDamp * relVy;
        this._f.y += Fb + Fd;
        // хвиля штовхає по схилу (напрямок нормалі)
        ocean.normalAt(this._v.x, this._v.z, t, this._n);
        const push = this.wavePushK * Math.min(depth, 0.6);
        this._f.x += this._n.x * push;
        this._f.z += this._n.z * push;
        // момент від розподілу сил → крен/тангаж (τ = r × F, F — вгору)
        this._r.set(this._v.x - this.pos.x, 0, this._v.z - this.pos.z);
        this._t.x += -this._r.z * (Fb + Fd);
        this._t.z += this._r.x * (Fb + Fd);
      }
    }

    // водний опір (квадратичний → топову швидкість)
    const dragC = 190;
    this._f.x -= dragC * this.vel.x * Math.max(1, speed) + 4 * this.vel.x;
    this._f.y -= 30 * this.vel.y;
    this._f.z -= dragC * this.vel.z * Math.max(1, speed) + 4 * this.vel.z;

    // вітер
    const wind = weather.wind;
    const wvx = Math.sin(weather.windDir) * wind;
    const wvz = -Math.cos(weather.windDir) * wind;
    this._f.x += wvx * 620;
    this._f.z += wvz * 620;

    // швартування: біля причалу без газу — м'яка пружина до точки шварту.
    // тримає човен на місці від вітру/хвиль, але не заважає відійти з повним газом.
    const dMx = this.pos.x - MOOR.x;
    const dMz = this.pos.z - MOOR.z;
    const dMoor = Math.hypot(dMx, dMz);
    if (dMoor < 10 && Math.abs(this.throttle) < 0.15) {
      let fxm = -dMx * 2100 - this.vel.x * 2500;
      let fzm = -dMz * 2100 - this.vel.z * 2500;
      const fl = Math.hypot(fxm, fzm);
      if (fl > 12000) { fxm *= 12000 / fl; fzm *= 12000 / fl; }
      this._f.x += fxm;
      this._f.z += fzm;
    }

    // тяга (у кормі)
    if (thrust !== 0) {
      const stern = this.localToWorld(0, -0.3, -4.2, this._v);
      this._f.x += fwd.x * thrust;
      this._f.z += fwd.z * thrust;
      this._t.y += (stern.z - this.pos.z) * fwd.x * thrust - (stern.x - this.pos.x) * fwd.z * thrust;
      this.engineLoad = clamp(speed / 10, 0, 1) * Math.abs(this.throttle);
    }

    // вітрила: тяга від вітру (безкоштовно) + крен
    this.applySails(dt, weather);

    // рильє: момент залежить від швидкості (без ходу — не крутиться)
    const rudderTorque = this.rudder * clamp(speed, 0, 10) * 800;
    this._t.y += rudderTorque;

    // ── інтегрування (підкроки для стабільності) ──
    const rollDamp = 1 + (game.upgrades.stab ?? 0) * 0.3;
    const sub = 2;
    const sdt = dt / sub;
    for (let s = 0; s < sub; s++) {
      this.vel.x += (this._f.x / this.mass) * sdt;
      this.vel.y += (this._f.y / this.mass) * sdt;
      this.vel.z += (this._f.z / this.mass) * sdt;
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
      this.angVel.y *= 1 - 0.8 * sdt;
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

    // шторм + мокра палуба → просочення корпусу
    if (this.deckWater > 85 && weather.intensity > 0.85) {
      game.damage(1.6 * dt);
    }

    if (game.hull <= 0 && !this.sinking) {
      this.sinking = true;
      this.sinkTimer = 0;
    }

    // приборна панель + прапор на мачті
    this.updatePanel(game);
    if (this.flag) this.flag.rotation.y = Math.sin(t * 3.1) * 0.25;

    // звук
    audio.setEngine(Math.abs(this.throttle), this.engineOn, this.engineLoad);

    this.syncTransform();
  }

  /** сили вітрил → загальні сили/моменти кадру; анімація парусів */
  private applySails(dt: number, weather: Weather) {
    const sf = this.sails.compute(dt, this.heading, this.vel, weather.windDir, weather.wind);
    this._f.x += sf.fx;
    this._f.z += sf.fz;
    this._t.z += sf.torqueRoll;
    this.sails.updateMeshes(dt, performance.now() / 1000);
    this.sails.updateWindex(this.heading, this.vel, weather.windDir);
  }

  /** приборна панель: стрілки RPM/паливо/швидкість, компасна шкала, лампа ON */
  updatePanel(game: GameState) {
    const kn = this.vel.length() * 1.944; // вузли
    const rpm = this.engineOn ? 700 + Math.abs(this.throttle) * 2100 + this.engineLoad * 400 : 0;
    const fuelMax = eff.maxFuel(game.upgrades.fuel);
    const sweep = (n: THREE.Group, f: number) => {
      n.rotation.z = -Math.PI * 0.75 + clamp(f, 0, 1) * Math.PI * 1.5;
    };
    sweep(this.needleRpm, rpm / 3000);
    sweep(this.needleFuel, fuelMax > 0 ? game.fuel / fuelMax : 0);
    sweep(this.needleSpeed, kn / 12);
    this.compassCard.rotation.z = -this.heading;
    if (this.onLampMat) this.onLampMat.emissiveIntensity = this.engineOn ? 0.9 : 0.05;
  }

  /** осушення палуби помпою */
  dryDeck(dt: number) {
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
    this.sails.reset();
    this.syncTransform();
  }
}
