// Backup and restore of playlists and the library index.

import { el } from "../core/dom.js";
import { isNative } from "../data/auth.js";
import { LIBRARY_CACHE_KEY, libraryTracks, loadCachedLibrary } from "../data/library.js";
import { loadPlaylists, savePlaylists } from "../data/playlists.js";
import { showToast } from "./toast.js";
import { kickOffIndexing, markLibraryLoaded, markLibraryStale, stopLibraryWorkAndWait } from "./libraryWork.js";

// Purely on-demand — only runs when you tap the button, never automatically,
// so it can't affect app speed. Safe to include the search index: it only
// stores each song's permanent OneDrive id, never the short-lived streaming
// link, so nothing in the backup can go stale.
// shareInstead: skip saving into Documents and go straight to the share sheet
// (for sending a copy to Drive, email, etc).
async function exportBackup(shareInstead) {
  let libraryCache = null;
  try {
    const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
    libraryCache = raw ? JSON.parse(raw) : null;
  } catch {
    libraryCache = null;
  }

  const backup = {
    type: "musicplayer-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    playlists: loadPlaylists(),
    libraryCache,
  };
  const json = JSON.stringify(backup, null, 2);
  // Date and time, so two backups the same day never collide (an app can only
  // overwrite files it created itself in shared storage).
  const filename = `musicplayer-backup-${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}.json`;

  // The <a download> + blob-URL trick below is a real-browser technique —
  // Android's WebView (what wraps this app) doesn't reliably implement
  // download-attribute handling for blob: URLs the way Chrome/Firefox do, so
  // on native this silently did nothing at all. Native instead:
  //   1. saves the file into the phone's public Documents folder, where My
  //      Files shows it and the restore file picker can browse to it. The
  //      share sheet alone can't do this: it only lists apps (Drive, email,
  //      Quick Share...), never "this phone's storage".
  //   2. falls back to the share sheet if that write is refused, and is also
  //      what the separate "Share backup" button uses.
  if (isNative() && window.Capacitor.Plugins.Filesystem && window.Capacitor.Plugins.Share) {
    const { Filesystem, Share } = window.Capacitor.Plugins;
    if (!shareInstead) {
      try {
        await Filesystem.writeFile({
          path: filename,
          data: json,
          directory: window.capacitorFilesystem.Directory.Documents,
          encoding: window.capacitorFilesystem.Encoding.UTF8,
        });
        showToast(`Saved to Documents/${filename}`, 8000);
        return;
      } catch (err) {
        console.warn("Couldn't save into Documents, using the share sheet instead", err);
        showToast("Couldn't save to Documents. Choose where to send it instead.", 5000);
      }
    }
    try {
      const written = await Filesystem.writeFile({
        path: filename,
        data: json,
        directory: window.capacitorFilesystem.Directory.Cache,
        encoding: window.capacitorFilesystem.Encoding.UTF8,
      });
      await Share.share({
        title: "NubePlayer backup",
        text: "Your NubePlayer playlists and library backup",
        url: written.uri,
        dialogTitle: "Save backup to…",
      });
    } catch (err) {
      console.error("Backup failed", err);
      showToast("Couldn't create backup file");
    }
    return;
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Backup saved");
}

// onDone(succeeded) is optional — used by the first-time intro flow (see
// below) to know when a restore triggered from there has actually finished,
// since FileReader is async and it needs to decide what to show next.
function importBackupFile(file, onDone) {
  const reader = new FileReader();
  reader.onload = async () => {
    let succeeded = false;
    try {
      const backup = JSON.parse(reader.result);
      let addedPlaylists = 0;
      if (Array.isArray(backup.playlists)) {
        const existing = loadPlaylists();
        const existingIds = new Set(existing.map((p) => p.id));
        const newOnes = backup.playlists.filter((p) => p && p.id && !existingIds.has(p.id));
        addedPlaylists = newOnes.length;
        savePlaylists(existing.concat(newOnes));
      }
      if (backup.libraryCache) {
        // A scan actively running against the OLD library would otherwise
        // keep grinding away on data this restore is about to throw away.
        await stopLibraryWorkAndWait();
        localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(backup.libraryCache));
        markLibraryStale();
        // Swap the live in-memory library over immediately instead of just
        // leaving stale data (and a stale Settings status line) sitting
        // around until something else happens to touch the library later —
        // that silence was exactly what made a restore look like it hadn't
        // done anything.
        if (loadCachedLibrary()) {
          markLibraryLoaded();
          el.scanStatus.textContent = `Restored — ${libraryTracks.length} song${libraryTracks.length === 1 ? "" : "s"}.`;
          kickOffIndexing();
        } else {
          // Doesn't match the currently selected music folder — falls back
          // to a fresh scan next time the library is touched, same as
          // before, but at least says so instead of staying silent.
          el.scanStatus.textContent = "Restored — pick your OneDrive music folder to match this backup to use it.";
        }
      }
      showToast(`Restored — ${addedPlaylists} playlist${addedPlaylists === 1 ? "" : "s"} added`);
      succeeded = true;
    } catch (err) {
      console.error("Restore failed", err);
      showToast("Couldn't read that backup file");
    }
    onDone && onDone(succeeded);
  };
  reader.readAsText(file);
}

el.backupBtn.addEventListener("click", () => exportBackup(false));

el.shareBackupBtn.addEventListener("click", () => exportBackup(true));

el.restoreBtn.addEventListener("click", () => pickBackupFile());

el.restoreFileInput.addEventListener("change", () => {
  const file = el.restoreFileInput.files[0];
  const onDone = restoreDone;
  restoreDone = null;
  if (file) importBackupFile(file, onDone);
  el.restoreFileInput.value = ""; // reset so selecting the same file again still fires "change"
});

// One shared <input type=file> serves both Settings' plain restore and the
// welcome guide's. `restoreDone` is whoever opened the picker's callback, told
// afterwards whether the restore worked (the welcome guide uses it to carry on
// into the folder picker).
let restoreDone = null;

export function pickBackupFile(onDone) {
  restoreDone = onDone || null;
  el.restoreFileInput.click();
}