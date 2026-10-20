import * as THREE from 'three';
import { Input } from './core/input';
import { TimeCycle } from './core/time';
import { offshore, seaFactor, Weather } from './core/weather';
import { Ocean, UNDERWATER_LAYER } from './core/ocean';
import { AudioEngine } from './core/audio';
import { clamp, rand, formatMoney } from './core/math';
import type { UpgradeId } from './core/types';
import { UPGRADE_BY_ID, MAX_LEVEL, upgradeCost, upgradeLock } from './game/upgrades';
import { GameState } from './game/state';
import { Boat, BOAT, MOOR, MOOR_HEADING, STATION_POS } from './world/boat';
import { moorSlotX, MOOR_SLOTS } from './net/coop';
import { Port } from './world/port';
import { terrainHeight } from './world/portTerrain';
import { Player } from './world/player';
import { Sky } from './world/sky';
import { SkyEnvironment } from './world/graphics';
import { ParticlePool } from './world/particles';
import { Stations } from './game/stations';
import { Fishing } from './game/fishing';
import { Hud, type FightHud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { MapView } from './ui/map';
import { Dialogs } from './ui/dialogs';
import { zoneFromDist, ZONE_NAMES } from './game/fish';

/** м'яке навчання: крок → підказка; умова виконання — у Game.updateTutorial */
const TUTORIAL = [
  'Підійди до штурвала на кормі й натисни E',
  'Виведи яхту з гавані: W — газ, A/D — кермо',
  'Підніми паруси: біля щогли натисни E. Найкраще йти, коли вітер збоку',
  'Візьми вудку з носової стійки (E). Тримай ЛКМ і відпусти в зеленій зоні — закид',
  'Чекай, поки поплавок піде під воду, — клікни ЛКМ. Тягни Space у зеленій зоні, A/D — проти ривка. Рибу з палуби неси в трюм на баку',
  'Повертайся в порт і продай улов у магазині',
];

const ZONE_SUB: Record<string, string> = { shore: 'тихі води біля дому', mid: 'тут ходить скумбрія', open: 'далеко від берега' };
import { Coop, type BoatAction } from './net/coop';
import { CameraRig } from './world/cameraRig';
import { loadSettings, saveSettings, type Settings } from './game/settings';
import { WindLines } from './world/windLines';
import { FoamTrail } from './world/foamTrail';
import { FishJump } from './world/fishJump';
import { DeckFish } from './world/deckFish';
import { RadioSet, RADIO_CHANNELS } from './world/radioSet';
import { CabinDoor } from './world/cabinDoor';
import { ChartTable, CHART_CENTER } from './world/chartTable';
import { Nets, type NetsNet } from './world/nets';
import { Bots } from './world/bots';
import { ShopCounter, type CounterTarget } from './world/shopCounter';
import { describeSave } from './game/saveTransfer';
import { Highlighter } from './world/highlight';
import { HOLDER_MOUNTS } from './world/upgradeParts';
import { DECK_Y as Y_DECK, HOUSE as L_HOUSE, RIG as L_RIG, SOLE_Y as Y_SOLE } from './world/yachtLayout';
import { HELM_DZ } from './world/yachtModel';
import { PLANS, applySinkToUpgrades, dailyPremium, type SinkReport } from './game/insurance';
import { Landmarks, LANDMARKS } from './world/landmarks';
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
  /** поштовх від удару хвилі (згасає) */
  private slamShake = 0;
  private slamTipT = 0;
  private _tiltQ = new THREE.Quaternion();
  private _tiltEuler = new THREE.Euler();
  /** наскільки камера наслідує нахил човна (1 = повністю, 0 = повна стабілізація) */
  private tiltFollow = 0.5;
  private _v = new THREE.Vector3();
  private _v2 = new THREE.Vector3();
  private _v3 = new THREE.Vector3();
  private _v4 = new THREE.Vector3();
  private hatchWarnT = 0;
  private _qHand = new THREE.Quaternion();
  private _eHand = new THREE.Euler();
  private reflHorizon = new THREE.Color();
  private reflZenith = new THREE.Color();
  private _reflGrey = new THREE.Color();
  private _fogGrey = new THREE.Color();
  private fogRaw = new THREE.Color(0xbcd8e6);
  private rig: CameraRig;
  private settings: Settings = loadSettings();
  private windLines: WindLines;
  private foamTrail: FoamTrail;
  private fishJump: FishJump;
  /** стрибок риби під час боротьби */
  private leapJump: FishJump;
  private deckFish: DeckFish;
  private radio!: RadioSet;
  private shopCounter!: ShopCounter;
  private cabinDoor!: CabinDoor;
  private chart!: ChartTable;
  /** сітки (апгрейд «Сітки»): буї в морі, постановка/вибирання з корми */
  private nets!: Nets;
  /** місцеві рибалки на човнах (боти) */
  private bots!: Bots;
  private stormWarned = false;
  private netsSyncT = 0;
  private netsSyncKey = '';
  private netsSyncMode = 'idle';
  /** гравець схилився над штурманським столом */
  private chartMode = false;
  private chartK = 0;
  private _chEye = new THREE.Vector3();
  private _chAt = new THREE.Vector3();
  private _chUp = new THREE.Vector3();
  private _chQ = new THREE.Quaternion();
  private _chM = new THREE.Matrix4();
  private doorWarnT = 0;
  private radioTextT = 0;
  private hl = new Highlighter();
  private _hv = new THREE.Vector3();
  private landmarks: Landmarks;
  private bellCd = 0;
  /** «з-за корми» за штурвалом (V); запам'ятовується */
  private chasePref = true;
  private selfAvatar: Avatar | null = null;
  private selfColor = -1;
  /** скільки секунд миша не рухала камеру (для автодоводки за курсом) */
  private camIdle = 0;
  /** фото-режим (P): вільна камера довкола яхти, без інтерфейсу */
  private photo = false;
  private photoYaw = 0;
  private photoPitch = -0.2;
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
    this.shopCounter = new ShopCounter(this.scene, this.port.solids);
    // прибій уздовж берега бухти
    this.ocean.setShore(terrainHeight, -520, -780, 1040, 860, 2);
    this.particles = new ParticlePool(this.scene, 1100);
    this.windLines = new WindLines(this.scene);
    this.foamTrail = new FoamTrail(this.scene);
    this.fishJump = new FishJump(this.scene);
    this.leapJump = new FishJump(this.scene);
    this.scene.add(this.moorMark);
    this.landmarks = new Landmarks(this.scene, this.port.rocks);
    this.boat = new Boat(this.scene);
    this.player = new Player(this.game);
    this.stations = new Stations(this.boat, this.game, this.audio);
    this.fishing = new Fishing(this.scene, this.audio, this.boat);
    this.deckFish = new DeckFish(this.scene, this.boat);
    this.radio = new RadioSet(this.boat.group);
    this.cabinDoor = new CabinDoor(this.boat.group);
    this.chart = new ChartTable(this.boat.group);
    this.nets = new Nets(this.scene);
    this.bots = new Bots(this.scene, this.port.platforms, this.port.rocks);
    this.bots.onChatter = (name, text) => this.hud.toast(`📻 «${name}»: ${text}`, 'warn', 4200);
    this.bots.onHorn = (v) => this.audio.horn(v);
    this.nets.onEvent = (msg, kind) => this.hud.toast(msg, kind, 4000);
    this.nets.onSound = (k, p) => (k === 'splash' ? this.audio.splash(p) : k === 'winch' ? this.audio.click() : this.audio.thump(p));
    this.nets.onFish = (f, at) => {
      // з сітки — у трюм; не влізло — на палубу (до 8 рибин); далі — за борт
      this.game.recordCatch(f);
      if (this.game.storeFish(f)) {
        if (Math.random() < 0.5) this.audio.thump(0.15);
        return 'hold';
      }
      if (this.deckFish.count < 8) {
        this.deckFish.drop(f, at, 0.2);
        return 'deck';
      }
      return 'lost';
    };
    this.deckFish.onWashed = (f) => this.hud.toast(`🌊 Хвиля змила за борт: ${this.game.speciesName(f.speciesId)}! Клади рибу в ящик одразу.`, 'bad', 4000);
    this.player.onJump = () => this.audio.step(this.player.mode === 'boat' ? 0 : 2, true);
    this.player.stationText = (id) =>
      id === 'radio'
        ? `Радіо — крутити ручку (${RADIO_CHANNELS[this.radio.channel].name.toLowerCase()})`
        : id === 'fishbox'
        ? !this.boat.hatchOpen
          ? `Відкрити люк трюму (${this.game.hold.length}/${this.game.holdCap})${this.deckFish.carried ? ' й покласти рибу' : ''}`
          : this.deckFish.carried
            ? `Покласти в трюм: ${this.game.speciesName(this.deckFish.carried.fish.speciesId).toLowerCase()} (${this.game.hold.length}/${this.game.holdCap})`
            : 'Закрити люк трюму'
        : id === 'nets'
        ? this.nets.stationLabel(this.game.upgrades.nets ?? 0, this.boat)
        : this.fishing.stationLabel(id);

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
    this.coop.botState = () => this.bots.netState();
    this.coop.onBots = (a) => this.bots.applyNet(a);

    this.hud = new Hud();
    this.minimap = new Minimap();
    this.mapView = new MapView();
    this.mapView.onRouteChange = () => {
      this.audio.click();
      this.chart.markDirty();
      this.saveGame();
    };
    this.mapView.onClose = () => this.closeMap();
    this.dialogs = new Dialogs(this.audio);

    this.underwater = document.createElement('div');
    this.underwater.id = 'underwater';
    document.body.appendChild(this.underwater);

    // події
    window.addEventListener('resize', () => this.onResize());
    // закрили вкладку / перемкнулись — зберегти одразу (автозбереження раз на 30 с)
    const saveNow = () => {
      if (this.phase !== 'intro') this.saveGame();
    };
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveNow();
    });
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
    this.boat.onSlam = (dmg, kind, power) => {
      this.slamShake = Math.min(1, 0.35 + power * 0.08);
      this.audio.thump(Math.min(1, power / 6));
      if (dmg >= 1) {
        const tip = this.slamTipT <= 0;
        if (tip) this.slamTipT = 25;
        const msg = kind === 'bow'
          ? `💥 Ніс ляснув об хвилю! Корпус −${Math.round(dmg)}${tip ? ' · скинь газ і бери хвилю під кутом 20–40°' : ''}`
          : `🌊 Гребінь ударив у борт! Корпус −${Math.round(dmg)}${tip ? ' · не стій лагом до хвилі — розвернись носом' : ''}`;
        this.hud.toast(msg, 'bad', tip ? 5000 : 2500);
        this.coop.sendEvent('slam', [Math.round(dmg), kind === 'bow' ? 1 : 2, Math.round(power * 10) / 10]);
      } else {
        this.coop.sendEvent('slam', [0, kind === 'bow' ? 1 : 2, Math.round(power * 10) / 10]);
      }
    };
    this.boat.sails.onEvent = (msg, kind) => {
      this.hud.toast(msg, kind, 4000);
      this.coop.sendEvent('toast', [msg, kind]);
    };
    this.fishing.onEvent = (msg, kind) => this.hud.toast(msg, kind, 4500);
    this.fishing.onSplash = (pos, power) => {
      this.particles.splash(pos.x, pos.y, pos.z, power);
      this.audio.splash(power * 0.7);
    };
    this.fishing.onLeap = (sp, kg, pos) => {
      // риба виринає дугою вбік і пірнає назад
      const a = Math.random() * Math.PI * 2;
      const to = this._v4.set(pos.x + Math.cos(a) * 1.6, pos.y - 0.2, pos.z + Math.sin(a) * 1.6);
      this.leapJump.start(sp, kg, pos, to, true);
    };
    this.boat.onEngineStall = () => {
      this.hud.toast('Хвиля заглушила двигун! Запусти його на двигунній (E)', 'bad');
      this.audio.snap();
      this.coop.sendEvent('stall');
    };
    this.boat.onSunk = () => this.handleSunk();
    this.player.onStep = (surf, run) => this.audio.step(surf, run);

    // звук стартує з першого жесту (політика автоплею) — музика грає вже в заставці
    this.applySettings(this.settings);
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
        onJoin: async (n, c, own) => {
          remember(n);
          await this.coop.start(n, c, own);
          if (own) this.enterOwnBoat(false);
          else this.startCrew(this.coop.hostId);
        },
      },
      this.saveSummary(),
    );
  }

  /**
   * Кооп-екіпаж чужої яхти: свій гаманець (окремий слот), яхта, її модулі
   * й трюм — власника. Покупки для яхти й зміни трюму йдуть власнику.
   */
  private startCrew(owner: number, keepWorld = false) {
    GameState.saveKey = GameState.COOP_KEY;
    const data = GameState.load();
    // сітки на човні капітана — його; гість лише бачить буї
    this.nets.load(null);
    this.nets.remote = true;
    this.game = new GameState();
    if (data) this.game.applySave(data);
    // трюм — яхти (прийде зі знімком власника), свій старий не тягнемо
    this.game.hold = [];
    this.game.holdHook = (op, f) => {
      if (op === 'add') this.coop.sendAction({ a: 'store', f: { ...f } });
      else if (op === 'remove') this.coop.sendAction({ a: 'take', uid: f.uid });
      else this.coop.sendAction({ a: 'cook', uid: f.uid });
    };
    this.player.attachGame(this.game);
    if (!keepWorld) {
      this.time = new TimeCycle(8.0);
      this.weather = new Weather();
    }
    this.coop.setMyBoat(owner);
    this.boat.moor.x = moorSlotX(owner);
    this.boat.reset(this.boat.moor.x, this.boat.moor.z, MOOR_HEADING);
    this.boat.sails.passive = true;
    this.deckFish.clear();
    this.fishing.reelIn();
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
    const cap = this.coop.nickOf(owner);
    this.hud.toast(`👥 Ти на яхті ${cap} в екіпажі. Трюм спільний: хто продав рибу — тому й гроші.`, 'good', 7000);
    if (!keepWorld) this.hud.toast('Enter — чат з екіпажем', 'warn', 6000);
  }

  /** кооп: на своїй яхті (свій соло-сейв: гроші, модулі, трюм) */
  private enterOwnBoat(keepWorld: boolean) {
    this.endCrew();
    this.coop.setMyBoat(this.coop.myId);
    const data = GameState.load();
    this.nets.load(data?.nets);
    this.game = new GameState();
    if (data) this.game.applySave(data);
    this.player.attachGame(this.game);
    if (!keepWorld) {
      this.time = new TimeCycle(data?.timeHours ?? 8.0);
      this.time.dayCount = data?.dayCount ?? 1;
      this.weather = new Weather();
      this.weather.restore(data?.weatherSeed ?? 10);
    }
    this.boat.moor.x = moorSlotX(this.coop.myId);
    this.boat.reset(this.boat.moor.x, this.boat.moor.z, MOOR_HEADING);
    this.deckFish.clear();
    this.fishing.reelIn();
    this.player.resetToBoat();
    this.stations.dispose();
    this.stations = new Stations(this.boat, this.game, this.audio);
    this.syncUpgrades();
    this.playTime = data?.totalPlayTime ?? this.playTime;
    this.prevObjectives = { ...this.game.objectives };
    this.lastDay = this.time.dayCount;
    this.lastWeather = this.weather.state();
    this.phase = 'play';
    this.requestLock();
    this.hud.flashHints();
    this.hud.toast(`⛵ Ти на своїй яхті — місце ${MOOR_SLOTS.indexOf(this.boat.moor.x) + 1} біля причалу. Друзі можуть піднятися на борт через меню (Esc).`, 'good', 7000);
  }

  /** пересісти на іншу яхту флотилії (з меню паузи) */
  private switchBoat(owner: number) {
    if (owner === this.coop.myBoat) return;
    this.saveGame();
    if (owner === this.coop.myId) this.enterOwnBoat(true);
    else this.startCrew(owner, true);
    this.syncUpgrades();
  }

  /** вихід з кооп-режиму гостя назад у соло */
  private endCrew() {
    this.boat.sails.passive = false;
    this.stations.onBoatAction = null;
    this.dialogs.onBoatPurchase = null;
    this.game.holdHook = null;
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
      case 'hatch':
        this.boat.hatchOpen = act.v === 1;
        break;
      case 'nets':
        this.nets.interact(g.upgrades.nets ?? 0, this.boat, g, this.weather);
        break;
      case 'door':
        this.boat.doorOpen = act.v === 1;
        break;
      // спільний трюм: екіпаж кладе / продає / варить рибу
      case 'store':
        if (act.f && g.hold.length < g.holdCap && !g.hold.some((f) => f.uid === act.f.uid)) g.hold.push({ ...act.f });
        break;
      case 'take': {
        const i = g.hold.findIndex((f) => f.uid === act.uid);
        if (i >= 0) g.hold.splice(i, 1);
        break;
      }
      case 'cook': {
        const f = g.hold.find((x) => x.uid === act.uid);
        if (f) f.cooked = true;
        break;
      }
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
      case 'nets':
        this.nets.applyNet(v as NetsNet);
        break;
      case 'slam': {
        const [dmg, k, power] = (Array.isArray(v) ? v : [0, 1, 3]) as number[];
        this.slamShake = Math.min(1, 0.35 + power * 0.08);
        this.audio.thump(Math.min(1, power / 6));
        if (dmg >= 1) this.hud.toast(k === 1 ? `💥 Ніс ляснув об хвилю! Корпус −${dmg}` : `🌊 Гребінь ударив у борт! Корпус −${dmg}`, 'bad', 2500);
        break;
      }
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
        // екіпаж: яхта, модулі й трюм — власника (за його полісом); у мене — лише риба з палуби
        const r = this.applySink(false, true);
        this.fishing.reelIn();
        this.player.resetToBoat();
        this.player.localZ = -1.2;
        this.hud.toast(`Затоплення! Втрачено риби: ${r.lostFish}${r.payout ? `, страхова виплата +${r.payout} ₴` : ' — не застраховано'}.`, 'bad', 7000);
        break;
      }
      case 'sleep':
        this.hud.toast('Капітан спить — ніч минула.', 'warn', 3500);
        break;
    }
  }

  private startNew() {
    GameState.clear();
    this.nets.load(null);
    this.game = new GameState();
    this.player.attachGame(this.game);
    this.time = new TimeCycle(8.0);
    this.weather = new Weather();
    this.boat.reset(this.boat.moor.x, this.boat.moor.z, MOOR_HEADING);
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
    this.hud.toast('Вітаємо на борту «Шторму»! Море чекає.', 'good', 6000);
  }

  private continueGame() {
    const data = GameState.load();
    if (!data) {
      this.startNew();
      return;
    }
    this.game.applySave(data);
    this.nets.load(data.nets);
    this.time = new TimeCycle(data.timeHours ?? 8.0);
    this.time.dayCount = data.dayCount ?? 1;
    this.weather.restore(data.weatherSeed ?? 10);
    // старі сейви: човен стояв на (0,-26) — під причалом; виносимо на шварт
    let bx = data.boatX ?? this.boat.moor.x, bz = data.boatZ ?? this.boat.moor.z, bh = data.boatHeading ?? MOOR_HEADING;
    const dock = this.port.platforms[0];
    if (bx > dock.x0 && bx < dock.x1 && bz > dock.z0 && bz < dock.z1) {
      bx = this.boat.moor.x; bz = this.boat.moor.z; bh = MOOR_HEADING;
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
    this.fishing.setOwned(this.game.upgrades.holders ?? 0);
    this.hl.invalidate();
  }

  private handleSunk() {
    const g = this.game;
    const r = this.applySink(true);
    this.boat.reset(this.boat.moor.x, this.boat.moor.z, MOOR_HEADING);
    this.player.resetToBoat();
    this.fishing.reelIn();
    // новий човен від страхової — цілий; без страховки — латаний корпус
    g.hull = r.plan.tier > 0 ? g.maxHull : Math.max(20, g.maxHull * 0.5);
    g.fuel = Math.max(g.fuel, 15);
    this.syncUpgrades();
    if (r.plan.claimH > 0) this.time.hours += r.plan.claimH;
    this.coop.sendEvent('sunk');
    this.saveGame();
    this.phase = 'dialog';
    this.dialogs.sinkReport(r, () => {
      this.phase = 'play';
      this.requestLock();
    });
  }

  /** підсвітка того, з чим зараз взаємодієш (E) */
  private updateHighlight(t: number) {
    const p = this.player;
    let key = '';
    let objs: THREE.Object3D[] | null = null;
    const near = (id: string, x: number, y: number, z: number, r: number, max: number) =>
      this.hl.near(id, this.boat.group, this._hv.set(x, y, z), r, max, (o) => {
        // вудки рухаються (руки/стійки) — їх додаємо окремо
        for (let q: THREE.Object3D | null = o; q; q = q.parent) if (q.userData.rod) return true;
        return false;
      });
    if (this.phase === 'play' && !this.dialogs.isOpen && !p.wheeling && p.mode === 'boat') {
      const fish = !this.deckFish.carried && this.deckFish.nearest(p.localX, p.localZ, 1.2);
      const id = p.nearest?.id ?? '';
      if (fish) {
        key = 'fish:' + fish.uid;
        objs = [this.deckFish.meshOf(fish)!].filter(Boolean);
      } else if (id === 'st:fishbox') {
        key = id;
        objs = [this.deckFish.hatch];
      } else if (id === 'st:nets') {
        key = id + (this.game.upgrades.nets ?? 0);
        objs = near(key, 0.6, 0.95, -4.95, 0.8, 1.4);
      } else if (id === 'st:radio') {
        key = id;
        objs = [this.radio.group];
      } else if (id === 'st:door') {
        key = id;
        objs = [this.cabinDoor.group];
      } else if (id === 'st:rod') {
        key = id + this.fishing.rackObjects().length;
        objs = [...this.fishing.rackObjects(), ...near('rack', 0.42, Y_DECK + 0.2, 3.76, 0.2, 0.6)];
      } else if (id.startsWith('st:holder')) {
        const h = Number(id.slice(9));
        const m = HOLDER_MOUNTS[h].base;
        const rod = this.fishing.holderObject(h);
        key = id + (rod ? 'r' : '');
        objs = [...near('holder' + h + this.game.upgrades.holders, m[0], m[1] + 0.2, m[2], 0.35, 0.8), ...(rod ? [rod] : [])];
      } else if (id === 'st:wheel') {
        key = id;
        objs = near('wheel', 0, Y_DECK + 0.75, -3.38 + HELM_DZ, 0.55, 1.6);
      } else if (id === 'st:engine' || id === 'st:pump') {
        const x = id === 'st:engine' ? 0.62 : -0.62;
        key = id;
        objs = near(id, x, Y_DECK + 0.05, -4.05, 0.3, 0.9);
      } else if (id === 'st:sails') {
        key = id;
        objs = near('sails', 0, L_HOUSE.top + 0.15, L_RIG.mastZ - 0.3, 0.6, 0.7);
      } else if (id === 'st:kitchen') {
        key = id;
        objs = near('kitchen', -0.82, Y_SOLE + 1.0, 1.15, 0.3, 0.6);
      } else if (id === 'st:bed') {
        key = id;
        objs = near('bed', 0, Y_SOLE + 0.45, 3.2, 0.8, 2.2);
      }
    }
    if (this.phase === 'play' && !this.dialogs.isOpen && p.mode === 'port' && p.nearest?.id.startsWith('shop:')) {
      key = p.nearest.id + ':' + (this.game.upgrades[p.nearest.id.slice(8) as keyof typeof this.game.upgrades] ?? '');
      const o = this.shopCounter.objectOf(p.nearest.id.slice(5) as CounterTarget);
      objs = o ? [o] : null;
    }
    this.hl.set(key, objs && objs.length ? objs : null);
    this.hl.update(t);
  }

  /** крамниця-прилавок: на що дивиться гравець у порту */
  private pickCounter() {
    const g = this.game;
    this.shopCounter.refresh(g.upgrades, g.money);
    const p = this.player;
    if (p.mode !== 'port') return;
    const t = this.shopCounter.pick(p.head, p.yaw, p.pitch);
    if (t) p.nearest = { id: 'shop:' + t, label: this.shopCounter.label(t, g.upgrades, g.money) };
  }

  /** E біля прилавка: купити річ з полиці / каса / страховка */
  private useCounter(t: CounterTarget) {
    const g = this.game;
    if (t === 'register' || t === 'insurance') {
      this.openDialog('shop', t === 'register' ? 'fish' : 'insurance');
      return;
    }
    const id = t.slice(3) as UpgradeId;
    const u = UPGRADE_BY_ID[id];
    if (g.upgrades[id] >= MAX_LEVEL) {
      this.hud.toast(`${u.name}: усе вже стоїть на човні`, 'warn', 2200);
      return;
    }
    const cost = upgradeCost(id, g.upgrades[id]) ?? 0;
    const lock = upgradeLock(id, g.upgrades);
    if (lock) {
      this.hud.toast(`🔒 «${u.parts[g.upgrades[id]].name}»: ${lock}`, 'warn', 2600);
      return;
    }
    if (!g.buyUpgrade(id)) {
      this.hud.toast(`Не вистачає ${formatMoney(cost - g.money)} на «${u.parts[g.upgrades[id]].name}»`, 'warn', 2600);
      return;
    }
    // гість купує для спільного човна — капітан ставить річ (як у вікні крамниці)
    this.dialogs.onBoatPurchase?.({ upgrade: id });
    this.syncUpgrades();
    this.audio.catchJingle();
    this.hud.toast(`🔧 «${u.parts[g.upgrades[id] - 1].name}» — вже на човні (−${formatMoney(cost)})`, 'good', 3200);
    this.saveGame();
  }

  /** що говорить станція, на яку налаштоване радіо */
  private radioText(): string {
    const g = this.game, w = this.weather;
    switch (this.radio.channel) {
      case 1: {
        const fc = w.snapshot().forecast;
        const bf = w.beaufort;
        const eta = w.stormEta;
        const f = eta != null ? `УВАГА: ШТОРМ приблизно за ${Math.max(1, Math.round(eta / 25))} год, у відкритому морі — до 10–11 балів` : fc > 0.74 ? 'УВАГА: очікується ШТОРМ, у відкритому морі — до 10–11 балів' : fc > 0.45 ? 'вітер посилюється, хвилі ростуть' : fc < 0.14 ? 'погода покращується, море спокійне' : 'погода стабільна';
        return `зараз ${bf.b} б. (${bf.name}, ${w.windMs.toFixed(0)} м/с) · прогноз: ${f} · далі від берега завжди сильніше`;
      }
      case 2:
        return g.reports.length ? g.reports.map((r) => `${ZONE_NAMES[r.zone]}: добре клює ${g.speciesName(r.speciesId).toLowerCase()} ×${r.boost.toFixed(1).replace('.', ',')}`).join(' · ') : 'сигнал загубився…';
      case 3:
        return `${g.priceTrendText} (тиждень ${g.priceWeek})` + g.market.events.map((e) => ` · ${e.mult > 1 ? '↑' : '↓'} ${e.text}`).join('');
      case 4:
        return '♪ «Ой, у морі хвилі…» · морські пісні до світанку ♪';
      default:
        return '';
    }
  }

  /** затоплення: улов на борту (трюм + палуба + руки) і модулі за полісом */
  private applySink(withModules: boolean, crew = false): SinkReport {
    const g = this.game;
    const plan = PLANS[g.insurance] ?? PLANS[0];
    const lost = [...(crew ? [] : g.hold), ...this.deckFish.clear()];
    const cargoValue = lost.reduce((a, f) => a + g.sellPrice(f), 0);
    g.hold.length = 0;
    const payout = Math.round(cargoValue * plan.cargo);
    const lostModules = withModules ? applySinkToUpgrades(g.upgrades, plan.tier) : [];
    const tow = plan.tow;
    g.money = Math.max(0, g.money + payout - tow);
    if (lost.some((f) => f.storm)) g.objectives.stormReturn = true;
    return { plan, lostFish: lost.length, cargoValue, payout, lostModules, tow };
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
      settings: this.settings,
      onSettings: (st) => {
        this.applySettings(st);
        saveSettings(st);
      },
      playTime: this.playTime,
      onBeforeExport: () => this.saveGame(),
      places: LANDMARKS.map((l) => ({ name: l.name, found: this.game.places.includes(l.id) })),
      coop: this.coop.active
        ? {
            room: this.coop.room,
            link: this.coop.inviteLink(),
            host: this.coop.isHost,
            players: this.coop.roster(),
            onLeave: () => this.leaveCoop(),
            boats: this.coop.fleetList(),
            onBoard: (owner) => {
              const to = owner < 0 ? this.coop.myId : owner;
              if (this.coop.isHost && to !== this.coop.myId) {
                // світ (час, погоду) веде капітан кімнати — він завжди на своїй яхті
                this.hud.toast('Капітан кімнати плаває на своїй яхті — друзі можуть прийти до тебе в екіпаж', 'warn', 4500);
                this.phase = 'play';
                this.requestLock();
                return;
              }
              this.switchBoat(to);
            },
          }
        : undefined,
    });
  }

  private openDialog(kind: 'shop' | 'radio', tab?: 'fish' | 'insurance') {
    this.phase = 'dialog';
    this.expectUnlock = true;
    document.exitPointerLock();
    this.saveTimer = 30;
    if (kind === 'shop') this.dialogs.shop(this.game, tab ?? 'vitrine');
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

  /** коротко про соло-сейв для стартового екрана */
  private saveSummary(): string | undefined {
    const d = GameState.load();
    return d ? describeSave(d) : undefined;
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
    if (!this.nets.remote) data.nets = this.nets.save();
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
      if (this.chartMode) this.setChart(false);
      else this.doInteract();
    }
    // Esc — меню паузи / продовження / закрити карту (працює і без pointer lock)
    if (input.pressed('Escape')) {
      if (this.chartMode) {
        this.setChart(false);
      } else if (this.phase === 'map') {
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
    // P — фото-режим
    if (input.pressed('KeyP') && this.phase === 'play' && !this.dialogs.isOpen) this.setPhoto(!this.photo);
    if (this.photo && this.phase !== 'play') this.setPhoto(false);
    // H — сховати / показати інтерфейс (фото, кіно)
    if (input.pressed('KeyH') && this.phase === 'play' && !this.dialogs.isOpen) this.hud.setHidden(!this.hud.hidden);
    if (input.pressed('F1') || input.pressed('Slash')) this.hud.flashHints(12);
    const wheelSteps = input.consumeWheel();
    if (wheelSteps && this.chartMode) {
      const [cw, ch] = this.chart.size;
      this.mapView.chartZoom(wheelSteps, this.chart.u, this.chart.v, cw, ch);
      this.chart.markDirty();
    } else if (wheelSteps && this.rig.mode === 'chase') this.rig.zoom(wheelSteps);
    if (this.photo) {
      const [mdx, mdy] = input.consumeMouse();
      this.photoYaw -= mdx * 0.0025;
      this.photoPitch = clamp(this.photoPitch - mdy * 0.0025, -1.2, 0.3);
    }
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
      // страховий внесок за добу
      if (g.insurance > 0) {
        const fee = dailyPremium(g.insurance, g.upgrades);
        if (g.money >= fee) {
          g.money -= fee;
          this.hud.toast(`🛡 Страховка «${PLANS[g.insurance].name}»: −${fee} ₴`, 'warn', 3500);
        } else {
          g.insurance = 0;
          this.hud.toast('🛡 Не вистачило грошей на внесок — страховка згоріла!', 'bad', 6000);
        }
      }
      this.hud.toast(`Новий день. ${g.priceTrendText}.`, 'warn');
      if (g.lastMarketEvent) this.hud.toast(`📈 Біржа: ${g.lastMarketEvent.text}`, g.lastMarketEvent.mult > 1 ? 'good' : 'warn', 6000);
    }

    // погода: у відкритому морі сильніша (множник від відстані до берега)
    {
      const wp = this.player.mode === 'boat' ? this.boat.pos : this.player.head;
      this.weather.localMul = seaFactor(offshore(wp.x, wp.z));
    }
    if (this.coop.isClient) this.weather.updatePassive(dt);
    else this.weather.update(dt);
    // штормове попередження заздалегідь (фронт ще не прийшов)
    const eta = this.weather.stormEta;
    if (eta != null && eta > 60 && !this.stormWarned) {
      this.stormWarned = true;
      this.hud.toast(`📻 Штормове попередження: шторм приблизно за ${Math.max(1, Math.round(eta / 60))} хв (≈${Math.max(1, Math.round(eta / 25))} год гри). Рибалки вертаються в порт`, 'warn', 6500);
    } else if (eta == null && this.weather.state() !== 'storm') this.stormWarned = false;
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
      this.coop.sendWorldEvent('bolt', p);
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
    this.ocean.setConditions(this.weather.base, this.weather.windDir);
    this.ocean.net = this.coop.oceanNet();
    // небо, яке відбиває вода: хмари роблять його сірішим (як туман)
    const cl = this.weather.cloudiness;
    this._reflGrey.setRGB(0.3, 0.33, 0.38).multiplyScalar(0.35 + 0.65 * this.time.daylight);
    this.reflHorizon.copy(this.time.skyHorizon).lerp(this._reflGrey, cl * 0.6);
    this.reflZenith.copy(this.time.skyZenith).lerp(this._reflGrey, cl * 0.75);
    this.ocean.update(dt, t, this.camera.position, this.time.sunDir, this.reflHorizon, this.fogRaw, this.fogDensity(), this.time.sunStrength * (1 - cl * 0.65), this.weather.flash, this.reflZenith);

    // паливо
    // повний газ — непропорційно дорожче: економний хід і паруси окупаються
    const fuelUse = this.coop.crewing ? 0 : Math.pow(Math.abs(this.boat.throttle), 1.4) * 0.07 * dt;
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
    if (this.chartMode && (this.phase !== 'play' || this.player.mode !== 'boat')) this.setChart(false);
    if (locked && this.phase === 'play' && !this.photo && this.chartMode) {
      // над картою: миша водить олівцем (біля краю карта їде), коліщатко — зум,
      // ЛКМ — точка маршруту, ПКМ — прибрати точку під олівцем (або останню)
      const [mdx, mdy] = input.consumeMouse();
      this.chart.moveCursor(mdx, mdy);
      this.chartEdgePan(dt);
      if (input.pressed('Mouse0')) this.chartClick();
      if (input.pressed('Mouse2') && this.game.route.length) {
        const [cw, ch] = this.chart.size;
        const i = this.mapView.chartHit(this.chart.u, this.chart.v, cw, ch, this.game.route);
        this.game.removeRoutePoint(i >= 0 ? i : this.game.route.length - 1);
        this.audio.click();
        this.chart.markDirty();
        this.saveGame();
      }
      this.boat.localToWorld(this.player.localX, this.player.floorY + 1.62, this.player.localZ, this.player.head);
    } else if (locked && this.phase === 'play' && !this.photo) {
      const crewHelm = this.coop.crewing && this.player.wheeling;
      if (crewHelm) {
        // свій газ/кермо (знімок капітана ще не встиг їх побачити)
        this.boat.throttle = this.coop.myHelm[0];
        this.boat.rudder = this.coop.myHelm[1];
      }
      this.player.update(dt, input, this.boat, this.port, this.ocean, t);
      this.pickCounter();
      if (crewHelm) this.coop.myHelm = [this.boat.throttle, this.boat.rudder];
    } else {
      // навіть без лока тримаємо голову на місці
      this.boat.localToWorld(this.player.localX, this.player.floorY + 1.62, this.player.localZ, this.player.head);
    }
    this.player.updateEnergy(dt);

    // човен
    this.boat.night = this.time.isNight;
    if (this.coop.crewing) {
      if (this.player.wheeling) {
        this.boat.throttle = this.coop.myHelm[0];
        this.boat.rudder = this.coop.myHelm[1];
      }
      this.boat.updateRemote(dt, t, this.ocean, this.weather, g, this.particles, this.audio);
    } else {
      this.coop.ownerApply(dt, this.boat, this.player);
      // інші яхти флотилії — теж перешкоди (зіткнення бортами)
      const others = [...(this.coop.active ? this.coop.fleetObstacles() : []), ...this.bots.obstacles()];
      this.boat.update(dt, t, this.ocean, this.weather, g, this.particles, this.audio, others.length ? [...this.port.rocks, ...others] : this.port.rocks, this.port.platforms[0]);
    }
    this.boat.updateGangway(dt, this.port.platforms[0]);
    // камера й маска води в корпусі — від пози човна саме цього кадру
    this.player.syncHead(this.boat);
    this.ocean.setHull(this.boat.group, this.boat.vel.length());
    // слід піни за кормою
    this.foamTrail.update(dt, t, this.boat.localToWorld(0, 0, -4.9, this._v), this.boat.heading, this.boat.vel.length(), this.ocean, this.camera.position, clamp(this.time.daylight + 0.15, 0, 1), clamp(this.weather.intensity - 0.4, 0, 1));

    // станції
    // відійшов від щогли — робота з фалами переривається
    if (this.stations.active?.id === 'sails' && this.player.nearest?.id !== 'st:sails') {
      this.stations.stop();
      this.hud.toast('Відійшов від щогли — фал кинуто', 'warn', 2000);
    }
    this.stations.update(dt, this.time.hours);

    // кооп: знімок світу (капітан), свій гравець і аватари екіпажу
    this.coop.ownerSend(dt, t, this.boat, this.weather, this.time, g, this.coop.crewing ? undefined : this.ocean.netState());
    this.coop.updateFleet(dt, t, this.ocean, this.weather, g, this.particles, this.time.daylight);
    // боти: симулює соло-гравець або капітан кімнати; гості доганяють пози
    this.bots.remote = this.coop.isClient;
    this.bots.update(dt, t, this.ocean, this.weather, this.time.daylight, [this.boat.pos, ...this.coop.fleetObstacles()], this.boat.pos);
    this.coop.tick(dt, this.boat, this.player, this.stations.active?.id === 'pump', this.fishing, this.ocean, t);

    // ловля
    this.fishing.update(dt, t, this.boat, this.ocean, input, g, this.weather, this.time);
    // вудка в руках: ЛКМ — закид / підсічка, R — змотати
    if (locked && this.phase === 'play' && !this.dialogs.isOpen && !this.photo && !this.chartMode && this.player.mode === 'boat' && !this.player.wheeling) {
      if (input.pressed('Mouse0')) this.fishing.click(this.boat, g, this.weather, this.time);
      if (input.pressed('KeyR')) this.fishing.reelHand();
    }
    const bobW = this._v3.copy(this.fishing.lastBobber);
    this.player.rodBusy = this.fishing.state === 'fight' || this.fishing.state === 'charge';
    this.fishJump.update(dt, t);
    this.leapJump.update(dt, t);
    const catched = this.fishing.takeCatch();
    if (catched) {
      // риба вилітає з води в руки
      // летить на палубу за півтора метра перед рибалкою (не в обличчя камері)
      const me = this.player.mode === 'boat' ? this.boat.localToWorld(this.player.localX, this.player.floorY + 0.35, this.player.localZ, this._v2) : this._v2.copy(this.player.head).setY(this.player.head.y - 1.3);
      const dx = bobW.x - me.x, dz = bobW.z - me.z, dl = Math.hypot(dx, dz) || 1;
      me.x += (dx / dl) * 1.5;
      me.z += (dz / dl) * 1.5;
      this.fishJump.start(catched.speciesId, catched.kg, bobW, me);
      this.particles.splash(bobW.x, bobW.y, bobW.z, 0.8);
      this.audio.splash(0.6);
      const name = g.speciesName(catched.speciesId);
      const isNew = !g.discovered.includes(catched.speciesId);
      g.recordCatch(catched);
      if (this.player.mode === 'boat') {
        // риба падає на палубу й б'ється — її треба віднести в ящик на баку
        this.deckFish.drop(catched, me, 1.05);
        this.hud.catchCard(name, catched.kg, catched.speciesId, isNew, catched.storm ? 'штормова · на палубі' : 'на палубі — неси в ящик');
      } else if (g.storeFish(catched)) {
        this.hud.catchCard(name, catched.kg, catched.speciesId, isNew, catched.storm ? 'штормова' : '');
      }
    }
    // риба на палубі: б'ється, псується, хвиля може змити
    this.cabinDoor.update(dt, this.boat.doorOpen);
    this.nets.update(dt, this.time.gameHourDelta(dt), t, this.boat, this.ocean, this.weather, this.camera.position);
    this.syncNets(dt);
    this.deckFish.update(dt, t, this.time.gameHourDelta(dt), this.boat.deckWater, g.hold, this.boat.hatchOpen);
    // радіо: текст станції й звук (чути в каюті, тихіше — з палуби)
    this.radio.update(dt);
    if ((this.chartMode || (this.player.mode === 'boat' && this.player.inCabin)) && this.chart.due(dt, this.chartMode)) {
      this.mapView.drawChart(this.chart.canvas, this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, this.game);
      this.chart.textureUpdated();
    }
    this.updateHighlight(t);
    this.radioTextT -= dt;
    if (this.radioTextT <= 0) {
      this.radioTextT = 2;
      this.radio.setText(this.radioText());
    }
    this.audio.setRadio(this.radio.on && this.player.mode === 'boat' && this.player.inCabin, this.radio.tuning, this.radio.channel >= 1 && this.radio.channel <= 3, dt);

    // вода тече у відкритий люк — гучне попередження
    if (this.boat.hatchOpen && this.boat.deckWater > 8) {
      this.hatchWarnT -= dt;
      if (this.hatchWarnT <= 0) {
        this.hatchWarnT = 6;
        this.hud.toast(`🌊 Вода заливає відкритий трюм (${Math.round(this.boat.bilge)}%)! Закрий люк (ящик із червоним ричагом на носі) й відкачай помпою!`, 'bad', 4500);
      }
    }

    // вода ллється у відчинені двері каюти
    if (this.boat.doorOpen && this.boat.deckWater > 15) {
      this.doorWarnT -= dt;
      if (this.doorWarnT <= 0) {
        this.doorWarnT = 7;
        this.hud.toast(`🌊 Вода ллється в каюту через відчинені двері! Зачини двері біля трапа (E — червоний засув).`, 'bad', 4500);
      }
    }

    // свіжість
    g.decayFreshness(this.time.gameHourDelta(dt));
    g.tickMarket(this.time.gameHourDelta(dt));

    // орієнтир шварту: світний обрис місця біля причалу, коли повертаєшся
    {
      const dm = Math.hypot(this.boat.pos.x - this.boat.moor.x, this.boat.pos.z - this.boat.moor.z);
      const want = dm < 220 && dm > 4 && !this.boat.mooredNow ? 1 : 0;
      const m = this.moorMark;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity += (want * (0.5 + 0.25 * Math.sin(t * 3)) - mat.opacity) * (1 - Math.exp(-3 * dt));
      m.visible = mat.opacity > 0.01;
      m.position.set(this.boat.moor.x, this.ocean.renderedHeightAt(this.boat.moor.x, this.boat.moor.z, t) + 0.08, this.boat.moor.z);
      if (this.boat.mooredNow && !this.wasMoored && this.leftHarbour) {
        this.hud.toast('⚓ Пришвартовано', 'good', 2500);
        this.audio.click();
        this.leftHarbour = false;
      }
      if (dm > 40) this.leftHarbour = true;
      this.wasMoored = this.boat.mooredNow;
    }

    // маршрут для лоції (лише капітан/соло — човен його)
    if (!this.coop.crewing) g.addTrack(this.boat.pos.x, this.boat.pos.z);
    // маршрут: дійшли до точки — компас веде на наступну
    if (g.advanceRoute(this.boat.pos.x, this.boat.pos.z)) {
      const nx = g.waypoint;
      this.hud.toast(nx ? `✓ Точку пройдено · далі ${this.mapView.fmtDist(Math.hypot(nx.x - this.boat.pos.x, nx.z - this.boat.pos.z))}, ще ${g.route.length}` : '🏁 Маршрут пройдено', 'good', 2600);
      this.audio.click();
      this.chart.markDirty();
      if (this.phase === 'map') this.mapView.refresh(this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, g);
    }

    // кранці — лише біля причалу
    this.boat.setFenders(Math.hypot(this.boat.pos.x - this.boat.moor.x, this.boat.pos.z - this.boat.moor.z) < 30);

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

    // пам'ятки: дзвоновий буй, відкриття місць
    const ring = this.landmarks.update(dt, t, this.ocean);
    this.bellCd -= dt;
    if (ring > 0.9 && this.bellCd <= 0) {
      this.bellCd = 1.6 + Math.random() * 2;
      const bl = LANDMARKS.find((l) => l.id === 'bell')!;
      const bd = Math.hypot(this.camera.position.x - bl.x, this.camera.position.z - bl.z);
      this.audio.bell(clamp(1 - bd / 320, 0, 1) * clamp(ring * 0.6, 0.5, 1.2) * 0.8);
    }
    this.checkPlaces();

    this.updateTutorial();

    // цілі: тости про досягнення
    for (const k of Object.keys(g.objectives) as Array<keyof typeof g.objectives>) {
      if (g.objectives[k] && !this.prevObjectives[k]) {
        this.hud.toast(this.objectiveToast(k), 'good', 5000);
      }
    }
    this.prevObjectives = { ...g.objectives };

    // автозбереження
    this.slamTipT -= dt;
    this.saveTimer -= dt;
    if (this.saveTimer <= 0 && this.phase === 'play') {
      this.saveTimer = 30;
      this.saveGame();
    }

    this.playTime += dt;
  }

  private lastDay = 1;
  private wasMoored = true;
  private leftHarbour = false;
  private moorMark: THREE.Mesh = (() => {
    const g = new THREE.RingGeometry(0.86, 1, 64);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0, depthWrite: false }));
    m.scale.set(2.6, 1, 6.2);
    m.rotation.y = MOOR_HEADING;
    m.position.set(MOOR.x, 0, MOOR.z);
    m.renderOrder = 2;
    return m;
  })();
  private sleeping = false;
  private fade: HTMLElement = (() => {
    const el = document.createElement('div');
    el.id = 'fade';
    document.body.appendChild(el);
    return el;
  })();
  private prevRoll = 0;
  private prevPitch = 0;
  private lastZone: string | null = null;
  private lastHours = 8;

  private updateTutorial() {
    const g = this.game;
    if (g.tut >= TUTORIAL.length) {
      this.hud.setGoal(null);
      return;
    }
    const done = [
      () => this.player.wheeling,
      () => Math.hypot(this.boat.pos.x - this.boat.moor.x, this.boat.pos.z - this.boat.moor.z) > 60,
      () => this.boat.sails.mode > 0,
      () => this.fishing.anyCast,
      () => g.stats.totalCaught > 0,
      () => g.objectives.firstSale,
    ][g.tut];
    if (done()) {
      g.tut++;
      this.audio.click();
      if (g.tut >= TUTORIAL.length) this.hud.toast('Ти освоївся. Далі — море твоє: шукай місця на лоції й нові види риби.', 'good', 6000);
    }
    this.hud.setGoal(g.tut < TUTORIAL.length ? TUTORIAL[g.tut] : null, g.tut + 1, TUTORIAL.length);
  }

  /** підплив до пам'ятки — місце відкрито */
  private checkPlaces() {
    const g = this.game;
    const p = this.player;
    const px = p.mode === 'boat' ? this.boat.pos.x : p.head.x;
    const pz = p.mode === 'boat' ? this.boat.pos.z : p.head.z;
    for (const l of LANDMARKS) {
      if (g.places.includes(l.id)) continue;
      if (Math.hypot(px - l.x, pz - l.z) > l.r) continue;
      g.places.push(l.id);
      this.hud.titleCard(l.name, `відкрито · ${l.sub}`);
      this.hud.toast(`📍 Місця: ${g.places.length}/${LANDMARKS.length}`, 'good', 3500);
      this.audio.discover();
      this.saveGame();
    }
  }

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

    // клює на вудці в руках — E теж підсікає
    if (this.fishing.state === 'bite') {
      this.fishing.hook(g, this.weather, this.time);
      return;
    }

    // риба на палубі: підняти (руки вільні від риби) — пріоритет над станціями поруч
    if (p.mode === 'boat' && !this.deckFish.carried && this.deckFish.nearest(p.localX, p.localZ, 1.2)) {
      const f = this.deckFish.pick(p.localX, p.localZ);
      if (f) {
        this.audio.splash(0.15);
        return;
      }
    }

    const id = p.interact(this.boat, this.port, this.audio);
    if (!id) return; // climb — оброблено

    if (id === 'st:nets') {
      if (this.coop.crewing) this.coop.sendAction({ a: 'nets' });
      else this.nets.interact(g.upgrades.nets ?? 0, this.boat, g, this.weather);
      return;
    }

    if (id === 'st:chart') {
      if (this.fishing.holding) {
        this.hud.toast('Спершу постав вудку — над картою потрібні обидві руки', 'warn', 2500);
        return;
      }
      this.setChart(true);
      return;
    }

    if (id === 'st:door') {
      this.boat.doorOpen = !this.boat.doorOpen;
      if (this.coop.crewing) this.coop.sendAction({ a: 'door', v: this.boat.doorOpen ? 1 : 0 });
      this.audio.thump(this.boat.doorOpen ? 0.35 : 0.55);
      return;
    }

    if (id === 'st:fishbox') {
      // люк трюму: закритий — відкрити; відкритий і риба в руках — покласти; інакше — закрити
      if (!this.boat.hatchOpen) {
        this.boat.hatchOpen = true;
        if (this.coop.crewing) this.coop.sendAction({ a: 'hatch', v: 1 });
        this.audio.thump(0.4);
        if (!this.deckFish.carried) this.hud.toast('Люк трюму відкрито. Не забудь закрити — хвиля заллє трюм!', 'warn', 3000);
        if (!this.deckFish.carried) return;
      }
      const f = this.deckFish.takeCarried();
      if (!f) {
        this.boat.hatchOpen = false;
        if (this.coop.crewing) this.coop.sendAction({ a: 'hatch', v: 0 });
        this.audio.thump(0.5);
        return;
      }
      if (g.storeFish(f)) {
        this.audio.thump(0.3);
        this.hud.toast(`🐟 ${g.speciesName(f.speciesId)} у ящику (${g.hold.length}/${g.holdCap})`, 'good', 1800);
      } else {
        this.deckFish.dropCarried(p.localX, p.localZ);
        this.hud.toast('Ящик повний! Продай улов або прокачай трюм.', 'warn', 3000);
      }
      return;
    }

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
      if (p.wheeling) this.hud.toast(this.chasePref ? 'Штурвал: W/S — газ, A/D — кермо, V — вид від першої особи (прибори на тумбі), E — вийти' : 'Штурвал: W/S — газ, A/D — кермо, V — вид з-за корми, E — вийти. Прибори — на тумбі перед колесом', 'warn', 4000);
      return;
    }
    if (id === 'st:rod' || id.startsWith('st:holder')) {
      if (p.mode !== 'boat') return;
      const msg = id === 'st:rod' ? this.fishing.rackAction() : this.fishing.holderAction(Number(id.slice(9)), g, this.weather, this.time);
      if (msg) this.hud.toast(msg, 'warn', 3000);
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
      // фізичне радіо: ручка настройки — наступна станція
      this.radio.next();
      this.radioTextT = 0;
      this.audio.click();
      return;
    }
    if (id === 'st:bed' || id === 'port:house') {
      this.doSleep(id === 'port:house');
      return;
    }
    if (id.startsWith('shop:')) {
      this.useCounter(id.slice(5) as CounterTarget);
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
    if (this.coop.crewing) this.coop.sendAction({ a: 'sails' });
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
    if (this.sleeping) return;
    this.sleeping = true;
    this.coop.sendWorldEvent('sleep');
    this.audio.click();
    // затемнення → ніч минає → світанок проявляється
    this.fade.classList.add('on');
    setTimeout(() => {
      const delta = this.time.sleepToDawn();
      this.nets.advanceHours(delta);
      this.lastHours = this.time.hours;
      this.game.addEnergy(100);
      this.game.decayFreshness(delta);
      this.game.tickMarket(delta);
      this.fade.classList.remove('on');
      this.dawnCard();
      this.hud.toast(`Пройшло ${Math.round(delta)} год. ${inPort ? 'Виспався в хаті.' : 'Виспався на койці.'}`, 'good', 3500);
      this.sleeping = false;
    }, 1100);
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
    this.moonLight.intensity = (1 - time.daylight) * 0.38 * (1 - this.weather.cloudiness * 0.5);
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
    // fogRaw — у тих самих «сирих» числах, що їх пишуть шейдери неба й океану (без sRGB-кодування);
    // three.js кодує fog.color у sRGB при завантаженні, тож для мешів даємо зворотне перетворення —
    // інакше далека суша й острови завжди світліші за небо позаду
    this.fogRaw.copy(time.skyHorizon).lerp(time.fogColor, 0.25).lerp(this._fogGrey.setRGB(0.3, 0.33, 0.38).multiplyScalar(0.35 + 0.65 * time.daylight), this.weather.cloudiness * 0.8);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.fogRaw).convertSRGBToLinear();
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
    this.slamShake = Math.max(0, this.slamShake - this.clockDelta * 1.8);
    const shakeAmp = 0.008 + this.weather.intensity * 0.02 + this.slamShake * 0.09;
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
      yaw: this.photo ? this.photoYaw : this.player.yaw,
      pitch: this.photo ? this.photoPitch : this.player.pitch + this.player.shakeX,
      roll: this.player.shakeZ,
      fpTilt: tilt,
      shake: this.camShake,
      boatPos: this.photo && this.player.mode !== 'boat' ? this.player.head : this.boat.pos,
      lift: this.photo && this.player.mode !== 'boat' ? -0.4 : undefined,
      waterAt: (x, z) => this.ocean.heightAt(x, z, t),
      t,
      orbitYaw: this.introYaw(),
    });
    // над штурманським столом: камера схиляється до карти (згори, північ — від себе)
    this.chartK += ((this.chartMode ? 1 : 0) - this.chartK) * (1 - Math.exp(-this.clockDelta * 6));
    if (this.chartK > 0.002) {
      const b = this.boat;
      b.localToWorld(CHART_CENTER.x - 0.3, CHART_CENTER.y + 0.55, CHART_CENTER.z, this._chEye);
      b.localToWorld(CHART_CENTER.x + 0.02, CHART_CENTER.y, CHART_CENTER.z, this._chAt);
      this._chUp.set(1, 0, 0).applyQuaternion(b.group.quaternion);
      this._chM.lookAt(this._chEye, this._chAt, this._chUp);
      this._chQ.setFromRotationMatrix(this._chM);
      this.camera.position.lerp(this._chEye, this.chartK);
      this.camera.quaternion.slerp(this._chQ, this.chartK);
    }
    // вітрові завитки (не в каюті)
    if (simDt > 0) {
      const indoor = this.rig.mode === 'fp' && this.player.mode === 'boat' && this.player.level !== 'deck';
      this.windLines.update(simDt, t, this.camera.position, this.weather.windDir, this.weather.wind, time.daylight, (x, z) => this.ocean.heightAt(x, z, t), indoor);
    }
    // свій рибалка за штурвалом — видно лише збоку
    this.updateSelfAvatar(chase, this.photo);
    // вудка в руках: від першої особи — за камерою, збоку — біля плеча аватара
    if (this.fishing.holding) {
      const fp = !chase;
      if (fp) this.fishing.setHandPose(this.camera.position, this.camera.quaternion, true);
      else {
        const av = this.selfAvatar?.worldPos ?? this.player.head;
        this._v4.copy(av).setY(av.y + (this.selfAvatar ? 1.5 : 0));
        this._qHand.setFromEuler(this._eHand.set(0.15, this.player.yaw, 0, 'YXZ'));
        this.fishing.setHandPose(this._v4, this._qHand, false);
      }
    }
    this.fishing.syncVisuals(this.clockDelta, t, this.ocean);
    // риба в руках
    if (this.deckFish.carried) {
      this.deckFish.carryGroup.visible = true;
      if (!chase) {
        this.deckFish.carryGroup.position.copy(this.camera.position);
        this.deckFish.carryGroup.quaternion.copy(this.camera.quaternion);
      } else {
        const av = this.selfAvatar?.worldPos ?? this.player.head;
        this.deckFish.carryGroup.position.copy(av).setY(av.y + 1.45);
        this.deckFish.carryGroup.quaternion.setFromEuler(this._eHand.set(0, this.player.yaw, 0, 'YXZ'));
      }
    }

    // підводне затемнення
    const inWater = !chase && this.player.mode === 'water' && head.y < this.ocean.heightAt(head.x, head.z, t) + 0.15;
    this.underwater.classList.toggle('show', inWater);

    // мінімапа
    const friends = this.coop.active ? this.coop.friendMarkers() : [];
    this.minimap.friends = friends;
    this.mapView.friends = friends;
    this.mapView.buoys = this.nets.markers();
    this.minimap.buoys = this.mapView.buoys;
    this.mapView.bots = this.minimap.bots = this.bots.markers();
    this.minimap.update(this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, time.isNight);
    // відкрита мапа в коопі — друзі й човен рухаються (~4 рази/с)
    if (this.phase === 'map') {
      this.mapRefreshT -= this.clockDelta;
      if (this.mapRefreshT <= 0) {
        this.mapRefreshT = 0.25;
        this.mapView.refresh(this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, g);
      }
    }

    // HUD
    const prompt = this.currentPrompt();
    let fight: FightHud | null = null;
    if (this.fishing.state === 'fight') {
      const f = this.fishing.fightInfo;
      fight = {
        name: g.speciesName(f.speciesId) + ` · ${f.kg.toFixed(f.kg < 1 ? 2 : 1).replace('.', ',')} кг`,
        tension: f.tension,
        limit: f.limit,
        dist: f.dist,
        stamina: f.stamina,
        pull: f.pull,
        lean: f.lean,
        status: f.status,
        jump: f.jump,
        lo: f.lo,
        hi: f.hi,
      };
    }
    this.hud.setCast(this.fishing.state === 'charge' ? this.fishing.castPower : null, this.fishing.status);
    this.hud.setRoster(this.coop.active ? this.coop.roster() : []);
    {
      const atSea = Math.hypot(this.boat.pos.x - this.boat.moor.x, this.boat.pos.z - this.boat.moor.z) > 80;
      const risk = g.insurance < 2 && (g.hold.length > 0 || this.deckFish.count > 0 || Object.values(g.upgrades).some((v) => v > g.insurance));
      const b = this.boat;
      this.hud.setInsWarn(
        b.bilge > 2 ? `🌊 Вода в трюмі ${Math.round(b.bilge)}%` :
        b.hatchOpen && atSea ? '⚠ Люк трюму відкрито' :
        b.doorOpen && atSea && this.weather.intensity > 0.5 ? '⚠ Двері каюти відчинені' :
        atSea && risk ? (g.insurance ? '⚠ Слабка страховка' : '⚠ Без страховки — ризик') : null,
      );
    }
    this.hud.setNight(time.daylight < 0.3);
    this.hud.update(
      g,
      time,
      this.weather,
      this.boat.pos,
      {
        prompt: prompt.text,
        promptBite: prompt.bite,
        promptKey: prompt.key ?? 'E',
        actionLabel: this.stations.active ? this.stations.active.label : null,
        actionProgress: this.stations.progress,
        fight,
        heading: this.boat.heading,
        speedKn: this.boat.vel.length() * 1.944,
        sail: this.player.mode === 'boat' || this.boat.sails.mode !== 0 ? this.boat.sails.hudText() : null,
      },
    );

    // прозора вода: спершу підводна частина сцени (корпус, дно, скелі) у текстуру
    if (!this.underwaterMarked) this.markUnderwater();
    this.ocean.renderRefraction(this.renderer, this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  private underwaterMarked = false;
  /** шар UNDERWATER_LAYER: усе, що сягає нижче ~0.8 м (дно, скелі, палі, буї) + низ яхти + світло */
  private markUnderwater() {
    this.underwaterMarked = true;
    const box = new THREE.Box3();
    this.scene.updateMatrixWorld(true);
    const lowest = (m: THREE.Mesh) => {
      if ((m as THREE.InstancedMesh).isInstancedMesh) {
        const im = m as THREE.InstancedMesh;
        im.computeBoundingBox();
        box.copy(im.boundingBox!).applyMatrix4(im.matrixWorld);
      } else {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      }
      return box.min.y;
    };
    this.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) {
        o.layers.enable(UNDERWATER_LAYER);
        return;
      }
      const m = o as THREE.Mesh;
      if (!m.isMesh || o === this.ocean.mesh) return;
      const mat = m.material as THREE.Material;
      if (!mat || (mat as THREE.Material).transparent || (m.geometry.attributes.position?.count ?? 0) === 0) return;
      if (lowest(m) < 0.8) m.layers.enable(UNDERWATER_LAYER);
    });
    // яхта хитається й кренится: беремо все, що нижче палуби (корпус, кіль, перо, транець)
    const inv = new THREE.Matrix4().copy(this.boat.group.matrixWorld).invert();
    this.boat.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      const mat = m.material as THREE.Material;
      if (box.min.y < 0.9 && !(mat && mat.transparent)) m.layers.enable(UNDERWATER_LAYER);
    });
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

  private applySettings(st: Settings) {
    this.settings = st;
    this.audio.setLevels(st.volume, st.music);
    Input.instance.sens = st.sens;
    Input.instance.invertY = st.invertY;
    this.rig.fovFp = st.fov;
    const pr = Math.max(0.75, Math.min(window.devicePixelRatio, 2) * st.scale);
    if (Math.abs(this.renderer.getPixelRatio() - pr) > 0.01) {
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  private setPhoto(on: boolean) {
    if (on === this.photo) return;
    this.photo = on;
    this.hud.setHidden(on);
    if (on) {
      this.photoYaw = this.player.yaw + Math.PI * 0.8;
      this.photoPitch = -0.15;
      this.hud.photoHint(true);
    } else {
      this.hud.photoHint(false);
    }
  }

  /** який вигляд зараз: заставка — обліт, штурвал — з-за корми (якщо обрано) */
  private updateCamMode(locked: boolean) {
    const dt = this.clockDelta;
    let m: 'fp' | 'chase' | 'orbit' = 'fp';
    if (this.phase === 'intro') m = 'orbit';
    else if (this.photo) m = 'chase';
    else if (this.player.mode === 'boat' && this.player.wheeling && this.chasePref) m = 'chase';
    else if (this.rig.mode === 'chase' && this.phase !== 'play') m = 'chase'; // меню поверх — не стрибаємо
    if (m === 'chase' && this.rig.mode !== 'chase' && !this.photo) {
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
    if (m === 'chase' && !this.photo && locked && this.phase === 'play') {
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
  private updateSelfAvatar(show: boolean, anywhere = false) {
    const p = this.player;
    if (!show || (p.mode !== 'boat' && !anywhere)) {
      this.selfAvatar?.hide();
      return;
    }
    const color = this.coop.active ? this.coop.myColor : 0xf2c12e;
    if (!this.selfAvatar || this.selfColor !== color) {
      this.selfAvatar?.dispose(this.scene);
      this.selfAvatar = new Avatar(this.scene, '', color, this.coop.active ? this.coop.myId : 1);
      this.selfAvatar.showLabel(false);
      this.selfColor = color;
    }
    // у заставці — капітан за штурвалом
    const atWheel = p.wheeling || this.phase === 'intro';
    const w = STATION_POS.wheel;
    if (p.mode !== 'boat') {
      this.selfAvatar.state = { m: p.mode === 'port' ? 1 : 2, x: p.wx, y: p.wy + p.jumpH, z: p.wz, yaw: p.yaw, pitch: 0, wh: 0, mv: 0 };
      this.selfAvatar.update(this.clockDelta, this.boat, this.ocean, this.simTime);
      return;
    }
    this.selfAvatar.state = {
      m: 0,
      x: atWheel ? w.x : p.localX,
      y: atWheel ? BOAT.deckY : p.floorY + p.jumpH,
      z: atWheel ? w.z : p.localZ,
      yaw: atWheel ? this.boat.heading + Math.PI : p.yaw,
      pitch: 0,
      wh: atWheel ? 1 : 0,
      mv: p.moving ? 1 : 0,
    };
    this.selfAvatar.update(this.clockDelta, this.boat, this.ocean, this.simTime);
  }

  private setChart(on: boolean) {
    if (on === this.chartMode) return;
    this.chartMode = on;
    this.chart.setActive(on);
    this.audio.click();
    if (on) {
      // олівець — на кінець маршруту (або на яхту)
      const [cw, ch] = this.chart.size;
      const r = this.game.route;
      const wp = r[r.length - 1];
      let uv = this.mapView.worldToUV(wp?.x ?? this.boat.pos.x, wp?.z ?? this.boat.pos.z, cw, ch);
      if (uv[0] < 0.03 || uv[0] > 0.97 || uv[1] < 0.03 || uv[1] > 0.97) {
        this.mapView.chartView.center(wp?.x ?? this.boat.pos.x, wp?.z ?? this.boat.pos.z);
        uv = this.mapView.worldToUV(wp?.x ?? this.boat.pos.x, wp?.z ?? this.boat.pos.z, cw, ch);
      }
      this.chart.setCursorUV(uv[0], uv[1]);
      this.chart.markDirty();
    }
  }

  private chartClick() {
    const [cw, ch] = this.chart.size;
    const w = this.mapView.uvToWorld(this.chart.u, this.chart.v, cw, ch);
    if (!w || this.mapView.isOnLand(w[0], w[1])) {
      this.hud.toast('Це суша — точку ставлять на воді', 'warn', 1800);
      return;
    }
    if (!this.game.addRoutePoint(w[0], w[1])) {
      this.hud.toast('Маршрут уже на повну — прибери зайві точки (ПКМ)', 'warn', 1800);
      return;
    }
    this.audio.click();
    this.chart.markDirty();
    this.saveGame();
    const n = this.game.route.length;
    const d = Math.hypot(w[0] - this.boat.pos.x, w[1] - this.boat.pos.z);
    this.hud.toast(n === 1 ? `📍 Точка 1 · ${this.mapView.fmtDist(d)}. Курс — на компасі` : `📍 Точка ${n} маршруту`, 'good', 1800);
  }

  /** олівець біля краю паперової карти — карта їде під ним */
  private chartEdgePan(dt: number) {
    const E = 0.06;
    const c = this.chart;
    const ex = c.u < E ? c.u - E : c.u > 1 - E ? c.u - (1 - E) : 0;
    const ey = c.v < E ? c.v - E : c.v > 1 - E ? c.v - (1 - E) : 0;
    if (!ex && !ey) return;
    const [cw, ch] = c.size;
    const before = this.mapView.uvToWorld(c.u, c.v, cw, ch);
    const sp = 900 * dt; // логічні px/с при олівці на самому краю
    this.mapView.chartPan(-(ex / E) * sp, -(ey / E) * sp, cw, ch);
    const after = this.mapView.uvToWorld(c.u, c.v, cw, ch);
    if (before && after && (before[0] !== after[0] || before[1] !== after[1])) c.markDirty();
  }

  /** власник яхти: сітки й буї екіпажу (на зміні та 2 Гц під час постановки/вибирання) */
  private syncNets(dt: number) {
    if (!this.coop.active || this.coop.crewing || this.nets.remote) return;
    this.netsSyncT -= dt;
    const st = this.nets.netState();
    const key = JSON.stringify(st);
    const modeChanged = this.nets.mode !== this.netsSyncMode;
    if (key === this.netsSyncKey && this.netsSyncT > 0) return;
    if (!modeChanged && this.nets.mode !== 'idle' && this.netsSyncT > 0) return;
    this.netsSyncKey = key;
    this.netsSyncMode = this.nets.mode;
    this.netsSyncT = this.nets.mode === 'idle' ? 5 : 0.5;
    this.coop.sendEvent('nets', st);
  }

  private currentPrompt(): { text: string | null; bite: boolean; key?: string } {
    if (this.chartMode) {
      const [cw, ch] = this.chart.size;
      const w = this.mapView.uvToWorld(this.chart.u, this.chart.v, cw, ch);
      const d = w ? ` (${this.mapView.fmtDist(Math.hypot(w[0] - this.boat.pos.x, w[1] - this.boat.pos.z))})` : '';
      return { text: `Точка маршруту${d} · ПКМ — прибрати · коліщатко — зум · E — встати`, bite: false, key: 'ЛКМ' };
    }
    const np = this.player.mode === 'boat' ? this.nets.prompt(this.boat) : null;
    if (np && this.fishing.state !== 'fight' && this.fishing.state !== 'bite') return { text: np, bite: false };
    // боротьба — перш за все
    if (this.fishing.state === 'fight' || this.fishing.state === 'charge') return { text: null, bite: false };
    if (this.fishing.state === 'bite') return { text: 'Клює! Підсікай!', bite: true, key: 'ЛКМ' };
    // станція-дія активна
    if (this.stations.active) return { text: this.stations.active.label, bite: false };
    // риба на палубі / в руках
    if (this.player.mode === 'boat') {
      const near = !this.deckFish.carried && this.deckFish.nearest(this.player.localX, this.player.localZ, 1.2);
      if (near) return { text: `Підняти: ${this.game.speciesName(near.speciesId).toLowerCase()} ${near.kg.toFixed(near.kg < 1 ? 2 : 1).replace('.', ',')} кг`, bite: false };
      if (this.deckFish.carried && this.player.nearest?.id !== 'st:fishbox') return { text: 'Риба в руках — неси до ящика на баку', bite: false };
    }
    // найближча ціль
    if (this.player.nearest) {
      const n = this.player.nearest;
      return { text: n.label, bite: false };
    }
    const fp = this.fishing.prompt();
    if (fp) return { text: fp, bite: false, key: 'ЛКМ' };
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
