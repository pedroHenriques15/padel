// Draws a View in perspective from behind the viewer's own baseline: team B's players see the
// court turned round, so everyone plays "up" the screen.
import { BACK_H, HALF_L, HALF_W, NET_H, SERVICE_LINE, SIDE_H } from './sim/constants.ts';
import type { Team, View, ViewPlayer } from './sim/types.ts';

export const W = 1280;
export const H = 800;

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

function layer(draw: (ctx: CanvasRenderingContext2D) => void, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W * dpr;
  c.height = H * dpr;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  draw(ctx);
  return c;
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: ViewPlayer, flip: boolean, me: boolean): void {
  const foot = proj(p.x, p.y, 0, flip);
  const s = foot.s;
  const hip = proj(p.x, p.y, 0.85, flip);
  const shoulder = proj(p.x, p.y, 1.45, flip);
  const head = proj(p.x, p.y, 1.66, flip);
  const w = 0.44 * s;

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

  // The racket, in the right hand: swung from behind to in front over a swing.
  const right = (p.team === 0) !== flip ? 1 : -1; // screen side of the player's right hand
  const toward = p.team === 0 ? 1 : -1; // world y towards the net
  const a = p.swing > 0 ? 1 - p.swing : 0.5;
  const ry = p.y + toward * (p.swing > 0 ? -0.4 + a * 0.9 : 0.1);
  const rx = p.x + ((p.team === 0 ? 1 : -1) * 0.45);
  const hand = proj(p.x + (p.team === 0 ? 1 : -1) * 0.25, p.y, 1.0, flip);
  const racket = proj(rx, ry, 1.05 + (p.swing > 0 ? Math.sin(a * Math.PI) * 0.25 : 0), flip);
  ctx.strokeStyle = '#2b2f3a';
  ctx.lineWidth = Math.max(2, 0.04 * s);
  line(ctx, hand, racket);
  ctx.fillStyle = TEAM_DARK[p.team];
  ctx.strokeStyle = '#0e121a';
  ctx.beginPath();
  ctx.ellipse(racket.x + right * 0.02 * s, racket.y, 0.12 * s, 0.15 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const label = proj(p.x, p.y, 2.05, flip);
  const size = Math.round(Math.max(12, Math.min(18, 0.3 * s)));
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(5, 8, 14, 0.8)';
  ctx.strokeText(p.name, label.x, label.y);
  ctx.fillStyle = me ? '#ffffff' : 'rgba(235, 240, 250, 0.85)';
  ctx.fillText(p.name, label.x, label.y);
  if (me) {
    const y = label.y - size - 4;
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.moveTo(label.x - 7, y - 8);
    ctx.lineTo(label.x + 7, y - 8);
    ctx.lineTo(label.x, y);
    ctx.closePath();
    ctx.fill();
  }
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

function drawScore(ctx: CanvasRenderingContext2D, v: View): void {
  const x = 22;
  const y = 22;
  const w = 340;
  ctx.fillStyle = 'rgba(8, 12, 22, 0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, 88, 12);
  ctx.fill();
  const golden = v.points[0] === 3 && v.points[1] === 3;
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
    while (ctx.measureText(name).width > 190 && name.length > 4) name = name.slice(0, -2) + '…';
    ctx.fillText(name, x + 28, ry - 2);
    if (v.servingTeam === t && v.phase !== 'over') {
      ctx.fillStyle = '#e5ff3a';
      ctx.beginPath();
      ctx.arc(x + 28 + ctx.measureText(name).width + 12, ry - 2, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillStyle = '#9fb0c8';
    ctx.fillText(String(v.games[t]), x + w - 82, ry - 1);
    ctx.fillStyle = golden ? '#ffe14d' : '#ffffff';
    ctx.fillText(POINTS[Math.min(3, v.points[t])], x + w - 34, ry - 1);
  }
  ctx.font = '500 11px system-ui, sans-serif';
  ctx.fillStyle = '#6f819b';
  ctx.textAlign = 'center';
  ctx.fillText('GAMES', x + w - 82, y + 10);
  ctx.fillText('POINTS', x + w - 34, y + 10);
  ctx.textAlign = 'left';
  ctx.fillText(`First to ${v.gamesToWin} games`, x + 12, y + 102);
}

function banner(ctx: CanvasRenderingContext2D, title: string, sub: string, color: string): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 32px system-ui, sans-serif';
  const w = Math.max(ctx.measureText(title).width, 260) + 60;
  ctx.fillStyle = 'rgba(8, 12, 22, 0.78)';
  ctx.beginPath();
  ctx.roundRect(W / 2 - w / 2, 16, w, sub ? 82 : 60, 14);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(title, W / 2, 46);
  if (sub) {
    ctx.font = '500 17px system-ui, sans-serif';
    ctx.fillStyle = '#c9d4e5';
    ctx.fillText(sub, W / 2, 80);
  }
}

export interface DrawOpts {
  viewTeam: Team;
  me: string | null;
  hud: boolean;
}

export class Renderer {
  private back: HTMLCanvasElement;
  private net: HTMLCanvasElement;
  private front: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.back = layer(drawBack, dpr);
    this.net = layer(drawNet, dpr);
    this.front = layer(drawFront, dpr);
  }

  draw(v: View, o: DrawOpts): void {
    const ctx = this.ctx;
    const flip = o.viewTeam === 1;
    ctx.drawImage(this.back, 0, 0, W, H);

    for (const p of v.players) shadow(ctx, p.x, p.y, 0.38, 0.35, flip);
    const b = v.ball;
    shadow(ctx, b.x, b.y, 0.09, Math.max(0.12, 0.45 - b.z * 0.08), flip);

    // Far to near, with the net between the halves.
    const depth = (y: number) => (flip ? -y : y);
    const items: { d: number; draw: () => void }[] = [
      { d: 0, draw: () => ctx.drawImage(this.net, 0, 0, W, H) },
      ...v.players.map((p) => ({ d: depth(p.y), draw: () => drawPlayer(ctx, p, flip, p.id === o.me) })),
      {
        d: depth(b.y),
        draw: () => {
          const p = proj(b.x, b.y, b.z, flip);
          ctx.fillStyle = '#e5ff3a';
          ctx.strokeStyle = 'rgba(40, 50, 0, 0.6)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(3.5, 0.08 * p.s), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        },
      },
    ];
    items.sort((a, c) => c.d - a.d).forEach((i) => i.draw());
    ctx.drawImage(this.front, 0, 0, W, H);

    if (!o.hud) return;
    drawScore(ctx, v);
    if (v.phase === 'point') {
      if (v.pointWinner === null) banner(ctx, v.message.startsWith('Fault') ? 'Fault' : v.message, v.message.replace(/^Fault: /, ''), '#ffe14d');
      else banner(ctx, `Point ${teamLabel(v, v.pointWinner)}`, v.message, TEAM_COLOR[v.pointWinner]);
    } else if (v.phase === 'serve') {
      const mine = v.serverId === o.me;
      if (mine) banner(ctx, 'Your serve', `Space to serve · hold ←/→ to aim${v.message ? ` · ${v.message}` : ''}`, '#ffffff');
      else if (v.message) banner(ctx, v.message, '', '#ffe14d');
    }
  }
}
