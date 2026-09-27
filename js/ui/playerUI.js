// The player screens: mini player, full player, artwork, and how they react to
// what the player reports.

import { el } from "../core/dom.js";
import { formatTime } from "../core/text.js";
import { findOnlineArtwork } from "../data/artwork.js";
import { getThumbnailUrl } from "../data/graph.js";
import { audioEl, currentTrack, cycleRepeat, player, playNext, playPause, playPrevious, seekTo, toggleShuffle } from "../player/player.js";
import { openAddToPlaylistModal } from "./addToPlaylist.js";
import { paintFallbackArt } from "./fallbackArt.js";
import { closeLyricsView, lyricsViewActive, provideRealTags, showLyricsForCurrentTrack, startTrackTags, updateActiveLyricsLine } from "./lyrics.js";
import { hideToast, showToast } from "./toast.js";
import { updateNowPlayingRows } from "./trackRow.js";
import { openUpNextView } from "./upNext.js";

// Only tried once neither OneDrive's thumbnail nor the file's own embedded
// picture panned out — a fixed delay rather than precisely sequencing two
// independent async checks, since both normally settle well within this.
function applyRealArt(url) {
  el.miniArt.src = url;
  el.miniArt.classList.remove("hidden");
  el.miniArtFallback.classList.add("hidden");
  el.fullArt.src = url;
  el.fullArt.classList.remove("hidden");
  el.fullArtFallback.classList.add("hidden");
}

// Skips a same-folder cover image on purpose — that was tried and dropped
// (a folder mixing multiple artists/albums means "some image in this
// folder" is often the WRONG cover, not a good guess).
async function tryOnlineArtFallback(item) {
  if (currentTrack() !== item) return; // track changed since this was scheduled
  // Check what's actually on screen, not just whether OneDrive claimed to
  // have a thumbnail — a "found" thumbnail URL can still fail to load (that's
  // exactly why the error-fallback exists), so trusting that flag here was
  // skipping this check even when nothing had actually loaded.
  if (!el.fullArt.classList.contains("hidden")) return; // real art is genuinely showing

  const title = item.name.replace(/\.[^/.]+$/, "");
  const artist = (item.audio && item.audio.artist) || "";
  try {
    const url = await findOnlineArtwork(title, artist);
    if (url && currentTrack() === item) {
      applyRealArt(url);
    }
  } catch (err) {
    console.error("Online art lookup failed", err);
  }
}

// Retriggers the CSS swap animation even on rapid consecutive track changes
// (e.g. spamming next/previous) — same remove/reflow/re-add trick as
// pulsePress(), since simply re-adding an already-present class wouldn't
// restart a CSS animation.
function pulseArtSwap(el) {
  el.classList.remove("art-swap-in");
  void el.offsetWidth;
  el.classList.add("art-swap-in");
}

player.onTrackChange = (item) => {
  el.nowPlayingBar.classList.remove("hidden");
  pulseArtSwap(el.npArt);
  pulseArtSwap(el.fullPlayerArt);
  const title = item.name.replace(/\.[^/.]+$/, "");
  const artist = (item.audio && item.audio.artist) || "OneDrive";
  el.nowPlayingTitle.textContent = title;
  el.nowPlayingArtist.textContent = artist;
  el.fullTitle.textContent = title;
  el.fullArtist.textContent = artist;
  updateNowPlayingRows();
  // Keeps the Up Next view honest if the track changes while it's already
  // open (e.g. skipping via the lock-screen/notification controls) — without
  // this, the overlay's DOM is left over from whenever it was last opened,
  // so the newly-current track would still show up in the reorderable
  // "Next up" list wearing the now-playing highlight instead of moving up
  // into "Now Playing" where it belongs.
  if (!el.upNextOverlay.classList.contains("hidden")) openUpNextView();
  // Cleared here, set in onRealTags below once the real embedded tag read
  // resolves for THIS track — lyrics matching prefers this over
  // item.audio.artist (see fetchLyricsResult), since that's the exact
  // title/artist actually shown on screen, not OneDrive's lighter metadata.
  startTrackTags();

  el.miniArt.classList.add("hidden");
  el.miniArtFallback.classList.remove("hidden");
  el.fullArt.classList.add("hidden");
  el.fullArtFallback.classList.remove("hidden");
  paintFallbackArt(item);
  setTimeout(() => tryOnlineArtFallback(item), 2500);

  getThumbnailUrl(item.id).then((url) => {
    if (!url || currentTrack() !== item) return;
    el.miniArt.src = url;
    el.miniArt.classList.remove("hidden");
    el.miniArtFallback.classList.add("hidden");
    el.fullArt.src = url;
    el.fullArt.classList.remove("hidden");
    el.fullArtFallback.classList.add("hidden");

    // Also show the art on the lock-screen/notification media controls.
    if ("mediaSession" in navigator && navigator.mediaSession.metadata) {
      navigator.mediaSession.metadata.artwork = [{ src: url, sizes: "512x512", type: "image/jpeg" }];
    }
  });

  // Lyrics view (if open) follows track changes rather than snapping back to
  // album art — same behavior as Spotify/Apple Music when you skip tracks
  // while reading along.
  if (lyricsViewActive) showLyricsForCurrentTrack();
};

