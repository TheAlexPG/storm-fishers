import * as THREE from 'three';
import { clamp, rand } from '../core/math';
import { Boat } from '../world/boat';
import { FISH, FISH_BY_ID, fishingSpot, makeFish, rollKg, zoneFromDist, type FishingSpot } from './fish';
import { eff, holderBiteSpeed, holderBiteWindow } from './upgrades';
import { paceMul } from './pace';
import { rodModel, RACK_SLOTS, HOLDER_MOUNTS, type PartKit } from '../world/upgradeParts';
import type { GameState } from './state';
import { offshore, type Weather } from '../core/weather';
import type { TimeCycle } from '../core/time';
import type { Ocean } from '../core/ocean';
import type { AudioEngine } from '../core/audio';
import type { Input } from '../core/input';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Ловля як мінігра — вудки фізичні:
//  • вудки стоять у носовій стійці; E — взяти в руки / поставити назад;
//  • з вудкою в руках: тримай ЛКМ — шкала сили, відпусти — закид туди, куди
//    дивишся; поплавок летить дугою; R — змотати;
//  • риба спершу «пробує» (підсічка зарано лякає), справжнє клювання топить
//    поплавок — клікни ЛКМ швидко;
//  • стійки на бортах (апгрейд): закинуту вудку можна поставити в стійку й
//    узяти іншу; клює в стійці — дзвіночок, біжи й хапай (E) за кілька секунд;
//  • боротьба: риба рветься вбік — нахиляй вудку навпаки (A/D), тягни Space,
//    тримай натяг у зеленій зоні, на стрибку відпусти. Ривки й стрибки риба
//    «готує» (видно заздалегідь), натяг змінюється плавно, а волосінь рветься
//    лише після кількох секунд перетягу — з попередженням.
//  • місце: далеко від берега й стай клює рідше, але частіше трофеї.
// ─────────────────────────────────────────────────────────────

export type FishingState = 'idle' | 'charge' | 'waiting' | 'bite' | 'fight';
export type RodKind = 'main' | 'spin' | 'donka' | 'troll';
type RodState = 'idle' | 'waiting' | 'bite';

const ROD_INFO: Record<RodKind, { name: string; cast: number; bite: number; trophy: number; color: number }> = {
  main: { name: L('Твоя вудка', `Your rod`), cast: 1, bite: 1, trophy: 0, color: 0xe8432f },
  spin: { name: L('Спінінг', `Spinning rod`), cast: 1.2, bite: 1.1, trophy: 0.1, color: 0xf2c12e },
  donka: { name: L('Донка', `Bottom rod`), cast: 0.85, bite: 1.3, trophy: 0.25, color: 0x3fae5a },
  troll: { name: L('Троллінгова вудка', `Trolling rod`), cast: 1.35, bite: 1, trophy: 0.6, color: 0x2f7fd0 },
};
const HOLDER_NAMES = [L('лівий борт', `port side`), L('правий борт', `starboard side`), L('корма', `stern`)];

/** зелена зона натягу (в межах 0..100): звичайна / «легка риболовля» */
const SWEET = { lo: 42, hi: 74 };
const SWEET_EASY = { lo: 36, hi: 78 };
/** скільки секунд перетягу волосінь витримує */
const GRACE = 1.5;
const GRACE_EASY = 2.4;
/** скільки секунд слабини риба терпить */
const SLACK = 3.5;
const SLACK_EASY = 5;
/** вікно підсічки, с */
const BITE_WINDOW = 1.6;
const BITE_WINDOW_EASY = 2.3;
/** шкала закиду: зелена зона */
export const CAST_SWEET = { lo: 0.74, hi: 0.95 };
export const CAST_SWEET_EASY = { lo: 0.66, hi: 0.97 };
/** понад цю швидкість (м/с) волосінь не втримати — вудки змотуються */
const MAX_TROLL_SPEED = 5;

class Rod {
  state: RodState = 'idle';
  where: 'none' | 'rack' | 'hand' | 'holder' = 'none';
  slot = 0;
  readonly pivot = new THREE.Group();
  readonly inner = new THREE.Group();
  tip!: THREE.Object3D;
  bobber: THREE.Mesh;
  line: THREE.Line;
  bobberPos = new THREE.Vector3();
  castDist = 10;
  biteAt = 0;
  biteWindow = 0;
  biteWindow0 = 1;
  biteAge = 0;
  nibble = 0;
  nibbleT = 0;
  perfect = false;
  /** політ поплавка після закиду: 0..1 (1 — на воді) */
  fly = 1;
  flyFrom = new THREE.Vector3();
  shake = 0;
  /** берегова вудка (з причалу / берега) — не з човна */
  shore = false;
  /** закинуто з берега: клює рідко й дрібне */
  pier = false;
  constructor(readonly kind: RodKind, mesh: THREE.Object3D, tipY: number) {
    this.pivot.add(this.inner);
    this.pivot.userData.rod = true;
    this.inner.add(mesh);
    const tip = mesh.getObjectByName('tip');
    if (tip) this.tip = tip;
    else {
      this.tip = new THREE.Object3D();
      this.tip.position.y = tipY;
      mesh.add(this.tip);
    }
    // поплавок кольору вудки: верх кольоровий, низ білий
    const col = ROD_INFO[kind].color;
    this.bobber = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, emissive: col, emissiveIntensity: 0.35 }),
    );
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.5 }));
    this.bobber.add(belly);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 }));
    stick.position.y = 0.2;
    this.bobber.add(stick);
    this.bobber.visible = false;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(13 * 3), 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xdde8ee, transparent: true, opacity: 0.65 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
  }
  get name() {
    return ROD_INFO[this.kind].name;
  }
}

export class Fishing {
  /** «поточний» поплавок (боротьба / вудка в руках) — для ефектів у main */
  get bobber(): THREE.Mesh {
    return (this.fightRod ?? this.hand ?? this.rods[0]).bobber;
  }
  private ripples: Array<{ m: THREE.Mesh; age: number; x: number; z: number; power: number }> = [];

  private rods: Rod[] = [];
  /** вудка в руках */
  hand: Rod | null = null;
  /** що стоїть у кожній бортовій стійці */
  private holders: Array<Rod | null> = [null, null, null];
  /** група «руки»: її ставить main за камерою/тілом */
  readonly handGroup = new THREE.Group();
  private handLocal = new THREE.Group();
  private charging = false;
  castPower = 0;
  private castPhase = 0;

