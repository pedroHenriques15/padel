// Rooms over WebRTC (PeerJS). Whoever creates the room is the host: their browser runs the match
// and sends everyone a View 30 times a second; the others send their keys.
import Peer, { type DataConnection } from 'peerjs';
import type { Controls } from './input.ts';
import { DT } from './sim/constants.ts';
import { newMatch, step, toView } from './sim/sim.ts';
import type { Seat, State, Team, TickInput, View } from './sim/types.ts';

const PREFIX = 'padel-pk26-';
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const HOST_ID = 'host';
const MAX_MEMBERS = 8;

export type SeatKey = 'A0' | 'A1' | 'B0' | 'B1';
export type Mode = '1v1' | '1v2' | '2v2';
export const MODE_SEATS: Record<Mode, SeatKey[]> = {
  '1v1': ['A0', 'B0'],
  '1v2': ['A0', 'B0', 'B1'],
  '2v2': ['A0', 'A1', 'B0', 'B1'],
};

export interface Member {
  id: string;
  name: string;
}

export interface Lobby {
  code: string;
  mode: Mode;
  gamesToWin: number;
  soloAssist: boolean;
  members: Member[];
  seats: Partial<Record<SeatKey, string>>; // member ids
  playing: boolean;
}

type ToHost = { t: 'hello'; name: string } | { t: 'sit'; seat: SeatKey | null } | ({ t: 'in' } & Controls) | { t: 'ping' };

// A browser that closes without saying goodbye can take long to notice over WebRTC, so the others
// ping every second, and the host lets go of one silent for this long.
const PING_MS = 1000;
const SILENT_MS = 6000;
type ToClient = { t: 'lobby'; lobby: Lobby; you: string } | { t: 'view'; v: View } | { t: 'bye'; why: string };

export const cleanName = (n: unknown): string =>
  (typeof n === 'string' ? n : '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) || 'Player';

export const seatTeam = (k: SeatKey): Team => (k[0] === 'A' ? 0 : 1);

export function mySeat(lobby: Lobby, id: string): SeatKey | null {
  return (Object.keys(lobby.seats) as SeatKey[]).find((k) => lobby.seats[k] === id && MODE_SEATS[lobby.mode].includes(k)) ?? null;
}

function makeCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    const fail = (e: unknown) => {
      peer.destroy();
      reject(e);
    };
    peer.once('open', () => {
      peer.off('error', fail);
      resolve(peer);
    });
    peer.once('error', fail);
  });
}

const errType = (e: unknown) => (e as { type?: string })?.type ?? '';

// Tick about 60 times a second from a worker: a background tab throttles its own timers, not a
// worker's, so the match goes on if the host switches tabs.
function ticker(fn: () => void): () => void {
  const src = 'setInterval(() => postMessage(0), 1000 / 60);';
  try {
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = fn;
    return () => w.terminate();
  } catch {
    const t = setInterval(fn, 1000 / 60);
    return () => clearInterval(t);
  }
}

interface Remote {
  conn: DataConnection;
  heard: number;
  name: string;
  ctl: Controls;
  seen: { h: number; l: number };
}

export class HostSession {
  readonly you = HOST_ID;
  lobby: Lobby;
  state: State | null = null;
  onChange: () => void = () => {};
  private remotes = new Map<string, Remote>();
  private localSeen = { h: 0, l: 0 };
  private stopTicker: (() => void) | null = null;
  private watchdog: ReturnType<typeof setInterval>;
  private acc = 0;
  private last = 0;
  private frame = 0;
  private peer: Peer;
  private readKeys: () => Controls;

  private constructor(peer: Peer, code: string, name: string, readKeys: () => Controls) {
    this.peer = peer;
    this.readKeys = readKeys;
    this.lobby = { code, mode: '2v2', gamesToWin: 3, soloAssist: true, members: [{ id: HOST_ID, name }], seats: { A0: HOST_ID }, playing: false };
    peer.on('connection', (c) => this.accept(c));
    this.watchdog = setInterval(() => {
      for (const [id, r] of this.remotes) {
        if (performance.now() - r.heard > SILENT_MS) {
          r.conn.close();
          this.drop(id);
        }
      }
    }, PING_MS);
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
  }

  static async create(name: string, readKeys: () => Controls): Promise<HostSession> {
    for (let i = 0; ; i++) {
      const code = makeCode();
      try {
        return new HostSession(await openPeer(PREFIX + code), code, name, readKeys);
      } catch (e) {
        if (errType(e) !== 'unavailable-id' || i >= 3) throw e;
      }
    }
  }

  private accept(c: DataConnection): void {
    c.on('data', (raw) => this.receive(c, raw as ToHost));
    c.on('close', () => this.drop(c.peer));
    c.on('error', () => this.drop(c.peer));
  }

  private send(c: DataConnection, m: ToClient): void {
    if (c.open) void c.send(m);
  }

