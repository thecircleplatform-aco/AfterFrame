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
//
// Why the shape below: the previous version ramped gain exponentially from
// 0.0001, so it spent most of the note practically silent and then jumped —
// which is heard as a thud, not a click. It also stacked a sine and a triangle
// two octaves up, and triangle waves carry strong odd harmonics, so it came out
// buzzy. A short filtered sine with a LINEAR attack and an exponential decay is
// what a professional send cue sounds like: soft onset (no click), fast falloff
// (no tail), one clean pitch (no buzz).
const MIN_GAP_MS = 140;

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
 * A single soft "tick" — a brief filtered sine that falls away immediately.
 *
 * - ~1.3 kHz reads as a crisp UI confirmation without the 3 kHz+ sibilance that
 *   gets fatiguing across repeated sends.
 * - A linear 3 ms attack avoids the click a hard onset would produce; the
 *   exponential release starts at the PEAK (never at ~zero), so it decays
 *   naturally instead of hanging silent then spiking.
 * - A lowpass at 3.2 kHz strips the sine's upper partials so it reads as a tone
 *   rather than a beep.
 * - Peak gain is deliberately low (0.045): sitting under speech is the goal, and
 *   being slightly too quiet costs far less than being noticed every send.
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
    const duration = 0.085;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // A whole-tone rise keeps the "sent, moving on" feel without the cartoon
    // 660 → 990 sweep the old version had.
    osc.frequency.setValueAtTime(1320, start);
    osc.frequency.linearRampToValueAtTime(1480, start + duration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, start);
    filter.Q.setValueAtTime(0.7, start);

    const gain = ctx.createGain();
    const peak = 0.045;
    // Linear attack: click-free onset.
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.003);
    // Exponential decay from the peak — safe because the value is never zero at
    // the start of the ramp, which is what `exponentialRamp` requires.
    gain.gain.exponentialRampToValueAtTime(peak * 0.02, start + duration);
    gain.gain.linearRampToValueAtTime(0, start + duration + 0.012);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + duration + 0.02);
  } catch {
    // Ignore: audio is never load-bearing.
  }
}
