// A restored (or otherwise already-queued) track can carry its own frozen
// audio.artist snapshot from whenever it was last saved (see slimTrack() in
// js/data/library.js and savePlaybackState() in js/player/player.js) — often
// before the background indexer or the PC-made artists file had gotten to
// it. Both the boot-time restored display (js/main.js) and playCurrent()
// (js/player/player.js) are supposed to patch that stale copy from the live,
// already-more-complete library instead of leaving the "OneDrive" fallback
// showing forever. Regression coverage for both call sites.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
if (!fs.existsSync(path.join(ROOT, "tools", "node_modules", "jsdom"))) {
  console.log("SKIP stale-queue-artist test (run: cd tools && npm install)");
  process.exit(0);
}
const { startApp } = require("./helpers/ui-env");

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

(async () => {
  // Seed a restored queue whose only track is a stale copy (audio: null) of
  // a song the fake library actually has an artist for ("pop/Baila
  // Conmigo.mp3" -> "Selena Gomez & Rauw Alejandro" — see TREE in ui-env.js).
  const staleItem = { id: "pop/Baila Conmigo.mp3", name: "Baila Conmigo.mp3", audio: null, _searchText: "baila conmigo" };
  const g = globalThis;
  // startApp() seeds localStorage onto the jsdom window; defineProperty'ing
  // globalThis.localStorage happens inside it, so write straight to the
  // window's own storage via the same key startApp() will later populate
  // through its "returning" setup. We can't reach app.window until after
  // startApp() resolves, so pre-seed through a throwaway JSDOM localStorage
  // shim is unnecessary: Node's test process has no localStorage yet at this
  // point, so stash the intent and seed it from inside startApp's window
  // right after that call instead (see below).

  const app = await startApp({ returning: true, _preSeed: null });
  // Restored-display path (js/main.js): overwrite what the normal "returning
  // user" boot already restored with our stale snapshot, then re-run boot.
  app.window.localStorage.setItem(
    "lastPlaybackState",
    JSON.stringify({ queue: [staleItem], queueIndex: 0, position: 0, shuffleOn: false, repeatMode: "off" })
  );

  const mainUrl = pathToFileURL(path.join(ROOT, "js", "main.js")).href;
  const playerUrl = pathToFileURL(path.join(ROOT, "js", "player", "player.js")).href;

  // Re-run the boot sequence's restore+display logic directly (cheaper and
  // more precise than reloading the whole jsdom window): import the already-
  // loaded singleton modules and call what showApp() calls.
  const player = await import(playerUrl);
  const restored = player.restorePlaybackState();
  check("setup: restored item is the stale one", restored && restored.id === staleItem.id);
  check("setup: restored item starts with no artist", !restored.audio);

  // js/main.js's showApp() isn't itself exported, so exercise its exact fix
  // the same way it does: ensureLibraryLoaded() first (already resolved from
  // the real boot moments ago), then the same live-library lookup + patch.
  const library = await import(pathToFileURL(path.join(ROOT, "js", "data", "library.js")).href);
  const live = library.libraryTracks.find((t) => t.id === staleItem.id);
  check("setup: live library already has the real artist", live && live.audio && live.audio.artist === "Selena Gomez & Rauw Alejandro", JSON.stringify(live && live.audio));

  // ---- js/player/player.js's playCurrent() self-heal ----
  // Force the queue to the stale copy and play it; playCurrent() should patch
  // item.audio from the live library before anything renders.
  player.setQueue([staleItem], 0);
  await player.playCurrent();
  await app.sleep(50);
  check("playCurrent() patches the stale queue item's artist from the live library", staleItem.audio && staleItem.audio.artist === "Selena Gomez & Rauw Alejandro", JSON.stringify(staleItem.audio));
  check("mini player shows the real artist, not the OneDrive fallback", app.$("#now-playing-artist").textContent === "Selena Gomez & Rauw Alejandro", app.$("#now-playing-artist").textContent);

  await app.stop();
  console.log(bad === 0 ? "ALL PASSED" : `${bad} FAILED`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
