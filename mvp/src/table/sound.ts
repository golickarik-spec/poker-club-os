/**
 * Tiny synthesised sound effects (Web Audio, no files). Browsers only allow
 * audio after the user has interacted with the page, and the sound setting is
 * off by default, so nothing ever plays unasked.
 */
type SoundName = 'card' | 'chip' | 'check' | 'fold' | 'turn' | 'win';

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
    }
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(ctx: AudioContext, freq: number, start: number, duration: number, gain: number, type: OscillatorType = 'sine'): void {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  amp.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

export function playSound(name: SoundName): void {
  const ctx = audio();
  if (!ctx) return;
  switch (name) {
    case 'card':
      tone(ctx, 1900, 0, 0.035, 0.03, 'triangle');
      break;
    case 'chip':
      tone(ctx, 2600, 0, 0.03, 0.04, 'square');
      tone(ctx, 3300, 0.035, 0.03, 0.03, 'square');
      break;
    case 'check':
      tone(ctx, 220, 0, 0.05, 0.06, 'sine');
      tone(ctx, 220, 0.09, 0.05, 0.05, 'sine');
      break;
    case 'fold':
      tone(ctx, 300, 0, 0.07, 0.03, 'sine');
      break;
    case 'turn':
      tone(ctx, 880, 0, 0.09, 0.05, 'sine');
      tone(ctx, 1320, 0.1, 0.12, 0.05, 'sine');
      break;
    case 'win':
      tone(ctx, 660, 0, 0.1, 0.05, 'triangle');
      tone(ctx, 880, 0.1, 0.1, 0.05, 'triangle');
      tone(ctx, 1320, 0.2, 0.18, 0.05, 'triangle');
      break;
  }
}
