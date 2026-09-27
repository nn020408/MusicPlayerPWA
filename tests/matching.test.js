// The pure lookup logic behind lyrics and cover art (js/data/textMatch.js,
// lyrics.js, artwork.js): cleaning titles, picking the main artist, scoring
// candidates, and the online lookups themselves against a fake network. These
// modules have no screen code, so they import straight into Node.
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const load = (rel) => import(pathToFileURL(path.join(ROOT, "js", "data", rel)).href);
let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

// A fake network: routes by URL, records every request.
const requests = [];
let routes = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  requests.push(u);
  for (const [test, respond] of routes) if (test(u)) return respond(u);
  return { ok: false, status: 404, json: async () => ({}) };
};
const json = (body) => ({ ok: true, status: 200, json: async () => body });

(async () => {
  const { cleanTrackTitle, primaryArtist, fieldMatchScore } = await load("textMatch.js");

  check("title: a leading track number is dropped", cleanTrackTitle("03 - Hips Don't Lie") === "Hips Don't Lie");
  check("title: '04. ' style numbers too, and (Lyrics) tags", cleanTrackTitle("04. Wonderwall (Lyrics)") === "Wonderwall");
  check("title: several trailing tags are all dropped", cleanTrackTitle("Song (Official Video) [HD]") === "Song");
  check("title: a plain title is left alone", cleanTrackTitle("Enter Sandman") === "Enter Sandman");
  check("artist: 'A & B' is credited to A", primaryArtist("Selena Gomez & Rauw Alejandro") === "Selena Gomez");
  check("artist: 'feat.' guests are dropped", primaryArtist("Shakira feat. Wyclef Jean") === "Shakira");
  check("artist: a solo artist is unchanged", primaryArtist("Metallica") === "Metallica");
  check("score: exact match earns full points", fieldMatchScore("Metallica", "Metallica", 3, 1.5) === 3);
  check("score: a partial match earns the partial points", fieldMatchScore("Metallica", "Metallica & Friends", 3, 1.5) === 1.5);
  check("score: a different name earns nothing", fieldMatchScore("Metallica", "Slayer", 3, 1.5) === 0);
  check("score: accents don't matter", fieldMatchScore("Celedón", "Celedon", 3, 1.5) === 3);
  check("score: nothing to compare scores nothing", fieldMatchScore("", "Anything", 3, 1.5) === 0);

  // ---- cover art (Apple's catalog): only a confident match is accepted
  const { findOnlineArtwork } = await load("artwork.js");
  const itunes = (results) => [(u) => u.startsWith("https://itunes.apple.com/search"), () => json({ results })];
  routes = [itunes([{ trackName: "Enter Sandman", artistName: "Metallica", artworkUrl100: "https://img/100x100bb.jpg" }])];
  check("artwork: a matching song gives a larger cover", (await findOnlineArtwork("Enter Sandman", "Metallica")) === "https://img/600x600bb.jpg");
  routes = [itunes([{ trackName: "Enter Sandman", artistName: "Some Cover Band", artworkUrl100: "https://img/100x100bb.jpg" }])];
  check("artwork: right title but the wrong artist is rejected", (await findOnlineArtwork("Enter Sandman", "Metallica")) === null);
  routes = [itunes([{ trackName: "Other", artistName: "Other", artworkUrl100: "https://img/100x100bb.jpg" }])];
  check("artwork: an unrelated result is rejected", (await findOnlineArtwork("Enter Sandman", "Metallica")) === null);
  routes = [itunes([
    { trackName: "Enter Sandman", artistName: "Some Cover Band", artworkUrl100: "https://img/wrong100x100.jpg" },
    { trackName: "Enter Sandman", artistName: "Metallica", artworkUrl100: "https://img/right100x100.jpg" },
  ])];
  check("artwork: the best-scored candidate wins, not the first", (await findOnlineArtwork("Enter Sandman", "Metallica")) === "https://img/right600x600.jpg");
  routes = [[() => true, () => { throw new TypeError("Failed to fetch"); }]];
  check("artwork: a network failure just means no cover", (await findOnlineArtwork("Enter Sandman", "Metallica")) === null);

  // ---- lyrics
  const { getLyricsForTrack } = await load("lyrics.js");
  const lrc = "[offset: 500]\n[00:10.00] First line\n[00:20.50] Second line\n[00:15.00][00:30.00] Chorus";
  const track = (id, name, artist) => ({ id, name, audio: artist ? { artist } : null });
  const sources = (tags, duration = 210) => ({ getRealTags: async () => tags, getDuration: () => duration });

  requests.length = 0;
  routes = [[(u) => u.startsWith("https://lrclib.net/api/get"), () => json({ plainLyrics: "First line\nSecond line", syncedLyrics: lrc })]];
  const first = await getLyricsForTrack(track("t1", "Enter Sandman.mp3", "Metallica"), sources({ title: "Enter Sandman", artist: "Metallica", album: "Metallica" }));
  check("lyrics: synced lyrics are parsed, sorted, and repeated tags expanded", first.synced.length === 4 && first.synced[0].text === "First line" && first.synced.filter((l) => l.text === "Chorus").length === 2);
  check("lyrics: the [offset] tag shifts every time (500ms earlier)", Math.abs(first.synced[0].time - 9.5) < 1e-9, String(first.synced[0].time));
  check("lyrics: the plain text comes along", first.plain === "First line\nSecond line");
  const getUrl = requests.find((u) => u.includes("/api/get"));
  check("lyrics: the lookup uses the real tag's title, artist, album and the song length", /track_name=Enter\+Sandman/.test(getUrl) && /artist_name=Metallica/.test(getUrl) && /album_name=Metallica/.test(getUrl) && /duration=210/.test(getUrl), getUrl);
  const before = requests.length;
  await getLyricsForTrack(track("t1", "Enter Sandman.mp3", "Metallica"), sources(null));
  check("lyrics: asking again for the same song costs no requests", requests.length === before);

  requests.length = 0;
  routes = [[(u) => u.startsWith("https://lrclib.net/api/get"), () => json({ plainLyrics: null, syncedLyrics: null, instrumental: true })]];
  const inst = await getLyricsForTrack(track("t2", "Interlude.mp3", "Someone"), sources(null));
  check("lyrics: an instrumental is reported as one", inst.instrumental === true);

  // real tags beat the file name and OneDrive's metadata when both exist
  requests.length = 0;
  routes = [[(u) => u.startsWith("https://lrclib.net/api/get"), () => json({ plainLyrics: "x", syncedLyrics: null })]];
  await getLyricsForTrack(track("t3", "track01.mp3", "Wrong Artist"), sources({ title: "Real Title", artist: "Real Artist" }));
  check("lyrics: the embedded tag is preferred over the file name and listing metadata", /track_name=Real\+Title/.test(requests[0]) && /artist_name=Real\+Artist/.test(requests[0]), requests[0]);

  // nothing on LRCLIB: falls back to lyrics.ovh (plain text only)
  requests.length = 0;
  routes = [
    [(u) => u.startsWith("https://lrclib.net/"), () => ({ ok: false, status: 404, json: async () => ({}) })],
    [(u) => u.startsWith("https://api.lyrics.ovh/"), () => json({ lyrics: "Plain fallback lyrics" })],
  ];
  const fb = await getLyricsForTrack(track("t4", "Obscure.mp3", "Obscure Band"), sources(null));
  check("lyrics: with nothing on LRCLIB, lyrics.ovh supplies plain text", fb.plain === "Plain fallback lyrics" && fb.synced === null && requests.some((u) => u.startsWith("https://api.lyrics.ovh/")));

  routes = [[() => true, () => { throw new TypeError("Failed to fetch"); }]];
  const none = await getLyricsForTrack(track("t5", "Offline.mp3", "Nobody"), sources(null));
  check("lyrics: offline just means no lyrics, not an error", none.plain === null && none.synced === null && none.instrumental === false);

  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL matching test crashed: " + (e && e.stack || e)); process.exit(1); });
