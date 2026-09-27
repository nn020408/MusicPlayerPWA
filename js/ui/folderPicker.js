// Choosing the OneDrive music folder (first-run onboarding, and "Change music
// folder" in Settings).

import { escapeHtml } from "../core/text.js";
import { el } from "../core/dom.js";
import { listFolder, retryWithBackoff } from "../data/graph.js";
import { DEFAULT_FOLDER_KEY } from "../data/library.js";
import { ensureLibraryLoaded, markLibraryStale } from "./libraryWork.js";
import { openMainFolderView } from "./folderView.js";

let fpStack = [{ id: "root", name: "OneDrive" }];

function renderFpBreadcrumb() {
  el.fpBreadcrumb.innerHTML = "";
  fpStack.forEach((folder, i) => {
    const btn = document.createElement("button");
    btn.className = "crumb";
    btn.textContent = folder.name;
    btn.addEventListener("click", () => {
      fpStack = fpStack.slice(0, i + 1);
      loadFpFolder(folder.id);
    });
    el.fpBreadcrumb.appendChild(btn);
    if (i < fpStack.length - 1) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "›";
      el.fpBreadcrumb.appendChild(sep);
    }
  });
}

async function loadFpFolder(folderId) {
  renderFpBreadcrumb();
  el.fpFileList.innerHTML = `<p class="status-msg"><span class="spinner"></span>Loading…</p>`;
  const isStillHere = () => fpStack[fpStack.length - 1]?.id === folderId;
  try {
    const { folders, tracks } = await retryWithBackoff(() => listFolder(folderId), {
      onRetry: (attempt) => {
        if (isStillHere()) {
          el.fpFileList.innerHTML = `<p class="status-msg"><span class="spinner"></span>Connection trouble — retrying (${attempt})…</p>`;
        }
      },
    });
    if (!isStillHere()) return;
    el.fpFileList.innerHTML = "";
    if (folders.length === 0) {
      el.fpFileList.innerHTML = `<p class="status-msg">No subfolders here.</p>`;
    }
    folders.forEach((folder) => {
      const row = document.createElement("div");
      row.className = "row folder-row";
      row.innerHTML = `<span class="row-icon">📁</span><span class="row-name">${escapeHtml(folder.name)}</span>`;
      row.addEventListener("click", () => {
        fpStack.push({ id: folder.id, name: folder.name });
        loadFpFolder(folder.id);
      });
      el.fpFileList.appendChild(row);
    });
    const current = fpStack[fpStack.length - 1];
    el.fpUseHereBtn.textContent = `✓ Use "${current.name}" (${tracks.length} song${tracks.length === 1 ? "" : "s"} here)`;
  } catch (err) {
    console.error(err);
    if (isStillHere()) {
      el.fpFileList.innerHTML = `<p class="status-msg">Couldn't load this folder. Check your connection and try again.</p>`;
    }
  }
}

export function openFolderPicker(mode) {
  fpStack = [{ id: "root", name: "OneDrive" }];
  el.folderPickerCancelBtn.classList.toggle("hidden", mode !== "change");
  el.folderPickerHeading.textContent = mode === "onboarding" ? "Select your music folder" : "Change music folder";
  // The mini player sits above overlays (z-index 25 vs 20) so it stays
  // visible over search/settings/etc — but here it would float directly on
  // top of the "Use this folder" button and eat its taps. Hide it for the
  // duration, same trick used for select mode.
  el.nowPlayingBar.classList.add("select-mode-hidden");
  el.folderPickerOverlay.classList.remove("hidden");
  loadFpFolder("root");
}

// Android back while the folder picker is open: step up one level within the
// picker itself first, same as the main folder view — works in both onboarding
// and "change folder" mode, since it never dismisses the picker, just
// navigates within it. At the picker's own root: onboarding has no Cancel
// button — it's mandatory, so back can't dismiss it there.
export function handleFolderPickerBack() {
  if (fpStack.length > 1) {
    fpStack = fpStack.slice(0, -1);
    loadFpFolder(fpStack[fpStack.length - 1].id);
    return true;
  }
  if (!el.folderPickerCancelBtn.classList.contains("hidden")) closeFolderPicker();
  return true; // always consumed, even when there was nothing to do
}

function closeFolderPicker() {
  el.folderPickerOverlay.classList.add("hidden");
  el.nowPlayingBar.classList.remove("select-mode-hidden");
}

el.fpHomeBtn.addEventListener("click", () => {
  fpStack = [{ id: "root", name: "OneDrive" }];
  loadFpFolder("root");
});

el.fpUseHereBtn.addEventListener("click", () => {
  // Only the chosen folder itself becomes the main view's navigation root —
  // not the whole path used to browse there. Otherwise back-navigation would
  // keep stepping up through OneDrive's root and any folders in between
  // before ever reaching the exit confirmation.
  const chosen = fpStack[fpStack.length - 1];
  setLibraryFolder(chosen);
  closeFolderPicker();
  openMainFolderView([chosen]);
  ensureLibraryLoaded(); // covers first-time folder selection and later changes, not just later app opens
});

el.folderPickerCancelBtn.addEventListener("click", () => {
  closeFolderPicker();
});

function setLibraryFolder(folder) {
  localStorage.setItem(DEFAULT_FOLDER_KEY, JSON.stringify([folder]));
  // Deliberately NOT clearing the library cache here — loadCachedLibrary()
  // already checks the cached rootId against this folder and rejects it on
  // its own if they don't match, forcing a fresh scan exactly when one's
  // actually needed. Force-deleting it unconditionally used to throw away a
  // perfectly valid cache any time this folder happens to match one already
  // cached — most visibly right after Restore from file, which writes a
  // fresh cache for the restored folder just before this runs (the intro's
  // restore flow sends you into this same picker afterward), making every
  // restore immediately force a full rescan instead of using what was just restored.
  markLibraryStale();
}