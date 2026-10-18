import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { UpgradeId } from '../core/types';
import { buildPartModel, partViewYaw, type PartKit } from '../world/upgradeParts';

// ─────────────────────────────────────────────────────────────
// Прев'ю речей крамниці: ті самі моделі, що кріпляться на човен.
// Один невеликий рендерер: спершу «фотографує» мініатюри для полиць
// (кеш dataURL), потім крутить вибрану річ на вітрині.
// ─────────────────────────────────────────────────────────────

const THUMB = 160;

export class PartPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private kit: PartKit = {
    mat: (c, r = 0.8, m = 0.05) => {
      const key = `${c}|${r}|${m}`;
      let mat = this.mats.get(key);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
        this.mats.set(key, mat);
      }
      return mat;
    },
  };
  private thumbs = new Map<string, string>();
  private live: { obj: THREE.Object3D; host: HTMLElement; raf: number; t0: number } | null = null;
  private holder = new THREE.Group();

  private ensure(): THREE.WebGLRenderer {
    if (this.renderer) return this.renderer;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.setClearColor(0x000000, 0);
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    const key = new THREE.DirectionalLight(0xfff1dc, 1.6);
    key.position.set(2, 3, 2.5);
    this.scene.add(key, new THREE.HemisphereLight(0xdfe9f0, 0x6b5a48, 0.6), this.holder);
    this.renderer = r;
    return r;
  }

  /** поставити річ у кадр: центр, масштаб під рамку, кут «три чверті» */
  private frame(obj: THREE.Object3D, yaw: number) {
    this.holder.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.holder.clear();
    const wrap = new THREE.Group();
    wrap.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    obj.position.sub(c);
    const r = Math.max(0.05, size.length() / 2);
    wrap.rotation.y = yaw;
    this.holder.add(wrap);
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.02;
    this.camera.position.set(0, dist * 0.42, dist * 0.91);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = dist * 0.05;
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();
    return wrap;
  }

  thumb(id: UpgradeId, lvl: number): string {
    const key = `${id}:${lvl}`;
    const hit = this.thumbs.get(key);
    if (hit) return hit;
    this.stopLive();
    const r = this.ensure();
    r.setSize(THUMB, THUMB, false);
    this.camera.aspect = 1;
    this.frame(buildPartModel(id, lvl, this.kit), partViewYaw(id, lvl));
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    this.thumbs.set(key, url);
    return url;
  }

  /** обертати річ у контейнері host (canvas вставляється туди) */
  showLive(host: HTMLElement, id: UpgradeId, lvl: number) {
    this.stopLive();
    const r = this.ensure();
    const w = Math.max(80, host.clientWidth || 260);
    const h = Math.max(80, host.clientHeight || 200);
    r.setSize(w, h, false);
    const cv = r.domElement;
    cv.style.width = '100%';
    cv.style.height = '100%';
    cv.style.display = 'block';
    host.appendChild(cv);
    this.camera.aspect = w / h;
    const yaw0 = partViewYaw(id, lvl);
    const wrap = this.frame(buildPartModel(id, lvl, this.kit), yaw0);
    const live = { obj: wrap, host, raf: 0, t0: performance.now() };
    const tick = () => {
      if (!host.isConnected) {
        this.stopLive();
        return;
      }
      const t = (performance.now() - live.t0) / 1000;
      wrap.rotation.y = yaw0 + t * 0.5;
      wrap.position.y = Math.sin(t * 1.4) * 0.004 * this.camera.position.length();
      r.render(this.scene, this.camera);
      live.raf = requestAnimationFrame(tick);
    };
    this.live = live;
    tick();
  }

  stopLive() {
    if (!this.live) return;
    cancelAnimationFrame(this.live.raf);
    this.live = null;
    this.renderer?.domElement.remove();
  }
}
