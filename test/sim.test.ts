import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotTarget } from '../src/sim/aim.ts';
import * as C from '../src/sim/constants.ts';
import { cleanControls, edges, noControls, seenOf } from '../src/sim/controls.ts';
import { newMatch, setupServe, step, toView } from '../src/sim/sim.ts';
import type { Difficulty, FormatKey, MatchConfig, Seat, State, TickInput } from '../src/sim/types.ts';

const seat = (id: string, team: 0 | 1, slot: 0 | 1, bot = false): Seat => ({ id, name: id, team, slot, bot });
const cfg = (seats: Seat[], format: FormatKey = 'g3', difficulty: Difficulty = 'normal'): MatchConfig => ({ format, difficulty, soloAssist: true, seats });
const IDLE: TickInput = { ix: 0, iy: 0, hold: false, press: false, lobHold: false, lobPress: false, dive: false, emote: 0 };
const TAP: TickInput = { ...IDLE, press: true };
const keys = (o: Partial<TickInput>): TickInput => ({ ...IDLE, ...o });

// Steps until done(s) or the time runs out; inputs(s) gives each tick's controls.
function run(s: State, done: (s: State) => boolean, inputs: (s: State) => Record<string, TickInput> = () => ({}), seconds = 10) {
  for (let i = 0; i < seconds * 60; i++) {
    if (done(s)) return;
    step(s, inputs(s));
  }
  assert.fail(`timed out in phase ${s.phase}: ${s.message}`);
}

function humanMatch(servingTeam: 0 | 1 = 0, seed = 42): State {
  const s = newMatch(cfg([seat('a', 0, 0), seat('b', 1, 0)]), seed);
  s.servingTeam = servingTeam;
  setupServe(s);
  return s;
}

// Serves with the bar held for `hold` seconds (0: a tap), the arrows held meanwhile.
function serveWith(s: State, hold: number, arrows: Partial<TickInput> = {}, slice = false) {
  run(s, (s) => s.timer > 0.6);
  const id = s.players[s.server].id;
  const down = slice ? { lobPress: true, lobHold: true } : { press: true, hold: true };
  if (hold === 0) step(s, { [id]: slice ? keys({ lobPress: true }) : TAP });
  else {
    step(s, { [id]: keys({ ...arrows, ...down }) });
    for (let i = 1; i < Math.round(hold * 60); i++) step(s, { [id]: keys({ ...arrows, hold: !slice, lobHold: slice }) });
    step(s, { [id]: keys(arrows) });
  }
  assert.equal(s.phase, 'rally');
}

// Puts a ball, already bounced in A's half, on its way to pass by A at (0, -6).
function incoming(s: State, x = 0.3, y = -2, vy = -9): void {
  const a = s.players[0];
  Object.assign(a, { x: 0, y: -6, vx: 0, vy: 0, cooldown: 0, swing: 0 });
  Object.assign(s.ball, { x, y, z: 1, vx: 0, vy, vz: 2.5, spin: '', out: false });
  Object.assign(s, { phase: 'rally', lastHitTeam: 1, crossed: true, bounces: 1, serveInFlight: false, serveReturn: false, rallyHits: 1, offGlass: false });
}

const speedOf = (s: State) => Math.hypot(s.ball.vx, s.ball.vy, s.ball.vz);

test('the server serves diagonally from the right first', () => {
  const s = newMatch(cfg([seat('a1', 0, 0), seat('a2', 0, 1), seat('b1', 1, 0), seat('b2', 1, 1)]), 1);
  s.servingTeam = 0;
  setupServe(s);
  const server = s.players[s.server];
  const receiver = s.players[s.receiver];
  assert.equal(server.id, 'a1');
  assert.ok(server.x > 0 && server.y < -C.SERVICE_LINE, 'team A serves from its right, behind the service line');
  assert.ok(receiver.x < 0 && receiver.y > 0, 'into the box across');
  assert.equal(receiver.id, 'b1', "the receiver is the one playing that side (B's right is x < 0)");

  s.points = [1, 0];
  setupServe(s);
  assert.ok(s.players[s.server].x < 0, 'the next point is from the left');
  assert.equal(s.players[s.receiver].id, 'b2');
});

