import { clamp, mulberry32 } from '../core/math';
import { FISH, FISH_BY_ID, fishSellPrice, zoneFromDist } from './fish';
import { isUk, L, plural } from '../core/i18n';
import { avgKg, FishMarket, PortMarket, glutUnits, speciesGen, type MarketCtx, type MarketEvent, type MarketSave } from './market';
import { BUYER_BY_ID, contractNeed, fitsContract, FishTrade, type BuyerId, type Contract, type TradeSave } from './buyers';
import { PORT_SITES, PORT_SITE_BY_ID, type PortSite } from '../world/portSites';
import { defaultUpgrades, eff, UPGRADES, MAX_LEVEL, upgradeCost, upgradeLock } from './upgrades';
import type {
  FishItem,
  ObjectiveState,
  PlayerStats,
  RadioReport,
  SaveData,
  UpgradeId,
  ZoneId,
} from '../core/types';

const SAVE_KEY = 'storm-fishers-save-v1';

export class GameState {
  money = 500;
  fuel = 40; // = базовий об'єм бака (eff.maxFuel(0)); інакше човен стартує з «переповненим» баком
  hull = 100;
  energy = 100;
  hold: FishItem[] = [];
  /** кооп-екіпаж: трюм належить яхті власника — зміни йдуть йому */
  holdHook: ((op: 'add' | 'remove' | 'cook', f: FishItem) => void) | null = null;
  /** страховка човна: 0 — немає, 1..4 — рівні (insurance.ts) */
  insurance = 0;
  upgrades = defaultUpgrades();
  discovered: string[] = [];
  /** відкриті місця (пам'ятки в морі) */
  places: string[] = [];
  /** знахідки на островах (капелюхи, пляшки, скриня) */
  finds: string[] = [];
  /** вибраний капелюх (game/hats.ts) */
  hat = 'captain';
  /** тент: скільки рівнів встановлено (null — усе куплене; 0 — знято зовсім) */
  tentFit: number | null = null;
  tentFolded = false;
  tentClosed = false;

  /** рівні апгрейдів, як вони стоять на яхті (тент можна зняти частково чи повністю) */
  fittedUpgrades(): Record<string, number> {
    const t = this.upgrades.tent ?? 0;
    return { ...this.upgrades, tent: this.tentFit == null ? t : Math.max(0, Math.min(t, this.tentFit)) };
  }
  /** рекорд ваги за видом, кг */
  records: Record<string, number> = {};
  /** крок навчання «що далі» (TUTORIAL.length — пройдено) */
  tut = 0;
  /** пройдений маршрут: плоский масив [x0,z0,x1,z1,…] */
  track: number[] = [];
  objectives: ObjectiveState = {
    firstSale: false,
    allSpecies: false,
    stormReturn: false,
    maxUpgrades: false,
    rich: false,
  };
  stats: PlayerStats = { totalCaught: 0, totalEarned: 0, stormsSurvived: 0, tripsOut: 0 };

  priceWeek = 1;
  priceMult: Record<string, number> = {};
  private weekRng = mulberry32(1234);
  /** біржа: насичення за видами, історія цін, події */
  market = new FishMarket();
  /** скупники риби: репутація, попит, замовлення (game/buyers.ts) */
  trade = new FishTrade();
  /** абсолютний ігровий час (день × 24 + година) — оновлює Game щокадру */
  clockH = 32;
  /** порт, де зараз послуги (біржа, пальне, верф): 'home' — «Шторм» (portSites.ts) */
  portId = 'home';
  /** біржі інших портів: свої запаси, споживання й підвіз (game/market.ts) */
  private portMarkets: Record<string, PortMarket> = {};
  /** кооп-гість продав рибу: капітан кімнати має врахувати її в запасах біржі */
  saleHook: ((portId: string, speciesId: string, units: number) => void) | null = null;

