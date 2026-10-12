// The match: players, the ball and padel's rules. Only the host runs it; everyone else draws the
// View it sends.
import * as C from './constants.ts';
import { botInputs } from './bot.ts';
import { clamp, fwd, halfSign, hittableDistance, moveBall, other, rightX, slotX } from './court.ts';
import { gauss, pick, rand } from './rng.ts';
import type { Ball, BallEvent, MatchConfig, Player, State, Team, TickInput, View } from './types.ts';

const BOT_SPEED = 0.88;
const BOT_MISS = 0.1; // chance of an unforced error per shot
const IDLE: TickInput = { ix: 0, iy: 0, hit: false, lob: false };

type Shot = 'drive' | 'hard' | 'soft' | 'smash' | 'lob';
const SHOTS: Record<Shot, { speed: number; margin: number; depth: [number, number] }> = {
  drive: { speed: 14, margin: 0.4, depth: [5.5, 8.2] },
  hard: { speed: 18, margin: 0.2, depth: [6, 8.6] },
  soft: { speed: 9, margin: 0.35, depth: [2.8, 5.2] },
  smash: { speed: 19, margin: 0.12, depth: [4, 7] },
  lob: { speed: 0, margin: 1.2, depth: [7.8, 9.1] },
};

export function newMatch(cfg: MatchConfig, seed = (Math.random() * 2 ** 32) >>> 0): State {
  const count = (t: Team) => cfg.seats.filter((x) => x.team === t).length;
  const players: Player[] = cfg.seats.map((seat) => {
    const solo = cfg.soloAssist && count(seat.team) === 1 && count(other(seat.team)) === 2;
    return {
      ...seat,
      x: 0,
      y: halfSign(seat.team) * 7,
      speed: C.SPEED * (solo ? 1.15 : 1) * (seat.bot ? BOT_SPEED : 1),
      reach: C.REACH * (solo ? 1.2 : 1),
      maxZ: C.MAX_Z + (solo ? 0.25 : 0),
      swing: 0,
      swingKind: 'drive',
      swingIx: 0,
      swingIy: 0,
      hitDone: true,
      cooldown: 0,
      prevD: Infinity,
      nearD: Infinity,
      nearAgo: Infinity,
    };
  });
  const s: State = {
    cfg,
    players,
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, out: false },
    phase: 'serve',
    timer: 0,
    seed,
    servingTeam: 0,
    serveTurn: [0, 0],
    server: 0,
    receiver: 0,
    serveSide: 1,
    boxSign: -1,
    serveFault: 0,
    lastHitTeam: null,
    crossed: false,
    bounces: 0,
    netTouched: false,
    serveInFlight: false,
    serveReturn: false,
    rallyHits: 0,
    sinceHit: 0,
    points: [0, 0],
    games: [0, 0],
    pointWinner: null,
    message: '',
    winner: null,
    ev: { hit: 0, bounce: 0, wall: 0 },
  };
  s.servingTeam = rand(s) < 0.5 ? 0 : 1;
  setupServe(s);
  return s;
}

export const teamOf = (s: State, t: Team): Player[] =>
  s.players.filter((p) => p.team === t).sort((a, b) => a.slot - b.slot);

