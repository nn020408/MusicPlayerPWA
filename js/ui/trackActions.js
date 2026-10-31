// The shared "⋮" menu for a song row — add to a playlist, remove from the
// playlist being viewed (if any), or delete the file from OneDrive itself —
// used by every list that shows songs (folder view, search, playlist/artist
// detail, Up Next) instead of each repeating its own version. Also exports
// the delete action on its own, for the trash icon in the full player.

import { el } from "../core/dom.js";
import { clearFolderListCache, deleteItem } from "../data/graph.js";
import { forgetTrack } from "../data/library.js";
import { removeTrackFromAllPlaylists, removeTrackFromPlaylist } from "../data/playlists.js";
import { currentTrack, getUpcomingTracks, playNext, resetPlayer } from "../player/player.js";
import { openAddToPlaylistModal } from "./addToPlaylist.js";
import { showToast } from "./toast.js";

let pendingTrack = null;
let pendingPlaylistId = null;
let pendingOnRemovedFromPlaylist = null;
let pendingOnDeleted = null;

const titleOf = (track) => track.name.replace(/\.[^/.]+$/, "");

// Every list that shows songs (folder view, search, playlist/artist detail,
// Up Next) tags its rows via trackRow.js's row.dataset.trackId -- removing by
// that, document-wide, cleans up a deleted song wherever it's currently
// rendered without this module needing to know which list is actually on
// screen. Needed specifically because the full player's trash icon isn't
// tied to any one list (unlike the ⋮ menu's own onDeleted callback, which
// each list already wires up for itself) -- confirmed as a real gap: deleting
// a song from the full player left its row sitting in whatever list was open
// underneath until that list happened to reload on its own.
function removeTrackRowEverywhere(trackId) {
  document.querySelectorAll(".track-row").forEach((row) => {
    if (row.dataset.trackId === trackId) row.remove();
  });
}

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

let pendingDeleteCancel = null; // set while the dialog is open, lets backButton.js dismiss it as Cancel

// A fresh random 2-digit code shown on every open, which has to be typed in
// before the Delete button enables -- a plain confirm() (and, before that, a
// timed delay) used to let a phone unlocked in a pocket chain two accidental
// taps (trash icon, then confirm) into an actual, irreversible OneDrive
// delete. Typing a number it's never shown isn't something a pocket can do.
function showDeleteConfirm(name) {
  const code = String(10 + Math.floor(Math.random() * 90)); // always 2 digits (10-99)
  el.deleteConfirmMessage.textContent = `Delete "${name}" from OneDrive? This can't be undone.`;
  el.deleteConfirmCode.textContent = code;
  el.deleteConfirmInput.value = "";
  el.deleteConfirmBtn.disabled = true;
  el.deleteConfirmModal.classList.remove("hidden");
  el.deleteConfirmInput.focus();
  return new Promise((resolve) => {
    const onInput = () => {
      el.deleteConfirmBtn.disabled = el.deleteConfirmInput.value !== code;
    };
    const settle = (result) => {
      pendingDeleteCancel = null;
      el.deleteConfirmModal.classList.add("hidden");
      el.deleteConfirmInput.removeEventListener("input", onInput);
      el.deleteConfirmBtn.removeEventListener("click", onConfirm);
      el.deleteConfirmCancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onConfirm = () => settle(true);
    const onCancel = () => settle(false);
    pendingDeleteCancel = onCancel;
    el.deleteConfirmInput.addEventListener("input", onInput);
    el.deleteConfirmBtn.addEventListener("click", onConfirm);
    el.deleteConfirmCancelBtn.addEventListener("click", onCancel);
  });
}

// Lets backButton.js dismiss an open delete-confirm dialog the same way it
// dismisses every other modal, instead of leaving its Promise unresolved if
// the hardware/gesture back button is pressed while it's open.
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
  removeTrackRowEverywhere(track.id);
  showToast(`Deleted "${name}"`);
  // If it's what's playing right now, move on -- but only if there's
  // actually somewhere to move to. On native, playNext() just advances
  // native's own queue POINTER; with nothing after it (a single song, or
  // the last one with repeat off), native has nothing left to load and
  // just leaves the already-playing (now-deleted) file running untouched.
  // Confirmed on-device as a real bug without this check: the song kept
  // audibly playing, the UI never updated, and the same dead row was still
  // sitting there to "delete" again (which Graph silently no-ops on a
  // repeat 404, so nothing about it looked wrong until you knew to check).
  if (currentTrack() && currentTrack().id === track.id) {
    if (getUpcomingTracks(1).length > 0) {
      playNext();
    } else {
      resetPlayer();
      el.nowPlayingBar.classList.add("hidden");
    }
  }
  onDeleted && onDeleted();
}

el.trackDeleteBtn.addEventListener("click", () => {
  el.trackActionsModal.classList.add("hidden");
  const track = pendingTrack;
  const onDeleted = pendingOnDeleted;
  if (!track) return;
  deleteTrackWithConfirm(track, { onDeleted });
});
