import * as THREE from 'three';
import { DECK_Y, HOUSE, RIG, SOLE_Y, sheerY, hullHalfWidth } from './yachtLayout';
import { glowTex } from './textures';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// Світло яхти з двома вимикачами: «Каюта» (щиток над штурманським
// столом) і «Палуба» (на лаві кокпіту біля рубки).
// Кожен — три положення: Авто (як раніше: вночі/у шторм) → Увімк → Вимк.
// Палуба: ходові вогні (червоний/зелений/кормовий, топовий — під мотором,
// якірний — на якорі), ліхтарі-апгрейди й палубний прожектор на краспиці.
// Ходові — лише світні меші й ореоли (без PointLight: кількість світел у
// сцені стала, шейдери не перекомпільовуються).
// ─────────────────────────────────────────────────────────────

/** 0 — авто, 1 — увімкнено, 2 — вимкнено */
export type LightMode = 0 | 1 | 2;

export const nextMode = (m: LightMode): LightMode => ((m + 1) % 3) as LightMode;

export function modeLabel(m: LightMode): string {
  return m === 0 ? L('авто', 'auto') : m === 1 ? L('увімкнено', 'on') : L('вимкнено', 'off');
}

/** локальні координати яхти: щиток у салоні й вимикач у кокпіті */
export const CABIN_SWITCH_POS = new THREE.Vector3(1.06, SOLE_Y + 1.12, 0.36);
export const DECK_SWITCH_POS = new THREE.Vector3(0.595, DECK_Y + 0.25, -1.0);

interface NavLamp {
  mesh: THREE.Mesh;
  halo: THREE.Sprite;
  kind: 'side' | 'stern' | 'mast' | 'anchor';
}

export class BoatLights {
  /** ціль погляду/підсвітки станцій */
  readonly cabinSwitch = new THREE.Group();
  readonly deckSwitch = new THREE.Group();
  private cabinLever: THREE.Mesh;
  private deckLever: THREE.Mesh;
  private cabinLed: THREE.MeshBasicMaterial;
  private deckLed: THREE.MeshBasicMaterial;
  private lamps: NavLamp[] = [];
  /** прожектор на краспиці: світить на палубу (постійно в сцені, інтенсивність 0 — вимкнено) */
  readonly flood: THREE.PointLight;
  private floodLamp: THREE.MeshBasicMaterial;

