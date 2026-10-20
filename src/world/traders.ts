import * as THREE from 'three';
import { L } from '../core/i18n';
import { DOCK_BY_ID } from '../game/cargo';
import { PORT_SITE_BY_ID } from './portSites';
import { farFog } from './continentMesh';
import type { Ocean } from '../core/ocean';
import type { BotMarker } from './bots';

// ─────────────────────────────────────────────────────────────
// Торгові судна між континентами: невеликі каботажники з контейнерами
// ходять туди-назад маршрутами «дім ↔ Лазурове узбережжя», «дім ↔ Північ»
// і «Лазурове ↔ Північ» через Великий океан, з паузою в гавані. Позиція —
// функція ігрового часу (у коопі в усіх однакова без мережі); біля яхти
// гравця судно ввічливо відходить убік.
// ─────────────────────────────────────────────────────────────

const SPEED = 6; // м/с
const PAUSE = 70; // с біля гавані
/** реальних секунд на ігрову годину (time.ts: доба = 600 с) */
const SEC_PER_H = 25;

/** точка підходу до гавані: трохи в морі перед причалом */
function approach(id: string): [number, number] {
  if (id === 'home') return [10, 230];
  const p = PORT_SITE_BY_ID[id];
  const d = DOCK_BY_ID[id];
  return [p.x + d.ox * (p.pierL + 170), p.z + d.oz * (p.pierL + 170)];
}

interface Route {
  pts: Array<[number, number]>;
  /** накопичені довжини */
  acc: number[];
  len: number;
}

function route(pts: Array<[number, number]>): Route {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, acc, len: acc[acc.length - 1] };
}

interface Ship {
  name: string;
  r: Route;
  phase: number;
  group: THREE.Group;
  x: number;
  z: number;
  h: number;
  side: number;
}

export class Traders {
  readonly group = new THREE.Group();
  private ships: Ship[] = [];
  private lights: THREE.Sprite[] = [];

  constructor(scene: THREE.Scene, glow: THREE.Texture) {
    const R = {
      med: route([approach('home'), [900, 950], [1700, 1900], [1950, 2850], approach('port-azzurro')]),
      north: route([approach('home'), [-900, 950], [-1700, 1750], [-1900, 2650], approach('port-cedar')]),
      cross: route([approach('port-azzurro'), [1500, 3300], [120, 3480], [-1500, 3150], approach('port-cedar')]),
      nikos: route([approach('port-azzurro'), [2500, 2050], approach('port-nikos')]),
    };
    const defs: Array<[string, Route, number, number, number]> = [
      [L('«Санта-Марія»', `“Santa Maria”`), R.med, 0, 0x8e2433, 0xf2f1ec],
      [L('«Північна зоря»', `“North Star”`), R.north, 0.45, 0x2c4f6e, 0xe9e4d8],
      [L('«Атлантика»', `“Atlantica”`), R.cross, 0.2, 0x2f3b45, 0xe2674a],
      [L('«Кедр»', `“Cedar”`), R.cross, 0.7, 0x3f5a35, 0xf2f1ec],
      [L('«Оливка»', `“Oliva”`), R.nikos, 0.3, 0x5d6b2c, 0xf6f3ec],
    ];
    for (const [name, r, phase, hull, trim] of defs) {
      const group = shipModel(hull, trim);
      this.group.add(group);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffe2a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      s.position.set(0, 9.5, -6);
      s.scale.setScalar(5);
      group.add(s);
      this.lights.push(s);
      this.ships.push({ name, r, phase, group, x: r.pts[0][0], z: r.pts[0][1], h: 0, side: 0 });
    }
    scene.add(this.group);
  }

