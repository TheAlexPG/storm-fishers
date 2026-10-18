import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Момент улову: риба вилітає з води дугою до рибалки й б'ється
// хвостом. Простий низькополігональний силует у кольорах виду.
// ─────────────────────────────────────────────────────────────

const COLORS: Record<string, [number, number]> = {
  hamsa: [0x6f8fa6, 0xe6eef2],
  balyk: [0x4f7896, 0xe9f0f2],
  leschak: [0x8a7458, 0xe8dccb],
  plyotka: [0x5d6670, 0xe9e6e0],
  makrel: [0x2f6f7a, 0xeef2ee],
  sula: [0x3f4d5a, 0xcfd6da],
  krap: [0xc8543c, 0xf2cfa8],
  forel: [0x5f7488, 0xf1d6c8],
  lusk: [0x7a7454, 0xece6cf],
  shoraga: [0x5a5246, 0xeee8dc],
  tunets: [0x24466e, 0xd9e2ea],
  akula: [0x6d7b86, 0xe8ecee],
};

export class FishJump {
  private fish = new THREE.Group();
  private body: THREE.Mesh;
  private tail: THREE.Mesh;
  private topMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.2, flatShading: true });
  private bellyMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.2, flatShading: true });
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private t = -1;
  private dur = 0.9;
  /** стрибок під час боротьби: виринає й пірнає назад (без лежання на палубі) */
  private leap = false;

  constructor(scene: THREE.Scene) {
    // тіло: сплюснутий ромбоїд з двох конусів (верх темний, черево світле)
    const g = new THREE.SphereGeometry(1, 8, 6);
    g.scale(0.28, 0.42, 1);
    this.body = new THREE.Mesh(g, [this.topMat, this.bellyMat]);
    // дві групи матеріалів: верхня половина вершин — темна
    g.clearGroups();
    const idx = g.index!;
    const pos = g.attributes.position;
    const top: number[] = [], bot: number[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      const y = (pos.getY(idx.getX(i)) + pos.getY(idx.getX(i + 1)) + pos.getY(idx.getX(i + 2))) / 3;
      (y > -0.05 ? top : bot).push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    }
    g.setIndex([...top, ...bot]);
    g.addGroup(0, top.length, 0);
    g.addGroup(top.length, bot.length, 1);
    this.fish.add(this.body);
    const tg = new THREE.ConeGeometry(0.42, 0.55, 3);
    tg.rotateX(Math.PI / 2);
    tg.scale(0.25, 1, 1);
    this.tail = new THREE.Mesh(tg, this.topMat);
    this.tail.position.z = -1.1;
    this.fish.add(this.tail);
    this.fish.visible = false;
    scene.add(this.fish);
  }

  /** запустити: з води (from) до рук (to); kg — розмір */
  start(speciesId: string, kg: number, from: THREE.Vector3, to: THREE.Vector3, leap = false) {
    this.leap = leap;
    const [top, belly] = COLORS[speciesId] ?? COLORS.balyk;
    this.topMat.color.setHex(top);
    this.bellyMat.color.setHex(belly);
    // довжина ~ кубічний корінь ваги
    const len = THREE.MathUtils.clamp(0.24 * Math.cbrt(kg) + 0.2, 0.3, 1.1);
    this.fish.scale.setScalar(len);
    this.from.copy(from);
    this.to.copy(to);
    this.dur = 0.75 + len * 0.4;
    this.t = 0;
    this.fish.visible = true;
  }

  /** true — зараз летить (сплеск на вильоті кличе main) */
  update(dt: number, time: number): boolean {
    if (this.t < 0) return false;
    this.t += dt;
    const u = this.t / this.dur;
    if (u >= 1.6) {
      this.fish.visible = false;
      this.t = -1;
      return false;
    }
    if (this.leap && u >= 1) {
      this.fish.visible = false;
      this.t = -1;
      return false;
    }
    const k = Math.min(1, u);
    const e = 1 - Math.pow(1 - k, 2);
    const p = this.fish.position.lerpVectors(this.from, this.to, e);
    p.y += Math.sin(k * Math.PI) * 1.4;
    // дивиться по траєкторії, б'є хвостом
    const dx = this.to.x - this.from.x, dz = this.to.z - this.from.z;
    this.fish.rotation.set(Math.cos(k * Math.PI) * 0.9, Math.atan2(dx, dz), Math.sin(time * 30) * 0.25);
    this.tail.rotation.y = Math.sin(time * 34) * 0.7;
    // на палубі: лежить і ще трохи б'ється, тоді зникає (у трюм)
    if (u > 1) {
      this.fish.rotation.x = 0;
      this.fish.rotation.z = Math.PI / 2 + Math.sin(time * 25) * 0.2 * (1.6 - u);
      if (u > 1.4) this.fish.scale.multiplyScalar(0.85);
    }
    return true;
  }
}
