import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { Input } from '../core/input';
import { Boat, BOAT, STATION_POS } from './boat';
import { DECK_COLLIDERS, COCKPIT, STAIR, SALOON, SOLE_Y, HALF_LEN, deckLimitX, stairY, type Box2 } from './yachtLayout';
import { Port, PORT_POINTS, type Platform } from './port';
import { Ocean } from '../core/ocean';
import type { GameState } from '../game/state';
import type { PlayerMode } from '../core/types';

// ─────────────────────────────────────────────────────────────
// Гравець: first-person на палубі / причалі / у воді.
// ─────────────────────────────────────────────────────────────

export interface Interactable {
  id: string;
  label: string;
}

const EYE = 1.62;
const WALK = 3.4;
const RUN = 5.6;
const SWIM = 2.3;

// станції в салоні (доступні лише внизу)
const CABIN_STATIONS = new Set(['kitchen', 'radio', 'bed']);
/** ближча досяжність: до щогли треба реально підійти бічною палубою */
const STATION_REACH: Record<string, number> = { sails: 1.7 };
const PLAYER_R = 0.22; // радіус тіла для колізій

/** рівень на яхті: палуба / трап компаньйона / салон у корпусі */
export type DeckLevel = 'deck' | 'stairs' | 'below';

export class Player {
  yaw = 0;
  pitch = 0;
  mode: PlayerMode = 'boat';
  /** локальні координати на палубі */
  localX = 0;
  localZ = 1.2;
  /** світлові координати (port/water) */
  wx = 0;
  wy = 1.1;
  wz = -20;
  /** керування човном */
  wheeling = false;
  /** руки зайняті вудкою (закид / боротьба): A/D/Space — для вудки, не для ходьби */
  rodBusy = false;
  /** підписи станцій вудок (залежать від того, що в руках) — задає main */
  stationText: ((id: string) => string) | null = null;
  /** у салоні (внизу або на трапі): затишок + каютні станції */
  inCabin = false;
  /** рівень на яхті та висота підлоги під ногами (локальна y) */
  level: DeckLevel = 'deck';
  floorY = BOAT.deckY;
  /** під дахом: каюта або критий кокпіт (hardtop) — захист від негоди */
  sheltered = false;
  /** найближча інтерактивна ціль */
  nearest: Interactable | null = null;
  /** позиція голови (для камери) */
  head = new THREE.Vector3();
  /** йде цього кадру (для аватара в коопі) */
  moving = false;
  /** додані нахили (хвилі, тряска) */
  shakeX = 0;
  shakeZ = 0;

  private bobPhase = 0;
  /** крок (кожні пів фази ходи) — main грає звук; поверхня: 0 дерево палуби, 1 дошки причалу, 2 бруківка/земля */
  onStep: ((surface: number, run: boolean) => void) | null = null;
  private stepAcc = 0;
  private stepTick(dt: number, rate: number, surface: number, run: boolean) {
    this.stepAcc += dt * rate;
    if (this.stepAcc >= Math.PI) {
      this.stepAcc -= Math.PI;
      this.onStep?.(surface, run);
    }
  }
  private headBob = 0;
  private railPush = 0;
  private inWaterT = 0;
  private _v = new THREE.Vector3();
  private _n = new THREE.Vector3();

  constructor(private game: GameState) {
    // старт: у критому кокпіті перед приборною панеллю. Швартувальний курс
    // (нос у світ +X) ставить причал за правим бортом: локальний +X = світ -Z.
    // yaw = 0 → погляд у світ -Z, тобто на порт; штурвал у 0.4 м попереду.
    this.mode = 'boat';
    this.localX = 0;
    this.localZ = -2.2;
    this.level = 'deck';
    this.floorY = BOAT.deckY;
    this.yaw = 0; // дивимось на порт; штурвал одразу в полі зору
  }

  /** прив'язати свіжий GameState (після «Нова гра» / «Продовжити») */
  attachGame(g: GameState) {
    this.game = g;
  }

  resetToBoat() {
    this.mode = 'boat';
    this.wheeling = false;
    this.localX = 0;
    this.localZ = -2.2;
    this.level = 'deck';
    this.floorY = BOAT.deckY;
    this.yaw = 0; // у кокпіт, погляд на штурвал/порт
  }