  /** біржа порту за id ('home' — «Шторм») */
  marketOf(portId: string): FishMarket {
    const site = PORT_SITE_BY_ID[portId];
    if (!site) return this.market;
    let m = this.portMarkets[site.id];
    if (!m) {
      m = this.portMarkets[site.id] = makePortMarket(this.market, site);
      m.remote = this.market.remote;
      m.seedHistory();
    }
    return m;
  }

  /** усі біржі: [id, біржа] */
  allMarkets(): Array<[string, FishMarket]> {
    return [['home', this.market], ...PORT_SITES.map((p) => [p.id, this.marketOf(p.id)] as [string, FishMarket])];
  }

  /** біржа порту, де ти зараз (домашня — market) */
  get venueMarket(): FishMarket {
    return this.marketOf(this.portId);
  }

  /** ціна за кг свіжої риби виду тут (біржа, де ти зараз) — одна для радіо, біржі й продажу */
  quotePerKg(speciesId: string, portId = this.portId): number {
    return this.marketOf(portId).perKg(speciesId, this.priceMult);
  }

  /** ціна свіжої рибини середньої ваги — скільки дасть біржа за типову рибину зараз */
  quoteTypical(speciesId: string, portId = this.portId): number {
    return Math.round(this.quotePerKg(speciesId, portId) * avgKg(speciesId));
  }

  /** назва порту послуг */
  get venueName(): string {
    return PORT_SITE_BY_ID[this.portId]?.name ?? L('Шторм', `Storm Harbour`);
  }

  /** ціна пального тут, ₴/л */
  get venueFuel(): number {
    return PORT_SITE_BY_ID[this.portId]?.econ.fuel ?? 6;
  }

  /** множник ціни ремонту тут */
  get venueRepair(): number {
    return PORT_SITE_BY_ID[this.portId]?.econ.repair ?? 1;
  }

  /** подія біржі, що з'явилась у новий день (для оголошення) */
  lastMarketEvent: MarketEvent | null = null;

  // радіо-звіти дня (обновлюються щодня)
  reports: RadioReport[] = [];

  // навігація: маршрут із точок (карта M / штурманський стіл); перша — поточна ціль
  route: Array<{ x: number; z: number }> = [];

  /** поточна точка маршруту (на неї вказує компас) */
  get waypoint(): { x: number; z: number } | null {
    return this.route[0] ?? null;
  }

  constructor() {
    this.rollPrices();
    this.rollReports();
    this.market.sample(this.priceMult);
    this.market.backfill(this.priceMult, this.priceWeek);
  }

  // ── Економіка ──

  get maxFuel() {
    return eff.maxFuel(this.upgrades.fuel);
  }
  get maxHull() {
    return eff.maxHull(this.upgrades.hull);
  }
  get holdCap() {
    return eff.holdCap(this.upgrades.hold);
  }

  addFuel(liters: number) {
    this.fuel = clamp(this.fuel + liters, 0, this.maxFuel);
  }
  spendFuel(liters: number): boolean {
    if (this.fuel < liters) return false;
    this.fuel -= liters;
    return true;
  }

  /** нижня межа корпусу: біля причалу (пришвартовано) яхта не тоне — див. Boat.update */
  hullFloor = 0;

  damage(amount: number) {
    if (this.hull <= this.hullFloor) return;
    this.hull = clamp(this.hull - amount, this.hullFloor, this.maxHull);
  }
  repair(amount: number) {
    this.hull = clamp(this.hull + amount, 0, this.maxHull);
  }

  spendEnergy(e: number): boolean {
    if (this.energy < e) return false;
    this.energy = clamp(this.energy - e, 0, 100);
    return true;
  }
  addEnergy(e: number) {
    this.energy = clamp(this.energy + e, 0, 100);
  }

  /** спробувати додати рибу в трюм */
  addFish(item: FishItem): boolean {
    if (this.hold.length >= this.holdCap) return false;
    this.hold.push(item);
    this.holdHook?.('add', item);
    this.recordCatch(item);
    return true;
  }

