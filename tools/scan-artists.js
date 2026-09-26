// Reads the artist tag of every song in the local copy of the music library
// and writes nubeplayer-artists.json into the library's root folder. OneDrive
// syncs that file to the cloud like any other, and NubePlayer downloads it in
// a single request to fill in almost every artist at once, instead of reading
// thousands of files over the network (which OneDrive rate-limits).
//
//   node scan-artists.js "E:\OneDrive\Music"
//
// Safe to run as often as you like: only new or changed files are re-read
// (remembered in tools/.artists-cache.json), so a re-run takes a few seconds,
// and the output file is only rewritten when something actually changed, so
// OneDrive isn't asked to upload it again for nothing. See
// install-artists-task.ps1 to run it automatically.
//
// The app treats the file as a shortcut, never a requirement: songs that
// aren't in it (or if it's missing) are read by the app's own background scan.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const OUT_NAME = "nubeplayer-artists.json";
const CACHE_FILE = path.join(__dirname, ".artists-cache.json");
const AUDIO = new Set([".mp3", ".m4a", ".flac", ".ogg", ".opus", ".wav", ".aac", ".wma"]);

const root = process.argv[2];
if (!root || !fs.existsSync(root)) {
  console.error(`Music folder not found: ${root || "(none given)"}`);
  console.error('Usage: node scan-artists.js "E:\\OneDrive\\Music"');
  process.exit(1);
}

// The app's own tag reader (js/id3.js), pointed at local files instead of
// HTTP: the artists it finds here are exactly what the app would have read.
function loadAppReader() {
  const ctx = { console, TextDecoder, Uint8Array, Error, Promise, Math, Number, AbortController, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "id3.js"), "utf8"), ctx);
  ctx.readByteRange = async (file, start, length) => {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      if (start >= size) throw new Error("HTTP 416");
      const n = Math.min(length, size - start);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, start);
      return new Uint8Array(buf);
    } finally {
      fs.closeSync(fd);
    }
  };
  return ctx.readArtistFast;
}

function* walk(dir, rel) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    console.error("Skipping unreadable folder:", dir);
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walk(full, relPath);
    else if (AUDIO.has(path.extname(e.name).toLowerCase())) yield { full, rel: relPath };
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const started = Date.now();
  const files = [...walk(root, "")];
  // A missing/unmounted drive looks like an empty library. Never replace a
  // good file with an empty one because of that.
  if (!files.length) {
    console.error("No audio files found - leaving everything as it is.");
    process.exit(1);
  }

  const readArtistFast = loadAppReader();
  let fallbackReader = null;
  async function readWithFallback(file) {
    const fast = await readArtistFast(file);
    if (fast !== null) return fast;
    // Formats the app's quick reader doesn't handle (FLAC, ID3v2.2...).
    if (!fallbackReader) fallbackReader = (await import("music-metadata")).parseFile;
    const meta = await fallbackReader(file, { skipCovers: true, duration: false });
    const c = meta.common;
    return ((c.artists && c.artists.length > 1 ? c.artists.join("; ") : c.artist) || "").trim();
  }

  const cache = readJson(CACHE_FILE, {}); // rel path -> { size, mtimeMs, artist }
  const nextCache = {};
  const result = {};
  let reused = 0;
  let read = 0;
  const unreadable = [];

  const queue = [...files];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const f = queue.shift();
        let stat;
        try {
          stat = fs.statSync(f.full);
        } catch {
          unreadable.push(f.rel);
          continue;
        }
        const known = cache[f.rel];
        if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) {
          nextCache[f.rel] = known;
          result[f.rel] = known.artist;
          reused++;
          continue;
        }
        try {
          const artist = await readWithFallback(f.full);
          nextCache[f.rel] = { size: stat.size, mtimeMs: stat.mtimeMs, artist };
          result[f.rel] = artist;
          read++;
        } catch {
          // Still downloading from OneDrive, locked, or damaged: leave it out
          // (the app reads it itself) and look again next run.
          unreadable.push(f.rel);
        }
      }
    })
  );

  fs.writeFileSync(CACHE_FILE, JSON.stringify(nextCache));

  const sorted = Object.fromEntries(Object.keys(result).sort().map((k) => [k, result[k]]));
  const outFile = path.join(root, OUT_NAME);
  const previous = readJson(outFile, null);
  const unchanged = previous && JSON.stringify(previous.files) === JSON.stringify(sorted);
  if (!unchanged) {
    const tmp = outFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ version: 2, createdAt: new Date().toISOString(), files: sorted }));
    fs.renameSync(tmp, outFile);
  }

  const withArtist = Object.values(sorted).filter(Boolean).length;
  console.log(
    `${new Date().toISOString()}  ${files.length} songs: ${reused} unchanged, ${read} read, ${unreadable.length} skipped. ` +
      `${withArtist} with an artist, ${files.length - unreadable.length - withArtist} without. ` +
      `${unchanged ? "File already up to date" : "File written"} (${Math.round((Date.now() - started) / 1000)}s).`
  );
  unreadable.slice(0, 5).forEach((f) => console.log("  skipped: " + f));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
