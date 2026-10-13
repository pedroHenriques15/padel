// Short synthesized sounds: the racket, a smash, bounces, the glass and the fence, the net, and a
// crowd that goes "oooh" and cheers. M mutes.
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
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

function knock(freq: number, gain: number, dur: number, type: OscillatorType = 'sine', at = 0): void {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
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

// Filtered noise: a burst for a hit or the glass, or a swell for the crowd.
function hiss(freq: number, q: number, gain: number, attack: number, dur: number, at = 0, type: BiquadFilterType = 'bandpass'): void {
  if (!ctx || muted) return;
  noise ??= (() => {
    const b = ctx!.createBuffer(1, ctx!.sampleRate, ctx!.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + dur + 0.05);
}

const SOUNDS = [
  () => {
    knock(620, 0.3, 0.08, 'triangle');
    hiss(2600, 2, 0.12, 0.002, 0.04);
  },
  () => knock(240, 0.18, 0.06),
  () => {
    hiss(3200, 6, 0.18, 0.002, 0.22);
    knock(170, 0.16, 0.1, 'square');
  },
  () => {
    knock(90, 0.25, 0.12);
    hiss(500, 1, 0.1, 0.003, 0.08, 0, 'lowpass');
  },
  () => {
    knock(130, 0.45, 0.18);
    knock(520, 0.3, 0.09, 'triangle');
    hiss(1300, 1.5, 0.3, 0.002, 0.1);
  },
  () => {
    for (let i = 0; i < 4; i++) hiss(5200, 3, 0.07, 0.002, 0.05, i * 0.035, 'highpass');
  },
  () => {
    hiss(520, 1.4, 0.16, 0.25, 0.9);
    hiss(900, 2.5, 0.06, 0.3, 0.7);
  },
  () => {
    hiss(900, 0.8, 0.14, 0.15, 1.4);
    for (let i = 0; i < 40; i++) hiss(1800 + Math.random() * 1500, 4, 0.08, 0.002, 0.03, Math.random() * 1.5);
  },
];

let last: number[] | null = null;

// Plays what happened since the last view: ev counts hits, bounces, glass, the net, smashes, the
// fence, the crowd's "oooh"s and cheers.
export function playEvents(ev: number[]): void {
  if (last) {
    ev.forEach((n, i) => {
      if (n > (last![i] ?? 0)) SOUNDS[i]?.();
    });
  }
  last = [...ev];
}

export function resetEvents(): void {
  last = null;
}
