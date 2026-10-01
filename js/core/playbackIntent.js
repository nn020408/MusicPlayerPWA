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

let keepAliveEl = null;

// Synthesized at runtime rather than a hardcoded blob, so what it actually
// contains is auditable: a quiet (~-55dBFS) 220Hz tone, well below the
// loudness of real music — not literal silence, since some engines treat a
// fully-silent/muted element as not "audible" and won't grant the exemption.
function makeKeepAliveDataUri() {
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1 second, looped
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, numSamples * 2, true);
  const amplitude = 60; // out of 32767 (~ -55dBFS)
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / sampleRate));
    view.setInt16(44 + i * 2, sample, true);
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

if (isNative()) {
  keepAliveEl = new Audio(makeKeepAliveDataUri());
  keepAliveEl.loop = true;
}

let pauseGraceTimer = null;

// Drives keepAliveEl. Called with true wherever playback is started/resumed,
// and false only where playback intent genuinely ends (sign-out, queue
// exhausted, retries given up) — deliberately NOT tied to audioEl's own
// pause/play events, since those also fire for the transient mid-retry pause
// this exists to survive. A user pause goes through pauseWithGrace() below
// instead of calling this directly.
export function setWantsToPlay(value) {
  if (pauseGraceTimer) {
    clearTimeout(pauseGraceTimer);
    pauseGraceTimer = null;
  }
  if (wantsToPlay === value) return;
  wantsToPlay = value;
  if (!keepAliveEl) return;
  if (value) keepAliveEl.play().catch(() => {});
  else keepAliveEl.pause();
}

// A plain user pause (in-app button, or the lock-screen/Bluetooth/car-stereo
// pause button) used to call setWantsToPlay(false) immediately, which stops
// the keep-alive tone and lets the WebView freeze within seconds. Frozen, the
// app can no longer run the "play" handler that a remote Play button (the
// car stereo, the lock screen) sends — pressing it then did nothing until the
// app was reopened by hand. This keeps the exemption alive for a grace period
// after pausing instead, long enough to resume from a stoplight, and only
// lets it lapse (ending the grace period, and with it the Android foreground
// service) if nothing resumes playback before the timer runs out. The timer
// itself survives the background freeze because the still-playing keep-alive
// tone is exactly what prevents that freeze while it's pending.
const PAUSE_GRACE_MS = 10 * 60 * 1000; // 10 minutes

// delayMs is a seam for tests (real production calls always use the default).
export function pauseWithGrace(delayMs = PAUSE_GRACE_MS) {
  if (pauseGraceTimer) clearTimeout(pauseGraceTimer);
  pauseGraceTimer = setTimeout(() => {
    pauseGraceTimer = null;
    setWantsToPlay(false);
  }, delayMs);
}
