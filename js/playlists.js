// Playlists are stored locally on this device only (localStorage) — there's
// no server for this app, so playlists won't sync across phones/browsers.

const PLAYLISTS_KEY = "playlists";

// A permanent, always-first playlist — can't be deleted (only cleared, with
// confirmation), same as the "Liked Songs"/"Favorites" convention in most
// mainstream music apps. Reserved ID (distinct from createPlaylist's
// "pl_"+timestamp pattern) so it's never confused with a user-created one.
const FAVORITES_PLAYLIST_ID = "favorites";

function loadPlaylists() {
  try {
    return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function savePlaylists(playlists) {
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
}

// Called once at startup — creates Favorites if this is a fresh install or an
// existing one from before Favorites existed. Unshifted (not pushed) so it
// stays first even on that one-time creation; every playlist created after
// via createPlaylist() naturally lands after it.
function ensureFavoritesPlaylist() {
  const playlists = loadPlaylists();
  if (playlists.some((p) => p.id === FAVORITES_PLAYLIST_ID)) return;
  playlists.unshift({ id: FAVORITES_PLAYLIST_ID, name: "Favorites", tracks: [] });
  savePlaylists(playlists);
}

function createPlaylist(name) {
  const playlists = loadPlaylists();
  const playlist = { id: "pl_" + Date.now(), name, tracks: [] };
  playlists.push(playlist);
  savePlaylists(playlists);
  return playlist;
}

function deletePlaylist(id) {
  if (id === FAVORITES_PLAYLIST_ID) return; // not allowed — see clearPlaylist instead
  savePlaylists(loadPlaylists().filter((p) => p.id !== id));
}

// Empties a playlist's tracks without deleting the playlist itself — the only
// way to "reset" Favorites, since deletePlaylist refuses that ID.
function clearPlaylist(id) {
  const playlists = loadPlaylists();
  const pl = playlists.find((p) => p.id === id);
  if (!pl) return;
  pl.tracks = [];
  savePlaylists(playlists);
}

function renamePlaylist(id, name) {
  if (id === FAVORITES_PLAYLIST_ID) return; // fixed name, same as it not being deletable
  const playlists = loadPlaylists();
  const pl = playlists.find((p) => p.id === id);
  if (!pl) return;
  pl.name = name;
  savePlaylists(playlists);
}

// Stores a lightweight snapshot of the track (just enough to display + play
// it later via getDownloadUrl(track), which only needs .id).
function addTrackToPlaylist(playlistId, track) {
  addTracksToPlaylist(playlistId, [track]);
}

// Bulk version — one localStorage read/write for N tracks instead of N of
// each, used when adding a whole folder's worth of songs at once. Returns
// how many were actually added (duplicates already in the playlist are skipped).
function addTracksToPlaylist(playlistId, tracks) {
  const playlists = loadPlaylists();
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl) return 0;
  const existingIds = new Set(pl.tracks.map((t) => t.id));
  let added = 0;
  tracks.forEach((track) => {
    if (existingIds.has(track.id)) return;
    pl.tracks.push({ id: track.id, name: track.name, audio: track.audio || null });
    existingIds.add(track.id);
    added++;
  });
  savePlaylists(playlists);
  return added;
}

function removeTrackFromPlaylist(playlistId, trackId) {
  const playlists = loadPlaylists();
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl) return;
  pl.tracks = pl.tracks.filter((t) => t.id !== trackId);
  savePlaylists(playlists);
}
