import { FISH_BY_ID } from './fish';
import type { FishItem } from '../core/types';

// ─────────────────────────────────────────────────────────────
// Камбуз: комора (прянощі й гарніри), рецепти (відомі / ні), готові страви
// й бафи від їжі та чаю. Чиста логіка без three.js — 3D у world/galley.ts,
// міні-ігри й книга рецептів — ui/kitchenUI.ts.
// Тексти — пари [uk, en] (L), щоб потім легко під'єднати перемикач мови.
// ─────────────────────────────────────────────────────────────

export type Txt = readonly [uk: string, en: string];

export type PantryId = 'salt' | 'onion' | 'potato' | 'butter' | 'lemon' | 'herbs' | 'rice' | 'sugar' | 'tea';

export const PANTRY: Record<PantryId, { name: Txt; icon: string; price: number }> = {
  tea: { name: ['Чай (заварка)', 'Tea leaves'], icon: '🍃', price: 6 },
  sugar: { name: ['Цукор', 'Sugar'], icon: '🍬', price: 4 },
  salt: { name: ['Сіль', 'Salt'], icon: '🧂', price: 3 },
  onion: { name: ['Цибуля', 'Onion'], icon: '🧅', price: 5 },
  potato: { name: ['Картопля', 'Potato'], icon: '🥔', price: 5 },
  butter: { name: ['Масло', 'Butter'], icon: '🧈', price: 12 },
  lemon: { name: ['Лимон', 'Lemon'], icon: '🍋', price: 9 },
  herbs: { name: ['Трави (чебрець, кріп)', 'Herbs (thyme, dill)'], icon: '🌿', price: 8 },
  rice: { name: ['Рис', 'Rice'], icon: '🍚', price: 10 },
};
export const PANTRY_IDS = Object.keys(PANTRY) as PantryId[];

/** крок міні-гри готування */
export type CookStep = 'chop' | 'heat' | 'stir' | 'flip' | 'simmer';

export const STEP_INFO: Record<CookStep, { name: Txt; hint: Txt }> = {
  chop: { name: ['Нарізати', 'Chop'], hint: ['E — коли ніж над рибою (у зеленій зоні)', 'E when the knife is over the green zone'] },
  heat: { name: ['Тримати жар', 'Mind the heat'], hint: ['A/D — тримай стрілку жару в зеленому, поки йде час', 'A/D keep the heat needle in the green until the timer ends'] },
  stir: { name: ['Помішувати', 'Stir'], hint: ['A і D по черзі — мішай ложкою', 'Alternate A and D to stir'] },
  flip: { name: ['Перевернути', 'Flip'], hint: ['E — коли скоринка золотава', 'E when the crust turns golden'] },
  simmer: { name: ['Томити', 'Simmer'], hint: ['E — зняти з вогню, коли смужка в зеленому', 'E to take it off the heat in the green'] },
};

export type BuffId = 'warm' | 'hearty' | 'luck' | 'strength';

export const BUFF_INFO: Record<BuffId, { icon: string; name: Txt; desc: Txt }> = {
  warm: { icon: '☕', name: ['Зігрівся', 'Warmed up'], desc: ['праця втомлює на 35% менше', 'work tires you 35% less'] },
  hearty: { icon: '🍲', name: ['Ситий', 'Well fed'], desc: ['енергія повільно відновлюється', 'energy slowly regenerates'] },
  luck: { icon: '🍀', name: ['Рибальське щастя', 'Angler\'s luck'], desc: ['клює на 20% швидше', 'bites 20% sooner'] },
  strength: { icon: '💪', name: ['Сила', 'Strength'], desc: ['рибу підтягуєш на 25% швидше', 'reel fish 25% faster'] },
};

export interface Recipe {
  id: string;
  name: Txt;
  icon: string;
  /** що потрібно з риби: кількість і з яких видів (порожньо — будь-яка) */
  fish: { n: number; from?: string[]; label: Txt };
  pantry: Partial<Record<PantryId, number>>;
  steps: CookStep[];
  buffs: Array<[BuffId, number]>; // секунди реального часу
  energy: number;
  /** множник ціни страви від вартості риби */
  value: number;
  /** ресторан бере лише делікатеси */
  premium?: boolean;
  /** як відкрити рецепт */
  source: 'start' | 'tavern' | 'chef' | 'marina' | 'island' | 'experiment';
  price?: number;
  blurb: Txt;
  /** просто «зварити» одну рибу (стара дія — риба стає «вареною» в трюмі) */
  boilsFish?: boolean;
}

const SMALL = ['hamsa', 'balyk', 'leschak', 'plyotka'];
const MID = ['plyotka', 'sula', 'lusk', 'krap', 'leschak'];

