// The court, in metres. x runs across (left to right as team A sees it), y along (team A's half
// is y < 0, team B's y > 0), z up. The net is at y = 0.
export const HALF_W = 5;
export const HALF_L = 10;
export const SERVICE_LINE = 6.95; // from the net
export const NET_H = 0.9;
export const BACK_H = 4; // 3 m of glass and 1 m of mesh
export const SIDE_H = 3;
export const SIDE_GLASS = 4; // m of glass at each end of the side walls; mesh between

export const BALL_R = 0.04;
export const G = 9.8;
export const FLOOR_E = 0.72; // how much of the vertical speed a bounce keeps
export const FLOOR_F = 0.88; // and of the horizontal speed
export const WALL_E = 0.68;
export const CORD = 0.05; // m either side of the tape where the ball clips the net and goes on

export const DT = 1 / 60;
export const SUBSTEPS = 4;

export const SPEED = 5.2; // m/s
export const ACCEL = 30; // m/s², starting to run
export const DECEL = 46; // m/s², stopping or turning
export const REACH = 1.05; // m, from the player's centre
export const MAX_Z = 2.7; // highest ball a player can reach, jumping
export const SMASH_Z = 1.75; // above this, a hit is an overhead
export const SWING = 0.36; // s a released swing can make contact for
export const LATE = 0.25; // s after the ball passed that a swing still reaches it (the others' lag)
export const COOLDOWN = 0.4; // s between swings

export const CHARGE_FULL = 0.75; // s holding the hit key to a full-power shot

export const SERVE_DELAY = 0.5; // s before the server may serve
export const SERVE_FULL = 1; // s for the serve's power bar to fill
export const SERVE_RED = 0.85; // above this much power, a serve risks a fault
export const SERVE_HOLD = 3; // s a serve can be held before it goes by itself
export const AIM_SPEED = 3.2; // m/s the serve's target moves
export const AUTO_SERVE = 8; // s before an idle server's serve goes by itself
export const POINT_PAUSE = 1.8; // s between a point and the next serve

export const DIVE_TIME = 0.26; // s of the dive's burst
export const DIVE_SPEED = 2.4; // times the player's speed
export const DIVE_DOWN = 0.5; // s on the floor after it
export const DIVE_COOLDOWN = 1.6; // s from one dive to the next
export const DIVE_REACH = 1.45; // times the reach, during the burst

export const EMOTE_TIME = 2.2; // s an emote shows
