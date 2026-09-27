const fs = require("fs"), vm = require("vm");
const { flat } = require("./helpers/flatten");
process.chdir(require("path").join(__dirname, ".."));
const store = {};
const doc = { hidden: true, _l: {}, addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }, removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); }, fire(t) { (this._l[t] || []).slice().forEach((f) => f()); } };
const ctx = { isNative: () => false,
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Map, Set, AbortController,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  navigator: {}, document: doc,
  retryWithBackoff: async (fn) => fn(),
  listFolder: async () => ({ tracks: [{ id: "a", "@microsoft.graph.downloadUrl": "u/a" }, { id: "b", "@microsoft.graph.downloadUrl": "u/b" }] }),
  getDownloadUrl: async () => "u", readArtist: async () => "Artist",
};
vm.createContext(ctx);
for (const f of ["js/data/library.js", "js/data/indexKeepAlive.js", "js/data/indexer.js"]) vm.runInContext(flat(f), ctx);
const run = (c) => vm.runInContext(c, ctx);
const fresh = () => run(`libraryTracks = [makeTrack({id:'a',name:'A.mp3'},'f'), makeTrack({id:'b',name:'B.mp3'},'f')]; indexFailedIds = new Set();`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (n, c, x = "") => { if (!c) bad++; console.log((c ? "PASS " : "FAIL ") + n + " " + x); };

(async () => {
  // 1. screen off, nothing playing: must NOT progress
  fresh(); ctx.wantsToPlay = false; doc.hidden = true;
  let finished = false;
  const p1 = run("startIndexing()").then(() => { finished = true; });
  await sleep(300);
  check("screen off + silent: indexing waits", !finished && run("libraryTracks.every(t => !t.indexed)"));
  // 2. screen comes back: must finish
  doc.hidden = false; doc.fire("visibilitychange");
  await p1;
  check("screen back on: indexing finishes", run("libraryTracks.every(t => t.indexed)"));

  // 3. screen off but music playing: must run straight through
  fresh(); doc.hidden = true; ctx.wantsToPlay = true;
  const t0 = Date.now();
  await run("startIndexing()");
  check("screen off + music playing: indexing runs without waiting", run("libraryTracks.every(t => t.indexed)") && Date.now() - t0 < 500, `${Date.now() - t0} ms`);

  // 4. screen off, silent, then music starts: picks up within the 2s poll
  fresh(); doc.hidden = true; ctx.wantsToPlay = false;
  const t1 = Date.now();
  const p4 = run("startIndexing()");
  await sleep(200);
  ctx.wantsToPlay = true;
  await p4;
  check("music starts while screen is off: indexing resumes by itself", run("libraryTracks.every(t => t.indexed)"), `${Date.now() - t1} ms`);
  process.exit(bad ? 1 : 0);
})();
