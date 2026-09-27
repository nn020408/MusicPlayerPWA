// Finding lyrics online: LRCLIB (synced and plain) first, then lyrics.ovh as a
// plain-text fallback. Candidates are scored against the song's title, artist
// and length so a low-confidence guess is never shown as a match. No screen code
// here; the panel lives in ui/lyrics.js.

import { cleanTrackTitle, fieldMatchScore, primaryArtist } from "./textMatch.js";

// LRCLIB (lrclib.net) is a free, keyless, crowd-sourced lyrics API — same
// "one small request for the currently-playing track only" pattern as
// findOnlineArtwork's iTunes lookup in data/artwork.js. Cached per track id (storing the
// in-flight promise, same pattern as thumbnailCache in graph.js) so
// re-opening the panel for a track already seen this session doesn't refetch.
const lyricsCache = new Map();

function parseSyncedLyrics(lrc) {
  const lines = [];
  const timeTag = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\]/g;
  // Some LRC files carry an [offset:+/-ms] metadata tag to correct for the
  // specific rip/encode they were timed against — silently ignoring this
  // was a real source of "lyrics don't quite match the position" reports,
  // not just crowd-sourced timestamp inaccuracy. Per the (informal) LRC
  // convention, a positive offset means the tag times run late, so it's
  // subtracted to land on the actual audio position.
  const offsetMatch = lrc.match(/\[offset:\s*([+-]?\d+)\]/i);
  const offsetSeconds = offsetMatch ? parseInt(offsetMatch[1], 10) / 1000 : 0;
  lrc.split("\n").forEach((line) => {
    const matches = [...line.matchAll(timeTag)];
    if (!matches.length) return;
    const text = line.replace(timeTag, "").trim();
    matches.forEach((m) => {
      lines.push({ time: parseInt(m[1], 10) * 60 + parseFloat(m[2]) - offsetSeconds, text });
    });
  });
  return lines.sort((a, b) => a.time - b.time);
}

// Used only against /api/search results, which can return several loosely-
// matched candidates (covers, live versions, other songs with a similar
// title) — blindly trusting index 0 was a real source of wrong lyrics.
// Scores each candidate against what we actually asked for and only accepts
// the best one if it clears a minimum bar, rather than always showing
// *something*.
function scoreLyricsCandidate(candidate, wantTitle, wantArtist, wantDuration) {
  let score = 0;
  score += fieldMatchScore(wantTitle, candidate.trackName, 3, 1.5);
  score += fieldMatchScore(wantArtist, candidate.artistName, 3, 1.5);

  if (wantDuration && candidate.duration) {
    const diff = Math.abs(candidate.duration - wantDuration);
    if (diff <= 2) score += 2;
    else if (diff <= 6) score += 1;
    else if (diff > 20) score -= 2; // almost certainly a different recording
  }
  return score;
}

// A lone exact title match (worth 3) used to clear this on its own — the
// bug that showed unrelated Spanish rap lyrics for a vallenato track called
// "Casualidad" ("coincidence"): common enough as a title that it collides
// across genres, and with no artist tag on the file to corroborate against,
// title-only was the *only* signal available. Raised so an exact title match
// needs at least a partial second signal (artist or duration) to pass —
// title alone, or artist alone, is no longer enough by itself.
const LYRICS_MATCH_THRESHOLD = 4;

