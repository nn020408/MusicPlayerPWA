// The next-track blob prefetch (player.js): downloads the whole next song
// ahead of time so advancing to it needs no network wait. A dropped/flaky
// connection can end that download early without fetch() itself reporting an
// error — the real-world symptom was "decode error (unsupported format?)" on
// perfectly ordinary songs, right at the auto-advance to whichever one got
// truncated. Checking the downloaded size against the server's own
// Content-Length catches that instead of trusting a partial file.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
if (!fs.existsSync(path.join(ROOT, "tools", "node_modules", "jsdom"))) {
  console.log("SKIP prefetch-integrity test (run: cd tools && npm install)");
  process.exit(0);
}
const { startApp, TRUNCATE_PREFETCH } = require("./helpers/ui-env");

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

(async () => {
  const app = await startApp();
  const { $, $$, sleep } = app;
  const { audioEl } = await import(pathToFileURL(path.join(ROOT, "js", "player", "player.js")).href);

  $$("#file-list .folder-row").find((r) => r.textContent.includes("Rock")).click();
  await sleep(300);

  // Folder listings sort alphabetically, so "Wonderwall" is next after "Sad
  // But True" — its background prefetch will report a Content-Length twice
  // what it actually delivers.
  TRUNCATE_PREFETCH.add("rock/Wonderwall.mp3");

  $$("#file-list .track-row").find((r) => r.textContent.includes("Sad But True")).click();
  await sleep(1500); // playback starts, and the (truncated) next-track prefetch runs in the background — give it time to actually finish

  $("#mini-next-btn").click();
  await sleep(500);

  check("advanced to the next song", /Wonderwall/.test($("#now-playing-title").textContent), $("#now-playing-title").textContent);
  check("the truncated prefetch was discarded, not played", !audioEl.src.startsWith("blob:"), audioEl.src);
  check("it fell back to the normal streaming URL instead", audioEl.src.includes("files.test"), audioEl.src);

  const errors = JSON.parse(app.window.localStorage.getItem("errorLog") || "[]");
  check("no decode/playback error was logged", !errors.some((e) => /decode error|Couldn't play/.test(e.message)), errors.map((e) => e.message.slice(0, 80)).join(" | "));

  await app.stop();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL prefetch-integrity test crashed: " + (e && e.stack || e)); process.exit(1); });
