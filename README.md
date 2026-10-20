<div align="center">

# ⛵ Storm Fishers · Грозова рибалка

**A cozy 3D sailing & fishing game that runs right in your browser — alone or with friends.**

Take your little yacht out of a sleepy northern harbour, chase fish schools across open water,
outrun Beaufort‑scale storms and come home with a hold full of catch.

### [▶ Play now — thealexpg.github.io/storm-fishers](https://thealexpg.github.io/storm-fishers/)

![Three.js](https://img.shields.io/badge/Three.js-r161-black?logo=three.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)
![Co-op](https://img.shields.io/badge/co--op-WebRTC%20P2P-2e8b57)
![No install](https://img.shields.io/badge/install-none%20%E2%80%94%20just%20a%20browser-e2674a)

</div>

---

## ✨ Features

### 🌊 The sea
- **Living ocean** — Gerstner waves that grow from harbour ripples to 14‑metre swells offshore, refractive transparent water, foam, spray and rain.
- **Weather that matters** — wind and sea state on the Beaufort scale, storms that build up and roll in, a day/night cycle with sunsets, a lighthouse and running lights.
- **Wave slamming** — punch head‑on into big seas at full throttle and the hull takes damage; take them at an angle like a real sailor.

### ⛵ The yacht
- **Sailing physics** — keel, sails trimmed to the apparent wind, gybes, a motor for the harbour, fuel, rudder and throttle at a real wheel.
- **Walk the whole boat** — deck, cockpit and a cabin below with closable companionway doors (leave them open in a storm and water gets in!).
- **Chart table** — lean over a paper chart in the cabin, zoom it and plot your course with a pencil.
- **Upgrades you can see** — hull, sails, hold, rods, nets: every level physically changes the boat.
- **Mooring & gangway** — step ashore and back aboard without climbing over the rails.

### 🎣 Fishing
- **Rod mini‑game** — power cast, strike on the bite, fight the fish with line tension and rod angle; rod holders for several rods at once.
- **Physical catch** — fish flop on deck, can be washed overboard, and are carried by hand to the fish box or the hold.
- **Commercial nets** (mid/end‑game) — set drift nets from the stern drum, mark them with buoys, come back hours later and haul the catch. Storms can tear them.
- **12 species** across shore, mid‑water and open‑sea zones, with radio reports of where the schools are biting today.

### 🗺️ Navigation
- **Full‑screen nautical chart (M)** — zoom with the mouse wheel, drag to pan, plot **multi‑point routes**; the compass leads you to the next waypoint and advances automatically.
- **Minimap, compass tape, bearing & distance chips**, your sailed track and discovered landmarks.

### 🏪 The harbour economy
- **Fish exchange** with live prices, per‑species price charts, demand saturation (dump too much of one species and the price drops) and market events.
- **Separate places in port** — chandlery for gear and upgrades, fuel kiosk, shipyard for repairs, harbour office for insurance, and the fish exchange for selling.

### 👥 Co‑op
- **Play with friends over the internet** — no server, no accounts: browsers connect peer‑to‑peer (WebRTC). Share a 4‑letter room code or an invite link.
- **A fleet, not just one boat** — everyone can come on their own yacht with their own progress, or join someone's crew. Four friends? Two boats, two sailors each.
- **Shared hold per boat** — the crew loads the catch together; whoever sells it gets the money.
- Text chat, coloured avatars, friends on the map.

### 💾 Progress
- Autosave in the browser, plus **save export/import** to move your progress to another computer.

---

## 🎮 Controls

| Key | Action |
|---|---|
| **W A S D** | walk · throttle & rudder at the wheel |
| **Mouse** | look around |
| **E** | interact (wheel, sails, doors, shops, chart table, nets…) |
| **LMB** | cast / strike · place a route point on the chart |
| **Space** | reel in during a fight · jump |
| **A / D** | tilt the rod while fighting |
| **R** | reel in the line |
| **M** | nautical chart (wheel — zoom, drag — pan, click — add route point, RMB — remove) |
| **V** | stern chase camera / first person at the wheel |
| **P** · **H** | photo mode · hide the interface |
| **Enter** | co‑op chat |
| **Esc** | pause menu (settings, co‑op, boats, save export) |
| **F1** | show hints |

---

## 🚀 Run it locally

```bash
npm ci
npm run dev          # http://localhost:5173 (co-op relay on the same port at /net)
```

Production build: `npm run build` → `dist/`. `npm run serve` builds it and serves it together with the co‑op relay.

### How co‑op networking works
On static hosting (GitHub Pages) players connect **directly** via WebRTC using [PeerJS](https://peerjs.com/) —
the public broker only introduces browsers to each other; no game data passes through it.
When a local relay is available (`npm run dev` / `npm run serve` → `server/relay.mjs`) the game uses it instead.
Add `?p2p=1` to force direct connections, or `?room=CODE` to join a room from a link.

In a room the host keeps the world clock and weather; each boat owner simulates their own yacht and streams it to the crew and other players.

---

## 🛠 Tech

- **Three.js** (r161) with hand‑written GLSL for the ocean, no post‑processing stack.
- **TypeScript + Vite**; the only runtime dependencies are `three` and `peerjs`.
- Procedural sound and music via the Web Audio API.
- Everything — models, textures, the paper chart — is generated in code.

```
src/
  core/    ocean, weather, time, input, audio, music
  world/   yacht, sails, cabin, port, nets, avatars, chart table
  game/    state & saves, fish, fishing, market, upgrades, insurance
  net/     co-op session (relay / P2P) and fleet sync
  ui/      HUD, chart (map), minimap, dialogs, exchange
```

---

<div align="center">

Made with ☕ and sea spray · interface in Ukrainian 🇺🇦

</div>
