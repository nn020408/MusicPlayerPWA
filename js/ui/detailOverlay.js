// The song list overlay used for a playlist or an artist.

import { el } from "../core/dom.js";
import { loadPlaylists, removeTrackFromPlaylist } from "../data/playlists.js";
import { playCurrent, queue, setQueue, setUpcomingOrder, shuffleOn, toggleShuffle } from "../player/player.js";
import { openAddToPlaylistModal } from "./addToPlaylist.js";
import { trackRow } from "./trackRow.js";

// onChanged (optional) is called after a song is removed from the playlist being shown.
export function openDetailList(title, tracks, playlistId, onChanged) {
  el.detailTitle.textContent = title;
  el.detailList.innerHTML = "";
  el.detailHeaderActions.classList.toggle("hidden", tracks.length === 0);
  el.detailPlayBtn.onclick = () => {
    setQueue(tracks, 0);
    if (shuffleOn) toggleShuffle();
    playCurrent();
  };
  el.detailShuffleBtn.onclick = () => {
    const startIndex = Math.floor(Math.random() * tracks.length);
    setQueue(tracks, startIndex);
    if (!shuffleOn) toggleShuffle();
    playCurrent();
  };
  if (tracks.length === 0) {
    el.detailList.innerHTML = `<p class="status-msg">No songs${playlistId ? " in this playlist yet." : "."}</p>`;
  }
  tracks.forEach((track, index) => {
    el.detailList.appendChild(
      trackRow(track, {
        onPlay: () => {
          setQueue(tracks, index);
          playCurrent();
        },
        onMenu: () => {
          if (playlistId) {
            if (confirm(`Remove "${track.name.replace(/\.[^/.]+$/, "")}" from this playlist?`)) {
              removeTrackFromPlaylist(playlistId, track.id);
              const updated = loadPlaylists().find((p) => p.id === playlistId);
              openDetailList(title, updated ? updated.tracks : [], playlistId, onChanged);
              if (onChanged) onChanged();
            }
          } else {
            openAddToPlaylistModal(track);
          }
        },
      })
    );
  });
  el.detailOverlay.classList.remove("hidden");
}

el.detailBackBtn.addEventListener("click", () => el.detailOverlay.classList.add("hidden"));

// Drag-to-reorder the "Up Next" queue via each row's dedicated handle (never
// the row itself, so it never fights with tap-to-play or the ⋮ menu). Rows
// are swapped live in the DOM as the dragged row crosses a neighbor's
// midpoint. Session-only — reorders playOrder in memory, nothing persisted.
//
// The compensation added to startClientY after a swap must match the
// height of whichever row it just swapped with, NOT the dragged row's own
// height — rows can differ in height (an artist subtitle line makes a row
// taller), and using a single fixed height there was what caused the drag
// to visibly desync/"resize" itself further with every swap.
//
// Move/end listeners live on window rather than using setPointerCapture on
// the handle — the live DOM reorder below (insertBefore) relocates the
// dragged row, and some WebViews silently release pointer capture when the
// captured element (or an ancestor) gets reparented mid-gesture. Once that
// happens pointerup never arrives, so the drag never "ends": the row is
// left stuck with its in-progress transform, showing as a displaced/blank
// row until the app is reloaded. window-level listeners don't depend on
// capture surviving a reparent, so they keep receiving events regardless.
export function enableQueueDragReorder(container) {
  container.querySelectorAll(".drag-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      const dragRow = handle.closest(".track-row");
      const dragHeight = dragRow.getBoundingClientRect().height;
      let startClientY = e.clientY;
      dragRow.classList.add("dragging");

      const onMove = (ev) => {
        const dy = ev.clientY - startClientY;
        dragRow.style.transform = `translateY(${dy}px)`;
        const rows = Array.from(container.querySelectorAll(".track-row"));
        const index = rows.indexOf(dragRow);
        const dragMid = dragRow.getBoundingClientRect().top + dragHeight / 2;

        if (dy < 0) {
          const prev = rows[index - 1];
          if (prev) {
            const prevRect = prev.getBoundingClientRect();
            if (dragMid < prevRect.top + prevRect.height / 2) {
              container.insertBefore(dragRow, prev);
              startClientY -= prevRect.height;
            }
          }
        } else {
          const next = rows[index + 1];
          if (next) {
            const nextRect = next.getBoundingClientRect();
            if (dragMid > nextRect.top + nextRect.height / 2) {
              container.insertBefore(dragRow, next.nextSibling);
              startClientY += nextRect.height;
            }
          }
        }
      };

      const onEnd = () => {
        dragRow.style.transform = "";
        dragRow.classList.remove("dragging");
        const orderedIds = Array.from(container.querySelectorAll(".track-row")).map((row) => row.dataset.trackId);
        const orderedQueueIndices = orderedIds.map((id) => queue.findIndex((t) => t.id === id));
        setUpcomingOrder(orderedQueueIndices);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    });
  });
}