/* Self-contained sound effects via the Web Audio API — no audio files.
   Every sound is synthesized from oscillators + gain envelopes. Muteable, with
   the preference persisted to localStorage. The AudioContext must be unlocked by
   a user gesture (browser autoplay policy), so unlock() is wired to the first
   click/tap in app.js. All play* helpers no-op until unlocked or when muted. */

const STORAGE_KEY = "snl_muted";

let ctx = null;
let muted = readMuted();

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* localStorage unavailable (private mode) — keep in-memory state only */
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = !!value;
  writeMuted(muted);
  return muted;
}

export function toggleMute() {
  return setMuted(!muted);
}

/* Create or resume the AudioContext. Safe to call repeatedly; only the first
   call inside a user gesture actually unlocks audio on strict browsers. */
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    ctx = null;
  }
}

function ready() {
  return !muted && ctx && ctx.state === "running";
}

/* One short tone with an exponential decay envelope. */
function tone(opts) {
  if (!ready()) return;
  const t0 = ctx.currentTime + (opts.delay || 0);
  const dur = opts.duration ?? 0.15;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = opts.type || "sine";
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.toFreq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.toFreq), t0 + dur);
  }

  const peak = opts.gain ?? 0.18;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/* Dice tumble — a quick run of clicky blips. */
export function playRoll() {
  if (!ready()) return;
  for (let i = 0; i < 5; i++) {
    tone({
      type: "square",
      freq: 220 + Math.random() * 180,
      duration: 0.05,
      gain: 0.07,
      delay: i * 0.05
    });
  }
}

/* Token landing on a tile — a small upward blip. */
export function playHop() {
  tone({ type: "triangle", freq: 360, toFreq: 540, duration: 0.07, gain: 0.09 });
}

/* Ladder climb — a bright ascending arpeggio. */
export function playLadder() {
  const notes = [392, 523, 659, 784];
  notes.forEach(function (f, i) {
    tone({ type: "sine", freq: f, duration: 0.16, gain: 0.14, delay: i * 0.08 });
  });
}

/* Snake descent — a comic downward sweep. */
export function playSnake() {
  tone({ type: "sawtooth", freq: 660, toFreq: 150, duration: 0.45, gain: 0.13 });
}

/* Victory — a short fanfare (major arpeggio + topped octave). */
export function playWin() {
  const notes = [523, 659, 784, 1047];
  notes.forEach(function (f, i) {
    tone({ type: "triangle", freq: f, duration: 0.32, gain: 0.16, delay: i * 0.11 });
  });
}
