// The touch controls, for phones and tablets. A stick appears under the left thumb to run. On the
// right, holding Hit (or Lob) charges, and sliding the thumb moves the target, as the arrows do;
// Dive dives the way the stick points. They press the keyboard's own keys (input.ts), so nothing
// after it can tell them apart.
import { h } from './dom.ts';
import type { Keyboard } from './input.ts';
import { EMOTES } from './sim/sim.ts';

// A direction's keys: right, left, up, down.
const RUN = ['KeyD', 'KeyA', 'KeyW', 'KeyS'];
const AIM = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'];
const REACH = 46; // how far, in px, the stick's knob goes; past it the stick follows the thumb
const RUN_DEAD = 12; // how far the thumb slides before the player runs, so a resting thumb stands still
const AIM_DEAD = 20; // more to aim, so a tap that slides a little leaves the target where it is

// A slide of dx, dy pixels as one of eight directions, each -1, 0 or 1 across and up the screen,
// or none inside the dead zone.
export function dir8(dx: number, dy: number, dead: number): [number, number] {
  const d = Math.hypot(dx, dy);
  if (d < dead) return [0, 0];
  const k = d * Math.sin(Math.PI / 8); // each direction takes 45°
  return [Math.abs(dx) > k ? Math.sign(dx) : 0, Math.abs(dy) > k ? -Math.sign(dy) : 0];
}

// Follows one finger on el from when it lands until it lifts; another finger is left to the other
// controls. Returns a function that lets go of it early.
function follow(el: HTMLElement, down: (x: number, y: number) => void, move: (x: number, y: number) => void, up: () => void): () => void {
  let id: number | null = null;
  el.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    id = e.pointerId;
    el.setPointerCapture(id);
    e.preventDefault();
    down(e.clientX, e.clientY);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId === id) move(e.clientX, e.clientY);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    up();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  return () => {
    if (id === null) return;
    id = null;
    up();
  };
}

export class TouchPad {
  readonly el: HTMLElement;
  private keys: Keyboard;
  private ends: (() => void)[] = [];
  private emotes: HTMLElement;

  constructor(keys: Keyboard) {
    this.keys = keys;
    this.emotes = this.emoteMenu();
    this.el = h(
      'div',
      { class: 'pad', oncontextmenu: (e: Event) => e.preventDefault() },
      this.stick(),
      this.swing('Lob', 'lob', 'KeyE'),
      this.swing('Hit', 'hit', 'Space'),
      this.button('Dive', 'dive', 'ShiftLeft'),
      this.emotes,
    );
    // Safari would scroll or zoom the page under a thumb that slides.
    this.el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  // Lets go of everything: the match is over, or the page went away.
  reset(): void {
    for (const end of this.ends) end();
    this.hold(AIM, 0, 0);
    this.emotes.classList.remove('open');
  }

  // Holds the keys of a direction (x right, y up, each -1, 0 or 1) and lets go of the others.
  private hold(codes: string[], x: number, y: number): void {
    const on = [x > 0, x < 0, y > 0, y < 0];
    codes.forEach((c, i) => (on[i] ? this.keys.press(c) : this.keys.release(c)));
  }

  // The stick appears where the thumb lands, anywhere on the left half, and comes back to its
  // corner when it lifts.
  private stick(): HTMLElement {
    const knob = h('div', { class: 'knob' });
    const base = h('div', { class: 'stick' }, knob);
    const zone = h('div', { class: 'run' }, base);
    let ox = 0; // the zone's corner on the screen
    let oy = 0;
    let cx = 0; // the stick's centre in the zone
    let cy = 0;
    const show = (dx: number, dy: number) => {
      base.style.left = `${cx}px`;
      base.style.top = `${cy}px`;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    this.ends.push(
      follow(
        zone,
        (x, y) => {
          const r = zone.getBoundingClientRect();
          ox = r.left;
          oy = r.top;
          cx = x - ox;
          cy = y - oy;
          base.classList.add('on');
          show(0, 0);
        },
        (x, y) => {
          let dx = x - ox - cx;
          let dy = y - oy - cy;
          const d = Math.hypot(dx, dy);
          if (d > REACH) {
            // Past its edge the stick follows the thumb, so turning back is quick.
            cx += dx * (1 - REACH / d);
            cy += dy * (1 - REACH / d);
            dx *= REACH / d;
            dy *= REACH / d;
          }
          show(dx, dy);
          this.hold(RUN, ...dir8(dx, dy, RUN_DEAD));
        },
        () => {
          base.classList.remove('on');
          base.style.left = base.style.top = knob.style.transform = '';
          this.hold(RUN, 0, 0);
        },
      ),
    );
    return zone;
  }

  // Hit and Lob: holding charges, and sliding the thumb from where it landed moves the target,
  // which stays where it's left.
  private swing(label: string, cls: string, code: string): HTMLElement {
    const knob = h('div', { class: 'knob' });
    const el = h('div', { class: `btn ${cls}` }, h('span', {}, label), knob);
    let x0 = 0;
    let y0 = 0;
    this.ends.push(
      follow(
        el,
        (x, y) => {
          x0 = x;
          y0 = y;
          this.hold(AIM, 0, 0);
          this.keys.press(code);
          el.classList.add('on');
        },
        (x, y) => {
          const [ax, ay] = dir8(x - x0, y - y0, AIM_DEAD);
          this.hold(AIM, ax, ay);
          const k = ax && ay ? 0.71 : 1;
          knob.style.transform = `translate(${ax * k * 26}px, ${-ay * k * 26}px)`;
        },
        () => {
          this.keys.release(code);
          el.classList.remove('on');
          knob.style.transform = '';
          this.hold(AIM, 0, 0);
        },
      ),
    );
    return el;
  }

  private button(label: string, cls: string, code: string): HTMLElement {
    const el = h('div', { class: `btn ${cls}` }, h('span', {}, label));
    this.ends.push(
      follow(
        el,
        () => {
          this.keys.press(code);
          el.classList.add('on');
        },
        () => {},
        () => {
          this.keys.release(code);
          el.classList.remove('on');
        },
      ),
    );
    return el;
  }

  // The emotes, behind a button so they take no room until wanted.
  private emoteMenu(): HTMLElement {
    const send = (i: number) => {
      this.keys.press(`Digit${i + 1}`);
      this.keys.release(`Digit${i + 1}`);
      box.classList.remove('open');
    };
    const box = h(
      'div',
      { class: 'emote' },
      h('button', { class: 'small', onclick: () => box.classList.toggle('open') }, '💬'),
      h('div', { class: 'list' }, ...EMOTES.map((t, i) => h('button', { class: 'small', onclick: () => send(i) }, t))),
    );
    return box;
  }
}
