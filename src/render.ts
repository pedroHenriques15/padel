// Draws a View in perspective from behind the viewer's own baseline: team B's players see the
// court turned round, so everyone plays "up" the screen.
import { AUTO_SERVE, BACK_H, HALF_L, HALF_W, NET_H, SERVE_RED, SERVICE_LINE, SIDE_H } from './sim/constants.ts';
import { halfSign } from './sim/court.ts';
import { EMOTES, FORMATS } from './sim/sim.ts';
import type { Team, View, ViewPlayer } from './sim/types.ts';

// The frame is H tall, and as wide as the canvas on the page, at least 1.6 times H: the court keeps
// its size, and a wider screen shows more round it.
let W = 1280;
const H = 800;

const TEAM_COLOR = ['#ff7a45', '#36d6c3'];
const TEAM_DARK = ['#b8471c', '#1a8f82'];
export const TEAM_NAME = ['Team A', 'Team B'];
const POINTS = ['0', '15', '30', '40'];

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

const EYE: V3 = [0, -19, 10.5];
const F = norm(sub([0, 0.5, 0], EYE));
const R = norm(cross(F, [0, 0, 1]));
const U = cross(R, F);
const FOCAL = 1050;
const MID = -0.052; // centres the court vertically

interface P2 {
  x: number;
  y: number;
  s: number; // pixels per metre at that depth
}

// World to screen, in the viewer's frame (flip turns the court round for team B).
function proj(x: number, y: number, z: number, flip = false): P2 {
  const d = sub(flip ? [-x, -y, z] : [x, y, z], EYE);
  const cz = dot(d, F);
  return { x: W / 2 + (dot(d, R) / cz) * FOCAL, y: H / 2 - (dot(d, U) / cz - MID) * FOCAL, s: FOCAL / cz };
}

