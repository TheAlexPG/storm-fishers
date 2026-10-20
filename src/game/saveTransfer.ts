import { GameState } from './state';
import type { SaveData } from '../core/types';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Перенесення сейву на інший комп'ютер: файл .json з обома слотами
// (соло й кооп-гість). Імпорт перевіряє файл і замінює слоти.
// ─────────────────────────────────────────────────────────────

const TAG = 'storm-fishers-save';

interface SaveFile {
  game: typeof TAG;
  v: 1;
  at: string;
  solo: Partial<SaveData> | null;
  coop: Partial<SaveData> | null;
}

function read(key: string): Partial<SaveData> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<SaveData>) : null;
  } catch {
    return null;
  }
}

export function hasAnySave(): boolean {
  return read(GameState.SOLO_KEY) != null || read(GameState.COOP_KEY) != null;
}

/** короткий опис сейву: «день 5, 2300 ₴, апгрейдів 7, улов 3» */
export function describeSave(d: Partial<SaveData> | null | undefined): string {
  if (!d) return '—';
  const up = Object.values(d.upgrades ?? {}).reduce((a: number, v) => a + (Number(v) || 0), 0);
  return L(`день ${d.dayCount ?? 1}, ${Math.round(d.money ?? 0)} ₴, апгрейдів ${up}, улов ${d.hold?.length ?? 0}`, `day ${d.dayCount ?? 1}, ${Math.round(d.money ?? 0)} ₴, upgrades ${up}, catch ${d.hold?.length ?? 0}`);
}

/** завантажити файл сейву */
export function exportSave(): boolean {
  const data: SaveFile = { game: TAG, v: 1, at: new Date().toISOString(), solo: read(GameState.SOLO_KEY), coop: read(GameState.COOP_KEY) };
  if (!data.solo && !data.coop) return false;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grozova-rybalka-${data.at.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}

function validSave(d: unknown): d is Partial<SaveData> {
  return !!d && typeof d === 'object' && typeof (d as SaveData).money === 'number' && Number.isFinite((d as SaveData).money);
}

export interface ParsedSave {
  solo: Partial<SaveData> | null;
  coop: Partial<SaveData> | null;
  summary: string;
}

/** прочитати й перевірити файл сейву (кидає помилку з поясненням) */
export async function parseSaveFile(file: File): Promise<ParsedSave> {
  if (file.size > 5_000_000) throw new Error(L('Файл завеликий — це не сейв гри', `The file is too large — it's not a game save`));
  let j: Partial<SaveFile> & Partial<SaveData>;
  try {
    j = JSON.parse(await file.text());
  } catch {
    throw new Error(L('Не вдалося прочитати файл — це не сейв гри', `Couldn't read the file — it's not a game save`));
  }
  // підтримка «голого» соло-сейву (вміст localStorage)
  if (j.game !== TAG) {
    if (validSave(j)) return { solo: j, coop: null, summary: describeSave(j) };
    throw new Error(L('Це не файл сейву «Грозової рибалки»', `This is not a Storm Fishers save file`));
  }
  const solo = validSave(j.solo) ? j.solo : null;
  const coop = validSave(j.coop) ? j.coop : null;
  if (!solo && !coop) throw new Error(L('У файлі немає збереженої гри', `There is no saved game in this file`));
  const parts = [solo ? L(`соло: ${describeSave(solo)}`, `solo: ${describeSave(solo)}`) : '', coop ? L(`кооп: ${describeSave(coop)}`, `co-op: ${describeSave(coop)}`) : ''].filter(Boolean);
  return { solo, coop, summary: parts.join(' · ') };
}

/** записати імпортований сейв у браузер (слоти, яких немає у файлі, не чіпаємо) */
export function applyImport(p: ParsedSave) {
  // далі сторінка перезавантажиться — поточна гра не має перезаписати імпорт
  GameState.frozen = true;
  if (p.solo) localStorage.setItem(GameState.SOLO_KEY, JSON.stringify(p.solo));
  if (p.coop) localStorage.setItem(GameState.COOP_KEY, JSON.stringify(p.coop));
}
