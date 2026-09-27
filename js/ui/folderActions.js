// The 3-dot menu on a folder row, and the shuffle-everything button.

import { el } from "../core/dom.js";
import { collectTracksRecursive } from "../data/library.js";
import { addToQueue, playCurrent, setQueue, shuffleOn, toggleShuffle } from "../player/player.js";
import { currentFolder } from "../state/browse.js";
import { showToast } from "./toast.js";
import { openAddToPlaylistModal } from "./addToPlaylist.js";

let pendingFolderForActions = null;

export function openFolderActionsModal(folder) {
  pendingFolderForActions = folder;
  el.folderActionsTitle.textContent = folder.name;
  el.folderActionsModal.classList.remove("hidden");
}

// ---------- Folder actions (3-dot menu on a folder row) ----------
el.folderActionsCancelBtn.addEventListener("click", () => el.folderActionsModal.classList.add("hidden"));

el.folderPlayBtn.addEventListener("click", async () => {
  el.folderActionsModal.classList.add("hidden");
  const folder = pendingFolderForActions;
  if (!folder) return;
  showToast(`Loading songs from "${folder.name}"…`);
  try {
    const tracks = await collectTracksRecursive(folder.id);
    if (tracks.length === 0) {
      showToast("No songs found in that folder");
      return;
    }
    const startIndex = Math.floor(Math.random() * tracks.length);
    setQueue(tracks, startIndex);
    if (!shuffleOn) toggleShuffle();
    playCurrent();
    showToast(`Shuffling ${tracks.length} song${tracks.length === 1 ? "" : "s"} from "${folder.name}"`);
  } catch (err) {
    console.error(err);
    showToast("Couldn't load that folder's songs");
  }
});

el.folderAddQueueBtn.addEventListener("click", async () => {
  el.folderActionsModal.classList.add("hidden");
  const folder = pendingFolderForActions;
  if (!folder) return;
  showToast(`Loading songs from "${folder.name}"…`);
  try {
    const tracks = await collectTracksRecursive(folder.id);
    if (tracks.length === 0) {
      showToast("No songs found in that folder");
      return;
    }
    addToQueue(tracks);
    showToast(`Added ${tracks.length} song${tracks.length === 1 ? "" : "s"} to queue`);
  } catch (err) {
    console.error(err);
    showToast("Couldn't load that folder's songs");
  }
});

el.folderAddPlaylistBtn.addEventListener("click", async () => {
  el.folderActionsModal.classList.add("hidden");
  const folder = pendingFolderForActions;
  if (!folder) return;
  showToast(`Loading songs from "${folder.name}"…`);
  try {
    const tracks = await collectTracksRecursive(folder.id);
    if (tracks.length === 0) {
      showToast("No songs found in that folder");
      return;
    }
    openAddToPlaylistModal(tracks);
  } catch (err) {
    console.error(err);
    showToast("Couldn't load that folder's songs");
  }
});

// Shuffle-plays everything under whatever folder you're currently looking at
// — its own songs plus every song in every subfolder shown, no matter how
// deep. No confirmation dialog: the loading toast already makes clear
// something's about to happen, and it's one tap to undo (just play something
// else), so a blocking yes/no felt like unnecessary friction for what's
// meant to be a quick "shuffle everything" action.
el.shuffleViewBtn.addEventListener("click", async () => {
  const folder = currentFolder();
  if (!folder) return;
  showToast(`Loading songs from "${folder.name}"…`);
  try {
    const tracks = await collectTracksRecursive(folder.id);
    if (tracks.length === 0) {
      showToast("No songs found here");
      return;
    }
    const startIndex = Math.floor(Math.random() * tracks.length);
    setQueue(tracks, startIndex);
    if (!shuffleOn) toggleShuffle();
    playCurrent();
    showToast(`Shuffling ${tracks.length} song${tracks.length === 1 ? "" : "s"} from "${folder.name}"`);
  } catch (err) {
    console.error(err);
    showToast("Couldn't load songs to shuffle");
  }
});