// Puts everyone in place for the next serve. The server serves from the right on even points
// (0-0, 15-15, 30-0...), diagonally into the receiver's box.
export function setupServe(s: State): void {
  const T = s.servingTeam;
  const R = other(T);
  const servers = teamOf(s, T);
  const receivers = teamOf(s, R);
  const server = servers[s.serveTurn[T] % servers.length];
  const sx = rightX(T) * ((s.points[0] + s.points[1]) % 2 === 0 ? 1 : -1);
  const box = -sx;
  const receiver = receivers.length === 1 ? receivers[0] : (receivers.find((p) => slotX(p) === box) ?? receivers[0]);

  const place = (p: Player, x: number, y: number) => {
    p.x = x;
    p.y = y;
  };
  place(server, sx * 2.4, halfSign(T) * 7.6);
  place(receiver, box * 2.6, halfSign(R) * 8.4);
  for (const p of servers) if (p !== server) place(p, -sx * 2.4, halfSign(T) * 3.2);
  for (const p of receivers) if (p !== receiver) place(p, -box * 2.4, halfSign(R) * 4.8);
  for (const p of s.players) {
    p.swing = 0;
    p.hitDone = true;
    p.cooldown = 0.2;
    p.prevD = Infinity;
    p.nearD = Infinity;
  }

  s.server = s.players.indexOf(server);
  s.receiver = s.players.indexOf(receiver);
  s.serveSide = sx;
  s.boxSign = box;
  s.ball = { x: server.x + rightX(T) * 0.3, y: server.y + fwd(T) * 0.25, z: 0.95, vx: 0, vy: 0, vz: 0, out: false };
  s.phase = 'serve';
  s.timer = 0;
  s.lastHitTeam = null;
  s.crossed = false;
  s.bounces = 0;
  s.netTouched = false;
  s.serveInFlight = false;
  s.serveReturn = false;
  s.rallyHits = 0;
  s.pointWinner = null;
  s.message = s.points[0] === 3 && s.points[1] === 3 ? 'Golden point' : s.serveFault ? 'Second serve' : '';
}

export function step(s: State, inputs: Record<string, TickInput>, dt = C.DT): void {
  s.timer += dt;
  s.sinceHit += dt;
  const bots = botInputs(s);
  for (const p of s.players) {
    let inp = (p.bot ? bots[p.id] : inputs[p.id]) ?? IDLE;
    if (s.phase === 'serve' && s.players[s.server] === p && s.timer > C.AUTO_SERVE) inp = { ...inp, hit: true };
    movePlayer(s, p, inp, dt);
  }

  if (s.phase === 'rally' || s.phase === 'point' || s.phase === 'over') {
    const h = dt / C.SUBSTEPS;
    for (let i = 0; i < C.SUBSTEPS; i++) {
      const ev: BallEvent[] = [];
      moveBall(s.ball, h, ev);
      for (const e of ev) {
        if (e.k === 'floor' && e.hard) s.ev.bounce++;
        if (e.k === 'wall' || e.k === 'net') s.ev.wall++;
        if (s.phase === 'rally') rule(s, e);
      }
    }
  }
  if (s.phase === 'rally') for (const p of s.players) tryHit(s, p);
  if (s.phase === 'point' && s.timer >= C.POINT_PAUSE) finishPoint(s);
}

function movePlayer(s: State, p: Player, inp: TickInput, dt: number): void {
  p.cooldown = Math.max(0, p.cooldown - dt);
  p.swing = Math.max(0, p.swing - dt);
  const serving = s.phase === 'serve' && s.players[s.server] === p;
  const len = Math.hypot(inp.ix, inp.iy);
  const k = len > 1 ? 1 / len : 1;
  if (!serving) {
    p.x += inp.ix * k * rightX(p.team) * p.speed * dt;
    p.y += inp.iy * k * fwd(p.team) * p.speed * dt;
  }
  p.x = clamp(p.x, -C.HALF_W + 0.3, C.HALF_W - 0.3);
  const hs = halfSign(p.team);
  p.y = hs * clamp(p.y * hs, 0.35, C.HALF_L - 0.3);

  if ((inp.hit || inp.lob) && p.cooldown <= 0) {
    if (serving && s.timer < C.SERVE_DELAY) return;
    p.swing = C.SWING;
    p.swingKind = inp.lob ? 'lob' : 'drive';
    p.swingIx = Math.sign(inp.ix);
    p.swingIy = Math.sign(inp.iy);
    p.hitDone = false;
    p.cooldown = C.COOLDOWN;
    p.prevD = Infinity;
    if (serving) serve(s, p);
  }
}

