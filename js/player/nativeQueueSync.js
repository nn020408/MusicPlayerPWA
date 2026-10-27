// Companion to js/player/player.js, split out to stay under this codebase's
// 900-line-per-module cap (tests/architecture.test.js) — not a standalone
// feature on its own, just where the native-queue-sync plumbing for the
// native-playback architecture (see the plan: full native queue + Microsoft
// Graph migration, replacing the JS-forwarding QueueAwarePlayer used to do)
// lives. Two jobs:
//   - push every queue mutation out to NativePlayerPlugin, so Next/Previous/
//     auto-advance can run entirely in native code (see NativePlayerPlugin.
//     java's requestNext()/requestPrevious()/STATE_ENDED handling)
//   - reconcile JS's own queue position back from native's own authoritative
//     state whenever native decided something on its own while the WebView
//     may have been frozen
//
// `queue`/`playOrder`/`orderPos`/`repeatMode` are player.js's own
// module-private state, passed in by every call rather than exported, so
// this stays the only file that knows native's queue is just a flattened
// playOrder.

import { isNative } from "../core/platform.js";
import { forgetTrack } from "../data/library.js";

function plugin() {
  return isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.NativePlayer;
}

export function syncNativeQueue(queue, playOrder, orderPos, repeatMode) {
  const p = plugin();
  if (!p) return;
  const tracks = playOrder.map((i) => {
    const t = queue[i];
    return { id: t.id, name: t.name, artist: (t.audio && t.audio.artist) || "" };
  });
  p.setQueue({ tracks, position: orderPos, repeatMode });
}

export function syncNativeRepeatMode(repeatMode) {
  const p = plugin();
  if (p) p.setRepeatMode({ repeatMode });
}

// `applyTrackChange` is player.js's applyNativeTrackChange, passed in rather
// than imported here to avoid a circular import (player.js imports this
// module to call syncNativeQueue/syncNativeRepeatMode).
export function initNativeQueueSync(applyTrackChange) {
  const p = plugin();
  if (!p) return;
  p.addListener("trackChanged", (data) => applyTrackChange(data));
  p.addListener("itemUnavailable", ({ itemId }) => forgetTrack(itemId));

  // Covers the gap between "native advanced" and "the event actually got
  // delivered" (e.g. the WebView was frozen at the exact moment native
  // acted) — reconciles from native's own authoritative getState() whenever
  // the app comes back to the foreground, same idea as player.js's own
  // visibilitychange/pagehide savePlaybackState() listeners.
  const reconcile = () => {
    p.getState().then((state) => {
      if (state && state.itemId != null) applyTrackChange({ itemId: state.itemId, position: state.queuePosition });
    });
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reconcile();
  });
  if (window.Capacitor.Plugins.App) window.Capacitor.Plugins.App.addListener("resume", reconcile);
}
