import * as THREE from 'three';
import { DECK_Y, HOUSE, STAIR } from './yachtLayout';

// ─────────────────────────────────────────────────────────────
// Двері каюти (компаньйон): дві тикові стулки на петлях у прорізі трапа.
// E зовні (у кокпіті) або зсередини (на трапі/в салоні) — відчинити/зачинити.
// Відчинені стулки складаються до передньої стінки рубки. Червоний засув-ричаг
// видно з обох боків: горизонтально — зачинено, вертикально — відчинено.
// У шторм відчинені двері пропускають воду з палуби в салон і трюм.
// ─────────────────────────────────────────────────────────────

const W = STAIR.x; // ширина стулки
const H = HOUSE.top - DECK_Y - 0.05;
const T = 0.035;
const PIVOT_Z = HOUSE.z0 - 0.045;
const OPEN_A = Math.PI - 0.2;

export class CabinDoor {
  readonly group = new THREE.Group();
  private leaves: THREE.Group[] = [];
  private levers: THREE.Mesh[] = [];
  private a = OPEN_A;

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
    const teak = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.7 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x5e3c22, roughness: 0.75 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 0.85 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd0342c, roughness: 0.45 });
    for (const s of [-1, 1]) {
      // s = -1 — ліва стулка (петля на x = -W), тягнеться до центру (+x)
      const pivot = new THREE.Group();
      pivot.position.set(s * W, DECK_Y + 0.03 + H / 2, PIVOT_Z);
      this.group.add(pivot);
      const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
        const mm = new THREE.Mesh(geo, m);
        mm.position.set(-s * x, y, z);
        mm.castShadow = true;
        mm.receiveShadow = true;
        pivot.add(mm);
        return mm;
      };
      const cx = W / 2 - 0.005;
      add(new THREE.BoxGeometry(W - 0.01, H, T), teak, cx, 0, 0);
      // рамка (обидва боки)
      for (const z of [-T / 2 - 0.006, T / 2 + 0.006]) {
        add(new THREE.BoxGeometry(W - 0.01, 0.05, 0.012), frame, cx, H / 2 - 0.025, z);
        add(new THREE.BoxGeometry(W - 0.01, 0.05, 0.012), frame, cx, -H / 2 + 0.025, z);
        add(new THREE.BoxGeometry(0.05, H, 0.012), frame, 0.03, 0, z);
        add(new THREE.BoxGeometry(0.05, H, 0.012), frame, W - 0.04, 0, z);
        // вентиляційні жалюзі
        for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(W - 0.14, 0.014, 0.01), frame, cx, H / 2 - 0.1 - i * 0.04, z);
      }
      // латунні петлі
      for (const y of [H / 2 - 0.1, -H / 2 + 0.1]) add(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8), brass, 0, y, -T / 2 - 0.01);
      // латунна ручка з обох боків біля середини
      for (const z of [-1, 1]) {
        const h = add(new THREE.TorusGeometry(0.035, 0.008, 6, 12, Math.PI), brass, W - 0.07, -0.05, z * (T / 2 + 0.02));
        h.rotation.set(0, z > 0 ? 0 : Math.PI, Math.PI / 2 * -s);
      }
      // червоний засув-ричаг (з обох боків), обертається навколо своєї осі
      for (const z of [-1, 1]) {
        const base = add(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10), brass, W - 0.09, 0.07, z * (T / 2 + 0.01));
        base.rotation.x = Math.PI / 2;
        const lv = add(new THREE.BoxGeometry(0.16, 0.026, 0.02), red, W - 0.09, 0.07, z * (T / 2 + 0.03));
        this.levers.push(lv);
      }
      this.leaves.push(pivot);
    }
    this.apply();
  }

  private apply() {
    this.leaves[0].rotation.y = this.a; // ліва
    this.leaves[1].rotation.y = -this.a; // права
    // засув: зачинено (a≈0) — поперек, відчинено — вертикально
    const k = Math.min(1, this.a / 0.6);
    for (const lv of this.levers) lv.rotation.z = (Math.PI / 2) * k;
  }

  update(dt: number, open: boolean) {
    const target = open ? OPEN_A : 0;
    if (Math.abs(target - this.a) < 1e-3) return;
    this.a += (target - this.a) * (1 - Math.exp(-dt * 7));
    this.apply();
  }
}
