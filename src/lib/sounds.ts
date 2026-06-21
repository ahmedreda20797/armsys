// src/lib/sounds.ts
// Play notification sounds using Web Audio API (no external files needed)
// Futuristic space ambient theme — soft ethereal tones
//
// Chrome requires AudioContext to be created/resumed after a user gesture.
// We track the first user interaction to enable audio safely.

let audioContext: AudioContext | null = null;
let userInteracted = false;

// Mark that the user has interacted with the page
if (typeof document !== 'undefined') {
  const enableAudio = () => {
    userInteracted = true;
    // If context exists but is suspended, resume it
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  };
  document.addEventListener('click', enableAudio, { once: true });
  document.addEventListener('keydown', enableAudio, { once: true });
  document.addEventListener('touchstart', enableAudio, { once: true });
}

function getAudioContext(): AudioContext | null {
  if (!userInteracted) return null;
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  } catch {
    return null;
  }
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  volume: number = 0.06,
  type: OscillatorType = 'sine'
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function playNotificationSound(type: 'travel' | 'request' | 'success' | 'error' = 'request') {
  try {
    const ctx = getAudioContext();
    if (!ctx) return; // No user gesture yet — skip silently

    const t = ctx.currentTime;

    switch (type) {
      case 'travel':
        // Futuristic space travel: 3-note ascending arpeggio with shimmer
        playTone(ctx, 440, t, 0.6, 0.05, 'sine');         // A4
        playTone(ctx, 554, t + 0.12, 0.5, 0.05, 'sine');  // C#5
        playTone(ctx, 659, t + 0.24, 0.5, 0.05, 'sine');  // E5
        // Shimmer overtone
        playTone(ctx, 1318, t + 0.35, 0.4, 0.02, 'sine'); // E6 (octave harmonic)
        break;

      case 'request':
        // Gentle space chime: soft two-note descending with ethereal tail
        playTone(ctx, 587, t, 0.4, 0.05, 'sine');        // D5
        playTone(ctx, 440, t + 0.15, 0.5, 0.04, 'sine'); // A4
        // Soft ambient tail
        playTone(ctx, 330, t + 0.35, 0.6, 0.02, 'sine'); // E4
        break;

      case 'success':
        // Cosmic success: bright three-note ascending with warm resolution
        playTone(ctx, 523, t, 0.3, 0.05, 'sine');        // C5
        playTone(ctx, 659, t + 0.1, 0.3, 0.05, 'sine');  // E5
        playTone(ctx, 784, t + 0.2, 0.4, 0.06, 'sine');  // G5
        // Warm resolve
        playTone(ctx, 1047, t + 0.35, 0.5, 0.03, 'sine'); // C6
        break;

      case 'error':
        // Deep space warning: low resonant tone
        playTone(ctx, 220, t, 0.35, 0.04, 'sine'); // A3
        playTone(ctx, 165, t + 0.15, 0.35, 0.03, 'sine'); // E3
        break;
    }
  } catch {
    // Audio not supported - silently ignore
  }
}
