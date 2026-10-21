<div align="center">

# ⛵ Storm Fishers · Грозова рибалка

**A cozy 3D sailing & fishing game that runs right in your browser — alone or with friends.**

Take your little yacht out of a sleepy northern harbour, chase fish schools across open water,
explore islands, outrun Beaufort‑scale storms and come home with a hold full of catch.

### [▶ Play now — thealexpg.github.io/storm-fishers](https://thealexpg.github.io/storm-fishers/)

![Three.js](https://img.shields.io/badge/Three.js-r161-black?logo=three.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)
![Co-op](https://img.shields.io/badge/co--op-WebRTC%20P2P-2e8b57)
![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-yellow)
![No install](https://img.shields.io/badge/install-none%20%E2%80%94%20just%20a%20browser-e2674a)

<br>

<img src="docs/media/hero.jpg" alt="A yacht sailing past a pine island at sunset" width="100%">

</div>

---

## 📸 Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/media/harbour.jpg" alt="The harbour with the lighthouse, quay and NPC fishing boats"><br><sub><b>Port «Шторм»</b> — the lighthouse, the quay and the local fishing fleet</sub></td>
    <td width="50%"><img src="docs/media/storm.jpg" alt="Yacht in a storm with rain and big waves"><br><sub><b>Storm</b> — 10–11 Beaufort out in the open sea</sub></td>
  </tr>
  <tr>
    <td><img src="docs/media/sunset-harbour.jpg" alt="Sailing home at sunset"><br><sub><b>Golden hour</b> — heading home with the catch</sub></td>
    <td><img src="docs/media/night.jpg" alt="Night in the harbour with lit windows and the lighthouse beam"><br><sub><b>Night</b> — lighthouse beam, cabin lights, running lights</sub></td>
  </tr>
  <tr>
    <td><img src="docs/media/island-hat.jpg" alt="A glowing straw hat on a palm island beach"><br><sub><b>Islands</b> — go ashore and find hidden hats and treasure</sub></td>
    <td><img src="docs/media/cabin-radio.jpg" alt="The cabin radio showing a three-day forecast"><br><sub><b>Cabin radio «Шторм‑М1»</b> — 3‑day forecast, market, music</sub></td>
  </tr>
  <tr>
    <td><img src="docs/media/exchange.jpg" alt="The fish exchange window with price charts"><br><sub><b>Fish exchange</b> — price history, demand and your hold's value</sub></td>
    <td><img src="docs/media/chart-route.jpg" alt="Nautical chart with a multi-point route between islands"><br><sub><b>Nautical chart</b> — zoom, pan and plot a route between the islands</sub></td>
  </tr>
</table>

---

## ✨ Features

### 🌊 The sea
- **Living ocean** — Gerstner waves that grow from harbour ripples to 14‑metre swells offshore, refractive transparent water, foam, spray and rain.
- **Weather that matters** — wind and sea state on the Beaufort scale and a day/night cycle with sunsets, a lighthouse and running lights.
- **Long, readable days and weather cycles** — at the normal pace a day lasts 20 real minutes: 16–28 minutes of fair weather, a front that builds for 5–8 minutes, then a 10–16 minute storm that slowly eases. The radio warns you about 15 minutes before it hits, so there's time to reef and run for port. The **game pace** setting stretches or shortens it all (relaxed — 30‑minute days, lively — ~13).
- **Rough waters** — three dangerous regions (the Storm Belt, the Shell Reefs and the Open Ocean) have higher seas and turn every front into a real storm. One weather system covers the whole sea, so between storms they are calm enough to fish; you get a warning about 7–9 minutes ahead, and every harbour is a safe haven.
- **Wave slamming** — punch head‑on into big seas at full throttle and the hull takes damage; take them at an angle like a real sailor.

### ⛵ The yacht
- **Sailing physics** — keel, sails trimmed to the apparent wind, a sail wheel at the mast to set exactly how much canvas you carry (two reefs, full sail, gennaker) with a suggestion for the current wind, gybes, a motor for the harbour, fuel, rudder and throttle at a real wheel.
- **Walk the whole boat** — deck, cockpit and a cabin below with closable companionway doors (leave them open in a storm and water gets in!).
- **Light switches** — a brass toggle on the nav-station panel for the cabin lights and one on the cockpit bench for the deck: running lights (red, green, stern; masthead under engine, anchor light at anchor), deck lanterns and a spreader floodlight for night fishing. Each cycles **auto → on → off**; in co-op the crew sees and can flip them.
- **A cozy cabin** — settees with cushions, rugs, bookshelves, a ship in a bottle, a swinging oil lantern, and a clock and barometer that follow the game time and the weather.
- **Physical radio «Шторм‑М1»** — a real set with a screen and separate controls: power, five preset buttons, a tuning knob (with static between stations) and a volume knob. Aim at a control and click it, or turn it with the mouse wheel. Its screen shows a 3‑day forecast, market prices with sparklines, fish reports, a live music spectrum or typed‑out channel 16 chatter.
- **Chart table** — lean over a paper chart in the cabin, zoom it and plot your course with a pencil.
- **Upgrades you can see** — hull, sails, hold, rods, nets: every level physically changes the boat.
- **Helm instruments & autopilot** — from a brass compass and wind gauge to a teak-and-brass gauge console, depth sounder, GPS chartplotter, fish finder and radar; the **autopilot** is a separate module (needs the GPS chartplotter) that sails your route by itself.
- **Hands on the wheel** — waves (especially from astern), gusts and weather helm slowly push the bow off course, so you keep correcting: barely in a calm, every few seconds in a fresh breeze, constantly in a storm. A cheap **wind-vane self-steering** gear on the transom (no GPS needed) gently holds the course you set; the autopilot holds it tighter and follows the route.
- **Mooring & gangway** — step ashore and back aboard without climbing over the rails.

### 🎣 Fishing
- **Rod mini‑game** — power cast, strike on the bite, fight the fish with line tension and rod angle; rod holders for several rods at once.
- **Physical catch** — fish flop on deck, can be washed overboard, and are carried by hand to the fish box or the hold.
- **Commercial nets** (mid/end‑game) — set drift nets from the stern drum, mark them with buoys, come back hours later and haul the catch. Storms can tear them.
- **12 species everywhere plus local catch** — gilt-head bream, sea bass, squid and octopus only off the Azure Coast; Arctic char and king crab only off the Northern Reach — across shore, mid‑water and open‑sea zones.
- **Radio fishing reports** name today's schools by place — a couple off each continent, a few at home and one out in the ocean — nearest first, with distance and bearing; the chart and the minimap mark them too.
- **Fishing grounds** — four marked spots where the fish run 1.5–2.5× heavier and trophies are far more common. The richest ones lie deep inside the rough waters. They appear on the chart as sailors' rumours with a risk rating (⚠ to ⚠⚠⚠) until you find them.

### 🏝️ Islands & treasure
- **A sea worth crossing** — about 3.4 × 2.6 km of open water. The nearest harbour is under a kilometre from home, the farthest, the whaling station, about 2 km.
- **Five islands to explore** — a gull rock, a pine island with a ruined keeper's hut, a palm spit, a pirate cove and a shell island, each with its own props.
- **Go ashore** — bring the boat in close, press **E** and walk the beaches and hills; the yacht holds its position while you're away, and you can always get back aboard.
- **Hidden hats & treasure** — find an ushanka, a sou'wester, a straw hat, a pirate tricorn and a crown of shells (plus a bonus hat for discovering every island), message bottles and a pirate chest.
- **Wardrobe** — pick your hat in the pause menu; in co‑op your friends see it too.

### 🌍 Continents across the ocean
- **Two continents** 3–5 km away across open water, each with its own look, climate and harbours:
  - **The Azure Coast** — a Mediterranean shore in the spirit of Italy and Greece: white villages with blue domes and terracotta roofs, cypresses and olive groves, terraced hills, a wide turquoise shallow and calm warm sea. Harbours: **Porto Azzurro** and the Greek village **Agios Nikos**, plus three little coves — **Olive Cove**, **Cala del Sole** with a chapel on the rock and **Cala Luce** facing the lighthouse.
  - **The Northern Reach** — a cold coast like Maine or Alaska: dark fir forests, granite shores, snow on the peaks, red-and-white lighthouses, more fog and more frequent storms. Harbours: **Cedar Harbor** and the remote trading post **Grizzly Cove**, plus three little coves — the **Salmon Shack** on stilts, **Smokehouse Cove** and **Fjord Landing**. Every cove has a pier, fuel, a fish buyer and a cargo office for short coastal runs.
- Small islands off each coast (a cypress isle, a chapel rock, an olive island; a fir island, granite skerries, a seal islet) and **three lighthouse refuges** in the middle of the ocean to shelter from a front.
- **Places to find off every coast**, as many as around home:
  - **Azure Coast** — the temple ruins of **Poseidon's Cape**, the sea arch of **Sirens' Grotto**, the blue-and-white **Santa Luce Light** with the keeper's washing line, **Amphora Shoal** next to a **sunken galley**, the **Turquoise Lagoon**, **Squid Hollow**, **Sea Bass Strait** and far-out **Tuna Ridge** fishing grounds.
  - **Northern Reach** — an abandoned **whaling station** on the skerries, a **trapper's cabin**, a carved totem on **Raven Rock**, the **Granite Tooth Light**, a **sunken trawler**, the **Waterfall Fjord**, **Seal Cove**, **Crab Bank** and the stormy **Ice Deep** fishing grounds.
  - **Great Ocean** — the **Delta** weather buoy, **Broken Masts Reef** and the **Bird Cauldron**, where gulls dive over feeding tuna.
  - Four more hats (a laurel wreath, a straw boater, a trapper's coonskin cap and a horned helm), an amphora, message bottles and a whaler's chest.
- Mountains are visible from far out at sea as hazy silhouettes; every harbour has its own fish prices — northern fish fetches more on the Azure Coast and the other way round.
- **Cargo ships** ply between the continents (and politely steer around your yacht).

### 📦 Cargo runs
- Every harbour has a **cargo office** with waybills: wine, pottery, olives and lemons from the Azure Coast, furs, maple syrup and cedar boards from the North, tackle and mail from home — and **iced fish** from anywhere.
- Take an order and the crates appear on the pier — **carry them aboard by hand** (E) and set them on the **cockpit benches** (strapped down automatically) or, with a bigger hold, in the **forepeak**. Deliver to the destination's cargo office before the deadline.
- Pay grows with distance and the roughness of the route; **runs across the ocean pay the most**. Fragile goods crack when waves slam the boat, iced fish spoils on a slow trip, and late delivery pays half.
- **Settle on another continent** — buy a home base (a villa in Porto Azzurro or a log cabin in Cedar Harbor) to sleep, save and be towed to after a wreck.

### 🗺️ Navigation
- **Full‑screen nautical chart (M)** — zoom with the mouse wheel, drag to pan, plot **multi‑point routes**; the compass leads you to the next waypoint and advances automatically.
- **Minimap, compass tape, bearing & distance chips**, your sailed track and discovered landmarks.

### 🏪 The harbour economy
- **A real harbour, not one magic menu** — each service has its own place on the quay: the **fish exchange** (the only place that buys fish), the **chandlery** for gear and upgrades, the **fuel kiosk**, the **shipyard** for hull repairs and the **harbour office** for insurance.
- **Home harbour life** — the “Warm Crust” bakery by the lighthouse (hot pies and buns you eat on the spot for energy and buffs, a fresh window every day), festoon lights and bunting along the quay, benches facing the sea, Rusk the bakery cat to pet and old Ostap on his bench with sailor's lore.
- **Fisher's Nook** — a village on stilts: huts over the shallows linked by boardwalks, fish drying on racks, punts on the sand, villagers who chat when you walk up, and **Orysia's Bait** — worms, bloodworms or live bait for a few minutes of faster (or bigger) bites.
- **“World's End” Whaling Station** — a stern outpost before the open ocean: an empty slipway with its winch, try-pots on a stone hearth (now the cook's chowder pot), barrel stacks, a harpoon rack, peeling paint, a whale's ribcage half-buried on the beach and a pennant snapping on the mast; old harpooner Sava tells tales, the cooper drives hoops and Bear the husky trots the quay. Fog rolls in here more often. **The Last Store before the ocean** sells provisions for the long passage — ship's biscuits, tinned stew, hand salve and a ginger tonic (energy and buffs).
- **Porto Azzurro** — a Mediterranean town: a piazza with a fountain and a campanile, the “Da Nino” trattoria under a striped awning, a narrow vicolo with laundry overhead and a nonna on her balcony, bougainvillea, a terraced lemon grove, colourful gozzo boats bobbing at the quay, festoon lights, a mandolin player by the fountain — and **Gelateria “Stella”**, where a cone gives you a little energy and a buff.
- **Dawn Harbour** — a little town on a rocky cape: a winding stone stair up to the chapel whose bell rings at 7 am and 7 pm, a market square with a fountain, the “Daybreak” café under string lights, signal flags, townsfolk who chat when you walk up (and a ginger cat). Its **chartmaker** sells true charts of places you haven't found yet — fishing grounds, islands, wrecks — and can plot your course there.
- **Cedar Harbor** — a northern lumber town under snowy roofs: a sawmill with a water wheel on the creek, log piles and a red timber shed, stacks of lobster traps and buoys on the quay, loggers at work, a fisherwoman in a yellow slicker at the pier end, crows on the ridges and a moose grazing by the treeline. On the porch of **Earl's Maple General Store** the old man rocks in his chair — inside: hot cocoa, pancakes with syrup, maple taffy on snow and a logger's breakfast, each with its own buffs.
- **Agios Nikos** — a Greek fishing village: whitewashed cube houses with blue doors and shutters climbing the hill, a blue‑domed church with a bell tower, windmills turning on the ridge, bougainvillea, octopus drying on a line, colourful caïques by the quay, Socrates the donkey and a cat on the white steps, and villagers who chat when you walk up. At **Aunt Despina's Meze** on the vine‑covered terrace you eat Greek dishes on the spot — loukoumades, horiatiki, kalamarakia, moussaka, grilled octopus — for energy and buffs.
- **Grizzly Cove** — a remote trading post under the snow: a log stockade with a watchtower, husky kennels and a dog sled, fur hides on drying racks, an igloo ice house, a painted totem, a campfire with a cooking pot where old Granny Nuna smokes her pipe, snowy firs and drifts, and a brown bear fishing on the spit. On clear nights the **northern lights** ripple over the ridge. **Silas's Trapper's Store** sells cloudberry tea, pemmican, fur mittens and a bear-claw charm — each with its own buffs.
- **Fish exchange** — a scrolling price ticker, cards for every species with sparklines and trend arrows, a big 6‑day price chart on graph paper, demand bars (sell too much of one species and its price sinks, then slowly recovers), market events, and a hold panel with your catch's projected value.
- **Local fishing fleet** — five NPC boats («Ластівка», «Стара Марта», «Дельфін», «Чайка», «Бриз») leave port, fish the grounds and come back. When a storm is forecast they all run for the harbour. They steer around rocks, islands and you, sound their horns as they pass and chat on the radio.

- **Sunny Marina, the resort** — a beach of loungers under striped umbrellas, a guest pontoon with neighbours' yachts, string lights over the promenade and a café terrace with a quiet street guitarist, holiday-makers strolling with ice cream — and a **gelato & souvenir kiosk**: a scoop restores your energy, and two resort hats (a sun hat and a marina cap) are sold only here.

### 👥 Co‑op
- **Play with friends over the internet** — no server, no accounts: browsers connect peer‑to‑peer (WebRTC). Share a 4‑letter room code or an invite link.
- **A fleet, not just one boat** — everyone can come on their own yacht with their own progress, or join someone's crew. Four friends? Two boats, two sailors each.
- **Shared hold per boat** — the crew loads the catch together; whoever sells it gets the money.
- Text chat, coloured avatars, friends on the map.

### 🏠 Home
- **Your own cottage** by the home quay — walk right in through the open door: a bed with a checked quilt, a crackling iron stove, a table by the window, a trophy fish on the wall. Sleep in the bed to skip to morning (the game saves).
- **Captain's log** — a cork board on the wall with your earnings, distance sailed, catch and a chart of where you've been; press **E** to open the full log: income and spending by day (14-day chart, best day, where the money came from and went), voyages (distance, time at sea, farthest point, places and ports), your fish collection with record weights, trophies, finds and every yacht upgrade.

### 💾 Progress
- Autosave in the browser, plus **save export/import** to move your progress to another computer.

### 🌍 Languages
- **English** (default) and **Ukrainian** — switch with the EN | UA toggle on the title screen or in the pause menu, or open the game with `?lang=uk` / `?lang=en`. In co-op every player sees the game in their own language.

---

## 🎮 Controls

| Key | Action |
|---|---|
| **W A S D** | walk · throttle & rudder at the wheel |
| **Mouse** | look around |
| **Hold RMB** | binoculars ×2 — read the radio, scan the horizon |
| **E** | interact (wheel, sails, doors, shops, chart table, nets…) · go ashore / back aboard · pick up / set down a cargo crate |
| **E at the mast** | sail wheel — drop, reef 2 (40 %), reef 1 (70 %), full, gennaker · pick with the mouse or **1–5**, haul with **LMB** / **E** |
| **LMB** | cast / strike · place a route point on the chart |
| **Space** | reel in during a fight · jump |
| **A / D** | tilt the rod while fighting |
| **R** | reel in the line |
| **M** | nautical chart (wheel — zoom, drag — pan, click — add route point, RMB — remove) |
| **N** | minimap range: near · medium · far (the badge under it tells you if you're on a fishing ground or a school) |
| **Radio** | aim at a button or knob · **LMB** press · **RMB** back · **wheel** turn |
| **T** | autopilot on/off at the wheel (autopilot module) |
| **G** | wind-vane self-steering on/off at the wheel — holds the current course |
| **V** | stern chase camera / first person at the wheel |
| **P** · **H** | photo mode · hide the interface |
| **Enter** | co‑op chat |
| **Esc** | pause menu (settings, co‑op, boats, hats, save export) |
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
  world/   yacht, sails, cabin & radio, port, islands, continents, cargo crates, NPC boats & cargo ships, nets, avatars
  game/    state & saves, fish, fishing, market, cargo orders, upgrades, insurance
  net/     co-op session (relay / P2P) and fleet sync
  ui/      HUD, chart (map), minimap, dialogs, exchange
```

---

## 📜 License

Storm Fishers is source‑available under the [PolyForm Noncommercial License 1.0.0](LICENSE) (see also [NOTICE](NOTICE)) — you're welcome to play it, read the code, learn from it, fork it and mod it **for non‑commercial purposes**.

**Commercial use, selling the game or any part of it, or redistributing it as part of a paid product requires a separate written permission from the author**, Alex Bromson ([@TheAlexPG](https://github.com/TheAlexPG)). Copyright © 2026 Alex Bromson. All rights not expressly granted are reserved.

Contributions are welcome — by opening a pull request you agree that your contribution may be distributed under this license and under any separate commercial license granted by the author.

> Versions of this repository published before this change were released under the MIT License; that grant still applies to those earlier copies.

---

<div align="center">

Made with ☕ and sea spray · in English and Ukrainian 🇺🇦

</div>