  /** риба піймана (відкриття виду, статистика) — ще не в трюмі */
  recordCatch(item: FishItem) {
    if (!this.discovered.includes(item.speciesId)) this.discovered.push(item.speciesId);
    if (item.kg > (this.records[item.speciesId] ?? 0)) this.records[item.speciesId] = Math.round(item.kg * 1000) / 1000;
    this.stats.totalCaught++;
    this.checkObjectives();
  }

  /** покласти рибу в ящик (уже піймана — без статистики) */
  storeFish(item: FishItem): boolean {
    if (this.hold.length >= this.holdCap) return false;
    this.hold.push(item);
    this.holdHook?.('add', item);
    return true;
  }

  removeFish(uid: number): FishItem | undefined {
    const i = this.hold.findIndex((f) => f.uid === uid);
    if (i < 0) return undefined;
    const f = this.hold.splice(i, 1)[0];
    this.holdHook?.('remove', f);
    return f;
  }

  /** ціна цієї риби, якщо продати її зараз (тренд × біржа × свіжість) */
  sellPrice(f: FishItem): number {
    return fishSellPrice(f, this.priceMult, this.venueMarket.factor(f.speciesId));
  }

  /** порядок продажу «спершу найдорожчі» (попит падає з кожною рибиною) */
  sellOrder(items: FishItem[]): FishItem[] {
    return [...items].sort((a, b) => this.sellPrice(b) - this.sellPrice(a));
  }

  /** чесний прорахунок продажу кількох риб поспіль: ціни по черзі й сума */
  quote(items: FishItem[]): { total: number; prices: number[] } {
    const vm = this.venueMarket;
    const stock: Record<string, number> = {};
    const prices: number[] = [];
    let total = 0;
    for (const f of this.sellOrder(items)) {
      const g = stock[f.speciesId] ?? vm.stockOf(f.speciesId);
      const v = fishSellPrice(f, this.priceMult, vm.factorAt(f.speciesId, g));
      stock[f.speciesId] = g + glutUnits(f);
      prices.push(v);
      total += v;
    }
    return { total, prices };
  }

  /** продати кілька риб поспіль (найдорожчі першими), повертає суму */
  sellMany(uids: number[]): number {
    const set = new Set(uids);
    const items = this.sellOrder(this.hold.filter((f) => set.has(f.uid)));
    let sum = 0;
    for (const f of items) sum += this.sellOne(f.uid);
    return sum;
  }

  /** продати все, повертає суму */
  sellAll(): number {
    return this.sellMany(this.hold.map((f) => f.uid));
  }

  sellOne(uid: number): number {
    const f = this.hold.find((x) => x.uid === uid);
    if (!f) return 0;
    const v = this.sellPrice(f);
    this.removeFish(uid);
    this.venueMarket.recordSale(f);
    this.saleHook?.(this.portId, f.speciesId, glutUnits(f));
    this.money += v;
    this.stats.totalEarned += v;
    this.objectives.firstSale = true;
    this.checkObjectives();
    return v;
  }

  // ── Скупники (таверна, коптильня, ресторан, завод, Остап) ──

  /** ціни партії в цього скупника (null — риба не підходить) */
  buyerQuote(id: BuyerId, items: FishItem[]) {
    return this.trade.quote(BUYER_BY_ID[id], items, this.priceMult, this.clockH);
  }

  /** продати скупнику; повертає суму (кооп-екіпаж: риба знімається з трюму власника через holdHook) */
  sellToBuyer(id: BuyerId, uids: number[]): number {
    const b = BUYER_BY_ID[id];
    if (!this.trade.isOpen(b, this.clockH)) return 0;
    const set = new Set(uids);
    const items = this.hold.filter((f) => set.has(f.uid));
    const q = this.trade.quote(b, items, this.priceMult, this.clockH);
    let sum = 0;
    for (const [uid, v] of q.prices) {
      const f = this.removeFish(uid);
      if (!f) continue;
      this.trade.recordSale(b, f);
      sum += v;
    }
    if (!sum) return 0;
    this.money += sum;
    this.stats.totalEarned += sum;
    this.trade.addRep(id, Math.min(3, q.prices.size * 0.25));
    this.objectives.firstSale = true;
    this.checkObjectives();
    return sum;
  }

