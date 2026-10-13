# Making changes

Step-by-step guides for the changes that reach across several files. For how it all works, read
[architecture.md](architecture.md).

Whatever you change, finish with:

```sh
npm run check && npm test
```

Then play it with `npm run dev`: create a room and start it, and bots fill the empty places. For a
friend's side of it, open the invite link in a second window, with `?lag=150` to feel a far-away
host.

## The feel

Most of the feel is numbers in `src/sim/constants.ts`:

| | |
|---|---|
| `SPEED`, `ACCEL`, `DECEL` | How fast players run, start and stop |
| `REACH`, `MAX_Z`, `SMASH_Z` | How far they reach, how high, and from what height a ball is an overhead |
| `SWING`, `LATE`, `COOLDOWN` | How long a swing can make contact, how late it still reaches a ball that passed, the wait between swings |
| `CHARGE_FULL` | How long to hold for a full-power shot |
| `SERVE_FULL`, `SERVE_RED`, `SERVE_HOLD`, `AIM_SPEED` | The serve's bar, where its red zone starts, how long it can be held, how fast the target moves |
| `SERVE_DELAY`, `AUTO_SERVE`, `POINT_PAUSE` | The waits round a serve and a point |
| `DIVE_*` | The dive: its burst, speed, time on the floor, cooldown, and longer reach |
| `FLOOR_E`, `FLOOR_F`, `WALL_E`, `CORD` | How the ball bounces off the floor and the walls, and how near the tape it clips the net |

The rest lives in code:

- **The shots** are in `hit()` in `src/sim/sim.ts`: the error formula (what makes a shot scatter),
  each shot's pace, net margin and spin, and when a contact is "Perfect!" or a frame. How deep each
  shot lands is `DEPTHS` in `src/sim/aim.ts`, and how wide `shotTarget` in the same file.
- **The serve** is `serve()` in `sim.ts`: the pace for the bar, and how wild the red zone makes it.
- **Spin** is `spinBounce()` in `src/sim/court.ts`: how low a slice stays, how high a kick leaps.
- **The bots** are `LEVELS` in `src/sim/bot.ts`, one row per difficulty.

Run `npm test` and read the printed lines. Each bot match test prints the shots a point, how the
points ended and the shots that got a name. Today they print about 7 (Easy) to 12 (Hard) shots a
point in singles, and 8 to 13.5 with three or four players. Much longer, and points drag; much
shorter, and nobody rallies. The matches are seeded, so the same code always prints the same
numbers: any change in them comes from your change. The power bar test
prints the faults in 60 serves, green and red. The tests also guard the feel (see "The tests guard
the feel" in `CLAUDE.md`), so a change has to keep them passing.

Bots aren't humans: they read the ball perfectly and never mistime a key. A change that makes bot
rallies longer can make the game feel fine for bots and impossible for people. Play it.

## A new shot

1. **`src/sim/types.ts`**: add it to `Shot`.
2. **`src/sim/aim.ts`**
   - Give it depths in `DEPTHS`: short, plain and deep, in metres from the net.
   - If a swing should become it by itself (as an overhead becomes a bandeja or a smash), add the
     rule to `shotKind`. The screen uses `shotKind` and `shotTarget` too, to draw the target, so
     the player sees the right one.
3. **`src/sim/sim.ts`, `hit()`**: a `case` with its pace (or a flight time), net margin, spin and the
   name that pops up (`tag`). If it should scatter more or less than the rest, scale `err`. If it
   counts as a smash in the stats, add it in `shotDone`.
4. **`src/sim/bot.ts`**: when the bots play it (`wantsLob`, `wantedPower`, `aimFor`), and where they
   stand after it (`home` reads `s.lastShot`).
5. **`src/render.ts`**: its name's colour in `tagColor`, if it should stand out.
6. **The help**: `howTo()` in `src/main.ts` and the README.
7. **`test/sim.test.ts`**: a test in the style of "overheads: a tap is a bandeja…", which puts the
   ball where it's needed and checks `s.lastShot` and the ball.

## A new key

The keys are **WASD to move, the arrows only to aim**, Space or J to hit, E or K to lob, Shift or L
to dive, 1-4 for emotes. Keep the arrows for aiming.

1. **`src/input.ts`**: add the key's codes to a list and to `GAME_KEYS` (so the page doesn't scroll
   or type with it). For a key that's held, read it in `read()`. For a press, count it in the
   `keydown` handler, as `hits` and `dives` are.
2. **`src/sim/controls.ts`**
   - Add a field to `Controls` and to `noControls`.
   - **Clean it in `cleanControls`**: a held key is `=== true`, a count is clamped to
     `0`–`1e9`, a direction is `Math.sign` of a clamped number.
   - Turn it into the tick's input in `edges`. A count becomes a press when it's gone up; add it to
     `Seen` and `seenOf`.
