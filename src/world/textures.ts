import * as THREE from 'three';
import { mulberry32 } from '../core/math';

// ─────────────────────────────────────────────────────────────
// Процедурні canvas-текстури для порту: дошки, камінь, бруківка,
// черепиця, штукатурка, вагонка, профнастил, шум для землі.
// Текстури нейтральні за кольором там, де їх тонує material.color.
// Усі кешуються — один екземпляр на тип.
// ─────────────────────────────────────────────────────────────

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** дрібне зерно: випадкові напівпрозорі цятки */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, rng: () => number, n: number, a: number, light = true) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${rng() * a})`;
    g.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }
}

const shade = (v: number) => {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c},${c},${c})`;
};

/** дерев'яні дошки: дошки йдуть уздовж V (вертикаль текстури); 1 тайл ≈ 4 дошки */
export function planksTex(): THREE.Texture {
  return cached('planks', () => {
    const [c, g] = canvas(256, 512);
    const rng = mulberry32(11);
    const N = 4;
    const bw = 256 / N;
    for (let i = 0; i < N; i++) {
      // кожна дошка складається з 2 відрізків з різними стиками
      let y = -rng() * 300;
      while (y < 512) {
        const len = 220 + rng() * 260;
        const base = 175 + rng() * 55;
        g.fillStyle = shade(base);
        g.fillRect(i * bw, y, bw, len);
        // волокна
        for (let k = 0; k < 14; k++) {
          const x = i * bw + 3 + rng() * (bw - 6);
          g.strokeStyle = `rgba(60,40,20,${0.08 + rng() * 0.14})`;
          g.lineWidth = 0.6 + rng() * 1.2;
          g.beginPath();
          g.moveTo(x, y);
          let xx = x;
          for (let s = 0; s <= len; s += 24) {
            xx += (rng() - 0.5) * 1.6;
            g.lineTo(xx, y + s);
          }
          g.stroke();
        }
        // сучок
        if (rng() < 0.5) {
          const kx = i * bw + 8 + rng() * (bw - 16);
          const ky = y + 20 + rng() * (len - 40);
          g.fillStyle = 'rgba(70,45,25,0.45)';
          g.beginPath();
          g.ellipse(kx, ky, 3 + rng() * 3, 6 + rng() * 6, 0, 0, Math.PI * 2);
          g.fill();
        }
        // стик + цвяхи
        g.fillStyle = 'rgba(25,18,10,0.85)';
        g.fillRect(i * bw, y, bw, 2);
        g.fillStyle = 'rgba(30,30,30,0.7)';
        g.fillRect(i * bw + 6, y + 6, 3, 3);
        g.fillRect(i * bw + bw - 9, y + 6, 3, 3);
        y += len;
      }
      // щілина між дошками
      g.fillStyle = 'rgba(20,14,8,0.95)';
      g.fillRect(i * bw, 0, 3, 512);
    }
    speckle(g, 256, 512, rng, 1600, 0.08, false);
    return finish(c);
  });
}

/** кам'яна кладка (тесані блоки) — 1 тайл ≈ 4 ряди */
export function stoneTex(): THREE.Texture {
  return cached('stone', () => {
    const [c, g] = canvas(512, 512);
    const rng = mulberry32(23);
    g.fillStyle = shade(95);
    g.fillRect(0, 0, 512, 512);
    const rows = 4;
    const rh = 512 / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rng() * 120;
      while (x < 512) {
        const w = 90 + rng() * 110;
        const b = 140 + rng() * 70;
        const pad = 4;
        g.fillStyle = shade(b);
        roundRect(g, x + pad, r * rh + pad, w - pad * 2, rh - pad * 2, 10);
        g.fill();
        // об'єм: світлий верх, темний низ
        const grd = g.createLinearGradient(0, r * rh, 0, r * rh + rh);
        grd.addColorStop(0, 'rgba(255,255,255,0.18)');
        grd.addColorStop(0.5, 'rgba(0,0,0,0)');
        grd.addColorStop(1, 'rgba(0,0,0,0.25)');
        g.fillStyle = grd;
        roundRect(g, x + pad, r * rh + pad, w - pad * 2, rh - pad * 2, 10);
        g.fill();
        // повтор по горизонталі (безшовність)
        if (x + w > 512) {
          g.fillStyle = shade(b);
          roundRect(g, x - 512 + pad, r * rh + pad, w - pad * 2, rh - pad * 2, 10);
          g.fill();
        }
        x += w;
      }
    }
    speckle(g, 512, 512, rng, 5000, 0.12, false);
    speckle(g, 512, 512, rng, 2500, 0.1, true);
    return finish(c);
  });
}

