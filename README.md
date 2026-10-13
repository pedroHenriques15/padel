# Padel

Padel in the browser with friends: 1v1, 1v2 or 2v2, online, keyboard only. Empty places are
played by bots, so it also works alone.

A throwaway game: no server, no accounts, nothing to maintain.

## Playing

1. Open the game's page and click **Create a room**.
2. Click **Copy invite link** and send it to your friends. They open it and click **Join**.
3. Pick 1v1, 1v2 or 2v2, the match (first to N games, one set, or best of three sets) and how
   good the bots are. Everyone picks a place; empty ones are bots.
4. **Start the match.**

| Key | |
|---|---|
| WASD or arrows | Move. You always play up the screen. The ring round your feet lights up when the ball is in reach. |
| Hold Space (or J) | Charge a shot: the longer, the harder. Let go to swing, or keep holding and you swing by yourself as the ball arrives. Charging plants your feet. A tap is the safe shot. |
| Arrows as you hit | Aim: ←/→ the side, ↑ deep, ↓ short; none, crosscourt. The target shows while you charge. |
| K | Lob (hold it for a higher one) |
| Shift or L | Dive towards the arrows, for a ball out of reach; you're down for a moment after |
| 1 to 4 | Vamos!, 😂, Sorry!, 👏 |
| M | Sound on/off |

**Serving:** walk along the baseline with ←/→, then hold Space: the power bar fills, and its red
top risks a fault. The arrows move your target in the box: the T, the body, or wide into the
glass. Let go to serve. K serves a slice, which stays low after the bounce.

**Overheads:** on a high ball, a tap is a bandeja (safe, deep), a charge a smash, and a full
charge from near the net a *por tres*: it bounces out of the court, a winner unless they get to
it first.

The rules, simplified: serve underhand, diagonally, into the box; a serve that clips the net and
lands in is a let. The ball must bounce once in the other half before it touches a wall; after
that it may come off the glass, and you play it before it bounces twice. Golden point at 40-40.
Sets are six games by two, with a tie-break at 6-6.

## How it works

- Whoever creates the room is the **host**: their browser runs the match and sends everyone the
  picture 30 times a second. The others send their keys. So the host should keep the tab open
  (another tab in front is fine) and have a decent connection.
- Players connect straight to the host over WebRTC, through [PeerJS](https://peerjs.com/)'s free
  public server, which only introduces them (and relays when a router is strict).
- Everyone moves their own player on their own screen at once, and tells the host where they are,
  so movement never lags. The ball and the others are a moment behind for those far from the
  host: a held charge swings by itself at the right time, and a tap up to 0.25 s late still
  reaches a ball that just passed.
- If a player leaves mid-match, a bot takes their place.

## Code

- `src/sim/`: the match (physics, rules, scoring, bots). Plain TypeScript, no browser.
  `body.ts` (moving) and `aim.ts` (where shots go) are shared with the screen.
- `src/session.ts`: rooms, the host and the others. `src/predict.ts`: a player's own figure.
- `src/render.ts`: the court in perspective, on a canvas.
- `src/main.ts`: the screens.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # the rules, and bots playing whole matches
npm run build
npm run deploy   # publish
```

`npm run deploy` tests, builds and publishes it to GitHub Pages (the `gh-pages` branch).
