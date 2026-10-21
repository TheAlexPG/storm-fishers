import type { FishItem, FishSpecies, ZoneId } from '../core/types';
import { L } from '../core/i18n';
import { paceMul } from './pace';
import { WS, seaDist, seaMul, LANDMASSES, landmassDist } from '../core/region';

// ─────────────────────────────────────────────────────────────
// 12 видів риби скрізь + місцеві біля континентів, 3 зони, денні/нічні вікна.
// ─────────────────────────────────────────────────────────────

export const FISH: FishSpecies[] = [
  { id: 'hamsa',   name: L('Шпрот', `Sprat`),        basePrice: 9,    zones: ['shore'],        day: true,  night: false, rarity: 1.0,  minKg: 0.05, maxKg: 0.12 },
  { id: 'balyk',  name: L('Оселедець', `Herring`),    basePrice: 13,   zones: ['shore'],        day: true,  night: true,  rarity: 1.0,  minKg: 0.1,  maxKg: 0.25 },
  { id: 'leschak',name: L('Камбала', `Flounder`),      basePrice: 16,   zones: ['shore', 'mid'], day: true,  night: true,  rarity: 1.1,  minKg: 0.2,  maxKg: 0.6 },
  { id: 'plyotka',name: L('Пікша', `Haddock`),        basePrice: 20,   zones: ['shore', 'mid'], day: true,  night: false, rarity: 1.0,  minKg: 0.15, maxKg: 0.45 },
  { id: 'makrel', name: L('Скумбрія', `Mackerel`),     basePrice: 34,   zones: ['mid'],          day: true,  night: true,  rarity: 1.0,  minKg: 0.4,  maxKg: 1.2 },
  { id: 'sula',   name: L('Сайда', `Saithe`),        basePrice: 46,   zones: ['mid'],          day: false, night: true,  rarity: 1.1,  minKg: 0.5,  maxKg: 1.6 },
  { id: 'krap',   name: L('Морський окунь', `Redfish`), basePrice: 55,   zones: ['mid'],          day: true,  night: true,  rarity: 1.2,  minKg: 0.3,  maxKg: 0.9 },
  { id: 'forel',  name: L('Лосось', `Salmon`),       basePrice: 74,   zones: ['mid', 'open'],  day: true,  night: false, rarity: 1.3,  minKg: 1.0,  maxKg: 2.8 },
  { id: 'lusk',   name: L('Тріска', `Cod`),       basePrice: 96,   zones: ['open'],         day: false, night: true,  rarity: 1.4,  minKg: 1.2,  maxKg: 3.5 },
  { id: 'shoraga',name: L('Палтус', `Halibut`),       basePrice: 140,  zones: ['open'],         day: false, night: true,  rarity: 1.6,  minKg: 2.0,  maxKg: 5.0 },
  { id: 'tunets', name: L('Тунець', `Tuna`),       basePrice: 205,  zones: ['open'],         day: true,  night: true,  rarity: 1.8,  minKg: 3.0,  maxKg: 9.0 },
  { id: 'akula',  name: L('Акула', `Shark`),        basePrice: 340,  zones: ['open'],         day: false, night: true,  rarity: 2.4,  minKg: 6.0,  maxKg: 22.0 },
  // ── місцеві: лише біля Лазурового узбережжя ──
  { id: 'dorada', name: L('Дорада', `Gilt-head bream`), basePrice: 44,  zones: ['shore', 'mid'], day: true,  night: false, rarity: 1.1,  minKg: 0.4,  maxKg: 1.4, regions: ['med'] },
  { id: 'sibas',  name: L('Сибас', `Sea bass`),        basePrice: 58,  zones: ['shore', 'mid'], day: true,  night: true,  rarity: 1.2,  minKg: 0.5,  maxKg: 2.2, regions: ['med'] },
  { id: 'kalmar', name: L('Кальмар', `Squid`),         basePrice: 66,  zones: ['mid', 'open'],  day: false, night: true,  rarity: 1.3,  minKg: 0.4,  maxKg: 2.0, regions: ['med'] },
  { id: 'vosmyn', name: L('Восьминіг', `Octopus`),     basePrice: 92,  zones: ['shore', 'mid'], day: true,  night: true,  rarity: 1.5,  minKg: 0.8,  maxKg: 4.0, regions: ['med'] },
  // ── місцеві: лише біля Північного краю ──
  { id: 'golets', name: L('Арктичний голець', `Arctic char`), basePrice: 52, zones: ['shore', 'mid'], day: true, night: true, rarity: 1.1, minKg: 0.5, maxKg: 2.0, regions: ['north'] },
  { id: 'krab',   name: L('Камчатський краб', `King crab`),   basePrice: 150, zones: ['mid', 'open'], day: false, night: true, rarity: 1.6, minKg: 1.5, maxKg: 6.0, regions: ['north'] },
];