/** бруківка — округлі камінці; 1 тайл ≈ 2 м */
export function cobbleTex(): THREE.Texture {
  return cached('cobble', () => {
    const [c, g] = canvas(512, 512);
    const rng = mulberry32(37);
    g.fillStyle = shade(70);
    g.fillRect(0, 0, 512, 512);
    const n = 10;
    const s = 512 / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n + 1; i++) {
        const ox = (j % 2) * s * 0.5;
        const cx = i * s + ox + (rng() - 0.5) * 6;
        const cy = j * s + s / 2 + (rng() - 0.5) * 6;
        const b = 125 + rng() * 80;
        for (const dx of [-512, 0, 512]) {
          g.fillStyle = shade(b);
          g.beginPath();
          g.ellipse(cx + dx, cy, s * 0.44, s * 0.4, rng() * 0.4, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.14)';
          g.beginPath();
          g.ellipse(cx + dx - 4, cy - 5, s * 0.26, s * 0.18, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    speckle(g, 512, 512, rng, 4000, 0.12, false);
    return finish(c);
  });
}

/** черепиця (хвилясті ряди); V — вниз по схилу; 1 тайл ≈ 2 м */
export function roofTilesTex(): THREE.Texture {
  return cached('tiles', () => {
    const [c, g] = canvas(256, 256);
    const rng = mulberry32(51);
    g.fillStyle = shade(90);
    g.fillRect(0, 0, 256, 256);
    const rows = 8;
    const cols = 8;
    const rh = 256 / rows;
    const cw = 256 / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * cw * 0.5;
      for (let i = -1; i < cols + 1; i++) {
        const x = i * cw + off;
        const y = r * rh;
        const b = 175 + rng() * 60;
        const grd = g.createLinearGradient(x, 0, x + cw, 0);
        grd.addColorStop(0, shade(b - 45));
        grd.addColorStop(0.45, shade(b + 10));
        grd.addColorStop(1, shade(b - 55));
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x + 1, y);
        g.lineTo(x + cw - 1, y);
        g.lineTo(x + cw - 1, y + rh * 0.8);
        g.quadraticCurveTo(x + cw / 2, y + rh * 1.25, x + 1, y + rh * 0.8);
        g.closePath();
        g.fill();
      }
      // тінь від ряду вище
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, r * rh, 256, 3);
    }
    speckle(g, 256, 256, rng, 1200, 0.1, false);
    return finish(c);
  });
}

/** штукатурка: м'який шум + підтьоки знизу; 1 тайл ≈ 3 м */
export function plasterTex(): THREE.Texture {
  return cached('plaster', () => {
    const [c, g] = canvas(256, 256);
    const rng = mulberry32(63);
    g.fillStyle = shade(236);
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(0,0,0,${rng() * 0.035})`;
      g.beginPath();
      g.arc(rng() * 256, rng() * 256, 6 + rng() * 26, 0, Math.PI * 2);
      g.fill();
    }
    speckle(g, 256, 256, rng, 3000, 0.07, false);
    speckle(g, 256, 256, rng, 1500, 0.08, true);
    return finish(c);
  });
}

/** вагонка (горизонтальні дошки-обшивка); V — вгору; 1 тайл ≈ 2 м, 10 дощок */
export function sidingTex(): THREE.Texture {
  return cached('siding', () => {
    const [c, g] = canvas(256, 256);
    const rng = mulberry32(77);
    const n = 10;
    const bh = 256 / n;
    for (let i = 0; i < n; i++) {
      const b = 215 + rng() * 25;
      const grd = g.createLinearGradient(0, i * bh, 0, i * bh + bh);
      grd.addColorStop(0, shade(b - 30));
      grd.addColorStop(0.2, shade(b));
      grd.addColorStop(1, shade(b - 12));
      g.fillStyle = grd;
      g.fillRect(0, i * bh, 256, bh);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, i * bh + bh - 2, 256, 2);
    }
    for (let k = 0; k < 60; k++) {
      g.strokeStyle = `rgba(0,0,0,${rng() * 0.05})`;
      const y = rng() * 256;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y + (rng() - 0.5) * 3);
      g.stroke();
    }
    speckle(g, 256, 256, rng, 1200, 0.07, false);
    return finish(c);
  });
}

/** профнастил (вертикальні хвилі); 1 тайл ≈ 1 м */
export function corrugatedTex(): THREE.Texture {
  return cached('corrugated', () => {
    const [c, g] = canvas(128, 128);
    const rng = mulberry32(91);
    for (let x = 0; x < 128; x++) {
      const v = 175 + Math.sin((x / 128) * Math.PI * 2 * 8) * 45;
      g.fillStyle = shade(v);
      g.fillRect(x, 0, 1, 128);
    }
    // іржаві підтьоки
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(120,60,20,${rng() * 0.18})`;
      g.fillRect(rng() * 128, rng() * 60, 2 + rng() * 4, 30 + rng() * 70);
    }
    speckle(g, 128, 128, rng, 500, 0.1, false);
    return finish(c);
  });
}

