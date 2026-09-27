// A brand-new install in the real app (jsdom, fake OneDrive): the welcome guide,
// restoring a backup from it, choosing the music folder, and how the Android
// back button behaves while setup is mandatory. This is the path where the
// intro, backup and folder-picker features hand over to each other.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
if (!fs.existsSync(path.join(ROOT, "tools", "node_modules", "jsdom"))) {
  console.log("SKIP onboarding test (run: cd tools && npm install)");
  process.exit(0);
}
const { startApp } = require("./helpers/ui-env");

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

(async () => {
  const app = await startApp({ returning: false });
  const { $, $$, sleep, window } = app;
  const hidden = (sel) => $(sel).classList.contains("hidden");
  const back = async () => { window.dispatchEvent(new window.PopStateEvent("popstate")); await sleep(80); };
  const panelShown = () => $$("#intro-panels .intro-panel").findIndex((p) => !p.classList.contains("hidden"));
  const startedAt = new Date().toISOString();

  check("onboarding: a new install starts on the welcome guide", !hidden("#intro-overlay") && panelShown() === 0);
  await back();
  check("onboarding: BACK on the first page does not dismiss the mandatory guide", !hidden("#intro-overlay"));
  $("#intro-next-btn").click();
  $("#intro-next-btn").click();
  check("onboarding: Next moves through the pages", panelShown() === 2, "page " + panelShown());
  await back();
  check("onboarding: BACK steps back a page", panelShown() === 1 && !hidden("#intro-overlay"), "page " + panelShown());
  $("#intro-next-btn").click();
  $("#intro-next-btn").click();
  check("onboarding: the last page offers restoring a backup", panelShown() === 3 && !!$("#intro-restore-btn"));

  // restore a backup from the guide: on success it carries on into the folder picker
  const backup = { playlists: [{ id: "old-1", name: "My Old Playlist", tracks: [] }] };
  const input = $("#restore-file-input");
  Object.defineProperty(input, "files", { value: [new window.File([JSON.stringify(backup)], "backup.json", { type: "application/json" })], configurable: true });
  $("#intro-restore-btn").click();
  input.dispatchEvent(new window.Event("change"));
  await sleep(500);
  check("onboarding: restoring from the guide restores the playlists", JSON.parse(window.localStorage.getItem("playlists")).some((p) => p.name === "My Old Playlist"));
  check("onboarding: ...then the guide closes and the folder picker opens", hidden("#intro-overlay") && !hidden("#folder-picker-overlay"));
  check("onboarding: the picker is mandatory (no Cancel button)", $("#folder-picker-cancel-btn").classList.contains("hidden"));

  // choose a folder
  await sleep(300);
  const rows = $$("#fp-file-list .folder-row");
  check("onboarding: the picker lists OneDrive's folders", rows.length === 3, rows.map((r) => r.textContent.trim()).join(", "));
  await back();
  check("onboarding: BACK at the picker's top does not close it", !hidden("#folder-picker-overlay"));
  rows.find((r) => r.textContent.includes("Rock")).click();
  await sleep(300);
  check("onboarding: opening a folder shows its subfolders and updates the path", /Rock/.test($("#fp-breadcrumb").textContent) && $$("#fp-file-list .folder-row").length === 1);
  await back();
  await sleep(200);
  check("onboarding: BACK goes up one level inside the picker", !/Rock/.test($("#fp-breadcrumb").textContent) && !hidden("#folder-picker-overlay"));
  $$("#fp-file-list .folder-row").find((r) => r.textContent.includes("Pop")).click();
  await sleep(300);
  $("#fp-use-here-btn").click();
  await sleep(600);
  check("onboarding: 'Use this folder' closes the picker and shows that folder", hidden("#folder-picker-overlay") && $$("#file-list .track-row").length === 3, $("#breadcrumb").textContent.replace(/\s+/g, " ").trim());
  check("onboarding: the choice is remembered", JSON.parse(window.localStorage.getItem("defaultFolderPath")).some((f) => f.name === "Pop"));
  check("onboarding: the welcome guide is marked as seen", window.localStorage.getItem("introSeenV1") === "1");
  await sleep(700);
  const cache = JSON.parse(window.localStorage.getItem("libraryIndexCache") || "null");
  check("onboarding: the library of that folder was scanned in the background", !!cache && cache.tracks.length === 3, cache ? cache.tracks.length + " songs" : "no cache");

  const errors = JSON.parse(window.localStorage.getItem("errorLog") || "[]").filter((e) => e.time >= startedAt);
  check("onboarding: nothing was written to the error log", errors.length === 0, errors.map((e) => e.message.slice(0, 100)).join(" | "));
  await app.stop();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL onboarding test crashed: " + (e && e.stack || e)); process.exit(1); });
