import * as THREE from 'three';
import { Input } from './core/input';
import { TimeCycle, DAY_SECONDS } from './core/time';
import { seaMul, Weather } from './core/weather';
import { WORLD, nearestHaven, roughAt, shoreRes } from './core/region';
import { Ocean, UNDERWATER_LAYER } from './core/ocean';
import { AudioEngine } from './core/audio';
import { clamp, rand, formatMoney } from './core/math';
import type { UpgradeId } from './core/types';
import { UPGRADE_BY_ID, MAX_LEVEL, upgradeCost, upgradeLock } from './game/upgrades';
import { GameState, newsText } from './game/state';
import { Boat, BOAT, MOOR, MOOR_HEADING, STATION_POS } from './world/boat';
import { moorSlotX, MOOR_SLOTS } from './net/coop';
import { Port } from './world/port';
import { terrainHeight } from './world/portTerrain';
import { Player, type Interactable } from './world/player';
import { Sky } from './world/sky';
import { SkyEnvironment } from './world/graphics';
import { ParticlePool } from './world/particles';
import { Stations } from './game/stations';
import { Fishing } from './game/fishing';
import { Hud, type FightHud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { MapView } from './ui/map';
import { Dialogs, type Venue } from './ui/dialogs';
import { StatsBoard, statsHtml, type StatsExtra } from './ui/statsBoard';
import { HomeCottage } from './world/homeCottage';
import { COTTAGE } from './world/cottageLayout';
import { zoneFromDist, ZONE_NAMES, FISH, SCHOOL_ANCHORS, SCHOOL_R } from './game/fish';

/** місця швартування й причали інших гаваней (portSites.ts) */
const SITE_BERTHS: Record<string, Berth[]> = Object.fromEntries(PORT_SITES.map((p) => [p.id, siteBerths(p)]));
const SITE_DOCKS: Record<string, Platform> = Object.fromEntries(PORT_SITES.map((p) => [p.id, pierRect(p)]));

/** м'яке навчання: крок → підказка; умова виконання — у Game.updateTutorial */
const TUTORIAL = [
  L('Підійди до штурвала на кормі й натисни E', `Go to the wheel at the stern and press E`),
  L('Виведи яхту з гавані: W — газ, A/D — кермо', `Take the yacht out of the harbour: W — throttle, A/D — rudder`),
  L('Підніми паруси: біля щогли натисни E. Найкраще йти, коли вітер збоку', `Hoist the sails: press E at the mast. It's best to sail with the wind on the beam`),
  L('Візьми вудку з носової стійки (E). Тримай ЛКМ і відпусти в зеленій зоні — закид', `Take a rod from the bow rack (E). Hold LMB and release in the green zone to cast`),
  L('Коли поплавок пірне — клікни ЛКМ. Далі тримай/відпускай Space, щоб натяг був у зеленій зоні; A/D — проти ривка. Рибу з палуби неси в трюм на баку', `When the float goes under — click LMB. Then hold/release Space to keep the tension in the green; A/D — against the pull. Carry fish from the deck to the hold on the foredeck`),
  L('Повертайся в порт і продай улов на рибній біржі (навіс на східній набережній)', `Head back to port and sell your catch at the fish exchange (the awning on the east promenade)`),
];

const ZONE_SUB: Record<string, string> = { shore: L('тихі води біля дому', `quiet waters near home`), mid: L('тут ходить скумбрія', `mackerel roam here`), open: L('далеко від берега', `far from the shore`) };
import { Coop, type BoatAction } from './net/coop';
import { CameraRig } from './world/cameraRig';
import { loadSettings, saveSettings, type Settings } from './game/settings';
import { setPace } from './game/pace';
import { WindLines } from './world/windLines';
import { FoamTrail } from './world/foamTrail';
import { Jellies } from './world/jellies';
import { FishJump } from './world/fishJump';
import { DeckFish } from './world/deckFish';
import { RadioSet, type RadioCtl, type RadioData } from './world/radioSet';
import type { MarketCtx } from './game/market';
import { forecast3 } from './game/forecast';
import { CabinDecor } from './world/cabinDecor';
import { Galley, PAN_POS, TEA_LOOK } from './world/galley';
import { KitchenUI } from './ui/kitchenUI';
import { SailMenu, type SailChoice } from './ui/sailMenu';
import { SAIL_AREA, sailModeLabel, type SailMode } from './world/sails';
import { CabinDoor } from './world/cabinDoor';
import { ChartTable, CHART_CENTER } from './world/chartTable';
import { Nets, type NetsNet } from './world/nets';
import { Bots, botName } from './world/bots';
import { sailEventText } from './world/sails';
import { HelmInstruments, depthAt, bearingDeg } from './world/helmInstruments';
import { instrHas } from './game/upgrades';
import { ShopCounter, type CounterTarget } from './world/shopCounter';
import { ExchangeBoard } from './world/exchangeBoard';
import { BuyerStalls } from './world/buyerStalls';
import { OrdersChip } from './ui/buyers';
import { BUYER_BY_ID, contractTitle, shortName, type BuyerId } from './game/buyers';
import { describeSave } from './game/saveTransfer';
import { Highlighter } from './world/highlight';
import { HOLDER_MOUNTS } from './world/upgradeParts';
import { DECK_Y as Y_DECK, HOUSE as L_HOUSE, RIG as L_RIG, SOLE_Y as Y_SOLE } from './world/yachtLayout';
import { HELM_DZ } from './world/yachtModel';
import { PLANS, applySinkToUpgrades, dailyPremium, type SinkReport } from './game/insurance';
import { Landmarks, LANDMARKS } from './world/landmarks';
import { Islands, FINDS } from './world/islands';
import { ISLANDS, islandNear } from './world/islandShape';
import { seabedDepth, ANCHOR_MAX_DEPTH, type AnchorResult } from './world/anchor';
import { HATS, HAT_BY_ID } from './game/hats';
import { Ports } from './world/ports';
import { PORT_SITES, PORT_SITE_BY_ID, PORT_SERVICE_HANDLERS, pierRect, siteBerths, type Berth } from './world/portSites';
import type { Platform } from './world/port';
import { Avatar } from './world/avatar';
import './styles.css';
import { L } from './core/i18n';

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
  /** приціл-точка в центрі екрана: росте в кільце, коли є з чим взаємодіяти */
  private reticle: HTMLElement;
  private reticleCls = '';

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
  private tiltFollow = 0.3;
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
  private jellies: Jellies;
  private fishJump: FishJump;
  /** стрибок риби під час боротьби */
  private leapJump: FishJump;
  /** риба, що вистрибує над стаєю з радіозвіту */
  private schoolJumps: FishJump[] = [];
  private schoolJumpT = 2;
  private _jFrom = new THREE.Vector3();
  private _jTo = new THREE.Vector3();
  private deckFish: DeckFish;
  private radio!: RadioSet;
  private cabinDecor!: CabinDecor;
  /** камбуз: чайник, книга рецептів, пательня (world/galley.ts) і міні-ігри (ui/kitchenUI.ts) */
  private galley!: Galley;
  private kitchen!: KitchenUI;
  private sailMenu!: SailMenu;
  /** меню парусів відкрите в цьому кадрі — ЛКМ не закидає вудку */
  private sailMenuFrame = false;
  private shopCounter!: ShopCounter;
  private exchangeBoard!: ExchangeBoard;
  private stalls!: BuyerStalls;
  private ordersChip!: OrdersChip;
  private ordersT = 0;
  private cabinDoor!: CabinDoor;
  private chart!: ChartTable;
  /** прилади штурвала (апгрейд «Прилади») */
  private instruments!: HelmInstruments;
  private apHold = 0;
  private apPrevH = 0;
  private shallowToastT = 0;
  /** сітки (апгрейд «Сітки»): буї в морі, постановка/вибирання з корми */
  private nets!: Nets;
  /** місцеві рибалки на човнах (боти) */
  private bots!: Bots;
  private stormWarned = false;
  private localStormWarned = false;
  private inRough = false;
  private netsSyncT = 0;
  private netsSyncKey = '';
  private netsSyncMode = 'idle';
  /** гравець схилився над штурманським столом */
  private chartMode = false;
  /** ПКМ над картою: скільки протягнуто (−1 — не затиснута) */
  private chartDrag = -1;
  private chartK = 0;
  private _chEye = new THREE.Vector3();
  private _chAt = new THREE.Vector3();
  private _chUp = new THREE.Vector3();
  private _chQ = new THREE.Quaternion();
  private _chM = new THREE.Matrix4();
  private doorWarnT = 0;
  /** якір: спроба авто-віддачі на березі, попередження про дрейф, попередній стан */
  private anchorAuto = false;
  private anchorWarnT = 0;
  private anchorPrev = 0;
  private radioRoom = 0;
  private cottage: HomeCottage;
  private statsBoard: StatsBoard;
  /** лоція для журналу (той самий малюнок, що на штурманському столі) */
  private statsChart = Object.assign(document.createElement('canvas'), { width: 1100, height: 776 });
  /** попередня позиція човна для лічильника шляху */
  private ledgerPrev: [number, number] | null = null;
  private radioTextT = 0;
  /** орган радіо, на який дивиться гравець (кнопка/ручка) */
  private radioCtl: RadioCtl | null = null;
  private hl = new Highlighter();
  private _hv = new THREE.Vector3();
  private _ray = new THREE.Raycaster();
  private _c0 = new THREE.Vector2();
  private landmarks: Landmarks;
  private islands: Islands;
  /** інші гавані світу (world/ports.ts) */
  private ports: Ports;
  /** місце швартування вдома (x на причалі «Шторму» — за слотом флотилії) */
  private homeMoorX = MOOR.x;
  /** причал поточного місця швартування (сходня, зіткнення корпусу) */
  private moorDock!: Platform;
  /** гавань, біля якої поточне місце швартування ('home' — «Шторм») */
  private moorSite = 'home';
  /** гавань, у якій ти зараз (для напису при прибутті) */
  private atSite: string | null = 'home';
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
    // хата рибалки: заходиш пішки — ліжко й «журнал капітана» на стіні
    this.statsBoard = new StatsBoard();
    this.cottage = new HomeCottage(this.port.group, this.statsBoard.tex);
    this.port.setCottage(this.cottage.solids, this.cottage.chimneyTop);
    this.shopCounter = new ShopCounter(this.scene, this.port.solids);
    this.exchangeBoard = new ExchangeBoard(this.scene);
    // прибій уздовж берега бухти
    // мапа дна на весь світ (2 м/піксель, у більшому світі — грубіше: region.ts shoreRes): мілини й прибій біля всіх берегів, островів і гаваней
    this.ocean.setShore(terrainHeight, WORLD.W0, WORLD.H0, WORLD.W1 - WORLD.W0, WORLD.H1 - WORLD.H0, shoreRes());
    this.particles = new ParticlePool(this.scene, 1100);
    this.windLines = new WindLines(this.scene);
    this.foamTrail = new FoamTrail(this.scene);
    this.jellies = new Jellies(this.scene);
    this.fishJump = new FishJump(this.scene);
    this.leapJump = new FishJump(this.scene);
    for (let i = 0; i < 3; i++) this.schoolJumps.push(new FishJump(this.scene));
    this.scene.add(this.moorMark);
    this.landmarks = new Landmarks(this.scene, this.port.rocks);
    this.islands = new Islands(this.scene);
    // скупники риби — після островів (хижа Остапа шукає вільне місце серед дерев)
    this.stalls = new BuyerStalls(this.scene, this.port);
    this.ordersChip = new OrdersChip();
    this.ports = new Ports(this.scene, this.port.platforms, this.port.solids);
    this.moorDock = this.port.quay;
    this.boat = new Boat(this.scene);
    this.boat.landAt = terrainHeight;
    this.player = new Player(this.game);
    this.stations = new Stations(this.boat, this.game, this.audio);
    this.fishing = new Fishing(this.scene, this.audio, this.boat);
    this.deckFish = new DeckFish(this.scene, this.boat);
    this.radio = new RadioSet(this.boat.group);
    this.cabinDecor = new CabinDecor(this.boat.group);
    this.galley = new Galley(this.boat.group);
    // кухоль у руках — дитина камери: камера має бути в сцені
    if (!this.camera.parent) this.scene.add(this.camera);
    const self = this;
    this.kitchen = new KitchenUI({
      // гра змінюється (нова / завантажена) — беремо поточну
      get game() {
        return self.game;
      },
      galley: this.galley,
      audio: this.audio,
      camera: this.camera,
      toast: (m, k, ms) => this.hud.toast(m, k ?? 'good', ms),
      roll: () => this.boat.roll,
      panelOpened: () => {
        this.phase = 'dialog';
        this.expectUnlock = true;
        document.exitPointerLock();
      },
      panelClosed: () => {
        this.expectUnlock = false;
        this.escSwallow = true;
        if (this.phase === 'dialog') {
          this.phase = 'play';
          this.requestLock();
        }
      },
      save: () => this.saveGame(),
      cookFishInHold: (f) => this.game.holdHook?.('cook', f),
    });
    this.cabinDoor = new CabinDoor(this.boat.group);
    this.chart = new ChartTable(this.boat.group);
    {
      const mats = new Map<string, THREE.MeshStandardMaterial>();
      this.instruments = new HelmInstruments(this.boat.group, this.boat.panelParts, {
        mat: (c, r = 0.8, m = 0.05) => {
          const k = `${c}|${r}|${m}`;
          let mt = mats.get(k);
          if (!mt) mats.set(k, (mt = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m })));
          return mt;
        },
      });
      this.instruments.onShallow = (d) => {
        this.audio.instrBeep('shallow');
        this.shallowToastT -= 1;
        if (this.shallowToastT <= 0) {
          this.shallowToastT = 6;
          this.hud.toast(L(`⚠ Мілина! Під кілем ${d.toFixed(1).replace('.', L(',', '.'))} м`, `⚠ Shallows! ${d.toFixed(1).replace('.', L(',', '.'))} m under the keel`), 'bad', 2200);
        }
      };
    }
    this.nets = new Nets(this.scene);
    this.bots = new Bots(this.scene, this.port.platforms, this.port.rocks);
    this.bots.onChatter = (name, text) => this.hud.toast(`📻 «${name}»: ${text}`, 'warn', 4200);
    // жива біржа: бот пришвартувався — здає улов (чим довше ловив, тим більшу частку «пулу» зони)
    this.bots.onUnload = (name, zr, sec) => {
      const zones = [...new Set([zoneFromDist(zr[0]), zoneFromDist(zr[1])])];
      const text = this.game.botUnload(name, zones, Math.min(0.85, 0.3 + sec / 500));
      if (text) this.marketNewsToast(name, text);
    };
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
    this.deckFish.onWashed = (f) => this.hud.toast(L(`🌊 Хвиля змила за борт: ${this.game.speciesName(f.speciesId)}! Клади рибу в ящик одразу.`, `🌊 A wave washed it overboard: ${this.game.speciesName(f.speciesId)}! Put fish in the box right away.`), 'bad', 4000);
    this.player.onJump = () => this.audio.step(this.player.mode === 'boat' ? 0 : 2, true);
    this.player.stationText = (id) =>
      id === 'anchor'
        ? this.anchorLabel()
        : id === 'radio'
        ? this.radio.label(this.radioCtl)
        : id === 'fishbox'
        ? !this.boat.hatchOpen
          ? L(`Відкрити люк трюму (${this.game.hold.length}/${this.game.holdCap})${this.deckFish.carried ? L(' й покласти рибу', ` and put the fish in`) : ''}`, `Open the hold hatch (${this.game.hold.length}/${this.game.holdCap})${this.deckFish.carried ? L(' й покласти рибу', ` and put the fish in`) : ''}`)
          : this.deckFish.carried
            ? L(`Покласти в трюм: ${this.game.speciesName(this.deckFish.carried.fish.speciesId).toLowerCase()} (${this.game.hold.length}/${this.game.holdCap})`, `Put in the hold: ${this.game.speciesName(this.deckFish.carried.fish.speciesId).toLowerCase()} (${this.game.hold.length}/${this.game.holdCap})`)
            : L('Закрити люк трюму', `Close the hold hatch`)
        : id === 'nets'
        ? this.nets.stationLabel(this.game.upgrades.nets ?? 0, this.boat)
        : id === 'kettle'
        ? this.kitchen.kettleLabel()
        : id === 'kitchen'
        ? this.kitchen.stoveLabel()
        : id === 'cookbook'
        ? this.kitchen.bookLabel()
        : this.fishing.stationLabel(id);

    this.coop = new Coop(this.scene, {
      onAction: (nick, act) => this.onCoopAction(nick, act),
      onEvent: (e, v) => this.onCoopEvent(e, v),
      onChat: (nick, text, color) => this.hud.chatLine(nick, text, color),
      onPeer: (nick, joined) => {
        this.hud.toast(joined ? L(`👋 ${nick} на борту`, `👋 ${nick} is aboard`) : L(`${nick} — поза грою`, `${nick} — left the game`), joined ? 'good' : 'warn', 3500);
        this.audio.click();
      },
      onClosed: (reason) => this.onCoopClosed(reason),
    });
    this.coop.botState = () => this.bots.netState();
    this.coop.onBots = (a) => this.bots.applyNet(a);
    // жива біржа: запаси симулює капітан кімнати, гості отримують знімок і шлють йому свої продажі
    this.coop.marketState = () => this.game.marketSnapshot();
    this.coop.onMarket = (d) => {
      for (const n of this.game.applyMarketSnapshot(d)) this.marketNewsToast(n.who, newsText(n.text, n.who));
    };
    this.coop.onMarketSale = (portId, sp, u) => this.game.marketOf(portId).addStock(sp, u);

    this.hud = new Hud();
    this.sailMenu = new SailMenu(document.getElementById('hud') ?? document.body);
    this.minimap = new Minimap();
    this.mapView = new MapView();
    this.mapView.onRouteChange = () => {
      this.audio.click();
      this.chart.markDirty();
      this.saveGame();
    };
    this.mapView.onClose = () => this.closeMap();
    this.dialogs = new Dialogs(this.audio);
    this.dialogs.onTrade = () => this.saveGame();
    this.dialogs.buyerExtra = (id, panel, refresh) => this.kitchen.buyerSection(id, panel, refresh);
    // кулінарна лавка Сонячної Марини (portSites: svc 'cookshop')
    PORT_SERVICE_HANDLERS.cookshop = () => this.kitchen.openMarinaShop();

    this.reticle = document.createElement('div');
    this.reticle.id = 'reticle';
    document.body.appendChild(this.reticle);

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
      this.hud.toast(L(`Удар! Міцність −${Math.round(power * 6)}`, `Impact! Hull −${Math.round(power * 6)}`), 'bad');
      this.audio.thump(power / 6);
      this.coop.sendEvent('hit', power);
    };
    // легкий удар хвилі — плеск, тим гучніший, чим сильніший удар
    this.boat.onWaveHit = (power) => this.audio.splash(Math.min(0.7, 0.12 + power * 0.18));
    this.boat.onSlam = (dmg, kind, power) => {
      this.slamShake = Math.min(1, 0.35 + power * 0.08);
      this.audio.thump(Math.min(1, power / 6));
      this.audio.splash(Math.min(1, 0.5 + power * 0.1));
      if (dmg >= 1) {
        const tip = this.slamTipT <= 0;
        if (tip) this.slamTipT = 25;
        const msg = kind === 'bow'
          ? L(`💥 Ніс ляснув об хвилю! Корпус −${Math.round(dmg)}${tip ? L(' · скинь газ і бери хвилю під кутом 20–40°', ` · ease the throttle and take the wave at 20–40°`) : ''}`, `💥 The bow slammed into a wave! Hull −${Math.round(dmg)}${tip ? L(' · скинь газ і бери хвилю під кутом 20–40°', ` · ease the throttle and take the wave at 20–40°`) : ''}`)
          : L(`🌊 Гребінь ударив у борт! Корпус −${Math.round(dmg)}${tip ? L(' · не стій лагом до хвилі — розвернись носом', ` · don't sit beam-on to the waves — turn your bow into them`) : ''}`, `🌊 A crest hit the side! Hull −${Math.round(dmg)}${tip ? L(' · не стій лагом до хвилі — розвернись носом', ` · don't sit beam-on to the waves — turn your bow into them`) : ''}`);
        this.hud.toast(msg, 'bad', tip ? 5000 : 2500);
        this.coop.sendEvent('slam', [Math.round(dmg), kind === 'bow' ? 1 : 2, Math.round(power * 10) / 10]);
      } else {
        this.coop.sendEvent('slam', [0, kind === 'bow' ? 1 : 2, Math.round(power * 10) / 10]);
      }
    };
    this.boat.sails.onEvent = (msg, kind, id) => {
      this.hud.toast(msg, kind, 4000);
      // екіпажу — номер події: кожен читає своєю мовою
      this.coop.sendEvent('toast', [`#sail${id}`, kind]);
    };
    this.fishing.onEvent = (msg, kind) => this.hud.toast(msg, kind, 4500);
    // вода для закиду з берега: не суходіл, не настил причалу й не корпус яхти
    this.fishing.waterAt = (x, z) =>
      terrainHeight(x, z) < -0.5 &&
      !this.port.platforms.some((p) => x > p.x0 - 0.4 && x < p.x1 + 0.4 && z > p.z0 - 0.4 && z < p.z1 + 0.4) &&
      Math.hypot(x - this.boat.pos.x, z - this.boat.pos.z) > 5;
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
      this.hud.toast(L('Хвиля заглушила двигун! Запусти його на двигунній (E)', `A wave stalled the engine! Restart it at the engine (E)`), 'bad');
      this.audio.snap();
      this.coop.sendEvent('stall');
    };
    this.boat.onSunk = () => this.handleSunk();
    this.boat.onDockPump = () => this.hud.toast(L('⚓ У порту воду з трюму відкачують з причалу — пришвартована яхта не потоне (на якорі — може!)', `⚓ In port the bilge is pumped out from the pier — a moored yacht won't sink (at anchor it can!)`), 'good', 3500);
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
          this.hud.toast(L(`👥 Кімната ${this.coop.room} відкрита. Код і посилання — у меню (Esc).`, `👥 Room ${this.coop.room} is open. The code and the link are in the menu (Esc).`), 'good', 9000);
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
    this.homeMoorX = this.boat.moor.x = moorSlotX(owner);
    this.boat.reset(this.homeMoorX, MOOR.z, MOOR_HEADING);
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
      if (p.patch) this.coop.sendAction({ a: 'repair', v: p.patch });
      if (p.upgrade) this.coop.sendAction({ a: 'upgrade', id: p.upgrade });
    };
    this.prevObjectives = { ...this.game.objectives };
    this.lastDay = this.time.dayCount;
    this.lastWeather = this.weather.state();
    this.phase = 'play';
    this.requestLock();
    this.hud.flashHints();
    const cap = this.coop.nickOf(owner);
    this.hud.toast(L(`👥 Ти на яхті ${cap} в екіпажі. Трюм спільний: хто продав рибу — тому й гроші.`, `👥 You're crew on yacht ${cap}. The hold is shared: whoever sells the fish gets the money.`), 'good', 7000);
    if (!keepWorld) this.hud.toast(L('Enter — чат з екіпажем', `Enter — chat with the crew`), 'warn', 6000);
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
    this.homeMoorX = this.boat.moor.x = moorSlotX(this.coop.myId);
    this.boat.reset(this.homeMoorX, MOOR.z, MOOR_HEADING);
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
    this.hud.toast(L(`⛵ Ти на своїй яхті — місце ${MOOR_SLOTS.indexOf(this.boat.moor.x) + 1} біля причалу. Друзі можуть піднятися на борт через меню (Esc).`, `⛵ You're on your own yacht — berth ${MOOR_SLOTS.indexOf(this.boat.moor.x) + 1} at the pier. Friends can come aboard via the menu (Esc).`), 'good', 7000);
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
    setPace(this.settings.pace); // знову свій темп, а не господаря
    this.hud.setRoster([]);
    if (wasCrew) {
      this.endCrew();
      this.showIntro();
    } else {
      this.phase = 'play';
      this.requestLock();
      this.hud.toast(L('Кімнату закрито — граєш сам.', `The room is closed — you're playing solo.`), 'warn');
    }
  }

  /** пауза → головне меню: зберегти, вийти з кімнати (якщо в ній), показати заставку */
  private exitToMenu() {
    this.saveGame();
    if (this.coop.active) {
      const wasCrew = this.coop.isClient;
      this.coop.leave();
      this.hud.setRoster([]);
      if (wasCrew) this.endCrew();
    }
    this.showIntro();
  }

  /** капітан: дія гостя над спільним човном */
  private onCoopAction(nick: string, act: BoatAction) {
    const g = this.game;
    switch (act.a) {
      case 'sails': {
        const sr = this.boat.sails;
        // v: 0..3 — рівень з меню; 10/11 — генакер увімк./вимк.; без v — старий цикл
        if (act.v === 10 || act.v === 11) {
          sr.gennOff = act.v === 11;
          this.hud.toast(`⛵ ${nick}: ${act.v === 10 ? L('генакер готовий', `gennaker ready`) : L('генакер прибрано', `gennaker stowed`)}`, 'good', 2200);
          break;
        }
        const m = act.v != null && act.v >= 0 && act.v <= 3 ? (sr.mode = act.v as SailMode) : sr.cycle();
        this.hud.toast(`⛵ ${nick}: ${L('паруси', `sails`)} — ${sr.label()}`, m === 0 ? 'warn' : 'good', 2200);
        break;
      }
      case 'engine':
        this.boat.restartEngine();
        this.hud.toast(L(`${nick}: двигун запущено`, `${nick}: engine started`), 'good');
        break;
      case 'repair':
        g.repair(Math.min(25, Math.max(0, act.v)));
        this.hud.toast(L(`🔧 ${nick}: корпус підлатано`, `🔧 ${nick}: hull patched`), 'good');
        break;
      case 'fuel':
        g.addFuel(Math.max(0, act.v));
        this.hud.toast(L(`⛽ ${nick}: +${Math.round(act.v)} л пального`, `⛽ ${nick}: +${Math.round(act.v)} l of fuel`), 'good');
        break;
      case 'hullFull':
        g.hull = g.maxHull;
        this.hud.toast(L(`🔧 ${nick}: ремонт корпусу оплачено`, `🔧 ${nick}: hull repair paid`), 'good');
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
      case 'tent':
        this.game.tentFolded = act.v === 1;
        if (act.v === 1) this.game.tentClosed = false;
        break;
      case 'curtain':
        this.game.tentClosed = act.v === 1 && !this.game.tentFolded;
        break;
      case 'anchor':
        this.anchorResult(this.boat.anchor.toggle(this.boat), nick);
        break;
      case 'ign':
        this.ignitionResult(this.boat.toggleIgnition(), nick);
        break;
      case 'ap':
        this.setAutopilot(act.v === 1, act.v === 1 ? '' : nick);
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
          if (id === 'tent') {
            g.tentFit = null;
            g.tentFolded = false;
          }
          this.syncUpgrades();
          this.hud.toast(L(`🛠 ${nick}: нова прокачка човна`, `🛠 ${nick}: a new boat upgrade`), 'good');
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
        if (dmg >= 1) this.hud.toast(k === 1 ? L(`💥 Ніс ляснув об хвилю! Корпус −${dmg}`, `💥 The bow slammed into a wave! Hull −${dmg}`) : L(`🌊 Гребінь ударив у борт! Корпус −${dmg}`, `🌊 A crest hit the side! Hull −${dmg}`), 'bad', 2500);
        break;
      }
      case 'hit': {
        const power = Number(v) || 1;
        this.hud.toast(L(`Удар! Міцність −${Math.round(power * 6)}`, `Impact! Hull −${Math.round(power * 6)}`), 'bad');
        this.audio.thump(power / 6);
        break;
      }
      case 'stall':
        this.hud.toast(L('Хвиля заглушила двигун! Запусти його на двигунній (E)', `A wave stalled the engine! Restart it at the engine (E)`), 'bad');
        this.audio.snap();
        break;
      case 'toast': {
        const [msg, kind] = v as [string, 'good' | 'bad' | 'warn'];
        const m = /^#sail(\d+)$/.exec(String(msg));
        this.hud.toast(m ? sailEventText(Number(m[1])) : String(msg), kind, 4000);
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
        this.hud.toast(L(`Затоплення! Втрачено риби: ${r.lostFish}${r.payout ? L(`, страхова виплата +${r.payout} ₴`, `, insurance payout +${r.payout} ₴`) : L(' — не застраховано', ` — not insured`)}.`, `Sunk! Fish lost: ${r.lostFish}${r.payout ? L(`, страхова виплата +${r.payout} ₴`, `, insurance payout +${r.payout} ₴`) : L(' — не застраховано', ` — not insured`)}.`), 'bad', 7000);
        break;
      }
      case 'sleep':
        this.hud.toast(L('Капітан спить — ніч минула.', `The captain is asleep — the night is over.`), 'warn', 3500);
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
    this.boat.reset(this.homeMoorX, MOOR.z, MOOR_HEADING);
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
    this.hud.toast(L('Вітаємо на борту «Шторму»! Море чекає.', `Welcome aboard the “Storm”! The sea is waiting.`), 'good', 6000);
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
    let bx = data.boatX ?? this.homeMoorX, bz = data.boatZ ?? MOOR.z, bh = data.boatHeading ?? MOOR_HEADING;
    const dock = this.port.quay;
    if (bx > dock.x0 && bx < dock.x1 && bz > dock.z0 && bz < dock.z1) {
      bx = this.homeMoorX; bz = MOOR.z; bh = MOOR_HEADING;
    }
    // сейв із меншого світу: у гавані — на причал тієї ж гавані, у морі — та сама відносна точка, якщо там вода
    let relocated = false;
    if (data.relocate) {
      const site = PORT_SITES.find((p) => Math.hypot(p.x - bx, p.z - bz) < 200);
      if (site) {
        const b = this.berthIn(site.id);
        bx = b.x; bz = b.z; bh = b.h; relocated = true;
      } else if (Math.hypot(bx, bz) < 220 || terrainHeight(bx, bz) > -2.5) {
        bx = this.homeMoorX; bz = MOOR.z; bh = MOOR_HEADING; relocated = true;
      }
    }
    this.boat.reset(bx, bz, bh);
    const an = data.anchor;
    if (!relocated && an && Number.isFinite(an.x) && Number.isFinite(an.z) && Number.isFinite(an.chain) && seabedDepth(an.x, an.z) <= ANCHOR_MAX_DEPTH + 5) this.boat.anchor.setDown(an.x, an.z, an.chain);
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
    this.hud.toast(L('Завантажено. Знову в море!', `Loaded. Back to sea!`), 'good');
  }

  private syncUpgrades() {
    this.boat.applyUpgrades(this.game.fittedUpgrades(), this.time.daylight);
    this.fishing.setOwned(this.game.upgrades.holders ?? 0);
    this.hl.invalidate();
  }

  private handleSunk() {
    const g = this.game;
    const r = this.applySink(true);
    // новий човен — у найближчій відомій гавані з верф'ю
    const sp = this.rescuePort(this.boat.pos.x, this.boat.pos.z);
    this.boat.reset(sp.berth.x, sp.berth.z, sp.berth.h);
    g.portId = sp.id;
    if (sp.id !== 'home') this.hud.toast(L(`🛟 Рятувальники відбуксирували тебе до гавані «${PORT_SITE_BY_ID[sp.id].name}»`, `🛟 Rescuers towed you to “${PORT_SITE_BY_ID[sp.id].name}” harbour`), 'warn', 6000);
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

  /** меші станції яхти: [ключ підсвітки, об'єкти] — їх підсвічуємо і в них цілиться промінь погляду */
  private stationObjects(id: string): [string, THREE.Object3D[] | null] {
    const near = (key: string, x: number, y: number, z: number, r: number, max: number) =>
      this.hl.near(key, this.boat.group, this._hv.set(x, y, z), r, max, (o) => {
        // вудки рухаються (руки/стійки) — їх додаємо окремо
        for (let q: THREE.Object3D | null = o; q; q = q.parent) if (q.userData.rod) return true;
        return false;
      });
    if (id === 'st:fishbox') return [id, [this.deckFish.hatch]];
    if (id === 'st:autopilot') return [id + (this.boat.autopilot ? '1' : '0'), [this.instruments.apButton]];
    if (id === 'st:nets') {
      const key = id + (this.game.upgrades.nets ?? 0);
      return [key, near(key, 0.6, 0.95, -4.95, 0.8, 1.4)];
    }
    if (id === 'st:anchor') return [id, near(id, 0, Y_DECK + 0.12, 4.1, 0.35, 0.5)];
    if (id === 'st:tent' || id === 'st:curtain') return [id + this.boat.tentLevel, id === 'st:tent' ? this.boat.canvas.foldObjects : this.boat.canvas.curtainObjects];
    if (id === 'st:door') return [id, [this.cabinDoor.group]];
    if (id === 'st:rod') return [id + this.fishing.rackObjects().length, [...this.fishing.rackObjects(), ...near('rack', 0.42, Y_DECK + 0.2, 3.76, 0.2, 0.6)]];
    if (id.startsWith('st:holder')) {
      const h = Number(id.slice(9));
      const m = HOLDER_MOUNTS[h].base;
      const rod = this.fishing.holderObject(h);
      return [id + (rod ? 'r' : ''), [...near('holder' + h + this.game.upgrades.holders, m[0], m[1] + 0.2, m[2], 0.35, 0.8), ...(rod ? [rod] : [])]];
    }
    if (id === 'st:wheel') return [id, near('wheel', 0, Y_DECK + 0.75, -3.38 + HELM_DZ, 0.55, 1.6)];
    if (id === 'st:engine' || id === 'st:pump') return [id, near(id, id === 'st:engine' ? 0.62 : -0.62, Y_DECK + 0.05, -4.05, 0.3, 0.9)];
    if (id === 'st:sails') return [id, near('sails', 0, L_HOUSE.top + 0.15, L_RIG.mastZ - 0.3, 0.6, 0.7)];
    if (id === 'st:kitchen') return [id, near('kitchen', -0.82, Y_SOLE + 1.0, 1.25, 0.3, 0.6)];
    if (id === 'st:kettle') return [id, [this.galley.kettle]];
    if (id === 'st:cookbook') return [id, [this.galley.book]];
    if (id === 'st:bed') return [id, near('bed', 0, Y_SOLE + 0.45, 3.2, 0.8, 2.2)];
    return ['', null];
  }

  private _pickBox = new THREE.Box3();
  private _pickBox2 = new THREE.Box3();
  private _pickV = new THREE.Vector3();
  private _mast: THREE.Object3D[] | null = null;
  private mastMesh(): THREE.Object3D[] {
    if (!this._mast) {
      const m = this.boat.group.getObjectByName('mast');
      this._mast = m ? [m] : [];
    }
    return this._mast;
  }

  /** від першої особи станція — лише та, у яку влучає промінь із центру екрана */
  private pickStation() {
    const p = this.player;
    if (p.mode !== 'boat' || p.wheeling || this.rig.mode !== 'fp') return;
    this._ray.setFromCamera(this._c0, this.camera);
    this._ray.far = 3.2;
    let best: Interactable | null = null;
    let bestD = Infinity;
    // промінь «бачить» і приховані меші (спущений парус, складений тент) — їх не рахуємо
    const shown = (o: THREE.Object3D) => {
      for (let q: THREE.Object3D | null = o; q; q = q.parent) if (!q.visible) return false;
      return true;
    };
    for (const s of p.reachable) {
      // радіо й штурманський стіл — цілком (дрібний орган радіо вибирає radio.aim);
      // паруси — ще й щогла, гік і самі паруси, а не лише фали біля щогли
      const objs =
        s.id === 'st:radio' ? [this.radio.group]
        : s.id === 'st:chart' ? [this.chart.group]
        : s.id === 'st:sails' ? [...(this.stationObjects(s.id)[1] ?? []), ...this.boat.sails.pickables(), ...this.mastMesh()]
        : this.stationObjects(s.id)[1];
      if (!objs) continue;
      const hit = this._ray.intersectObjects(objs, true).find((h) => shown(h.object));
      let d = hit ? hit.distance : Infinity;
      // дрібна станція (тонка рукоять помпи, кнопка, тримач) — рахуємо й промах на кілька сантиметрів
      if (!hit) {
        const box = this._pickBox.makeEmpty();
        for (const o of objs) o.traverse((m) => {
          if ((m as THREE.Mesh).isMesh && shown(m)) box.union(this._pickBox2.setFromObject(m));
        });
        if (!box.isEmpty() && box.getSize(this._pickV).length() < 0.8 && this._ray.ray.intersectBox(box.expandByScalar(0.08), this._pickV)) {
          d = this._pickV.distanceTo(this._ray.ray.origin);
          if (d > this._ray.far) d = Infinity;
        }
      }
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    // зійти на берег — не станція, лишається за дальністю
    if (best || p.nearest?.id !== 'go-ashore') p.nearest = best;
  }

  /** над стаєю з радіозвіту риба вистрибує з води раз на ~2 с — видно, де клює */
  private updateSchoolJumps(dt: number, t: number) {
    for (const j of this.schoolJumps) {
      const was = j.busy;
      j.update(dt, t);
      if (was && !j.busy) {
        const l = j.landing;
        this.particles.splash(l.x, l.y + 0.2, l.z, 0.35);
      }
    }
    this.schoolJumpT -= dt;
    if (this.schoolJumpT > 0) return;
    this.schoolJumpT = 1.5 + Math.random();
    const cam = this.camera.position;
    const r = this.game.reports.find((r) => {
      const [ax, az] = SCHOOL_ANCHORS[r.zone];
      return Math.hypot(ax - cam.x, az - cam.z) < SCHOOL_R;
    });
    const jump = this.schoolJumps.find((j) => !j.busy);
    if (!r || !jump) return;
    const a = Math.random() * Math.PI * 2;
    const d = 8 + Math.random() * 30;
    const x = cam.x + Math.cos(a) * d;
    const z = cam.z + Math.sin(a) * d;
    // не з-під корпусу й не з суходолу
    if (Math.hypot(x - this.boat.pos.x, z - this.boat.pos.z) < 6 || terrainHeight(x, z) > -1.5 || islandNear(x, z, 5)) return;
    const y = this.ocean.heightAt(x, z, t);
    const h = Math.random() * Math.PI * 2;
    const len = 1.2 + Math.random() * 1.5;
    this._jFrom.set(x, y - 0.2, z);
    this._jTo.set(x + Math.cos(h) * len, y - 0.3, z + Math.sin(h) * len);
    jump.start(r.speciesId, 0.4 + Math.random() * 1.5, this._jFrom, this._jTo, true);
    this.particles.splash(x, y + 0.1, z, 0.5);
    this.audio.splash(Math.max(0.05, 0.35 - d * 0.008));
  }

  /** підсвітка того, з чим зараз взаємодієш (E) */
  private updateHighlight(t: number) {
    const p = this.player;
    let key = '';
    let objs: THREE.Object3D[] | null = null;
    if (this.phase === 'play' && !this.dialogs.isOpen && !this.kitchen.active && !p.wheeling && p.mode === 'boat') {
      const fish = !this.deckFish.carried && this.deckFish.nearest(p.localX, p.localZ, 1.2);
      const id = p.nearest?.id ?? '';
      if (fish) {
        key = 'fish:' + fish.uid;
        objs = [this.deckFish.meshOf(fish)!].filter(Boolean);
      } else if (id === 'st:radio') {
        // підсвічуємо лише орган, на який дивишся (вимкнене радіо — кнопку живлення)
        const o = this.radio.object(this.radioCtl ?? (this.radio.on ? 'tune' : 'power'));
        key = id + ':' + (this.radioCtl ?? (this.radio.on ? '' : 'power'));
        objs = o && (this.radioCtl || !this.radio.on) ? [o] : null;
      } else {
        [key, objs] = this.stationObjects(id);
      }
    }
    if (this.phase === 'play' && !this.dialogs.isOpen && p.mode === 'port' && p.nearest?.id.startsWith('shop:')) {
      key = p.nearest.id + ':' + (this.game.upgrades[p.nearest.id.slice(8) as keyof typeof this.game.upgrades] ?? '');
      const o = this.shopCounter.objectOf(p.nearest.id.slice(5) as CounterTarget);
      objs = o ? [o] : null;
    }
    this.hl.set(key, objs && objs.length ? objs : null);
    this.hl.update(t);
    // радіо ввімкнене, але погляд не на кнопці/ручці — проста точка (наводься точніше)
    this.updateReticle((!!key || !!p.nearest) && !(p.nearest?.id === 'st:radio' && this.radio.on && !this.radioCtl));
  }

  /** приціл: лише від першої особи в грі; кільце — є ціль, менше кільце — дрібний орган (кнопка радіо) */
  private updateReticle(target: boolean) {
    const show = this.phase === 'play' && Input.instance.pointerLocked && this.rig.mode === 'fp' && !this.photo && !this.chartMode && !this.hud.hidden && !this.dialogs.isOpen && !this.player.wheeling;
    const cls = !show ? '' : this.radioCtl ? 'on fine' : target ? 'on target' : 'on';
    if (cls === this.reticleCls) return;
    this.reticleCls = cls;
    this.reticle.className = cls;
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
      // каса — каталог крамниці; поліс оформлюють у конторі порту
      this.openDialog(t === 'register' ? 'shop' : 'office');
      return;
    }
    const id = t.slice(3) as UpgradeId;
    const u = UPGRADE_BY_ID[id];
    if (g.upgrades[id] >= MAX_LEVEL) {
      this.hud.toast(L(`${u.name}: усе вже стоїть на човні`, `${u.name}: everything is already on the boat`), 'warn', 2200);
      return;
    }
    const cost = upgradeCost(id, g.upgrades[id]) ?? 0;
    const lock = upgradeLock(id, g.upgrades);
    if (lock) {
      this.hud.toast(`🔒 «${u.parts[g.upgrades[id]].name}»: ${lock}`, 'warn', 2600);
      return;
    }
    if (!g.buyUpgrade(id)) {
      this.hud.toast(L(`Не вистачає ${formatMoney(cost - g.money)} на «${u.parts[g.upgrades[id]].name}»`, `Short by ${formatMoney(cost - g.money)} for “${u.parts[g.upgrades[id]].name}”`), 'warn', 2600);
      return;
    }
    // гість купує для спільного човна — капітан ставить річ (як у вікні крамниці)
    this.dialogs.onBoatPurchase?.({ upgrade: id });
    this.syncUpgrades();
    this.audio.catchJingle();
    this.hud.toast(L(`🔧 «${u.parts[g.upgrades[id] - 1].name}» — вже на човні (−${formatMoney(cost)})`, `🔧 “${u.parts[g.upgrades[id] - 1].name}” — now on the boat (−${formatMoney(cost)})`), 'good', 3200);
    this.saveGame();
  }

  /** стан світу для кроку живої біржі: година, день (вихідні), погода (хто в морі) */
  private marketCtx(hour = this.time.hours): MarketCtx {
    return { hour: ((hour % 24) + 24) % 24, day: this.time.dayCount, weather: this.weather.base };
  }

  /** новина біржі (бот здав улов): у порту — коротке повідомлення, не частіше ніж раз на 45 с */
  private marketNewsT = -1e9;
  private marketNewsToast(who: string, text: string) {
    const now = performance.now() / 1000;
    if (now - this.marketNewsT < 45 || this.phase !== 'play') return;
    if (Math.hypot(this.boat.pos.x, this.boat.pos.z) > 200 && this.player.mode === 'boat') return;
    this.marketNewsT = now;
    this.hud.toast(`🚢 «${botName(who)}» ${text}`, 'warn', 4200);
  }

  /** дані для екрана радіо: прогноз, біржа, звіти, трюм */
  private radioData(): RadioData {
    const g = this.game, w = this.weather;
    const snap = w.snapshot();
    const bf = w.beaufort;
    const h = Math.floor(this.time.hours), m = Math.floor((this.time.hours % 1) * 60);
    return {
      clock: L(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · день ${this.time.dayCount}`, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · day ${this.time.dayCount}`),
      now: { bf: bf.b, name: bf.name, ms: w.windMs, wave: Math.round((0.2 + w.intensity * w.intensity * 4.2) * 10) / 10, dir: w.windDir },
      forecast: forecast3(w.base, snap.forecast, w.windDir, this.time.dayCount),
      // ціни — та сама функція, що й біржа та продаж (біржа порту, де ти зараз; свіжа риба)
      market: FISH.map((sp) => ({
        name: sp.name,
        // та сама біржа, де продаватимеш (порт, у якому стоїш), — ціна свіжої рибини за кг
        price: g.quotePerKg(sp.id),
        hist: g.venueMarket.hist[sp.id] ?? [],
        demand: g.venueMarket.demand(sp.id),
        event: g.venueMarket.eventFor(sp.id)?.text,
      })),
      events: [...g.market.events.map((e) => `${e.mult > 1 ? '▲' : '▼'} ${e.text}`), ...g.market.news.slice(-2).map((n) => `🚢 «${botName(n.who)}» ${newsText(n.text, n.who)}`), ...g.trade.tickerTexts(g.clockH)],
      news: g.market.news.map((n) => ({ who: `«${botName(n.who)}»`, text: newsText(n.text, n.who), h: n.h })),
      reports: g.reports.map((r) => ({ zone: ZONE_NAMES[r.zone], name: g.speciesName(r.speciesId), boost: r.boost })),
      hold: { count: g.hold.length, cap: g.holdCap, value: g.hold.reduce((a, f) => a + g.sellPrice(f), 0) },
      stormSoon: w.localStormEta != null || snap.forecast > 0.74 || w.base > 0.74,
      tip: (() => {
        const zone = zoneFromDist(Math.hypot(this.boat.pos.x, this.boat.pos.z));
        const night = this.time.isNight;
        const here = FISH.filter((f) => f.zones.includes(zone) && (night ? f.night : f.day)).map((f) => f.name.toLowerCase());
        return here.length ? L(`${night ? L('Ніч', `Night`) : L('День', `Day`)} · ${ZONE_NAMES[zone]}: тут зараз ловиться ${here.join(', ')}`, `${night ? L('Ніч', `Night`) : L('День', `Day`)} · ${ZONE_NAMES[zone]}: biting here now — ${here.join(', ')}`) : '';
      })(),
    };
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
    g.earn(payout, 'insurance');
    g.spend(Math.min(g.money, tow), 'tow');
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
      onMenu: () => this.exitToMenu(),
      settings: this.settings,
      onSettings: (st) => {
        this.applySettings(st);
        saveSettings(st);
      },
      playTime: this.playTime,
      onBeforeExport: () => this.saveGame(),
      places: LANDMARKS.map((l) => ({ name: l.name, found: this.game.places.includes(l.id) })),
      game: this.game,
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
                this.hud.toast(L('Капітан кімнати плаває на своїй яхті — друзі можуть прийти до тебе в екіпаж', `The room's captain sails their own yacht — friends can join you as crew`), 'warn', 4500);
                this.phase = 'play';
                this.requestLock();
                return;
              }
              this.switchBoat(to);
            },
          }
        : undefined,
      tent: this.coop.crewing
        ? undefined
        : {
            owned: this.game.upgrades.tent ?? 0,
            fit: this.game.fittedUpgrades().tent,
            onPick: (l) => {
              const owned = this.game.upgrades.tent ?? 0;
              this.game.tentFit = l >= owned ? null : l;
              this.syncUpgrades();
              this.saveGame();
            },
          },
      hats: {
        list: HATS.map((h) => ({ id: h.id, name: h.name, icon: h.icon, owned: this.hatOwned(h.id), hint: h.hint })),
        current: this.game.hat,
        onPick: (id) => {
          this.game.hat = id;
          this.saveGame();
        },
      },
    });
  }

  /** скупники: час, попит, прострочені замовлення */
  private tickTrade(hours: number) {
    const g = this.game;
    g.clockH = this.time.dayCount * 24 + this.time.hours;
    const failed = g.trade.tick(hours, g.clockH);
    for (const c of failed) this.hud.toast(L(`📜 Замовлення згоріло: ${contractTitle(c)} (${shortName(c.buyer)}) — репутація −4`, `📜 Order expired: ${contractTitle(c)} (${shortName(c.buyer)}) — reputation −4`), 'warn', 4200);
    if (failed.length) this.saveGame();
  }

  private openDialog(kind: Venue | 'exchange' | 'radio' | BuyerId) {
    this.phase = 'dialog';
    this.expectUnlock = true;
    document.exitPointerLock();
    this.saveTimer = 30;
    if (kind in BUYER_BY_ID) this.dialogs.buyer(this.game, kind as BuyerId);
    else if (kind === 'radio') this.dialogs.radio(this.game, this.weather, this.time);
    else if (kind === 'exchange') this.dialogs.exchange(this.game);
    else this.dialogs.shop(this.game, kind as Venue);
  }

  /** дані для «журналу капітана», яких немає в GameState */
  private statsExtra(): StatsExtra {
    const g = this.game;
    const treasures = g.finds.filter((f) => !f.startsWith('hat:')).length;
    return {
      day: g.today,
      playTime: this.playTime,
      places: { found: g.places.filter((id) => LANDMARKS.some((l) => l.id === id)).length, total: LANDMARKS.length },
      ports: { found: 1 + PORT_SITES.filter((p) => g.places.includes(p.id)).length, total: 1 + PORT_SITES.length },
      hats: { found: HATS.filter((h) => this.hatOwned(h.id)).length, total: HATS.length },
      treasures,
      chart: this.drawStatsChart(),
    };
  }

  private drawStatsChart(): HTMLCanvasElement {
    this.mapView.drawChart(this.statsChart, this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, this.game);
    return this.statsChart;
  }

  /** стенд у хаті: детальний журнал */
  private openStats() {
    this.phase = 'dialog';
    this.expectUnlock = true;
    document.exitPointerLock();
    this.audio.click();
    this.dialogs.stats(statsHtml(this.game, this.statsExtra()));
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
    const an = this.boat.anchor;
    if (!this.coop.crewing && an.state === 2) data.anchor = { x: Math.round(an.ax * 10) / 10, z: Math.round(an.az * 10) / 10, chain: Math.round(an.chain) };
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
    if (locked && input.pressed('KeyE') && this.phase === 'play' && !this.dialogs.isOpen && !this.kitchen.busy && !this.sailMenuFrame) {
      if (this.chartMode) this.setChart(false);
      else this.doInteract();
    }
    // Esc — меню паузи / продовження / закрити карту (працює і без pointer lock)
    if (input.pressed('Escape')) {
      if (this.sailMenu.open) {
        this.sailMenu.close(); // меню парусів — просто закрити
      } else if (this.kitchen.active) {
        this.kitchen.abort(); // чай / готування — перервати, а не меню паузи
      } else if (this.chartMode) {
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
    // X за штурвалом — ключ запалювання: заглушити / запустити двигун
    if (input.pressed('KeyX') && this.phase === 'play' && !this.dialogs.isOpen && this.player.mode === 'boat' && this.player.wheeling) this.ignition();
    // V — вид з-за корми / від першої особи (за штурвалом)
    // T за штурвалом — автопілот (з «Приладами» 5)
    if (input.pressed('KeyT') && this.phase === 'play' && !this.dialogs.isOpen && this.player.mode === 'boat' && this.player.wheeling && instrHas(this.game.upgrades.instr ?? 0).radar) this.toggleAutopilot();
    if (input.pressed('KeyV') && this.phase === 'play' && !this.dialogs.isOpen) {
      this.chasePref = !this.chasePref;
      try {
        localStorage.setItem('storm-cam', this.chasePref ? 'chase' : 'fp');
      } catch {
        /* ок */
      }
      if (!this.player.wheeling) this.hud.toast(this.chasePref ? L('Вид з-за корми — коли стоїш за штурвалом', `Stern view — when you're at the wheel`) : L('Вид від першої особи', `First-person view`), 'warn', 2200);
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
    } else if (wheelSteps && (this.radioCtl === 'tune' || this.radioCtl === 'vol')) {
      this.radio.turn(this.radioCtl, -wheelSteps);
      this.audio.click();
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
          g.spend(fee, 'insurance');
          this.hud.toast(L(`🛡 Страховка «${PLANS[g.insurance].name}»: −${fee} ₴`, `🛡 “${PLANS[g.insurance].name}” insurance: −${fee} ₴`), 'warn', 3500);
        } else {
          g.insurance = 0;
          this.hud.toast(L('🛡 Не вистачило грошей на внесок — страховка згоріла!', `🛡 Not enough money for the premium — the insurance lapsed!`), 'bad', 6000);
        }
      }
      this.hud.toast(L(`Новий день. ${g.priceTrendText}.`, `A new day. ${g.priceTrendText}.`), 'warn');
      if (g.lastMarketEvent) this.hud.toast(L(`📈 Біржа: ${g.lastMarketEvent.text}`, `📈 Exchange: ${g.lastMarketEvent.text}`), g.lastMarketEvent.mult > 1 ? 'good' : 'warn', 6000);
    }

    // погода: у відкритому морі сильніша (множник від відстані до берега)
    {
      const wp = this.player.mode === 'boat' ? this.boat.pos : this.player.head;
      this.weather.localMul = seaMul(wp.x, wp.z);
    }
    if (this.coop.isClient) this.weather.updatePassive(dt);
    else this.weather.update(dt);
    // штормове попередження заздалегідь (фронт ще не прийшов)
    const eta = this.weather.stormEta;
    if (eta != null && eta > 60 && !this.stormWarned) {
      this.stormWarned = true;
      this.hud.toast(L(`📻 Штормове попередження: шторм приблизно за ${Math.max(1, Math.round(eta / 60))} хв (≈${Math.max(1, Math.round(eta / 25))} год гри). Рибалки вертаються в порт${this.boat.doorOpen || this.boat.hatchOpen ? L(' · зачини двері каюти й люк трюму', ` · close the cabin doors and the hold hatch`) : ''}`, `📻 Storm warning: a storm in about ${Math.max(1, Math.round(eta / 60))} min (≈${Math.max(1, Math.round(eta / 25))} game hours). Fishermen are heading back to port${this.boat.doorOpen || this.boat.hatchOpen ? L(' · зачини двері каюти й люк трюму', ` · close the cabin doors and the hold hatch`) : ''}`), 'warn', 6500);
    } else if (eta == null && this.weather.state() !== 'storm') this.stormWarned = false;
    // бурхливий район: фронт без шторму тут однаково стане штормом — попереджаємо так само заздалегідь
    {
      const wp = this.player.mode === 'boat' ? this.boat.pos : this.player.head;
      const ra = roughAt(wp.x, wp.z);
      // у бурхливому районі шторм починається вже з фронтом (раніше за загальний)
      const fe = this.weather.roughHere ? this.weather.frontEta : null;
      const le = fe;
      if (le != null && le > 45 && !this.localStormWarned) {
        this.localStormWarned = true;
        this.hud.toast(L(`📻 Фронт приблизно за ${Math.max(1, Math.round(le / 60))} хв. Тут, ${ra.area ? `у районі «${ra.area.name}»` : 'у відкритому морі'}, він принесе шторм — рушай до гавані чи ближче до берега`, `📻 A front in about ${Math.max(1, Math.round(le / 60))} min. Out here${ra.area ? ` in ${ra.area.name}` : ' in the open sea'} it will bring a storm — head for a harbour or closer to shore`), 'warn', 7000);
      } else if (this.weather.frontEta == null && this.weather.state() !== 'storm') this.localStormWarned = false;
      // увійшли в бурхливий район — підказка, де найближчий затишок
      if (!this.inRough && ra.v > 0.35 && ra.area) {
        this.inRough = true;
        const nh = nearestHaven(wp.x, wp.z);
        const site = PORT_SITES.find((p) => Math.hypot(p.x - nh.h.x, p.z - nh.h.z) < 80);
        const port = site ? site.name : L('«Шторм»', `Storm Harbour`);
        const fNow = this.weather.frontEta;
        const soon = fNow != null ? L(` · ⛈ фронт ${fNow < 30 ? 'уже йде' : `за ${Math.max(1, Math.round(fNow / 60))} хв`}!`, ` · ⛈ front ${fNow < 30 ? 'is already here' : `in ${Math.max(1, Math.round(fNow / 60))} min`}!`) : '';
        this.hud.toast(L(`⚠ ${ra.area.name}: хвиля вища, шторм тут лютіший — зате риба більша. Найближча гавань — ${port} (${(nh.d / 1000).toFixed(1).replace('.', ',')} км)${soon}`, `⚠ ${ra.area.name[0].toUpperCase() + ra.area.name.slice(1)}: higher seas and fiercer storms — but bigger fish. Nearest harbour: ${port} (${(nh.d / 1000).toFixed(1)} km)${soon}`), 'warn', 6500);
      } else if (this.inRough && ra.v < 0.12) this.inRough = false;
    }
    if (this.weather.state() !== this.lastWeather) {
      const st = this.weather.state();
      if (st === 'storm') {
        // що відчинене — туди й заллє: двері каюти й люк трюму
        const open = [this.boat.doorOpen ? L('двері каюти', `the cabin doors`) : '', this.boat.hatchOpen ? L('люк трюму', `the hold hatch`) : ''].filter(Boolean);
        this.hud.toast(L(`⛈ ШТОРМ! Хвилі ростуть. Дістанься порту або ризикуй!${open.length ? L(` Зачини ${open.join(L(' і ', ` and `))} — інакше заллє й потопить`, ` Close ${open.join(L(' і ', ` and `))} — or you'll be swamped and sink`) : ''}`, `⛈ STORM! The sea is building. Make it to port or take your chances!${open.length ? L(` Зачини ${open.join(L(' і ', ` and `))} — інакше заллє й потопить`, ` Close ${open.join(L(' і ', ` and `))} — or you'll be swamped and sink`) : ''}`), 'bad', 6000);
      }
      else if (st === 'calm' && this.lastWeather === 'storm') {
        g.stats.stormsSurvived++;
        this.hud.toast(L('Шторм минув. Ти справжній рибал.', `The storm has passed. You're a true fisherman.`), 'good', 4500);
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
          this.hud.toast(L('Паливо скінчилось! Повертайся в порт.', `Out of fuel! Head back to port.`), 'bad', 5000);
        }
      } else {
        g.fuel = 0;
        this.boat.throttle = 0;
      }
    }
    if (g.fuel > 5) this.outOfFuelWarned = false;

    // гравець
    if (this.chartMode && (this.phase !== 'play' || this.player.mode !== 'boat')) this.setChart(false);
    if (this.kitchen.active && (this.phase !== 'play' || this.player.mode !== 'boat' || !this.player.inCabin)) {
      if (this.phase === 'play') this.kitchen.abort();
    }
    if (locked && this.phase === 'play' && !this.photo && this.kitchen.active) {
      // біля чайника / плити: руки зайняті — стоїмо, миша не крутить голову
      input.consumeMouse();
    } else if (locked && this.phase === 'play' && !this.photo && this.chartMode) {
      // над картою: миша водить олівцем (біля краю карта їде), коліщатко — зум,
      // ЛКМ — точка маршруту, ПКМ — прибрати точку під олівцем (або останню)
      // ПКМ затиснута й тягнеш — карта їде за мишею (олівець на місці); короткий клік ПКМ — прибрати точку
      const [mdx, mdy] = input.consumeMouse();
      const [cw, ch] = this.chart.size;
      if (input.pressed('Mouse2')) this.chartDrag = 0;
      if (this.chartDrag >= 0 && input.down('Mouse2')) {
        this.chartDrag += Math.abs(mdx) + Math.abs(mdy);
        if (this.chartDrag > 8) {
          this.mapView.chartPan(mdx * 0.71, mdy * 0.71, cw, ch);
          this.chart.markDirty();
        }
      } else {
        this.chart.moveCursor(mdx, mdy);
        this.chartEdgePan(dt);
      }
      if (this.chartDrag >= 0 && !input.down('Mouse2')) {
        if (this.chartDrag <= 8 && this.game.route.length) {
          const i = this.mapView.chartHit(this.chart.u, this.chart.v, cw, ch, this.game.route);
          this.game.removeRoutePoint(i >= 0 ? i : this.game.route.length - 1);
          this.audio.click();
          this.saveGame();
        }
        this.chart.markDirty();
        this.chartDrag = -1;
      }
      // WASD / стрілки — рухати карту
      const kx = (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0) - (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0);
      const kz = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
      if (kx || kz) {
        this.mapView.chartPan(kx * 320 * dt, kz * 320 * dt, cw, ch);
        this.chart.markDirty();
      }
      if (input.pressed('Mouse0')) this.chartClick();
      this.boat.localToWorld(this.player.localX, this.player.floorY + 1.62, this.player.localZ, this.player.head);
    } else if (locked && this.phase === 'play' && !this.photo) {
      const crewHelm = this.coop.crewing && this.player.wheeling;
      if (crewHelm) {
        // свій газ/кермо (знімок капітана ще не встиг їх побачити)
        this.boat.throttle = this.coop.myHelm[0];
        this.boat.rudder = this.coop.myHelm[1];
      }
      this.sailMenuFrame = this.sailMenu.open;
      if (this.sailMenu.open) this.updateSailMenu(input);
      this.player.update(dt, input, this.boat, this.port, this.ocean, t);
      this.pickStation();
      this.pickCounter();
      if (this.player.onIsland) {
        const f = this.islands.pick(this.player.wx, this.player.wz, this.game.finds) ?? this.stalls.pickHermit(this.player.wx, this.player.wz);
        if (f) this.player.nearest = f;
      }
      if (crewHelm) this.coop.myHelm = [this.boat.throttle, this.boat.rudder];
    } else {
      // навіть без лока тримаємо голову на місці (на яхті — разом із нею; на березі й у воді голова вже у світових координатах)
      if (this.player.mode === 'boat') this.boat.localToWorld(this.player.localX, this.player.floorY + 1.62, this.player.localZ, this.player.head);
    }
    this.player.updateEnergy(dt);

    // місце швартування — найближче з гаваней (своє місце за слотом флотилії)
    this.pickMoor();

    // човен
    this.boat.night = this.time.isNight;
    this.boat.anchor.remote = this.coop.crewing;
    if (this.coop.crewing) {
      this.autopilotStep(dt);
      if (this.player.wheeling) {
        this.boat.throttle = this.coop.myHelm[0];
        this.boat.rudder = this.coop.myHelm[1];
      }
      this.boat.updateRemote(dt, t, this.ocean, this.weather, g, this.particles, this.audio);
    } else {
      this.coop.ownerApply(dt, this.boat, this.player);
      this.autopilotStep(dt);
      // інші яхти флотилії — теж перешкоди (зіткнення бортами)
      const others = [...(this.coop.active ? this.coop.fleetObstacles() : []), ...this.bots.obstacles()];
      this.boat.update(dt, t, this.ocean, this.weather, g, this.particles, this.audio, others.length ? [...this.port.rocks, ...others] : this.port.rocks, this.moorDock);
      this.islands.collideBoat(this.boat, g);
      // капітан зійшов на острів / плаває біля нього: якір віддається сам
      // (якщо дістає дна); де задуглибоко — яхту просто «притримуємо»
      const p = this.player;
      if (p.onIsland || (p.mode === 'water' && islandNear(p.wx, p.wz, 40))) {
        this.boat.throttle = 0;
        if (!this.boat.anchor.down && !this.anchorAuto) {
          this.anchorAuto = true;
          if (this.boat.anchor.toggle(this.boat) === 'drop') this.hud.toast(L('⚓ Якір віддано автоматично — яхта чекатиме біля берега', `⚓ Anchor dropped automatically — the yacht will wait by the shore`), 'good', 3200);
        }
        if (!this.boat.anchor.down) this.boat.vel.multiplyScalar(Math.exp(-dt * 2.5));
      } else if (p.mode === 'boat') this.anchorAuto = false;
    }
    this.boat.updateGangway(dt, this.moorDock);
    this.updateAnchorHud(dt);
    // камера й маска води в корпусі — від пози човна саме цього кадру
    this.player.syncHead(this.boat);
    this.ocean.setHull(this.boat.group, this.boat.vel.length());
    // слід піни за кормою
    this.foamTrail.update(dt, t, this.boat.localToWorld(0, 0, -4.9, this._v), this.boat.heading, this.boat.vel.length(), this.ocean, this.camera.position, clamp(this.time.daylight + 0.15, 0, 1), clamp(this.weather.intensity - 0.4, 0, 1));
    // нічне цвітіння медуз
    this.jellies.update(dt, t, this.ocean, this.camera.position, 1 - this.time.daylight);

    // станції
    // відійшов від щогли — робота з фалами переривається
    if (this.stations.active?.id === 'sails' && this.player.nearest?.id !== 'st:sails') {
      this.stations.stop();
      this.hud.toast(L('Відійшов від щогли — фал кинуто', `You left the mast — halyard released`), 'warn', 2000);
    }
    this.stations.update(dt, this.time.hours);

    // кооп: знімок світу (капітан), свій гравець і аватари екіпажу
    this.coop.ownerSend(dt, t, this.boat, this.weather, this.time, g, this.coop.crewing ? undefined : this.ocean.netState());
    this.coop.updateFleet(dt, t, this.ocean, this.weather, g, this.particles, this.time.daylight);
    // боти: симулює соло-гравець або капітан кімнати; гості доганяють пози
    this.bots.remote = this.coop.isClient;
    // жива біржа: гість не симулює запаси (вони від капітана), а свої продажі шле йому
    if (this.game.market.remote !== this.coop.isClient) this.game.setMarketRemote(this.coop.isClient);
    this.game.saleHook = this.coop.isClient ? (p, sp, u) => this.coop.sendMarketSale(p, sp, u) : null;
    this.bots.update(dt, t, this.ocean, this.weather, this.time.daylight, [this.boat.pos, ...this.coop.fleetObstacles()], this.boat.pos);
    this.coop.myHat = this.game.hat;
    this.coop.tick(dt, this.boat, this.player, this.stations.active?.id === 'pump', this.fishing, this.ocean, t);

    // ловля
    // з причалу/берега — берегова вудка (клює рідко й дрібне)
    this.fishing.ashore = this.player.mode === 'port';
    this.fishing.update(dt, t, this.boat, this.ocean, input, g, this.weather, this.time);
    // вудка в руках: ЛКМ — закид / підсічка, R — змотати
    if (locked && this.phase === 'play' && !this.dialogs.isOpen && !this.photo && !this.chartMode && !this.kitchen.active && !this.sailMenuFrame && ((this.player.mode === 'boat' && !this.player.wheeling) || this.player.mode === 'port')) {
      if (this.radioCtl && (input.pressed('Mouse0') || input.pressed('Mouse2'))) {
        // кнопки й ручки радіо
        this.radio.use(this.radioCtl, input.pressed('Mouse0') ? 1 : -1);
        this.radioTextT = 0;
        this.audio.click();
      } else if (input.pressed('Mouse0')) this.fishing.click(this.boat, g, this.weather, this.time);
      if (input.pressed('KeyR')) this.fishing.reelHand();
    }
    const bobW = this._v3.copy(this.fishing.lastBobber);
    this.player.rodBusy = this.fishing.state === 'fight' || this.fishing.state === 'charge';
    this.fishJump.update(dt, t);
    this.leapJump.update(dt, t);
    this.updateSchoolJumps(dt, t);
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
      const prevRec = g.records[catched.speciesId] ?? 0;
      const trophy = this.fishing.lastTrophy;
      const record = prevRec > 0 && catched.kg > prevRec;
      g.recordCatch(catched);
      if (trophy) g.ledger.trophies++;
      this.bumpFishSkill();
      if (trophy) {
        this.audio.trophy();
        this.hud.toast(L(`🏆 Трофей! ${name} ${catched.kg.toFixed(1).replace('.', L(',', '.'))} кг — ${record || !prevRec ? L('новий рекорд виду', `new species record`) : L(`рекорд ${prevRec.toFixed(1).replace('.', L(',', '.'))} кг`, `record ${prevRec.toFixed(1).replace('.', L(',', '.'))} kg`)}`, `🏆 Trophy! ${name} ${catched.kg.toFixed(1).replace('.', L(',', '.'))} kg — ${record || !prevRec ? L('новий рекорд виду', `new species record`) : L(`рекорд ${prevRec.toFixed(1).replace('.', L(',', '.'))} кг`, `record ${prevRec.toFixed(1).replace('.', L(',', '.'))} kg`)}`), 'good', 5000);
      }
      if (this.player.mode === 'boat') {
        // риба падає на палубу й б'ється — її треба віднести в ящик на баку
        this.deckFish.drop(catched, me, 1.05);
        this.hud.catchCard(name, catched.kg, catched.speciesId, isNew, catched.storm ? L('штормова · на палубі', `storm catch · on deck`) : L('на палубі — неси в ящик', `on deck — carry it to the box`), trophy, record);
      } else if (g.storeFish(catched)) {
        this.hud.catchCard(name, catched.kg, catched.speciesId, isNew, catched.storm ? L('штормова', `storm catch`) : '', trophy, record);
      } else {
        this.hud.toast(L(`Трюм повний — ${name.toLowerCase()} повертається в море`, `The hold is full — the ${name.toLowerCase()} goes back to the sea`), 'warn', 3500);
      }
    }
    // риба на палубі: б'ється, псується, хвиля може змити
    this.cabinDoor.update(dt, this.boat.doorOpen);
    this.nets.update(dt, this.time.gameHourDelta(dt), t, this.boat, this.ocean, this.weather, this.camera.position);
    this.syncNets(dt);
    this.deckFish.update(dt, t, this.time.gameHourDelta(dt), this.boat.deckWater, g.hold, this.boat.hatchOpen);
    // радіо: екран і звук (чути в каюті, тихіше — з палуби крізь двері)
    const inCabin = this.player.mode === 'boat' && this.player.inCabin;
    this.radioCtl = inCabin && this.phase === 'play' && !this.dialogs.isOpen && this.player.nearest?.id === 'st:radio' ? this.radio.aim(this.camera) : null;
    this.radio.spectrum = this.audio.radioSpectrum();
    this.radio.update(dt, inCabin);
    this.cabinDecor.update(dt, this.time.hours, this.weather.base, this.boat.group, 1 - this.time.daylight);
    {
      // хата: світло у вікнах і лампа; журнал на стіні — перемальовується, коли поруч
      const p = this.player;
      const near = p.mode === 'port' && !p.onIsland && Math.hypot(p.wx - COTTAGE.x, p.wz - COTTAGE.z) < 30;
      this.cottage.update(dt, 1 - this.time.daylight, p.inHouse, near);
      if (this.statsBoard.due(dt, near)) this.statsBoard.draw(this.game, this.statsExtra());
    }
    // камбуз: міні-гра (клавіші — лише в грі), бафи, пара й полум'я
    this.kitchen.update(dt, input, t, locked && this.phase === 'play');
    this.exchangeBoard.update(dt, this.game);
    if ((this.chartMode || (this.player.mode === 'boat' && this.player.inCabin)) && this.chart.due(dt, this.chartMode)) {
      this.mapView.drawChart(this.chart.canvas, this.boat.pos.x, this.boat.pos.z, this.boat.heading, this.port.rocks, this.game);
      this.chart.textureUpdated();
    }
    this.updateHighlight(t);
    this.radioTextT -= dt;
    if (this.radioTextT <= 0) {
      this.radioTextT = 1;
      this.radio.data = this.radioData();
    }
    {
      const tn = this.radio.tuned;
      // чути по всьому човну: у каюті — тепло й повно, на палубі — глухіше (крізь двері),
      // на березі — стихає з відстанню; шторм заглушує зовні
      const storm = clamp((this.weather.intensity - 0.45) / 0.5, 0, 1);
      let audible = 0;
      if (inCabin) audible = 1;
      else if (this.player.mode === 'boat') audible = (this.boat.doorOpen ? 0.6 : 0.4) * (1 - storm * 0.6);
      else {
        const d = Math.hypot(this.player.head.x - this.boat.pos.x, this.player.head.z - this.boat.pos.z);
        audible = clamp(1 - d / 22, 0, 1) * 0.3 * (1 - storm * 0.7);
      }
      this.radioRoom += ((inCabin ? 1 : 0) - this.radioRoom) * Math.min(1, dt * 2.5);
      this.audio.radio({ audible, on: this.radio.on, signal: tn.signal, sweep: this.radio.sweep, content: tn.st?.content ?? 'none', style: tn.st?.style ?? 0, volume: this.radio.volume, room: this.radioRoom }, dt);
    }

    // вода тече у відкритий люк — гучне попередження
    if (this.boat.hatchOpen && this.boat.deckWater > 8) {
      this.hatchWarnT -= dt;
      if (this.hatchWarnT <= 0) {
        this.hatchWarnT = 6;
        this.hud.toast(L(`🌊 Вода заливає відкритий трюм (${Math.round(this.boat.bilge)}%)! Закрий люк (ящик із червоним ричагом на носі) й відкачай помпою!`, `🌊 Water is pouring into the open hold (${Math.round(this.boat.bilge)}%)! Close the hatch (the box with the red lever on the bow) and pump it out!`), 'bad', 4500);
      }
    }

    // вода ллється у відчинені двері каюти
    if (this.boat.doorOpen && (this.boat.deckWater > 15 || (this.weather.rain > 0.3 && this.player.mode === 'boat'))) {
      this.doorWarnT -= dt;
      if (this.doorWarnT <= 0) {
        this.doorWarnT = 7;
        this.hud.toast(L(`🌊 Вода ллється в каюту через відчинені двері! Зачини двері біля трапа (E — червоний засув).`, `🌊 Water is pouring into the cabin through the open doors! Close the doors by the companionway (E — the red latch).`), 'bad', 4500);
      }
    }

    // свіжість
    g.decayFreshness(this.time.gameHourDelta(dt));
    g.tickMarket(this.time.gameHourDelta(dt), this.marketCtx());
    this.tickTrade(this.time.gameHourDelta(dt));
    this.stalls.update(dt, g.trade, g.clockH, 1 - this.time.daylight, this.player.mode === 'boat' ? undefined : this.player.head);
    this.ordersT -= dt;
    if (this.ordersT <= 0) {
      this.ordersT = 0.5;
      this.ordersChip.update(g, this.phase === 'play' && !this.hud.hidden && !this.photo);
    }

    // орієнтир шварту: світний обрис місця біля причалу, коли повертаєшся
    {
      const dm = Math.hypot(this.boat.pos.x - this.boat.moor.x, this.boat.pos.z - this.boat.moor.z);
      const want = dm < 220 && dm > 4 && !this.boat.mooredNow ? 1 : 0;
      const m = this.moorMark;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity += (want * (0.5 + 0.25 * Math.sin(t * 3)) - mat.opacity) * (1 - Math.exp(-3 * dt));
      m.visible = mat.opacity > 0.01;
      m.position.set(this.boat.moor.x, this.ocean.renderedHeightAt(this.boat.moor.x, this.boat.moor.z, t) + 0.08, this.boat.moor.z);
      m.rotation.y = this.boat.moorHeading;
      if (this.boat.mooredNow) g.portId = this.moorSite;
      if (this.boat.mooredNow && !this.wasMoored && this.leftHarbour) {
        this.hud.toast(this.moorSite === 'home' ? L('⚓ Пришвартовано', `⚓ Moored`) : L(`⚓ Пришвартовано · ${PORT_SITE_BY_ID[this.moorSite]?.name ?? ''}`, `⚓ Moored · ${PORT_SITE_BY_ID[this.moorSite]?.name ?? ''}`), 'good', 2500);
        this.audio.click();
        this.leftHarbour = false;
      }
      if (dm > 40) this.leftHarbour = true;
      this.wasMoored = this.boat.mooredNow;
    }

    // маршрут для лоції (лише капітан/соло — човен його)
    if (!this.coop.crewing) g.addTrack(this.boat.pos.x, this.boat.pos.z);
    // книга капітана: шлях і час у морі — свої (і для екіпажу на чужій яхті)
    {
      const lg = g.ledger;
      const bx = this.boat.pos.x, bz = this.boat.pos.z;
      if (this.player.mode === 'boat' && this.ledgerPrev) {
        const step = Math.hypot(bx - this.ledgerPrev[0], bz - this.ledgerPrev[1]);
        // телепорт (переставили човен, міграція) — не рахуємо
        if (step < 40) lg.distM += step;
        if (!this.boat.mooredNow) lg.seaSec += dt;
        lg.maxFar = Math.max(lg.maxFar, Math.hypot(bx, bz));
      }
      this.ledgerPrev = [bx, bz];
    }
    // маршрут: дійшли до точки — компас веде на наступну
    if (g.advanceRoute(this.boat.pos.x, this.boat.pos.z)) {
      const nx = g.waypoint;
      this.hud.toast(nx ? L(`✓ Точку пройдено · далі ${this.mapView.fmtDist(Math.hypot(nx.x - this.boat.pos.x, nx.z - this.boat.pos.z))}, ще ${g.route.length}`, `✓ Waypoint reached · next ${this.mapView.fmtDist(Math.hypot(nx.x - this.boat.pos.x, nx.z - this.boat.pos.z))}, ${g.route.length} to go`) : L('🏁 Маршрут пройдено', `🏁 Route complete`), 'good', 2600);
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
        this.hud.toast(L('У море! Пам\'ятай про паливо і погоду.', `To sea! Mind your fuel and the weather.`), 'warn', 4000);
      } else {
        this.hud.titleCard(L('Порт «Шторм»', `Storm Harbour`), L('вдома', `home`));
        if (g.hold.some((f) => f.storm)) g.objectives.stormReturn = true;
      }
    }

    this.updatePortsNav();

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
    this.islands.update(dt, t, g.finds);
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
      if (g.tut >= TUTORIAL.length) this.hud.toast(L('Ти освоївся. Далі — море твоє: шукай місця на лоції й нові види риби.', `You've got the hang of it. The sea is yours now: look for places on the chart and new fish species.`), 'good', 6000);
    }
    this.hud.setGoal(g.tut < TUTORIAL.length ? TUTORIAL[g.tut] : null, g.tut + 1, TUTORIAL.length);
  }

  /** знахідка на острові: капелюх у гардероб, гроші з пляшки/скрині */
  private takeFind(fid: string) {
    const g = this.game;
    const f = FINDS.find((x) => x.id === fid);
    if (!f || g.finds.includes(fid)) return;
    g.finds.push(fid);
    this.audio.discover();
    if (f.kind === 'hat') {
      const h = HAT_BY_ID[f.hat!];
      g.hat = h.id;
      this.hud.titleCard(`${h.icon} ${h.name}`, L('знахідка · вже на тобі (змінити — в паузі)', `found · you're wearing it (change it in the pause menu)`));
      this.hud.toast(L(`🎩 Капелюхи: ${HATS.filter((x) => this.hatOwned(x.id)).length}/${HATS.length}`, `🎩 Hats: ${HATS.filter((x) => this.hatOwned(x.id)).length}/${HATS.length}`), 'good', 3500);
    } else {
      if (f.money) g.earn(f.money, 'finds');
      if (f.kind === 'bottle') {
        this.hud.titleCard(L('Пляшка із запискою', `A bottle with a note`), f.note ?? '');
        // записка на Мушлевому острові — ще й рецепт ухи
        if (fid === 'bottle:shell') this.kitchen.learnFromNote('ukha');
      } else this.hud.titleCard(L('Піратська скриня!', `A pirate chest!`), L(`старі монети · +${f.money} ₴`, `old coins · +${f.money} ₴`));
      this.hud.toast(`+${f.money} ₴`, 'good', 3000);
    }
    this.saveGame();
  }

  private hatOwned(id: string): boolean {
    return id === 'captain' || this.game.finds.includes('hat:' + id);
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
      this.hud.titleCard(l.name, L(`відкрито · ${l.sub}`, `discovered · ${l.sub}`));
      this.hud.toast(L(`📍 Місця: ${g.places.length}/${LANDMARKS.length}`, `📍 Places: ${g.places.length}/${LANDMARKS.length}`), 'good', 3500);
      // усі острови відкрито — шапка з помпоном у подарунок
      if (!g.finds.includes('hat:beanie') && ISLANDS.every((d) => g.places.includes(d.id))) {
        g.finds.push('hat:beanie');
        this.hud.toast(L('🧶 Усі острови на лоції! У гардеробі — шапка з помпоном', `🧶 Every island is on the chart! A bobble hat is in your wardrobe`), 'good', 5000);
      }
      this.audio.discover();
      this.saveGame();
    }
  }

  private dawnCard() {
    this.hud.titleCard(L(`День ${this.time.dayCount}`, `Day ${this.time.dayCount}`), L('світанок', `dawn`));
  }
  private mapRefreshT = 0;
  private lastWeather: string = 'calm';

  private objectiveToast(k: string): string {
    switch (k) {
      case 'firstSale': return L('🏆 Ціль: перший продаж!', `🏆 Goal: first sale!`);
      case 'allSpecies': return L('🏆 Рибальський довідник: усі 12 видів!', `🏆 Angler's guide: all 12 species!`);
      case 'stormReturn': return L('🏆 Штормовий улов доставлений у порт!', `🏆 Storm catch delivered to port!`);
      case 'maxUpgrades': return L('🏆 Човен повної прокачки!', `🏆 Fully upgraded boat!`);
      case 'rich': return L('🏆 Капітан північного моря: 25 000 ₴!', `🏆 Captain of the North Sea: 25,000 ₴!`);
      default: return L('🏆 Ціль виконано!', `🏆 Goal complete!`);
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

    if (id === 'go-ashore') {
      this.audio.splash(0.2);
      if (!this.coop.crewing) this.hud.toast(L('⚓ Яхта на якорі. Назад — E біля яхти', `⚓ The yacht is at anchor. To get back — E by the yacht`), 'good', 3000);
      return;
    }
    if (id === 'swim-boat') {
      this.audio.splash(0.5);
      this.hud.toast(L('🏊 Доплив до яхти', `🏊 Swam back to the yacht`), 'good', 1800);
      return;
    }
    if (id.startsWith('find:')) {
      this.takeFind(id.slice(5));
      return;
    }

    if (id === 'st:autopilot') {
      this.toggleAutopilot();
      return;
    }

    if (id === 'st:nets') {
      if (this.coop.crewing) this.coop.sendAction({ a: 'nets' });
      else this.nets.interact(g.upgrades.nets ?? 0, this.boat, g, this.weather);
      return;
    }

    if (id === 'st:chart') {
      if (this.fishing.holding) {
        this.hud.toast(L('Спершу постав вудку — над картою потрібні обидві руки', `Put the rod away first — you need both hands at the chart`), 'warn', 2500);
        return;
      }
      this.setChart(true);
      return;
    }

    if (id === 'st:kettle' || id === 'st:kitchen' || id === 'st:cookbook') {
      if (id !== 'st:cookbook' && this.fishing.holding) {
        this.hud.toast(L('Спершу постав вудку — на камбузі потрібні обидві руки', 'Put the rod away first — you need both hands in the galley'), 'warn', 2500);
        return;
      }
      if (id === 'st:cookbook') this.kitchen.openBook();
      else {
        // погляд — на чайник / пательню, поки триває міні-гра
        this.lookAtLocal(id === 'st:kettle' ? TEA_LOOK : this._v2.copy(PAN_POS).setY(PAN_POS.y - 0.15));
        if (id === 'st:kettle') this.kitchen.startTea();
        else this.kitchen.openStove();
      }
      return;
    }

    if (id === 'st:anchor') {
      this.anchorToggle();
      return;
    }

    if (id === 'st:tent' || id === 'st:curtain') {
      this.tentToggle(id === 'st:tent' ? 'tent' : 'curtain');
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
        if (!this.deckFish.carried) this.hud.toast(L('Люк трюму відкрито. Не забудь закрити — хвиля заллє трюм!', `Hold hatch open. Don't forget to close it — a wave will flood the hold!`), 'warn', 3000);
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
        this.hud.toast(L(`🐟 ${g.speciesName(f.speciesId)} у ящику (${g.hold.length}/${g.holdCap})`, `🐟 ${g.speciesName(f.speciesId)} in the box (${g.hold.length}/${g.holdCap})`), 'good', 1800);
      } else {
        this.deckFish.dropCarried(p.localX, p.localZ);
        this.hud.toast(L('Ящик повний! Продай улов або прокачай трюм.', `The box is full! Sell your catch or upgrade the hold.`), 'warn', 3000);
      }
      return;
    }

    if (id === 'st:wheel') {
      if (!p.wheeling && this.coop.active) {
        const by = this.coop.wheelTakenBy();
        if (by) {
          this.hud.toast(L(`Штурвал тримає ${by}`, `${by} is at the wheel`), 'warn', 2500);
          return;
        }
        this.coop.myHelm = [this.boat.throttle, this.boat.rudder];
      }
      p.wheeling = !p.wheeling;
      if (p.wheeling) this.hud.toast(this.chasePref ? L('Штурвал: W/S — газ, A/D — кермо, V — вид від першої особи (прибори на тумбі), E — вийти', `Wheel: W/S — throttle, A/D — rudder, V — first-person view (instruments on the pedestal), E — leave`) : L('Штурвал: W/S — газ, A/D — кермо, V — вид з-за корми, E — вийти. Прибори — на тумбі перед колесом', `Wheel: W/S — throttle, A/D — rudder, V — stern view, E — leave. Instruments are on the pedestal in front of the wheel`), 'warn', 4000);
      return;
    }
    if (id === 'st:rod' || id.startsWith('st:holder')) {
      if (p.mode !== 'boat') return;
      const msg = id === 'st:rod' ? this.fishing.rackAction() : this.fishing.holderAction(Number(id.slice(9)), g, this.weather, this.time);
      if (msg) this.hud.toast(msg, 'warn', 3000);
      return;
    }
    if (id === 'st:sails') {
      // біля щогли — радіальне меню: скільки вітрила поставити
      if (this.stations.active?.id === 'sails') return;
      const sr = this.boat.sails;
      this.sailMenu.show(sr.mode, sr.hasGenn ? !sr.gennOff : null, sr.recommend(), sr.tws, true);
      return;
    }
    if (id === 'st:radio') {
      // фізичне радіо: E — те саме, що ЛКМ по органу, на який дивишся (або живлення)
      this.radio.use(this.radioCtl ?? 'power', 1);
      this.radioTextT = 0;
      return;
    }
    if (id === 'st:bed' || id === 'port:house') {
      this.doSleep(id === 'port:house');
      return;
    }
    if (id === 'port:board') {
      this.openStats();
      return;
    }
    if (id.startsWith('shop:')) {
      this.useCounter(id.slice(5) as CounterTarget);
      return;
    }
    // послуги інших гаваней: «svc:<порт>:<вид>»
    if (id.startsWith('svc:')) {
      const [, site, kind] = id.split(':');
      this.game.portId = site;
      if (kind === 'sleep') this.doSleep(true);
      else if (kind === 'fuel' || kind === 'yard' || kind === 'shop' || kind === 'office' || kind === 'exchange') this.openDialog(kind);
      else PORT_SERVICE_HANDLERS[kind]?.(site, this.game);
      return;
    }
    if (id.startsWith('port:')) this.game.portId = 'home';
    // кожне місце в порту — лише свої послуги
    const venue = ({ 'port:shop': 'shop', 'port:fuel': 'fuel', 'port:repair': 'yard', 'port:office': 'office', 'port:market': 'exchange', 'port:tavern': 'tavern', 'port:smoke': 'smoke', 'port:chef': 'chef', 'port:cannery': 'cannery', 'buyer:hermit': 'hermit' } as const)[id as 'port:shop'];
    if (venue) {
      this.openDialog(venue);
      return;
    }
    // станції
    const st = id.replace('st:', '');
    const res = this.stations.tryStart(st);
    if (!res.ok && res.msg && res.msg !== '__sleep__') {
      this.hud.toast(res.msg, 'warn', 2500);
    }
  }

  /** кожен кадр, поки відкрите меню парусів: миша вибирає, клавіші підтверджують */
  private updateSailMenu(input: Input) {
    const menu = this.sailMenu;
    if (this.phase !== 'play' || this.dialogs.isOpen || this.player.mode !== 'boat' || this.player.nearest?.id !== 'st:sails') {
      menu.close();
      return;
    }
    const [dx, dy] = input.consumeMouse();
    menu.move(dx, dy);
    for (const k of ['1', '2', '3', '4', '5']) {
      if (input.pressed('Digit' + k) || input.pressed('Numpad' + k)) {
        const c = menu.byKey(k);
        if (c != null) return this.chooseSails(c);
      }
    }
    if (input.pressed('Mouse2')) return menu.close();
    if (input.pressed('Mouse0') || input.pressed('KeyE')) {
      if (menu.sel != null) return this.chooseSails(menu.sel);
      return menu.close();
    }
    // затиснули E, повели мишею й відпустили — як «колесо» в іграх
    if (!input.down('KeyE')) {
      if (menu.heldLong() && menu.sel != null) return this.chooseSails(menu.sel);
      menu.releaseHold();
    }
  }

  /** вибір з меню: фізична робота біля щогли — що більша зміна, то довше */
  private chooseSails(c: SailChoice) {
    this.sailMenu.close();
    const g = this.game;
    const sr = this.boat.sails;
    if (c === 'genn') {
      const off = !sr.gennOff;
      this.stations.startTimed('sails', off ? L('Прибираємо генакер у мішок…', `Bagging the gennaker…`) : L('Готуємо генакер…', `Rigging the gennaker…`), 1.6, () => {
        if (this.coop.crewing) this.coop.sendAction({ a: 'sails', v: off ? 11 : 10 });
        sr.gennOff = off;
        this.audio.click();
        this.hud.toast(off ? L('⛵ Генакер прибрано', `⛵ Gennaker stowed`) : L('⛵ Генакер готовий — розкриється на повних курсах', `⛵ Gennaker ready — it sets on broad reaches`), 'good', 2400);
      });
      return;
    }
    if (c === sr.mode) return;
    const from = SAIL_AREA[sr.mode], to = SAIL_AREA[c];
    const d = Math.abs(to - from);
    const up = to > from;
    const label = c === 0 ? L('Травимо фал — спускаємо паруси…', `Easing the halyard — dropping the sails…`)
      : up ? L(`Тягнемо фал — ${sailModeLabel(c)}…`, `Hauling the halyard — ${sailModeLabel(c)}…`)
      : L(`Беремо риф — ${sailModeLabel(c)}…`, `Taking a reef — ${sailModeLabel(c)}…`);
    const dur = up ? 1.2 + d * 2.6 : 1.0 + d * 1.6;
    const cost = up ? Math.max(1, Math.round(d * 4)) : Math.max(1, Math.round(d * 2));
    if (!g.spendEnergy(cost)) {
      this.hud.toast(L('Занадто втомлений, щоб тягнути фали', `Too tired to haul the halyards`), 'warn', 2500);
      return;
    }
    this.stations.startTimed('sails', label, dur, () => this.setSails(c));
  }

  private setSails(m: SailMode) {
    if (this.coop.crewing) this.coop.sendAction({ a: 'sails', v: m });
    this.boat.sails.mode = m;
    this.audio.click();
    this.hud.toast(L(`⛵ Паруси: ${this.boat.sails.label()}`, `⛵ Sails: ${this.boat.sails.label()}`), m === 0 ? 'warn' : 'good', 2200);
  }

  private doSleep(inPort: boolean) {
    if (this.coop.isClient) {
      // час світу веде капітан — гість лише відпочиває
      this.game.addEnergy(60);
      this.hud.toast(L('Подрімав годинку. Сили відновлено.', `Took a nap. Energy restored.`), 'good', 3000);
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
      // погода живе далі, поки спиш: стільки ж «реальних» секунд, скільки годин минуло
      this.weather.advance((delta / 24) * DAY_SECONDS);
      this.nets.advanceHours(delta);
      this.lastHours = this.time.hours;
      this.game.addEnergy(100);
      this.game.decayFreshness(delta);
      this.game.tickMarket(delta, this.marketCtx(this.time.hours - delta));
      this.tickTrade(delta);
      this.fade.classList.remove('on');
      this.dawnCard();
      if (inPort) this.saveGame();
      this.hud.toast(L(`Пройшло ${Math.round(delta)} год. ${inPort ? L('Виспався в хаті.', `Slept well in the cottage.`) : L('Виспався на койці.', `Slept well in the bunk.`)}`, `${Math.round(delta)} h passed. ${inPort ? L('Виспався в хаті.', `Slept well in the cottage.`) : L('Виспався на койці.', `Slept well in the bunk.`)}`), 'good', 3500);
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
      (this.player.mode === 'boat' && this.player.level !== 'deck') || this.player.inHouse,
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
    this.ports.setNight(1 - time.daylight);
    this.ports.update(t, this.camera.position);
    // бризки, сплески, дим: рух і згасання (без цього частинки ніколи не малювались і забивали пул)
    this.particles.update(simDt);

    // каюта: тепле світло вночі та у шторм
    this.boat.setInteriorLight(time.daylight, this.weather.intensity);

    // апгрейди-світло (тент — як встановлено: його можна зняти)
    this.boat.applyUpgrades(g.fittedUpgrades(), time.daylight);
    if (!this.coop.crewing) {
      // тент: стан — у сейві власника; екіпаж бачить зі знімка
      this.boat.tentFolded = g.tentFolded;
      this.boat.tentClosed = g.tentClosed;
    }

    // камера: від першої особи / з-за корми (V за штурвалом) / обліт у заставці
    const head = this.player.head;
    const chase = this.rig.mode !== 'fp';
    // тряска: шторм + хвилі
    this.slamShake = Math.max(0, this.slamShake - this.clockDelta * 1.8);
    // у штиль і помірну погоду — без тремтіння (раніше ~1 см на 2 Гц постійно);
    // лише шторм і удар хвилі дають тряску, і повільнішу
    const shakeAmp = Math.max(0, this.weather.intensity - 0.6) * 0.025 + this.slamShake * 0.09;
    this.camShake.set(
      (Math.sin(t * 8.7) + Math.sin(t * 4.3)) * 0.5 * shakeAmp,
      (Math.sin(t * 7.1) + Math.sin(t * 3.9)) * 0.5 * shakeAmp,
      Math.sin(t * 7.9) * 0.5 * shakeAmp,
    );
    // нахил: позицію й курс ми наслідуємо човен повністю, а тангаж/крен — частково
    // (тіло стабілізує половину). Обертання у world-рамці (premultiply) —
    // коректно незалежно від того, куди гравець дивиться. Лише на палубі:
    // у воді тіло тримає рівновагу на хвилі, на причалі човен не наш.
    let tilt: THREE.Quaternion | null = null;
    if (this.player.mode === 'boat') {
      // очі моряка тримають горизонт: у тиху погоду — ~70 % стабілізації, у шторм — менше
      const follow = this.tiltFollow + 0.18 * clamp((this.weather.intensity - 0.5) / 0.5, 0, 1);
      this._tiltEuler.set(this.boat.pitch * follow, 0, this.boat.roll * follow);
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
    this.updateInstruments(this.clockDelta);
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
        name: g.speciesName(f.speciesId) + L(` · ${f.kg.toFixed(f.kg < 1 ? 2 : 1).replace('.', L(',', '.'))} кг`, ` · ${f.kg.toFixed(f.kg < 1 ? 2 : 1).replace('.', L(',', '.'))} kg`),
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
        windup: f.windup,
        jumpWarn: f.jumpWarn,
        strain: f.strain,
        trophy: f.trophy,
        coach: this.fishSkill < 4,
      };
      // волосінь на межі — легке тремтіння
      if (f.strain > 0) this.slamShake = Math.max(this.slamShake, 0.12 + f.strain * 0.25);
    }
    this.hud.setCast(this.fishing.state === 'charge' ? this.fishing.castPower : null, this.fishing.status, this.fishing.castSweet);
    {
      const st = this.fishing.state;
      this.hud.setFishSpot((st === 'waiting' || st === 'bite') && this.fishing.spot ? this.fishing.spot.hint : null);
    }
    this.hud.setRoster(this.coop.active ? this.coop.roster() : []);
    {
      const atSea = Math.hypot(this.boat.pos.x - this.boat.moor.x, this.boat.pos.z - this.boat.moor.z) > 80;
      const risk = g.insurance < 2 && (g.hold.length > 0 || this.deckFish.count > 0 || Object.values(g.upgrades).some((v) => v > g.insurance));
      const b = this.boat;
      this.hud.setInsWarn(
        b.bilge > 2 ? L(`🌊 Вода в трюмі ${Math.round(b.bilge)}%`, `🌊 Water in the bilge ${Math.round(b.bilge)}%`) + (b.autoPumping ? L(' · автопомпа качає', ` · auto pump on`) : '') :
        b.hatchOpen && atSea ? L('⚠ Люк трюму відкрито', `⚠ Hold hatch open`) :
        b.doorOpen && atSea && this.weather.intensity > 0.5 ? L('⚠ Двері каюти відчинені', `⚠ Cabin doors open`) :
        atSea && risk ? (g.insurance ? L('⚠ Слабка страховка', `⚠ Weak insurance`) : L('⚠ Без страховки — ризик', `⚠ No insurance — risky`)) : null,
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
        promptBiteLeft: prompt.bite ? this.fishing.biteLeft : null,
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
    const d = this.port.quay;
    const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
    const bx = this.boat.pos.x, bz = this.boat.pos.z;
    // найближча точка причалу до човна
    const px = clamp(bx, d.x0, d.x1), pz = clamp(bz, d.z0, d.z1);
    const ax = bx - px || bx - cx, az = bz - pz || bz - cz;
    return Math.atan2(ax, az);
  }

  /** скільки риб уже піймав цей гравець (підказки боротьби зникають після кількох) */
  private fishSkill = (() => {
    try {
      return Number(localStorage.getItem('storm-fish-skill')) || 0;
    } catch {
      return 0;
    }
  })();

  private bumpFishSkill() {
    this.fishSkill++;
    try {
      localStorage.setItem('storm-fish-skill', String(this.fishSkill));
    } catch {
      /* ок */
    }
  }

  private applySettings(st: Settings) {
    this.settings = st;
    this.fishing.easy = st.easyFish;
    // у чужій кооп-кімнаті темп задає господар (приходить зі знімком світу)
    if (!(this.coop.active && !this.coop.isHost)) setPace(st.pace);
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
    if (!this.selfAvatar || this.selfColor !== color || this.selfAvatar.hatId !== this.game.hat) {
      this.selfAvatar?.dispose(this.scene);
      this.selfAvatar = new Avatar(this.scene, '', color, this.coop.active ? this.coop.myId : 1, this.game.hat);
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

  /** місце швартування для свого слоту в гавані (вдома — x за слотом флотилії) */
  private berthIn(site: string): Berth {
    if (site === 'home') return { x: this.homeMoorX, z: MOOR.z, h: MOOR_HEADING };
    const list = SITE_BERTHS[site];
    const slot = Math.max(0, MOOR_SLOTS.indexOf(this.homeMoorX));
    return list[slot % list.length];
  }

  /** найближче місце швартування → boat.moor (пружина, сходня, орієнтир) */
  private pickMoor() {
    const bx = this.boat.pos.x, bz = this.boat.pos.z;
    let site = 'home';
    let best = this.berthIn('home');
    let bd = Math.hypot(bx - best.x, bz - best.z);
    for (const p of PORT_SITES) {
      if (Math.abs(bx - p.x) > 500 || Math.abs(bz - p.z) > 500) continue;
      const b = this.berthIn(p.id);
      const d = Math.hypot(bx - b.x, bz - b.z);
      if (d < bd) {
        bd = d;
        best = b;
        site = p.id;
      }
    }
    this.boat.moor.x = best.x;
    this.boat.moor.z = best.z;
    this.boat.moorHeading = best.h;
    this.moorDock = site === 'home' ? this.port.quay : SITE_DOCKS[site];
    this.moorSite = site;
  }

  /** куди везуть після затоплення: найближча відома гавань із верф'ю (дім — завжди) */
  private rescuePort(x: number, z: number): { id: string; berth: Berth } {
    let id = 'home';
    let bd = Math.hypot(x, z);
    for (const p of PORT_SITES) {
      if (p.econ.repair == null || !this.game.places.includes(p.id)) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bd) {
        bd = d;
        id = p.id;
      }
    }
    return { id, berth: this.berthIn(id) };
  }

  /** компас веде до найближчої відомої гавані; напис при заході в гавань */
  private updatePortsNav() {
    const g = this.game;
    const px = this.player.mode === 'boat' ? this.boat.pos.x : this.player.head.x;
    const pz = this.player.mode === 'boat' ? this.boat.pos.z : this.player.head.z;
    const np = this.hud.navPort;
    np.x = MOOR.x; np.z = MOOR.z; np.name = L('Шторм', `Storm Harbour`); np.home = true;
    let bd = Math.hypot(px - MOOR.x, pz - MOOR.z);
    let here: string | null = bd < 80 ? 'home' : null;
    for (const p of PORT_SITES) {
      const b = this.berthIn(p.id);
      const d = Math.hypot(px - b.x, pz - b.z);
      if (d < 80) here = p.id;
      if (!g.places.includes(p.id)) continue;
      if (d < bd) {
        bd = d;
        np.x = b.x; np.z = b.z; np.name = p.name; np.home = false;
      }
    }
    if (here !== this.atSite) {
      // знову в уже відомій гавані — напис (перше відкриття малює checkPlaces)
      if (here && here !== 'home' && g.places.includes(here) && this.phase === 'play') {
        const p = PORT_SITE_BY_ID[here];
        this.hud.titleCard(p.name, L(`гавань · пальне ${p.econ.fuel} ₴/л${p.econ.repair != null ? L(' · верф', ` · shipyard`) : ''}`, `harbour · fuel ${p.econ.fuel} ₴/l${p.econ.repair != null ? L(' · верф', ` · shipyard`) : ''}`));
      }
      this.atSite = here;
    }
  }

  /** повернути голову на точку в локалі яхти (камбуз) */
  private lookAtLocal(p: THREE.Vector3) {
    const w = this.boat.localToWorld(p.x, p.y, p.z, this._v);
    const h = this.player.head;
    const dx = w.x - h.x, dy = w.y - h.y, dz = w.z - h.z;
    this.player.yaw = Math.atan2(-dx, -dz);
    this.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
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
      this.hud.toast(L('Це суша — точку ставлять на воді', `That's land — waypoints go on water`), 'warn', 1800);
      return;
    }
    if (!this.game.addRoutePoint(w[0], w[1])) {
      this.hud.toast(L('Маршрут уже на повну — прибери зайві точки (ПКМ)', `The route is full — remove some points (RMB)`), 'warn', 1800);
      return;
    }
    this.audio.click();
    this.chart.markDirty();
    this.saveGame();
    const n = this.game.route.length;
    const d = Math.hypot(w[0] - this.boat.pos.x, w[1] - this.boat.pos.z);
    this.hud.toast(n === 1 ? L(`📍 Точка 1 · ${this.mapView.fmtDist(d)}. Курс — на компасі`, `📍 Waypoint 1 · ${this.mapView.fmtDist(d)}. Bearing is on the compass`) : L(`📍 Точка ${n} маршруту`, `📍 Route waypoint ${n}`), 'good', 1800);
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

  // ── якір ──
  private anchorLabel(): string {
    const a = this.boat.anchor;
    if (a.state === 0) {
      const b = this.boat.localToWorld(0, 1, 4.9, this._v);
      const d = seabedDepth(b.x, b.z);
      return d > ANCHOR_MAX_DEPTH ? L(`Брашпиль — тут задуглибоко (${Math.round(d)} м), якір не дістане`, `Windlass — too deep here (${Math.round(d)} m), the anchor won't reach`) : L(`Брашпиль — віддати якір (глибина ${Math.round(d)} м)`, `Windlass — drop anchor (depth ${Math.round(d)} m)`);
    }
    if (a.winch < 0) return L('Брашпиль — знову травити ланцюг', `Windlass — pay out the chain again`);
    return L(`Брашпиль — вибрати якір (${Math.round(a.chain)} м ланцюга)`, `Windlass — weigh anchor (${Math.round(a.chain)} m of chain)`);
  }

  private anchorToggle() {
    const a = this.boat.anchor;
    this.audio.click();
    if (!this.coop.crewing) {
      this.anchorResult(a.toggle(this.boat));
      return;
    }
    // екіпаж: глибину видно й самому, команду виконує власник яхти
    if (a.state === 0) {
      const b = this.boat.localToWorld(0, 1, 4.9, this._v);
      const d = seabedDepth(b.x, b.z);
      if (d > ANCHOR_MAX_DEPTH) return this.anchorResult('deep');
    }
    this.coop.sendAction({ a: 'anchor', v: 1 });
    this.anchorResult(a.state === 0 || a.winch < 0 ? 'drop' : 'raise');
  }

  private anchorResult(r: AnchorResult, nick?: string) {
    const a = this.boat.anchor;
    const who = nick ? `${nick}: ` : '';
    if (r === 'drop') this.hud.toast(L(`⚓ ${who}якір пішов${a.depth ? L(` · глибина ${Math.round(a.depth)} м`, ` · depth ${Math.round(a.depth)} m`) : ''}`, `⚓ ${who}anchor's down${a.depth ? L(` · глибина ${Math.round(a.depth)} м`, ` · depth ${Math.round(a.depth)} m`) : ''}`), 'good', 2400);
    else if (r === 'raise') this.hud.toast(L(`⚓ ${who}брашпиль вибирає ланцюг…`, `⚓ ${who}the windlass is hauling the chain…`), 'good', 2000);
    else if (r === 'deep') {
      const b = this.boat.localToWorld(0, 1, 4.9, this._v);
      this.hud.toast(L(`Тут задуглибоко (${Math.round(seabedDepth(b.x, b.z))} м) — якір не дістає дна. Шукай мілину біля берега чи острова`, `Too deep here (${Math.round(seabedDepth(b.x, b.z))} m) — the anchor can't reach the bottom. Look for shallows near the shore or an island`), 'warn', 3200);
    } else if (r === 'shallow') this.hud.toast(L('Тут замілко — спершу відійди від берега', `Too shallow here — move away from the shore first`), 'warn', 2400);
  }

  /** чіп «на якорі», попередження про дрейф, «якір на борту» */
  private updateAnchorHud(dt: number) {
    const a = this.boat.anchor;
    const chain = L(`${Math.round(a.chain)} м ланцюга`, `${Math.round(a.chain)} m of chain`);
    const dragging = a.state === 2 && a.drag > 0.5;
    this.hud.setAnchorChip(
      a.state === 0 ? null :
      dragging ? L('⚓ якір повзе!', `⚓ anchor dragging!`) :
      a.winch < 0 ? L(`⚓ вибираємо · ${chain}`, `⚓ weighing · ${chain}`) :
      a.state === 1 ? L('⚓ віддаємо якір…', `⚓ dropping anchor…`) :
      a.winch > 0 ? L(`⚓ травимо · ${chain}`, `⚓ paying out · ${chain}`) :
      L(`⚓ на якорі · ${chain}`, `⚓ at anchor · ${chain}`),
      dragging,
    );
    if (this.anchorPrev !== 0 && a.state === 0) this.hud.toast(L('⚓ Якір на борту — можна йти', `⚓ Anchor aboard — you can go`), 'good', 2000);
    this.anchorPrev = a.state;
    this.anchorWarnT -= dt;
    if (dragging && this.anchorWarnT <= 0 && !this.coop.crewing) {
      this.anchorWarnT = 14;
      const b = this.boat;
      this.hud.toast(
        Math.abs(b.throttle) > 0.3 ? L('⚓ Газ проти ланцюга — якір повзе по дну. Спершу вибери якір (брашпиль на баку)', `⚓ Throttle against the chain — the anchor is dragging along the bottom. Weigh the anchor first (windlass on the foredeck)`) :
        b.sails.mode > 0 ? L('⚓ Паруси тягнуть яхту — якір повзе. Спусти паруси або вибери якір', `⚓ The sails are pulling the yacht — the anchor is dragging. Drop the sails or weigh anchor`) :
        L('⚓ Шторм зриває якір — яхту зносить! Шукай мілину ближче до берега або вибирай якір і йди', `⚓ The storm is tearing the anchor loose — the yacht is drifting! Find shallows closer to shore or weigh anchor and go`),
        'warn', 4200,
      );
    }
  }

  /** тент: скласти/розкласти або опустити/скрутити штори (екіпаж — через власника) */
  private tentToggle(what: 'tent' | 'curtain') {
    const b = this.boat;
    this.audio.thump(0.3);
    if (what === 'tent') {
      const fold = !b.tentFolded;
      if (this.coop.crewing) {
        this.coop.sendAction({ a: 'tent', v: fold ? 1 : 0 });
        b.tentFolded = fold;
      } else {
        this.game.tentFolded = fold;
        if (fold) this.game.tentClosed = false;
        this.saveGame();
      }
      this.hud.toast(fold ? L('⛺ Тент складено — над кокпітом лише небо й паруси', `⛺ Canvas folded — nothing but sky and sails over the cockpit`) : L('⛺ Тент розкладено', `⛺ Canvas unfolded`), 'good', 2000);
      return;
    }
    const close = !b.tentClosed;
    if (this.coop.crewing) {
      this.coop.sendAction({ a: 'curtain', v: close ? 1 : 0 });
      b.tentClosed = close;
    } else {
      this.game.tentClosed = close;
      this.saveGame();
    }
    this.hud.toast(close ? L('⛺ Штори опущено — кокпіт закрито від хвиль і дощу', `⛺ Curtains down — the cockpit is closed off from waves and rain`) : L('⛺ Штори скручено — видно все навколо', `⛺ Curtains rolled up — you can see all around`), 'good', 2000);
  }

  /** ключ запалювання (X за штурвалом); екіпаж просить власника яхти */
  private ignition() {
    this.audio.click();
    if (this.coop.crewing) {
      if (!this.boat.engineOn && !this.boat.engineKilled) return this.ignitionResult('stalled');
      this.coop.sendAction({ a: 'ign' });
      this.ignitionResult(this.boat.engineOn ? 'off' : 'on');
      this.coop.myHelm[0] = 0;
      return;
    }
    this.ignitionResult(this.boat.toggleIgnition());
  }

  private ignitionResult(r: 'off' | 'on' | 'stalled', nick?: string) {
    const who = nick ? `${nick}: ` : '';
    if (r === 'off') this.hud.toast(L(`🔑 ${who}двигун заглушено`, `🔑 ${who}engine stopped`), 'good', 2000);
    else if (r === 'on') this.hud.toast(L(`🔑 ${who}двигун запущено`, `🔑 ${who}engine started`), 'good', 2000);
    else this.hud.toast(L('Двигун заглох — запусти його в моторному відсіку на кормі (E)', `The engine stalled — restart it in the engine bay at the stern (E)`), 'warn', 3000);
  }

  /** автопілот: увімк./вимк. (екіпаж просить власника яхти) */
  private toggleAutopilot(on = !this.boat.autopilot) {
    if (this.coop.crewing) {
      this.coop.sendAction({ a: 'ap', v: on ? 1 : 0 });
      this.boat.autopilot = on; // відразу на своєму пульті; знімок власника підтвердить
    } else this.setAutopilot(on);
    this.audio.instrBeep(on ? 'apOn' : 'apOff');
  }

  private setAutopilot(on: boolean, why = '') {
    if (on === this.boat.autopilot) return;
    if (on && this.game.upgrades.instr < 5) return;
    this.boat.autopilot = on;
    this.apHold = this.boat.heading;
    this.apPrevH = this.boat.heading;
    const wp = this.game.waypoint;
    this.hud.toast(
      on ? (wp ? L('🤖 Автопілот: веду маршрутом. Кермо (A/D) чи T — вимкнути', `🤖 Autopilot: following the route. Rudder (A/D) or T — off`) : L('🤖 Автопілот тримає курс. Кермо (A/D) чи T — вимкнути', `🤖 Autopilot is holding course. Rudder (A/D) or T — off`)) : L(`🤖 Автопілот вимкнено${why ? ' — ' + why : ''}`, `🤖 Autopilot off${why ? ' — ' + why : ''}`),
      on ? 'good' : 'warn',
      2600,
    );
    if (!on && why) this.audio.instrBeep('apOff');
  }

  /** автопілот (симулює власник яхти): кермо на точку маршруту або тримати курс */
  private autopilotStep(dt: number) {
    const b = this.boat;
    if (!b.autopilot) return;
    const steering = this.player.wheeling && this.phase === 'play' && (Input.instance.down('KeyA') || Input.instance.down('KeyD'));
    if (this.coop.crewing) {
      // екіпаж за штурвалом крутить кермо — просимо власника вимкнути
      if (steering) this.toggleAutopilot(false);
      return;
    }
    if (steering || (this.game.upgrades.instr ?? 0) < 5) {
      this.setAutopilot(false, steering ? L('кермо в руках', `hands on the wheel`) : '');
      return;
    }
    // скелі/мілина по курсу — вимкнути й пискнути
    const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
    const look = Math.min(70, 18 + b.vel.length() * 6);
    for (let d = 10; d <= look; d += 6) {
      const x = b.pos.x + fx * d, z = b.pos.z + fz * d;
      const rock = this.port.rocks.some((r) => !r.kind && Math.hypot(r.x - x, r.z - z) < r.r + 4);
      if (rock || depthAt(x, z) < 3) {
        this.setAutopilot(false, L('попереду мілина чи скеля!', `shallows or rocks ahead!`));
        this.audio.instrBeep('shallow');
        return;
      }
    }
    const wp = this.game.waypoint;
    const want = wp ? Math.atan2(wp.x - b.pos.x, wp.z - b.pos.z) : this.apHold;
    if (wp) this.apHold = want;
    const err = Math.atan2(Math.sin(want - b.heading), Math.cos(want - b.heading));
    const rate = dt > 0 ? Math.atan2(Math.sin(b.heading - this.apPrevH), Math.cos(b.heading - this.apPrevH)) / dt : 0;
    this.apPrevH = b.heading;
    // ПД-регулятор: rudder +1 крутить heading угору (див. Player: D → −1 → праворуч)
    const cmd = clamp(err * 2.4 - rate * 1.6, -1, 1);
    b.rudder = cmd;
  }

  /** прилади: рівень, екрани, чіпи HUD, маршрут/AIS на мінікарті */
  private updateInstruments(dt: number) {
    const g = this.game, b = this.boat;
    const lvl = g.upgrades.instr ?? 0;
    const has = instrHas(lvl);
    if (this.instruments.level !== lvl) this.instruments.setLevel(lvl);
    const bots = this.bots.markers();
    this.minimap.bots = bots;
    this.minimap.ais = has.radar;
    this.mapView.bots = has.radar ? bots : [];
    this.minimap.route = has.gps ? g.route : [];
    // риба під кілем: базово за зоною, біля зграй з радіозвітів — густіше
    const dist = Math.hypot(b.pos.x, b.pos.z);
    const zone = zoneFromDist(dist);
    let fish = (zone === 'shore' ? 0.34 : zone === 'mid' ? 0.3 : 0.24) + (this.time.isNight ? 0.05 : 0);
    let school: { x: number; z: number; name: string } | null = null;
    let sd = 900;
    for (const r of g.reports) {
      const [ax, az] = SCHOOL_ANCHORS[r.zone];
      const d = Math.hypot(ax - b.pos.x, az - b.pos.z);
      fish += Math.max(0, 1 - d / 320) * 0.25 * r.boost;
      if (d < sd) {
        sd = d;
        school = { x: ax, z: az, name: g.speciesName(r.speciesId) };
      }
    }
    const depth = depthAt(b.pos.x, b.pos.z);
    if (depth < 2) fish *= 0.3;
    fish = clamp(fish + (Math.sin(this.simTime * 0.37) * 0.04), 0, 1);
    const snap = this.weather.snapshot();
    const falling = this.weather.localStormEta != null || snap.forecast > this.weather.base + 0.12;
    const s = b.sails;
    this.instruments.update(dt, {
      x: b.pos.x,
      z: b.pos.z,
      heading: b.heading,
      speed: b.vel.length(),
      awa: s.awa,
      aws: s.aws,
      fromStarboard: s.windFromStarboard,
      hpa: 1024 - this.weather.intensity * 42 - (falling ? 6 : 0),
      falling,
      route: g.route,
      boats: [...bots, ...(this.coop.active ? this.coop.fleetBoats() : [])],
      rocks: this.port.rocks,
      fish,
      school,
      autopilot: b.autopilot,
      night: this.time.isNight,
    });
    this.hud.instr = {
      lvl,
      speed: b.vel.length(),
      depth,
      wind: this.weather.windMs,
      falling,
      fishBrg: school && sd > 40 && sd < 700 ? bearingDeg(b.pos.x, b.pos.z, school.x, school.z) : null,
      fish,
      autopilot: b.autopilot,
    };
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
    if (this.kitchen.active) return { text: null, bite: false };
    if (this.chartMode) {
      const [cw, ch] = this.chart.size;
      const w = this.mapView.uvToWorld(this.chart.u, this.chart.v, cw, ch);
      const d = w ? ` (${this.mapView.fmtDist(Math.hypot(w[0] - this.boat.pos.x, w[1] - this.boat.pos.z))})` : '';
      return { text: L(`Точка маршруту${d} · ПКМ — прибрати, затиснути й тягти — рухати карту (або WASD) · коліщатко — зум · E — встати`, `Route point${d} · RMB — remove, hold and drag — move the chart (or WASD) · wheel — zoom · E — stand up`), bite: false, key: L('ЛКМ', `LMB`) };
    }
    const np = this.player.mode === 'boat' ? this.nets.prompt(this.boat) : null;
    if (np && this.fishing.state !== 'fight' && this.fishing.state !== 'bite') return { text: np, bite: false };
    // боротьба — перш за все
    if (this.fishing.state === 'fight' || this.fishing.state === 'charge') return { text: null, bite: false };
    if (this.fishing.state === 'bite') return { text: L('Клює! Підсікай!', `Bite! Strike!`), bite: true, key: L('ЛКМ', `LMB`) };
    // волосінь у воді — підказка риболовлі важливіша за сусідню станцію (люк, ящик…)
    if (this.fishing.state === 'waiting') {
      const fp = this.fishing.prompt();
      if (fp) return { text: fp, bite: false, key: '' };
    }
    // станція-дія активна
    if (this.stations.active) return { text: this.stations.active.label, bite: false };
    // риба на палубі / в руках
    if (this.player.mode === 'boat') {
      const near = !this.deckFish.carried && this.deckFish.nearest(this.player.localX, this.player.localZ, 1.2);
      if (near) return { text: L(`Підняти: ${this.game.speciesName(near.speciesId).toLowerCase()} ${near.kg.toFixed(near.kg < 1 ? 2 : 1).replace('.', L(',', '.'))} кг`, `Pick up: ${this.game.speciesName(near.speciesId).toLowerCase()} ${near.kg.toFixed(near.kg < 1 ? 2 : 1).replace('.', L(',', '.'))} kg`), bite: false };
      if (this.deckFish.carried && this.player.nearest?.id !== 'st:fishbox') return { text: L('Риба в руках — неси до ящика на баку', `Fish in hand — carry it to the box on the foredeck`), bite: false };
    }
    // найближча ціль
    if (this.player.nearest) {
      const n = this.player.nearest;
      return { text: n.label, bite: false };
    }
    const fp = this.fishing.prompt() ?? (this.player.mode === 'port' ? this.fishing.shorePrompt(this.player.wx, this.player.wz, this.player.yaw) : null);
    if (fp) return { text: fp, bite: false, key: L('ЛКМ', `LMB`) };
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