  /** риба з трюму, що підходить під замовлення (у порядку здачі) */
  contractFish(c: Contract): FishItem[] {
    const fit = this.hold.filter((f) => fitsContract(c, f));
    // на вагу — спершу важчі (менше рибин), поштучно — спершу найдешевші
    return c.kg ? fit.sort((a, b) => b.kg - a.kg) : fit.sort((a, b) => this.sellPrice(a) - this.sellPrice(b));
  }

  /** здати рибу під замовлення; повертає { delivered, done, reward } */
  deliverContract(cid: string): { delivered: number; done: boolean; reward: number } {
    const c = this.trade.active.find((x) => x.id === cid);
    if (!c) return { delivered: 0, done: false, reward: 0 };
    const need = contractNeed(c);
    let delivered = 0;
    for (const f of this.contractFish(c)) {
      if (c.got >= need - 1e-6) break;
      if (!this.removeFish(f.uid)) continue;
      c.got = Math.round((c.got + (c.kg ? f.kg : 1)) * 100) / 100;
      delivered++;
    }
    if (c.got < need - 1e-6) return { delivered, done: false, reward: 0 };
    this.trade.active = this.trade.active.filter((x) => x !== c);
    this.trade.addRep(c.buyer, c.rep);
    this.trade.done++;
    this.money += c.reward;
    this.stats.totalEarned += c.reward;
    this.checkObjectives();
    return { delivered, done: true, reward: c.reward };
  }

  buyUpgrade(id: UpgradeId): boolean {
    const cost = upgradeCost(id, this.upgrades[id]);
    if (cost == null || this.money < cost || upgradeLock(id, this.upgrades)) return false;
    this.money -= cost;
    this.upgrades[id]++;
    // корпус: після апгрейду збільшуємо поточну міцність на таку ж кількість
    if (id === 'hull') this.hull = Math.min(this.maxHull, this.hull + 40);
    // новий рівень тенту ставлять одразу — увесь, що є
    if (id === 'tent') {
      this.tentFit = null;
      this.tentFolded = false;
    }
    this.checkObjectives();
    return true;
  }

  /** щотижневий (кожні 24 год гри) коливання цін ±15 % */
  rollPrices() {
    const old = { ...this.priceMult };
    this.priceWeek++;
    for (const sp of FISH) {
      this.priceMult[sp.id] = 0.85 + this.weekRng() * 0.3;
    }
    this.lastMarketEvent = this.market.newDay(old, this.priceWeek);
  }

  /** хід ігрового часу для бірж (годин): споживання, підвіз флотилій, історія */
  tickMarket(dtHours: number, ctx?: MarketCtx) {
    for (const [, m] of this.allMarkets()) m.tick(dtHours, this.priceMult, ctx);
  }

  /**
   * бот пришвартувався в «Штормі» й здає улов (зони, де ловив; share — частка
   * «пулу» — більша, якщо довго ловив у гарну погоду). Повертає текст новини або null.
   */
  botUnload(who: string, zones: ZoneId[], share: number): string | null {
    const got = this.market.botUnload(zones, share);
    if (!got.length) return null;
    const kg = got.reduce((a, [id, u]) => a + u * avgKg(id), 0);
    if (kg < 3) return null;
    const [top] = got[0];
    const drop = this.market.demand(top) < 0.97;
    // текст складається мовою читача (кооп-гість може мати іншу мову): «@u|кг|вид|ще видів|падає»
    const text = `@u|${Math.round(kg)}|${top}|${got.length - 1}|${drop ? 1 : 0}`;
    this.market.pushNews({ h: this.clockH, who, text });
    return newsText(text, who);
  }

