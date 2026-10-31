// Deleting a song from OneDrive itself (the ⋮ menu's "Delete from OneDrive",
// and the full player's trash icon): asks first, calls Graph's DELETE, drops
// it from the library cache and every playlist, and if it was playing moves
// on — same recovery path as a song OneDrive already reports gone (404).
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
if (!fs.existsSync(path.join(ROOT, "tools", "node_modules", "jsdom"))) {
  console.log("SKIP delete-track test (run: cd tools && npm install)");
  process.exit(0);
}
const { startApp, FAIL_DELETE, DELETED } = require("./helpers/ui-env");

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

(async () => {
  const app = await startApp();
  const { $, $$, sleep, window } = app;
  const titles = () => JSON.parse(window.localStorage.getItem("libraryIndexCache")).tracks.map((t) => t.name);
  const hidden = (sel) => $(sel).classList.contains("hidden");

  const setInput = (sel, value) => {
    $(sel).value = value;
    $(sel).dispatchEvent(new window.Event("input"));
  };

  // Assumes a delete trigger (the ⋮ menu's Delete, or the full player's
  // trash icon) was just clicked, opening the delete-confirm dialog (see
  // trackActions.js). Reads the random code it shows, types the wrong thing
  // first to confirm that's rejected, then types the real code and confirms.
  const confirmDelete = async () => {
    await sleep(50);
    const code = $("#delete-confirm-code").textContent;
    check("a 2-digit code is shown", /^\d{2}$/.test(code), code);
    $("#delete-confirm-btn").click(); // disabled -- a browser no-ops a click on a disabled button
    await sleep(50);
    check("delete stays blocked with nothing typed", !hidden("#delete-confirm-modal"));
    setInput("#delete-confirm-input", code === "00" ? "01" : "00"); // deliberately wrong
    check("the wrong code leaves it disabled", $("#delete-confirm-btn").disabled);
    setInput("#delete-confirm-input", code);
    check("the right code enables it", !$("#delete-confirm-btn").disabled);
    $("#delete-confirm-btn").click();
  };

  // ---- the menu, and cancelling out of it changes nothing
  $$("#file-list .folder-row").find((r) => r.textContent.includes("Pop")).click();
  await sleep(300);
  $$("#file-list .track-row").find((r) => r.textContent.includes("Who Knew")).querySelector(".row-menu-btn").click();
  await sleep(100);
  check("the menu offers Delete from OneDrive", !hidden("#track-actions-modal") && !hidden("#track-delete-btn"));
  check("no playlist to remove from here, so that option stays hidden", hidden("#track-remove-playlist-btn"));
  $("#track-actions-cancel-btn").click();
  check("cancel just closes the menu", hidden("#track-actions-modal") && titles().includes("Who Knew.mp3"));

  // ---- cancelling the delete-confirm dialog itself also changes nothing
  $$("#file-list .track-row").find((r) => r.textContent.includes("Who Knew")).querySelector(".row-menu-btn").click();
  await sleep(50);
  $("#track-delete-btn").click();
  await sleep(50);
  check("the delete-confirm dialog opens, button starts disabled", !hidden("#delete-confirm-modal") && $("#delete-confirm-btn").disabled);
  $("#delete-confirm-cancel-btn").click();
  await sleep(50);
  check("cancelling it closes the dialog and deletes nothing", hidden("#delete-confirm-modal") && titles().includes("Who Knew.mp3"));

  // ---- a failed delete (e.g. no permission) leaves everything as it was
  FAIL_DELETE.add("pop/Who Knew.mp3");
  $$("#file-list .track-row").find((r) => r.textContent.includes("Who Knew")).querySelector(".row-menu-btn").click();
  await sleep(50);
  $("#track-delete-btn").click();
  await confirmDelete();
  await sleep(200);
  check("a failed delete says so", /Couldn't delete "Who Knew"/.test($("#toast").textContent), $("#toast").textContent);
  check("a failed delete doesn't touch the library", titles().includes("Who Knew.mp3"));
  check("a failed delete leaves the row in the folder", !!$$("#file-list .track-row").find((r) => r.textContent.includes("Who Knew")));
  FAIL_DELETE.delete("pop/Who Knew.mp3");

  // ---- a real delete: Graph gets the DELETE, the library and the row both drop it
  $$("#file-list .track-row").find((r) => r.textContent.includes("Who Knew")).querySelector(".row-menu-btn").click();
  await sleep(50);
  $("#track-delete-btn").click();
  await confirmDelete();
  await sleep(300);
  check("Graph got the delete request", DELETED.includes("pop/Who Knew.mp3"), DELETED.join(","));
  check("the song is dropped from the library cache", !titles().includes("Who Knew.mp3"));
  check("the other songs in the folder stay", titles().includes("Hips Don't Lie.mp3") && titles().includes("Baila Conmigo.mp3"));
  check("its row disappears from the folder view", !$$("#file-list .track-row").find((r) => r.textContent.includes("Who Knew")));
  check("a toast confirms the delete", /Deleted "Who Knew"/.test($("#toast").textContent));

  // ---- deleting the song currently playing moves on, via the full player's trash icon
  // (picks the one NOT last in the (now 2-song, alphabetical) folder queue —
  // playNext() deliberately doesn't wrap at the end with repeat off, same as
  // the dead-file/404 path it shares, so deleting the last song wouldn't
  // advance anywhere and this check would be testing the wrong thing)
  $$("#file-list .track-row").find((r) => r.textContent.includes("Baila Conmigo")).click();
  await sleep(300);
  check("setup: Baila Conmigo is now playing", /Baila Conmigo/.test($("#now-playing-title").textContent));
  $("#now-playing-bar .np-title").click();
  await sleep(100);
  $("#full-player-delete-btn").click();
  await confirmDelete();
  await sleep(300);
  check("deleting the playing song moves on to another one", /Hips Don't Lie/.test($("#now-playing-title").textContent), $("#now-playing-title").textContent);
  check("it's gone from the library cache too", !titles().includes("Baila Conmigo.mp3"));
  check("its row also disappears from the folder view sitting underneath the full player", !$$("#file-list .track-row").find((r) => r.textContent.includes("Baila Conmigo")));

  // ---- deleting a song also drops it from any playlist it was added to
  $("#full-player-close-btn").click();
  $$("#breadcrumb .crumb")[0].click(); // back to the library root
  await sleep(200);
  $$("#file-list .folder-row").find((r) => r.textContent.includes("Salsa")).click();
  await sleep(300);
  $$("#file-list .track-row").find((r) => r.textContent.includes("Pedro Navaja")).querySelector(".row-menu-btn").click();
  await sleep(50);
  $("#track-add-playlist-btn").click();
  await sleep(50);
  window.prompt = () => "Road Trip";
  globalThis.prompt = window.prompt;
  $("#add-playlist-new-btn").click();
  await sleep(100);
  const beforeDelete = JSON.parse(window.localStorage.getItem("playlists") || "[]").find((p) => p.name === "Road Trip");
  check("setup: the song was added to a playlist", !!beforeDelete && beforeDelete.tracks.some((t) => t.name === "Pedro Navaja.mp3"));
  $$("#file-list .track-row").find((r) => r.textContent.includes("Pedro Navaja")).querySelector(".row-menu-btn").click();
  await sleep(50);
  $("#track-delete-btn").click();
  await confirmDelete();
  await sleep(300);
  const afterDelete = JSON.parse(window.localStorage.getItem("playlists") || "[]").find((p) => p.name === "Road Trip");
  check("deleting it drops it from the playlist too", !!afterDelete && !afterDelete.tracks.some((t) => t.name === "Pedro Navaja.mp3"), JSON.stringify(afterDelete && afterDelete.tracks));

  // ---- deleting the only song in a one-song folder (nothing to advance to,
  // repeat off) stops playback outright instead of leaving the just-deleted
  // file running -- confirmed on-device as a real bug without this: native
  // just advances its queue pointer, and with nothing after it, leaves
  // whatever was already playing untouched.
  $$("#breadcrumb .crumb")[0].click();
  await sleep(200);
  $$("#file-list .folder-row").find((r) => r.textContent.includes("Rock")).click();
  await sleep(300);
  $$("#file-list .folder-row").find((r) => r.textContent.includes("Live")).click();
  await sleep(300);
  $$("#file-list .track-row").find((r) => r.textContent.includes("Yesterday")).click();
  await sleep(300);
  check("setup: Yesterday (Live) is now playing, alone in its folder", /Yesterday/.test($("#now-playing-title").textContent));
  $("#now-playing-bar .np-title").click();
  await sleep(100);
  $("#full-player-delete-btn").click();
  await confirmDelete();
  await sleep(300);
  check("playback stops outright instead of leaving the deleted song running", hidden("#now-playing-bar"));
  check("it's gone from the library cache", !titles().includes("Yesterday (Live).mp3"));

  await app.stop();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL delete-track test crashed: " + (e && e.stack || e)); process.exit(1); });