  private receive(c: DataConnection, m: ToHost): void {
    if (!m || typeof m !== 'object') return;
    const r = this.remotes.get(c.peer);
    if (r) r.heard = performance.now();
    if (m.t === 'hello' && !r) {
      if (this.lobby.members.length >= MAX_MEMBERS) {
        this.send(c, { t: 'bye', why: 'The room is full.' });
        setTimeout(() => c.close(), 500);
        return;
      }
      const name = cleanName(m.name);
      this.remotes.set(c.peer, { conn: c, heard: performance.now(), name, ctl: { ix: 0, iy: 0, h: 0, l: 0 }, seen: { h: 0, l: 0 } });
      this.lobby.members.push({ id: c.peer, name });
      if (!this.lobby.playing) {
        const free = MODE_SEATS[this.lobby.mode].find((k) => !this.lobby.seats[k]);
        if (free) this.lobby.seats[free] = c.peer;
      }
      this.changed();
    } else if (m.t === 'sit' && r) {
      this.sit(c.peer, m.seat);
    } else if (m.t === 'in' && r) {
      const n = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
      r.ctl = { ix: n(m.ix, -1, 1), iy: n(m.iy, -1, 1), h: n(m.h, 0, 1e9), l: n(m.l, 0, 1e9) };
    }
  }

  private drop(id: string): void {
    if (!this.remotes.delete(id)) return;
    this.lobby.members = this.lobby.members.filter((m) => m.id !== id);
    for (const k of Object.keys(this.lobby.seats) as SeatKey[]) if (this.lobby.seats[k] === id) delete this.lobby.seats[k];
    // Mid-match, a bot takes over.
    const p = this.state?.players.find((p) => p.id === id);
    if (p) {
      p.bot = true;
      p.name += ' (bot)';
    }
    this.changed();
  }

  sit(id: string, seat: SeatKey | null): void {
    if (this.lobby.playing) return;
    if (seat && (!MODE_SEATS[this.lobby.mode].includes(seat) || this.lobby.seats[seat])) return;
    for (const k of Object.keys(this.lobby.seats) as SeatKey[]) if (this.lobby.seats[k] === id) delete this.lobby.seats[k];
    if (seat) this.lobby.seats[seat] = id;
    this.changed();
  }

  configure(c: Partial<Pick<Lobby, 'mode' | 'gamesToWin' | 'soloAssist'>>): void {
    if (this.lobby.playing) return;
    Object.assign(this.lobby, c);
    // Someone in a seat the new mode drops moves to a free one.
    const active = MODE_SEATS[this.lobby.mode];
    for (const k of Object.keys(this.lobby.seats) as SeatKey[]) {
      if (active.includes(k)) continue;
      const id = this.lobby.seats[k]!;
      delete this.lobby.seats[k];
      const free = active.find((a) => !this.lobby.seats[a]);
      if (free) this.lobby.seats[free] = id;
    }
    this.changed();
  }

  start(): void {
    const seats: Seat[] = MODE_SEATS[this.lobby.mode].map((k) => {
      const member = this.lobby.members.find((m) => m.id === this.lobby.seats[k]);
      const team = seatTeam(k);
      const slot = k[1] === '0' ? 0 : 1;
      return member ? { id: member.id, name: member.name, team, slot, bot: false } : { id: `bot-${k}`, name: `Bot ${k}`, team, slot, bot: true };
    });
    this.state = newMatch({ gamesToWin: this.lobby.gamesToWin, soloAssist: this.lobby.soloAssist, seats });
    this.lobby.playing = true;
    this.localSeen = { ...this.localSeen, ...this.readKeys() };
    for (const r of this.remotes.values()) r.seen = { h: r.ctl.h, l: r.ctl.l };
    this.last = performance.now();
    this.acc = 0;
    this.stopTicker?.();
    this.stopTicker = ticker(() => this.tick());
    this.changed();
  }

  backToLobby(): void {
    this.stopTicker?.();
    this.stopTicker = null;
    this.state = null;
    this.lobby.playing = false;
    this.changed();
  }

  leave(): void {
    this.stopTicker?.();
    clearInterval(this.watchdog);
    this.peer.destroy();
  }

  private tick(): void {
    const now = performance.now();
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    while (this.acc >= DT * 1000 && this.state) {
      this.acc -= DT * 1000;
      const inputs: Record<string, TickInput> = { [HOST_ID]: edges(this.readKeys(), this.localSeen) };
      for (const [id, r] of this.remotes) inputs[id] = edges(r.ctl, r.seen);
      step(this.state, inputs);
      if (++this.frame % 2 === 0) {
        const m: ToClient = { t: 'view', v: toView(this.state) };
        for (const r of this.remotes.values()) this.send(r.conn, m);
      }
    }
  }

  private changed(): void {
    for (const [id, r] of this.remotes) this.send(r.conn, { t: 'lobby', lobby: this.lobby, you: id });
    this.onChange();
  }
}

