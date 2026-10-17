// ─────────────────────────────────────────────────────────────
// Кооп-реле «Шторм»: кімнати за кодом, ретрансляція повідомлень.
// Логіки гри тут немає — authority у хоста (той, хто створив кімнату).
//
//   dev:  вбудовано у Vite (vite.config.ts → attachRelay), шлях /net
//   prod: node server/relay.mjs [port]  — роздає dist/ + /net
//
// Протокол (JSON):
//   → {t:'hello', nick, create:true}            створити кімнату (ти — капітан)
//   → {t:'hello', nick, room:'ABCD'}            приєднатися
//   ← {t:'welcome', id, room, host, hostId, peers:[{id,nick}]}
//   ← {t:'error', msg}
//   ← {t:'join', id, nick} · {t:'leave', id} · {t:'hostLeft'}
//   → {t:'msg', to?, d}   ← {t:'msg', from, d}
// ─────────────────────────────────────────────────────────────

import { WebSocketServer } from 'ws';

const MAX_PEERS = 8;
const MAX_MSG = 32 * 1024;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** @type {Map<string, {code:string, hostId:number, peers:Map<number,{id:number,nick:string,ws:import('ws').WebSocket}>}>} */
const rooms = new Map();
let nextId = 1;

function makeCode() {
  for (let n = 0; n < 1000; n++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('no free room codes');
}

function cleanNick(v) {
  const s = String(v ?? '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 16);
  return s || 'Моряк';
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function onConnection(ws) {
  const id = nextId++;
  /** @type {null | {code:string, hostId:number, peers:Map}} */
  let room = null;
  let nick = 'Моряк';
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    if (raw.length > MAX_MSG) return;
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'hello' && !room) {
      nick = cleanNick(m.nick);
      if (m.create) {
        room = { code: makeCode(), hostId: id, peers: new Map() };
        rooms.set(room.code, room);
      } else {
        const code = String(m.room ?? '').toUpperCase().trim();
        const r = rooms.get(code);
        if (!r) return send(ws, { t: 'error', msg: `Кімнату «${code}» не знайдено` });
        if (r.peers.size >= MAX_PEERS) return send(ws, { t: 'error', msg: 'Кімната повна (8/8)' });
        room = r;
      }
      // однакові ніки — додаємо номер
      const taken = new Set([...room.peers.values()].map((p) => p.nick));
      if (taken.has(nick)) {
        let k = 2;
        while (taken.has(`${nick} ${k}`)) k++;
        nick = `${nick} ${k}`;
      }
      const peers = [...room.peers.values()].map((p) => ({ id: p.id, nick: p.nick }));
      for (const p of room.peers.values()) send(p.ws, { t: 'join', id, nick });
      room.peers.set(id, { id, nick, ws });
      send(ws, { t: 'welcome', id, nick, room: room.code, host: room.hostId === id, hostId: room.hostId, peers });
      return;
    }

    if (m.t === 'msg' && room) {
      const out = JSON.stringify({ t: 'msg', from: id, d: m.d });
      if (typeof m.to === 'number') {
        const p = room.peers.get(m.to);
        if (p && p.ws.readyState === 1) p.ws.send(out);
      } else {
        for (const p of room.peers.values()) if (p.id !== id && p.ws.readyState === 1) p.ws.send(out);
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.peers.delete(id);
    if (room.hostId === id) {
      // капітан пішов — кімната закривається
      for (const p of room.peers.values()) {
        send(p.ws, { t: 'hostLeft' });
        p.ws.close();
      }
      rooms.delete(room.code);
    } else {
      for (const p of room.peers.values()) send(p.ws, { t: 'leave', id });
      if (room.peers.size === 0) rooms.delete(room.code);
    }
    room = null;
  });
}

/** LAN-адреси цього комп'ютера — для посилання-запрошення, коли капітан відкрив гру на localhost */
export async function lanIps() {
  const os = await import('node:os');
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

/** connect-middleware: GET /net-info → {ips:[…]} */
export function netInfoMiddleware(req, res, next) {
  if ((req.url || '').split('?')[0] !== '/net-info') return next();
  lanIps().then((ips) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ips }));
  });
}

/** підчепити реле до наявного http-сервера (Vite dev / preview / свій) */
export function attachRelay(httpServer, path = '/net') {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });
  wss.on('connection', onConnection);
  httpServer.on('upgrade', (req, socket, head) => {
    const url = (req.url || '').split('?')[0];
    if (url !== path) return; // інші upgrade (Vite HMR) — не наші
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  // відвалені з'єднання (сон ноутбука, зник Wi‑Fi)
  const iv = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 10000);
  httpServer.on('close', () => clearInterval(iv));
  return wss;
}

// ── самостійний запуск: роздати збірку + реле ──
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const pathMod = await import('node:path');
  const root = pathMod.resolve(pathMod.dirname(fileURLToPath(import.meta.url)), '../dist');
  const port = Number(process.argv[2] || process.env.PORT || 8080);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
  const server = http.createServer((req, res) => netInfoMiddleware(req, res, () => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = pathMod.join(root, pathMod.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': types[pathMod.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  }));
  attachRelay(server);
  server.listen(port, () => {
    void lanIps().then((ips) => {
    console.log(`Шторм: http://localhost:${port}`);
    for (const ip of ips) console.log(`  у мережі: http://${ip}:${port}`);
    });
  });
}
