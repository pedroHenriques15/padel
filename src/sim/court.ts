import { BACK_H, BALL_R, CORD, FLOOR_E, FLOOR_F, G, HALF_L, HALF_W, NET_H, SIDE_GLASS, SIDE_H, WALL_E } from './constants.ts';
import type { Ball, BallEvent, Player, State, Team } from './types.ts';

export const halfSign = (t: Team): number => (t === 0 ? -1 : 1); // y sign of a team's half
export const fwd = (t: Team): number => (t === 0 ? 1 : -1); // y direction towards the net
export const rightX = (t: Team): number => (t === 0 ? 1 : -1); // x direction of a team's right
export const sideOf = (y: number): Team => (y < 0 ? 0 : 1);
export const other = (t: Team): Team => (t === 0 ? 1 : 0);
export const slotX = (p: Player): number => (p.slot === 0 ? rightX(p.team) : -rightX(p.team));
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

// What spin does to a bounce: a slice stays low and skids on, a kick (a smash hit for the fence)
// leaps up and out.
function spinBounce(b: Ball): void {
  if (b.spin === 'slice') {
    b.vz *= 0.55;
    b.vx *= 1.12;
    b.vy *= 1.12;
  } else if (b.spin === 'kick') {
    const h = Math.hypot(b.vx, b.vy) || 1;
    b.vx *= 7.5 / h;
    b.vy *= 7.5 / h;
    b.vz = Math.max(b.vz, 13);
  }
  b.spin = '';
}

// Moves the ball by h seconds: gravity, the floor, the net and the walls. What it touched goes in
// ev; the rules are someone else's business.
export function moveBall(b: Ball, h: number, ev: BallEvent[]): void {
  const py = b.y;
  const pz = b.z;
  b.vz -= G * h;
  b.x += b.vx * h;
  b.y += b.vy * h;
  b.z += b.vz * h;
  if (b.out) {
    if (b.z < 0) {
      b.z = 0;
      b.vx = b.vy = b.vz = 0;
    }
    return;
  }

  if (py !== 0 && py < 0 !== b.y < 0) {
    const f = py / (py - b.y);
    const zAtNet = pz + (b.z - pz) * f;
    if (zAtNet < NET_H - CORD) {
      b.y = py < 0 ? -BALL_R : BALL_R;
      b.vy = -b.vy * 0.15;
      b.vx *= 0.4;
      if (b.vz > 0) b.vz *= 0.3;
      b.spin = '';
      ev.push({ k: 'net' });
    } else {
      if (zAtNet < NET_H + CORD) {
        // Off the tape: it goes on, slower, and pops up.
        b.vy *= 0.5;
        b.vx *= 0.7;
        b.vz = Math.abs(b.vz) * 0.3 + 0.8;
        b.spin = '';
        ev.push({ k: 'cord' });
      }
      ev.push({ k: 'cross', side: sideOf(b.y) });
    }
  }

  if (b.z < BALL_R) {
    b.z = BALL_R;
    if (b.vz < 0) {
      const speed = -b.vz;
      b.vz = speed * FLOOR_E < 0.5 ? 0 : speed * FLOOR_E;
      b.vx *= FLOOR_F;
      b.vy *= FLOOR_F;
      if (b.spin) spinBounce(b);
      ev.push({ k: 'floor', side: sideOf(b.y), x: b.x, y: b.y, hard: speed > 1.2 });
    }
  }

  const xr = HALF_W - BALL_R;
  if (Math.abs(b.x) > xr) {
    if (b.z > SIDE_H) {
      b.out = true;
      ev.push({ k: 'out', side: sideOf(b.y) });
      return;
    }
    b.x = Math.sign(b.x) * xr;
    if (Math.sign(b.vx) === Math.sign(b.x)) b.vx = -b.vx * WALL_E;
    ev.push({ k: 'wall', side: sideOf(b.y), mesh: Math.abs(b.y) < HALF_L - SIDE_GLASS });
  }
  const yr = HALF_L - BALL_R;
  if (Math.abs(b.y) > yr) {
    if (b.z > BACK_H) {
      b.out = true;
      ev.push({ k: 'out', side: sideOf(b.y) });
      return;
    }
    b.y = Math.sign(b.y) * yr;
    if (Math.sign(b.vy) === Math.sign(b.y)) b.vy = -b.vy * WALL_E;
    ev.push({ k: 'wall', side: sideOf(b.y), mesh: b.z > 3 });
  }
}

// How far p is from a ball they may hit now, or Infinity.
export function hittableDistance(s: State, p: Player): number {
  const b = s.ball;
  if (s.phase !== 'rally' || b.out || s.serveInFlight) return Infinity;
  if (s.lastHitTeam === p.team) return Infinity;
  if (s.serveReturn && s.players[s.receiver] !== p) return Infinity;
  if (sideOf(b.y) !== p.team || b.z > p.maxZ) return Infinity;
  return Math.hypot(b.x - p.x, b.y - p.y);
}
