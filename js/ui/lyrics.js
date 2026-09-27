// Lyrics: finding them online (LRCLIB, lyrics.ovh) and the synced lyrics panel
// in the full player.

import { el } from "../core/dom.js";
import { audioEl, queue, queueIndex } from "../player/player.js";

// LRCLIB (lrclib.net) is a free, keyless, crowd-sourced lyrics API — same
// "one small request for the currently-playing track only" pattern as
// findOnlineArtwork's iTunes lookup above. Cached per track id (storing the
// in-flight promise, same pattern as thumbnailCache in graph.js) so
// re-opening the panel for a track already seen this session doesn't refetch.
const lyricsCache = new Map();

export let lyricsViewActive = false;

let currentLyrics = null;

 // { plain, synced: [{time,text}]|null, instrumental } for whatever's rendered now
// The real embedded tag read (id3.js), captured in player.onRealTags below —
// this is the exact title/artist actually shown on screen, and a more
// reliable match target than item.audio (OneDrive's lighter folder-listing
// metadata, which fetchLyricsResult falls back to when this isn't set yet).
let currentRealTags = null;

// Reset per track in onTrackChange, resolved once in onRealTags — lets a
// lyrics fetch that starts before the real tag arrives wait for it once
// instead of firing again reactively when it shows up (that was the
// double-fetch/double-"Loading lyrics…" bug).
let realTagsPromise = null;

let resolveRealTagsPromise = null;

let activeLyricsLineIndex = -1;

// A new track started: forget the previous track's real tags and set up a fresh
// promise that provideRealTags() resolves — lets a lyrics fetch started before
// the real tag arrives wait for it once instead of firing twice (fetch now with
// weak data, fetch again once better data shows up).
export function startTrackTags() {
  currentRealTags = null;
  realTagsPromise = new Promise((resolve) => {
    resolveRealTagsPromise = resolve;
  });
}

// The real embedded tag read for the current track has arrived.
export function provideRealTags(tags) {
  currentRealTags = tags;
  if (resolveRealTagsPromise) {
    resolveRealTagsPromise(tags);
    resolveRealTagsPromise = null;
  }
}

// Leaves the lyrics view (closing the full player does this, so reopening it
// always starts back on the album art).
export function closeLyricsView() {
  if (!lyricsViewActive) return;
  lyricsViewActive = false;
  el.fullPlayerArt.classList.remove("hidden");
  el.lyricsPanel.classList.add("hidden");
  el.lyricsBtn.classList.remove("icon-active");
}

// Waits briefly for the real tag read to resolve (if one's in flight for the
// current track) rather than immediately settling for weaker metadata —
// bounded so a slow/failed tag read can't hang the lyrics fetch indefinitely.
function waitForRealTags(timeoutMs) {
  if (currentRealTags) return Promise.resolve(currentRealTags);
  if (!realTagsPromise) return Promise.resolve(null);
  return Promise.race([realTagsPromise, new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
}

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

// Filenames rarely match LRCLIB's clean track titles verbatim — strips a
// leading track number ("03 - ", "03. ") and trailing tags that are clearly
// upload/quality noise, not part of the actual title ("(Official Video)",
// "[HD]", "(Lyrics)"). Loops so "Song (Official Video) [HD]" loses both.
// Deliberately conservative: things like "(Remix)" or "(feat. X)" are left
// alone since they're often genuinely part of the official title.
export function cleanTrackTitle(name) {
  let t = name.replace(/^\s*(?:track\s*)?\d{1,3}[\s._-]+/i, "");
  const trailingTag = /\s*[([]([^()[\]]{1,60})[)\]]\s*$/;
  const noiseWords = /official|video|audio|lyrics?|visualizer|hd|4k|mv\b|kbps|flac|full album/i;
  let m;
  while ((m = t.match(trailingTag)) && noiseWords.test(m[1])) {
    t = t.slice(0, m.index);
  }
  return t.replace(/\s{2,}/g, " ").trim();
}

// "Artist A feat. Artist B" / "Artist A, Artist B" / "Artist A & Artist B"
// -> "Artist A" — LRCLIB's artist_name is the primary credited artist, and
// querying with the full collab string as a single name rarely matches.
export function primaryArtist(artist) {
  return artist.split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bx\b|\bvs\.?\b)\s*/i)[0].trim();
}

