// A remote player's own figure and target: they move at once with their keys, by the rules the
// host uses (sim/body.ts, sim/aim.ts), instead of a round trip later, and it tells the host where
// they are. The host puts the figure back in place for each serve; the place counter says when.
import { autoTarget, clampServeAim, clampShotAim, defaultServeAim, likelyShot, steer } from './sim/aim.ts';
import { moveBody, newBody, type Body } from './sim/body.ts';
import * as C from './sim/constants.ts';
import type { Controls } from './sim/controls.ts';
import { other } from './sim/court.ts';
import type { SwingKind, View } from './sim/types.ts';

export class Me {
  body: Body = newBody();
  place = -1;
  aim = { x: 0, y: 0 }; // their target: the serve's, or the next shot's
  aimed = false; // the arrows moved it since their team's last shot; else it's the automatic shot
  private shots = -1; // the shot counter they last saw
  private placeAt = 0; // when, on this clock, the latest serve was set up
  private dives = 0;
  private charging: { kind: SwingKind; at: number; seen: boolean } | null = null;
  private spent = 0; // the press whose swing the host has made
  private serving = false;

  // v is the newest view from the host; held, the kind of key held since its press at pressedAt.
  update(v: View, id: string, c: Controls, held: SwingKind | null, pressedAt: number, now: number, dt: number): void {
    const p = v.players.find((q) => q.id === id);
    if (!p) return;
    const R = other(p.team);
    if (v.place !== this.place) {
      this.body = newBody(p.x, p.y);
      this.place = v.place;
      this.placeAt = now - v.timer * 1000;
      this.charging = null;
      this.dives = c.d;
      this.aimed = false;
    }
    if (v.shot.n !== this.shots) {
      this.shots = v.shot.n;
      if (v.players.find((q) => q.id === v.shot.id)?.team === p.team) this.aimed = false;
    }
    this.serving = v.phase === 'serve' && v.serverId === id;
    if (!held || pressedAt <= this.spent) this.charging = null;
    else if (!this.charging || this.charging.at < pressedAt) {
      // A serve can't start before its wait is over; a key held through it starts it then.
      const at = this.serving ? Math.max(pressedAt, this.placeAt + C.SERVE_DELAY * 1000) : pressedAt;
      this.charging = { kind: held, at, seen: false };
    }
    // Once the host has swung (or served), the charge is over though the key is still down, as it
    // is on the host: the ring empties.
    if (this.charging) {
      if (p.charge >= 0) this.charging.seen = true;
      else if (this.charging.seen || now - pressedAt > 1200) {
        this.spent = pressedAt;
        this.charging = null;
      }
    }
    const dive = c.d > this.dives;
    this.dives = c.d;
    moveBody(this.body, c.ix, c.iy, dive, { team: p.team, serveSide: this.serving ? v.serveSide : 0, speed: p.speed }, dt);
    // The target, as the host moves it (aimControl in sim.ts).
    if (!this.aimed) {
      const charge = this.charge(now);
      this.aim = this.serving
        ? defaultServeAim(v.boxSign, R)
        : autoTarget(p.team, this.body.x, likelyShot(charge >= 0 && this.kind() === 'lob', Math.max(0, charge), v.ball, this.body));
    }
    if (c.tx || c.ty) {
      this.aim = steer(this.aim, p.team, c.tx, c.ty, this.serving ? C.SERVE_AIM_SPEED : C.AIM_SPEED, dt);
      this.aimed = true;
    }
    if (this.aimed) this.aim = this.serving ? clampServeAim(this.aim.x, this.aim.y, v.boxSign, R) : clampShotAim(this.aim.x, this.aim.y, p.team);
  }

  // How full their charge is, 0-1, or -1.
  charge(now: number): number {
    if (!this.charging || now < this.charging.at) return -1;
    return Math.min(1, (now - this.charging.at) / 1000 / (this.serving ? C.SERVE_FULL : C.CHARGE_FULL));
  }

  kind(): SwingKind {
    return this.charging?.kind ?? 'drive';
  }

  pose(): Pick<Controls, 'px' | 'py' | 'pl' | 'ax' | 'ay'> {
    const r = (v: number) => Math.round(v * 100) / 100;
    const at = { px: r(this.body.x), py: r(this.body.y), pl: this.place };
    // The automatic shot the host works out itself, at contact, for the shot it turns out to be.
    return this.aimed ? { ...at, ax: r(this.aim.x), ay: r(this.aim.y) } : at;
  }
}
