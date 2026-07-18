// Talks to the Microsoft Graph API to browse OneDrive and get streamable
// download URLs. Graph's @microsoft.graph.downloadUrl is a pre-authenticated,
// short-lived (~1hr) direct link — no auth header needed to actually stream it.

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

// Accepts either a relative Graph path ("/me/drive/...") or a full absolute
// URL (used for @odata.nextLink pagination, which Graph returns as a full URL).
async function graphGet(pathOrUrl) {
  const token = await getAccessToken();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : GRAPH_ROOT + pathOrUrl;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Graph request failed: ${res.status}`);
  return res.json();
}

// Revisiting a folder (breadcrumb back, reopening the app on the same
// folder, the library scan re-touching a folder already browsed) used to
// re-fetch it from Graph every single time. Cached per session — cleared
// only on an explicit rescan, since content changes are user-initiated here.
// Stores the in-flight PROMISE so concurrent callers share one request.
const folderListCache = new Map();

function clearFolderListCache() {
  folderListCache.clear();
}

// List the contents of a OneDrive folder ("root" for the top level).
// Note: deliberately no $select here — on personal OneDrive accounts,
// $select unreliably drops the @microsoft.graph.downloadUrl annotation, and
// we fetch that fresh right before playback anyway (see getDownloadUrl).
//
// Graph paginates children (~200 per page) via @odata.nextLink — folders
// with more files than that would silently lose items if we only read the
// first page, so we follow every page until exhausted.
function listFolder(folderId) {
  if (folderListCache.has(folderId)) return folderListCache.get(folderId);

  const promise = (async () => {
    let nextUrl =
      folderId === "root" ? "/me/drive/root/children" : `/me/drive/items/${folderId}/children`;
    let items = [];
    while (nextUrl) {
      const data = await graphGet(nextUrl);
      items = items.concat(data.value || []);
      nextUrl = data["@odata.nextLink"] || null;
    }

    const folders = items
      .filter((i) => i.folder)
      .sort((a, b) => a.name.localeCompare(b.name));
    const tracks = items
      .filter((i) => i.file && i.file.mimeType && i.file.mimeType.startsWith("audio/"))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { folders, tracks };
  })();

  folderListCache.set(folderId, promise);
  promise.catch(() => folderListCache.delete(folderId)); // don't cache failures
  return promise;
}

// Fetch a fresh download URL for an item. No $select is used — a plain GET
// on a personal OneDrive driveItem includes @microsoft.graph.downloadUrl by
// default, which is more reliable than trying to select it explicitly.
async function refreshDownloadUrl(itemId) {
  const data = await graphGet(`/me/drive/items/${itemId}`);
  const url = data["@microsoft.graph.downloadUrl"];
  if (!url) {
    console.error("Graph item response missing downloadUrl", data);
    throw new Error("OneDrive didn't provide a download link for this item");
  }
  return url;
}

// Always fetch fresh — download URLs are short-lived and per-request anyway.
async function getDownloadUrl(item) {
  return refreshDownloadUrl(item.id);
}

// OneDrive auto-generates thumbnails from embedded cover art for most audio
// files. Cached in-memory only for this session (thumbnail URLs are also
// short-lived, so no point persisting them).
//
// The cache stores the in-flight PROMISE, not just the resolved value — so if
// playCurrent() and the track-change UI both ask for the same track's art at
// nearly the same time, they share one network request instead of firing two.
const thumbnailCache = new Map();

function getThumbnailUrl(itemId) {
  if (thumbnailCache.has(itemId)) return thumbnailCache.get(itemId);
  const promise = (async () => {
    try {
      const data = await graphGet(`/me/drive/items/${itemId}/thumbnails`);
      const set = data.value && data.value[0];
      // "medium" is plenty for both the 44px mini-player icon and the ~340px
      // full-player art — "large" can be a much bigger download (OneDrive's
      // large thumbnails are often 800px+) for no visible benefit here.
      const pick = set && (set.medium || set.small || set.large);
      return (pick && pick.url) || null;
    } catch (err) {
      return null;
    }
  })();
  thumbnailCache.set(itemId, promise);
  return promise;
}
