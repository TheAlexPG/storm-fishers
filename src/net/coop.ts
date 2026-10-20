import * as THREE from 'three';
import { NetSession, type GameMsg, type PeerInfo } from './session';
import { BUILD } from '../core/build';
import { P2PSession } from './p2p';
import { getPace, setPace } from '../game/pace';

/** є власне реле (dev-сервер / node server/relay.mjs) — інакше пряме з'єднання WebRTC */
async function relayAvailable(): Promise<boolean> {
  if (new URLSearchParams(location.search).has('p2p')) return false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch('/net-info', { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = (await r.json()) as { ips?: unknown };
    return Array.isArray(j.ips);
  } catch {
    return false;
  }
}
import { Avatar, colorForId, type NetPlayer } from '../world/avatar';
import { Boat } from '../world/boat';
import type { Ocean } from '../core/ocean';
import type { Fishing } from '../game/fishing';
import type { Player } from '../world/player';
import type { Weather } from '../core/weather';
import type { TimeCycle } from '../core/time';
import type { GameState } from '../game/state';
import type { FishItem, UpgradeId } from '../core/types';
import type { ParticlePool } from '../world/particles';

// ─────────────────────────────────────────────────────────────
// Кооп «флотилія».
//   Капітан кімнати (хост): погода, час — 10 Гц знімок світу ('w').
//   Кожна яхта має власника: він симулює її фізику й 20 Гц шле знімок ('b')
//   разом із ресурсами, модулями, трюмом і фазами хвиль. Хто на чужій яхті
//   (екіпаж) — інтерполює її знімки з затримкою; дії над яхтою (штурвал,
//   фали, люк, трюм, покупки) — повідомленнями власнику.
//   Трюм — спільний для яхти: класти може будь-хто з екіпажу, гроші
//   отримує той, хто продав. Гаманець — у кожного свій.
//   Чужі яхти, на яких тебе немає, — лише картинка (поза + модулі).
// ─────────────────────────────────────────────────────────────

const SNAP_HZ = 20;
const WORLD_HZ = 10;
/** знімок запасів живої біржі від капітана кімнати, с */
const MARKET_SEC = 2;
const PLAYER_HZ = 15;
/** затримка відтворення знімків: 2.4 пакети — переживає джитер Wi‑Fi */
const INTERP_DELAY = 0.12;
/** місця швартування вздовж причалу (x), z — як у MOOR */
export const MOOR_SLOTS = [0, 11.5, -11.5, 21];

interface Snap {
  t: number;
  b: number[];
}

interface RemotePeer {
  info: PeerInfo;
  avatar: Avatar;
  state: NetPlayer | null;
  helm: [number, number] | null;
  pump: boolean;
}

/** яхта іншого власника */
interface FleetBoat {
  snaps: Snap[];
  last: GameMsg | null;
  fresh: boolean;
  /** коли востаннє чули (с, performance) */
  rx: number;
  /** картинка (якщо ми не на ній) */
  visual: Boat | null;
  upKey: string;
}

export type BoatAction =
  | { a: 'sails'; v?: number }
  | { a: 'engine' }
  | { a: 'repair'; v: number }
  | { a: 'fuel'; v: number }
  | { a: 'hullFull' }
  | { a: 'upgrade'; id: string }
  | { a: 'hatch'; v: number }
  | { a: 'door'; v: number }
  | { a: 'anchor'; v: number }
  | { a: 'store'; f: FishItem }
  | { a: 'take'; uid: number }
  | { a: 'cook'; uid: number }
  | { a: 'nets' }
  | { a: 'ap'; v: number }
  | { a: 'ign' }
  | { a: 'tent'; v: number }
  | { a: 'curtain'; v: number }
  /** радіо: v — ЛКМ/ПКМ по органу, s — кроки коліщатка */
  | { a: 'radio'; c: string; v?: number; s?: number }
  /** спільний гаманець: v > 0 — заробіток екіпажу, v < 0 — витрата; k — стаття книги */
  | { a: 'money'; v: number; k: string };

export interface FriendMarker {
  x: number;
  z: number;
  nick: string;
  color: string;
  onBoat: boolean;
  fishing: boolean;
}

export interface FleetEntry {
  owner: number;
  nick: string;
  crew: string[];
  mine: boolean;
  here: boolean;
}

export interface CoopHandlers {
  /** власник яхти: хтось з екіпажу зробив дію над нею */
  onAction(from: string, act: BoatAction): void;
  /** подія від власника своєї яхти (удар, затоплення…) або світу (блискавка, сон) */
  onEvent(e: string, v: unknown): void;
  onChat(nick: string, text: string, color: string): void;
  onPeer(nick: string, joined: boolean): void;
  onClosed(reason: string): void;
  /** у гравця інша збірка гри */
  onBuild(nick: string, hash: string): void;
}

/** місце швартування для яхти власника */
export function moorSlotX(owner: number): number {
  return MOOR_SLOTS[(Math.max(1, owner) - 1) % MOOR_SLOTS.length];
}

/** маршрут члена екіпажу свого борту (для лоції, столу й мінімапи) */
export interface CrewRoute {
  id: number;
  nick: string;
  color: string;
  /** власник яхти: його маршрут веде автопілот */
  captain: boolean;
  pts: Array<{ x: number; z: number }>;
}

export class Coop {
  session: NetSession | P2PSession | null = null;
  readonly peers = new Map<number, RemotePeer>();
  /** хто за штурвалом моєї яхти (id) — від власника */
  helmOwner: number | null = null;
  /** екіпаж: свій газ/кермо, поки тримає штурвал (знімки його не перетирають) */
  myHelm: [number, number] = [0, 0];
  /** мій капелюх (бачать інші) */
  myHat = 'captain';
  /** чия яхта — моя поточна (id власника) */
  myBoat = 0;

  private fleet = new Map<number, FleetBoat>();
  /** гість: оцінка (час капітана − локальний годинник) */
  private clockOffset: number | null = null;
  private snapTimer = 0;
  private worldTimer = 0;
  private playerTimer = 0;
  private holdKey = '';
  private holdT = 0;
  private _b: number[] = [];
  private lastWorld: GameMsg | null = null;
  /** човни-боти: капітан кімнати шле пози в пакеті світу, гості їх приймають */
  botState: (() => number[]) | null = null;
  onBots: ((a: unknown) => void) | null = null;
  /** жива біржа: капітан кімнати шле запаси всіх бірж (раз на MARKET_SEC) */
  marketState: (() => unknown) | null = null;
  /** радіо моєї яхти — екіпажу в знімку борту */
  radioState: (() => number[]) | null = null;
  onRadio: ((s: number[]) => void) | null = null;
  onMarket: ((d: unknown) => void) | null = null;
  /** капітан: гість продав рибу (порт, вид, типові рибини) */
  onMarketSale: ((portId: string, speciesId: string, units: number) => void) | null = null;
  private marketTimer = 0;
  private worldFresh = false;

  constructor(private scene: THREE.Scene, private h: CoopHandlers) {}

  get active(): boolean {
    return this.session?.connected === true;
  }
  get isHost(): boolean {
    return this.active && this.session!.isHost;
  }
  get isClient(): boolean {
    return this.active && !this.session!.isHost;
  }
  /** я в екіпажі чужої яхти (її фізику веде власник) */
  get crewing(): boolean {
    return this.active && this.myBoat !== this.myId;
  }
  /** власник яхти, на якій я в екіпажі, ще в кімнаті */
  get captainHere(): boolean {
    return this.peers.has(this.myBoat);
  }
  get room(): string {
    return this.session?.room ?? '';
  }
  get myId(): number {
    return this.session?.id ?? 0;
  }
  get hostId(): number {
    return this.session?.hostId ?? 1;
  }

  /** LAN-IP сервера (якщо гру відкрито на localhost — друзям він не підійде) */
  private lanHost: string | null = null;

  /** посилання-запрошення */
  inviteLink(): string {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    if (this.lanHost && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) u.hostname = this.lanHost;
    u.searchParams.set('room', this.room);
    return u.toString();
  }

  private async fetchLan() {
    try {
      const r = await fetch('/net-info');
      const j = (await r.json()) as { ips?: string[] };
      // домашня мережа — пріоритет (192.168.*, 10.*), потім решта
      const ips = j.ips ?? [];
      this.lanHost = ips.find((ip) => ip.startsWith('192.168.')) ?? ips.find((ip) => ip.startsWith('10.')) ?? ips[0] ?? null;
    } catch {
      /* статичний хостинг без /net-info */
    }
  }

  /** ownBoat — гість приходить на своїй яхті (інакше — в екіпаж капітана) */
  async start(nick: string, room: string | null, ownBoat = true) {
    this.leave();
    const s = (await relayAvailable()) ? new NetSession() : new P2PSession();
    s.onJoin = (p) => {
      this.ensurePeer(p);
      this.h.onPeer(p.nick, true);
      // своя збірка — новенькому: різні збірки в одній кімнаті розходяться
      s.send({ k: 'v', h: BUILD.hash }, p.id);
    };
    s.onLeave = (p) => {
      this.dropPeer(p.id);
      this.h.onPeer(p.nick, false);
    };
    s.onMsg = (from, d) => this.onMsg(from, d);
    s.onClosed = (reason) => {
      this.cleanup();
      this.h.onClosed(reason);
    };
    await s.connect(nick, room);
    this.session = s;
    this.myBoat = s.isHost || ownBoat ? s.id : s.hostId;
    if (s.isHost) void this.fetchLan();
    for (const p of s.peers.values()) this.ensurePeer(p);
    s.send({ k: 'v', h: BUILD.hash });
  }

  /** перейти на іншу яхту (owner = myId — своя) */
  setMyBoat(owner: number) {
    this.myBoat = owner;
    this.helmOwner = null;
    this.myHelm = [0, 0];
    const f = this.fleet.get(owner);
    if (f?.visual) {
      f.visual.dispose(this.scene);
      f.visual = null;
    }
    if (f) f.fresh = true;
    this.holdKey = '';
  }

  leave() {
    this.session?.close();
    this.cleanup();
  }

  private cleanup() {
    this.session = null;
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    for (const f of this.fleet.values()) f.visual?.dispose(this.scene);
    this.fleet.clear();
    this.clockOffset = null;
    this.helmOwner = null;
    this.myBoat = 0;
  }

  private ensurePeer(p: PeerInfo): RemotePeer {
    let r = this.peers.get(p.id);
    if (!r) {
      r = { info: p, avatar: new Avatar(this.scene, p.nick, colorForId(p.id), p.id), state: null, helm: null, pump: false };
      this.peers.set(p.id, r);
    }
    return r;
  }

  private dropPeer(id: number) {
    this.peerRoutes.delete(id);
    const r = this.peers.get(id);
    if (!r) return;
    r.avatar.dispose(this.scene);
    this.peers.delete(id);
    if (this.helmOwner === id) this.helmOwner = null;
    const f = this.fleet.get(id);
    if (f) {
      f.visual?.dispose(this.scene);
      this.fleet.delete(id);
    }
  }

  nickOf(id: number): string {
    return this.session?.nickOf(id) ?? '???';
  }

  /** колір куртки свого аватара */
  get myColor(): number {
    return colorForId(this.myId);
  }

  colorOf(id: number): string {
    return '#' + colorForId(id).toString(16).padStart(6, '0');
  }

  /** список для меню паузи / HUD */
  roster(): Array<{ id: number; nick: string; color: string; host: boolean; me: boolean }> {
    const s = this.session;
    if (!s) return [];
    const ids = [s.id, ...this.peers.keys()].sort((a, b) => a - b);
    return ids.map((id) => ({ id, nick: s.nickOf(id), color: this.colorOf(id), host: id === s.hostId, me: id === s.id }));
  }

  /** яхти в кімнаті: власник, екіпаж, чи моя, чи я на ній */
  fleetList(): FleetEntry[] {
    const s = this.session;
    if (!s) return [];
    const boatOf = new Map<number, number>([[s.id, this.myBoat]]);
    for (const [id, r] of this.peers) boatOf.set(id, r.state?.bo ?? s.hostId);
    const owners = new Set<number>();
    for (const [id, b] of boatOf) if (b === id) owners.add(id);
    owners.add(this.myBoat);
    return [...owners].sort((a, b) => a - b).map((o) => ({
      owner: o,
      nick: s.nickOf(o),
      crew: [...boatOf].filter(([id, b]) => b === o && id !== o).map(([id]) => s.nickOf(id)),
      mine: o === s.id,
      here: o === this.myBoat,
    }));
  }

  // ── повідомлення ──

  private onMsg(from: number, d: GameMsg) {
    const s = this.session;
    if (!s) return;
    switch (d.k) {
      case 'p': {
        const r = this.peers.get(from);
        if (!r) return;
        r.state = d.s as NetPlayer;
        // інший капелюх — перебудувати модель
        if ((r.state.h ?? 'captain') !== r.avatar.hatId) {
          r.avatar.dispose(this.scene);
          r.avatar = new Avatar(this.scene, r.info.nick, colorForId(r.info.id), r.info.id, r.state.h);
        }
        r.avatar.state = r.state;
        r.helm = (d.helm as [number, number] | undefined) ?? null;
        r.pump = d.pump === 1;
        break;
      }
      case 'w': {
        if (s.isHost || from !== s.hostId) return;
        const t = d.t as number;
        const off = t - performance.now() / 1000;
        // орієнтир — найшвидші пакети (найбільший off): до них підтягуємось
        // швидко, а від запізнілих відступаємо повільно — джитер мережі не «смикає» годинник
        if (this.clockOffset == null || Math.abs(off - this.clockOffset) > 2) this.clockOffset = off;
        else this.clockOffset += (off - this.clockOffset) * (off > this.clockOffset ? 0.3 : 0.02);
        this.lastWorld = d;
        this.worldFresh = true;
        // темп гри — як у господаря кімнати
        if (typeof d.pc === 'number') setPace(d.pc);
        if (d.bt) this.onBots?.(d.bt);
        break;
      }
      case 'b': {
        if (from === s.id) return;
        let f = this.fleet.get(from);
        if (!f) {
          f = { snaps: [], last: null, fresh: false, rx: 0, visual: null, upKey: '' };
          this.fleet.set(from, f);
        }
        const t = d.t as number;
        const b = d.b as number[];
        f.rx = performance.now() / 1000;
        // телепорт (затоплення, перезапуск) — без інтерполяції через пів моря
        const last = f.snaps[f.snaps.length - 1];
        if (last && Math.hypot(b[0] - last.b[0], b[2] - last.b[2]) > 25) f.snaps = [];
        // трюм приходить не в кожному пакеті — зберігаємо останній
        const hold = d.hold ?? f.last?.hold;
        f.last = { ...d, hold };
        f.fresh = true;
        if (last && t <= last.t) return;
        f.snaps.push({ t, b });
        if (f.snaps.length > 40) f.snaps.splice(0, f.snaps.length - 40);
        break;
      }
      case 'a': {
        // дії приймає лише власник яхти, на якій зараз відправник
        if (this.myBoat !== s.id) return;
        this.h.onAction(s.nickOf(from), d.act as BoatAction);
        break;
      }
      case 'e': {
        const world = d.w === 1;
        if (world ? from !== s.hostId || s.isHost : from !== this.myBoat) return;
        this.h.onEvent(d.e as string, d.v);
        break;
      }
      case 'm': {
        // запаси бірж — лише від капітана кімнати
        if (s.isHost || from !== s.hostId) return;
        this.onMarket?.(d.m);
        break;
      }
      case 'ms': {
        if (!s.isHost) return;
        const u = Number(d.u);
        if (typeof d.p === 'string' && typeof d.sp === 'string' && Number.isFinite(u) && u > 0 && u < 5) this.onMarketSale?.(d.p, d.sp, u);
        break;
      }
      case 'rt': {
        // маршрут гравця: показуємо лише екіпажу того самого борту (фільтр — у crewRoutes)
        const raw = Array.isArray(d.r) ? (d.r as unknown[]).slice(0, 96) : [];
        const pts: Array<{ x: number; z: number }> = [];
        for (let i = 0; i + 1 < raw.length; i += 2) {
          const x = Number(raw[i]), z = Number(raw[i + 1]);
          if (Number.isFinite(x) && Number.isFinite(z)) pts.push({ x, z });
        }
        this.peerRoutes.set(from, { bo: Number(d.bo), pts });
        break;
      }
      case 'v': {
        if (typeof d.h === 'string' && d.h !== BUILD.hash) this.h.onBuild(s.nickOf(from), d.h.slice(0, 16));
        break;
      }
      case 'c': {
        const text = String(d.text ?? '').slice(0, 160);
        if (text) this.h.onChat(s.nickOf(from), text, this.colorOf(from));
        break;
      }
    }
  }

  /** екіпаж: напрям і фази хвиль від власника яхти (щоб корпус сидів у тій самій воді) */
  oceanNet(): number[] | null {
    if (!this.crewing) return null;
    const oc = this.fleet.get(this.myBoat)?.last?.oc;
    return Array.isArray(oc) ? (oc as number[]) : null;
  }

  /** дія над моєю яхтою — її власнику */
  sendAction(act: BoatAction) {
    if (!this.session || !this.crewing) return;
    this.session.send({ k: 'a', act }, this.myBoat);
  }

  /** подія моєї яхти — її екіпажу (лише власник) */
  sendEvent(e: string, v?: unknown) {
    if (this.active && !this.crewing) this.session!.send({ k: 'e', e, v });
  }

  /** подія світу (блискавка, сон) — від капітана кімнати всім */
  sendWorldEvent(e: string, v?: unknown) {
    if (this.isHost) this.session!.send({ k: 'e', e, v, w: 1 });
  }

  /** гість продав рибу на біржі — капітан кімнати додасть її в запас (спільний ринок) */
  sendMarketSale(portId: string, speciesId: string, units: number) {
    const s = this.session;
    if (!s || s.isHost) return;
    s.send({ k: 'ms', p: portId, sp: speciesId, u: Math.round(units * 100) / 100 }, s.hostId);
  }

  sendChat(text: string) {
    const t = text.trim().slice(0, 160);
    if (!t || !this.session) return;
    this.session.send({ k: 'c', text: t });
    this.h.onChat(this.session.nick, t, this.colorOf(this.session.id));
  }

  /** чи вільний штурвал моєї яхти (ніхто інший його не тримає) */
  wheelTakenBy(): string | null {
    for (const [id, r] of this.peers) {
      if ((r.state?.bo ?? this.hostId) !== this.myBoat) continue;
      if (r.state?.wh) return r.info.nick;
      if (this.crewing && this.helmOwner === id) return r.info.nick;
    }
    return null;
  }

  // ── власник яхти ──

  /** перед кроком фізики: штурвал/помпа екіпажу моєї яхти */
  ownerApply(dt: number, boat: Boat, player: Player) {
    if (!this.active || this.crewing) return;
    if (player.wheeling) {
      this.helmOwner = this.myId;
    } else {
      let owner: number | null = null;
      for (const [id, r] of this.peers) {
        if (r.state?.bo !== this.myId) continue;
        if (r.state?.wh && r.helm) {
          owner = id;
          boat.throttle = r.helm[0];
          boat.rudder = r.helm[1];
          break;
        }
      }
      // гість відпустив штурвал — колесо повертається до прямо (газ лишається)
      if (owner == null && this.helmOwner != null && this.helmOwner !== this.myId) boat.rudder = 0;
      this.helmOwner = owner;
    }
    for (const r of this.peers.values()) if (r.pump && r.state?.bo === this.myId) boat.dryDeck(dt);
  }

  /** після кроку фізики: знімок моєї яхти всім (і світу — від капітана) */
  ownerSend(dt: number, simTime: number, boat: Boat, weather: Weather, time: TimeCycle, g: GameState, ocean?: number[]) {
    if (!this.active || this.peers.size === 0) return;
    const r = (v: number, k = 1000) => Math.round(v * k) / k;
    if (this.isHost) {
      this.worldTimer -= dt;
      if (this.worldTimer <= 0) {
        this.worldTimer = Math.max(0, this.worldTimer + 1 / WORLD_HZ);
        this.session!.send({
          k: 'w',
          t: r(simTime),
          w: [r(weather.base, 1e4), r(weather.snapshot().forecast, 1e3), r(weather.windDir, 1e4), r(weather.flash, 100), Math.round(weather.stormEta ?? -1), Math.round(weather.frontEta ?? -1)],
          bt: this.botState?.(),
          tm: [r(time.hours, 1e4), time.dayCount],
          pc: r(getPace(), 100),
        });
      }
      // жива біржа: запаси рідко змінюються — знімок раз на 2 с
      this.marketTimer -= dt;
      if (this.marketTimer <= 0 && this.marketState) {
        this.marketTimer = MARKET_SEC;
        this.session!.send({ k: 'm', m: this.marketState() });
      }
    }
    if (this.crewing) return;
    this.snapTimer -= dt;
    if (this.snapTimer > 0) return;
    this.snapTimer = Math.max(0, this.snapTimer + 1 / SNAP_HZ);
    const msg: GameMsg = {
      k: 'b',
      t: r(simTime),
      b: boat.netState(),
      oc: ocean,
      res: [r(g.fuel, 100), r(g.hull, 10), Math.round(g.money)],
      up: g.fittedUpgrades(),
      helm: this.helmOwner,
      ap: boat.autopilot ? 1 : 0,
      rd: this.radioState?.(),
    };
    // трюм — коли змінився (або раз на 2 с для тих, хто щойно прийшов)
    const key = g.hold.map((f) => f.uid + (f.cooked ? 'c' : '')).join(',');
    this.holdT -= dt;
    if (key !== this.holdKey || this.holdT <= 0) {
      this.holdKey = key;
      this.holdT = 2;
      msg.hold = g.hold.map((f) => ({ ...f, freshness: Math.round(f.freshness * 10) / 10 }));
    }
    this.session!.send(msg);
  }

  // ── годинник, моя чужа яхта, чужі яхти ──

  /** час капітана зараз (для гостя — оцінка), null — ще невідомо */
  private clock(simTime: number): number | null {
    if (this.isHost) return simTime;
    if (this.clockOffset == null) return null;
    return performance.now() / 1000 + this.clockOffset;
  }

  /** затримка відтворення знімків яхти власника */
  private delayOf(owner: number): number {
    return owner === this.hostId ? INTERP_DELAY : INTERP_DELAY * 2;
  }

  /**
   * Перед кадром (гість): погода й час від капітана; якщо я в екіпажі —
   * поза яхти з буфера знімків. Повертає час симуляції (хвиль) або null.
   */
  clientApply(boat: Boat, weather: Weather, time: TimeCycle, g: GameState): number | null {
    if (!this.isClient && !this.crewing) return null;
    const clock = this.clock(0);
    if (clock == null) return null;
    const w = this.lastWorld;
    if (w && this.worldFresh) {
      this.worldFresh = false;
      const wv = w.w as number[];
      weather.applyNet(wv[0], wv[1], wv[2], wv[3], wv[4], wv[5]);
      const tm = w.tm as number[];
      // години — м'яко (щоб не стрибало між пакетами), стрибок сну — одразу
      let dh = tm[0] - time.hours;
      if (dh > 12) dh -= 24;
      if (dh < -12) dh += 24;
      if (Math.abs(dh) > 0.5 || tm[1] !== time.dayCount) {
        time.hours = tm[0];
        time.dayCount = tm[1];
      } else {
        time.hours += dh * 0.2;
      }
    }
    if (!this.crewing) return clock - INTERP_DELAY;
    const renderT = clock - this.delayOf(this.myBoat);
    const f = this.fleet.get(this.myBoat);
    if (!f || f.snaps.length === 0) return renderT;
    this.interp(f.snaps, renderT, this._b);
    boat.applyNet(this._b);
    const last = f.last;
    if (last && f.fresh) {
      f.fresh = false;
      const res = last.res as number[];
      g.fuel = res[0];
      g.hull = res[1];
      if (typeof res[2] === 'number') g.walletNet(res[2]);
      g.upgrades = { ...g.upgrades, ...(last.up as Record<UpgradeId, number>) };
      this.helmOwner = (last.helm as number | null) ?? null;
      boat.autopilot = last.ap === 1;
      if (Array.isArray(last.rd)) this.onRadio?.(last.rd as number[]);
      if (Array.isArray(last.hold)) g.hold = (last.hold as FishItem[]).map((x) => ({ ...x }));
    }
    return renderT;
  }

  private interp(sn: Snap[], renderT: number, out: number[]) {
    // відкидаємо застарілі (лишаємо одну до renderT)
    while (sn.length > 2 && sn[1].t <= renderT) sn.shift();
    const a = sn[0];
    const b = sn.length > 1 ? sn[1] : null;
    out.length = a.b.length;
    if (!b || renderT <= a.t) {
      // немає наступного — коротка екстраполяція за швидкістю (до 0.25 с)
      for (let i = 0; i < a.b.length; i++) out[i] = a.b[i];
      const ex = Math.min(0.25, Math.max(0, renderT - a.t));
      out[0] += a.b[6] * ex;
      out[2] += a.b[8] * ex;
    } else {
      const f = Math.min(1, (renderT - a.t) / Math.max(1e-4, b.t - a.t));
      for (let i = 0; i < a.b.length; i++) out[i] = a.b[i] + (b.b[i] - a.b[i]) * f;
      // кути — найкоротшою дугою
      const dh = Math.atan2(Math.sin(b.b[3] - a.b[3]), Math.cos(b.b[3] - a.b[3]));
      out[3] = a.b[3] + dh * f;
      // дискретні — від новішого
      for (const i of [11, 13, 14, 15, 17, 18, 19, 20, 23, 25, 26, 27]) if (i < b.b.length) out[i] = b.b[i];
    }
  }

  /** чужі яхти, на яких мене немає: картинка за знімками */
  updateFleet(dt: number, simTime: number, ocean: Ocean, weather: Weather, g: GameState, particles: ParticlePool, daylight: number) {
    if (!this.active) return;
    const now = performance.now() / 1000;
    const clock = this.clock(simTime);
    for (const [owner, f] of this.fleet) {
      if (owner === this.myBoat) continue;
      // власник перейшов на чужу яхту / пішов — яхта зникає
      if (now - f.rx > 3) {
        f.visual?.dispose(this.scene);
        this.fleet.delete(owner);
        continue;
      }
      if (clock == null || f.snaps.length === 0) continue;
      if (!f.visual) {
        f.visual = new Boat(this.scene, true);
        f.visual.sails.passive = true;
        f.upKey = '';
      }
      const v = f.visual;
      this.interp(f.snaps, clock - this.delayOf(owner), this._b);
      v.applyNet(this._b);
      // хвилі в кожного свої (фази) — висоту чужої яхти беремо з нашої води
      v.pos.y = ocean.heightAt(v.pos.x, v.pos.z, simTime) - 0.5;
      const up = f.last?.up as Record<UpgradeId, number> | undefined;
      const key = up ? JSON.stringify(up) : '';
      if (up && key !== f.upKey) {
        f.upKey = key;
        v.applyUpgrades(up, daylight);
      }
      v.updateRemote(dt, simTime, ocean, weather, g, particles, null);
    }
  }

  /** чужі яхти як перешкоди для фізики своєї (зіткнення) */
  /** чужі яхти флотилії для радара/AIS: позиція, курс, ім'я власника */
  fleetBoats(): Array<{ x: number; z: number; h: number; name: string }> {
    const out: Array<{ x: number; z: number; h: number; name: string }> = [];
    for (const [owner, f] of this.fleet) {
      if (owner === this.myBoat || !f.visual) continue;
      out.push({ x: f.visual.pos.x, z: f.visual.pos.z, h: f.visual.heading, name: `⛵ ${this.session?.nickOf(owner) ?? '???'}` });
    }
    return out;
  }

  fleetObstacles(): Array<{ x: number; z: number; r: number; kind: 'mark' }> {
    const out: Array<{ x: number; z: number; r: number; kind: 'mark' }> = [];
    for (const [owner, f] of this.fleet) {
      if (owner === this.myBoat || !f.visual) continue;
      out.push({ x: f.visual.pos.x, z: f.visual.pos.z, r: 2.4, kind: 'mark' });
    }
    return out;
  }

  /** кожен кадр: свій стан іншим + анімація аватарів */
  tick(dt: number, boat: Boat, player: Player, pumping: boolean, fishing: Fishing, ocean: Ocean, t: number) {
    if (!this.active) return;
    this.playerTimer -= dt;
    if (this.playerTimer <= 0) {
      this.playerTimer += 1 / PLAYER_HZ;
      if (this.playerTimer < 0) this.playerTimer = 0;
      const r = (v: number, k = 100) => Math.round(v * k) / k;
      const onBoat = player.mode === 'boat';
      const st: NetPlayer = {
        m: onBoat ? 0 : player.mode === 'port' ? 1 : 2,
        x: r(onBoat ? player.localX : player.wx),
        y: r((onBoat ? player.floorY : player.wy) + player.jumpH),
        z: r(onBoat ? player.localZ : player.wz),
        yaw: r(player.yaw, 1000),
        pitch: r(player.pitch, 100),
        wh: player.wheeling ? 1 : 0,
        mv: player.moving ? 1 : 0,
        bo: this.myBoat,
      };
      if (this.myHat !== 'captain') st.h = this.myHat;
      const fs = fishing.netState();
      if (fs) st.f = fs;
      const rd = fishing.netHand;
      if (rd) st.rd = rd;
      const msg: GameMsg = { k: 'p', s: st };
      if (this.crewing && player.wheeling) msg.helm = [r(this.myHelm[0]), r(this.myHelm[1])];
      if (pumping) msg.pump = 1;
      this.session!.send(msg);
    }
    for (const r of this.peers.values()) {
      const bo = r.state?.bo ?? this.hostId;
      const b = bo === this.myBoat ? boat : this.fleet.get(bo)?.visual ?? null;
      r.avatar.update(dt, b, ocean, t);
    }
  }

  // ── спільна лоція екіпажу: кожен бачить точки маршруту свого борту своїм кольором ──
  private peerRoutes = new Map<number, { bo: number; pts: Array<{ x: number; z: number }> }>();
  private routeKey = '';
  private routeT = 0;

  /** свій маршрут — усім (при зміні й раз на 3 с, щоб його отримав і той, хто щойно прийшов на борт) */
  syncRoute(dt: number, route: ReadonlyArray<{ x: number; z: number }>) {
    if (!this.active || !this.session) return;
    this.routeT -= dt;
    const flat: number[] = [];
    for (const p of route) flat.push(Math.round(p.x), Math.round(p.z));
    const key = this.myBoat + ':' + flat.join(',');
    if (key === this.routeKey && this.routeT > 0) return;
    this.routeKey = key;
    this.routeT = 3;
    this.session.send({ k: 'rt', bo: this.myBoat, r: flat });
  }

  /** маршрути інших гравців на моєму борту (капітан — першим) */
  crewRoutes(): CrewRoute[] {
    const out: CrewRoute[] = [];
    if (!this.active || !this.session) return out;
    for (const [id, v] of this.peerRoutes) {
      if (!this.peers.has(id) || v.bo !== this.myBoat || !v.pts.length) continue;
      out.push({ id, nick: this.nickOf(id), color: this.colorOf(id), captain: id === this.myBoat, pts: v.pts });
    }
    return out.sort((a, b) => Number(b.captain) - Number(a.captain));
  }

  /** друзі для мапи/мінімапи: світова позиція, колір, нік, чи на борту, чи рибалить */
  friendMarkers(): FriendMarker[] {
    const out: FriendMarker[] = [];
    for (const [id, r] of this.peers) {
      if (!r.state || !r.avatar.root.visible) continue;
      const p = r.avatar.worldPos;
      out.push({ x: p.x, z: p.z, nick: r.info.nick, color: this.colorOf(id), onBoat: r.state.m === 0, fishing: !!r.state.f });
    }
    return out;
  }
}
