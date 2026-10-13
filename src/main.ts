import './style.css';
import { playEvents, resetEvents, toggleMute, unlockAudio } from './audio.ts';
import { Keyboard } from './input.ts';
import { Me } from './predict.ts';
import { Renderer, TEAM_NAME, type Overlay } from './render.ts';
import { ClientSession, cleanName, HostSession, MODE_SEATS, mySeat, seatTeam, type Lobby, type Mode, type SeatKey } from './session.ts';
import { shotKind, shotTarget } from './sim/aim.ts';
import { DT } from './sim/constants.ts';
import { sideOf } from './sim/court.ts';
import { FORMATS, newMatch, step, toView } from './sim/sim.ts';
import type { Difficulty, FormatKey, State, Team, View } from './sim/types.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#court')!;
const ui = document.querySelector<HTMLDivElement>('#ui')!;
const renderer = new Renderer(canvas);
const keys = new Keyboard();
const me = new Me();
const debug = new URLSearchParams(location.search).has('debug');

let session: HostSession | ClientSession | null = null;
let notice = '';

// A tiny element builder that only ever sets text, never HTML: names come from other people.
type Child = Node | string | null | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

function savedName(): string {
  try {
    return localStorage.getItem('padel-name') ?? '';
  } catch {
    return '';
  }
}

function saveName(n: string): void {
  try {
    localStorage.setItem('padel-name', n);
  } catch {
    /* private window */
  }
}

const roomFromUrl = () => (new URLSearchParams(location.search).get('room') ?? '').trim().toLowerCase();
const inviteLink = (code: string) => `${location.origin}${location.pathname}?room=${code}`;

function lobbyOf(): Lobby | null {
  return session instanceof HostSession ? session.lobby : (session?.lobby ?? null);
}

function playing(): boolean {
  return !!lobbyOf()?.playing;
}

// ---- Screens ----

function homeScreen(): HTMLElement {
  const name = h('input', { id: 'name', maxLength: 16, placeholder: 'Your name', value: savedName(), autocomplete: 'off' });
  const code = h('input', { id: 'code', maxLength: 5, placeholder: 'Room code', value: roomFromUrl(), autocomplete: 'off', spellcheck: false });
  const err = h('p', { class: 'err' }, notice);
  const busy = (b: boolean) => panel.querySelectorAll('button').forEach((x) => (x.disabled = b));
  const who = () => {
    const n = cleanName(name.value);
    saveName(n);
    return n;
  };

  const host = async () => {
    unlockAudio();
    busy(true);
    err.textContent = 'Opening a room…';
    try {
      const s = await HostSession.create(who(), () => keys.read());
      s.onChange = render;
      session = s;
      notice = '';
      render();
    } catch (e) {
      busy(false);
      err.textContent = `Couldn't open a room (${(e as { type?: string }).type ?? 'error'}). Try again in a moment.`;
    }
  };
  const join = async () => {
    const c = code.value.trim().toLowerCase();
    if (!/^[a-z0-9]{5}$/.test(c)) {
      err.textContent = 'A room code has 5 letters and numbers.';
      return;
    }
    unlockAudio();
    busy(true);
    err.textContent = 'Joining…';
    try {
      const s = await ClientSession.join(c, who());
      s.onChange = render;
      s.onClose = (why) => {
        session = null;
        notice = why;
        history.replaceState(null, '', location.pathname);
        render();
      };
      session = s;
      notice = '';
      render();
    } catch (e) {
      busy(false);
      err.textContent = (e as Error).message;
    }
  };
  code.addEventListener('keydown', (e) => e.key === 'Enter' && void join());

  const invited = roomFromUrl();
  const panel = h(
    'div',
    { class: 'panel home' },
    h('h1', {}, 'Padel', h('span', {}, '.')),
    h('p', { class: 'tag' }, '1v1, 1v2 or 2v2 with friends, in the browser.'),
    h('label', {}, 'Your name', name),
    invited
      ? h('button', { class: 'primary', onclick: join }, `Join room ${invited}`)
      : h('button', { class: 'primary', onclick: host }, 'Create a room'),
    h('div', { class: 'or' }, invited ? 'or' : 'or join one'),
    invited
      ? h('button', { onclick: host }, 'Create my own room')
      : h('div', { class: 'row' }, code, h('button', { onclick: join }, 'Join')),
    err,
    howTo(),
  );
  return panel;
}