3. **`src/sim/types.ts`**: the field in `TickInput`. Make it optional, or add it to the `IDLE` inputs
   in `sim.ts`, `bot.ts` and the tests.
4. **`src/sim/sim.ts`, `control()`** or what it calls: what it does.
5. **`src/predict.ts`**: if it changes how a player moves, `Me.update` has to do the same on a
   friend's screen, with the same `moveBody`.
6. **`src/touch.ts`**: a touch control that presses the same key: `button` for a key that's only
   pressed, `swing` for one that charges and aims as the thumb slides. Place it in `src/style.css`,
   in the right-hand corner by the others.
7. **The help**: `howTo()` (both lists) and `gameBar()` in `src/main.ts`, the serve banner in
   `src/render.ts` (both texts) if it matters for serving, and the README's two tables.

## A new field in the view

The `View` goes to every friend 30 times a second.

1. Add it to `View` or `ViewPlayer` in `src/sim/types.ts`, and fill it in `toView` (`src/sim/sim.ts`).
   Round numbers with `r2`. Something that only matters at the end, send only then, as the stats are.
2. If it moves smoothly (a position), interpolate it in `ClientSession.view()` in `src/session.ts`,
   as the players and the ball are. Otherwise the newest value is drawn as it is.
3. Draw it in `src/render.ts`, or use it in `src/main.ts`.
4. A page loaded before the change still joins rooms, and would get a view without the field. If
   that would break it, change the peer id prefix (see [A new network message](#a-new-network-message)).

## A new match format

1. Add a key to `FormatKey` in `src/sim/types.ts` and an entry to `FORMATS` in `src/sim/sim.ts`:
   `games: N` for the first to N games, `sets: N` for the best of N sets of six games.
2. That's all for one of those two kinds. The lobby's list, the host's check (`configure`), the
   label under the scoreboard and the end screen read `FORMATS` or the score, and the scoreboard
   shows the earlier sets as soon as there are any.
3. A new kind of format (a different set length, advantage instead of golden point) goes in
   `gameWon` and `finishPoint`. Add a test in the style of "sets: six games by two…".

## A new sound

1. Add a counter to `ev` in `State` (`src/sim/types.ts`) and to its start in `newMatch`, and bump it
   where the thing happens in `sim.ts`.
2. **Add it to the end of the `ev` array in `toView`, and its sound to the end of `SOUNDS` in
   `src/audio.ts`, at the same index.** The two are matched by position only.
3. A sound is a `knock` (a pitched blip that falls) or a `hiss` (filtered noise, a burst or a
   swell), or a few of them together.

## A new emote

1. Add its text to `EMOTES` in `src/sim/sim.ts`.
2. Add its keys to `EMOTES` in `src/input.ts`, and change the `% 4` that turns a key into a number.
   The touch menu gets a button by itself, and presses `Digit1` on, so keep the digits first.
3. Raise the `4`s: the clamp on `ek` in `cleanControls` and the `1`-`4` check in `control()`.
4. The help, and the README.

## A new bot level

1. Add it to `Difficulty` in `src/sim/types.ts` and a row to `LEVELS` in `src/sim/bot.ts`.
2. Add it to the lists in `lobbyScreen` in `src/main.ts` and in `configure` in `src/session.ts`
   (the host rejects any level it doesn't know), and to the levels the bot match tests loop over.

## A new network message

1. Add it to `ToHost` or `ToClient` in `src/session.ts`.
2. Handle it in `HostSession.receive` or `ClientSession.receive`. On the host, **validate
   everything**, and never trust an id in the message over the connection's own `c.peer`.
3. The host is a player too, but never sends itself messages. Its own actions are method calls
   (`sit`, `configure`, `start`), and its keys are read straight from the keyboard each tick. Give
   the host the same behaviour by that path.
4. Live and dev builds share rooms while the peer id prefix (`PREFIX`, `padel-pk26-`) matches. If an
   old page would misbehave with the new message, change the prefix.

## The court

The court's sizes are in `src/sim/constants.ts` (`HALF_W`, `HALF_L`, `SERVICE_LINE`, `NET_H`,
`BACK_H`, `SIDE_H`, `SIDE_GLASS`), and the ball and the drawing read them. A few places assume a
10 by 20 m court and need changing with it:

| Where | What |
|---|---|
| `src/sim/aim.ts` | `DEPTHS`: how deep each shot lands, in metres from the net |
| `src/sim/sim.ts` | `setupServe`: where everyone stands for the serve (7.6, 8.4, 3.2 and 4.8 m from the net) |
| `src/sim/bot.ts` | `home`: where bots wait (3.2, 3.4, 6, 7.4 and 8.4 m), and `atNet` (4.5 m) |
| `src/render.ts` | `drawBack`: the panels every 2.5 m, the side glass in 2 m panels and 4 m from each end, the posts every 2 m |
| `src/render.ts` | `EYE`, `FOCAL` and `MID`: the camera, which frames this court |