  constructor(parent: THREE.Object3D) {
    const sw = this.buildSwitch(L('КАЮТА', 'CABIN'));
    this.cabinSwitch.add(sw.g);
    this.cabinLever = sw.lever;
    this.cabinLed = sw.led;
    // на борту салону над штурманським столом, обличчям усередину (−x)
    this.cabinSwitch.position.copy(CABIN_SWITCH_POS);
    this.cabinSwitch.rotation.y = -Math.PI / 2;
    parent.add(this.cabinSwitch);

    const sw2 = this.buildSwitch(L('ПАЛУБА', 'DECK'));
    this.deckSwitch.add(sw2.g);
    this.deckLever = sw2.lever;
    this.deckLed = sw2.led;
    // внутрішній бік лівої лави кокпіту біля рубки, обличчям до середини (−x)
    this.deckSwitch.position.copy(DECK_SWITCH_POS);
    this.deckSwitch.rotation.y = -Math.PI / 2;
    parent.add(this.deckSwitch);

    // ходові вогні: лівий борт (+x) — червоний, правий (−x) — зелений
    // на скулах носа трохи нижче за борт (як на справжній яхті), кормовий — на транці
    const sz = 3.7;
    const sy = sheerY(sz) - 0.07;
    const sx = hullHalfWidth(sz) + 0.02;
    this.addLamp(parent, 'side', 0xff2a1e, sx, sy, sz);
    this.addLamp(parent, 'side', 0x22ff6a, -sx, sy, sz);
    this.addLamp(parent, 'stern', 0xfff4dc, 0.62, sheerY(-4.7) - 0.1, -4.73);
    this.addLamp(parent, 'mast', 0xfff4dc, 0, RIG.base + 4.0, RIG.mastZ + 0.17);
    this.addLamp(parent, 'anchor', 0xfff4dc, 0, RIG.top + 0.12, RIG.mastZ);

    // прожектор: плафон під краспицею + світло
    const floodMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.3, metalness: 0.8 }));
    floodMesh.position.set(0, HOUSE.top + 2.3, RIG.mastZ - 0.12);
    parent.add(floodMesh);
    this.floodLamp = new THREE.MeshBasicMaterial({ color: 0x3a3630, toneMapped: false });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.06, 14), this.floodLamp);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, HOUSE.top + 2.26, RIG.mastZ - 0.12);
    parent.add(lens);
    this.flood = new THREE.PointLight(0xfff0d6, 0, 12, 1.5);
    this.flood.position.set(0, HOUSE.top + 2.15, RIG.mastZ - 0.12);
    parent.add(this.flood);
  }

  private buildSwitch(label: string) {
    const g = new THREE.Group();
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.85 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.012), new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.5, metalness: 0.2 }));
    g.add(plate);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.132, 0.162, 0.008), brass);
    rim.position.z = -0.004;
    g.add(rim);
    // табличка з написом
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 32;
    const x = c.getContext('2d')!;
    x.fillStyle = '#e8dcc0';
    x.fillRect(0, 0, 128, 32);
    x.fillStyle = '#2a2118';
    x.font = '700 20px -apple-system, "Segoe UI", sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(label, 64, 17);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.0225), new THREE.MeshBasicMaterial({ map: tex }));
    tag.position.set(0, 0.052, 0.0065);
    g.add(tag);
    // гніздо й важіль тумблера
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 14), brass);
    boss.rotation.x = Math.PI / 2;
    boss.position.set(0, -0.005, 0.01);
    g.add(boss);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.045, 8).translate(0, 0.0225, 0), brass);
    lever.position.set(0, -0.005, 0.016);
    g.add(lever);
    // світлодіод стану
    const led = new THREE.MeshBasicMaterial({ color: 0xffb03a, toneMapped: false });
    const ledM = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 8), led);
    ledM.position.set(0, -0.052, 0.008);
    g.add(ledM);
    return { g, lever, led };
  }

  private addLamp(parent: THREE.Object3D, kind: NavLamp['kind'], color: number, x: number, y: number, z: number) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x222222, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat);
    mesh.position.set(x, y, z);
    mesh.userData.on = new THREE.Color(color);
    parent.add(mesh);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
    halo.scale.setScalar(kind === 'anchor' || kind === 'mast' ? 1.1 : 0.8);
    halo.position.copy(mesh.position);
    halo.visible = false;
    parent.add(halo);
    this.lamps.push({ mesh, halo, kind });
  }

  private static setSwitch(lever: THREE.Mesh, led: THREE.MeshBasicMaterial, m: LightMode) {
    // авто — посередині, увімкнено — вгору, вимкнено — вниз
    lever.rotation.x = m === 1 ? Math.PI / 2 - 0.65 : m === 2 ? Math.PI / 2 + 0.65 : Math.PI / 2;
    led.color.setHex(m === 0 ? 0xffb03a : m === 1 ? 0x48ff7a : 0x5a1612);
  }

  /** чи горить каютне світло (для шейдерів/підказок) — 0..∞ сила */
  static cabinLevel(m: LightMode, daylight: number, storm: number): number {
    const auto = Math.max(0.2, (1 - daylight) * 1.7 + storm * 0.9);
    return m === 1 ? Math.max(1.5, auto) : m === 2 ? 0 : auto;
  }

  /** сила ліхтарів-апгрейдів на палубі 0..1 (була «ніч») */
  static deckLevel(m: LightMode, daylight: number): number {
    const night = 1 - daylight;
    return m === 1 ? Math.max(night, 0.85) : m === 2 ? 0 : night;
  }

  update(cabin: LightMode, deck: LightMode, daylight: number, storm: number, anchored: boolean, engineOn: boolean) {
    BoatLights.setSwitch(this.cabinLever, this.cabinLed, cabin);
    BoatLights.setSwitch(this.deckLever, this.deckLed, deck);
    const night = 1 - daylight;
    // ходові: авто — у сутінках/вночі й у негоду (погана видимість)
    const nav = deck === 1 || (deck === 0 && (night > 0.35 || storm > 0.75));
    for (const l of this.lamps) {
      const on = nav && (l.kind === 'anchor' ? anchored : l.kind === 'mast' ? engineOn && !anchored : !anchored);
      const mat = l.mesh.material as THREE.MeshBasicMaterial;
      if (on) mat.color.copy(l.mesh.userData.on as THREE.Color);
      else mat.color.setHex(0x222222);
      l.halo.visible = on;
      // вдень ореол ледь помітний, вночі — яскравий
      (l.halo.material as THREE.SpriteMaterial).opacity = 0.25 + night * 0.7;
    }
    // палубний прожектор — лише «увімкнено» (вночі корисно для рибалки)
    const f = deck === 1 ? 0.35 + night * 0.65 : 0;
    this.flood.intensity = f * 14;
    this.floodLamp.color.setHex(f > 0 ? 0xfff0d0 : 0x3a3630);
  }
}
