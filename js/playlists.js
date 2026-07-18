// Playlists are stored locally on this device only (localStorage) — there's
// no server for this app, so playlists won't sync across phones/browsers.

const PLAYLISTS_KEY = "playlists";

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

function createPlaylist(name) {
  const playlists = loadPlaylists();
  const playlist = { id: "pl_" + Date.now(), name, tracks: [] };
  playlists.push(playlist);
  savePlaylists(playlists);
  return playlist;
}

function deletePlaylist(id) {
  savePlaylists(loadPlaylists().filter((p) => p.id !== id));
}

function renamePlaylist(id, name) {
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
