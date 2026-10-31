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

// How long the delete-confirm button stays disabled after the dialog opens —
// long enough that a real person reading the prompt clears it without even
// noticing, short enough not to feel like a deliberate delay. A plain
// confirm() used to let a phone unlocked in a pocket chain two accidental
// taps (trash icon, then confirm) into an actual, irreversible OneDrive
// delete; this makes the second tap land before the button can respond to it.
const DELETE_CONFIRM_DELAY_MS = 1500;

let pendingDeleteCancel = null; // set while the dialog is open, lets backButton.js dismiss it as Cancel

function showDeleteConfirm(name) {
  el.deleteConfirmMessage.textContent = `Delete "${name}" from OneDrive? This can't be undone.`;
  el.deleteConfirmModal.classList.remove("hidden");
  el.deleteConfirmBtn.disabled = true;
  el.deleteConfirmBtn.textContent = `🗑 Delete from OneDrive (${Math.ceil(DELETE_CONFIRM_DELAY_MS / 1000)})`;
  return new Promise((resolve) => {
    const deadline = Date.now() + DELETE_CONFIRM_DELAY_MS;
    const tick = setInterval(() => {
      const secondsLeft = Math.ceil((deadline - Date.now()) / 1000);
      if (secondsLeft <= 0) {
        clearInterval(tick);
        el.deleteConfirmBtn.disabled = false;
        el.deleteConfirmBtn.textContent = "🗑 Delete from OneDrive";
      } else {
        el.deleteConfirmBtn.textContent = `🗑 Delete from OneDrive (${secondsLeft})`;
      }
    }, 200);
    const settle = (result) => {
      clearInterval(tick);
      pendingDeleteCancel = null;
      el.deleteConfirmModal.classList.add("hidden");
      el.deleteConfirmBtn.removeEventListener("click", onConfirm);
      el.deleteConfirmCancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onConfirm = () => settle(true);
    const onCancel = () => settle(false);
    pendingDeleteCancel = onCancel;
    el.deleteConfirmBtn.addEventListener("click", onConfirm);
    el.deleteConfirmCancelBtn.addEventListener("click", onCancel);
  });
}

// Lets backButton.js dismiss an open delete-confirm dialog the same way it
// dismisses every other modal, instead of leaving its Promise unresolved
// (and its countdown timer running) if the hardware/gesture back button is
// pressed while it's open.
export function cancelPendingDeleteConfirm() {
  if (pendingDeleteCancel) pendingDeleteCancel();
}

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
  if (!(await showDeleteConfirm(name))) return;
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
