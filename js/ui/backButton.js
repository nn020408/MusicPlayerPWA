// The Android back button (and the browser's back button): closes one layer at a
// time.

import { el } from "../core/dom.js";
import { isNative } from "../data/auth.js";
import { exitSelectMode, selectMode } from "./select.js";
import { goUpOneFolder } from "./folderView.js";
import { handleFolderPickerBack } from "./folderPicker.js";
import { handleIntroBack } from "./intro.js";
import { handleSearchBack } from "./search.js";
import { closeFullPlayer } from "./playerUI.js";

// A PWA has no built-in back-stack, so without this the hardware/gesture
// back button just exits the app immediately no matter what's open. This
// makes it behave like a normal app: close whatever's on top first, then
// step up one folder level at a time, then exit once there's nothing left.
function handleBackPress() {
  if (selectMode) {
    exitSelectMode();
    return true;
  }
  if (!el.addPlaylistModal.classList.contains("hidden")) {
    el.addPlaylistModal.classList.add("hidden");
    return true;
  }
  if (!el.playlistActionsModal.classList.contains("hidden")) {
    el.playlistActionsModal.classList.add("hidden");
    return true;
  }
  if (!el.folderActionsModal.classList.contains("hidden")) {
    el.folderActionsModal.classList.add("hidden");
    return true;
  }
  if (!el.upNextOverlay.classList.contains("hidden")) {
    // Sits above the full player (it's opened from within it) — close this
    // first so back steps out one layer at a time, same as everything else.
    el.upNextOverlay.classList.add("hidden");
    return true;
  }
  if (!el.fullPlayer.classList.contains("hidden")) {
    closeFullPlayer();
    return true;
  }
  if (!el.detailOverlay.classList.contains("hidden")) {
    el.detailOverlay.classList.add("hidden");
    return true;
  }
  if (!el.introOverlay.classList.contains("hidden")) return handleIntroBack();
  if (!el.folderPickerOverlay.classList.contains("hidden")) return handleFolderPickerBack();
  if (!el.settingsOverlay.classList.contains("hidden")) {
    el.settingsOverlay.classList.add("hidden");
    return true;
  }
  if (!el.playlistsOverlay.classList.contains("hidden")) {
    el.playlistsOverlay.classList.add("hidden");
    return true;
  }
  if (!el.searchOverlay.classList.contains("hidden")) return handleSearchBack();
  if (goUpOneFolder()) return true;
  // Nothing left to close and we're at the top of folder navigation.
  if (isNative()) {
    // Native convention: minimize like any normal Android app, rather than
    // killing the process or asking "are you sure" — there's a real task
    // switcher to bring it back from, unlike a website's back button.
    window.Capacitor.Plugins.App.minimizeApp();
    return true;
  }
  // Web has no "minimize" — this back press would actually leave the page,
  // so confirm first rather than letting one stray tap close everything.
  if (confirm("Exit NubePlayer?")) {
    return false; // let this back press go through and exit
  }
  return true; // stay — re-arm the guard for the next back press
}

// A pushState "guard" entry absorbs the back press (popstate fires without
// actually navigating anywhere); re-pushing it after handling one keeps
// absorbing back presses indefinitely until handleBackPress reports there's
// nothing left to close, at which point we stop re-pushing and the next
// back press exits the app for real.
// Only react to back presses once we've actually armed the guard ourselves —
// the Microsoft sign-in redirect can trigger a stray popstate while landing
// back on the app (before showApp() has run), which would otherwise hit the
// "nothing left to close" case and pop the exit-confirmation before the user
// has even seen the app yet.
let backGuardActive = false;

export function pushBackGuard() {
  backGuardActive = true;
  history.pushState({ musicPlayerBackGuard: true }, "");
}

// Native's hardware back button doesn't naturally fire "popstate" the way a
// real browser's back button does — @capacitor/app's own default handling
// (when nothing else listens) just tries the WebView's own goBack()/history,
// bypassing all of the above entirely. Registering our own listener hands
// every press straight to handleBackPress() instead, no indirection.
if (isNative()) {
  window.Capacitor.Plugins.App.addListener("backButton", () => handleBackPress());
} else {
  window.addEventListener("popstate", () => {
    if (!backGuardActive) return;
    if (handleBackPress()) pushBackGuard();
  });
}