/** базові види (є скрізь) — для покупців, замовлень і домашніх звітів */
export const BASE_FISH: FishSpecies[] = FISH.filter((f) => !f.regions);

/** рибний регіон: біля якого континенту (до ~1 км від берега) — там клюють і місцеві види */
export type FishRegion = 'home' | 'med' | 'north';
export function fishRegionAt(x: number, z: number): FishRegion {
  for (const m of LANDMASSES) if (landmassDist(m, x, z) < 1100) return m.id as FishRegion;
  return 'home';
}

/** які види клюють тут (зона + регіон): місцеві — лише біля свого берега */
export function fishPoolAt(x: number, z: number, zone: ZoneId): FishSpecies[] {
  const reg = fishRegionAt(x, z);
  return FISH.filter((f) => f.zones.includes(zone) && (!f.regions || (reg !== 'home' && f.regions.includes(reg))));
}

export const FISH_BY_ID: Record<string, FishSpecies> = Object.fromEntries(FISH.map((f) => [f.id, f]));

export const ZONE_NAMES: Record<ZoneId, string> = {
  shore: L('Узбережжя', `Coastal waters`),
  mid: L('Середина', `Mid-water`),
  open: L('Відкрите море', `Open sea`),
};

/** де на карті стоять стаї з радіо-звітів (за зонами) — карта малює їх тут */
export const SCHOOL_ANCHORS: Record<ZoneId, [number, number]> = {
  shore: [150 * WS, 110 * WS],
  mid: [-380 * WS, 520 * WS],
  open: [600 * WS, 720 * WS],
};

/** іменовані стаї по всьому світу: радіо щодня називає кілька біля кожного берега */
export interface SchoolSpot {
  id: string;
  name: string;
  region: FishRegion | 'ocean';
  zone: ZoneId;
  x: number;
  z: number;
}
/** зона стаї — з відстані до берега (як у ловлі), щоб звіт і клювання збігались */
const SPOT = (s: Omit<SchoolSpot, 'zone'>): SchoolSpot => ({ ...s, zone: zoneFromDist(seaDist(s.x, s.z)) });
export const SCHOOL_SPOTS: SchoolSpot[] = [
  // домашні — старі «стаї зони»
  SPOT({ id: 'sch-home-shore', name: L('мілина біля Шторму', `the shoal off Storm`), region: 'home', x: SCHOOL_ANCHORS.shore[0], z: SCHOOL_ANCHORS.shore[1] }),
  SPOT({ id: 'sch-home-mid', name: L('банка на заході', `the western bank`), region: 'home', x: SCHOOL_ANCHORS.mid[0], z: SCHOOL_ANCHORS.mid[1] }),
  SPOT({ id: 'sch-home-open', name: L('глибина на південному сході', `the deep to the southeast`), region: 'home', x: SCHOOL_ANCHORS.open[0], z: SCHOOL_ANCHORS.open[1] }),
  // Лазурове узбережжя
  SPOT({ id: 'sch-med-azzurro', name: L('банка Аццурро', `the Azzurro bank`), region: 'med', x: 2330, z: 2760 }),
  SPOT({ id: 'sch-med-nikos', name: L('мілина Айос-Нікоса', `the Agios Nikos shoal`), region: 'med', x: 3380, z: 1560 }),
  SPOT({ id: 'sch-med-boot', name: L('води біля «чобота»', `the waters off the Boot`), region: 'med', x: 2560, z: 4380 }),
  SPOT({ id: 'sch-med-gulf', name: L('гирло Гольфо', `the mouth of the Golfo`), region: 'med', x: 5080, z: 3060 }),
  SPOT({ id: 'sch-med-cape', name: L('Посейдонів мис', `Poseidon's Cape`), region: 'med', x: 4980, z: 1820 }),
  SPOT({ id: 'sch-med-south', name: L('південний свал', `the southern drop-off`), region: 'med', x: 3920, z: 4520 }),
  // Північний край
  SPOT({ id: 'sch-n-cedar', name: L('плесо Сідар-Гарбору', `the Cedar Harbor reach`), region: 'north', x: -2330, z: 2330 }),
  SPOT({ id: 'sch-n-grizzly', name: L('гирло Бухти Гризлі', `the mouth of Grizzly Cove`), region: 'north', x: -3420, z: 980 }),
  SPOT({ id: 'sch-n-west', name: L('біля західних фіордів', `off the western fjords`), region: 'north', x: -4960, z: 2620 }),
  SPOT({ id: 'sch-n-skerries', name: L('шхери на сході', `the eastern skerries`), region: 'north', x: -2560, z: 3520 }),
  SPOT({ id: 'sch-n-south', name: L('південна банка', `the southern bank`), region: 'north', x: -3720, z: 4060 }),
  SPOT({ id: 'sch-n-nw', name: L('північно-західний свал', `the northwest drop-off`), region: 'north', x: -4660, z: 1500 }),
  // Великий океан
  SPOT({ id: 'sch-oc-west', name: L('океан між домом і Північчю', `the ocean between home and the North`), region: 'ocean', x: -1360, z: 2420 }),
  SPOT({ id: 'sch-oc-east', name: L('океан між домом і Лазуровим', `the ocean between home and the Azure Coast`), region: 'ocean', x: 1380, z: 2640 }),
  SPOT({ id: 'sch-oc-south', name: L('південний океан', `the southern ocean`), region: 'ocean', x: 160, z: 3640 }),
];
export const SCHOOL_BY_ID: Record<string, SchoolSpot> = Object.fromEntries(SCHOOL_SPOTS.map((s) => [s.id, s]));

