import { L } from '../core/i18n';
import { SAIL_AREA, sailModeLabel, type SailMode } from '../world/sails';
import './sailMenu.css';

// ─────────────────────────────────────────────────────────────
// Радіальне меню парусів біля щогли (як «колесо» в іграх):
// E — відкрити; рух миші вибирає сектор, ЛКМ / відпустити затиснуту E /
// ще раз E — тягнути фал; цифри 1–4 (5 — генакер) — одразу; ПКМ / Esc — ні.
// Догори — більше вітрила, за годинниковою — менше.
// ─────────────────────────────────────────────────────────────

export type SailChoice = SailMode | 'genn';

interface Sector {
  id: SailChoice;
  key: string;
  title: string;
  sub: string;
  a0: number;
  a1: number;
}

const NS = 'http://www.w3.org/2000/svg';
const R_IN = 60;
const R_OUT = 158;
const SIZE = 360;
const C = SIZE / 2;

function polar(r: number, a: number): [number, number] {
  // a — від «12 години» за годинниковою (рад)
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

function wedge(a0: number, a1: number, rIn: number, rOut: number): string {
  const gap = 0.025;
  const b0 = a0 + gap, b1 = a1 - gap;
  const [x0, y0] = polar(rOut, b0), [x1, y1] = polar(rOut, b1);
  const [x2, y2] = polar(rIn, b1), [x3, y3] = polar(rIn, b0);
  const large = b1 - b0 > Math.PI ? 1 : 0;
  return `M${x0},${y0} A${rOut},${rOut} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rIn},${rIn} 0 ${large} 0 ${x3},${y3} Z`;
}

/** значок вітрила: щогла + трикутник, заповнений на частку площі */
function sailGlyph(g: SVGGElement, cx: number, cy: number, area: number, genn: boolean) {
  const h = 34, w = 22;
  const add = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    g.appendChild(e);
    return e;
  };
  const top = cy - h / 2, bot = cy + h / 2, mx = cx - w / 2 + 3;
  if (genn) {
    // пузатий генакер попереду щогли
    add('path', { d: `M${mx},${top} Q${mx + w + 8},${cy - 2} ${mx + 4},${bot}`, class: 'sm-cloth genn' });
  } else {
    add('path', { d: `M${mx},${top} L${mx},${bot} L${mx + w},${bot} Z`, class: 'sm-ghost' });
    if (area > 0) {
      const yy = bot - h * area;
      // точка на задній шкаторині (гіпотенузі) на висоті рифу
      const xx = mx + w * (1 - area);
      add('path', { d: `M${mx},${yy} L${mx},${bot} L${mx + w},${bot} L${xx},${yy} Z`, class: 'sm-cloth' });
      // риф-шкентелі
      if (area < 0.99) add('line', { x1: mx, y1: yy, x2: xx, y2: yy, class: 'sm-reefline' });
    }
  }
  add('line', { x1: mx, y1: top - 3, x2: mx, y2: bot + 2, class: 'sm-mast' });
}

