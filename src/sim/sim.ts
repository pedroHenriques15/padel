// The match: players, the ball and padel's rules. Only the host runs it; everyone else draws the
// View it sends.
import * as C from './constants.ts';
import { clampServeAim, defaultServeAim, shotKind, shotTarget } from './aim.ts';
import { clampBody, moveBody, type Limits } from './body.ts';
import { botInputs, LEVELS } from './bot.ts';
import { clamp, fwd, halfSign, hittableDistance, lerp, moveBall, other, rightX, slotX } from './court.ts';
import { gauss, pick, rand } from './rng.ts';
import type { Ball, BallEvent, FormatKey, MatchConfig, Player, Shot, Spin, State, SwingKind, Team, TickInput, View } from './types.ts';

const IDLE: TickInput = { ix: 0, iy: 0, hold: false, press: false, lobHold: false, lobPress: false, dive: false, emote: 0 };

export const FORMATS: Record<FormatKey, { label: string; games?: number; sets?: number }> = {
  g1: { label: 'First to 1 game', games: 1 },
  g2: { label: 'First to 2 games', games: 2 },
  g3: { label: 'First to 3 games', games: 3 },
  g4: { label: 'First to 4 games', games: 4 },
  g6: { label: 'First to 6 games', games: 6 },
  s1: { label: 'One set', sets: 1 },
  s3: { label: 'Best of 3 sets', sets: 3 },
};

export const EMOTES = ['Vamos!', '😂', 'Sorry!', '👏'];

export function newMatch(cfg: MatchConfig, seed = (Math.random() * 2 ** 32) >>> 0): State {
  const level = LEVELS[cfg.difficulty];
  const count = (t: Team) => cfg.seats.filter((x) => x.team === t).length;
  const players: Player[] = cfg.seats.map((seat) => {
    const solo = cfg.soloAssist && count(seat.team) === 1 && count(other(seat.team)) === 2;
    return {
      ...seat,
      x: 0,
      y: halfSign(seat.team) * 7,
      vx: 0,
      vy: 0,
      speed: C.SPEED * (solo ? 1.15 : 1) * (seat.bot ? level.speed : 1),
      reach: C.REACH * (solo ? 1.2 : 1),
      maxZ: C.MAX_Z + (solo ? 0.25 : 0),
      swing: 0,
      swingKind: 'drive',
      power: 0,
      hitDone: true,
      cooldown: 0,
      charge: -1,
      chargeKind: 'drive',
      armed: null,
      aimIx: 0,
      aimIy: 0,
      prevD: Infinity,
      nearD: Infinity,
      nearAgo: Infinity,
      dive: 0,
      down: 0,
      diveCd: 0,
      diveX: 0,
      diveY: 0,
      aimX: 0,
      aimY: 0,
      emote: 0,
      emoteT: 0,
    };
  });
  const s: State = {
    cfg,
    players,
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: '', out: false },
    phase: 'serve',
    timer: 0,
    seed,
    place: 0,
    servingTeam: 0,
    serveTurn: [0, 0],
    server: 0,
    receiver: 0,
    serveSide: 1,
    boxSign: -1,
    serveFault: 0,
    lastHitTeam: null,
    lastHitter: -1,
    lastShot: null,
    crossed: false,
    bounces: 0,
    netTouched: false,
    offGlass: false,
    marked: false,
    serveInFlight: false,
    serveReturn: false,
    rallyHits: 0,
    sinceHit: 0,
    points: [0, 0],
    games: [0, 0],
    sets: [0, 0],
    setScores: [],
    tiebreak: false,
    tbFirst: 0,
    pointWinner: null,
    message: '',
    winner: null,
    stats: Object.fromEntries(players.map((p) => [p.id, { aces: 0, winners: 0, errors: 0, smashes: 0, fastest: 0 }])),
    longest: 0,
    shot: { n: 0, id: '', kmh: 0, tag: '' },
    mark: { n: 0, x: 0, y: 0 },
    ev: { hit: 0, bounce: 0, wall: 0, net: 0, smash: 0, mesh: 0, ooh: 0, cheer: 0 },
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
    p.vx = p.vy = 0;
    p.swing = 0;
    p.hitDone = true;
    p.cooldown = 0.2;
    p.charge = -1;
    p.armed = null;
    p.dive = p.down = 0;
    p.prevD = Infinity;
    p.nearD = Infinity;
  }
  const aim = defaultServeAim(box, R);
  server.aimX = aim.x;
  server.aimY = aim.y;

  s.place++;
  s.server = s.players.indexOf(server);
  s.receiver = s.players.indexOf(receiver);
  s.serveSide = sx;
  s.boxSign = box;
  s.ball = { x: 0, y: 0, z: 0.95, vx: 0, vy: 0, vz: 0, spin: '', out: false };
  holdBall(s);
  s.phase = 'serve';
  s.timer = 0;
  s.lastHitTeam = null;
  s.lastHitter = -1;
  s.lastShot = null;
  s.crossed = false;
  s.bounces = 0;
  s.netTouched = false;
  s.offGlass = false;
  s.serveInFlight = false;
  s.serveReturn = false;
  s.rallyHits = 0;
  s.pointWinner = null;
  s.message = s.serveFault
    ? 'Second serve'
    : s.tiebreak
      ? s.points[0] + s.points[1] === 0
        ? 'Tie-break'
        : ''
      : s.points[0] === 3 && s.points[1] === 3
        ? 'Golden point'
        : '';
}

