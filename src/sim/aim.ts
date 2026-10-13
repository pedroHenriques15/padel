// Where shots go. Shared by the match and the screen, which shows the player their target.
import { HALF_W, SERVICE_LINE, SMASH_Z } from './constants.ts';
import { clamp, halfSign, rightX } from './court.ts';
import type { Shot, SwingKind, Team } from './types.ts';

// How deep each shot lands, in metres from the net: short (↓), plain, deep (↑).
const DEPTHS: Record<Shot, [number, number, number]> = {
  serve: [4, 5, 6],
  drive: [3.4, 6.4, 8.4],
  lob: [7.4, 8.3, 9],
  bandeja: [5.6, 7.6, 8.6],
  smash: [4.2, 6, 7.8],
  portres: [3, 3.2, 3.4],
  dig: [6.5, 6.5, 6.5],
  frame: [5, 5, 5],
};

// Which shot a swing makes: an overhead is a bandeja when hit softly, a smash when hit hard, and
// a por tres when hit as hard as it gets, from near the net.
export function shotKind(kind: SwingKind, power: number, ballZ: number, hitterY: number): Shot {
  if (kind === 'lob') return 'lob';
  if (ballZ <= SMASH_Z) return 'drive';
  if (power >= 0.9 && Math.abs(hitterY) < 5) return 'portres';
  return power < 0.35 ? 'bandeja' : 'smash';
}

// The target of a shot by team, with the arrows ix, iy held, the ball at ballX: ←/→ choose the
// side, ↑/↓ deep or short. With neither, it goes crosscourt, more sharply from wide.
export function shotTarget(team: Team, ix: number, iy: number, ballX: number, shot: Shot): { x: number; y: number } {
  const side = Math.sign(ix) * rightX(team);
  const x = side !== 0 ? side * 3.3 : Math.abs(ballX) > 0.8 ? -Math.sign(ballX) * Math.min(3.4, 1.8 + Math.abs(ballX) * 0.35) : 0;
  const d = DEPTHS[shot];
  const depth = iy > 0 ? d[2] : iy < 0 ? d[0] : d[1];
  return { x, y: -halfSign(team) * depth };
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
