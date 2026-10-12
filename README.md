# Padel

Padel in the browser with friends: 1v1, 1v2 or 2v2, online, keyboard only. Empty places are
played by bots, so it also works alone.

A throwaway game: no server, no accounts, nothing to maintain.

## Playing

1. Open the game's page and click **Create a room**.
2. Click **Copy invite link** and send it to your friends. They open it and click **Join**.
3. Pick 1v1, 1v2 or 2v2, and the games to win. Everyone picks a place; empty ones are bots.
4. **Start the match.**

| Key | |
|---|---|
| WASD or arrows | Move. You always play up the screen. |
| Space or J | Hit, as the ball reaches you. The closer it passes, the better the shot. A high ball is smashed. |
| K or L | Lob |
| Hold ←/→ as you hit | Aim |
| Hold ↑ / ↓ as you hit | Hit hard / play it short |
| M | Sound on/off |

The rules, simplified: serve underhand, diagonally, into the box. The ball must bounce once in
the other half before it touches a wall; after that it may come off the glass, and you play it
before it bounces twice. Golden point at 40-40. First to N games wins.

## How it works

- Whoever creates the room is the **host**: their browser runs the match and sends everyone the
  picture 30 times a second. The others send their keys. So the host should keep the tab open
  (another tab in front is fine) and have a decent connection.
- Players connect straight to the host over WebRTC, through [PeerJS](https://peerjs.com/)'s free
  public server, which only introduces them (and relays when a router is strict).
- Players far from the host feel their delay. It plays well up to about 150 ms; a swing up to
  0.2 s late still reaches a ball that just passed.
- If a player leaves mid-match, a bot takes their place.

## Code

- `src/sim/`: the match (physics, rules, scoring, bots). Plain TypeScript, no browser.
- `src/session.ts`: rooms, the host and the others.
- `src/render.ts`: the court in perspective, on a canvas.
- `src/main.ts`: the screens.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # the rules, and bots playing whole matches
npm run build
```

Pushing to `main` publishes it to GitHub Pages (`.github/workflows/pages.yml`).