// Sends the ball to land at (tx, ty) at the given horizontal speed, raising the arc until it
// clears the net by margin. A lob gives its flight time instead.
function launch(b: Ball, tx: number, ty: number, speed: number, margin: number, time?: number): void {
  const dx = tx - b.x;
  const dy = ty - b.y;
  let T = time ?? Math.max(0.35, Math.hypot(dx, dy) / speed);
  const vzFor = (t: number) => (C.BALL_R - b.z + 0.5 * C.G * t * t) / t;
  for (let i = 0; i < 30; i++) {
    const tn = -b.y / (dy / T);
    if (!(tn > 0 && tn < T)) break;
    const zn = b.z + vzFor(T) * tn - 0.5 * C.G * tn * tn;
    if (zn >= C.NET_H + margin) break;
    T *= 1.06;
  }
  b.vx = dx / T;
  b.vy = dy / T;
  b.vz = vzFor(T);
  b.out = false;
}

function serve(s: State, p: Player): void {
  const T = p.team;
  const R = other(T);
  const aim = p.swingIx * rightX(T);
  const tx = s.boxSign * 2.5 + aim * 1.3 + gauss(s) * 0.3;
  const ty = halfSign(R) * (4.8 + rand(s) * 1.4) + gauss(s) * 0.3;
  s.ball.z = 0.8;
  launch(s.ball, tx, ty, p.swingIy > 0 ? 13 : 10.5, 0.25);
  s.phase = 'rally';
  s.timer = 0;
  s.serveInFlight = true;
  s.lastHitTeam = T;
  s.crossed = false;
  s.bounces = 0;
  s.netTouched = false;
  s.serveReturn = false;
  s.message = '';
  p.hitDone = true;
  s.sinceHit = 0;
  s.ev.hit++;
}

// A swing makes contact where the ball comes closest to the player, so standing well is what
// makes a good shot. A swing that comes a moment late still reaches a ball that just passed: the
// others play with a network delay.
function tryHit(s: State, p: Player): void {
  const d = hittableDistance(s, p);
  if (d <= p.reach) {
    p.nearD = Math.min(p.nearD, d);
    p.nearAgo = 0;
  } else {
    p.nearAgo += C.DT;
  }
  if (p.swing > 0 && !p.hitDone) {
    if (d <= p.reach && (d > p.prevD || d < 0.3 || p.swing <= C.DT * 1.5)) hit(s, p, d);
    else if (d > p.reach && d < Infinity && p.nearAgo <= C.LATE) hit(s, p, p.nearD);
  }
  p.prevD = d;
}

function hit(s: State, p: Player, d: number): void {
  const b = s.ball;
  const t = p.team;
  const q = clamp(1 - d / p.reach, 0, 1);
  const shot: Shot =
    p.swingKind === 'lob' ? 'lob' : b.z > C.SMASH_Z ? 'smash' : p.swingIy > 0 ? 'hard' : p.swingIy < 0 ? 'soft' : 'drive';
  const sh = SHOTS[shot];
  const aim = p.swingIx * rightX(t);
  // Off-centre contact, a fast ball and a volley all make the shot less accurate.
  const incoming = Math.hypot(b.vx, b.vy, b.vz);
  const err = 0.22 + (1 - q) * (1 - q) * 1.8 + Math.max(0, incoming - 9) * 0.045 + (s.bounces === 0 ? 0.15 : 0);
  // Bots read the ball perfectly, so they make unforced errors instead, more against a fast ball.
  const botMiss = p.bot && rand(s) < BOT_MISS + Math.max(0, incoming - 12) * 0.02;
  const miss = botMiss ? pick(s, ['long', 'wide', 'net'] as const) : null;
  let tx = (aim !== 0 ? aim * 3.2 : clamp(-b.x * 0.5 + (rand(s) - 0.5) * 2.4, -3.2, 3.2)) + gauss(s) * err;
  let depth = sh.depth[0] + rand(s) * (sh.depth[1] - sh.depth[0]) + gauss(s) * err * 1.2;
  if (miss === 'long') depth = 10.6;
  if (miss === 'wide') tx = (tx < 0 ? -1 : 1) * 5.6;
  if (miss === 'net') depth = 1.2;
  launch(b, tx, halfSign(other(t)) * depth, sh.speed, miss === 'net' ? -9 : sh.margin, shot === 'lob' ? 1.8 + rand(s) * 0.4 : undefined);
  s.lastHitTeam = t;
  s.crossed = false;
  s.bounces = 0;
  s.netTouched = false;
  s.serveReturn = false;
  s.rallyHits++;
  for (const q of s.players) q.nearD = Infinity;
  p.hitDone = true;
  s.sinceHit = 0;
  s.ev.hit++;
}

