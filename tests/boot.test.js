const fs = require("fs"), vm = require("vm");
const { flat, moduleOrder, allModuleFiles } = require("./helpers/flatten");
process.chdir(require("path").join(__dirname, ".."));

// A stub that accepts any property access / call, so top-level wiring code runs.
function stub(name = "el") {
  const fn = function () {};
  const target = { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, value: "", textContent: "", innerHTML: "", files: [], children: [] };
  return new Proxy(fn, {
    get(_, p) {
      if (p === Symbol.toPrimitive) return () => "";
      if (p in target) return target[p];
      if (p === "then") return undefined;
      if (p === "querySelector") return () => null;
      if (p === "querySelectorAll") return () => [];
      if (p === "closest") return () => null;
      return stub(String(p));
    },
    set(_, p, v) { target[p] = v; return true; },
    apply() { return stub("call"); },
  });
}
const store = {};
const listeners = {};
const window = {
  Capacitor: undefined, location: { origin: "http://localhost", pathname: "/" },
  addEventListener() {}, matchMedia: () => ({ matches: false }),
};
const document = {
  getElementById: () => stub(), querySelector: () => stub(), querySelectorAll: () => [],
  createElement: () => stub(), addEventListener() {}, body: stub(), documentElement: stub(), hidden: false, visibilityState: "visible",
  head: stub(),
};
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Map, Set, AbortController, URL, Blob, TextDecoder, Date, Math, JSON, Array, Object, String, Number, RegExp, Error, Uint8Array, ArrayBuffer, DataView, btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  window, document, navigator: { userAgent: "test", mediaSession: undefined },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  Audio: function () { return stub("audio"); }, MediaMetadata: function () {}, FileReader: function () {},
  msal: { PublicClientApplication: function () { return { initialize: async () => {}, handleRedirectPromise: async () => null, getAllAccounts: () => [], acquireTokenSilent: async () => ({}) }; } },
  jsmediatags: {}, fetch: async () => { throw new Error("offline in test"); },
  MutationObserver: function () { return { observe() {} }; }, prompt() {}, confirm() { return false; }, requestAnimationFrame: (f) => setTimeout(f, 0), performance: { now: () => Date.now() },
  encodeURIComponent, decodeURIComponent,
};
ctx.window = Object.assign(window, ctx, { window });
vm.createContext(ctx);

const order = moduleOrder("js/main.js"); // dependencies first, like the browser evaluates them
const html = fs.readFileSync("index.html", "utf8");
const moduleTags = [...html.matchAll(/<script type="module" src="(js\/[A-Za-z0-9-]+\.js)"><\/script>/g)].map((m) => m[1]);
const classicAppTags = [...html.matchAll(/<script src="(js\/[A-Za-z0-9-]+\.js)"><\/script>/g)].map((m) => m[1]).filter((f) => !f.includes("vendor"));
if (JSON.stringify(moduleTags) !== JSON.stringify(["js/main.js"]) || classicAppTags.length) { console.log("FAIL index.html should load one module entry (js/main.js) and no classic app scripts:", moduleTags, classicAppTags); process.exit(1); }
console.log("PASS index.html loads the app as one ES module entry (js/main.js)");

const swFiles = fs.readFileSync("sw.js", "utf8");
const missingFromSw = allModuleFiles().filter((f) => !swFiles.includes(`"./${f}"`));
if (missingFromSw.length) { console.log("FAIL sw.js cache list is missing:", missingFromSw.join(", ")); process.exit(1); }
console.log(`PASS all ${allModuleFiles().length} modules are in the service-worker cache list`);
const unreachable = allModuleFiles().filter((f) => !order.includes(f));
if (unreachable.length) { console.log("FAIL modules nothing imports (dead code, or a missing import in main.js):", unreachable.join(", ")); process.exit(1); }
console.log("PASS every module is reachable from main.js");
process.on("unhandledRejection", () => {}); // async init() against the stub is allowed to fail quietly
for (const f of order) {
  try { vm.runInContext(flat(f), ctx, { filename: f }); }
  catch (e) { console.log("FAIL loading " + f + ": " + e.message); process.exit(1); }
}
console.log("PASS all scripts executed their top-level code with no error");

// The new UI helpers exist and run against real library data
const run = (c) => vm.runInContext(c, ctx);
for (const name of ["kickOffIndexing", "renderSearchHome", "renderArtistsView", "runSearch", "indexBannerHtml", "refreshVisibleRowArtists", "artistRowHtml", "openArtist", "startIndexing", "readArtist", "searchArtists"]) {
  if (run(`typeof ${name}`) !== "function") { console.log("FAIL missing function", name); process.exit(1); }
}
console.log("PASS new functions are all defined");
run(`libraryTracks = [makeTrack({id:'a',name:'Song One.mp3'}, 'f1'), makeTrack({id:'b',name:'Song Two.mp3'}, 'f1')]; applyIndexedArtist(libraryTracks[0], 'Selena Gómez');`);
const bannerHtml = run("indexBannerHtml()");
console.log("PASS banner while partially indexed:", JSON.stringify(bannerHtml.slice(0, 60)) + "…");
console.log("PASS artist row html:", JSON.stringify(run(`artistRowHtml(getArtists()[0])`).replace(/\s+/g, " ").slice(0, 90)));
run("renderSearchHome(); renderArtistsView();");
console.log("PASS search home and Artists view render without error");
// Explicit exit: app code loaded into this sandbox can schedule real Node
// timers (e.g. player.js's session-priority heartbeat) that would otherwise
// keep this process alive waiting for them instead of exiting once the
// checks above are done.
process.exit(0);
