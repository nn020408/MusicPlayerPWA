// Whether playback is currently *intended* to be on — used by player.js (and
// the artist reader) to tell a transient pause (a network retry in flight,
// the post-pause grace window below) apart from playback genuinely having
// stopped.
//
// On Android this used to also drive a near-silent looping tone, kept
// playing for as long as wantsToPlay was true, specifically to stop
// Chromium from freezing this WebView's JS while backgrounded — needed
// because Next/Previous/auto-advance's queue and Microsoft Graph logic used
// to live here in JS. That's no longer true: the native engine (ExoPlayer,
// via NativePlayerPlugin/PlaybackService/NativeQueueManager/NativeAuthClient/
// NativeGraphClient — see the architecture plan) now owns the entire
// playback-critical path end-to-end in native Android code, so nothing left
// in that path depends on this WebView staying unfrozen, and the tone was
// removed. wantsToPlay itself stays — it's ordinary intent-tracking state,
// unrelated to the freeze-exemption trick it used to also drive.
export let wantsToPlay = false;

let pauseGraceTimer = null;

// Called with true wherever playback is started/resumed, and false only
// where playback intent genuinely ends (sign-out, queue exhausted, retries
// given up) — deliberately NOT tied to audioEl's own pause/play events,
// since those also fire for a transient mid-retry pause this is meant to
// survive. A user pause goes through pauseWithGrace() below instead of
// calling this directly.
export function setWantsToPlay(value) {
  if (pauseGraceTimer) {
    clearTimeout(pauseGraceTimer);
    pauseGraceTimer = null;
  }
  wantsToPlay = value;
}

// A plain user pause (in-app button, or the lock-screen/Bluetooth/car-stereo
// pause button) used to call setWantsToPlay(false) immediately — on the old
// JS-dependent path that stopped the keep-alive tone and let the WebView
// freeze within seconds, which meant a remote Play press (car stereo, lock
// screen) did nothing until the app was reopened by hand. That's no longer a
// risk (Play is fully native), but this grace period is kept anyway: it's
// also just correct intent-tracking for a normal pause (a meal, an errand)
// as opposed to playback actually ending.
const PAUSE_GRACE_MS = 4 * 60 * 60 * 1000; // 4 hours

// delayMs is a seam for tests (real production calls always use the default).
export function pauseWithGrace(delayMs = PAUSE_GRACE_MS) {
  if (pauseGraceTimer) clearTimeout(pauseGraceTimer);
  pauseGraceTimer = setTimeout(() => {
    pauseGraceTimer = null;
    setWantsToPlay(false);
  }, delayMs);
}
