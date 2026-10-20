import { L } from '../core/i18n';
// ─────────────────────────────────────────────────────────────
// З'єднання з кооп-реле (server/relay.mjs) по WebSocket.
// Кімната за 4-літерним кодом; хост (капітан) — authority світу й човна.
// ─────────────────────────────────────────────────────────────

export interface PeerInfo {
  id: number;
  nick: string;
}

export interface Welcome {
  id: number;
  nick: string;
  room: string;
  host: boolean;
  hostId: number;
  peers: PeerInfo[];
}

export type GameMsg = { k: string; [key: string]: unknown };

export class NetSession {
  id = 0;
  nick = '';
  room = '';
  isHost = false;
  hostId = 0;
  peers = new Map<number, PeerInfo>();
  connected = false;

  onJoin: ((p: PeerInfo) => void) | null = null;
  onLeave: ((p: PeerInfo) => void) | null = null;
  onMsg: ((from: number, d: GameMsg) => void) | null = null;
  /** з'єднання втрачено або капітан пішов */
  onClosed: ((reason: string) => void) | null = null;

  private ws: WebSocket | null = null;
  private closedByUs = false;

  static url(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/net`;
  }

  /** створити кімнату (room = null) або приєднатися до наявної */
  connect(nick: string, room: string | null): Promise<Welcome> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(NetSession.url());
      this.ws = ws;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error(L('Сервер не відповідає', `Server is not responding`)));
      }, 6000);
      ws.onopen = () => {
        ws.send(JSON.stringify(room ? { t: 'hello', nick, room } : { t: 'hello', nick, create: true }));
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(L('Немає з\'єднання з сервером', `No connection to the server`)));
      };
      ws.onclose = () => {
        const was = this.connected;
        this.connected = false;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(L('З\'єднання закрито', `Connection closed`)));
        } else if (was && !this.closedByUs) {
          this.onClosed?.(this.isHost ? L('Зв\'язок із сервером втрачено', `Lost connection to the server`) : L('Зв\'язок із капітаном втрачено', `Lost connection to the captain`));
        }
      };
      ws.onmessage = (ev) => {
        let m: any;
        try {
          m = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        switch (m.t) {
          case 'welcome': {
            const w = m as Welcome;
            this.id = w.id;
            this.nick = w.nick;
            this.room = w.room;
            this.isHost = w.host;
            this.hostId = w.hostId;
            this.peers.clear();
            for (const p of w.peers) this.peers.set(p.id, p);
            this.connected = true;
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(w);
            }
            break;
          }
          case 'error':
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              ws.close();
              reject(new Error(relayError(String(m.msg))));
            }
            break;
          case 'join': {
            const p = { id: m.id as number, nick: String(m.nick) };
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
            this.closedByUs = true; // наступний onclose — очікуваний
            this.connected = false;
            this.onClosed?.(L('Капітана більше немає в грі — кімнату закрито', `The captain has left the game — the room is closed`));
            break;
          case 'msg':
            this.onMsg?.(m.from as number, m.d as GameMsg);
            break;
        }
      };
    });
  }

  /** усім у кімнаті (або одному, якщо to) */
  send(d: GameMsg, to?: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(to != null ? { t: 'msg', to, d } : { t: 'msg', d }));
  }

  close() {
    this.closedByUs = true;
    this.connected = false;
    this.ws?.close();
    this.ws = null;
    this.peers.clear();
  }

  nickOf(id: number): string {
    if (id === this.id) return this.nick;
    return this.peers.get(id)?.nick ?? '???';
  }
}

/** помилки реле приходять ключами (#notfound:КОД, #full:n) — читаємо своєю мовою */
function relayError(msg: string): string {
  const nf = /^#notfound:(.*)$/.exec(msg);
  if (nf) return L(`Кімнату «${nf[1]}» не знайдено`, `Room “${nf[1]}” not found`);
  const full = /^#full:(\d+)$/.exec(msg);
  if (full) return L(`Кімната повна (${full[1]}/${full[1]})`, `The room is full (${full[1]}/${full[1]})`);
  return msg;
}
