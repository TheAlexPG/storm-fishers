// ─────────────────────────────────────────────────────────────
// Дві мови інтерфейсу: англійська (за замовчуванням) і українська.
// L(uk, en) — рядок поруч з перекладом прямо в коді (без ключів-словників).
// Мова береться з ?lang=uk|en або localStorage «storm-lang»; зміна мови —
// збереження гри й перезавантаження сторінки (так оновлюються й 3D-вивіски).
// ─────────────────────────────────────────────────────────────

export type Lang = 'en' | 'uk';

const KEY = 'storm-lang';

function detect(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'uk' || q === 'ua') return 'uk';
    if (q === 'en') return 'en';
  } catch {
    /* ок */
  }
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'uk' || v === 'en') return v;
  } catch {
    /* ок */
  }
  return 'en';
}

let lang: Lang = detect();
try {
  document.documentElement.lang = lang === 'uk' ? 'uk' : 'en';
  document.title = lang === 'uk' ? 'Грозова рибалка — Storm Fishers' : 'Storm Fishers — Грозова рибалка';
} catch {
  /* ок */
}

export function getLang(): Lang {
  return lang;
}

export const isUk = () => lang === 'uk';

/** запам'ятати мову (застосовується після перезавантаження) */
export function saveLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ок */
  }
}

/** змінити мову: запам'ятати й перезавантажити (прибрати ?lang з адреси) */
export function switchLang(l: Lang, beforeReload?: () => void) {
  if (l === lang) return;
  saveLang(l);
  beforeReload?.();
  try {
    const u = new URL(location.href);
    u.searchParams.delete('lang');
    location.replace(u.toString());
  } catch {
    location.reload();
  }
}

/** рядок поточною мовою */
export function L(uk: string, en: string): string {
  return lang === 'uk' ? uk : en;
}

/** форма множини: укр — одна/кілька/багато, англ — one/other */
export function plural(n: number, uk: [string, string, string], en: [string, string]): string {
  if (lang !== 'uk') return Math.abs(n) === 1 ? en[0] : en[1];
  const m10 = Math.abs(n) % 10, m100 = Math.abs(n) % 100;
  if (m10 === 1 && m100 !== 11) return uk[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return uk[1];
  return uk[2];
}

/** число з десятковим розділювачем мови (укр — кома, англ — крапка) */
export function fmtNum(v: number, digits = 1): string {
  const s = v.toFixed(digits);
  return lang === 'uk' ? s.replace('.', ',') : s;
}

/** десятковий розділювач для рядків, де число вже відформатоване з крапкою */
export function dec(s: string): string {
  return lang === 'uk' ? s.replace('.', ',') : s;
}
