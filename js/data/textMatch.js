// Fuzzy text matching for online lookups (lyrics, cover art): cleaning a title
// down to the song name, picking the main artist, and scoring how well a
// candidate matches what was asked for.

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
// Splits a credit like "A / B; C & D feat. E" into its artists, in order.
export function creditedNames(artist) {
  return artist
    .split(/\s*(?:\/|;|,|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bx\b|\bvs\.?\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function primaryArtist(artist) {
  return creditedNames(artist)[0] || "";
}

// Accents are removed first, so "Díaz" and "Diaz" compare equal instead of
// turning into "d az" and "diaz".
function normalizeForCompare(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