test('a serve that lands in the box and is not returned is an ace', () => {
  const s = humanMatch(0);
  serveWith(s, 0);
  assert.ok(s.serveInFlight);
  run(s, (s) => s.serveReturn || s.phase !== 'rally');
  assert.equal(s.phase, 'rally', s.message);
  run(s, (s) => s.phase === 'point');
  assert.equal(s.pointWinner, 0);
  assert.equal(s.message, 'Ace!');
  assert.equal(s.stats.a.aces, 1);
  run(s, (s) => s.phase === 'serve');
  assert.deepEqual(s.points, [1, 0]);
});

test('serving too early does nothing, but a key held through the wait serves', () => {
  const s = humanMatch(0);
  step(s, { a: TAP });
  run(s, (s) => s.timer > 1);
  assert.equal(s.phase, 'serve');

  const t = humanMatch(0);
  step(t, { a: keys({ press: true, hold: true }) });
  run(t, (t) => t.timer > 0.8, () => ({ a: keys({ hold: true }) }));
  assert.ok(t.players[0].charge > 0.2, 'the bar is filling');
  step(t, {});
  assert.equal(t.phase, 'rally');
});

test('the server walks along the baseline before serving, but stays behind the line, on their side', () => {
  const s = humanMatch(0);
  const a = s.players[0];
  const x0 = a.x;
  run(s, (s) => s.timer > 2, () => ({ a: keys({ ix: 1, iy: 1 }) }));
  assert.ok(a.x > x0 + 1, 'walked right');
  assert.ok(a.x < C.HALF_W && a.y <= -C.SERVICE_LINE - 0.3, 'not past the service line');
  run(s, (s) => s.timer > 4, () => ({ a: keys({ ix: -1 }) }));
  assert.ok(a.x > 0, 'not across the centre');
  assert.ok(Math.abs(s.ball.x - (a.x + 0.3)) < 0.01, 'the ball goes with them');
});

test('the power bar: more power, a faster serve; the red top, more faults', () => {
  const pace = (hold: number) => {
    const s = humanMatch(0);
    serveWith(s, hold);
    return Math.hypot(s.ball.vx, s.ball.vy);
  };
  assert.ok(pace(0.75) > pace(0.1) * 1.4, `${pace(0.75)} vs ${pace(0.1)}`);

  const faults = (hold: number) => {
    let n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = humanMatch(0, seed);
      serveWith(s, hold);
      run(s, (s) => s.serveReturn || s.phase !== 'rally');
      if (s.phase === 'point' && s.pointWinner === null) n++;
    }
    return n;
  };
  const green = faults(0.7);
  const red = faults(1.2);
  console.log(`faults in 60 serves: green ${green}, red ${red}`);
  assert.ok(green <= 6, `green faults ${green}`);
  assert.ok(red >= green + 10, `red faults ${red}`);
});

test("the arrows move the serve's target in the box", () => {
  const landing = (ix: number, iy: number) => {
    const s = humanMatch(0, 3);
    serveWith(s, 0.8, { ix, iy });
    const target = { x: s.players[0].aimX, y: s.players[0].aimY };
    let at: { x: number; y: number } | null = null;
    run(s, (s) => {
      if (!at && s.mark.n > 0) at = { x: s.mark.x, y: s.mark.y };
      return !!at;
    });
    return { target, at: at! };
  };
  // A serves from the right (x > 0) into B's box at x < 0. A's screen-left is x < 0: wide.
  const wide = landing(-1, 0);
  const t = landing(1, 0);
  assert.ok(wide.target.x < -4.5 && t.target.x > -0.5, `targets ${wide.target.x}, ${t.target.x}`);
  assert.ok(wide.at.x < t.at.x - 2.5, `landed at ${wide.at.x} and ${t.at.x}`);
  const deep = landing(0, 1);
  const short = landing(0, -1);
  assert.ok(deep.at.y > short.at.y + 2, `deep ${deep.at.y}, short ${short.at.y}`);
});

