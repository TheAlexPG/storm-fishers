import * as THREE from 'three';
import { clamp, rand } from '../core/math';
import { Boat } from '../world/boat';
import { FISH, FISH_BY_ID, makeFish, zoneFromDist } from './fish';
import { eff } from './upgrades';
import type { GameState } from './state';
import type { Weather } from '../core/weather';
import type { TimeCycle } from '../core/time';
import type { Ocean } from '../core/ocean';
import type { AudioEngine } from '../core/audio';
import type { Input } from '../core/input';

// ─────────────────────────────────────────────────────────────
// Ловля як мінігра:
//  1. закид — тримай E, шкала сили ходить туди-сюди; відпусти в зеленій зоні;
//  2. клювання — спершу риба «пробує» (поплавок смикається; підсічка зарано
//     лякає рибу), потім справжнє клювання топить поплавок — тисни E швидко;
//  3. боротьба — риба рветься вбік: нахиляй вудку навпаки (A/D), тягни Space,
//     тримаючи натяг у зеленій зоні; стрибок — відпусти; виснаж рибу й підтягни.
// ─────────────────────────────────────────────────────────────

export type FishingState = 'idle' | 'charge' | 'waiting' | 'bite' | 'fight';

/** зелена зона натягу (в межах 0..100) */
const SWEET_LO = 42;
const SWEET_HI = 74;