function normalizeForCompare(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Plain Levenshtein edit distance — used so a real-world spelling variant
// (an extra/missing/swapped letter — e.g. a band tagged "La Etnnia" vs a
// file/query reading "La Etnia") still scores as a match. Substring
// containment (below) already covers the *other* common case, an extra
// qualifier word ("Los Inquietos" vs "Los Inquietos del Vallenato") — edit
// distance alone scores that poorly since the lengths differ a lot, so both
// checks are needed, not just one.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Shared by title and artist comparisons in both scoreLyricsCandidate and
// scoreArtworkCandidate: exact match, a clean substring relationship, or a
// close spelling variant (>=85% similar) all count as a strong match;
// anything moderately close (>=65%) counts as a partial one.
export function fieldMatchScore(want, got, exactPoints, partialPoints) {
  if (!want) return 0;
  const nWant = normalizeForCompare(want);
  const nGot = normalizeForCompare(got);
  if (!nGot) return 0;
  if (nGot === nWant) return exactPoints;
  // A one-character spelling variant on an otherwise-matching string is as
  // trustworthy as an exact match — kept as its own check rather than folded
  // into the substring one below, since it doesn't change the original
  // exact-vs-partial weighting for the substring case.
  if (similarity(nWant, nGot) >= 0.85) return exactPoints;
  if (nGot.includes(nWant) || nWant.includes(nGot) || similarity(nWant, nGot) >= 0.65) return partialPoints;
  return 0;
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

async function fetchLyricsResult(track) {
  // Prefer the real embedded tag (currentRealTags — the exact title/artist
  // shown on screen) over item.audio, OneDrive's lighter folder-listing
  // metadata that can be empty or wrong even when the real tag is fine. If
  // the tag read is still in flight for this track, wait up to 3s for it —
  // one fetch with the best available data, instead of fetching now and
  // potentially again once the real tag shows up.
  const realTags = queue[queueIndex] === track ? await waitForRealTags(3000) : null;

  const rawTitle = (realTags && realTags.title) || track.name.replace(/\.[^/.]+$/, "");
  const cleanTitle = cleanTrackTitle(rawTitle);
  const titleCandidates = [...new Set([cleanTitle, rawTitle])];

  const rawArtist = (realTags && realTags.artist) || (track.audio && track.audio.artist) || "";
  const artist = rawArtist ? primaryArtist(rawArtist) : "";
  const album = (realTags && realTags.album) || (track.audio && track.audio.album) || "";
  const duration = Math.round(audioEl.duration) || 0;

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

function getLyricsForTrack(track) {
  if (lyricsCache.has(track.id)) return lyricsCache.get(track.id);
  const promise = fetchLyricsResult(track);
  lyricsCache.set(track.id, promise);
  return promise;
}

function renderLyricsPanel(lyrics) {
  activeLyricsLineIndex = -1;
  el.lyricsPanel.innerHTML = "";
  if (lyrics.instrumental) {
    el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty">🎧 This track is instrumental — no lyrics.</p>`;
    return;
  }
  if (lyrics.synced && lyrics.synced.length) {
    lyrics.synced.forEach((line, i) => {
      const p = document.createElement("p");
      p.className = "lyrics-line";
      p.dataset.index = i;
      p.textContent = line.text || "♪";
      el.lyricsPanel.appendChild(p);
    });
    return;
  }
  if (lyrics.plain) {
    const p = document.createElement("p");
    p.className = "lyrics-plain";
    p.textContent = lyrics.plain;
    el.lyricsPanel.appendChild(p);
    return;
  }
  el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty">No lyrics found for this song.</p>`;
}

export async function showLyricsForCurrentTrack() {
  const track = queue[queueIndex];
  if (!track) return;
  currentLyrics = null;
  el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty"><span class="spinner"></span>Loading lyrics…</p>`;
  try {
    const lyrics = await getLyricsForTrack(track);
    if (queue[queueIndex] !== track || !lyricsViewActive) return; // track/view changed while fetching
    currentLyrics = lyrics;
    renderLyricsPanel(lyrics);
  } catch (err) {
    if (queue[queueIndex] !== track || !lyricsViewActive) return;
    console.error("Lyrics lookup failed", err);
    el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty">Couldn't load lyrics.</p>`;
  }
}

// Cheap linear scan (a synced lyric file is at most a couple hundred lines)
// run on the same timeupdate tick the seek bar already updates on — not a
// per-frame cost, and only does anything while the lyrics panel is open.
export function updateActiveLyricsLine(current) {
  if (!currentLyrics || !currentLyrics.synced || !currentLyrics.synced.length) return;
  const lines = currentLyrics.synced;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= current) idx = i;
    else break;
  }
  if (idx === activeLyricsLineIndex) return;
  activeLyricsLineIndex = idx;
  const prevActive = el.lyricsPanel.querySelector(".lyrics-line.active");
  if (prevActive) prevActive.classList.remove("active");
  if (idx < 0) return;
  const lineEl = el.lyricsPanel.querySelector(`.lyrics-line[data-index="${idx}"]`);
  if (lineEl) {
    lineEl.classList.add("active");
    lineEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function toggleLyricsView() {
  lyricsViewActive = !lyricsViewActive;
  el.fullPlayerArt.classList.toggle("hidden", lyricsViewActive);
  el.lyricsPanel.classList.toggle("hidden", !lyricsViewActive);
  el.lyricsBtn.classList.toggle("icon-active", lyricsViewActive);
  if (lyricsViewActive) showLyricsForCurrentTrack();
}

el.lyricsBtn.addEventListener("click", toggleLyricsView);