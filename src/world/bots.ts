import * as THREE from 'three';
import { isUk, L } from '../core/i18n';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Ocean } from '../core/ocean';
import type { Weather } from '../core/weather';
import { terrainHeight } from './portTerrain';
import type { RockObstacle } from './boat';

// ─────────────────────────────────────────────────────────────
// Місцеві рибалки: кілька човнів-ботів живуть своїм життям — стоять біля
// набережної, виходять у море, дрейфують на місці лову й повертаються.
// Коли по радіо штормове попередження (або вже дме) — усі, хто в морі,
// повертаються в порт і стоять, поки не стихне.
// Моделі дешеві: один меш (вершинні кольори) на корпус + окремі вітрила.
// Вогні — спільні Points на всіх. У коопі симулює капітан кімнати, гості
// отримують пози в пакеті світу й плавно їх доганяють.
// ─────────────────────────────────────────────────────────────

type Kind = 'trawler' | 'sloop';
type State = 'moored' | 'leaving' | 'transit' | 'fishing' | 'return' | 'docking';
const ST: State[] = ['moored', 'leaving', 'transit', 'fishing', 'return', 'docking'];

interface Def {
  name: string;
  kind: Kind;
  hull: number;
  trim: number;
  /** причал біля набережної (не місця гравців: ті на z = −15.9, x −11.5…21) */
  berth: { x: number; z: number; h: number };
  /** зона лову: радіус від порту */
  zone: [number, number];
  cruise: number;
}

const QUAY_Z = -36.6;
const DEFS: Def[] = [
  { name: 'Ластівка', kind: 'trawler', hull: 0x2f6f9f, trim: 0xf1ece0, berth: { x: 34, z: QUAY_Z, h: -Math.PI / 2 }, zone: [160, 380], cruise: 6.2 },
  { name: 'Стара Марта', kind: 'trawler', hull: 0xb8432e, trim: 0xf3e6c8, berth: { x: 45, z: QUAY_Z, h: -Math.PI / 2 }, zone: [420, 820], cruise: 5.6 },
  { name: 'Чайка', kind: 'sloop', hull: 0xf4f1ea, trim: 0x24878c, berth: { x: 56, z: QUAY_Z, h: -Math.PI / 2 }, zone: [200, 520], cruise: 6.8 },
  { name: 'Дельфін', kind: 'trawler', hull: 0x3e7d4f, trim: 0xf1ece0, berth: { x: -47, z: QUAY_Z, h: Math.PI / 2 }, zone: [300, 700], cruise: 5.9 },
  { name: 'Бриз', kind: 'sloop', hull: 0x22303b, trim: 0xe2674a, berth: { x: -58, z: QUAY_Z, h: Math.PI / 2 }, zone: [140, 420], cruise: 7.2 },
];

/** точка на підході до причалу (з моря — прямо на північ) */
const APPROACH_Z = -22;
const LANE_Z = 14;

interface Bot {
  d: Def;
  group: THREE.Group;
  sails: THREE.Mesh | null;
  x: number;
  z: number;
  h: number;
  spd: number;
  /** куди хоче (поточна точка шляху) */
  path: Array<[number, number]>;
  state: State;
  timer: number;
  /** м'яке відхилення (запам'ятати бік обходу) */
  avoidSide: number;
  stuckT: number;
  lastD: number;
  roll: number;
  /** нахил по хвилі (згладжена нормаль) */
  nrm: THREE.Vector3;
  /** гість: мережева ціль */
  net: { x: number; z: number; h: number; spd: number; at: number } | null;
  /** скільки секунд ловив у цьому рейсі (улов здає на біржу, коли пришвартується) */
  fishT: number;
}

const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

export interface BotMarker {
  x: number;
  z: number;
  h: number;
  name: string;
}

