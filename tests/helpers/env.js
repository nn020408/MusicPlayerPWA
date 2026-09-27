// A fake browser for tests: `document`, `window`, `localStorage`, `navigator`
// and friends, where any element lookup returns a stub that accepts any property
// access or call. Lets the app's top-level wiring code run in Node.
//
//   const { ctx, store } = createEnv();
//   vm.createContext(ctx)            // for the sandboxed tests, or
//   Object.assign(globalThis, ctx)   // for importing the real ES modules

function stub() {
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
      return stub();
    },
    set(_, p, v) {
      target[p] = v;
      return true;
    },
    apply() {
      return stub();
    },
  });
}

function createEnv() {
  const store = {};
  const window = {
    Capacitor: undefined,
    location: { origin: "http://localhost", pathname: "/" },
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
  };
  const document = {
    getElementById: () => stub(),
    querySelector: () => stub(),
    querySelectorAll: () => [],
    createElement: () => stub(),
    addEventListener() {},
    body: stub(),
    documentElement: stub(),
    hidden: false,
    visibilityState: "visible",
    head: stub(),
  };
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Map, Set, AbortController, URL, Blob, TextDecoder, Date, Math, JSON, Array, Object, String, Number, RegExp, Error, Uint8Array, ArrayBuffer, DataView,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    window,
    document,
    navigator: { userAgent: "test", mediaSession: undefined },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    Audio: function () { return stub(); },
    MediaMetadata: function () {},
    FileReader: function () {},
    msal: { PublicClientApplication: function () { return { initialize: async () => {}, handleRedirectPromise: async () => null, getAllAccounts: () => [], acquireTokenSilent: async () => ({}) }; } },
    jsmediatags: {},
    fetch: async () => { throw new Error("offline in test"); },
    MutationObserver: function () { return { observe() {} }; },
    prompt() {},
    confirm() { return false; },
    requestAnimationFrame: (f) => setTimeout(f, 0),
    performance: { now: () => Date.now() },
    encodeURIComponent,
    decodeURIComponent,
  };
  ctx.window = Object.assign(window, ctx, { window });
  return { ctx, store };
}

module.exports = { createEnv, stub };
