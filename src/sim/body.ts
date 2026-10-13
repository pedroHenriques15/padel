// How a player moves: running with a little acceleration, at full speed whether charging or not,
// and the dive. The host moves everyone with it, and a remote player moves themselves with it on
// their own screen, so both agree.
import * as C from './constants.ts';
import { clamp, fwd, halfSign, rightX } from './court.ts';
import type { Team } from './types.ts';

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dive: number;
  down: number;
  diveCd: number;
  diveX: number;
  diveY: number;
}

export interface Limits {
  team: Team;
  serveSide: number; // waiting to serve: the x sign of their side, else 0
  speed: number;
}

export const newBody = (x = 0, y = 0): Body => ({ x, y, vx: 0, vy: 0, dive: 0, down: 0, diveCd: 0, diveX: 0, diveY: 0 });

// Keeps a player in their half, and a server between the centre and the side wall, behind the
// service line.
export function clampBody(b: { x: number; y: number }, L: Pick<Limits, 'team' | 'serveSide'>): void {
  const hs = halfSign(L.team);
  if (L.serveSide !== 0) {
    b.x = L.serveSide * clamp(b.x * L.serveSide, 0.3, C.HALF_W - 0.4);
    b.y = hs * clamp(b.y * hs, C.SERVICE_LINE + 0.3, C.HALF_L - 0.4);
  } else {
    b.x = clamp(b.x, -C.HALF_W + 0.3, C.HALF_W - 0.3);
    b.y = hs * clamp(b.y * hs, 0.35, C.HALF_L - 0.3);
  }
}

export function moveBody(b: Body, ix: number, iy: number, diveKey: boolean, L: Limits, dt: number): void {
  b.diveCd = Math.max(0, b.diveCd - dt);
  if (b.down > 0) {
    b.down = Math.max(0, b.down - dt);
    b.vx = b.vy = 0;
  } else if (b.dive > 0) {
    b.dive = Math.max(0, b.dive - dt);
    if (b.dive === 0) {
      b.down = C.DIVE_DOWN;
      b.vx = b.vy = 0;
    }
  } else {
    const len = Math.hypot(ix, iy);
    const k = len > 1 ? 1 / len : 1;
    const wx = ix * k * rightX(L.team);
    const wy = iy * k * fwd(L.team);
    if (diveKey && b.diveCd <= 0 && L.serveSide === 0 && len > 0) {
      const n = Math.hypot(wx, wy);
      b.diveX = wx / n;
      b.diveY = wy / n;
      b.dive = C.DIVE_TIME;
      b.diveCd = C.DIVE_COOLDOWN;
      b.vx = b.diveX * L.speed * C.DIVE_SPEED;
      b.vy = b.diveY * L.speed * C.DIVE_SPEED;
    } else {
      const tx = wx * L.speed;
      const ty = wy * L.speed;
      const dx = tx - b.vx;
      const dy = ty - b.vy;
      const gap = Math.hypot(dx, dy);
      if (gap > 0) {
        const speeding = tx * b.vx + ty * b.vy >= 0 && Math.hypot(tx, ty) >= Math.hypot(b.vx, b.vy);
        const m = Math.min(1, ((speeding ? C.ACCEL : C.DECEL) * dt) / gap);
        b.vx += dx * m;
        b.vy += dy * m;
      }
    }
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  clampBody(b, L);
}
