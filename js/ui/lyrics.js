// The lyrics panel in the full player: shows the lyrics for the current song
// (synced lines follow the playback position). Finding them online is
// data/lyrics.js.

import { el } from "../core/dom.js";
import { folderPathOf, libraryArtistFor } from "../data/library.js";
import { getLyricsForTrack } from "../data/lyrics.js";
import { audioEl, currentTrack } from "../player/player.js";

export let lyricsViewActive = false;

let currentLyrics = null; // { plain, synced: [{time,text}]|null, instrumental } for whatever's rendered now
// The real embedded tag read (id3.js), captured in player.onRealTags below —
// this is the exact title/artist actually shown on screen, and a more
// reliable match target than item.audio (OneDrive's lighter folder-listing
// metadata, which fetchLyricsResult falls back to when this isn't set yet).
let currentRealTags = null;

// Reset per track in onTrackChange, resolved once in onRealTags — lets a
// lyrics fetch that starts before the real tag arrives wait for it once
// instead of firing again reactively when it shows up (that was the
// double-fetch/double-"Loading lyrics…" bug).
let realTagsPromise = null;

let resolveRealTagsPromise = null;

let activeLyricsLineIndex = -1;

// A new track started: forget the previous track's real tags and set up a fresh
// promise that provideRealTags() resolves — lets a lyrics fetch started before
// the real tag arrives wait for it once instead of firing twice (fetch now with
// weak data, fetch again once better data shows up).
export function startTrackTags() {
  currentRealTags = null;
  realTagsPromise = new Promise((resolve) => {
    resolveRealTagsPromise = resolve;
  });
}

// The real embedded tag read for the current track has arrived.
export function provideRealTags(tags) {
  currentRealTags = tags;
  if (resolveRealTagsPromise) {
    resolveRealTagsPromise(tags);
    resolveRealTagsPromise = null;
  }
}

// Leaves the lyrics view (closing the full player does this, so reopening it
// always starts back on the album art).
export function closeLyricsView() {
  if (!lyricsViewActive) return;
  lyricsViewActive = false;
  el.fullPlayerArt.classList.remove("hidden");
  el.lyricsPanel.classList.add("hidden");
  el.lyricsBtn.classList.remove("icon-active");
}

// Waits briefly for the real tag read to resolve (if one's in flight for the
// current track) rather than immediately settling for weaker metadata —
// bounded so a slow/failed tag read can't hang the lyrics fetch indefinitely.
function waitForRealTags(timeoutMs) {
  if (currentRealTags) return Promise.resolve(currentRealTags);
  if (!realTagsPromise) return Promise.resolve(null);
  return Promise.race([realTagsPromise, new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
}

function renderLyricsPanel(lyrics) {
  activeLyricsLineIndex = -1;
  el.lyricsPanel.innerHTML = "";
  if (lyrics.instrumental) {
    el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty">🎧 This track is instrumental — no lyrics.</p>`;
    return;
  }
  if (lyrics.synced && lyrics.synced.length) {
    lyrics.synced.forEach((line, i) => {
      const p = document.createElement("p");
      p.className = "lyrics-line";
      p.dataset.index = i;
      p.textContent = line.text || "♪";
      el.lyricsPanel.appendChild(p);
    });
    return;
  }
  if (lyrics.plain) {
    const p = document.createElement("p");
    p.className = "lyrics-plain";
    p.textContent = lyrics.plain;
    el.lyricsPanel.appendChild(p);
    return;
  }
  el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty">No lyrics found for this song.</p>`;
}

export async function showLyricsForCurrentTrack() {
  const track = currentTrack();
  if (!track) return;
  currentLyrics = null;
  el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty"><span class="spinner"></span>Loading lyrics…</p>`;
  try {
    // Prefer the real embedded tag (the exact title/artist shown on screen) over
    // OneDrive's lighter folder-listing metadata; if that read is still in flight
    // for this track, wait up to 3s for it — one fetch with the best available data.
    const lyrics = await getLyricsForTrack(track, {
      getRealTags: () => (currentTrack() === track ? waitForRealTags(3000) : Promise.resolve(null)),
      getDuration: () => Math.round(audioEl.duration) || 0,
      folderPath: () => folderPathOf(track.folderId),
      libraryArtist: () => libraryArtistFor(track.id),
    });
    if (currentTrack() !== track || !lyricsViewActive) return; // track/view changed while fetching
    currentLyrics = lyrics;
    renderLyricsPanel(lyrics);
  } catch (err) {
    if (currentTrack() !== track || !lyricsViewActive) return;
    console.error("Lyrics lookup failed", err);
    el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty">Couldn't load lyrics.</p>`;
  }
}

// Cheap linear scan (a synced lyric file is at most a couple hundred lines)
// run on the same timeupdate tick the seek bar already updates on — not a
// per-frame cost, and only does anything while the lyrics panel is open.
export function updateActiveLyricsLine(current) {
  if (!currentLyrics || !currentLyrics.synced || !currentLyrics.synced.length) return;
  const lines = currentLyrics.synced;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= current) idx = i;
    else break;
  }
  if (idx === activeLyricsLineIndex) return;
  activeLyricsLineIndex = idx;
  const prevActive = el.lyricsPanel.querySelector(".lyrics-line.active");
  if (prevActive) prevActive.classList.remove("active");
  if (idx < 0) return;
  const lineEl = el.lyricsPanel.querySelector(`.lyrics-line[data-index="${idx}"]`);
  if (lineEl) {
    lineEl.classList.add("active");
    lineEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function toggleLyricsView() {
  lyricsViewActive = !lyricsViewActive;
  el.fullPlayerArt.classList.toggle("hidden", lyricsViewActive);
  el.lyricsPanel.classList.toggle("hidden", !lyricsViewActive);
  el.lyricsBtn.classList.toggle("icon-active", lyricsViewActive);
  if (lyricsViewActive) showLyricsForCurrentTrack();
}

el.lyricsBtn.addEventListener("click", toggleLyricsView);