  /** кооп: компактний знімок запасів усіх бірж + новини (від капітана кімнати) */
  marketSnapshot(): { s: Record<string, number[]>; n: Array<[number, string, string]> } {
    const s: Record<string, number[]> = {};
    for (const [id, m] of this.allMarkets()) s[id] = m.packStock();
    return { s, n: this.market.news.map((n) => [Math.round(n.h * 100) / 100, n.who, n.text]) };
  }

  /** кооп-гість: прийняти знімок запасів; повертає нові новини (щоб показати) */
  applyMarketSnapshot(d: unknown): Array<{ who: string; text: string }> {
    const fresh: Array<{ who: string; text: string }> = [];
    if (!d || typeof d !== 'object') return fresh;
    const o = d as { s?: Record<string, unknown>; n?: unknown };
    if (o.s && typeof o.s === 'object') for (const [id, a] of Object.entries(o.s)) if (id === 'home' || PORT_SITE_BY_ID[id]) this.marketOf(id).unpackStock(a);
    if (Array.isArray(o.n)) {
      const seen = new Set(this.market.news.map((n) => `${n.h}|${n.who}`));
      for (const r of o.n) {
        if (!Array.isArray(r) || typeof r[0] !== 'number' || typeof r[1] !== 'string' || typeof r[2] !== 'string') continue;
        const key = `${r[0]}|${r[1]}`;
        if (seen.has(key)) continue;
        this.market.pushNews({ h: r[0], who: r[1], text: r[2] });
        fresh.push({ who: r[1], text: r[2] });
      }
    }
    return fresh;
  }

  /** кооп-гість: запаси від капітана (без свого підвозу/споживання) */
  setMarketRemote(on: boolean) {
    for (const [, m] of this.allMarkets()) m.remote = on;
  }

  /** свіжий радіо-звіт дня: 2–3 види в зонах */
  rollReports() {
    const rng = mulberry32(this.priceWeek * 7919 + 13);
    this.reports = [];
    const n = 2 + Math.floor(rng() * 2);
    const zones: ZoneId[] = ['shore', 'mid', 'open'];
    for (let i = 0; i < n; i++) {
      const zone = zones[Math.floor(rng() * zones.length)];
      const cands = FISH.filter((f) => f.zones.includes(zone));
      const sp = cands[Math.floor(rng() * cands.length)];
      if (!this.reports.some((r) => r.speciesId === sp.id)) {
        this.reports.push({ zone, speciesId: sp.id, boost: 1.4 + rng() * 0.6 });
      }
    }
  }

  reportBoost(speciesId: string, zone: ZoneId): number {
    const r = this.reports.find((x) => x.speciesId === speciesId && x.zone === zone);
    return r ? r.boost : 1;
  }

  // ── Навігація ──

  /** поставити/переставити точку на карті */
  /** додати точку маршруту, якщо відпливли достатньо далеко */
  addTrack(x: number, z: number) {
    const n = this.track.length;
    if (n >= 2 && Math.hypot(x - this.track[n - 2], z - this.track[n - 1]) < 25) return;
    this.track.push(Math.round(x), Math.round(z));
    if (this.track.length > 800) this.track.splice(0, this.track.length - 800);
  }

  static readonly ROUTE_MAX = 24;

  setWaypoint(x: number, z: number) {
    this.route = [{ x, z }];
  }

  clearWaypoint() {
    this.route = [];
  }

  /** додати точку в кінець маршруту (або вставити перед index) */
  addRoutePoint(x: number, z: number, index = this.route.length): boolean {
    if (this.route.length >= GameState.ROUTE_MAX) return false;
    this.route.splice(Math.max(0, Math.min(index, this.route.length)), 0, { x, z });
    return true;
  }