/** де стоїть стая звіту (старі звіти без spot — домашня стая зони) */
export function schoolPos(r: { zone: ZoneId; spot?: string }): [number, number] {
  const s = r.spot ? SCHOOL_BY_ID[r.spot] : undefined;
  return s ? [s.x, s.z] : SCHOOL_ANCHORS[r.zone];
}

/** назва стаї звіту */
export function schoolName(r: { zone: ZoneId; spot?: string }): string {
  return (r.spot ? SCHOOL_BY_ID[r.spot]?.name : undefined) ?? ZONE_NAMES[r.zone];
}

// ─────────────────────────────────────────────────────────────
// Рибні місця (гарячі точки): велика риба й трофеї — але в бурхливих
// районах (region.ts ROUGH), де шторм лютіший. Ризик 1..3 — для лоції.
// Відкриваються, коли підпливеш (game.places, як пам'ятки); до того —
// «чутки моряків» на карті.
// ─────────────────────────────────────────────────────────────

export interface Hotspot {
  id: string;
  name: string;
  sub: string;
  x: number;
  z: number;
  r: number;
  /** множник ваги риби в центрі */
  kg: number;
  /** добавка до шансу трофея в центрі */
  trophy: number;
  /** ризик 1 (помірно) .. 3 (небезпечно) */
  risk: 1 | 2 | 3;
}

