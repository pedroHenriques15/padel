export type Team = 0 | 1;
export type SwingKind = 'drive' | 'lob';

// One tick of a player's controls. ix is right (+) / left (-) on their screen, iy towards the
// net (+) / away from it (-); hit and lob are true on the tick the key went down.
export interface TickInput {
  ix: number;
  iy: number;
  hit: boolean;
  lob: boolean;
}

export interface Seat {
  id: string;
  name: string;
  team: Team;
  slot: 0 | 1; // 0 plays the right of their half, 1 the left
  bot: boolean;
}

export interface MatchConfig {
  gamesToWin: number;
  soloAssist: boolean; // in 1v2, the lone player is faster and reaches further
  seats: Seat[];
}

export interface Player extends Seat {
  x: number;
  y: number;
  speed: number;
  reach: number;
  maxZ: number;
  swing: number; // seconds left in the current swing
  swingKind: SwingKind;
  swingIx: number;
  swingIy: number;
  hitDone: boolean;
  cooldown: number;
  prevD: number; // distance to the ball last tick, to hit at the closest point
  nearD: number; // closest the ball came within reach lately, for a late swing
  nearAgo: number; // seconds since then
}

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  out: boolean; // left the enclosure over a wall
}

export type BallEvent =
  | { k: 'net' }
  | { k: 'cross'; side: Team }
  | { k: 'floor'; side: Team; x: number; y: number; hard: boolean }
  | { k: 'wall'; side: Team }
  | { k: 'out'; side: Team };

export type Phase = 'serve' | 'rally' | 'point' | 'over';

export interface State {
  cfg: MatchConfig;
  players: Player[];
  ball: Ball;
  phase: Phase;
  timer: number; // seconds in this phase
  seed: number;

  servingTeam: Team;
  serveTurn: [number, number]; // which of each team's players serves its next game
  server: number; // index into players
  receiver: number;
  serveSide: number; // the server's x sign
  boxSign: number; // the service box's x sign
  serveFault: number; // 1 after a first fault

  lastHitTeam: Team | null;
  crossed: boolean; // the ball has crossed the net since the last hit
  bounces: number; // floor bounces on the receiving side since the last hit
  netTouched: boolean;
  serveInFlight: boolean;
  serveReturn: boolean; // only the receiver may hit
  rallyHits: number;
  sinceHit: number; // seconds since the last hit or serve

  points: [number, number];
  games: [number, number];
  pointWinner: Team | null; // null after a fault
  message: string;
  winner: Team | null;
  ev: { hit: number; bounce: number; wall: number }; // counters, for the sounds
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
}

export interface View {
  players: ViewPlayer[];
  ball: { x: number; y: number; z: number };
  phase: Phase;
  points: [number, number];
  games: [number, number];
  gamesToWin: number;
  servingTeam: Team;
  serverId: string;
  message: string;
  pointWinner: Team | null;
  winner: Team | null;
  ev: [number, number, number];
}