// One tick's input from running counts: a press since the last tick is a hit.
function edges(c: Controls, seen: { h: number; l: number }): TickInput {
  const hit = c.h > seen.h;
  const lob = c.l > seen.l;
  seen.h = c.h;
  seen.l = c.l;
  return { ix: c.ix, iy: c.iy, hit, lob };
}

const INTERP_MS = 80;

export class ClientSession {
  lobby: Lobby | null = null;
  you = '';
  onChange: () => void = () => {};
  onClose: (why: string) => void = () => {};
  private views: { at: number; v: View }[] = [];
  private sent = { ix: 0, iy: 0, h: 0, l: 0, at: 0 };
  private closed = false;
  private peer: Peer;
  private conn: DataConnection;
  private pinger: ReturnType<typeof setInterval>;

  private constructor(peer: Peer, conn: DataConnection) {
    this.peer = peer;
    this.conn = conn;
    this.pinger = setInterval(() => {
      if (conn.open) void conn.send({ t: 'ping' } satisfies ToHost);
    }, PING_MS);
    conn.on('data', (raw) => this.receive(raw as ToClient));
    conn.on('close', () => this.close('The host closed the room.'));
    conn.on('error', () => this.close('Lost the connection to the host.'));
    peer.on('error', (e) => {
      if (errType(e) !== 'peer-unavailable') this.close('Lost the connection to the host.');
    });
  }

  static async join(code: string, name: string): Promise<ClientSession> {
    const peer = await openPeer();
    return new Promise((resolve, reject) => {
      const conn = peer.connect(PREFIX + code.toLowerCase(), { reliable: true });
      const fail = (why: string) => {
        peer.destroy();
        reject(new Error(why));
      };
      const timer = setTimeout(() => fail("Couldn't reach that room. Check the code, and that the host still has it open."), 15000);
      peer.once('error', (e) => {
        clearTimeout(timer);
        fail(errType(e) === 'peer-unavailable' ? 'No room with that code.' : `Couldn't connect (${errType(e) || 'error'}).`);
      });
      conn.once('open', () => {
        clearTimeout(timer);
        const s = new ClientSession(peer, conn);
        void conn.send({ t: 'hello', name } satisfies ToHost);
        resolve(s);
      });
    });
  }

  private receive(m: ToClient): void {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'lobby') {
      const wasPlaying = this.lobby?.playing;
      this.lobby = m.lobby;
      this.you = m.you;
      if (!m.lobby.playing || !wasPlaying) this.views = [];
      this.onChange();
    } else if (m.t === 'view') {
      this.views.push({ at: performance.now(), v: m.v });
      if (this.views.length > 12) this.views.shift();
    } else if (m.t === 'bye') {
      this.close(m.why);
    }
  }

  sit(seat: SeatKey | null): void {
    void this.conn.send({ t: 'sit', seat } satisfies ToHost);
  }

  // Sends the keys when they change, and twice a second anyway.
  sendControls(c: Controls): void {
    const now = performance.now();
    const s = this.sent;
    if (c.ix === s.ix && c.iy === s.iy && c.h === s.h && c.l === s.l && now - s.at < 500) return;
    this.sent = { ...c, at: now };
    if (this.conn.open) void this.conn.send({ t: 'in', ...c } satisfies ToHost);
  }

  // The view a little in the past, between the two snapshots around it, so motion is smooth. The
  // player's own figure is the newest, so moving feels quicker.
  view(): View | null {
    const v = this.smoothed();
    const newest = this.views.at(-1)?.v.players.find((p) => p.id === this.you);
    if (v && newest) v.players = v.players.map((p) => (p.id === this.you ? { ...p, x: newest.x, y: newest.y } : p));
    return v;
  }

  private smoothed(): View | null {
    const vs = this.views;
    if (vs.length === 0) return null;
    const at = performance.now() - INTERP_MS;
    let i = vs.length - 1;
    while (i > 0 && vs[i - 1].at > at) i--;
    if (i === 0 || vs[i].at <= at) return { ...vs[i].v };
    const a = vs[i - 1];
    const b = vs[i];
    const f = (at - a.at) / (b.at - a.at);
    const lerp = (x: number, y: number) => x + (y - x) * f;
    const jump = Math.hypot(b.v.ball.x - a.v.ball.x, b.v.ball.y - a.v.ball.y) > 3;
    return {
      ...b.v,
      players: b.v.players.map((p) => {
        const q = a.v.players.find((o) => o.id === p.id);
        return q ? { ...p, x: lerp(q.x, p.x), y: lerp(q.y, p.y) } : p;
      }),
      ball: jump ? b.v.ball : { x: lerp(a.v.ball.x, b.v.ball.x), y: lerp(a.v.ball.y, b.v.ball.y), z: lerp(a.v.ball.z, b.v.ball.z) },
    };
  }

  close(why: string): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pinger);
    this.peer.destroy();
    this.onClose(why);
  }
}
