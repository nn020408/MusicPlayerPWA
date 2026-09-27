// The playlists screen and the rename / delete / clear menu on each playlist.

import { escapeHtml } from "../core/text.js";
import { el } from "../core/dom.js";
import { FAVORITES_PLAYLIST_ID, clearPlaylist, createPlaylist, deletePlaylist, loadPlaylists, renamePlaylist } from "../data/playlists.js";
import { openDetailList } from "./detailOverlay.js";

function renderPlaylistsList() {
  const playlists = loadPlaylists();
  el.playlistsList.innerHTML = "";
  if (playlists.length === 0) {
    el.playlistsList.innerHTML = `<p class="status-msg">No playlists yet. Tap "+ New Playlist" to create one.</p>`;
    return;
  }
  playlists.forEach((pl) => {
    const row = document.createElement("div");
    row.className = "row";
    const icon = pl.id === FAVORITES_PLAYLIST_ID ? "❤️" : "📃";
    row.innerHTML = `
      <span class="row-icon">${icon}</span>
      <div class="row-text">
        <div class="row-name">${escapeHtml(pl.name)}</div>
        <div class="row-sub">${pl.tracks.length} song${pl.tracks.length === 1 ? "" : "s"}</div>
      </div>
      <button class="row-menu-btn">⋮</button>
    `;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".row-menu-btn")) return;
      openDetailList(pl.name, pl.tracks, pl.id, renderPlaylistsList);
    });
    row.querySelector(".row-menu-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openPlaylistActionsModal(pl);
    });
    el.playlistsList.appendChild(row);
  });
}

// ---------- Playlist actions (3-dot menu on a playlist row: rename/delete) ----------
let pendingPlaylistForActions = null;

function openPlaylistActionsModal(playlist) {
  pendingPlaylistForActions = playlist;
  el.playlistActionsTitle.textContent = playlist.name;
  const isFavorites = playlist.id === FAVORITES_PLAYLIST_ID;
  // Favorites is a fixed system playlist — no renaming, no deleting, only
  // clearing it out.
  el.playlistRenameBtn.classList.toggle("hidden", isFavorites);
  el.playlistDeleteBtn.classList.toggle("hidden", isFavorites);
  el.playlistClearBtn.classList.toggle("hidden", !isFavorites);
  el.playlistActionsModal.classList.remove("hidden");
}

el.playlistActionsCancelBtn.addEventListener("click", () => el.playlistActionsModal.classList.add("hidden"));

el.playlistRenameBtn.addEventListener("click", () => {
  el.playlistActionsModal.classList.add("hidden");
  const playlist = pendingPlaylistForActions;
  if (!playlist) return;
  const name = prompt("Rename playlist:", playlist.name);
  if (name && name.trim() && name.trim() !== playlist.name) {
    renamePlaylist(playlist.id, name.trim());
    renderPlaylistsList();
  }
});

el.playlistDeleteBtn.addEventListener("click", () => {
  el.playlistActionsModal.classList.add("hidden");
  const playlist = pendingPlaylistForActions;
  if (!playlist) return;
  if (confirm(`Delete playlist "${playlist.name}"?`)) {
    deletePlaylist(playlist.id);
    renderPlaylistsList();
  }
});

el.playlistClearBtn.addEventListener("click", () => {
  el.playlistActionsModal.classList.add("hidden");
  const playlist = pendingPlaylistForActions;
  if (!playlist) return;
  if (confirm(`Remove all songs from "${playlist.name}"? The playlist itself will stay, just empty.`)) {
    clearPlaylist(playlist.id);
    renderPlaylistsList();
  }
});

el.playlistsBtn.addEventListener("click", () => {
  renderPlaylistsList();
  el.playlistsOverlay.classList.remove("hidden");
});

el.playlistsCloseBtn.addEventListener("click", () => el.playlistsOverlay.classList.add("hidden"));

el.newPlaylistBtn.addEventListener("click", () => {
  const name = prompt("Playlist name:");
  if (name && name.trim()) {
    createPlaylist(name.trim());
    renderPlaylistsList();
  }
});