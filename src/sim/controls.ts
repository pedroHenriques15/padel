// A player's keys as they travel: presses are counted, so a quick tap between two ticks (or two
// network messages) is never lost: the host compares counts. A remote player adds where they are.
import type { TickInput } from './types.ts';

export interface Controls {
  ix: number; // running: WASD
  iy: number;
  tx: number; // aiming: the arrows
  ty: number;
  h: number; // hit presses so far
  hd: boolean; // hit held
  l: number; // lob presses
  ld: boolean;
  d: number; // dive presses
  e: number; // emote presses
  ek: number; // the last emote, 1-4
  px?: number; // a remote player's position
  py?: number;
  pl?: number; // the placement they saw
  ax?: number; // where they aim their serve
  ay?: number;
}

export type Seen = { h: number; l: number; d: number; e: number };

export const noControls = (): Controls => ({ ix: 0, iy: 0, tx: 0, ty: 0, h: 0, hd: false, l: 0, ld: false, d: 0, e: 0, ek: 0 });
export const seenOf = (c: Controls): Seen => ({ h: c.h, l: c.l, d: c.d, e: c.e });

// One tick's input from running counts: a press since the last tick is a press.
export function edges(c: Controls, seen: Seen): TickInput {
  const inp: TickInput = {
    ix: c.ix,
    iy: c.iy,
    aim: [c.tx, c.ty],
    hold: c.hd,
    press: c.h > seen.h,
    lobHold: c.ld,
    lobPress: c.l > seen.l,
    dive: c.d > seen.d,
    emote: c.e > seen.e ? c.ek : 0,
  };
  Object.assign(seen, seenOf(c));
  if (c.pl !== undefined && c.px !== undefined && c.py !== undefined) {
    inp.pose = { x: c.px, y: c.py, place: c.pl };
    if (c.ax !== undefined && c.ay !== undefined) inp.serveAim = { x: c.ax, y: c.ay };
  }
  return inp;
}

// What came over the network, made safe: numbers in range, or left out.
export function cleanControls(m: Record<string, unknown>): Controls {
  const n = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
  const opt = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
  const c: Controls = {
    ix: Math.sign(n(m.ix, -1, 1)),
    iy: Math.sign(n(m.iy, -1, 1)),
    tx: Math.sign(n(m.tx, -1, 1)),
    ty: Math.sign(n(m.ty, -1, 1)),
    h: n(m.h, 0, 1e9),
    hd: m.hd === true,
    l: n(m.l, 0, 1e9),
    ld: m.ld === true,
    d: n(m.d, 0, 1e9),
    e: n(m.e, 0, 1e9),
    ek: Math.round(n(m.ek, 0, 4)),
  };
  const px = opt(m.px, -20, 20);
  const py = opt(m.py, -20, 20);
  const pl = opt(m.pl, 0, 1e9);
  if (px !== undefined && py !== undefined && pl !== undefined) Object.assign(c, { px, py, pl });
  const ax = opt(m.ax, -20, 20);
  const ay = opt(m.ay, -20, 20);
  if (ax !== undefined && ay !== undefined) Object.assign(c, { ax, ay });
  return c;
}
