// The Settings screen's buttons: change folder, rescan, reset, and
// showing/hiding the screen.

import { el } from "../core/dom.js";
import { getLibraryRootLabel, resetLibrary } from "../data/library.js";
import { isLibraryWorkActive, resetIndexState } from "../data/indexer.js";
import { showToast } from "./toast.js";
import { libraryEvents, markLibraryStale, rescanLibrary, stopLibraryWorkAndWait, updateRescanButtonUI } from "./libraryWork.js";
import { openFolderPicker } from "./folderPicker.js";
import { renderThemeList } from "./themes.js";

el.settingsBtn.addEventListener("click", () => {
  el.libraryRootLabel.textContent = getLibraryRootLabel();
  // Don't clear scanStatus here — it already reflects reality (blank if
  // never scanned, live progress if scanning, or the "Done" summary), and
  // wiping it was erasing the auto-scan's result the moment you opened
  // Settings to go check it.
  renderThemeList();
  updateRescanButtonUI(); // reflects a pass that's been running since before Settings was opened
  el.settingsOverlay.classList.remove("hidden");
});

el.settingsCloseBtn.addEventListener("click", () => el.settingsOverlay.classList.add("hidden"));

// The mini player floats above every overlay (z-index) and covered the bottom of
// Settings. Watching the overlay's own class means every way of closing it
// (Close button, Android back, opening another screen from it) restores the
// player without each path having to remember to.
new MutationObserver(() => {
  document.body.classList.toggle("settings-open", !el.settingsOverlay.classList.contains("hidden"));
}).observe(el.settingsOverlay, { attributes: true, attributeFilter: ["class"] });

// Unlike "Rescan library" (which keeps every artist already read, so adding a
// few songs doesn't redo the whole job), this throws all of it away and starts
// over: a fresh folder scan, then reading every artist again.
el.resetLibraryBtn.addEventListener("click", async () => {
  const ok = confirm(
    "Erase the scanned library and all artist names read so far, and start again from zero?\n\nYour playlists, backup files and chosen music folder are not affected. The song scan is quick; reading artist names takes a few minutes."
  );
  if (!ok) return;
  await stopLibraryWorkAndWait();
  resetLibrary();
  resetIndexState();
  markLibraryStale({ forgetLoad: true });
  el.scanStatus.textContent = "";
  libraryEvents.emit("reset");
  showToast("Starting from zero…");
  rescanLibrary(); // scans from nothing, then kicks off artist indexing when done
});

el.rescanLibraryBtn.addEventListener("click", () => {
  // Same button doubles as Stop while something's already running — see
  // updateRescanButtonUI(). stopLibraryWorkAndWait() (called from within
  // rescanLibrary() itself too) is what actually does the cancelling; this
  // branch just covers tapping Stop with no rescan intended to follow it.
  if (isLibraryWorkActive()) {
    showToast("Stopping…");
    stopLibraryWorkAndWait().then(updateRescanButtonUI);
    return;
  }
  rescanLibrary();
});

el.changeFolderBtn.addEventListener("click", () => {
  el.settingsOverlay.classList.add("hidden");
  openFolderPicker("change");
});