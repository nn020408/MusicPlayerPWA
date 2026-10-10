// core/playbackIntent.js: whether playback is "intended" to be on, and the
// grace period after a user pause. This is what keeps the app from freezing
// in the background right after pausing (see pauseWithGrace's own comment) —
// without it, a remote Play (lock screen, Bluetooth car stereo) silently does
// nothing once the app is frozen, and only reopening the app by hand recovers it.
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal native-platform stub: makes isNative() true so the module creates a
// keep-alive tone via the Web Audio API, and records oscillator start()/stop()
// calls on it (analogous to an <audio> element's play()/pause()).
const audioCalls = [];
class FakeAudioNode {
  connect(dest) { return dest; }
  disconnect() {}
}
class FakeOscillator extends FakeAudioNode {
  constructor() { super(); this.frequency = { value: 0 }; }
  start() { audioCalls.push("play"); }
  stop() { audioCalls.push("pause"); }
}
class FakeGainNode extends FakeAudioNode {
  constructor() { super(); this.gain = { value: 0 }; }
}
class FakeAudioContext {
  constructor() { this.state = "running"; this.destination = new FakeAudioNode(); }
  createOscillator() { return new FakeOscillator(); }
  createGain() { return new FakeGainNode(); }
  resume() { return Promise.resolve(); }
}
globalThis.window = { Capacitor: { isNativePlatform: () => true }, AudioContext: FakeAudioContext };

(async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, "js", "core", "playbackIntent.js")).href);
  const { setWantsToPlay, pauseWithGrace } = mod;

  setWantsToPlay(true);
  check("playing starts the keep-alive tone", audioCalls.at(-1) === "play");

  audioCalls.length = 0;
  pauseWithGrace(60);
  check("a user pause does NOT stop the keep-alive tone right away", audioCalls.length === 0);
  check("wantsToPlay stays true during the grace period (a remote Play can still resume it)", mod.wantsToPlay === true);

  await sleep(100);
  check("the tone does stop once the grace period really expires with nothing resuming it", audioCalls.at(-1) === "pause");
  check("wantsToPlay is false once the grace period expires", mod.wantsToPlay === false);

  audioCalls.length = 0;
  setWantsToPlay(true);
  audioCalls.length = 0;
  pauseWithGrace(60);
  setWantsToPlay(true); // resumed (e.g. the car stereo's Play button) before the grace period ends
  await sleep(100);
  check("resuming during the grace period cancels it (the tone isn't stopped later)", audioCalls.every((c) => c !== "pause"), audioCalls.join(","));
  check("wantsToPlay is still true after the original timer's delay has passed", mod.wantsToPlay === true);

  audioCalls.length = 0;
  pauseWithGrace(60);
  pauseWithGrace(60); // pausing twice in a row (e.g. a double-tap) must not fire the timer twice
  await sleep(100);
  check("pausing twice only stops the tone once", audioCalls.filter((c) => c === "pause").length === 1, audioCalls.join(","));

  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL playback-intent test crashed: " + (e && e.stack || e)); process.exit(1); });
