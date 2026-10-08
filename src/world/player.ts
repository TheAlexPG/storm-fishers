import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { Input } from '../core/input';
import { Boat, BOAT, STATION_POS } from './boat';
import { Port, PORT_POINTS } from './port';
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

// каюта (локальні межі для колізії ходьби)
const CABIN = { x0: -0.62, x1: 1.08, z0: -3.05, z1: -0.62 };

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
    // старт: на причалі біля човна
    this.mode = 'boat';
    this.localX = 0;
    this.localZ = 1.2;
    this.yaw = Math.PI; // дивимось на порт
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
          const lx = -Math.cos(this.yaw);
          const lz = Math.sin(this.yaw);
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
          // каюта — стіна
          if (
            nx > CABIN.x0 - 0.25 && nx < CABIN.x1 + 0.25 &&
            nz > CABIN.z0 - 0.25 && nz < CABIN.z1 + 0.25
          ) {
            // витискаємо по мінімальному проникненню
            const pL = nx - (CABIN.x0 - 0.25);
            const pR = (CABIN.x1 + 0.25) - nx;
            const pB = nz - (CABIN.z0 - 0.25);
            const pT = (CABIN.z1 + 0.25) - nz;
            const m = Math.min(pL, pR, pB, pT);
            if (m === pL) nx = CABIN.x0 - 0.25;
            else if (m === pR) nx = CABIN.x1 + 0.25;
            else if (m === pB) nz = CABIN.z0 - 0.25;
            else nz = CABIN.z1 + 0.25;
          }
          this.localX = clamp(nx, -1.3, 1.3);
          this.localZ = clamp(nz, -4.4, 4.4);
          moving = true;
          // вихід за борт
          if (Math.abs(this.localX) > 1.28 || Math.abs(this.localZ) > 4.38) {
            const world = boat.localToWorld(this.localX, BOAT.deckY, this.localZ, this._v);
            const nearDock = this.onDock(world.x, world.z, port);
            if (nearDock) {
              this.mode = 'port';
              this.wx = world.x;
              this.wz = world.z;
              this.wy = 1.1;
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
    } else if (this.mode === 'port') {
      const speed = running ? RUN : WALK;
      if (inF || inL) {
        const fx = -Math.sin(this.yaw);
        const fz = -Math.cos(this.yaw);
        const lx = -Math.cos(this.yaw);
        const lz = Math.sin(this.yaw);
        let dx = fx * inF + lx * inL;
        let dz = fz * inF + lz * inL;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        const nx = this.wx + dx * speed * dt;
        const nz = this.wz + dz * speed * dt;
        const plat = this.platformAt(nx, nz, port);
        if (plat) {
          this.wx = nx;
          this.wy = plat.y;
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
        const lx = -Math.cos(this.yaw);
        const lz = Math.sin(this.yaw);
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

  private onDock(x: number, z: number, port: Port): boolean {
    return this.platformAt(x, z, port) != null;
  }

  private platformAt(x: number, z: number, port: Port): { y: number } | null {
    for (const p of port.platforms) {
      if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return { y: p.y };
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
      this.localX = clamp(local.x, -1.1, 1.1);
      this.localZ = clamp(local.z, -4.2, 4.2);
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

  /** енергія: відновлення в спокої */
  updateEnergy(dt: number) {
    if (this.mode === 'boat' && !this.wheeling) {
      this.game.addEnergy(0.9 * dt);
    } else if (this.mode === 'port') {
      this.game.addEnergy(1.2 * dt);
    }
  }
}