test('a slice serve stays low after the bounce', () => {
  const bounce = (slice: boolean) => {
    const s = humanMatch(0, 5);
    serveWith(s, 0.6, {}, slice);
    run(s, (s) => s.bounces > 0 || s.phase !== 'rally');
    return s.ball.vz;
  };
  assert.ok(bounce(true) < bounce(false) * 0.75, `${bounce(true)} vs ${bounce(false)}`);
});

test('a serve that clips the net and lands in the box is a let', () => {
  const s = humanMatch(0);
  serveWith(s, 0);
  // Aim it at the tape.
  const b = s.ball;
  const t = 0.5;
  Object.assign(b, { x: 0.5, y: -3, z: 0.95, vx: -1, vy: 3 / t, spin: '' });
  b.vz = (0.9 - b.z + 0.5 * C.G * t * t) / t;
  run(s, (s) => s.phase !== 'rally');
  assert.match(s.message, /^Let/);
  assert.equal(s.pointWinner, null);
  run(s, (s) => s.phase === 'serve');
  assert.equal(s.serveFault, 0, 'not a fault');
  assert.deepEqual(s.points, [0, 0]);
});

test('a serve into the net is a fault, and two are a double fault', () => {
  const s = humanMatch(0);
  const intoNet = (s: State) => {
    serveWith(s, 0);
    s.ball.vz = 0;
    s.ball.vy = 12;
    s.ball.z = 0.5;
    run(s, (s) => s.phase === 'point');
  };
  intoNet(s);
  assert.equal(s.pointWinner, null);
  assert.match(s.message, /^Fault/);
  run(s, (s) => s.phase === 'serve');
  assert.equal(s.message, 'Second serve');
  intoNet(s);
  assert.equal(s.message, 'Double fault');
  assert.equal(s.pointWinner, 1);
  assert.equal(s.stats.a.errors, 1);
});

test('a ball that hits the glass before bouncing loses the point', () => {
  const s = humanMatch(0);
  serveWith(s, 0);
  run(s, (s) => s.serveReturn);
  Object.assign(s.ball, { x: 0, y: 3, z: 1.5, vx: 0, vy: -25, vz: 2 });
  Object.assign(s, { lastHitTeam: 1, lastHitter: 1, crossed: false, bounces: 0, serveReturn: false });
  run(s, (s) => s.phase === 'point');
  assert.equal(s.message, 'Hit the glass before bouncing');
  assert.equal(s.pointWinner, 0);
  assert.equal(s.stats.b.errors, 1);
});

test('a ball may come off the glass after bouncing, and then it is hit harder', () => {
  const s = humanMatch(0);
  serveWith(s, 0);
  Object.assign(s.ball, { x: 0, y: -2, z: 1, vx: 0, vy: 14, vz: 2.5 });
  s.serveInFlight = false;
  run(s, (s) => s.phase !== 'rally' || s.offGlass);
  assert.equal(s.phase, 'rally', s.message);
  assert.equal(s.bounces, 1);
});

test('a swing a moment late still reaches a ball that just passed, a very late one does not', () => {
  for (const [lateBy, hits] of [
    [0.1, true],
    [0.45, false],
  ] as const) {
    const s = humanMatch(0);
    serveWith(s, 0);
    incoming(s, 0.4, -3, -8);
    run(s, (s) => s.ball.y < -6.1);
    const before = s.shot.n;
    for (let i = 0; i < Math.round(lateBy * 60); i++) step(s, {});
    step(s, { a: TAP });
    step(s, {});
    assert.equal(s.shot.n > before, hits, `late by ${lateBy}s`);
  }
});

test('holding the hit key: the swing comes by itself, and the longer the charge the harder', () => {
  // Charging before the ball comes: a full charge by the time it arrives, and no key let go.
  const full = humanMatch(0, 9);
  serveWith(full, 0);
  full.players[0].cooldown = 0;
  step(full, { a: keys({ press: true, hold: true }) });
  for (let i = 0; i < 50; i++) step(full, { a: keys({ hold: true }) });
  incoming(full);
  const fullBefore = full.shot.n;
  run(full, (s) => s.shot.n > fullBefore, () => ({ a: keys({ hold: true }) }), 3);
  const fullSpeed = speedOf(full);
  // A tap as the ball comes.
  const s = humanMatch(0, 9);
  serveWith(s, 0);
  incoming(s);
  run(s, (s) => s.ball.y < -5.2);
  const before = s.shot.n;
  run(s, (s) => s.shot.n > before, (s) => ({ a: s.ball.y < -5.2 && s.ball.y > -5.4 ? TAP : IDLE }), 2);
  const tapSpeed = speedOf(s);
  assert.ok(fullSpeed > tapSpeed * 1.5, `full ${fullSpeed.toFixed(1)} vs tap ${tapSpeed.toFixed(1)} m/s`);
  assert.ok(full.shot.kmh > 70, `${full.shot.kmh} km/h`);
});

