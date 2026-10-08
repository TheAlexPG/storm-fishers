// ─────────────────────────────────────────────────────────────
// Місце для коопа. MVP — LocalAdapter (echo), але весь світ
// будується так, що стан можна ретранслювати:
//   World (час/погода) — authority хоста, синхрон по clock;
//   Boat — shared object, authority хоста;
//   Player — N слотів, інпути помередь.
// ─────────────────────────────────────────────────────────────

export interface NetMessage {
  type: string;
  [key: string]: unknown;
}

export interface NetworkAdapter {
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  send(msg: NetMessage): void;
  onMessage(cb: (msg: NetMessage) => void): void;
}

/** MVP: локальний ехо-адаптер. */
export class LocalAdapter implements NetworkAdapter {
  connected = true;
  private cb: ((msg: NetMessage) => void) | null = null;

  connect() {
    /* нічого не робить */
  }

  disconnect() {
    this.connected = false;
  }

  send(_msg: NetMessage) {
    /* single-player: повідомлення кудись не надсилаємо */
  }

  onMessage(cb: (msg: NetMessage) => void) {
    this.cb = cb;
    void this.cb;
  }
}
