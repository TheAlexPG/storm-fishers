import { clamp, mulberry32 } from '../core/math';
import { FISH, FISH_BY_ID, fishSellPrice } from './fish';
import { defaultUpgrades, eff, UPGRADES, MAX_LEVEL, upgradeCost } from './upgrades';
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
  upgrades = defaultUpgrades();
  discovered: string[] = [];
  /** відкриті місця (пам'ятки в морі) */
  places: string[] = [];
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

  // радіо-звіти дня (обновлюються щодня)
  reports: RadioReport[] = [];

  // навігація: точка, вибрана на карті (M)
  waypoint: { x: number; z: number } | null = null;

  constructor() {
    this.rollPrices();
    this.rollReports();
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

  damage(amount: number) {
    this.hull = clamp(this.hull - amount, 0, this.maxHull);
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
    if (!this.discovered.includes(item.speciesId)) this.discovered.push(item.speciesId);
    this.stats.totalCaught++;
    this.checkObjectives();
    return true;
  }

  removeFish(uid: number): FishItem | undefined {
    const i = this.hold.findIndex((f) => f.uid === uid);
    if (i < 0) return undefined;
    return this.hold.splice(i, 1)[0];
  }

  /** продати все, повертає суму */
  sellAll(): number {
    let sum = 0;
    for (const f of this.hold) sum += fishSellPrice(f, this.priceMult);
    this.hold = [];
    this.money += sum;
    this.stats.totalEarned += sum;
    this.objectives.firstSale = true;
    this.checkObjectives();
    return sum;
  }

  sellOne(uid: number): number {
    const f = this.removeFish(uid);
    if (!f) return 0;
    const v = fishSellPrice(f, this.priceMult);
    this.money += v;
    this.stats.totalEarned += v;
    this.objectives.firstSale = true;
    this.checkObjectives();
    return v;
  }

  buyUpgrade(id: UpgradeId): boolean {
    const cost = upgradeCost(id, this.upgrades[id]);
    if (cost == null || this.money < cost) return false;
    this.money -= cost;
    this.upgrades[id]++;
    // корпус: після апгрейду збільшуємо поточну міцність на таку ж кількість
    if (id === 'hull') this.hull = Math.min(this.maxHull, this.hull + 40);
    this.checkObjectives();
    return true;
  }

  /** щотижневий (кожні 24 год гри) коливання цін ±15 % */
  rollPrices() {
    this.priceWeek++;
    for (const sp of FISH) {
      this.priceMult[sp.id] = 0.85 + this.weekRng() * 0.3;
    }
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

  setWaypoint(x: number, z: number) {
    this.waypoint = { x, z };
  }

  clearWaypoint() {
    this.waypoint = null;
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

  /** свіжість падає: dt — години гри */
  decayFreshness(dtHours: number) {
    for (const f of this.hold) {
      if (!f.cooked) f.freshness = clamp(f.freshness - (dtHours / 2) * 100, 0, 100);
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
      upgrades: this.upgrades,
      discovered: this.discovered,
      places: this.places,
      tut: this.tut,
      track: this.track,
      objectives: this.objectives,
      timeHours: 0, // заповнюється зовні
      dayCount: 1,
      weatherSeed: 0,
      priceWeek: this.priceWeek,
      priceMult: this.priceMult,
      stats: this.stats,
      boatX: 0,
      boatZ: 0,
      boatHeading: 0,
      totalPlayTime: 0,
      waypoint: this.waypoint,
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

  static write(data: SaveData) {
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
    if (data.upgrades) this.upgrades = { ...defaultUpgrades(), ...data.upgrades };
    if (Array.isArray(data.discovered)) this.discovered = data.discovered;
    if (Array.isArray(data.places)) this.places = data.places;
    // старі сейви без кроку: досвідчений гравець — навчання пропускаємо
    if (Array.isArray(data.track)) this.track = data.track.filter((v) => typeof v === 'number').slice(-800);
    if (typeof data.tut === 'number') this.tut = data.tut;
    else if (data.objectives?.firstSale) this.tut = 99;
    if (data.objectives) this.objectives = { ...this.objectives, ...data.objectives };
    if (data.stats) this.stats = { ...this.stats, ...data.stats };
    if (typeof data.priceWeek === 'number') this.priceWeek = data.priceWeek;
    if (data.priceMult) this.priceMult = data.priceMult;
    if (data.waypoint && typeof data.waypoint.x === 'number' && typeof data.waypoint.z === 'number') {
      this.waypoint = { x: data.waypoint.x, z: data.waypoint.z };
    }
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
    if (avg > 1.05) return 'ціни високі';
    if (avg < 0.95) return 'ціни низькі';
    return 'ціни звичайні';
  }

  speciesName(id: string): string {
    return FISH_BY_ID[id]?.name ?? id;
  }
}
