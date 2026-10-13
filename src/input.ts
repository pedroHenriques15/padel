// The keyboard. Presses are counted, so a quick tap between two ticks (or two network messages)
// is never lost: the host compares counts. The touch controls (touch.ts) press the same keys.
import type { Controls } from './sim/controls.ts';
import type { SwingKind } from './sim/types.ts';

// WASD runs; the arrows only aim.
const LEFT = ['KeyA'];
const RIGHT = ['KeyD'];
const UP = ['KeyW'];
const DOWN = ['KeyS'];
const AIM_LEFT = ['ArrowLeft'];
const AIM_RIGHT = ['ArrowRight'];
const AIM_UP = ['ArrowUp'];
const AIM_DOWN = ['ArrowDown'];
const HIT = ['Space', 'KeyJ'];
const LOB = ['KeyE', 'KeyK'];
const DIVE = ['ShiftLeft', 'ShiftRight', 'KeyL'];
const EMOTES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'];
export const GAME_KEYS = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN, ...AIM_LEFT, ...AIM_RIGHT, ...AIM_UP, ...AIM_DOWN, ...HIT, ...LOB, ...DIVE, ...EMOTES]);

export class Keyboard {
  private down = new Set<string>();
  hits = 0;
  lobs = 0;
  dives = 0;
  emotes = 0;
  emote = 0;
  pressedAt = 0; // when the hit or lob key last went down
  pressedKind: SwingKind = 'drive';
  enabled = false;

  constructor() {
    addEventListener('keydown', (e) => {
      if (!this.enabled || (e.target instanceof HTMLElement && e.target.closest('input, select, textarea'))) return;
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (e.repeat) this.down.add(e.code);
      else this.press(e.code);
    });
    addEventListener('keyup', (e) => this.release(e.code));
    addEventListener('blur', () => this.clear());
  }

  // A key goes down, on the keyboard or on the screen. A key already down doesn't count again.
  press(code: string): void {
    if (!this.enabled || this.down.has(code)) return;
    if (HIT.includes(code) || LOB.includes(code)) {
      if (HIT.includes(code)) this.hits++;
      else this.lobs++;
      this.pressedAt = performance.now();
      this.pressedKind = HIT.includes(code) ? 'drive' : 'lob';
    }
    if (DIVE.includes(code)) this.dives++;
    if (EMOTES.includes(code)) {
      this.emotes++;
      this.emote = (EMOTES.indexOf(code) % 4) + 1;
    }
    this.down.add(code);
  }

  release(code: string): void {
    this.down.delete(code);
  }

  // Lets go of every key, as when the page loses the focus.
  clear(): void {
    this.down.clear();
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  // The kind of the latest press, while its key is still down.
  held(): SwingKind | null {
    return this.any(this.pressedKind === 'lob' ? LOB : HIT) ? this.pressedKind : null;
  }

  read(): Controls {
    return {
      ix: (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0),
      iy: (this.any(UP) ? 1 : 0) - (this.any(DOWN) ? 1 : 0),
      tx: (this.any(AIM_RIGHT) ? 1 : 0) - (this.any(AIM_LEFT) ? 1 : 0),
      ty: (this.any(AIM_UP) ? 1 : 0) - (this.any(AIM_DOWN) ? 1 : 0),
      h: this.hits,
      hd: this.any(HIT),
      l: this.lobs,
      ld: this.any(LOB),
      d: this.dives,
      e: this.emotes,
      ek: this.emote,
    };
  }
}
