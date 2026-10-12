import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SERVICE_LINE } from '../src/sim/constants.ts';
import { newMatch, setupServe, step, toView } from '../src/sim/sim.ts';
import type { MatchConfig, Seat, State, TickInput } from '../src/sim/types.ts';

const seat = (id: string, team: 0 | 1, slot: 0 | 1, bot = false): Seat => ({ id, name: id, team, slot, bot });
const cfg = (seats: Seat[], gamesToWin = 3): MatchConfig => ({ gamesToWin, soloAssist: true, seats });
const HIT: TickInput = { ix: 0, iy: 0, hit: true, lob: false };

// Steps until done(s) or the time runs out; inputs(s) gives each tick's controls.
function run(s: State, done: (s: State) => boolean, inputs: (s: State) => Record<string, TickInput> = () => ({}), seconds = 10) {
  for (let i = 0; i < seconds * 60; i++) {
    if (done(s)) return;
    step(s, inputs(s));
  }
  assert.fail(`timed out in phase ${s.phase}: ${s.message}`);
}

function humanMatch(servingTeam: 0 | 1 = 0): State {
  const s = newMatch(cfg([seat('a', 0, 0), seat('b', 1, 0)]), 42);
  s.servingTeam = servingTeam;
  setupServe(s);
  return s;
}

test('the server serves diagonally from the right first', () => {
  const s = newMatch(cfg([seat('a1', 0, 0), seat('a2', 0, 1), seat('b1', 1, 0), seat('b2', 1, 1)]), 1);
  s.servingTeam = 0;
  setupServe(s);
  const server = s.players[s.server];
  const receiver = s.players[s.receiver];
  assert.equal(server.id, 'a1');
  assert.ok(server.x > 0 && server.y < -SERVICE_LINE, 'team A serves from its right, behind the service line');
  assert.ok(receiver.x < 0 && receiver.y > 0, 'into the box across');
  assert.equal(receiver.id, 'b1', "the receiver is the one playing that side (B's right is x < 0)");

  s.points = [1, 0];
  setupServe(s);
  assert.ok(s.players[s.server].x < 0, 'the next point is from the left');
  assert.equal(s.players[s.receiver].id, 'b2');
});

test('a serve that lands in the box and is not returned is an ace', () => {
  const s = humanMatch(0);
  run(s, (s) => s.timer > 0.6);
  run(s, (s) => s.phase === 'rally', () => ({ a: HIT }));
  assert.ok(s.serveInFlight);
  run(s, (s) => s.serveReturn || s.phase !== 'rally');
  assert.equal(s.phase, 'rally', s.message);
  run(s, (s) => s.phase === 'point');
  assert.equal(s.pointWinner, 0);
  assert.equal(s.message, 'Ace!');
  run(s, (s) => s.phase === 'serve');
  assert.deepEqual(s.points, [1, 0]);
});

test('serving too early does nothing', () => {
  const s = humanMatch(0);
  step(s, { a: HIT });
  assert.equal(s.phase, 'serve');
});

test('a serve into the net is a fault, and two are a double fault', () => {
  const s = humanMatch(0);
  const intoNet = (s: State) => {
    run(s, (s) => s.timer > 0.6);
    run(s, (s) => s.phase === 'rally', () => ({ a: HIT }));
    // Aim it low and short, into the tape.
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
});

test('a ball that hits the glass before bouncing loses the point', () => {
  const s = humanMatch(0);
  run(s, (s) => s.timer > 0.6);
  run(s, (s) => s.phase === 'rally', () => ({ a: HIT }));
  run(s, (s) => s.serveReturn);
  // B returns it straight into A's back glass.
  Object.assign(s.ball, { x: 0, y: 3, z: 1.5, vx: 0, vy: -25, vz: 2 });
  s.lastHitTeam = 1;
  s.crossed = false;
  s.bounces = 0;
  s.serveReturn = false;
  run(s, (s) => s.phase === 'point');
  assert.equal(s.message, 'Hit the glass before bouncing');
  assert.equal(s.pointWinner, 0);
});

test('a ball may come off the glass after bouncing, and the receiver can still play it', () => {
  const s = humanMatch(0);
  run(s, (s) => s.timer > 0.6);
  run(s, (s) => s.phase === 'rally', () => ({ a: HIT }));
  // A drive from A that bounces deep in B's half and comes off the back glass.
  Object.assign(s.ball, { x: 0, y: -2, z: 1, vx: 0, vy: 14, vz: 2.5 });
  s.serveInFlight = false;
  let wall = false;
  run(s, (s) => {
    wall ||= s.ev.wall > 0;
    return s.phase !== 'rally' || (wall && s.ball.vy < 0);
  });
  assert.equal(s.phase, 'rally', s.message);
  assert.equal(s.bounces, 1);
});

test('a swing a moment late still reaches a ball that just passed, a very late one does not', () => {
  for (const [lateBy, hits] of [
    [0.1, true],
    [0.4, false],
  ] as const) {
    const s = humanMatch(0);
    run(s, (s) => s.timer > 0.6);
    run(s, (s) => s.phase === 'rally', () => ({ a: HIT }));
    // B's return, already bounced in A's half, passing right by A, who stands still.
    const a = s.players[0];
    a.x = 0;
    a.y = -6;
    Object.assign(s.ball, { x: 0.4, y: -3, z: 1, vx: 0, vy: -8, vz: 2.5 });
    Object.assign(s, { lastHitTeam: 1, crossed: true, bounces: 1, serveInFlight: false, serveReturn: false });
    run(s, (s) => s.ball.y < a.y - 0.1);
    const before = s.ev.hit;
    for (let i = 0; i < Math.round(lateBy * 60); i++) step(s, {});
    step(s, { a: HIT });
    assert.equal(s.ev.hit > before, hits, `late by ${lateBy}s`);
  }
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

for (const [name, seats] of [
  ['1v1', [seat('a', 0, 0, true), seat('b', 1, 0, true)]],
  ['1v2', [seat('a', 0, 0, true), seat('b1', 1, 0, true), seat('b2', 1, 1, true)]],
  ['2v2', [seat('a1', 0, 0, true), seat('a2', 0, 1, true), seat('b1', 1, 0, true), seat('b2', 1, 1, true)]],
] as const) {
  test(`bots finish a ${name} match, with real rallies`, () => {
    const reasons: Record<string, number> = {};
    let points = 0;
    let hits = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const s = newMatch(cfg([...seats], 2), seed);
      let last = '';
      run(
        s,
        (s) => {
          if (s.phase === 'point' && s.message !== last) {
            reasons[s.message.replace(/^Fault: .*/, 'Fault')] = (reasons[s.message.replace(/^Fault: .*/, 'Fault')] ?? 0) + 1;
            if (s.pointWinner !== null) points++;
          }
          last = s.phase === 'point' ? s.message : '';
          return s.phase === 'over';
        },
        () => ({}),
        60 * 30,
      );
      hits += s.ev.hit;
      assert.ok(s.winner !== null);
      const v = toView(s);
      assert.equal(v.games[v.winner!], 2);
    }
    const perPoint = hits / points;
    console.log(name, `${perPoint.toFixed(1)} hits a point`, reasons);
    assert.ok(perPoint > 2.5, `rallies too short: ${perPoint.toFixed(1)} hits a point`);
  });
}
