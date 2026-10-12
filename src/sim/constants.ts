// The court, in metres. x runs across (left to right as team A sees it), y along (team A's half
// is y < 0, team B's y > 0), z up. The net is at y = 0.
export const HALF_W = 5;
export const HALF_L = 10;
export const SERVICE_LINE = 6.95; // from the net
export const NET_H = 0.9;
export const BACK_H = 4; // 3 m of glass and 1 m of mesh
export const SIDE_H = 3;

export const BALL_R = 0.04;
export const G = 9.8;
export const FLOOR_E = 0.72; // how much of the vertical speed a bounce keeps
export const FLOOR_F = 0.88; // and of the horizontal speed
export const WALL_E = 0.68;

export const DT = 1 / 60;
export const SUBSTEPS = 4;

export const SPEED = 5.2; // m/s
export const REACH = 1.05; // m, from the player's centre
export const MAX_Z = 2.7; // highest ball a player can reach, jumping
export const SMASH_Z = 1.75; // above this, a hit is a smash
export const SWING = 0.36; // s a swing can make contact for
export const LATE = 0.2; // s after the ball passed that a swing still reaches it (the others' lag)
export const COOLDOWN = 0.45; // s between swings
export const SERVE_DELAY = 0.5; // s before the server may serve
export const AUTO_SERVE = 6; // s before an idle server's serve goes by itself
export const POINT_PAUSE = 1.8; // s between a point and the next serve