test('charging plants the feet: the arrows aim and do not move; after the swing they move again', () => {
  const s = humanMatch(0, 9);
  serveWith(s, 0);
  const a = s.players[0];
  Object.assign(a, { x: 0, y: -6, vx: 0, vy: 0, cooldown: 0 });
  step(s, { a: keys({ ix: -1, press: true, hold: true }) });
  for (let i = 0; i < 30; i++) step(s, { a: keys({ ix: -1, hold: true }) });
  assert.ok(Math.abs(a.x) < 0.05 && Math.abs(a.y + 6) < 0.05, `moved to ${a.x.toFixed(2)}, ${a.y.toFixed(2)}`);
  assert.equal(a.aimIx, -1, 'the arrow aims');
  incoming(s);
  a.charge = 0.5;
  const before = s.shot.n;
  run(s, (s) => s.shot.n > before, () => ({ a: keys({ ix: -1, hold: true }) }), 3);
  const x = a.x;
  for (let i = 0; i < 30; i++) step(s, { a: keys({ ix: -1, hold: true }) });
  assert.ok(a.x < x - 0.5, 'free to move once the swing came, the key still down');
});

test('the arrows at contact aim the shot: ←/→ the side, ↑/↓ deep or short', () => {
  const landing = (ix: number, iy: number) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const s = humanMatch(0, seed);
      serveWith(s, 0);
      incoming(s, 0.05);
      const before = s.shot.n;
      run(s, (s) => s.shot.n > before, () => ({ a: keys({ ix, iy, press: true, hold: true }) }), 3);
      const m = s.mark.n;
      run(s, (s) => s.mark.n > m || s.phase !== 'rally', () => ({}), 4);
      xs.push(s.mark.x);
      ys.push(s.mark.y);
    }
    const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    return { x: avg(xs), y: avg(ys) };
  };
  const right = landing(1, 0);
  const left = landing(-1, 0);
  assert.ok(right.x > 2 && left.x < -2, `right ${right.x.toFixed(1)}, left ${left.x.toFixed(1)}`);
  const deep = landing(0, 1);
  const short = landing(0, -1);
  assert.ok(deep.y > short.y + 3, `deep ${deep.y.toFixed(1)}, short ${short.y.toFixed(1)}`);
  // No arrows: crosscourt.
  assert.ok(shotTarget(0, 0, 0, 3, 'drive').x < -2.5 && shotTarget(0, 0, 0, -3, 'drive').x > 2.5);
});

test('overheads: a tap is a bandeja, a full charge at the net a por tres out of the court', () => {
  const overhead = (hold: boolean, seed: number) => {
    const s = humanMatch(0, seed);
    serveWith(s, 0);
    const a = s.players[0];
    a.cooldown = 0;
    if (hold) for (let i = 0; i < 50; i++) step(s, { a: keys({ press: i === 0, hold: true }) });
    Object.assign(a, { x: 0, y: -3, vx: 0, vy: 0, swing: 0 });
    // A short lob from B, dropping onto A at the net.
    Object.assign(s.ball, { x: 0.1, y: 1, z: 4.5, vx: 0, vy: -5.8, vz: 0, spin: '', out: false });
    Object.assign(s, { lastHitTeam: 1, lastHitter: 1, crossed: false, bounces: 0, serveInFlight: false, serveReturn: false, rallyHits: 1 });
    const before = s.shot.n;
    let t = 0;
    run(s, (s) => s.shot.n > before, () => ({ a: hold ? keys({ hold: true }) : s.ball.z < 2.2 && t++ === 0 ? TAP : IDLE }), 3);
    return s;
  };
  const bandeja = overhead(false, 4);
  assert.equal(bandeja.lastShot, 'bandeja');
  let out = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const s = overhead(true, seed);
    assert.equal(s.lastShot, 'portres');
    assert.ok(speedOf(s) > speedOf(bandeja) * 1.5);
    run(s, (s) => s.phase !== 'rally', () => ({}), 5);
    if (s.message === 'Por tres!') {
      out++;
      assert.equal(s.pointWinner, 0);
    }
  }
  assert.ok(out >= 6, `${out} of 10 por tres left the court`);
});

