// data/auth.js's native token refresh: concurrent callers near expiry must
// share one refresh request, not fire one each. Refresh tokens are typically
// single-use/rotating, so two requests racing with the same (about to be
// invalidated) refresh token can have the second one rejected even though
// the first actually succeeded — forcing a spurious full sign-out in an app
// that routinely has several Graph requests in flight at once (the indexer,
// prefetching, a folder listing).
//
// The actual refresh-token POST lives in native (NativeAuthClient.java) —
// auth.js only ever calls NativePlayer.getAccessToken() and relays the
// result, confirmed on-device as the fix for an account lockout: JS used to
// run its own separate POST here too, and that second, uncoordinated copy
// racing native's own refresh is what got the login flagged by Microsoft as
// a "client request loop" (AADSTS50196). This test's own single-flight
// guard (refreshPromise) still matters even with native doing the real
// work — without it, 3 concurrent callers would still make 3 redundant
// plugin calls instead of sharing 1.
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

// Minimal native-platform + storage stub — auth.js touches no DOM at all, so
// this doesn't need jsdom, same as tests/playback-intent.test.js.
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

let postCalls = 0;
let postDelayMs = 20; // a window a second concurrent call could race into
let nativeShouldFail = false;
globalThis.window = {
  location: { origin: "https://localhost", pathname: "/index.html" }, // auth.js's web-side MSAL config reads this unconditionally at module load
  Capacitor: {
    isNativePlatform: () => true,
    Plugins: {
      NativePlayer: {
        // Stands in for NativeAuthClient's own refresh — the single place
        // the real POST happens now (see this file's header comment).
        getAccessToken: () => new Promise((resolve, reject) => {
          setTimeout(() => {
            postCalls++;
            if (nativeShouldFail) { reject(new Error("Token refresh rejected")); return; }
            resolve({ accessToken: "fresh-token-" + postCalls, refreshToken: "fresh-refresh-" + postCalls, expiresAt: Date.now() + 3600 * 1000 });
          }, postDelayMs);
        }),
        addListener: () => {}, // auth.js registers the "nativeAuthTokensUpdated" listener unconditionally at module load on the native side
        setAuthTokens: () => {}, // storeNativeTokens() echoes the fresh token back to native after every refresh
      },
      App: { addListener: () => {} }, // auth.js registers its OAuth-redirect listener unconditionally at module load on the native side
      Browser: { open: () => {}, close: () => Promise.resolve() },
    },
  },
};
globalThis.msal = { PublicClientApplication: function () { return {}; } }; // auth.js constructs this unconditionally at module load, web side

(async () => {
  const { getAccessToken } = await import(pathToFileURL(path.join(ROOT, "js", "data", "auth.js")).href);

  // ---- no tokens stored at all: a clear "not signed in" error, no network call
  let threwNotSignedIn = false;
  try { await getAccessToken(); } catch (e) { threwNotSignedIn = /Not signed in/.test(e.message); }
  check("no stored tokens: throws a clear error, no request made", threwNotSignedIn && postCalls === 0);

  // ---- an already-expired token: concurrent callers share ONE refresh request
  store.nativeAuthTokens = JSON.stringify({ accessToken: "stale", refreshToken: "refresh-1", expiresAt: Date.now() - 1000 });
  const [a, b, c] = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
  check("only one refresh request was actually sent for 3 concurrent callers", postCalls === 1, `${postCalls} requests`);
  check("every concurrent caller got the same fresh token", a === b && b === c, `${a} / ${b} / ${c}`);

  // ---- a still-valid token: returned directly, no network call at all
  postCalls = 0;
  store.nativeAuthTokens = JSON.stringify({ accessToken: "still-good", refreshToken: "refresh-2", expiresAt: Date.now() + 10 * 60 * 1000 });
  const direct = await getAccessToken();
  check("a non-expired token is returned without refreshing", direct === "still-good" && postCalls === 0);

  // ---- a failed refresh clears the stored tokens and gives a clear error
  store.nativeAuthTokens = JSON.stringify({ accessToken: "stale2", refreshToken: "bad-refresh", expiresAt: Date.now() - 1000 });
  nativeShouldFail = true;
  let threwExpired = false;
  try { await getAccessToken(); } catch (e) { threwExpired = /Sign-in expired/.test(e.message); }
  check("a failed refresh clears the stored tokens and says sign-in expired", threwExpired && store.nativeAuthTokens === undefined);

  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL auth-refresh test crashed: " + (e && e.stack || e)); process.exit(1); });
