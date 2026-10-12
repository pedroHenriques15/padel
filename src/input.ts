// The keyboard. Presses are counted, so a quick tap between two ticks (or two network messages)
// is never lost: the host compares counts.
const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];
const HIT = ['Space', 'KeyJ'];
const LOB = ['KeyK', 'KeyL'];
const GAME_KEYS = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN, ...HIT, ...LOB]);

export interface Controls {
  ix: number;
  iy: number;
  h: number; // hit presses so far
  l: number; // lob presses so far
}

export class Keyboard {
  private down = new Set<string>();
  hits = 0;
  lobs = 0;
  enabled = false;

  constructor() {
    addEventListener('keydown', (e) => {
      if (!this.enabled || (e.target instanceof HTMLElement && e.target.closest('input, select, textarea'))) return;
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (!e.repeat) {
        if (HIT.includes(e.code)) this.hits++;
        if (LOB.includes(e.code)) this.lobs++;
      }
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  read(): Controls {
    return {
      ix: (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0),
      iy: (this.any(UP) ? 1 : 0) - (this.any(DOWN) ? 1 : 0),
      h: this.hits,
      l: this.lobs,
    };
  }
}