  removeRoutePoint(i: number) {
    if (i >= 0 && i < this.route.length) this.route.splice(i, 1);
  }

  /** яхта дійшла до поточної точки → наступна; повертає пройдену точку */
  advanceRoute(x: number, z: number, radius = 30): { x: number; z: number } | null {
    const wp = this.route[0];
    if (!wp || Math.hypot(wp.x - x, wp.z - z) > radius) return null;
    return this.route.shift() ?? null;
  }

  private checkObjectives() {
    if (this.discovered.length >= FISH.length) this.objectives.allSpecies = true;
    if (UPGRADES.every((u) => this.upgrades[u.id] >= MAX_LEVEL)) this.objectives.maxUpgrades = true;
    if (this.money >= 25000) this.objectives.rich = true;
  }

  /** пошкоджений улов (затоплення): втрата частки */
  loseHoldFraction(f: number) {
    const n = Math.ceil(this.hold.length * f);
    this.hold.splice(0, n);
  }

  /** риба в трюмі на льоду: від свіжої до зовсім несвіжої — ~60 год гри (≈25 хв реального часу) */
  static readonly FRESH_HOURS = 60;

  /** свіжість падає: dt — години гри (перші години на льоду — майже без втрат) */
  decayFreshness(dtHours: number) {
    for (const f of this.hold) {
      if (f.cooked) continue;
      const k = f.freshness > 92 ? 0.5 : 1;
      f.freshness = clamp(f.freshness - (dtHours / GameState.FRESH_HOURS) * 100 * k, 0, 100);
    }
  }

  // ── Збереження ──

  /** створює SaveData з поточного стану (без запису) */
  buildSave(): SaveData {
    return {
      version: 1,
      money: this.money,
      fuel: this.fuel,
      hull: this.hull,
      energy: this.energy,
      hold: this.hold,
      insurance: this.insurance,
      upgrades: this.upgrades,
      discovered: this.discovered,
      places: this.places,
      finds: this.finds,
      hat: this.hat,
      tentFit: this.tentFit,
      tentFolded: this.tentFolded,
      tentClosed: this.tentClosed,
      records: this.records,
      tut: this.tut,
      track: this.track,
      objectives: this.objectives,
      timeHours: 0, // заповнюється зовні
      dayCount: 1,
      weatherSeed: 0,
      priceWeek: this.priceWeek,
      priceMult: this.priceMult,
      market: this.market.serialize(),
      trade: this.trade.serialize(),
      portMarkets: Object.fromEntries(Object.entries(this.portMarkets).map(([id, m]) => [id, { stock: m.serialize().stock, hist: m.hist }])),
      port: this.portId,
      stats: this.stats,
      boatX: 0,
      boatZ: 0,
      boatHeading: 0,
      totalPlayTime: 0,
      waypoint: this.waypoint,
      route: this.route.map((p) => ({ x: Math.round(p.x), z: Math.round(p.z) })),
    };
  }

  save() {
    GameState.write(this.buildSave());
  }

  /** записує готовий SaveData (наприклад, з даними світу) */
  /** окремий слот для кооп-гостя: його гроші/улов, без чіпання соло-сейву */
  static saveKey = SAVE_KEY;
  static readonly SOLO_KEY = SAVE_KEY;
  static readonly COOP_KEY = 'storm-fishers-coop-v1';

  /** після імпорту сейву (перед перезавантаженням) — не записувати */
  static frozen = false;

  static write(data: SaveData) {
    if (GameState.frozen) return;
    try {
      localStorage.setItem(GameState.saveKey, JSON.stringify(data));
    } catch {
      /* приватний режим */
    }
  }

  static load(): Partial<SaveData> | null {
    try {
      const raw = localStorage.getItem(GameState.saveKey);
      if (!raw) return null;
      return JSON.parse(raw) as Partial<SaveData>;
    } catch {
      return null;
    }
  }

