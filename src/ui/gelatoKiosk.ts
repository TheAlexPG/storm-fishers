import './gelato.css';
import { formatMoney } from '../core/math';
import { L } from '../core/i18n';
import type { GameState } from '../game/state';
import { HAT_BY_ID } from '../game/hats';

// ─────────────────────────────────────────────────────────────
// Кіоск «Морозиво й сувеніри» Сонячної Марини: кулька морозива додає сил
// (як чай, але швидше й дорожче), а на вітрині — дві курортні шапки,
// яких не знайти на островах. Гроші — через журнал капітана.
// ─────────────────────────────────────────────────────────────

export interface Scoop {
  id: string;
  name: string;
  icon: string;
  color: string;
  price: number;
  energy: number;
}

export const SCOOPS: Scoop[] = [
  { id: 'lemon', name: L('Лимонне', 'Lemon'), icon: '🍋', color: '#f2d75a', price: 14, energy: 18 },
  { id: 'pistachio', name: L('Фісташкове', 'Pistachio'), icon: '🥜', color: '#a7c98a', price: 18, energy: 24 },
  { id: 'caramel', name: L('Солона карамель', 'Sea-salt caramel'), icon: '🧂', color: '#e0a865', price: 22, energy: 30 },
  { id: 'berry', name: L('Полуничний ріжок', 'Strawberry cone'), icon: '🍓', color: '#ef8f9b', price: 16, energy: 20 },
];

/** шапки на вітрині: id з game/hats.ts → ціна */
export const KIOSK_HATS: Array<[string, number]> = [
  ['panama', 420],
  ['marinacap', 260],
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function gelatoHtml(game: GameState, owned: (hatId: string) => boolean): string {
  const scoops = SCOOPS.map((s) => `
    <button class="gl-scoop" data-scoop="${s.id}" ${game.money < s.price ? 'disabled' : ''}>
      <i style="--c:${s.color}"></i>
      <b>${s.icon} ${esc(s.name)}</b>
      <small>+${s.energy} ${L('сил', 'energy')} · ${formatMoney(s.price)}</small>
    </button>`).join('');
  const hats = KIOSK_HATS.map(([id, price]) => {
    const h = HAT_BY_ID[id];
    if (!h) return '';
    const has = owned(id);
    const worn = game.hat === id;
    return `<div class="gl-hat">
      <span class="gl-hat-ico">${h.icon}</span>
      <div><b>${esc(h.name)}</b><br><span class="cg-meta">${has ? (worn ? L('на тобі', 'you are wearing it') : L('уже твоя — одягнути?', 'already yours — wear it?')) : L('лише тут, на курорті', 'only here, at the resort')}</span></div>
      ${has ? (worn ? '' : `<button class="btn" data-wear="${id}">${L('Одягнути', 'Wear')}</button>`) : `<button class="btn primary" data-hat="${id}" ${game.money < price ? 'disabled' : ''}>${L('Купити', 'Buy')} ${formatMoney(price)}</button>`}
    </div>`;
  }).join('');
  return `
    <div class="cg-head"><div>
      <h1>🍦 ${L('Морозиво й сувеніри', 'Gelato & souvenirs')}</h1>
      <p class="sub">${L('Сонячна Марина · кіоск на набережній', 'Sunny Marina · a kiosk on the promenade')}</p>
    </div><div class="money-chip">${formatMoney(game.money)}</div></div>
    <p class="cg-meta">${L('Кулька холодного морозива після вахти — і знову є сили тягнути фали.', 'A scoop of cold gelato after your watch — and there\'s strength to haul the halyards again.')} ${L('Сили зараз', 'Energy now')}: <b>${Math.round(game.energy)}%</b></p>
    <div class="gl-scoops">${scoops}</div>
    <h3 class="gl-h">🎩 ${L('Вітрина', 'Display')}</h3>
    <div class="gl-hats">${hats}</div>
    <div class="btn-row"><button class="btn" data-close>${L('Закрити (Esc)', 'Close (Esc)')}</button></div>`;
}
