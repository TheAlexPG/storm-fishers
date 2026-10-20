import * as THREE from 'three';
import type { FishItem } from '../core/types';
import type { Ocean } from '../core/ocean';
import { offshore, type Weather } from '../core/weather';
import { localIntensity, seaMul } from '../core/region';
import type { GameState } from '../game/state';
import { FISH, makeFish, zoneFromDist } from '../game/fish';
import { netCount, netHaulSpeed, netLength } from '../game/upgrades';
import type { Boat } from './boat';
import { HALF_LEN, WATERLINE_Y } from './yachtLayout';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Сітки — промисловий лов (мід/енд-гейм, апгрейд «Сітки»).
//
//  Поставити: E біля сіткового ящика/барабана на кормі, далі йти повільно
//  (1–5 м/с) — сітка розмотується за кормою, на початку лишається буй із
//  прапорцем, наприкінці — другий. Швидше 6.5 м/с — сітка плутається.
//  Сітка «стоїть» ігрові години: улов росте й насичується (≈5 год), після
//  14 год риба в сітці псується. Шторм рве сітки (особливо далеко в морі).
//  Вибрати: підійти кормою до буя (до 14 м), E — барабан тягне сітку,
//  риба йде одразу в трюм; що не влізло — на палубу; решта — за борт.
//  Кожне вибирання зношує снасть (менше улову) — лагодять у порту біля
//  того ж барабана (плата + заміна порваних сіток).
//  Сітки — того, хто їх ставив (капітан човна); буї видно всім у коопі.
// ─────────────────────────────────────────────────────────────

export interface NetSet {
  id: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  len: number;
  /** скільки ігрових годин стоїть */
  soakH: number;
  /** пошкодження від шторму 0..100 (100 — порвало) */
  wear: number;
}

interface NetsSave {
  nets: NetSet[];
  lost: number;
  gear: number;
  nextId: number;
}

/** кооп: стан сіток для гостей (лише показ) */
export interface NetsNet {
  n: number[][];
  s: number[] | null;
  h: number[] | null;
}

const FLOAT_STEP = 4; // м між поплавцями
const MAX_FLOATS = 220;
const HAUL_REACH = 14;
const SPOIL_H = 14;

export class Nets {
  nets: NetSet[] = [];
  /** порвані/втрачені сітки — замінюють у порту */
  lost = 0;
  /** знос снасті від вибирань 0..100 (менше улову), лагодиться в порту */
  gear = 0;
  mode: 'idle' | 'shoot' | 'haul' = 'idle';
  /** кооп-гість: лише малюємо стан капітана */
  remote = false;

  onEvent: ((msg: string, kind: 'good' | 'warn' | 'bad') => void) | null = null;
  /** витягнута з сітки риба: main кладе в трюм / на палубу */
  onFish: ((f: FishItem, at: THREE.Vector3) => 'hold' | 'deck' | 'lost') | null = null;
  onSound: ((kind: 'splash' | 'thump' | 'winch', power: number) => void) | null = null;

  private nextId = 1;
  private shoot: { x0: number; z0: number; laid: number; max: number; dx: number; dz: number } | null = null;
  private haul: { net: NetSet; prog: number; dur: number; fish: FishItem[]; given: number; res: { hold: number; deck: number; lost: number }; fromStart: boolean } | null = null;

  private floats: THREE.InstancedMesh;
  private buoys: THREE.Group[] = [];
  private _m = new THREE.Matrix4();
  private _p = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private _s = new THREE.Vector3(1, 1, 1);
  private _stern = new THREE.Vector3();
  private flagMat: THREE.MeshStandardMaterial;

