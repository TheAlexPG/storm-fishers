import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { Input } from '../core/input';
import { Boat, BOAT, STATION_POS } from './boat';
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

// стіни каюти (локальні AABB) — тверді; гравець заходить через дверний отвір
// у кормовій стіні (x -0.2..0.7). Стіни товсті (0.25), отже тунелювання неможливе.
const CABIN_WALLS = [
  { x0: -0.9, x1: 1.1, z0: -0.8, z1: -0.55 },    // носова стіна
  { x0: -0.9, x1: -0.65, z0: -3.05, z1: -0.55 }, // лівий борт
  { x0: 0.85, x1: 1.1, z0: -3.05, z1: -0.55 },   // правий борт
  { x0: -0.9, x1: -0.2, z0: -3.05, z1: -2.8 },   // корма (ліворуч дверей)
  { x0: 0.7, x1: 1.1, z0: -3.05, z1: -2.8 },     // корма (праворуч дверей)
];
// внутрішнє приміщення каюти (для прапорця inCabin і затишних ефектів)
const CABIN_IN = { x0: -0.65, x1: 0.85, z0: -2.8, z1: -0.8 };
// станції всередині каюти (доступні лише зсередини)
const CABIN_STATIONS = new Set(['kitchen', 'radio', 'bed']);
const PLAYER_R = 0.28; // радіус тіла для колізії зі стінами

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
  /** стоїмо всередині каюти (затишок + каютні станції) */
  inCabin = false;
  /** найближча інтерактивна ціль */
  nearest: Interactable | null = null;
  /** позиція голови (для камери) */
  head = new THREE.Vector3();
  /** додані нахили (хвилі, тряска) */
  shakeX = 0;
  shakeZ = 0;

  private bobPhase = 0;
  private inWaterT = 0;
  private _v = new THREE.Vector3();
  private _n = new THREE.Vector3();

  constructor(private game: GameState) {
    // старт: на палубі біля шварту. Швартувальний курс (нос у світ +X)
    // ставить причал за правим бортом: локальний +X = світ -Z.
    // yaw = 0 → погляд у світ -Z, тобто на порт.
    this.mode = 'boat';
    this.localX = 0;
    this.localZ = 1.2;
    this.yaw = 0; // дивимось на порт
  }

  /** прив'язати свіжий GameState (після «Нова гра» / «Продовжити») */
  attachGame(g: GameState) {
    this.game = g;
  }

  resetToBoat() {
    this.mode = 'boat';
    this.wheeling = false;
    this.localX = 0;
    this.localZ = 1.2;
  }

  /** свіжий кадр: миша + рух + переходи */
  update(dt: number, input: Input, boat: Boat, port: Port, ocean: Ocean, t: number) {
    const [mdx, mdy] = input.consumeMouse();
    this.yaw -= mdx * 0.0021;
    this.pitch = clamp(this.pitch - mdy * 0.0021, -1.35, 1.35);

    const running = input.down('ShiftLeft') || input.down('ShiftRight');
    const inF = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const inL = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const inUp = input.down('Space') ? 1 : 0;
    const inDown = input.down('KeyC') ? 1 : 0;

    let moving = false;
    this.inCabin = false;

    if (this.mode === 'boat') {
      if (this.wheeling) {
        // керування човном
        boat.throttle = damp(boat.throttle, inF, 2.2, dt);
        boat.rudder = damp(boat.rudder, inL, 3.0, dt);
        // тримаємось біля штурвала
        this.localX = STATION_POS.wheel.x;
        this.localZ = STATION_POS.wheel.z;
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
          let nx = this.localX + ldx * speed * dt;
          let nz = this.localZ + ldz * speed * dt;
          // каюта — стіни (пройти можна лише через дверний отвір у кормі)
          [nx, nz] = this.resolveCabin(nx, nz);
          this.localX = clamp(nx, -1.3, 1.3);
          this.localZ = clamp(nz, -4.4, 4.4);
          moving = true;
          // вихід за борт: поруч платформа (зазор до ~0.9 м) — сойти на неї, інакше — у воду
          if (Math.abs(this.localX) > 1.28 || Math.abs(this.localZ) > 4.38) {
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
      // голова
      boat.localToWorld(this.localX, BOAT.deckY + EYE, this.localZ, this.head);
      if (moving) {
        this.bobPhase += dt * (running ? 11 : 7.5);
        this.head.y += Math.sin(this.bobPhase) * 0.035;
      }
      // всередині каюти?
      this.inCabin =
        this.localX > CABIN_IN.x0 && this.localX < CABIN_IN.x1 &&
        this.localZ > CABIN_IN.z0 && this.localZ < CABIN_IN.z1;
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
        const nx = this.wx + dx * speed * dt;
        const nz = this.wz + dz * speed * dt;
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

    this.nearest = this.findNearest(boat, port);
  }

  /** витіснення зі стін каюти: тіло — коло радіуса PLAYER_R, стіни — товсті AABB */
  private resolveCabin(x: number, z: number): [number, number] {
    for (const w of CABIN_WALLS) {
      const x0 = w.x0 - PLAYER_R, x1 = w.x1 + PLAYER_R;
      const z0 = w.z0 - PLAYER_R, z1 = w.z1 + PLAYER_R;
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
      for (const [id, sp] of Object.entries(STATION_POS)) {
        // каютні станції — лише зсередини; палубні — лише на палубі
        if (this.inCabin ? !CABIN_STATIONS.has(id) : CABIN_STATIONS.has(id)) continue;
        const w = boat.localToWorld(sp.x, BOAT.deckY, sp.z, this._v);
        const d = Math.hypot(p.x - w.x, p.y - w.y - 0.4, p.z - w.z);
        if (d < bestD) {
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
      case 'wheel': return this.wheeling ? 'Вийти зі штурвала' : 'Керування (газ W/S, рильє A/D)';
      case 'rod': return 'Вудка — закинути / зняти';
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
      let lx = clamp(local.x, -1.1, 1.1);
      let lz = clamp(local.z, -4.2, 4.2);
      [lx, lz] = this.resolveCabin(lx, lz); // не спавнитись всередині стіни каюти
      this.localX = clamp(lx, -1.3, 1.3);
      this.localZ = clamp(lz, -4.4, 4.4);
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

  /** енергія: відновлення в спокої (у каюті — затишок, відновлюється швидше) */
  updateEnergy(dt: number) {
    if (this.mode === 'boat' && !this.wheeling) {
      this.game.addEnergy((this.inCabin ? 1.5 : 0.9) * dt);
    } else if (this.mode === 'port') {
      this.game.addEnergy(1.2 * dt);
    }
  }
}