export class Bots {
  /** кооп-гість: не симулювати, лише доганяти пози від капітана */
  remote = false;
  /** радіо-репліки («Ластівка» повертається…) */
  onChatter: ((name: string, text: string) => void) | null = null;
  /** гудок поруч із гравцем */
  onHorn: ((vol: number) => void) | null = null;
  /** пришвартувався після лову: здає улов на біржу (зона лову за відстанню, секунди лову) */
  onUnload: ((name: string, zoneR: [number, number], fishSec: number) => void) | null = null;
  readonly list: Bot[] = [];
  private lights: THREE.Points;
  private lightPos: Float32Array;
  private mat: THREE.MeshStandardMaterial;
  private sailMat: THREE.MeshStandardMaterial;
  private chatterT = 20;
  private hornT = 0;
  /** блоковані зони (причали, пірси) — прямокутники */
  private blocks: Array<{ x0: number; z0: number; x1: number; z1: number }> = [];
  private rocks: RockObstacle[] = [];
  private stormMode = false;

  constructor(private scene: THREE.Scene, platforms: Array<{ x0: number; z0: number; x1: number; z1: number }>, rocks: RockObstacle[]) {
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
    this.sailMat = new THREE.MeshStandardMaterial({ color: 0xf5efe0, roughness: 0.85, side: THREE.DoubleSide });
    this.blocks = platforms.map((p) => ({ x0: p.x0 - 2.5, z0: p.z0 - 2.5, x1: p.x1 + 2.5, z1: p.z1 + 2.5 }));
    this.rocks = rocks;
    DEFS.forEach((d, i) => {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(buildHull(d), this.mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      let sails: THREE.Mesh | null = null;
      if (d.kind === 'sloop') {
        sails = new THREE.Mesh(buildSails(), this.sailMat);
        sails.castShadow = true;
        group.add(sails);
      }
      group.name = 'bot:' + d.name;
      scene.add(group);
      const b: Bot = {
        d, group, sails,
        x: d.berth.x, z: d.berth.z, h: d.berth.h, spd: 0,
        path: [], state: 'moored',
        // розійтись у часі: хтось одразу в морі
        timer: 15 + i * 35 + Math.random() * 30,
        avoidSide: i % 2 ? 1 : -1, stuckT: 0, lastD: 1e9, roll: 0,
        nrm: new THREE.Vector3(0, 1, 0), net: null, fishT: 0,
      };
      this.list.push(b);
    });
    // ходові вогні: на кожен човен — червоний (лівий), зелений (правий), білий (топ)
    const n = this.list.length * 3;
    this.lightPos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < this.list.length; i++) {
      col.set([1, 0.15, 0.1, 0.15, 1, 0.3, 1, 0.97, 0.85], i * 9);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.lightPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.lights = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.7, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false }));
    this.lights.frustumCulled = false;
    this.lights.visible = false;
    scene.add(this.lights);
  }

  /** чи треба ховатися від погоди */
  private stormy(w: Weather): boolean {
    const eta = w.stormEta;
    return w.base > 0.58 || w.forecast > 0.74 || (eta != null && eta < 260);
  }

  /** others — човни гравців (перешкоди для обходу) */
  update(dt: number, t: number, ocean: Ocean, weather: Weather, daylight: number, others: Array<{ x: number; z: number }>, player?: { x: number; z: number }) {
    if (this.remote) this.followNet(dt);
    else this.simulate(dt, weather, others);
    // поза на хвилі — у всіх
    for (const b of this.list) this.pose(b, dt, t, ocean);
    this.updateLights(daylight);
    // гудок, коли гравець поруч із ходовим ботом
    this.hornT -= dt;
    if (player && this.hornT <= 0) {
      for (const b of this.list) {
        if (b.spd < 2) continue;
        const d = Math.hypot(b.x - player.x, b.z - player.z);
        if (d < 22) {
          this.onHorn?.(Math.max(0.25, 1 - d / 22));
          this.hornT = 25;
          break;
        }
      }
    }
  }

  private simulate(dt: number, weather: Weather, others: Array<{ x: number; z: number }>) {
    const storm = this.stormy(weather);
    this.chatterT -= dt;
    if (storm && !this.stormMode) {
      // штормове попередження: всі, хто в морі — додому
      const atSea = this.list.filter((b) => b.state === 'transit' || b.state === 'fishing' || b.state === 'leaving');
      for (const b of atSea) this.goHome(b);
      if (atSea.length) this.chatter(atSea[0].d.name, atSea.length > 1 ? L(`повертаємось у порт, барометр падає — ${atSea.length} човни йдуть додому`, `heading back to port, the glass is falling — ${atSea.length} boats going home`) : L('повертаюсь у порт, барометр падає', `heading back to port, the glass is falling`));
    }
    if (!storm && this.stormMode) {
      // після шторму — виходять не всі одразу
      this.list.forEach((b, i) => {
        if (b.state === 'moored') b.timer = 40 + i * 30 + Math.random() * 60;
      });
    }
    this.stormMode = storm;

    for (const b of this.list) {
      b.timer -= dt;
      switch (b.state) {
        case 'moored':
          b.spd = 0;
          if (b.timer <= 0 && !storm) this.leave(b);
          break;
        case 'leaving':
        case 'transit':
        case 'return':
          this.steer(b, dt, others, b.state === 'return' && storm ? b.d.cruise * 1.15 : b.d.cruise);
          if (b.path.length === 0) {
            if (b.state === 'leaving') {
              b.state = 'transit';
              b.path = [this.fishingSpot(b)];
              b.lastD = 1e9;
            } else if (b.state === 'transit') {
              b.state = 'fishing';
              b.timer = 120 + Math.random() * 200;
              if (Math.random() < 0.3) this.chatter(b.d.name, L('на місці, кидаю снасті', `on the spot, setting my gear`));
            } else {
              b.state = 'docking';
              b.timer = 0;
            }
          }
          break;
        case 'fishing': {
          // повільний дрейф колом
          b.spd += (0.7 - b.spd) * Math.min(1, dt * 0.5);
          b.fishT += dt;
          b.h += dt * 0.05 * b.avoidSide;
          b.x += Math.sin(b.h) * b.spd * dt;
          b.z += Math.cos(b.h) * b.spd * dt;
          if (b.timer <= 0) this.goHome(b);
          break;
        }
        case 'docking': {
          // останні метри: тихо стати бортом до набережної
          const B = b.d.berth;
          b.timer += dt;
          const k = Math.min(1, dt * 0.45);
          b.x += (B.x - b.x) * k;
          b.z += (B.z - b.z) * k;
          b.h += wrap(B.h - b.h) * Math.min(1, dt * 0.6);
          b.spd = Math.hypot(B.x - b.x, B.z - b.z) * 0.45;
          if (Math.hypot(B.x - b.x, B.z - b.z) < 0.15 || b.timer > 25) {
            b.x = B.x;
            b.z = B.z;
            b.h = B.h;
            b.state = 'moored';
            b.spd = 0;
            b.timer = storm ? 60 : 90 + Math.random() * 180;
            if (b.fishT > 5) this.onUnload?.(b.d.name, b.d.zone, b.fishT);
            b.fishT = 0;
          }
          break;
        }
      }
      this.separate(b, others);
    }
  }

  private leave(b: Bot) {
    const B = b.d.berth;
    b.state = 'leaving';
    b.path = [[B.x, APPROACH_Z], [B.x + Math.sign(B.x) * 6, LANE_Z]];
    b.lastD = 1e9;
    b.stuckT = 0;
    if (Math.random() < 0.45) this.chatter(b.d.name, Math.random() < 0.5 ? L('виходжу в море, до вечора', `heading out to sea, back by evening`) : L('віддаю швартови, йду на лов', `casting off, going fishing`));
  }

  private goHome(b: Bot) {
    const B = b.d.berth;
    b.state = 'return';
    b.path = [[B.x + Math.sign(B.x) * 6, LANE_Z], [B.x, APPROACH_Z], [B.x, B.z + 3.5]];
    // якщо вже під причалом — не їхати назад у море
    if (b.z < LANE_Z + 6 && Math.abs(b.x - B.x) < 30) b.path.shift();
    b.lastD = 1e9;
    b.stuckT = 0;
  }

  private fishingSpot(b: Bot): [number, number] {
    for (let k = 0; k < 40; k++) {
      const a = (Math.random() - 0.5) * 2.6; // на південь від берега
      const r = b.d.zone[0] + Math.random() * (b.d.zone[1] - b.d.zone[0]);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (this.free(x, z, 14)) return [x, z];
    }
    return [b.d.berth.x * 3, 200];
  }

  /** чиста вода в точці (запас m) */
  private free(x: number, z: number, m = 4): boolean {
    if (terrainHeight(x, z) > -2.2) return false;
    for (const r of this.rocks) if (Math.abs(r.x - x) < r.r + m && Math.abs(r.z - z) < r.r + m && Math.hypot(r.x - x, r.z - z) < r.r + m) return false;
    for (const p of this.blocks) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) return false;
    return true;
  }

  /** курс на точку шляху з обходом берега, скель, причалів і човнів */
  private steer(b: Bot, dt: number, others: Array<{ x: number; z: number }>, cruise: number) {
    const [tx, tz] = b.path[0];
    const dx = tx - b.x, dz = tz - b.z;
    const dist = Math.hypot(dx, dz);
    const last = b.path.length === 1;
    const reach = last && (b.state === 'return' || b.state === 'leaving') ? 2.5 : b.state === 'transit' ? 12 : 6;
    if (dist < reach) {
      b.path.shift();
      b.lastD = 1e9;
      return;
    }
    // застряг (обхід зациклився) — нова мета або пропустити точку
    if (dist < b.lastD - 0.5) {
      b.lastD = dist;
      b.stuckT = 0;
    } else {
      b.stuckT += dt;
      if (b.stuckT > 25) {
        b.stuckT = 0;
        b.lastD = 1e9;
        b.avoidSide = -b.avoidSide;
        if (b.state === 'transit') b.path = [this.fishingSpot(b)];
        else if (b.path.length > 1) b.path.shift();
      }
    }
    const want = Math.atan2(dx, dz);
    // у гавані — коротший огляд (там вузько), у морі — далекий
    const harbour = Math.hypot(b.x, b.z + 25) < 70;
    const look = harbour ? [4, 8, 12] : [7, 14, 22, 32];
    let best = want;
    let found = false;
    for (const off of [0, 0.3, 0.6, 0.9, 1.25, 1.6, 2.0, 2.5]) {
      for (const sgn of off ? [b.avoidSide, -b.avoidSide] : [1]) {
        const h = want + off * sgn;
        let ok = true;
        for (const L of look) {
          const px = b.x + Math.sin(h) * L, pz = b.z + Math.cos(h) * L;
          // фінальна точка біля причалу сама «в блоці» — до неї можна
          if (last && Math.hypot(px - tx, pz - tz) < 5) break;
          if (!this.free(px, pz, harbour ? 1.5 : 4) || this.boatNear(b, px, pz, others, 7)) {
            ok = false;
            break;
          }
        }
        if (ok) {
          best = h;
          found = true;
          if (off) b.avoidSide = sgn;
          break;
        }
      }
      if (found) break;
    }
    const turn = wrap(best - b.h);
    const rate = 0.18 + 0.05 * Math.min(b.spd, 6);
    b.h = wrap(b.h + Math.max(-rate * dt, Math.min(rate * dt, turn)));
    b.roll += (-turn * 0.08 * Math.min(1, b.spd / 4) - b.roll) * Math.min(1, dt * 2);
    // швидкість: повільно в гавані й на поворотах, стоп, якщо попереду глухо
    let target = cruise;
    if (harbour) target = Math.min(target, 2.6);
    if (last && (b.state === 'return' || b.state === 'leaving')) target = Math.min(target, 0.6 + dist * 0.25);
    target *= 1 - Math.min(0.7, Math.abs(turn) * 0.5);
    if (!found) {
      // глухо в усі боки — розвертатись на місці в бік обходу
      target = 0.8;
      b.h = wrap(b.h + b.avoidSide * rate * dt);
    }
    const acc = target > b.spd ? 0.6 : 1.2;
    b.spd += Math.max(-acc * dt, Math.min(acc * dt, target - b.spd));
    b.x += Math.sin(b.h) * b.spd * dt;
    b.z += Math.cos(b.h) * b.spd * dt;
  }

  private boatNear(self: Bot, x: number, z: number, others: Array<{ x: number; z: number }>, r: number): boolean {
    for (const o of others) if (Math.abs(o.x - x) < r && Math.abs(o.z - z) < r && Math.hypot(o.x - x, o.z - z) < r) return true;
    // між собою: поступається лише «молодший» (інакше двоє взаємно блокуються)
    const me = this.list.indexOf(self);
    for (let i = 0; i < me; i++) {
      const b = this.list[i];
      if (b.state !== 'moored' && Math.hypot(b.x - x, b.z - z) < r * 0.7) return true;
    }
    return false;
  }

  /** не налазити на човни гравців і один на одного (м'який поштовх) */
  private separate(b: Bot, others: Array<{ x: number; z: number }>) {
    if (b.state === 'moored') return;
    const push = (ox: number, oz: number, R: number, slow: boolean) => {
      const dx = b.x - ox, dz = b.z - oz;
      const d = Math.hypot(dx, dz);
      if (d >= R || d < 1e-3) return;
      const k = (R - d) * 0.5;
      b.x += (dx / d) * k;
      b.z += (dz / d) * k;
      if (slow) b.spd = Math.max(0.5, b.spd * 0.97);
    };
    for (const o of others) push(o.x, o.z, 6, true);
    for (const o of this.list) if (o !== b) push(o.x, o.z, 5, false);
  }

  private chatter(name: string, text: string) {
    if (this.chatterT > 0) return;
    this.chatterT = 35;
    this.onChatter?.(botName(name), text);
  }

  /** поза на хвилі: висота й нахил за водою, легкий крен на поворотах */
  private pose(b: Bot, dt: number, t: number, ocean: Ocean) {
    const y = ocean.heightAt(b.x, b.z, t);
    ocean.normalAt(b.x, b.z, t, _n);
    // важкий човен — нахил згладжений, не повторює кожну брижу
    b.nrm.lerp(_n, Math.min(1, dt * 2.5)).normalize();
    const g = b.group;
    g.position.set(b.x, y - 0.05 - 0.03 * b.spd, b.z);
    _q.setFromUnitVectors(_up, _v.copy(b.nrm).lerp(_up, 0.35).normalize());
    _e.set(-Math.min(0.05, b.spd * 0.006), b.h, b.roll, 'YXZ');
    _q2.setFromEuler(_e);
    g.quaternion.copy(_q).multiply(_q2);
    if (b.sails) b.sails.visible = b.state === 'transit' || b.state === 'return' || (b.state === 'leaving' && b.spd > 2);
  }

  private updateLights(daylight: number) {
    const on = daylight < 0.55;
    this.lights.visible = on;
    if (!on) return;
    const P = this.lightPos;
    this.list.forEach((b, i) => {
      const L = b.d.kind === 'sloop' ? 8.8 : 4.6;
      const pts: Array<[number, number, number]> = [[-1.25, 1.35, 1.6], [1.25, 1.35, 1.6], [0, L, b.d.kind === 'sloop' ? 0.6 : 1.7]];
      pts.forEach(([x, y, z], k) => {
        _v.set(x, y, z).applyQuaternion(b.group.quaternion).add(b.group.position);
        P[(i * 3 + k) * 3] = _v.x;
        P[(i * 3 + k) * 3 + 1] = _v.y;
        P[(i * 3 + k) * 3 + 2] = _v.z;
      });
    });
    this.lights.geometry.attributes.position.needsUpdate = true;
  }

  // ── кооп ──

  /** капітан → гості: x, z, курс, швидкість, стан (по 5 чисел на човен) */
  netState(): number[] {
    const out: number[] = [];
    for (const b of this.list) out.push(Math.round(b.x * 10) / 10, Math.round(b.z * 10) / 10, Math.round(b.h * 1000) / 1000, Math.round(b.spd * 10) / 10, ST.indexOf(b.state));
    return out;
  }

  applyNet(a: unknown) {
    if (!Array.isArray(a)) return;
    const now = performance.now() / 1000;
    for (let i = 0; i < this.list.length && i * 5 + 4 < a.length; i++) {
      const [x, z, h, spd, st] = a.slice(i * 5, i * 5 + 5).map(Number);
      if (![x, z, h, spd].every(Number.isFinite)) continue;
      const b = this.list[i];
      b.state = ST[st] ?? 'moored';
      // перший пакет або телепорт — одразу на місце
      if (!b.net || Math.hypot(b.x - x, b.z - z) > 60) {
        b.x = x;
        b.z = z;
        b.h = h;
      }
      b.net = { x, z, h, spd, at: now };
    }
  }

  private followNet(dt: number) {
    const now = performance.now() / 1000;
    for (const b of this.list) {
      const n = b.net;
      if (!n) continue;
      // екстраполяція за швидкістю (пакети 10 Гц), далі м'яко доганяємо
      const a = Math.min(1, now - n.at);
      const px = n.x + Math.sin(n.h) * n.spd * a, pz = n.z + Math.cos(n.h) * n.spd * a;
      const k = Math.min(1, dt * 4);
      const ox = b.x, oz = b.z;
      b.x += (px - b.x) * k;
      b.z += (pz - b.z) * k;
      const turn = wrap(n.h - b.h);
      b.h = wrap(b.h + turn * k);
      b.roll += (-turn * 0.6 * Math.min(1, n.spd / 4) - b.roll) * Math.min(1, dt * 2);
      b.spd = dt > 0 ? Math.hypot(b.x - ox, b.z - oz) / dt : n.spd;
    }
  }

  // ── для карти, мінікарти, фізики ──

  markers(): BotMarker[] {
    return this.list.map((b) => ({ x: b.x, z: b.z, h: b.h, name: botName(b.d.name) }));
  }

  /** перешкоди для фізики яхти гравця (як інші яхти флотилії) */
  obstacles(): Array<{ x: number; z: number; r: number; kind: 'mark' }> {
    return this.list.map((b) => ({ x: b.x, z: b.z, r: b.d.kind === 'sloop' ? 2.3 : 2.5, kind: 'mark' as const }));
  }

  /** найближчий бот (для підказок і тестів) */
  nearest(x: number, z: number): { name: string; d: number; state: State } | null {
    let best: Bot | null = null, bd = Infinity;
    for (const b of this.list) {
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best ? { name: botName(best.d.name), d: bd, state: best.state } : null;
  }

  dispose() {
    for (const b of this.list) {
      this.scene.remove(b.group);
      b.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.scene.remove(this.lights);
    this.lights.geometry.dispose();
  }
}

/** м'яка кругла пляма для вогнів */
function glowTex(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// ── моделі (локально: +z — нос, y = 0 — ватерлінія) ──

function tint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // для merge — однаковий набір атрибутів
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') geo.deleteAttribute(k);
  return geo;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return tint(g, hex);
}

function cyl(r0: number, r1: number, h: number, x: number, y: number, z: number, hex: number, rotZ = 0, rotX = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r0, r1, h, 7);
  if (rotZ) g.rotateZ(rotZ);
  if (rotX) g.rotateX(rotX);
  g.translate(x, y, z);
  return tint(g, hex);
}

