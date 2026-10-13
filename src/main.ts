import './style.css';
import { playEvents, resetEvents, toggleMute, unlockAudio } from './audio.ts';
import { h } from './dom.ts';
import { GAME_KEYS, Keyboard } from './input.ts';
import { Me } from './predict.ts';
import { Renderer, TEAM_NAME, type Overlay } from './render.ts';
import { ClientSession, cleanName, HostSession, MODE_SEATS, mySeat, seatTeam, type Lobby, type Mode, type SeatKey } from './session.ts';
import { likelyShot, serveSpread, shotSpread } from './sim/aim.ts';
import { DT } from './sim/constants.ts';
import { sideOf } from './sim/court.ts';
import { FORMATS, newMatch, step, toView } from './sim/sim.ts';
import type { Difficulty, FormatKey, State, Team, View } from './sim/types.ts';
import { TouchPad } from './touch.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#court')!;
const ui = document.querySelector<HTMLDivElement>('#ui')!;
const renderer = new Renderer(canvas);
const keys = new Keyboard();
const pad = new TouchPad(keys);
const me = new Me();
const debug = new URLSearchParams(location.search).has('debug');

let session: HostSession | ClientSession | null = null;
let notice = '';

// The touch controls show on a phone or a tablet, and on any screen once it's touched; a key
// pressed in a match hides them again. ?touch shows them from the start.
let touch = false;
function setTouch(on: boolean): void {
  touch = on;
  document.body.classList.toggle('touch', on);
}
setTouch(matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch'));
addEventListener('pointerdown', (e) => e.pointerType === 'touch' && !touch && setTouch(true));

// A phone plays full screen and sideways, where the browser lets a page do that (an iPhone's
// doesn't: it's asked to turn instead).
const canFullscreen = () => !!document.documentElement.requestFullscreen;
function fullscreen(): void {
  if (!canFullscreen() || document.fullscreenElement) return;
  const turn = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  document.documentElement
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => turn.lock?.('landscape'))
    .catch(() => {});
}

// A phone in a room keeps its screen on: one that locks stops playing, and a host's closes the
// room for everyone.
let awake: WakeLockSentinel | null = null;
let asking = false;
function keepAwake(): void {
  const want = !!session && !document.hidden;
  if (want && !awake && !asking && 'wakeLock' in navigator) {
    asking = true;
    navigator.wakeLock
      .request('screen')
      .then((w) => {
        awake = w;
        w.onrelease = () => (awake = null);
        keepAwake();
      })
      .catch(() => {})
      .finally(() => (asking = false));
  } else if (!want && awake) void awake.release();
}