  applySave(data: Partial<SaveData>) {
    if (typeof data.money === 'number') this.money = data.money;
    if (typeof data.fuel === 'number') this.fuel = data.fuel;
    if (typeof data.hull === 'number') this.hull = data.hull;
    if (typeof data.energy === 'number') this.energy = data.energy;
    if (Array.isArray(data.hold)) this.hold = data.hold;
    if (typeof data.insurance === 'number') this.insurance = data.insurance;
    if (data.upgrades) {
      this.upgrades = { ...defaultUpgrades(), ...data.upgrades };
      // старий сейв (до «Приладів»): досвідченим капітанам — механіка/ехолот у подарунок,
      // щоб звичні швидкість і цифри не зникли разом з оновленням
      if (data.upgrades.instr == null) {
        const sum = Object.values(data.upgrades).reduce((a: number, v) => a + (Number(v) || 0), 0);
        this.upgrades.instr = sum >= 10 ? 2 : sum >= 3 ? 1 : 0;
      }
      // старий сейв (з жорстким дахом-hardtop): дах прибрали, натомість досвідченим — тент
      if (data.upgrades.tent == null) {
        const sum = Object.values(data.upgrades).reduce((a: number, v) => a + (Number(v) || 0), 0);
        this.upgrades.tent = sum >= 8 ? 2 : sum >= 3 ? 1 : 0;
      }
    }
    if (Array.isArray(data.discovered)) this.discovered = data.discovered;
    if (Array.isArray(data.places)) this.places = data.places;
    this.finds = Array.isArray(data.finds) ? data.finds.filter((v) => typeof v === 'string') : [];
    this.hat = typeof data.hat === 'string' ? data.hat : 'captain';
    this.tentFit = typeof data.tentFit === 'number' ? data.tentFit : null;
    this.tentFolded = data.tentFolded === true;
    this.tentClosed = data.tentClosed === true;
    this.records = {};
    if (data.records && typeof data.records === 'object') for (const [k, v] of Object.entries(data.records)) if (Number.isFinite(v)) this.records[k] = Number(v);
    // старі сейви без кроку: досвідчений гравець — навчання пропускаємо
    if (Array.isArray(data.track)) this.track = data.track.filter((v) => typeof v === 'number').slice(-800);
    if (typeof data.tut === 'number') this.tut = data.tut;
    else if (data.objectives?.firstSale) this.tut = 99;
    if (data.objectives) this.objectives = { ...this.objectives, ...data.objectives };
    if (data.stats) this.stats = { ...this.stats, ...data.stats };
    if (typeof data.priceWeek === 'number') this.priceWeek = data.priceWeek;
    if (data.priceMult) this.priceMult = data.priceMult;
    // біржа: старі сейви — повний попит, без подій; історія стартує з поточної ціни
    this.market.load(data.market);
    const remote = this.market.remote;
    this.portMarkets = {};
    // біржі інших портів: нові сейви — запаси й історія; старі — «надлишок» (portGlut) → норма + надлишок
    const pm = (data.portMarkets && typeof data.portMarkets === 'object' ? data.portMarkets : {}) as Record<string, Partial<MarketSave>>;
    const pg = (data.portGlut && typeof data.portGlut === 'object' ? data.portGlut : {}) as Record<string, Record<string, number>>;
    for (const site of PORT_SITES) {
      const m = this.marketOf(site.id) as PortMarket;
      m.remote = remote;
      const d = pm[site.id];
      m.loadStock(d?.stock, d ? undefined : pg[site.id]);
      if (d?.hist && typeof d.hist === 'object') {
        for (const [k, v] of Object.entries(d.hist)) if (FISH_BY_ID[k] && Array.isArray(v)) m.hist[k] = v.filter((x) => Number.isFinite(x)).slice(-48);
      }
      m.seedHistory();
    }
    this.portId = typeof data.port === 'string' && PORT_SITE_BY_ID[data.port] ? data.port : 'home';
    this.lastMarketEvent = null;
    if (!this.market.hist[FISH[0].id]?.length) this.market.sample(this.priceMult);
    this.market.backfill(this.priceMult, this.priceWeek);
    this.trade.load(data.trade as Partial<TradeSave> | undefined);
    const ok = (p: unknown): p is { x: number; z: number } => !!p && Number.isFinite((p as { x: number }).x) && Number.isFinite((p as { z: number }).z);
    this.route = [];
    if (Array.isArray(data.route)) this.route = data.route.filter(ok).slice(0, GameState.ROUTE_MAX).map((p) => ({ x: p.x, z: p.z }));
    else if (ok(data.waypoint)) this.route = [{ x: data.waypoint.x, z: data.waypoint.z }];
    this.checkObjectives();
  }

