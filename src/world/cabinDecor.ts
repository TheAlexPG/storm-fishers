import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DECK_Y, HOUSE, SOLE_Y, STAIR } from './yachtLayout';

// ─────────────────────────────────────────────────────────────
// Затишок у салоні: книжки й банки на полицях, килимки, подушки, годинник і
// барометр на носовій переборці (живі: стрілки йдуть за часом гри й погодою),
// латунні бра, гасова лампа над столиком (гойдається проти крену), картини,
// поручні під стелею, кухлі на гачках у камбузі. Без нових джерел світла —
// лише емісія; дрібниці злиті в кілька мешів зі спільними матеріалами.
// ─────────────────────────────────────────────────────────────

const S = SOLE_Y;
const BZ = 2.66; // носова переборка
const SHELF_TOP = S + 1.09;

type Part = { geo: THREE.BufferGeometry; color: number };

/** кольорові частини → один меш (vertexColors) */
function merged(parts: Part[], mat: THREE.Material): THREE.Mesh {
  const geos = parts.map(({ geo, color }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    return g;
  });
  const m = new THREE.Mesh(mergeGeometries(geos), mat);
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return g;
}

function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// маленький детермінований rng — однаковий вигляд полиць щоразу
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BOOK_COLORS = [0x8e2f25, 0x2f5d62, 0xc9a227, 0x3b4a6b, 0x6d8b4e, 0xe2674a, 0x5b3b24, 0xd8cdb4, 0x24878c];