function howTo(): HTMLElement {
  return h(
    'details',
    { class: 'how' },
    h('summary', {}, 'How to play'),
    h(
      'ul',
      {},
      h('li', {}, h('b', {}, 'Move'), ' WASD or the arrows. You always play up the screen. The ring round your feet lights up when the ball is in reach.'),
      h('li', {}, h('b', {}, 'Serve'), ' Walk along the baseline with ←/→, then hold Space: the power bar fills (the red top risks a fault) and the arrows move your target in the box. Let go to serve. K serves a slice, which stays low.'),
      h('li', {}, h('b', {}, 'Hit'), ' Hold Space as the ball comes: the longer, the harder. Let go to swing, or keep holding and you swing by yourself as it arrives. Charging plants your feet. A quick tap is the safe shot; the closer the ball passes, the better.'),
      h('li', {}, h('b', {}, 'Aim'), ' The arrows as you hit: ←/→ the side, ↑ deep, ↓ short. With none, it goes crosscourt. Your target shows on the other side while you charge.'),
      h('li', {}, h('b', {}, 'Overheads'), ' A high ball: tap for a bandeja, charge for a smash; fully charged from near the net it bounces out of the court: por tres!'),
      h('li', {}, h('b', {}, 'Lob, dive, emotes'), ' K lobs (hold it for a higher one). Shift or L dives towards the arrows, for a ball out of reach. 1 to 4: Vamos!, 😂, Sorry!, 👏'),
      h('li', {}, h('b', {}, 'Rules'), ' Serve underhand, diagonally, into the box; a serve that clips the net and lands in is a let. The ball must bounce once in the other half before it touches a wall; after that it can come off the glass, and you play it before it bounces twice. Golden point at 40-40.'),
      h('li', {}, h('b', {}, 'Sound'), ' M mutes.'),
    ),
  );
}

function lobbyScreen(lobby: Lobby, you: string): HTMLElement {
  const isHost = session instanceof HostSession;
  const mine = mySeat(lobby, you);
  const sit = (k: SeatKey | null) => (session instanceof HostSession ? session.sit(you, k) : session?.sit(k));
  const nameOf = (id: string | undefined) => lobby.members.find((m) => m.id === id)?.name;
  const copy = h('button', {
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(inviteLink(lobby.code));
        copy.textContent = 'Copied!';
      } catch {
        prompt('Send this link to your friends:', inviteLink(lobby.code));
      }
    },
  }, 'Copy invite link');

  const seatCard = (k: SeatKey) => {
    const id = lobby.seats[k];
    const n = nameOf(id);
    return h(
      'div',
      { class: `seat${id === you ? ' me' : ''}${n ? '' : ' empty'}` },
      h('span', { class: 'who' }, n ? (id === you ? `${n} (you)` : n) : 'Bot'),
      !n && h('button', { class: 'small', onclick: () => sit(k) }, 'Sit here'),
      id === you && h('button', { class: 'small ghost', onclick: () => sit(null) }, 'Watch'),
    );
  };
  const team = (t: Team) =>
    h('div', { class: `team t${t}` }, h('h3', {}, TEAM_NAME[t]), ...MODE_SEATS[lobby.mode].filter((k) => seatTeam(k) === t).map(seatCard));

  const watching = lobby.members.filter((m) => !Object.entries(lobby.seats).some(([k, id]) => id === m.id && MODE_SEATS[lobby.mode].includes(k as SeatKey)));
  const modeBtn = (m: Mode) =>
    h('button', { class: lobby.mode === m ? 'on' : '', disabled: !isHost, onclick: () => (session as HostSession).configure({ mode: m }) }, m);
  const format = h(
    'select',
    { disabled: !isHost, onchange: () => (session as HostSession).configure({ format: format.value as FormatKey }) },
    ...(Object.keys(FORMATS) as FormatKey[]).map((k) => h('option', { value: k, selected: k === lobby.format }, FORMATS[k].label)),
  );
  const level = h(
    'select',
    { disabled: !isHost, onchange: () => (session as HostSession).configure({ difficulty: level.value as Difficulty }) },
    ...(['easy', 'normal', 'hard'] as const).map((d) => h('option', { value: d, selected: d === lobby.difficulty }, d[0].toUpperCase() + d.slice(1))),
  );
  const assist = h('input', {
    type: 'checkbox',
    checked: lobby.soloAssist,
    disabled: !isHost,
    onchange: () => (session as HostSession).configure({ soloAssist: assist.checked }),
  });

  return h(
    'div',
    { class: 'panel lobby' },
    h('div', { class: 'room' }, h('div', {}, h('span', { class: 'label' }, 'Room'), h('b', { class: 'code' }, lobby.code)), copy),
    h('div', { class: 'modes' }, modeBtn('1v1'), modeBtn('1v2'), modeBtn('2v2')),
    h('div', { class: 'teams' }, team(0), h('div', { class: 'vs' }, 'vs'), team(1)),
    h(
      'div',
      { class: 'settings' },
      h('label', {}, 'Match ', format),
      h('label', {}, 'Bots ', level),
      lobby.mode === '1v2' && h('label', {}, assist, ' Help the lone player'),
    ),
    h('p', { class: 'hint' }, 'Empty places are played by bots. ', watching.length ? `Watching: ${watching.map((m) => m.name).join(', ')}.` : ''),
    isHost ? h('button', { class: 'primary', onclick: () => (session as HostSession).start() }, mine ? 'Start the match' : 'Start (you watch)') : h('p', { class: 'wait' }, 'Waiting for the host to start…'),
    h('button', { class: 'ghost', onclick: leave }, 'Leave the room'),
    howTo(),
  );
}