/** шум для землі/трави (сірий, множиться на vertex color); 1 тайл ≈ 6 м */
export function groundDetailTex(): THREE.Texture {
  return cached('ground', () => {
    const [c, g] = canvas(256, 256);
    const rng = mulberry32(103);
    g.fillStyle = shade(225);
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(0,0,0,${rng() * 0.035})`;
      g.beginPath();
      g.arc(rng() * 256, rng() * 256, 8 + rng() * 30, 0, Math.PI * 2);
      g.fill();
    }
    // стебельця трави
    for (let i = 0; i < 2600; i++) {
      const x = rng() * 256;
      const y = rng() * 256;
      const l = rng() < 0.5;
      g.strokeStyle = l ? `rgba(255,255,255,${rng() * 0.18})` : `rgba(0,0,0,${rng() * 0.2})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rng() - 0.5) * 3, y - 2 - rng() * 4);
      g.stroke();
    }
    return finish(c);
  });
}

/** м'яка радіальна пляма (світлові ореоли, калюжі світла) */
export function glowTex(): THREE.Texture {
  return cached('glow', () => {
    const [c, g] = canvas(128, 128);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = finish(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** промінь маяка: яскравий біля джерела, згасає вздовж V */
export function beamTex(): THREE.Texture {
  return cached('beam', () => {
    const [c, g] = canvas(64, 256);
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.25)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 256);
    const t = finish(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** вікно: рама + перехрестя; скло — темне (вдень) */
export function windowTex(): THREE.Texture {
  return cached('window', () => {
    const [c, g] = canvas(64, 96);
    g.fillStyle = '#f2efe6';
    g.fillRect(0, 0, 64, 96);
    const grd = g.createLinearGradient(0, 0, 64, 96);
    grd.addColorStop(0, '#9fb8c8');
    grd.addColorStop(0.5, '#4a6476');
    grd.addColorStop(1, '#2c3e4c');
    g.fillStyle = grd;
    g.fillRect(6, 6, 52, 84);
    g.fillStyle = '#f2efe6';
    g.fillRect(30, 6, 4, 84);
    g.fillRect(6, 44, 52, 4);
    return finish(c);
  });
}

/** емісивна маска для вікна: світиться лише скло (тепле світло з фіранками) */
export function windowGlowTex(): THREE.Texture {
  return cached('windowGlow', () => {
    const [c, g] = canvas(64, 96);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 96);
    const grd = g.createRadialGradient(32, 60, 4, 32, 50, 60);
    grd.addColorStop(0, '#ffe2a8');
    grd.addColorStop(1, '#c87a30');
    g.fillStyle = grd;
    g.fillRect(6, 6, 52, 84);
    // фіранки
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(6, 6, 10, 84);
    g.fillRect(48, 6, 10, 84);
    g.fillStyle = '#000';
    g.fillRect(30, 6, 4, 84);
    g.fillRect(6, 44, 52, 4);
    return finish(c);
  });
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
