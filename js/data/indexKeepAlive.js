// Android only: while artists are being read, a foreground service (with a
// small notification) keeps the app's network alive with the screen off, so the
// job carries on instead of freezing when the phone is locked. On the web
// version there is no plugin and this does nothing, so the job still pauses in a
// background tab. The native side is IndexKeepAlivePlugin / IndexKeepAliveService.



import { isNative } from "../core/platform.js";

const indexKeepAlive = isNative() && window.Capacitor.registerPlugin ? window.Capacitor.registerPlugin("IndexKeepAlive") : null;
let indexKeepAliveActive = false; // the service is confirmed running
let indexKeepAliveRequested = false;
let indexKeepAliveTextAt = 0;

export function isIndexKeepAliveActive() {
  return indexKeepAliveActive;
}

// Called with every progress update from the indexer: starts the service when
// work begins, refreshes its notification text (at most every 5s), and stops it
// when work ends.
export function syncIndexKeepAlive(state, done, total, pct) {
  if (!indexKeepAlive) return;
  const working = state === "running" || state === "throttled";
  if (working && !indexKeepAliveRequested) {
    indexKeepAliveRequested = true;
    indexKeepAlive
      .start({ text: `${done} of ${total} songs (${pct}%)` })
      .then(() => {
        if (indexKeepAliveRequested) indexKeepAliveActive = true;
      })
      .catch(() => {
        indexKeepAliveRequested = false;
        indexKeepAliveActive = false;
      });
  } else if (working) {
    if (Date.now() - indexKeepAliveTextAt > 5000) {
      indexKeepAliveTextAt = Date.now();
      indexKeepAlive.update({ text: `${done} of ${total} songs (${pct}%)` }).catch(() => {});
    }
  } else if (indexKeepAliveRequested) {
    indexKeepAliveRequested = false;
    indexKeepAliveActive = false;
    indexKeepAlive.stop().catch(() => {});
  }
}