export const RECIPES: Recipe[] = [
  {
    id: 'boiled', name: ['Варена риба', 'Boiled fish'], icon: '🐟', source: 'start',
    fish: { n: 1, label: ['1 сира риба', '1 raw fish'] }, pantry: { salt: 1 }, steps: ['simmer'],
    buffs: [], energy: 0, value: 1.5, boilsFish: true,
    blurb: ['Найпростіше: рибу в окріп, щіпку солі. Варена риба лишається в трюмі й продається дорожче (×1,5).', 'The basics: fish into boiling water with a pinch of salt. It stays in the hold and sells for more (×1.5).'],
  },
  {
    id: 'yushka', name: ['Юшка', 'Fish broth'], icon: '🍲', source: 'start',
    fish: { n: 2, from: SMALL, label: ['2 дрібні рибини (шпрот, оселедець, камбала, пікша)', '2 small fish (sprat, herring, flounder, haddock)'] },
    pantry: { potato: 1, onion: 1, salt: 1 }, steps: ['chop', 'simmer', 'stir'],
    buffs: [['hearty', 420], ['warm', 240]], energy: 30, value: 2.0,
    blurb: ['Рибальська юшка в казанку: картопля, цибуля, дрібна риба. Гріє й наїдає.', 'A fisherman\'s pot of broth: potato, onion and small fish. Warming and filling.'],
  },
  {
    id: 'fried_mackerel', name: ['Смажена скумбрія', 'Pan-fried mackerel'], icon: '🍳', source: 'tavern', price: 120,
    fish: { n: 1, from: ['makrel'], label: ['1 скумбрія', '1 mackerel'] }, pantry: { butter: 1, salt: 1 }, steps: ['heat', 'flip', 'heat'],
    buffs: [['luck', 360]], energy: 18, value: 2.2,
    blurb: ['Скумбрія на маслі до хрусткої шкірки. Кажуть, після неї клює краще.', 'Mackerel fried in butter until the skin crackles. They say fish bite better after it.'],
  },
  {
    id: 'smoked_herring', name: ['Копчений оселедець', 'Smoked herring'], icon: '🔥', source: 'tavern', price: 160,
    fish: { n: 2, from: ['balyk'], label: ['2 оселедці', '2 herrings'] }, pantry: { salt: 1, herbs: 1 }, steps: ['heat', 'simmer'],
    buffs: [['warm', 480]], energy: 14, value: 2.4,
    blurb: ['Гарячого копчення над вільховою трісою в казанку з кришкою — як у діда Гната.', 'Hot-smoked over alder chips in a lidded pot, the way old Hnat does it.'],
  },
  {
    id: 'cod_cakes', name: ['Котлети з тріски', 'Cod cakes'], icon: '🥘', source: 'tavern', price: 220,
    fish: { n: 1, from: ['lusk'], label: ['1 тріска', '1 cod'] }, pantry: { potato: 1, onion: 1, butter: 1 }, steps: ['chop', 'stir', 'flip'],
    buffs: [['strength', 420], ['hearty', 240]], energy: 26, value: 2.3,
    blurb: ['Тріска з картоплею й цибулею, обсмажені до скоринки. Сили — на цілу вахту.', 'Cod mashed with potato and onion, fried golden. Strength for a whole watch.'],
  },
  {
    id: 'salmon_lemon', name: ['Лосось з лимоном', 'Salmon with lemon'], icon: '🍋', source: 'chef', price: 320, premium: true,
    fish: { n: 1, from: ['forel'], label: ['1 лосось', '1 salmon'] }, pantry: { lemon: 1, butter: 1, herbs: 1 }, steps: ['heat', 'flip', 'simmer'],
    buffs: [['luck', 420], ['strength', 300]], energy: 22, value: 2.6,
    blurb: ['Рецепт шефа Ліндстрема: лосось на вершковому маслі з лимоном і кропом.', 'Chef Lindström\'s way: salmon in butter with lemon and dill.'],
  },
  {
    id: 'tuna_steak', name: ['Стейк з тунця', 'Tuna steak'], icon: '🥩', source: 'chef', price: 480, premium: true,
    fish: { n: 1, from: ['tunets'], label: ['1 тунець', '1 tuna'] }, pantry: { lemon: 1, salt: 1, butter: 1 }, steps: ['heat', 'flip', 'heat'],
    buffs: [['strength', 600], ['hearty', 300]], energy: 35, value: 2.4,
    blurb: ['Сильний жар, хвилина з кожного боку — всередині рожевий. Для тих, хто тягає велику рибу.', 'High heat, a minute a side, pink inside. For those who haul the big ones.'],
  },
  {
    id: 'ukha', name: ['Уха по-рибальськи', 'Fisherman\'s ukha'], icon: '🥣', source: 'island',
    fish: { n: 2, from: MID, label: ['2 рибини середніх вод (пікша, сайда, тріска, окунь, камбала)', '2 mid-water fish (haddock, saithe, cod, redfish, flounder)'] },
    pantry: { potato: 1, onion: 1, herbs: 1, salt: 1 }, steps: ['chop', 'simmer', 'stir', 'simmer'],
    buffs: [['hearty', 600], ['warm', 480], ['luck', 240]], energy: 45, value: 2.6, premium: true,
    blurb: ['Потрійна уха з записки в пляшці: дві риби, коріння, трави — і чарка за борт для Нептуна.', 'Triple ukha from a note in a bottle: two fish, roots, herbs — and a toast poured overboard for Neptune.'],
  },
  {
    id: 'paella', name: ['Паелья з морепродуктами', 'Seafood paella'], icon: '🥘', source: 'marina', price: 650, premium: true,
    fish: { n: 2, label: ['2 будь-які рибини', 'any 2 fish'] }, pantry: { rice: 2, lemon: 1, herbs: 1, butter: 1 }, steps: ['heat', 'stir', 'simmer', 'heat'],
    buffs: [['luck', 600], ['hearty', 480], ['warm', 300]], energy: 40, value: 3.0,
    blurb: ['Курортний делікатес Сонячної Марини: шафранний рис, лимон і улов дня на широкій пательні.', 'Sonyachna Marina\'s resort favourite: saffron rice, lemon and the catch of the day in a wide pan.'],
  },
  {
    id: 'sea_soup', name: ['Морський суп з рисом', 'Sea soup with rice'], icon: '🍜', source: 'experiment',
    fish: { n: 1, label: ['1 будь-яка рибина', 'any 1 fish'] }, pantry: { rice: 1, onion: 1, lemon: 1 }, steps: ['chop', 'simmer', 'stir'],
    buffs: [['hearty', 360], ['warm', 300]], energy: 28, value: 2.1,
    blurb: ['Знайдено навмання: рис, цибуля, лимон і риба — несподівано смачно.', 'Found by accident: rice, onion, lemon and fish — surprisingly good.'],
  },
];
export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r])) as Record<string, Recipe>;