function gameBar(lobby: Lobby): HTMLElement {
  const mute = h('button', { class: 'small ghost', onclick: () => (mute.textContent = toggleMute() ? 'Sound off' : 'Sound on') }, 'Sound on');
  return h(
    'div',
    { class: 'bar' },
    h('span', {}, 'Room ', h('b', {}, lobby.code)),
    h('span', { class: 'keys' }, 'Hold Space: charge · arrows aim · K lob · Shift dive · 1-4 emotes'),
    mute,
    h('button', { class: 'small ghost', onclick: leave }, 'Leave'),
  );
}

function statsTable(v: View): HTMLElement | null {
  if (!v.stats) return null;
  type Line = NonNullable<View['stats']>[number];
  const cols: [string, (s: Line) => string][] = [
    ['Aces', (s) => String(s.aces)],
    ['Winners', (s) => String(s.winners)],
    ['Errors', (s) => String(s.errors)],
    ['Smashes', (s) => String(s.smashes)],
    ['Fastest', (s) => (s.fastest ? `${s.fastest} km/h` : '–')],
  ];
  return h(
    'div',
    { class: 'stats' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, ''), ...cols.map(([c]) => h('th', {}, c)))),
      h('tbody', {}, ...v.stats.map((s) => h('tr', { class: `t${s.team}` }, h('td', {}, s.name), ...cols.map(([, f]) => h('td', {}, f(s)))))),
    ),
    h('p', { class: 'hint' }, `Longest rally: ${v.longest} shots`),
  );
}

function finalScore(v: View): string {
  if (v.setScores.length) return v.setScores.map((s) => `${s[0]}–${s[1]}`).join('  ');
  return `${v.games[0]} – ${v.games[1]}`;
}

function overScreen(v: View): HTMLElement {
  const isHost = session instanceof HostSession;
  const names = v.players.filter((p) => p.team === v.winner).map((p) => p.name).join(' & ');
  return h(
    'div',
    { class: 'panel over' },
    h('h2', { class: `t${v.winner}` }, `${names} win!`),
    h('p', { class: 'final' }, finalScore(v)),
    statsTable(v),
    isHost
      ? h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => (session as HostSession).start() }, 'Play again'), h('button', { onclick: () => (session as HostSession).backToLobby() }, 'Back to the lobby'))
      : h('p', { class: 'wait' }, 'Waiting for the host…'),
  );
}

function leave(): void {
  if (session instanceof HostSession) {
    if (session.lobby.members.length > 1 && !confirm('Close the room for everyone?')) return;
    session.leave();
  } else session?.close('');
  session = null;
  notice = '';
  history.replaceState(null, '', location.pathname);
  render();
}

let overShown = false;

function render(): void {
  const lobby = lobbyOf();
  const you = session?.you ?? '';
  keys.enabled = !!lobby?.playing;
  overShown = false;
  document.body.classList.toggle('in-game', !!lobby?.playing);
  if (!session || !lobby) ui.replaceChildren(homeScreen());
  else if (!lobby.playing) ui.replaceChildren(lobbyScreen(lobby, you));
  else {
    (document.activeElement as HTMLElement | null)?.blur();
    resetEvents();
    ui.replaceChildren(gameBar(lobby));
  }
}

