// A remote player's own figure: it moves at once with their keys, by the rules the host uses
// (sim/body.ts), instead of a round trip later, and tells the host where it is. The host puts it
// back in place for each serve; the place counter says when.
import { clampServeAim, defaultServeAim } from './sim/aim.ts';
import { moveBody, newBody, type Body } from './sim/body.ts';
import * as C from './sim/constants.ts';
import type { Controls } from './sim/controls.ts';
import { fwd, other, rightX } from './sim/court.ts';
import type { SwingKind, View } from './sim/types.ts';

export class Me {
  body: Body = newBody();
  place = -1;
  aim = { x: 0, y: 0 }; // where they aim their serve
  private placeAt = 0; // when, on this clock, the latest serve was set up
  private dives = 0;
  private charging: { kind: SwingKind; at: number } | null = null;
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
    }
    this.serving = v.phase === 'serve' && v.serverId === id;
    if (!held) this.charging = null;
    else if (!this.charging || this.charging.at < pressedAt) {
      // A serve can't start before its wait is over; a key held through it starts it then.
      const at = this.serving ? Math.max(pressedAt, this.placeAt + C.SERVE_DELAY * 1000) : pressedAt;
      this.charging = { kind: held, at };
      if (this.serving) this.aim = defaultServeAim(v.boxSign, R);
    }
    const dive = c.d > this.dives;
    this.dives = c.d;
    const charging = !!this.charging && now >= this.charging.at;
    moveBody(this.body, c.ix, c.iy, dive, { team: p.team, serveSide: this.serving ? v.serveSide : 0, frozen: this.serving && charging, slow: charging, speed: p.speed }, dt);
    if (this.serving && charging) {
      this.aim = clampServeAim(
        this.aim.x + c.ix * rightX(p.team) * C.AIM_SPEED * dt,
        this.aim.y + c.iy * fwd(p.team) * C.AIM_SPEED * dt,
        v.boxSign,
        R,
      );
    } else if (this.serving) {
      this.aim = defaultServeAim(v.boxSign, R);
    }
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
    return { px: r(this.body.x), py: r(this.body.y), pl: this.place, ax: r(this.aim.x), ay: r(this.aim.y) };
  }
}
