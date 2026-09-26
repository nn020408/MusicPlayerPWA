const fs = require("fs"), vm = require("vm");
process.chdir(require("path").join(__dirname, ".."));
const store = {};
const mk = () => ({ _l: {}, addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }, removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); } });
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Map, Set, AbortController,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  navigator: { onLine: true }, document: Object.assign(mk(), { hidden: false }), window: mk(),
  retryWithBackoff: async (fn, o = {}) => { let last; for (let i = 0; i < (o.maxAttempts || 3); i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 5)); } } throw last; } };
const raws = Array.from({ length: 30 }, (_, i) => ({ id: "s" + i, name: `S${i}.m4a`, file: { mimeType: "audio/mp4" }, "@microsoft.graph.downloadUrl": "u/s" + i }));
ctx.listFolder = async (id) => (id === "root" ? { folders: [{ id: "f" }], tracks: [] } : { folders: [], tracks: raws });
ctx.getDownloadUrl = async (t) => "u/" + t.id;
vm.createContext(ctx);
for (const f of ["js/library.js", "js/indexer.js"]) vm.runInContext(fs.readFileSync(f, "utf8"), ctx);
const run = (c) => vm.runInContext(c, ctx);
let bad = 0; const check = (n, c, x = "") => { if (!c) bad++; console.log((c ? "PASS " : "FAIL ") + n + " " + x); };
(async () => {
  run("INDEX_RETRY_PAUSE_MS = 100; indexIntervalMs = 5;");
  await run("scanLibrary()");
  // songs 3,7,11 fail for the first pass only (a rough patch), then work
  let calls = {};
  ctx.readArtist = async (url) => { const n = +url.split("/s")[1]; calls[n] = (calls[n] || 0) + 1; if ([3, 7, 11].includes(n) && calls[n] <= 3) throw new TypeError("Failed to fetch"); return "Artist"; };
  const state = await run("startIndexing()");
  const done = run("libraryTracks.filter(t => t.indexed).length");
  check("songs that failed in a rough patch are retried in the same run", state === "done" && done === 30, `indexed ${done}/30, state ${state}`);
  // a truly broken song stops after its strikes and does not loop forever
  run("libraryTracks = []; resetIndexState();"); await run("scanLibrary()"); calls = {};
  ctx.readArtist = async (url) => { if (url.endsWith("/s5")) throw new Error("corrupt"); return "Artist"; };
  const t0 = Date.now();
  const st2 = await run("startIndexing()");
  check("a genuinely bad song ends the run (no endless retry)", st2 === "done" && run("libraryTracks.filter(t => t.indexed).length") === 29 && Date.now() - t0 < 5000, `strikes ${run("indexFailCounts.get('s5')")}`);
  process.exit(bad ? 1 : 0);
})();
