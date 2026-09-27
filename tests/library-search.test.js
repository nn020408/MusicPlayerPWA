const fs = require("fs"), vm = require("vm");
process.chdir(require("path").join(__dirname, ".."));

const store = {};
const ctx = { isNative: () => false,
  console, setTimeout, clearTimeout, Promise, Map, Set, AbortController,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  navigator: {},
  document: { hidden: false, addEventListener() {}, removeEventListener() {} },
  retryWithBackoff: async (fn, o = {}) => { let last; for (let i = 0; i < (o.maxAttempts || 3); i++) { try { return await fn(); } catch (e) { last = e; } } throw last; },
};
vm.createContext(ctx);

// Fake OneDrive: 3 folders. "kids" is first in the library, "vallenato" is the one on screen.
const raw = (id, name) => ({ id, name, file: { mimeType: "audio/mpeg" }, "@microsoft.graph.downloadUrl": "http://dl/" + id });
const tree = {
  root: { folders: [{ id: "kids" }, { id: "vallenato" }, { id: "pop" }], tracks: [] },
  kids: { folders: [], tracks: [raw("k1", "Baby Shark.mp3")] },
  vallenato: { folders: [], tracks: [raw("v1", "Cuatro Rosas.mp3"), raw("v2", "El Amor Es Asi, Jorge Celedon.mp3"), raw("v3", "Hasta Que Tu Regreses.mp3"), raw("v4", "Sin Etiqueta.mp3")] },
  pop: { folders: [], tracks: [raw("p1", "Love You Like A Love Song.mp3"), raw("p2", "AC-DC Thunder.mp3"), raw("p3", "Fruko.mp3")] },
};
const tags = {
  k1: "Cocomelon", v1: "Jorge Celedón & Jimmy Zambrano", v2: "Jorge Celedón Con El Binomio De Oro De América",
  v3: "Embrujo Vallenato", v4: "", p1: "Selena Gómez & The Scene", p2: "AC/DC", p3: "Fruko y sus Tesos",
};
const readOrder = [];
ctx.listFolder = async (id) => tree[id];
ctx.getDownloadUrl = async (t) => "http://dl/" + t.id;
ctx.readArtist = async (url) => { const id = url.split("/").pop(); readOrder.push(id); return tags[id]; };

for (const f of ["js/library.js", "js/indexKeepAlive.js", "js/indexer.js"]) vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
const run = (code) => vm.runInContext(code, ctx);

let failures = 0;
const check = (name, cond, extra = "") => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

(async () => {
  await run("scanLibrary()");
  check("scan finds all 8 songs, each remembers its folder", run("libraryTracks.length") === 8 && run("libraryTracks.every(t => t.folderId)"));
  check("before indexing, artist search finds nothing", run("searchLibrary('selena').length") === 0);
  check("before indexing, song-name search works", run("searchLibrary('baby shark').length") === 1);

  run("indexPriorityFolderId = 'vallenato'"); // the folder on screen
  const state = await run("startIndexing()");
  check("indexer finishes", state === "done", state);
  check("visible-first: the folder on screen was read before the others", readOrder.slice(0, 4).every((id) => id.startsWith("v")), readOrder.join(","));
  check("every song marked indexed", run("libraryTracks.every(t => t.indexed)"));

  check("'jorge celed' (partial, no accent) finds both Celedón songs", run("searchLibrary('jorge celed').map(t=>t.id).sort().join()") === "v1,v2");
  check("'CELEDÓN' with accent and caps also matches", run("searchLibrary('CELEDÓN').length") === 2);
  check("words in any order: 'zambrano jorge'", run("searchLibrary('zambrano jorge').length") === 1);
  check("finds Selena by artist", run("searchLibrary('selena gomez').map(t=>t.id).join()") === "p1");
  check("file extension no longer matches 'mp3'", run("searchLibrary('mp3').length") === 0);

  const names = run("getArtists().map(a => a.name)");
  check("Jorge Celedón is one artist across both credits", names.filter((n) => /Jorge Celed/.test(n)).length === 1, JSON.stringify(names));
  check("collaborators become artists too (Jimmy Zambrano, El Binomio De Oro De América)", names.includes("Jimmy Zambrano") && names.includes("El Binomio De Oro De América"));
  check("AC/DC is NOT split", names.includes("AC/DC") && !names.includes("AC"));
  check("'Fruko y sus Tesos' is NOT split on Spanish y", names.includes("Fruko y sus Tesos") && !names.includes("sus Tesos"));
  check("Jorge Celedón artist page lists both songs", run("songsByArtistKey('jorge celedon').length") === 2);
  check("artist search 'jorge' returns Jorge Celedón", run("searchArtists('jorge').some(a => a.key === 'jorge celedon')"));

  // Persistence + rescan keeps indexed artists (no re-reading)
  const before = run("libraryTracks.filter(t=>t.indexed).length");
  readOrder.length = 0;
  await run("scanLibrary()");
  check("rescan carries over artists already read", run("searchLibrary('selena').length") === 1 && run("libraryTracks.every(t => t.indexed)"), `indexed before=${before}`);
  const state2 = await run("startIndexing()");
  check("nothing left to read after a rescan", readOrder.length === 0, readOrder.join(","));
  check("cache restores with artists", run("loadCachedLibrary() && searchLibrary('selena').length === 1"));

  // Stop + resume
  run("libraryTracks.forEach(t => { delete t.indexed; t.audio = null; })");
  readOrder.length = 0;
  ctx.readArtist = async (url) => { const id = url.split("/").pop(); readOrder.push(id); if (readOrder.length === 3) run("stopLibraryWork()"); return tags[id]; };
  const stopped = await run("startIndexing()");
  const doneAtStop = run("libraryTracks.filter(t=>t.indexed).length");
  check("stop is honoured and reported", stopped === "stopped" && doneAtStop < 8, `state=${stopped}, indexed=${doneAtStop}/8`);
  ctx.readArtist = async (url) => { const id = url.split("/").pop(); readOrder.push(id); return tags[id]; };
  readOrder.length = 0;
  const resumed = await run("startIndexing({ force: true })");
  check("resume finishes only the remainder", resumed === "done" && readOrder.length === 8 - doneAtStop && run("libraryTracks.every(t=>t.indexed)"), `re-read ${readOrder.length}`);

  // A song that fails is left un-indexed (retried next session), and doesn't hang the loop
  run("libraryTracks.forEach(t => { delete t.indexed; t.audio = null; })");
  ctx.readArtist = async (url) => { const id = url.split("/").pop(); if (id === "p3") throw new Error("network"); return tags[id]; };
  const partial = await run("startIndexing({ force: true })");
  check("failed song doesn't hang the run; it stays un-indexed for next time", partial === "done" && run("libraryTracks.filter(t=>!t.indexed).map(t=>t.id).join()") === "p3");

  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
