import * as THREE from 'three';
import { SOLE_Y } from './yachtLayout';
import type { ForecastDay } from '../game/forecast';
import type { RadioContent } from '../core/radioAudio';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Морський приймач «Шторм-М1» на панелі над штурманським столом.
// Кожен орган керування — окремий: дивишся на кнопку/ручку й тиснеш ЛКМ (або E),
// ручки крутяться коліщатком. Живлення, п'ять кнопок-пресетів (погода, риба,
// біржа, музика, ефір), ручка настройки (між станціями шипить, на шкалі є і
// станції без кнопки), гучність. Екран показує прогноз на 3 дні, біржу зі
// спарклайнами, рибальські звіти, музику зі спектром і перемовини каналу 16.
// ─────────────────────────────────────────────────────────────

export type RadioMode = 'weather' | 'fish' | 'market' | 'music' | 'chat';

export interface RadioStation {
  id: string;
  name: string;
  /** положення на шкалі 0..1 */
  freq: number;
  mode: RadioMode;
  content: RadioContent;
  style?: number;
  songs?: string[];
}

export const RADIO_STATIONS: RadioStation[] = [
  { id: 'weather', name: L('МЕТЕО 161.5', `MET 161.5`), freq: 0.1, mode: 'weather', content: 'voice' },
  { id: 'fish', name: L('РИБАЛЬСЬКИЙ ЗВІТ', `FISHING REPORT`), freq: 0.28, mode: 'fish', content: 'voice' },
  { id: 'market', name: L('БІРЖА РИБИ', `FISH EXCHANGE`), freq: 0.46, mode: 'market', content: 'voice' },
  { id: 'calm', name: L('ТИХА ВОДА', `STILL WATER`), freq: 0.64, mode: 'music', content: 'music', style: 2, songs: [L('«Штиль на світанку»', `“Dawn Calm”`), L('«Поплавок»', `“The Float”`), L('«Туман над затокою»', `“Fog over the Bay”`), L('«Чай у каюті»', `“Tea in the Cabin”`), L('«Далекий маяк»', `“Distant Lighthouse”`)] },
  { id: 'wave', name: L('ХВИЛЯ FM', `WAVE FM`), freq: 0.55, mode: 'music', content: 'music', style: 0, songs: [L('«Ой, у морі хвилі»', `“Oh, the Waves at Sea”`), L('«Гей, підтягуй шкот»', `“Heave, Trim the Sheet”`), L('«Чайка над молом»', `“A Gull over the Mole”`), L('«Додому з уловом»', `“Home with the Catch”`)] },
  { id: 'ch16', name: L('КАНАЛ 16', `CHANNEL 16`), freq: 0.8, mode: 'chat', content: 'chat' },
  { id: 'breeze', name: L('НІЧНИЙ БРИЗ', `NIGHT BREEZE`), freq: 0.94, mode: 'music', content: 'music', style: 1, songs: [L('«Ліхтарі на пірсі»', `“Lanterns on the Pier”`), L('«Тиха гавань»', `“Quiet Harbour”`), L('«Солоний джаз»', `“Salty Jazz”`)] },
];
const PRESETS = ['weather', 'fish', 'market', 'calm', 'ch16'];
const PRESET_LABEL = [L('ПОГОДА', `WEATHER`), L('РИБА', `FISH`), L('БІРЖА', `MARKET`), L('МУЗИКА', `MUSIC`), L('ЕФІР', `AIR`)];
const BAND = [156.0, 163.0];
/** ширина «ловлі» станції на шкалі */
const CATCH = 0.028;

export type RadioCtl = 'power' | 'p0' | 'p1' | 'p2' | 'p3' | 'p4' | 'tune' | 'vol';

export interface RadioData {
  clock: string;
  now: { bf: number; name: string; ms: number; wave: number; dir: number };
  forecast: ForecastDay[];
  market: Array<{ name: string; price: number; hist: number[]; demand: number; event?: string }>;
  events: string[];
  reports: Array<{ zone: string; name: string; boost: number }>;
  hold: { count: number; cap: number; value: number };
  stormSoon: boolean;
  /** що клює тут і зараз (зона гравця, день/ніч) */
  tip?: string;
  /** жива біржа: хто з рибалок здав улов (канал 16 переказує нові) */
  news?: Array<{ who: string; text: string; h: number }>;
}

/** локальні координати яхти: панель на борту над штурманським столом */
const POS = new THREE.Vector3(1.075, SOLE_Y + 1.03, 0.95);
const SW = 640;
const SH = 400;

const AMBER = '#ffc867';
const GREEN = '#9df0c0';
const DIM = 'rgba(157,240,192,0.45)';
const MONO = '"Courier New", ui-monospace, monospace';
const SANS = 'Manrope, -apple-system, "Segoe UI", sans-serif';

export class RadioSet {
  readonly group = new THREE.Group();
  /** за замовчуванням грає тихо — спокійна «Тиха вода» */
  on = true;
  /** поточне положення стрілки 0..1 і куди її ведуть */
  freq = 0.64;
  private freqTarget = 0.64;
  volume = 0.35;
  data: RadioData | null = null;
  spectrum: Uint8Array | null = null;
  /** шум під час настройки (0..1) — для звуку */
  sweep = 0;
  /** меші-органи керування (для прицілювання й підсвітки) */
  private ctls = new Map<RadioCtl, THREE.Object3D>();
  private pickables: THREE.Object3D[] = [];
  private press = new Map<RadioCtl, number>();
  private needle: THREE.Mesh;
  private tuneKnob: THREE.Group;
  private volKnob: THREE.Group;
  private leds: THREE.MeshStandardMaterial[] = [];
  private powerLed: THREE.MeshStandardMaterial;
  private screenMat: THREE.MeshBasicMaterial;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private noise: HTMLCanvasElement;
  private redrawT = 0;
  private boot = 0;
  private t = 0;
  private page = 0;
  private pageT = 0;
  private chatLog: Array<{ who: string; text: string; at: number }> = [];
  /** до якої новини біржі вже переказали (ігрові години) */
  private newsH = 0;
  private chatT = 0;
  private _ray = new THREE.Raycaster();
  private _c = new THREE.Vector2();

