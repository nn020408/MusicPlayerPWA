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

// This has been through two earlier designs, both wrong in instructive ways:
//
// 1) A plain HTMLAudioElement looping a short WAV, on the theory that
//    Android's native decoder behind <audio loop> wasn't gapless and was
//    clicking at every loop restart.
// 2) Switching to a Web Audio oscillator — no loop boundary at all, so it
//    couldn't glitch that way — which turned the reported "boo boo boo" into
//    one CONTINUOUS tone instead of fixing it. That meant (1)'s theory was
//    wrong: the tone was never clicking, it was simply loud enough to hear
//    the whole time, and what sounded rhythmic was it poking through as the
//    song's own volume rose and fell. Dropping the gain ~30dB (0.0018 ->
//    0.00004) did fix the loudness — but a few days later, lock-screen/
//    notification controls were reported gone after the app had been
//    backgrounded a while, "fixed" by force-restarting it. Root cause: an
//    AudioContext (unlike an <audio> element) can be suspended by Android
//    while backgrounded, and once that happens this tone actually stops —
//    silently losing the freeze exemption it exists for, which is exactly
//    what lets player.js's sessionHeartbeat() keep re-announcing the media
//    session every minute (see the comment above it). An <audio> element
//    doesn't have that failure mode.
//
// So: back to design (1), keeping only the real lesson from (2) — it's
// audioEl.volume that was too loud, not the loop itself. Generated at full
// amplitude; volume (below) does the attenuating, the same plain property
// any in-app volume slider would use.
//
// A third bug, found after dropping to 0.00004: that volume is too quiet for
// Chromium's own freeze exemption to recognize as "playing audio" at all.
// Confirmed on-device by injecting test tones at several volumes while
// paused+backgrounded+locked for 5+ minutes each and probing with
// Runtime.evaluate over CDP (no app-visible UI involved): 0.00004 and even
// 0.0004 both still froze solid (the probe hung until the app was
// foregrounded again — the WebView's JS, including this file's own
// setTimeout calls, genuinely stops executing, it's not merely throttled);
// 0.002 and above stayed fully responsive and a real KEYCODE_MEDIA_PLAY_PAUSE
// resumed correctly without ever opening the app. The exemption appears to
// depend on measured loudness specifically (not just "is a media element
// technically playing") — a second test holding volume at 1.0 but baking the
// same tiny amplitude straight into the PCM samples still froze, so there's
// no trick that satisfies the check while staying silent. 0.002 is almost
// exactly the original pre-(1)/(2) 0.0018 volume, so this isn't new loudness
// being introduced — it's the quietest level with direct on-device evidence
// of actually working.
function makeKeepAliveDataUri() {
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1 second, looped — 220 cycles of a 220Hz
  // tone fit exactly into this many samples, so the loop point is sample-
  // accurate with zero phase discontinuity (verified: this was never the
  // source of the audible issue — see the design history above).
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
  const amplitude = 16384; // half-scale — plenty of headroom; volume does the real attenuating
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / sampleRate));
    view.setInt16(44 + i * 2, sample, true);
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

// Needed even with the native engine (ExoPlayer, via NativePlayerPlugin) —
// a real regression was introduced and then un-done here, worth recording:
// actual audio OUTPUT moved to native, which indeed never gets frozen by
// Chromium's background-tab policy. But Next/Previous and auto-advance-to-
// the-next-track still have to ask THIS WebView's JS "what's next, get me a
// fresh streaming URL for it" (see QueueAwarePlayer.java's forward to
// notifyRemoteAction, and the "ended" handling in player.js) — and once
// this tone stopped running, this WebView had zero audio signal of its own
// again, so Chromium had no reason not to freeze its JS. Confirmed on real
// devices: Play/Pause (handled entirely natively, no JS involved) kept
// working, while Next/Previous/auto-advance all silently queued until the
// app was reopened by hand — exactly what this tone exists to prevent.
// Keeping it active is what it costs to keep those working too, given the
// queue/Graph-API logic they depend on is still JS, not native.
let keepAliveEl = null;
if (isNative()) {
  keepAliveEl = new Audio(makeKeepAliveDataUri());
  keepAliveEl.loop = true;
  keepAliveEl.volume = 0.002; // quietest level confirmed on-device to actually keep the freeze exemption — see the comment above
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
