// src/lib/sounds.ts
// Play notification beep sound using Web Audio API (no external files needed)
// All sounds are soft and gentle — not annoying
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function playNotificationSound(type: 'travel' | 'request' | 'success' | 'error' = 'request') {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    switch (type) {
      case 'travel':
        // Soft gentle chime: 2 light descending tones
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(660, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.25);
        gainNode.gain.setValueAtTime(0.08, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.35);

        // Second gentle tone
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(520, ctx.currentTime + 0.4);
        osc2.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.7);
        gain2.gain.setValueAtTime(0.06, ctx.currentTime + 0.4);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75);
        osc2.start(ctx.currentTime + 0.4);
        osc2.stop(ctx.currentTime + 0.75);
        break;

      case 'request':
        // Soft gentle notification: 1 ascending tone, very quiet
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(520, ctx.currentTime);
        oscillator.frequency.setValueAtTime(659, ctx.currentTime + 0.12);
        gainNode.gain.setValueAtTime(0.06, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.3);
        break;

      case 'success':
        // Soft pleasant ascending chime
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(523, ctx.currentTime);
        oscillator.frequency.setValueAtTime(659, ctx.currentTime + 0.08);
        oscillator.frequency.setValueAtTime(784, ctx.currentTime + 0.16);
        gainNode.gain.setValueAtTime(0.06, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.35);
        break;

      case 'error':
        // Very soft low buzz
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(200, ctx.currentTime);
        gainNode.gain.setValueAtTime(0.05, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.25);
        break;
    }
  } catch {
    // Audio not supported - silently ignore
  }
}
