export type Team = 0 | 1;
export type SwingKind = 'drive' | 'lob';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type FormatKey = 'g1' | 'g2' | 'g3' | 'g4' | 'g6' | 's1' | 's3';
export type Shot = 'serve' | 'drive' | 'lob' | 'bandeja' | 'smash' | 'portres' | 'dig' | 'frame';
export type Spin = '' | 'slice' | 'kick';

// A remote player's own position: they move on their own screen, and say where they are. place
// is the last placement they saw (State.place), so the host ignores where they were before it.
export interface Pose {
  x: number;
  y: number;
  place: number;
}

// One tick of a player's controls. ix is right (+) / left (-) on their screen, iy towards the
// net (+) / away from it (-). The presses are true on the tick the key went down.
export interface TickInput {
  ix: number;
  iy: number;
  hold: boolean; // the hit key is down
  press: boolean;
  lobHold: boolean;
  lobPress: boolean;
  dive: boolean;
  emote: number; // 1-4 on the tick one was pressed, else 0
  pose?: Pose;
  serveAim?: { x: number; y: number }; // where a remote player or a bot aims their serve
  shotAim?: [number, number]; // a bot's arrows at contact, without moving
}

export interface Seat {
  id: string;
  name: string;
  team: Team;
  slot: 0 | 1; // 0 plays the right of their half, 1 the left
  bot: boolean;
}

export interface MatchConfig {
  format: FormatKey;
  difficulty: Difficulty; // the bots'
  soloAssist: boolean; // in 1v2, the lone player is faster and reaches further
  seats: Seat[];
}

export interface Player extends Seat {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  reach: number;
  maxZ: number;
  swing: number; // seconds left in the current swing
  swingKind: SwingKind;
  power: number; // of the current swing, 0-1
  hitDone: boolean;
  cooldown: number;
  charge: number; // seconds the hit (or lob) key has been held, or -1
  chargeKind: SwingKind;
  armed: SwingKind | null; // a press waiting for the cooldown to end
  aimIx: number; // the arrows this tick, which aim the shot
  aimIy: number;
  prevD: number; // distance to the ball last tick, to hit at the closest point
  nearD: number; // closest the ball came within reach lately, for a late swing
  nearAgo: number; // seconds since then
  dive: number; // seconds left of a dive's burst
  down: number; // seconds left on the floor after it
  diveCd: number;
  diveX: number;
  diveY: number;
  aimX: number; // where the server aims, in the receiver's box
  aimY: number;
  emote: number;
  emoteT: number;
}

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: Spin; // changes the next bounce
  out: boolean; // left the enclosure over a wall
}

export type BallEvent =
  | { k: 'net' }
  | { k: 'cord' } // clipped the tape and went over
  | { k: 'cross'; side: Team }
  | { k: 'floor'; side: Team; x: number; y: number; hard: boolean }
  | { k: 'wall'; side: Team; mesh: boolean }
  | { k: 'out'; side: Team };

export type Phase = 'serve' | 'rally' | 'point' | 'over';

export interface Stats {
  aces: number;
  winners: number;
  errors: number;
  smashes: number;
  fastest: number; // km/h
}

export interface State {
  cfg: MatchConfig;
  players: Player[];
  ball: Ball;
  phase: Phase;
  timer: number; // seconds in this phase
  seed: number;
  place: number; // counts the placements for a serve

  servingTeam: Team;
  serveTurn: [number, number]; // which of each team's players serves its next game
  server: number; // index into players
  receiver: number;
  serveSide: number; // the server's x sign
  boxSign: number; // the service box's x sign
  serveFault: number; // 1 after a first fault

  lastHitTeam: Team | null;
  lastHitter: number; // index into players, or -1
  lastShot: Shot | null;
  crossed: boolean; // the ball has crossed the net since the last hit
  bounces: number; // floor bounces on the receiving side since the last hit
  netTouched: boolean;
  offGlass: boolean; // it came off the receiving side's glass after its bounce
  marked: boolean; // its landing since the last hit is marked
  serveInFlight: boolean;
  serveReturn: boolean; // only the receiver may hit
  rallyHits: number;
  sinceHit: number; // seconds since the last hit or serve

  points: [number, number]; // in a tie-break, plain numbers
  games: [number, number]; // in this set
  sets: [number, number];
  setScores: [number, number][];
  tiebreak: boolean;
  tbFirst: Team; // who served first in the tie-break
  pointWinner: Team | null; // null after a fault or a let
  message: string;
  winner: Team | null;

  stats: Record<string, Stats>;
  longest: number; // shots in the longest rally
  shot: { n: number; id: string; kmh: number; tag: string }; // the latest
  mark: { n: number; x: number; y: number }; // where the ball last landed
  ev: { hit: number; bounce: number; wall: number; net: number; smash: number; mesh: number; ooh: number; cheer: number }; // counters, for the sounds
}

// What the screen needs, and what the host sends the others 30 times a second.
export interface ViewPlayer {
  id: string;
  name: string;
  team: Team;
  bot: boolean;
  x: number;
  y: number;
  swing: number; // 1 at the start of a swing, 0 at rest
  charge: number; // 0-1 while charging, else -1
  ck: number; // what is charging: 0 a shot, 1 a lob, 2 a serve, 3 a slice serve
  dive: number; // 0, 1 diving, 2 on the floor
  em: number; // emote 1-4, or 0
  et: number; // its seconds left
  speed: number;
  reach: number;
  maxZ: number;
}

export interface StatLine extends Stats {
  id: string;
  name: string;
  team: Team;
}

export interface View {
  players: ViewPlayer[];
  ball: { x: number; y: number; z: number };
  phase: Phase;
  timer: number;
  place: number;
  points: [number, number];
  games: [number, number];
  sets: [number, number];
  setScores: [number, number][];
  tiebreak: boolean;
  format: FormatKey;
  servingTeam: Team;
  serverId: string;
  serveSide: number;
  boxSign: number;
  serveAim: { x: number; y: number };
  hitTeam: number; // the last hitter's team, or -1
  only: string; // the one player who may hit (the serve's receiver), or ''
  flight: boolean; // the serve hasn't bounced yet: nobody may hit
  message: string;
  pointWinner: Team | null;
  winner: Team | null;
  shot: { n: number; id: string; kmh: number; tag: string };
  mark: { n: number; x: number; y: number };
  ev: number[];
  stats?: StatLine[];
  longest?: number;
}
