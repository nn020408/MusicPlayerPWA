// The shared "⋮" menu for a song row — add to a playlist, remove from the
// playlist being viewed (if any), or delete the file from OneDrive itself —
// used by every list that shows songs (folder view, search, playlist/artist
// detail, Up Next) instead of each repeating its own version. Also exports
// the delete action on its own, for the trash icon in the full player.

import { el } from "../core/dom.js";
import { clearFolderListCache, deleteItem } from "../data/graph.js";
import { forgetTrack } from "../data/library.js";
import { removeTrackFromAllPlaylists, removeTrackFromPlaylist } from "../data/playlists.js";
import { currentTrack, playNext } from "../player/player.js";
import { openAddToPlaylistModal } from "./addToPlaylist.js";
import { showToast } from "./toast.js";

let pendingTrack = null;
let pendingPlaylistId = null;
let pendingOnRemovedFromPlaylist = null;
let pendingOnDeleted = null;

const titleOf = (track) => track.name.replace(/\.[^/.]+$/, "");

// playlistId (optional): shows "Remove from this playlist" — only makes
// sense when the menu was opened from that playlist's own song list.
// onRemovedFromPlaylist / onDeleted: let the list this row came from refresh
// itself afterwards (each list knows how to re-render its own rows; this
// module doesn't try to guess that generically — see the call sites).
export function openTrackActionsModal(track, { playlistId = null, onRemovedFromPlaylist, onDeleted } = {}) {
  pendingTrack = track;
  pendingPlaylistId = playlistId;
  pendingOnRemovedFromPlaylist = onRemovedFromPlaylist;
  pendingOnDeleted = onDeleted;
  el.trackActionsTitle.textContent = titleOf(track);
  el.trackRemovePlaylistBtn.classList.toggle("hidden", !playlistId);
  el.trackActionsModal.classList.remove("hidden");
}

el.trackActionsCancelBtn.addEventListener("click", () => el.trackActionsModal.classList.add("hidden"));

el.trackAddPlaylistBtn.addEventListener("click", () => {
  el.trackActionsModal.classList.add("hidden");
  if (pendingTrack) openAddToPlaylistModal(pendingTrack);
});

el.trackRemovePlaylistBtn.addEventListener("click", () => {
  el.trackActionsModal.classList.add("hidden");
  const track = pendingTrack;
  const playlistId = pendingPlaylistId;
  const onRemovedFromPlaylist = pendingOnRemovedFromPlaylist;
  if (!track || !playlistId) return;
  if (confirm(`Remove "${titleOf(track)}" from this playlist?`)) {
    removeTrackFromPlaylist(playlistId, track.id);
    onRemovedFromPlaylist && onRemovedFromPlaylist();
  }
});

// Deletes the song from OneDrive itself (not just this device's view of it)
// — asks first, since this can't be undone. Shared by the modal's own
// "Delete from OneDrive" button and the full player's trash icon.
//
// What happens to the library cache: forgetTrack() drops the song from the
// in-memory library AND re-saves libraryIndexCache to localStorage right
// away, same as when a song is found to already be gone from OneDrive (a 404
// during playback — see player.js). So it stops showing up in search/folders
// immediately, and stays gone after an app restart without needing a rescan.
export async function deleteTrackWithConfirm(track, { onDeleted } = {}) {
  const name = titleOf(track);
  if (!confirm(`Delete "${name}" from OneDrive? This can't be undone.`)) return;
  try {
    await deleteItem(track.id);
  } catch (err) {
    showToast(`Couldn't delete "${name}": ${(err && err.message) || err}`);
    return;
  }
  forgetTrack(track.id);
  removeTrackFromAllPlaylists(track.id);
  clearFolderListCache(); // otherwise a folder reload would just show the deleted file again
  showToast(`Deleted "${name}"`);
  // If it's what's playing right now, move on rather than leave a dead
  // download link queued up — same recovery path as the 404-during-playback
  // case, which already handles this correctly.
  if (currentTrack() && currentTrack().id === track.id) playNext();
  onDeleted && onDeleted();
}

el.trackDeleteBtn.addEventListener("click", () => {
  el.trackActionsModal.classList.add("hidden");
  const track = pendingTrack;
  const onDeleted = pendingOnDeleted;
  if (!track) return;
  deleteTrackWithConfirm(track, { onDeleted });
});