export const HOTSPOTS: Hotspot[] = [
  { id: 'hot-stack', name: L('Мілина Пташиного стовпа', `Bird Stack Shoal`), sub: L('скумбрія й окунь крупніші — і хвиля ще помірна', `bigger mackerel and redfish — and the sea is still moderate`), x: 900, z: 420, r: 130, kg: 1.5, trophy: 0.08, risk: 1 },
  { id: 'hot-reef', name: L('Палтусова яма', `Halibut Hole`), sub: L('за рифами Мушлевого: палтус і тріска-велетні, але рифи ловлять хвилю', `past the Shell reefs: giant halibut and cod, but the reefs catch the swell`), x: -1330, z: 820, r: 150, kg: 1.9, trophy: 0.16, risk: 2 },
  { id: 'hot-belt', name: L('Тунцева банка', `Tuna Bank`), sub: L('посеред штормового поясу: тунець і акула вдвічі важчі — тікай, щойно падає барометр', `in the middle of the storm belt: tuna and sharks twice the weight — run as soon as the glass falls`), x: 1480, z: 620, r: 170, kg: 2.3, trophy: 0.22, risk: 3 },
  { id: 'hot-deep', name: L('Акулячий жолоб', `Shark Trench`), sub: L('край відкритого океану: найбільші трофеї й найвищі хвилі', `the edge of the open ocean: the biggest trophies and the highest seas`), x: 380, z: 1480, r: 180, kg: 2.5, trophy: 0.25, risk: 3 },
  // ── біля континентів і в Великому океані ──
  { id: 'hot-lagoon', name: L('Бірюзова лагуна', `Turquoise Lagoon`), sub: L('мілко й тепло: риба ситіша, а шторми сюди майже не доходять', `shallow and warm: well-fed fish, and storms hardly reach in here`), x: 4290, z: 3610, r: 120, kg: 1.35, trophy: 0.06, risk: 1 },
  { id: 'hot-gulf', name: L('Кальмарова западина', `Squid Hollow`), sub: L('глибоко в Гольфо: уночі піднімається велика риба', `deep in the Golfo: big fish rise at night`), x: 4700, z: 2800, r: 150, kg: 1.6, trophy: 0.1, risk: 1 },
  { id: 'hot-fjord', name: L('Водоспадний фіорд', `Waterfall Fjord`), sub: L('лосось і палтус біля водоспаду — але фіорд вузький, а туман густий', `salmon and halibut by the falls — but the fjord is narrow and the fog thick`), x: -4500, z: 2880, r: 140, kg: 1.8, trophy: 0.14, risk: 2 },
  { id: 'hot-seals', name: L('Тюленяча бухта', `Seal Cove`), sub: L('де тюлені — там і тріска: холодно, хвиля з півночі', `where there are seals there's cod: cold, with a northern swell`), x: -4160, z: 1160, r: 130, kg: 1.6, trophy: 0.12, risk: 2 },
  { id: 'hot-strait', name: L('Сибасова протока', `Sea Bass Strait`), sub: L('між «чоботом» і материком: сибас і восьминоги тримаються течії', `between the Boot and the mainland: sea bass and octopus hold the current`), x: 3660, z: 4120, r: 120, kg: 1.45, trophy: 0.08, risk: 1 },
  { id: 'hot-tunaridge', name: L('Тунцева гряда', `Tuna Ridge`), sub: L('далеко на південному сході: тунець і кальмари-велетні — але це вже відкритий океан', `far to the southeast: tuna and giant squid — but this is already the open ocean`), x: 5250, z: 3900, r: 170, kg: 2.1, trophy: 0.18, risk: 3 },
  { id: 'hot-crabbank', name: L('Крабова банка', `Crab Bank`), sub: L('між шхерами: камчатський краб і тріска — гранітні мілини чекають на необережних', `among the skerries: king crab and cod — granite shoals await the careless`), x: -2260, z: 3380, r: 130, kg: 1.7, trophy: 0.12, risk: 2 },
  { id: 'hot-icedeep', name: L('Крижана прірва', `The Ice Deep`), sub: L('північно-західний свал: палтус і краби-велетні, найлютіші шторми Півночі', `the northwest drop-off: giant halibut and crabs, the North's fiercest storms`), x: -4980, z: 1180, r: 170, kg: 2.2, trophy: 0.2, risk: 3 },
  { id: 'hot-birds', name: L('Пташиний котел', `The Bird Cauldron`), sub: L('птахи над водою — тунець женеться за сардиною; посеред Великого океану', `birds over the water — tuna chasing sardines; in the middle of the Great Ocean`), x: -420, z: 2300, r: 170, kg: 2.4, trophy: 0.22, risk: 3 },
];

/** сила гарячої точки в місці 0..1 і яка саме */
export function hotspotAt(x: number, z: number): { hot: number; spot: Hotspot | null } {
  let best = 0, spot: Hotspot | null = null;
  for (const h of HOTSPOTS) {
    const q = Math.hypot(x - h.x, z - h.z) / h.r;
    if (q >= 1.6) continue;
    const v = Math.exp(-q * q * 1.4);
    if (v > best) { best = v; spot = h; }
  }
  return { hot: best, spot };
}

// ─────────────────────────────────────────────────────────────
// Місце лову: далеко від берега й від стай клює рідко, але риба більша
// й частіше трапляється трофей; на стаї — часто, але дрібніше.
// ─────────────────────────────────────────────────────────────

export interface FishingSpot {
  /** віддаленість від порту 0..1 */
  far: number;
  /** близькість до стаї з радіо-звіту 0..1 */
  heat: number;
  /** множник часу очікування клювання */
  wait: number;
  /** шанс трофея (без вудки) */
  trophy: number;
  /** коротка підказка гравцю */
  hint: string;
  /** гаряча точка 0..1 (HOTSPOTS) і множник ваги риби */
  hot: number;
  kgMul: number;
}

export const SCHOOL_R = 120;

