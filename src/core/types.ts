// Спільні типи гри. Один джерело правди для всіх модулів.

export type ZoneId = 'shore' | 'mid' | 'open';

export interface FishSpecies {
  id: string;
  name: string;
  basePrice: number;
  zones: ZoneId[];
  /** чи клює вдень */
  day: boolean;
  /** чи клює вночі */
  night: boolean;
  /** відносна рідкісність (більше = рідше) */
  rarity: number;
  /** мінімальний/максимальний розмір у кг */
  minKg: number;
  maxKg: number;
}

export interface FishItem {
  uid: number;
  speciesId: string;
  /** розмір у кг (з урахуванням множника 0.7–1.5 від типового) */
  kg: number;
  /** 0..100 */
  freshness: number;
  cooked: boolean;
  /** піймана під час шторму/сильного вітру → +25 % ціни */
  storm: boolean;
  /** множник ціни темпу гри на момент улову (game/pace.ts); старі сейви — без нього */
  pm?: number;
}

export type UpgradeId =
  | 'engine'
  | 'hull'
  | 'hold'
  | 'rod'
  | 'fuel'
  | 'lights'
  | 'stab'
  | 'holders'
  | 'sails'
  | 'nets'
  | 'instr'
  | 'tent'
  | 'pump';

export type UpgradeLevels = Record<UpgradeId, number>;

export type WeatherState = 'calm' | 'breeze' | 'wind' | 'storm';

export interface WeatherSnapshot {
  state: WeatherState;
  /** 0..1.15 — загальна інтенсивність (хвилі, вітер, дощ) */
  intensity: number;
  /** 0..1 сила вітру */
  wind: number;
  /** напрямок вітру (рад, 0 = північ/−Z, за годинниковою) */
  windDir: number;
  /** 0..1 кількість дощу */
  rain: number;
  /** поточний блискавковий спалах 0..1 */
  flash: number;
  /** прогноз: інтенсивність у найближчу годину */
  forecast: number;
}

export type StationId =
  | 'wheel'
  | 'rod'
  | 'engine'
  | 'pump'
  | 'kitchen'
  | 'radio'
  | 'bed'
  | 'clean';

export type PlayerMode = 'boat' | 'port' | 'water';

export interface SaveData {
  version: number;
  money: number;
  fuel: number;
  hull: number;
  energy: number;
  hold: FishItem[];
  upgrades: UpgradeLevels;
  discovered: string[];
  /** відкриті місця (пам'ятки в морі) */
  places?: string[];
  /** знахідки на островах */
  finds?: string[];
  /** старі сейви: насичення бірж інших портів (portSites.ts) */
  portGlut?: Record<string, Record<string, number>>;
  /** біржі інших портів: запаси й історія цін (game/market.ts) */
  portMarkets?: Record<string, { stock?: Record<string, number>; hist?: Record<string, number[]> }>;
  /** порт, біля якого стояли (для послуг і повернення) */
  port?: string;
  /** вибраний капелюх */
  hat?: string;
  /** крок навчання (6 — пройдено) */
  tut?: number;
  /** пройдений маршрут (точки x,z через кожні ~25 м; останні 400) */
  track?: number[];
  objectives: ObjectiveState;
  timeHours: number;
  dayCount: number;
  weatherSeed: number;
  priceWeek: number;
  priceMult: Record<string, number>;
  /** біржа риби (насичення, історія, події); старі сейви — без поля */
  market?: import('../game/market').MarketSave;
  /** рівень страховки човна (0 — без) */
  insurance?: number;
  stats: PlayerStats;
  /** книга капітана (game/ledger.ts); старі сейви — без поля */
  ledger?: import('../game/ledger').LedgerSave;
  boatX: number;
  boatZ: number;
  boatHeading: number;
  totalPlayTime: number;
  waypoint: { x: number; z: number } | null;
  /** скупники: репутація, попит, замовлення (game/buyers.ts TradeSave) */
  trade?: unknown;
  /** камбуз: комора, рецепти, страви, бафи (game/cooking.ts) */
  kitchen?: unknown;
  /** маршрут (новіші сейви; waypoint — перша точка для сумісності) */
  route?: Array<{ x: number; z: number }>;
  /** поставлені сітки (world/nets.ts) */
  nets?: unknown;
  /** рекорд ваги за видом, кг */
  records?: Record<string, number>;
  /** яхта стоїть на якорі (точка на дні й витравлений ланцюг) */
  anchor?: { x: number; z: number; chain: number };
  /** масштаб світу, у якому записано координати (region.ts WS; старі сейви — 1) */
  worldScale?: number;
  /** після міграції масштабу: поставити човен заново (main.continueGame) */
  relocate?: boolean;
  /** тент: встановлений рівень (≤ купленого; null — усе куплене), складений, штори опущені */
  tentFit?: number | null;
  tentFolded?: boolean;
  tentClosed?: boolean;
  /** вимкнені лампи яхти (біти LAMPS у world/boat.ts) */
  lampsOff?: number;
}

export interface PlayerStats {
  totalCaught: number;
  totalEarned: number;
  stormsSurvived: number;
  tripsOut: number;
}

export interface ObjectiveState {
  firstSale: boolean;
  allSpecies: boolean;
  stormReturn: boolean;
  maxUpgrades: boolean;
  rich: boolean;
}

export interface RadioReport {
  zone: ZoneId;
  speciesId: string;
  /** множник клювання для цього виду в цій зоні */
  boost: number;
}
