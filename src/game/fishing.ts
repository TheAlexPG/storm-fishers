import * as THREE from 'three';
import { clamp, rand } from '../core/math';
import { Boat, BOAT, STATION_POS } from '../world/boat';
import { FISH, FISH_BY_ID, makeFish, zoneFromDist } from './fish';
import { eff } from './upgrades';
import type { GameState } from './state';
import type { Weather } from '../core/weather';
import type { TimeCycle } from '../core/time';
import type { Ocean } from '../core/ocean';
import type { AudioEngine } from '../core/audio';
import type { Input } from '../core/input';

// ─────────────────────────────────────────────────────────────
// Ловля: закид → клювання → зачеп → боротьба (тяга/відстань).
// ─────────────────────────────────────────────────────────────

export type FishingState = 'idle' | 'waiting' | 'bite' | 'fight';

export class Fishing {
  state: FishingState = 'idle';
  bobber = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xe04040, roughness: 0.4 }),
  );
  private line: THREE.Line;
  private lineGeo: THREE.BufferGeometry;
  private bobberPos = new THREE.Vector3();
  private rodTipWorld = new THREE.Vector3();

  private biteAt = 0;
  private biteWindow = 0;
  private fightTension = 0;
  private fightDist = 0;
  private fightMaxDist = 1;
  private fishKg = 1;
  private fishSpeciesId = 'hamsa';
  private fishRun = 0;
  private runTimer = 0;
  private overTension = 0;
  private lineBreakAt = 90;

  constructor(private scene: THREE.Scene, private audio: AudioEngine) {
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(this.lineGeo, new THREE.LineBasicMaterial({ color: 0xdde8ee, transparent: true, opacity: 0.6 }));
    this.line.visible = false;
    this.bobber.visible = false;
    this.scene.add(this.bobber);
    this.scene.add(this.line);
  }

  /** закинути вудку */
  cast(boat: Boat, game: GameState, weather: Weather, time: TimeCycle): boolean {
    if (this.state !== 'idle') return false;
    const zone = zoneFromDist(Math.hypot(boat.pos.x, boat.pos.z));
    if (zone === 'shore' && Math.hypot(boat.pos.x, boat.pos.z) < 60) {
      return false; // занадто близько до причалу — не куди закидати
    }
    if (!game.spendEnergy(2)) return false;
    const rodLvl = game.upgrades.rod;
    const dist = eff.castDist(rodLvl) * rand(0.85, 1.15);
    // поплавок вперед від носа (вудка на носовій палубі)
    const fwd = new THREE.Vector3(Math.sin(boat.heading), 0, Math.cos(boat.heading));
    const base = boat.localToWorld(0, BOAT.deckY + 0.5, 3.9, new THREE.Vector3());
    this.bobberPos.copy(base).addScaledVector(fwd, dist);
    this.state = 'waiting';
    // базовий час: 5–30 с, зона, погода, вудка, радіо
    let t = rand(5, 30);
    t *= zone === 'shore' ? 0.7 : zone === 'mid' ? 1.0 : 1.45;
    t /= eff.biteSpeed(rodLvl);
    if (weather.intensity > 0.6) t *= 0.7; // у шторм клює частіше
    // радіо-звіт скорочує час для тих видів, що в зоні
    for (const r of game.reports) {
      if (r.zone === zone) {
        t /= 1.3;
        break;
      }
    }
    this.biteAt = Math.max(2, t);
    this.bobber.visible = true;
    this.line.visible = true;
    this.audio.splash(0.5);
    return true;
  }

  /** зняти вудку (без улову) */
  reelIn() {
    if (this.state === 'fight') return;
    this.state = 'idle';
    this.bobber.visible = false;
    this.line.visible = false;
  }

  /** зачепити рибу (у вікні клювання) */
  hook(game: GameState, weather: Weather, time: TimeCycle, boat: Boat) {
    if (this.state !== 'bite') return;
    // вибір виду: зона, доба, рідкісність, радіо, шторм
    const zone = zoneFromDist(Math.hypot(boat.pos.x, boat.pos.z));
    const day = !time.isNight;
    const pool = FISH.filter((f) => f.zones.includes(zone) && (day ? f.day : f.night));
    if (pool.length === 0) {
      // ніч у зоні, де ніщо не ловиться — беремо будь-що з зони
      const anyPool = FISH.filter((f) => f.zones.includes(zone));
      pool.push(...anyPool);
    }
    // ваги
    const weights = pool.map((f) => {
      let w = 1 / f.rarity;
      const rep = game.reportBoost(f.id, zone);
      if (rep > 1) w *= rep;
      if (weather.intensity > 0.6 && f.zones.includes('open')) w *= 1.6; // рідкісна риба в шторм
      return w;
    });
    let sum = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    let sp = pool[0];
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        sp = pool[i];
        break;
      }
    }
    this.fishSpeciesId = sp.id;
    this.fishKg = rand(sp.minKg, sp.maxKg) * rand(0.85, 1.3);
    this.fightMaxDist = rand(10, 16) + this.fishKg * 0.4;
    this.fightDist = this.fightMaxDist;
    this.fightTension = 25;
    this.fishRun = 0;
    this.runTimer = rand(1, 3);
    this.overTension = 0;
    this.lineBreakAt = 86 + eff.lineStrength(game.upgrades.rod) * 14 - 14; // 86..92
    this.state = 'fight';
  }

  /** чи тримає гравець лінію */
  isPulling(input: Input): boolean {
    return input.down('Space');
  }

  update(dt: number, t: number, boat: Boat, ocean: Ocean, input: Input, game: GameState, weather: Weather, time: TimeCycle) {
    if (this.state === 'idle') {
      this.bobber.visible = false;
      this.line.visible = false;
      return;
    }

    // вудка: кінчик у світі (вудка на носі)
    boat.localToWorld(0, BOAT.deckY + 1.0, 4.6, this.rodTipWorld);

    if (this.state === 'waiting') {
      // поплавок плаває по хвилях
      this.bobber.position.set(
        this.bobberPos.x,
        ocean.heightAt(this.bobberPos.x, this.bobberPos.z, t) + 0.06,
        this.bobberPos.z,
      );
      this.biteAt -= dt;
      if (this.biteAt <= 0) {
        this.state = 'bite';
        this.biteWindow = 1.6;
        this.audio.bite();
        this.bobber.position.y = ocean.heightAt(this.bobberPos.x, this.bobberPos.z, t) - 0.1;
      }
    } else if (this.state === 'bite') {
      // поплавок тоне-вистрибує
      const h = ocean.heightAt(this.bobberPos.x, this.bobberPos.z, t);
      this.bobber.position.set(this.bobberPos.x, h - 0.12 + Math.sin(t * 22) * 0.07, this.bobberPos.z);
      this.biteWindow -= dt;
      if (this.biteWindow <= 0) {
        this.reelIn();
      }
    } else if (this.state === 'fight') {
      // риба тягне від човна
      this.runTimer -= dt;
      if (this.runTimer <= 0) {
        this.fishRun = this.fishRun > 0 ? 0 : rand(0.8, 1.8);
        this.runTimer = this.fishRun > 0 ? rand(0.5, 1.4) : rand(1.2, 2.6);
      }
      const pulling = this.isPulling(input);
      const sp = FISH_BY_ID[this.fishSpeciesId];
      const strength = 0.4 + clamp(this.fishKg / (sp ? sp.maxKg : 1), 0, 1) * 0.6; // сильна риба
      if (pulling) {
        this.fightTension += (34 + strength * 30) * dt * (this.fishRun > 0 ? 1.5 : 1);
        this.fightDist -= (1.5 + eff.biteSpeed(game.upgrades.rod) * 0.35) * dt;
        game.spendEnergy(0.5 * dt);
      } else {
        this.fightTension -= 62 * dt;
        this.fightDist += (0.55 + this.fishRun * 0.5) * dt;
      }
      this.fightTension = clamp(this.fightTension, 0, 100);
      this.fightDist = clamp(this.fightDist, 0, this.fightMaxDist * 1.3);

      // відрив
      if (this.fightTension >= this.lineBreakAt) {
        this.overTension += dt;
        if (this.overTension > 1.0) {
          this.snap();
          return;
        }
      } else {
        this.overTension = Math.max(0, this.overTension - dt * 2);
      }
      // улов!
      if (this.fightDist <= 0.5) {
        this.catchFish(weather);
        return;
      }
      // поплавок (риба) біжить від човна
      const fwd = new THREE.Vector3(Math.sin(boat.heading), 0, Math.cos(boat.heading));
      const target = new THREE.Vector3().copy(boat.pos).addScaledVector(fwd, -(this.fightDist + 5));
      const h = ocean.heightAt(target.x, target.z, t);
      this.bobber.position.set(target.x, h + 0.05, target.z);
    }

    // лінія від вудки до поплавка
    const attr = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const midX = (this.rodTipWorld.x + this.bobber.position.x) / 2;
    const midY = Math.min(this.rodTipWorld.y, this.bobber.position.y) - 0.6;
    const midZ = (this.rodTipWorld.z + this.bobber.position.z) / 2;
    attr.setXYZ(0, this.rodTipWorld.x, this.rodTipWorld.y, this.rodTipWorld.z);
    attr.setXYZ(1, midX, midY, midZ);
    attr.setXYZ(2, this.bobber.position.x, this.bobber.position.y, this.bobber.position.z);
    attr.needsUpdate = true;
  }

  private snap() {
    this.audio.snap();
    this.state = 'idle';
    this.bobber.visible = false;
    this.line.visible = false;
  }

  private catchFish(weather: Weather) {
    const item = makeFish(this.fishSpeciesId, this.fishKg, weather.stormBonus);
    this.state = 'idle';
    this.bobber.visible = false;
    this.line.visible = false;
    this.audio.catchJingle();
    this._lastCatch = item;
  }

  /** улов цього разу (повертається і з'їдається) */
  private _lastCatch: ReturnType<typeof makeFish> | null = null;
  takeCatch(): ReturnType<typeof makeFish> | null {
    const c = this._lastCatch;
    this._lastCatch = null;
    return c;
  }

  /** дані поточної боротьби для HUD */
  get fightInfo(): { speciesId: string; kg: number; tension: number; limit: number; dist: number } {
    return {
      speciesId: this.fishSpeciesId,
      kg: this.fishKg,
      tension: this.fightTension,
      limit: this.lineBreakAt,
      dist: this.fightDist,
    };
  }

  /** підказка для HUD */
  prompt(): string | null {
    switch (this.state) {
      case 'waiting': return 'Риба може клюнути… (E — зняти)';
      case 'bite': return 'КЛЕВНЕННЯ! Натисни E!';
      case 'fight': return 'Тримай Space — тягни! Не перетягни!';
      default: return null;
    }
  }
}