export function fishingSpot(x: number, z: number, reports: ReadonlyArray<{ zone: ZoneId; spot?: string }>): FishingSpot {
  const d = seaDist(x, z);
  const far = Math.min(1, Math.max(0, (d - 120 * WS) / (1000 * WS)));
  let heat = 0;
  for (const r of reports) {
    const [ax, az] = schoolPos(r);
    const q = Math.hypot(x - ax, z - az) / SCHOOL_R;
    heat = Math.max(heat, Math.exp(-q * q));
  }
  const cold = 1 - heat;
  const hs = hotspotAt(x, z);
  const hot = hs.hot;
  const kgMul = 1 + ((hs.spot?.kg ?? 1) - 1) * hot;
  const trophy = 0.02 + 0.15 * far * cold + (hs.spot?.trophy ?? 0) * hot;
  // на рибному місці риба тримається купно — клює помітно швидше, ніж просто в глибокій воді
  const wait = (0.75 + 0.95 * far) * (1 - 0.55 * heat) * (1 - 0.3 * hot);
  const rough = seaMul(x, z) > 1.5;
  const hint =
    hot > 0.4 && hs.spot ? L(`🎣 ${hs.spot.name} — риба тут важча й частіше трофеї${rough ? ' · стеж за погодою!' : ''}`, `🎣 ${hs.spot.name} — heavier fish and more trophies here${rough ? ' · watch the weather!' : ''}`)
    : heat > 0.45 ? L('🐟 Тут стая — клює часто, риба дрібніша', `🐟 A school is here — quick bites, smaller fish`)
    : far > 0.55 ? L('🌊 Глибока вода — клює рідко · шанс на трофей ↑', `🌊 Deep water — slow bites · better trophy odds ↑`)
    : far > 0.25 ? L('Відкрита вода — клює помірно, трапляються великі', `Open water — steady bites, big ones happen`)
    : L('Біля берега — клює швидко, риба невелика', `Near the shore — quick bites, small fish`);
  return { far, heat, wait, trophy, hint, hot, kgMul };
}

/** вага риби: на стаї — дрібніша; далеко й поза стаями — «товстий хвіст» трофеїв */
export function rollKg(sp: FishSpecies, spot: FishingSpot, rodTrophy: number, rnd: () => number = Math.random): { kg: number; trophy: boolean } {
  const r = (a: number, b: number) => a + (b - a) * rnd();
  let kg = r(sp.minKg, sp.maxKg) * r(0.85, 1.15) * (1 - 0.18 * spot.heat) * (1 + 0.15 * spot.far) * (1 + rodTrophy * 0.2) * (spot.kgMul ?? 1);
  const p = spot.trophy + rodTrophy * 0.08;
  const trophy = rnd() < p;
  if (trophy) kg = Math.max(kg, sp.maxKg) * r(1.25, 1.9);
  return { kg, trophy };
}

/** трофей — набагато більший за звичайний максимум виду */
export function isTrophy(speciesId: string, kg: number): boolean {
  const sp = FISH_BY_ID[speciesId];
  return !!sp && kg >= sp.maxKg * 1.2;
}

/** зона за відстанню від порту (м) */
export function zoneFromDist(d: number): ZoneId {
  if (d < 400 * WS) return 'shore';
  if (d < 900 * WS) return 'mid';
  return 'open';
}

// випадкова база: uid не повторюються між перезапусками й гравцями (спільний трюм у коопі)
let uidCounter = Math.floor(Math.random() * 2 ** 40);
export function makeFish(speciesId: string, kg: number, storm: boolean): FishItem {
  return {
    uid: uidCounter++,
    speciesId,
    kg,
    freshness: 100,
    cooked: false,
    storm,
    // темп фіксується на улові: не можна ловити на «динамічному», а продати за ціною «спокійного»
    pm: Math.round(paceMul() * 1000) / 1000,
  };
}

/** ціна за одиницю (без свіжості) */
export function fishPrice(item: FishItem, priceMult: Record<string, number>): number {
  const sp = FISH_BY_ID[item.speciesId];
  if (!sp) return 0;
  const mult = priceMult[item.speciesId] ?? 1;
  const perKg = sp.basePrice / ((sp.minKg + sp.maxKg) / 2);
  let v = item.kg * perKg * mult;
  v *= item.cooked ? 1.5 : 1.0;
  if (item.storm) v *= 1.25;
  // темп гри: динамічний — риба дешевша, спокійний — дорожча (той, що був на улові)
  v *= item.pm ?? paceMul();
  return v;
}

/** повна ціна з урахуванням свіжості; market — множник біржі (подія × попит) */
export function fishSellPrice(item: FishItem, priceMult: Record<string, number>, market = 1): number {
  const fresh = item.cooked ? 1.0 : item.freshness / 100;
  return Math.max(1, Math.round(fishPrice(item, priceMult) * market * (0.35 + 0.65 * fresh)));
}
