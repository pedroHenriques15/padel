// Bots fill the empty places. They foresee where the ball goes by running the same physics ahead,
// run to the first place they can reach it, and swing when it comes.
import { DT } from './constants.ts';
import { fwd, halfSign, hittableDistance, moveBall, other, rightX, sideOf, slotX } from './court.ts';
import { pick, rand } from './rng.ts';
import type { Ball, BallEvent, Player, State, Team, TickInput } from './types.ts';

interface Pt {
  t: number;
  x: number;
  y: number;
  z: number;
  side: Team;
  bounces: number; // on the receiving side
}

const IDLE: TickInput = { ix: 0, iy: 0, hit: false, lob: false };

const REACTION = 0.22; // s after the other side's hit before a bot reads it
const SLOP = 1.2; // m: how far off the ideal spot a bot may stand

export function predict(s: State, seconds = 2.5): Pt[] {
  const b: Ball = { ...s.ball };
  const receiving = s.lastHitTeam === null ? null : other(s.lastHitTeam);
  let bounces = s.bounces;
  const pts: Pt[] = [];
  const h = DT / 2;
  for (let i = 1, t = h; t < seconds; i++, t += h) {
    const ev: BallEvent[] = [];
    moveBall(b, h, ev);
    for (const e of ev) if (e.k === 'floor' && e.side === receiving) bounces++;
    if (b.out || bounces >= 2) break;
    if (i % 2 === 0) pts.push({ t, x: b.x, y: b.y, z: b.z, side: sideOf(b.y), bounces });
  }
  return pts;
}

export function botInputs(s: State): Record<string, TickInput> {
  const out: Record<string, TickInput> = {};
  const bots = s.players.filter((p) => p.bot);
  if (bots.length === 0) return out;

  if (s.phase === 'serve') {
    for (const p of bots) {
      const serving = s.players[s.server] === p && s.timer > 1.1;
      out[p.id] = serving ? { ix: pick(s, [-1, 0, 0, 1]), iy: rand(s) < 0.3 ? 1 : 0, hit: true, lob: false } : IDLE;
    }
    return out;
  }

  const pred = s.phase === 'rally' && !s.ball.out && s.lastHitTeam !== null ? predict(s) : [];
  const plans: Record<Team, { player: Player; pt: Pt } | null> = { 0: null, 1: null };
  for (const t of [0, 1] as const) {
    if (s.phase === 'rally' && s.lastHitTeam === other(t) && s.sinceHit >= REACTION) plans[t] = plan(s, t, pred);
  }
  for (const p of bots) out[p.id] = decide(s, p, plans[p.team]);
  return out;
}

// Which of the team takes the ball, and where: the earliest place someone can reach.
function plan(s: State, t: Team, pred: Pt[]): { player: Player; pt: Pt } | null {
  const takers = s.serveInFlight || s.serveReturn ? [s.players[s.receiver]] : s.players.filter((p) => p.team === t);
  let best: { player: Player; pt: Pt; late: number } | null = null;
  for (const m of takers) {
    const r = intercept(s, m, pred);
    if (r && (!best || r.late < best.late || (r.late <= 0 && best.late <= 0 && r.pt.t < best.pt.t))) {
      best = { player: m, ...r };
    }
  }
  return best;
}

function intercept(s: State, m: Player, pred: Pt[]): { pt: Pt; late: number } | null {
  let best: { pt: Pt; late: number } | null = null;
  for (const pt of pred) {
    if (pt.side !== m.team || pt.z < 0.2 || pt.z > m.maxZ * 0.92) continue;
    const volley = !s.serveInFlight && pt.bounces === 0 && Math.abs(pt.y) < 4 && pt.z > 0.5;
    if (pt.bounces < 1 && !volley) continue;
    const need = Math.max(0, Math.hypot(pt.x - m.x, pt.y - m.y) - m.reach * 0.6) / m.speed;
    const late = need - pt.t;
    if (late <= 0) return { pt, late };
    if (!best || late < best.late) best = { pt, late };
  }
  return best;
}

function home(s: State, p: Player): [number, number] {
  const hs = halfSign(p.team);
  const depth = s.lastHitTeam === p.team ? 5.6 : 7.2;
  const mates = s.players.filter((q) => q.team === p.team).length;
  return mates === 1 ? [s.ball.x * 0.3, hs * depth] : [slotX(p) * 2.4, hs * depth];
}

function decide(s: State, p: Player, pl: { player: Player; pt: Pt } | null): TickInput {
  if (s.phase === 'rally' && p.cooldown <= 0 && hittableDistance(s, p) <= p.reach * 0.95) {
    const oppAtNet = s.players.filter((q) => q.team !== p.team).every((q) => Math.abs(q.y) < 4.5);
    const lob = rand(s) < (oppAtNet ? 0.35 : 0.15);
    const r = rand(s);
    return { ix: pick(s, [-1, 0, 0, 1]), iy: r < 0.25 ? 1 : r < 0.37 ? -1 : 0, hit: !lob, lob };
  }
  // Bots aim to stand a little off the ideal spot, differently for each shot, so they miss too.
  const i = s.players.indexOf(p);
  const off = (n: number) => (Math.abs(Math.sin(s.rallyHits * 12.9898 + i * 78.233 + n) * 43758.5453) % 1) - 0.5;
  const reacting = s.phase === 'rally' && s.lastHitTeam !== p.team && s.sinceHit < REACTION;
  if (reacting) return IDLE;
  const [tx, ty] =
    pl && pl.player === p
      ? [pl.pt.x + off(1) * SLOP, pl.pt.y + halfSign(p.team) * 0.2 + off(2) * SLOP]
      : home(s, p);
  const wx = tx - p.x;
  const wy = ty - p.y;
  const d = Math.hypot(wx, wy);
  if (d < 0.08) return IDLE;
  const k = Math.min(1, d / 0.4) / d;
  return { ix: wx * k * rightX(p.team), iy: wy * k * fwd(p.team), hit: false, lob: false };
}
