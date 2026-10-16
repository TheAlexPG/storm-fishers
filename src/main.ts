import * as THREE from 'three';
import { Input } from './core/input';
import { TimeCycle } from './core/time';
import { Weather } from './core/weather';
import { Ocean } from './core/ocean';
import { AudioEngine } from './core/audio';
import { clamp, rand } from './core/math';
import { GameState } from './game/state';
import { Boat, BOAT, MOOR, MOOR_HEADING } from './world/boat';
import { Port } from './world/port';
import { Player } from './world/player';
import { Sky } from './world/sky';
import { SkyEnvironment } from './world/graphics';
import { ParticlePool } from './world/particles';
import { Stations } from './game/stations';
import { Fishing } from './game/fishing';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { MapView } from './ui/map';
import { Dialogs } from './ui/dialogs';
import { zoneFromDist } from './game/fish';
import { LocalAdapter } from './net/adapter';
import './styles.css';

// ─────────────────────────────────────────────────────────────
// Головний цикл: світ, ігри, UI.
// ─────────────────────────────────────────────────────────────

type Phase = 'intro' | 'play' | 'paused' | 'dialog' | 'map';

class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private phase: Phase = 'intro';
  private expectUnlock = false;
  /** true на кадр після того, як діалог закрито через Esc — щоб той самий Esc не відкрив меню паузи */
  private escSwallow = false;
  private playTime = 0;
  private saveTimer = 0;
  /** час симуляції (лише рухається, поки світ працює) — фаза хвиль не «стрибає» після паузи */
  private simTime = 0;
  /** dt поточного кадру (для рендер-модулів) */
  private clockDelta = 0;

  // світ
  private ocean: Ocean;
  private sky: Sky;
  private port: Port;
  private boat: Boat;
  private player: Player;
  private particles: ParticlePool;
  private sunLight: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private moonLight: THREE.DirectionalLight;
  private skyEnv: SkyEnvironment;

  // ігри
  private game = new GameState();
  private time = new TimeCycle(8.0);
  private weather = new Weather();
  private stations: Stations;
  private fishing: Fishing;
  private audio = new AudioEngine();
  private net = new LocalAdapter();

  // UI
  private hud: Hud;
  private minimap: Minimap;
  private mapView: MapView;
  private dialogs: Dialogs;
  private underwater: HTMLElement;

  // стан
  private inPort = true;
  private outOfFuelWarned = false;
  private prevObjectives = { ...this.game.objectives };
  private camShake = new THREE.Vector3();
  private _tiltQ = new THREE.Quaternion();
  private _tiltEuler = new THREE.Euler();
  /** наскільки камера наслідує нахил човна (1 = повністю, 0 = повна стабілізація) */
  private tiltFollow = 0.5;
  private _v = new THREE.Vector3();
  private _v2 = new THREE.Vector3();

  constructor() {
    // рендер
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('app')!.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 4000);
    this.scene.fog = new THREE.FogExp2(0xbcd8e6, 0.0016);

    // світло
    this.sunLight = new THREE.DirectionalLight(0xfff2dd, 1.6);
    this.sunLight.castShadow = true;
    // тіні: тісніший фрустум навколо човна — чіткі тіні такелажу й рубки
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 34;
    sc.bottom = -34;
    this.sunLight.shadow.normalBias = 0.03;
    sc.near = 10;
    sc.far = 400;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.hemi = new THREE.HemisphereLight(0xbcd8e6, 0x0a3040, 0.55);
    this.scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight(0x8aa8d8, 0.0);
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    // відбиття неба на матеріалах (IBL)
    this.skyEnv = new SkyEnvironment(this.renderer, this.scene);
    // віньєтка (CSS-оверлей — без пост-обробки)
    const vig = document.createElement('div');
    vig.id = 'vignette';
    document.getElementById('app')!.appendChild(vig);

    // модулі
    this.ocean = new Ocean(this.scene);
    this.sky = new Sky(this.scene);
    this.port = new Port(this.scene);
    this.particles = new ParticlePool(this.scene, 1100);
    this.boat = new Boat(this.scene);
    this.player = new Player(this.game);
    this.stations = new Stations(this.boat, this.game, this.audio);
    this.fishing = new Fishing(this.scene, this.audio);

    this.hud = new Hud();
    this.minimap = new Minimap();
    this.mapView = new MapView();
    this.mapView.onWaypoint = (x, z) => {
      this.game.setWaypoint(x, z);
      this.mapView.show(this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, this.game);
      this.saveGame();
    };
    this.mapView.onClear = () => {
      this.game.clearWaypoint();
      this.mapView.show(this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, this.game);
      this.saveGame();
    };
    this.mapView.onClose = () => this.closeMap();
    this.dialogs = new Dialogs(this.audio);

    this.underwater = document.createElement('div');
    this.underwater.id = 'underwater';
    document.body.appendChild(this.underwater);

    // події
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement != null;
      if (locked) {
        this.expectUnlock = false; // локи вийшло — очікування знято
      } else if (!this.expectUnlock && this.phase === 'play') {
        this.openPause();
      }
    });
    this.renderer.domElement.addEventListener('click', () => {
      if (this.phase === 'play' && document.pointerLockElement == null) {
        this.requestLock();
      }
    });
    this.dialogs.onClose(() => {
      // повертаємось в гру
      this.expectUnlock = false;
      // проковтнути Esc, яким щойно закрили діалог, щоб не відкривалось меню паузи
      this.escSwallow = true;
      if (this.phase === 'dialog') {
        this.phase = 'play';
        this.requestLock();
      }
    });

    // колбACKи човна
    this.boat.onHullHit = (power) => {
      this.hud.toast(`Удар! Міцність −${Math.round(power * 6)}`, 'bad');
      this.audio.thump(power / 6);
    };
    this.boat.sails.onEvent = (msg, kind) => this.hud.toast(msg, kind, 4000);
    this.fishing.onEvent = (msg, kind) => this.hud.toast(msg, kind, 4500);
    this.boat.onEngineStall = () => {
      this.hud.toast('Хвиля заглушила двигун! Запусти його на двигунній (E)', 'bad');
      this.audio.snap();
    };
    this.boat.onSunk = () => this.handleSunk();

    // старт
    Input.instance.attach(this.renderer.domElement);
    this.showIntro();
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());

    // заставка
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('done');
      setTimeout(() => loading.remove(), 800);
    }
  }

  private requestLock() {
    try {
      const p = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {
        /* користувач клікне сам */
      });
    } catch {
      /* ок */
    }
  }

  private showIntro() {
    this.phase = 'intro';
    this.dialogs.intro(
      GameState.hasSave(),
      () => this.startNew(),
      () => this.continueGame(),
    );
  }

  private startNew() {
    GameState.clear();
    this.game = new GameState();
    this.player.attachGame(this.game);
    this.time = new TimeCycle(8.0);
    this.weather = new Weather();
    this.boat.reset(MOOR.x, MOOR.z, MOOR_HEADING);
    this.player.resetToBoat();
    this.stations.dispose();
    this.stations = new Stations(this.boat, this.game, this.audio);
    this.syncUpgrades();
    this.prevObjectives = { ...this.game.objectives };
    this.lastDay = this.time.dayCount;
    this.lastWeather = this.weather.state();
    this.phase = 'play';
    this.requestLock();
    this.hud.toast('Вітаємо на борту «Шторму»! Почни з порту: продавай, прокачуй, лови.', 'good', 6000);
    this.hud.toast('Порада: пальне дороге — у вітер іди під парусами (підніми їх фалом біля щогли). Двигун — для штилю й причалу.', 'warn', 9000);
  }

  private continueGame() {
    const data = GameState.load();
    if (!data) {
      this.startNew();
      return;
    }
    this.game.applySave(data);
    this.time = new TimeCycle(data.timeHours ?? 8.0);
    this.time.dayCount = data.dayCount ?? 1;
    this.weather.restore(data.weatherSeed ?? 10);
    // старі сейви: човен стояв на (0,-26) — під причалом; виносимо на шварт
    let bx = data.boatX ?? MOOR.x, bz = data.boatZ ?? MOOR.z, bh = data.boatHeading ?? MOOR_HEADING;
    const dock = this.port.platforms[0];
    if (bx > dock.x0 && bx < dock.x1 && bz > dock.z0 && bz < dock.z1) {
      bx = MOOR.x; bz = MOOR.z; bh = MOOR_HEADING;
    }
    this.boat.reset(bx, bz, bh);
    this.player.resetToBoat();
    this.stations.dispose();
    this.stations = new Stations(this.boat, this.game, this.audio);
    this.syncUpgrades();
    this.playTime = data.totalPlayTime ?? 0;
    this.prevObjectives = { ...this.game.objectives };
    this.lastDay = this.time.dayCount;
    this.lastWeather = this.weather.state();
    this.phase = 'play';
    this.requestLock();
    this.hud.toast('Завантажено. Знову в море!', 'good');
  }

  private syncUpgrades() {
    this.boat.applyUpgrades(this.game.upgrades, this.time.daylight);
  }

  private handleSunk() {
    const penalty = 300;
    this.game.money = Math.max(0, this.game.money - penalty);
    const hadStorm = this.game.hold.some((f) => f.storm);
    this.game.loseHoldFraction(0.3);
    this.boat.reset(MOOR.x, MOOR.z, MOOR_HEADING);
    this.player.resetToBoat();
    this.fishing.reelIn();
    this.game.hull = Math.max(20, this.game.maxHull * 0.5);
    this.hud.toast(`Затоплення! Рятувальний катер забрав тебе. Штраф ${penalty} ₴, втрачено 30% улову.`, 'bad', 6000);
    if (hadStorm) this.game.objectives.stormReturn = true;
  }

  private openPause() {
    this.phase = 'paused';
    this.saveGame();
    this.dialogs.pause({
      onResume: () => {
        this.phase = 'play';
        this.requestLock();
      },
      onReset: () => {
        GameState.clear();
        this.showIntro();
      },
      sound: !this.audio.muted,
      onToggleSound: () => this.audio.setMuted(!this.audio.muted),
      playTime: this.playTime,
    });
  }

  private openDialog(kind: 'shop' | 'radio') {
    this.phase = 'dialog';
    this.expectUnlock = true;
    document.exitPointerLock();
    this.saveTimer = 30;
    if (kind === 'shop') this.dialogs.shop(this.game);
    else this.dialogs.radio(this.game, this.weather, this.time);
  }

  // ── штурвальна карта (M) ──
  private openMap() {
    this.phase = 'map';
    this.expectUnlock = true; // вихід з lock не відкриває паузу
    this.mapView.show(this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, this.game);
    document.exitPointerLock();
  }

  private closeMap() {
    this.mapView.hide();
    this.phase = 'play';
    this.expectUnlock = false;
    this.requestLock();
  }

  private saveGame() {
    const data = this.game.buildSave();
    this.game.fillWorldSave(
      data,
      this.time.hours,
      this.time.dayCount,
      this.boat.pos.x,
      this.boat.pos.z,
      this.boat.heading,
      this.playTime,
      this.weather.intensity,
    );
    GameState.write(data);
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ── головний кадр ──

  private frame() {
    // єдиний getDelta за кадр (повторний виклик скинув би годинник і «забрав» dt)
    const dt = clamp(this.clock.getDelta(), 0, 0.05);
    this.clockDelta = dt;
    const input = Input.instance;
    input.beginFrame();

    const locked = document.pointerLockElement != null;
    // підказка «клікни, щоб захопити мишу», коли lock не діє (напр. браузер відмовив)
    this.hud.setLockHint(this.phase === 'play' && !locked && !this.dialogs.isOpen);
    const simRunning = this.phase === 'play' || this.phase === 'intro';

    if (simRunning) {
      this.simTime += dt;
      this.update(dt, this.simTime, input, locked);
    }

    // E — дія
    if (locked && input.pressed('KeyE') && this.phase === 'play' && !this.dialogs.isOpen) {
      this.doInteract();
    }
    // Esc — меню паузи / продовження / закрити карту (працює і без pointer lock)
    if (input.pressed('Escape')) {
      if (this.phase === 'map') {
        this.closeMap();
      } else if (!this.escSwallow) {
        if (this.phase === 'play' && !this.dialogs.isOpen) {
          this.openPause();
        } else if (this.phase === 'paused' && this.dialogs.isOpen) {
          this.dialogs.close();
          this.phase = 'play';
          this.requestLock();
        }
        // phase 'dialog' — діалог закриється своїм escHandler (магазин/радіо)
      }
    }
    this.escSwallow = false;
    // M — штурвальна карта (повноекранна)
    if (input.pressed('KeyM')) {
      if (this.phase === 'map') this.closeMap();
      else if (this.phase === 'play' && !this.dialogs.isOpen) this.openMap();
    }
    // Space у битві — обробляється в fishing через input.down

    this.render();
  }

  private update(dt: number, t: number, input: Input, locked: boolean) {
    const g = this.game;

    // час
    this.time.update(dt);
    if (this.time.dayCount !== this.lastDay) {
      this.lastDay = this.time.dayCount;
      g.rollPrices();
      g.rollReports();
      this.hud.toast(`Новий день. ${g.priceTrendText}.`, 'warn');
    }

    // погода
    this.weather.update(dt);
    if (this.weather.state() !== this.lastWeather) {
      const st = this.weather.state();
      if (st === 'storm') this.hud.toast('⛈ ШТОРМ! Хвилі ростуть. Дістанься порту або ризикуй!', 'bad', 5000);
      else if (st === 'calm' && this.lastWeather === 'storm') {
        g.stats.stormsSurvived++;
        this.hud.toast('Шторм минув. Ти справжній рибал.', 'good', 4500);
      }
      this.lastWeather = st;
    }
    // блискавка
    this.weather.onLightning = (p) => {
      this.sky.setFlash(p);
      this.audio.thunder(p);
    };

    // амб'єнс: вітер/дощ/набій хвиль (тихіше, коли гравець далеко від води; під дахом — у каюті чи кокпіті)
    // край води (причал) ≈ z=-18, хата ≈ z=-60
    const nearWater =
      (this.player.mode === 'port' ? clamp((this.player.wz + 60) / 42, 0.25, 1) : 1) *
      (this.player.sheltered ? 0.45 : 1);
    this.audio.setAmbience(this.weather.wind, this.weather.rain, clamp(this.weather.intensity, 0, 1), nearWater);

    // океан
    this.ocean.setConditions(this.weather.intensity, this.weather.windDir);
    this.ocean.setHull(this.boat.group, this.boat.vel.length());
    this.ocean.update(dt, t, this.camera.position, this.time.sunDir, this.time.skyHorizon, this.time.fogColor, this.fogDensity(), this.time.sunStrength, this.weather.flash);

    // паливо
    // повний газ — непропорційно дорожче: економний хід і паруси окупаються
    const fuelUse = Math.pow(Math.abs(this.boat.throttle), 1.4) * 0.07 * dt;
    if (fuelUse > 0) {
      if (g.spendFuel(fuelUse)) {
        if (g.fuel <= 0.01 && !this.outOfFuelWarned) {
          this.outOfFuelWarned = true;
          this.hud.toast('Паливо скінчилось! Повертайся в порт.', 'bad', 5000);
        }
      } else {
        g.fuel = 0;
        this.boat.throttle = 0;
      }
    }
    if (g.fuel > 5) this.outOfFuelWarned = false;

    // гравець
    if (locked && this.phase === 'play') {
      this.player.update(dt, input, this.boat, this.port, this.ocean, t);
    } else {
      // навіть без лока тримаємо голову на місці
      this.boat.localToWorld(this.player.localX, this.player.floorY + 1.62, this.player.localZ, this.player.head);
    }
    this.player.updateEnergy(dt);

    // човен
    this.boat.night = this.time.isNight;
    this.boat.update(dt, t, this.ocean, this.weather, g, this.particles, this.audio, this.port.rocks, this.port.platforms[0]);

    // станції
    // відійшов від щогли — робота з фалами переривається
    if (this.stations.active?.id === 'sails' && this.player.nearest?.id !== 'st:sails') {
      this.stations.stop();
      this.hud.toast('Відійшов від щогли — фал кинуто', 'warn', 2000);
    }
    this.stations.update(dt, this.time.hours);

    // ловля
    this.fishing.update(dt, t, this.boat, this.ocean, input, g, this.weather, this.time);
    const catched = this.fishing.takeCatch();
    if (catched) {
      const name = g.speciesName(catched.speciesId);
      if (g.addFish(catched)) {
        const fresh = catched.storm ? ' · штормова!' : '';
        this.hud.toast(`Улов: ${name}, ${catched.kg.toFixed(2)} кг${fresh}`, 'good');
        this.particles.sparkle(this.boat.localToWorld(0, BOAT.deckY + 1, 3.9, this._v).x, this.boat.localToWorld(0, BOAT.deckY + 1, 3.9, this._v).y, this.boat.localToWorld(0, BOAT.deckY + 1, 3.9, this._v).z);
      } else {
        // трюм повний — продаємо одразу
        const v = g.sellOne(catched.uid) || 0;
        this.hud.toast(`Трюм повний — ${name} продано за ${v} ₴`, 'warn');
      }
    }

    // свіжість
    g.decayFreshness(this.time.gameHourDelta(dt));

    // порт / поїздка
    const d = Math.hypot(this.boat.pos.x, this.boat.pos.z);
    const portNow = d < 40;
    if (portNow !== this.inPort) {
      this.inPort = portNow;
      if (!portNow) {
        g.stats.tripsOut++;
        this.hud.toast('У море! Пам\'ятай про паливо і погоду.', 'warn', 4000);
      } else {
        this.hud.toast('Порт «Шторм». Вбома на місці.', 'good', 3500);
        if (g.hold.some((f) => f.storm)) g.objectives.stormReturn = true;
      }
    }

    // цілі: тости про досягнення
    for (const k of Object.keys(g.objectives) as Array<keyof typeof g.objectives>) {
      if (g.objectives[k] && !this.prevObjectives[k]) {
        this.hud.toast(this.objectiveToast(k), 'good', 5000);
      }
    }
    this.prevObjectives = { ...g.objectives };

    // автозбереження
    this.saveTimer -= dt;
    if (this.saveTimer <= 0 && this.phase === 'play') {
      this.saveTimer = 30;
      this.saveGame();
    }

    this.playTime += dt;
  }

  private lastDay = 1;
  private lastWeather: string = 'calm';

  private objectiveToast(k: string): string {
    switch (k) {
      case 'firstSale': return '🏆 Ціль: перший продаж!';
      case 'allSpecies': return '🏆 Рибальський довідник: усі 12 видів!';
      case 'stormReturn': return '🏆 Штормовий улов доставлений у порт!';
      case 'maxUpgrades': return '🏆 Човен повної прокачки!';
      case 'rich': return '🏆 Капітан північного моря: 25 000 ₴!';
      default: return '🏆 Ціль виконано!';
    }
  }

  private doInteract() {
    const g = this.game;
    const p = this.player;

    // спочатку: клювання
    if (this.fishing.state === 'bite') {
      const rodW = this.boat.localToWorld(0, BOAT.deckY, 3.9, this._v);
      if (p.mode === 'boat') {
        const px = this.boat.localToWorld(p.localX, BOAT.deckY, p.localZ, this._v2);
        if (px.distanceTo(rodW) < 3.5) {
          this.fishing.hook(g, this.weather, this.time, this.boat);
          return;
        }
      }
    }

    const id = p.interact(this.boat, this.port, this.audio);
    if (!id) return; // climb — оброблено

    if (id === 'st:wheel') {
      p.wheeling = !p.wheeling;
      if (p.wheeling) this.hud.toast('Штурвал: W/S — газ, A/D — рильє, E — вийти. Прибори — на тумбі перед колесом.', 'warn', 3500);
      return;
    }
    if (id === 'st:rod') {
      if (this.fishing.state === 'idle') {
        if (p.mode !== 'boat') return;
        const ok = this.fishing.cast(this.boat, g, this.weather, this.time);
        if (!ok) {
          if (Math.hypot(this.boat.pos.x, this.boat.pos.z) < 60) this.hud.toast('Занадто близько до причалу — відійди в море.', 'warn');
          else this.hud.toast('Не вистачає енергії.', 'warn');
        }
      } else if (this.fishing.state === 'waiting') {
        this.fishing.reelIn();
      }
      return;
    }
    if (id === 'st:sails') {
      // фізична робота біля щогли: тягнути фал / риф-шкентель займає час і сили
      if (this.stations.active?.id === 'sails') return;
      const m = this.boat.sails.mode;
      const [label, dur, cost] = m === 0 ? ['Тягнемо фал — піднімаємо паруси…', 3.5, 4] as const
        : m === 2 ? ['Беремо риф…', 2.5, 2] as const
        : ['Травимо фал — спускаємо паруси…', 2.0, 1] as const;
      if (!g.spendEnergy(cost)) {
        this.hud.toast('Занадто втомлений, щоб тягнути фали', 'warn', 2500);
        return;
      }
      this.stations.startTimed('sails', label, dur, () => this.cycleSails());
      return;
    }
    if (id === 'st:radio') {
      this.openDialog('radio');
      return;
    }
    if (id === 'st:bed' || id === 'port:house') {
      this.doSleep(id === 'port:house');
      return;
    }
    if (id === 'port:shop' || id === 'port:fuel' || id === 'port:repair') {
      this.openDialog('shop');
      return;
    }
    // станції
    const st = id.replace('st:', '');
    const res = this.stations.tryStart(st);
    if (!res.ok && res.msg && res.msg !== '__sleep__') {
      this.hud.toast(res.msg, 'warn', 2500);
    }
  }

  private cycleSails() {
    const m = this.boat.sails.cycle();
    this.audio.click();
    const txt = m === 2 ? '⛵ Паруси підняті — повні' : m === 1 ? '⛵ Взято риф (≈60 % площі)' : '⛵ Паруси спущено';
    this.hud.toast(txt, m === 0 ? 'warn' : 'good', 2200);
  }

  private doSleep(inPort: boolean) {
    const delta = this.time.sleepToDawn();
    this.game.addEnergy(100);
    this.game.decayFreshness(delta);
    this.hud.toast(`Сон. Пройшло ${Math.round(delta)} год. ${inPort ? 'Безкоштовно в хаті.' : 'Виспався на койці.'}`, 'good', 3500);
    this.audio.click();
  }

  private fogDensity(): number {
    const base = 0.0016;
    const storm = this.weather.intensity * 0.0011;
    return base + storm;
  }

  private render() {
    const g = this.game;
    const time = this.time;
    const t = this.simTime;
    // у паузі/діалозі світ застигає
    const simDt = this.phase === 'play' || this.phase === 'intro' ? this.clockDelta : 0;

    // небо і світло
    this.sky.update(
      simDt,
      this.camera.position,
      time.sunDir,
      time.skyZenith,
      time.skyHorizon,
      time.daylight,
      this.weather.cloudiness,
      this.weather.rain,
      this.weather.windDir,
      time.hours,
      this.player.mode === 'boat' && this.player.level !== 'deck',
    );
    const sunI = time.sunStrength;
    const cloudFactor = 1 - this.weather.cloudiness * 0.55;
    this.sunLight.intensity = sunI * 1.7 * cloudFactor + this.weather.flash * 3.0;
    this.moonLight.intensity = (1 - time.daylight) * 0.22;
    const sunPos = this._v.copy(time.sunDir).multiplyScalar(140).add(this.boat.pos);
    this.sunLight.position.copy(sunPos);
    this.sunLight.target.position.copy(this.boat.pos);
    this._v2.set(-time.sunDir.x, Math.max(time.sunDir.y, 0.2), -time.sunDir.z).normalize().multiplyScalar(140).add(this.boat.pos);
    this.moonLight.position.copy(this._v2);
    this.moonLight.target.position.copy(this.boat.pos);
    // IBL уже дає розсіяне світло неба — півсфера слабша, ніж без нього
    this.hemi.intensity = (0.18 + time.daylight * 0.32) * (1 - this.weather.cloudiness * 0.3);
    this.skyEnv.update(simDt || 0.016, time.skyZenith, time.skyHorizon, time.sunDir, time.sunStrength * (1 - this.weather.cloudiness * 0.6));
    this.hemi.color.copy(time.skyHorizon);

    // порт
    this.port.setNight(1 - time.daylight);
    this.port.update(simDt, t);

    // каюта: тепле світло вночі та у шторм
    this.boat.setInteriorLight(time.daylight, this.weather.intensity);

    // апгрейди-світло
    this.boat.applyUpgrades(g.upgrades, time.daylight);

    // камера: first-person
    const head = this.player.head;
    // тряска: шторм + хвилі
    const shakeAmp = 0.008 + this.weather.intensity * 0.02;
    this.camShake.set(
      (Math.sin(t * 13.7) + Math.sin(t * 7.3)) * 0.5 * shakeAmp,
      (Math.sin(t * 11.1) + Math.sin(t * 5.9)) * 0.5 * shakeAmp,
      (Math.sin(t * 12.3)) * 0.5 * shakeAmp,
    );
    this.camera.position.set(head.x + this.camShake.x, head.y + this.camShake.y, head.z + this.camShake.z);
    this.camera.rotation.set(this.player.pitch + this.player.shakeX, this.player.yaw, this.player.shakeZ, 'YXZ');
    // нахил: позицію й курс ми наслідуємо човен повністю, а тангаж/крен — частково
    // (тіло стабілізує половину). Обертання у world-рамці (premultiply) —
    // коректно незалежно від того, куди гравець дивиться. Лише на палубі:
    // у воді тіло тримає рівновагу на хвилі, на причалі човен не наш.
    if (this.player.mode === 'boat') {
      this._tiltEuler.set(this.boat.pitch * this.tiltFollow, 0, this.boat.roll * this.tiltFollow);
      this.camera.quaternion.premultiply(this._tiltQ.setFromEuler(this._tiltEuler));
    }

    // підводне затемнення
    const inWater = this.player.mode === 'water' && head.y < this.ocean.heightAt(head.x, head.z, t) + 0.15;
    this.underwater.classList.toggle('show', inWater);

    // мінімапа
    this.minimap.update(this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, time.isNight);

    // HUD
    const prompt = this.currentPrompt();
    let fight: { name: string; tension: number; limit: number; dist: number } | null = null;
    if (this.fishing.state === 'fight') {
      const f = this.fishing.fightInfo;
      fight = {
        name: g.speciesName(f.speciesId) + ` · ${f.kg.toFixed(1)} кг`,
        tension: f.tension,
        limit: f.limit,
        dist: f.dist,
      };
    }
    this.hud.update(
      g,
      time,
      this.weather,
      this.boat.pos,
      {
        prompt: prompt.text,
        promptBite: prompt.bite,
        actionLabel: this.stations.active ? this.stations.active.label : null,
        actionProgress: this.stations.progress,
        fight,
        heading: this.boat.heading,
        speedKn: this.boat.vel.length() * 1.944,
        sail: this.player.mode === 'boat' || this.boat.sails.mode !== 0 ? this.boat.sails.hudText() : null,
      },
    );

    this.renderer.render(this.scene, this.camera);
  }

  private currentPrompt(): { text: string | null; bite: boolean } {
    // боротьба — перш за все
    if (this.fishing.state === 'fight') return { text: null, bite: false };
    if (this.fishing.state === 'bite') return { text: 'КЛЕВНЕННЯ! Натисни E!', bite: true };
    // станція-дія активна
    if (this.stations.active) return { text: this.stations.active.label, bite: false };
    // найближча ціль
    if (this.player.nearest) {
      const n = this.player.nearest;
      if (n.id === 'st:rod' && this.fishing.state === 'waiting') {
        return { text: 'Поплавок у воді… (E — зняти)', bite: false };
      }
      return { text: n.label, bite: false };
    }
    return { text: null, bite: false };
  }
}

// ── старт ──
const game = new Game();
// debug-хук для інструментів / headless-тестів
(window as unknown as Record<string, unknown>).__debug = {
  game,
  input: Input.instance,
};
