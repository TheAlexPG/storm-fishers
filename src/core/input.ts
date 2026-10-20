// Стан клавіатури/миші (опитується кожен кадр, без подій-обробників логіки).

export class Input {
  /** єдиний екземпляр для всієї гри */
  static instance: Input = new Input();

  keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  pointerLocked = false;
  /** налаштування: множник чутливості й інверсія осі Y */
  sens = 1;
  invertY = false;
  /** накопичене коліщатко миші (з'їдає consumeWheel) */
  wheel = 0;

  private downHandler = (e: KeyboardEvent) => {
    if (e.repeat) return;
    // набір тексту (нік, код кімнати, чат) — не керування
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    this.keys.add(e.code);
    // швидкий «тап» (натиснули й відпустили між кадрами) теж має спрацювати
    this.tapped.add(e.code);
  };
  private upHandler = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private moveHandler = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    // Chrome на захопленні/відпусканні миші шле один «стрибок» на сотні пікселів —
    // камера від нього відлітала; такі події пропускаємо
    if (Math.abs(e.movementX) > 450 || Math.abs(e.movementY) > 450) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
  private wheelHandler = (e: WheelEvent) => {
    if (!this.pointerLocked) return;
    this.wheel += Math.sign(e.deltaY);
  };
  // кнопки миші як «клавіші» Mouse0 (ЛКМ) / Mouse2 (ПКМ) — лише при захопленій миші
  private mdownHandler = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    const c = 'Mouse' + e.button;
    this.keys.add(c);
    this.tapped.add(c);
  };
  private mupHandler = (e: MouseEvent) => {
    this.keys.delete('Mouse' + e.button);
  };
  private lockHandler = () => {
    this.pointerLocked = document.pointerLockElement != null;
    // накопичений рух за мить до/після захоплення — не крутить камеру
    this.mouseDX = 0;
    this.mouseDY = 0;
  };

  attach(el: HTMLElement) {
    window.addEventListener('keydown', this.downHandler);
    window.addEventListener('keyup', this.upHandler);
    window.addEventListener('mousemove', this.moveHandler);
    window.addEventListener('wheel', this.wheelHandler, { passive: true });
    window.addEventListener('mousedown', this.mdownHandler);
    window.addEventListener('mouseup', this.mupHandler);
    document.addEventListener('pointerlockchange', this.lockHandler);
    void el;
  }

  detach() {
    window.removeEventListener('keydown', this.downHandler);
    window.removeEventListener('keyup', this.upHandler);
    window.removeEventListener('mousemove', this.moveHandler);
    window.removeEventListener('wheel', this.wheelHandler);
    window.removeEventListener('mousedown', this.mdownHandler);
    window.removeEventListener('mouseup', this.mupHandler);
    document.removeEventListener('pointerlockchange', this.lockHandler);
  }

  /** натиснуто в цьому кадрі (з'їдається) */
  private justPressed = new Set<string>();
  private prevKeys = new Set<string>();
  private tapped = new Set<string>();

  beginFrame() {
    this.justPressed.clear();
    for (const k of this.keys) if (!this.prevKeys.has(k)) this.justPressed.add(k);
    for (const k of this.tapped) this.justPressed.add(k);
    this.tapped.clear();
    this.prevKeys.clear();
    for (const k of this.keys) this.prevKeys.add(k);
    // мишу НЕ нулюємо тут: дельти накопичуються між кадрами і з'їдаються
    // consumeMouse() в player.update — той самий кадр, після beginFrame()
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  pressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  consumeMouse(): [number, number] {
    const d = [this.mouseDX * this.sens, this.mouseDY * this.sens * (this.invertY ? -1 : 1)] as [number, number];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
