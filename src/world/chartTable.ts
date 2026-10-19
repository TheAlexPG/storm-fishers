import * as THREE from 'three';
import { SOLE_Y } from './yachtLayout';

// ─────────────────────────────────────────────────────────────
// Штурманський стіл: паперова лоція лежить на столі в салоні (текстура —
// та сама карта, що й MapView). E — схилитися над столом: камера дивиться
// згори, миша водить олівцем, ЛКМ — точка маршруту, ПКМ — стерти, E — встати.
// Північ карти — до борту (від гравця), схід — до носа.
// ─────────────────────────────────────────────────────────────

/** локальні координати яхти: центр карти на стільниці */
export const CHART_CENTER = new THREE.Vector3(0.83, SOLE_Y + 0.79, 0.95);
const CW = 1100;
const CH = 776; // співвідношення світу карти 1900×1340
const PW = 0.6; // уздовж z (схід — нос)
const PH = (PW * CH) / CW; // уздовж x (північ — борт)

export class ChartTable {
  readonly group = new THREE.Group();
  readonly canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private pencil = new THREE.Group();
  /** курсор олівця 0..1 (u — схід, v — південь) */
  u = 0.5;
  v = 0.5;
  private redrawT = 0;

  constructor(parent: THREE.Object3D) {
    this.canvas.width = CW;
    this.canvas.height = CH;
    const x = this.canvas.getContext('2d')!;
    x.fillStyle = '#efe6d4';
    x.fillRect(0, 0, CW, CH);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.9 }));
    // площина лежить: +x площини → нос (+z), +y площини (верх карти) → борт (+x)
    paper.rotation.set(-Math.PI / 2, -Math.PI / 2, 0, 'YXZ');
    paper.receiveShadow = true;
    this.group.add(paper);
    // латунні притискачі по кутах
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.8 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.012, 10), brass);
      w.position.set((sx * PH) / 2 - sx * 0.01, 0.006, (sz * PW) / 2 - sz * 0.01);
      this.group.add(w);
    }
    // паралельна лінійка й циркуль — для вигляду
    const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.36), new THREE.MeshStandardMaterial({ color: 0xd9e4e8, roughness: 0.3, transparent: true, opacity: 0.7 }));
    ruler.position.set(-PH / 2 - 0.05, 0.004, 0.05);
    ruler.rotation.y = 0.12;
    this.group.add(ruler);
    // олівець (вістрям у точку курсору)
    const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.15, 6), new THREE.MeshStandardMaterial({ color: 0xe0a526, roughness: 0.6 }));
    wood.position.y = 0.09;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.02, 6), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
    tip.rotation.x = Math.PI;
    tip.position.y = 0.01;
    const lean = new THREE.Group();
    lean.add(wood, tip);
    lean.rotation.set(0.35, 0, -0.35);
    this.pencil.add(lean);
    this.pencil.visible = false;
    this.group.add(this.pencil);
    this.group.position.copy(CHART_CENTER);
    parent.add(this.group);
  }

  /** олівець видно лише коли гравець над столом */
  setActive(on: boolean) {
    this.pencil.visible = on;
  }

  /** рух миші → олівець по карті (dx, dy — пікселі) */
  moveCursor(dx: number, dy: number) {
    this.u = THREE.MathUtils.clamp(this.u + dx * 0.0011, 0.01, 0.99);
    this.v = THREE.MathUtils.clamp(this.v + dy * 0.0011 * (CW / CH), 0.01, 0.99);
    this.placePencil();
  }

  /** поставити олівець на світову точку (наприклад, на яхту) */
  setCursorUV(u: number, v: number) {
    this.u = u;
    this.v = v;
    this.placePencil();
  }

  private placePencil() {
    // u (схід) → +z стола; v (південь) → −x стола (до гравця)
    this.pencil.position.set(PH / 2 - this.v * PH, 0, -PW / 2 + this.u * PW);
  }

  /** чи пора перемалювати (раз на ~1 с; частіше, коли над столом) */
  due(dt: number, active: boolean): boolean {
    this.redrawT -= dt;
    if (this.redrawT > 0) return false;
    this.redrawT = active ? 0.25 : 1.5;
    return true;
  }

  markDirty() {
    this.redrawT = 0;
  }

  textureUpdated() {
    this.tex.needsUpdate = true;
  }

  get size(): [number, number] {
    return [CW, CH];
  }

  /** точка, куди дивиться камера над столом, і де стоїть голова (локаль яхти) */
  static readonly EYE = new THREE.Vector3(CHART_CENTER.x - 0.5, CHART_CENTER.y + 0.62, CHART_CENTER.z);
}
