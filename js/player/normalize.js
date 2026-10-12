// Volume normalization — evens out quiet and loud songs (and quiet/loud
// moments within one song) via a dynamics compressor on the live audio
// stream. Worth being honest about what this is NOT: true per-track loudness
// matching (like Spotify/YouTube) needs a LUFS measurement of each file,
// which would mean downloading and analyzing every song up front — not
// practical here. This instead leans on the same trick behind "volume
// leveling"/"smart volume" toggles in a lot of players when a precomputed
// per-track gain isn't available: compress whatever's playing right now so
// the loud parts and quiet parts of your library sit closer together.

import { audioEl } from "./player.js";

const KEY = "volumeNormalize";
let enabled = localStorage.getItem(KEY) === "1";

let normCtx = null;
let compressor = null;

// createMediaElementSource() can only ever be called once for a given <audio>
// element (the Web Audio spec disallows a second source node on the same
// element), so the graph is built once and left in place for good — "off"
// below makes the compressor a no-op instead of trying to unwire it.
function ensureGraph() {
  if (compressor) return;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return; // no Web Audio support here — normalization just stays a no-op
  normCtx = new Ctor();
  if (normCtx.state === "suspended") normCtx.resume().catch(() => {});
  const source = normCtx.createMediaElementSource(audioEl);
  compressor = normCtx.createDynamicsCompressor();
  source.connect(compressor);
  compressor.connect(normCtx.destination);
  applyEnabled();
}

// Settings chosen for "leveling", not "squashing" — a moderate ratio and a
// wide knee so it smooths out the difference between a quiet acoustic track
// and a loud, compressed pop one without obviously pumping on either.
function applyEnabled() {
  if (!compressor) return;
  if (enabled) {
    compressor.threshold.setValueAtTime(-28, normCtx.currentTime);
    compressor.knee.setValueAtTime(24, normCtx.currentTime);
    compressor.ratio.setValueAtTime(6, normCtx.currentTime);
    compressor.attack.setValueAtTime(0.02, normCtx.currentTime);
    compressor.release.setValueAtTime(0.3, normCtx.currentTime);
  } else {
    // ratio 1:1 passes the signal through essentially unchanged.
    compressor.ratio.setValueAtTime(1, normCtx.currentTime);
    compressor.threshold.setValueAtTime(0, normCtx.currentTime);
  }
}

export function isVolumeNormalizeOn() {
  return enabled;
}

export function setVolumeNormalize(value) {
  enabled = !!value;
  localStorage.setItem(KEY, enabled ? "1" : "0");
  ensureGraph();
  applyEnabled();
}

// A fresh AudioContext can start "suspended" on some engines until a real
// user gesture resumes it — belt-and-suspenders alongside ensureGraph()'s own
// resume attempt, tied to playback actually starting.
audioEl.addEventListener("play", () => {
  if (enabled && normCtx && normCtx.state === "suspended") normCtx.resume().catch(() => {});
});

if (enabled) ensureGraph();
