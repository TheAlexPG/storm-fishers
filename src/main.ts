import * as THREE from 'three';
import { Input } from './core/input';
import { TimeCycle } from './core/time';
import { Weather } from './core/weather';
import { Ocean } from './core/ocean';
import { AudioEngine } from './core/audio';
import { clamp, rand } from './core/math';
import { GameState } from './game/state';
import { Boat, BOAT, MOOR, MOOR_HEADING, STATION_POS } from './world/boat';
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
import { zoneFromDist, ZONE_NAMES } from './game/fish';

const ZONE_SUB: Record<string, string> = { shore: 'тихі води біля дому', mid: 'тут ходить скумбрія', open: 'далеко від берега' };
import { Coop, type BoatAction } from './net/coop';
import { CameraRig } from './world/cameraRig';
import { WindLines } from './world/windLines';
import { Avatar } from './world/avatar';
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
  private coop: Coop;

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
  private _fogGrey = new THREE.Color();
  private rig: CameraRig;
  private windLines: WindLines;
  /** «з-за корми» за штурвалом (V); запам'ятовується */
  private chasePref = true;
  private selfAvatar: Avatar | null = null;
  private selfColor = -1;
  /** скільки секунд миша не рухала камеру (для автодоводки за курсом) */
  private camIdle = 0;
  private lastYaw = 0;

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
    this.rig = new CameraRig(this.camera);
    try {
      this.chasePref = localStorage.getItem('storm-cam') !== 'fp';
    } catch {
      /* ок */
    }

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
    this.windLines = new WindLines(this.scene);
    this.boat = new Boat(this.scene);
    this.player = new Player(this.game);
    this.stations = new Stations(this.boat, this.game, this.audio);
    this.fishing = new Fishing(this.scene, this.audio);

    this.coop = new Coop(this.scene, {
      onAction: (nick, act) => this.onCoopAction(nick, act),
      onEvent: (e, v) => this.onCoopEvent(e, v),
      onChat: (nick, text, color) => this.hud.chatLine(nick, text, color),
      onPeer: (nick, joined) => {
        this.hud.toast(joined ? `👋 ${nick} на борту` : `${nick} — поза грою`, joined ? 'good' : 'warn', 3500);
        this.audio.click();
      },
      onClosed: (reason) => this.onCoopClosed(reason),
    });

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
      this.coop.sendEvent('hit', power);
    };
    this.boat.sails.onEvent = (msg, kind) => {
      this.hud.toast(msg, kind, 4000);
      this.coop.sendEvent('toast', [msg, kind]);
    };
    this.fishing.onEvent = (msg, kind) => this.hud.toast(msg, kind, 4500);
    this.boat.onEngineStall = () => {
      this.hud.toast('Хвиля заглушила двигун! Запусти його на двигунній (E)', 'bad');
      this.audio.snap();
      this.coop.sendEvent('stall');
    };
    this.boat.onSunk = () => this.handleSunk();

    // звук стартує з першого жесту (політика автоплею) — музика грає вже в заставці
    try {
      this.audio.setMusic(localStorage.getItem('storm-music') !== 'off');
    } catch {
      /* ок */
    }
    const wake = () => {
      this.audio.resume();
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);

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
    GameState.saveKey = GameState.SOLO_KEY;
    let nick = '';
    try {
      nick = localStorage.getItem('storm-nick') ?? '';
    } catch {
      /* приватний режим */
    }
    const code = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase().slice(0, 4);
    const remember = (n: string) => {
      try {
        localStorage.setItem('storm-nick', n);
      } catch {
        /* ок */
      }
    };
    this.dialogs.intro(
      GameState.hasSave(),
      () => this.startNew(),
      () => this.continueGame(),
      {
        nick,
        code,
        onHost: async (n) => {
          remember(n);
          await this.coop.start(n, null);
          if (GameState.hasSave()) this.continueGame();
          else this.startNew();
          this.hud.toast(`👥 Кімната ${this.coop.room} відкрита. Код і посилання — у меню (Esc).`, 'good', 9000);
        },
        onJoin: async (n, c) => {
          remember(n);
          await this.coop.start(n, c);
          this.startCrew();
        },
      },
    );
  }

  /** гість кооп-кімнати: свій гаманець/улов (окремий слот), човен і світ — капітана */
  private startCrew() {
    GameState.saveKey = GameState.COOP_KEY;
    const data = GameState.load();
    this.game = new GameState();
    if (data) this.game.applySave(data);
    this.player.attachGame(this.game);
    this.time = new TimeCycle(8.0);
    this.weather = new Weather();
    this.boat.reset(MOOR.x, MOOR.z, MOOR_HEADING);
    this.boat.sails.passive = true;
    this.player.resetToBoat();
    // поруч зі штурвалом стоїть капітан — гість з'являється біля трапа
    this.player.localZ = -1.2;
    this.stations.dispose();
    this.stations = new Stations(this.boat, this.game, this.audio);
    this.stations.onBoatAction = (a, v) => this.coop.sendAction(a === 'engine' ? { a: 'engine' } : { a: 'repair', v: v ?? 0 });
    this.dialogs.onBoatPurchase = (p) => {
      if (p.fuel) this.coop.sendAction({ a: 'fuel', v: p.fuel });
      if (p.repair) this.coop.sendAction({ a: 'hullFull' });
      if (p.upgrade) this.coop.sendAction({ a: 'upgrade', id: p.upgrade });
    };
    this.prevObjectives = { ...this.game.objectives };
    this.lastDay = this.time.dayCount;
    this.lastWeather = this.weather.state();
    this.phase = 'play';
    this.requestLock();
    this.hud.flashHints();
    const cap = this.coop.roster().find((p) => p.host)?.nick ?? 'капітан';
    this.hud.toast(`👥 Ти на борту «Шторму» в екіпажі ${cap}. Гроші й улов — твої, човен — спільний.`, 'good', 7000);
    this.hud.toast('Enter — чат з екіпажем', 'warn', 6000);
  }

  /** вихід з кооп-режиму гостя назад у соло */
  private endCrew() {
    this.boat.sails.passive = false;
    this.stations.onBoatAction = null;
    this.dialogs.onBoatPurchase = null;
    GameState.saveKey = GameState.SOLO_KEY;
  }

  private onCoopClosed(reason: string) {
    const wasCrew = GameState.saveKey === GameState.COOP_KEY;
    this.hud.toast(reason, 'bad', 6000);
    this.hud.setRoster([]);
    if (wasCrew) {
      this.saveGame();
      this.endCrew();
      this.dialogs.close();
      this.expectUnlock = true;
      document.exitPointerLock();
      this.showIntro();
    }
  }

  private leaveCoop() {
    const wasCrew = this.coop.isClient;
    if (wasCrew) this.saveGame();
    this.coop.leave();
    this.hud.setRoster([]);
    if (wasCrew) {
      this.endCrew();
      this.showIntro();
    } else {
      this.phase = 'play';
      this.requestLock();
      this.hud.toast('Кімнату закрито — граєш сам.', 'warn');
    }
  }

  /** капітан: дія гостя над спільним човном */
  private onCoopAction(nick: string, act: BoatAction) {
    const g = this.game;
    switch (act.a) {
      case 'sails': {
        const m = this.boat.sails.cycle();
        const txt = m === 2 ? 'паруси підняті' : m === 1 ? 'взято риф' : 'паруси спущено';
        this.hud.toast(`⛵ ${nick}: ${txt}`, 'good', 2200);
        break;
      }
      case 'engine':
        this.boat.restartEngine();
        this.hud.toast(`${nick}: двигун запущено`, 'good');
        break;
      case 'repair':
        g.repair(Math.min(25, Math.max(0, act.v)));
        this.hud.toast(`🔧 ${nick}: корпус підлатано`, 'good');
        break;
      case 'fuel':
        g.addFuel(Math.max(0, act.v));
        this.hud.toast(`⛽ ${nick}: +${Math.round(act.v)} л пального`, 'good');
        break;
      case 'hullFull':
        g.hull = g.maxHull;
        this.hud.toast(`🔧 ${nick}: ремонт корпусу оплачено`, 'good');
        break;
      case 'upgrade': {
        const id = act.id as keyof typeof g.upgrades;
        if (id in g.upgrades && g.upgrades[id] < 5) {
          g.upgrades[id]++;
          if (id === 'hull') g.hull = Math.min(g.maxHull, g.hull + 40);
          this.syncUpgrades();
          this.hud.toast(`🛠 ${nick}: нова прокачка човна`, 'good');
        }
        break;
      }
    }
  }

  /** гість: подія від капітана */
  private onCoopEvent(e: string, v: unknown) {
    switch (e) {
      case 'hit': {
        const power = Number(v) || 1;
        this.hud.toast(`Удар! Міцність −${Math.round(power * 6)}`, 'bad');
        this.audio.thump(power / 6);
        break;
      }
      case 'stall':
        this.hud.toast('Хвиля заглушила двигун! Запусти його на двигунній (E)', 'bad');
        this.audio.snap();
        break;
      case 'toast': {
        const [msg, kind] = v as [string, 'good' | 'bad' | 'warn'];
        this.hud.toast(String(msg), kind, 4000);
        break;
      }
      case 'bolt':
        this.sky.setFlash(Number(v) || 0.7);
        this.audio.thunder(Number(v) || 0.7);
        break;
      case 'sunk': {
        const g = this.game;
        g.money = Math.max(0, g.money - 150);
        g.loseHoldFraction(0.3);
        this.fishing.reelIn();
        this.player.resetToBoat();
        this.player.localZ = -1.2;
        this.hud.toast('Затоплення! Рятувальний катер забрав екіпаж. Штраф 150 ₴, втрачено 30% улову.', 'bad', 6000);
        break;
      }
      case 'sleep':
        this.hud.toast('Капітан спить — ніч минула.', 'warn', 3500);
        break;
    }
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
    this.hud.flashHints();
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
    this.hud.flashHints();
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
    this.coop.sendEvent('sunk');
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
      music: this.audio.musicOn,
      onToggleMusic: () => {
        this.audio.setMusic(!this.audio.musicOn);
        try {
          localStorage.setItem('storm-music', this.audio.musicOn ? 'on' : 'off');
        } catch {
          /* ок */
        }
      },
      playTime: this.playTime,
      coop: this.coop.active
        ? {
            room: this.coop.room,
            link: this.coop.inviteLink(),
            host: this.coop.isHost,
            players: this.coop.roster(),
            onLeave: () => this.leaveCoop(),
          }
        : undefined,
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
    // у коопі світ не зупиняється, поки хтось у меню чи магазині
    const simRunning = this.phase === 'play' || this.phase === 'intro' || this.coop.active;

    if (simRunning) {
      this.simTime += dt;
      // гість: час хвиль — як у капітана (знімок човна рахувався саме на цих хвилях)
      const ct = this.coop.clientApply(this.boat, this.weather, this.time, this.game);
      if (ct != null) this.simTime = ct;
      this.update(dt, this.simTime, input, locked);
    }
    // чат (Enter)
    if (this.coop.active && this.phase === 'play' && input.pressed('Enter') && !this.dialogs.isOpen) {
      this.hud.openChat((text: string) => this.coop.sendChat(text));
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
    this.audio.updateMusic({
      night: 1 - this.time.daylight,
      storm: clamp((this.weather.intensity - 0.45) / 0.5, 0, 1),
      intro: this.phase === 'intro',
    });
    // M — штурвальна карта (повноекранна)
    if (input.pressed('KeyM')) {
      if (this.phase === 'map') this.closeMap();
      else if (this.phase === 'play' && !this.dialogs.isOpen) this.openMap();
    }
    // V — вид з-за корми / від першої особи (за штурвалом)
    if (input.pressed('KeyV') && this.phase === 'play' && !this.dialogs.isOpen) {
      this.chasePref = !this.chasePref;
      try {
        localStorage.setItem('storm-cam', this.chasePref ? 'chase' : 'fp');
      } catch {
        /* ок */
      }
      if (!this.player.wheeling) this.hud.toast(this.chasePref ? 'Вид з-за корми — коли стоїш за штурвалом' : 'Вид від першої особи', 'warn', 2200);
    }
    // H — сховати / показати інтерфейс (фото, кіно)
    if (input.pressed('KeyH') && this.phase === 'play' && !this.dialogs.isOpen) this.hud.setHidden(!this.hud.hidden);
    const wheelSteps = input.consumeWheel();
    if (wheelSteps && this.rig.mode === 'chase') this.rig.zoom(wheelSteps);
    this.updateCamMode(locked);
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
    if (this.coop.isClient) this.weather.updatePassive(dt);
    else this.weather.update(dt);
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
      this.coop.sendEvent('bolt', p);
    };

    // амб'єнс: вітер/дощ/набій хвиль (тихіше, коли гравець далеко від води; під дахом — у каюті чи кокпіті)
    // край води (причал) ≈ z=-18, хата ≈ z=-60
    const nearWater =
      (this.player.mode === 'port' ? clamp((this.player.wz + 60) / 42, 0.25, 1) : 1) *
      (this.player.sheltered ? 0.45 : 1);
    this.audio.setAmbience(this.weather.wind, this.weather.rain, clamp(this.weather.intensity, 0, 1), nearWater);
    {
      const sails = this.boat.sails;
      const rock = Math.hypot(this.boat.roll - this.prevRoll, this.boat.pitch - this.prevPitch) / Math.max(dt, 1e-3);
      this.prevRoll = this.boat.roll;
      this.prevPitch = this.boat.pitch;
      const portD = Math.hypot(this.boat.pos.x, this.boat.pos.z);
      this.audio.updateSea(dt, {
        hoist: sails.hoist,
        luffing: sails.luffing,
        aws: sails.aws,
        rock: this.player.mode === 'boat' ? rock : 0,
        speed: this.player.mode === 'boat' ? this.boat.vel.length() : 99,
        gulls: this.time.daylight > 0.5 && this.weather.rain < 0.2 ? clamp(1 - portD / 350, 0.15, 0.9) : 0,
        sheltered: this.player.sheltered,
      });
    }

    // океан
    this.ocean.setConditions(this.weather.intensity, this.weather.windDir);
    this.ocean.update(dt, t, this.camera.position, this.time.sunDir, this.time.skyHorizon, (this.scene.fog as THREE.FogExp2).color, this.fogDensity(), this.time.sunStrength, this.weather.flash);

    // паливо
    // повний газ — непропорційно дорожче: економний хід і паруси окупаються
    const fuelUse = this.coop.isClient ? 0 : Math.pow(Math.abs(this.boat.throttle), 1.4) * 0.07 * dt;
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
      const crewHelm = this.coop.isClient && this.player.wheeling;
      if (crewHelm) {
        // свій газ/кермо (знімок капітана ще не встиг їх побачити)
        this.boat.throttle = this.coop.myHelm[0];
        this.boat.rudder = this.coop.myHelm[1];
      }
      this.player.update(dt, input, this.boat, this.port, this.ocean, t);
      if (crewHelm) this.coop.myHelm = [this.boat.throttle, this.boat.rudder];
    } else {
      // навіть без лока тримаємо голову на місці
      this.boat.localToWorld(this.player.localX, this.player.floorY + 1.62, this.player.localZ, this.player.head);
    }
    this.player.updateEnergy(dt);

    // човен
    this.boat.night = this.time.isNight;
    if (this.coop.isClient) {
      if (this.player.wheeling) {
        this.boat.throttle = this.coop.myHelm[0];
        this.boat.rudder = this.coop.myHelm[1];
      }
      this.boat.updateRemote(dt, t, this.ocean, this.weather, g, this.particles, this.audio);
    } else {
      this.coop.hostApply(dt, this.boat, this.player);
      this.boat.update(dt, t, this.ocean, this.weather, g, this.particles, this.audio, this.port.rocks, this.port.platforms[0]);
    }
    // камера й маска води в корпусі — від пози човна саме цього кадру
    this.player.syncHead(this.boat);
    this.ocean.setHull(this.boat.group, this.boat.vel.length());

    // станції
    // відійшов від щогли — робота з фалами переривається
    if (this.stations.active?.id === 'sails' && this.player.nearest?.id !== 'st:sails') {
      this.stations.stop();
      this.hud.toast('Відійшов від щогли — фал кинуто', 'warn', 2000);
    }
    this.stations.update(dt, this.time.hours);

    // кооп: знімок світу (капітан), свій гравець і аватари екіпажу
    this.coop.hostSend(dt, t, this.boat, this.weather, this.time, g);
    this.coop.tick(dt, this.boat, this.player, this.stations.active?.id === 'pump', this.fishing, this.ocean, t);

    // ловля
    this.fishing.update(dt, t, this.boat, this.ocean, input, g, this.weather, this.time);
    const catched = this.fishing.takeCatch();
    if (catched) {
      const name = g.speciesName(catched.speciesId);
      const isNew = !g.discovered.includes(catched.speciesId);
      if (g.addFish(catched)) {
        this.hud.catchCard(name, catched.kg, catched.speciesId, isNew, catched.storm ? 'штормова' : '');
        const rw = this.boat.localToWorld(0, BOAT.deckY + 1, 3.9, this._v);
        this.particles.sparkle(rw.x, rw.y, rw.z);
      } else {
        // трюм повний — продаємо одразу
        const v = g.sellOne(catched.uid) || 0;
        this.hud.catchCard(name, catched.kg, catched.speciesId, isNew, `трюм повний — продано за ${v} ₴`);
      }
    }

    // свіжість
    g.decayFreshness(this.time.gameHourDelta(dt));

    // кранці — лише біля причалу
    this.boat.setFenders(Math.hypot(this.boat.pos.x - MOOR.x, this.boat.pos.z - MOOR.z) < 30);

    // порт / поїздка
    const d = Math.hypot(this.boat.pos.x, this.boat.pos.z);
    const portNow = d < 40;
    if (portNow !== this.inPort) {
      this.inPort = portNow;
      if (!portNow) {
        g.stats.tripsOut++;
        this.hud.toast('У море! Пам\'ятай про паливо і погоду.', 'warn', 4000);
      } else {
        this.hud.titleCard('Порт «Шторм»', 'вдома');
        if (g.hold.some((f) => f.storm)) g.objectives.stormReturn = true;
      }
    }

    // нова зона моря — великий напис, як назви місць у дорожніх іграх
    const zone = zoneFromDist(d);
    if (zone !== this.lastZone) {
      if (this.lastZone && this.phase === 'play') this.hud.titleCard(ZONE_NAMES[zone], ZONE_SUB[zone]);
      this.lastZone = zone;
    }
    // світанок — новий день
    const h = this.time.hours;
    if (this.lastHours < 6 && h >= 6 && h < 7) this.dawnCard();
    this.lastHours = h;

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
  private prevRoll = 0;
  private prevPitch = 0;
  private lastZone: string | null = null;
  private lastHours = 8;

  private dawnCard() {
    this.hud.titleCard(`День ${this.time.dayCount}`, 'світанок');
  }
  private mapRefreshT = 0;
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
      if (!p.wheeling && this.coop.active) {
        const by = this.coop.wheelTakenBy();
        if (by) {
          this.hud.toast(`Штурвал тримає ${by}`, 'warn', 2500);
          return;
        }
        this.coop.myHelm = [this.boat.throttle, this.boat.rudder];
      }
      p.wheeling = !p.wheeling;
      if (p.wheeling) this.hud.toast('Штурвал: W/S — газ, A/D — кермо, E — вийти. Прибори — на тумбі перед колесом.', 'warn', 3500);
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
    if (this.coop.isClient) this.coop.sendAction({ a: 'sails' });
    const m = this.boat.sails.cycle();
    this.audio.click();
    const txt = m === 2 ? '⛵ Паруси підняті — повні' : m === 1 ? '⛵ Взято риф (≈60 % площі)' : '⛵ Паруси спущено';
    this.hud.toast(txt, m === 0 ? 'warn' : 'good', 2200);
  }

  private doSleep(inPort: boolean) {
    if (this.coop.isClient) {
      // час світу веде капітан — гість лише відпочиває
      this.game.addEnergy(60);
      this.hud.toast('Подрімав годинку. Сили відновлено.', 'good', 3000);
      this.audio.click();
      return;
    }
    this.coop.sendEvent('sleep');
    const delta = this.time.sleepToDawn();
    this.lastHours = this.time.hours;
    this.dawnCard();
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
    // туман — у колір обрію (у шторм сіріє); раніше лишався денним і вночі
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(time.fogColor).lerp(this._fogGrey.setRGB(0.3, 0.33, 0.38).multiplyScalar(0.35 + 0.65 * time.daylight), this.weather.cloudiness * 0.8);
    fog.density = this.fogDensity();

    // порт
    this.port.setNight(1 - time.daylight);
    this.port.update(simDt, t);

    // каюта: тепле світло вночі та у шторм
    this.boat.setInteriorLight(time.daylight, this.weather.intensity);

    // апгрейди-світло
    this.boat.applyUpgrades(g.upgrades, time.daylight);

    // камера: від першої особи / з-за корми (V за штурвалом) / обліт у заставці
    const head = this.player.head;
    const chase = this.rig.mode !== 'fp';
    // тряска: шторм + хвилі
    const shakeAmp = 0.008 + this.weather.intensity * 0.02;
    this.camShake.set(
      (Math.sin(t * 13.7) + Math.sin(t * 7.3)) * 0.5 * shakeAmp,
      (Math.sin(t * 11.1) + Math.sin(t * 5.9)) * 0.5 * shakeAmp,
      (Math.sin(t * 12.3)) * 0.5 * shakeAmp,
    );
    // нахил: позицію й курс ми наслідуємо човен повністю, а тангаж/крен — частково
    // (тіло стабілізує половину). Обертання у world-рамці (premultiply) —
    // коректно незалежно від того, куди гравець дивиться. Лише на палубі:
    // у воді тіло тримає рівновагу на хвилі, на причалі човен не наш.
    let tilt: THREE.Quaternion | null = null;
    if (this.player.mode === 'boat') {
      this._tiltEuler.set(this.boat.pitch * this.tiltFollow, 0, this.boat.roll * this.tiltFollow);
      tilt = this._tiltQ.setFromEuler(this._tiltEuler);
    }
    this.rig.update(this.clockDelta, {
      head,
      yaw: this.player.yaw,
      pitch: this.player.pitch + this.player.shakeX,
      roll: this.player.shakeZ,
      fpTilt: tilt,
      shake: this.camShake,
      boatPos: this.boat.pos,
      waterAt: (x, z) => this.ocean.heightAt(x, z, t),
      t,
      orbitYaw: this.introYaw(),
    });
    // вітрові завитки (не в каюті)
    if (simDt > 0) {
      const indoor = this.rig.mode === 'fp' && this.player.mode === 'boat' && this.player.level !== 'deck';
      this.windLines.update(simDt, t, this.camera.position, this.weather.windDir, this.weather.wind, time.daylight, (x, z) => this.ocean.heightAt(x, z, t), indoor);
    }
    // свій рибалка за штурвалом — видно лише збоку
    this.updateSelfAvatar(chase);

    // підводне затемнення
    const inWater = !chase && this.player.mode === 'water' && head.y < this.ocean.heightAt(head.x, head.z, t) + 0.15;
    this.underwater.classList.toggle('show', inWater);

    // мінімапа
    const friends = this.coop.active ? this.coop.friendMarkers() : [];
    this.minimap.friends = friends;
    this.mapView.friends = friends;
    this.minimap.update(this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, time.isNight);
    // відкрита мапа в коопі — друзі й човен рухаються (~4 рази/с)
    if (this.phase === 'map' && this.coop.active) {
      this.mapRefreshT -= this.clockDelta;
      if (this.mapRefreshT <= 0) {
        this.mapRefreshT = 0.25;
        this.mapView.refresh(this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, g);
      }
    }

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
    this.hud.setRoster(this.coop.active ? this.coop.roster() : []);
    this.hud.setNight(time.daylight < 0.3);
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

  /** заставка: камера з боку моря — від причалу через яхту, трохи в бік носа */
  private introYaw(): number {
    const d = this.port.platforms[0];
    const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
    const bx = this.boat.pos.x, bz = this.boat.pos.z;
    // найближча точка причалу до човна
    const px = clamp(bx, d.x0, d.x1), pz = clamp(bz, d.z0, d.z1);
    const ax = bx - px || bx - cx, az = bz - pz || bz - cz;
    return Math.atan2(ax, az);
  }

  /** який вигляд зараз: заставка — обліт, штурвал — з-за корми (якщо обрано) */
  private updateCamMode(locked: boolean) {
    const dt = this.clockDelta;
    let m: 'fp' | 'chase' | 'orbit' = 'fp';
    if (this.phase === 'intro') m = 'orbit';
    else if (this.player.mode === 'boat' && this.player.wheeling && this.chasePref) m = 'chase';
    else if (this.rig.mode === 'chase' && this.phase !== 'play') m = 'chase'; // меню поверх — не стрибаємо
    if (m === 'chase' && this.rig.mode !== 'chase') {
      // кут — з-за корми, трохи згори
      this.player.yaw = this.boat.heading + Math.PI;
      this.player.pitch = 0;
    }
    if (m === 'fp' && this.rig.mode === 'chase') {
      // назад у голову — дивимось уперед по курсу
      this.player.yaw = this.boat.heading + Math.PI;
      this.player.pitch = -0.05;
    }
    this.rig.setMode(m);
    // автодоводка: миша спокійна — камера сама заходить за корму
    if (m === 'chase' && locked && this.phase === 'play') {
      if (Math.abs(this.player.yaw - this.lastYaw) > 1e-4) this.camIdle = 0;
      else this.camIdle += dt;
      if (this.camIdle > 1.6 && this.boat.vel.length() > 0.4) {
        const want = this.boat.heading + Math.PI;
        const d = Math.atan2(Math.sin(want - this.player.yaw), Math.cos(want - this.player.yaw));
        this.player.yaw += d * (1 - Math.exp(-0.8 * dt));
      }
      this.lastYaw = this.player.yaw;
    }
  }

  /** свій рибалка: видно лише з-за корми / в заставці */
  private updateSelfAvatar(show: boolean) {
    const p = this.player;
    if (!show || p.mode !== 'boat') {
      this.selfAvatar?.hide();
      return;
    }
    const color = this.coop.active ? this.coop.myColor : 0xf2c12e;
    if (!this.selfAvatar || this.selfColor !== color) {
      this.selfAvatar?.dispose(this.scene);
      this.selfAvatar = new Avatar(this.scene, '', color);
      this.selfAvatar.showLabel(false);
      this.selfColor = color;
    }
    // у заставці — капітан за штурвалом
    const atWheel = p.wheeling || this.phase === 'intro';
    const w = STATION_POS.wheel;
    this.selfAvatar.state = {
      m: 0,
      x: atWheel ? w.x : p.localX,
      y: atWheel ? BOAT.deckY : p.floorY,
      z: atWheel ? w.z : p.localZ,
      yaw: atWheel ? this.boat.heading + Math.PI : p.yaw,
      pitch: 0,
      wh: atWheel ? 1 : 0,
      mv: p.moving ? 1 : 0,
    };
    this.selfAvatar.update(this.clockDelta, this.boat, this.ocean, this.simTime);
  }

  private currentPrompt(): { text: string | null; bite: boolean } {
    // боротьба — перш за все
    if (this.fishing.state === 'fight') return { text: null, bite: false };
    if (this.fishing.state === 'bite') return { text: 'Клює! Тисни E!', bite: true };
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