function poly(ctx: CanvasRenderingContext2D, pts: P2[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function line(ctx: CanvasRenderingContext2D, a: P2, b: P2): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

// An ellipse on the floor around (x, y), r metres across, or the part of it from 0 to frac.
function floorRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, flip: boolean, frac = 1): void {
  const c = proj(x, y, 0, flip);
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, r * c.s, r * c.s * 0.45, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
}

// A wall panel from (x0,y0) to (x1,y1), z0 to z1: glass, or mesh.
function panel(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, mesh: boolean): void {
  const c = [proj(x0, y0, z0), proj(x1, y1, z0), proj(x1, y1, z1), proj(x0, y0, z1)];
  poly(ctx, c);
  if (mesh) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(160, 175, 195, 0.16)';
    ctx.lineWidth = 1;
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.25);
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      line(ctx, proj(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0), proj(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z1));
    }
    for (let z = z0; z <= z1; z += 0.25) line(ctx, proj(x0, y0, z), proj(x1, y1, z));
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(170, 220, 255, 0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 235, 255, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

function post(ctx: CanvasRenderingContext2D, x: number, y: number, z: number): void {
  ctx.strokeStyle = '#2a3446';
  const a = proj(x, y, 0);
  ctx.lineWidth = Math.max(2, a.s * 0.06);
  line(ctx, a, proj(x, y, z));
}

// The back of the scene: floor, lines, the far glass and the side walls. Never changes.
function drawBack(ctx: CanvasRenderingContext2D): void {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1220');
  bg.addColorStop(1, '#16233a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  poly(ctx, [proj(-HALF_W - 1.5, -HALF_L - 2, 0), proj(HALF_W + 1.5, -HALF_L - 2, 0), proj(HALF_W + 1.5, HALF_L + 1.5, 0), proj(-HALF_W - 1.5, HALF_L + 1.5, 0)]);
  ctx.fillStyle = '#1a2b44';
  ctx.fill();

  poly(ctx, [proj(-HALF_W, -HALF_L, 0), proj(HALF_W, -HALF_L, 0), proj(HALF_W, HALF_L, 0), proj(-HALF_W, HALF_L, 0)]);
  const turf = ctx.createLinearGradient(0, proj(0, HALF_L, 0).y, 0, proj(0, -HALF_L, 0).y);
  turf.addColorStop(0, '#1d5fa3');
  turf.addColorStop(1, '#2a78c8');
  ctx.fillStyle = turf;
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 2.5;
  for (const y of [-SERVICE_LINE, SERVICE_LINE]) line(ctx, proj(-HALF_W, y, 0), proj(HALF_W, y, 0));
  line(ctx, proj(0, -SERVICE_LINE, 0), proj(0, SERVICE_LINE, 0));
  line(ctx, proj(0, HALF_L, 0), proj(0, HALF_L - 0.2, 0));
  line(ctx, proj(0, -HALF_L, 0), proj(0, -HALF_L + 0.2, 0));

  // The far end: glass to 3 m, mesh above; the side walls: glass for 4 m from each end, mesh
  // between.
  for (let x = -HALF_W; x < HALF_W; x += 2.5) {
    panel(ctx, x, HALF_L, x + 2.5, HALF_L, 0, 3, false);
    panel(ctx, x, HALF_L, x + 2.5, HALF_L, 3, BACK_H, true);
  }
  for (const sx of [-HALF_W, HALF_W]) {
    for (const [y0, y1] of [[HALF_L, HALF_L - 2], [HALF_L - 2, HALF_L - 4], [-HALF_L + 4, -HALF_L + 2], [-HALF_L + 2, -HALF_L]]) {
      panel(ctx, sx, y0, sx, y1, 0, SIDE_H, false);
    }
    panel(ctx, sx, HALF_L - 4, sx, -HALF_L + 4, 0, SIDE_H, true);
    for (let y = -HALF_L; y <= HALF_L; y += 2) post(ctx, sx, y, SIDE_H);
  }
  for (let x = -HALF_W; x <= HALF_W; x += 2.5) post(ctx, x, HALF_L, BACK_H);
}

function drawNet(ctx: CanvasRenderingContext2D): void {
  const top = (x: number) => NET_H + 0.02 * (Math.abs(x) / HALF_W);
  poly(ctx, [proj(-HALF_W, 0, 0), proj(HALF_W, 0, 0), proj(HALF_W, 0, top(HALF_W)), proj(-HALF_W, 0, top(-HALF_W))]);
  ctx.fillStyle = 'rgba(8, 12, 20, 0.35)';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1;
  for (let x = -HALF_W; x <= HALF_W; x += 0.12) line(ctx, proj(x, 0, 0), proj(x, 0, 1));
  for (let z = 0; z < NET_H; z += 0.12) line(ctx, proj(-HALF_W, 0, z), proj(HALF_W, 0, z));
  ctx.restore();
  ctx.strokeStyle = '#f4f6fb';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = -HALF_W; x <= HALF_W; x += 0.5) {
    const p = proj(x, 0, top(x));
    if (x === -HALF_W) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  post(ctx, -HALF_W, 0, 1.0);
  post(ctx, HALF_W, 0, 1.0);
}

// The near end, over everything: just the frame, so it doesn't hide the play.
function drawFront(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = 'rgba(200, 235, 255, 0.12)';
  ctx.lineWidth = 1.5;
  line(ctx, proj(-HALF_W, -HALF_L, 3), proj(HALF_W, -HALF_L, 3));
  post(ctx, -HALF_W, -HALF_L, BACK_H);
  post(ctx, HALF_W, -HALF_L, BACK_H);
}

function layer(draw: (ctx: CanvasRenderingContext2D) => void, k: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(W * k);
  c.height = Math.round(H * k);
  const ctx = c.getContext('2d')!;
  ctx.scale(k, k);
  draw(ctx);
  return c;
}

// The colour of a charge: a shot warms from white to orange; a serve is green, red at the top.
function chargeColor(charge: number, serve: boolean): string {
  if (serve) return charge >= SERVE_RED ? '#ff4d4d' : '#7dff7a';
  return charge < 0.5 ? '#ffffff' : charge < 0.9 ? '#ffd23a' : '#ff8a3a';
}

function bubble(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha: number, z: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(z, z);
  ctx.globalAlpha = alpha;
  ctx.font = '700 17px system-ui, "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 22;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -30, w, 28, 10);
  ctx.moveTo(-6, -3);
  ctx.lineTo(0, 5);
  ctx.lineTo(6, -3);
  ctx.fill();
  ctx.fillStyle = '#141a26';
  ctx.fillText(text, 0, -16);
  ctx.restore();
}

// z is how much larger the name and the emote are drawn.
function drawPlayer(ctx: CanvasRenderingContext2D, p: ViewPlayer, flip: boolean, me: boolean, z: number): void {
  const foot = proj(p.x, p.y, 0, flip);
  const s = foot.s;
  const w = 0.44 * s;
  const toward = p.team === 0 ? 1 : -1; // world y towards the net
  const right = (p.team === 0) !== flip ? 1 : -1; // screen side of the player's right hand

  // The charge, as a ring on the floor that fills.
  if (p.charge >= 0) {
    const serve = p.ck >= 2;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    floorRing(ctx, p.x, p.y, 0.62, flip);
    ctx.stroke();
    ctx.strokeStyle = chargeColor(p.charge, serve);
    floorRing(ctx, p.x, p.y, 0.62, flip, Math.max(0.02, p.charge));
    ctx.stroke();
  }

  let label: P2;
  if (p.dive === 2) {
    // Down on the floor after a dive.
    const c = proj(p.x, p.y, 0.25, flip);
    ctx.fillStyle = TEAM_COLOR[p.team];
    ctx.beginPath();
    ctx.roundRect(c.x - 0.55 * s, c.y - 0.16 * s, 1.1 * s, 0.32 * s, 0.14 * s);
    ctx.fill();
    ctx.fillStyle = '#f1c9a5';
    ctx.beginPath();
    ctx.arc(c.x + right * 0.68 * s, c.y - 0.04 * s, 0.12 * s, 0, Math.PI * 2);
    ctx.fill();
    label = proj(p.x, p.y, 0.9, flip);
  } else {
    // Standing, or low and stretched in a dive.
    const diving = p.dive === 1;
    const hip = proj(p.x, p.y, diving ? 0.5 : 0.85, flip);
    const shoulder = proj(p.x, p.y, diving ? 0.95 : 1.45, flip);
    const head = proj(p.x, p.y, diving ? 1.12 : 1.66, flip);
    ctx.fillStyle = '#1b2232';
    ctx.fillRect(foot.x - w * 0.36, hip.y, w * 0.3, foot.y - hip.y);
    ctx.fillRect(foot.x + w * 0.06, hip.y, w * 0.3, foot.y - hip.y);
    ctx.fillStyle = TEAM_COLOR[p.team];
    ctx.beginPath();
    ctx.roundRect(foot.x - w / 2, shoulder.y, w, hip.y - shoulder.y + 2, w * 0.25);
    ctx.fill();
    ctx.fillStyle = '#f1c9a5';
    ctx.beginPath();
    ctx.arc(head.x, head.y, 0.12 * s, 0, Math.PI * 2);
    ctx.fill();

    // The racket, in the right hand: drawn back and up while charging, swung from behind to in
    // front over a swing, reaching out in a dive.
    const a = p.swing > 0 ? 1 - p.swing : 0.5;
    const back = p.charge >= 0 ? 0.25 + p.charge * 0.35 : 0;
    const ry = p.y + toward * (p.swing > 0 ? -0.4 + a * 0.9 : p.charge >= 0 ? -back : 0.1);
    const rx = p.x + (p.team === 0 ? 1 : -1) * (diving ? 0.85 : 0.45);
    const rz = diving ? 0.7 : 1.05 + (p.swing > 0 ? Math.sin(a * Math.PI) * 0.25 : p.charge >= 0 ? back * 0.8 : 0);
    const hand = proj(p.x + (p.team === 0 ? 1 : -1) * 0.25, p.y, diving ? 0.75 : 1.0, flip);
    const racket = proj(rx, ry, rz, flip);
    ctx.strokeStyle = '#2b2f3a';
    ctx.lineWidth = Math.max(2, 0.04 * s);
    line(ctx, hand, racket);
    ctx.fillStyle = TEAM_DARK[p.team];
    ctx.strokeStyle = '#0e121a';
    ctx.beginPath();
    ctx.ellipse(racket.x + right * 0.02 * s, racket.y, 0.12 * s, 0.15 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    label = proj(p.x, p.y, diving ? 1.5 : 2.05, flip);
  }

  const size = Math.round(Math.max(12, Math.min(18, 0.3 * s)) * z);
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3 * z;
  ctx.strokeStyle = 'rgba(5, 8, 14, 0.8)';
  ctx.strokeText(p.name, label.x, label.y);
  ctx.fillStyle = me ? '#ffffff' : 'rgba(235, 240, 250, 0.85)';
  ctx.fillText(p.name, label.x, label.y);
  let top = label.y - size - 4 * z;
  if (me) {
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.moveTo(label.x - 7 * z, top - 8 * z);
    ctx.lineTo(label.x + 7 * z, top - 8 * z);
    ctx.lineTo(label.x, top);
    ctx.closePath();
    ctx.fill();
    top -= 12 * z;
  }
  if (p.em) bubble(ctx, EMOTES[p.em - 1], label.x, top, Math.min(1, p.et / 0.3), z);
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, flip: boolean): void {
  const p = proj(x, y, 0, flip);
  ctx.fillStyle = `rgba(0, 10, 30, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * p.s, r * p.s * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

const teamLabel = (v: View, t: Team) =>
  v.players
    .filter((p) => p.team === t)
    .map((p) => p.name)
    .join(' & ') || TEAM_NAME[t];

// Returns where its box ends on the right.
function drawScore(ctx: CanvasRenderingContext2D, v: View): number {
  const x = 22;
  const y = 22;
  const sets = v.format.startsWith('s');
  const done = v.setScores;
  const w = 340 + done.length * 30;
  ctx.fillStyle = 'rgba(8, 12, 22, 0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, 88, 12);
  ctx.fill();
  const golden = !v.tiebreak && v.points[0] === 3 && v.points[1] === 3;
  const nameW = 190 - (sets ? 10 : 0);
  for (const t of [0, 1] as const) {
    const ry = y + 30 + t * 38;
    ctx.fillStyle = TEAM_COLOR[t];
    ctx.beginPath();
    ctx.roundRect(x + 12, ry - 14, 6, 22, 3);
    ctx.fill();
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e9eef7';
    let name = teamLabel(v, t);
    while (ctx.measureText(name).width > nameW && name.length > 4) name = name.slice(0, -2) + '…';
    ctx.fillText(name, x + 28, ry - 2);
    if (v.servingTeam === t && v.phase !== 'over') {
      ctx.fillStyle = '#e5ff3a';
      ctx.beginPath();
      ctx.arc(x + 28 + ctx.measureText(name).width + 12, ry - 2, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    done.forEach((set, i) => {
      ctx.font = `${set[t] > set[1 - t] ? 700 : 500} 17px system-ui, sans-serif`;
      ctx.fillStyle = set[t] > set[1 - t] ? '#e9eef7' : '#6f819b';
      ctx.fillText(String(set[t]), x + w - 112 - (done.length - i) * 30, ry - 1);
    });
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillStyle = '#9fb0c8';
    ctx.fillText(String(v.games[t]), x + w - 82, ry - 1);
    ctx.fillStyle = golden || v.tiebreak ? '#ffe14d' : '#ffffff';
    ctx.fillText(v.tiebreak ? String(v.points[t]) : POINTS[Math.min(3, v.points[t])], x + w - 34, ry - 1);
  }
  ctx.font = '500 11px system-ui, sans-serif';
  ctx.fillStyle = '#6f819b';
  ctx.textAlign = 'center';
  ctx.fillText('GAMES', x + w - 82, y + 10);
  ctx.fillText('POINTS', x + w - 34, y + 10);
  if (done.length) ctx.fillText('SETS', x + w - 112 - ((done.length + 1) * 30) / 2, y + 10);
  ctx.textAlign = 'left';
  ctx.fillText(FORMATS[v.format].label + (v.tiebreak ? ' · Tie-break' : ''), x + 12, y + 102);
  return x + w;
}

// A message at the top, in the middle: up to z times larger, but no more than 1.2, so it leaves the
// far players' names in sight, and smaller if need be to keep clear of the score, whose box ends at
// left.
function banner(ctx: CanvasRenderingContext2D, title: string, sub: string, color: string, z: number, left: number): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '500 17px system-ui, sans-serif';
  const subW = sub ? ctx.measureText(sub).width : 0;
  ctx.font = '800 32px system-ui, sans-serif';
  const w = Math.max(ctx.measureText(title).width, subW, 260) + 60;
  const k = Math.max(0.75, Math.min(z, 1.2, (W / 2 - left - 12) / (w / 2)));
  ctx.translate(W / 2, 0);
  ctx.scale(k, k);
  ctx.fillStyle = 'rgba(8, 12, 22, 0.78)';
  ctx.beginPath();
  ctx.roundRect(-w / 2, 16, w, sub ? 82 : 60, 14);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(title, 0, 46);
  if (sub) {
    ctx.font = '500 17px system-ui, sans-serif';
    ctx.fillStyle = '#c9d4e5';
    ctx.fillText(sub, 0, 80);
  }
  ctx.restore();
}

// What only the viewer sees about their own player.
export interface Overlay {
  charge: number; // 0-1, or -1
  serve: boolean; // they are serving
  target: { x: number; y: number } | null; // where the shot or serve would go
  reachable: boolean; // the ball is within their reach now
  reach: number;
}

export interface DrawOpts {
  viewTeam: Team;
  me: string | null;
  hud: boolean;
  overlay?: Overlay;
  touch?: boolean; // they play on a touch screen: the help names its buttons
}

interface Floater {
  x: number;
  y: number;
  t: number;
  tag: string;
  kmh: number;
}

const tagColor = (tag: string) =>
  tag === 'Perfect!' ? '#e5ff3a' : tag.startsWith('Smash') || tag.startsWith('Por') ? '#ff6a5a' : tag === 'Frame!' ? '#ffb27a' : '#ffffff';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private back!: HTMLCanvasElement;
  private net!: HTMLCanvasElement;
  private front!: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size = '';
  private zoom = 1; // how much larger the HUD and the names are drawn, to stay readable on a small screen
  private trail: { x: number; y: number; z: number; t: number }[] = [];
  private marks: { x: number; y: number; t: number }[] = [];
  private floaters: Floater[] = [];
  private seenMark = -1;
  private seenShot = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.fit();
  }

  // Fits the frame to the canvas's size on the page, as it is now (a phone turns, a window
  // resizes), with as many pixels as the screen has there, up to twice the frame's.
  private fit(): void {
    const cw = this.canvas.clientWidth || W;
    const ch = this.canvas.clientHeight || H;
    const dpr = window.devicePixelRatio || 1;
    const size = `${cw} ${ch} ${dpr}`;
    if (size === this.size) return;
    this.size = size;
    W = Math.round(H * Math.max(1.6, cw / ch));
    const k = Math.min(2, (ch * dpr) / H);
    this.canvas.width = Math.round(W * k);
    this.canvas.height = Math.round(H * k);
    this.ctx.setTransform(k, 0, 0, k, 0, 0);
    this.back = layer(drawBack, k);
    this.net = layer(drawNet, k);
    this.front = layer(drawFront, k);
    this.zoom = Math.min(1.45, Math.max(1, 540 / ch));
  }

  // Bounce marks and shot speeds come from counters in the view: a new number is a new one.
  private remember(v: View, now: number): void {
    if (this.seenMark < 0 || v.mark.n < this.seenMark) this.seenMark = v.mark.n;
    if (this.seenShot < 0 || v.shot.n < this.seenShot) this.seenShot = v.shot.n;
    if (v.mark.n > this.seenMark) {
      this.seenMark = v.mark.n;
      this.marks.push({ x: v.mark.x, y: v.mark.y, t: now });
    }
    if (v.shot.n > this.seenShot) {
      this.seenShot = v.shot.n;
      const p = v.players.find((q) => q.id === v.shot.id);
      if (p) this.floaters.push({ x: p.x, y: p.y, t: now, tag: v.shot.tag, kmh: v.shot.kmh });
    }
    this.marks = this.marks.filter((m) => now - m.t < 1600);
    this.floaters = this.floaters.filter((f) => now - f.t < 1400);
    const b = v.ball;
    const last = this.trail.at(-1);
    if (last && Math.hypot(b.x - last.x, b.y - last.y, b.z - last.z) > 2.5) this.trail = [];
    if (!last || last.x !== b.x || last.y !== b.y || last.z !== b.z) this.trail.push({ ...b, t: now });
    this.trail = this.trail.filter((p) => now - p.t < 140);
  }

  draw(v: View, o: DrawOpts, now = performance.now()): void {
    this.fit();
    const ctx = this.ctx;
    const z = this.zoom;
    const flip = o.viewTeam === 1;
    this.remember(v, now);
    ctx.drawImage(this.back, 0, 0, W, H);
    const me = o.me ? v.players.find((p) => p.id === o.me) : undefined;
    const ov = o.hud ? o.overlay : undefined;

    // Serving: the box to aim at.
    if (ov?.serve && me) {
      const hs = halfSign(me.team === 0 ? 1 : 0);
      poly(ctx, [proj(0, 0, 0, flip), proj(v.boxSign * HALF_W, 0, 0, flip), proj(v.boxSign * HALF_W, hs * SERVICE_LINE, 0, flip), proj(0, hs * SERVICE_LINE, 0, flip)]);
      ctx.fillStyle = 'rgba(229, 255, 58, 0.08)';
      ctx.fill();
    }

    for (const m of this.marks) {
      const a = 1 - (now - m.t) / 1600;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * a})`;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.25 * a})`;
      ctx.lineWidth = 2;
      floorRing(ctx, m.x, m.y, 0.13, flip);
      ctx.fill();
      ctx.stroke();
    }

    if (me && ov && v.phase !== 'over') {
      ctx.lineWidth = ov.reachable ? 3 : 1.5;
      ctx.strokeStyle = ov.reachable ? '#e5ff3a' : 'rgba(255, 255, 255, 0.16)';
      floorRing(ctx, me.x, me.y, ov.reach, flip);
      ctx.stroke();
    }
    if (me && ov?.target && ov.charge >= 0) {
      const pulse = 0.8 + 0.2 * Math.sin(now / 90);
      const t = ov.target;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = TEAM_COLOR[me.team];
      ctx.globalAlpha = pulse;
      floorRing(ctx, t.x, t.y, 0.42, flip);
      ctx.stroke();
      floorRing(ctx, t.x, t.y, 0.18, flip);
      ctx.fillStyle = TEAM_COLOR[me.team];
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (const p of v.players) shadow(ctx, p.x, p.y, 0.38, 0.35, flip);
    const b = v.ball;
    shadow(ctx, b.x, b.y, 0.09, Math.max(0.12, 0.45 - b.z * 0.08), flip);

    // Far to near, with the net between the halves.
    const depth = (y: number) => (flip ? -y : y);
    const items: { d: number; draw: () => void }[] = [
      { d: 0, draw: () => ctx.drawImage(this.net, 0, 0, W, H) },
      ...v.players.map((p) => ({ d: depth(p.y), draw: () => drawPlayer(ctx, p, flip, p.id === o.me, z) })),
      { d: depth(b.y), draw: () => this.drawBall(v, flip, now) },
    ];
    items.sort((a, c) => c.d - a.d).forEach((i) => i.draw());
    ctx.drawImage(this.front, 0, 0, W, H);

    // Shot speeds and names, rising beside the hitter, clear of their name and emotes.
    for (const f of this.floaters) {
      const k = (now - f.t) / 1400;
      const p = proj(f.x, f.y, 1.5 + k * 0.7, flip);
      p.x += 0.75 * p.s;
      ctx.globalAlpha = Math.min(1, (1 - k) * 2.2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(5, 8, 14, 0.85)';
      let y = p.y;
      if (f.tag) {
        ctx.font = `800 ${Math.round(20 * z)}px system-ui, sans-serif`;
        ctx.strokeText(f.tag, p.x, y);
        ctx.fillStyle = tagColor(f.tag);
        ctx.fillText(f.tag, p.x, y);
        y += 17 * z;
      }
      if (f.kmh > 0) {
        ctx.font = `600 ${Math.round(14 * z)}px system-ui, sans-serif`;
        const t = `${f.kmh} km/h`;
        ctx.strokeText(t, p.x, y);
        ctx.fillStyle = '#c9d4e5';
        ctx.fillText(t, p.x, y);
      }
      ctx.globalAlpha = 1;
    }

    if (!o.hud) return;
    if (ov?.serve && me) this.powerBar(me, ov.charge, flip);
    ctx.save();
    ctx.scale(z, z);
    const score = drawScore(ctx, v) * z;
    ctx.restore();
    if (v.phase === 'point') {
      if (v.pointWinner === null) {
        const [title, sub] = v.message.split(': ');
        banner(ctx, title, sub ?? '', '#ffe14d', z, score);
      } else banner(ctx, `Point ${teamLabel(v, v.pointWinner)}`, v.message, TEAM_COLOR[v.pointWinner], z, score);
    } else if (v.phase === 'serve') {
      const mine = v.serverId === o.me;
      const left = Math.ceil(AUTO_SERVE - v.timer);
      if (mine) {
        const keys = o.touch ? 'Hold Hit for power (Lob: slice) · slide to aim · let go' : 'A/D walk · hold Space for power (E: slice) · arrows aim · let go';
        banner(ctx, v.message ? `Your serve · ${v.message}` : 'Your serve', left <= 3 ? `Serving by itself in ${left}…` : keys, '#ffffff', z, score);
      } else if (v.message) banner(ctx, v.message, '', '#ffe14d', z, score);
    }
  }

  private drawBall(v: View, flip: boolean, now: number): void {
    const ctx = this.ctx;
    const tr = this.trail;
    if (tr.length >= 2) {
      const a = tr[0];
      const z = tr[tr.length - 1];
      const speed = Math.hypot(z.x - a.x, z.y - a.y, z.z - a.z) / Math.max(0.001, (z.t - a.t) / 1000);
      if (speed > 9) {
        const strength = Math.min(1, (speed - 9) / 12);
        for (let i = 1; i < tr.length; i++) {
          const k = 1 - (now - tr[i].t) / 140;
          const p0 = proj(tr[i - 1].x, tr[i - 1].y, tr[i - 1].z, flip);
          const p1 = proj(tr[i].x, tr[i].y, tr[i].z, flip);
          ctx.strokeStyle = `rgba(229, 255, 58, ${0.5 * k * strength})`;
          ctx.lineWidth = Math.max(2, 0.12 * p1.s * k);
          ctx.lineCap = 'round';
          line(ctx, p0, p1);
        }
        ctx.lineCap = 'butt';
      }
    }
    const p = proj(v.ball.x, v.ball.y, v.ball.z, flip);
    ctx.fillStyle = '#e5ff3a';
    ctx.strokeStyle = 'rgba(40, 50, 0, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3.5, 0.08 * p.s), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // The serve's power bar, beside the server: green, then red at the top.
  private powerBar(me: ViewPlayer, charge: number, flip: boolean): void {
    const ctx = this.ctx;
    const head = proj(me.x, me.y, 1.7, flip);
    const foot = proj(me.x, me.y, 0, flip);
    const h = 96;
    const x = 0;
    const y = 0;
    ctx.save();
    ctx.translate(foot.x + 0.75 * foot.s, head.y - 10);
    ctx.scale(this.zoom, this.zoom);
    ctx.fillStyle = 'rgba(8, 12, 22, 0.8)';
    ctx.beginPath();
    ctx.roundRect(x - 3, y - 3, 20, h + 6, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 77, 77, 0.25)';
    ctx.fillRect(x, y, 14, h * (1 - SERVE_RED));
    if (charge > 0) {
      ctx.fillStyle = chargeColor(charge, true);
      ctx.fillRect(x, y + h * (1 - charge), 14, h * charge);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    line(ctx, { x, y: y + h * (1 - SERVE_RED), s: 1 }, { x: x + 14, y: y + h * (1 - SERVE_RED), s: 1 });
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c9d4e5';
    ctx.fillText('POWER', x + 7, y + h + 16);
    ctx.restore();
  }
}
