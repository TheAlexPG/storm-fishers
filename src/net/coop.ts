import * as THREE from 'three';
import { NetSession, type GameMsg, type PeerInfo } from './session';
import { Avatar, colorForId, type NetPlayer } from '../world/avatar';
import type { Boat } from '../world/boat';
import type { Ocean } from '../core/ocean';
import type { Fishing } from '../game/fishing';
import type { Player } from '../world/player';
import type { Weather } from '../core/weather';
import type { TimeCycle } from '../core/time';
import type { GameState } from '../game/state';
import type { UpgradeId } from '../core/types';

// ─────────────────────────────────────────────────────────────
// Кооп «одна яхта на всіх».
//   Капітан (хост): симулює човен, погоду, час; 20 Гц шле знімок світу.
//   Екіпаж (гості): човен не симулюють — інтерполюють знімки з затримкою
//   ~120 мс (той самий час хвиль, що й у капітана → корпус сидить у воді
//   однаково). Свого гравця кожен рухає сам і шле 15 Гц.
//   Дії гостей над спільним човном (штурвал, фали, двигун, помпа,
//   покупки) — повідомленнями капітану. Гаманець/улов — у кожного свій.
// ─────────────────────────────────────────────────────────────

const SNAP_HZ = 20;
const PLAYER_HZ = 15;
/** затримка відтворення знімків: 2.4 пакети — переживає джитер Wi‑Fi */
const INTERP_DELAY = 0.12;

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

export type BoatAction =
  | { a: 'sails' }
  | { a: 'engine' }
  | { a: 'repair'; v: number }
  | { a: 'fuel'; v: number }
  | { a: 'hullFull' }
  | { a: 'upgrade'; id: string };

export interface FriendMarker {
  x: number;
  z: number;
  nick: string;
  color: string;
  onBoat: boolean;
  fishing: boolean;
}

export interface CoopHandlers {
  /** капітан: гість зробив дію над човном */
  onAction(from: string, act: BoatAction): void;
  /** гість: подія від капітана (удар, затоплення, тост…) */
  onEvent(e: string, v: unknown): void;
  onChat(nick: string, text: string, color: string): void;
  onPeer(nick: string, joined: boolean): void;
  onClosed(reason: string): void;
}

export class Coop {
  session: NetSession | null = null;
  readonly peers = new Map<number, RemotePeer>();
  /** хто за штурвалом (id) — від капітана */
  helmOwner: number | null = null;
  /** гість: свій газ/кермо, поки тримає штурвал (знімки його не перетирають) */
  myHelm: [number, number] = [0, 0];