  /** clockH — абсолютний ігровий час (години) */
  update(dt: number, clockH: number, ocean: Ocean, t: number, player: THREE.Vector3, night: number) {
    for (const s of this.ships) {
      const cycle = (2 * s.r.len) / SPEED + 2 * PAUSE;
      let u = ((clockH * SEC_PER_H) / cycle + s.phase) % 1;
      if (u < 0) u += 1;
      // туди → пауза → назад → пауза
      const T = u * cycle;
      const go = s.r.len / SPEED;
      let d: number, dir: number;
      if (T < go) { d = T * SPEED; dir = 1; }
      else if (T < go + PAUSE) { d = s.r.len; dir = 0; }
      else if (T < 2 * go + PAUSE) { d = s.r.len - (T - go - PAUSE) * SPEED; dir = -1; }
      else { d = 0; dir = 0; }
      let i = 1;
      while (i < s.r.acc.length - 1 && s.r.acc[i] < d) i++;
      const [ax, az] = s.r.pts[i - 1], [bx, bz] = s.r.pts[i];
      const k = (d - s.r.acc[i - 1]) / Math.max(1, s.r.acc[i] - s.r.acc[i - 1]);
      let x = ax + (bx - ax) * k, z = az + (bz - az) * k;
      let h = Math.atan2(bx - ax, bz - az);
      if (dir < 0) h += Math.PI;
      // яхта попереду поруч — відійти вбік (плавно)
      const fx = Math.sin(h), fz = Math.cos(h);
      const px = player.x - x, pz = player.z - z;
      const ahead = px * fx + pz * fz, lateral = px * fz - pz * fx;
      const want = ahead > -25 && ahead < 110 && Math.abs(lateral) < 45 ? -Math.sign(lateral || 1) * 50 : 0;
      s.side += (want - s.side) * Math.min(1, dt * 0.25);
      x += fz * s.side;
      z += -fx * s.side;
      s.x = x;
      s.z = z;
      s.h = h;
      const y = ocean.heightAt(x, z, t);
      s.group.position.set(x, y - 0.4, z);
      s.group.rotation.set(Math.sin(t * 0.5 + s.phase * 9) * 0.02, h, Math.sin(t * 0.37 + s.phase * 5) * 0.035, 'YXZ');
      s.group.visible = Math.hypot(player.x - x, player.z - z) < 3200;
    }
    for (const l of this.lights) l.material.opacity = night * 0.9;
  }

  /** для мінімапи / AIS */
  markers(): BotMarker[] {
    return this.ships.map((s) => ({ x: s.x, z: s.z, h: s.h, name: s.name }));
  }
}

/** каботажник ~22 м: корпус, контейнери, рубка на кормі, щогла з краном */
function shipModel(hullCol: number, trimCol: number): THREE.Group {
  const g = new THREE.Group();
  const M = (c: number, r = 0.7) => farFog(new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.05 }));
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    g.add(o);
    return o;
  };
  // корпус: коробка + загострений ніс
  add(new THREE.BoxGeometry(5.4, 3.0, 16), M(hullCol), 0, 1.2, -1);
  const bow = add(new THREE.CylinderGeometry(0.01, 2.7, 6, 4, 1), M(hullCol), 0, 1.2, 9.5);
  bow.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  bow.scale.set(1, 1, 0.55);
  add(new THREE.BoxGeometry(5.5, 0.3, 21.8), M(trimCol), 0, 2.75, 0.8);
  add(new THREE.BoxGeometry(5.42, 0.6, 16.02), M(0x1c2126), 0, 0.0, -1);
  // контейнери
  const cols = [0xc23a2c, 0x2f6fb5, 0xe39a2d, 0x3e7d4f, 0x8d8f8a, 0xb0532e];
  let n = 0;
  for (let z = -2; z <= 7; z += 3) for (const x of [-1.25, 1.25]) {
    add(new THREE.BoxGeometry(2.3, 2.3, 2.8), M(cols[(n++ * 7 + Math.round(z)) % cols.length], 0.6), x, 4.05, z);
  }
  // рубка
  add(new THREE.BoxGeometry(4.8, 4.0, 3.6), M(trimCol), 0, 4.8, -6.6);
  add(new THREE.BoxGeometry(4.9, 0.9, 3.7), M(0x24292d, 0.3), 0, 6.1, -6.6);
  add(new THREE.CylinderGeometry(0.45, 0.55, 2.4, 10), M(0x2a2f36), 0, 7.6, -7.8);
  // щогла й стріла крана
  add(new THREE.CylinderGeometry(0.12, 0.15, 7, 6), M(0xd9d4c8), 0, 6.4, 5.5);
  const boom = add(new THREE.CylinderGeometry(0.08, 0.08, 6, 6), M(0xe39a2d), 0, 5.6, 2.8);
  boom.rotation.x = 1.0;
  return g;
}