export class SailMenu {
  readonly el: HTMLDivElement;
  private svg: SVGSVGElement;
  private paths = new Map<SailChoice, SVGPathElement>();
  private groups = new Map<SailChoice, SVGGElement>();
  private dot: SVGCircleElement;
  private centerTitle: HTMLDivElement;
  private centerSub: HTMLDivElement;
  private foot: HTMLDivElement;
  private sectors: Sector[] = [];
  open = false;
  /** відкрили затиснутою E — відпускання підтверджує */
  private heldSince = 0;
  private vx = 0;
  private vy = 0;
  sel: SailChoice | null = null;
  private current: SailMode = 0;
  private gennOn = false;
  private rec: SailMode = 2;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'sail-menu';
    this.el.innerHTML = `
      <div class="sm-ring"></div>
      <div class="sm-center"><div class="sm-ct"></div><div class="sm-cs"></div></div>
      <div class="sm-foot"></div>`;
    parent.appendChild(this.el);
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
    this.el.querySelector('.sm-ring')!.appendChild(this.svg);
    this.dot = document.createElementNS(NS, 'circle');
    this.centerTitle = this.el.querySelector('.sm-ct')!;
    this.centerSub = this.el.querySelector('.sm-cs')!;
    this.foot = this.el.querySelector('.sm-foot')!;
  }

  private build(withGenn: boolean) {
    this.svg.textContent = '';
    this.paths.clear();
    this.groups.clear();
    const defs: Array<Omit<Sector, 'a0' | 'a1'>> = [
      { id: 2, key: '4', title: L('Повні', `Full`), sub: '100%' },
      { id: 1, key: '3', title: L('Риф 1', `Reef 1`), sub: '70%' },
      { id: 3, key: '2', title: L('Риф 2', `Reef 2`), sub: '40%' },
      { id: 0, key: '1', title: L('Спустити', `Drop`), sub: '0%' },
    ];
    if (withGenn) defs.push({ id: 'genn', key: '5', title: L('Генакер', `Gennaker`), sub: '' });
    const n = defs.length;
    const span = (Math.PI * 2) / n;
    this.sectors = defs.map((d, i) => ({ ...d, a0: i * span - span / 2, a1: i * span + span / 2 }));
    // підкладка-кільце
    const base = document.createElementNS(NS, 'circle');
    base.setAttribute('cx', String(C));
    base.setAttribute('cy', String(C));
    base.setAttribute('r', String(R_OUT + 8));
    base.setAttribute('class', 'sm-base');
    this.svg.appendChild(base);
    for (const s of this.sectors) {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'sm-sec');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', wedge(s.a0, s.a1, R_IN, R_OUT));
      p.setAttribute('class', 'sm-wedge');
      g.appendChild(p);
      const mid = (s.a0 + s.a1) / 2;
      const [gx, gy] = polar((R_IN + R_OUT) / 2, mid);
      const icon = document.createElementNS(NS, 'g');
      icon.setAttribute('class', 'sm-icon');
      sailGlyph(icon, gx + 4, gy - 16, s.id === 'genn' ? 1 : SAIL_AREA[s.id], s.id === 'genn');
      g.appendChild(icon);
      const text = (cls: string, x: number, y: number, str: string) => {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', String(x));
        t.setAttribute('y', String(y));
        t.setAttribute('class', cls);
        t.textContent = str;
        g.appendChild(t);
        return t;
      };
      text('sm-title', gx, gy + 18, s.title);
      text('sm-sub', gx, gy + 33, s.sub);
      // номер клавіші — праворуч від значка
      const [kx, ky] = [gx + 26, gy - 22];
      const kc = document.createElementNS(NS, 'circle');
      kc.setAttribute('cx', String(kx));
      kc.setAttribute('cy', String(ky));
      kc.setAttribute('r', '9');
      kc.setAttribute('class', 'sm-keybg');
      g.appendChild(kc);
      text('sm-key', kx, ky + 4, s.key);
      this.svg.appendChild(g);
      this.paths.set(s.id, p);
      this.groups.set(s.id, g);
    }
    this.dot.setAttribute('r', '5');
    this.dot.setAttribute('class', 'sm-dot');
    this.svg.appendChild(this.dot);
  }

  /** відкрити: поточний режим, генакер (null — немає апгрейду), порада за вітром */
  show(current: SailMode, genn: boolean | null, rec: SailMode, windMs: number, held: boolean) {
    this.current = current;
    this.gennOn = !!genn;
    this.rec = rec;
    this.build(genn !== null);
    this.open = true;
    this.vx = this.vy = 0;
    this.sel = null;
    this.heldSince = held ? performance.now() : 0;
    this.el.classList.add('show');
    this.el.parentElement?.classList.add('sail-open');
    for (const s of this.sectors) {
      const g = this.groups.get(s.id)!;
      g.classList.toggle('cur', s.id === current || (s.id === 'genn' && this.gennOn));
      g.classList.toggle('rec', s.id === rec && s.id !== current);
      if (s.id === 'genn') {
        const sub = g.querySelector('.sm-sub');
        if (sub) sub.textContent = this.gennOn ? L('увімкнено', `on`) : L('вимкнено', `off`);
      }
    }
    const recTxt = rec === 0 ? L('краще спустити', `better drop them`) : L(`радимо: ${sailModeLabel(rec)}`, `advice: ${sailModeLabel(rec)}`);
    this.foot.innerHTML = `<b>${L('Вітер', `Wind`)} ${Math.round(windMs)} ${L('м/с', `m/s`)}</b> · ${recTxt}<br><span>${L('миша — вибір · ЛКМ / E — тягнути · 1–4 — одразу · ПКМ / Esc — ні', `mouse — pick · LMB / E — haul · 1–4 — at once · RMB / Esc — cancel`)}</span>`;
    this.refresh();
  }

  close() {
    this.open = false;
    this.el.classList.remove('show');
    this.el.parentElement?.classList.remove('sail-open');
  }

  /** рух миші (пікселі): вибір сектора за кутом */
  move(dx: number, dy: number) {
    this.vx += dx;
    this.vy += dy;
    const l = Math.hypot(this.vx, this.vy);
    if (l > 90) {
      this.vx *= 90 / l;
      this.vy *= 90 / l;
    }
    if (l > 22) {
      const a = (Math.atan2(this.vx, -this.vy) + Math.PI * 2) % (Math.PI * 2);
      const s = this.sectors.find((s) => {
        const a0 = (s.a0 + Math.PI * 2) % (Math.PI * 2);
        const a1 = a0 + (s.a1 - s.a0);
        return (a >= a0 && a < a1) || (a + Math.PI * 2 >= a0 && a + Math.PI * 2 < a1);
      });
      this.sel = s?.id ?? null;
    } else this.sel = null;
    this.refresh();
  }

  /** клавіша 1–5 → вибір */
  byKey(k: string): SailChoice | null {
    return this.sectors.find((s) => s.key === k)?.id ?? null;
  }

  /** відпустили E після довгого затискання — підтвердити */
  heldLong(): boolean {
    return this.heldSince > 0 && performance.now() - this.heldSince > 280;
  }
  releaseHold() {
    this.heldSince = 0;
  }

  private refresh() {
    // точка-курсор біжить по краю внутрішнього кола (не лягає на текст у центрі)
    const l = Math.hypot(this.vx, this.vy);
    const k = l > 1 ? (Math.min(1, l / 40) * (R_IN - 7)) / l : 0;
    const [dx, dy] = [C + this.vx * k, C + this.vy * k];
    this.dot.setAttribute('cx', String(dx));
    this.dot.setAttribute('cy', String(dy));
    for (const [id, g] of this.groups) g.classList.toggle('sel', id === this.sel);
    const s = this.sectors.find((x) => x.id === this.sel);
    if (!s) {
      this.centerTitle.textContent = L('Паруси', `Sails`);
      this.centerSub.textContent = L(`зараз: ${sailModeLabel(this.current)}`, `now: ${sailModeLabel(this.current)}`);
      return;
    }
    if (s.id === 'genn') {
      this.centerTitle.textContent = this.gennOn ? L('Прибрати генакер', `Stow gennaker`) : L('Генакер', `Gennaker`);
      this.centerSub.textContent = L('ставиться сам на повних курсах', 'sets itself when running free');
      return;
    }
    this.centerTitle.textContent = s.id === this.current ? L('Без змін', `No change`) : s.title;
    this.centerSub.textContent =
      s.id === 2 ? L('слабкий і помірний вітер', `light to moderate wind`) :
      s.id === 1 ? L('свіжий вітер, ~10–13 м/с', `fresh wind, ~10–13 m/s`) :
      s.id === 3 ? L('сильний вітер і шквали', `strong wind and squalls`) :
      L('шторм, причал, якір', `storm, berth, anchor`);
  }
}
