// Short synthesized knocks for hits, bounces and the glass. M mutes.
let ctx: AudioContext | null = null;
let muted = false;

export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}

function knock(freq: number, gain: number, dur: number, type: OscillatorType = 'sine'): void {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

let last: [number, number, number] | null = null;

// Plays what happened since the last view: ev counts hits, bounces and walls.
export function playEvents(ev: [number, number, number]): void {
  if (last) {
    if (ev[0] > last[0]) knock(620, 0.3, 0.08, 'triangle');
    if (ev[1] > last[1]) knock(240, 0.18, 0.06);
    if (ev[2] > last[2]) knock(150, 0.22, 0.12, 'square');
  }
  last = [...ev];
}

export function resetEvents(): void {
  last = null;
}