// Before the serve, the ball is in the server's hand.
function holdBall(s: State): void {
  const p = s.players[s.server];
  const T = p.team;
  s.ball.x = p.x + rightX(T) * 0.3;
  s.ball.y = p.y + fwd(T) * 0.25;
  s.ball.z = p.charge >= 0 ? 0.8 : 0.95;
}

export function step(s: State, inputs: Record<string, TickInput>, dt = C.DT): void {
  s.timer += dt;
  s.sinceHit += dt;
  const bots = botInputs(s);
  for (const p of s.players) control(s, p, (p.bot ? bots[p.id] : inputs[p.id]) ?? IDLE, dt);
  if (s.phase === 'serve') holdBall(s);

  if (s.phase === 'rally' || s.phase === 'point' || s.phase === 'over') {
    const h = dt / C.SUBSTEPS;
    for (let i = 0; i < C.SUBSTEPS; i++) {
      const ev: BallEvent[] = [];
      moveBall(s.ball, h, ev);
      for (const e of ev) {
        if (e.k === 'floor' && e.hard) s.ev.bounce++;
        if (e.k === 'wall') s.ev[e.mesh ? 'mesh' : 'wall']++;
        if (e.k === 'net' || e.k === 'cord') s.ev.net++;
        if (s.phase === 'rally') rule(s, e);
      }
    }
  }
  if (s.phase === 'rally') for (const p of s.players) tryHit(s, p);
  if (s.phase === 'point' && s.timer >= C.POINT_PAUSE) finishPoint(s);
}

function control(s: State, p: Player, inp: TickInput, dt: number): void {
  p.cooldown = Math.max(0, p.cooldown - dt);
  p.swing = Math.max(0, p.swing - dt);
  p.emoteT = Math.max(0, p.emoteT - dt);
  if (p.emoteT === 0) p.emote = 0;
  if (inp.emote >= 1 && inp.emote <= 4 && p.emoteT < C.EMOTE_TIME - 0.6) {
    p.emote = inp.emote;
    p.emoteT = C.EMOTE_TIME;
  }
  p.aimIx = inp.shotAim ? inp.shotAim[0] : Math.sign(inp.ix);
  p.aimIy = inp.shotAim ? inp.shotAim[1] : Math.sign(inp.iy);

  const serving = s.phase === 'serve' && s.players[s.server] === p;
  const limits: Limits = { team: p.team, serveSide: serving ? s.serveSide : 0, frozen: serving && p.charge >= 0, slow: p.charge >= 0, speed: p.speed };
  const wasDiving = p.dive > 0;
  moveBody(p, inp.ix, inp.iy, inp.dive, limits, dt);
  // A remote player moves on their own screen: where they say they are counts, once they have
  // seen where the last serve put them.
  if (inp.pose && inp.pose.place === s.place) {
    p.x = inp.pose.x;
    p.y = inp.pose.y;
    clampBody(p, limits);
  }
  if (p.dive > 0 && !wasDiving) {
    p.charge = -1;
    p.armed = null;
  }

  if (serving) serveControl(s, p, inp, dt);
  else swingControl(p, inp, dt);
}

