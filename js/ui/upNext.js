// The Up Next queue overlay.

import { escapeHtml } from "../core/text.js";
import { el } from "../core/dom.js";
import { libraryArtistFor } from "../data/library.js";
import { getUpcomingTracks, playIndex, queue, queueIndex, repeatMode } from "../player/player.js";
import { openAddToPlaylistModal } from "./addToPlaylist.js";
import { EQUALIZER_ICON, trackRow } from "./trackRow.js";
import { enableQueueDragReorder } from "./detailOverlay.js";

// Jumps within the CURRENT queue/play order (via playIndex) rather than
// replacing it with setQueue — tapping an upcoming track should just skip
// ahead to it, not turn "what's next" into a brand new queue.
function renderUpNextNowPlaying() {
  const current = queue[queueIndex];
  const hasCurrent = !!current;
  el.upNextNowLabel.classList.toggle("hidden", !hasCurrent);
  el.upNextNowRow.classList.toggle("hidden", !hasCurrent);
  if (!hasCurrent) return;
  const artist = (current.audio && current.audio.artist) || libraryArtistFor(current.id);
  el.upNextNowRow.innerHTML = `
    <span class="row-lead">${EQUALIZER_ICON}</span>
    <div class="row-text">
      <div class="row-name">${escapeHtml(current.name.replace(/\.[^/.]+$/, ""))}</div>
      ${artist ? `<div class="row-sub">${escapeHtml(artist)}</div>` : ""}
    </div>
  `;
}

// Jumps within the CURRENT queue/play order (via playIndex) rather than
// replacing it with setQueue — tapping an upcoming track should just skip
// ahead to it, not turn "what's next" into a brand new queue.
export function openUpNextView() {
  renderUpNextNowPlaying();
  const upcoming = getUpcomingTracks(Infinity);
  el.upNextList.innerHTML = "";
  if (upcoming.length === 0) {
    const msg = repeatMode === "one" ? "Repeat is set to this song only." : "Nothing queued after this.";
    el.upNextList.innerHTML = `<p class="status-msg">${msg}</p>`;
  }
  upcoming.forEach((track) => {
    el.upNextList.appendChild(
      trackRow(track, {
        reorderable: upcoming.length > 1,
        onPlay: () => {
          const idx = queue.indexOf(track);
          el.upNextOverlay.classList.add("hidden");
          if (idx !== -1) playIndex(idx);
        },
        onMenu: () => openAddToPlaylistModal(track),
      })
    );
  });
  if (upcoming.length > 1) enableQueueDragReorder(el.upNextList);
  el.upNextOverlay.classList.remove("hidden");
}

el.upNextBtn.addEventListener("click", openUpNextView);

el.upNextCloseBtn.addEventListener("click", () => el.upNextOverlay.classList.add("hidden"));