test('a dive: a burst of speed, a longer reach, then a moment on the floor', () => {
  const s = humanMatch(0);
  serveWith(s, 0);
  const a = s.players[0];
  Object.assign(a, { x: 0, y: -6, vx: 0, vy: 0 });
  Object.assign(s, { lastHitTeam: 0 });
  step(s, { a: keys({ ix: 1, dive: true }) });
  run(s, (s) => s.players[0].dive === 0, () => ({ a: keys({ ix: 1 }) }), 1);
  const dived = a.x;
  assert.ok(dived > C.SPEED * C.DIVE_TIME * 1.8, `dived ${dived.toFixed(2)} m`);
  for (let i = 0; i < 15; i++) step(s, { a: keys({ ix: 1 }) });
  assert.ok(Math.abs(a.x - dived) < 0.01, 'down on the floor');

  // A ball out of reach to the side is dug out by the dive.
  const t = humanMatch(0, 2);
  serveWith(t, 0);
  incoming(t, 1.9, -2, -9);
  run(t, (t) => t.ball.y < -4.4);
  const before = t.shot.n;
  run(t, (t) => t.shot.n > before || t.phase !== 'rally', (t) => ({ a: keys({ ix: 1, dive: t.players[0].dive === 0 && t.players[0].down === 0 }) }), 2);
  assert.equal(t.shot.tag, 'Diving save!');
});

test('scoring: golden point and the match', () => {
  const s = humanMatch(0);
  s.points = [3, 3];
  setupServe(s);
  assert.equal(s.message, 'Golden point');
  s.pointWinner = 1;
  s.phase = 'point';
  s.timer = 99;
  step(s, {});
  assert.deepEqual(s.games, [0, 1]);
  assert.deepEqual(s.points, [0, 0]);
  assert.equal(s.servingTeam, 1, 'the serve changes teams after a game');

  s.games = [2, 2];
  s.points = [3, 1];
  s.pointWinner = 0;
  s.phase = 'point';
  s.timer = 99;
  step(s, {});
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
  assert.ok(toView(s).stats);
});

test('sets: six games by two, a tie-break at 6-6, best of three', () => {
  const s = newMatch(cfg([seat('a', 0, 0), seat('b', 1, 0)], 's3'), 1);
  const point = (w: 0 | 1) => {
    s.pointWinner = w;
    s.phase = 'point';
    s.timer = 99;
    step(s, {});
  };
  const game = (w: 0 | 1) => {
    for (let i = 0; i < 4; i++) point(w);
  };
  for (let i = 0; i < 5; i++) game(0);
  for (let i = 0; i < 5; i++) game(1);
  game(0);
  assert.deepEqual(s.games, [6, 5], 'not a set at 6-5');
  game(1);
  assert.ok(s.tiebreak, 'a tie-break at 6-6');
  const first = s.servingTeam;
  point(0);
  assert.notEqual(s.servingTeam, first, 'the serve changes after the first point');
  point(1);
  assert.notEqual(s.servingTeam, first, 'then every two');
  point(1);
  assert.equal(s.servingTeam, first);
  assert.equal(toView(s).points.join('-'), '1-2', 'counted in plain numbers');
  for (let i = 0; i < 6; i++) point(0);
  assert.ok(!s.tiebreak);
  assert.deepEqual(s.sets, [1, 0]);
  assert.deepEqual(s.setScores, [[7, 6]]);
  assert.equal(s.servingTeam, 1 - first, 'who served first in the tie-break receives first');
  for (let i = 0; i < 6; i++) game(1);
  assert.deepEqual(s.sets, [1, 1]);
  for (let i = 0; i < 6; i++) game(0);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
});

