const fs = require("fs"), vm = require("vm");
process.chdir(require("path").join(__dirname, ".."));
const store = {};
const ctx = { isNative: () => false,
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Map, Set, AbortController,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  navigator: {}, document: { hidden: false, addEventListener() {}, removeEventListener() {} },
  retryWithBackoff: async (fn) => fn(),
};
const raw = (id, name) => ({ id, name, file: { mimeType: "audio/mpeg" }, "@microsoft.graph.downloadUrl": "u/" + id });
const tree = { root: { folders: [{ id: "f" }], tracks: [] }, f: { folders: [], tracks: [raw("a", "One.mp3"), raw("b", "Two.mp3"), raw("c", "Three.mp3")] } };
let reads = 0;
ctx.listFolder = async (id) => tree[id];
ctx.getDownloadUrl = async (t) => "u/" + t.id;
ctx.readArtist = async () => { reads++; return "Selena Gomez"; };
vm.createContext(ctx);
for (const f of ["js/library.js", "js/indexKeepAlive.js", "js/indexer.js"]) vm.runInContext(fs.readFileSync(f, "utf8"), ctx);
const run = (c) => vm.runInContext(c, ctx);
let bad = 0;
const check = (n, c, x = "") => { if (!c) bad++; console.log((c ? "PASS " : "FAIL ") + n + " " + x); };

(async () => {
  await run("scanLibrary()");
  await run("startIndexing()");
  check("fully indexed first", run("libraryTracks.every(t => t.indexed)") && reads === 3, `reads=${reads}`);

  // plain rescan keeps artists (unchanged behaviour)
  reads = 0;
  await run("scanLibrary()"); await run("startIndexing()");
  check("plain rescan keeps artists and re-reads nothing", reads === 0 && run("searchLibrary('selena').length") === 3);

  // reset: starts from zero
  run("indexFailedIds.add('a')"); // a stale failure from before the reset
  run("resetLibrary(); resetIndexState();");
  check("reset empties the library and the saved cache", run("libraryTracks.length") === 0 && run("localStorage.getItem(LIBRARY_CACHE_KEY)") === null);
  check("reset removes artist search results", run("searchLibrary('selena').length") === 0 && run("getArtists().length") === 0);
  reads = 0;
  await run("scanLibrary()");
  check("fresh scan after reset has no artists carried over", run("libraryTracks.every(t => !t.indexed && !t.audio)"));
  await run("startIndexing()");
  check("every song read again from scratch, incl. the one that failed before the reset", reads === 3 && run("libraryTracks.every(t => t.indexed)"), `reads=${reads}`);
  process.exit(bad ? 1 : 0);
})();
