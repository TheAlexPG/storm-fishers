import * as THREE from 'three';
import { clamp, rand } from '../core/math';
import { Boat, BOAT } from '../world/boat';
import { DECK_COLLIDERS, deckLimitX } from '../world/yachtLayout';
import type { GameState } from './state';
import type { AudioEngine } from '../core/audio';

// ─────────────────────────────────────────────────────────────
// Станції та рутини: ремонт, помпа, кухня, сон, прибирання.
// ─────────────────────────────────────────────────────────────

export interface Stain {
  x: number;
  z: number;
  r: number;
  mesh: THREE.Mesh;
}

export interface ActiveAction {
  id: string;
  label: string;
  /** -1 = безкінечна (доки не зупиниш) */
  duration: number;
  t: number;
  energyRate: number;
  tick: (dt: number, done: boolean) => void;
}

export class Stations {
  active: ActiveAction | null = null;
  stains: Stain[] = [];
  private stainTimer = 20;
  private group = new THREE.Group();
  /** кооп-клієнт: дії над спільним човном ідуть до капітана */
  onBoatAction: ((a: 'engine' | 'repair', v?: number) => void) | null = null;

  constructor(private boat: Boat, private game: GameState, private audio: AudioEngine) {
    boat.group.add(this.group);
  }

  /** спробувати запустити станцію. Повертає true, якщо почалося. */
  tryStart(id: string): { ok: boolean; msg?: string } {
    switch (id) {
      case 'engine': {
        if (!this.boat.engineOn) {
          return this.startTimed('engine', 'Запуск двигуна…', 2.0, () => {
            this.boat.restartEngine();
            this.onBoatAction?.('engine');
            this.audio.click();
          });
        }
        if (this.game.hull >= this.game.maxHull) return { ok: false, msg: 'Корпус справний' };
        if (!this.game.spendEnergy(15)) return { ok: false, msg: 'Занадто втомлений (E → койка)' };
        return this.startTimed('engine', 'Ремонт двигуна…', 3.0, () => {
          this.game.repair(25);
          this.onBoatAction?.('repair', 25);
          this.audio.click();
        });
      }
      case 'pump': {
        if (this.active?.id === 'pump') {
          this.stop();
          return { ok: true };
        }
        if (this.boat.deckWater < 2 && this.boat.bilge < 1) return { ok: false, msg: 'Палуба й трюм сухі' };
        this.active = {
          id: 'pump',
          label: 'Помпа працює…',
          duration: -1,
          t: 0,
          energyRate: 1.6,
          tick: (dt) => {
            this.boat.dryDeck(dt);
            if ((this.boat.deckWater <= 0.5 && this.boat.bilge <= 0.5) || this.game.energy < 3) this.stop();
          },
        };
        return { ok: true };
      }
      case 'kitchen': {
        const raw = this.game.hold.find((f) => !f.cooked);
        if (!raw) return { ok: false, msg: 'Немає сирої риби' };
        if (!this.game.spendEnergy(5)) return { ok: false, msg: 'Занадто втомлений' };
        return this.startTimed('kitchen', 'Варимо рибу…', 2.5, () => {
          raw.cooked = true;
          this.game.holdHook?.('cook', raw);
          this.audio.click();
        });
      }
      case 'bed': {
        // сон: скочити до світанку
        return { ok: true, msg: '__sleep__' };
      }
      case 'clean': {
        const s = this.nearestStain();
        if (!s) return { ok: false, msg: 'Палуба чиста' };
        if (!this.game.spendEnergy(4)) return { ok: false, msg: 'Занадто втомлений' };
        return this.startTimed('clean', 'Прибираємо…', 1.8, () => {
          this.removeStain(s);
          // бонус до свіжості
          for (const f of this.game.hold) f.freshness = clamp(f.freshness + 2, 0, 100);
          this.audio.click();
        });
      }
      default:
        return { ok: false, msg: id };
    }
  }

  startTimed(id: string, label: string, duration: number, done: () => void): { ok: boolean; msg?: string } {
    this.active = {
      id,
      label,
      duration,
      t: 0,
      energyRate: 0,
      tick: (dt, isDone) => {
        if (isDone) done();
      },
    };
    return { ok: true };
  }

  stop() {
    this.active = null;
  }

  get progress(): number {
    if (!this.active || this.active.duration <= 0) return 0;
    return clamp(this.active.t / this.active.duration, 0, 1);
  }

  update(dt: number, timeH: number) {
    if (this.active) {
      this.active.t += dt;
      const d = this.active.duration;
      const isDone = d > 0 && this.active.t >= d;
      this.active.tick(dt, isDone);
      if (this.active) {
        if (this.active.energyRate > 0) {
          if (!this.game.spendEnergy(this.active.energyRate * dt)) {
            this.stop();
          }
        }
      }
      if (isDone) this.stop();
    }

    // плями з'являються (частіше в морі/штормі)
    this.stainTimer -= dt;
    if (this.stainTimer <= 0 && this.stains.length < 3) {
      this.stainTimer = rand(25, 55);
      const x = rand(-0.9, 0.9);
      const z = rand(-4.2, 4.0);
      if (!this.insideCabin(x, z)) this.addStain(x, z);
    }
    void timeH;
  }

  private insideCabin(x: number, z: number): boolean {
    // рубка/лави/тумба на палубі — плями лише на відкритому настилі
    return DECK_COLLIDERS.some((b) => x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3) ||
      Math.abs(x) > deckLimitX(z, 0.3);
  }

  private addStain(x: number, z: number) {
    const geo = new THREE.CircleGeometry(rand(0.25, 0.45), 12);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x2a2018, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, BOAT.deckY + 0.06, z);
    this.group.add(mesh);
    this.stains.push({ x, z, r: 0.5, mesh });
  }

  private removeStain(s: Stain) {
    this.group.remove(s.mesh);
    s.mesh.geometry.dispose();
    (s.mesh.material as THREE.Material).dispose();
    this.stains = this.stains.filter((x) => x !== s);
  }

  private nearestStain(): Stain | null {
    // "гравець" — середина палуби (станція clean доступна з будь-де, обираємо найближчу до центру)
    let best: Stain | null = null;
    let bd = 1e9;
    for (const s of this.stains) {
      const d = Math.hypot(s.x, s.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** чи є що прибирати (для підказки) */
  hasStains(): boolean {
    return this.stains.length > 0;
  }

  /** зняти зі сцени човна (при перезапуску гри) */
  dispose() {
    for (const s of [...this.stains]) this.removeStain(s);
    this.stains = [];
    this.active = null;
    this.stainTimer = 20;
    this.boat.group.remove(this.group);
  }
}
