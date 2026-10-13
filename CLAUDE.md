# CLAUDE.md

Padel is a padel game played in the browser, 1v1, 1v2 or 2v2 between friends on their own
computers, keyboard only. It is TypeScript on a 2D canvas, with PeerJS (WebRTC) for the rooms,
built with Vite and served from GitHub Pages. There is no server and no accounts, and no asset
files either: the court is drawn with canvas paths and every sound is synthesized. The README
promises "nothing to maintain", so treat that as a design constraint: don't add a backend, a build
step or a dependency without a strong reason.

- `README.md`: the game as a player sees it (controls, serving, shots, the rules).
- `docs/architecture.md`: how it fits together: the match, the loop, the network.
- `docs/making-changes.md`: step-by-step guides for changes that touch several files (the feel, a
  shot, a key, a field in the view, a format, a sound, an emote, a message).
- `docs/releasing.md`: shipping a change to the live site.

## Commands

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # node --test over test/*.test.ts, about two seconds
npm run check        # tsc; the only type check the tests get
npm run build        # tsc && vite build, into dist/
npm run deploy       # tests, builds, force-pushes dist/ to gh-pages: it publishes the game
```

- Run one test with `node --test --test-name-pattern="por tres" test/sim.test.ts`.
- Node runs the `.ts` tests directly by stripping the types, so it needs Node 22.18 or later, and it
  does **not** type-check them. Run `npm run check` as well as `npm test`.
- `npm run deploy` publishes to the public site. Only run it when asked. It needs bash (Git Bash on
  Windows).
- To ship a change: check it, commit it to `main`, `git push origin main`, `npm run deploy`, then
  confirm the live page at https://pedrohenriques15.github.io/padel/ serves the new build. The deploy
  publishes the working tree, so commit first. The details are in `docs/releasing.md`.
- The bot match tests print a line each: shots a point, how the points ended, and the shots that got
  a name ("Perfect!", "Bandeja", "Smash!"...). The power bar test prints its fault counts. Read them
  when tuning.

### Trying it in a browser

- `?debug` exposes `window.__padel`: the view being drawn (`v`), the player's own overlay (`ov`:
  charge, target, whether the ball is in reach), and on a friend's screen their own figure (`me`)
  and the placement it has seen (`place`). That's what Playwright checks read.
- `?lag=150` delays a friend's messages by 75 ms each way, to try a far-away host. It only acts on
  the joining side; the host ignores it.
- To play alone, create a room and start it: the empty places fill with bots. To test with other
  players, open a second window with the invite link, `?room=<code>`. A friend's page in a background
  tab stops drawing, and with it stops sending its keys; the host's doesn't stop playing. Rooms go
  through PeerJS's public server, so this needs internet access.
- With no room, the home and lobby screens show four bots playing best of three sets behind the
  panels.

## The two halves

**The match** is pure TypeScript with no DOM, so it runs under `node --test`: everything in
`src/sim/`. Keep it that way. If one of these files touches `window` or `document`, the tests can no
longer load it.

**The browser** is everything else: `src/render.ts` (the canvas), `src/session.ts` (PeerJS),
`src/predict.ts` (a friend's own figure), `src/main.ts` (screens, the loop and the glue),
`src/input.ts` and `src/audio.ts`.

How a match runs:

- **Only the host runs the match.** Its browser calls `step` 60 times a second from a worker timer,
  so a host tab in the background keeps playing, and sends every other browser a `View` every second
  step, 30 times a second. The others send their keys, and draw the views they get.
- **Except where a player is.** Each player moves their own figure on their own screen with
  `moveBody` (`src/sim/body.ts`), the same function the host uses, and sends the host where they
  are. The host takes it, inside their half, once they've seen the latest serve's placement (the
  `place` counter). So nobody's own movement lags.
- **Keys are counted, not sent as events.** `Controls` carries how many times each key has gone down
  so far, and whether it's down now. The host turns that into one tick's presses with `edges`, so a
  tap between two messages is never lost.
- **A charge is a swing that waits.** Holding the hit key charges; the swing comes by itself where
  the ball passes closest, or when the key is let go. Timing doesn't depend on the network.
- Everything in `src/sim/` is **seeded**: `rand(s)` in `rng.ts` advances `s.seed`, so a test replays
  the same match every time. The bots' choices come from `hash(s, p, k)` in `bot.ts`, one number per
  shot.

## Conventions

- Imports carry the `.ts` extension, and type-only imports use `import type` or `type`
  (`verbatimModuleSyntax`).
- Use no TS-only runtime syntax: no `enum`, `namespace` or constructor parameter properties
  (`erasableSyntaxOnly`). Node has to be able to strip the types. Use string unions and `as const`
  objects instead.
- Coordinates: metres, with **x across** the court (left to right as team A sees it), **y along** it
  (team A's half is y < 0, team B's y > 0, the net at y = 0) and **z up**. `halfSign(t)`, `fwd(t)`
  and `rightX(t)` in `src/sim/court.ts` turn a team's "my half", "towards the net" and "my right"
  into world signs.
- **Keys are relative to the player's own screen.** `ix` is right/left on their screen and `iy`
  towards/away from the net, whichever side they play. Team B's screen is the court turned round
  (`flip` in `render.ts`), so everyone plays up the screen.
- **WASD moves; the arrows only aim.** The owner asked for that after the arrows both moved and
  aimed. Never let the arrows move a player.
- Units: seconds and m/s in the match (`DT = 1/60`, every timer on `Player` and `State`);
  milliseconds only in the browser (`performance.now()`, `INTERP_MS`, `?lag`).
- The match reports what happened through counters, never by calling out: `s.ev` (for sounds),
  `s.shot` (the latest shot's speed and name) and `s.mark` (where the ball last landed). The
  browser plays or draws a counter when it goes up.
- Build DOM with the `h()` helper in `main.ts`, which only ever sets text. Never use `innerHTML`:
  player names come from other people. On the canvas, names go through `fillText`.
- The host trusts nothing a client sends. `cleanControls` (`src/sim/controls.ts`) clamps every
  number, `cleanName` cuts names short, and `configure` and `sit` check what they're given. Any new
  message or field needs the same treatment.
- Style: comments are full sentences in plain English that say what a thing is for or why it is so,
  not what the next line does. Short names where the maths is dense (`b`, `p`, `s`, `q`, `d`). Use
  2 spaces, single quotes, semicolons and trailing commas. Long lines are fine, and no formatter is
  configured. Files are LF (`.gitattributes`). Write the README and UI text in the same plain voice
  as the README.

## Gotchas

- **Anything that moves players for a serve must bump `s.place`.** A friend's browser keeps sending
  where it thinks it is. The host only ignores those positions because `setupServe` increments
  `place`, and the friend's `Me` only snaps to the new spot when it sees the new number. Teleport a
  player without it and their old position overwrites the new one.
- **The `View` is the network format.** Everything in it goes to every browser 30 times a second.
  Keep it small, round numbers with `r2`, and send things that only matter at the end (the stats)
  only then.
- **The sound counters are matched by position.** `toView` sends `ev` as an array, and `SOUNDS` in
  `src/audio.ts` plays index `i` when number `i` goes up. Add a counter at the end of both, in the
  same order.
- **The emotes are numbered in three places**: the keys in `src/input.ts`, the clamp in
  `cleanControls`, and the 1-4 check in `control()` in `sim.ts`, next to `EMOTES` for the text.
- **Movement and aim are shared with the screen.** `src/sim/body.ts` runs on the host and on a
  friend's screen, and `src/sim/aim.ts` draws the target the player sees. A change there changes
  both, which is the point; keep them free of anything only the host knows.
- **A friend's charge ends when the host says so.** `Me` keeps a charge from the key press and ends
  it once the host's view shows that player's charge over (the swing came), so the friend can move
  again with the key still down, as the host can.
- **The peer id prefix** `padel-pk26-` in `src/session.ts` decides which builds can see each other's
  rooms. The live game and a dev build share rooms while it matches. Change it when the message or
  view format changes so that an old page would break.
- **The tests guard the feel.** They check, among other things: a full charge at least 1.5 times as
  fast as a tap and over 70 km/h; 6 or fewer faults in 60 green serves and at least 10 more in the
  red; a por tres leaving the court at least 6 times in 10; a dive going 1.8 times as far as running
  would in the same time; and the bots, at every level and in every mode, averaging more than 2.5
  shots a point. A change to the
  constants, the error formula or the bots has to keep them passing.
- **A host that leaves ends the room** for everyone. A player who leaves mid-match is replaced by a
  bot with their name and "(bot)". Someone joining mid-match watches; they can take a place once
  the host goes back to the lobby.
