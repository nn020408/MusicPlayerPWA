// Wires the UI to auth, the library index, playlists, and the player. This is
// the entry point (index.html loads it as an ES module); importing the feature
// modules below is what sets each one up.

import "./core/errorlog.js"; // first: wraps console.error before any other module runs
import { APP_VERSION } from "./core/config.js";
import { el } from "./core/dom.js";
import { getActiveAccount, initAuth, signIn, signOut } from "./data/auth.js";
import { clearFolderListCache } from "./data/graph.js";
import { DEFAULT_FOLDER_KEY, LIBRARY_CACHE_KEY } from "./data/library.js";
import { ensureFavoritesPlaylist } from "./data/playlists.js";
import { player, repeatMode, resetPlayer, restorePlaybackState, shuffleOn } from "./player/player.js";
import { paintFallbackArt } from "./ui/fallbackArt.js";
import { ensureLibraryLoaded, markLibraryStale } from "./ui/libraryWork.js";
import { openMainFolderView } from "./ui/folderView.js";
import { openFolderPicker } from "./ui/folderPicker.js";
import { INTRO_SEEN_KEY, showIntro } from "./ui/intro.js";
import { pushBackGuard } from "./ui/backButton.js";
import "./ui/playlists.js";
import "./ui/settings.js";
import "./ui/pullToRefresh.js";
import "./ui/errorLogView.js";
import "./ui/swipe.js";

// Shows whatever was last playing (title/artist/colorful placeholder) without
// fetching anything — no download URL, no real thumbnail/ID3 read — so
// reopening the app doesn't spend data until you actually tap play.
function showRestoredTrackDisplay(item) {
  el.nowPlayingBar.classList.remove("hidden");
  const title = item.name.replace(/\.[^/.]+$/, "");
  const artist = (item.audio && item.audio.artist) || "OneDrive";
  el.nowPlayingTitle.textContent = title;
  el.nowPlayingArtist.textContent = artist;
  el.fullTitle.textContent = title;
  el.fullArtist.textContent = artist;
  el.miniArt.classList.add("hidden");
  el.miniArtFallback.classList.remove("hidden");
  el.fullArt.classList.add("hidden");
  el.fullArtFallback.classList.remove("hidden");
  paintFallbackArt(item);
  el.miniPlayPauseBtn.textContent = "▶";
  el.fullPlayPauseBtn.textContent = "▶";
}

// ---------- Auth / boot ----------
function showApp() {
  el.loadingScreen.classList.add("hidden");
  el.loginScreen.classList.add("hidden");
  el.appScreen.classList.remove("hidden");
  pushBackGuard();

  const restoredItem = restorePlaybackState();
  if (restoredItem) showRestoredTrackDisplay(restoredItem);
  // restorePlaybackState() restores shuffleOn/repeatMode themselves, but
  // never touches the shuffle/repeat buttons — without this, a session that
  // last ended with shuffle on starts back up still shuffling internally
  // while the button shows off. Every "shuffle and play" action elsewhere
  // only calls toggleShuffle() when shuffleOn is currently false, so once
  // that mismatch exists nothing else was ever going to correct it.
  player.onShuffleRepeatChange && player.onShuffleRepeatChange(shuffleOn, repeatMode);

  const savedPath = getSavedFolderPath();
  if (!savedPath) {
    // First-time setup goes through the intro first (which itself opens the
    // folder picker once dismissed — see finishIntro()); an existing user
    // who somehow has no saved folder (e.g. cleared data) has already seen
    // it, so skip straight to the picker instead of showing it again.
    if (!localStorage.getItem(INTRO_SEEN_KEY)) {
      showIntro(true);
    } else {
      openFolderPicker("onboarding");
    }
  } else {
    openMainFolderView(savedPath);
    ensureLibraryLoaded(); // quietly builds/refreshes the search index in the background — no need to open Search first
  }
}