function rule(s: State, e: BallEvent): void {
  const H = s.lastHitTeam;
  if (H === null) return;
  const R = other(H);
  switch (e.k) {
    case 'net':
      s.netTouched = true;
      return;
    case 'cross':
      if (e.side === R) s.crossed = true;
      else if (s.bounces >= 1) endRally(s, H, 'Came back over the net');
      return;
    case 'floor':
      if (e.side === H) {
        if (!s.crossed) lose(s, H, s.netTouched ? 'Into the net' : 'Short of the net');
        return;
      }
      s.bounces++;
      if (s.serveInFlight) {
        s.serveInFlight = false;
        if (Math.abs(e.y) > C.SERVICE_LINE + C.BALL_R || Math.sign(e.x) !== s.boxSign) fault(s, 'out of the box');
        else s.serveReturn = true;
      } else if (s.bounces >= 2) {
        endRally(s, H, s.rallyHits === 0 ? 'Ace!' : 'Winner!');
      }
      return;
    case 'wall':
      if (e.side === R && s.bounces === 0) lose(s, H, 'Hit the glass before bouncing');
      else if (s.serveInFlight) fault(s, 'hit the glass');
      return;
    case 'out':
      if (e.side === R && s.bounces >= 1) endRally(s, H, 'Out of the court!');
      else lose(s, H, 'Out');
  }
}

function lose(s: State, hitter: Team, why: string): void {
  if (s.serveInFlight) fault(s, why.toLowerCase());
  else endRally(s, other(hitter), why);
}

function fault(s: State, why: string): void {
  s.serveInFlight = false;
  if (s.serveFault === 0) {
    s.serveFault = 1;
    endRally(s, null, `Fault: ${why}`);
  } else {
    endRally(s, other(s.servingTeam), 'Double fault');
  }
}

function endRally(s: State, winner: Team | null, why: string): void {
  s.phase = 'point';
  s.timer = 0;
  s.pointWinner = winner;
  s.message = why;
}

// Golden point: no advantage, the first to four points takes the game. The first team to
// gamesToWin games takes the match.
function finishPoint(s: State): void {
  const w = s.pointWinner;
  if (w !== null) {
    s.serveFault = 0;
    s.points[w]++;
    if (s.points[w] >= 4) {
      s.games[w]++;
      s.points = [0, 0];
      s.serveTurn[s.servingTeam]++;
      s.servingTeam = other(s.servingTeam);
      if (s.games[w] >= s.cfg.gamesToWin) {
        s.winner = w;
        s.phase = 'over';
        s.message = '';
        return;
      }
    }
  }
  setupServe(s);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function toView(s: State): View {
  return {
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      bot: p.bot,
      x: r2(p.x),
      y: r2(p.y),
      swing: r2(p.swing / C.SWING),
    })),
    ball: { x: r2(s.ball.x), y: r2(s.ball.y), z: r2(s.ball.z) },
    phase: s.phase,
    points: [s.points[0], s.points[1]],
    games: [s.games[0], s.games[1]],
    gamesToWin: s.cfg.gamesToWin,
    servingTeam: s.servingTeam,
    serverId: s.players[s.server].id,
    message: s.message,
    pointWinner: s.pointWinner,
    winner: s.winner,
    ev: [s.ev.hit, s.ev.bounce, s.ev.wall],
  };
}
