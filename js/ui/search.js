// Search: songs and artists in one box, grouped like Spotify, plus the Artists
// view.

import { escapeHtml } from "../core/text.js";
import { el } from "../core/dom.js";
import { getArtists, searchArtists, searchLibrary, songsByArtistKey } from "../data/library.js";
import { indexCounts, isIndexing } from "../data/indexer.js";
import { playCurrent, setQueue } from "../player/player.js";
import { ensureLibraryLoaded, indexState, kickOffIndexing, libraryEvents, libraryLoaded } from "./libraryWork.js";
import { openAddToPlaylistModal } from "./addToPlaylist.js";
import { trackRow } from "./trackRow.js";
import { openDetailList } from "./detailOverlay.js";

// One box matches song name and artist (accent-insensitive, any word order).
// Results come in sections: matching artists first, then songs. With nothing
// typed, the Artists view is one tap away, with an honest indexing progress
// line while artist names are still being read in the background.
const SEARCH_SONG_LIMIT = 200;

let searchView = "home";

 // home | artists | results — what "Refresh" should redraw

el.searchBtn.addEventListener("click", async () => {
  el.searchOverlay.classList.remove("hidden");
  el.searchInput.value = "";
  el.searchResults.innerHTML = "";
  el.searchInput.focus();
  if (!libraryLoaded) {
    // rescanLibrary()'s onProgress (via setScanProgressUI) takes over showing
    // live progress here now, same text as Settings, since the overlay is open.
    await ensureLibraryLoaded();
  }
  if (libraryLoaded && !el.searchInput.value.trim()) renderSearchHome();
});

el.searchCloseBtn.addEventListener("click", () => el.searchOverlay.classList.add("hidden"));

let searchDebounceTimer = null;

el.searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(runSearch, 150);
});

// Shown above search home / the Artists view / results while indexing isn't
// finished. Empty string (and the element hides itself via :empty) once every
// song has been read.
function indexBannerHtml() {
  const { done, total } = indexCounts();
  if (!total || done >= total) return "";
  const pct = Math.round((done / total) * 100);
  const nums = `${done.toLocaleString()} of ${total.toLocaleString()} songs (${pct}%)`;
  if (isIndexing) {
    const pause = indexState === "throttled" ? " (easing off for a moment, OneDrive pushed back)" : "";
    return `Reading artist names… ${nums}${pause} <button class="text-btn accent" data-act="refresh">Refresh</button>`;
  }
  return `Artist indexing paused: ${nums} <button class="text-btn accent" data-act="resume">Resume</button>`;
}

function updateIndexBanner() {
  const banner = document.getElementById("index-banner");
  if (banner) banner.innerHTML = indexBannerHtml();
}

libraryEvents.on("indexProgress", updateIndexBanner);

libraryEvents.on("scanned", () => {
  if (!el.searchOverlay.classList.contains("hidden") && !el.searchInput.value.trim()) renderSearchHome();
});

libraryEvents.on("scanFailed", () => {
  if (!el.searchOverlay.classList.contains("hidden") && !el.searchInput.value.trim()) {
    el.searchResults.innerHTML = `<p class="status-msg">Couldn't finish scanning your library.</p>`;
  }
});

libraryEvents.on("reset", () => {
  if (!el.searchOverlay.classList.contains("hidden")) el.searchResults.innerHTML = "";
});

function artistRowHtml(a) {
  return `<div class="row" data-artist-key="${encodeURIComponent(a.key)}">
    <span class="row-icon">🎤</span>
    <div class="row-text"><div class="row-name">${escapeHtml(a.name)}</div><div class="row-sub">${a.count} song${a.count === 1 ? "" : "s"}</div></div>
  </div>`;
}

function renderSearchHome() {
  searchView = "home";
  const n = getArtists().length;
  const sub = n ? `${n.toLocaleString()} artist${n === 1 ? "" : "s"}` : "Filling in as songs are read";
  el.searchResults.innerHTML = `<div id="index-banner" class="index-banner">${indexBannerHtml()}</div>
    <div class="row" data-act="artists">
      <span class="row-icon">🎤</span>
      <div class="row-text"><div class="row-name">Artists</div><div class="row-sub">${sub}</div></div>
    </div>`;
}

// Android back while Search is open: the Artists view is one level inside
// Search, so step back out of it first.
export function handleSearchBack() {
  if (searchView === "artists") {
    renderSearchHome();
    return true;
  }
  el.searchOverlay.classList.add("hidden");
  return true;
}

function renderArtistsView() {
  searchView = "artists";
  const artists = getArtists();
  el.searchResults.innerHTML = `<div class="toolbar"><button class="text-btn" data-act="back">‹ Back</button></div>
    <div id="index-banner" class="index-banner">${indexBannerHtml()}</div>
    ${artists.length ? artists.map(artistRowHtml).join("") : `<p class="status-msg">No artists yet. They appear as songs are read.</p>`}`;
  el.searchResults.scrollTop = 0;
}

function openArtist(key) {
  const artist = getArtists().find((a) => a.key === key);
  openDetailList(artist ? artist.name : key, songsByArtistKey(key));
}

// One listener for everything in the results pane that isn't a song row
// (song rows carry their own handlers from trackRow()).
el.searchResults.addEventListener("click", (e) => {
  const target = e.target.closest("[data-act], [data-artist-key]");
  if (!target) return;
  if (target.dataset.artistKey) {
    openArtist(decodeURIComponent(target.dataset.artistKey));
    return;
  }
  const act = target.dataset.act;
  if (act === "artists") renderArtistsView();
  else if (act === "back") renderSearchHome();
  else if (act === "resume") kickOffIndexing(true);
  else if (act === "refresh") {
    if (searchView === "artists") renderArtistsView();
    else if (searchView === "home") renderSearchHome();
    else runSearch();
  }
});

function runSearch() {
  const query = el.searchInput.value;
  if (!query.trim()) {
    if (libraryLoaded) renderSearchHome();
    else el.searchResults.innerHTML = "";
    return;
  }
  searchView = "results";
  const artists = searchArtists(query).slice(0, 5);
  const songs = searchLibrary(query);
  const { done, total } = indexCounts();
  el.searchResults.innerHTML = "";

  if (total > 0 && done < total) {
    el.searchResults.insertAdjacentHTML(
      "beforeend",
      `<div id="index-banner" class="index-banner">Artist info is still loading (${done.toLocaleString()} of ${total.toLocaleString()} songs), so artist results may be incomplete. <button class="text-btn accent" data-act="refresh">Search again</button></div>`
    );
  }
  if (!artists.length && !songs.length) {
    el.searchResults.insertAdjacentHTML("beforeend", `<p class="status-msg">No matches.</p>`);
    return;
  }
  if (artists.length) {
    el.searchResults.insertAdjacentHTML("beforeend", `<div class="section-title">Artists</div>${artists.map(artistRowHtml).join("")}`);
  }
  if (songs.length) {
    el.searchResults.insertAdjacentHTML("beforeend", `<div class="section-title">Songs (${songs.length.toLocaleString()})</div>`);
    songs.slice(0, SEARCH_SONG_LIMIT).forEach((track, index) => {
      el.searchResults.appendChild(
        trackRow(track, {
          onPlay: () => {
            setQueue(songs, index);
            playCurrent();
          },
          onMenu: () => openAddToPlaylistModal(track),
        })
      );
    });
    if (songs.length > SEARCH_SONG_LIMIT) {
      el.searchResults.insertAdjacentHTML("beforeend", `<p class="status-msg">Showing the first ${SEARCH_SONG_LIMIT} songs. Type more to narrow it down.</p>`);
    }
  }
}