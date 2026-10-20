import { L } from './i18n';

declare const __BUILD__: { hash: string; date: string };

/** ця збірка гри: короткий хеш коміту й дата (вшиває Vite під час збірки) */
export const BUILD: { hash: string; date: string } = typeof __BUILD__ === 'undefined' ? { hash: 'dev', date: '' } : __BUILD__;

/** новіша збірка, яку вже викладено (null — це найсвіжіша) */
let newer: string | null = null;

/** підпис збірки в меню й паузі */
export function buildTagHtml(): string {
  const d = BUILD.date ? ' · ' + BUILD.date.split('-').reverse().join('.') : '';
  const up = newer ? ` · <b>${L(`є новіша ${newer} — онови сторінку (F5)`, `newer ${newer} is out — reload the page (F5)`)}</b>` : '';
  return `<div class="build-tag">${L('збірка', 'build')} ${BUILD.hash}${d}${up}</div>`;
}

/**
 * Опублікована гра раз на 5 хв дивиться у version.json поруч, чи не вийшла
 * новіша збірка. На dev-сервері version.json немає — перевірка мовчить.
 */
export function watchForUpdates(onNew: (hash: string) => void) {
  if (BUILD.hash === 'dev') return;
  const check = async () => {
    try {
      const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      const v = (await r.json()) as { hash?: unknown };
      if (typeof v.hash === 'string' && v.hash !== BUILD.hash && v.hash !== newer) {
        newer = v.hash;
        onNew(v.hash);
      }
    } catch {
      // офлайн чи dev — спробуємо згодом
    }
  };
  setInterval(check, 5 * 60 * 1000);
}