// Hold the hit key (or K, for a slice) and the power bar fills; the arrows move the target in the
// box; let go to serve.
function serveControl(s: State, p: Player, inp: TickInput, dt: number): void {
  const T = p.team;
  const R = other(T);
  if (p.charge < 0) {
    if (s.timer < C.SERVE_DELAY) {
      // Too early: a tap does nothing, but a key held through the wait starts the serve.
      if ((inp.press && inp.hold) || (inp.lobPress && inp.lobHold)) p.armed = inp.lobPress ? 'lob' : 'drive';
      if (p.armed && !(p.armed === 'lob' ? inp.lobHold : inp.hold)) p.armed = null;
      return;
    }
    if (inp.press || inp.lobPress || p.armed) {
      p.chargeKind = inp.lobPress ? 'lob' : inp.press ? 'drive' : p.armed!;
      p.armed = null;
      p.charge = 0;
    } else {
      if (s.timer > C.AUTO_SERVE) serve(s, p, 0.55, false);
      return;
    }
  }
  if (inp.serveAim && (!inp.pose || inp.pose.place === s.place)) {
    p.aimX = inp.serveAim.x;
    p.aimY = inp.serveAim.y;
  } else if (!inp.pose) {
    p.aimX += Math.sign(inp.ix) * rightX(T) * C.AIM_SPEED * dt;
    p.aimY += Math.sign(inp.iy) * fwd(T) * C.AIM_SPEED * dt;
  }
  const a = clampServeAim(p.aimX, p.aimY, s.boxSign, R);
  p.aimX = a.x;
  p.aimY = a.y;
  const held = p.chargeKind === 'lob' ? inp.lobHold : inp.hold;
  if (held && p.charge < C.SERVE_HOLD) {
    p.charge += dt;
    return;
  }
  serve(s, p, Math.min(1, p.charge / C.SERVE_FULL), p.chargeKind === 'lob');
}

// Press and hold the hit key to charge: the longer, the harder. Let go to swing, or keep holding
// and the swing comes by itself as the ball arrives.
function swingControl(p: Player, inp: TickInput, dt: number): void {
  if (p.dive > 0 || p.down > 0) return;
  if (inp.press) p.armed = 'drive';
  if (inp.lobPress) p.armed = 'lob';
  if (p.armed && p.charge < 0 && p.cooldown <= 0) {
    p.charge = 0;
    p.chargeKind = p.armed;
    p.armed = null;
  }
  if (p.charge < 0) return;
  if (p.chargeKind === 'lob' ? inp.lobHold : inp.hold) {
    p.charge = Math.min(C.CHARGE_FULL, p.charge + dt);
    return;
  }
  p.swing = C.SWING;
  p.swingKind = p.chargeKind;
  p.power = p.charge / C.CHARGE_FULL;
  p.hitDone = false;
  p.cooldown = C.COOLDOWN;
  p.prevD = Infinity;
  p.charge = -1;
}

