// Стан клавіатури/миші (опитується кожен кадр, без подій-обробників логіки).

export class Input {
  /** єдиний екземпляр для всієї гри */
  static instance: Input = new Input();

  keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  pointerLocked = false;
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
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
  private wheelHandler = (e: WheelEvent) => {
    if (!this.pointerLocked) return;
    this.wheel += Math.sign(e.deltaY);
  };
  private lockHandler = () => {
    this.pointerLocked = document.pointerLockElement != null;
  };

  attach(el: HTMLElement) {
    window.addEventListener('keydown', this.downHandler);
    window.addEventListener('keyup', this.upHandler);
    window.addEventListener('mousemove', this.moveHandler);
    window.addEventListener('wheel', this.wheelHandler, { passive: true });
    document.addEventListener('pointerlockchange', this.lockHandler);
    void el;
  }

  detach() {
    window.removeEventListener('keydown', this.downHandler);
    window.removeEventListener('keyup', this.upHandler);
    window.removeEventListener('mousemove', this.moveHandler);
    window.removeEventListener('wheel', this.wheelHandler);
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
    const d = [this.mouseDX, this.mouseDY] as [number, number];
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
