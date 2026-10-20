import Peer, { type DataConnection } from 'peerjs';
import type { GameMsg, PeerInfo, Welcome } from './session';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Кооп через інтернет без власного сервера: пряме з'єднання WebRTC
// (PeerJS; публічний брокер лише «знайомить» браузери). Капітан — центр
// зірки: приймає друзів, роздає їм id і пересилає повідомлення. Протокол —
// той самий, що в реле (server/relay.mjs), тож Coop не бачить різниці.
// ─────────────────────────────────────────────────────────────

const PREFIX = 'storm-fishers-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PEERS = 8;
const HOST_ID = 1;

function makeCode(): string {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

function cleanNick(v: unknown): string {
  const s = String(v ?? '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 16);
  return s || L('Моряк', `Sailor`);
}

type Wire =
  | { t: 'hello'; nick: string }
  | { t: 'welcome' } & Welcome
  | { t: 'error'; msg: string }
  | { t: 'join'; id: number; nick: string }
  | { t: 'leave'; id: number }
  | { t: 'hostLeft' }
  | { t: 'msg'; to?: number; from?: number; d: GameMsg };

export class P2PSession {
  id = 0;
  nick = '';
  room = '';
  isHost = false;
  hostId = HOST_ID;
  peers = new Map<number, PeerInfo>();
  connected = false;

  onJoin: ((p: PeerInfo) => void) | null = null;
  onLeave: ((p: PeerInfo) => void) | null = null;
  onMsg: ((from: number, d: GameMsg) => void) | null = null;
  onClosed: ((reason: string) => void) | null = null;

  private peer: Peer | null = null;
  /** капітан: з'єднання друзів за id */
  private conns = new Map<number, DataConnection>();
  /** гість: з'єднання з капітаном */
  private hostConn: DataConnection | null = null;
  private nextId = HOST_ID + 1;
  private closedByUs = false;

  connect(nick: string, room: string | null): Promise<Welcome> {
    return room ? this.join(nick, room.toUpperCase().trim()) : this.host(nick);
  }

  // ── капітан ──
  private host(nick: string, attempt = 0): Promise<Welcome> {
    return new Promise((resolve, reject) => {
      const code = makeCode();
      const peer = new Peer(PREFIX + code, { debug: 0 });
      const timer = setTimeout(() => {
        peer.destroy();
        reject(new Error(L('Сервер знайомств не відповідає — перевір інтернет', `The matchmaking server isn't responding — check your internet`)));
      }, 10000);
      peer.on('open', () => {
        clearTimeout(timer);
        this.peer = peer;
        this.id = HOST_ID;
        this.nick = cleanNick(nick);
        this.room = code;
        this.isHost = true;
        this.connected = true;
        peer.on('connection', (c) => this.acceptGuest(c));
        peer.on('disconnected', () => {
          // втратили брокер — наявні з'єднання живуть; пробуємо повернутись для нових друзів
          if (!this.closedByUs) peer.reconnect();
        });
        resolve({ id: HOST_ID, nick: this.nick, room: code, host: true, hostId: HOST_ID, peers: [] });
      });
      peer.on('error', (e: { type?: string }) => {
        clearTimeout(timer);
        if (this.connected) return;
        peer.destroy();
        if (e.type === 'unavailable-id' && attempt < 5) this.host(nick, attempt + 1).then(resolve, reject);
        else reject(new Error(L('Не вдалося створити кімнату: ', `Couldn't create a room: `) + (e.type ?? L('помилка мережі', `network error`))));
      });
    });
  }

  private acceptGuest(c: DataConnection) {
    let gid = 0;
    c.on('data', (raw) => {
      const m = raw as Wire;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello' && !gid) {
        if (this.conns.size >= MAX_PEERS - 1) {
          c.send({ t: 'error', msg: '#full' }); // гість перекладе сам
          setTimeout(() => c.close(), 300);
          return;
        }
        gid = this.nextId++;
        let nick = cleanNick(m.nick);
        const taken = new Set([this.nick, ...[...this.peers.values()].map((p) => p.nick)]);
        if (taken.has(nick)) {
          let k = 2;
          while (taken.has(`${nick} ${k}`)) k++;
          nick = `${nick} ${k}`;
        }
        const others: PeerInfo[] = [{ id: HOST_ID, nick: this.nick }, ...this.peers.values()];
        c.send({ t: 'welcome', id: gid, nick, room: this.room, host: false, hostId: HOST_ID, peers: others });
        for (const oc of this.conns.values()) oc.send({ t: 'join', id: gid, nick });
        this.conns.set(gid, c);
        const info = { id: gid, nick };
        this.peers.set(gid, info);
        this.onJoin?.(info);
        return;
      }
      if (m.t === 'msg' && gid) {
        const d = m.d;
        if (m.to == null) {
          this.onMsg?.(gid, d);
          for (const [id, oc] of this.conns) if (id !== gid) oc.send({ t: 'msg', from: gid, d });
        } else if (m.to === HOST_ID) {
          this.onMsg?.(gid, d);
        } else {
          this.conns.get(m.to)?.send({ t: 'msg', from: gid, d });
        }
      }
    });
    const drop = () => {
      if (!gid || !this.conns.has(gid)) return;
      this.conns.delete(gid);
      const p = this.peers.get(gid);
      this.peers.delete(gid);
      for (const oc of this.conns.values()) oc.send({ t: 'leave', id: gid });
      if (p) this.onLeave?.(p);
    };
    c.on('close', drop);
    c.on('error', drop);
  }

  // ── гість ──
  private join(nick: string, code: string): Promise<Welcome> {
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      let settled = false;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail(L(`Кімнату «${code}» не знайдено або капітан недоступний`, `Room “${code}” not found or the captain is unavailable`)), 12000);
      peer.on('error', (e: { type?: string }) => {
        if (e.type === 'peer-unavailable') fail(L(`Кімнату «${code}» не знайдено`, `Room “${code}” not found`));
        else if (!settled) fail(L('Немає з\'єднання: ', `No connection: `) + (e.type ?? L('помилка мережі', `network error`)));
        else if (!this.closedByUs && this.connected) {
          this.connected = false;
          this.onClosed?.(L('Зв\'язок із капітаном втрачено', `Lost connection to the captain`));
        }
      });
      peer.on('open', () => {
        const c = peer.connect(PREFIX + code, { serialization: 'json', reliable: true });
        this.hostConn = c;
        c.on('open', () => c.send({ t: 'hello', nick }));
        c.on('data', (raw) => {
          const m = raw as Wire;
          if (!m || typeof m !== 'object') return;
          switch (m.t) {
            case 'welcome': {
              this.peer = peer;
              this.id = m.id;
              this.nick = m.nick;
              this.room = m.room;
              this.isHost = false;
              this.hostId = m.hostId;
              this.peers.clear();
              for (const p of m.peers) this.peers.set(p.id, p);
              this.connected = true;
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve({ id: m.id, nick: m.nick, room: m.room, host: false, hostId: m.hostId, peers: m.peers });
              }
              break;
            }
            case 'error':
              fail(m.msg === '#full' ? L(`Кімната повна (${MAX_PEERS}/${MAX_PEERS})`, `The room is full (${MAX_PEERS}/${MAX_PEERS})`) : m.msg);
              break;
            case 'join': {
              const p = { id: m.id, nick: m.nick };
              this.peers.set(p.id, p);
              this.onJoin?.(p);
              break;
            }
            case 'leave': {
              const p = this.peers.get(m.id);
              this.peers.delete(m.id);
              if (p) this.onLeave?.(p);
              break;
            }
            case 'hostLeft':
              this.closedByUs = true;
              this.connected = false;
              this.onClosed?.(L('Капітана більше немає в грі — кімнату закрито', `The captain has left the game — the room is closed`));
              break;
            case 'msg':
              if (m.from != null) this.onMsg?.(m.from, m.d);
              break;
          }
        });
        c.on('close', () => {
          if (!settled) fail(L('З\'єднання закрито', `Connection closed`));
          else if (this.connected && !this.closedByUs) {
            this.connected = false;
            this.onClosed?.(L('Зв\'язок із капітаном втрачено', `Lost connection to the captain`));
          }
        });
      });
    });
  }

  /** усім у кімнаті (або одному, якщо to) */
  send(d: GameMsg, to?: number) {
    if (this.isHost) {
      if (to != null) this.conns.get(to)?.send({ t: 'msg', from: HOST_ID, d });
      else for (const c of this.conns.values()) c.send({ t: 'msg', from: HOST_ID, d });
    } else if (this.hostConn?.open) {
      this.hostConn.send(to != null ? { t: 'msg', to, d } : { t: 'msg', d });
    }
  }

  close() {
    this.closedByUs = true;
    if (this.isHost) for (const c of this.conns.values()) c.send({ t: 'hostLeft' });
    this.connected = false;
    const p = this.peer;
    // дати «hostLeft» відлетіти
    setTimeout(() => p?.destroy(), 200);
    this.peer = null;
    this.conns.clear();
    this.hostConn = null;
    this.peers.clear();
  }

  nickOf(id: number): string {
    if (id === this.id) return this.nick;
    return this.peers.get(id)?.nick ?? '???';
  }
}
