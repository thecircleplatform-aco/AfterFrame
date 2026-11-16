// The "message sent" cue.
//
// Synthesised with WebAudio rather than shipping an audio file: it is a single
// short blip, so a 1-2 KB asset would still cost a request and a decoder, and it
// could not adapt to the user's volume/mute state the way the audio graph does.
//
// Rules:
//   • Lazily create the AudioContext on first play (browsers block construction
//     before a gesture, and this always follows a click/keypress).
//   • Respect `prefers-reduced-motion`: the cue accompanies the send animation,
//     so suppressing the animation should suppress the sound too.
//   • Never throw — audio is decoration, and a failure must not break sending.
const MIN_GAP_MS = 120;

let context: AudioContext | null = null;
let lastPlayed = 0;

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/** True when the OS asks for less motion (and therefore less incidental sound). */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A two-tone rising blip — the same shape as the send animation (upward,
 * quick). Short enough to feel like feedback rather than a notification.
 */
export function playMessageSentSound(): void {
  try {
    if (prefersReducedMotion()) return;
    const now = Date.now();
    if (now - lastPlayed < MIN_GAP_MS) return;
    lastPlayed = now;

    const ctx = audioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const start = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    // Fast attack, exponential tail — a click-free envelope.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.06, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);

    const first = ctx.createOscillator();
    first.type = 'sine';
    first.frequency.setValueAtTime(660, start);
    first.frequency.exponentialRampToValueAtTime(990, start + 0.09);
    first.connect(gain);
    first.start(start);
    first.stop(start + 0.17);

    // A quieter octave above gives the blip some body without getting shrill.
    const second = ctx.createOscillator();
    second.type = 'triangle';
    second.frequency.setValueAtTime(1320, start + 0.02);
    second.frequency.exponentialRampToValueAtTime(1980, start + 0.1);
    const secondGain = ctx.createGain();
    secondGain.gain.setValueAtTime(0.0001, start);
    secondGain.gain.exponentialRampToValueAtTime(0.018, start + 0.03);
    secondGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
    second.connect(secondGain);
    secondGain.connect(ctx.destination);
    second.start(start + 0.02);
    second.stop(start + 0.16);
  } catch {
    // Ignore: audio is never load-bearing.
  }
}
