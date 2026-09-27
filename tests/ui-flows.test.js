// Feature flows in the real app (jsdom, fake OneDrive, fake audio): playback,
// the full player and lyrics view, Up Next, playlists (create / add / remove),
// and restoring a backup. These are the paths where features hand work to each
// other, so they are what a refactor could quietly break.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
if (!fs.existsSync(path.join(ROOT, "tools", "node_modules", "jsdom"))) {
  console.log("SKIP ui flows test (run: cd tools && npm install)");
  process.exit(0);
}
const { startApp } = require("./helpers/ui-env");

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

(async () => {
  const app = await startApp();
  const { $, $$, sleep, window } = app;
  const hidden = (sel) => $(sel).classList.contains("hidden");
  const startedAt = new Date().toISOString();

  // ---- open the Pop folder and play its first song
  $$("#file-list .folder-row").find((r) => r.textContent.includes("Pop")).click();
  await sleep(300);
  const rows = $$("#file-list .track-row");
  check("flows: Pop folder lists its 3 songs", rows.length === 3, rows.length + " rows");
  rows[0].click();
  await sleep(400);
  check("flows/player: tapping a song shows the mini player with its name", !hidden("#now-playing-bar") && $("#now-playing-title").textContent.includes("Baila Conmigo"), $("#now-playing-title").textContent); // songs are listed alphabetically
  check("flows/player: it is playing", !window.document.body.classList.contains("audio-paused"));
  $("#mini-play-pause-btn").click();
  await sleep(200);
  check("flows/player: pause works", window.document.body.classList.contains("audio-paused"));
  $("#mini-play-pause-btn").click();
  await sleep(200);
  check("flows/player: resume works", !window.document.body.classList.contains("audio-paused"));
  $("#mini-next-btn").click();
  await sleep(400);
  check("flows/player: next goes to the next song", $("#now-playing-title").textContent.includes("Hips Don't Lie"), $("#now-playing-title").textContent);
  check("flows/player: the playing row is marked in the list", $$("#file-list .now-playing-row").length === 1);

  // ---- full player, lyrics view, Up Next
  $("#now-playing-bar .np-title").click();
  await sleep(200);
  check("flows/full player: opens", !hidden("#full-player"));
  $("#lyrics-btn").click();
  await sleep(400);
  check("flows/lyrics: the lyrics panel replaces the album art", !hidden("#lyrics-panel") && $(".full-player-art").classList.contains("hidden"));
  $("#up-next-btn").click();
  await sleep(200);
  check("flows/up next: opens and shows the current song", !hidden("#up-next-overlay") && $("#up-next-now-row").textContent.includes("Hips Don't Lie"));
  $("#up-next-close-btn").click();
  $("#full-player-close-btn").click();
  await sleep(200);
  check("flows/full player: closing it leaves lyrics view (reopens on the art)", hidden("#full-player") && hidden("#lyrics-panel") && !$(".full-player-art").classList.contains("hidden"));

  // ---- playlists: create one from the add-to-playlist dialog, then open and edit it
  $("#now-playing-bar .np-title").click();
  $("#add-to-playlist-btn").click();
  await sleep(100);
  check("flows/playlists: the add-to-playlist dialog opens", !hidden("#add-playlist-modal"));
  window.prompt = () => "Road Trip";
  globalThis.prompt = window.prompt;
  $("#add-playlist-new-btn").click();
  await sleep(200);
  const saved = JSON.parse(window.localStorage.getItem("playlists") || "[]");
  const trip = saved.find((p) => p.name === "Road Trip");
  check("flows/playlists: a new playlist was created holding the song", !!trip && trip.tracks.length === 1 && trip.tracks[0].name.includes("Hips Don't Lie"), JSON.stringify(saved.map((p) => p.name + ":" + p.tracks.length)));
  $("#full-player-close-btn").click();

  $("#playlists-btn").click();
  await sleep(150);
  const tripRow = $$("#playlists-list .row").find((r) => r.textContent.includes("Road Trip"));
  check("flows/playlists: the playlists screen lists it with 1 song", !!tripRow && /1 song\b/.test(tripRow.textContent));
  tripRow.click();
  await sleep(150);
  check("flows/playlists: opening it shows its song", !hidden("#detail-overlay") && $$("#detail-list .track-row").length === 1);
  $("#detail-list .track-row .row-menu-btn").click(); // for a playlist the menu removes the song
  await sleep(200);
  check("flows/playlists: removing the song empties the list", $$("#detail-list .track-row").length === 0 && /No songs/.test($("#detail-list").textContent));
  const tripRow2 = $$("#playlists-list .row").find((r) => r.textContent.includes("Road Trip"));
  check("flows/playlists: the playlists screen behind it updated to 0 songs", !!tripRow2 && /0 songs/.test(tripRow2.textContent), tripRow2 && tripRow2.textContent.replace(/\s+/g, " ").trim());
  $("#detail-back-btn").click();
  $("#playlists-close-btn").click();

  // ---- restore a backup file from Settings
  $("#settings-btn").click();
  const backup = { playlists: [{ id: "restored-1", name: "From Backup", tracks: [] }], libraryCache: JSON.parse(window.localStorage.getItem("libraryIndexCache")) };
  const input = $("#restore-file-input");
  Object.defineProperty(input, "files", { value: [new window.File([JSON.stringify(backup)], "backup.json", { type: "application/json" })], configurable: true });
  $("#restore-btn").click();
  input.dispatchEvent(new window.Event("change"));
  await sleep(500);
  check("flows/backup: restoring adds the playlists", JSON.parse(window.localStorage.getItem("playlists")).some((p) => p.name === "From Backup"));
  check("flows/backup: restoring swaps the library in and says so", /Restored — 11 songs|Artists ready — all 11 songs/.test($("#scan-status").textContent), $("#scan-status").textContent);
  $("#settings-close-btn").click();

  const errors = JSON.parse(window.localStorage.getItem("errorLog") || "[]").filter((e) => e.time >= startedAt);
  check("flows: nothing was written to the error log", errors.length === 0, errors.map((e) => e.message.slice(0, 100)).join(" | "));
  await app.stop();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL ui flows crashed: " + (e && e.stack || e)); process.exit(1); });
