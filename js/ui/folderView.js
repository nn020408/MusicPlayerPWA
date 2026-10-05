// The main view: browsing folders, rooted at the chosen music folder.

import { escapeHtml } from "../core/text.js";
import { el } from "../core/dom.js";
import { listFolder, retryWithBackoff } from "../data/graph.js";
import { runWithConcurrency } from "../data/library.js";
import { setIndexPriorityFolder } from "../data/indexer.js";
import { playCurrent, setQueue } from "../player/player.js";
import { currentFolder, currentTracks, folderStack, pushFolder, replaceFolderStack, setListing, truncateFolderStack } from "../state/browse.js";
import { openAddToPlaylistModal } from "./addToPlaylist.js";
import { enterSelectMode, exitSelectMode, selectMode, setupLongPress, toggleItemSelection } from "./select.js";
import { trackRow } from "./trackRow.js";
import { openFolderActionsModal } from "./folderActions.js";

function renderBreadcrumb() {
  el.breadcrumb.innerHTML = "";
  folderStack.forEach((folder, i) => {
    const btn = document.createElement("button");
    btn.className = "crumb";
    btn.textContent = folder.name;
    btn.addEventListener("click", () => {
      truncateFolderStack(i + 1);
      openFolder(folder.id, false);
    });
    el.breadcrumb.appendChild(btn);
    if (i < folderStack.length - 1) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "›";
      el.breadcrumb.appendChild(sep);
    }
  });
}

async function openFolder(folderId, pushToStack, folderName) {
  setIndexPriorityFolder(folderId); // the indexer reads what you are looking at first
  // Selection is scoped to whatever folder is currently shown (see
  // currentFolders/currentTracks below) — navigating away would leave it
  // pointing at rows that no longer exist, so just close it out first.
  if (selectMode) exitSelectMode();
  if (pushToStack) pushFolder({ id: folderId, name: folderName });
  renderBreadcrumb();
  el.statusMsg.innerHTML = `<span class="spinner"></span>Loading…`;
  el.fileList.innerHTML = "";
  // Bad/spotty signal (as opposed to navigator.onLine going false) tends to
  // fail an individual request rather than reliably — retry a few times with
  // backoff instead of dead-ending on one attempt. isStillHere() guards
  // against applying a stale retry's result after the user has since
  // navigated to a different folder.
  const isStillHere = () => currentFolder()?.id === folderId;
  try {
    const { folders, tracks } = await retryWithBackoff(() => listFolder(folderId), {
      onRetry: (attempt) => {
        if (isStillHere()) el.statusMsg.innerHTML = `<span class="spinner"></span>Connection trouble — retrying (${attempt})…`;
      },
    });
    if (!isStillHere()) return;
    setListing(tracks, folders);
    el.statusMsg.textContent = folders.length + tracks.length === 0 ? "This folder is empty." : "";

    folders.forEach((folder) => {
      const row = document.createElement("div");
      row.className = "row folder-row";
      row.innerHTML = `
        <span class="row-lead">
          <span class="row-icon">📁</span>
          <span class="select-check"><span class="circle">✓</span></span>
        </span>
        <span class="row-name">${escapeHtml(folder.name)}</span>
        <button class="row-menu-btn">⋮</button>
      `;

      const wasLongPress = setupLongPress(row, () => {
        if (!selectMode) enterSelectMode();
        toggleItemSelection("folder", folder.id, folder.name, folder, row);
      });

      row.addEventListener("click", (e) => {
        if (e.target.closest(".row-menu-btn")) return;
        if (wasLongPress()) return;
        if (selectMode) {
          toggleItemSelection("folder", folder.id, folder.name, folder, row);
          return;
        }
        openFolder(folder.id, true, folder.name);
      });
      row.querySelector(".row-menu-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        openFolderActionsModal(folder);
      });
      el.fileList.appendChild(row);
    });

    tracks.forEach((track, index) => {
      el.fileList.appendChild(
        trackRow(track, {
          selectable: true,
          onPlay: () => {
            setQueue(currentTracks, index);
            playCurrent();
          },
          onMenu: () => openAddToPlaylistModal(track),
        })
      );
    });

    // Quietly warm each subfolder's own contents in the background (low
    // priority, bounded concurrency — same pattern as the library scan) so
    // that if you tap into one next, it's likely already cached instead of
    // needing its own fresh network round trip. One level deep only — this
    // is "prefetch what's visible right now", not a second library scan.
    // Fire-and-forget: never awaited, and listFolder's own folderListCache
    // already de-dupes this against anything the scan is doing in parallel.
    runWithConcurrency(5, folders.map((f) => f.id), (id) =>
      listFolder(id, { priority: "low" }).then(() => undefined).catch(() => undefined)
    );
  } catch (err) {
    console.error(err);
    if (isStillHere()) el.statusMsg.textContent = "Couldn't load this folder. Check your connection and try again.";
  }
}

export function openMainFolderView(stack) {
  replaceFolderStack(stack);
  openFolder(currentFolder().id, false);
}

// Re-reads the folder on screen (e.g. after the library was rescanned).
export function reloadCurrentFolder() {
  const folder = currentFolder();
  if (folder) openFolder(folder.id, false);
}

// One level up in the main view (the Android back button). False when already at the top.
export function goUpOneFolder() {
  if (folderStack.length <= 1) return false;
  truncateFolderStack(folderStack.length - 1);
  openFolder(currentFolder().id, false);
  return true;
}