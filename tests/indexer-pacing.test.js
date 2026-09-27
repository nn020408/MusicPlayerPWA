const fs = require("fs"), vm = require("vm");
const { flat } = require("./helpers/flatten");
process.chdir(require("path").join(__dirname, ".."));
const store = {};
const mk = () => ({ _l: {}, addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }, removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); }, fire(t) { (this._l[t] || []).slice().forEach((f) => f()); } });
const doc = Object.assign(mk(), { hidden: false });
const ctx = { isNative: () => false,
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Map, Set, AbortController,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  navigator: { onLine: true }, document: doc, window: mk(),
  retryWithBackoff: async (fn, o = {}) => { let last; for (let i = 0; i < (o.maxAttempts || 3); i++) { try { return await fn(); } catch (e) { last = e; if (i < (o.maxAttempts || 3) - 1) await new Promise((r) => setTimeout(r, 5)); } } throw last; },
};
const N = 60;
const raws = Array.from({ length: N }, (_, i) => ({ id: "s" + i, name: `Song${i}.mp3`, file: { mimeType: "audio/mpeg" }, "@microsoft.graph.downloadUrl": "u/s" + i }));
ctx.listFolder = async (id) => (id === "root" ? { folders: [{ id: "f" }], tracks: [] } : { folders: [], tracks: raws });
let graphUrlCalls = 0;
ctx.getDownloadUrl = async (t) => { graphUrlCalls++; return "u/" + t.id + "?fresh"; };
vm.createContext(ctx);
for (const f of ["js/library.js", "js/indexKeepAlive.js", "js/indexer.js"]) vm.runInContext(flat(f), ctx);
const run = (c) => vm.runInContext(c, ctx);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (n, c, x = "") => { if (!c) bad++; console.log((c ? "PASS " : "FAIL ") + n + " " + x); };
const done = () => run("libraryTracks.filter(t => t.indexed).length");
async function fresh() {
  run("libraryTracks = []; resetIndexState(); indexIntervalMs = 40; indexCooldownUntil = 0; indexNextSlotAt = 0; indexConsecutiveFailures = 0; indexSuccessStreak = 0; globalThis.__throttled = 0;");
  await run("scanLibrary()");
}

(async () => {
  run("INDEX_COOLDOWN_MS = 150");

  // 1. Pacing: read starts are never closer together than the gap, whatever the concurrency
  await fresh();
  const starts = [];
  ctx.readArtist = async () => { starts.push(Date.now()); await sleep(10); return "Artist"; };
  await run("startIndexing()");
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  check("pacing: reads are spaced out (6 in flight, but never bunched up)", done() === N && avgGap >= 36, `average gap ${Math.round(avgGap)}ms for a 40ms setting, ${starts.length} reads`);

  // 2. Easing off: 4 failures in a row double the gap and take a short breather, no blame
  await fresh();
  run("indexIntervalMs = 200");
  run("for (let i = 0; i < 4; i++) noteIndexFailure();");
  check("4 failures in a row: gap doubles (200 -> 400ms)", run("indexIntervalMs") === 400);
  check("...with a short breather, not minutes", run("isIndexThrottled()") && run("indexCooldownUntil - Date.now()") <= 150);
  run("indexCooldownUntil = 0; for (let i = 0; i < 4; i++) noteIndexFailure();");
  check("keeps easing off if it keeps failing (400 -> 800ms)", run("indexIntervalMs") === 800);

  // 3. Speeding back up: every 30 successes trims the gap by 15%
  run("indexSuccessStreak = 0; for (let i = 0; i < 30; i++) noteIndexSuccess();");
  check("30 successes: gap shrinks 15% (800 -> 680ms)", run("indexIntervalMs") === 680);
  run("indexIntervalMs = 92; indexSuccessStreak = 0; for (let i = 0; i < 90; i++) noteIndexSuccess();");
  check("never gets faster than the floor", run("indexIntervalMs") === run("INDEX_INTERVAL_FLOOR_MS"));
  run("indexIntervalMs = 2000; indexCooldownUntil = 0; for (let i = 0; i < 12; i++) noteIndexFailure();");
  check("never slower than the ceiling", run("indexIntervalMs") === run("INDEX_INTERVAL_CEIL_MS"));

  // 4. A real throttling episode: the server rejects everything for a while, then recovers
  await fresh(); graphUrlCalls = 0;
  let throttleUntil = null;
  ctx.readArtist = async () => { await sleep(15); if (throttleUntil && Date.now() < throttleUntil) throw new TypeError("Failed to fetch"); return "Artist"; };
  const p = run("startIndexing({ onProgress: (p) => { if (p.state === 'throttled') globalThis.__throttled++; } })");
  await sleep(60);
  throttleUntil = Date.now() + 500;
  const state = await p;
  check("throttling episode: run finishes every song", state === "done" && done() === N, `indexed ${done()}/${N}`);
  check("throttling episode: user told it is easing off", run("globalThis.__throttled") >= 1, `${run("globalThis.__throttled")}x`);
  check("throttling episode: nobody blamed for it", run("indexFailCounts.size") === 0 && run("indexFailedIds.size") === 0);
  check("throttling episode: retries reused the links (no Graph link storm)", graphUrlCalls === 0, `graph link requests: ${graphUrlCalls}`);
  check("throttling episode: pace slowed down in response", run("indexIntervalMs") > 40, `gap now ${run("indexIntervalMs")}ms`);

  // 5. Expired link is replaced, only then
  await fresh(); graphUrlCalls = 0;
  ctx.readArtist = async (url) => { if (!url.endsWith("?fresh")) throw new Error("HTTP 403"); return "Artist"; };
  await run("startIndexing()");
  check("HTTP 403 (expired link) gets a fresh link and succeeds", done() === N && graphUrlCalls === N, `fresh links: ${graphUrlCalls}`);

  // 6. One genuinely bad file is still just a strike
  await fresh();
  ctx.readArtist = async (url) => { if (url.endsWith("/s7")) throw new Error("corrupt file"); return "Artist"; };
  await run("startIndexing()");
  check("one bad song: everything else indexed, that one struck up to the cap (3), not forever", done() === N - 1 && run("indexFailCounts.get('s7')") === 3);
  process.exit(bad ? 1 : 0);
})();
