// Bots fill the empty places. They foresee where the ball goes by running the same physics ahead,
// run to the first place they can reach it, charge as it comes, and aim away from the other side.
// How well they do it is the lobby's difficulty.
import { CHARGE_FULL, DT, SERVE_FULL, SMASH_Z } from './constants.ts';
import { fwd, halfSign, hittableDistance, lerp, moveBall, other, rightX, sideOf, slotX } from './court.ts';
import type { Ball, BallEvent, Difficulty, Player, State, Team, TickInput } from './types.ts';

export interface Level {
  speed: number; // of a human's
  reaction: number; // s after the other side's hit before a bot reads it
  slop: number; // m: how far off the ideal spot a bot may stand
  miss: number; // chance of an unforced error per shot
  power: [number, number]; // how hard they hit
  smart: number; // how often they aim away from the other side
  lobAtNet: number; // how often they lob players at the net
  net: number; // how often they follow a good shot to the net
  portres: number; // how often they go for a por tres
  dive: boolean;
  serve: [number, number]; // the serve's power
  slice: number; // how often they slice a serve
  lines: number; // how near the lines they aim a serve, 0-1
}

export const LEVELS: Record<Difficulty, Level> = {
  easy: { speed: 0.8, reaction: 0.32, slop: 1.5, miss: 0.15, power: [0, 0.55], smart: 0.2, lobAtNet: 0.25, net: 0.3, portres: 0, dive: false, serve: [0.3, 0.6], slice: 0, lines: 0.2 },
  normal: { speed: 0.88, reaction: 0.22, slop: 1.1, miss: 0.1, power: [0.15, 0.85], smart: 0.5, lobAtNet: 0.35, net: 0.6, portres: 0.25, dive: true, serve: [0.45, 0.82], slice: 0.15, lines: 0.5 },
  hard: { speed: 0.97, reaction: 0.15, slop: 0.8, miss: 0.07, power: [0.3, 1], smart: 0.85, lobAtNet: 0.45, net: 0.9, portres: 0.6, dive: true, serve: [0.6, 0.9], slice: 0.3, lines: 0.8 },
};

interface Pt {
  t: number;
  x: number;
  y: number;
  z: number;
  side: Team;
  bounces: number; // on the receiving side
}

interface Plan {
  player: Player;
  pt: Pt;
  late: number; // s they would be late by
}

const IDLE: TickInput = { ix: 0, iy: 0, hold: false, press: false, lobHold: false, lobPress: false, dive: false, emote: 0 };