export interface Dish {
  id: number;
  recipe: string;
  /** якість 0..1 */
  q: number;
  /** вартість риби, з якої готували (₴) — база для ціни продажу */
  base: number;
}

export interface Buff {
  id: BuffId;
  /** секунд реального часу лишилось */
  left: number;
  max: number;
}

export interface KitchenSave {
  pantry: Partial<Record<PantryId, number>>;
  known: string[];
  dishes: Dish[];
  buffs: Buff[];
  cooked: number;
  teas: number;
}

export const MAX_DISHES = 8;

let uid = Math.floor(Math.random() * 1e6);

export function qualityStars(q: number): string {
  return q >= 0.85 ? '★★★' : q >= 0.55 ? '★★☆' : q >= 0.25 ? '★☆☆' : '☆☆☆';
}

export class Kitchen {
  pantry: Record<PantryId, number> = { tea: 6, sugar: 4, salt: 6, onion: 2, potato: 2, butter: 1, lemon: 1, herbs: 0, rice: 0 };
  known: string[] = RECIPES.filter((r) => r.source === 'start').map((r) => r.id);
  dishes: Dish[] = [];
  buffs: Buff[] = [];
  cooked = 0;
  teas = 0;

  /** множник ефекту бафу: warm — енергія на працю, luck — очікування клювання, strength — підтягування */
  mul(kind: 'energyCost' | 'biteWait' | 'reel'): number {
    if (kind === 'energyCost') return this.has('warm') ? 0.65 : 1;
    if (kind === 'biteWait') return this.has('luck') ? 0.8 : 1;
    return this.has('strength') ? 1.25 : 1;
  }

  has(b: BuffId): boolean {
    return this.buffs.some((x) => x.id === b && x.left > 0);
  }

  addBuff(id: BuffId, sec: number) {
    const e = this.buffs.find((x) => x.id === id);
    if (e) {
      e.left = Math.max(e.left, sec);
      e.max = Math.max(e.max, e.left);
    } else this.buffs.push({ id, left: sec, max: sec });
  }

  /** хід реального часу; повертає енергію, яку дає «ситість» */
  update(dt: number): number {
    for (const b of this.buffs) b.left -= dt;
    this.buffs = this.buffs.filter((b) => b.left > 0);
    return this.has('hearty') ? dt * 0.06 : 0;
  }

  /** чи вистачає продуктів комори */
  pantryOk(r: Recipe): boolean {
    return (Object.entries(r.pantry) as Array<[PantryId, number]>).every(([k, n]) => (this.pantry[k] ?? 0) >= n);
  }

  usePantry(r: Recipe) {
    for (const [k, n] of Object.entries(r.pantry) as Array<[PantryId, number]>) this.pantry[k] = Math.max(0, (this.pantry[k] ?? 0) - n);
  }