// In a match, a phone held upright is asked to turn it: the court needs the width.
const rotate = h(
  'div',
  { class: 'rotate' },
  h('p', {}, 'Turn your phone sideways to play.'),
  canFullscreen() && h('button', { class: 'primary', onclick: fullscreen }, 'Play full screen'),
);
document.querySelector('#app')!.append(pad.el, rotate);
pad.el.addEventListener('pointerup', unlockAudio);

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
    if (touch) fullscreen();
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
    if (touch) fullscreen();
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
  const item = (what: string, how: string) => h('li', {}, h('b', {}, what), ' ', how);
  const overheads = item('Overheads', 'A high ball: tap for a bandeja, charge for a smash; fully charged from near the net it bounces out of the court: por tres!');
  const rules = item(
    'Rules',
    'Serve underhand, diagonally, into the box; a serve that clips the net and lands in is a let. The ball must bounce once in the other half before it touches a wall; after that it can come off the glass, and you play it before it bounces twice. Golden point at 40-40.',
  );
  const items = touch
    ? [
        item('Move', 'Put your left thumb anywhere on the left half and slide it: a stick appears under it. You always play up the screen. The ring round your feet lights up when the ball is in reach.'),
        item('Hit', 'Hold Hit as the ball comes: the longer, the harder. Let go to swing, or keep holding and you swing by yourself as it arrives. You run as fast while you hold it. A quick tap is the safe shot; the closer the ball passes, the better.'),
        item('Aim', 'While you hold Hit, slide your thumb to move your target on the other side; it stays where you leave it. Until you move it, it is the crosscourt shot (dashed). The disc round it is where the ball may land: wider with power, and against a fast ball.'),
        item('Serve', 'Walk along the baseline with the stick, then hold Hit: the power bar fills (the red top risks a fault), and sliding your thumb moves your target in the box. Let go to serve. Lob serves a slice, which stays low.'),
        overheads,
        item('Lob, dive, emotes', 'Lob aims as Hit does; hold it for a higher one. Dive dives the way the stick points, for a ball out of reach. 💬: Vamos!, 😂, Sorry!, 👏'),
        rules,
        item('Phone', 'Turn it sideways.'),
      ]
    : [
        item('Move', 'WASD. You always play up the screen. The ring round your feet lights up when the ball is in reach.'),
        item('Aim', 'The arrows move your target on the other side, any time, and it stays where you leave it. Until you move it, it is the crosscourt shot (dashed), and after each shot by your team it goes back to that. The disc round it is where the ball may land: wider with power, and against a fast ball.'),
        item('Serve', 'Walk along the baseline with A/D, then hold Space: the power bar fills (the red top risks a fault). The arrows move your target in the box, before or while you charge. Let go to serve. E (or K) serves a slice, which stays low.'),
        item('Hit', 'Hold Space as the ball comes: the longer, the harder. Let go to swing, or keep holding and you swing by yourself as it arrives. You run as fast while you charge. A quick tap is the safe shot; the closer the ball passes, the better.'),
        overheads,
        item('Lob, dive, emotes', 'E (or K) lobs; hold it for a higher one. Shift (or L) dives the way you run, for a ball out of reach. 1 to 4: Vamos!, 😂, Sorry!, 👏'),
        rules,
        item('Sound', 'M mutes.'),
      ];
  return h('details', { class: 'how' }, h('summary', {}, 'How to play'), h('ul', {}, ...items));
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
    isHost ? h('button', { class: 'primary', onclick: start }, mine ? 'Start the match' : 'Start (you watch)') : h('p', { class: 'wait' }, 'Waiting for the host to start…'),
    h('button', { class: 'ghost', onclick: leave }, 'Leave the room'),
    howTo(),
  );
}

function gameBar(lobby: Lobby): HTMLElement {
  const mute = h('button', { class: 'small ghost', onclick: () => (mute.textContent = toggleMute() ? 'Sound off' : 'Sound on') }, 'Sound on');
  return h(
    'div',
    { class: 'bar' },
    h('span', { class: 'where' }, 'Room ', h('b', {}, lobby.code)),
    h('span', { class: 'keys' }, 'WASD move · arrows aim · hold Space: charge · E lob · Shift dive · 1-4 emotes'),
    mute,
    canFullscreen() && h('button', { class: 'small ghost fs', onclick: fullscreen }, 'Full screen'),
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
      ? h('div', { class: 'row' }, h('button', { class: 'primary', onclick: start }, 'Play again'), h('button', { onclick: () => (session as HostSession).backToLobby() }, 'Back to the lobby'))
      : h('p', { class: 'wait' }, 'Waiting for the host…'),
  );
}