// Sends the ball to land at (tx, ty) at the given horizontal speed, raising the arc until it
// clears the net by margin. A lob gives its flight time instead.
function launch(b: Ball, tx: number, ty: number, speed: number, margin: number, time?: number): void {
  const dx = tx - b.x;
  const dy = ty - b.y;
  let T = time ?? Math.max(0.2, Math.hypot(dx, dy) / speed);
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

const kmh = (b: Ball) => Math.round(Math.hypot(b.vx, b.vy, b.vz) * 3.6);

function shotDone(s: State, p: Player, shot: Shot, tag: string): void {
  const k = kmh(s.ball);
  s.shot = { n: s.shot.n + 1, id: p.id, kmh: k, tag };
  const st = s.stats[p.id];
  st.fastest = Math.max(st.fastest, k);
  if (shot === 'smash' || shot === 'portres') st.smashes++;
  s.ev[shot === 'smash' || shot === 'portres' ? 'smash' : 'hit']++;
  s.lastHitTeam = p.team;
  s.lastHitter = s.players.indexOf(p);
  s.lastShot = shot;
  s.crossed = false;
  s.bounces = 0;
  s.netTouched = false;
  s.offGlass = false;
  s.marked = false;
  s.sinceHit = 0;
  for (const q of s.players) q.nearD = Infinity;
  p.hitDone = true;
  p.charge = -1;
}

// The serve: the power bar sets the pace, and its red top makes the serve wild. A slice is
// slower, and stays low after the bounce.
function serve(s: State, p: Player, power: number, slice: boolean): void {
  const red = Math.max(0, power - C.SERVE_RED) / (1 - C.SERVE_RED);
  const wild = 0.22 + red * 0.95;
  const tx = p.aimX + gauss(s) * wild;
  const ty = p.aimY + gauss(s) * wild;
  const speed = slice ? lerp(7, 12.5, power) : lerp(8, 17.5, power);
  const margin = slice ? 0.3 : lerp(0.32, 0.1, power) - red * Math.abs(gauss(s)) * 0.25;
  s.ball.z = 0.8;
  launch(s.ball, tx, ty, speed, margin);
  s.ball.spin = slice ? 'slice' : '';
  s.phase = 'rally';
  s.timer = 0;
  s.serveInFlight = true;
  s.serveReturn = false;
  s.message = '';
  p.cooldown = C.COOLDOWN;
  p.swing = C.SWING;
  shotDone(s, p, 'serve', slice ? 'Slice serve' : '');
}

// A swing makes contact where the ball comes closest to the player, so standing well is what
// makes a good shot. A swing that comes a moment late still reaches a ball that just passed: the
// others play with a network delay. A held charge is a swing that waits for the ball.
function tryHit(s: State, p: Player): void {
  const d = hittableDistance(s, p);
  const reach = p.reach * (p.dive > 0 ? C.DIVE_REACH : 1);
  if (d <= reach) {
    p.nearD = Math.min(p.nearD, d);
    p.nearAgo = 0;
  } else {
    p.nearAgo += C.DT;
  }
  if (p.dive > 0) {
    if (d <= reach) hit(s, p, d / C.DIVE_REACH, 0.1, 'dig');
    p.prevD = d;
    return;
  }
  const charging = p.charge >= 0;
  if (charging || (p.swing > 0 && !p.hitDone)) {
    const power = charging ? p.charge / C.CHARGE_FULL : p.power;
    const kind = charging ? p.chargeKind : p.swingKind;
    const ending = !charging && p.swing <= C.DT * 1.5;
    if (d <= p.reach && (d > p.prevD || d < 0.3 || ending)) hit(s, p, d, power, kind);
    else if (d > p.reach && d < Infinity && p.nearAgo <= C.LATE && p.nearD < Infinity) hit(s, p, p.nearD, power, kind);
  }
  p.prevD = d;
}

function hit(s: State, p: Player, d: number, power: number, kind: SwingKind | 'dig'): void {
  const b = s.ball;
  const t = p.team;
  const level = LEVELS[s.cfg.difficulty];
  const q = clamp(1 - d / p.reach, 0, 1);
  let shot: Shot = kind === 'dig' ? 'dig' : q < 0.1 ? 'frame' : shotKind(kind, power, b.z, p.y);
  if (shot === 'portres' && q < 0.35) shot = 'smash';
  const perfect = q >= 0.75 && shot !== 'dig' && shot !== 'frame';
  const glass = s.offGlass && (shot === 'drive' || shot === 'lob');
  const incoming = Math.hypot(b.vx, b.vy, b.vz);

  // How far off the target it may go, in metres: off-centre contact, power, a fast ball and a
  // volley all add to it; a clean hit and a ball off the glass take from it.
  // A volley at the feet is the hardest of all.
  const volley = s.bounces === 0;
  let err = 0.2 + (1 - q) ** 2 * 1.7 * (0.7 + 0.6 * power) + power * 0.3 + Math.max(0, incoming - 10) * 0.04 + (volley ? 0.12 : 0) + (volley && b.z < 0.55 ? 0.7 : 0);
  if (perfect) err *= 0.6;
  if (glass) err *= 0.75;
  if (shot === 'bandeja') err *= 0.7;
  if (shot === 'portres') err *= 0.6;

  const aim = shotTarget(t, p.aimIx, p.aimIy, b.x, shot);
  const ys = -halfSign(t); // the y sign of the other half
  let tx = aim.x + gauss(s) * err;
  let depth = Math.max(0.5, Math.abs(aim.y) + gauss(s) * err * 1.1);
  let speed = 0;
  let margin = 0.3;
  let time: number | undefined;
  let spin: Spin = '';
  let tag = '';
  switch (shot) {
    case 'drive':
      speed = lerp(9, 22, power) * (perfect ? 1.08 : 1) * (glass ? 1.1 : 1);
      margin = lerp(0.42, 0.14, power) + gauss(s) * err * 0.08;
      tag = perfect ? 'Perfect!' : glass && power > 0.4 ? 'Off the glass' : '';
      break;
    case 'lob':
      time = lerp(1.5, 2.2, power);
      margin = 1.2;
      tag = perfect ? 'Perfect!' : '';
      break;
    case 'bandeja':
      speed = 13;
      spin = 'slice';
      tag = 'Bandeja';
      break;
    case 'smash':
      speed = lerp(15, 25, power) * (perfect ? 1.06 : 1);
      margin = 0.12 + gauss(s) * err * 0.06;
      tag = power > 0.6 ? 'Smash!' : 'Víbora';
      break;
    case 'portres':
      speed = 26;
      margin = 0.1;
      spin = 'kick';
      tag = 'Smash!';
      break;
    case 'dig':
      time = 1.4 + rand(s) * 0.3;
      tx = gauss(s) * 1.5;
      depth = 6.5 + gauss(s);
      tag = 'Diving save!';
      break;
    case 'frame':
      time = 1.1;
      tx = aim.x * 0.3 + gauss(s) * 2.2;
      depth = 3 + rand(s) * 6;
      tag = 'Frame!';
      break;
  }
  // Bots read the ball perfectly, so they make unforced errors instead, more against a fast ball.
  if (p.bot && shot !== 'dig' && rand(s) < level.miss + Math.max(0, incoming - 13) * 0.015 + (volley && b.z < 0.55 ? 0.12 : 0)) {
    const miss = pick(s, ['long', 'wide', 'net'] as const);
    if (miss === 'long') depth = 10.6;
    if (miss === 'wide') tx = (tx < 0 ? -1 : 1) * 5.6;
    if (miss === 'net') {
      depth = 1.2;
      margin = -9;
      time = undefined;
      speed = Math.max(speed, 10);
    }
  }
  launch(b, tx, ys * depth, speed, margin, time);
  b.spin = spin;
  s.rallyHits++;
  s.serveReturn = false;
  p.swing = Math.max(p.swing, C.SWING * 0.7);
  p.cooldown = Math.max(p.cooldown, C.COOLDOWN * 0.6);
  shotDone(s, p, shot, tag);
}

type Credit = 'winner' | 'ace' | 'error' | null;

function rule(s: State, e: BallEvent): void {
  const H = s.lastHitTeam;
  if (H === null) return;
  const R = other(H);
  switch (e.k) {
    case 'net':
    case 'cord':
      s.netTouched = true;
      return;
    case 'cross':
      if (e.side === R) s.crossed = true;
      else if (s.bounces >= 1) endRally(s, H, 'Came back over the net', 'winner');
      return;
    case 'floor':
      if (!s.marked) {
        s.marked = true;
        s.mark = { n: s.mark.n + 1, x: e.x, y: e.y };
      }
      if (e.side === H) {
        if (!s.crossed) lose(s, H, s.netTouched ? 'Into the net' : 'Short of the net');
        return;
      }
      s.bounces++;
      if (s.serveInFlight) {
        s.serveInFlight = false;
        if (Math.abs(e.y) > C.SERVICE_LINE + C.BALL_R || Math.sign(e.x) !== s.boxSign) fault(s, 'out of the box');
        else if (s.netTouched) {
          s.ev.ooh++;
          endRally(s, null, 'Let: it clipped the net. Serve again', null);
        } else s.serveReturn = true;
      } else if (s.bounces >= 2) {
        endRally(s, H, s.rallyHits === 0 ? 'Ace!' : 'Winner!', s.rallyHits === 0 ? 'ace' : 'winner');
      }
      return;
    case 'wall':
      if (e.side === R && s.bounces === 0) lose(s, H, 'Hit the glass before bouncing');
      else if (e.side === R) s.offGlass = true;
      return;
    case 'out':
      if (e.side === R && s.bounces >= 1) {
        const portres = s.lastShot === 'portres';
        if (portres) s.ev.cheer++;
        endRally(s, H, portres ? 'Por tres!' : 'Out of the court!', s.rallyHits === 0 ? 'ace' : 'winner');
      } else lose(s, H, 'Out');
  }
}

function lose(s: State, hitter: Team, why: string): void {
  if (s.serveInFlight) fault(s, why.toLowerCase());
  else endRally(s, other(hitter), why, 'error');
}

function fault(s: State, why: string): void {
  s.serveInFlight = false;
  if (s.serveFault === 0) {
    s.serveFault = 1;
    endRally(s, null, `Fault: ${why}`, null);
  } else {
    endRally(s, other(s.servingTeam), 'Double fault', 'error');
  }
}

// The rally is over. credit says what it was for whoever hit last: a winner, an ace or an error.
function endRally(s: State, winner: Team | null, why: string, credit: Credit): void {
  s.phase = 'point';
  s.timer = 0;
  s.pointWinner = winner;
  s.message = why;
  const shots = s.rallyHits + 1;
  s.longest = Math.max(s.longest, shots);
  const p = s.players[s.lastHitter];
  if (!p || !credit) return;
  const st = s.stats[p.id];
  if (credit === 'ace') st.aces++;
  if (credit === 'winner') st.winners++;
  if (credit === 'error') st.errors++;
  if (shots >= 8) s.ev[credit === 'error' ? 'ooh' : 'cheer']++;
  else if (credit === 'ace') s.ev.ooh++;
  // Bots celebrate now and then, and say sorry.
  if (p.bot && credit !== 'error' && rand(s) < 0.3) Object.assign(p, { emote: 1, emoteT: C.EMOTE_TIME });
  if (p.bot && credit === 'error' && rand(s) < 0.12) Object.assign(p, { emote: 3, emoteT: C.EMOTE_TIME });
}

// Golden point: no advantage, the first to four points takes the game. A tie-break goes to seven,
// by two. Then the format: the first to N games, or sets of six games, by two, with a tie-break
// at 6-6.
function finishPoint(s: State): void {
  const w = s.pointWinner;
  if (w !== null) {
    s.serveFault = 0;
    s.points[w]++;
    if (s.tiebreak) {
      if (s.points[w] >= 7 && s.points[w] - s.points[other(w)] >= 2) {
        if (gameWon(s, w)) return;
      } else if ((s.points[0] + s.points[1]) % 2 === 1) {
        // In a tie-break the serve changes after the first point, then every two.
        s.serveTurn[s.servingTeam]++;
        s.servingTeam = other(s.servingTeam);
      }
    } else if (s.points[w] >= 4) {
      if (gameWon(s, w)) return;
    }
  }
  setupServe(s);
}

// Returns true when it wins the match.
function gameWon(s: State, w: Team): boolean {
  const f = FORMATS[s.cfg.format];
  const wasTiebreak = s.tiebreak;
  s.games[w]++;
  s.points = [0, 0];
  s.tiebreak = false;
  if (wasTiebreak) {
    // Whoever served first in the tie-break receives first in the next set.
    s.servingTeam = other(s.tbFirst);
  } else {
    s.serveTurn[s.servingTeam]++;
    s.servingTeam = other(s.servingTeam);
  }
  if (f.games) return s.games[w] >= f.games && over(s, w);
  const o = other(w);
  if (wasTiebreak || (s.games[w] >= 6 && s.games[w] - s.games[o] >= 2)) {
    s.sets[w]++;
    s.setScores.push([s.games[0], s.games[1]]);
    s.games = [0, 0];
    return s.sets[w] > f.sets! / 2 && over(s, w);
  }
  if (s.games[0] === 6 && s.games[1] === 6) {
    s.tiebreak = true;
    s.tbFirst = s.servingTeam;
  }
  return false;
}

function over(s: State, w: Team): true {
  s.winner = w;
  s.phase = 'over';
  s.message = '';
  return true;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function toView(s: State): View {
  const server = s.players[s.server];
  return {
    players: s.players.map((p) => {
      const serving = s.phase === 'serve' && p === server;
      return {
        id: p.id,
        name: p.name,
        team: p.team,
        bot: p.bot,
        x: r2(p.x),
        y: r2(p.y),
        swing: r2(p.swing / C.SWING),
        charge: p.charge < 0 ? -1 : r2(Math.min(1, p.charge / (serving ? C.SERVE_FULL : C.CHARGE_FULL))),
        ck: (serving ? 2 : 0) + (p.chargeKind === 'lob' ? 1 : 0),
        dive: p.dive > 0 ? 1 : p.down > 0 ? 2 : 0,
        em: p.emote,
        et: r2(p.emoteT),
        speed: p.speed,
        reach: p.reach,
        maxZ: p.maxZ,
      };
    }),
    ball: { x: r2(s.ball.x), y: r2(s.ball.y), z: r2(s.ball.z) },
    phase: s.phase,
    timer: r2(s.timer),
    place: s.place,
    points: [s.points[0], s.points[1]],
    games: [s.games[0], s.games[1]],
    sets: [s.sets[0], s.sets[1]],
    setScores: s.setScores.map((x) => [x[0], x[1]]),
    tiebreak: s.tiebreak,
    format: s.cfg.format,
    servingTeam: s.servingTeam,
    serverId: server.id,
    serveSide: s.serveSide,
    boxSign: s.boxSign,
    serveAim: { x: r2(server.aimX), y: r2(server.aimY) },
    hitTeam: s.lastHitTeam ?? -1,
    only: s.serveInFlight || s.serveReturn ? s.players[s.receiver].id : '',
    flight: s.serveInFlight,
    message: s.message,
    pointWinner: s.pointWinner,
    winner: s.winner,
    shot: { ...s.shot },
    mark: { ...s.mark },
    ev: [s.ev.hit, s.ev.bounce, s.ev.wall, s.ev.net, s.ev.smash, s.ev.mesh, s.ev.ooh, s.ev.cheer],
    ...(s.phase === 'over'
      ? { stats: s.players.map((p) => ({ id: p.id, name: p.name, team: p.team, ...s.stats[p.id] })), longest: s.longest }
      : {}),
  };
}
