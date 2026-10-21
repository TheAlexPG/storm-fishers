import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Матриці лише коли щось справді змінилось. Типово three.js щокадру
// перескладає матрицю КОЖНОГО об'єкта (позиція/поворот/масштаб → matrix)
// і ставить matrixWorldNeedsUpdate — тож для тисяч нерухомих будинків, паль
// і дерев щокадру ще й перемножуються світові матриці. Тут updateMatrix
// спершу порівнює позицію, кватерніон і масштаб з попередніми: не змінились —
// матриця та сама, світову не перераховуємо. Поведінка ідентична (будь-яка
// зміна position/rotation/quaternion/scale підхоплюється тим самим кадром).
// ─────────────────────────────────────────────────────────────

type Cached = THREE.Object3D & { _mc?: Float64Array };

let installed = false;

export function installFastMatrix() {
  if (installed) return;
  installed = true;
  const proto = THREE.Object3D.prototype as THREE.Object3D & { updateMatrix(): void };
  proto.updateMatrix = function (this: Cached) {
    const p = this.position, q = this.quaternion, s = this.scale;
    let c = this._mc;
    if (
      c &&
      c[0] === p.x && c[1] === p.y && c[2] === p.z &&
      c[3] === q.x && c[4] === q.y && c[5] === q.z && c[6] === q.w &&
      c[7] === s.x && c[8] === s.y && c[9] === s.z
    ) return;
    if (!c) c = this._mc = new Float64Array(10);
    c[0] = p.x; c[1] = p.y; c[2] = p.z;
    c[3] = q.x; c[4] = q.y; c[5] = q.z; c[6] = q.w;
    c[7] = s.x; c[8] = s.y; c[9] = s.z;
    this.matrix.compose(p, q, s);
    this.matrixWorldNeedsUpdate = true;
  };
}
