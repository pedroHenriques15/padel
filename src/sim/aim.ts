// Where shots go. Every player has a target on the other half that the arrows move, and that stays
// where they leave it; until they move it, it's the automatic shot. Shared by the match and the
// screen, which shows the player their target.
import { HALF_L, HALF_W, SERVE_RED, SERVICE_LINE, SMASH_Z } from './constants.ts';
import { clamp, fwd, halfSign, rightX } from './court.ts';
import type { Shot, SwingKind, Team } from './types.ts';

// How deep each shot lands, in metres from the net: short, plain, deep. The automatic shot goes to
// the plain depth; the bots choose among the three.
export const DEPTHS: Record<Shot, [number, number, number]> = {
  serve: [4, 5, 6],
  drive: [3.4, 6.4, 8.4],
  lob: [7.4, 8.3, 9],
  bandeja: [5.6, 7.6, 8.6],
  smash: [4.2, 6, 7.8],
  portres: [3, 3.2, 3.4],
  dig: [6.5, 6.5, 6.5],
  frame: [5, 5, 5],
};

const LOB_MIN = 6.5; // m from the net: a lob aimed shorter still goes this deep
const PORTRES_X = 3.4; // a por tres lands short, so it kicks out over the back wall, and not too wide

// Which shot a swing makes: an overhead is a bandeja when hit softly, a smash when hit hard, and
// a por tres when hit as hard as it gets, from near the net.
export function shotKind(kind: SwingKind, power: number, ballZ: number, hitterY: number): Shot {
  if (kind === 'lob') return 'lob';
  if (ballZ <= SMASH_Z) return 'drive';
  if (power >= 0.9 && Math.abs(hitterY) < 5) return 'portres';
  return power < 0.35 ? 'bandeja' : 'smash';
}

// The shot a swing will most likely make, before it's made: an overhead only once a high ball is
// close, at the power charged so far.
export function likelyShot(lob: boolean, power: number, ball: { x: number; y: number; z: number }, p: { x: number; y: number }): Shot {
  const near = Math.hypot(ball.x - p.x, ball.y - p.y) < 2.5;
  return shotKind(lob ? 'lob' : 'drive', power, near ? ball.z : 0, p.y);
}

// The automatic shot for a player of team at x: crosscourt, more sharply from wider, down the
// middle from the middle, to the shot's plain depth.
export function autoTarget(team: Team, x: number, shot: Shot): { x: number; y: number } {
  return { x: -Math.sign(x) * Math.min(3.2, Math.abs(x) * 1.4), y: -halfSign(team) * DEPTHS[shot][1] };
}

// A target moved by the arrows for dt: ix right and iy deep on the player's screen, at speed m/s.
export function steer(a: { x: number; y: number }, team: Team, ix: number, iy: number, speed: number, dt: number): { x: number; y: number } {
  return { x: a.x + Math.sign(ix) * rightX(team) * speed * dt, y: a.y + Math.sign(iy) * fwd(team) * speed * dt };
}

// Keeps a shot's target on the other half, inside the walls: right up to the lines, where a miss
// hits the glass before bouncing.
export function clampShotAim(x: number, y: number, team: Team): { x: number; y: number } {
  const ys = -halfSign(team);
  return { x: clamp(x, -(HALF_W - 0.4), HALF_W - 0.4), y: ys * clamp(y * ys, 1.5, HALF_L - 0.4) };
}

// Where a shot goes: the automatic shot, or the target, with the shot's own limits.
export function shotAim(team: Team, aimed: boolean, aim: { x: number; y: number }, x: number, shot: Shot): { x: number; y: number } {
  if (!aimed) return autoTarget(team, x, shot);
  const ys = -halfSign(team);
  if (shot === 'portres') return { x: clamp(aim.x, -PORTRES_X, PORTRES_X), y: ys * DEPTHS.portres[1] };
  if (shot === 'lob') return { x: aim.x, y: ys * Math.max(LOB_MIN, aim.y * ys) };
  return { x: aim.x, y: aim.y };
}

// How far off its target a shot may land, in metres (a standard deviation; a little more along the
// length). Off-centre contact (q is 1 at the sweet spot), power, a fast ball (pace, m/s) and a volley
// add to it, a volley at the feet (low) most of all; a perfect contact and a ball off the glass take
// from it.
export function shotSpread(shot: Shot, q: number, power: number, pace: number, volley: boolean, low: boolean, perfect: boolean, glass: boolean): number {
  let err = 0.2 + (1 - q) ** 2 * 1.7 * (0.7 + 0.6 * power) + power * 0.3 + Math.max(0, pace - 10) * 0.04 + (volley ? 0.12 : 0) + (volley && low ? 0.7 : 0);
  if (perfect) err *= 0.6;
  if (glass) err *= 0.75;
  if (shot === 'bandeja') err *= 0.7;
  if (shot === 'portres') err *= 0.6;
  return err;
}

// The serve's scatter, in metres: small, until the bar's red top makes it wild.
export function serveSpread(power: number): number {
  const red = Math.max(0, power - SERVE_RED) / (1 - SERVE_RED);
  return 0.22 + red * 0.95;
}

// The receiver's service box: between the centre line and the side wall on boxSign's side,
// between the net and the service line. The serve's target stays inside it.
export function clampServeAim(x: number, y: number, boxSign: number, receiving: Team): { x: number; y: number } {
  const hs = halfSign(receiving);
  return { x: boxSign * clamp(x * boxSign, 0.2, HALF_W - 0.2), y: hs * clamp(y * hs, 1, SERVICE_LINE - 0.1) };
}

export const defaultServeAim = (boxSign: number, receiving: Team): { x: number; y: number } => ({
  x: boxSign * 2.5,
  y: halfSign(receiving) * 5,
});