export class Fishing {
  state: FishingState = 'idle';
  /** класичний поплавок: червоний верх, білий низ, ледь світиться — видно з 15 м */
  bobber = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xe8432f, roughness: 0.4, emissive: 0xe8432f, emissiveIntensity: 0.35 }),
  );
  /** кола на воді довкола поплавка */
  private ripples: Array<{ m: THREE.Mesh; age: number }> = [];
  private rippleT = 0;
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
  private castDist = 10;
  private _d = new THREE.Vector3();
  // ── мінігра ──
  /** сила закиду 0..1 (шкала), фаза коливання */
  castPower = 0;
  private castPhase = 0;
  /** ідеальний закид — клює швидше */
  private perfectCast = false;
  /** «пробування» поплавка: таймер наступного смикання, глибина смикання */
  private nibbleT = 0;
  private nibble = 0;
  /** час від справжнього клювання (реакція) */
  private biteAge = 0;
  // боротьба
  private stamina = 100;
  private staminaMax = 100;
  /** куди рветься риба: −1 ліворуч, +1 праворуч, 0 — тягне в глибину */
  pull = 0;
  /** нахил вудки гравцем −1..1 (згладжений) */
  lean = 0;
  /** бічний зсув риби від лінії закиду, м */
  private side = 0;
  private jumpT = 0;
  private nextJump = 5;
  private slackT = 0;
  private pullT = 0;
  /** коротке повідомлення в HUD боротьби */
  status = '';
  private statusT = 0;
  /** колбеки для ефектів (сплеск, стрибок риби) */
  onSplash: ((pos: THREE.Vector3, power: number) => void) | null = null;
  onLeap: ((speciesId: string, kg: number, pos: THREE.Vector3) => void) | null = null;
  /** повідомлення для HUD */
  onEvent: ((msg: string, kind: 'warn' | 'bad' | 'good') => void) | null = null;

  constructor(private scene: THREE.Scene, private audio: AudioEngine) {
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(this.lineGeo, new THREE.LineBasicMaterial({ color: 0xdde8ee, transparent: true, opacity: 0.6 }));
    this.line.visible = false;
    this.bobber.visible = false;
    const belly = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.5 }),
    );
    this.bobber.add(belly);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5), new THREE.MeshStandardMaterial({ color: 0xe8432f, emissive: 0xe8432f, emissiveIntensity: 0.35 }));
    stick.position.y = 0.2;
    this.bobber.add(stick);
    const ringGeo = new THREE.RingGeometry(0.85, 1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      this.scene.add(m);
      this.ripples.push({ m, age: 9 });
    }
    this.scene.add(this.bobber);
    this.scene.add(this.line);
  }

  /** почати закид: тримай E — шкала сили, відпусти — закид */
  startCharge(boat: Boat, game: GameState): boolean {
    if (this.state !== 'idle') return false;
    if (Math.hypot(boat.pos.x, boat.pos.z) < 60) return false;
    if (game.energy < 2) return false;
    this.state = 'charge';
    this.castPower = 0;
    this.castPhase = 0;
    return true;
  }

  /** закинути вудку (power 0..1 — із шкали; без шкали — 0.85) */
  cast(boat: Boat, game: GameState, weather: Weather, time: TimeCycle, power = 0.85): boolean {
    if (this.state !== 'idle' && this.state !== 'charge') return false;
    this.state = 'idle';
    const zone = zoneFromDist(Math.hypot(boat.pos.x, boat.pos.z));
    if (zone === 'shore' && Math.hypot(boat.pos.x, boat.pos.z) < 60) {
      return false; // занадто близько до причалу — не куди закидати
    }
    if (!game.spendEnergy(2)) return false;
    const rodLvl = game.upgrades.rod;
    // ідеальна зона шкали 0.78–0.95: найдалі й найточніше; перетягнув — недоліт
    this.perfectCast = power >= 0.78 && power <= 0.95;
    const k = power > 0.95 ? 0.75 : 0.45 + 0.6 * power;
    const dist = eff.castDist(rodLvl) * k * (this.perfectCast ? 1.1 : rand(0.9, 1.05));
    this.castDist = dist;
    // поплавок вперед і помітно на правий борт: прямо по курсу його ховає згорнутий стаксель на штазі
    const h = boat.heading - 0.42;
    const fwd = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
    const base = boat.rodTipWorld(new THREE.Vector3());
    this.bobberPos.copy(base).addScaledVector(fwd, dist);
    this.state = 'waiting';
    this.rippleT = 0;
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
    if (this.perfectCast) t *= 0.55;
    this.biteAt = Math.max(2, t);
    this.nibbleT = Math.min(this.biteAt * 0.5, rand(1.5, 4));
    this.nibble = 0;
    this.bobber.visible = true;
    this.line.visible = true;
    this.audio.splash(0.5);
    this.say(this.perfectCast ? 'Ідеальний закид!' : power > 0.95 ? 'Перетягнув — недоліт' : '', 2);
    return true;
  }

  private say(msg: string, sec = 1.6) {
    this.status = msg;
    this.statusT = msg ? sec : 0;
  }

  /** E під час очікування: якщо поплавок саме смикається — підсічка зарано */
  strikeIfNibbling(): boolean {
    if (this.state !== 'waiting' || this.nibble < 0.05) return false;
    return this.strikeEarly();
  }

  /** підсічка не вчасно (під час «пробування») — риба лякається */
  strikeEarly(): boolean {
    if (this.state !== 'waiting') return false;
    this.biteAt += rand(4, 8);
    this.nibbleT = rand(2, 4);
    this.nibble = 0;
    this.audio.splash(0.25);
    this.onEvent?.('Зарано! Риба злякалась — чекай, поки поплавок піде під воду.', 'warn');
    return true;
  }

  /** зняти вудку (без улову) */
  reelIn() {
    if (this.state === 'fight') return;
    this.say('');
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
    this.fightTension = 35;
    this.fishRun = 0;
    this.runTimer = rand(1, 3);
    this.overTension = 0;
    this.lineBreakAt = 86 + eff.lineStrength(game.upgrades.rod) * 14 - 14; // 86..92
    // витривалість: вага й рідкість; швидка підсічка «вибиває» чверть
    const rel = clamp(this.fishKg / sp.maxKg, 0, 1.3);
    this.staminaMax = 60 + rel * 50 + sp.rarity * 25;
    const perfect = this.biteAge < 0.4;
    this.stamina = this.staminaMax * (perfect ? 0.72 : 1);
    this.pull = 0;
    this.lean = 0;
    this.side = 0;
    this.jumpT = 0;
    this.nextJump = rand(4, 8);
    this.slackT = 0;
    this.pullT = rand(0.8, 1.6);
    this.say(perfect ? 'Ідеальна підсічка!' : 'Є! Риба на гачку', 1.8);
    this.state = 'fight';
  }

  private spawnRipple(power: number) {
    const r = this.ripples.reduce((a, b) => (a.age > b.age ? a : b));
    r.age = 0;
    r.m.userData.power = power;
    r.m.visible = true;
  }

  private updateRipples(dt: number, t: number, ocean: Ocean) {
    for (const r of this.ripples) {
      if (!r.m.visible) continue;
      r.age += dt;
      const life = 1.6;
      if (r.age > life || this.state === 'idle') {
        r.m.visible = false;
        continue;
      }
      const u = r.age / life;
      const p = (r.m.userData.power as number) ?? 0.5;
      const sc = 0.15 + u * (0.6 + p * 0.5);
      r.m.scale.setScalar(sc);
      r.m.position.set(this.bobberPos.x, ocean.heightAt(this.bobberPos.x, this.bobberPos.z, t) + 0.03, this.bobberPos.z);
      (r.m.material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.5 * (0.5 + p * 0.5);
    }
  }

  /** чи тримає гравець лінію */
  isPulling(input: Input): boolean {
    return input.down('Space');
  }

  update(dt: number, t: number, boat: Boat, ocean: Ocean, input: Input, game: GameState, weather: Weather, time: TimeCycle) {
    this.updateRipples(dt, t, ocean);
    if (this.statusT > 0) {
      this.statusT -= dt;
      if (this.statusT <= 0) this.status = '';
    }
    if (this.state === 'charge') {
      // шкала сили ходить туди-сюди (~1.4 с цикл); відпустив E — закид
      this.castPhase += dt / 0.7;
      const ph = this.castPhase % 2;
      this.castPower = ph < 1 ? ph : 2 - ph;
      boat.setRodBend(0.1 + this.castPower * 0.35);
      if (!input.down('KeyE')) this.cast(boat, game, weather, time, this.castPower);
      return;
    }
    if (this.state === 'idle') {
      this.bobber.visible = false;
      this.line.visible = false;
      boat.setRodBend(0);
      return;
    }
    // нові кола: спокійно — рідко, клювання — часто
    this.rippleT -= dt;
    if (this.rippleT <= 0 && this.state !== 'fight') {
      this.rippleT = this.state === 'bite' ? 0.22 : 1.8 + Math.random();
      this.spawnRipple(this.state === 'bite' ? 1 : 0.5);
    }

    // вигин вудлища: натяг волосіні
    boat.setRodBend(
      this.state === 'fight' ? 0.15 + this.fightTension / 115
        : this.state === 'bite' ? 0.25 + 0.15 * Math.sin(t * 22)
        : 0.05 + this.nibble * 0.12,
    );
    // кінчик вудки у світі
    boat.rodTipWorld(this.rodTipWorld);

    if (this.state === 'waiting' || this.state === 'bite') {
      // човен відійшов — волосінь натягнулась, вудку змотано
      const dx = this.bobberPos.x - this.rodTipWorld.x;
      const dz = this.bobberPos.z - this.rodTipWorld.z;
      if (Math.hypot(dx, dz) > this.castDist * 1.6 + 8) {
        this.reelIn();
        this.onEvent?.('Човен відійшов — волосінь натягнулась, вудку змотано. Для риболовлі стань на місці.', 'warn');
        return;
      }
    }

    if (this.state === 'waiting') {
      // «пробування»: риба смикає поплавок кілька разів перед справжнім клюванням
      this.nibbleT -= dt;
      if (this.nibbleT <= 0 && this.biteAt > 1.2) {
        this.nibble = 1;
        this.nibbleT = rand(1.2, 3.5);
        this.spawnRipple(0.7);
        this.audio.splash(0.12);
      }
      this.nibble = Math.max(0, this.nibble - dt * 3.5);
      const h = ocean.heightAt(this.bobberPos.x, this.bobberPos.z, t);
      this.bobber.position.set(this.bobberPos.x, h + 0.06 - this.nibble * 0.09 * (0.6 + 0.4 * Math.sin(t * 40)), this.bobberPos.z);
      this.biteAt -= dt;
      if (this.biteAt <= 0) {
        this.state = 'bite';
        this.biteWindow = 1.1;
        this.biteAge = 0;
        this.audio.bite();
        this.spawnRipple(1);
        this.onSplash?.(this.bobber.position, 0.35);
      }
    } else if (this.state === 'bite') {
      // поплавок пішов під воду
      const h = ocean.heightAt(this.bobberPos.x, this.bobberPos.z, t);
      this.bobber.position.set(this.bobberPos.x, h - 0.16 + Math.sin(t * 22) * 0.05, this.bobberPos.z);
      this.biteAge += dt;
      this.biteWindow -= dt;
      if (this.biteWindow <= 0) {
        this.reelIn();
        this.onEvent?.('Проґавив клювання — риба зірвалась з гачка.', 'warn');
      }
    } else if (this.state === 'fight') {
      if (this.fightStep(dt, t, boat, ocean, input, game, weather)) return;
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

  /** крок боротьби; true — боротьба скінчилась (улов/обрив/зрив) */
  private fightStep(dt: number, t: number, boat: Boat, ocean: Ocean, input: Input, game: GameState, weather: Weather): boolean {
    const sp = FISH_BY_ID[this.fishSpeciesId];
    const power = 0.45 + clamp(this.fishKg / (sp ? sp.maxKg : 1), 0, 1) * 0.35 + (sp ? sp.rarity * 0.12 : 0);
    const tired = this.stamina < this.staminaMax * 0.25;

    // риба міняє напрям ривка
    this.pullT -= dt;
    if (this.pullT <= 0) {
      const r = Math.random();
      this.pull = tired ? (r < 0.6 ? 0 : r < 0.8 ? -1 : 1) : r < 0.42 ? -1 : r < 0.84 ? 1 : 0;
      this.pullT = tired ? rand(1.4, 2.6) : rand(1.1, 2.4);
    }
    // стрибок
    this.nextJump -= dt;
    if (this.jumpT <= 0 && this.nextJump <= 0 && !tired) {
      this.jumpT = 1.15;
      this.nextJump = rand(6, 11);
      this.onLeap?.(this.fishSpeciesId, this.fishKg, this.bobber.position);
      this.onSplash?.(this.bobber.position, 0.7);
      this.say('СТРИБОК! Відпусти Space!', 1.2);
    }
    const jumping = this.jumpT > 0;
    if (jumping) this.jumpT -= dt;

    // керування: Space — тягти, A/D — нахил вудки (протидія ривку)
    const reeling = this.isPulling(input);
    const leanIn = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    this.lean += (leanIn - this.lean) * (1 - Math.exp(-dt * 8));
    // протидія: нахил проти ривка (ривок ліворуч → вудка праворуч)
    const counter = this.pull === 0 ? 1 - Math.abs(this.lean) * 0.4 : clamp(-this.pull * this.lean, -1, 1);
    const effort = this.pull === 0 ? 0.5 : 1;

    // натяг
    let dT = 0;
    if (reeling) dT += (26 + power * 22) * (jumping ? 3.2 : 1);
    else dT -= 48;
    dT += this.pull !== 0 ? (1 - counter) * 30 * power * effort : 6 * power;
    if (this.fishRun > 0) dT += 10 * power;
    this.fightTension = clamp(this.fightTension + dT * dt, 0, 100);
    const sweet = this.fightTension >= SWEET_LO && this.fightTension <= SWEET_HI;

    // виснаження риби: у зеленій зоні й з правильним нахилом — найшвидше;
    // стрибок без натягу — риба б'ється об повітря й теж втомлюється
    let drain = 1.2;
    if (sweet) drain += 3 + Math.max(0, counter) * 3.5;
    if (jumping && !reeling) drain += 9;
    this.stamina = Math.max(0, this.stamina - drain * dt);

    // відстань: тягнеш — ближче (уставшу рибу — швидше), ривок — далі
    const reelSpeed = (1.0 + eff.biteSpeed(game.upgrades.rod) * 0.45) * (tired ? 1.8 : sweet ? 1.0 : 0.45);
    if (reeling && !jumping) this.fightDist -= reelSpeed * dt;
    const run = tired ? 0.25 : this.pull !== 0 ? 1.1 * (1 - Math.max(0, counter)) * power + 0.3 : 0.5 * power;
    this.fightDist += run * dt * (reeling ? 0.6 : 1);
    this.fightDist = clamp(this.fightDist, 0, this.fightMaxDist * 1.4);
    if (reeling) game.spendEnergy(0.45 * dt);

    // риба тягне вбік — поплавок/риба їде поперек
    const sideTarget = tired ? 0 : this.pull * Math.min(5, 1.5 + this.fightDist * 0.25) * (1 - 0.6 * Math.max(0, counter));
    this.side += (sideTarget - this.side) * (1 - Math.exp(-dt * 1.4));

    // обрив: натяг під межею понад секунду
    if (this.fightTension >= this.lineBreakAt) {
      this.overTension += dt;
      if (this.overTension > 0.8) {
        this.snap();
        this.onEvent?.('💥 Волосінь обірвалась — перетягнув!', 'bad');
        return true;
      }
    } else {
      this.overTension = Math.max(0, this.overTension - dt * 2);
    }
    // зрив: волосінь провисла надто довго — риба виплюнула гачок
    if (this.fightTension < 12) {
      this.slackT += dt;
      if (this.slackT > 2.6) {
        this.snap();
        this.onEvent?.('Риба зірвалась — волосінь провисла. Тримай натяг у зеленій зоні.', 'warn');
        return true;
      }
    } else {
      this.slackT = Math.max(0, this.slackT - dt);
    }

    // підказки
    if (!this.statusT || this.statusT <= 0) {
      if (jumping) this.status = 'СТРИБОК! Відпусти Space!';
      else if (this.slackT > 1.2) this.status = 'Слабина! Тягни Space';
      else if (this.overTension > 0.2) this.status = 'Занадто туго! Відпусти';
      else if (tired) this.status = 'Риба втомилась — тягни!';
      else if (this.pull < 0) this.status = 'Рветься ліворуч → тисни D';
      else if (this.pull > 0) this.status = 'Рветься праворуч → тисни A';
      else this.status = 'Тягне в глибину — тримай натяг';
    }

    // улов!
    if (this.fightDist <= 0.5) {
      this.catchFish(weather);
      return true;
    }
    // поплавок (риба) — на волосіні від кінчика вудки, у бік закиду + поперечний зсув
    const dir = this._d.set(this.bobberPos.x - this.rodTipWorld.x, 0, this.bobberPos.z - this.rodTipWorld.z);
    if (dir.lengthSq() < 1e-4) dir.set(Math.sin(boat.heading), 0, Math.cos(boat.heading));
    dir.normalize();
    // «праворуч» від напрямку на рибу (з погляду рибалки)
    const rx = -dir.z, rz = dir.x;
    const tx = this.rodTipWorld.x + dir.x * (this.fightDist + 2) + rx * this.side;
    const tz = this.rodTipWorld.z + dir.z * (this.fightDist + 2) + rz * this.side;
    const h = ocean.heightAt(tx, tz, t);
    this.bobber.position.set(tx, h + 0.02 - (this.pull === 0 && !tired ? 0.12 : 0) + Math.sin(t * 14) * 0.02, tz);
    // бурун від риби, що б'ється
    this.rippleT -= dt;
    if (this.rippleT <= 0) {
      this.rippleT = tired ? 0.9 : 0.35;
      this.spawnRipple(tired ? 0.4 : 0.9);
    }
    return false;
  }

  private snap() {
    this.audio.snap();
    this.state = 'idle';
    this.bobber.visible = false;
    this.line.visible = false;
  }

  private catchFish(weather: Weather) {
    this.say('');
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
  get fightInfo(): { speciesId: string; kg: number; tension: number; limit: number; dist: number; stamina: number; pull: number; lean: number; status: string; jump: boolean; lo: number; hi: number } {
    return {
      speciesId: this.fishSpeciesId,
      kg: this.fishKg,
      tension: this.fightTension,
      limit: this.lineBreakAt,
      dist: this.fightDist,
      stamina: this.staminaMax > 0 ? this.stamina / this.staminaMax : 0,
      pull: this.pull,
      lean: this.lean,
      status: this.status,
      jump: this.jumpT > 0,
      lo: SWEET_LO,
      hi: SWEET_HI,
    };
  }

  /** кооп: [стан 1 чекає / 2 клює / 3 боротьба, x, z, натяг] або null */
  netState(): [number, number, number, number] | null {
    if (this.state === 'idle' || this.state === 'charge') return null;
    const s = this.state === 'waiting' ? 1 : this.state === 'bite' ? 2 : 3;
    const r = (v: number) => Math.round(v * 100) / 100;
    return [s, r(this.bobber.position.x), r(this.bobber.position.z), Math.round(this.state === 'fight' ? this.fightTension : 0)];
  }

  /** підказка для HUD */
  prompt(): string | null {
    switch (this.state) {
      case 'charge': return 'Відпусти E у зеленій зоні — закид';
      case 'waiting': return 'Чекай, поки поплавок піде під воду… (E — зняти)';
      case 'bite': return 'КЛЮЄ! Тисни E!';
      case 'fight': return 'Space — тягти · A/D — нахил вудки проти ривка';
      default: return null;
    }
  }
}