function start(): void {
  if (touch) fullscreen();
  (session as HostSession).start();
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
  if (!lobby?.playing) pad.reset();
  document.body.classList.toggle('in-game', !!lobby?.playing);
  document.body.classList.toggle('seated', !!lobby?.playing && !!mySeat(lobby, you));
  document.body.classList.remove('over');
  if (!session && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  keepAwake();
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

// What only the player sees about themselves: their charge, their target (aim; aimed if they moved
// it) and how far off it the ball may land, and whether the ball is in reach.
function overlay(v: View, id: string, charge: number, lob: boolean, aim: { x: number; y: number }, aimed: boolean): Overlay | undefined {
  const p = v.players.find((q) => q.id === id);
  if (!p) return undefined;
  const serve = v.phase === 'serve' && v.serverId === id;
  const b = v.ball;
  // The target shows while the next shot is theirs to play, and once they've moved it.
  const turn = v.phase === 'rally' && v.hitTeam !== p.team && (!v.only || v.only === id);
  const target = serve || turn || charge >= 0 || aimed ? aim : null;
  // A shot's spread for a fair contact, on a ball as fast as the last shot; it can't know more.
  const power = Math.max(0, charge);
  const spread = serve ? serveSpread(power) : shotSpread(likelyShot(lob, power, b, p), 0.6, power, v.shot.kmh / 3.6, false, false, false, false);
  const reachable =
    v.phase === 'rally' &&
    !v.flight &&
    v.hitTeam !== p.team &&
    (!v.only || v.only === id) &&
    sideOf(b.y) === p.team &&
    b.z <= p.maxZ &&
    Math.hypot(b.x - p.x, b.y - p.y) <= p.reach;
  return { charge, serve, target, aimed, spread, reachable, reach: p.reach };
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
    const p = session.state.players.find((q) => q.id === session!.you);
    const vp = v.players.find((q) => q.id === session!.you);
    if (p && vp) ov = overlay(v, p.id, vp.charge, vp.ck % 2 === 1, { x: p.aimX, y: p.aimY }, p.aimed);
  }
  if (lobby?.playing && session instanceof ClientSession) {
    const raw = session.newest();
    const id = session.you;
    const mine = raw?.players.find((p) => p.id === id);
    if (raw) me.update(raw, id, keys.read(), keys.held(), keys.pressedAt, now, dt);
    session.sendControls(mine ? { ...keys.read(), ...me.pose() } : keys.read());
    v = session.view();
    if (v && raw && mine) {
      // Their own figure moves at once, and their charge shows from the press.
      const charge = me.charge(now);
      const dive = me.body.dive > 0 ? 1 : me.body.down > 0 ? 2 : 0;
      v.players = v.players.map((p) => (p.id === id ? { ...p, x: me.body.x, y: me.body.y, charge, dive } : p));
      ov = overlay(v, id, charge, me.kind() === 'lob', me.aim, me.aimed);
    }
  }
  if (debug) (window as unknown as { __padel: unknown }).__padel = { v, ov, me: { ...me.body }, place: me.place };
  if (v && lobby) {
    const seat = mySeat(lobby, session!.you);
    const meId = v.players.some((p) => p.id === session!.you) ? session!.you : null;
    renderer.draw(v, { viewTeam: seat ? seatTeam(seat) : 0, me: meId, hud: true, overlay: ov, touch }, now);
    playEvents(v.ev);
    if (v.phase === 'over' && !overShown) {
      overShown = true;
      pad.reset();
      document.body.classList.add('over');
      ui.append(overScreen(v));
    }
    if (v.phase !== 'over' && overShown) render();
  } else {
    renderer.draw(attractView(now), { viewTeam: 0, me: null, hud: false });
  }
  requestAnimationFrame(frame);
}

addEventListener('keydown', (e) => {
  if (touch && playing() && GAME_KEYS.has(e.code)) setTouch(false);
  if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) {
    const b = [...ui.querySelectorAll('button')].find((x) => x.textContent?.startsWith('Sound'));
    if (b) b.click();
    else toggleMute();
  }
});

// A phone that locks or changes app stops drawing, and so stops sending its keys: let go of them
// first, or the host would go on holding them.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pad.reset();
    keys.clear();
    if (session instanceof ClientSession && playing()) session.sendControls(keys.read());
  }
  keepAwake();
});

render();
requestAnimationFrame(frame);