export class CabinDecor {
  readonly group = new THREE.Group();
  private hourHand: THREE.Object3D;
  private minHand: THREE.Object3D;
  private baroNeedle: THREE.Object3D;
  private lantern: THREE.Group;
  private flame: THREE.MeshStandardMaterial;
  private glow: THREE.MeshStandardMaterial[] = [];
  private swing = new THREE.Vector2();
  private swingV = new THREE.Vector2();
  private baro = 0.3;
  private t = 0;
  private _q = new THREE.Quaternion();
  private _e = new THREE.Euler();

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
    const g = this.group;
    const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 0.85 });
    const teak = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.55 });

    // ── книжки, банки й дрібниці на полицях за диванами ──
    const parts: Part[] = [];
    const r = rng(7);
    const shelf = (side: number, z0: number, z1: number) => {
      let z = z0;
      while (z < z1) {
        const t = 0.022 + r() * 0.03;
        const h = 0.12 + r() * 0.07;
        const lean = z + t > z1 - 0.02 ? -0.25 : r() < 0.12 ? (r() - 0.5) * 0.3 : 0;
        parts.push({ geo: box(0.1, h, t, side * 1.07, SHELF_TOP + h / 2 + 0.002, z + t / 2, 0, lean * side), color: BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)] });
        z += t + 0.003;
      }
    };
    shelf(1, 1.66, 2.02);
    shelf(-1, 2.22, 2.56);
    // банки з крупами/спеціями (скло — бурштинове) і кришки
    const jars = (side: number, zs: number[]) =>
      zs.forEach((z, i) => {
        const h = 0.09 + (i % 2) * 0.04;
        parts.push({ geo: cyl(0.035, 0.035, h, side * 1.07, SHELF_TOP + h / 2, z, 10), color: [0xd99a4e, 0xc4d6b0, 0xe8c9a0][i % 3] });
        parts.push({ geo: cyl(0.037, 0.037, 0.015, side * 1.07, SHELF_TOP + h + 0.007, z, 10), color: 0xb8453a });
      });
    jars(1, [2.12, 2.22, 2.32]);
    jars(-1, [1.72, 1.82]);
    // кораблик у пляшці на правій полиці
    parts.push({ geo: (() => { const b = new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10); b.rotateX(Math.PI / 2); b.translate(1.07, SHELF_TOP + 0.03, 2.5); return b; })(), color: 0x9fc9b8 });
    parts.push({ geo: box(0.012, 0.035, 0.08, 1.07, SHELF_TOP + 0.04, 2.5), color: 0xfff4e0 });
    // мушля й морська зірка на лівій полиці
    parts.push({ geo: (() => { const s = new THREE.SphereGeometry(0.04, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); s.scale(1, 0.6, 1.2); s.translate(-1.07, SHELF_TOP, 1.97); return s; })(), color: 0xf2d7c0 });
    parts.push({ geo: (() => { const s = new THREE.CylinderGeometry(0.045, 0.045, 0.012, 5); s.translate(-1.07, SHELF_TOP + 0.006, 2.1); return s; })(), color: 0xe2674a });

    // горщик із зеленню й банки на стільниці камбуза
    parts.push({ geo: cyl(0.06, 0.045, 0.09, -0.98, S + 0.965, -0.38, 10), color: 0xc8643c });
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const leaf = new THREE.SphereGeometry(0.035, 6, 4);
      leaf.scale(0.6, 1.4, 0.6);
      leaf.rotateZ(Math.cos(a) * 0.5);
      leaf.rotateX(Math.sin(a) * 0.5);
      leaf.translate(-0.98 + Math.cos(a) * 0.025, S + 1.06, -0.38 + Math.sin(a) * 0.025);
      parts.push({ geo: leaf, color: k % 2 ? 0x6d9b4e : 0x86b35c });
    }
    for (const [i, z] of [-0.2, -0.1].entries()) {
      parts.push({ geo: cyl(0.032, 0.032, 0.12 - i * 0.03, -1.0, S + 0.98 - i * 0.015, z, 10), color: [0xe8c9a0, 0xd99a4e][i] });
      parts.push({ geo: cyl(0.034, 0.034, 0.012, -1.0, S + 1.045 - i * 0.03, z, 10), color: 0x2f5d62 });
    }

    // столик: розгорнута книжка й тарілка з сухариками
    parts.push({ geo: box(0.14, 0.012, 0.2, -0.47, S + 0.746, 1.97, 0, 0.06), color: 0xf3efe6 });
    parts.push({ geo: box(0.14, 0.012, 0.2, -0.33, S + 0.746, 1.97, 0, -0.06), color: 0xf3efe6 });
    parts.push({ geo: box(0.29, 0.008, 0.21, -0.4, S + 0.738, 1.97), color: 0x8e2f25 });
    parts.push({ geo: cyl(0.08, 0.07, 0.012, -0.4, S + 0.745, 2.42, 16), color: 0xf3efe6 });
    for (let k = 0; k < 4; k++) parts.push({ geo: box(0.03, 0.012, 0.02, -0.42 + (k % 2) * 0.04, S + 0.757, 2.4 + Math.floor(k / 2) * 0.04, k * 0.7), color: 0xd9a55e });

    // подушки на диванах
    const pillow = (x: number, z: number, color: number, rot: number) => {
      // «надута» подушка: товста посередині, тонка по краях
      const p = new THREE.BoxGeometry(1, 1, 1, 1, 8, 8);
      const pos = p.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i), z = pos.getZ(i);
        const m = Math.max(Math.abs(y), Math.abs(z)) * 2;
        pos.setX(i, pos.getX(i) * 0.12 * (0.2 + 0.8 * (1 - m * m)));
        pos.setY(i, y * 0.28 * (1 - 0.12 * Math.pow(Math.abs(z) * 2, 4)));
        pos.setZ(i, z * 0.3 * (1 - 0.12 * Math.pow(Math.abs(y) * 2, 4)));
      }
      p.computeVertexNormals();
      p.rotateZ(-Math.sign(x) * 0.35);
      p.rotateY(rot);
      p.translate(x, S + 0.6, z);
      parts.push({ geo: p, color });
    };
    pillow(-0.98, 1.78, 0xe0a526, 0.1);
    pillow(-0.98, 2.47, 0xe2674a, -0.15);
    pillow(0.98, 2.44, 0x24878c, 0.12);
    pillow(0.98, 1.8, 0xf3efe6, -0.1);
    // складений плед у кутку правого дивана
    for (let k = 0; k < 3; k++) parts.push({ geo: box(0.26, 0.022, 0.3, 0.84, S + 0.505 + k * 0.023, 2.12, 0.05 * k), color: k === 1 ? 0xefe4c8 : 0xb8453a });

    g.add(merged(parts, vc));

    // ── поручні під стелею (тик) + латунні ніжки ──
    const rails: Part[] = [];
    for (const s of [-1, 1]) {
      const x = s * 0.6, y = HOUSE.top - 0.1;
      rails.push({ geo: (() => { const b = new THREE.CylinderGeometry(0.014, 0.014, 1.7, 8); b.rotateX(Math.PI / 2); b.translate(x, y, 1.5); return b; })(), color: 0x8a5a32 });
      for (const z of [0.75, 1.5, 2.25]) rails.push({ geo: cyl(0.012, 0.012, 0.1, x, y + 0.05, z, 6), color: 0xc9a227 });
    }
    g.add(merged(rails, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2 })));

    // ── килимки ──
    const kilim = canvasTex(256, 256, (x) => {
      x.fillStyle = '#8e2f25';
      x.fillRect(0, 0, 256, 256);
      x.fillStyle = '#efe4c8';
      x.fillRect(14, 14, 228, 228);
      x.fillStyle = '#2f5d62';
      x.fillRect(24, 24, 208, 208);
      x.fillStyle = '#e0a526';
      for (let i = 0; i < 5; i++) {
        const c = 128, r = 90 - i * 18;
        x.beginPath();
        x.moveTo(c, c - r);
        x.lineTo(c + r, c);
        x.lineTo(c, c + r);
        x.lineTo(c - r, c);
        x.closePath();
        x.fillStyle = i % 2 ? '#efe4c8' : i === 4 ? '#8e2f25' : '#e0a526';
        x.fill();
      }
      x.fillStyle = '#efe4c8';
      for (let i = 0; i < 12; i++) {
        x.fillRect(30 + i * 17, 30, 8, 8);
        x.fillRect(30 + i * 17, 218, 8, 8);
      }
    });
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.86), new THREE.MeshStandardMaterial({ map: kilim, roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, S + 0.004, 2.12);
    rug.receiveShadow = true;
    g.add(rug);
    const stripes = canvasTex(64, 256, (x) => {
      const cols = ['#efe4c8', '#24878c', '#efe4c8', '#e2674a', '#efe4c8', '#2f5d62'];
      for (let i = 0; i < 16; i++) {
        x.fillStyle = cols[i % cols.length];
        x.fillRect(0, i * 16, 64, 16);
      }
    });
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.95), new THREE.MeshStandardMaterial({ map: stripes, roughness: 1 }));
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(0, S + 0.004, 1.05);
    runner.receiveShadow = true;
    g.add(runner);

    // ── носова переборка: годинник, барометр, бра, табличка з назвою ──
    const face = (draw: (x: CanvasRenderingContext2D) => void) => new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, draw), roughness: 0.5 });
    const dial = (x: number, y: number, mat: THREE.Material) => {
      const d = new THREE.Group();
      d.position.set(x, y, BZ - 0.035);
      d.rotation.y = Math.PI; // лицем до корми
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 28), brass);
      d.add(ring);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.02, 28), brass);
      back.rotation.x = Math.PI / 2;
      back.position.z = -0.012;
      d.add(back);
      const f = new THREE.Mesh(new THREE.CircleGeometry(0.08, 28), mat);
      f.position.z = 0.0;
      d.add(f);
      // склечко
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.08, 28), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05 }));
      glass.position.z = 0.012;
      d.add(glass);
      g.add(d);
      return d;
    };
    const clockFace = face((x) => {
      x.fillStyle = '#f6efdc';
      x.fillRect(0, 0, 256, 256);
      x.fillStyle = '#2a3a46';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.font = '700 30px Georgia, serif';
      const R = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        x.font = i % 3 === 0 ? '700 28px Georgia, serif' : '600 20px Georgia, serif';
        x.fillText(R[i], 128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96);
      }
      x.font = '700 15px Manrope, sans-serif';
      x.fillStyle = '#7a2e22';
      x.fillText('ШТОРМ', 128, 170);
    });
    const clock = dial(-0.74, S + 1.2, clockFace);
    const hand = (len: number, w: number, color: number) => {
      const h = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.004), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
      m.position.y = len / 2 - 0.01;
      h.add(m);
      h.position.z = 0.006;
      return h;
    };
    this.hourHand = hand(0.045, 0.008, 0x1d2a33);
    this.minHand = hand(0.065, 0.005, 0x1d2a33);
    clock.add(this.hourHand, this.minHand);
    const baroFace = face((x) => {
      x.fillStyle = '#f6efdc';
      x.fillRect(0, 0, 256, 256);
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      const lab = ['ЯСНО', 'ЗМІННО', 'ДОЩ', 'БУРЯ'];
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI * 0.75 + (i / 3) * Math.PI * 1.5 - Math.PI / 2;
        x.font = '800 17px Manrope, sans-serif';
        x.fillStyle = i === 3 ? '#b8453a' : '#2a3a46';
        x.fillText(lab[i], 128 + Math.cos(a) * 82, 128 + Math.sin(a) * 82);
      }
      x.strokeStyle = '#2a3a46';
      x.lineWidth = 2;
      for (let i = 0; i <= 30; i++) {
        const a = -Math.PI * 0.75 + (i / 30) * Math.PI * 1.5 - Math.PI / 2;
        const r0 = i % 5 ? 108 : 100;
        x.beginPath();
        x.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0);
        x.lineTo(128 + Math.cos(a) * 116, 128 + Math.sin(a) * 116);
        x.stroke();
      }
      x.font = '700 14px Manrope, sans-serif';
      x.fillStyle = '#7a2e22';
      x.fillText('БАРОМЕТР', 128, 175);
    });
    const baro = dial(0.74, S + 1.2, baroFace);
    this.baroNeedle = hand(0.07, 0.006, 0xb8453a);
    baro.add(this.baroNeedle);
    // бра обабіч дверей: латунна чашка й тепле матове скло
    for (const x of [-0.53, 0.53]) {
      const shade = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc77a, emissiveIntensity: 0.9, roughness: 0.6, transparent: true, opacity: 0.95 });
      this.glow.push(shade);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), brass);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(x, S + 1.3, BZ - 0.06);
      g.add(arm);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.03, 12), brass);
      cup.position.set(x, S + 1.29, BZ - 0.1);
      g.add(cup);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.08, 14, 1, true), shade);
      s.position.set(x, S + 1.345, BZ - 0.1);
      g.add(s);
    }
    // табличка з назвою над дверним прорізом
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.46, 0.1),
      new THREE.MeshStandardMaterial({
        roughness: 0.5,
        map: canvasTex(512, 112, (x) => {
          x.fillStyle = '#6b4226';
          x.fillRect(0, 0, 512, 112);
          x.strokeStyle = '#c9a227';
          x.lineWidth = 6;
          x.strokeRect(8, 8, 496, 96);
          x.fillStyle = '#e8c35a';
          x.font = '800 54px Unbounded, Manrope, sans-serif';
          x.textAlign = 'center';
          x.textBaseline = 'middle';
          x.fillText('«ШТОРМ»', 256, 60);
        }),
      }),
    );
    plate.position.set(0, DECK_Y - 0.25, BZ - 0.03);
    plate.rotation.y = Math.PI;
    g.add(plate);

    // рятувальний круг на стінці над дверним прорізом
    {
      const ring: Part[] = [];
      for (let i = 0; i < 8; i++) {
        const t = new THREE.TorusGeometry(0.14, 0.042, 8, 6, Math.PI / 4);
        t.rotateZ((i * Math.PI) / 4 + Math.PI / 8);
        ring.push({ geo: t, color: i % 2 ? 0xf3efe6 : 0xd0342c });
      }
      // мотузка-лінь по колу
      for (let i = 0; i < 4; i++) {
        const t = new THREE.TorusGeometry(0.14, 0.008, 4, 6, Math.PI / 4);
        t.rotateZ((i * Math.PI) / 2 - Math.PI / 8);
        t.translate(0, 0, 0.042);
        ring.push({ geo: t, color: 0xd9c9a0 });
      }
      const m = merged(ring, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
      m.position.set(0, S + 1.82, 2.34);
      m.rotation.y = Math.PI;
      g.add(m);
    }

    // ── картини на кормовій переборці (обабіч трапа) ──
    const painting = (x: number, y: number, draw: (c: CanvasRenderingContext2D) => void) => {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.02), teak);
      fr.position.set(x, y, STAIR.zTop - 0.015);
      g.add(fr);
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), new THREE.MeshStandardMaterial({ map: canvasTex(260, 200, draw), roughness: 0.8 }));
      pic.position.set(x, y, STAIR.zTop - 0.004);
      g.add(pic);
    };
    painting(-0.8, S + 1.4, (c) => {
      // маяк на скелі
      const sky = c.createLinearGradient(0, 0, 0, 200);
      sky.addColorStop(0, '#f2b880');
      sky.addColorStop(1, '#fde7c4');
      c.fillStyle = sky;
      c.fillRect(0, 0, 260, 200);
      c.fillStyle = '#3f7a86';
      c.fillRect(0, 140, 260, 60);
      c.fillStyle = '#5f6b4e';
      c.beginPath();
      c.moveTo(120, 140);
      c.quadraticCurveTo(170, 100, 230, 140);
      c.fill();
      c.fillStyle = '#f6efdc';
      c.fillRect(165, 58, 22, 60);
      c.fillStyle = '#c8352b';
      c.fillRect(165, 74, 22, 12);
      c.fillRect(165, 98, 22, 12);
      c.fillStyle = '#2a3a46';
      c.fillRect(162, 50, 28, 10);
      c.fillStyle = '#ffe9a0';
      c.beginPath();
      c.moveTo(176, 54);
      c.lineTo(60, 30);
      c.lineTo(60, 66);
      c.closePath();
      c.globalAlpha = 0.5;
      c.fill();
      c.globalAlpha = 1;
      c.fillStyle = '#fde7c4';
      for (let i = 0; i < 6; i++) c.fillRect(10 + i * 40, 160 + (i % 2) * 14, 24, 3);
    });
    painting(0.8, S + 1.4, (c) => {
      // вітрильник у морі
      c.fillStyle = '#cfe7e4';
      c.fillRect(0, 0, 260, 200);
      c.fillStyle = '#24878c';
      c.fillRect(0, 128, 260, 72);
      c.fillStyle = '#f6efdc';
      c.beginPath();
      c.moveTo(130, 30);
      c.lineTo(130, 118);
      c.lineTo(78, 118);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(136, 44);
      c.lineTo(136, 118);
      c.lineTo(176, 118);
      c.closePath();
      c.fill();
      c.fillStyle = '#c8352b';
      c.beginPath();
      c.moveTo(70, 122);
      c.lineTo(190, 122);
      c.lineTo(176, 136);
      c.lineTo(84, 136);
      c.closePath();
      c.fill();
      c.fillStyle = '#f2b880';
      c.beginPath();
      c.arc(214, 46, 18, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#f6efdc';
      c.lineWidth = 3;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.arc(20 + i * 55, 160, 14, Math.PI, 0);
        c.stroke();
      }
    });

    // ── гасова лампа над столиком (гойдається) ──
    this.lantern = new THREE.Group();
    this.lantern.position.set(-0.36, HOUSE.top - 0.06, 2.12);
    g.add(this.lantern);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 6, 12), brass);
    this.lantern.add(hook);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.14, 4), brass);
    chain.position.y = -0.08;
    this.lantern.add(chain);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.06, 12), brass);
    cap.position.y = -0.17;
    this.lantern.add(cap);
    this.flame = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffb050, emissiveIntensity: 1.5, transparent: true, opacity: 0.88, roughness: 0.2 });
    this.glow.push(this.flame);
    const glassL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.11, 14), this.flame);
    glassL.position.y = -0.255;
    this.lantern.add(glassL);
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.12, 0.006), brass);
      bar.position.set(Math.cos(a) * 0.05, -0.255, Math.sin(a) * 0.05);
      this.lantern.add(bar);
    }
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.03, 14), brass);
    foot.position.y = -0.325;
    this.lantern.add(foot);
  }

  /** hours — час гри, storm — сила погоди 0..1, boat — група яхти (для гойдання лампи) */
  update(dt: number, hours: number, storm: number, boat: THREE.Object3D, night: number) {
    this.t += dt;
    // годинник: справжній час гри
    const h12 = hours % 12;
    this.hourHand.rotation.z = -(h12 / 12) * Math.PI * 2;
    this.minHand.rotation.z = -((hours % 1) * Math.PI * 2);
    // барометр повільно повзе за погодою (з легким тремтінням у шторм)
    this.baro += (Math.min(1, storm) - this.baro) * (1 - Math.exp(-dt * 0.3));
    this.baroNeedle.rotation.z = Math.PI * 0.75 - this.baro * Math.PI * 1.5 + (storm > 0.7 ? Math.sin(this.t * 13) * 0.02 : 0);
    // лампа: висне вертикально у світі, з пружним запізненням
    boat.getWorldQuaternion(this._q);
    this._e.setFromQuaternion(this._q, 'YXZ');
    const tx = -this._e.x, tz = -this._e.z;
    const k = 18, c = 1.6;
    this.swingV.x += ((tx - this.swing.x) * k - this.swingV.x * c) * dt;
    this.swingV.y += ((tz - this.swing.y) * k - this.swingV.y * c) * dt;
    this.swing.x += this.swingV.x * dt;
    this.swing.y += this.swingV.y * dt;
    this.lantern.rotation.set(this.swing.x, 0, this.swing.y);
    // тепле світло: вночі яскравіше, полум'я ледь мерехтить
    const flick = 1 + Math.sin(this.t * 9) * 0.05 + Math.sin(this.t * 23) * 0.04;
    for (const m of this.glow) m.emissiveIntensity = (0.7 + night * 0.9) * (m === this.flame ? flick * 1.3 : 1);
  }
}