  constructor(private scene: THREE.Scene) {
    this.floats = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf2c12e, roughness: 0.6 }), MAX_FLOATS);
    this.floats.count = 0;
    this.floats.frustumCulled = false;
    scene.add(this.floats);
    this.flagMat = new THREE.MeshStandardMaterial({ color: 0xe9592f, roughness: 0.7, side: THREE.DoubleSide });
  }

  private buoy(i: number): THREE.Group {
    let b = this.buoys[i];
    if (b) return b;
    b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), new THREE.MeshStandardMaterial({ color: 0xe9592f, roughness: 0.55 }));
    body.scale.y = 1.2;
    body.position.y = 0.12;
    b.add(body);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 18), new THREE.MeshStandardMaterial({ color: 0xf7f1df, roughness: 0.5 }));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.15;
    b.add(band);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.4, metalness: 0.5 }));
    pole.position.y = 1.3;
    b.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.36), this.flagMat);
    flag.position.set(0.28, 2.2, 0);
    flag.name = 'flag';
    b.add(flag);
    // світловідбивна смуга на жердині — видно вночі в прожектор
    const refl = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe9a8, emissiveIntensity: 0.6 }));
    refl.position.y = 1.9;
    b.add(refl);
    b.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.scene.add(b);
    this.buoys[i] = b;
    return b;
  }

  /** точка на кормі, звідки йде сітка (світ) */
  private stern(boat: Boat): THREE.Vector3 {
    return boat.localToWorld(0.6, WATERLINE_Y + 0.3, -HALF_LEN - 0.45, this._stern);
  }

  available(level: number): number {
    return Math.max(0, netCount(level) - this.nets.length - this.lost);
  }

  /** найближчий кінець сітки до корми (м) */
  private nearestNet(boat: Boat): { net: NetSet; d: number; fromStart: boolean } | null {
    const s = this.stern(boat);
    let best: { net: NetSet; d: number; fromStart: boolean } | null = null;
    for (const n of this.nets) {
      const d0 = Math.hypot(n.x0 - s.x, n.z0 - s.z);
      const d1 = Math.hypot(n.x1 - s.x, n.z1 - s.z);
      const d = Math.min(d0, d1);
      if (!best || d < best.d) best = { net: n, d, fromStart: d0 <= d1 };
    }
    return best;
  }

  private nearPort(boat: Boat): boolean {
    return Math.hypot(boat.pos.x, boat.pos.z + 16) < 70;
  }

  repairCost(): number {
    return Math.round(this.gear * 14 + this.lost * 450);
  }

  /** напис біля барабана */
  stationLabel(level: number, boat: Boat): string {
    if (this.mode === 'shoot' && this.shoot) return L(`Обрізати й поставити сітку (${Math.round(this.shoot.laid)} з ${this.shoot.max} м)`, `Cut and set the net (${Math.round(this.shoot.laid)} of ${this.shoot.max} m)`);
    if (this.mode === 'haul' && this.haul) return L(`Барабан тягне сітку… ${Math.round(this.haul.prog * 100)} %`, `The drum is hauling the net… ${Math.round(this.haul.prog * 100)} %`);
    const near = this.nearestNet(boat);
    if (near && near.d < HAUL_REACH) return L(`Вибирати сітку №${near.net.id} · стоїть ${fmtH(near.net.soakH)}${near.net.soakH > SPOIL_H ? L(' (риба псується!)', ` (the fish is spoiling!)`) : ''}`, `Haul net #${near.net.id} · soaking ${fmtH(near.net.soakH)}${near.net.soakH > SPOIL_H ? L(' (риба псується!)', ` (the fish is spoiling!)`) : ''}`);
    if (this.nearPort(boat) && (this.gear > 3 || this.lost > 0)) return L(`Полагодити сітки${this.lost ? L(` і замінити порвані (${this.lost})`, ` and replace torn ones (${this.lost})`) : ''} — ${this.repairCost()} ₴`, `Mend the nets${this.lost ? L(` і замінити порвані (${this.lost})`, ` and replace torn ones (${this.lost})`) : ''} — ${this.repairCost()} ₴`);
    const av = this.available(level);
    if (this.nearPort(boat)) return av ? L(`Сітки на борту: ${av} — ставлять у морі, не біля порту`, `Nets aboard: ${av} — set them at sea, not by the harbour`) : L('Усі сітки в морі', `All nets are at sea`);
    if (av) return L(`Поставити сітку (${av} з ${netCount(level)}) — далі йди повільно 1–5 м/с`, `Set a net (${av} of ${netCount(level)}) — then go slowly at 1–5 m/s`);
    if (this.lost) return L(`Сіток немає: ${this.lost} порвано — заміна в порту`, `No nets: ${this.lost} torn — replace them in port`);
    return L(`Усі сітки в морі (${this.nets.length}) — підійди кормою до буя`, `All nets are at sea (${this.nets.length}) — come stern-first to a buoy`);
  }

  /** підказка під час постановки/вибирання (поверх інших) */
  prompt(boat: Boat): string | null {
    if (this.mode === 'shoot' && this.shoot) {
      const v = Math.hypot(boat.vel.x, boat.vel.z);
      const hint = v > 5.2 ? L('ПОВІЛЬНІШЕ — сітка заплутається!', `SLOW DOWN — the net will tangle!`) : v < 0.6 ? L('дай хід — сітка не розмотується', `get moving — the net isn't paying out`) : L('хід добрий', `good speed`);
      return L(`Сітка за бортом: ${Math.round(this.shoot.laid)} / ${this.shoot.max} м · ${v.toFixed(1).replace('.', L(',', '.'))} м/с — ${hint}`, `Net over the side: ${Math.round(this.shoot.laid)} / ${this.shoot.max} m · ${v.toFixed(1).replace('.', L(',', '.'))} m/s — ${hint}`);
    }
    if (this.mode === 'haul' && this.haul) return L(`Вибираємо сітку №${this.haul.net.id}: ${Math.round(this.haul.prog * 100)} % · риба: ${this.haul.given}/${this.haul.fish.length}`, `Hauling net #${this.haul.net.id}: ${Math.round(this.haul.prog * 100)} % · fish: ${this.haul.given}/${this.haul.fish.length}`);
    return null;
  }

  /** E біля барабана (або дія гостя через капітана) */
  interact(level: number, boat: Boat, game: GameState, weather: Weather): void {
    if (this.remote) return;
    if (this.mode === 'shoot') {
      this.finishShoot('cut');
      return;
    }
    if (this.mode === 'haul') return;
    const near = this.nearestNet(boat);
    if (near && near.d < HAUL_REACH) {
      this.startHaul(near.net, near.fromStart, level, game, weather);
      return;
    }
    if (this.nearPort(boat) && (this.gear > 3 || this.lost > 0)) {
      const cost = this.repairCost();
      if (game.money < cost) {
        this.onEvent?.(L(`На ремонт сіток бракує ${cost - game.money} ₴`, `Mending the nets needs ${cost - game.money} ₴ more`), 'warn');
        return;
      }
      game.money -= cost;
      this.gear = 0;
      this.lost = 0;
      this.onSound?.('thump', 0.4);
      this.onEvent?.(L(`🧵 Сітки полагоджено (−${cost} ₴) — ловлять як нові`, `🧵 Nets mended (−${cost} ₴) — they fish like new`), 'good');
      return;
    }
    if (this.nearPort(boat)) {
      this.onEvent?.(L('Сітки ставлять у морі — відійди від порту', `Nets are set at sea — move away from the harbour`), 'warn');
      return;
    }
    if (this.available(level) <= 0) {
      this.onEvent?.(this.lost ? L('Вільних сіток немає — порвані заміни в порту', `No free nets — replace the torn ones in port`) : L('Усі сітки вже в морі', `All nets are already at sea`), 'warn');
      return;
    }
    const s = this.stern(boat);
    this.shoot = { x0: s.x, z0: s.z, laid: 0, max: netLength(level), dx: -Math.sin(boat.heading), dz: -Math.cos(boat.heading) };
    this.mode = 'shoot';
    this.onSound?.('splash', 0.6);
    this.onEvent?.(L('🛟 Буй за бортом — сітка пішла! Стань за штурвал і йди повільно (1–5 м/с)', `🛟 Buoy over the side — the net is going out! Take the wheel and go slowly (1–5 m/s)`), 'good');
    void weather;
  }

  private finishShoot(why: 'cut' | 'full' | 'tangle') {
    const sh = this.shoot;
    this.shoot = null;
    this.mode = 'idle';
    if (!sh) return;
    if (sh.laid < 8) {
      this.onEvent?.(L('Замало сітки у воді — вибрали назад на борт', `Too little net in the water — hauled it back aboard`), 'warn');
      return;
    }
    const net: NetSet = { id: this.freeId(), x0: sh.x0, z0: sh.z0, x1: sh.x0 + sh.dx * sh.laid, z1: sh.z0 + sh.dz * sh.laid, len: sh.laid, soakH: 0, wear: why === 'tangle' ? 35 : 0 };
    this.nets.push(net);
    this.onSound?.('splash', 0.5);
    if (why === 'tangle') this.onEvent?.(L(`Сітка №${net.id} заплуталась на ходу — ловитиме гірше. Став повільніше!`, `Net #${net.id} tangled under way — it'll catch less. Set it slower!`), 'bad');
    else this.onEvent?.(L(`🛟 Сітка №${net.id} стоїть (${Math.round(sh.laid)} м). Повертайся за кілька годин — буї на карті`, `🛟 Net #${net.id} is set (${Math.round(sh.laid)} m). Come back in a few hours — buoys are on the chart`), 'good');
  }

  private freeId(): number {
    for (let i = 1; i < 99; i++) if (!this.nets.some((n) => n.id === i)) return i;
    return this.nextId++;
  }

  /** скільки риби дасть сітка зараз (для витягування) */
  private rollCatch(n: NetSet, level: number, game: GameState): FishItem[] {
    const mx = (n.x0 + n.x1) / 2, mz = (n.z0 + n.z1) / 2;
    const zone = zoneFromDist(Math.hypot(mx, mz));
    const off = offshore(mx, mz);
    const base = zone === 'shore' ? 7 : zone === 'mid' ? 11 : 15;
    const soakF = 1 - Math.exp(-n.soakH / 4);
    const count = Math.round(base * (n.len / 40) * soakF * (1 - n.wear / 160) * (1 - this.gear / 220) * (0.75 + Math.random() * 0.45));
    const pool = FISH.filter((f) => f.zones.includes(zone));
    const deep = level >= 5 ? 2.2 : 1;
    // сітка бере косяки: звичайна риба частіше, рідкісна — далеко в морі й на глибоководний дрифтер
    const weights = pool.map((f) => {
      let w = 1 / Math.pow(f.rarity, 1.6);
      const rep = game.reportBoost(f.id, zone);
      if (rep > 1) w *= rep;
      w *= 1 + off * (f.rarity - 1) * 1.1 * deep;
      return w;
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    const fresh = n.soakH > SPOIL_H ? Math.max(20, 100 - (n.soakH - SPOIL_H) * 6) : 100;
    const out: FishItem[] = [];
    for (let i = 0; i < count; i++) {
      let x = Math.random() * sum;
      let sp = pool[0];
      for (let j = 0; j < pool.length; j++) {
        x -= weights[j];
        if (x <= 0) {
          sp = pool[j];
          break;
        }
      }
      const f = makeFish(sp.id, (sp.minKg + Math.random() * (sp.maxKg - sp.minKg)) * (0.75 + Math.random() * 0.3), false);
      f.freshness = fresh;
      out.push(f);
    }
    return out;
  }

  private startHaul(net: NetSet, fromStart: boolean, level: number, game: GameState, weather: Weather) {
    void weather;
    const fish = this.rollCatch(net, level, game);
    const dur = Math.max(5, net.len / (4 * netHaulSpeed(level)));
    this.haul = { net, prog: 0, dur, fish, given: 0, res: { hold: 0, deck: 0, lost: 0 }, fromStart };
    this.mode = 'haul';
    this.onSound?.('winch', 1);
    this.onEvent?.(L(`⚙ Вибираємо сітку №${net.id}…`, `⚙ Hauling net #${net.id}…`), 'good');
  }

  private finishHaul() {
    const h = this.haul;
    this.haul = null;
    this.mode = 'idle';
    if (!h) return;
    this.nets = this.nets.filter((n) => n !== h.net);
    this.gear = Math.min(100, this.gear + 5 + h.net.wear * 0.15);
    const n = h.fish.length;
    const parts = [L(`${h.res.hold} у трюм`, `${h.res.hold} to the hold`)];
    if (h.res.deck) parts.push(L(`${h.res.deck} на палубі`, `${h.res.deck} on deck`));
    if (h.res.lost) parts.push(L(`${h.res.lost} за борт — трюм повний`, `${h.res.lost} over the side — the hold is full`));
    this.onEvent?.(n ? L(`🎣 Сітка №${h.net.id}: ${n} риб (${parts.join(', ')})${h.net.soakH > SPOIL_H ? L(' · частина зіпсувалась', ` · some of it spoiled`) : ''}`, `🎣 Net #${h.net.id}: ${n} fish (${parts.join(', ')})${h.net.soakH > SPOIL_H ? L(' · частина зіпсувалась', ` · some of it spoiled`) : ''}`) : L(`Сітка №${h.net.id} порожня — постій довше або далі в морі`, `Net #${h.net.id} is empty — soak it longer or further out to sea`), n ? 'good' : 'warn');
    if (this.gear > 40) this.onEvent?.(L('Сітки зносились — лагодять у порту біля барабана', `The nets are worn — mend them in port at the drum`), 'warn');
  }

  /** години, що пройшли поза кадрами (сон) */
  advanceHours(h: number) {
    if (this.remote) return;
    for (const n of this.nets) n.soakH += h;
  }

  update(dt: number, dtHours: number, t: number, boat: Boat, ocean: Ocean, weather: Weather, cam: THREE.Vector3) {
    if (!this.remote) {
      // шторм рве сітки (сила погоди в точці сітки)
      for (let i = this.nets.length - 1; i >= 0; i--) {
        const n = this.nets[i];
        n.soakH += dtHours;
        const li = localIntensity(weather.base, seaMul((n.x0 + n.x1) / 2, (n.z0 + n.z1) / 2));
        if (li > 0.95) n.wear += dtHours * (li - 0.95) * 70;
        if (n.wear >= 100) {
          this.nets.splice(i, 1);
          this.lost++;
          this.onEvent?.(L(`🌊 Шторм порвав сітку №${n.id} — буй відірвало. Заміна в порту`, `🌊 The storm tore net #${n.id} — the buoy broke loose. Replace it in port`), 'bad');
        }
      }
      if (this.mode === 'shoot' && this.shoot) {
        const s = this.stern(boat);
        const sh = this.shoot;
        const dx = s.x - sh.x0, dz = s.z - sh.z0;
        const d = Math.hypot(dx, dz);
        if (d > 0.5) {
          sh.dx = dx / d;
          sh.dz = dz / d;
        }
        sh.laid = Math.min(sh.max, d);
        const v = Math.hypot(boat.vel.x, boat.vel.z);
        if (v > 6.5 && sh.laid > 3) this.finishShoot('tangle');
        else if (sh.laid >= sh.max) this.finishShoot('full');
      } else if (this.mode === 'haul' && this.haul) {
        const h = this.haul;
        h.prog = Math.min(1, h.prog + dt / h.dur);
        const want = Math.floor(h.prog * h.fish.length + 0.0001);
        while (h.given < want) {
          const f = h.fish[h.given++];
          const r = this.onFish?.(f, this.stern(boat)) ?? 'lost';
          h.res[r]++;
        }
        if (Math.random() < dt * 3) this.onSound?.('winch', 0.4);
        if (h.prog >= 1) this.finishHaul();
      }
    }
    this.draw(t, boat, ocean, cam);
  }

  // ── показ ──

  private draw(t: number, boat: Boat, ocean: Ocean, cam: THREE.Vector3) {
    let fi = 0;
    let bi = 0;
    const s = this.stern(boat);
    const line = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / FLOAT_STEP));
      for (let i = 0; i <= n && fi < MAX_FLOATS; i++) {
        const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
        if (Math.abs(x - cam.x) > 500 || Math.abs(z - cam.z) > 500) continue;
        this._p.set(x, ocean.heightAt(x, z, t) + 0.04, z);
        this._m.compose(this._p, this._q, this._s);
        this.floats.setMatrixAt(fi++, this._m);
      }
    };
    const putBuoy = (x: number, z: number, phase: number) => {
      const b = this.buoy(bi++);
      b.visible = true;
      const y = ocean.heightAt(x, z, t);
      b.position.set(x, y, z);
      b.rotation.set(Math.sin(t * 1.3 + phase) * 0.12, phase, Math.cos(t * 1.1 + phase) * 0.12);
      const flag = b.getObjectByName('flag');
      if (flag) flag.rotation.y = Math.sin(t * 3 + phase) * 0.35;
    };
    for (const n of this.nets) {
      if (this.haul && this.haul.net === n) {
        // вибирається: від корми до дальнього кінця, ближній кінець «їде» до барабана
        const h = this.haul;
        const fx = h.fromStart ? n.x1 : n.x0, fz = h.fromStart ? n.z1 : n.z0;
        const nx = h.fromStart ? n.x0 : n.x1, nz = h.fromStart ? n.z0 : n.z1;
        const cx = nx + (fx - nx) * h.prog, cz = nz + (fz - nz) * h.prog;
        line(s.x, s.z, cx, cz);
        line(cx, cz, fx, fz);
        putBuoy(fx, fz, n.id * 1.7);
        continue;
      }
      line(n.x0, n.z0, n.x1, n.z1);
      putBuoy(n.x0, n.z0, n.id * 1.7);
      putBuoy(n.x1, n.z1, n.id * 2.9);
    }
    if (this.shoot) {
      const sh = this.shoot;
      line(sh.x0, sh.z0, sh.x0 + sh.dx * sh.laid, sh.z0 + sh.dz * sh.laid);
      line(sh.x0 + sh.dx * sh.laid, sh.z0 + sh.dz * sh.laid, s.x, s.z);
      putBuoy(sh.x0, sh.z0, 0.4);
    }
    this.floats.count = fi;
    this.floats.instanceMatrix.needsUpdate = true;
    for (let i = bi; i < this.buoys.length; i++) this.buoys[i].visible = false;
  }

  /** буї для карти й мінікарти */
  markers(): Array<{ x0: number; z0: number; x1: number; z1: number; id: number; h: number }> {
    return this.nets.map((n) => ({ x0: n.x0, z0: n.z0, x1: n.x1, z1: n.z1, id: n.id, h: n.soakH }));
  }

  // ── збереження / кооп ──

  save(): NetsSave {
    return { nets: this.nets.map((n) => ({ ...n })), lost: this.lost, gear: this.gear, nextId: this.nextId };
  }

  load(d: unknown) {
    this.remote = false;
    this.shoot = null;
    this.haul = null;
    this.mode = 'idle';
    const s = d as Partial<NetsSave> | null | undefined;
    this.nets = Array.isArray(s?.nets) ? s!.nets.filter((n) => n && Number.isFinite(n.x0) && Number.isFinite(n.len)).map((n) => ({ ...n })) : [];
    this.lost = Number(s?.lost) || 0;
    this.gear = Number(s?.gear) || 0;
    this.nextId = Number(s?.nextId) || 1;
  }

  netState(): NetsNet {
    const r = (v: number) => Math.round(v * 10) / 10;
    return {
      n: this.nets.map((n) => [n.id, r(n.x0), r(n.z0), r(n.x1), r(n.z1), r(n.len), r(n.soakH)]),
      s: this.shoot ? [r(this.shoot.x0), r(this.shoot.z0), r(this.shoot.laid), r(this.shoot.dx * 100) / 100, r(this.shoot.dz * 100) / 100, this.shoot.max] : null,
      h: this.haul ? [this.haul.net.id, Math.round(this.haul.prog * 100) / 100, this.haul.fromStart ? 1 : 0] : null,
    };
  }

  /** кооп-гість: стан від капітана */
  applyNet(st: NetsNet) {
    this.remote = true;
    const old = new Map(this.nets.map((n) => [n.id, n]));
    this.nets = (st.n ?? []).map((a) => ({ ...(old.get(a[0]) ?? { wear: 0 }), id: a[0], x0: a[1], z0: a[2], x1: a[3], z1: a[4], len: a[5], soakH: a[6] }) as NetSet);
    if (st.s) {
      this.shoot = { x0: st.s[0], z0: st.s[1], laid: st.s[2], dx: st.s[3], dz: st.s[4], max: st.s[5] };
      this.mode = 'shoot';
    } else this.shoot = null;
    if (st.h) {
      const net = this.nets.find((n) => n.id === st.h![0]);
      if (net) {
        this.haul = { net, prog: st.h[1], dur: 1, fish: [], given: 0, res: { hold: 0, deck: 0, lost: 0 }, fromStart: st.h[2] === 1 };
        this.mode = 'haul';
      }
    } else this.haul = null;
    if (!st.s && !st.h) this.mode = 'idle';
  }
}

function fmtH(h: number): string {
  return h < 1 ? L(`${Math.round(h * 60)} хв`, `${Math.round(h * 60)} min`) : L(`${h.toFixed(h < 10 ? 1 : 0).replace('.', L(',', '.'))} год`, `${h.toFixed(h < 10 ? 1 : 0).replace('.', L(',', '.'))} h`);
}
