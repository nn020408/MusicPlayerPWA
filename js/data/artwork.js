// Last-resort cover art: looking a song up in Apple's public music catalog and
// scoring the candidates so a wrong cover is never accepted. No screen code
// here; applying the art is ui/playerUI.js.

import { cleanTrackTitle, fieldMatchScore, primaryArtist } from "./textMatch.js";

// Same scoring discipline as scoreLyricsCandidate/LYRICS_MATCH_THRESHOLD
// in data/lyrics.js — this used to just trust iTunes' top result blindly (limit=1, no
// verification), which for less mainstream genres (regional/vallenato etc.,
// where iTunes' catalog is thin) reliably returned some other band's cover
// entirely instead of admitting "no match" and falling back to the
// placeholder. Confirmed by a user report showing 4-5 confidently wrong
// covers in a row.
function scoreArtworkCandidate(candidate, wantTitle, wantArtist) {
  let score = 0;
  score += fieldMatchScore(wantTitle, candidate.trackName, 3, 1.5);
  score += fieldMatchScore(wantArtist, candidate.artistName, 3, 1.5);
  return score;
}

const ARTWORK_MATCH_THRESHOLD = 4; // same bar as lyrics — an exact title alone isn't enough without the artist agreeing too

// Last resort: look up the song by artist/title in Apple's public music
// catalog. This is the only art source that leaves the app/OneDrive — it's a
// best-effort text match, so several candidates are scored against what was
// actually asked for rather than trusting whichever one comes back first.
export async function findOnlineArtwork(title, artist) {
  const cleanTitle = cleanTrackTitle(title);
  const cleanArtist = artist ? primaryArtist(artist) : "";
  const term = `${cleanArtist} ${cleanTitle}`.trim();
  if (!term) return null;
  try {
    const res = await fetch(`https://itunes.apple.com/search?media=music&limit=5&term=${encodeURIComponent(term)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results || [];
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of results) {
      const score = scoreArtworkCandidate(candidate, cleanTitle, cleanArtist);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best || bestScore < ARTWORK_MATCH_THRESHOLD || !best.artworkUrl100) return null;
    return best.artworkUrl100.replace("100x100", "600x600"); // ask for a bigger version than the default thumbnail
  } catch (err) {
    return null;
  }
}
