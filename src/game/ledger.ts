// ─────────────────────────────────────────────────────────────
// Книга капітана: заробіток і витрати по днях і статтях, пройдений шлях,
// час у морі, улов у кілограмах і трофеї. Показується на стенді в хаті
// (world/homeCottage.ts, ui/statsBoard.ts). Статистика особиста — у кожного
// гравця своя (кооп-гість пише у свій слот сейву).
// ─────────────────────────────────────────────────────────────

export type EarnKind = 'exchange' | 'buyers' | 'contracts' | 'kitchen' | 'finds' | 'insurance' | 'other';
export type SpendKind = 'fuel' | 'repair' | 'upgrades' | 'insurance' | 'nets' | 'kitchen' | 'tow' | 'fees' | 'other';

export interface LedgerDay {
  /** номер ігрового дня */
  d: number;
  in: number;
  out: number;
}

export interface LedgerSave {
  days?: LedgerDay[];
  earned?: Partial<Record<EarnKind, number>>;
  spent?: Partial<Record<SpendKind, number>>;
  distM?: number;
  seaSec?: number;
  maxFar?: number;
  kg?: number;
  trophies?: number;
}

/** скільки днів пам'ятає графік */
const KEEP_DAYS = 30;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class Ledger {
  days: LedgerDay[] = [];
  earned: Record<EarnKind, number> = { exchange: 0, buyers: 0, contracts: 0, kitchen: 0, finds: 0, insurance: 0, other: 0 };
  spent: Record<SpendKind, number> = { fuel: 0, repair: 0, upgrades: 0, insurance: 0, nets: 0, kitchen: 0, tow: 0, fees: 0, other: 0 };
  /** пройдено на яхті, м */
  distM = 0;
  /** час у морі (на борту, не біля причалу), с реального часу */
  seaSec = 0;
  /** найдальша точка від дому, м */
  maxFar = 0;
  /** піймано кілограмів */
  kg = 0;
  trophies = 0;

  private day(d: number): LedgerDay {
    let r = this.days[this.days.length - 1];
    if (!r || r.d !== d) {
      r = { d, in: 0, out: 0 };
      this.days.push(r);
      if (this.days.length > KEEP_DAYS) this.days.splice(0, this.days.length - KEEP_DAYS);
    }
    return r;
  }

  earn(v: number, kind: EarnKind, d: number) {
    if (!(v > 0)) return;
    this.earned[kind] += v;
    this.day(d).in += v;
  }

  spend(v: number, kind: SpendKind, d: number) {
    if (!(v > 0)) return;
    this.spent[kind] += v;
    this.day(d).out += v;
  }

  get totalSpent(): number {
    return Object.values(this.spent).reduce((a, b) => a + b, 0);
  }

  get totalEarned(): number {
    return Object.values(this.earned).reduce((a, b) => a + b, 0);
  }

  /** найкращий день за заробітком (серед збережених) */
  get bestDay(): LedgerDay | null {
    let best: LedgerDay | null = null;
    for (const r of this.days) if (!best || r.in > best.in) best = r;
    return best && best.in > 0 ? best : null;
  }

  /** останні n днів (порожні дні між записами — нулями), для графіка */
  lastDays(today: number, n: number): LedgerDay[] {
    const out: LedgerDay[] = [];
    for (let d = today - n + 1; d <= today; d++) {
      if (d < 1) continue;
      out.push(this.days.find((r) => r.d === d) ?? { d, in: 0, out: 0 });
    }
    return out;
  }

  serialize(): LedgerSave {
    const r = (v: number) => Math.round(v);
    return {
      days: this.days.map((x) => ({ d: x.d, in: r(x.in), out: r(x.out) })),
      earned: { ...this.earned },
      spent: { ...this.spent },
      distM: r(this.distM),
      seaSec: r(this.seaSec),
      maxFar: r(this.maxFar),
      kg: Math.round(this.kg * 100) / 100,
      trophies: this.trophies,
    };
  }

  /** старі сейви без книги — усе з нуля */
  load(s: LedgerSave | undefined | null) {
    if (!s || typeof s !== 'object') return;
    if (Array.isArray(s.days)) this.days = s.days.filter((x) => x && Number.isFinite(x.d)).map((x) => ({ d: x.d, in: num(x.in), out: num(x.out) })).slice(-KEEP_DAYS);
    for (const k of Object.keys(this.earned) as EarnKind[]) this.earned[k] = num(s.earned?.[k]);
    for (const k of Object.keys(this.spent) as SpendKind[]) this.spent[k] = num(s.spent?.[k]);
    this.distM = num(s.distM);
    this.seaSec = num(s.seaSec);
    this.maxFar = num(s.maxFar);
    this.kg = num(s.kg);
    this.trophies = num(s.trophies);
  }
}