test('1v2: the lone player gets help, and serves and receives every point', () => {
  const s = newMatch(cfg([seat('solo', 0, 0), seat('b1', 1, 0), seat('b2', 1, 1)]), 7);
  const solo = s.players[0];
  assert.ok(solo.speed > s.players[1].speed && solo.reach > s.players[1].reach);
  for (const [served, points] of [
    [0, [0, 0]],
    [0, [1, 0]],
    [1, [0, 0]],
    [1, [0, 1]],
  ] as const) {
    s.servingTeam = served;
    s.points = [points[0], points[1]];
    setupServe(s);
    assert.equal(served === 0 ? s.players[s.server].id : s.players[s.receiver].id, 'solo');
  }
});

test('emotes show over the player for a moment', () => {
  const s = humanMatch(0);
  step(s, { b: keys({ emote: 2 }) });
  assert.equal(toView(s).players[1].em, 2);
  run(s, (s) => s.timer > C.EMOTE_TIME + 0.1);
  assert.equal(toView(s).players[1].em, 0);
});

test('a remote player says where they are; the host keeps them in their half, and ignores where they were before a serve', () => {
  const s = humanMatch(0);
  const c = { ...noControls(), px: 1.5, py: 3, pl: s.place };
  step(s, { b: edges(c, seenOf(c)) });
  assert.deepEqual([s.players[1].x, s.players[1].y], [1.5, 3]);
  const across = { ...c, py: -3 };
  step(s, { b: edges(across, seenOf(across)) });
  assert.ok(s.players[1].y > 0, 'not across the net');
  setupServe(s);
  const y = s.players[1].y;
  step(s, { b: edges(c, seenOf(c)) });
  assert.equal(s.players[1].y, y, 'a position from before the serve is ignored');

  const clean = cleanControls({ ix: 7, iy: -0.2, h: 'x', hd: 1, px: 1e9, py: 2, pl: 3, ek: 9 });
  assert.deepEqual([clean.ix, clean.iy, clean.h, clean.hd, clean.px, clean.ek], [1, -1, 0, false, 20, 4]);
});

for (const [name, seats] of [
  ['1v1', [seat('a', 0, 0, true), seat('b', 1, 0, true)]],
  ['1v2', [seat('a', 0, 0, true), seat('b1', 1, 0, true), seat('b2', 1, 1, true)]],
  ['2v2', [seat('a1', 0, 0, true), seat('a2', 0, 1, true), seat('b1', 1, 0, true), seat('b2', 1, 1, true)]],
] as const) {
  for (const level of ['easy', 'normal', 'hard'] as const) {
    test(`${level} bots finish a ${name} match, with real rallies`, () => {
      const reasons: Record<string, number> = {};
      const tags: Record<string, number> = {};
      let points = 0;
      let hits = 0;
      for (let seed = 1; seed <= 3; seed++) {
        const s = newMatch(cfg([...seats], 'g2', level), seed);
        let last = '';
        let shot = 0;
        run(
          s,
          (s) => {
            if (s.phase === 'point' && s.message !== last) {
              const k = s.message.replace(/^(Fault|Let).*/, '$1');
              reasons[k] = (reasons[k] ?? 0) + 1;
              if (s.pointWinner !== null) points++;
            }
            if (s.shot.n !== shot) {
              shot = s.shot.n;
              if (s.shot.tag) tags[s.shot.tag] = (tags[s.shot.tag] ?? 0) + 1;
            }
            last = s.phase === 'point' ? s.message : '';
            return s.phase === 'over';
          },
          () => ({}),
          60 * 30,
        );
        hits += s.shot.n;
        assert.ok(s.winner !== null);
        const v = toView(s);
        assert.equal(v.games[v.winner!], 2);
      }
      const perPoint = hits / points;
      console.log(level, name, `${perPoint.toFixed(1)} shots a point`, reasons, tags);
      assert.ok(perPoint > 2.5, `rallies too short: ${perPoint.toFixed(1)} shots a point`);
    });
  }
}
