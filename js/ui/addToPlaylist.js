// The "add to playlist" dialog.

import { el } from "../core/dom.js";
import { escapeHtml } from "../core/text.js";
import { addTracksToPlaylist, createPlaylist, FAVORITES_PLAYLIST_ID, loadPlaylists } from "../data/playlists.js";
import { showToast } from "./toast.js";

let pendingTracksForPlaylist = [];

// Accepts a single track or an array (e.g. every song found under a folder).
export function openAddToPlaylistModal(trackOrTracks) {
  pendingTracksForPlaylist = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
  const playlists = loadPlaylists();
  el.addPlaylistList.innerHTML = "";
  if (playlists.length === 0) {
    el.addPlaylistList.innerHTML = `<p class="status-msg">No playlists yet — create one below.</p>`;
  }
  playlists.forEach((pl) => {
    const row = document.createElement("div");
    row.className = "row";
    const icon = pl.id === FAVORITES_PLAYLIST_ID ? "❤️" : "📃";
    row.innerHTML = `<span class="row-icon">${icon}</span><span class="row-name">${escapeHtml(pl.name)}</span>`;
    row.addEventListener("click", () => {
      const added = addTracksToPlaylist(pl.id, pendingTracksForPlaylist);
      el.addPlaylistModal.classList.add("hidden");
      showToast(added === 1 ? `Added to "${pl.name}"` : `Added ${added} songs to "${pl.name}"`);
    });
    el.addPlaylistList.appendChild(row);
  });
  el.addPlaylistModal.classList.remove("hidden");
}

el.addPlaylistNewBtn.addEventListener("click", () => {
  const name = prompt("Playlist name:");
  if (name && name.trim()) {
    const pl = createPlaylist(name.trim());
    const added = addTracksToPlaylist(pl.id, pendingTracksForPlaylist);
    el.addPlaylistModal.classList.add("hidden");
    showToast(added === 1 ? `Added to "${pl.name}"` : `Added ${added} songs to "${pl.name}"`);
  }
});

el.addPlaylistCancelBtn.addEventListener("click", () => el.addPlaylistModal.classList.add("hidden"));