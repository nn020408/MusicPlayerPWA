// A song deleted in OneDrive: playing it drops it from the library right away
// (no retries, no error left on screen) and moves on to the next song.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
if (!fs.existsSync(path.join(ROOT, "tools", "node_modules", "jsdom"))) {
  console.log("SKIP dead-files test (run: cd tools && npm install)");
  process.exit(0);
}
const { startApp, GONE } = require("./helpers/ui-env");

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

(async () => {
  const app = await startApp();
  const { $, $$, sleep, window } = app;
  const titles = () => JSON.parse(window.localStorage.getItem("libraryIndexCache")).tracks.map((t) => t.name);

  // open Pop; "Who Knew.mp3" has been deleted in OneDrive but is still in the library
  $$("#file-list .folder-row").find((r) => r.textContent.includes("Pop")).click();
  await sleep(300);
  GONE.add("pop/Who Knew.mp3");
  check("before: the deleted song is still in the library", titles().includes("Who Knew.mp3"));

  const started = Date.now();
  $$("#file-list .track-row").find((r) => r.textContent.includes("Who Knew")).click();
  await sleep(800);

  check("the deleted song is dropped from the library", !titles().includes("Who Knew.mp3"));
  check("the other songs stay", titles().includes("Hips Don't Lie.mp3") && titles().includes("Baila Conmigo.mp3"));
  check("the player says what happened", /Removed "Who Knew" — it's no longer in OneDrive/.test($("#toast").textContent) || /Removed "Who Knew"/.test($("#now-playing-title").textContent + $("#toast").textContent), $("#toast").textContent);
  check("it gave up at once, without retrying", Date.now() - started < 4000, `${Date.now() - started}ms`);
  check("playback moved on to another song", !/Who Knew/.test($("#now-playing-title").textContent));

  await app.stop();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL dead-files test crashed: " + (e && e.stack || e)); process.exit(1); });
