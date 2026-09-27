const fs = require("fs"), vm = require("vm");
const { flat } = require("./helpers/flatten");
process.chdir(require("path").join(__dirname, ".."));
const store = {};
const ctx = { console: { log: console.log, warn() {}, error() {} }, setTimeout, clearTimeout, Promise, Map, Set, AbortController,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  navigator: { onLine: true }, document: { hidden: false, addEventListener() {} }, window: { addEventListener() {} } };
vm.createContext(ctx);
for (const f of ["js/data/library.js", "js/data/graph.js"]) { try { vm.runInContext(flat(f), ctx); } catch (e) { /* graph.js may touch browser globals */ } }
const run = (c) => vm.runInContext(c, ctx);
let bad = 0; const check = (n, c, x = "") => { if (!c) bad++; console.log((c ? "PASS " : "FAIL ") + n + " " + x); };

function fresh() {
  run(`libraryFolderPaths = { root: "", fA: "Rock", fB: "Rock/Live", fC: "Classics" }; artistsFileSync = null;
    libraryTracks = [
      { id: "1", name: "Song.mp3", folderId: "fA", audio: null, _searchText: "song" },
      { id: "2", name: "Song.mp3", folderId: "fC", audio: null, _searchText: "song" },
      { id: "3", name: "Live One.m4a", folderId: "fB", audio: null, _searchText: "live one" },
      { id: "4", name: "Untagged.mp3", folderId: "fA", audio: null, _searchText: "untagged" },
      { id: "5", name: "New Song.mp3", folderId: "fA", audio: null, _searchText: "new song" },
      { id: "6", name: "Done.mp3", folderId: "fA", audio: { artist: "Kept" }, indexed: true, _searchText: "done kept" },
      { id: "7", name: "Rootsong.mp3", folderId: "root", audio: null, _searchText: "rootsong" },
    ];`);
}
const FILE = { version: 2, files: { "Rock/Song.mp3": "Artist A", "Classics/Song.mp3": "Artist C", "Rock/Live/Live One.m4a": "Live Guy", "Rock/Untagged.mp3": "", "Rock/Done.mp3": "Someone Else", "Rootsong.mp3": "Root Guy" } };

(async () => {
  fresh();
  const r = run(`applyArtistsFile(${JSON.stringify(FILE)})`);
  const t = (id) => run(`libraryTracks.find(t => t.id === "${id}")`);
  check("counts", r.applied === 4 && r.none === 1 && r.missing === 1, JSON.stringify(r));
  check("same song name in two folders gets each folder's own artist", t("1").audio.artist === "Artist A" && t("2").audio.artist === "Artist C");
  check("nested folder path matches", t("3").audio.artist === "Live Guy");
  check("song in the root folder matches", t("7").audio.artist === "Root Guy");
  check("empty artist = untagged: marked read, no artist", t("4").indexed === true && t("4").audio === null);
  check("song missing from the file stays for the background scan", !t("5").indexed);
  check("already-read songs are never overwritten", t("6").audio.artist === "Kept");
  check("search text now includes the artist", t("1")._searchText.includes("artist a"));
  check("matching ignores case and accents", (() => { fresh(); run(`libraryTracks[0].name = "SÓNG.mp3"`); return run(`applyArtistsFile({version:2,files:{"rock/song.mp3":"X"}})`).applied === 1; })());
  let threw = false; try { run(`applyArtistsFile({version:1})`); } catch { threw = true; }
  check("unknown file format is rejected", threw);
  fresh(); run("libraryFolderPaths = {}");
  const r2 = await run("syncArtistsFile()");
  check("no folder paths known yet (old cache): skipped quietly", r2 === null && !run("libraryTracks.some(t => t.indexed && t.id === '1')"));

  // syncArtistsFile end to end with stubs
  fresh();
  ctx.listFolder = async () => ({ folders: [], tracks: [], artistsFile: { id: "af", "@microsoft.graph.downloadUrl": "https://x/file" } });
  ctx.fetch = async () => ({ ok: true, json: async () => FILE });
  ctx.refreshDownloadUrl = async () => "https://x/fresh";
  const s1 = await run("syncArtistsFile()");
  check("sync downloads and applies the file", s1 && s1.applied === 4, JSON.stringify(s1));
  let fetches = 0; ctx.fetch = async () => { fetches++; return { ok: true, json: async () => FILE }; };
  await run("syncArtistsFile()");
  check("only once per session", fetches === 0);

  fresh(); ctx.listFolder = async () => ({ folders: [], tracks: [], artistsFile: null });
  check("no file in OneDrive: nothing happens, no error", (await run("syncArtistsFile()")) === null && run("libraryTracks.filter(t => t.indexed).length") === 1);

  fresh(); ctx.listFolder = async () => ({ folders: [], tracks: [], artistsFile: { id: "af", "@microsoft.graph.downloadUrl": "https://x/old" } });
  const seen = []; ctx.fetch = async (u) => { seen.push(u); return u.endsWith("old") ? { ok: false, status: 403 } : { ok: true, json: async () => FILE }; };
  const s3 = await run("syncArtistsFile()");
  check("expired link: fetches a fresh one and still works", s3 && s3.applied === 4 && seen.length === 2, seen.join(" "));

  fresh(); ctx.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError("bad json"); } });
  check("corrupt file: ignored, songs left for the background scan", (await run("syncArtistsFile()")) === null && run("libraryTracks.filter(t => t.indexed).length") === 1);
  ctx.fetch = async () => ({ ok: true, json: async () => FILE });
  check("...and a later attempt can still succeed", (await run("syncArtistsFile()")).applied === 4);

  fresh(); ctx.fetch = async () => { throw new TypeError("Failed to fetch"); };
  check("offline: ignored quietly", (await run("syncArtistsFile()")) === null);

  fresh(); run("libraryTracks.forEach(t => { t.indexed = true; })"); let listed = 0; ctx.listFolder = async () => { listed++; return {}; };
  await run("syncArtistsFile()");
  check("everything already read: no request at all", listed === 0);
  process.exit(bad ? 1 : 0);
})();