function getSavedFolderPath() {
  try {
    const raw = localStorage.getItem(DEFAULT_FOLDER_KEY);
    if (!raw) return null;
    let stack = JSON.parse(raw);
    if (!Array.isArray(stack) || !stack.length) return null;
    if (stack.length > 1) {
      // Self-heal old saves made before the fix above — collapses a full
      // OneDrive-root-to-folder path down to just the chosen folder, so
      // existing users don't have to pick their folder again.
      stack = [stack[stack.length - 1]];
      localStorage.setItem(DEFAULT_FOLDER_KEY, JSON.stringify(stack));
    }
    return stack;
  } catch {
    return null;
  }
}

function showLogin() {
  el.loadingScreen.classList.add("hidden");
  el.loginScreen.classList.remove("hidden");
  el.appScreen.classList.add("hidden");
}

el.signInBtn.addEventListener("click", async () => {
  try {
    await signIn();
  } catch (err) {
    console.error("Sign-in failed", err);
    return;
  }
  // Web's signIn() navigates away (MSAL loginRedirect) before this matters;
  // native has no such reload, so the app screen needs to be shown explicitly
  // — without this, sign-in would silently succeed but leave you stuck on the
  // login screen until the next manual reopen of the app.
  if (getActiveAccount()) showApp();
});

el.signOutBtn.addEventListener("click", async () => {
  if (!confirm("Sign out of NubePlayer?")) return;
  // Full clean slate — in case whoever signs in next is a different account,
  // nothing about the previous one (which folder was chosen, its cached
  // library index, in-flight Graph folder listings, the queue/mini-player)
  // should carry over. Playlists and the color theme are device/user
  // preferences, not tied to a specific signed-in account, so those are
  // deliberately left alone.
  localStorage.removeItem("lastPlaybackState");
  localStorage.removeItem(DEFAULT_FOLDER_KEY);
  localStorage.removeItem(LIBRARY_CACHE_KEY);
  clearFolderListCache();
  markLibraryStale();
  resetPlayer();
  el.nowPlayingBar.classList.add("hidden");
  // Settings (where this button lives) is a separate fixed-position overlay
  // from #app-screen — showLogin() below only hides #app-screen, so without
  // this, Settings (or any other overlay left open) would still be sitting
  // on top of everything the next time showApp() runs, making it look like
  // sign-in "took you to Settings" instead of the folder view underneath.
  el.settingsOverlay.classList.add("hidden");
  el.searchOverlay.classList.add("hidden");
  el.playlistsOverlay.classList.add("hidden");
  el.detailOverlay.classList.add("hidden");
  el.introOverlay.classList.add("hidden");
  el.fullPlayer.classList.add("hidden");
  await signOut();
  // Web's signOut() navigates away (MSAL logoutRedirect) before this matters;
  // native has no such reload, so the login screen needs to be shown explicitly
  // — without this the app just silently sat on the (now signed-out) app screen.
  showLogin();
});

ensureFavoritesPlaylist(); // local-only, no auth needed — safe before sign-in even resolves

(async function init() {
  try {
    const account = await initAuth();
    if (account) {
      showApp();
    } else {
      showLogin();
    }
  } catch (err) {
    // #loading-screen is what's visible by default now (see index.html) — a
    // rejection here with no catch would otherwise leave it showing forever
    // with no button and no way out, which is strictly worse than the old
    // default-visible login screen this replaced.
    console.error("Failed to check sign-in state", err);
    showLogin();
  }
})();

// Shown in Settings and on the login screen (el.loginVersionLabel) so a
// deploy/build can be visually confirmed instead of guessed at — same
// APP_VERSION constant on both web and native, since native has no service
// worker to ask.
el.appVersionLabel.textContent = APP_VERSION;

el.loginVersionLabel.textContent = APP_VERSION;

// Pointless inside the Capacitor app — there's nothing to cache, everything's
// already bundled locally — and Android WebView's service worker support is
// flaky enough there that registration just fails with a console warning.
if ("serviceWorker" in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform())) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}