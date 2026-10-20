import * as THREE from 'three';
import { L } from '../core/i18n';
import { SOLE_Y } from './yachtLayout';

// ─────────────────────────────────────────────────────────────
// Камбуз: емальований чайник на окремому кардановому пальнику праворуч від
// плити, чайна тацю (кухлі, бляшанка чаю, цукорниця, лимон), книга рецептів
// на стільниці й пательня, що з'являється на плиті під час готування.
// Пара — дешеві Points. Кухоль у руках від першої особи — дочірній камері.
// ─────────────────────────────────────────────────────────────

const S = SOLE_Y;
const TOP = S + 0.92; // стільниця камбуза
/** локаль яхти: чайник, пательня, книга — для станцій і погляду */
export const KETTLE_POS = new THREE.Vector3(-0.84, TOP + 0.02, 0.84);
export const PAN_POS = new THREE.Vector3(-0.82, S + 0.97, 1.32);
/** куди дивитись під час чаю: між чайником і кухлем, трохи нижче (панель міні-гри — внизу екрана) */
export const TEA_LOOK = new THREE.Vector3(-0.73, TOP - 0.16, 0.8);
export const BOOK_POS = new THREE.Vector3(-1.02, TOP + 0.12, 0.03);
/** кухоль, у який наливають: на краю стільниці поруч із чайником */
const MUG_POS = new THREE.Vector3(-0.62, TOP, 0.74);

function lathe(points: Array<[number, number]>, seg = 18) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

function steamTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** пара: частинки піднімаються від точки-джерела й тануть */
class Steam {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private life: Float32Array;
  private vel: Float32Array;
  private mat: THREE.PointsMaterial;
  rate = 0;
  readonly src = new THREE.Vector3();
  constructor(parent: THREE.Object3D, tex: THREE.Texture, n = 28, size = 0.06) {
    this.pos = new Float32Array(n * 3);
    this.life = new Float32Array(n).fill(-1);
    this.vel = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ map: tex, size, transparent: true, depthWrite: false, opacity: 0.55, color: 0xf6f8fa, sizeAttenuation: true });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    parent.add(this.points);
  }
  update(dt: number) {
    const n = this.life.length;
    let spawn = this.rate * dt * 30;
    for (let i = 0; i < n; i++) {
      if (this.life[i] < 0) {
        if (spawn > Math.random()) {
          spawn -= 1;
          this.life[i] = 1;
          this.pos[i * 3] = this.src.x + (Math.random() - 0.5) * 0.02;
          this.pos[i * 3 + 1] = this.src.y;
          this.pos[i * 3 + 2] = this.src.z + (Math.random() - 0.5) * 0.02;
          this.vel[i * 3] = (Math.random() - 0.5) * 0.06;
          this.vel[i * 3 + 1] = 0.14 + Math.random() * 0.12;
          this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.06;
        } else {
          this.pos[i * 3 + 1] = -999;
        }
        continue;
      }
      this.life[i] -= dt * 0.9;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -999;
    }
    this.mat.opacity = 0.25 + 0.35 * Math.min(1, this.rate);
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Galley {
  readonly group = new THREE.Group();
  /** для підсвітки й станцій */
  readonly kettle = new THREE.Group();
  readonly book = new THREE.Group();
  readonly stoveTop = new THREE.Group();
  private kettleTilt = new THREE.Group();
  private lid: THREE.Mesh;
  private flame: THREE.Mesh;
  private flameMat: THREE.MeshBasicMaterial;
  private mugTea: THREE.Mesh;
  private pan = new THREE.Group();
  private panFlame: THREE.Mesh;
  private panFood: THREE.Mesh;
  private panFoodMat: THREE.MeshStandardMaterial;
  private panSoup: THREE.Mesh;
  private spoon: THREE.Mesh;
  private steamKettle: Steam;
  private steamPan: Steam;
  private steamHand: Steam;
  private handMug = new THREE.Group();
  private handT = 0;
  private flameOn = false;
  private boil = 0;
  /** кут нахилу чайника при наливанні (0 — стоїть) */
  pourTilt = 0;
  private stirT = 0;
  private stream: THREE.Mesh;
  private _a = new THREE.Vector3();
  private _b = new THREE.Vector3();
  private flipT = 0;

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
    const tex = steamTex();
    const enamel = new THREE.MeshStandardMaterial({ color: 0xc8453a, roughness: 0.35, metalness: 0.05 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 0.4 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c0c6, roughness: 0.3, metalness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.5 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.6 });

    // ── кардановий пальник для чайника (кільце на двох шарнірах) ──
    const burner = new THREE.Group();
    burner.position.copy(KETTLE_POS);
    burner.position.y = TOP;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.03, 18), dark);
    base.position.y = 0.015;
    burner.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.006, 6, 20), steel);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.04;
    burner.add(ring);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 6), steel);
      post.position.set(0, 0.03, s * 0.08);
      burner.add(post);
    }
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0x5aa8ff, transparent: true, opacity: 0.85 });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.03, 12, 1, true), this.flameMat);
    this.flame.position.y = 0.045;
    this.flame.visible = false;
    burner.add(this.flame);
    this.group.add(burner);

    // ── чайник: емаль, кремова кришка, носик, дужка ──
    this.kettle.position.copy(KETTLE_POS).setY(TOP + 0.04);
    this.kettle.add(this.kettleTilt);
    const body = new THREE.Mesh(lathe([[0, 0], [0.07, 0], [0.078, 0.02], [0.075, 0.07], [0.06, 0.1], [0.035, 0.115], [0, 0.115]]), enamel);
    body.castShadow = true;
    this.kettleTilt.add(body);
    this.lid = new THREE.Mesh(lathe([[0, 0], [0.036, 0], [0.03, 0.012], [0.008, 0.016], [0.012, 0.03], [0, 0.032]], 14), cream);
    this.lid.position.y = 0.112;
    this.kettleTilt.add(this.lid);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.016, 0.1, 8), enamel);
    spout.position.set(0.075, 0.07, 0);
    spout.rotation.z = -0.95;
    this.kettleTilt.add(spout);
    const whistle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.01, 0.018, 8), steel);
    whistle.position.set(0.112, 0.1, 0);
    whistle.rotation.z = -0.95;
    this.kettleTilt.add(whistle);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.007, 6, 16, Math.PI), dark);
    handle.position.set(0, 0.11, 0);
    this.kettleTilt.add(handle);
    // носиком — до кухля на краю стільниці
    this.kettle.rotation.y = Math.atan2(-(MUG_POS.z - KETTLE_POS.z), MUG_POS.x - KETTLE_POS.x);
    this.group.add(this.kettle);
    this.steamKettle = new Steam(this.group, tex, 30, 0.07);
    // струмінь окропу з носика в кухоль (видно, коли наливаєш)
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 1, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0xdff1ff, transparent: true, opacity: 0.7, roughness: 0.05 }));
    this.stream.visible = false;
    this.group.add(this.stream);

    // ── чайна таця: два кухлі, бляшанка чаю, цукорниця, пів лимона ──
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.32), wood);
    tray.position.set(-0.78, TOP + 0.006, 0.14);
    this.group.add(tray);
    const mugMat = [new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.4 }), new THREE.MeshStandardMaterial({ color: 0x24878c, roughness: 0.4 })];
    const mug = (m: THREE.Material) => {
      const g = new THREE.Group();
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.075, 14, 1, true), m);
      (cup.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      cup.position.y = 0.0375;
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.028, 14), m);
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.y = 0.002;
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 12), m);
      h.position.set(0.036, 0.04, 0);
      g.add(cup, bottom, h);
      return g;
    };
    const m1 = mug(mugMat[0]);
    m1.position.copy(MUG_POS).setY(TOP);
    m1.rotation.y = -0.6;
    this.group.add(m1);
    // чай у кухлі (диск, що підіймається)
    this.mugTea = new THREE.Mesh(new THREE.CircleGeometry(0.03, 14), new THREE.MeshStandardMaterial({ color: 0x8a4b17, roughness: 0.15, metalness: 0.1 }));
    this.mugTea.rotation.x = -Math.PI / 2;
    this.mugTea.position.copy(MUG_POS).setY(TOP + 0.004);
    this.mugTea.visible = false;
    this.group.add(this.mugTea);
    const m2 = mug(mugMat[1]);
    m2.position.set(-0.86, TOP + 0.012, 0.22);
    m2.rotation.y = 2.2;
    this.group.add(m2);
    const tin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 14), new THREE.MeshStandardMaterial({ color: 0x2f5d62, roughness: 0.35, metalness: 0.6 }));
    tin.position.set(-0.9, TOP + 0.057, 0.05);
    this.group.add(tin);
    const tinLid = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 14), new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 0.8 }));
    tinLid.position.set(-0.9, TOP + 0.108, 0.05);
    this.group.add(tinLid);
    const sugar = new THREE.Mesh(lathe([[0, 0], [0.03, 0], [0.034, 0.03], [0.026, 0.06], [0, 0.062]], 14), cream);
    sugar.position.set(-0.86, TOP + 0.012, -0.04);
    this.group.add(sugar);
    const lemon = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2d43a, roughness: 0.6 }));
    lemon.rotation.x = Math.PI;
    lemon.position.set(-0.7, TOP + 0.04, 0.24);
    this.group.add(lemon);
    const lemonCut = new THREE.Mesh(new THREE.CircleGeometry(0.027, 12), new THREE.MeshStandardMaterial({ color: 0xfbf2a8, roughness: 0.7 }));
    lemonCut.rotation.x = -Math.PI / 2;
    lemonCut.position.set(-0.7, TOP + 0.0405, 0.24);
    this.group.add(lemonCut);

    // ── книга рецептів: стоїть корінцем до салону, з закладкою ──
    this.book.position.copy(BOOK_POS);
    const cover = new THREE.MeshStandardMaterial({ color: 0x8e2f25, roughness: 0.7 });
    const spineTex = (() => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 256;
      const x = c.getContext('2d')!;
      x.fillStyle = '#8e2f25';
      x.fillRect(0, 0, 64, 256);
      x.fillStyle = '#e6c46a';
      x.fillRect(0, 22, 64, 6);
      x.fillRect(0, 228, 64, 6);
      x.save();
      x.translate(40, 128);
      x.rotate(-Math.PI / 2);
      x.font = 'bold 26px Georgia, serif';
      x.textAlign = 'center';
      x.fillText(L('РЕЦЕПТИ', 'RECIPES'), 0, 0);
      x.restore();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const spineMat = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.7 });
    const pages = new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 0.9 });
    // box faces: +x, -x, +y, -y, +z, -z — корінець до салону (+x)
    const bk = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.24, 0.05), [spineMat, pages, pages, pages, cover, cover]);
    bk.castShadow = true;
    this.book.add(bk);
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.06, 0.012), new THREE.MeshStandardMaterial({ color: 0x24878c }));
    ribbon.position.set(0.05, -0.14, 0);
    this.book.add(ribbon);
    this.group.add(this.book);

    // ── пательня на плиті (лише коли готуєш) ──
    this.pan.position.copy(PAN_POS);
    const panBody = new THREE.Mesh(lathe([[0, 0], [0.095, 0], [0.105, 0.03], [0.108, 0.035], [0, 0.035]], 20), dark);
    this.pan.add(panBody);
    const panHandle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.014, 0.024), wood);
    panHandle.position.set(0.17, 0.03, 0);
    this.pan.add(panHandle);
    this.panFoodMat = new THREE.MeshStandardMaterial({ color: 0xd9a0a0, roughness: 0.55 });
    this.panFood = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6), this.panFoodMat);
    this.panFood.scale.set(0.07, 0.02, 0.03);
    this.panFood.position.y = 0.04;
    this.pan.add(this.panFood);
    this.panSoup = new THREE.Mesh(new THREE.CircleGeometry(0.09, 18), new THREE.MeshStandardMaterial({ color: 0xd8b26a, roughness: 0.2 }));
    this.panSoup.rotation.x = -Math.PI / 2;
    this.panSoup.position.y = 0.03;
    this.pan.add(this.panSoup);
    this.spoon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.2), wood);
    this.spoon.position.set(0, 0.08, 0);
    this.spoon.rotation.x = 0.9;
    this.pan.add(this.spoon);
    this.pan.visible = false;
    this.stoveTop.add(this.pan);
    // синє полум'я конфорки під пательнею
    this.panFlame = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 18), this.flameMat);
    this.panFlame.rotation.x = Math.PI / 2;
    this.panFlame.position.copy(PAN_POS).setY(S + 0.962);
    this.panFlame.visible = false;
    this.stoveTop.add(this.panFlame);
    this.group.add(this.stoveTop);
    this.steamPan = new Steam(this.group, tex, 26, 0.08);
    this.steamPan.src.copy(PAN_POS).setY(PAN_POS.y + 0.06);

    // ── кухоль у руках (від першої особи) ──
    const hm = mug(new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.4 }));
    const tea = new THREE.Mesh(new THREE.CircleGeometry(0.03, 14), new THREE.MeshStandardMaterial({ color: 0x7a3f12, roughness: 0.15 }));
    tea.rotation.x = -Math.PI / 2;
    tea.position.y = 0.065;
    hm.add(tea);
    hm.scale.setScalar(1.6);
    this.handMug.add(hm);
    this.handMug.visible = false;
    this.steamHand = new Steam(this.handMug, tex, 18, 0.05);
    this.steamHand.src.set(0, 0.12, 0);
  }

  // ── чайник ──
  setFlame(on: boolean) {
    this.flameOn = on;
    this.flame.visible = on;
  }
  /** 0..1 — від теплого до кипіння (кришка підстрибує, пара густішає) */
  setBoil(b: number) {
    this.boil = b;
  }
  /** рівень чаю в кухлі на таці (0 — порожній, ховається) */
  setMug(level: number, color = 0x8a4b17) {
    this.mugTea.visible = level > 0.02;
    this.mugTea.position.y = TOP + 0.004 + 0.066 * Math.min(1, level);
    (this.mugTea.material as THREE.MeshStandardMaterial).color.setHex(color);
  }

  // ── пательня ──
  /** soup — казан з юшкою (рідина), інакше — шматок риби на пательні */
  setPan(on: boolean, soup = false) {
    this.pan.visible = on;
    this.panFlame.visible = on;
    this.panSoup.visible = soup;
    this.panFood.visible = !soup;
    this.spoon.visible = soup;
    if (!on) this.steamPan.rate = 0;
  }
  /** готовність 0..1.3: сира → золотава → підгоріла */
  setDone(d: number) {
    const raw = new THREE.Color(0xd9a0a0), gold = new THREE.Color(0xc9862e), burnt = new THREE.Color(0x3a2414);
    const c = d < 1 ? raw.lerp(gold, d) : gold.lerp(burnt, Math.min(1, (d - 1) / 0.3));
    this.panFoodMat.color.copy(c);
    (this.panSoup.material as THREE.MeshStandardMaterial).color.copy(new THREE.Color(0xe9d8a8).lerp(new THREE.Color(0xb98a3c), Math.min(1, d)));
  }
  setPanSteam(r: number) {
    this.steamPan.rate = r;
  }
  stir() {
    this.stirT = 0.4;
  }
  flip() {
    this.flipT = 0.5;
  }

  /** кухоль у руках на кілька секунд (дитина камери) */
  showHandMug(camera: THREE.Camera, sec = 4) {
    if (this.handMug.parent !== camera) camera.add(this.handMug);
    this.handMug.position.set(0.16, -0.17, -0.38);
    this.handMug.rotation.set(0.15, -0.4, 0);
    this.handMug.visible = true;
    this.handT = sec;
  }

  update(dt: number, t: number) {
    // кришка тарахтить, пара з носика
    const b = this.flameOn ? this.boil : Math.max(0, this.boil - dt * 0.2);
    this.lid.position.y = 0.112 + (b > 0.85 ? Math.abs(Math.sin(t * 38)) * 0.006 * (b - 0.85) * 6 : 0);
    this.kettleTilt.rotation.z = -this.pourTilt;
    this.kettle.updateMatrixWorld();
    this.steamKettle.src.set(0.112, 0.11, 0);
    this.kettle.localToWorld(this.steamKettle.src);
    this.group.worldToLocal(this.steamKettle.src);
    this.steamKettle.rate = b > 0.35 ? (b - 0.35) * 2 : this.pourTilt > 0.4 ? 0.6 : 0;
    // струмінь: від кінчика носика вниз у кухоль
    this.stream.visible = this.pourTilt > 0.55;
    if (this.stream.visible) {
      const a = this._a.set(0.118, 0.105, 0);
      this.kettleTilt.localToWorld(a);
      this.group.worldToLocal(a);
      const b2 = this._b.copy(MUG_POS).setY(TOP + 0.06);
      b2.x += (Math.random() - 0.5) * 0.004;
      this.stream.position.copy(a).add(b2).multiplyScalar(0.5);
      this.stream.scale.set(1, a.distanceTo(b2), 1);
      this.stream.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b2.sub(a).normalize());
    }
    this.steamKettle.update(dt);
    this.flameMat.opacity = 0.7 + Math.sin(t * 40) * 0.15;
    // пательня: помішування / перевертання
    if (this.stirT > 0) {
      this.stirT -= dt;
      this.spoon.rotation.y = Math.sin(this.stirT * 18) * 0.8;
    }
    if (this.flipT > 0) {
      this.flipT -= dt;
      const k = 1 - this.flipT / 0.5;
      this.panFood.position.y = 0.04 + Math.sin(k * Math.PI) * 0.12;
      this.panFood.rotation.x = k * Math.PI;
    }
    this.steamPan.update(dt);
    if (this.handT > 0) {
      this.handT -= dt;
      this.handMug.position.y = -0.17 + Math.sin(t * 1.6) * 0.006 - (this.handT < 0.5 ? (0.5 - this.handT) * 0.4 : 0);
      this.steamHand.rate = 0.6;
      this.steamHand.update(dt);
      if (this.handT <= 0) this.handMug.visible = false;
    }
  }
}