// OneDrive's thumbnail metadata isn't always reliable (same gap we found
// with artist names) — sometimes it hands back a URL that doesn't actually
// load. Without this, a broken thumbnail would just sit there as the
// browser's native "broken image" icon instead of falling back to the
// colorful placeholder.
el.miniArt.addEventListener("error", () => {
  el.miniArt.classList.add("hidden");
  el.miniArtFallback.classList.remove("hidden");
});

el.fullArt.addEventListener("error", () => {
  el.fullArt.classList.add("hidden");
  el.fullArtFallback.classList.remove("hidden");
});

player.onPlayStateChange = (isPlaying) => {
  const symbol = isPlaying ? "⏸" : "▶";
  el.miniPlayPauseBtn.textContent = symbol;
  el.fullPlayPauseBtn.textContent = symbol;
  // Drives the equalizer-bar animation (CSS) on every "now playing" row
  // anywhere in the DOM at once — a single toggle here instead of hunting
  // down and re-rendering each row individually whenever play/pause changes.
  document.body.classList.toggle("audio-paused", !isPlaying);
};

// Toast rather than el.statusMsg (used below to be reserved for folder-load
// state) — el.statusMsg lives in the base view, underneath every overlay
// (Full Player included), so it's invisible during actual playback, which is
// exactly when this message matters. Toast is position:fixed above
// everything, so it's visible no matter what screen you're looking at.
// "Loading …" fires on every single track change (including normal
// skip/auto-advance, which is instant almost always) — toasting that too
// would pop up on every song. Only retry/error messages are worth
// interrupting for; routine loading has no toast at all.
//
// Persistent (no auto-hide) rather than a timed toast — a reconnect can take
// up to ~2 minutes across several retries, and a message that vanishes on
// its own 4-second timer partway through reads as "gave up" even though
// it's still actively retrying. It only goes away once onStatus("") fires
// (real success) or a new message replaces it.
player.onStatus = (message) => {
  if (!message) {
    hideToast();
    return;
  }
  if (message.startsWith("Loading")) return;
  showToast(message, null);
};

player.onTimeUpdate = (current, duration) => {
  el.fullCurrentTime.textContent = formatTime(current);
  el.fullDuration.textContent = formatTime(duration);
  if (duration > 0) el.fullSeekBar.value = String((current / duration) * 1000);
  if (lyricsViewActive) updateActiveLyricsLine(current);
};

player.onShuffleRepeatChange = (shuffle, repeat) => {
  el.shuffleBtn.classList.toggle("active", shuffle);
  el.repeatBtn.classList.toggle("active", repeat !== "off");
  el.repeatBtn.textContent = repeat === "one" ? "🔂" : "🔁";
};

// Real tag data read straight from the file (see id3.js) — only fires for
// whatever's currently playing, so it's safe to just overwrite the display.
player.onRealTags = (tags) => {
  if (tags.title) {
    el.nowPlayingTitle.textContent = tags.title;
    el.fullTitle.textContent = tags.title;
  }
  if (tags.artist) {
    el.nowPlayingArtist.textContent = tags.artist;
    el.fullArtist.textContent = tags.artist;
  }
  if (tags.pictureUrl) {
    el.miniArt.src = tags.pictureUrl;
    el.miniArt.classList.remove("hidden");
    el.miniArtFallback.classList.add("hidden");
    el.fullArt.src = tags.pictureUrl;
    el.fullArt.classList.remove("hidden");
    el.fullArtFallback.classList.add("hidden");
  }

  // player.js only guarantees this fires for whatever's still current, so
  // it's safe to trust currentTrack() here (see the guard in playCurrent).
  provideRealTags(tags);
};

