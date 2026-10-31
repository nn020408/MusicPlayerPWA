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

// A Next/Previous tap on native normally lands (via prefetch) well under this,
// so routine skips never show anything -- only a genuinely slow one (a
// stalled connection needing its own retry-with-backoff inside
// NativeGraphClient, confirmed on-device as a real cause of several-second
// gaps) does. Without this, that wait looked indistinguishable from the
// button doing nothing at all, which is exactly what it was reported as.
// onStatus is passed in rather than imported (same reason as
// initNativeQueueSync's applyTrackChange param) -- it's player.js's own
// player.onStatus, read at call time since playerUI.js assigns it after
// player.js finishes loading.
const SLOW_ADVANCE_FEEDBACK_MS = 1200;
let pendingAdvanceTimer = null;

export function armPendingAdvanceFeedback(onStatus) {
  clearTimeout(pendingAdvanceTimer);
  pendingAdvanceTimer = setTimeout(() => onStatus && onStatus("Connection trouble — hang on…"), SLOW_ADVANCE_FEEDBACK_MS);
}

export function clearPendingAdvanceFeedback(onStatus) {
  if (!pendingAdvanceTimer) return;
  clearTimeout(pendingAdvanceTimer);
  pendingAdvanceTimer = null;
  onStatus && onStatus("");
}

// `applyTrackChange` is player.js's applyNativeTrackChange, passed in rather
// than imported here to avoid a circular import (player.js imports this
// module to call syncNativeQueue/syncNativeRepeatMode). `getOnStatus` is a
// thunk for the same reason, reading player.onStatus lazily (it isn't
// assigned until playerUI.js loads) -- just for clearPendingAdvanceFeedback
// below.
export function initNativeQueueSync(applyTrackChange, getOnStatus) {
  const p = plugin();
  if (!p) return;
  p.addListener("trackChanged", (data) => applyTrackChange(data));
  p.addListener("itemUnavailable", ({ itemId }) => forgetTrack(itemId));
  // Fired for every native Next/Previous outcome that DOESN'T produce a
  // trackChanged (a same-track restart, a queue-boundary no-op) -- without
  // this, armPendingAdvanceFeedback's timer had nothing to ever clear it for
  // those cases, leaving a bogus "Connection trouble" toast on screen
  // indefinitely. Harmless if a trackChanged already cleared it first.
  p.addListener("advanceSettled", () => clearPendingAdvanceFeedback(getOnStatus()));

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