  // боротьба (завжди з вудкою в руках)
  private fightRod: Rod | null = null;
  private fightTension = 0;
  private fightDist = 0;
  private fightMaxDist = 1;
  private fishKg = 1;
  private fishSpeciesId = 'hamsa';
  private overTension = 0;
  private lineBreakAt = 90;
  /** згладжена швидкість зміни натягу (без ривків) */
  private tRate = 0;
  /** сила поточного ривка 0..1 (наростає плавно) */
  private pullK = 0;
  /** риба «готує» ривок у бік nextPull */
  private windup = 0;
  private nextPull = 0;
  /** риба готується вистрибнути */
  private jumpWarn = 0;
  private canJump = true;
  private small = false;
  private strainBeep = 0;
  private fishTrophy = false;
  /** фрикціон травить волосінь (0..1) */
  private dragSlip = 0;
  /** «легка риболовля» (налаштування) */
  easy = true;
  /** місце, де закинута вудка в руках (для підказки в HUD) */
  spot: FishingSpot | null = null;
  private stamina = 100;
  private staminaMax = 100;
  /** куди рветься риба: −1 ліворуч, +1 праворуч, 0 — тягне в глибину */
  pull = 0;
  /** нахил вудки гравцем −1..1 (згладжений) */
  lean = 0;
  private side = 0;
  private jumpT = 0;
  private nextJump = 5;
  private slackT = 0;
  private pullT = 0;
  private rippleT = 0;
  private fightDir = new THREE.Vector3();
  /** коротке повідомлення в HUD */
  status = '';
  private statusT = 0;
  private tipW = new THREE.Vector3();
  private _d = new THREE.Vector3();
  private _q = new THREE.Quaternion();

  onEvent: ((msg: string, kind: 'warn' | 'bad' | 'good') => void) | null = null;
  /** гравець на березі/причалі (не на човні) — рибалить береговою вудкою */
  ashore = false;
  /** чи є вода в точці (для закиду з берега) */
  waterAt: ((x: number, z: number) => boolean) | null = null;
  private shoreRod: Rod;
  private pierTip = false;
  onSplash: ((pos: THREE.Vector3, power: number) => void) | null = null;
  onLeap: ((speciesId: string, kg: number, pos: THREE.Vector3) => void) | null = null;

