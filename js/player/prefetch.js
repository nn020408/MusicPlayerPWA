// Pre-fetches the NEXT track's streaming URL and full file ahead of time so
// advancing to it needs no network wait — mobile browsers throttle
// background JS heavily once the screen locks, and a fetch that would
// normally take a few hundred ms can stall indefinitely at that point. The
// already-playing track keeps going fine either way (that's native audio,
// not JS-dependent); it's specifically the *transition* to the next one this
// protects. Used only by player.js's playCurrent()/resetPlayer().

import { getDownloadUrl, retryWithBackoff } from "../data/graph.js";

const prefetchedUrls = new Map(); // itemId -> streaming url
const urlPrefetchPromises = new Map(); // itemId -> in-flight/settled Promise<url>, so blob prefetch can reuse it

export function prefetchDownloadUrl(item) {
  if (!item) return null;
  if (prefetchedUrls.has(item.id)) return Promise.resolve(prefetchedUrls.get(item.id));
  if (urlPrefetchPromises.has(item.id)) return urlPrefetchPromises.get(item.id);
  const promise = getDownloadUrl(item)
    .then((url) => {
      if (url) prefetchedUrls.set(item.id, url);
      return url;
    })
    .catch(() => null)
    .finally(() => urlPrefetchPromises.delete(item.id));
  urlPrefetchPromises.set(item.id, promise);
  return promise;
}

// Reads and removes a prefetched streaming URL, if one exists — a
// prefetched URL/blob only ever gets used on the very first play attempt for
// a track (see takePrefetchedBlobUrl below and its caller in player.js).
export function takePrefetchedUrl(itemId) {
  const url = prefetchedUrls.get(itemId);
  if (url) prefetchedUrls.delete(itemId);
  return url || null;
}

// Prefetching just the streaming URL above still leaves the actual next-
// track handoff dependent on opening a fresh HTTP connection and buffering
// it when .play() is called — exactly the kind of network+JS work that can
// get stuck if the screen locks right as the current track ends (mobile
// browsers exempt "audibly playing" tabs from background throttling, but
// that exemption is fragile in the brief silent gap between tracks). So this
// also pulls down the entire next track's bytes into a Blob ahead of time,
// while the current track is still playing (screen presumably on) — the
// eventual swap then only needs a synchronous object-URL assignment, no
// network I/O, giving it the best chance of completing before/without
// hitting that freeze window. Only ever one track ahead, same scope as the
// URL prefetch above, to keep memory/bandwidth bounded.
const prefetchedBlobUrls = new Map(); // itemId -> object URL (already downloaded, not yet consumed)
let blobPrefetch = null; // { itemId, controller } for the in-flight download, if any

// keepItemId: a second id to spare — playCurrent() calls this to start
// prefetching the NEXT track's blob while it's still reading the CURRENT
// track's own already-prefetched blob out of this same map. Without it, that
// current-track entry was wiped by this cleanup before ever being read,
// silently making the whole "download ahead of time" optimization a no-op.
function revokeStaleBlobPrefetches(exceptItemId, keepItemId) {
  for (const [id, url] of prefetchedBlobUrls) {
    if (id !== exceptItemId && id !== keepItemId) {
      URL.revokeObjectURL(url);
      prefetchedBlobUrls.delete(id);
    }
  }
}

export function prefetchNextTrackBlob(item, keepItemId) {
  if (!item || prefetchedBlobUrls.has(item.id)) return;
  if (blobPrefetch && blobPrefetch.itemId === item.id) return;
  // Respect an explicit data-saver signal — this trades bandwidth for
  // reliability, which isn't the right call for someone who's opted into
  // saving data. (Network Information API isn't universal; feature-detect.)
  if (navigator.connection && navigator.connection.saveData) return;

  revokeStaleBlobPrefetches(item.id, keepItemId);
  // An in-flight prefetch for keepItemId (the track that just became current)
  // is still worth letting finish — aborting it here to go chase the track
  // AFTER this one would be the same self-defeating mistake keepItemId
  // exists to avoid, just for the still-downloading case instead of the
  // already-cached one. Only ever one prefetch runs at a time by design, so
  // this one simply waits its turn — the next transition tries again.
  if (blobPrefetch && blobPrefetch.itemId === keepItemId) return;
  if (blobPrefetch) blobPrefetch.controller.abort();

  const controller = new AbortController();
  const entry = { itemId: item.id, controller };
  blobPrefetch = entry;

  prefetchDownloadUrl(item)
    .then((url) => {
      if (!url || controller.signal.aborted) return null;
      // Retried up to 3 times — a dropped connection mid-download is exactly
      // the kind of transient failure this guards against (see the
      // Content-Length check below). If every attempt fails, the outer
      // .catch() below lets this prefetch quietly give up — playCurrent()'s
      // own, more patient 8-attempt retry still handles it once this song's
      // turn actually comes, just without the "already downloaded" head start.
      return retryWithBackoff(
        async () => {
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) {
            const err = new Error(`HTTP ${res.status}`);
            err.status = res.status;
            throw err;
          }
          const expectedLength = Number(res.headers.get("content-length"));
          const blob = await res.blob();
          // A dropped/flaky connection can end the response stream early
          // without fetch() itself reporting an error — res.blob() just
          // resolves with whatever bytes it got. That's a silently truncated
          // file, which only ever showed up later as "decode error
          // (unsupported format?)" right at the track transition, with
          // nothing to connect it back to a network problem. Checking the
          // downloaded size against what the server said to expect catches
          // it here instead of trusting it.
          if (expectedLength && blob.size !== expectedLength) throw new Error("truncated download");
          return blob;
        },
        // A 404 (the track was deleted in OneDrive) won't fix itself on retry
        // — same exclusion playCurrent()'s own retry already makes.
        { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 4000, shouldRetry: (err) => !controller.signal.aborted && !(err && err.status === 404) }
      );
    })
    .then((blob) => {
      if (blob && !controller.signal.aborted) {
        prefetchedBlobUrls.set(item.id, URL.createObjectURL(blob));
      }
    })
    .catch(() => {}) // aborted, or every retry failed — falls back to streaming the URL like before
    .finally(() => {
      if (blobPrefetch === entry) blobPrefetch = null;
    });
}

// Reads and removes a prefetched full-file blob URL, if one exists.
export function takePrefetchedBlobUrl(itemId) {
  const url = prefetchedBlobUrls.get(itemId);
  if (url) prefetchedBlobUrls.delete(itemId);
  return url || null;
}

// Drops everything in-flight or already downloaded — called from
// resetPlayer() (sign-out, library reset).
export function clearAllPrefetches() {
  if (blobPrefetch) blobPrefetch.controller.abort();
  blobPrefetch = null;
  for (const url of prefetchedBlobUrls.values()) URL.revokeObjectURL(url);
  prefetchedBlobUrls.clear();
  prefetchedUrls.clear();
  urlPrefetchPromises.clear();
}