  private snaps: Snap[] = [];
  /** гість: оцінка (час капітана − локальний годинник) */
  private clockOffset: number | null = null;
  private snapTimer = 0;
  private playerTimer = 0;
  private _b: number[] = [];

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
  get room(): string {
    return this.session?.room ?? '';
  }
  get myId(): number {
    return this.session?.id ?? 0;
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

  async start(nick: string, room: string | null) {
    this.leave();
    const s = new NetSession();
    s.onJoin = (p) => {
      this.ensurePeer(p);
      this.h.onPeer(p.nick, true);
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
    if (s.isHost) void this.fetchLan();
    for (const p of s.peers.values()) this.ensurePeer(p);
  }

  leave() {
    this.session?.close();
    this.cleanup();
  }

  private cleanup() {
    this.session = null;
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.snaps = [];
    this.clockOffset = null;
    this.helmOwner = null;
  }

  private ensurePeer(p: PeerInfo): RemotePeer {
    let r = this.peers.get(p.id);
    if (!r) {
      r = { info: p, avatar: new Avatar(this.scene, p.nick, colorForId(p.id)), state: null, helm: null, pump: false };
      this.peers.set(p.id, r);
    }
    return r;
  }

  private dropPeer(id: number) {
    const r = this.peers.get(id);
    if (!r) return;
    r.avatar.dispose(this.scene);
    this.peers.delete(id);
    if (this.helmOwner === id) this.helmOwner = null;
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

  // ── повідомлення ──

  private onMsg(from: number, d: GameMsg) {
    const s = this.session;
    if (!s) return;
    switch (d.k) {
      case 'p': {
        const r = this.peers.get(from);
        if (!r) return;
        r.state = d.s as NetPlayer;
        r.avatar.state = r.state;
        r.helm = (d.helm as [number, number] | undefined) ?? null;
        r.pump = d.pump === 1;
        break;
      }
      case 's': {
        if (s.isHost || from !== s.hostId) return;
        const t = d.t as number;
        const now = performance.now() / 1000;
        const off = t - now;
        // орієнтир — найшвидші пакети (найбільший off): до них підтягуємось
        // швидко, а від запізнілих відступаємо повільно — джитер мережі не «смикає» годинник
        if (this.clockOffset == null || Math.abs(off - this.clockOffset) > 2) this.clockOffset = off;
        else this.clockOffset += (off - this.clockOffset) * (off > this.clockOffset ? 0.3 : 0.02);
        // телепорт (затоплення, перезапуск) — без інтерполяції через пів моря
        const last = this.snaps[this.snaps.length - 1];
        if (last && Math.hypot((d.b as number[])[0] - last.b[0], (d.b as number[])[2] - last.b[2]) > 25) this.snaps = [];
        if (last && t <= last.t) return;
        this.snaps.push({ t, b: d.b as number[] });
        if (this.snaps.length > 40) this.snaps.splice(0, this.snaps.length - 40);
        this.lastWorld = d;
        this.worldFresh = true;
        break;
      }
      case 'a': {
        if (!s.isHost) return;
        this.h.onAction(s.nickOf(from), d.act as BoatAction);
        break;
      }
      case 'e': {
        if (s.isHost || from !== s.hostId) return;
        this.h.onEvent(d.e as string, d.v);
        break;
      }
      case 'c': {
        const text = String(d.text ?? '').slice(0, 160);
        if (text) this.h.onChat(s.nickOf(from), text, this.colorOf(from));
        break;
      }
    }
  }

  /** останній знімок світу (погода/час/ресурси) — гість застосовує в applyWorld */
  private lastWorld: GameMsg | null = null;
  private worldFresh = false;

  sendAction(act: BoatAction) {
    this.session?.send({ k: 'a', act }, this.session.hostId);
  }

  sendEvent(e: string, v?: unknown) {
    if (this.isHost) this.session!.send({ k: 'e', e, v });
  }

  sendChat(text: string) {
    const t = text.trim().slice(0, 160);
    if (!t || !this.session) return;
    this.session.send({ k: 'c', text: t });
    this.h.onChat(this.session.nick, t, this.colorOf(this.session.id));
  }

  /** чи вільний штурвал для мене (ніхто інший його не тримає) */
  wheelTakenBy(): string | null {
    for (const [id, r] of this.peers) {
      if (r.state?.wh) return r.info.nick;
      if (this.isClient && this.helmOwner === id) return r.info.nick;
    }
    return null;
  }

  // ── капітан ──

  /** перед кроком фізики: штурвал/помпа гостей */
  hostApply(dt: number, boat: Boat, player: Player) {
    if (!this.isHost) return;
    if (player.wheeling) {
      this.helmOwner = this.myId;
    } else {
      let owner: number | null = null;
      for (const [id, r] of this.peers) {
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
    for (const r of this.peers.values()) if (r.pump) boat.dryDeck(dt);
  }

  /** після кроку фізики: знімок світу всім */
  hostSend(dt: number, simTime: number, boat: Boat, weather: Weather, time: TimeCycle, g: GameState) {
    if (!this.isHost || this.peers.size === 0) return;
    this.snapTimer -= dt;
    if (this.snapTimer > 0) return;
    this.snapTimer += 1 / SNAP_HZ;
    if (this.snapTimer < 0) this.snapTimer = 0;
    const r = (v: number, k = 1000) => Math.round(v * k) / k;
    this.session!.send({
      k: 's',
      t: r(simTime),
      b: boat.netState(),
      w: [r(weather.intensity, 1e4), r(weather.snapshot().forecast, 1e3), r(weather.windDir, 1e4), r(weather.flash, 100)],
      tm: [r(time.hours, 1e4), time.dayCount],
      res: [r(g.fuel, 100), r(g.hull, 10)],
      up: g.upgrades,
      helm: this.helmOwner,
    });
  }

  // ── гість ──

  /**
   * Перед кадром: поза човна з буфера знімків, погода, час, ресурси човна.
   * Повертає час симуляції (хвиль), узгоджений з капітаном, або null, якщо
   * знімків ще немає.
   */
  clientApply(boat: Boat, weather: Weather, time: TimeCycle, g: GameState): number | null {
    if (!this.isClient || this.clockOffset == null || this.snaps.length === 0) return null;
    const renderT = performance.now() / 1000 + this.clockOffset - INTERP_DELAY;
    const sn = this.snaps;
    // відкидаємо застарілі (лишаємо одну до renderT)
    while (sn.length > 2 && sn[1].t <= renderT) sn.shift();
    const a = sn[0];
    const b = sn.length > 1 ? sn[1] : null;
    const out = this._b;
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
      out[11] = b.b[11];
      out[13] = b.b[13];
      out[14] = b.b[14];
    }
    boat.applyNet(out);

    const w = this.lastWorld;
    if (w && this.worldFresh) {
      this.worldFresh = false;
      const wv = w.w as number[];
      weather.applyNet(wv[0], wv[1], wv[2], wv[3]);
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
      const res = w.res as number[];
      g.fuel = res[0];
      g.hull = res[1];
      g.upgrades = { ...g.upgrades, ...(w.up as Record<UpgradeId, number>) };
      this.helmOwner = (w.helm as number | null) ?? null;
    }
    return renderT;
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
        y: r(onBoat ? player.floorY : player.wy),
        z: r(onBoat ? player.localZ : player.wz),
        yaw: r(player.yaw, 1000),
        pitch: r(player.pitch, 100),
        wh: player.wheeling ? 1 : 0,
        mv: player.moving ? 1 : 0,
      };
      const fs = fishing.netState();
      if (fs) st.f = fs;
      const msg: GameMsg = { k: 'p', s: st };
      if (this.isClient && player.wheeling) msg.helm = [r(this.myHelm[0]), r(this.myHelm[1])];
      if (pumping) msg.pump = 1;
      this.session!.send(msg);
    }
    for (const r of this.peers.values()) r.avatar.update(dt, boat, ocean, t);
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
