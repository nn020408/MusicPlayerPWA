// Whether playback is currently *intended* to be on, and on Android the quiet
// looping tone that keeps the app running for as long as it is. Shared by the
// player and by anything that should keep working while music plays (the artist
// reader).

import { isNative } from "./platform.js";

// Background execution keep-alive (Android only).
// Android's WebView (Chromium) fully freezes a backgrounded page's JS —
// every timer, every pending fetch — once it decides the page has gone
// quiet. Actively playing audio exempts a page from that freeze, but the
// exemption lapses the instant audioEl itself pauses — which is exactly what
// happens for the few seconds a network hiccup takes to recover (see the
// "error" listener in player/player.js and its retryWithBackoff loop): the app goes silent,
// gets frozen mid-retry if the screen happens to be off right then, and the
// pending setTimeout only fires once the app is foregrounded again. That
// matches "only resumes once I turn the screen back on and look at the app"
// exactly — it's page *visibility* freezing, not (just) battery optimization.
// A second, extremely quiet looping tone keeps the page genuinely producing
// audio for the whole time playback is *intended* to be on (tracked by
// wantsToPlay, not audioEl.paused, so it survives that gap), so the retry
// timers keep firing straight through it instead of freezing.
export let wantsToPlay = false;

// A plain HTMLAudioElement looping a short WAV was tried first here, on the
// theory that Android's native decoder behind <audio loop> wasn't gapless and
// was clicking at every loop restart. Switching to a Web Audio oscillator
// (below) — which has no loop boundary at all, so couldn't glitch that way —
// turned the reported "boo boo boo" into one CONTINUOUS tone instead of
// fixing it, which means that theory was wrong: the tone was never clicking,
// it was simply loud enough to hear the whole time, and what sounded
// rhythmic was it poking through as the song's own volume rose and fell.
// Fixed for real now by dropping the gain about 30dB from what it was
// (0.0018 -> 0.00004) — still not literal silence (so a player that treats a
// fully-muted/all-zero stream as "not audible" and withholds the freeze
// exemption still sees real samples), but far enough under a real song's
// level that it shouldn't surface even in a quiet passage.
let audioCtx = null;
let oscillator = null;
let gainNode = null;

function startKeepAliveTone() {
  if (oscillator) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  oscillator = audioCtx.createOscillator();
  gainNode = audioCtx.createGain();
  oscillator.frequency.value = 220;
  gainNode.gain.value = 0.00004; // ~ -88dBFS — see the comment above on why this is so much quieter than it first was
  oscillator.connect(gainNode).connect(audioCtx.destination);
  try {
    oscillator.start();
  } catch {
    oscillator = null;
    gainNode = null;
  }
}

function stopKeepAliveTone() {
  if (!oscillator) return;
  try {
    oscillator.stop();
  } catch {}
  oscillator.disconnect();
  gainNode.disconnect();
  oscillator = null;
  gainNode = null;
}

let pauseGraceTimer = null;

// Drives the keep-alive tone. Called with true wherever playback is
// started/resumed, and false only where playback intent genuinely ends
// (sign-out, queue exhausted, retries given up) — deliberately NOT tied to
// audioEl's own pause/play events, since those also fire for the transient
// mid-retry pause this exists to survive. A user pause goes through
// pauseWithGrace() below instead of calling this directly.
export function setWantsToPlay(value) {
  if (pauseGraceTimer) {
    clearTimeout(pauseGraceTimer);
    pauseGraceTimer = null;
  }
  if (wantsToPlay === value) return;
  wantsToPlay = value;
  if (!isNative()) return;
  if (value) startKeepAliveTone();
  else stopKeepAliveTone();
}

// A plain user pause (in-app button, or the lock-screen/Bluetooth/car-stereo
// pause button) used to call setWantsToPlay(false) immediately, which stops
// the keep-alive tone and lets the WebView freeze within seconds. Frozen, the
// app can no longer run the "play" handler that a remote Play button (the
// car stereo, the lock screen) sends — pressing it then did nothing until the
// app was reopened by hand. This keeps the exemption alive for a grace period
// after pausing instead — long enough to cover a normal pause (a meal, running
// an errand), closer to how a native player like YouTube or Spotify stays
// resumable until you actually leave the app — and only lets it lapse (ending
// the grace period, and with it the Android foreground service) if nothing
// resumes playback before the timer runs out. If you swipe the app away or
// force-stop it, Android kills the whole process regardless of this timer, so
// that always ends it immediately too. The timer itself survives the
// background freeze because the still-playing keep-alive tone is exactly what
// prevents that freeze while it's pending.
const PAUSE_GRACE_MS = 4 * 60 * 60 * 1000; // 4 hours

// delayMs is a seam for tests (real production calls always use the default).
export function pauseWithGrace(delayMs = PAUSE_GRACE_MS) {
  if (pauseGraceTimer) clearTimeout(pauseGraceTimer);
  pauseGraceTimer = setTimeout(() => {
    pauseGraceTimer = null;
    setWantsToPlay(false);
  }, delayMs);
}
