// core/playbackIntent.js: whether playback is "intended" to be on, and the
// grace period after a user pause (pauseWithGrace) — ordinary intent-
// tracking state used elsewhere (e.g. player.js) to tell a transient pause
// apart from playback genuinely having stopped. This used to also drive a
// keep-alive tone to stop Chromium freezing the WebView in the background;
// that's gone now that the native engine owns the whole playback-critical
// path (see the architecture plan), so this only tests the state machine.
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

(async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, "js", "core", "playbackIntent.js")).href);
  const { setWantsToPlay, pauseWithGrace } = mod;

  setWantsToPlay(true);
  check("setWantsToPlay(true) sets wantsToPlay", mod.wantsToPlay === true);

  pauseWithGrace(60);
  check("a user pause does NOT drop wantsToPlay right away", mod.wantsToPlay === true);

  await sleep(100);
  check("wantsToPlay is false once the grace period really expires with nothing resuming it", mod.wantsToPlay === false);

  setWantsToPlay(true);
  pauseWithGrace(60);
  setWantsToPlay(true); // resumed (e.g. the car stereo's Play button) before the grace period ends
  await sleep(100);
  check("wantsToPlay is still true after the original timer's delay has passed (resuming cancels it)", mod.wantsToPlay === true);

  setWantsToPlay(true);
  pauseWithGrace(60);
  pauseWithGrace(60); // pausing twice in a row (e.g. a double-tap) must not fire two independent timers
  await sleep(100);
  check("wantsToPlay is false exactly once the (single) grace timer expires", mod.wantsToPlay === false);

  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL playback-intent test crashed: " + (e && e.stack || e)); process.exit(1); });