// A number in [0, 1) that stays the same for a bot until the next shot, so its choices hold.
function hash(s: State, p: Player, k: number): number {
  const x = Math.sin((s.place * 31 + s.rallyHits * 7 + s.players.indexOf(p) * 13 + k) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Where the ball goes. Bots don't read spin: a slice or a kick fools them until it bounces.
export function predict(s: State, seconds = 2.5): Pt[] {
  const b: Ball = { ...s.ball, spin: '' };
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
  const L = LEVELS[s.cfg.difficulty];

  if (s.phase === 'serve') {
    for (const p of bots) out[p.id] = s.players[s.server] === p ? serveInput(s, p, L) : IDLE;
    return out;
  }

  const pred = s.phase === 'rally' && !s.ball.out && s.lastHitTeam !== null ? predict(s) : [];
  const plans: Record<Team, Plan | null> = { 0: null, 1: null };
  for (const t of [0, 1] as const) {
    if (s.phase === 'rally' && s.lastHitTeam === other(t) && s.sinceHit >= L.reaction) plans[t] = plan(s, t, pred);
  }
  for (const p of bots) out[p.id] = decide(s, p, plans[p.team], L);
  return out;
}

// The serve: a target at the T, the body or wide into the glass, nearer the lines the better the
// bot, and the bar held to the power it wants.
function serveInput(s: State, p: Player, L: Level): TickInput {
  if (s.timer < 1.1) return IDLE;
  const slice = hash(s, p, 1) < L.slice;
  const want = lerp(L.serve[0], L.serve[1], hash(s, p, 2));
  const where = hash(s, p, 3);
  const margin = 0.35 + (1 - L.lines) * 1.1;
  const x = s.boxSign * (where < 0.35 ? margin : where < 0.6 ? 2.5 : 5 - margin);
  const y = halfSign(other(p.team)) * (6.95 - margin - hash(s, p, 4) * 1.2);
  const serveAim = { x, y };
  if (p.charge < 0) return { ...IDLE, press: !slice, hold: !slice, lobPress: slice, lobHold: slice, serveAim };
  const held = p.charge / SERVE_FULL < want;
  return { ...IDLE, hold: held && p.chargeKind === 'drive', lobHold: held && p.chargeKind === 'lob', serveAim };
}

// Which of the team takes the ball, and where: the earliest place someone can reach.
function plan(s: State, t: Team, pred: Pt[]): Plan | null {
  const takers = s.serveInFlight || s.serveReturn ? [s.players[s.receiver]] : s.players.filter((p) => p.team === t);
  let best: Plan | null = null;
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

const atNet = (q: Player): boolean => Math.abs(q.y) < 4.5;

function wantsLob(s: State, p: Player, L: Level, z: number): boolean {
  if (z > SMASH_Z) return false;
  const opp = s.players.filter((q) => q.team !== p.team);
  return hash(s, p, 7) < (opp.every(atNet) ? L.lobAtNet : 0.06);
}

function wantedPower(s: State, p: Player, pt: Pt, L: Level): number {
  // A por tres, against players at the back: at the net, they would volley it.
  const back = s.players.every((q) => q.team === p.team || Math.abs(q.y) > 6);
  if (pt.z > SMASH_Z && Math.abs(p.y) < 5 && back && hash(s, p, 6) < L.portres) return 1;
  // Hard at players at the net, softer otherwise.
  const lo = s.players.every((q) => q.team === p.team || atNet(q)) && hash(s, p, 13) < L.smart ? (L.power[0] + L.power[1]) / 2 : L.power[0];
  return lerp(lo, L.power[1], hash(s, p, 5));
}

// The arrows at contact: away from the other side (down the middle between two); from the net,
// short and wide past players at the back; otherwise deep against them, and short at the feet of
// players at the net.
function aimFor(s: State, p: Player, L: Level): [number, number] {
  const opp = s.players.filter((q) => q.team !== p.team);
  if (hash(s, p, 8) < L.smart) {
    const avg = opp.reduce((a, q) => a + q.x, 0) / opp.length;
    let side = Math.abs(avg) > 0.6 ? -Math.sign(avg) : hash(s, p, 9) < 0.5 ? -1 : 1;
    const angle = atNet(p) && !opp.some(atNet) && hash(s, p, 10) < 0.6;
    if (!angle && opp.length === 2 && hash(s, p, 10) < 0.3) side = 0;
    const iy = angle || opp.every(atNet) ? -1 : hash(s, p, 11) < 0.25 ? -1 : 1;
    return [side * rightX(p.team), iy];
  }
  const side = [-1, 0, 0, 1][Math.floor(hash(s, p, 9) * 4)];
  const r = hash(s, p, 11);
  return [side * rightX(p.team), r < 0.25 ? 1 : r < 0.37 ? -1 : 0];
}

// Where to wait: at the net after a good shot of their own, back when lobbed, and towards the
// middle while the partner takes the ball.
function home(s: State, p: Player, pl: Plan | null, L: Level): [number, number] {
  const hs = halfSign(p.team);
  const opp = s.players.filter((q) => q.team !== p.team);
  let depth: number;
  if (s.lastHitTeam === p.team) {
    const good = s.lastShot === 'lob' || s.lastShot === 'bandeja' || s.lastShot === 'smash' || opp.every((q) => Math.abs(q.y) > 6.5);
    depth = good && hash(s, p, 12) < L.net ? 3.2 : 6;
  } else {
    depth = s.lastShot === 'lob' ? 8.4 : atNet(p) && s.lastShot !== 'smash' && s.lastShot !== 'portres' ? 3.4 : 7.4;
  }
  const mates = s.players.filter((q) => q.team === p.team).length;
  if (mates === 1) return [s.ball.x * 0.3, hs * depth];
  const partnerTakes = !!pl && pl.player !== p;
  return [slotX(p) * (partnerTakes ? 1.1 : 2.4), hs * depth];
}

function decide(s: State, p: Player, pl: Plan | null, L: Level): TickInput {
  if (p.dive > 0 || p.down > 0) return IDLE;
  const rally = s.phase === 'rally';
  const mine = !!pl && pl.player === p;
  // The ball is here and they aren't charging: a quick swing.
  if (rally && p.charge < 0 && p.cooldown <= 0 && hittableDistance(s, p) <= p.reach * 0.95) {
    const lob = wantsLob(s, p, L, s.ball.z);
    return { ...IDLE, press: !lob, lobPress: lob, shotAim: aimFor(s, p, L) };
  }
  const holding: TickInput = { ...IDLE, hold: p.chargeKind === 'drive', lobHold: p.chargeKind === 'lob', shotAim: aimFor(s, p, L) };
  if (rally && s.lastHitTeam !== p.team && s.sinceHit < L.reaction) return p.charge >= 0 ? holding : IDLE;

  // Bots aim to stand a little off the ideal spot, differently for each shot, so they miss too;
  // more so against a hard shot, which rushes them.
  const off = (n: number) => hash(s, p, 20 + n) - 0.5;
  const slop = L.slop * (1 + Math.max(0, s.shot.kmh / 3.6 - 13) * 0.08);
  const [tx, ty] = mine ? [pl.pt.x + off(1) * slop, pl.pt.y + halfSign(p.team) * 0.2 + off(2) * slop] : home(s, p, pl, L);
  const wx = tx - p.x;
  const wy = ty - p.y;
  const d = Math.hypot(wx, wy);
  const k = d < 0.08 ? 0 : Math.min(1, d / 0.4) / d;
  const inp: TickInput = { ...(p.charge >= 0 && mine ? holding : IDLE), ix: wx * k * rightX(p.team), iy: wy * k * fwd(p.team) };
  if (!mine || !rally) return inp;

  // Charge as the ball comes, so the swing is as hard as they want when it arrives.
  const lob = wantsLob(s, p, L, pl.pt.z);
  const power = wantedPower(s, p, pl.pt, L);
  if (p.charge < 0 && p.cooldown <= 0 && pl.pt.t <= power * CHARGE_FULL + 0.05 && (d < 0.6 || pl.pt.t < 0.15)) {
    Object.assign(inp, { press: !lob, hold: !lob, lobPress: lob, lobHold: lob });
  }
  inp.shotAim = aimFor(s, p, L);
  // A dive for a ball they can't run to.
  if (L.dive && pl.late > 0.06 && pl.pt.t < 0.35 && d > p.reach && d < 2.4 && p.diveCd <= 0) inp.dive = true;
  return inp;
}