// ---- The loop ----

// Bots play on the home and lobby screens, behind the panels.
let attract: State | null = null;
let attractLast = 0;
function attractView(now: number): View {
  if (!attract || attract.phase === 'over') {
    const seat = (id: string, team: Team, slot: 0 | 1) => ({ id, name: '', team, slot, bot: true });
    attract = newMatch({ format: 's3', difficulty: 'normal', soloAssist: false, seats: [seat('a', 0, 0), seat('b', 0, 1), seat('c', 1, 0), seat('d', 1, 1)] });
    attractLast = now;
  }
  let n = 0;
  while (now - attractLast >= DT * 1000 && n++ < 10) {
    step(attract, {});
    attractLast += DT * 1000;
  }
  if (n >= 10) attractLast = now;
  return toView(attract);
}

// What only the player sees about themselves: their charge, where it would go, and whether the
// ball is in reach.
function overlay(v: View, id: string, charge: number, lob: boolean): Overlay | undefined {
  const p = v.players.find((q) => q.id === id);
  if (!p) return undefined;
  const serve = v.phase === 'serve' && v.serverId === id;
  const b = v.ball;
  const c = keys.read();
  let target: Overlay['target'] = null;
  if (charge >= 0) {
    if (serve) target = session instanceof ClientSession ? me.aim : v.serveAim;
    else {
      // An overhead only once a high ball is close; until then, the shot it will most likely be.
      const near = Math.hypot(b.x - p.x, b.y - p.y) < 2.5;
      target = shotTarget(p.team, c.ix, c.iy, b.x, shotKind(lob ? 'lob' : 'drive', charge, near ? b.z : 0, p.y));
    }
  }
  const reachable =
    v.phase === 'rally' &&
    !v.flight &&
    v.hitTeam !== p.team &&
    (!v.only || v.only === id) &&
    sideOf(b.y) === p.team &&
    b.z <= p.maxZ &&
    Math.hypot(b.x - p.x, b.y - p.y) <= p.reach;
  return { charge, serve, target, reachable, reach: p.reach };
}

let lastFrame = 0;

function frame(now: number): void {
  const lobby = lobbyOf();
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  let v: View | null = null;
  let ov: Overlay | undefined;
  if (lobby?.playing && session instanceof HostSession && session.state) {
    v = toView(session.state);
    const p = v.players.find((q) => q.id === session!.you);
    if (p) ov = overlay(v, p.id, p.charge, p.ck % 2 === 1);
  }
  if (lobby?.playing && session instanceof ClientSession) {
    const raw = session.newest();
    const id = session.you;
    const mine = raw?.players.find((p) => p.id === id);
    if (raw) me.update(raw, id, keys.read(), keys.held(), keys.pressedAt, now, dt);
    session.sendControls(mine ? { ...keys.read(), ...me.pose() } : keys.read());
    v = session.view();
    if (v && raw && mine) {
      // Their own figure moves at once; the charge shows from the press, until the host says the
      // swing came.
      const local = me.charge(now);
      const charge = local >= 0 && (mine.charge >= 0 || now - keys.pressedAt < 350 || raw.phase === 'serve') ? local : -1;
      const dive = me.body.dive > 0 ? 1 : me.body.down > 0 ? 2 : 0;
      v.players = v.players.map((p) => (p.id === id ? { ...p, x: me.body.x, y: me.body.y, charge, dive } : p));
      ov = overlay(v, id, charge, me.kind() === 'lob');
    }
  }
  if (debug) (window as unknown as { __padel: unknown }).__padel = { v, ov, me: { ...me.body }, place: me.place };
  if (v && lobby) {
    const seat = mySeat(lobby, session!.you);
    const meId = v.players.some((p) => p.id === session!.you) ? session!.you : null;
    renderer.draw(v, { viewTeam: seat ? seatTeam(seat) : 0, me: meId, hud: true, overlay: ov }, now);
    playEvents(v.ev);
    if (v.phase === 'over' && !overShown) {
      overShown = true;
      ui.append(overScreen(v));
    }
    if (v.phase !== 'over' && overShown) render();
  } else {
    renderer.draw(attractView(now), { viewTeam: 0, me: null, hud: false });
  }
  requestAnimationFrame(frame);
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) {
    const b = [...ui.querySelectorAll('button')].find((x) => x.textContent?.startsWith('Sound'));
    if (b) b.click();
    else toggleMute();
  }
});

render();
requestAnimationFrame(frame);