function hullGeo(len: number, beam: number, hex: number, stripe: number): THREE.BufferGeometry[] {
  const half = len / 2;
  const bw = beam / 2;
  const shape = new THREE.Shape();
  // контур у площині (x, y) → потім y стає z (нос +z)
  shape.moveTo(-bw * 0.8, -half);
  shape.lineTo(bw * 0.8, -half);
  shape.quadraticCurveTo(bw * 1.05, -half * 0.2, bw, half * 0.25);
  shape.quadraticCurveTo(bw * 0.8, half * 0.8, 0, half);
  shape.quadraticCurveTo(-bw * 0.8, half * 0.8, -bw, half * 0.25);
  shape.quadraticCurveTo(-bw * 1.05, -half * 0.2, -bw * 0.8, -half);
  const H = 1.5;
  const make = (h: number, inset: number, y0: number, c: number) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: 0.1, bevelSize: inset, bevelSegments: 1, curveSegments: 7 });
    g.rotateX(Math.PI / 2); // видавлення вниз, контур +y → нос +z
    g.translate(0, y0, 0);
    return tint(g, c);
  };
  // корпус від −0.75 (під водою) до +0.75; смуга по планширу
  const out = [make(H, 0.06, 0.75, hex)];
  const s = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false, curveSegments: 7 });
  s.rotateX(Math.PI / 2);
  s.scale(1.02, 1, 1.02);
  s.translate(0, 0.86, 0);
  out.push(tint(s, stripe));
  // палуба
  const dk = new THREE.ShapeGeometry(shape, 7);
  dk.rotateX(-Math.PI / 2); // лицем угору, нос → −z
  dk.rotateY(Math.PI); // нос → +z
  dk.scale(0.94, 1, 0.96);
  dk.translate(0, 0.78, 0);
  out.push(tint(dk, 0xc9a77a));
  return out;
}

