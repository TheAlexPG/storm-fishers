// Математичні допоміжники (без залежностей від three, де це можливо)
import { L } from './i18n';

export const TAU = Math.PI * 2;

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Плавне прямування: newV = damp(cur, target, lambda, dt) */
export function damp(cur: number, target: number, lambda: number, dt: number): number {
  return lerp(cur, target, 1 - Math.exp(-lambda * dt));
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function dampAngle(cur: number, target: number, lambda: number, dt: number): number {
  const d = wrapAngle(target - cur);
  return cur + d * (1 - Math.exp(-lambda * dt));
}

export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function randInt(a: number, b: number): number {
  return Math.floor(rand(a, b + 1));
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function chance(p: number): boolean {
  return Math.random() < p;
}

/** Детермінований псевдовипадковий генератор (mulberry32) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function formatMoney(v: number): string {
  return Math.round(v).toLocaleString(L('uk-UA', 'en-GB')) + ' ₴';
}

export function formatTime(hours: number): string {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Компасний курс, ° (0 = північ = світ −Z, за годинниковою через схід = +X) —
 * та сама конвенція, що й пеленги на HUD/карті. heading — кут човна
 * (0 → нос на +Z, зростання — поворот ліворуч).
 */
export function compassDeg(heading: number): number {
  const d = 180 - (heading * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}
