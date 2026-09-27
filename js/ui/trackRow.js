// The song row every list uses (folder view, search results, playlists, queue).

import { escapeHtml } from "../core/text.js";
import { el } from "../core/dom.js";
import { libraryArtistFor } from "../data/library.js";
import { queue, queueIndex } from "../player/player.js";
import { libraryEvents } from "./libraryWork.js";
import { enterSelectMode, selectKey, selectMode, selectedItems, setupLongPress, toggleItemSelection } from "./select.js";

// Lists stay fast: the artist line comes from the library index (the
// background artist read), never a per-row fetch. When a song's artist isn't
// known (yet, or its file has no tag) the line is simply omitted rather than
// showing a placeholder on every row.
export const EQUALIZER_ICON = `<span class="row-icon playing"><span class="bar"></span><span class="bar"></span><span class="bar"></span></span>`;

const NOTE_ICON = `<span class="row-icon">🎵</span>`;

// `selectable` opts a row into the multi-select gesture — only the main
// folder view's tracks pass this; Search results and a playlist's detail
// list render the exact same rows they always have.
export function trackRow(track, { onPlay, onMenu, selectable = false, reorderable = false }) {
  const row = document.createElement("div");
  const isPlaying = !!(queue[queueIndex] && queue[queueIndex].id === track.id);
  row.className = "row track-row" + (isPlaying ? " now-playing-row" : "");
  row.dataset.trackId = track.id;
  const artist = (track.audio && track.audio.artist) || libraryArtistFor(track.id);
  const key = selectKey("track", track.id);
  row.innerHTML = `
    <span class="row-lead">
      ${isPlaying ? EQUALIZER_ICON : NOTE_ICON}
      <span class="select-check"><span class="circle">✓</span></span>
    </span>
    <div class="row-text">
      <div class="row-name">${escapeHtml(track.name.replace(/\.[^/.]+$/, ""))}</div>
      ${artist ? `<div class="row-sub">${escapeHtml(artist)}</div>` : ""}
    </div>
    <button class="row-menu-btn">⋮</button>
    ${reorderable ? `<span class="drag-handle">☰</span>` : ""}
  `;
  if (selectable && selectedItems.has(key)) row.classList.add("selected");

  const wasLongPress = selectable ? setupLongPress(row, () => {
    if (!selectMode) enterSelectMode();
    toggleItemSelection("track", track.id, track.name, track, row);
  }) : () => false;

  row.addEventListener("click", (e) => {
    if (e.target.closest(".row-menu-btn, .drag-handle")) return;
    if (wasLongPress()) return;
    if (selectable && selectMode) {
      toggleItemSelection("track", track.id, track.name, track, row);
      return;
    }
    onPlay();
  });
  row.querySelector(".row-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    onMenu();
  });
  return row;
}

// Songs already on screen in the folder view were drawn before their artist
// was known — fill the artist line in as it arrives instead of making you
// reopen the folder.
function refreshVisibleRowArtists() {
  el.fileList.querySelectorAll(".track-row").forEach((row) => {
    if (row.querySelector(".row-sub")) return;
    const artist = libraryArtistFor(row.dataset.trackId);
    const text = row.querySelector(".row-text");
    if (artist && text) text.insertAdjacentHTML("beforeend", `<div class="row-sub">${escapeHtml(artist)}</div>`);
  });
}

libraryEvents.on("indexProgress", refreshVisibleRowArtists);

// Keeps already-rendered rows in sync when the playing track changes without
// the list itself being re-rendered (e.g. skipping next/previous while
// looking at the same folder/search results/playlist).
export function updateNowPlayingRows() {
  const currentId = queue[queueIndex] && queue[queueIndex].id;
  document.querySelectorAll(".track-row").forEach((row) => {
    const isPlaying = row.dataset.trackId === currentId;
    const wasPlaying = row.classList.contains("now-playing-row");
    if (isPlaying === wasPlaying) return;
    row.classList.toggle("now-playing-row", isPlaying);
    const icon = row.querySelector(".row-icon");
    if (icon) icon.outerHTML = isPlaying ? EQUALIZER_ICON : NOTE_ICON;
  });
}