import * as THREE from 'three';
import { SOLE_Y } from './yachtLayout';

// ─────────────────────────────────────────────────────────────
// Фізичне радіо над штурманським столом (без вікон інтерфейсу):
// E — повернути ручку настройки на наступну станцію (погода → рибальський
// звіт → біржа → музика → вимкнено). Стрілка біжить по шкалі частот,
// між станціями шипить ефір, на дисплеї — бігучий рядок із текстом станції.
// ─────────────────────────────────────────────────────────────

export interface RadioChannel {
  name: string;
  freq: number; // 0..1 — положення на шкалі
}

export const RADIO_CHANNELS: RadioChannel[] = [
  { name: 'ВИМК', freq: 0 },
  { name: 'ПОГОДА 161.5', freq: 0.2 },
  { name: 'РИБАЛЬСЬКИЙ ЗВІТ', freq: 0.42 },
  { name: 'БІРЖА РИБИ', freq: 0.64 },
  { name: 'ХВИЛЯ FM', freq: 0.86 },
];

/** локальні координати яхти: панель на борту над штурманським столом */
const POS = new THREE.Vector3(1.04, SOLE_Y + 1.02, 1.2);

export class RadioSet {
  readonly group = new THREE.Group();
  channel = 0;
  private needle: THREE.Mesh;
  private knob: THREE.Group;
  private volKnob: THREE.Group;
  private lamp: THREE.MeshStandardMaterial;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private needleU = 0;
  private knobA = 0;
  private scroll = 0;
  private text = '';
  private redrawT = 0;
  /** шум під час настройки (0..1) — для звуку */
  tuning = 0;

  constructor(parent: THREE.Object3D) {
    const g = this.group;
    g.position.copy(POS);
    // лицем до салону (−X): локальна +Z радіо → −X яхти
    g.rotation.y = -Math.PI / 2;
    parent.add(g);
    const body = new THREE.MeshStandardMaterial({ color: 0x5b3b24, roughness: 0.6 });
    const face = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.7 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.8 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parentObj: THREE.Object3D = g) => {
      const mm = new THREE.Mesh(geo, m);
      mm.position.set(x, y, z);
      mm.castShadow = true;
      parentObj.add(mm);
      return mm;
    };
    // дерев'яний корпус і передня панель
    add(new THREE.BoxGeometry(0.46, 0.24, 0.16), body, 0, 0, -0.02);
    add(new THREE.BoxGeometry(0.42, 0.2, 0.01), face, 0, 0, 0.065);
    // шкала частот (світла, з поділками) + стрілка
    const scale = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.05), new THREE.MeshStandardMaterial({ color: 0xf2e6c4, emissive: 0xffc77a, emissiveIntensity: 0.25, roughness: 0.6, map: this.scaleTex() }));
    scale.position.set(-0.03, 0.055, 0.071);
    g.add(scale);
    this.needle = add(new THREE.BoxGeometry(0.004, 0.05, 0.004), new THREE.MeshStandardMaterial({ color: 0xd0342c, emissive: 0xd0342c, emissiveIntensity: 0.6 }), -0.18, 0.055, 0.074);
    // дисплей бігучого рядка
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 64;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.0375), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    disp.position.set(-0.03, -0.02, 0.071);
    g.add(disp);
    // ручка настройки (велика) і гучності
    this.knob = new THREE.Group();
    this.knob.position.set(0.16, 0.0, 0.075);
    g.add(this.knob);
    const k1 = add(new THREE.CylinderGeometry(0.035, 0.038, 0.03, 18), new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.4 }), 0, 0, 0.012, this.knob);
    k1.rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.006, 0.03, 0.006), brass, 0, 0.018, 0.03, this.knob);
    this.volKnob = new THREE.Group();
    this.volKnob.position.set(0.16, -0.075, 0.075);
    g.add(this.volKnob);
    const k2 = add(new THREE.CylinderGeometry(0.018, 0.02, 0.025, 14), new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.4 }), 0, 0, 0.01, this.volKnob);
    k2.rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.004, 0.016, 0.004), brass, 0, 0.01, 0.024, this.volKnob);
    // лампочка «ефір» і гратка динаміка
    this.lamp = new THREE.MeshStandardMaterial({ color: 0x331a0a, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.4 });
    add(new THREE.SphereGeometry(0.009, 8, 6), this.lamp, 0.16, 0.075, 0.072);
    for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.11, 0.004, 0.004), brass, -0.12 + 0, -0.06 - i * 0.012 + 0.02, 0.072).position.x = -0.12;
    // антена
    const ant = add(new THREE.CylinderGeometry(0.003, 0.004, 0.4, 5), brass, -0.2, 0.3, -0.06);
    ant.rotation.z = 0.35;
    this.setText('');
    this.draw();
  }

  private scaleTex(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 40;
    const x = c.getContext('2d')!;
    x.fillStyle = '#f2e6c4';
    x.fillRect(0, 0, 256, 40);
    x.fillStyle = '#4a3a24';
    for (let i = 0; i <= 40; i++) x.fillRect(8 + i * 6, i % 5 ? 26 : 18, 1, i % 5 ? 10 : 18);
    x.font = 'bold 10px sans-serif';
    for (let i = 0; i < 5; i++) x.fillText(String(156 + i * 2), 4 + i * 60, 12);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** наступна станція; повертає її */
  next(): RadioChannel {
    this.channel = (this.channel + 1) % RADIO_CHANNELS.length;
    this.tuning = 1;
    this.scroll = 0;
    return RADIO_CHANNELS[this.channel];
  }

  get on(): boolean {
    return this.channel !== 0;
  }

  setText(t: string) {
    if (t === this.text) return;
    this.text = t;
  }

  private draw() {
    const x = this.ctx;
    x.fillStyle = '#0b1a12';
    x.fillRect(0, 0, 512, 64);
    if (!this.on) {
      this.tex.needsUpdate = true;
      return;
    }
    x.font = '700 34px "Courier New", monospace';
    x.textBaseline = 'middle';
    x.fillStyle = this.tuning > 0.3 ? '#3a7a5a' : '#6dffb0';
    const msg = this.tuning > 0.3 ? '··· настройка ···' : `${RADIO_CHANNELS[this.channel].name} — ${this.text}`;
    const w = x.measureText(msg).width + 120;
    const off = -((this.scroll * 80) % w);
    x.fillText(msg, 512 + off, 33);
    x.fillText(msg, 512 + off + w, 33);
    this.tex.needsUpdate = true;
  }

  update(dt: number) {
    const target = RADIO_CHANNELS[this.channel].freq;
    this.needleU += (target - this.needleU) * (1 - Math.exp(-dt * 3));
    this.needle.position.x = -0.18 + this.needleU * 0.3;
    this.knobA += (target * Math.PI * 3 - this.knobA) * (1 - Math.exp(-dt * 4));
    this.knob.rotation.z = -this.knobA;
    this.volKnob.rotation.z = this.on ? -1.6 : 0;
    this.tuning = Math.max(0, this.tuning - dt * 1.4);
    this.lamp.emissiveIntensity = this.on ? 1.2 + Math.sin(performance.now() / 300) * 0.2 : 0;
    this.scroll += dt;
    this.redrawT -= dt;
    if (this.redrawT <= 0) {
      this.redrawT = 1 / 30;
      this.draw();
    }
  }
}
