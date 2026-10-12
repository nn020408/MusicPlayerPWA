// Settings: a short list of categories (Library, Appearance, Backup, Help,
// Account) — each opens its own screen below, so Settings itself stays a
// quick scan instead of one long page of every control at once.

import { el } from "../core/dom.js";
import { getLibraryRootLabel, resetLibrary } from "../data/library.js";
import { isLibraryWorkActive, resetIndexState } from "../data/indexer.js";
import { showToast } from "./toast.js";
import { libraryEvents, markLibraryStale, rescanLibrary, stopLibraryWorkAndWait, updateRescanButtonUI } from "./libraryWork.js";
import { openFolderPicker } from "./folderPicker.js";
import { renderThemeList } from "./themes.js";

el.settingsBtn.addEventListener("click", () => el.settingsOverlay.classList.remove("hidden"));

el.settingsCloseBtn.addEventListener("click", () => el.settingsOverlay.classList.add("hidden"));

// Each category: the row that opens it, the screen it opens, and what (if
// anything) that screen needs refreshed right before it's shown — e.g.
// Library's scan status or Appearance's theme list, which can have changed
// since the last time this category was open.
const CATEGORIES = [
  { btn: "settingsLibraryBtn", overlay: "settingsLibraryOverlay", backBtn: "settingsLibraryBackBtn", onOpen: () => { el.libraryRootLabel.textContent = getLibraryRootLabel(); updateRescanButtonUI(); } },
  { btn: "settingsAppearanceBtn", overlay: "settingsAppearanceOverlay", backBtn: "settingsAppearanceBackBtn", onOpen: renderThemeList },
  { btn: "settingsBackupBtn", overlay: "settingsBackupOverlay", backBtn: "settingsBackupBackBtn" },
  { btn: "settingsHelpBtn", overlay: "settingsHelpOverlay", backBtn: "settingsHelpBackBtn" },
  { btn: "settingsAccountBtn", overlay: "settingsAccountOverlay", backBtn: "settingsAccountBackBtn" },
];

for (const { btn, overlay, backBtn, onOpen } of CATEGORIES) {
  el[btn].addEventListener("click", () => {
    onOpen && onOpen();
    el.settingsOverlay.classList.add("hidden");
    el[overlay].classList.remove("hidden");
  });
  el[backBtn].addEventListener("click", () => {
    el[overlay].classList.add("hidden");
    el.settingsOverlay.classList.remove("hidden");
  });
}

// The mini player floats above every overlay (z-index) and covered the
// bottom of Settings and its category screens. Watching every one of their
// classes means every way of closing any of them (Close, Back, Android back,
// opening another screen from one) restores the player without each path
// having to remember to.
const settingsOverlays = [el.settingsOverlay, el.settingsLibraryOverlay, el.settingsAppearanceOverlay, el.settingsBackupOverlay, el.settingsHelpOverlay, el.settingsAccountOverlay];
function updateSettingsOpenClass() {
  document.body.classList.toggle("settings-open", settingsOverlays.some((o) => !o.classList.contains("hidden")));
}
const settingsObserver = new MutationObserver(updateSettingsOpenClass);
settingsOverlays.forEach((o) => settingsObserver.observe(o, { attributes: true, attributeFilter: ["class"] }));

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
  el.settingsLibraryOverlay.classList.add("hidden");
  el.settingsOverlay.classList.add("hidden");
  openFolderPicker("change");
});