  static clear() {
    try {
      localStorage.removeItem(GameState.saveKey);
    } catch {
      /* ignore */
    }
  }

  static hasSave(): boolean {
    try {
      return localStorage.getItem(GameState.saveKey) != null;
    } catch {
      return false;
    }
  }

  // для збереження стану світу (час/човен) — заповнює SaveData зовні
  fillWorldSave(data: SaveData, timeHours: number, dayCount: number, boatX: number, boatZ: number, heading: number, playTime: number, weatherIntensity: number) {
    data.timeHours = timeHours;
    data.dayCount = dayCount;
    data.boatX = boatX;
    data.boatZ = boatZ;
    data.boatHeading = heading;
    data.totalPlayTime = playTime;
    // масштабування узгоджене з Weather.serialize()/restore() (×100 / ÷100)
    data.weatherSeed = Math.round(weatherIntensity * 100);
  }

  get priceTrendText(): string {
    const avg = Object.values(this.priceMult).reduce((a, b) => a + b, 0) / FISH.length;
    if (avg > 1.05) return L('ціни високі', `prices are high`);
    if (avg < 0.95) return L('ціни низькі', `prices are low`);
    return L('ціни звичайні', `prices are normal`);
  }

  speciesName(id: string): string {
    return FISH_BY_ID[id]?.name ?? id;
  }
}

/** розмір ринку порту → множник норми запасу й споживання */
const PORT_SCALE: Record<PortSite['size'], number> = { tiny: 0.45, medium: 0.8, large: 1.1, outpost: 0.55 };

/** біржа іншого порту: місцеві ціни видів, розмір, улов місцевої флотилії (риба «своєї» зони — більше) */
function makePortMarket(home: FishMarket, site: PortSite): PortMarket {
  const zone = zoneFromDist(Math.hypot(site.x, site.z));
  return new PortMarket(
    home,
    (id) => site.econ.species[id] ?? site.econ.fish,
    PORT_SCALE[site.size] ?? 1,
    (id) => (FISH_BY_ID[id]?.zones.includes(zone) ? 1.15 : 0.9),
  );
}

/** новина біржі мовою гравця (старі сейви — готовий український текст) */
export function newsText(text: string, who: string): string {
  if (!text.startsWith('@u|')) return text;
  const [, kgS, top, moreS, dropS] = text.split('|');
  const kg = Number(kgS) || 0, more = Number(moreS) || 0, drop = dropS === '1';
  if (isUk()) {
    const verb = /[ая]$/.test(who) ? 'здала' : 'здав'; // «Чайка» здала, «Дельфін» здав
    const m = more > 0 ? ` і ще ${more} ${plural(more, ['вид', 'види', 'видів'], ['', ''])}` : '';
    return `${verb} ${kg} кг риби — найбільше ${speciesGen(top)}${m}${drop ? ` · ціна на ${speciesGen(top)} падає` : ''}`;
  }
  const name = (FISH_BY_ID[top]?.name ?? top).toLowerCase();
  const m = more > 0 ? ` and ${more} more species` : '';
  return `unloaded ${kg} kg of fish — mostly ${name}${m}${drop ? ` · ${name} price is falling` : ''}`;
}