  constructor(scene: THREE.Scene, private audio: AudioEngine, private boat: Boat) {
    const ringGeo = new THREE.RingGeometry(0.85, 1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this.ripples.push({ m, age: 9, x: 0, z: 0, power: 0.5 });
    }
    // вудки: основна — та, що стояла на носі; решта — з апгрейду стійок
    const mats = new Map<string, THREE.MeshStandardMaterial>();
    const kit: PartKit = {
      mat: (c, r = 0.8, m = 0.05) => {
        const k = `${c}|${r}|${m}`;
        let mat = mats.get(k);
        if (!mat) mats.set(k, (mat = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m })));
        return mat;
      },
    };
    const main = boat.takeMainRod();
    this.rods.push(new Rod('main', main.group, main.len));
    for (const k of ['spin', 'donka', 'troll'] as const) this.rods.push(new Rod(k, rodModel(kit, k), 2));
    // берегова вудка: з'являється в руках, коли рибалиш із причалу чи берега
    this.shoreRod = new Rod('main', rodModel(kit, 'spin'), 2);
    this.shoreRod.shore = true;
    this.rods.push(this.shoreRod);
    for (const r of this.rods) {
      r.pivot.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      r.pivot.visible = false;
      scene.add(r.bobber, r.line);
    }
    // вудка в руці: від правої руки вперед і вгору
    this.handLocal.rotation.set(-0.95, 0, -0.12, 'YXZ');
    this.handGroup.add(this.handLocal);
    scene.add(this.handGroup);
    this.setOwned(0);
  }

  /** які вудки є (рівень апгрейду стійок): 1 — спінінг, 2 — донка, 5 — троллінгова */
  setOwned(holdersLvl: number) {
    const own: Record<RodKind, boolean> = { main: true, spin: holdersLvl >= 1, donka: holdersLvl >= 2, troll: holdersLvl >= 5 };
    this.rods.forEach((r, i) => {
      if (!r.shore && own[r.kind] && r.where === 'none') this.toRack(r, i);
    });
  }

  private toRack(r: Rod, slot: number) {
    r.where = 'rack';
    r.slot = slot;
    const s = RACK_SLOTS[slot];
    this.boat.group.add(r.pivot);
    r.pivot.position.set(...s.p);
    r.pivot.rotation.set(...s.r);
  }

  private toHolder(r: Rod, h: number) {
    r.where = 'holder';
    r.slot = h;
    this.holders[h] = r;
    const m = HOLDER_MOUNTS[h];
    this.boat.group.add(r.pivot);
    r.pivot.position.set(...m.base);
    r.pivot.rotation.set(...m.r);
    // основа вудки — у трубці тримача (0.22 м уздовж нахиленої осі)
    r.pivot.translateY(0.22);
  }

  private toHand(r: Rod) {
    if (r.where === 'holder') this.holders[r.slot] = null;
    r.where = 'hand';
    this.hand = r;
    this.handLocal.add(r.pivot);
    r.pivot.position.set(0, 0, 0);
    r.pivot.rotation.set(0, 0, 0);
  }

  /** поставити руку: fp — за камерою; інакше — біля правого плеча аватара */
  setHandPose(pos: THREE.Vector3, quat: THREE.Quaternion, fp: boolean) {
    this.handGroup.position.copy(pos);
    this.handGroup.quaternion.copy(quat);
    if (fp) this.handLocal.position.set(0.3, -0.42, -0.32);
    else this.handLocal.position.set(0.32, -0.1, -0.25);
    this.handGroup.updateMatrixWorld(true);
  }

  // ───────────── стан для інших систем ─────────────

  /** стан вудки в руках (сумісність із HUD/коопом) */
  get state(): FishingState {
    if (this.fightRod) return 'fight';
    if (this.charging) return 'charge';
    return this.hand ? this.hand.state : 'idle';
  }
  /** хоч одна вудка у воді */
  get anyCast(): boolean {
    return !!this.fightRod || this.rods.some((r) => r.state !== 'idle');
  }
  get holding(): boolean {
    return !!this.hand;
  }

  private say(msg: string, sec = 1.6) {
    this.status = msg;
    this.statusT = msg ? sec : 0;
  }

  // ───────────── дії гравця ─────────────

  /** носова стійка: взяти вудку / поставити назад */
  rackAction(): string | null {
    if (this.fightRod || this.charging) return null;
    if (this.hand) {
      if (this.hand.state !== 'idle') return L('Спершу змотай вудку (R) або постав її в стійку на борту.', `Reel in first (R) or put the rod in a holder on the rail.`);
      const r = this.hand;
      this.hand = null;
      this.toRack(r, this.rods.indexOf(r));
      this.audio.click();
      return null;
    }
    const r = this.rods.find((x) => x.where === 'rack');
    if (!r) return L('Усі вудки вже в роботі.', `All rods are already in use.`);
    this.toHand(r);
    this.audio.click();
    this.say(L(`${r.name} в руках — тримай ЛКМ, щоб закинути`, `${r.name} in hand — hold LMB to cast`), 2.2);
    return null;
  }

  /** бортова стійка h: поставити вудку з рук / взяти (клює — одразу підсічка) */
  holderAction(h: number, game: GameState, weather: Weather, time: TimeCycle): string | null {
    if (this.fightRod || this.charging) return null;
    const there = this.holders[h];
    if (there) {
      if (this.hand) return L('Руки зайняті — спершу постав свою вудку (в іншу стійку чи на ніс).', `Your hands are full — put your rod down first (in another holder or the bow rack).`);
      const biting = there.state === 'bite';
      this.toHand(there);
      this.audio.click();
      if (biting) this.hook(game, weather, time);
      return null;
    }
    if (!this.hand) return L('Стійка порожня — візьми вудку з носової стійки.', `The holder is empty — take a rod from the bow rack.`);
    const r = this.hand;
    this.hand = null;
    this.toHolder(r, h);
    this.audio.click();
    if (r.state !== 'idle') this.say(L(`${r.name} чекає в стійці — бери наступну`, `${r.name} is waiting in the holder — grab the next one`), 2);
    return null;
  }

  /** ЛКМ натиснуто */
  click(boat: Boat, game: GameState, weather: Weather, time: TimeCycle) {
    // з берега без вудки в руках — береговa вудка сама опиняється в руках
    if (this.ashore && !this.hand && !this.fightRod && !this.charging && this.shoreRod.where === 'none') this.toHand(this.shoreRod);
    const r = this.hand;
    if (!r || this.fightRod || this.charging) return;
    if (r.state === 'idle') {
      if (!this.ashore && Math.hypot(boat.pos.x, boat.pos.z) < 60) {
        this.onEvent?.(L('Занадто близько до причалу — відійди в море.', `Too close to the pier — head out to sea.`), 'warn');
        return;
      }
      if (game.energy < 2) {
        this.onEvent?.(L('Не вистачає енергії.', `Not enough energy.`), 'warn');
        if (r.shore) this.dropShoreRod();
        return;
      }
      this.charging = true;
      this.castPower = 0;
      this.castPhase = 0;
    } else if (r.state === 'bite') {
      this.hook(game, weather, time);
    } else if (r.nibble > 0.05) {
      this.strikeEarly(r);
    } else if (r.state === 'waiting' && r.fly >= 1) {
      this.say(L('Ще не клює — чекай, поки поплавок пірне під воду', `No bite yet — wait for the float to dip under`), 1.6);
    }
  }

  /** R — змотати вудку в руках */
  reelHand() {
    if (this.hand && !this.fightRod) {
      this.reel(this.hand);
      this.charging = false;
      if (this.hand.shore) this.dropShoreRod();
    }
  }

  /** сховати берегову вудку (змотано / повернувся на човен) */
  private dropShoreRod() {
    const r = this.shoreRod;
    this.reel(r);
    r.pier = false;
    if (this.hand === r) this.hand = null;
    r.where = 'none';
    r.pivot.removeFromParent();
  }

  /** змотати все (сон, телепорт, затоплення) */
  reelIn() {
    if (this.fightRod) return;
    this.charging = false;
    for (const r of this.rods) this.reel(r);
  }

  private reel(r: Rod) {
    r.state = 'idle';
    r.bobber.visible = false;
    r.line.visible = false;
    r.nibble = 0;
  }

  private strikeEarly(r: Rod) {
    // риба лише обережніша — наживка ціла, чекаємо далі
    r.biteAt += this.easy ? rand(1.5, 3) : rand(3, 5);
    r.nibbleT = rand(1.5, 3);
    r.nibble = 0;
    this.audio.splash(0.2);
    this.say(L('Зарано! Це була поклювка — підсікай, коли поплавок ПІРНЕ', `Too early! That was just a nibble — strike when the float GOES UNDER`), 2.4);
  }

  private cast(r: Rod, boat: Boat, game: GameState, weather: Weather, power: number) {
    this.charging = false;
    const info = ROD_INFO[r.kind];
    const cs = this.easy ? CAST_SWEET_EASY : CAST_SWEET;
    const perfect = power >= cs.lo && power <= cs.hi;
    const k = power > 0.95 ? 0.75 : 0.45 + 0.6 * power;
    const castDist = eff.castDist(game.upgrades.rod) * info.cast * k * (perfect ? 1.1 : rand(0.9, 1.05));
    // туди, куди дивишся (по горизонталі)
    r.tip.getWorldPosition(this.tipW);
    this.handGroup.getWorldQuaternion(this._q);
    const dir = this._d.set(0, 0, -1).applyQuaternion(this._q).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(Math.sin(boat.heading), 0, Math.cos(boat.heading));
    dir.normalize();
    const pier = this.ashore;
    const tx = this.tipW.x + dir.x * castDist, tz = this.tipW.z + dir.z * castDist;
    // з берега — поплавок має впасти у воду, а не на причал чи пісок
    if (pier && this.waterAt && !this.waterAt(tx, tz)) {
      this.onEvent?.(L('Тут не закинеш — там немає води. Стань на край причалу й дивись на воду', `You can't cast here — there's no water there. Stand at the edge of the pier and face the water`), 'warn');
      if (r.shore) this.dropShoreRod();
      return;
    }
    if (!game.spendEnergy(2)) return;
    r.perfect = perfect;
    r.castDist = castDist;
    r.pier = pier;
    r.bobberPos.set(tx, 0, tz);
    if (!pier) {
      // поплавок має впасти за бортом
      const bx = r.bobberPos.x - boat.pos.x, bz = r.bobberPos.z - boat.pos.z;
      const bd = Math.hypot(bx, bz) || 1;
      if (bd < 6.5) r.bobberPos.set(boat.pos.x + (bx / bd) * 6.5, 0, boat.pos.z + (bz / bd) * 6.5);
    } else if (!this.pierTip) {
      this.pierTip = true;
      this.onEvent?.(L('🎣 Біля причалу й берега клює рідко й дрібне — справжня риба далі в морі', `🎣 Near the pier and the shore bites are rare and the fish are small — the real fish are out at sea`), 'warn');
    }
    r.bobberPos.y = 0;
    r.flyFrom.copy(this.tipW);
    r.fly = 0;
    r.state = 'waiting';
    // далеко від берега й стай — довше, біля стаї — швидко (fish.ts fishingSpot)
    const spot = fishingSpot(r.bobberPos.x, r.bobberPos.z, game.reports);
    if (r.where === 'hand') this.spot = pier ? { ...spot, hint: L('Біля причалу й берега — клює рідко, риба дрібна', `By the pier and the shore — rare bites, small fish`) } : spot;
    let t = rand(5, 15) * spot.wait;
    t /= eff.biteSpeed(game.upgrades.rod) * info.bite;
    if (weather.intensity > 0.6) t *= 0.75;
    if (r.perfect) t *= 0.6;
    t *= game.kitchen.mul('biteWait'); // смажена скумбрія — «рибальське щастя»
    t *= paceMul(); // темп гри: динамічний — клює частіше
    // з причалу/берега — риба полохлива й рідка
    if (pier) t *= 3.5;
    r.biteAt = Math.max(pier ? 12 : 2.5, t);
    r.nibbleT = Math.min(r.biteAt * 0.5, rand(1.5, 4));
    r.nibble = 0;
    r.bobber.visible = true;
    r.line.visible = true;
    this.audio.splash(0.2);
    this.say(r.perfect ? L('Ідеальний закид! Клюватиме швидше', `Perfect cast! Bites will come sooner`) : power > cs.hi ? L('Перетягнув — недоліт', `Overcast — fell short`) : power < cs.lo ? L('Слабкий закид — у зеленій зоні клює швидше', `Weak cast — casts in the green zone get bites sooner`) : '', 2);
  }

  /** зачепити рибу на вудці в руках (вона клює) */
  hook(game: GameState, weather: Weather, time: TimeCycle) {
    const r = this.hand;
    if (!r || r.state !== 'bite') return;
    const info = ROD_INFO[r.kind];
    const pier = r.pier;
    const zone = pier ? 'shore' : zoneFromDist(Math.hypot(this.boat.pos.x, this.boat.pos.z));
    const day = !time.isNight;
    const pool = FISH.filter((f) => f.zones.includes(zone) && (day ? f.day : f.night));
    if (pool.length === 0) pool.push(...FISH.filter((f) => f.zones.includes(zone)));
    // ваги: рідкісність, радіо, шторм; «трофейні» вудки тягнуть рідкісну велику рибу
    const off = pier ? 0 : offshore(this.boat.pos.x, this.boat.pos.z);
    const spot = fishingSpot(r.bobberPos.x, r.bobberPos.z, game.reports);
    const weights = pool.map((f) => {
      let w = 1 / f.rarity;
      // радіо-звіт діє в межах стаї (на карті), трохи — по всій зоні
      const rep = game.reportBoost(f.id, zone);
      if (rep > 1) w *= 1 + (rep - 1) * (0.35 + 0.65 * spot.heat);
      if (weather.intensity > 0.6 && f.zones.includes('open')) w *= 1.6;
      w *= 1 + info.trophy * (f.rarity - 1) * 1.5;
      // далі від берега — рідкісніша риба
      w *= 1 + off * (f.rarity - 1) * 2.2;
      return w;
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    let x = Math.random() * sum;
    let sp = pool[0];
    for (let i = 0; i < pool.length; i++) {
      x -= weights[i];
      if (x <= 0) {
        sp = pool[i];
        break;
      }
    }
    this.fishSpeciesId = sp.id;
    const roll = rollKg(sp, spot, pier ? 0 : info.trophy);
    // з причалу — дрібнота, без трофеїв
    this.fishKg = pier ? Math.max(0.02, Math.round(roll.kg * rand(0.3, 0.45) * 100) / 100) : roll.kg;
    this.fishTrophy = pier ? false : roll.trophy;
    r.tip.getWorldPosition(this.tipW);
    this.fightDir.set(r.bobberPos.x - this.tipW.x, 0, r.bobberPos.z - this.tipW.z);
    this.fightMaxDist = Math.max(6, this.fightDir.length() - 2);
    this.fightDist = this.fightMaxDist;
    this.fightTension = 50;
    this.tRate = 0;
    this.overTension = 0;
    this.lineBreakAt = Math.max(88, 86 + eff.lineStrength(game.upgrades.rod) * 14 - 14);
    // велика риба — довша боротьба, але не різкіша; дрібна — швидко й спокійно
    const rel = clamp(this.fishKg / sp.maxKg, 0, 2.4);
    this.staminaMax = 30 + 18 * sp.rarity + 40 * rel;
    this.small = this.fishKg < 0.5 && sp.rarity < 1.2;
    this.canJump = !this.small;
    const perfect = r.biteAge < 0.5;
    this.stamina = this.staminaMax * (perfect ? 0.75 : 1);
    this.pull = 0;
    this.pullK = 0;
    this.windup = 0;
    this.nextPull = 0;
    this.jumpWarn = 0;
    this.lean = 0;
    this.side = 0;
    this.jumpT = 0;
    this.nextJump = rand(6, 10);
    this.slackT = 0;
    this.pullT = rand(1.5, 2.5);
    this.say(this.fishTrophy ? L('Ого, щось велике! Не поспішай', `Whoa, something big! Take your time`) : perfect ? L('Ідеальна підсічка!', `Perfect strike!`) : L('Є! Риба на гачку', `Got it! Fish on`), 2);
    this.fightRod = r;
    r.state = 'idle';
    r.bobber.visible = true;
    r.line.visible = true;
  }

  // ───────────── кадр ─────────────

  private spawnRipple(x: number, z: number, power: number) {
    const r = this.ripples.reduce((a, b) => (a.age > b.age ? a : b));
    r.age = 0;
    r.x = x;
    r.z = z;
    r.power = power;
    r.m.visible = true;
  }

  private updateRipples(dt: number, t: number, ocean: Ocean) {
    for (const r of this.ripples) {
      if (!r.m.visible) continue;
      r.age += dt;
      const life = 1.6;
      if (r.age > life) {
        r.m.visible = false;
        continue;
      }
      const u = r.age / life;
      r.m.scale.setScalar(0.15 + u * (0.6 + r.power * 0.5));
      r.m.position.set(r.x, ocean.heightAt(r.x, r.z, t) + 0.03, r.z);
      (r.m.material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.5 * (0.5 + r.power * 0.5);
    }
  }

  isPulling(input: Input): boolean {
    return input.down('Space');
  }

  update(dt: number, t: number, boat: Boat, ocean: Ocean, input: Input, game: GameState, weather: Weather, _time: TimeCycle) {
    this.updateRipples(dt, t, ocean);
    const speed = Math.hypot(boat.vel.x, boat.vel.z);
    if (this.statusT > 0) {
      this.statusT -= dt;
      if (this.statusT <= 0) this.status = '';
    }
    if (this.charging) {
      const r = this.hand;
      this.castPhase += dt / (this.easy ? 1.15 : 0.95);
      const ph = this.castPhase % 2;
      this.castPower = ph < 1 ? ph : 2 - ph;
      if (!r) this.charging = false;
      else if (!input.down('Mouse0')) this.cast(r, boat, game, weather, this.castPower);
    }
    const holderLvl = game.upgrades.holders ?? 0;
    // надто швидко — волосіні не втримати
    // повернувся на човен із береговою вудкою — ховаємо її
    if (!this.ashore && this.shoreRod.where === 'hand' && this.fightRod !== this.shoreRod && !this.charging) this.dropShoreRod();
    if (speed > MAX_TROLL_SPEED && !this.fightRod && this.rods.some((r) => r.state !== 'idle' && !r.pier)) {
      for (const r of this.rods) if (!r.pier) this.reel(r);
      this.onEvent?.(L('Човен іде надто швидко — вудки змотано. Троллінг — лише на малому ходу.', `The boat is going too fast — rods reeled in. Trolling works only at low speed.`), 'warn');
    }
    const trolling = speed > 1 && speed <= MAX_TROLL_SPEED;
    for (const r of this.rods) {
      if (r.state === 'idle' || r === this.fightRod) continue;
      this.updateWaiting(r, dt, ocean, t, holderLvl, trolling && !r.pier);
    }
    if (this.fightRod) this.fightStep(dt, t, boat, ocean, input, game, weather);
  }

  private updateWaiting(r: Rod, dt: number, ocean: Ocean, t: number, holderLvl: number, trolling: boolean) {
    r.tip.getWorldPosition(this.tipW);
    // волосінь тягне поплавок за човном (троллінг), якщо той відійшов
    const dx = r.bobberPos.x - this.tipW.x, dz = r.bobberPos.z - this.tipW.z;
    const d = Math.hypot(dx, dz);
    const maxD = r.castDist + 1.5;
    if (d > maxD && r.fly >= 1) {
      r.bobberPos.x = this.tipW.x + (dx / d) * maxD;
      r.bobberPos.z = this.tipW.z + (dz / d) * maxD;
    }
    const inHolder = r.where === 'holder';
    let rate = 1;
    if (inHolder) rate *= holderBiteSpeed(holderLvl);
    if (trolling) rate *= r.kind === 'troll' ? 1.6 : 1.15;
    if (r.state === 'waiting') {
      r.nibbleT -= dt;
      if (r.nibbleT <= 0 && r.biteAt > 1.2 && r.fly >= 1) {
        r.nibble = 1;
        r.nibbleT = rand(1.2, 3.5);
        this.spawnRipple(r.bobberPos.x, r.bobberPos.z, 0.7);
        if (r.where === 'hand') this.audio.splash(0.12);
      }
      r.nibble = Math.max(0, r.nibble - dt * 3.5);
      if (r.fly >= 1) r.biteAt -= dt * rate;
      if (r.biteAt <= 0) {
        r.state = 'bite';
        r.biteAge = 0;
        r.biteWindow = inHolder ? holderBiteWindow(holderLvl) : this.easy ? BITE_WINDOW_EASY : BITE_WINDOW;
        r.biteWindow0 = r.biteWindow;
        this.spawnRipple(r.bobberPos.x, r.bobberPos.z, 1);
        this._d.set(r.bobberPos.x, ocean.heightAt(r.bobberPos.x, r.bobberPos.z, t), r.bobberPos.z);
        this.onSplash?.(this._d, 0.35);
        if (inHolder) {
          this.audio.tinkle(holderLvl >= 3 ? 1.4 : 0.7);
          this.onEvent?.(L(`🔔 Клює: ${r.name.toLowerCase()} (${HOLDER_NAMES[r.slot]}) — біжи й хапай (E)!`, `🔔 Bite: ${r.name.toLowerCase()} (${HOLDER_NAMES[r.slot]}) — run and grab it (E)!`), 'good');
        } else this.audio.bite();
      }
    } else if (r.state === 'bite') {
      r.biteAge += dt;
      r.biteWindow -= dt;
      if (inHolder && Math.floor(r.biteAge * 2.2) !== Math.floor((r.biteAge - dt) * 2.2)) this.audio.tinkle(holderLvl >= 3 ? 0.9 : 0.4);
      if (r.biteWindow <= 0) {
        if (inHolder) {
          this.reel(r);
          this.onEvent?.(L(`${r.name}: риба з'їла наживку й пішла. Закинь знову.`, `${r.name}: the fish ate the bait and left. Cast again.`), 'warn');
        } else {
          // запізно — але наживка ціла: риба ще повернеться
          r.state = 'waiting';
          r.biteAt = rand(3, 7) * (this.spot?.wait ?? 1) * (r.pier ? 3 : 1);
          r.nibbleT = rand(1, 2.5);
          r.nibble = 0;
          this.say(L('Запізно — риба зійшла. Наживка ціла, чекай наступного клювання', `Too late — the fish got away. The bait is fine, wait for the next bite`), 2.6);
        }
      }
    }
  }

  /** після камери: вудки, поплавки, волосіні (одна поза на кадр — без відставання) */
  syncVisuals(dt: number, t: number, ocean: Ocean) {
    for (const r of this.rods) {
      r.pivot.visible = r.where !== 'none';
      // вигин: клювання смикає, боротьба гне за натягом, замах — назад
      let bend = 0.02;
      if (r === this.fightRod) bend = 0.12 + this.fightTension / 120 + this.lean * 0.0;
      else if (r.state === 'bite') bend = 0.25 + 0.15 * Math.sin(t * 22);
      else if (r.state === 'waiting') bend = 0.05 + r.nibble * 0.12;
      else if (r === this.hand && this.charging) bend = -0.3 * this.castPower;
      r.shake += (bend - r.shake) * (1 - Math.exp(-dt * 14));
      r.inner.rotation.x = r.shake * 0.6;
      r.inner.rotation.z = r === this.fightRod ? -this.lean * 0.35 : 0;
      if (r.state === 'idle' && r !== this.fightRod) continue;
      r.pivot.updateMatrixWorld(true);
      r.tip.getWorldPosition(this.tipW);
      const h = ocean.heightAt(r.bobberPos.x, r.bobberPos.z, t);
      if (r.fly < 1) {
        // поплавок летить дугою від кінчика вудки
        r.fly = Math.min(1, r.fly + dt / 0.65);
        const u = r.fly;
        r.bobber.position.lerpVectors(r.flyFrom, this._d.set(r.bobberPos.x, h, r.bobberPos.z), u);
        r.bobber.position.y += Math.sin(u * Math.PI) * (1.5 + r.castDist * 0.12);
        if (r.fly >= 1) {
          this.spawnRipple(r.bobberPos.x, r.bobberPos.z, 0.8);
          this.onSplash?.(r.bobber.position, 0.25);
        }
      } else if (r !== this.fightRod) {
        const y = r.state === 'bite' ? h - 0.16 + Math.sin(t * 22) * 0.05 : h + 0.06 - r.nibble * 0.09 * (0.6 + 0.4 * Math.sin(t * 40));
        r.bobber.position.set(r.bobberPos.x, y, r.bobberPos.z);
      }
      // волосінь: провисає дугою (натягнута в боротьбі)
      const attr = r.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const sag = r === this.fightRod ? 0.5 * (1 - Math.min(1, this.fightTension / 80)) + 0.03 : r.fly < 1 ? 0.1 : 0.7;
      const b = r.bobber.position;
      for (let i = 0; i <= 12; i++) {
        const u = i / 12;
        attr.setXYZ(i, this.tipW.x + (b.x - this.tipW.x) * u, this.tipW.y + (b.y - this.tipW.y) * u - Math.sin(u * Math.PI) * sag, this.tipW.z + (b.z - this.tipW.z) * u);
      }
      attr.needsUpdate = true;
    }
  }

  /** крок боротьби */
  private fightStep(dt: number, t: number, boat: Boat, ocean: Ocean, input: Input, game: GameState, weather: Weather) {
    const r = this.fightRod!;
    const sp = FISH_BY_ID[this.fishSpeciesId];
    const easy = this.easy;
    const rel = clamp(this.fishKg / (sp ? sp.maxKg : 1), 0, 1.2);
    // сила ривків майже не росте з вагою — велика риба просто довше бореться
    const power = Math.min(0.85, 0.4 + rel * 0.2 + (sp ? (sp.rarity - 1) * 0.12 : 0));
    const tired = this.stamina < this.staminaMax * 0.25;

    // ривки: спершу риба «готується» (стрілку видно заздалегідь), потім сила наростає
    this.pullT -= dt;
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) {
        if (this.pull !== 0 && this.pull !== this.nextPull) this.pullK *= 0.3;
        this.pull = this.nextPull;
      }
    } else if (this.pullT <= 0) {
      const calm = tired ? 0.6 : this.small ? 0.45 : 0.22;
      const np = Math.random() < calm ? 0 : Math.random() < 0.5 ? -1 : 1;
      if (np !== 0 && np !== this.pull) {
        this.nextPull = np;
        this.windup = (easy ? 0.95 : 0.65) + rel * 0.15;
        this.pullT = this.windup + rand(1.8, 3.2);
      } else {
        this.pull = np;
        this.pullT = rand(1.5, 3);
      }
    }
    this.pullK += ((this.pull !== 0 ? 1 : 0) - this.pullK) * (1 - Math.exp(-dt * 2.4));

    // стрибок: попередження → стрибок
    this.nextJump -= dt;
    if (this.canJump && !tired && this.jumpT <= 0 && this.jumpWarn <= 0 && this.windup <= 0 && this.nextJump <= 0) {
      this.jumpWarn = easy ? 1.1 : 0.75;
      this.audio.splash(0.15);
    }
    if (this.jumpWarn > 0) {
      this.jumpWarn -= dt;
      if (this.jumpWarn <= 0) {
        this.jumpT = 1.1;
        this.nextJump = rand(8, 14);
        this.onLeap?.(this.fishSpeciesId, this.fishKg, r.bobber.position);
        this.onSplash?.(r.bobber.position, 0.7);
      }
    }
    const jumping = this.jumpT > 0;
    if (jumping) this.jumpT -= dt;

    const reeling = this.isPulling(input);
    const leanIn = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    this.lean += (leanIn - this.lean) * (1 - Math.exp(-dt * 8));
    const counter = this.pull === 0 ? 1 - Math.abs(this.lean) * 0.4 : clamp(-this.pull * this.lean, -1, 1);

    // натяг: цільова швидкість зміни, згладжена — без різких стрибків
    const swz = easy ? SWEET_EASY : SWEET;
    // фрикціон: вище зеленої зони котушка травить волосінь — натяг росте ледве-ледве
    const over = clamp((this.fightTension - swz.hi) / Math.max(1, this.lineBreakAt - swz.hi), 0, 1);
    const drag = 1 - over * (easy ? 0.8 : 0.5);
    // травить лише тоді, коли риба реально тягне; втомлена не опирається — її дотягуєш
    // (інакше з затиснутим Space натяг упирався у фрикціон, і риба вічно стояла на місці)
    const fishForce = tired ? 0 : this.pull !== 0 ? 0.45 + 0.55 * this.pullK : 0.45;
    this.dragSlip = reeling && over > 0.25 ? over * fishForce : 0;
    let rate = reeling ? (24 + power * 18) * drag * (jumping ? (easy ? 1.6 : 2.2) : 1) : -42;
    rate += this.pull !== 0 ? (1 - counter) * 26 * power * this.pullK : 6 * power;
    if (easy) rate *= 0.85;
    this.tRate += (rate - this.tRate) * (1 - Math.exp(-dt * 6));
    // «легка»: фрикціон налаштовано нижче межі — сам по собі натяг волосінь не рве,
    // небезпечно лише тягнути під час стрибка (про нього попереджаємо)
    const cap = easy && !(jumping && reeling) ? this.lineBreakAt - 2 : 100;
    this.fightTension = clamp(this.fightTension + this.tRate * dt, 0, cap);
    if (this.fightTension >= cap && this.tRate > 0) this.tRate = 0;
    const sw = easy ? SWEET_EASY : SWEET;
    const sweet = this.fightTension >= sw.lo && this.fightTension <= sw.hi;

    let drain = 1.2;
    if (sweet) drain += 3 + Math.max(0, counter) * 3.5;
    if (jumping && !reeling) drain += 9;
    // риба, що тягне проти фрикціону, теж втомлюється
    if (this.dragSlip > 0) drain += 2.5;
    this.stamina = Math.max(0, this.stamina - drain * dt);

    // поки риба має сили — підтягується повільно; важка — ще повільніше
    const sf = this.staminaMax > 0 ? this.stamina / this.staminaMax : 0;
    const heavy = 1 / (1 + Math.max(0, this.fishKg - 1) * 0.07);
    const reelSpeed = (1.0 + eff.biteSpeed(game.upgrades.rod) * 0.45) * (tired ? 1.8 : sweet ? (0.5 + 0.5 * (1 - sf)) * heavy : 0.4 * heavy);
    if (reeling && !jumping) this.fightDist -= reelSpeed * game.kitchen.mul('reel') * dt * (1 - this.dragSlip);
    // фрикціон травить: риба забирає волосінь
    this.fightDist += this.dragSlip * 0.6 * dt;
    const run = tired ? 0.25 : this.pull !== 0 ? (1.1 * (1 - Math.max(0, counter)) * power + 0.3) * (0.4 + 0.6 * this.pullK) : 0.5 * power;
    this.fightDist += run * dt * (reeling ? 0.6 : 1);
    this.fightDist = clamp(this.fightDist, 0, this.fightMaxDist * 1.4);
    if (reeling) game.spendEnergy(0.45 * dt);

    const sideTarget = tired ? 0 : this.pull * this.pullK * Math.min(5, 1.5 + this.fightDist * 0.25) * (1 - 0.6 * Math.max(0, counter));
    this.side += (sideTarget - this.side) * (1 - Math.exp(-dt * 1.4));

    // перетяг: волосінь тримає кілька секунд, попереджає писком і тремтінням
    const grace = easy ? GRACE_EASY : GRACE;
    if (this.fightTension >= this.lineBreakAt) {
      this.overTension += dt;
      if (this.overTension > grace) {
        this.endFight();
        this.audio.snap();
        this.onEvent?.(L('💥 Волосінь обірвалась — надто довго в червоній зоні. Коли натяг червоний, відпускай Space.', `💥 The line snapped — too long in the red. When the tension is red, let go of Space.`), 'bad');
        return;
      }
    } else this.overTension = Math.max(0, this.overTension - dt * 1.2);
    this.strainBeep -= dt;
    if ((this.overTension > 0 || this.fightTension > this.lineBreakAt - 6) && this.strainBeep <= 0) {
      this.strainBeep = this.overTension > grace * 0.5 ? 0.18 : 0.32;
      this.audio.strain(0.4 + this.overTension / grace);
    }
    const slackMax = easy ? SLACK_EASY : SLACK;
    if (this.fightTension < 12) {
      this.slackT += dt;
      if (this.slackT > slackMax) {
        this.endFight();
        this.audio.snap();
        this.onEvent?.(L('Риба зірвалась — волосінь довго провисала. Тримай Space, щоб натяг був у зеленій зоні.', `The fish got off — the line was slack too long. Hold Space to keep the tension in the green.`), 'warn');
        return;
      }
    } else this.slackT = Math.max(0, this.slackT - dt);

    if (this.statusT <= 0) this.status = this.fightAdvice(tired, jumping);

    if (this.fightDist <= 0.5) {
      this.catchFish(weather);
      return;
    }
    // риба — на волосіні від кінчика: у бік, де клюнула, + поперечний зсув
    r.tip.getWorldPosition(this.tipW);
    const dir = this._d.copy(this.fightDir);
    if (dir.lengthSq() < 1e-4) dir.set(Math.sin(boat.heading), 0, Math.cos(boat.heading));
    dir.normalize();
    const rx = -dir.z, rz = dir.x;
    const tx = this.tipW.x + dir.x * (this.fightDist + 2) + rx * this.side;
    const tz = this.tipW.z + dir.z * (this.fightDist + 2) + rz * this.side;
    r.bobberPos.set(tx, 0, tz);
    const h = ocean.heightAt(tx, tz, t);
    const warnBob = this.jumpWarn > 0 || this.windup > 0 ? Math.sin(t * 30) * 0.05 : 0;
    r.bobber.position.set(tx, h + 0.02 - (this.pull === 0 && !tired ? 0.12 : 0) + Math.sin(t * 14) * 0.02 + warnBob, tz);
    this.rippleT -= dt;
    if (this.rippleT <= 0) {
      this.rippleT = tired ? 0.9 : this.windup > 0 || this.jumpWarn > 0 ? 0.18 : 0.35;
      this.spawnRipple(tx, tz, tired ? 0.4 : 0.9);
    }
  }

  /** що зараз робити — одна коротка порада */
  private fightAdvice(tired: boolean, jumping: boolean): string {
    if (this.jumpWarn > 0) return L('Зараз вистрибне — відпусти Space!', `It's about to jump — let go of Space!`);
    if (jumping) return L('СТРИБОК! Не тягни, чекай', `JUMP! Don't pull, wait`);
    if (this.overTension > 0) return L('Занадто туго! Відпусти Space', `Too tight! Let go of Space`);
    if (this.fightTension > this.lineBreakAt - 6) return L('Натяг майже червоний — відпусти', `Tension almost red — let go`);
    if (this.dragSlip > 0) return L('Фрикціон травить волосінь — відпусти Space', `The drag is paying out line — let go of Space`);
    if (this.slackT > 1) return L('Слабина! Тягни Space', `Slack! Hold Space`);
    if (this.windup > 0) return this.nextPull < 0 ? L('Риба збирається рвонути ліворуч — тримай D', `The fish is about to bolt left — hold D`) : L('Риба збирається рвонути праворуч — тримай A', `The fish is about to bolt right — hold A`);
    if (this.pull < 0) return L('Рветься ліворуч → тримай D', `Pulling left → hold D`);
    if (this.pull > 0) return L('Рветься праворуч → тримай A', `Pulling right → hold A`);
    if (tired) return L('Риба втомилась — тягни!', `The fish is tired — reel it in!`);
    return L('Тягни Space помалу — натяг у зеленій зоні', `Reel gently with Space — keep the tension in the green`);
  }

  private endFight() {
    const r = this.fightRod;
    this.fightRod = null;
    if (r) this.reel(r);
    if (r) r.pier = false;
    this.say('');
  }

  private catchFish(weather: Weather) {
    const item = makeFish(this.fishSpeciesId, this.fishKg, weather.stormBonus);
    this.lastTrophy = this.fishTrophy;
    this.lastBobber.copy(this.fightRod!.bobber.position);
    this.endFight();
    this.audio.catchJingle();
    this._lastCatch = item;
  }

  /** де була риба в момент улову (для ефекту вильоту) */
  readonly lastBobber = new THREE.Vector3();
  /** останній улов — трофей */
  lastTrophy = false;
  private _lastCatch: ReturnType<typeof makeFish> | null = null;
  takeCatch(): ReturnType<typeof makeFish> | null {
    const c = this._lastCatch;
    this._lastCatch = null;
    return c;
  }

  get fightInfo(): { speciesId: string; kg: number; tension: number; limit: number; dist: number; stamina: number; pull: number; lean: number; status: string; jump: boolean; lo: number; hi: number; windup: number; jumpWarn: boolean; strain: number; trophy: boolean } {
    const sw = this.easy ? SWEET_EASY : SWEET;
    return {
      windup: this.windup > 0 ? this.nextPull : 0,
      jumpWarn: this.jumpWarn > 0,
      strain: clamp(this.overTension / (this.easy ? GRACE_EASY : GRACE), 0, 1),
      trophy: this.fishTrophy,
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
      lo: sw.lo,
      hi: sw.hi,
    };
  }

  /** кооп: [стан 1 чекає / 2 клює / 3 боротьба, x, z, натяг] або null (вудка в руках) */
  netState(): [number, number, number, number] | null {
    const r = this.fightRod ?? this.hand;
    if (!r || (r.state === 'idle' && !this.fightRod)) return null;
    const s = this.fightRod ? 3 : r.state === 'waiting' ? 1 : 2;
    const q = (v: number) => Math.round(v * 100) / 100;
    return [s, q(r.bobber.position.x), q(r.bobber.position.z), Math.round(this.fightRod ? this.fightTension : 0)];
  }

  /** скільки лишилось вікна підсічки (0..1) для вудки в руках; null — не клює */
  get biteLeft(): number | null {
    const r = this.hand;
    if (!r || r.state !== 'bite' || this.fightRod) return null;
    return clamp(r.biteWindow / r.biteWindow0, 0, 1);
  }

  /** шкала закиду: зелена зона */
  get castSweet() {
    return this.easy ? CAST_SWEET_EASY : CAST_SWEET;
  }

  /** підпис станції вудок (залежить від того, що в руках) */
  stationLabel(id: string): string {
    if (id === 'rod') {
      if (this.hand) return this.hand.state === 'idle' ? L(`Поставити: ${this.hand.name.toLowerCase()} — на ніс`, `Put back: ${this.hand.name.toLowerCase()} — on the bow`) : L('Носова стійка (спершу змотай — R)', `Bow rack (reel in first — R)`);
      const r = this.rods.find((x) => x.where === 'rack');
      return r ? L(`Взяти: ${r.name.toLowerCase()}`, `Take: ${r.name.toLowerCase()}`) : L('Носова стійка (порожня)', `Bow rack (empty)`);
    }
    const h = Number(id.slice(6));
    const there = this.holders[h];
    if (there) return there.state === 'bite' ? L(`ХАПАЙ: ${there.name.toLowerCase()} — клює!`, `GRAB IT: ${there.name.toLowerCase()} — a bite!`) : L(`Взяти зі стійки: ${there.name.toLowerCase()}`, `Take from the holder: ${there.name.toLowerCase()}`);
    return this.hand ? L(`Поставити в стійку: ${this.hand.name.toLowerCase()}`, `Put in the holder: ${this.hand.name.toLowerCase()}`) : L(`Стійка для вудки (${HOLDER_NAMES[h]})`, `Rod holder (${HOLDER_NAMES[h]})`);
  }

  /** для підсвітки: вудки в носовій стійці / вудка в бортовій стійці h */
  rackObjects(): THREE.Object3D[] {
    return this.rods.filter((r) => r.where === 'rack').map((r) => r.pivot);
  }
  holderObject(h: number): THREE.Object3D | null {
    return this.holders[h]?.pivot ?? null;
  }

  /** з берега: чи можна закинути в напрямку погляду (вода попереду) */
  shorePrompt(x: number, z: number, yaw: number): string | null {
    if (!this.ashore || this.hand || this.fightRod || this.shoreRod.where !== 'none' || !this.waterAt) return null;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const d of [5, 9]) if (!this.waterAt(x + fx * d, z + fz * d)) return null;
    return L('Закинути вудку з берега (клює рідко й дрібне)', `Cast a line from the shore (rare, small bites)`);
  }

  /** підказка для HUD, коли вудка в руках */
  prompt(): string | null {
    if (this.fightRod || this.charging) return null;
    const r = this.hand;
    if (!r) return null;
    switch (r.state) {
      case 'idle': return L(`${r.name}: тримай ЛКМ — закид`, `${r.name}: hold LMB — cast`);
      case 'waiting': return r.nibble > 0.05 ? L('Поклювка… ще рано — чекай, поки поплавок пірне', `A nibble… too early — wait for the float to go under`) : L('Чекай клювання — поплавок пірне під воду · R — змотати', `Wait for a bite — the float will dip under · R — reel in`);
      case 'bite': return L('КЛЮЄ! Підсікай — ЛКМ!', `BITE! Strike — LMB!`);
    }
  }
}