  /** риба з трюму, що підходить під рецепт (дешевші — першими, сира) */
  fishFor(r: Recipe, hold: FishItem[]): FishItem[] | null {
    const ok = hold.filter((f) => !f.cooked && (!r.fish.from || r.fish.from.includes(f.speciesId)));
    if (ok.length < r.fish.n) return null;
    const sorted = [...ok].sort((a, b) => fishValue(a) - fishValue(b));
    // уха: дві РІЗНІ риби
    if (r.id === 'ukha') {
      const a = sorted[0];
      const b = sorted.find((f) => f.speciesId !== a.speciesId);
      return b ? [a, b] : null;
    }
    return sorted.slice(0, r.fish.n);
  }

  learn(id: string): boolean {
    if (this.known.includes(id) || !RECIPE_BY_ID[id]) return false;
    this.known.push(id);
    return true;
  }

  /** експеримент: вгадати рецепт за складом комори (будь-яка риба) */
  experiment(chosen: PantryId[]): Recipe | null {
    const set = new Set(chosen);
    for (const r of RECIPES) {
      if (this.known.includes(r.id) || r.source === 'start') continue;
      if (r.source !== 'experiment' && r.source !== 'tavern') continue;
      const need = Object.keys(r.pantry) as PantryId[];
      if (need.length === set.size && need.every((k) => set.has(k))) return r;
    }
    return null;
  }

  addDish(recipe: string, q: number, base: number): Dish | null {
    if (this.dishes.length >= MAX_DISHES) return null;
    const d = { id: ++uid, recipe, q, base };
    this.dishes.push(d);
    return d;
  }

  /** з'їсти: енергія й бафи (довші за кращу якість) */
  eat(id: number, addEnergy: (e: number) => void): Recipe | null {
    const i = this.dishes.findIndex((d) => d.id === id);
    if (i < 0) return null;
    const d = this.dishes.splice(i, 1)[0];
    const r = RECIPE_BY_ID[d.recipe];
    if (!r) return null;
    addEnergy(r.energy * (0.6 + 0.6 * d.q));
    for (const [b, sec] of r.buffs) this.addBuff(b, sec * (0.6 + 0.7 * d.q));
    return r;
  }

  save(): KitchenSave {
    return { pantry: { ...this.pantry }, known: [...this.known], dishes: this.dishes.map((d) => ({ ...d })), buffs: this.buffs.map((b) => ({ ...b })), cooked: this.cooked, teas: this.teas };
  }

  load(s: Partial<KitchenSave> | undefined) {
    const k = new Kitchen();
    Object.assign(this, { pantry: k.pantry, known: k.known, dishes: [], buffs: [], cooked: 0, teas: 0 });
    if (!s || typeof s !== 'object') return;
    for (const id of PANTRY_IDS) if (Number.isFinite(s.pantry?.[id])) this.pantry[id] = Math.max(0, Math.round(s.pantry![id]!));
    if (Array.isArray(s.known)) for (const id of s.known) if (RECIPE_BY_ID[id] && !this.known.includes(id)) this.known.push(id);
    if (Array.isArray(s.dishes)) this.dishes = s.dishes.filter((d) => d && RECIPE_BY_ID[d.recipe] && Number.isFinite(d.q)).slice(0, MAX_DISHES).map((d) => ({ id: ++uid, recipe: d.recipe, q: d.q, base: Number(d.base) || 0 }));
    if (Array.isArray(s.buffs)) this.buffs = s.buffs.filter((b) => b && BUFF_INFO[b.id] && b.left > 0).map((b) => ({ id: b.id, left: b.left, max: b.max || b.left }));
    this.cooked = Number(s.cooked) || 0;
    this.teas = Number(s.teas) || 0;
  }
}

/** базова вартість рибини (без ринку й свіжості) */
export function fishValue(f: FishItem): number {
  const sp = FISH_BY_ID[f.speciesId];
  if (!sp) return 0;
  return f.kg * (sp.basePrice / ((sp.minKg + sp.maxKg) / 2));
}

/** ціна страви в скупника: таверна — будь-які, ресторан — делікатеси дорожче */
export function dishPrice(d: Dish, buyer: 'tavern' | 'chef'): number {
  const r = RECIPE_BY_ID[d.recipe];
  if (!r || r.boilsFish) return 0;
  if (buyer === 'chef' && !r.premium) return 0;
  const pantryCost = (Object.entries(r.pantry) as Array<[PantryId, number]>).reduce((a, [k, n]) => a + PANTRY[k].price * n, 0);
  // ×(≈2–3) від сирої риби за кращу якість; праця й продукти окупаються, але не ламають біржу
  const k = (0.45 + 0.55 * d.q) * (buyer === 'chef' ? 1.3 : 1);
  return Math.max(5, Math.round((d.base * r.value + pantryCost * 1.5) * k));
}