function buildHull(d: Def): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const white = 0xf3efe6, dark = 0x2a3a46, wood = 0x8a5a36, steel = 0x9aa3a8;
  if (d.kind === 'trawler') {
    parts.push(...hullGeo(9, 3.2, d.hull, d.trim));
    // рубка ближче до носа, вікна темною смугою
    parts.push(box(2.1, 1.5, 2.2, 0, 1.55, 1.4, white));
    parts.push(box(2.16, 0.38, 2.26, 0, 1.85, 1.4, dark));
    parts.push(box(2.4, 0.12, 2.6, 0, 2.36, 1.35, d.trim));
    // щогла з реєм і П-подібна рама на кормі (трал)
    parts.push(cyl(0.07, 0.09, 3.2, 0, 3.9, 1.7, steel));
    parts.push(cyl(0.04, 0.04, 1.6, 0, 4.6, 1.7, steel, Math.PI / 2));
    for (const s of [-1, 1]) parts.push(cyl(0.08, 0.08, 2.6, s * 1.15, 2.05, -3.6, d.trim));
    parts.push(cyl(0.08, 0.08, 2.4, 0, 3.3, -3.6, d.trim, Math.PI / 2));
    // ящики й бухта сітки на кормі
    parts.push(box(1.0, 0.5, 0.8, -0.6, 1.03, -1.6, 0x3d7fb0));
    parts.push(box(0.9, 0.45, 0.8, 0.65, 1.0, -2.2, 0xd9a514));
    parts.push(cyl(0.5, 0.5, 0.35, 0.2, 0.98, -2.8, 0x5d6b4a));
    // кранці
    for (const s of [-1, 1]) for (const z of [-1.5, 1.5]) parts.push(cyl(0.16, 0.16, 0.6, s * 1.62, 0.55, z, white));
  } else {
    parts.push(...hullGeo(8.6, 2.8, d.hull, d.trim));
    parts.push(box(1.6, 0.55, 2.8, 0, 1.05, 0.2, white));
    parts.push(box(1.64, 0.14, 2.0, 0, 1.12, 0.35, dark));
    parts.push(cyl(0.07, 0.09, 9.2, 0, 5.3, 1.4, 0xe8e4da));
    parts.push(cyl(0.05, 0.05, 3.6, 0, 2.0, -0.4, wood, 0, Math.PI / 2));
    // кокпіт
    parts.push(box(1.7, 0.2, 1.6, 0, 0.82, -2.6, wood));
    parts.push(box(1.0, 0.35, 0.18, 0, 1.0, -3.3, d.trim));
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** грот і стаксель (окремий меш — ховаються, коли човен стоїть) */
function buildSails(): THREE.BufferGeometry {
  const tri = (a: number[], b: number[], c: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
    g.computeVertexNormals();
    return g;
  };
  const main = tri([0, 2.1, 1.3], [0, 9.6, 1.3], [0, 2.1, -2.1]);
  const jib = tri([0, 1.2, 4.1], [0, 8.9, 1.5], [0, 1.4, 1.6]);
  // трішки «пузом» (злегка розвернути)
  main.rotateY(0.18);
  jib.rotateY(0.25);
  return mergeGeometries([main, jib], false)!;
}

/** імена ботів — українські (вони ж ключі в новинах біржі); англійською — переклад */
const BOT_EN: Record<string, string> = { 'Ластівка': 'Swallow', 'Стара Марта': 'Old Martha', 'Чайка': 'Seagull', 'Дельфін': 'Dolphin', 'Бриз': 'Breeze' };
export function botName(uk: string): string {
  return isUk() ? uk : BOT_EN[uk] ?? uk;
}