  /** на борту: голова з поточної пози човна (викликати після boat.update) */
  syncHead(boat: Boat) {
    if (this.mode !== 'boat') return;
    boat.localToWorld(this.localX, this.floorY + EYE, this.localZ, this.head);
    this.head.y += this.headBob;
  }

  /** свіжий кадр: миша + рух + переходи */
  update(dt: number, input: Input, boat: Boat, port: Port, ocean: Ocean, t: number) {
    const [mdx, mdy] = input.consumeMouse();
    this.yaw -= mdx * 0.0021;
    this.pitch = clamp(this.pitch - mdy * 0.0021, -1.35, 1.35);

    const running = input.down('ShiftLeft') || input.down('ShiftRight');
    const busy = this.rodBusy && !this.wheeling;
    const inF = busy ? 0 : (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const inL = busy ? 0 : (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const inUp = !busy && input.down('Space') ? 1 : 0;
    const inDown = input.down('KeyC') ? 1 : 0;

    let moving = false;
    this.inCabin = false;
    this.sheltered = false;

    if (this.mode === 'boat') {
      if (this.wheeling) {
        // керування човном
        boat.throttle = damp(boat.throttle, inF, 2.2, dt);
        // кермо: знак перевернутий — зростання heading крутить човен ЛІВОРУЧ
        // (нос (sin h, cos h) рухається проти годинникової), а D = «вправо».
        // Тому D → rudder −1 → поворот на право, як у справжнього штурвала.
        boat.rudder = damp(boat.rudder, -inL, 3.0, dt);
        // тримаємось біля штурвала
        this.localX = STATION_POS.wheel.x;
        this.localZ = STATION_POS.wheel.z;
        this.level = 'deck';
        this.floorY = BOAT.deckY;
      } else {
        const speed = running ? RUN : WALK;
        if (inF || inL) {
          const fx = -Math.sin(this.yaw);
          const fz = -Math.cos(this.yaw);
          const lx = Math.cos(this.yaw); // правий вектор камери (D = вправо)
          const lz = -Math.sin(this.yaw);
          let dx = fx * inF + lx * inL;
          let dz = fz * inF + lz * inL;
          const l = Math.hypot(dx, dz) || 1;
          dx /= l;
          dz /= l;
          // світ → локаль човна
          const ch = Math.cos(boat.heading);
          const sh = Math.sin(boat.heading);
          const ldx = dx * ch - dz * sh;
          const ldz = dx * sh + dz * ch;
          const nx = this.localX + ldx * speed * dt;
          const nz = this.localZ + ldz * speed * dt;
          moving = true;
          if (this.moveOnBoat(nx, nz, dt)) {
            // вихід за борт: поруч платформа (зазор до ~0.9 м) — зійти на неї, інакше — у воду
            const world = boat.localToWorld(this.localX, BOAT.deckY, this.localZ, this._v);
            const plat = this.platformNear(world.x, world.z, port, 0.9);
            if (plat) {
              this.mode = 'port';
              this.wx = clamp(world.x, plat.x0, plat.x1);
              this.wz = clamp(world.z, plat.z0, plat.z1);
              this.wy = plat.y;
            } else {
              this.fallIn(boat, world.x, world.z);
            }
          }
        }
      }
      // голова (остаточно — у syncHead після кроку човна, інакше камера
      // відстає на кадр від палуби й на ходу «смикається»)
      if (moving) {
        this.bobPhase += dt * (running ? 11 : 7.5);
        this.stepTick(dt, running ? 11 : 7.5, 0, running);
      }
      this.headBob = moving ? Math.sin(this.bobPhase) * 0.035 : 0;
      this.syncHead(boat);
      // у салоні? (внизу або вже на трапі нижче рівня палуби)
      this.inCabin = this.level === 'below' || (this.level === 'stairs' && this.floorY < BOAT.deckY - 0.7);
      // під дахом: салон, трап або кокпіт під hardtop — укриття в негоду
      this.sheltered =
        this.level !== 'deck' ||
        (Math.abs(this.localX) <= COCKPIT.x && this.localZ >= COCKPIT.z0 && this.localZ <= COCKPIT.z1);
    } else if (this.mode === 'port') {
      const speed = running ? RUN : WALK;
      if (inF || inL) {
        const fx = -Math.sin(this.yaw);
        const fz = -Math.cos(this.yaw);
        const lx = Math.cos(this.yaw); // правий вектор камери (D = вправо)
        const lz = -Math.sin(this.yaw);
        let dx = fx * inF + lx * inL;
        let dz = fz * inF + lz * inL;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        // будинки й реквізит — тверді
        const [nx, nz] = port.resolveSolids(this.wx + dx * speed * dt, this.wz + dz * speed * dt, PLAYER_R);
        const plat = this.platformNear(nx, nz, port, 0);
        if (plat) {
          this.wx = nx;
          // плавний ступінь по висоті (причал 1.1 ↔ земля 1.6), без «попапу»
          this.wy = damp(this.wy, plat.y, 14, dt);
          this.wz = nz;
          moving = true;
        } else {
          // крок у воду
          this.fallIn(boat, nx, nz);
        }
      }
      this.head.set(this.wx, this.wy + EYE, this.wz);
      if (moving) {
        this.bobPhase += dt * (running ? 11 : 7.5);
        this.head.y += Math.sin(this.bobPhase) * 0.03;
        this.stepTick(dt, running ? 11 : 7.5, this.wy < 1.35 ? 1 : 2, running);
      }
    } else {
      // ── вода ──
      this.inWaterT += dt;
      const speed = SWIM * (running ? 1.5 : 1);
      if (inF || inL) {
        const fx = -Math.sin(this.yaw);
        const fz = -Math.cos(this.yaw);
        const lx = Math.cos(this.yaw); // правий вектор камери (D = вправо)
        const lz = -Math.sin(this.yaw);
        let dx = fx * inF + lx * inL;
        let dz = fz * inF + lz * inL;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        this.wx += dx * speed * dt;
        this.wz += dz * speed * dt;
      }
      // плавання: голова на хвилі
      const h = ocean.heightAt(this.wx, this.wz, t);
      const targetY = h + (inUp ? 0.15 : inDown ? -1.1 : -0.35);
      this.wy = damp(this.wy, targetY, 4, dt);
      // нахил камери від нормалі хвилі
      ocean.normalAt(this.wx, this.wz, t, this._n);
      this.shakeZ = damp(this.shakeZ, -this._n.x * 0.5, 3, dt);
      this.shakeX = damp(this.shakeX, this._n.z * 0.5, 3, dt);
      this.head.set(this.wx, this.wy + 0.55, this.wz);
      if (moving === false && (inF || inL)) {
        this.bobPhase += dt * 8;
        this.head.y += Math.sin(this.bobPhase) * 0.04;
      }
    }

    this.moving = moving || (this.mode === 'water' && (inF !== 0 || inL !== 0));
    this.nearest = this.findNearest(boat, port);
  }

  /**
   * Крок по яхті з урахуванням рівнів. Повертає true, якщо гравець ступив за борт
   * (лише з палуби). Палуба: обрис корпусу + тверді рубка/щитки/тумба.
   * Трап: коридор |x| < STAIR.x, висота лінійно між палубою і салоном.
   * Салон: прохід між меблями (SALOON), нагору — лише через трап.
   */
  private moveOnBoat(nx: number, nz: number, dt: number): boolean {
    const r = PLAYER_R;
    if (this.level === 'deck') {
      [nx, nz] = this.resolveBoxes(nx, nz, DECK_COLLIDERS, r);
      // увійти на трап: з кокпіту вперед у проріз компаньйона
      if (Math.abs(nx) < STAIR.x && nz > STAIR.zTop && nz < STAIR.zTop + 0.4) this.level = 'stairs';
      // за борт: через корму (купальна платформа) одразу; через леєри — якщо
      // тиснути на них ~0.6 с (перелазимо), щоб не випасти випадково
      // (носовий пульпіт суцільний — через ніс не випасти)
      const atRail = Math.abs(nx) > deckLimitX(nz, r) + 0.02 && nz < HALF_LEN - 1.0;
      this.railPush = atRail ? this.railPush + dt : 0;
      const overboard = nz < -(HALF_LEN - 0.32) || this.railPush > 0.6;
      this.localX = clamp(nx, -deckLimitX(nz, r), deckLimitX(nz, r));
      this.localZ = clamp(nz, -(HALF_LEN - 0.35), HALF_LEN - 0.35);
      this.floorY = this.level === 'stairs' ? stairY(this.localZ) : BOAT.deckY;
      return this.level === 'deck' && overboard;
    }
    if (this.level === 'stairs') {
      const lim = STAIR.x - r * 0.6;
      this.localX = clamp(nx, -lim, lim);
      this.localZ = nz;
      if (nz < STAIR.zTop) {
        this.level = 'deck';
        this.localZ = STAIR.zTop - 0.02;
      } else if (nz > STAIR.zBot) {
        this.level = 'below';
      }
      this.floorY = this.level === 'stairs' ? stairY(this.localZ) : this.level === 'below' ? SOLE_Y : BOAT.deckY;
      return false;
    }
    // салон
    const lim = SALOON.x - r * 0.4;
    this.localX = clamp(nx, -lim, lim);
    this.localZ = clamp(nz, STAIR.zTop, SALOON.z1 - r);
    if (this.localZ < STAIR.zBot) {
      // назад на трап — лише в його коридорі
      if (Math.abs(this.localX) < STAIR.x - r * 0.6) this.level = 'stairs';
      else this.localZ = STAIR.zBot;
    }
    this.floorY = this.level === 'stairs' ? stairY(this.localZ) : SOLE_Y;
    return false;
  }

  /** витіснення з товстих AABB (тіло — коло радіуса r) */
  private resolveBoxes(x: number, z: number, boxes: Box2[], r: number): [number, number] {
    for (const w of boxes) {
      const x0 = w.x0 - r, x1 = w.x1 + r;
      const z0 = w.z0 - r, z1 = w.z1 + r;
      if (x > x0 && x < x1 && z > z0 && z < z1) {
        const pL = x - x0;
        const pR = x1 - x;
        const pB = z - z0;
        const pT = z1 - z;
        const m = Math.min(pL, pR, pB, pT);
        if (m === pL) x = x0;
        else if (m === pR) x = x1;
        else if (m === pB) z = z0;
        else z = z1;
      }
    }
    return [x, z];
  }

  /** поставити на палубу (спавн / залізти на борт) */
  private placeOnDeck(lx: number, lz: number) {
    this.level = 'deck';
    this.floorY = BOAT.deckY;
    [lx, lz] = this.resolveBoxes(lx, lz, DECK_COLLIDERS, PLAYER_R);
    const lim = deckLimitX(lz, PLAYER_R);
    this.localX = clamp(lx, -lim, lim);
    this.localZ = clamp(lz, -(HALF_LEN - 0.4), HALF_LEN - 0.4);
  }

  /** платформа під точкою; margin — допуск (напр. ступінь з палуби в зазорі до ~0.9 м) */
  private platformNear(x: number, z: number, port: Port, margin: number): Platform | null {
    for (const p of port.platforms) {
      if (x >= p.x0 - margin && x <= p.x1 + margin && z >= p.z0 - margin && z <= p.z1 + margin) return p;
    }
    return null;
  }

  private fallIn(_boat: Boat, x: number, z: number) {
    this.mode = 'water';
    this.wx = x;
    this.wz = z;
    this.wy = 0.2;
    this.inWaterT = 0;
  }

  /** найближча інтерактивна річ у радіусі */
  private findNearest(boat: Boat, port: Port): Interactable | null {
    const p = this.head;
    let best: Interactable | null = null;
    let bestD = 3.2;

    if (this.mode === 'boat') {
      // за штурвалом E завжди означає «вийти» — інакше найближчою виявлялась
      // сусідня станція і з-за керма було не встати
      if (this.wheeling) return { id: 'st:wheel', label: this.stationLabel('wheel', boat) };
      for (const [id, sp] of Object.entries(STATION_POS)) {
        // каютні станції — лише зсередини; палубні — лише на палубі
        if (this.inCabin ? !CABIN_STATIONS.has(id) : CABIN_STATIONS.has(id)) continue;
        if (!boat.stationOn(id)) continue;
        const w = boat.localToWorld(sp.x, sp.y ?? BOAT.deckY, sp.z, this._v);
        const d = Math.hypot(p.x - w.x, p.y - w.y - 0.4, p.z - w.z);
        if (d < bestD && d < (STATION_REACH[id] ?? 3.2)) {
          bestD = d;
          best = { id: 'st:' + id, label: this.stationLabel(id, boat) };
        }
      }
    } else if (this.mode === 'port') {
      for (const pt of PORT_POINTS) {
        const d = Math.hypot(this.wx - pt.x, this.wz - pt.z);
        if (d < bestD) {
          bestD = d;
          best = { id: 'port:' + pt.id, label: pt.label };
        }
      }
      // залізти на човен прямо з причалу (иначе пасажир би застряг)
      const dBoat = Math.hypot(this.wx - boat.pos.x, this.wz - boat.pos.z);
      if (dBoat < 7.0 && dBoat < bestD + 2.0) {
        best = { id: 'climb-boat', label: 'Залізти на човен' };
        bestD = dBoat;
      }
    } else {
      // у воді: залізти на човен / на причал
      const bw = new THREE.Vector3();
      boat.localToWorld(0, 0, 0, bw);
      const dBoat = Math.hypot(this.wx - bw.x, this.wz - bw.z);
      if (dBoat < 6.5) {
        best = { id: 'climb-boat', label: 'Залізти на човен' };
        bestD = dBoat;
      }
      const dock = port.platforms[0];
      if (
        this.wx > dock.x0 - 2 && this.wx < dock.x1 + 2 &&
        this.wz > dock.z0 - 2 && this.wz < dock.z1 + 2
      ) {
        const dD = Math.hypot(this.wx - clamp(this.wx, dock.x0, dock.x1), this.wz - clamp(this.wz, dock.z0, dock.z1));
        if (dD < bestD + 2) {
          best = { id: 'climb-dock', label: 'Залізти на причал' };
        }
      }
    }
    return best;
  }

  private stationLabel(id: string, boat: Boat): string {
    switch (id) {
      case 'wheel': return this.wheeling ? 'Вийти зі штурвала' : 'Стати за штурвал (газ W/S, кермо A/D)';
      case 'sails': return boat.sails.mode === 0 ? 'Фал на щоглі — підняти паруси' : boat.sails.mode === 2 ? 'Риф-шкентель — взяти риф' : 'Фал — спустити паруси';
      case 'rod': return this.stationText?.('rod') ?? 'Стійка з вудками';
      case 'holder0': case 'holder1': case 'holder2': return this.stationText?.(id) ?? 'Стійка для вудки';
      case 'engine': return boat.engineOn ? 'Ремонт двигуна' : 'Запустити двигун!';
      case 'pump': return boat.deckWater > 5 ? 'Осушити палубу' : 'Помпа (палуба суха)';
      case 'kitchen': return 'Кухня — сварити рибу';
      case 'radio': return 'Радіо — прогноз';
      case 'bed': return 'Койка — спати';
      default: return id;
    }
  }

  /** E: дія. Повертає true, якщо гравець сам обробив (перехід режиму). */
  interact(boat: Boat, port: Port, audio: { click(): void }): string | null {
    const n = this.nearest;
    if (!n) return null;
    audio.click();

    if (n.id === 'climb-boat') {
      const w = new THREE.Vector3();
      boat.localToWorld(0, 0, 0, w);
      const local = boat.worldToLocal(this.wx, this.wy, this.wz, this._v);
      this.placeOnDeck(local.x, local.z);
      this.mode = 'boat';
      this.shakeX = 0;
      this.shakeZ = 0;
      return null;
    }
    if (n.id === 'climb-dock') {
      const dock = port.platforms[0];
      this.wx = clamp(this.wx, dock.x0 + 0.5, dock.x1 - 0.5);
      this.wz = clamp(this.wz, dock.z0 + 0.5, dock.z1 - 0.5);
      this.wy = dock.y;
      this.mode = 'port';
      this.shakeX = 0;
      this.shakeZ = 0;
      return null;
    }
    return n.id;
  }

  /** енергія: відновлення в спокої (каюта — затишок, кокпіт під дахом — теж) */
  updateEnergy(dt: number) {
    if (this.mode === 'boat' && !this.wheeling) {
      const rate = this.inCabin ? 1.5 : this.sheltered ? 1.2 : 0.9;
      this.game.addEnergy(rate * dt);
    } else if (this.mode === 'port') {
      this.game.addEnergy(1.2 * dt);
    }
  }
}