async function lrclibGet(params) {
  try {
    const res = await fetch(`https://lrclib.net/api/get?${params}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function lrclibSearch(params) {
  try {
    const res = await fetch(`https://lrclib.net/api/search?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function bestScoredMatch(results, wantTitle, wantArtist, wantDuration) {
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of results) {
    const score = scoreLyricsCandidate(candidate, wantTitle, wantArtist, wantDuration);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= LYRICS_MATCH_THRESHOLD ? best : null;
}

// LRCLIB is a smaller, mostly community/synced-lyrics-focused database — some
// perfectly ordinary songs just aren't in it at all (not a matching problem,
// a coverage gap). lyrics.ovh is a free, keyless, plain-text-only lyrics API
// with broader mainstream/older-catalog coverage, tried only after LRCLIB's
// own 4-strategy cascade below has already come up completely empty. No
// synced timestamps, and no alternate candidates to score against (it's a
// direct lookup, not a search), so this is strictly a last resort.
async function lyricsOvhGet(artist, title) {
  try {
    const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.lyrics || null;
  } catch {
    return null;
  }
}

// sources: { getRealTags(), getDuration() } — where the caller gets the real embedded tag
// (a promise, possibly waiting for the tag read to finish) and the song's length in
// seconds. Called only when a fetch is really needed, so a cached track costs nothing.
async function fetchLyricsResult(track, sources) {
  // Prefer the real embedded tag (currentRealTags — the exact title/artist
  // shown on screen) over item.audio, OneDrive's lighter folder-listing
  // metadata that can be empty or wrong even when the real tag is fine. If
  // the tag read is still in flight for this track, wait up to 3s for it —
  // one fetch with the best available data, instead of fetching now and
  // potentially again once the real tag shows up.
  const realTags = await sources.getRealTags();

  const rawTitle = (realTags && realTags.title) || track.name.replace(/\.[^/.]+$/, "");
  const cleanTitle = cleanTrackTitle(rawTitle);
  const titleCandidates = [...new Set([cleanTitle, rawTitle])];

  const rawArtist = (realTags && realTags.artist) || (track.audio && track.audio.artist) || "";
  const artist = rawArtist ? primaryArtist(rawArtist) : "";
  const album = (realTags && realTags.album) || (track.audio && track.audio.album) || "";
  const duration = sources.getDuration();

  let hit = null;

  // 1) Exact match on the cleaned title — most precise when it works.
  if (!hit && artist) {
    const params = new URLSearchParams({ track_name: cleanTitle, artist_name: artist });
    if (album) params.set("album_name", album);
    if (duration) params.set("duration", String(duration));
    hit = await lrclibGet(params);
  }
  // 2) Same, but without duration — covers a different reference recording
  //    (radio edit vs. album version) being a few seconds off.
  if (!hit && artist && duration) {
    const params = new URLSearchParams({ track_name: cleanTitle, artist_name: artist });
    if (album) params.set("album_name", album);
    hit = await lrclibGet(params);
  }
  // 3) Fuzzy search, scored — try each title candidate until one clears the
  //    confidence bar, instead of trusting whichever result LRCLIB ranks
  //    first.
  for (const title of titleCandidates) {
    if (hit) break;
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const results = await lrclibSearch(params);
    hit = bestScoredMatch(results, cleanTitle, artist, duration);
  }
  // 4) Last resort: title only, no artist constraint (covers a missing/wrong
  //    artist tag) — still scored, so a low-confidence guess doesn't slip
  //    through as if it were a real match.
  if (!hit && artist) {
    const params = new URLSearchParams({ track_name: cleanTitle });
    const results = await lrclibSearch(params);
    hit = bestScoredMatch(results, cleanTitle, "", duration);
  }

  if (hit) {
    return {
      plain: hit.plainLyrics || null,
      synced: hit.syncedLyrics ? parseSyncedLyrics(hit.syncedLyrics) : null,
      instrumental: !!hit.instrumental,
    };
  }

  // 5) LRCLIB has nothing at all for this track — try the broader-coverage
  // plain-text fallback before giving up (see lyricsOvhGet above).
  const plainFallback = artist && cleanTitle ? await lyricsOvhGet(artist, cleanTitle) : null;
  return { plain: plainFallback, synced: null, instrumental: false };
}

export function getLyricsForTrack(track, sources) {
  if (lyricsCache.has(track.id)) return lyricsCache.get(track.id);
  const promise = fetchLyricsResult(track, sources);
  lyricsCache.set(track.id, promise);
  return promise;
}