  constructor(parent: THREE.Object3D) {
    const g = this.group;
    g.position.copy(POS);
    // лицем до салону (−X): локальна +Z радіо → −X яхти, +X радіо → нос
    g.rotation.y = -Math.PI / 2;
    parent.add(g);
    const walnut = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.5 });
    const walnutDark = new THREE.MeshStandardMaterial({ color: 0x3e2414, roughness: 0.55 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.faceTex(), roughness: 0.55 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 0.85 });
    const bakelite = new THREE.MeshStandardMaterial({ color: 0x1f1a16, roughness: 0.35 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, p: THREE.Object3D = g) => {
      const mm = new THREE.Mesh(geo, m);
      mm.position.set(x, y, z);
      p.add(mm);
      return mm;
    };
    // корпус: горіх із закругленими кромками, кремова лицьова панель
    const body = add(roundBox(0.9, 0.36, 0.14, 0.03), walnut, 0, 0, -0.01);
    body.castShadow = true;
    add(new THREE.BoxGeometry(0.86, 0.32, 0.01), cream, 0, 0, 0.062);
    // рамка екрана
    add(roundBox(0.43, 0.28, 0.02, 0.012), walnutDark, -0.2, 0.012, 0.064);
    // екран
    this.canvas = document.createElement('canvas');
    this.canvas.width = SW;
    this.canvas.height = SH;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    add(new THREE.PlaneGeometry(0.4, 0.25), this.screenMat, -0.2, 0.012, 0.0752);
    // скло екрана з відблиском
    const glass = add(new THREE.PlaneGeometry(0.4, 0.25), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, roughness: 0.05, metalness: 0.2 }), -0.2, 0.012, 0.077);
    glass.renderOrder = 2;
    // шкала частот зі стрілкою
    add(new THREE.PlaneGeometry(0.32, 0.05), new THREE.MeshStandardMaterial({ color: 0xf2e6c4, emissive: 0xffc77a, emissiveIntensity: 0.35, roughness: 0.6, map: this.scaleTex() }), 0.2, 0.125, 0.0685);
    this.needle = add(new THREE.BoxGeometry(0.004, 0.05, 0.004), new THREE.MeshStandardMaterial({ color: 0xd0342c, emissive: 0xd0342c, emissiveIntensity: 0.6 }), 0, 0.125, 0.072);
    // п'ять кнопок-пресетів із вогниками над ними
    for (let i = 0; i < 5; i++) {
      const x = 0.07 + i * 0.062;
      const b = add(roundBox(0.048, 0.03, 0.022, 0.006), bakelite, x, 0.05, 0.074);
      this.reg(`p${i}` as RadioCtl, b);
      const led = new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xffb040, emissiveIntensity: 0, roughness: 0.4 });
      add(new THREE.SphereGeometry(0.005, 8, 6), led, x, 0.078, 0.069);
      this.leds.push(led);
    }
    // живлення: червона кнопка й вогник
    const pw = add(new THREE.CylinderGeometry(0.018, 0.02, 0.022, 16), new THREE.MeshStandardMaterial({ color: 0xc8352b, roughness: 0.4 }), 0.075, -0.075, 0.072);
    pw.rotation.x = Math.PI / 2;
    this.reg('power', pw);
    this.powerLed = new THREE.MeshStandardMaterial({ color: 0x401010, emissive: 0xff3b2b, emissiveIntensity: 0, roughness: 0.4 });
    add(new THREE.SphereGeometry(0.006, 8, 6), this.powerLed, 0.075, -0.035, 0.069);
    // гучність
    this.volKnob = new THREE.Group();
    this.volKnob.position.set(0.19, -0.08, 0.068);
    g.add(this.volKnob);
    const k2 = add(new THREE.CylinderGeometry(0.026, 0.029, 0.03, 20), bakelite, 0, 0, 0.012, this.volKnob);
    k2.rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 16), brass, 0, 0, 0.029, this.volKnob).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.004, 0.016, 0.004), new THREE.MeshStandardMaterial({ color: 0xfff4e0 }), 0, 0.014, 0.032, this.volKnob);
    this.reg('vol', this.volKnob);
    // настройка — велика ручка з рифленням
    this.tuneKnob = new THREE.Group();
    this.tuneKnob.position.set(0.335, -0.07, 0.068);
    g.add(this.tuneKnob);
    const k1 = add(new THREE.CylinderGeometry(0.045, 0.049, 0.036, 24), bakelite, 0, 0, 0.015, this.tuneKnob);
    k1.rotation.x = Math.PI / 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      add(new THREE.BoxGeometry(0.006, 0.006, 0.03), bakelite, Math.cos(a) * 0.049, Math.sin(a) * 0.049, 0.015, this.tuneKnob);
    }
    add(new THREE.CylinderGeometry(0.032, 0.032, 0.004, 20), brass, 0, 0, 0.035, this.tuneKnob).rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 8), new THREE.MeshStandardMaterial({ color: 0xfff4e0 }), 0, 0.022, 0.038, this.tuneKnob).rotation.x = Math.PI / 2;
    this.reg('tune', this.tuneKnob);
    // латунні ніжки-кронштейни й антена
    for (const x of [-0.4, 0.4]) add(new THREE.BoxGeometry(0.03, 0.05, 0.12), brass, x, -0.19, 0);
    const ant = add(new THREE.CylinderGeometry(0.003, 0.004, 0.42, 5), brass, 0.38, 0.36, -0.04);
    ant.rotation.z = -0.3;
    add(new THREE.SphereGeometry(0.008, 8, 6), brass, 0.44, 0.56, -0.04);
    this.noise = this.makeNoise();
    this.draw();
  }

  private reg(id: RadioCtl, o: THREE.Object3D) {
    this.ctls.set(id, o);
    o.traverse((c) => {
      c.userData.radioCtl = id;
      if ((c as THREE.Mesh).isMesh) this.pickables.push(c);
    });
  }

  /** орган керування, на який дивиться камера (центр екрана) */
  aim(camera: THREE.Camera): RadioCtl | null {
    this._ray.setFromCamera(this._c.set(0, 0), camera);
    this._ray.far = 1.8;
    const hit = this._ray.intersectObjects(this.pickables, false)[0];
    if (hit) return hit.object.userData.radioCtl as RadioCtl;
    // поруч із дрібною кнопкою — теж рахується (до ~2.5 см)
    let best: RadioCtl | null = null;
    let bd = 0.03;
    const p = new THREE.Vector3();
    for (const [id, o] of this.ctls) {
      o.getWorldPosition(p);
      const d = this._ray.ray.distanceToPoint(p);
      if (d < bd && this._ray.ray.origin.distanceTo(p) < 1.8) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  object(ctl: RadioCtl): THREE.Object3D | undefined {
    return this.ctls.get(ctl);
  }

  /** станція, на яку зараз налаштовано, і сила сигналу 0..1 */
  get tuned(): { st: RadioStation | null; signal: number } {
    let best: RadioStation | null = null;
    let bd = Infinity;
    for (const s of RADIO_STATIONS) {
      const d = Math.abs(s.freq - this.freq);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    const signal = Math.max(0, Math.min(1, 1 - bd / CATCH));
    return { st: signal > 0 ? best : null, signal: signal * signal * (3 - 2 * signal) };
  }

  get mhz(): string {
    return (BAND[0] + this.freq * (BAND[1] - BAND[0])).toFixed(2).replace('.', L(',', '.'));
  }

  label(ctl: RadioCtl | null): string {
    if (!ctl) return this.on ? L('Радіо — наведи погляд на кнопку чи ручку', `Radio — aim at a button or a knob`) : L('Радіо «Шторм-М1» — подивись на червону кнопку, щоб увімкнути', `“Storm-M1” radio — look at the red button to switch it on`);
    if (ctl === 'power') return this.on ? L('Вимкнути радіо', `Switch the radio off`) : L('Увімкнути радіо', `Switch the radio on`);
    if (ctl === 'tune') return L(`Настройка ${this.mhz} МГц — коліщатко: крутити · ЛКМ/ПКМ: наступна/попередня станція`, `Tuning ${this.mhz} MHz — wheel: turn · LMB/RMB: next/previous station`);
    if (ctl === 'vol') return L(`Гучність ${Math.round(this.volume * 100)}% — коліщатко · ЛКМ/ПКМ: +/−`, `Volume ${Math.round(this.volume * 100)}% — wheel · LMB/RMB: +/−`);
    const i = Number(ctl.slice(1));
    const st = RADIO_STATIONS.find((s) => s.id === PRESETS[i]);
    return L(`Кнопка «${PRESET_LABEL[i]}» — ${st?.name.toLowerCase() ?? ''}${this.on ? '' : L(' (радіо вимкнене)', ` (radio is off)`)}`, `“${PRESET_LABEL[i]}” button — ${st?.name.toLowerCase() ?? ''}${this.on ? '' : L(' (радіо вимкнене)', ` (radio is off)`)}`);
  }

  /** ЛКМ/E (dir = 1) чи ПКМ (dir = −1) по органу керування */
  use(ctl: RadioCtl, dir = 1) {
    this.press.set(ctl, 1);
    if (ctl === 'power') {
      this.on = !this.on;
      if (this.on) this.boot = 1;
      return;
    }
    if (ctl === 'vol') {
      this.volume = Math.max(0, Math.min(1, this.volume + dir * 0.1));
      return;
    }
    if (ctl === 'tune') {
      // до наступної станції на шкалі
      const list = [...RADIO_STATIONS].sort((a, b) => a.freq - b.freq);
      const cur = this.freqTarget;
      const nx = dir > 0 ? list.find((s) => s.freq > cur + 0.005) ?? list[0] : [...list].reverse().find((s) => s.freq < cur - 0.005) ?? list[list.length - 1];
      this.freqTarget = nx.freq;
      return;
    }
    const st = RADIO_STATIONS.find((s) => s.id === PRESETS[Number(ctl.slice(1))]);
    if (!st) return;
    if (!this.on) {
      this.on = true;
      this.boot = 1;
    }
    // повторне натискання на біржі — наступна сторінка
    if (Math.abs(this.freqTarget - st.freq) < 0.002 && st.mode === 'market') this.page++;
    else this.page = 0;
    this.pageT = 0;
    this.freqTarget = st.freq;
  }

  /** коліщатко на ручці: кроки (+ — за годинниковою) */
  turn(ctl: RadioCtl, steps: number) {
    if (ctl === 'vol') this.volume = Math.max(0, Math.min(1, this.volume + steps * 0.05));
    else if (ctl === 'tune') {
      this.freqTarget = Math.max(0, Math.min(1, this.freqTarget + steps * 0.008));
      this.sweep = Math.max(this.sweep, 0.6);
    } else return;
    this.press.set(ctl, 0.3);
  }

  update(dt: number, visible: boolean) {
    this.t += dt;
    const before = this.freq;
    // стрілка доїжджає до цілі (через шум між станціями)
    const d = this.freqTarget - this.freq;
    const step = Math.sign(d) * Math.min(Math.abs(d), dt * (0.12 + Math.abs(d) * 2.5));
    this.freq += step;
    if (Math.abs(this.freq - before) > 1e-4) this.sweep = Math.min(1, this.sweep + dt * 6);
    this.sweep = Math.max(0, this.sweep - dt * 1.6);
    this.boot = Math.max(0, this.boot - dt * 1.1);
    this.needle.position.x = 0.05 + this.freq * 0.3;
    this.tuneKnob.rotation.z = -this.freq * Math.PI * 5;
    this.volKnob.rotation.z = 2.3 - this.volume * 4.6;
    // натиснуті кнопки
    for (const [id, p] of this.press) {
      const np = Math.max(0, p - dt * 6);
      this.press.set(id, np);
      const o = this.ctls.get(id)!;
      if (id.startsWith('p') || id === 'power') o.position.z = 0.074 - (id === 'power' ? 0.002 : 0) - np * 0.008;
    }
    const tuned = this.tuned;
    for (let i = 0; i < 5; i++) this.leds[i].emissiveIntensity = this.on && tuned.st?.id === PRESETS[i] ? 1.6 * tuned.signal : 0;
    this.powerLed.emissive.setHex(this.on ? 0x4cff8a : 0xff3b2b);
    this.powerLed.emissiveIntensity = this.on ? 1.2 : 0.25;
    // сторінки біржі гортаються самі
    this.pageT += dt;
    if (this.pageT > 8) {
      this.pageT = 0;
      this.page++;
    }
    if (this.on && tuned.st?.mode === 'chat') this.tickChat(dt);
    if (!visible) return;
    this.redrawT -= dt;
    if (this.redrawT <= 0) {
      this.redrawT = 1 / 20;
      this.draw();
    }
  }

  // ── екран ──
  private draw() {
    const x = this.ctx;
    x.save();
    x.fillStyle = '#081210';
    x.fillRect(0, 0, SW, SH);
    if (!this.on) {
      // вимкнений: темне скло з відблиском
      const g = x.createLinearGradient(0, 0, SW, SH);
      g.addColorStop(0, 'rgba(255,255,255,0.05)');
      g.addColorStop(0.45, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, SW, SH);
      x.restore();
      this.tex.needsUpdate = true;
      return;
    }
    const bg = x.createRadialGradient(SW / 2, SH / 2, 60, SW / 2, SH / 2, SW * 0.7);
    bg.addColorStop(0, '#12251d');
    bg.addColorStop(1, '#07100d');
    x.fillStyle = bg;
    x.fillRect(0, 0, SW, SH);
    if (this.boot > 0) {
      this.drawBoot(x);
    } else {
      const { st, signal } = this.tuned;
      this.drawHeader(x, st, signal);
      x.save();
      x.beginPath();
      x.rect(0, 52, SW, SH - 52 - 30);
      x.clip();
      if (st && signal > 0.05) {
        // слабкий сигнал — картинка тремтить і просвічує шум
        if (signal < 0.9) x.translate((Math.random() - 0.5) * 10 * (1 - signal), 0);
        x.globalAlpha = Math.min(1, signal * 1.4);
        this.drawMode(x, st);
        x.globalAlpha = 1;
      }
      if (!st || signal < 0.9) this.drawStatic(x, st ? signal : 0);
      x.restore();
      this.drawFooter(x);
    }
    // розгортка ЕПТ: лінії і віньєтка
    x.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < SH; y += 4) x.fillRect(0, y, SW, 2);
    const v = x.createRadialGradient(SW / 2, SH / 2, SH * 0.45, SW / 2, SH / 2, SW * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    x.fillStyle = v;
    x.fillRect(0, 0, SW, SH);
    x.restore();
    this.tex.needsUpdate = true;
  }

  private drawBoot(x: CanvasRenderingContext2D) {
    const k = 1 - this.boot;
    x.fillStyle = AMBER;
    x.font = `800 44px ${SANS}`;
    x.textAlign = 'center';
    x.fillText(L('ШТОРМ-М1', `STORM-M1`), SW / 2, 170);
    x.font = `600 20px ${MONO}`;
    x.fillStyle = GREEN;
    x.fillText(L('морський приймач · самоперевірка', `marine receiver · self-test`), SW / 2, 210);
    x.strokeStyle = DIM;
    x.lineWidth = 2;
    x.strokeRect(170, 245, 300, 18);
    x.fillStyle = GREEN;
    x.fillRect(174, 249, 292 * k, 10);
  }

  private drawHeader(x: CanvasRenderingContext2D, st: RadioStation | null, signal: number) {
    x.fillStyle = 'rgba(157,240,192,0.08)';
    x.fillRect(0, 0, SW, 48);
    x.textAlign = 'left';
    x.font = `800 24px ${SANS}`;
    x.fillStyle = AMBER;
    x.fillText(st && signal > 0.3 ? st.name : L('ПОШУК…', `SEARCHING…`), 18, 33);
    x.textAlign = 'right';
    x.font = `700 22px ${MONO}`;
    x.fillStyle = GREEN;
    x.fillText(L(`${this.mhz} МГц`, `${this.mhz} MHz`), SW - 92, 32);
    // сила сигналу
    for (let i = 0; i < 4; i++) {
      x.fillStyle = signal > (i + 0.5) / 4.5 ? GREEN : 'rgba(157,240,192,0.18)';
      x.fillRect(SW - 76 + i * 9, 34 - (i + 1) * 6, 6, (i + 1) * 6);
    }
    // гучність
    x.fillStyle = DIM;
    x.fillRect(SW - 36, 14, 4, 20);
    x.fillStyle = GREEN;
    const vh = Math.round(this.volume * 20);
    x.fillRect(SW - 28, 34 - vh, 10, vh);
  }

  private drawFooter(x: CanvasRenderingContext2D) {
    x.fillStyle = 'rgba(157,240,192,0.08)';
    x.fillRect(0, SH - 30, SW, 30);
    x.font = `600 16px ${MONO}`;
    x.fillStyle = DIM;
    x.textAlign = 'left';
    x.fillText(this.data?.clock ?? '', 16, SH - 10);
    x.textAlign = 'right';
    const { st } = this.tuned;
    const hint = st?.mode === 'market' ? L('БІРЖА ще раз — наступна сторінка', `MARKET again — next page`) : L('крути ручку — є й інші станції', `turn the knob — there are other stations`);
    x.fillText(hint, SW - 16, SH - 10);
  }

  private drawStatic(x: CanvasRenderingContext2D, signal: number) {
    x.globalAlpha = 0.85 * (1 - signal);
    const ox = Math.floor(Math.random() * 256), oy = Math.floor(Math.random() * 256);
    x.drawImage(this.noise, ox, oy, SW / 2, (SH - 82) / 2, 0, 52, SW, SH - 82);
    x.globalAlpha = 1;
    if (signal < 0.3) {
      x.textAlign = 'center';
      x.fillStyle = 'rgba(8,18,16,0.75)';
      x.fillRect(SW / 2 - 200, 150, 400, 96);
      x.font = `800 26px ${SANS}`;
      x.fillStyle = AMBER;
      x.fillText(L('ПОШУК СИГНАЛУ', `SEARCHING FOR SIGNAL`), SW / 2, 190);
      x.font = `600 18px ${MONO}`;
      x.fillStyle = GREEN;
      x.fillText(L('◂  крути ручку настройки  ▸', `◂  turn the tuning knob  ▸`), SW / 2, 225);
    }
  }

  private drawMode(x: CanvasRenderingContext2D, st: RadioStation) {
    const d = this.data;
    if (!d) return;
    switch (st.mode) {
      case 'weather': return this.drawWeather(x, d);
      case 'fish': return this.drawFish(x, d);
      case 'market': return this.drawMarket(x, d);
      case 'music': return this.drawMusic(x, st);
      case 'chat': return this.drawChat(x);
    }
  }

  private drawWeather(x: CanvasRenderingContext2D, d: RadioData) {
    const n = d.now;
    x.textAlign = 'left';
    x.font = `700 19px ${SANS}`;
    x.fillStyle = GREEN;
    x.fillText(L(`Зараз: ${n.bf} б · ${n.name} · ${Math.round(n.ms)} м/с · хвиля ${n.wave.toFixed(1).replace('.', L(',', '.'))} м`, `Now: Bf ${n.bf} · ${n.name} · ${Math.round(n.ms)} m/s · waves ${n.wave.toFixed(1).replace('.', L(',', '.'))} m`), 18, 82);
    const cw = 196, ch = 236, y0 = 98;
    d.forecast.forEach((f, i) => {
      const x0 = 14 + i * (cw + 11);
      x.fillStyle = f.storm > 60 ? 'rgba(255,107,94,0.14)' : 'rgba(157,240,192,0.07)';
      roundRect(x, x0, y0, cw, ch, 12);
      x.fill();
      x.strokeStyle = f.storm > 60 ? 'rgba(255,107,94,0.7)' : 'rgba(157,240,192,0.25)';
      x.lineWidth = 2;
      x.stroke();
      x.textAlign = 'center';
      x.font = `800 20px ${SANS}`;
      x.fillStyle = AMBER;
      x.fillText(f.label, x0 + cw / 2, y0 + 30);
      weatherIcon(x, x0 + cw / 2, y0 + 82, f.state, this.t);
      x.font = `800 22px ${MONO}`;
      x.fillStyle = GREEN;
      x.fillText(L(`${f.bf} б · ${Math.round(f.windMs)} м/с`, `Bf ${f.bf} · ${Math.round(f.windMs)} m/s`), x0 + cw / 2, y0 + 146);
      // стрілка вітру
      x.save();
      x.translate(x0 + cw - 26, y0 + 22);
      x.rotate(f.dir);
      x.beginPath();
      x.moveTo(0, -11);
      x.lineTo(6, 8);
      x.lineTo(0, 4);
      x.lineTo(-6, 8);
      x.closePath();
      x.fillStyle = DIM;
      x.fill();
      x.restore();
      x.font = `600 17px ${MONO}`;
      x.fillStyle = DIM;
      x.fillText(L(`хвиля ${f.waveM.toFixed(1).replace('.', L(',', '.'))} м`, `waves ${f.waveM.toFixed(1).replace('.', L(',', '.'))} m`), x0 + cw / 2, y0 + 174);
      // ризик шторму
      x.fillStyle = 'rgba(157,240,192,0.15)';
      x.fillRect(x0 + 18, y0 + 196, cw - 36, 10);
      x.fillStyle = f.storm > 60 ? '#ff6b5e' : f.storm > 25 ? AMBER : GREEN;
      x.fillRect(x0 + 18, y0 + 196, (cw - 36) * (f.storm / 100), 10);
      x.font = `700 15px ${SANS}`;
      x.fillText(L(`шторм ${f.storm}%`, `storm ${f.storm}%`), x0 + cw / 2, y0 + 226);
    });
    if (d.stormSoon && Math.floor(this.t * 2) % 2 === 0) {
      x.textAlign = 'center';
      x.font = `800 18px ${SANS}`;
      x.fillStyle = '#ff6b5e';
      x.fillText(L('⚠ ШТОРМОВЕ ПОПЕРЕДЖЕННЯ — повертайтесь у порт', `⚠ STORM WARNING — return to port`), SW / 2, SH - 40);
    }
  }

  private drawFish(x: CanvasRenderingContext2D, d: RadioData) {
    x.textAlign = 'left';
    x.font = `800 21px ${SANS}`;
    x.fillStyle = GREEN;
    x.fillText(L('Де клює сьогодні', `Where they're biting today`), 18, 84);
    if (!d.reports.length) {
      x.font = `600 20px ${MONO}`;
      x.fillStyle = DIM;
      x.fillText(L('Стаї не помічено. Слухайте завтра.', `No schools spotted. Listen again tomorrow.`), 18, 130);
    }
    d.reports.slice(0, 4).forEach((r, i) => {
      const y = 104 + i * 58;
      x.fillStyle = 'rgba(157,240,192,0.07)';
      roundRect(x, 14, y, SW - 28, 50, 10);
      x.fill();
      fishIcon(x, 50, y + 25, 1 + Math.min(1, (r.boost - 1) * 0.8) * 0.3, this.t + i);
      x.font = `800 22px ${SANS}`;
      x.fillStyle = AMBER;
      x.fillText(r.name, 92, y + 23);
      x.font = `600 17px ${MONO}`;
      x.fillStyle = DIM;
      x.fillText(r.zone, 92, y + 43);
      x.textAlign = 'right';
      x.font = `800 26px ${MONO}`;
      x.fillStyle = GREEN;
      x.fillText(`×${r.boost.toFixed(1).replace('.', L(',', '.'))}`, SW - 30, y + 34);
      x.textAlign = 'left';
    });
    if (d.tip) {
      x.font = `700 17px ${SANS}`;
      x.fillStyle = GREEN;
      wrap(x, d.tip, 18, 104 + Math.min(4, d.reports.length) * 58 + 22, SW - 36, 22, 2);
    }
    x.font = `600 17px ${MONO}`;
    x.fillStyle = DIM;
    x.fillText(L(`У трюмі: ${d.hold.count}/${d.hold.cap} · ≈ ${Math.round(d.hold.value)} ₴`, `In the hold: ${d.hold.count}/${d.hold.cap} · ≈ ${Math.round(d.hold.value)} ₴`), 18, SH - 42);
  }

  private drawMarket(x: CanvasRenderingContext2D, d: RadioData) {
    const per = 5;
    const pages = Math.max(1, Math.ceil(d.market.length / per));
    const pg = this.page % pages;
    const rows = d.market.slice(pg * per, pg * per + per);
    x.font = `700 15px ${MONO}`;
    x.fillStyle = DIM;
    x.textAlign = 'left';
    x.fillText(L('ВИД', `SPECIES`), 18, 72);
    x.fillText(L('₴/КГ СВІЖ.', `₴/KG FRESH`), 228, 72);
    x.fillText(L('ІСТОРІЯ', `HISTORY`), 330, 72);
    x.textAlign = 'right';
    x.fillText(L(`стор. ${pg + 1}/${pages}`, `page ${pg + 1}/${pages}`), SW - 18, 72);
    rows.forEach((r, i) => {
      const y = 82 + i * 50;
      if (i % 2 === 0) {
        x.fillStyle = 'rgba(157,240,192,0.05)';
        x.fillRect(10, y, SW - 20, 48);
      }
      const h = r.hist.slice(-24);
      const first = h[0] ?? r.price;
      const ch = first > 0 ? (r.price - first) / first : 0;
      const up = ch > 0.02, down = ch < -0.02;
      const col = up ? GREEN : down ? '#ff8a7a' : AMBER;
      x.textAlign = 'left';
      x.font = `800 20px ${SANS}`;
      x.fillStyle = '#e9f7ee';
      x.fillText(r.name, 18, y + 24);
      // попит (насичення ринку)
      x.fillStyle = 'rgba(157,240,192,0.15)';
      x.fillRect(18, y + 33, 120, 5);
      x.fillStyle = r.demand > 0.85 ? GREEN : r.demand > 0.6 ? AMBER : '#ff8a7a';
      x.fillRect(18, y + 33, 120 * r.demand, 5);
      if (r.event) {
        x.font = `700 13px ${SANS}`;
        x.fillStyle = AMBER;
        x.fillText(r.event, 146, y + 40);
      }
      x.font = `800 22px ${MONO}`;
      x.fillStyle = col;
      x.fillText(r.price.toFixed(r.price < 100 ? 1 : 0).replace('.', L(',', '.')), 228, y + 30);
      // спарклайн
      if (h.length > 1) {
        const lo = Math.min(...h), hi = Math.max(...h);
        const sx = 330, sw = 200, sy = y + 8, sh = 32;
        x.beginPath();
        h.forEach((v, k) => {
          const px = sx + (k / (h.length - 1)) * sw;
          const py = sy + sh - ((v - lo) / (hi - lo || 1)) * sh;
          if (k) x.lineTo(px, py);
          else x.moveTo(px, py);
        });
        x.strokeStyle = col;
        x.lineWidth = 2.5;
        x.stroke();
        x.lineTo(sx + sw, sy + sh);
        x.lineTo(sx, sy + sh);
        x.closePath();
        x.fillStyle = up ? 'rgba(157,240,192,0.12)' : down ? 'rgba(255,138,122,0.12)' : 'rgba(255,200,103,0.1)';
        x.fill();
      } else {
        // історії ще немає (новий сейв) — пунктир
        x.setLineDash([6, 6]);
        x.strokeStyle = DIM;
        x.lineWidth = 2;
        x.beginPath();
        x.moveTo(330, y + 24);
        x.lineTo(530, y + 24);
        x.stroke();
        x.setLineDash([]);
      }
      x.textAlign = 'right';
      x.font = `800 18px ${MONO}`;
      x.fillStyle = col;
      x.fillText(`${up ? '▲' : down ? '▼' : '■'}${Math.abs(Math.round(ch * 100))}%`, SW - 18, y + 30);
    });
    // бігучий рядок подій
    const tick = d.events.length ? d.events.join('   ·   ') : L('Ринок спокійний. Продавайте різну рибу — ціна одного виду падає від надлишку.', `The market is calm. Sell a mix of fish — one species gets cheaper when there's a glut.`);
    x.font = `700 17px ${SANS}`;
    const w = x.measureText(tick).width + 80;
    const off = (this.t * 70) % w;
    x.textAlign = 'left';
    x.fillStyle = AMBER;
    x.fillText(tick, SW - off, SH - 42);
    x.fillText(tick, SW - off + w, SH - 42);
  }

  private drawMusic(x: CanvasRenderingContext2D, st: RadioStation) {
    const songs = st.songs ?? ['…'];
    const song = songs[Math.floor(this.t / 95) % songs.length];
    x.textAlign = 'center';
    x.font = `600 18px ${MONO}`;
    x.fillStyle = DIM;
    x.fillText(L('♪ зараз в ефірі ♪', `♪ on air now ♪`), SW / 2, 92);
    x.font = `800 30px ${SANS}`;
    x.fillStyle = AMBER;
    x.fillText(song, SW / 2, 132);
    // спектр (від справжнього звуку; без звуку — «ефір дихає»)
    const n = 24, bw = 18, gap = 5;
    const x0 = (SW - n * (bw + gap)) / 2;
    const base = 330;
    for (let i = 0; i < n; i++) {
      // смуги 1..18 (~190 Гц–3,4 кГц) — там, де грає AM-тракт
      const bi = 1 + (i / (n - 1)) * 17, b0 = Math.floor(bi), bf = bi - b0;
      const s = this.spectrum ? (((this.spectrum[b0] ?? 0) * (1 - bf) + (this.spectrum[b0 + 1] ?? 0) * bf) / 255) * (0.8 + i * 0.03) : 0.25 + 0.2 * Math.sin(this.t * 3 + i * 0.7) * Math.sin(this.t * 1.3 + i);
      const h = Math.max(4, s * 150);
      const g = x.createLinearGradient(0, base - 150, 0, base);
      g.addColorStop(0, AMBER);
      g.addColorStop(1, GREEN);
      x.fillStyle = g;
      for (let yy = base - h; yy < base; yy += 8) x.fillRect(x0 + i * (bw + gap), yy, bw, 6);
    }
    // касета-«хвиля»
    x.strokeStyle = DIM;
    x.lineWidth = 2;
    x.beginPath();
    for (let i = 0; i <= 60; i++) {
      const px = 40 + i * ((SW - 80) / 60);
      const py = 160 + Math.sin(i * 0.5 + this.t * 4) * 5;
      if (i) x.lineTo(px, py);
      else x.moveTo(px, py);
    }
    x.stroke();
  }

  private drawChat(x: CanvasRenderingContext2D) {
    x.textAlign = 'left';
    const lines = this.chatLog.slice(-5);
    if (!lines.length) {
      x.font = `600 20px ${MONO}`;
      x.fillStyle = DIM;
      x.fillText(L('· · · тиша в ефірі · · ·', `· · · silence on air · · ·`), 18, 120);
    }
    lines.forEach((l, i) => {
      const y = 84 + i * 56;
      const age = this.t - l.at;
      const shown = Math.min(l.text.length, Math.floor(age * 34));
      x.font = `800 18px ${SANS}`;
      x.fillStyle = AMBER;
      x.fillText(l.who, 18, y);
      x.font = `600 17px ${MONO}`;
      x.fillStyle = i === lines.length - 1 ? GREEN : DIM;
      wrap(x, l.text.slice(0, shown) + (shown < l.text.length && Math.floor(this.t * 4) % 2 ? '▌' : ''), 18, y + 22, SW - 36, 20, 2);
    });
  }

  private tickChat(dt: number) {
    this.chatT -= dt;
    if (this.chatT > 0) return;
    this.chatT = 5 + Math.random() * 6;
    const d = this.data;
    // свіжа новина біржі (бот здав улов) — у ефір першою (старі з сейву — лише остання)
    if (!this.newsH && d?.news?.length) this.newsH = d.news[d.news.length - 1].h - 1e-3;
    const fresh = d?.news?.find((n) => n.h > this.newsH);
    if (fresh) {
      this.newsH = fresh.h;
      this.chatLog.push({ who: fresh.who, text: fresh.text, at: this.t });
      if (this.chatLog.length > 12) this.chatLog.shift();
      return;
    }
    const who = [L('«Чайка-2»', `“Seagull-2”`), L('«Ластівка»', `“Swallow”`), L('«Буревісник»', `“Petrel”`), L('«Дельфін»', `“Dolphin”`), L('Портова служба', `Harbour control`), L('«Стара Марта»', `“Old Martha”`), L('«Кит»', `“Whale”`)];
    const w = who[Math.floor(Math.random() * who.length)];
    const pool: string[] = [
      L('Бачу туман на заході, зменшую хід, прийом.', `Fog to the west, slowing down, over.`),
      L('Хто біля маяка — у вас клює? Прийом.', `Anyone by the lighthouse — are they biting? Over.`),
      L('Повертаюсь із уловом, ставте чайник.', `Coming back with a catch, put the kettle on.`),
      L('Чайки сідають на воду — буде тиша.', `Gulls settling on the water — calm ahead.`),
      L('Перевірте ходові вогні, вечоріє.', `Check your running lights, it's getting dark.`),
      L('Помітив дельфінів на сході. Гарний знак!', `Spotted dolphins to the east. Good sign!`),
      L('Хтось загубив червоний кранець біля пірсу.', `Someone lost a red fender by the pier.`),
    ];
    if (d?.reports[0]) pool.push(L(`${d.reports[0].zone}: ${d.reports[0].name.toLowerCase()} іде косяком, поспішайте!`, `${d.reports[0].zone}: ${d.reports[0].name.toLowerCase()} running in schools, hurry!`));
    if (d?.stormSoon) pool.push(L('Барометр падає. Усім суднам — до порту!', `The glass is falling. All vessels — back to port!`), L('Хвиля росте, беру риф і йду додому.', `The sea is building, taking a reef and heading home.`));
    if (w === L('Портова служба', `Harbour control`)) pool.push(L(`Вітер ${d?.now.bf ?? 3} балів. Причал вільний, швартуйтесь лівим бортом.`, `Wind force ${d?.now.bf ?? 3}. The berth is free, moor port side to.`));
    this.chatLog.push({ who: w, text: pool[Math.floor(Math.random() * pool.length)], at: this.t });
    if (this.chatLog.length > 12) this.chatLog.shift();
  }

  // ── текстури ──
  private makeNoise(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 576;
    c.height = 416;
    const x = c.getContext('2d')!;
    const img = x.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 80 + Math.random() * 140;
      img.data[i] = v * 0.7;
      img.data[i + 1] = v;
      img.data[i + 2] = v * 0.8;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  private faceTex(): THREE.CanvasTexture {
    // кремова панель з підписами (ширина 0.86 × 0.32 м → 860×320)
    const c = document.createElement('canvas');
    c.width = 860;
    c.height = 320;
    const x = c.getContext('2d')!;
    x.fillStyle = '#efe4c8';
    x.fillRect(0, 0, 860, 320);
    x.fillStyle = '#4a3622';
    x.textAlign = 'center';
    const px = (lx: number) => 430 + lx * 1000;
    const py = (ly: number) => 160 - ly * 1000;
    x.font = '800 15px Manrope, sans-serif';
    PRESET_LABEL.forEach((l, i) => x.fillText(l, px(0.07 + i * 0.062), py(0.012)));
    x.font = '700 14px Manrope, sans-serif';
    x.fillText(L('ЖИВЛ.', `PWR`), px(0.075), py(-0.118));
    x.fillText(L('ГУЧНІСТЬ', `VOLUME`), px(0.19), py(-0.136));
    x.fillText(L('НАСТРОЙКА', `TUNING`), px(0.335), py(-0.143));
    // шкала гучності
    for (let i = 0; i <= 10; i++) {
      const a = -2.3 + (i / 10) * 4.6 - Math.PI / 2;
      x.fillRect(px(0.19) + Math.cos(a) * 40 - 1, py(-0.08) + Math.sin(a) * 40 - 1, 3, 3);
    }
    x.font = '800 18px Unbounded, Manrope, sans-serif';
    x.textAlign = 'left';
    x.fillStyle = '#7a2e22';
    x.fillText(L('ШТОРМ-М1', `STORM-M1`), 30, 312);
    x.font = '600 13px Manrope, sans-serif';
    x.fillStyle = '#4a3622';
    x.fillText(L('морський приймач · УКХ 156–163 МГц', `marine receiver · VHF 156–163 MHz`), 150, 312);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  private scaleTex(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 50;
    const x = c.getContext('2d')!;
    x.fillStyle = '#f2e6c4';
    x.fillRect(0, 0, 320, 50);
    x.fillStyle = '#4a3a24';
    for (let i = 0; i <= 70; i++) x.fillRect(10 + i * 4.285, i % 10 ? 34 : 24, 1, i % 10 ? 10 : 20);
    x.font = 'bold 12px sans-serif';
    x.textAlign = 'center';
    for (let i = 0; i <= 7; i++) x.fillText(String(156 + i), 10 + i * 42.85, 16);
    // станції — червоні крапки
    x.fillStyle = '#c8352b';
    for (const s of RADIO_STATIONS) x.fillRect(10 + s.freq * 300 - 2, 44, 4, 4);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
}

function roundBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -d / 2);
  return g;
}

function roundRect(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
  x.beginPath();
  x.roundRect(px, py, w, h, r);
}

function wrap(x: CanvasRenderingContext2D, text: string, px: number, py: number, maxW: number, lh: number, maxLines: number) {
  const words = text.split(' ');
  let line = '';
  let n = 0;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (x.measureText(t).width > maxW && line) {
      x.fillText(line, px, py + n * lh);
      n++;
      line = w;
      if (n >= maxLines) return;
    } else line = t;
  }
  if (line) x.fillText(line, px, py + n * lh);
}

function weatherIcon(x: CanvasRenderingContext2D, cx: number, cy: number, s: string, t: number) {
  const sun = (ox: number, oy: number, r: number) => {
    x.fillStyle = AMBER;
    x.beginPath();
    x.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = AMBER;
    x.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + t * 0.3;
      x.beginPath();
      x.moveTo(cx + ox + Math.cos(a) * (r + 5), cy + oy + Math.sin(a) * (r + 5));
      x.lineTo(cx + ox + Math.cos(a) * (r + 12), cy + oy + Math.sin(a) * (r + 12));
      x.stroke();
    }
  };
  const cloud = (ox: number, oy: number, k: number, col: string) => {
    x.fillStyle = col;
    x.beginPath();
    x.arc(cx + ox - 18 * k, cy + oy + 4 * k, 15 * k, 0, Math.PI * 2);
    x.arc(cx + ox + 2 * k, cy + oy - 8 * k, 20 * k, 0, Math.PI * 2);
    x.arc(cx + ox + 22 * k, cy + oy + 4 * k, 14 * k, 0, Math.PI * 2);
    x.rect(cx + ox - 18 * k, cy + oy + 4 * k, 40 * k, 15 * k);
    x.fill();
  };
  if (s === 'calm') sun(0, 0, 20);
  else if (s === 'breeze') {
    sun(-16, -10, 15);
    cloud(10, 10, 0.9, '#cfe9dc');
  } else if (s === 'wind') {
    cloud(0, -4, 1, '#a8c9bb');
    x.strokeStyle = GREEN;
    x.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const o = ((t * 40 + i * 25) % 60) - 30;
      x.beginPath();
      x.moveTo(cx - 36 + o, cy + 26 + i * 8);
      x.lineTo(cx + 4 + o, cy + 26 + i * 8);
      x.stroke();
    }
  } else {
    cloud(0, -6, 1.05, '#6f8a80');
    x.fillStyle = Math.floor(t * 3) % 3 === 0 ? '#fff6c0' : AMBER;
    x.beginPath();
    x.moveTo(cx + 2, cy + 10);
    x.lineTo(cx - 10, cy + 32);
    x.lineTo(cx, cy + 30);
    x.lineTo(cx - 6, cy + 48);
    x.lineTo(cx + 12, cy + 24);
    x.lineTo(cx + 2, cy + 26);
    x.closePath();
    x.fill();
  }
}

function fishIcon(x: CanvasRenderingContext2D, cx: number, cy: number, k: number, t: number) {
  x.save();
  x.translate(cx, cy + Math.sin(t * 3) * 2);
  x.scale(k, k);
  x.fillStyle = GREEN;
  x.beginPath();
  x.ellipse(0, 0, 18, 9, 0, 0, Math.PI * 2);
  x.fill();
  x.beginPath();
  x.moveTo(14, 0);
  x.lineTo(26, -9);
  x.lineTo(26, 9);
  x.closePath();
  x.fill();
  x.fillStyle = '#081210';
  x.beginPath();
  x.arc(-9, -2, 2.4, 0, Math.PI * 2);
  x.fill();
  x.restore();
}