// Restarts the CSS press animation even on rapid repeat taps (removing then
// re-adding the class in the same tick wouldn't retrigger it — the reflow
// forces the browser to notice).
function pulsePress(button) {
  button.classList.remove("btn-pressed");
  void button.offsetWidth;
  button.classList.add("btn-pressed");
}

el.miniPrevBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  pulsePress(el.miniPrevBtn);
  playPrevious();
});

el.miniPlayPauseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  playPause();
});

el.miniNextBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  pulsePress(el.miniNextBtn);
  playNext();
});

el.fullPlayPauseBtn.addEventListener("click", playPause);

// Hold-to-seek (full player only — the mini bar has no room/time context for
// scrubbing feedback, same reasoning most players use). A quick tap still
// just skips a track, matching before. While held past the threshold, it
// scrubs instead. The actual seek is deliberately stepped (every
// HOLD_SEEK_INTERVAL_MS) rather than continuous — tracks stream from a
// remote URL here, not a local file, so a real seek re-buffers over the
// network; committing on every animation frame would hammer that instead of
// feeling smooth. Only wired up if the Pointer Events API exists (it does on
// everything this app targets) — skipped harmlessly otherwise, falling back
// to plain click-to-skip via the listener below.
const HOLD_SEEK_THRESHOLD_MS = 450;

const HOLD_SEEK_STEP_SECONDS = 3;

const HOLD_SEEK_INTERVAL_MS = 300;

function wireHoldToSeek(button, direction, tapAction) {
  let holdTimer = null;
  let seekInterval = null;
  let isSeeking = false;

  function beginHold() {
    const duration = audioEl.duration;
    if (!duration || !isFinite(duration)) return; // nothing loaded to scrub through
    isSeeking = true;
    button.classList.add("btn-holding");
    seekInterval = setInterval(() => {
      const next = Math.min(Math.max(audioEl.currentTime + direction * HOLD_SEEK_STEP_SECONDS, 0), audioEl.duration || 0);
      seekTo(next);
    }, HOLD_SEEK_INTERVAL_MS);
  }

  function endHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
    clearInterval(seekInterval);
    seekInterval = null;
    if (!isSeeking) return false;
    button.classList.remove("btn-holding");
    isSeeking = false;
    return true; // was a hold-seek, not a tap
  }

  button.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(beginHold, HOLD_SEEK_THRESHOLD_MS);
  });
  button.addEventListener("pointerup", () => {
    if (!endHold()) {
      pulsePress(button);
      tapAction();
    }
  });
  button.addEventListener("pointercancel", endHold);
  button.addEventListener("pointerleave", endHold);
}

if (window.PointerEvent) {
  wireHoldToSeek(el.fullNextBtn, 1, playNext);
  wireHoldToSeek(el.fullPrevBtn, -1, playPrevious);
} else {
  el.fullNextBtn.addEventListener("click", () => {
    pulsePress(el.fullNextBtn);
    playNext();
  });
  el.fullPrevBtn.addEventListener("click", () => {
    pulsePress(el.fullPrevBtn);
    playPrevious();
  });
}

el.fullSeekBar.addEventListener("input", () => {
  const duration = audioEl.duration || 0;
  if (duration > 0) seekTo((Number(el.fullSeekBar.value) / 1000) * duration);
});

el.shuffleBtn.addEventListener("click", toggleShuffle);

el.repeatBtn.addEventListener("click", cycleRepeat);

export function openFullPlayer() {
  if (!currentTrack()) return;
  el.fullPlayer.classList.remove("hidden");
}

export function closeFullPlayer() {
  el.fullPlayer.classList.add("hidden");
  // Reopening always starts back on album art, not wherever lyrics view was
  // left — avoids surprising state the next time this is opened.
  closeLyricsView();
}

el.fullPlayerCloseBtn.addEventListener("click", closeFullPlayer);

el.addToPlaylistBtn.addEventListener("click", () => {
  const track = currentTrack();
  if (track) openAddToPlaylistModal(track);
});